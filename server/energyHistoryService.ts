/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  isSqliteCorruptionError,
  openResilientDatabase,
  resetAndReopenDatabase,
} from './sqliteResilience.ts';
import type { Appliance, Classroom, SchoolSettings } from '../src/types/energy.ts';
import {
  INITIAL_CLASSROOMS,
  INITIAL_SCHOOL_SETTINGS,
  computeHeatIndex,
} from '../src/data/initialClassrooms.ts';
import {
  ROOM_APPLIANCE_SPECS,
  TOTAL_CAMPUS_RATED_POWER_WATTS,
  computeRoomRatedPowerWatts,
} from '../src/data/roomApplianceSpecs.ts';
import { computeApplianceWatts } from '../src/utils/applianceUtils.ts';
import type {
  HistoricalAnomaliesResponse,
  HistoricalAnomaly,
  HistoricalInvestigationResponse,
  HistoryBlockRanking,
  HistoryClassroomRanking,
  HistoryDatePreset,
  HistoryEventRecord,
  HistoryOverviewResponse,
  HistoryRangeMeta,
  HistoryTrendPoint,
  RoomHistoryDetailResponse,
  RoomHistoryPoint,
  TimeOfDayHourBucket,
  TimeOfDayProfileResponse,
} from '../src/types/history.ts';
import {
  computePrecedingEquivalentRange,
  enumerateIstDates,
  formatIstFullLabel,
  formatIstShortLabel,
  formatIstTimestampLabel,
  getIstDateString,
  getIstDayOfWeek,
  getIstHourAndMinute,
  isValidIstDate,
  parseIstDateToUtcMs,
  resolveHistoryPresetRange,
  shiftIstDate,
} from '../src/utils/historyDates.ts';

const DB_PATH = path.resolve(process.cwd(), '.roomwise-history.db');
const RETENTION_DAYS = 92;
const SEED_VERSION = 'v3-canonical-operational';

interface IntervalRow {
  bucket_key: string;
  ts_ms: number;
  date_ist: string;
  hour_ist: number;
  day_type: 'school' | 'saturday' | 'holiday' | 'sunday';
  room_id: string;
  room_code: string;
  building: string;
  floor: string;
  room_type: string;
  occupied_fraction: number;
  avg_occupants: number;
  temperature_c: number;
  humidity_pct: number;
  natural_lux: number;
  ambient_lux: number;
  lights_avg_pct: number;
  fan_avg_pct: number;
  manual_share: number;
  lights_watts: number;
  fan_watts: number;
  aux_watts: number;
  total_watts: number;
  rated_watts: number;
  lights_kwh: number;
  fan_kwh: number;
  aux_kwh: number;
  actual_kwh: number;
  rated_kwh: number;
  interval_hours: number;
  source: 'seeded' | 'snapshot' | 'event';
}

interface EventRow {
  id: string;
  ts_ms: number;
  date_ist: string;
  hour_ist: number;
  room_id: string;
  room_code: string;
  building: string;
  event_type: string;
  summary: string;
  actor: string;
  before_watts: number;
  after_watts: number;
  delta_watts: number;
}

const roomById = new Map<string, Classroom>(INITIAL_CLASSROOMS.map((r) => [r.id, r]));

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededUnit(key: string): number {
  let x = hashSeed(key) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

const specByRoomId = new Map(ROOM_APPLIANCE_SPECS.map((s) => [s.roomId, s]));

function computeLightsWattsFromSpec(roomId: string, pct: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (clamped <= 0) return 0;
  const spec = specByRoomId.get(roomId);
  if (!spec || spec.lights.count <= 0) return 0;
  const perFixture = Math.round(spec.lights.totalWatts / spec.lights.count);
  return computeApplianceWatts('lights', perFixture, clamped) * spec.lights.count;
}

function computeFanWattsFromSpec(roomId: string, pct: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (clamped <= 0) return 0;
  const spec = specByRoomId.get(roomId);
  if (!spec || spec.fans.count <= 0) return 0;
  const perFan = Math.round(spec.fans.totalWatts / spec.fans.count);
  return computeApplianceWatts('fan', perFan, clamped) * spec.fans.count;
}

function computeAuxWattsFromSpec(roomId: string, pct: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (clamped <= 0) return 0;
  const spec = specByRoomId.get(roomId);
  if (!spec?.aux) return 0;
  return computeApplianceWatts(spec.aux.type, spec.aux.powerRatingWatts, clamped);
}

function classifyIstDay(
  dateIst: string,
  todayIst: string
): 'school' | 'saturday' | 'holiday' | 'sunday' {
  const dow = getIstDayOfWeek(dateIst);
  if (dow === 0) return 'sunday';

  // Keep today & yesterday strictly aligned with campus operating days unless Sunday
  if (dateIst === todayIst || dateIst === shiftIstDate(todayIst, -1)) {
    return dow === 6 ? 'saturday' : 'school';
  }

  // Realistic IIT Kharagpur academic calendar breaks across trailing 90 days:
  // Gandhi Jayanti (Oct 2), Puja recess (Oct 19-22), Diwali break (Nov 1-2)
  const mmdd = dateIst.slice(5);
  if (
    mmdd === '10-02' ||
    mmdd === '10-19' ||
    mmdd === '10-20' ||
    mmdd === '10-21' ||
    mmdd === '10-22' ||
    mmdd === '11-01' ||
    mmdd === '11-02' ||
    mmdd === '08-15' ||
    mmdd === '09-05'
  ) {
    return 'holiday';
  }

  if (dow === 6) {
    // Second Saturday of month = campus closed holiday
    const dayOfMonth = Number(dateIst.slice(8, 10));
    if (dayOfMonth >= 8 && dayOfMonth <= 14) {
      return 'holiday';
    }
    return 'saturday';
  }

  return 'school';
}

interface SimulatedAnomalyDirective {
  roomId: string;
  dateIst: string;
  hourStart: number;
  hourEnd: number;
  kind:
    | 'post_hours_manual'
    | 'vacant_day_lighting'
    | 'excess_cooling_override'
    | 'event_overrun';
  lightsPct: number;
  fanPct: number;
  auxPct: number;
  occupancyPct: number;
  tempBoostC?: number;
  reasonTag: string;
}

function buildAnomalySchedule(todayIst: string): Map<string, SimulatedAnomalyDirective[]> {
  const schedule = new Map<string, SimulatedAnomalyDirective[]>();
  const add = (d: SimulatedAnomalyDirective) => {
    const arr = schedule.get(d.dateIst) || [];
    arr.push(d);
    schedule.set(d.dateIst, arr);
  };

  const yesterday = shiftIstDate(todayIst, -1);
  const twoDaysAgo = shiftIstDate(todayIst, -2);
  const fourDaysAgo = shiftIstDate(todayIst, -4);
  const sixDaysAgo = shiftIstDate(todayIst, -6);
  const nineDaysAgo = shiftIstDate(todayIst, -9);
  const fourteenDaysAgo = shiftIstDate(todayIst, -14);
  const twentyTwoDaysAgo = shiftIstDate(todayIst, -22);
  const thirtyFiveDaysAgo = shiftIstDate(todayIst, -35);
  const fortyFourDaysAgo = shiftIstDate(todayIst, -44);
  const fiftyEightDaysAgo = shiftIstDate(todayIst, -58);

  // Yesterday's realistic multi-factor anomalies (great for diagnostic queries like "Why was energy higher yesterday?")
  add({
    roomId: 'g3-301',
    dateIst: yesterday,
    hourStart: 15,
    hourEnd: 19,
    kind: 'post_hours_manual',
    lightsPct: 100,
    fanPct: 75,
    auxPct: 82,
    occupancyPct: 0,
    tempBoostC: 1.8,
    reasonTag: 'Computer Lab AC & workstation bay left in manual override after dismissal (no recent PIR motion)',
  });
  add({
    roomId: 'nb-102',
    dateIst: yesterday,
    hourStart: 10,
    hourEnd: 13,
    kind: 'vacant_day_lighting',
    lightsPct: 90,
    fanPct: 70,
    auxPct: 0,
    occupancyPct: 0,
    reasonTag: 'Class VII-B lighting & fans manually locked ON despite no recent daytime PIR motion',
  });
  add({
    roomId: 'mph-01',
    dateIst: yesterday,
    hourStart: 15,
    hourEnd: 17,
    kind: 'event_overrun',
    lightsPct: 90,
    fanPct: 85,
    auxPct: 100,
    occupancyPct: 24,
    reasonTag: 'Auditorium rehearsal extended post-hours with projector & stage banks active (occupied)',
  });

  // Trailing 7 days anomalies
  add({
    roomId: 'g3-202',
    dateIst: twoDaysAgo,
    hourStart: 11,
    hourEnd: 14,
    kind: 'excess_cooling_override',
    lightsPct: 95,
    fanPct: 100,
    auxPct: 0,
    occupancyPct: 28,
    tempBoostC: 2.3,
    reasonTag: 'Chemistry Lab thermal fan override stayed at 100% during low afternoon occupancy',
  });
  add({
    roomId: 'ob-201',
    dateIst: fourDaysAgo,
    hourStart: 15,
    hourEnd: 18,
    kind: 'post_hours_manual',
    lightsPct: 85,
    fanPct: 60,
    auxPct: 0,
    occupancyPct: 0,
    reasonTag: 'Central Library reading bays left manually illuminated after hours with no recent PIR motion',
  });
  add({
    roomId: 'g3-101',
    dateIst: sixDaysAgo,
    hourStart: 15,
    hourEnd: 17,
    kind: 'post_hours_manual',
    lightsPct: 100,
    fanPct: 80,
    auxPct: 0,
    occupancyPct: 0,
    reasonTag: 'Class XI-A fixtures stayed active 3 hours post-hours while vacant',
  });

  // Trailing 30-day & previous-month anomalies
  add({
    roomId: 'g3-201',
    dateIst: nineDaysAgo,
    hourStart: 16,
    hourEnd: 19,
    kind: 'post_hours_manual',
    lightsPct: 90,
    fanPct: 65,
    auxPct: 100,
    occupancyPct: 0,
    reasonTag: 'Physics Lab optical track & ceiling array stayed powered after dismissal',
  });
  add({
    roomId: 'ob-102',
    dateIst: fourteenDaysAgo,
    hourStart: 9,
    hourEnd: 13,
    kind: 'vacant_day_lighting',
    lightsPct: 100,
    fanPct: 80,
    auxPct: 0,
    occupancyPct: 0,
    reasonTag: 'Class XII-B daytime exam rotation left room vacant with manual 100% override',
  });
  add({
    roomId: 'pp-02',
    dateIst: twentyTwoDaysAgo,
    hourStart: 15,
    hourEnd: 18,
    kind: 'post_hours_manual',
    lightsPct: 85,
    fanPct: 75,
    auxPct: 0,
    occupancyPct: 0,
    reasonTag: 'LKG room lights & fans remained ON post-hours after parent teacher meeting',
  });
  add({
    roomId: 'g3-301',
    dateIst: thirtyFiveDaysAgo,
    hourStart: 15,
    hourEnd: 20,
    kind: 'post_hours_manual',
    lightsPct: 95,
    fanPct: 80,
    auxPct: 85,
    occupancyPct: 0,
    tempBoostC: 2.1,
    reasonTag: 'Computer Lab AC & workstation bay ran into evening hours during vacancy',
  });
  add({
    roomId: 'nb-201',
    dateIst: fortyFourDaysAgo,
    hourStart: 10,
    hourEnd: 14,
    kind: 'excess_cooling_override',
    lightsPct: 95,
    fanPct: 100,
    auxPct: 0,
    occupancyPct: 85,
    tempBoostC: 2.6,
    reasonTag: 'High October humidity & full manual lighting bypass increased Class VIII-A draw',
  });
  add({
    roomId: 'mph-01',
    dateIst: fiftyEightDaysAgo,
    hourStart: 15,
    hourEnd: 19,
    kind: 'post_hours_manual',
    lightsPct: 90,
    fanPct: 80,
    auxPct: 100,
    occupancyPct: 0,
    reasonTag: 'Auditorium stage banks and projector stayed active post-hours after function',
  });

  return schedule;
}

class EnergyHistoryService {
  private db: DatabaseSync;
  private isInitialized = false;
  private lastIntegrationMs = 0;
  private cachedSelectIntervalStmt: ReturnType<DatabaseSync['prepare']> | null = null;
  private cachedUpsertIntervalStmt: ReturnType<DatabaseSync['prepare']> | null = null;
  private cachedInsertControlEventStmt: ReturnType<DatabaseSync['prepare']> | null = null;
  private cachedStmtDb: DatabaseSync | null = null;

  constructor() {
    this.db = openResilientDatabase(DB_PATH, 'energy-history');
    try {
      this.createSchema();
    } catch (err) {
      if (!isSqliteCorruptionError(err)) throw err;
      this.db = resetAndReopenDatabase(this.db, DB_PATH, 'energy-history');
      this.createSchema();
    }
  }

  public getDb(): DatabaseSync {
    return this.db;
  }

  private createSchema(): void {
    // Migrate legacy schema if baseline_watts exists without rated_watts
    const existingCols = this.db
      .prepare("PRAGMA table_info('history_intervals')")
      .all() as Array<{ name: string }>;
    if (existingCols.length > 0 && !existingCols.some((c) => c.name === 'rated_watts')) {
      this.db.exec('DROP TABLE IF EXISTS history_intervals;');
    }

    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -16000;
      PRAGMA temp_store = MEMORY;

      CREATE TABLE IF NOT EXISTS history_intervals (
        bucket_key TEXT PRIMARY KEY,
        ts_ms INTEGER NOT NULL,
        date_ist TEXT NOT NULL,
        hour_ist INTEGER NOT NULL,
        day_type TEXT NOT NULL,
        room_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        building TEXT NOT NULL,
        floor TEXT NOT NULL,
        room_type TEXT NOT NULL,
        occupied_fraction REAL NOT NULL,
        avg_occupants REAL NOT NULL,
        temperature_c REAL NOT NULL,
        humidity_pct REAL NOT NULL,
        natural_lux REAL NOT NULL,
        ambient_lux REAL NOT NULL,
        lights_avg_pct REAL NOT NULL,
        fan_avg_pct REAL NOT NULL,
        manual_share REAL NOT NULL,
        lights_watts REAL NOT NULL,
        fan_watts REAL NOT NULL,
        aux_watts REAL NOT NULL,
        total_watts REAL NOT NULL,
        rated_watts REAL NOT NULL,
        lights_kwh REAL NOT NULL,
        fan_kwh REAL NOT NULL,
        aux_kwh REAL NOT NULL,
        actual_kwh REAL NOT NULL,
        rated_kwh REAL NOT NULL,
        interval_hours REAL NOT NULL,
        source TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hist_date_room
        ON history_intervals (date_ist, room_id);
      CREATE INDEX IF NOT EXISTS idx_hist_building_date
        ON history_intervals (building, date_ist);
      CREATE INDEX IF NOT EXISTS idx_hist_room_ts
        ON history_intervals (room_id, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_hist_date_ts
        ON history_intervals (date_ist, ts_ms, room_code);

      CREATE TABLE IF NOT EXISTS history_events (
        id TEXT PRIMARY KEY,
        ts_ms INTEGER NOT NULL,
        date_ist TEXT NOT NULL,
        hour_ist INTEGER NOT NULL,
        room_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        building TEXT NOT NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        actor TEXT NOT NULL,
        before_watts REAL NOT NULL,
        after_watts REAL NOT NULL,
        delta_watts REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hist_events_date
        ON history_events (date_ist, ts_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_hist_events_room
        ON history_events (room_id, ts_ms DESC);

      CREATE TABLE IF NOT EXISTS history_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  public initialize(now: Date = new Date()): void {
    try {
      this.initializeInternal(now);
    } catch (err) {
      if (!isSqliteCorruptionError(err)) throw err;
      this.db = resetAndReopenDatabase(this.db, DB_PATH, 'energy-history');
      this.createSchema();
      this.initializeInternal(now);
    }
  }

  private initializeInternal(now: Date): void {
    const todayIst = getIstDateString(now);
    const { hour: currentHourIst, minute: currentMinuteIst } = getIstHourAndMinute(now);
    const startWindow = shiftIstDate(todayIst, -(RETENTION_DAYS - 1));

    const versionRow = this.db
      .prepare("SELECT value FROM history_meta WHERE key = 'seed_version'")
      .get() as { value: string } | undefined;
    if (versionRow?.value !== SEED_VERSION) {
      this.db.exec("DELETE FROM history_intervals WHERE source = 'seeded';");
      this.db.exec("DELETE FROM history_events WHERE id LIKE 'seed-ev-%';");
      this.db
        .prepare("INSERT OR REPLACE INTO history_meta (key, value) VALUES ('seed_version', ?)")
        .run(SEED_VERSION);
    }

    const existingDatesRows = this.db
      .prepare('SELECT DISTINCT date_ist FROM history_intervals WHERE date_ist >= ?')
      .all(startWindow) as Array<{ date_ist: string }>;
    const existingDates = new Set(existingDatesRows.map((r) => r.date_ist));

    const allDates = enumerateIstDates(startWindow, todayIst);
    const missingDates = allDates.filter((d) => !existingDates.has(d));

    const existingTodayHourRows = this.db
      .prepare('SELECT DISTINCT hour_ist FROM history_intervals WHERE date_ist = ?')
      .all(todayIst) as Array<{ hour_ist: number }>;
    const existingTodayHours = new Set(existingTodayHourRows.map((r) => r.hour_ist));
    const todayNeedsFill = Array.from({ length: currentHourIst + 1 }, (_, h) => h).some(
      (h) => !existingTodayHours.has(h)
    );

    const anomalySchedule = buildAnomalySchedule(todayIst);

    if (missingDates.length > 0 || todayNeedsFill) {
      this.seedMissingDays(
        missingDates,
        todayIst,
        currentHourIst,
        currentMinuteIst,
        existingTodayHours,
        todayNeedsFill,
        anomalySchedule
      );
    }

    this.ensureSeededAnomalyEvents(anomalySchedule);

    const metaRow = this.db
      .prepare("SELECT value FROM history_meta WHERE key = 'last_integration_ms'")
      .get() as { value: string } | undefined;
    const parsedMetaMs = metaRow ? Number(metaRow.value) : 0;
    this.lastIntegrationMs =
      Number.isFinite(parsedMetaMs) && parsedMetaMs > 0 ? parsedMetaMs : now.getTime();

    this.db
      .prepare("INSERT OR REPLACE INTO history_meta (key, value) VALUES ('last_integration_ms', ?)")
      .run(String(now.getTime()));

    this.isInitialized = true;
  }

  private seedMissingDays(
    missingDates: string[],
    todayIst: string,
    currentHourIst: number,
    currentMinuteIst: number,
    existingTodayHours: Set<number>,
    todayNeedsFill: boolean,
    anomalySchedule: Map<string, SimulatedAnomalyDirective[]>
  ): void {
    const insertInterval = this.db.prepare(`
      INSERT OR IGNORE INTO history_intervals (
        bucket_key, ts_ms, date_ist, hour_ist, day_type,
        room_id, room_code, building, floor, room_type,
        occupied_fraction, avg_occupants, temperature_c, humidity_pct,
        natural_lux, ambient_lux, lights_avg_pct, fan_avg_pct, manual_share,
        lights_watts, fan_watts, aux_watts, total_watts, rated_watts,
        lights_kwh, fan_kwh, aux_kwh, actual_kwh, rated_kwh,
        interval_hours, source
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    const datesToProcess = new Set(missingDates);
    if (todayNeedsFill) {
      datesToProcess.add(todayIst);
    }

    const totalRange = RETENTION_DAYS;
    const todayMs = parseIstDateToUtcMs(todayIst);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const dateIst of Array.from(datesToProcess).sort()) {
        const dayType = classifyIstDay(dateIst, todayIst);
        const dayStartMs = parseIstDateToUtcMs(dateIst);
        const daysAgo = Math.max(0, Math.round((todayMs - dayStartMs) / 86_400_000));
        // Seasonal factor: Aug-Sep warmer/humid (daysAgo 60..90), Nov cooler (daysAgo 0..20)
        const seasonalWarmth = Math.min(1, Math.max(0, (daysAgo - 8) / Math.max(1, totalRange - 12)));
        const dayAnomalies = anomalySchedule.get(dateIst) || [];
        const isYesterday = daysAgo === 1;

        const maxHour =
          dateIst === todayIst ? Math.min(23, Math.max(0, currentHourIst)) : 23;

        for (let hourIst = 0; hourIst <= maxHour; hourIst++) {
          // On today, preserve any existing hours (e.g. live snapshot/event buckets)
          if (dateIst === todayIst && existingTodayHours.has(hourIst)) continue;

          const intervalHours =
            dateIst === todayIst && hourIst === currentHourIst
              ? Math.max(0.05, round3(Math.max(3, currentMinuteIst) / 60))
              : 1.0;

          const hourStartMs = dayStartMs + hourIst * 3_600_000;

          // Outdoor solar irradiance envelope for Kharagpur 22.3°N
          const solarElevation =
            hourIst >= 6 && hourIst <= 17
              ? Math.sin(((hourIst - 5.5) / 12.5) * Math.PI)
              : 0;
          const cloudFactor =
            0.76 + 0.24 * seededUnit(`cloud:${dateIst}:${hourIst}`) - seasonalWarmth * 0.08;
          const outdoorDaylight = Math.max(0, Math.round(460 * solarElevation * cloudFactor));

          // Outdoor diurnal temperature curve: coldest ~05:30 IST, warmest ~13:00-14:00 IST
          const diurnalTemp = Math.sin(((hourIst - 7) / 24) * 2 * Math.PI);
          const middayHeatBoost =
            hourIst >= 11 && hourIst <= 14 ? 2.4 * Math.sin(((hourIst - 10) / 5) * Math.PI) : 0;
          const baseAmbientTemp =
            23.0 + seasonalWarmth * 4.5 + diurnalTemp * 3.2 + middayHeatBoost + (isYesterday ? 1.4 : 0);
          const baseHumidity = Math.round(
            Math.max(46, Math.min(89, 58 + seasonalWarmth * 19 - diurnalTemp * 5))
          );

          for (const room of INITIAL_CLASSROOMS) {
            const matchingAnomaly = dayAnomalies.find(
              (a) => a.roomId === room.id && hourIst >= a.hourStart && hourIst <= a.hourEnd
            );

            // Standard school schedule fraction inside this hour (07:30-14:30 weekdays, 08:00-12:20 Sat)
            let scheduledSchoolFraction = 0;
            if (dayType === 'school') {
              if (hourIst === 7) scheduledSchoolFraction = 0.5;
              else if (hourIst >= 8 && hourIst <= 13) scheduledSchoolFraction = 1.0;
              else if (hourIst === 14) scheduledSchoolFraction = 0.5;
            } else if (dayType === 'saturday') {
              if (hourIst >= 8 && hourIst <= 11) scheduledSchoolFraction = 0.9;
              else if (hourIst === 12) scheduledSchoolFraction = 0.35;
            }

            // Determine realistic occupancy per room type & hour
            let occRatio = 0;
            const roomJitter = seededUnit(`occ:${dateIst}:${hourIst}:${room.id}`);

            if (scheduledSchoolFraction > 0) {
              if (room.type === 'Auditorium') {
                // Auditorium occupied for scheduled morning assemblies or peak midday events
                const hasAssembly =
                  (dayType === 'school' && hourIst === 9 && seededUnit(`aud:${dateIst}`) > 0.55) ||
                  (hourIst >= 11 && hourIst <= 13 && seededUnit(`aud-aft:${dateIst}`) > 0.52);
                occRatio = hasAssembly ? 0.54 + roomJitter * 0.28 : 0;
              } else if (room.type === 'Science Lab' || room.type === 'Computer Lab') {
                // Practical lab batches peak late morning / midday (10:00-13:00 IST)
                const labSlot = seededUnit(`lab:${dateIst}:${hourIst}:${room.id}`);
                const labThreshold = hourIst >= 10 && hourIst <= 13 ? 0.14 : hourIst <= 8 ? 0.55 : 0.32;
                occRatio = labSlot > labThreshold ? (0.72 + roomJitter * 0.22) * scheduledSchoolFraction : 0;
              } else if (room.type === 'Pre-Primary Activity Room') {
                // Pre-Primary finishes around 12:30
                occRatio =
                  hourIst <= 12
                    ? (0.76 + roomJitter * 0.16) * scheduledSchoolFraction
                    : 0;
              } else if (room.type === 'Staff Room') {
                occRatio = (0.38 + roomJitter * 0.32) * scheduledSchoolFraction;
              } else if (room.type === 'Library') {
                occRatio = (0.32 + roomJitter * 0.35) * scheduledSchoolFraction;
              } else {
                // General classrooms: full instructional schedule; brief recess stagger & occasional lab rotation
                const isFreePeriod =
                  room.id === 'nb-102' && hourIst === 10 && dateIst === todayIst
                    ? true
                    : hourIst === 8
                    ? roomJitter < 0.18
                    : roomJitter < 0.09;
                if (isFreePeriod) {
                  occRatio = 0;
                } else {
                  occRatio = (0.78 + roomJitter * 0.18) * scheduledSchoolFraction;
                }
              }
            }

            // Override occupancy if anomaly directive applies
            if (matchingAnomaly) {
              occRatio = matchingAnomaly.occupancyPct / 100;
            }

            const roomTemp = round1(
              Math.max(
                20.5,
                Math.min(
                  36.2,
                  baseAmbientTemp +
                    (room.floor.includes('3rd') || room.floor.includes('2nd') ? 1.2 : -0.3) +
                    occRatio * 1.5 +
                    (matchingAnomaly?.tempBoostC || 0) +
                    (roomJitter - 0.5) * 0.6
                )
              )
            );

            const roomAlpha = room.calibration.learnedParameters.daylightPenetrationAlpha;
            const natLux =
              outdoorDaylight <= 0
                ? 0
                : Math.round(
                    Math.max(
                      5,
                      Math.min(475, outdoorDaylight * (0.45 + roomAlpha * 1.45))
                    )
                  );

            let lightsPct = 0;
            let fanPct = 0;
            let auxPct = 0;
            let manualShare = 0;

            if (matchingAnomaly) {
              lightsPct = matchingAnomaly.lightsPct;
              fanPct = matchingAnomaly.fanPct;
              auxPct = matchingAnomaly.auxPct;
              manualShare = 1.0;
            } else if (occRatio > 0.04) {
              // Adaptive closed-loop daylight harvesting with blackboard glare-control floor (25%)
              const targetLux = room.calibration.manualParameters.targetLux || 300;
              const effectiveAlpha = hourIst >= 11 && hourIst <= 14 ? roomAlpha * 0.85 : roomAlpha;
              const natContrib = natLux * effectiveAlpha;
              const artificialLuxNeeded = Math.max(0, targetLux - natContrib);
              const daylightMinFloor = hourIst >= 10 && hourIst <= 14 ? 28 : 22;
              lightsPct = Math.max(
                daylightMinFloor,
                Math.min(100, Math.round((artificialLuxNeeded / 240) * 100))
              );

              if (isYesterday) {
                lightsPct = Math.min(100, Math.round(lightsPct * 1.12));
              }

              const hi = computeHeatIndex(roomTemp, baseHumidity);
              if (hi >= 33) fanPct = 95;
              else if (hi >= 30.5) fanPct = 80;
              else if (hi >= 28) fanPct = 65;
              else if (hi >= 25.5) fanPct = 45;
              else fanPct = 20;

              if (room.type === 'Computer Lab') {
                // Computer lab inverter compressor load increases meaningfully during midday ambient warmth
                const middayAcBump = hourIst >= 11 && hourIst <= 14 ? 22 : hourIst === 10 ? 12 : 0;
                auxPct = Math.max(
                  35,
                  Math.min(92, Math.round(40 + seasonalWarmth * 22 + middayAcBump + (isYesterday ? 10 : 0)))
                );
              } else if (room.type === 'Auditorium' && occRatio > 0.2) {
                auxPct = 85;
              }
            } else {
              // Vacant: Adaptive eco shedding turns loads OFF, with rare tiny manual-switch human slip (~1% chance)
              const slip = seededUnit(`slip:${dateIst}:${hourIst}:${room.id}`);
              if (dayType !== 'sunday' && scheduledSchoolFraction > 0 && slip > 0.975) {
                lightsPct = 55;
                fanPct = 40;
                manualShare = 0.5;
              } else if (dayType !== 'sunday' && hourIst >= 15 && hourIst <= 17 && slip > 0.992) {
                lightsPct = 65;
                fanPct = 0;
                manualShare = 1.0;
              }
            }

            // Duty cycle inside hour: partial school bell hours (07:30-08:00, 14:00-14:30) operate only for scheduledSchoolFraction unless an anomaly overrides
            const dutyFactor =
              matchingAnomaly || scheduledSchoolFraction === 0
                ? 1.0
                : scheduledSchoolFraction;

            const lightsWatts = Math.round(computeLightsWattsFromSpec(room.id, lightsPct) * dutyFactor);
            const fanWatts = Math.round(computeFanWattsFromSpec(room.id, fanPct) * dutyFactor);
            const auxWatts = Math.round(computeAuxWattsFromSpec(room.id, auxPct) * dutyFactor);
            const totalWatts = lightsWatts + fanWatts + auxWatts;

            // Canonical installed rated ceiling for this room & interval
            const ratedWatts = computeRoomRatedPowerWatts(room.id);

            // Physics-strict Energy (kWh) = Power (kW) × Time (hours)
            const lightsKWh = round4((lightsWatts / 1000) * intervalHours);
            const fanKWh = round4((fanWatts / 1000) * intervalHours);
            const auxKWh = round4((auxWatts / 1000) * intervalHours);
            const actualKWh = round4(lightsKWh + fanKWh + auxKWh);
            const ratedKWh = round4((ratedWatts / 1000) * intervalHours);

            const avgOccupants = round1(occRatio * room.capacity);
            const artificialLux = Math.round((lightsPct / 100) * 240);
            const ambientLux = Math.round(natLux * roomAlpha + artificialLux);

            const bucketKey = `${dateIst}:${String(hourIst).padStart(2, '0')}:${room.id}`;

            insertInterval.run(
              bucketKey,
              hourStartMs,
              dateIst,
              hourIst,
              dayType,
              room.id,
              room.roomCode,
              room.building,
              room.floor,
              room.type,
              round3(occRatio),
              avgOccupants,
              roomTemp,
              baseHumidity,
              natLux,
              ambientLux,
              lightsPct,
              fanPct,
              manualShare,
              lightsWatts,
              fanWatts,
              auxWatts,
              totalWatts,
              ratedWatts,
              lightsKWh,
              fanKWh,
              auxKWh,
              actualKWh,
              ratedKWh,
              intervalHours,
              'seeded'
            );
          }
        }
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      console.error('[history] Failed seeding intervals:', err);
    }
  }

  private ensureSeededAnomalyEvents(
    anomalySchedule: Map<string, SimulatedAnomalyDirective[]>
  ): void {
    const insertEvent = this.db.prepare(`
      INSERT OR IGNORE INTO history_events (
        id, ts_ms, date_ist, hour_ist, room_id, room_code, building,
        event_type, summary, actor, before_watts, after_watts, delta_watts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const [dateIst, directives] of anomalySchedule.entries()) {
        for (const d of directives) {
          const room = roomById.get(d.roomId);
          if (!room) continue;
          const afterW =
            computeLightsWattsFromSpec(d.roomId, d.lightsPct) +
            computeFanWattsFromSpec(d.roomId, d.fanPct) +
            computeAuxWattsFromSpec(d.roomId, d.auxPct);
          const tsMs = parseIstDateToUtcMs(dateIst) + d.hourStart * 3_600_000 + 600_000;
          const evId = `seed-ev-${dateIst}-${d.roomId}-${d.hourStart}`;
          insertEvent.run(
            evId,
            tsMs,
            dateIst,
            d.hourStart,
            room.id,
            room.roomCode,
            room.building,
            'manual_override_detected',
            d.reasonTag,
            'Node Telemetry Log',
            0,
            afterW,
            afterW
          );
        }
      }
      this.db.exec('COMMIT;');
    } catch {
      this.db.exec('ROLLBACK;');
    }
  }

  /**
   * Integrates elapsed energy (Power kW * dt Hours) from the live classroom appliance store
   * without inflating or duplicating intervals.
   */
  public recordLiveSnapshot(
    rooms: Array<{
      id?: string;
      roomId?: string;
      roomCode: string;
      appliances: Appliance[];
      isVacantDefault?: boolean;
    }>,
    nowMs: number = Date.now(),
    source: 'snapshot' | 'event' = 'snapshot'
  ): void {
    if (!this.isInitialized) return;

    const elapsedMs = Math.max(0, Math.min(900_000, nowMs - this.lastIntegrationMs));
    this.lastIntegrationMs = nowMs;
    if (elapsedMs < 500 && source === 'snapshot') return;

    const dtHours = Math.max(0.0002, elapsedMs / 3_600_000);
    const nowDate = new Date(nowMs);
    const dateIst = getIstDateString(nowDate);
    const { hour: hourIst } = getIstHourAndMinute(nowDate);
    const hourStartMs = parseIstDateToUtcMs(dateIst) + hourIst * 3_600_000;
    const dayType = classifyIstDay(dateIst, dateIst);

    const selectExisting = this.db.prepare(
      'SELECT * FROM history_intervals WHERE bucket_key = ?'
    );
    const upsertStmt = this.db.prepare(`
      INSERT INTO history_intervals (
        bucket_key, ts_ms, date_ist, hour_ist, day_type,
        room_id, room_code, building, floor, room_type,
        occupied_fraction, avg_occupants, temperature_c, humidity_pct,
        natural_lux, ambient_lux, lights_avg_pct, fan_avg_pct, manual_share,
        lights_watts, fan_watts, aux_watts, total_watts, rated_watts,
        lights_kwh, fan_kwh, aux_kwh, actual_kwh, rated_kwh,
        interval_hours, source
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
      ON CONFLICT(bucket_key) DO UPDATE SET
        lights_watts = excluded.lights_watts,
        fan_watts = excluded.fan_watts,
        aux_watts = excluded.aux_watts,
        total_watts = excluded.total_watts,
        lights_avg_pct = excluded.lights_avg_pct,
        fan_avg_pct = excluded.fan_avg_pct,
        manual_share = excluded.manual_share,
        lights_kwh = excluded.lights_kwh,
        fan_kwh = excluded.fan_kwh,
        aux_kwh = excluded.aux_kwh,
        actual_kwh = excluded.actual_kwh,
        rated_kwh = excluded.rated_kwh,
        interval_hours = excluded.interval_hours,
        source = excluded.source
    `);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const r of rooms) {
        const rid = r.id || r.roomId || '';
        const base = roomById.get(rid);
        if (!base) continue;

        let lightsW = 0;
        let fanW = 0;
        let auxW = 0;
        let lSum = 0;
        let lCnt = 0;
        let fSum = 0;
        let fCnt = 0;
        let manCnt = 0;

        for (const a of r.appliances) {
          if (a.type === 'lights') {
            lightsW += a.currentPowerWatts;
            lSum += a.outputPercent ?? 0;
            lCnt++;
          } else if (a.type === 'fan') {
            fanW += a.currentPowerWatts;
            fSum += a.outputPercent ?? 0;
            fCnt++;
          } else {
            auxW += a.currentPowerWatts;
          }
          if (a.operatingMode === 'MANUAL' || a.isManualOverride) {
            manCnt++;
          }
        }

        const totalW = lightsW + fanW + auxW;
        const lAvgPct = lCnt > 0 ? Math.round(lSum / lCnt) : 0;
        const fAvgPct = fCnt > 0 ? Math.round(fSum / fCnt) : 0;
        const manShare = r.appliances.length > 0 ? round3(manCnt / r.appliances.length) : 0;

        const bucketKey = `${dateIst}:${String(hourIst).padStart(2, '0')}:${base.id}`;
        const prev = selectExisting.get(bucketKey) as IntervalRow | undefined;

        const ratedW = computeRoomRatedPowerWatts(base.id);

        if (prev) {
          const prevHrs = Math.max(0.01, prev.interval_hours);
          const nextHrs = Math.min(1.0, round4(prevHrs + dtHours));
          const addLightsKWh = round4((lightsW / 1000) * dtHours);
          const addFanKWh = round4((fanW / 1000) * dtHours);
          const addAuxKWh = round4((auxW / 1000) * dtHours);
          const addRatedKWh = round4((ratedW / 1000) * dtHours);

          const nextLightsKWh = round4(prev.lights_kwh + addLightsKWh);
          const nextFanKWh = round4(prev.fan_kwh + addFanKWh);
          const nextAuxKWh = round4(prev.aux_kwh + addAuxKWh);
          const nextActualKWh = round4(nextLightsKWh + nextFanKWh + nextAuxKWh);
          const nextRatedKWh = round4(prev.rated_kwh + addRatedKWh);

          upsertStmt.run(
            bucketKey,
            prev.ts_ms,
            dateIst,
            hourIst,
            dayType,
            base.id,
            base.roomCode,
            base.building,
            base.floor,
            base.type,
            prev.occupied_fraction,
            prev.avg_occupants,
            prev.temperature_c,
            prev.humidity_pct,
            prev.natural_lux,
            prev.ambient_lux,
            lAvgPct,
            fAvgPct,
            manShare,
            round1((nextLightsKWh * 1000) / nextHrs),
            round1((nextFanKWh * 1000) / nextHrs),
            round1((nextAuxKWh * 1000) / nextHrs),
            round1((nextActualKWh * 1000) / nextHrs),
            ratedW,
            nextLightsKWh,
            nextFanKWh,
            nextAuxKWh,
            nextActualKWh,
            nextRatedKWh,
            nextHrs,
            source === 'event' ? 'event' : prev.source === 'event' ? 'event' : 'snapshot'
          );
        } else {
          const lightsKWh = round4((lightsW / 1000) * dtHours);
          const fanKWh = round4((fanW / 1000) * dtHours);
          const auxKWh = round4((auxW / 1000) * dtHours);
          const actualKWh = round4(lightsKWh + fanKWh + auxKWh);
          const ratedKWh = round4((ratedW / 1000) * dtHours);
          const occFrac = r.isVacantDefault ? 0 : round3(base.currentOccupants / Math.max(1, base.capacity));

          upsertStmt.run(
            bucketKey,
            hourStartMs,
            dateIst,
            hourIst,
            dayType,
            base.id,
            base.roomCode,
            base.building,
            base.floor,
            base.type,
            occFrac,
            r.isVacantDefault ? 0 : base.currentOccupants,
            base.environment.temperature,
            base.environment.humidity,
            base.environment.naturalDaylightLux,
            base.environment.ambientLux,
            lAvgPct,
            fAvgPct,
            manShare,
            lightsW,
            fanW,
            auxW,
            totalW,
            ratedW,
            lightsKWh,
            fanKWh,
            auxKWh,
            actualKWh,
            ratedKWh,
            round4(dtHours),
            source
          );
        }
      }

      this.db
        .prepare("INSERT OR REPLACE INTO history_meta (key, value) VALUES ('last_integration_ms', ?)")
        .run(String(nowMs));
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      console.error('[history] recordLiveSnapshot error:', err);
    }
  }

  private ensureControlStatements() {
    if (this.cachedStmtDb !== this.db) {
      this.cachedStmtDb = this.db;
      this.cachedSelectIntervalStmt = this.db.prepare(
        'SELECT * FROM history_intervals WHERE bucket_key = ?'
      );
      this.cachedUpsertIntervalStmt = this.db.prepare(`
        INSERT INTO history_intervals (
          bucket_key, ts_ms, date_ist, hour_ist, day_type,
          room_id, room_code, building, floor, room_type,
          occupied_fraction, avg_occupants, temperature_c, humidity_pct,
          natural_lux, ambient_lux, lights_avg_pct, fan_avg_pct, manual_share,
          lights_watts, fan_watts, aux_watts, total_watts, rated_watts,
          lights_kwh, fan_kwh, aux_kwh, actual_kwh, rated_kwh,
          interval_hours, source
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?
        )
        ON CONFLICT(bucket_key) DO UPDATE SET
          lights_watts = excluded.lights_watts,
          fan_watts = excluded.fan_watts,
          aux_watts = excluded.aux_watts,
          total_watts = excluded.total_watts,
          lights_avg_pct = excluded.lights_avg_pct,
          fan_avg_pct = excluded.fan_avg_pct,
          manual_share = excluded.manual_share,
          lights_kwh = excluded.lights_kwh,
          fan_kwh = excluded.fan_kwh,
          aux_kwh = excluded.aux_kwh,
          actual_kwh = excluded.actual_kwh,
          rated_kwh = excluded.rated_kwh,
          interval_hours = excluded.interval_hours,
          source = excluded.source
      `);
      this.cachedInsertControlEventStmt = this.db.prepare(`
        INSERT INTO history_events (
          id, ts_ms, date_ist, hour_ist, room_id, room_code, building,
          event_type, summary, actor, before_watts, after_watts, delta_watts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    return {
      selectExisting: this.cachedSelectIntervalStmt!,
      upsertStmt: this.cachedUpsertIntervalStmt!,
      insertControlEvent: this.cachedInsertControlEventStmt!,
    };
  }

  /**
   * Fast targeted single-room snapshot update for individual classroom control actions.
   * Updates only the affected room's current hourly bucket (1 SELECT + 1 UPSERT instead of 25)
   * without advancing the global 25-room elapsed energy integration clock.
   */
  public recordRoomControlSnapshot(
    room: {
      id?: string;
      roomId?: string;
      roomCode: string;
      appliances: Appliance[];
      isVacantDefault?: boolean;
    },
    nowMs: number = Date.now()
  ): void {
    if (!this.isInitialized) return;
    const rid = room.id || room.roomId || '';
    const base = roomById.get(rid);
    if (!base) return;

    const nowDate = new Date(nowMs);
    const dateIst = getIstDateString(nowDate);
    const { hour: hourIst } = getIstHourAndMinute(nowDate);
    const hourStartMs = parseIstDateToUtcMs(dateIst) + hourIst * 3_600_000;
    const dayType = classifyIstDay(dateIst, dateIst);

    let lightsW = 0;
    let fanW = 0;
    let auxW = 0;
    let lSum = 0;
    let lCnt = 0;
    let fSum = 0;
    let fCnt = 0;
    let manCnt = 0;

    for (const a of room.appliances) {
      if (a.type === 'lights') {
        lightsW += a.currentPowerWatts;
        lSum += a.outputPercent ?? 0;
        lCnt++;
      } else if (a.type === 'fan') {
        fanW += a.currentPowerWatts;
        fSum += a.outputPercent ?? 0;
        fCnt++;
      } else {
        auxW += a.currentPowerWatts;
      }
      if (a.operatingMode === 'MANUAL' || a.isManualOverride) {
        manCnt++;
      }
    }

    const totalW = lightsW + fanW + auxW;
    const lAvgPct = lCnt > 0 ? Math.round(lSum / lCnt) : 0;
    const fAvgPct = fCnt > 0 ? Math.round(fSum / fCnt) : 0;
    const manShare = room.appliances.length > 0 ? round3(manCnt / room.appliances.length) : 0;
    const bucketKey = `${dateIst}:${String(hourIst).padStart(2, '0')}:${base.id}`;

    const ratedW = computeRoomRatedPowerWatts(base.id);

    try {
      const { selectExisting, upsertStmt } = this.ensureControlStatements();
      const prev = selectExisting.get(bucketKey) as IntervalRow | undefined;

      if (prev) {
        upsertStmt.run(
          bucketKey,
          prev.ts_ms,
          dateIst,
          hourIst,
          dayType,
          base.id,
          base.roomCode,
          base.building,
          base.floor,
          base.type,
          prev.occupied_fraction,
          prev.avg_occupants,
          prev.temperature_c,
          prev.humidity_pct,
          prev.natural_lux,
          prev.ambient_lux,
          lAvgPct,
          fAvgPct,
          manShare,
          lightsW,
          fanW,
          auxW,
          totalW,
          ratedW,
          prev.lights_kwh,
          prev.fan_kwh,
          prev.aux_kwh,
          prev.actual_kwh,
          prev.rated_kwh,
          prev.interval_hours,
          'event'
        );
      } else {
        const dtHours = 0.0002;
        const lightsKWh = round4((lightsW / 1000) * dtHours);
        const fanKWh = round4((fanW / 1000) * dtHours);
        const auxKWh = round4((auxW / 1000) * dtHours);
        const actualKWh = round4(lightsKWh + fanKWh + auxKWh);
        const ratedKWh = round4((ratedW / 1000) * dtHours);
        const occFrac = room.isVacantDefault ? 0 : round3(base.currentOccupants / Math.max(1, base.capacity));

        upsertStmt.run(
          bucketKey,
          hourStartMs,
          dateIst,
          hourIst,
          dayType,
          base.id,
          base.roomCode,
          base.building,
          base.floor,
          base.type,
          occFrac,
          room.isVacantDefault ? 0 : base.currentOccupants,
          base.environment.temperature,
          base.environment.humidity,
          base.environment.naturalDaylightLux,
          base.environment.ambientLux,
          lAvgPct,
          fAvgPct,
          manShare,
          lightsW,
          fanW,
          auxW,
          totalW,
          ratedW,
          lightsKWh,
          fanKWh,
          auxKWh,
          actualKWh,
          ratedKWh,
          round4(dtHours),
          'event'
        );
      }
    } catch (err) {
      console.error('[history] recordRoomControlSnapshot error:', err);
    }
  }

  public recordControlEvent(params: {
    roomId: string;
    roomCode: string;
    building?: string;
    eventType: string;
    summary: string;
    actor: string;
    beforeWatts: number;
    afterWatts: number;
    tsMs?: number;
  }): void {
    if (!this.isInitialized) return;
    const tsMs = params.tsMs ?? Date.now();
    const d = new Date(tsMs);
    const dateIst = getIstDateString(d);
    const { hour } = getIstHourAndMinute(d);
    const base = roomById.get(params.roomId);
    const id = `ev-${tsMs}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const { insertControlEvent } = this.ensureControlStatements();
      insertControlEvent.run(
        id,
        tsMs,
        dateIst,
        hour,
        params.roomId,
        params.roomCode,
        params.building || base?.building || 'Campus',
        params.eventType,
        params.summary,
        params.actor,
        Math.round(params.beforeWatts),
        Math.round(params.afterWatts),
        Math.round(params.afterWatts - params.beforeWatts)
      );
    } catch (err) {
      console.error('[history] recordControlEvent error:', err);
    }
  }

  public resolveRangeParams(params: {
    preset?: string;
    startDate?: string;
    endDate?: string;
    naturalQuery?: string;
  }): { preset: HistoryDatePreset; startDate: string; endDate: string } {
    const now = new Date();
    const today = getIstDateString(now);

    if (params.naturalQuery && params.naturalQuery.trim()) {
      return resolveNaturalDateQuery(params.naturalQuery, now);
    }

    const validPresets = new Set<HistoryDatePreset>([
      'today',
      'yesterday',
      'last_7_days',
      'last_30_days',
      'this_month',
      'previous_month',
      'custom',
    ]);

    const preset: HistoryDatePreset = validPresets.has(params.preset as HistoryDatePreset)
      ? (params.preset as HistoryDatePreset)
      : params.startDate || params.endDate
      ? 'custom'
      : 'last_7_days';

    if (preset === 'custom') {
      const start = isValidIstDate(params.startDate) ? params.startDate : shiftIstDate(today, -6);
      const end = isValidIstDate(params.endDate) ? params.endDate : today;
      const ordered = start <= end ? { startDate: start, endDate: end } : { startDate: end, endDate: start };
      // Guard excessively wide ranges
      const days = enumerateIstDates(ordered.startDate, ordered.endDate);
      if (days.length > 180) {
        return {
          preset,
          startDate: shiftIstDate(ordered.endDate, -179),
          endDate: ordered.endDate,
        };
      }
      return { preset, ...ordered };
    }

    return {
      preset,
      ...resolveHistoryPresetRange(preset, params.startDate, params.endDate, now),
    };
  }

  private buildRangeMeta(
    preset: HistoryDatePreset,
    startDate: string,
    endDate: string,
    recordedRoomIntervals: number,
    scopeRoomCount: number
  ): HistoryRangeMeta {
    const now = new Date();
    const todayIst = getIstDateString(now);
    const { hour: currentHourIst } = getIstHourAndMinute(now);
    const { previousStartDate, previousEndDate, daysCount } = computePrecedingEquivalentRange(
      startDate,
      endDate
    );

    const includesToday = startDate <= todayIst && endDate >= todayIst;
    const isPartial = includesToday && currentHourIst < 23;

    // Calculate honest expected intervals for elapsed time (do not count future hours as missing unless comparing vs full day)
    let expectedHoursTotal = 0;
    for (const d of enumerateIstDates(startDate, endDate)) {
      if (d < todayIst) expectedHoursTotal += 24;
      else if (d === todayIst) expectedHoursTotal += currentHourIst + 1;
    }
    const expectedRoomIntervals = Math.max(1, expectedHoursTotal * scopeRoomCount);
    const completenessPercent = Math.min(
      100,
      round1((recordedRoomIntervals / expectedRoomIntervals) * 100)
    );

    const lastTsRow = this.db
      .prepare('SELECT MAX(ts_ms) AS max_ts FROM history_intervals WHERE date_ist >= ? AND date_ist <= ?')
      .get(startDate, endDate) as { max_ts: number | null } | undefined;
    const lastTs = lastTsRow?.max_ts || now.getTime();

    return {
      preset,
      startDate,
      endDate,
      previousStartDate,
      previousEndDate,
      timezone: 'Asia/Kolkata',
      daysCount,
      granularity: daysCount === 1 ? 'hourly' : 'daily',
      includesToday,
      isPartial,
      recordedRoomIntervals,
      expectedRoomIntervals,
      completenessPercent,
      lastRecordedIstLabel: formatIstTimestampLabel(Math.max(lastTs, Math.min(now.getTime(), lastTs))),
      note: isPartial
        ? `Includes today (${todayIst}) up to ${String(currentHourIst).padStart(2, '0')}:59 IST — in-progress partial day.`
        : completenessPercent < 95
        ? `Partial telemetry coverage (${completenessPercent}% of expected intervals recorded).`
        : undefined,
    };
  }

  private fetchIntervals(
    startDate: string,
    endDate: string,
    building?: string | null,
    roomId?: string | null
  ): IntervalRow[] {
    let sql = 'SELECT * FROM history_intervals WHERE date_ist >= ? AND date_ist <= ?';
    const args: Array<string> = [startDate, endDate];
    if (building && building !== 'All') {
      sql += ' AND building = ?';
      args.push(building);
    }
    if (roomId && roomId !== 'all') {
      sql += ' AND room_id = ?';
      args.push(roomId);
    }
    sql += ' ORDER BY ts_ms ASC, room_code ASC';
    return this.db.prepare(sql).all(...args) as unknown as IntervalRow[];
  }

  /**
   * Fast SQL-level daily summary for solar/demand benchmarks (avoids fetching
   * 100k+ full interval rows and anomaly scans when only daily/monthly totals are needed).
   */
  public getDemandSummaryRange(startDate: string, endDate: string): {
    daysCount: number;
    daysWithData: number;
    totalActualKWh: number;
    averageDailyKWh: number;
    monthlyObservedKwh: Record<number, number>;
  } {
    const dailyRows = this.db
      .prepare(
        `SELECT date_ist, SUM(actual_kwh) AS daily_kwh
         FROM history_intervals
         WHERE date_ist >= ? AND date_ist <= ?
         GROUP BY date_ist
         ORDER BY date_ist ASC`
      )
      .all(startDate, endDate) as Array<{ date_ist: string; daily_kwh: number }>;

    const daysCount = Math.max(1, enumerateIstDates(startDate, endDate).length);
    let totalActual = 0;
    const monthlyObservedKwh: Record<number, number> = {};

    for (const r of dailyRows) {
      const dailyKwh = Number(r.daily_kwh || 0);
      totalActual += dailyKwh;
      const mNum = Number(String(r.date_ist || '').slice(5, 7));
      if (mNum >= 1 && mNum <= 12) {
        monthlyObservedKwh[mNum] = round1((monthlyObservedKwh[mNum] || 0) + round2(dailyKwh));
      }
    }

    const daysWithData = Math.max(1, dailyRows.length);
    return {
      daysCount,
      daysWithData: dailyRows.length,
      totalActualKWh: round2(totalActual),
      averageDailyKWh: dailyRows.length > 0 ? round2(totalActual / daysWithData) : 0,
      monthlyObservedKwh,
    };
  }

  /**
   * Fast SQL-level average daily kWh lookup for environmental weather-energy outlook.
   * Numerically identical to getOverview({ preset }).kpis.averageDailyKWh.
   */
  public getAverageDailyKWhQuick(preset: 'last_7_days' | 'last_30_days'): number {
    const { startDate, endDate } = this.resolveRangeParams({ preset });
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS days_with_data, COALESCE(SUM(daily_kwh), 0) AS total_kwh
         FROM (
           SELECT date_ist, SUM(actual_kwh) AS daily_kwh
           FROM history_intervals
           WHERE date_ist >= ? AND date_ist <= ?
           GROUP BY date_ist
         )`
      )
      .get(startDate, endDate) as { days_with_data: number; total_kwh: number } | undefined;

    if (!row || !row.days_with_data || row.days_with_data <= 0) {
      return 0;
    }
    return round2(Number(row.total_kwh || 0) / Number(row.days_with_data));
  }

  private fetchPreviousPeriodSummary(
    startDate: string,
    endDate: string,
    building?: string | null,
    roomId?: string | null
  ): {
    rowCount: number;
    dayCount: number;
    totalActual: number;
    blockTotals: Map<string, number>;
    roomTotals: Map<string, number>;
  } {
    const clauses = ['date_ist >= ?', 'date_ist <= ?'];
    const args: (string | number)[] = [startDate, endDate];
    if (building && building !== 'All') {
      clauses.push('building = ?');
      args.push(building);
    }
    if (roomId && roomId !== 'all') {
      clauses.push('(room_id = ? OR room_code = ?)');
      args.push(roomId, roomId);
    }
    const whereSql = clauses.join(' AND ');

    const grouped = this.db
      .prepare(
        `SELECT room_id, building, SUM(actual_kwh) AS total_kwh, COUNT(*) AS row_cnt
         FROM history_intervals
         WHERE ${whereSql}
         GROUP BY room_id, building`
      )
      .all(...args) as Array<{
        room_id: string;
        building: string;
        total_kwh: number;
        row_cnt: number;
      }>;

    let rowCount = 0;
    let totalActual = 0;
    const blockTotals = new Map<string, number>();
    const roomTotals = new Map<string, number>();

    for (const g of grouped) {
      const kwh = Number(g.total_kwh || 0);
      rowCount += Number(g.row_cnt || 0);
      totalActual += kwh;
      blockTotals.set(g.building, (blockTotals.get(g.building) || 0) + kwh);
      roomTotals.set(g.room_id, (roomTotals.get(g.room_id) || 0) + kwh);
    }

    let dayCount = 0;
    if (rowCount > 0) {
      const dayRow = this.db
        .prepare(
          `SELECT COUNT(DISTINCT date_ist) AS day_cnt
           FROM history_intervals
           WHERE ${whereSql}`
        )
        .get(...args) as { day_cnt: number } | undefined;
      dayCount = Number(dayRow?.day_cnt || 0);
    }

    return { rowCount, dayCount, totalActual, blockTotals, roomTotals };
  }

  public getOverview(params: {
    preset?: string;
    startDate?: string;
    endDate?: string;
    building?: string | null;
    roomId?: string | null;
    settings?: SchoolSettings;
    preFetchedRows?: IntervalRow[];
  }): HistoryOverviewResponse {
    const activeSettings = params.settings || INITIAL_SCHOOL_SETTINGS;
    const resolved = this.resolveRangeParams(params);
    const { preset, startDate, endDate } = resolved;

    const buildingFilter = params.building && params.building !== 'All' ? params.building : null;
    const roomFilter = params.roomId && params.roomId !== 'all' ? params.roomId : null;

    const rows = params.preFetchedRows ?? this.fetchIntervals(startDate, endDate, buildingFilter, roomFilter);
    const scopeRoomCount = roomFilter
      ? 1
      : buildingFilter
      ? Math.max(1, INITIAL_CLASSROOMS.filter((r) => r.building === buildingFilter).length)
      : INITIAL_CLASSROOMS.length;

    const range = this.buildRangeMeta(preset, startDate, endDate, rows.length, scopeRoomCount);
    const prevSummary = this.fetchPreviousPeriodSummary(
      range.previousStartDate,
      range.previousEndDate,
      buildingFilter,
      roomFilter
    );

    let totalActual = 0;
    let totalRated = 0;
    let totalLights = 0;
    let totalFans = 0;
    let totalAux = 0;

    // Group for series (hourly if 1 day, daily if multi-day)
    const seriesBuckets = new Map<
      string,
      {
        key: string;
        label: string;
        subLabel?: string;
        dateIst: string;
        hourIst?: number;
        dayType?: 'school' | 'saturday' | 'holiday' | 'sunday';
        isSchoolHours?: boolean;
        isPartial?: boolean;
        actualKWh: number;
        ratedMaxKWh: number;
        lightingKWh: number;
        fanKWh: number;
        auxKWh: number;
        occSum: number;
        tempSum: number;
        count: number;
        byBuilding: Record<string, number>;
        byRoom: Record<string, number>;
      }
    >();

    // Daily buckets (always needed for Average Daily KWh & Lowest/Peak Day calculations)
    const dailyTotalsMap = new Map<string, { actualKWh: number; ratedMaxKWh: number; dayType: string }>();

    // Block and classroom maps
    const blockAgg = new Map<
      string,
      {
        building: string;
        rooms: Set<string>;
        actualKWh: number;
        ratedMaxKWh: number;
        lightingKWh: number;
        fanKWh: number;
        auxKWh: number;
        occSum: number;
        count: number;
      }
    >();

    const roomAgg = new Map<
      string,
      {
        roomId: string;
        roomCode: string;
        name: string;
        building: string;
        floor: string;
        roomType: string;
        actualKWh: number;
        ratedMaxKWh: number;
        lightingKWh: number;
        fanKWh: number;
        auxKWh: number;
        occSum: number;
        tempSum: number;
        postHoursKWh: number;
        manualSum: number;
        count: number;
      }
    >();

    const todayIst = getIstDateString();
    const { hour: currentHourIst } = getIstHourAndMinute();

    for (const row of rows) {
      totalActual += row.actual_kwh;
      totalRated += row.rated_kwh;
      totalLights += row.lights_kwh;
      totalFans += row.fan_kwh;
      totalAux += row.aux_kwh;

      const dailyEntry = dailyTotalsMap.get(row.date_ist) || {
        actualKWh: 0,
        ratedMaxKWh: 0,
        dayType: row.day_type,
      };
      dailyEntry.actualKWh += row.actual_kwh;
      dailyEntry.ratedMaxKWh += row.rated_kwh;
      dailyTotalsMap.set(row.date_ist, dailyEntry);

      const sKey =
        range.granularity === 'hourly'
          ? `${row.date_ist}:${String(row.hour_ist).padStart(2, '0')}`
          : row.date_ist;

      let sBucket = seriesBuckets.get(sKey);
      if (!sBucket) {
        sBucket = {
          key: sKey,
          label:
            range.granularity === 'hourly'
              ? `${String(row.hour_ist).padStart(2, '0')}:00`
              : formatIstShortLabel(row.date_ist),
          subLabel:
            range.granularity === 'hourly'
              ? formatIstShortLabel(row.date_ist)
              : formatIstFullLabel(row.date_ist),
          dateIst: row.date_ist,
          hourIst: range.granularity === 'hourly' ? row.hour_ist : undefined,
          dayType: row.day_type,
          isSchoolHours:
            range.granularity === 'hourly'
              ? row.day_type === 'school'
                ? row.hour_ist >= 7 && row.hour_ist <= 14
                : row.day_type === 'saturday'
                ? row.hour_ist >= 8 && row.hour_ist <= 12
                : false
              : undefined,
          isPartial:
            row.date_ist === todayIst &&
            (range.granularity === 'daily' || row.hour_ist === currentHourIst),
          actualKWh: 0,
          ratedMaxKWh: 0,
          lightingKWh: 0,
          fanKWh: 0,
          auxKWh: 0,
          occSum: 0,
          tempSum: 0,
          count: 0,
          byBuilding: {},
          byRoom: {},
        };
        seriesBuckets.set(sKey, sBucket);
      }

      sBucket.actualKWh += row.actual_kwh;
      sBucket.ratedMaxKWh += row.rated_kwh;
      sBucket.lightingKWh += row.lights_kwh;
      sBucket.fanKWh += row.fan_kwh;
      sBucket.auxKWh += row.aux_kwh;
      sBucket.occSum += row.occupied_fraction * 100;
      sBucket.tempSum += row.temperature_c;
      sBucket.count += 1;
      sBucket.byBuilding[row.building] =
        (sBucket.byBuilding[row.building] || 0) + row.actual_kwh;
      sBucket.byRoom[row.room_code] =
        (sBucket.byRoom[row.room_code] || 0) + row.actual_kwh;

      const bEntry = blockAgg.get(row.building) || {
        building: row.building,
        rooms: new Set<string>(),
        actualKWh: 0,
        ratedMaxKWh: 0,
        lightingKWh: 0,
        fanKWh: 0,
        auxKWh: 0,
        occSum: 0,
        count: 0,
      };
      bEntry.rooms.add(row.room_id);
      bEntry.actualKWh += row.actual_kwh;
      bEntry.ratedMaxKWh += row.rated_kwh;
      bEntry.lightingKWh += row.lights_kwh;
      bEntry.fanKWh += row.fan_kwh;
      bEntry.auxKWh += row.aux_kwh;
      bEntry.occSum += row.occupied_fraction * 100;
      bEntry.count += 1;
      blockAgg.set(row.building, bEntry);

      const baseRoom = roomById.get(row.room_id);
      const rEntry = roomAgg.get(row.room_id) || {
        roomId: row.room_id,
        roomCode: row.room_code,
        name: baseRoom?.name || row.room_code,
        building: row.building,
        floor: row.floor,
        roomType: row.room_type,
        actualKWh: 0,
        ratedMaxKWh: 0,
        lightingKWh: 0,
        fanKWh: 0,
        auxKWh: 0,
        occSum: 0,
        tempSum: 0,
        postHoursKWh: 0,
        manualSum: 0,
        count: 0,
      };
      rEntry.actualKWh += row.actual_kwh;
      rEntry.ratedMaxKWh += row.rated_kwh;
      rEntry.lightingKWh += row.lights_kwh;
      rEntry.fanKWh += row.fan_kwh;
      rEntry.auxKWh += row.aux_kwh;
      rEntry.occSum += row.occupied_fraction * 100;
      rEntry.tempSum += row.temperature_c;
      if (row.hour_ist >= 15 || row.hour_ist <= 6) {
        rEntry.postHoursKWh += row.actual_kwh;
      }
      rEntry.manualSum += row.manual_share * 100;
      rEntry.count += 1;
      roomAgg.set(row.room_id, rEntry);
    }

    // Preceding period totals by overall / block / room (computed via SQL GROUP BY)
    const prevTotalActual = prevSummary.totalActual;
    const prevBlockTotals = prevSummary.blockTotals;
    const prevRoomTotals = prevSummary.roomTotals;
    const prevDaysCount = prevSummary.dayCount;

    const totalActualRounded = round2(totalActual);
    const ratedCapacityRounded = round2(totalRated);
    const ratedUtilizationPercent =
      totalRated > 0 ? round1((totalActual / totalRated) * 100) : 0;
    const daysWithData = Math.max(1, dailyTotalsMap.size);
    const averageDailyKWh = round2(totalActual / daysWithData);

    const comparisonAvailable = prevSummary.rowCount > 0 && prevTotalActual > 0.01;
    const prevTotalRounded = comparisonAvailable ? round2(prevTotalActual) : null;
    const prevAvgDaily =
      comparisonAvailable && prevDaysCount > 0 ? round2(prevTotalActual / prevDaysCount) : null;
    const changeKWh = comparisonAvailable ? round2(totalActual - prevTotalActual) : null;
    const changePercent =
      comparisonAvailable && prevTotalActual > 0
        ? round1(((totalActual - prevTotalActual) / prevTotalActual) * 100)
        : null;

    const series: HistoryTrendPoint[] = Array.from(seriesBuckets.values()).map((b) => {
      const byBuildingRounded: Record<string, number> = {};
      for (const [blk, val] of Object.entries(b.byBuilding)) {
        byBuildingRounded[blk] = round2(val);
      }
      const byRoomRounded: Record<string, number> = {};
      for (const [rm, val] of Object.entries(b.byRoom)) {
        byRoomRounded[rm] = round2(val);
      }
      const expectedInBucket =
        range.granularity === 'hourly' ? scopeRoomCount : 24 * scopeRoomCount;

      return {
        key: b.key,
        label: b.label,
        subLabel: b.subLabel,
        dateIst: b.dateIst,
        hourIst: b.hourIst,
        dayType: b.dayType,
        isSchoolHours: b.isSchoolHours,
        isPartial: b.isPartial,
        actualKWh: round2(b.actualKWh),
        ratedMaxKWh: round2(b.ratedMaxKWh),
        lightingKWh: round2(b.lightingKWh),
        fanKWh: round2(b.fanKWh),
        auxKWh: round2(b.auxKWh),
        avgOccupancyPercent: b.count > 0 ? round1(b.occSum / b.count) : 0,
        avgTempC: b.count > 0 ? round1(b.tempSum / b.count) : 0,
        coveragePercent: Math.min(100, round1((b.count / Math.max(1, expectedInBucket)) * 100)),
        byBuilding: byBuildingRounded,
        byRoom: byRoomRounded,
      };
    });

    // Peak & lowest calculation
    let peakPoint: HistoryOverviewResponse['kpis']['peakPoint'] = null;
    for (const pt of series) {
      if (!peakPoint || pt.actualKWh > peakPoint.actualKWh) {
        peakPoint = {
          label: pt.hourIst !== undefined ? `${pt.label} IST (${pt.subLabel || pt.dateIst})` : pt.subLabel || pt.label,
          dateIst: pt.dateIst,
          hourIst: pt.hourIst,
          actualKWh: pt.actualKWh,
          ratedMaxKWh: pt.ratedMaxKWh,
          occupancyPercent: pt.avgOccupancyPercent,
          note:
            pt.dayType && pt.dayType !== 'school'
              ? `${pt.dayType} schedule`
              : undefined,
        };
      }
    }

    let lowestDay: HistoryOverviewResponse['kpis']['lowestDay'] = null;
    for (const [dIst, dVal] of dailyTotalsMap.entries()) {
      // Skip incomplete today when comparing lowest full day on multi-day ranges
      if (dailyTotalsMap.size > 1 && dIst === todayIst && range.isPartial) continue;
      if (!lowestDay || dVal.actualKWh < lowestDay.actualKWh) {
        lowestDay = {
          dateIst: dIst,
          label: formatIstFullLabel(dIst),
          actualKWh: round2(dVal.actualKWh),
          dayType: dVal.dayType,
        };
      }
    }
    if (!lowestDay && dailyTotalsMap.size > 0) {
      const [firstDate, firstVal] = Array.from(dailyTotalsMap.entries())[0];
      lowestDay = {
        dateIst: firstDate,
        label: formatIstFullLabel(firstDate),
        actualKWh: round2(firstVal.actualKWh),
        dayType: firstVal.dayType,
      };
    }

    // Detect anomalies across range to attach room anomaly counts cleanly
    const anomaliesResp = this.getAnomalies({
      startDate,
      endDate,
      building: buildingFilter,
      roomId: roomFilter,
    });
    const anomalyCountByRoom = new Map<string, number>();
    for (const a of anomaliesResp.anomalies) {
      if (a.roomId) {
        anomalyCountByRoom.set(a.roomId, (anomalyCountByRoom.get(a.roomId) || 0) + 1);
      }
    }

    const classroomsRanked: HistoryClassroomRanking[] = Array.from(roomAgg.values())
      .map((r) => {
        const prevVal = prevRoomTotals.get(r.roomId);
        const pctChange =
          comparisonAvailable && typeof prevVal === 'number' && prevVal > 0.05
            ? round1(((r.actualKWh - prevVal) / prevVal) * 100)
            : null;
        return {
          roomId: r.roomId,
          roomCode: r.roomCode,
          name: r.name,
          building: r.building,
          floor: r.floor,
          roomType: r.roomType,
          actualKWh: round2(r.actualKWh),
          ratedMaxKWh: round2(r.ratedMaxKWh),
          ratedUtilizationPercent:
            r.ratedMaxKWh > 0 ? round1((r.actualKWh / r.ratedMaxKWh) * 100) : 0,
          sharePercent: totalActual > 0 ? round1((r.actualKWh / totalActual) * 100) : 0,
          changeVsPrevPercent: pctChange,
          lightingKWh: round2(r.lightingKWh),
          fanKWh: round2(r.fanKWh),
          auxKWh: round2(r.auxKWh),
          avgOccupancyPercent: r.count > 0 ? round1(r.occSum / r.count) : 0,
          avgTempC: r.count > 0 ? round1(r.tempSum / r.count) : 0,
          postHoursKWh: round2(r.postHoursKWh),
          manualOverrideSharePercent: r.count > 0 ? round1(r.manualSum / r.count) : 0,
          anomalyCount: anomalyCountByRoom.get(r.roomId) || 0,
        };
      })
      .sort((a, b) => b.actualKWh - a.actualKWh);

    const blocksRanked: HistoryBlockRanking[] = Array.from(blockAgg.values())
      .map((b) => {
        const prevVal = prevBlockTotals.get(b.building);
        const pctChange =
          comparisonAvailable && typeof prevVal === 'number' && prevVal > 0.1
            ? round1(((b.actualKWh - prevVal) / prevVal) * 100)
            : null;
        const topRoom = classroomsRanked.find((c) => c.building === b.building);
        return {
          building: b.building,
          roomCount: b.rooms.size,
          actualKWh: round2(b.actualKWh),
          ratedMaxKWh: round2(b.ratedMaxKWh),
          ratedUtilizationPercent:
            b.ratedMaxKWh > 0 ? round1((b.actualKWh / b.ratedMaxKWh) * 100) : 0,
          sharePercent: totalActual > 0 ? round1((b.actualKWh / totalActual) * 100) : 0,
          changeVsPrevPercent: pctChange,
          lightingKWh: round2(b.lightingKWh),
          fanKWh: round2(b.fanKWh),
          auxKWh: round2(b.auxKWh),
          avgOccupancyPercent: b.count > 0 ? round1(b.occSum / b.count) : 0,
          topConsumerRoomCode: topRoom?.roomCode || '-',
          topConsumerRoomName: topRoom?.name || '-',
        };
      })
      .sort((a, b) => b.actualKWh - a.actualKWh);

    const tariff = activeSettings.tariffPerKWhINR;
    const carbon = activeSettings.gridCarbonFactorKgCO2PerKWh;

    return {
      ok: true,
      range,
      tariffPerKWhINR: tariff,
      gridCarbonFactorKgCO2PerKWh: carbon,
      kpis: {
        totalActualKWh: totalActualRounded,
        ratedCapacityKWh: ratedCapacityRounded,
        ratedUtilizationPercent,
        averageDailyKWh,
        estimatedCostINR: round2(totalActual * tariff),
        estimatedCo2Kg: round2(totalActual * carbon),
        lightingKWh: round2(totalLights),
        fanKWh: round2(totalFans),
        auxKWh: round2(totalAux),
        peakPoint,
        lowestDay,
        comparison: {
          available: comparisonAvailable,
          previousTotalKWh: prevTotalRounded,
          previousAverageDailyKWh: prevAvgDaily,
          changeKWh,
          changePercent,
          note: !comparisonAvailable
            ? `No sufficient historical records found for preceding period (${range.previousStartDate} to ${range.previousEndDate}).`
            : range.isPartial
            ? `Current period includes partial in-progress day (${todayIst}); comparison reflects elapsed coverage vs full preceding period (${range.previousStartDate} to ${range.previousEndDate}).`
            : `Compared against preceding ${range.daysCount}-day window (${range.previousStartDate} to ${range.previousEndDate}).`,
        },
      },
      series,
      blocks: blocksRanked,
      classrooms: classroomsRanked,
      installedRatedMaxKW: round2(TOTAL_CAMPUS_RATED_POWER_WATTS / 1000),
      dataClassification:
        'Persisted SQLite Historical Integration (kW × hours across 25 ROOMWISE Modelled Nodes)',
    };
  }

  public compareEnergyPeriods(params: {
    periodAQuery: string;
    periodBQuery: string;
    building?: string | null;
    roomId?: string | null;
    settings?: SchoolSettings;
    now?: Date;
  }) {
    const now = params.now || new Date();
    const activeSettings = params.settings || INITIAL_SCHOOL_SETTINGS;
    const todayIst = getIstDateString(now);
    const { hour: currentHourIst, minute: currentMinuteIst } = getIstHourAndMinute(now);
    const buildingFilter =
      params.building && params.building !== 'All' ? params.building.trim() : null;
    const roomObj = params.roomId
      ? roomById.get(params.roomId) ||
        INITIAL_CLASSROOMS.find(
          (r) => r.roomCode.toLowerCase() === String(params.roomId).toLowerCase()
        ) ||
        null
      : null;
    const roomIdFilter = roomObj ? roomObj.id : null;

    const rA = resolveNaturalDateQuery(params.periodAQuery || 'yesterday', now);
    const rB = resolveNaturalDateQuery(params.periodBQuery || 'today', now);

    const rowsA = this.fetchIntervals(rA.startDate, rA.endDate, buildingFilter, roomIdFilter);
    const rowsB = this.fetchIntervals(rB.startDate, rB.endDate, buildingFilter, roomIdFilter);

    const scopeRoomCount = roomIdFilter
      ? 1
      : buildingFilter
      ? Math.max(1, INITIAL_CLASSROOMS.filter((r) => r.building === buildingFilter).length)
      : INITIAL_CLASSROOMS.length;

    const metaA = this.buildRangeMeta(rA.preset, rA.startDate, rA.endDate, rowsA.length, scopeRoomCount);
    const metaB = this.buildRangeMeta(rB.preset, rB.startDate, rB.endDate, rowsB.length, scopeRoomCount);

    const summarizeRows = (rows: IntervalRow[], meta: HistoryRangeMeta) => {
      const tariff = activeSettings.tariffPerKWhINR;
      let totalActual = 0;
      let totalRated = 0;
      const daySet = new Set<string>();
      const completedDaySet = new Set<string>();
      let completedDaysActual = 0;
      const todayHourSet = new Set<number>();
      let minHour = 24;
      let maxHour = -1;

      for (const row of rows) {
        totalActual += row.actual_kwh;
        totalRated += row.rated_kwh;
        daySet.add(row.date_ist);
        if (row.hour_ist < minHour) minHour = row.hour_ist;
        if (row.hour_ist > maxHour) maxHour = row.hour_ist;
        if (row.date_ist === todayIst) {
          todayHourSet.add(row.hour_ist);
        } else {
          completedDaySet.add(row.date_ist);
          completedDaysActual += row.actual_kwh;
        }
      }

      const dataAvailable = rows.length > 0 && daySet.size > 0;
      const daysWithData = daySet.size;
      const completedDaysCount = completedDaySet.size;
      const totalActualKWh = round2(totalActual);
      const ratedCapacityKWh = round2(totalRated);
      const ratedUtilizationPercent =
        totalRated > 0 ? round1((totalActual / totalRated) * 100) : 0;

      // Only compute averageDailyKWh across completed days when partial today is mixed in
      const averageDailyKWh = !dataAvailable
        ? null
        : meta.isPartial && completedDaysCount > 0
        ? round2(completedDaysActual / completedDaysCount)
        : meta.isPartial
        ? null
        : round2(totalActual / Math.max(1, daysWithData));

      const hoursCoveredCount =
        meta.startDate === meta.endDate && meta.startDate === todayIst
          ? todayHourSet.size
          : daysWithData > 0 && meta.daysCount === 1
          ? new Set(rows.map((r) => r.hour_ist)).size
          : 0;

      const elapsedTimeWindowIst =
        meta.startDate === meta.endDate && dataAvailable && maxHour >= 0
          ? meta.startDate === todayIst && meta.isPartial
            ? `${String(Math.max(0, minHour)).padStart(2, '0')}:00–${String(currentHourIst).padStart(2, '0')}:${String(currentMinuteIst).padStart(2, '0')} IST (in-progress partial day)`
            : `${String(Math.max(0, minHour)).padStart(2, '0')}:00–${String(maxHour).padStart(2, '0')}:59 IST (full day)`
          : null;

      return {
        range: meta,
        dataAvailable,
        daysWithData,
        completedDaysCount,
        hoursCoveredCount,
        elapsedTimeWindowIst,
        totalActualKWh,
        ratedCapacityKWh,
        ratedUtilizationPercent,
        averageDailyKWh,
        estimatedCostINR: round2(totalActualKWh * tariff),
      };
    };

    const ovA = !roomIdFilter
      ? this.getOverview({
          preset: rA.preset,
          startDate: rA.startDate,
          endDate: rA.endDate,
          building: buildingFilter,
          settings: activeSettings,
        })
      : null;
    const ovB = !roomIdFilter
      ? this.getOverview({
          preset: rB.preset,
          startDate: rB.startDate,
          endDate: rB.endDate,
          building: buildingFilter,
          settings: activeSettings,
        })
      : null;

    const sumA = summarizeRows(rowsA, metaA);
    const sumB = summarizeRows(rowsB, metaB);

    const hasPartialDay = metaA.isPartial || metaB.isPartial;
    const bothHaveData = sumA.dataAvailable && sumB.dataAvailable;

    // Compute equivalent elapsed IST time-of-day window when at least one period includes today's partial day
    let equivalentWindowComparison: {
      windowLabelIst: string;
      cutoffHourIst: number;
      cutoffMinuteIst: number;
      hoursComparedCount: number;
      periodAKWh: number;
      periodBKWh: number;
      periodADailyEquivalentKWh: number;
      periodBDailyEquivalentKWh: number;
      deltaKWh: number;
      deltaPercent: number | null;
      higherPeriod: 'periodA' | 'periodB' | 'equal';
      note: string;
    } | null = null;

    if (hasPartialDay && bothHaveData) {
      const todayRows = (metaA.includesToday ? rowsA : rowsB).filter((r) => r.date_ist === todayIst);
      if (todayRows.length > 0) {
        const cutoffHourIst = todayRows.reduce((mx, r) => Math.max(mx, r.hour_ist), 0);
        const cutoffHourTodayRows = todayRows.filter((r) => r.hour_ist === cutoffHourIst);
        const avgTodayCutoffFraction =
          cutoffHourTodayRows.length > 0
            ? Math.min(
                1,
                Math.max(
                  0.02,
                  cutoffHourTodayRows.reduce((s, r) => s + r.interval_hours, 0) /
                    cutoffHourTodayRows.length
                )
              )
            : Math.min(1, Math.max(0.02, currentMinuteIst / 60));

        const computeWindowDailyMean = (rows: IntervalRow[]) => {
          const perDaySums = new Map<string, number>();
          for (const row of rows) {
            if (row.hour_ist > cutoffHourIst) continue;
            let kwh = row.actual_kwh;
            if (row.hour_ist === cutoffHourIst && row.date_ist !== todayIst) {
              const rowHrs = Math.max(0.05, row.interval_hours || 1);
              const scale = Math.min(1, avgTodayCutoffFraction / rowHrs);
              kwh *= scale;
            }
            perDaySums.set(row.date_ist, (perDaySums.get(row.date_ist) || 0) + kwh);
          }
          if (perDaySums.size === 0) return null;
          let sum = 0;
          for (const v of perDaySums.values()) sum += v;
          return {
            perDayMeanKWh: round2(sum / perDaySums.size),
            totalWindowKWh: round2(sum),
            daysIncluded: perDaySums.size,
          };
        };

        const winA = computeWindowDailyMean(rowsA);
        const winB = computeWindowDailyMean(rowsB);
        if (winA && winB) {
          const valA = winA.perDayMeanKWh;
          const valB = winB.perDayMeanKWh;
          // Delta = Period B minus Period A when Period B is newer (or explicit periodB - periodA & periodA - periodB clarity)
          const deltaBvsA = round2(valB - valA);
          const pctBvsA = valA > 0.01 ? round1(((valB - valA) / valA) * 100) : null;
          const windowLabelIst = `00:00–${String(cutoffHourIst).padStart(2, '0')}:${String(
            currentMinuteIst
          ).padStart(2, '0')} IST`;
          const higherPeriod: 'periodA' | 'periodB' | 'equal' =
            Math.abs(valA - valB) < 0.005 ? 'equal' : valA > valB ? 'periodA' : 'periodB';

          equivalentWindowComparison = {
            windowLabelIst,
            cutoffHourIst,
            cutoffMinuteIst: currentMinuteIst,
            hoursComparedCount: cutoffHourIst + 1,
            periodAKWh: valA,
            periodBKWh: valB,
            periodADailyEquivalentKWh: valA,
            periodBDailyEquivalentKWh: valB,
            deltaKWh: deltaBvsA,
            deltaPercent: pctBvsA,
            higherPeriod,
            note: `Equivalent elapsed-time comparison over ${windowLabelIst} (${cutoffHourIst + 1} hourly buckets; current hour scaled proportionally to ${Math.round(
              avgTodayCutoffFraction * 100
            )}% elapsed).`,
          };
        }
      }
    }

    const dailyRateChangePercent =
      !bothHaveData
        ? null
        : sumA.averageDailyKWh !== null &&
          sumB.averageDailyKWh !== null &&
          sumA.averageDailyKWh > 0.05
        ? round1(((sumB.averageDailyKWh - sumA.averageDailyKWh) / sumA.averageDailyKWh) * 100)
        : equivalentWindowComparison?.deltaPercent ?? null;

    let partialDayDisclosure: string | null = null;
    if (metaA.isPartial && !metaB.isPartial) {
      partialDayDisclosure = `Period A (${rA.startDate}) is an in-progress partial day up to ${String(
        currentHourIst
      ).padStart(2, '0')}:${String(currentMinuteIst).padStart(
        2,
        '0'
      )} IST, while Period B (${rB.startDate === rB.endDate ? rB.startDate : `${rB.startDate} to ${rB.endDate}`}) represents full completed day(s). Raw totals cannot be compared 1:1 without matching the elapsed time window.`;
    } else if (!metaA.isPartial && metaB.isPartial) {
      partialDayDisclosure = `Period B (${rB.startDate}) is an in-progress partial day up to ${String(
        currentHourIst
      ).padStart(2, '0')}:${String(currentMinuteIst).padStart(
        2,
        '0'
      )} IST, while Period A (${rA.startDate === rA.endDate ? rA.startDate : `${rA.startDate} to ${rA.endDate}`}) represents full completed day(s). Raw totals cannot be compared 1:1 without matching the elapsed time window.`;
    } else if (metaA.isPartial && metaB.isPartial) {
      partialDayDisclosure = `Both periods include the in-progress partial day (${todayIst} up to ${String(
        currentHourIst
      ).padStart(2, '0')}:${String(currentMinuteIst).padStart(2, '0')} IST).`;
    }

    return {
      ok: bothHaveData,
      dataAvailable: bothHaveData,
      scope: roomObj
        ? `${roomObj.name} (${roomObj.roomCode})`
        : buildingFilter || 'All Campus Blocks',
      building: roomObj ? roomObj.building : buildingFilter,
      roomId: roomObj?.id ?? null,
      roomCode: roomObj?.roomCode ?? null,
      roomName: roomObj?.name ?? null,
      comparisonBasis: !bothHaveData
        ? ('insufficient_data' as const)
        : equivalentWindowComparison
        ? ('equivalent_elapsed_window' as const)
        : ('completed_periods' as const),
      hasPartialDay,
      partialDayDisclosure,
      periodA: {
        query: params.periodAQuery,
        ...sumA,
        ...(ovA ? { blocks: ovA.blocks } : {}),
      },
      periodB: {
        query: params.periodBQuery,
        ...sumB,
        ...(ovB ? { blocks: ovB.blocks } : {}),
      },
      equivalentWindowComparison,
      dailyRateChangePercent,
      dataClassification: roomObj
        ? 'Persisted SQLite Classroom Interval Integration (Modelled Node)'
        : 'Persisted SQLite Historical Integration (kW × hours across 25 ROOMWISE Modelled Nodes)',
    };
  }

  public getRoomHistory(params: {
    roomId: string;
    preset?: string;
    startDate?: string;
    endDate?: string;
    settings?: SchoolSettings;
  }): RoomHistoryDetailResponse | null {
    const activeSettings = params.settings || INITIAL_SCHOOL_SETTINGS;
    const room =
      roomById.get(params.roomId) ||
      INITIAL_CLASSROOMS.find(
        (c) => c.roomCode.toLowerCase() === params.roomId.toLowerCase()
      );
    if (!room) return null;

    const resolved = this.resolveRangeParams(params);
    const { preset, startDate, endDate } = resolved;
    const rows = this.fetchIntervals(startDate, endDate, null, room.id);
    const range = this.buildRangeMeta(preset, startDate, endDate, rows.length, 1);
    const prevRows = this.fetchIntervals(
      range.previousStartDate,
      range.previousEndDate,
      null,
      room.id
    );

    let actualKWh = 0;
    let ratedMaxKWh = 0;
    let lightingKWh = 0;
    let fanKWh = 0;
    let auxKWh = 0;
    let postHoursKWh = 0;
    let occSum = 0;
    let tempSum = 0;

    const seriesBuckets = new Map<
      string,
      {
        key: string;
        label: string;
        dateIst: string;
        hourIst?: number;
        actualKWh: number;
        ratedMaxKWh: number;
        lightingKWh: number;
        fanKWh: number;
        auxKWh: number;
        occSum: number;
        occCountSum: number;
        tempSum: number;
        humSum: number;
        manSum: number;
        count: number;
      }
    >();

    for (const row of rows) {
      actualKWh += row.actual_kwh;
      ratedMaxKWh += row.rated_kwh;
      lightingKWh += row.lights_kwh;
      fanKWh += row.fan_kwh;
      auxKWh += row.aux_kwh;
      if (row.hour_ist >= 15 || row.hour_ist <= 6) {
        postHoursKWh += row.actual_kwh;
      }
      occSum += row.occupied_fraction * 100;
      tempSum += row.temperature_c;

      const sKey =
        range.granularity === 'hourly'
          ? `${row.date_ist}:${String(row.hour_ist).padStart(2, '0')}`
          : row.date_ist;
      const b = seriesBuckets.get(sKey) || {
        key: sKey,
        label:
          range.granularity === 'hourly'
            ? `${String(row.hour_ist).padStart(2, '0')}:00`
            : formatIstShortLabel(row.date_ist),
        dateIst: row.date_ist,
        hourIst: range.granularity === 'hourly' ? row.hour_ist : undefined,
        actualKWh: 0,
        ratedMaxKWh: 0,
        lightingKWh: 0,
        fanKWh: 0,
        auxKWh: 0,
        occSum: 0,
        occCountSum: 0,
        tempSum: 0,
        humSum: 0,
        manSum: 0,
        count: 0,
      };
      b.actualKWh += row.actual_kwh;
      b.ratedMaxKWh += row.rated_kwh;
      b.lightingKWh += row.lights_kwh;
      b.fanKWh += row.fan_kwh;
      b.auxKWh += row.aux_kwh;
      b.occSum += row.occupied_fraction * 100;
      b.occCountSum += row.avg_occupants;
      b.tempSum += row.temperature_c;
      b.humSum += row.humidity_pct;
      b.manSum += row.manual_share * 100;
      b.count += 1;
      seriesBuckets.set(sKey, b);
    }

    const prevActual = prevRows.reduce((s, r) => s + r.actual_kwh, 0);
    const changeVsPrevPercent =
      prevRows.length > 0 && prevActual > 0.02
        ? round1(((actualKWh - prevActual) / prevActual) * 100)
        : null;

    const eventsRaw = this.db
      .prepare(
        'SELECT * FROM history_events WHERE room_id = ? AND date_ist >= ? AND date_ist <= ? ORDER BY ts_ms DESC LIMIT 20'
      )
      .all(room.id, startDate, endDate) as unknown as EventRow[];

    const events: HistoryEventRecord[] = eventsRaw.map((e) => ({
      id: e.id,
      tsMs: e.ts_ms,
      dateIst: e.date_ist,
      hourIst: e.hour_ist,
      timeIstLabel: formatIstTimestampLabel(e.ts_ms),
      roomId: e.room_id,
      roomCode: e.room_code,
      building: e.building,
      eventType: e.event_type,
      summary: e.summary,
      actor: e.actor,
      beforeWatts: e.before_watts,
      afterWatts: e.after_watts,
      deltaWatts: e.delta_watts,
    }));

    const anomalies = this.getAnomalies({
      startDate,
      endDate,
      roomId: room.id,
    }).anomalies;

    const series: RoomHistoryPoint[] = Array.from(seriesBuckets.values()).map((b) => ({
      key: b.key,
      label: b.label,
      dateIst: b.dateIst,
      hourIst: b.hourIst,
      actualKWh: round2(b.actualKWh),
      ratedMaxKWh: round2(b.ratedMaxKWh),
      lightingKWh: round2(b.lightingKWh),
      fanKWh: round2(b.fanKWh),
      auxKWh: round2(b.auxKWh),
      occupancyPercent: b.count > 0 ? round1(b.occSum / b.count) : 0,
      avgOccupants: b.count > 0 ? round1(b.occCountSum / b.count) : 0,
      temperatureC: b.count > 0 ? round1(b.tempSum / b.count) : 0,
      humidityPercent: b.count > 0 ? round1(b.humSum / b.count) : 0,
      manualSharePercent: b.count > 0 ? round1(b.manSum / b.count) : 0,
      coveragePercent:
        range.granularity === 'hourly'
          ? 100
          : Math.min(100, round1((b.count / 24) * 100)),
    }));

    return {
      ok: true,
      room: {
        id: room.id,
        roomCode: room.roomCode,
        name: room.name,
        building: room.building,
        floor: room.floor,
        type: room.type,
        capacity: room.capacity,
        ratedPowerWatts: computeRoomRatedPowerWatts(room.id),
      },
      range,
      totals: {
        actualKWh: round2(actualKWh),
        ratedMaxKWh: round2(ratedMaxKWh),
        ratedUtilizationPercent:
          ratedMaxKWh > 0 ? round1((actualKWh / ratedMaxKWh) * 100) : 0,
        lightingKWh: round2(lightingKWh),
        fanKWh: round2(fanKWh),
        auxKWh: round2(auxKWh),
        postHoursKWh: round2(postHoursKWh),
        avgOccupancyPercent: rows.length > 0 ? round1(occSum / rows.length) : 0,
        avgTempC: rows.length > 0 ? round1(tempSum / rows.length) : null,
        changeVsPrevPercent,
        estimatedCostINR: round2(actualKWh * activeSettings.tariffPerKWhINR),
      },
      series,
      events,
      anomalies,
      temperatureSupported: rows.length > 0,
    };
  }

  public getTimeOfDayProfile(params: {
    preset?: string;
    startDate?: string;
    endDate?: string;
    building?: string | null;
    roomId?: string | null;
    settings?: SchoolSettings;
  }): TimeOfDayProfileResponse {
    const activeSettings = params.settings || INITIAL_SCHOOL_SETTINGS;
    const resolved = this.resolveRangeParams(params);
    const { preset, startDate, endDate } = resolved;
    const buildingFilter = params.building && params.building !== 'All' ? params.building : null;
    const roomFilter = params.roomId && params.roomId !== 'all' ? params.roomId : null;

    const rows = this.fetchIntervals(startDate, endDate, buildingFilter, roomFilter);
    const scopeRoomCount = roomFilter
      ? 1
      : buildingFilter
      ? Math.max(1, INITIAL_CLASSROOMS.filter((r) => r.building === buildingFilter).length)
      : INITIAL_CLASSROOMS.length;
    const range = this.buildRangeMeta(preset, startDate, endDate, rows.length, scopeRoomCount);

    // Aggregate per (date, hour) first so multi-day average kW per hour is exact
    const byHour = Array.from({ length: 24 }, (_, hourIst) => ({
      hourIst,
      days: new Map<
        string,
        {
          actualKWh: number;
          ratedMaxKWh: number;
          lightingKWh: number;
          fanKWh: number;
          auxKWh: number;
          occSum: number;
          tempSum: number;
          count: number;
        }
      >(),
    }));

    for (const r of rows) {
      const hBucket = byHour[r.hour_ist];
      if (!hBucket) continue;
      const dEntry = hBucket.days.get(r.date_ist) || {
        actualKWh: 0,
        ratedMaxKWh: 0,
        lightingKWh: 0,
        fanKWh: 0,
        auxKWh: 0,
        occSum: 0,
        tempSum: 0,
        count: 0,
      };
      dEntry.actualKWh += r.actual_kwh;
      dEntry.ratedMaxKWh += r.rated_kwh;
      dEntry.lightingKWh += r.lights_kwh;
      dEntry.fanKWh += r.fan_kwh;
      dEntry.auxKWh += r.aux_kwh;
      dEntry.occSum += r.occupied_fraction * 100;
      dEntry.tempSum += r.temperature_c;
      dEntry.count += 1;
      hBucket.days.set(r.date_ist, dEntry);
    }

    let schoolHoursKWh = 0;
    let offHoursKWh = 0;
    let postHoursTotalKWh = 0;
    let postHoursVacantKWh = 0;

    for (const r of rows) {
      const inSchoolWindow = r.hour_ist >= 7 && r.hour_ist <= 14;
      if (inSchoolWindow) schoolHoursKWh += r.actual_kwh;
      else offHoursKWh += r.actual_kwh;
      if (r.hour_ist >= 15 || r.hour_ist <= 5) {
        postHoursTotalKWh += r.actual_kwh;
        if (r.occupied_fraction <= 0.05) {
          postHoursVacantKWh += r.actual_kwh;
        }
      }
    }

    const totalKWh = schoolHoursKWh + offHoursKWh;

    const rawHours: TimeOfDayHourBucket[] = byHour.map((hb) => {
      const sampleDays = hb.days.size;
      let sumKWh = 0;
      let sumRatedKWh = 0;
      let sumLightKWh = 0;
      let sumFanKWh = 0;
      let sumAuxKWh = 0;
      let occAvgAcc = 0;
      let tempAvgAcc = 0;

      for (const d of hb.days.values()) {
        sumKWh += d.actualKWh;
        sumRatedKWh += d.ratedMaxKWh;
        sumLightKWh += d.lightingKWh;
        sumFanKWh += d.fanKWh;
        sumAuxKWh += d.auxKWh;
        occAvgAcc += d.count > 0 ? d.occSum / d.count : 0;
        tempAvgAcc += d.count > 0 ? d.tempSum / d.count : 0;
      }

      const denom = Math.max(1, sampleDays);
      const band: TimeOfDayHourBucket['band'] =
        hb.hourIst < 7 ? 'pre_hours' : hb.hourIst <= 14 ? 'school_hours' : 'post_hours';

      return {
        hourIst: hb.hourIst,
        hourLabel: `${String(hb.hourIst).padStart(2, '0')}:00`,
        band,
        totalKWh: round2(sumKWh),
        avgKW: round2(sumKWh / denom),
        ratedMaxKW: round2(sumRatedKWh / denom),
        lightingAvgKW: round2(sumLightKWh / denom),
        fanAvgKW: round2(sumFanKWh / denom),
        auxAvgKW: round2(sumAuxKWh / denom),
        avgOccupancyPercent: sampleDays > 0 ? round1(occAvgAcc / sampleDays) : 0,
        avgTempC: sampleDays > 0 ? round1(tempAvgAcc / sampleDays) : 0,
        sampleDays,
        flag: 'normal',
      };
    });

    const activeHours = rawHours.filter((h) => h.sampleDays > 0);
    let peakHour = activeHours[0] || rawHours[10];
    let lowestHour = activeHours[0] || rawHours[3];
    for (const h of activeHours) {
      if (h.avgKW > peakHour.avgKW) peakHour = h;
      if (h.avgKW < lowestHour.avgKW) lowestHour = h;
    }

    const avgSchoolKW =
      rawHours
        .filter((h) => h.band === 'school_hours' && h.sampleDays > 0)
        .reduce((s, h) => s + h.avgKW, 0) /
      Math.max(1, rawHours.filter((h) => h.band === 'school_hours' && h.sampleDays > 0).length);

    for (const h of rawHours) {
      if (h.sampleDays === 0) continue;
      if (h.hourIst === peakHour.hourIst) {
        h.flag = 'peak';
        h.flagReason = `Peak campus demand hour (${h.avgKW} kW avg at ${h.avgOccupancyPercent}% occupancy)`;
      } else if (
        h.band === 'post_hours' &&
        h.avgKW > Math.max(0.55, avgSchoolKW * 0.28)
      ) {
        h.flag = 'post_hours_draw';
        h.flagReason = `Elevated post-hours demand (${h.avgKW} kW avg with ${h.avgOccupancyPercent}% occupancy)`;
      } else if (h.avgKW > avgSchoolKW * 1.32 && h.band === 'school_hours') {
        h.flag = 'unusual_spike';
        h.flagReason = `Above typical school-hour demand (+${round1(((h.avgKW - avgSchoolKW) / Math.max(0.1, avgSchoolKW)) * 100)}% vs school-hour avg)`;
      } else if (h.hourIst === lowestHour.hourIst) {
        h.flag = 'low';
        h.flagReason = `Lowest demand period (${h.avgKW} kW avg standby)`;
      }
    }

    return {
      ok: true,
      range,
      buildingFilter,
      roomIdFilter: roomFilter,
      schoolHoursWindow: activeSettings.schoolHours,
      hours: rawHours,
      summary: {
        peakHourLabel: `${peakHour.hourLabel} IST`,
        peakAvgKW: peakHour.avgKW,
        peakOccupancyPercent: peakHour.avgOccupancyPercent,
        lowestHourLabel: `${lowestHour.hourLabel} IST`,
        lowestAvgKW: lowestHour.avgKW,
        schoolHoursKWh: round2(schoolHoursKWh),
        schoolHoursSharePercent: totalKWh > 0 ? round1((schoolHoursKWh / totalKWh) * 100) : 0,
        offHoursKWh: round2(offHoursKWh),
        offHoursSharePercent: totalKWh > 0 ? round1((offHoursKWh / totalKWh) * 100) : 0,
        postHoursTotalKWh: round2(postHoursTotalKWh),
        postHoursVacantSharePercent:
          postHoursTotalKWh > 0 ? round1((postHoursVacantKWh / postHoursTotalKWh) * 100) : 0,
      },
    };
  }

  public getAnomalies(params: {
    preset?: string;
    startDate?: string;
    endDate?: string;
    building?: string | null;
    roomId?: string | null;
    preFetchedTargetRows?: IntervalRow[];
    preFetchedRange?: HistoryRangeMeta;
  }): HistoricalAnomaliesResponse {
    const resolved = this.resolveRangeParams(params);
    const { preset, startDate, endDate } = resolved;
    const buildingFilter = params.building && params.building !== 'All' ? params.building : null;
    const roomFilter = params.roomId && params.roomId !== 'all' ? params.roomId : null;

    const targetRows =
      params.preFetchedTargetRows ?? this.fetchIntervals(startDate, endDate, buildingFilter, roomFilter);
    const scopeRoomCount = roomFilter
      ? 1
      : buildingFilter
      ? Math.max(1, INITIAL_CLASSROOMS.filter((r) => r.building === buildingFilter).length)
      : INITIAL_CLASSROOMS.length;
    const range =
      params.preFetchedRange ??
      this.buildRangeMeta(preset, startDate, endDate, targetRows.length, scopeRoomCount);

    // Compute trailing 21-day comparable operational reference directly in SQLite via GROUP BY
    const refStart = shiftIstDate(startDate, -21);
    const refEnd = shiftIstDate(startDate, -1);
    const refClauses = ['date_ist >= ?', 'date_ist <= ?'];
    const refArgs: (string | number)[] = [refStart, refEnd];
    if (buildingFilter) {
      refClauses.push('building = ?');
      refArgs.push(buildingFilter);
    }
    if (roomFilter) {
      refClauses.push('(room_id = ? OR room_code = ?)');
      refArgs.push(roomFilter, roomFilter);
    }
    const refGrouped = this.db
      .prepare(
        `SELECT room_id, day_type,
                SUM(daily_actual) AS sum_daily_kwh,
                SUM(daily_fan) AS sum_fan_kwh,
                COUNT(*) AS samples
         FROM (
           SELECT room_id, date_ist, day_type,
                  SUM(actual_kwh) AS daily_actual,
                  SUM(fan_kwh) AS daily_fan
           FROM history_intervals
           WHERE ${refClauses.join(' AND ')}
           GROUP BY room_id, date_ist, day_type
         )
         GROUP BY room_id, day_type`
      )
      .all(...refArgs) as Array<{
        room_id: string;
        day_type: string;
        sum_daily_kwh: number;
        sum_fan_kwh: number;
        samples: number;
      }>;

    const refRoomComparable = new Map<string, { avgDailyKWh: number; avgFanKWh: number; samples: number }>();
    for (const v of refGrouped) {
      refRoomComparable.set(`${v.room_id}:${v.day_type}`, {
        avgDailyKWh: Number(v.sum_daily_kwh || 0),
        avgFanKWh: Number(v.sum_fan_kwh || 0),
        samples: Number(v.samples || 0),
      });
    }

    // Group target rows by (date, room) to evaluate daily + hourly patterns cleanly
    const targetByRoomDay = new Map<string, IntervalRow[]>();
    const targetByBlockDay = new Map<string, { building: string; dateIst: string; dayType: string; actualKWh: number; rooms: Set<string> }>();

    for (const r of targetRows) {
      const rdKey = `${r.date_ist}:${r.room_id}`;
      const arr = targetByRoomDay.get(rdKey) || [];
      arr.push(r);
      targetByRoomDay.set(rdKey, arr);

      const bdKey = `${r.date_ist}:${r.building}`;
      const blk = targetByBlockDay.get(bdKey) || {
        building: r.building,
        dateIst: r.date_ist,
        dayType: r.day_type,
        actualKWh: 0,
        rooms: new Set<string>(),
      };
      blk.actualKWh += r.actual_kwh;
      blk.rooms.add(r.room_id);
      targetByBlockDay.set(bdKey, blk);
    }

    const anomalies: HistoricalAnomaly[] = [];
    const todayIst = getIstDateString();

    for (const [rdKey, intervals] of targetByRoomDay.entries()) {
      const sample = intervals[0];
      const room = roomById.get(sample.room_id);
      const roomName = room?.name || sample.room_code;

      // 1. Check Unexpected Post-Hours Usage (outside 07:30-14:30 IST, i.e. hours >= 15 or <= 5)
      const postHoursVacant = intervals.filter(
        (i) => (i.hour_ist >= 15 || i.hour_ist <= 5) && i.occupied_fraction <= 0.05 && i.total_watts >= 110
      );
      if (postHoursVacant.length >= 2) {
        const postKWh = round2(postHoursVacant.reduce((s, i) => s + i.actual_kwh, 0));
        const minH = Math.min(...postHoursVacant.map((i) => i.hour_ist));
        const maxH = Math.max(...postHoursVacant.map((i) => i.hour_ist));
        const expectedStandbyKWh = round2(postHoursVacant.length * 0.02);
        const devKWh = round2(Math.max(0, postKWh - expectedStandbyKWh));
        anomalies.push({
          id: `anom-post-${rdKey}`,
          dateIst: sample.date_ist,
          hourIst: minH,
          timeWindowLabel: `${formatIstShortLabel(sample.date_ist)} · ${String(minH).padStart(2, '0')}:00–${String(maxH + 1).padStart(2, '0')}:00 IST`,
          roomId: sample.room_id,
          roomCode: sample.room_code,
          roomName,
          building: sample.building,
          type: 'post_hours_usage',
          severity: postKWh >= 3.0 ? 'high' : postKWh >= 1.2 ? 'medium' : 'low',
          confidence: 'high',
          observedKWh: postKWh,
          comparableExpectedKWh: expectedStandbyKWh,
          deviationKWh: devKWh,
          deviationPercent: expectedStandbyKWh > 0 ? round1((devKWh / expectedStandbyKWh) * 100) : 100,
          title: `Post-hours power draw in ${sample.room_code} while vacant`,
          explanation: `${roomName} drew ${postKWh} kWh across ${postHoursVacant.length} post-hours intervals after dismissal despite 0% recorded occupancy.`,
          evidence: [
            `Mean load during post-hours window: ${Math.round(postHoursVacant.reduce((s, i) => s + i.total_watts, 0) / postHoursVacant.length)} W`,
            `Manual override share: ${Math.round((postHoursVacant.reduce((s, i) => s + i.manual_share, 0) / postHoursVacant.length) * 100)}%`,
            `Recorded occupancy: 0% across all ${postHoursVacant.length} intervals`,
          ],
          caveat:
            'Reflects active circuit draw during zero-occupancy intervals; staff maintenance or unlogged cleaning work would not appear on PIR sensors.',
        });
      }

      // 2. Check Lighting Active During Confirmed Daytime Vacancy
      const vacantLit = intervals.filter(
        (i) =>
          i.hour_ist >= 7 &&
          i.hour_ist <= 14 &&
          i.day_type !== 'sunday' &&
          i.occupied_fraction === 0 &&
          i.lights_watts >= 120
      );
      if (vacantLit.length >= 2) {
        const obsKWh = round2(vacantLit.reduce((s, i) => s + i.actual_kwh, 0));
        const lightWasteKWh = round2(vacantLit.reduce((s, i) => s + i.lights_kwh, 0));
        const minH = Math.min(...vacantLit.map((i) => i.hour_ist));
        const maxH = Math.max(...vacantLit.map((i) => i.hour_ist));
        anomalies.push({
          id: `anom-vaclit-${rdKey}`,
          dateIst: sample.date_ist,
          hourIst: minH,
          timeWindowLabel: `${formatIstShortLabel(sample.date_ist)} · ${String(minH).padStart(2, '0')}:00–${String(maxH + 1).padStart(2, '0')}:00 IST`,
          roomId: sample.room_id,
          roomCode: sample.room_code,
          roomName,
          building: sample.building,
          type: 'vacant_lighting_active',
          severity: obsKWh >= 1.5 ? 'medium' : 'low',
          confidence: 'high',
          observedKWh: obsKWh,
          comparableExpectedKWh: 0,
          deviationKWh: obsKWh,
          deviationPercent: 100,
          title: `Daytime lighting active during vacancy in ${sample.room_code}`,
          explanation: `${roomName} remained lit (${lightWasteKWh} kWh lighting + fan draw) for ${vacantLit.length} daytime hours while unoccupied.`,
          evidence: [
            `Average lighting output during vacancy: ${Math.round(vacantLit.reduce((s, i) => s + i.lights_avg_pct, 0) / vacantLit.length)}%`,
            `Natural daylight was ${Math.round(vacantLit.reduce((s, i) => s + i.natural_lux, 0) / vacantLit.length)} lux`,
          ],
          caveat:
            'Corresponds to zero PIR occupancy readings during scheduled hours (possible manual switch lock or brief vacant class swap).',
        });
      }

      // 3. Check Substantial Excess Consumption vs Room's Comparable Trailing Average (full days only unless severe)
      const isPartialToday = sample.date_ist === todayIst && intervals.length < 22;
      if (!isPartialToday) {
        const dayActual = intervals.reduce((s, i) => s + i.actual_kwh, 0);
        const dayFan = intervals.reduce((s, i) => s + i.fan_kwh, 0);
        const refStats = refRoomComparable.get(`${sample.room_id}:${sample.day_type}`);
        const comparableAvg =
          refStats && refStats.samples > 0
            ? refStats.avgDailyKWh / refStats.samples
            : room
            ? room.dailyActualKWh
            : dayActual;

        const devKWh = dayActual - comparableAvg;
        const devPct = comparableAvg > 0.2 ? (devKWh / comparableAvg) * 100 : 0;

        if (devPct >= 32 && devKWh >= 0.8) {
          // Avoid duplicate lower-severity daily alert if a single clear post_hours alert already captures almost all of it, UNLESS it's large or multi-cause
          const avgTemp = round1(intervals.reduce((s, i) => s + i.temperature_c, 0) / intervals.length);
          const avgFan = refStats && refStats.samples > 0 ? refStats.avgFanKWh / refStats.samples : 0;
          const isFanDriven = avgFan > 0 && (dayFan - avgFan) > devKWh * 0.35;

          anomalies.push({
            id: `anom-excess-${rdKey}`,
            dateIst: sample.date_ist,
            hourIst: null,
            timeWindowLabel: formatIstFullLabel(sample.date_ist),
            roomId: sample.room_id,
            roomCode: sample.room_code,
            roomName,
            building: sample.building,
            type: isFanDriven ? 'abnormal_fan_pattern' : 'excess_over_comparable',
            severity: devPct >= 75 || devKWh >= 4.0 ? 'high' : 'medium',
            confidence: refStats && refStats.samples >= 3 ? 'high' : 'moderate',
            observedKWh: round2(dayActual),
            comparableExpectedKWh: round2(comparableAvg),
            deviationKWh: round2(devKWh),
            deviationPercent: round1(devPct),
            title: isFanDriven
              ? `Elevated BLDC fan & thermal load in ${sample.room_code} (+${round1(devPct)}%)`
              : `${sample.room_code} consumed +${round1(devPct)}% above comparable prior-day avg`,
            explanation: `${roomName} used ${round2(dayActual)} kWh on ${formatIstShortLabel(sample.date_ist)} vs its ${round2(comparableAvg)} kWh trailing ${sample.day_type}-day average (+${round2(devKWh)} kWh).`,
            evidence: [
              `Comparable prior avg (${refStats?.samples ?? 0} prior ${sample.day_type} days): ${round2(comparableAvg)} kWh`,
              `Daily mean temperature: ${avgTemp}°C · Fan energy: ${round2(dayFan)} kWh`,
              `Peak interval occupancy: ${Math.round(Math.max(...intervals.map((i) => i.occupied_fraction)) * 100)}%`,
            ],
            caveat:
              'Deviation compares against trailing 21-day same-day-type average; extended occupancy events or warmer ambient conditions may legitimately contribute.',
          });
        }
      }
    }

    // Sort high -> medium -> low, then largest deviation first, then most recent
    const sevWeight = { high: 3, medium: 2, low: 1 };
    anomalies.sort((a, b) => {
      if (sevWeight[b.severity] !== sevWeight[a.severity]) {
        return sevWeight[b.severity] - sevWeight[a.severity];
      }
      if (Math.abs(b.deviationKWh - a.deviationKWh) > 0.25) {
        return b.deviationKWh - a.deviationKWh;
      }
      return b.dateIst.localeCompare(a.dateIst);
    });

    const capped = anomalies.slice(0, 40);

    return {
      ok: true,
      range,
      totalCount: anomalies.length,
      highCount: anomalies.filter((a) => a.severity === 'high').length,
      mediumCount: anomalies.filter((a) => a.severity === 'medium').length,
      lowCount: anomalies.filter((a) => a.severity === 'low').length,
      anomalies: capped,
    };
  }

  public investigatePeriod(params: {
    preset?: string;
    startDate?: string;
    endDate?: string;
    naturalQuery?: string;
    building?: string | null;
    roomId?: string | null;
  }): HistoricalInvestigationResponse {
    const resolved = this.resolveRangeParams(params);
    const buildingFilter = params.building && params.building !== 'All' ? params.building : null;
    const roomFilter = params.roomId && params.roomId !== 'all' ? params.roomId : null;

    // Fetch target interval rows ONCE and reuse across overview, anomalies, and hourly attribution.
    const targetRows = this.fetchIntervals(
      resolved.startDate,
      resolved.endDate,
      buildingFilter,
      roomFilter
    );

    const overview = this.getOverview({
      preset: resolved.preset,
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      building: params.building,
      roomId: params.roomId,
      preFetchedRows: targetRows,
    });

    // Compute trailing 14-day comparable-day-type average via a single SQL GROUP BY query
    const lookbackStart = shiftIstDate(resolved.startDate, -14);
    const lookbackEnd = shiftIstDate(resolved.startDate, -1);
    const lbClauses = ['date_ist >= ?', 'date_ist <= ?'];
    const lbArgs: (string | number)[] = [lookbackStart, lookbackEnd];
    if (buildingFilter) {
      lbClauses.push('building = ?');
      lbArgs.push(buildingFilter);
    }
    if (roomFilter) {
      lbClauses.push('(room_id = ? OR room_code = ?)');
      lbArgs.push(roomFilter, roomFilter);
    }
    const lookbackGrouped = this.db
      .prepare(
        `SELECT room_id, building, date_ist, day_type, SUM(actual_kwh) AS daily_kwh
         FROM history_intervals
         WHERE ${lbClauses.join(' AND ')}
         GROUP BY room_id, building, date_ist, day_type`
      )
      .all(...lbArgs) as Array<{
        room_id: string;
        building: string;
        date_ist: string;
        day_type: string;
        daily_kwh: number;
      }>;

    const targetDates = enumerateIstDates(resolved.startDate, resolved.endDate);
    const targetIsWeekendOnly = targetDates.every(
      (d) => classifyIstDay(d, getIstDateString()) === 'sunday'
    );
    const filteredLookback = lookbackGrouped.filter((r) =>
      targetIsWeekendOnly ? r.day_type === 'sunday' : r.day_type !== 'sunday' && r.day_type !== 'holiday'
    );
    const lookbackPool = filteredLookback.length > 0 ? filteredLookback : lookbackGrouped;

    const lbDayTotals = new Map<string, number>();
    const lbBlockDayTotals = new Map<string, number>();
    const lbRoomDayTotals = new Map<string, number>();

    for (const r of lookbackPool) {
      const kwh = Number(r.daily_kwh || 0);
      lbDayTotals.set(r.date_ist, (lbDayTotals.get(r.date_ist) || 0) + kwh);
      const bk = `${r.building}:${r.date_ist}`;
      lbBlockDayTotals.set(bk, (lbBlockDayTotals.get(bk) || 0) + kwh);
      const rk = `${r.room_id}:${r.date_ist}`;
      lbRoomDayTotals.set(rk, (lbRoomDayTotals.get(rk) || 0) + kwh);
    }

    const avgPerDayCampus =
      lbDayTotals.size > 0
        ? Array.from(lbDayTotals.values()).reduce((s, v) => s + v, 0) / lbDayTotals.size
        : null;
    const comparableCampusTotal =
      avgPerDayCampus !== null ? round2(avgPerDayCampus * targetDates.length) : null;

    const deltaCampusKWh =
      comparableCampusTotal !== null
        ? round2(overview.kpis.totalActualKWh - comparableCampusTotal)
        : null;
    const deltaCampusPct =
      comparableCampusTotal !== null && comparableCampusTotal > 0.1
        ? round1(((overview.kpis.totalActualKWh - comparableCampusTotal) / comparableCampusTotal) * 100)
        : null;

    const topContributingBlocks = overview.blocks.map((b) => {
      const matchingDays = Array.from(lbBlockDayTotals.entries())
        .filter(([k]) => k.startsWith(`${b.building}:`))
        .map(([, v]) => v);
      const compAvg =
        matchingDays.length > 0
          ? round2((matchingDays.reduce((s, v) => s + v, 0) / matchingDays.length) * targetDates.length)
          : null;
      const dKWh = compAvg !== null ? round2(b.actualKWh - compAvg) : null;
      const dPct = compAvg !== null && compAvg > 0.1 ? round1(((b.actualKWh - compAvg) / compAvg) * 100) : null;
      return {
        building: b.building,
        actualKWh: b.actualKWh,
        comparableAvgKWh: compAvg,
        deltaKWh: dKWh,
        deltaPercent: dPct,
        sharePercent: b.sharePercent,
      };
    }).sort((a, b) => (b.deltaKWh ?? b.actualKWh) - (a.deltaKWh ?? a.actualKWh));

    const topContributingRooms = overview.classrooms.map((c) => {
      const matchingDays = Array.from(lbRoomDayTotals.entries())
        .filter(([k]) => k.startsWith(`${c.roomId}:`))
        .map(([, v]) => v);
      const compAvg =
        matchingDays.length > 0
          ? round2((matchingDays.reduce((s, v) => s + v, 0) / matchingDays.length) * targetDates.length)
          : null;
      const dKWh = compAvg !== null ? round2(c.actualKWh - compAvg) : null;
      const dPct = compAvg !== null && compAvg > 0.05 ? round1(((c.actualKWh - compAvg) / compAvg) * 100) : null;
      return {
        roomCode: c.roomCode,
        name: c.name,
        building: c.building,
        actualKWh: c.actualKWh,
        comparableAvgKWh: compAvg,
        deltaKWh: dKWh,
        deltaPercent: dPct,
        postHoursKWh: c.postHoursKWh,
        manualSharePercent: c.manualOverrideSharePercent,
        avgOccupancyPercent: c.avgOccupancyPercent,
      };
    }).sort((a, b) => (b.deltaKWh ?? b.actualKWh) - (a.deltaKWh ?? a.actualKWh))
      .slice(0, 8);

    const avgTempC =
      targetRows.length > 0
        ? round1(targetRows.reduce((s, r) => s + r.temperature_c, 0) / targetRows.length)
        : 0;
    const avgOccPct =
      targetRows.length > 0
        ? round1((targetRows.reduce((s, r) => s + r.occupied_fraction, 0) / targetRows.length) * 100)
        : 0;
    const postHoursKWh = round2(
      targetRows
        .filter((r) => r.hour_ist >= 15 || r.hour_ist <= 6)
        .reduce((s, r) => s + r.actual_kwh, 0)
    );

    const anomalies = this.getAnomalies({
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      building: params.building,
      roomId: params.roomId,
      preFetchedTargetRows: targetRows,
      preFetchedRange: overview.range,
    }).anomalies.slice(0, 8);

    const eventsRaw = this.db
      .prepare(
        'SELECT * FROM history_events WHERE date_ist >= ? AND date_ist <= ? ORDER BY ts_ms DESC LIMIT 12'
      )
      .all(resolved.startDate, resolved.endDate) as unknown as EventRow[];
    const events: HistoryEventRecord[] = eventsRaw.map((e) => ({
      id: e.id,
      tsMs: e.ts_ms,
      dateIst: e.date_ist,
      hourIst: e.hour_ist,
      timeIstLabel: formatIstTimestampLabel(e.ts_ms),
      roomId: e.room_id,
      roomCode: e.room_code,
      building: e.building,
      eventType: e.event_type,
      summary: e.summary,
      actor: e.actor,
      beforeWatts: e.before_watts,
      afterWatts: e.after_watts,
      deltaWatts: e.delta_watts,
    }));

    const uncertaintyNotes: string[] = [];
    if (overview.range.isPartial) {
      uncertaintyNotes.push(
        `Target period includes today (${getIstDateString()}), which is still in progress (${overview.range.completenessPercent}% elapsed interval coverage).`
      );
    }
    if (lbDayTotals.size < 3) {
      uncertaintyNotes.push(
        'Limited prior comparable days were available in the lookback window, lowering reference precision.'
      );
    }
    uncertaintyNotes.push(
      'Appliance kWh totals integrate modeled/configured fixture ratings (computeApplianceWatts × interval hours); post-hours events without PIR motion may reflect either left-on equipment or untracked staff presence.'
    );

    const topBlock = topContributingBlocks[0];
    const topRoom = topContributingRooms[0];
    const labelStr =
      resolved.startDate === resolved.endDate
        ? formatIstFullLabel(resolved.startDate)
        : `${formatIstShortLabel(resolved.startDate)} – ${formatIstShortLabel(resolved.endDate)}`;

    const narrativeParts: string[] = [
      `Total recorded draw for ${labelStr} was ${overview.kpis.totalActualKWh} kWh (lighting ${overview.kpis.lightingKWh} kWh, fans ${overview.kpis.fanKWh} kWh, aux ${overview.kpis.auxKWh} kWh).`,
    ];
    if (comparableCampusTotal !== null && deltaCampusKWh !== null && deltaCampusPct !== null) {
      narrativeParts.push(
        `Compared to the ${lbDayTotals.size}-day comparable prior-day average (${comparableCampusTotal} kWh), consumption was ${deltaCampusKWh >= 0 ? `+${deltaCampusKWh}` : deltaCampusKWh} kWh (${deltaCampusPct >= 0 ? `+${deltaCampusPct}` : deltaCampusPct}%).`
      );
    }
    if (topBlock) {
      narrativeParts.push(
        `Largest block contributor: ${topBlock.building} (${topBlock.actualKWh} kWh${topBlock.deltaKWh !== null ? `, ${topBlock.deltaKWh >= 0 ? `+${topBlock.deltaKWh}` : topBlock.deltaKWh} kWh vs comparable avg` : ''}).`
      );
    }
    if (topRoom) {
      narrativeParts.push(
        `Top room variance: ${topRoom.roomCode} (${topRoom.name}) at ${topRoom.actualKWh} kWh${topRoom.postHoursKWh > 0.5 ? ` with ${topRoom.postHoursKWh} kWh post-hours draw` : ''}.`
      );
    }

    const targetDayTypes = Array.from(
      new Set(targetDates.map((d) => classifyIstDay(d, getIstDateString())))
    );
    const hasData = targetRows.length > 0;
    const isUnusuallyHigh =
      hasData &&
      deltaCampusPct !== null &&
      deltaCampusPct >= 10 &&
      (deltaCampusKWh ?? 0) > 0.15;

    let comparisonVerdict: NonNullable<HistoricalInvestigationResponse['dayContext']>['comparisonVerdict'] =
      'insufficient_reference';
    if (!hasData) {
      comparisonVerdict = 'no_data';
    } else if (targetIsWeekendOnly && (deltaCampusPct === null || deltaCampusPct < 15)) {
      comparisonVerdict = 'weekend_or_holiday_low';
    } else if (deltaCampusPct === null) {
      comparisonVerdict = 'insufficient_reference';
    } else if (isUnusuallyHigh) {
      comparisonVerdict = 'elevated';
    } else if (deltaCampusPct <= -10) {
      comparisonVerdict = 'below_typical';
    } else {
      comparisonVerdict = 'within_normal_range';
    }

    const hourTotals = new Map<number, number>();
    for (const r of targetRows) {
      hourTotals.set(r.hour_ist, (hourTotals.get(r.hour_ist) || 0) + r.actual_kwh);
    }
    let peakHour: number | null = null;
    let peakHourKWh: number | null = null;
    for (const [h, kwh] of hourTotals.entries()) {
      if (peakHourKWh === null || kwh > peakHourKWh) {
        peakHour = h;
        peakHourKWh = round2(kwh);
      }
    }

    return {
      ok: true,
      targetPeriod: {
        label: labelStr,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
        actualKWh: overview.kpis.totalActualKWh,
        ratedMaxKWh: overview.kpis.ratedCapacityKWh,
        comparableHistoricalAvgKWh: comparableCampusTotal,
        deltaVsComparableKWh: deltaCampusKWh,
        deltaVsComparablePercent: deltaCampusPct,
        isPartial: overview.range.isPartial,
        completenessPercent: overview.range.completenessPercent,
      },
      componentDrivers: {
        lightingKWh: overview.kpis.lightingKWh,
        fanKWh: overview.kpis.fanKWh,
        auxKWh: overview.kpis.auxKWh,
        postHoursKWh,
        avgTempC,
        avgOccupancyPercent: avgOccPct,
      },
      topContributingBlocks,
      topContributingRooms,
      anomalies,
      events,
      narrativeSummary: narrativeParts.join(' '),
      uncertaintyNotes,
      dayContext: {
        targetDayTypes,
        isWeekendOrHolidayOnly: targetIsWeekendOnly,
        comparableSampleDays: lbDayTotals.size,
        recordedIntervals: targetRows.length,
        hasData,
        isUnusuallyHigh,
        comparisonVerdict,
        peakHourLabel: peakHour !== null ? `${String(peakHour).padStart(2, '0')}:00 IST` : null,
        peakHourKWh,
      },
    };
  }
}

export function resolveNaturalDateQuery(
  rawQuery: string,
  now: Date = new Date()
): { preset: HistoryDatePreset; startDate: string; endDate: string } {
  const qRaw = rawQuery.toLowerCase().trim();
  const q = qRaw.replace(/_/g, ' ').replace(/\s+/g, ' ');
  const today = getIstDateString(now);

  // Explicit ISO date (YYYY-MM-DD)
  const isoMatches = qRaw.match(/\b(\d{4}-\d{2}-\d{2})\b/g);
  if (isoMatches && isoMatches.length >= 2 && isValidIstDate(isoMatches[0]) && isValidIstDate(isoMatches[1])) {
    const a = isoMatches[0];
    const b = isoMatches[1];
    return a <= b
      ? { preset: 'custom', startDate: a, endDate: b }
      : { preset: 'custom', startDate: b, endDate: a };
  }
  if (isoMatches && isoMatches.length === 1 && isValidIstDate(isoMatches[0])) {
    return { preset: 'custom', startDate: isoMatches[0], endDate: isoMatches[0] };
  }

  if (q === 'today' || q.includes('today') || q.includes('so far')) {
    return { preset: 'today', startDate: today, endDate: today };
  }
  if (
    q === 'day before yesterday' ||
    q.includes('day before yesterday') ||
    q.includes('2 days ago') ||
    q.includes('two days ago')
  ) {
    const d = shiftIstDate(today, -2);
    return { preset: 'custom', startDate: d, endDate: d };
  }
  if (q.includes('3 days ago') || q.includes('three days ago')) {
    const d = shiftIstDate(today, -3);
    return { preset: 'custom', startDate: d, endDate: d };
  }
  if (q === 'yesterday' || q.includes('yesterday')) {
    const y = shiftIstDate(today, -1);
    return { preset: 'yesterday', startDate: y, endDate: y };
  }
  if (q.includes('previous month') || q.includes('last month')) {
    return { preset: 'previous_month', ...resolveHistoryPresetRange('previous_month', undefined, undefined, now) };
  }
  if (q.includes('this month') || q.includes('current month')) {
    return { preset: 'this_month', ...resolveHistoryPresetRange('this_month', undefined, undefined, now) };
  }
  if (q.includes('last week') || q.includes('previous week')) {
    // Monday-Sunday previous calendar week or trailing 7d before this week
    const dow = getIstDayOfWeek(today); // 0=Sun..6=Sat
    const daysSinceMonday = (dow + 6) % 7;
    const thisWeekMonday = shiftIstDate(today, -daysSinceMonday);
    const prevWeekEnd = shiftIstDate(thisWeekMonday, -1);
    const prevWeekStart = shiftIstDate(prevWeekEnd, -6);
    return { preset: 'custom', startDate: prevWeekStart, endDate: prevWeekEnd };
  }
  if (q.includes('this week')) {
    const dow = getIstDayOfWeek(today);
    const daysSinceMonday = (dow + 6) % 7;
    return { preset: 'custom', startDate: shiftIstDate(today, -daysSinceMonday), endDate: today };
  }
  if (q.includes('30') || q.includes('past month')) {
    return { preset: 'last_30_days', ...resolveHistoryPresetRange('last_30_days', undefined, undefined, now) };
  }
  if (q.includes('7') || q.includes('week')) {
    return { preset: 'last_7_days', ...resolveHistoryPresetRange('last_7_days', undefined, undefined, now) };
  }

  // Named month support (e.g., "October", "September", "August", "November")
  const monthNames: Array<[string, number]> = [
    ['january', 1], ['february', 2], ['march', 3], ['april', 4],
    ['may', 5], ['june', 6], ['july', 7], ['august', 8],
    ['september', 9], ['october', 10], ['november', 11], ['december', 12],
    ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['aug', 8],
    ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
  ];
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  for (const [name, mNum] of monthNames) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(q)) {
      const targetYear = mNum > currentMonth ? currentYear - 1 : currentYear;
      const moStr = String(mNum).padStart(2, '0');
      const firstDay = `${targetYear}-${moStr}-01`;
      const nextMo = mNum === 12 ? 1 : mNum + 1;
      const nextYr = mNum === 12 ? targetYear + 1 : targetYear;
      const lastDay = shiftIstDate(`${nextYr}-${String(nextMo).padStart(2, '0')}-01`, -1);
      const boundedEnd = lastDay > today ? today : lastDay;
      return {
        preset: mNum === currentMonth ? 'this_month' : mNum === currentMonth - 1 ? 'previous_month' : 'custom',
        startDate: firstDay,
        endDate: boundedEnd >= firstDay ? boundedEnd : firstDay,
      };
    }
  }

  return { preset: 'last_7_days', ...resolveHistoryPresetRange('last_7_days', undefined, undefined, now) };
}

export const energyHistoryService = new EnergyHistoryService();
