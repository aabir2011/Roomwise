/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { INITIAL_CLASSROOMS } from '../src/data/initialClassrooms.ts';
import { ROOM_APPLIANCE_SPECS } from '../src/data/roomApplianceSpecs.ts';
import type {
  CounterfactualBaselineMethod,
  CreateInterventionInput,
  InterventionActionStatus,
  InterventionCircuitType,
  InterventionCorrectionEntry,
  InterventionDetailResponse,
  InterventionEnergyCalculation,
  InterventionLedgerListResponse,
  InterventionLedgerQueryParams,
  InterventionLedgerSummary,
  InterventionOverlapInfo,
  InterventionRecord,
  InterventionSensorSnapshot,
  InterventionSource,
  InterventionTriggerCategory,
  InterventionVerificationStatus,
} from '../src/types/interventionLedger.ts';
import type { HistoryDatePreset } from '../src/types/history.ts';
import {
  formatIstTimestampLabel,
  getIstDateString,
  parseIstDateToUtcMs,
  resolveHistoryPresetRange,
  shiftIstDate,
} from '../src/utils/historyDates.ts';
import { energyHistoryService } from './energyHistoryService.ts';

export const LEDGER_CALCULATION_VERSION = 'ledger-calc-v1.0';
const LEDGER_SEED_VERSION = 'v1-dav-day-school-sim';

const ROOM_BY_ID = new Map(INITIAL_CLASSROOMS.map((r) => [r.id, r]));
const SPEC_BY_ROOM_ID = new Map(ROOM_APPLIANCE_SPECS.map((s) => [s.roomId, s]));

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

export interface TimeInterval {
  startMs: number;
  endMs: number;
  eventId: string;
}

/**
 * Enforces strict provenance-to-verification rules so simulated or unverified
 * events can NEVER be falsely labelled as meter-backed or meter-verified.
 */
export function resolveStrictVerificationStatus(
  source: InterventionSource,
  requestedStatus?: InterventionVerificationStatus,
  hasDocumentedBaselineVerification = false
): { status: InterventionVerificationStatus; basis: string } {
  if (source === 'simulated') {
    return {
      status: 'estimated',
      basis:
        'Modelled operational control record using ROOMWISE room appliance ratings and control rules (meter verification pending).',
    };
  }

  if (source === 'hardware_telemetry') {
    return {
      status: 'estimated',
      basis:
        'Derived from hardware node telemetry and configured appliance power ratings; utility meter verification has not been attached.',
    };
  }

  // source === 'meter_data'
  if (requestedStatus === 'meter_verified' && hasDocumentedBaselineVerification) {
    return {
      status: 'meter_verified',
      basis:
        'Supported by actual electricity-meter measurements and a documented comparable prior-reference verification protocol.',
    };
  }

  return {
    status: 'meter_backed',
    basis:
      'Supported by electricity-meter measurements, with comparable prior-reference verification still pending.',
  };
}

/**
 * Determines whether two circuit targets in the same room can overlap on the same electrical load.
 * - Independent circuits in the same room (e.g., lights vs fan) do NOT conflict.
 * - Same circuit ID always conflicts.
 * - A room-wide combined event ('room_combined') conflicts with every specific circuit in that room.
 */
export function circuitsConflict(
  a: { affectedCircuitId: string; circuitType: InterventionCircuitType },
  b: { affectedCircuitId: string; circuitType: InterventionCircuitType }
): boolean {
  if (a.affectedCircuitId === b.affectedCircuitId) return true;
  if (a.circuitType === 'room_combined' || b.circuitType === 'room_combined') return true;
  return false;
}

/**
 * Subtracts a set of already-counted intervals from a candidate interval [startMs, endMs].
 * Returns exact non-overlapping duration, trimmed overlap duration, and overlapping event IDs.
 */
export function computeNonOverlappingInterval(
  startMs: number,
  endMs: number,
  existingCountedIntervals: ReadonlyArray<TimeInterval>
): {
  rawMs: number;
  uncoveredMs: number;
  overlapMs: number;
  overlappingEventIds: string[];
} {
  const rawMs = Math.max(0, endMs - startMs);
  if (rawMs === 0) {
    return { rawMs: 0, uncoveredMs: 0, overlapMs: 0, overlappingEventIds: [] };
  }

  const intersecting: Array<{ start: number; end: number; eventId: string }> = [];
  for (const iv of existingCountedIntervals) {
    const s = Math.max(startMs, iv.startMs);
    const e = Math.min(endMs, iv.endMs);
    if (e > s) {
      intersecting.push({ start: s, end: e, eventId: iv.eventId });
    }
  }

  if (intersecting.length === 0) {
    return { rawMs, uncoveredMs: rawMs, overlapMs: 0, overlappingEventIds: [] };
  }

  intersecting.sort((x, y) => x.start - y.start || x.end - y.end);
  const merged: Array<{ start: number; end: number }> = [];
  const overlappingIds = new Set<string>();

  for (const iv of intersecting) {
    overlappingIds.add(iv.eventId);
    const last = merged[merged.length - 1];
    if (!last || iv.start > last.end) {
      merged.push({ start: iv.start, end: iv.end });
    } else if (iv.end > last.end) {
      last.end = iv.end;
    }
  }

  const overlapMs = merged.reduce((sum, m) => sum + (m.end - m.start), 0);
  const uncoveredMs = Math.max(0, rawMs - overlapMs);

  return {
    rawMs,
    uncoveredMs,
    overlapMs,
    overlappingEventIds: Array.from(overlappingIds),
  };
}

/**
 * Pure, dimensionally validated counterfactual energy calculation:
 *   Estimated energy avoided (Wh) = Estimated power difference (W) × Attributed duration (hours)
 *   Estimated energy avoided (kWh) = Wh / 1000
 *
 * Explicitly returns calculable=false and null Wh/kWh when baseline, post-power, or valid duration is unavailable.
 */
export function evaluateInterventionEnergyAndOverlap(params: {
  actionStatus: InterventionActionStatus;
  startTsMs: number;
  endTsMs: number | null;
  counterfactualBaselineWatts: number | null;
  postInterventionWatts: number | null;
  baselineMethod: CounterfactualBaselineMethod;
  baselineExplanation: string;
  assumptions: string[];
  loadRatingSource: string;
  existingCountedIntervals: ReadonlyArray<TimeInterval>;
}): {
  energyCalculation: InterventionEnergyCalculation;
  overlap: InterventionOverlapInfo;
  durationMinutes: number | null;
} {
  const {
    actionStatus,
    startTsMs,
    endTsMs,
    counterfactualBaselineWatts,
    postInterventionWatts,
    baselineMethod,
    baselineExplanation,
    assumptions,
    loadRatingSource,
    existingCountedIntervals,
  } = params;

  const makeNotCalculable = (reason: string): {
    energyCalculation: InterventionEnergyCalculation;
    overlap: InterventionOverlapInfo;
    durationMinutes: number | null;
  } => {
    const durationMinutes =
      endTsMs !== null && Number.isFinite(endTsMs) && endTsMs > startTsMs
        ? round1((endTsMs - startTsMs) / 60000)
        : null;
    const rawHours = durationMinutes !== null ? round4(durationMinutes / 60) : null;
    const powerDiff =
      counterfactualBaselineWatts !== null &&
      postInterventionWatts !== null &&
      Number.isFinite(counterfactualBaselineWatts) &&
      Number.isFinite(postInterventionWatts)
        ? round2(Math.max(0, counterfactualBaselineWatts - postInterventionWatts))
        : null;

    return {
      durationMinutes,
      energyCalculation: {
        calculable: false,
        unavailableReason: reason,
        counterfactualBaselineWatts:
          counterfactualBaselineWatts !== null && Number.isFinite(counterfactualBaselineWatts)
            ? round2(counterfactualBaselineWatts)
            : null,
        postInterventionWatts:
          postInterventionWatts !== null && Number.isFinite(postInterventionWatts)
            ? round2(postInterventionWatts)
            : null,
        powerDifferenceWatts: powerDiff,
        rawDurationHours: rawHours,
        attributedDurationHours: null,
        rawEnergyAvoidedWh: null,
        attributedEnergyAvoidedWh: null,
        attributedEnergyAvoidedKwh: null,
        formulaExpression: `Not calculable — ${reason}`,
        baselineMethod,
        baselineExplanation,
        assumptions,
        loadRatingSource,
        calculationMethodVersion: LEDGER_CALCULATION_VERSION,
      },
      overlap: {
        status: 'not_calculable_missing_data',
        countedInTotals: false,
        overlappingEventIds: [],
        trimmedOverlapMinutes: 0,
        explanation: reason,
      },
    };
  };

  if (actionStatus === 'cancelled' || actionStatus === 'unresolved') {
    return makeNotCalculable(`Intervention status is "${actionStatus}"; no avoided energy attributed.`);
  }

  if (actionStatus === 'active' || endTsMs === null || !Number.isFinite(endTsMs)) {
    return makeNotCalculable('End timestamp and completed duration are not yet available.');
  }

  if (endTsMs <= startTsMs) {
    return makeNotCalculable('Intervention duration is zero or invalid (end <= start).');
  }

  if (
    baselineMethod === 'unavailable' ||
    counterfactualBaselineWatts === null ||
    !Number.isFinite(counterfactualBaselineWatts) ||
    counterfactualBaselineWatts < 0
  ) {
    return makeNotCalculable('Counterfactual baseline power (W) is unavailable; savings cannot be fabricated.');
  }

  if (
    postInterventionWatts === null ||
    !Number.isFinite(postInterventionWatts) ||
    postInterventionWatts < 0
  ) {
    return makeNotCalculable('Post-intervention operating power (W) is unavailable.');
  }

  const powerDiffWatts = round2(Math.max(0, counterfactualBaselineWatts - postInterventionWatts));
  const durationMinutes = round1((endTsMs - startTsMs) / 60000);
  const rawDurationHours = round4((endTsMs - startTsMs) / 3600000);

  if (powerDiffWatts <= 0) {
    return makeNotCalculable(
      'Post-intervention power is equal to or above counterfactual baseline (0 W reduction).'
    );
  }

  const overlapEval = computeNonOverlappingInterval(startTsMs, endTsMs, existingCountedIntervals);
  const attributedDurationHours = round4(overlapEval.uncoveredMs / 3600000);
  const trimmedOverlapMinutes = round1(overlapEval.overlapMs / 60000);
  const rawEnergyAvoidedWh = round2(powerDiffWatts * rawDurationHours);
  const attributedEnergyAvoidedWh = round2(powerDiffWatts * attributedDurationHours);
  const attributedEnergyAvoidedKwh = round4(attributedEnergyAvoidedWh / 1000);

  if (overlapEval.uncoveredMs <= 0) {
    return {
      durationMinutes,
      energyCalculation: {
        calculable: true,
        unavailableReason: null,
        counterfactualBaselineWatts: round2(counterfactualBaselineWatts),
        postInterventionWatts: round2(postInterventionWatts),
        powerDifferenceWatts: powerDiffWatts,
        rawDurationHours,
        attributedDurationHours: 0,
        rawEnergyAvoidedWh,
        attributedEnergyAvoidedWh: 0,
        attributedEnergyAvoidedKwh: 0,
        formulaExpression: `${powerDiffWatts} W × 0.00 h attributed (100% covered by overlapping event) = 0 Wh`,
        baselineMethod,
        baselineExplanation,
        assumptions,
        loadRatingSource,
        calculationMethodVersion: LEDGER_CALCULATION_VERSION,
      },
      overlap: {
        status: 'excluded_overlap_duplicate',
        countedInTotals: false,
        overlappingEventIds: overlapEval.overlappingEventIds,
        trimmedOverlapMinutes,
        explanation: `Entire ${durationMinutes} min interval overlaps already-counted intervention(s) (${overlapEval.overlappingEventIds.join(', ')}) on the same room circuit. Retained for auditability and excluded from aggregate savings to prevent double counting.`,
      },
    };
  }

  if (overlapEval.overlapMs > 0) {
    return {
      durationMinutes,
      energyCalculation: {
        calculable: true,
        unavailableReason: null,
        counterfactualBaselineWatts: round2(counterfactualBaselineWatts),
        postInterventionWatts: round2(postInterventionWatts),
        powerDifferenceWatts: powerDiffWatts,
        rawDurationHours,
        attributedDurationHours,
        rawEnergyAvoidedWh,
        attributedEnergyAvoidedWh,
        attributedEnergyAvoidedKwh,
        formulaExpression: `${powerDiffWatts} W × ${round2(attributedDurationHours)} h (trimmed ${trimmedOverlapMinutes} min overlap) = ${attributedEnergyAvoidedWh} Wh (${round3(attributedEnergyAvoidedKwh)} kWh)`,
        baselineMethod,
        baselineExplanation,
        assumptions,
        loadRatingSource,
        calculationMethodVersion: LEDGER_CALCULATION_VERSION,
      },
      overlap: {
        status: 'counted_partial_overlap_trimmed',
        countedInTotals: true,
        overlappingEventIds: overlapEval.overlappingEventIds,
        trimmedOverlapMinutes,
        explanation: `${trimmedOverlapMinutes} min overlapped existing intervention(s) (${overlapEval.overlappingEventIds.join(', ')}) on the same circuit; only the remaining ${round1(overlapEval.uncoveredMs / 60000)} min is attributed to aggregate avoided energy.`,
      },
    };
  }

  return {
    durationMinutes,
    energyCalculation: {
      calculable: true,
      unavailableReason: null,
      counterfactualBaselineWatts: round2(counterfactualBaselineWatts),
      postInterventionWatts: round2(postInterventionWatts),
      powerDifferenceWatts: powerDiffWatts,
      rawDurationHours,
      attributedDurationHours,
      rawEnergyAvoidedWh,
      attributedEnergyAvoidedWh,
      attributedEnergyAvoidedKwh,
      formulaExpression: `${powerDiffWatts} W × ${round2(attributedDurationHours)} h = ${attributedEnergyAvoidedWh} Wh (${round3(attributedEnergyAvoidedKwh)} kWh)`,
      baselineMethod,
      baselineExplanation,
      assumptions,
      loadRatingSource,
      calculationMethodVersion: LEDGER_CALCULATION_VERSION,
    },
    overlap: {
      status: 'counted_full',
      countedInTotals: true,
      overlappingEventIds: [],
      trimmedOverlapMinutes: 0,
      explanation:
        'Independently attributable circuit load and time interval with zero overlap against other counted interventions in this room.',
    },
  };
}

interface DbLedgerRow {
  id: string;
  idempotency_key: string;
  event_group_id: string;
  parent_event_id: string | null;
  room_id: string;
  room_code: string;
  room_name: string;
  building: string;
  floor: string;
  source: string;
  is_demonstration_data: number;
  trigger_ts_ms: number;
  start_ts_ms: number;
  end_ts_ms: number | null;
  duration_minutes: number | null;
  recorded_at_ms: number;
  date_ist: string;
  trigger_category: string;
  trigger_summary: string;
  evidence_summary: string;
  sensor_snapshot_json: string;
  rule_logic: string;
  affected_circuit_id: string;
  affected_circuit_name: string;
  circuit_type: string;
  previous_state: string;
  new_state: string;
  action_performed: string;
  action_status: string;
  actor: string;
  energy_calc_json: string;
  overlap_json: string;
  counted_in_totals: number;
  attributed_avoided_wh: number | null;
  attributed_avoided_kwh: number | null;
  verification_status: string;
  verification_basis: string;
}

interface DbCorrectionRow {
  id: string;
  intervention_id: string;
  created_at_ms: number;
  actor: string;
  reason: string;
  previous_summary: string;
  new_summary: string;
}

export class InterventionLedgerService {
  private customDb?: DatabaseSync;
  private isInitialized = false;

  constructor(db?: DatabaseSync) {
    this.customDb = db;
    this.createSchema();
  }

  private get db(): DatabaseSync {
    return this.customDb ?? energyHistoryService.getDb();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intervention_ledger_events (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE NOT NULL,
        event_group_id TEXT NOT NULL,
        parent_event_id TEXT,
        room_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        room_name TEXT NOT NULL,
        building TEXT NOT NULL,
        floor TEXT NOT NULL,
        source TEXT NOT NULL,
        is_demonstration_data INTEGER NOT NULL DEFAULT 1,
        trigger_ts_ms INTEGER NOT NULL,
        start_ts_ms INTEGER NOT NULL,
        end_ts_ms INTEGER,
        duration_minutes REAL,
        recorded_at_ms INTEGER NOT NULL,
        date_ist TEXT NOT NULL,
        trigger_category TEXT NOT NULL,
        trigger_summary TEXT NOT NULL,
        evidence_summary TEXT NOT NULL,
        sensor_snapshot_json TEXT NOT NULL,
        rule_logic TEXT NOT NULL,
        affected_circuit_id TEXT NOT NULL,
        affected_circuit_name TEXT NOT NULL,
        circuit_type TEXT NOT NULL,
        previous_state TEXT NOT NULL,
        new_state TEXT NOT NULL,
        action_performed TEXT NOT NULL,
        action_status TEXT NOT NULL,
        actor TEXT NOT NULL,
        energy_calc_json TEXT NOT NULL,
        overlap_json TEXT NOT NULL,
        counted_in_totals INTEGER NOT NULL DEFAULT 0,
        attributed_avoided_wh REAL,
        attributed_avoided_kwh REAL,
        verification_status TEXT NOT NULL,
        verification_basis TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_date_room
        ON intervention_ledger_events (date_ist, room_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_room_circuit_time
        ON intervention_ledger_events (room_id, affected_circuit_id, start_ts_ms);
      CREATE INDEX IF NOT EXISTS idx_ledger_group
        ON intervention_ledger_events (event_group_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_building_date
        ON intervention_ledger_events (building, date_ist);

      CREATE TABLE IF NOT EXISTS intervention_ledger_corrections (
        id TEXT PRIMARY KEY,
        intervention_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        previous_summary TEXT NOT NULL,
        new_summary TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_corr_event
        ON intervention_ledger_corrections (intervention_id, created_at_ms);

      CREATE TABLE IF NOT EXISTS intervention_ledger_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  public initialize(options?: { seedDemonstrationData?: boolean }): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.createSchema();

    const shouldSeed = options?.seedDemonstrationData ?? true;
    if (!shouldSeed) return;

    const existingMeta = this.db
      .prepare('SELECT value FROM intervention_ledger_meta WHERE key = ?')
      .get('seed_version') as { value?: string } | undefined;

    if (existingMeta?.value === LEDGER_SEED_VERSION) {
      return;
    }

    const existingCount = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM intervention_ledger_events').get() as {
        cnt: number;
      }
    ).cnt;

    if (existingCount === 0) {
      this.seedSimulatedDemonstrationEvents();
    }

    this.db
      .prepare('INSERT OR REPLACE INTO intervention_ledger_meta (key, value) VALUES (?, ?)')
      .run('seed_version', LEDGER_SEED_VERSION);
  }

  private rowToRecord(row: DbLedgerRow, groupCountMap?: Map<string, number>): InterventionRecord {
    const sensorSnapshot = JSON.parse(row.sensor_snapshot_json) as InterventionSensorSnapshot;
    const energyCalculation = JSON.parse(row.energy_calc_json) as InterventionEnergyCalculation;
    const overlap = JSON.parse(row.overlap_json) as InterventionOverlapInfo;

    const groupCount =
      groupCountMap?.get(row.event_group_id) ??
      (
        this.db
          .prepare('SELECT COUNT(*) as cnt FROM intervention_ledger_events WHERE event_group_id = ?')
          .get(row.event_group_id) as { cnt: number }
      ).cnt;

    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      eventGroupId: row.event_group_id,
      parentEventId: row.parent_event_id,
      roomId: row.room_id,
      roomCode: row.room_code,
      roomName: row.room_name,
      building: row.building,
      floor: row.floor,
      source: row.source as InterventionSource,
      isDemonstrationData: row.is_demonstration_data === 1,

      triggerTsMs: row.trigger_ts_ms,
      triggerAtIst: formatIstTimestampLabel(row.trigger_ts_ms),
      startTsMs: row.start_ts_ms,
      startAtIst: formatIstTimestampLabel(row.start_ts_ms),
      endTsMs: row.end_ts_ms,
      endAtIst: row.end_ts_ms !== null ? formatIstTimestampLabel(row.end_ts_ms) : null,
      durationMinutes: row.duration_minutes,
      recordedAtMs: row.recorded_at_ms,
      recordedAtIst: formatIstTimestampLabel(row.recorded_at_ms),
      dateIst: row.date_ist,
      timezone: 'Asia/Kolkata',

      triggerCategory: row.trigger_category as InterventionTriggerCategory,
      triggerSummary: row.trigger_summary,
      evidenceSummary: row.evidence_summary,
      sensorSnapshot,
      ruleLogic: row.rule_logic,

      affectedCircuitId: row.affected_circuit_id,
      affectedCircuitName: row.affected_circuit_name,
      circuitType: row.circuit_type as InterventionCircuitType,
      previousState: row.previous_state,
      newState: row.new_state,
      actionPerformed: row.action_performed,
      actionStatus: row.action_status as InterventionActionStatus,
      actor: row.actor,
      relatedActionCountInGroup: groupCount,

      energyCalculation,
      overlap,

      verificationStatus: row.verification_status as InterventionVerificationStatus,
      verificationBasis: row.verification_basis,
    };
  }

  public recordIntervention(input: CreateInterventionInput): {
    created: boolean;
    duplicate: boolean;
    record: InterventionRecord;
  } {
    const room = ROOM_BY_ID.get(input.roomId);
    if (!room) {
      throw new Error(`Unknown roomId "${input.roomId}" — cannot record intervention.`);
    }

    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      `idem-${input.roomId}-${input.affectedCircuitId}-${input.startTsMs}-${input.triggerCategory}-${input.actionPerformed}`;

    // Idempotency check by key or explicit ID
    const existingByKey = this.db
      .prepare('SELECT * FROM intervention_ledger_events WHERE idempotency_key = ?')
      .get(idempotencyKey) as DbLedgerRow | undefined;
    if (existingByKey) {
      return { created: false, duplicate: true, record: this.rowToRecord(existingByKey) };
    }

    if (input.id) {
      const existingById = this.db
        .prepare('SELECT * FROM intervention_ledger_events WHERE id = ?')
        .get(input.id) as DbLedgerRow | undefined;
      if (existingById) {
        return { created: false, duplicate: true, record: this.rowToRecord(existingById) };
      }
    }

    const id =
      input.id?.trim() ||
      `intv-${getIstDateString(new Date(input.startTsMs))}-${crypto.randomBytes(4).toString('hex')}`;
    const eventGroupId = input.eventGroupId?.trim() || `grp-${id}`;
    const recordedAtMs = Date.now();
    const dateIst = getIstDateString(new Date(input.startTsMs));

    // Fetch existing counted intervals for the SAME room that could conflict with this circuit
    const existingRows = this.db
      .prepare(
        `SELECT id, affected_circuit_id, circuit_type, start_ts_ms, end_ts_ms
         FROM intervention_ledger_events
         WHERE room_id = ? AND counted_in_totals = 1 AND end_ts_ms IS NOT NULL`
      )
      .all(input.roomId) as Array<{
      id: string;
      affected_circuit_id: string;
      circuit_type: string;
      start_ts_ms: number;
      end_ts_ms: number;
    }>;

    const conflictingIntervals: TimeInterval[] = [];
    for (const row of existingRows) {
      if (
        circuitsConflict(
          { affectedCircuitId: input.affectedCircuitId, circuitType: input.circuitType },
          {
            affectedCircuitId: row.affected_circuit_id,
            circuitType: row.circuit_type as InterventionCircuitType,
          }
        )
      ) {
        conflictingIntervals.push({
          eventId: row.id,
          startMs: row.start_ts_ms,
          endMs: row.end_ts_ms,
        });
      }
    }

    const { energyCalculation, overlap, durationMinutes } = evaluateInterventionEnergyAndOverlap({
      actionStatus: input.actionStatus,
      startTsMs: input.startTsMs,
      endTsMs: input.endTsMs,
      counterfactualBaselineWatts: input.counterfactualBaselineWatts,
      postInterventionWatts: input.postInterventionWatts,
      baselineMethod: input.baselineMethod,
      baselineExplanation: input.baselineExplanation,
      assumptions: input.assumptions ?? [],
      loadRatingSource: input.loadRatingSource,
      existingCountedIntervals: conflictingIntervals,
    });

    const verification = resolveStrictVerificationStatus(
      input.source,
      input.requestedVerificationStatus,
      Boolean(input.hasDocumentedBaselineVerification)
    );

    const isDemo = input.isDemonstrationData ?? input.source === 'simulated';

    this.db
      .prepare(
        `INSERT INTO intervention_ledger_events (
          id, idempotency_key, event_group_id, parent_event_id,
          room_id, room_code, room_name, building, floor,
          source, is_demonstration_data,
          trigger_ts_ms, start_ts_ms, end_ts_ms, duration_minutes, recorded_at_ms, date_ist,
          trigger_category, trigger_summary, evidence_summary, sensor_snapshot_json, rule_logic,
          affected_circuit_id, affected_circuit_name, circuit_type,
          previous_state, new_state, action_performed, action_status, actor,
          energy_calc_json, overlap_json, counted_in_totals, attributed_avoided_wh, attributed_avoided_kwh,
          verification_status, verification_basis
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?
        )`
      )
      .run(
        id,
        idempotencyKey,
        eventGroupId,
        input.parentEventId ?? null,
        room.id,
        room.roomCode,
        room.name,
        room.building,
        room.floor,
        input.source,
        isDemo ? 1 : 0,
        input.triggerTsMs,
        input.startTsMs,
        input.endTsMs,
        durationMinutes,
        recordedAtMs,
        dateIst,
        input.triggerCategory,
        input.triggerSummary,
        input.evidenceSummary,
        JSON.stringify(input.sensorSnapshot),
        input.ruleLogic,
        input.affectedCircuitId,
        input.affectedCircuitName,
        input.circuitType,
        input.previousState,
        input.newState,
        input.actionPerformed,
        input.actionStatus,
        input.actor,
        JSON.stringify(energyCalculation),
        JSON.stringify(overlap),
        overlap.countedInTotals ? 1 : 0,
        energyCalculation.attributedEnergyAvoidedWh,
        energyCalculation.attributedEnergyAvoidedKwh,
        verification.status,
        verification.basis
      );

    // Record automatic audit trail entry when overlap prevention trims or excludes energy
    if (
      overlap.status === 'counted_partial_overlap_trimmed' ||
      overlap.status === 'excluded_overlap_duplicate'
    ) {
      this.appendCorrectionEntry({
        interventionId: id,
        actor: 'ROOMWISE Anti-Double-Counting Engine',
        reason:
          overlap.status === 'excluded_overlap_duplicate'
            ? 'Excluded duplicate overlapping load interval from totals'
            : 'Trimmed partial overlapping duration on same circuit',
        previousSummary: `Raw interval ${durationMinutes ?? 0} min (${energyCalculation.rawEnergyAvoidedWh ?? 0} Wh raw)`,
        newSummary: `Attributed ${round1((energyCalculation.attributedDurationHours ?? 0) * 60)} min (${energyCalculation.attributedEnergyAvoidedWh ?? 0} Wh attributed) · Conflicts: ${overlap.overlappingEventIds.join(', ')}`,
      });
    }

    const inserted = this.db
      .prepare('SELECT * FROM intervention_ledger_events WHERE id = ?')
      .get(id) as unknown as DbLedgerRow;

    return {
      created: true,
      duplicate: false,
      record: this.rowToRecord(inserted),
    };
  }

  public appendCorrectionEntry(params: {
    interventionId: string;
    actor: string;
    reason: string;
    previousSummary: string;
    newSummary: string;
  }): InterventionCorrectionEntry {
    const id = `corr-${crypto.randomBytes(5).toString('hex')}`;
    const createdAtMs = Date.now();
    this.db
      .prepare(
        `INSERT INTO intervention_ledger_corrections (
          id, intervention_id, created_at_ms, actor, reason, previous_summary, new_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.interventionId,
        createdAtMs,
        params.actor,
        params.reason,
        params.previousSummary,
        params.newSummary
      );
    return {
      id,
      interventionId: params.interventionId,
      createdAtMs,
      createdAtIst: formatIstTimestampLabel(createdAtMs),
      actor: params.actor,
      reason: params.reason,
      previousSummary: params.previousSummary,
      newSummary: params.newSummary,
    };
  }

  public listInterventions(query: InterventionLedgerQueryParams = {}): InterventionLedgerListResponse {
    const validPresets: ReadonlyArray<HistoryDatePreset> = [
      'today',
      'yesterday',
      'last_7_days',
      'last_30_days',
      'this_month',
      'previous_month',
      'custom',
    ];
    const requestedPreset: HistoryDatePreset =
      query.preset && validPresets.includes(query.preset as HistoryDatePreset)
        ? (query.preset as HistoryDatePreset)
        : query.startDate || query.endDate
        ? 'custom'
        : 'last_30_days';
    const resolvedRange = resolveHistoryPresetRange(
      requestedPreset,
      query.startDate,
      query.endDate
    );

    const conditions: string[] = ['date_ist >= ? AND date_ist <= ?'];
    const args: Array<string | number> = [resolvedRange.startDate, resolvedRange.endDate];

    if (query.building && query.building !== 'All') {
      conditions.push('building = ?');
      args.push(query.building);
    }
    if (query.roomId && query.roomId !== 'All') {
      conditions.push('room_id = ?');
      args.push(query.roomId);
    }
    if (query.triggerCategory && query.triggerCategory !== 'All') {
      conditions.push('trigger_category = ?');
      args.push(query.triggerCategory);
    }
    if (query.circuitType && query.circuitType !== 'All') {
      conditions.push('circuit_type = ?');
      args.push(query.circuitType);
    }
    if (query.actionStatus && query.actionStatus !== 'All') {
      conditions.push('action_status = ?');
      args.push(query.actionStatus);
    }
    if (query.source && query.source !== 'All') {
      conditions.push('source = ?');
      args.push(query.source);
    }
    if (query.verificationStatus && query.verificationStatus !== 'All') {
      conditions.push('verification_status = ?');
      args.push(query.verificationStatus);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM intervention_ledger_events WHERE ${conditions.join(' AND ')} ORDER BY start_ts_ms DESC`
      )
      .all(...args) as unknown as DbLedgerRow[];

    const groupCounts = new Map<string, number>();
    const allGroupRows = this.db
      .prepare(
        'SELECT event_group_id, COUNT(*) as cnt FROM intervention_ledger_events GROUP BY event_group_id'
      )
      .all() as Array<{ event_group_id: string; cnt: number }>;
    for (const g of allGroupRows) {
      groupCounts.set(g.event_group_id, g.cnt);
    }

    let records = rows.map((r) => this.rowToRecord(r, groupCounts));

    if (query.search && query.search.trim().length > 0) {
      const q = query.search.trim().toLowerCase();
      records = records.filter(
        (r) =>
          r.roomCode.toLowerCase().includes(q) ||
          r.roomName.toLowerCase().includes(q) ||
          r.building.toLowerCase().includes(q) ||
          r.triggerSummary.toLowerCase().includes(q) ||
          r.actionPerformed.toLowerCase().includes(q) ||
          r.affectedCircuitName.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.eventGroupId.toLowerCase().includes(q)
      );
    }

    const sortBy = query.sortBy || 'timestamp';
    const sortDir = query.sortDir === 'asc' ? 1 : -1;
    records.sort((a, b) => {
      if (sortBy === 'energy') {
        const av = a.energyCalculation.attributedEnergyAvoidedWh ?? -1;
        const bv = b.energyCalculation.attributedEnergyAvoidedWh ?? -1;
        return (av - bv) * sortDir;
      }
      if (sortBy === 'duration') {
        const av = a.durationMinutes ?? -1;
        const bv = b.durationMinutes ?? -1;
        return (av - bv) * sortDir;
      }
      if (sortBy === 'room') {
        return a.roomCode.localeCompare(b.roomCode) * sortDir;
      }
      return (a.startTsMs - b.startTsMs) * sortDir;
    });

    const summary = this.computeSummary(records);

    const buildings = Array.from(new Set(INITIAL_CLASSROOMS.map((r) => r.building)));
    const rooms = INITIAL_CLASSROOMS.map((r) => ({
      roomId: r.id,
      roomCode: r.roomCode,
      roomName: r.name,
      building: r.building,
    }));

    return {
      ok: true,
      range: {
        startDate: resolvedRange.startDate,
        endDate: resolvedRange.endDate,
        timezone: 'Asia/Kolkata',
      },
      provenanceDisclosure:
        'Current intervention records are modelled operational control entries derived from ROOMWISE room appliance ratings and control rules; physical hardware metering is not connected.',
      summary,
      records,
      filterOptions: {
        buildings,
        rooms,
        triggers: [
          'pir_vacancy',
          'ambient_light',
          'thermal_comfort',
          'schedule',
          'manual_override',
          'audit_remediation',
        ],
        circuitTypes: ['lights', 'fan', 'ac', 'projector', 'equipment', 'room_combined'],
        statuses: ['completed', 'active', 'cancelled', 'unresolved'],
        sources: ['simulated', 'hardware_telemetry', 'meter_data'],
        verificationStatuses: ['estimated', 'meter_backed', 'meter_verified'],
      },
    };
  }

  public getInterventionDetail(id: string): InterventionDetailResponse | null {
    const row = this.db
      .prepare('SELECT * FROM intervention_ledger_events WHERE id = ?')
      .get(id) as DbLedgerRow | undefined;
    if (!row) return null;

    const groupRows = this.db
      .prepare(
        'SELECT * FROM intervention_ledger_events WHERE event_group_id = ? ORDER BY start_ts_ms ASC, id ASC'
      )
      .all(row.event_group_id) as unknown as DbLedgerRow[];

    const groupCounts = new Map<string, number>([[row.event_group_id, groupRows.length]]);
    const record = this.rowToRecord(row, groupCounts);
    const relatedGroupEvents = groupRows
      .filter((r) => r.id !== row.id)
      .map((r) => this.rowToRecord(r, groupCounts));

    const corrRows = this.db
      .prepare(
        'SELECT * FROM intervention_ledger_corrections WHERE intervention_id = ? ORDER BY created_at_ms ASC'
      )
      .all(id) as unknown as DbCorrectionRow[];

    const corrections: InterventionCorrectionEntry[] = corrRows.map((c) => ({
      id: c.id,
      interventionId: c.intervention_id,
      createdAtMs: c.created_at_ms,
      createdAtIst: formatIstTimestampLabel(c.created_at_ms),
      actor: c.actor,
      reason: c.reason,
      previousSummary: c.previous_summary,
      newSummary: c.new_summary,
    }));

    return {
      ok: true,
      record,
      relatedGroupEvents,
      corrections,
    };
  }

  private computeSummary(records: ReadonlyArray<InterventionRecord>): InterventionLedgerSummary {
    let countedInterventions = 0;
    let overlapAdjustedCount = 0;
    let excludedOverlapCount = 0;
    let notCalculableCount = 0;
    let estimatedAvoidedWh = 0;
    let meterBackedAvoidedWh = 0;
    let meterVerifiedAvoidedWh = 0;
    let simulatedEventCount = 0;
    let hardwareEventCount = 0;
    let meterDataEventCount = 0;

    const buildingMap = new Map<
      string,
      { building: string; interventionsCount: number; estWh: number; verifiedWh: number }
    >();
    const roomMap = new Map<
      string,
      { roomId: string; roomCode: string; roomName: string; building: string; interventionsCount: number; estWh: number }
    >();

    for (const r of records) {
      if (r.source === 'simulated') simulatedEventCount++;
      else if (r.source === 'hardware_telemetry') hardwareEventCount++;
      else if (r.source === 'meter_data') meterDataEventCount++;

      if (r.overlap.status === 'counted_partial_overlap_trimmed') overlapAdjustedCount++;
      if (r.overlap.status === 'excluded_overlap_duplicate') excludedOverlapCount++;
      if (!r.energyCalculation.calculable) notCalculableCount++;

      const attrWh =
        r.overlap.countedInTotals &&
        r.energyCalculation.calculable &&
        r.energyCalculation.attributedEnergyAvoidedWh !== null
          ? r.energyCalculation.attributedEnergyAvoidedWh
          : 0;

      if (r.overlap.countedInTotals && r.energyCalculation.calculable) {
        countedInterventions++;
        if (r.verificationStatus === 'meter_verified') {
          meterVerifiedAvoidedWh += attrWh;
        } else if (r.verificationStatus === 'meter_backed') {
          meterBackedAvoidedWh += attrWh;
        } else {
          estimatedAvoidedWh += attrWh;
        }
      }

      const bEntry = buildingMap.get(r.building) ?? {
        building: r.building,
        interventionsCount: 0,
        estWh: 0,
        verifiedWh: 0,
      };
      bEntry.interventionsCount += 1;
      if (r.verificationStatus === 'meter_verified') bEntry.verifiedWh += attrWh;
      else bEntry.estWh += attrWh;
      buildingMap.set(r.building, bEntry);

      const rmEntry = roomMap.get(r.roomId) ?? {
        roomId: r.roomId,
        roomCode: r.roomCode,
        roomName: r.roomName,
        building: r.building,
        interventionsCount: 0,
        estWh: 0,
      };
      rmEntry.interventionsCount += 1;
      rmEntry.estWh += attrWh;
      roomMap.set(r.roomId, rmEntry);
    }

    return {
      totalInterventions: records.length,
      countedInterventions,
      overlapAdjustedCount,
      excludedOverlapCount,
      notCalculableCount,
      estimatedAvoidedWh: round1(estimatedAvoidedWh),
      estimatedAvoidedKwh: round3(estimatedAvoidedWh / 1000),
      meterBackedAvoidedKwh: round3(meterBackedAvoidedWh / 1000),
      meterVerifiedAvoidedKwh: round3(meterVerifiedAvoidedWh / 1000),
      simulatedEventCount,
      hardwareEventCount,
      meterDataEventCount,
      byBuilding: Array.from(buildingMap.values())
        .map((b) => ({
          building: b.building,
          interventionsCount: b.interventionsCount,
          estimatedAvoidedKwh: round3(b.estWh / 1000),
          meterVerifiedAvoidedKwh: round3(b.verifiedWh / 1000),
        }))
        .sort((a, b) => b.estimatedAvoidedKwh - a.estimatedAvoidedKwh),
      byRoom: Array.from(roomMap.values())
        .map((rm) => ({
          roomId: rm.roomId,
          roomCode: rm.roomCode,
          roomName: rm.roomName,
          building: rm.building,
          interventionsCount: rm.interventionsCount,
          estimatedAvoidedKwh: round3(rm.estWh / 1000),
        }))
        .sort((a, b) => b.estimatedAvoidedKwh - a.estimatedAvoidedKwh)
        .slice(0, 10),
    };
  }

  /**
   * Deterministic modelled dataset rooted in actual DAV Model School 25-node
   * room specs & legitimate ROOMWISE control rules. Labelled as modelled/estimated.
   */
  private seedSimulatedDemonstrationEvents(): void {
    const todayIst = getIstDateString();
    const istMs = (daysOffset: number, hour: number, minute: number): number => {
      const dateStr = shiftIstDate(todayIst, daysOffset);
      const dayStartUtc = parseIstDateToUtcMs(dateStr);
      return dayStartUtc + (hour * 60 + minute) * 60 * 1000;
    };

    const g301Spec = SPEC_BY_ROOM_ID.get('g3-301');
    const nb102Spec = SPEC_BY_ROOM_ID.get('nb-102');
    const mphSpec = SPEC_BY_ROOM_ID.get('mph-01');
    const g3g01Spec = SPEC_BY_ROOM_ID.get('g3-g01');
    const ob101Spec = SPEC_BY_ROOM_ID.get('ob-101');
    const pp01Spec = SPEC_BY_ROOM_ID.get('pp-01');

    const seeds: CreateInterventionInput[] = [
      // 1 & 2. Grouped Vacancy Auto-Shed in NB-102 (Independent Lights + Fans circuits — zero double count)
      {
        id: 'sim-intv-nb102-vac-lights',
        idempotencyKey: 'seed-sim-nb102-vac-lights-d1',
        eventGroupId: 'grp-sim-nb102-vacancy-d1',
        roomId: 'nb-102',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-1, 10, 12),
        startTsMs: istMs(-1, 10, 20),
        endTsMs: istMs(-1, 11, 50),
        triggerCategory: 'pir_vacancy',
        triggerSummary: 'PIR vacancy confirmed after 8-minute inactivity grace window',
        evidenceSummary: 'No PIR motion detected for 8 min in Class VI-B during outdoor PT period; lighting bank remained at 50% (120 W).',
        sensorSnapshot: {
          pirStatus: 'Vacancy Confirmed',
          lastMotionMinutesAgo: 8,
          naturalDaylightLux: 310,
          ambientLux: 390,
          temperatureC: 27.6,
          humidityPercent: 58,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE PIR Vacancy Auto-Shed (Grace = 8 min → 0% output on lighting circuit)',
        affectedCircuitId: 'nb-102-lights',
        affectedCircuitName: 'LED Lighting Bank (L1–L6, 240 W rated)',
        circuitType: 'lights',
        previousState: '50% AUTO (120 W)',
        newState: 'OFF (0 W)',
        actionPerformed: 'Switched off perimeter & inner LED lighting circuit on confirmed vacancy',
        actionStatus: 'completed',
        actor: 'ROOMWISE Adaptive Controller (Simulated)',
        counterfactualBaselineWatts: 120,
        postInterventionWatts: 0,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Assumes lighting bank would have remained at pre-intervention 50% (120 W) during the 90-minute unoccupied period without PIR auto-shed.',
        assumptions: [
          `Lighting nameplate rating from ROOM_APPLIANCE_SPECS: ${nb102Spec?.lights.totalWatts ?? 240} W (6 LED fixtures).`,
          'Counterfactual assumes manual switch-off would not occur until next scheduled class at 11:50 IST.',
          'Grouped under grp-sim-nb102-vacancy-d1; fans attributed separately on independent circuit.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (nb-102 lights)',
      },
      {
        id: 'sim-intv-nb102-vac-fans',
        idempotencyKey: 'seed-sim-nb102-vac-fans-d1',
        eventGroupId: 'grp-sim-nb102-vacancy-d1',
        parentEventId: 'sim-intv-nb102-vac-lights',
        roomId: 'nb-102',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-1, 10, 12),
        startTsMs: istMs(-1, 10, 20),
        endTsMs: istMs(-1, 11, 50),
        triggerCategory: 'pir_vacancy',
        triggerSummary: 'PIR vacancy confirmed — companion BLDC fan circuit shed',
        evidenceSummary: 'Same vacancy trigger in Class VI-B (NB-102); 4 BLDC fans were running at 60% speed (84 W).',
        sensorSnapshot: {
          pirStatus: 'Vacancy Confirmed',
          lastMotionMinutesAgo: 8,
          temperatureC: 27.6,
          humidityPercent: 58,
          heatIndexC: 29.1,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE PIR Vacancy Auto-Shed (Grace = 8 min → 0% output on BLDC fan sectors)',
        affectedCircuitId: 'nb-102-fans',
        affectedCircuitName: 'BLDC Ceiling Fans (S1–S4, 140 W rated)',
        circuitType: 'fan',
        previousState: '60% AUTO (84 W)',
        newState: 'OFF (0 W)',
        actionPerformed: 'Stopped all 4 BLDC fan sectors on confirmed vacancy',
        actionStatus: 'completed',
        actor: 'ROOMWISE Adaptive Controller (Simulated)',
        counterfactualBaselineWatts: 84,
        postInterventionWatts: 0,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Assumes BLDC fans would have continued at 60% (84 W) until students returned at 11:50 IST.',
        assumptions: [
          `Fan nameplate rating from ROOM_APPLIANCE_SPECS: ${nb102Spec?.fans.totalWatts ?? 140} W (4 BLDC fans).`,
          'Independently attributable fan load grouped with nb-102-lights under grp-sim-nb102-vacancy-d1.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (nb-102 fans)',
      },

      // 3. Demonstrating Anti-Double-Counting: Overlapping daylight-dimming trigger on NB-102 lights while ALREADY shed by vacancy!
      {
        id: 'sim-intv-nb102-overlap-daylight',
        idempotencyKey: 'seed-sim-nb102-overlap-daylight-d1',
        eventGroupId: 'grp-sim-nb102-vacancy-d1',
        parentEventId: 'sim-intv-nb102-vac-lights',
        roomId: 'nb-102',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-1, 10, 45),
        startTsMs: istMs(-1, 10, 45),
        endTsMs: istMs(-1, 11, 30),
        triggerCategory: 'ambient_light',
        triggerSummary: 'High natural daylight event during existing vacancy shutoff (overlap guard demonstration)',
        evidenceSummary: 'Natural daylight rose to 415 lx while NB-102 lights were already switched off by sim-intv-nb102-vac-lights.',
        sensorSnapshot: {
          pirStatus: 'Vacancy Confirmed',
          naturalDaylightLux: 415,
          ambientLux: 415,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Daylight Harvesting Rule (Superseded by active PIR vacancy shutoff)',
        affectedCircuitId: 'nb-102-lights',
        affectedCircuitName: 'LED Lighting Bank (L1–L6, 240 W rated)',
        circuitType: 'lights',
        previousState: '100% nominal ref (240 W)',
        newState: 'OFF (0 W)',
        actionPerformed: 'Daylight suppression logged while lighting circuit was already OFF',
        actionStatus: 'completed',
        actor: 'ROOMWISE Daylight Controller (Simulated)',
        counterfactualBaselineWatts: 120,
        postInterventionWatts: 0,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Overlaps 100% with sim-intv-nb102-vac-lights on nb-102-lights; automatically excluded from aggregate totals to prevent double counting.',
        assumptions: [
          'Retained in ledger for complete trigger auditability.',
          'Anti-double-counting engine sets attributed duration to 0 h because nb-102-lights is already counted for 10:20–11:50 IST.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (nb-102 lights)',
      },

      // 4. Daylight Harvesting LED Dimming in G3-G01
      {
        id: 'sim-intv-g3g01-daylight',
        idempotencyKey: 'seed-sim-g3g01-daylight-d1',
        eventGroupId: 'grp-sim-g3g01-daylight-d1',
        roomId: 'g3-g01',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-1, 9, 30),
        startTsMs: istMs(-1, 9, 30),
        endTsMs: istMs(-1, 12, 30),
        triggerCategory: 'ambient_light',
        triggerSummary: 'Natural window daylight exceeded 340 lx — perimeter LED dimming applied',
        evidenceSummary: 'LDR reading 360 lx with calibrated α = 0.72 delivered ~259 lx on student desks; LED array trimmed from 100% (240 W) to 45% (108 W).',
        sensorSnapshot: {
          pirStatus: 'Motion Active',
          lastMotionMinutesAgo: 0,
          naturalDaylightLux: 360,
          ambientLux: 325,
          temperatureC: 28.2,
          humidityPercent: 56,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Closed-Loop Daylight Harvesting (Target = 300 lx desk illuminance)',
        affectedCircuitId: 'g3-g01-lights',
        affectedCircuitName: 'LED Lighting Array (L1–L6, 240 W rated)',
        circuitType: 'lights',
        previousState: '100% (240 W)',
        newState: '45% AUTO (108 W)',
        actionPerformed: 'Dimmed LED array from 100% to 45% to maintain 300 lx target',
        actionStatus: 'completed',
        actor: 'ROOMWISE Adaptive Controller (Simulated)',
        counterfactualBaselineWatts: g3g01Spec?.lights.totalWatts ?? 240,
        postInterventionWatts: 108,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Compares dimmed operating draw (108 W) against pre-dimming 100% ON state (240 W) over the 3.0-hour high-daylight morning window.',
        assumptions: [
          'Assumes non-dimmable classroom lights would otherwise remain 100% ON during occupied morning periods.',
          'Desk illuminance maintained ≥ 300 lx using calibrated daylight penetration α.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (g3-g01 lights)',
      },

      // 5. Designated AC Setpoint/Load Trim in G3-301 Computer Lab (ONLY AC-equipped space)
      {
        id: 'sim-intv-g3301-ac-trim',
        idempotencyKey: 'seed-sim-g3301-ac-trim-d2',
        eventGroupId: 'grp-sim-g3301-thermal-d2',
        roomId: 'g3-301',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-2, 11, 15),
        startTsMs: istMs(-2, 11, 15),
        endTsMs: istMs(-2, 13, 15),
        triggerCategory: 'thermal_comfort',
        triggerSummary: 'Computer Lab AC compressor modulation + BLDC airflow balance',
        evidenceSummary: 'Designated AC space (G3-301) heat index stabilized at 25.4°C; inverter AC modulated from 72% (1728 W) to 52% (1248 W) with BLDC fans assisting air distribution.',
        sensorSnapshot: {
          pirStatus: 'Motion Active',
          lastMotionMinutesAgo: 1,
          temperatureC: 24.8,
          humidityPercent: 52,
          heatIndexC: 25.4,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Designated AC Thermal Envelope Rule (G3-301 Computer Lab only)',
        affectedCircuitId: 'g3301-ac',
        affectedCircuitName: 'Inverter Climate Unit (2x 2.0 TR, 2400 W rated)',
        circuitType: 'ac',
        previousState: '72% AUTO (1728 W)',
        newState: '52% AUTO (1248 W)',
        actionPerformed: 'Modulated inverter AC output from 72% to 52% during occupied ICT batches',
        actionStatus: 'completed',
        actor: 'ROOMWISE Adaptive Controller (Simulated)',
        counterfactualBaselineWatts: 1728,
        postInterventionWatts: 1248,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Compares modulated inverter draw (1248 W) against prior steady-state cooling draw (1728 W) across 2.0 hours of scheduled ICT classes.',
        assumptions: [
          `G3-301 is the sole designated AC room in the 25-node inventory (${g301Spec?.aux?.powerRatingWatts ?? 2400} W rated).`,
          'Estimated power draw uses proportional inverter duty model (not sub-metered compressor telemetry).',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (g3-301 aux)',
      },

      // 6. Multipurpose Hall Intermittent Post-Assembly Auto-Shed (Lights + Fans + AV)
      {
        id: 'sim-intv-mph01-post-assembly-lights',
        idempotencyKey: 'seed-sim-mph01-assembly-lights-d2',
        eventGroupId: 'grp-sim-mph01-assembly-d2',
        roomId: 'mph-01',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-2, 8, 45),
        startTsMs: istMs(-2, 8, 55),
        endTsMs: istMs(-2, 13, 55),
        triggerCategory: 'schedule',
        triggerSummary: 'Post-assembly MPH vacancy shutoff — auditorium lighting bank',
        evidenceSummary: 'Morning assembly ended at 08:45 IST; PIR confirmed empty Multipurpose Hall after 10 min grace window.',
        sensorSnapshot: {
          pirStatus: 'Vacancy Confirmed',
          lastMotionMinutesAgo: 10,
          naturalDaylightLux: 185,
          ambientLux: 185,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Intermittent Hall Vacancy Shutoff (MPH-01)',
        affectedCircuitId: 'mph-01-lights',
        affectedCircuitName: 'Auditorium LED Fixtures (L1–L16, 640 W rated)',
        circuitType: 'lights',
        previousState: '75% (480 W)',
        newState: 'OFF (0 W)',
        actionPerformed: 'Powered off all 16 auditorium lighting fixtures after morning assembly',
        actionStatus: 'completed',
        actor: 'ROOMWISE Schedule & PIR Guard (Simulated)',
        counterfactualBaselineWatts: 480,
        postInterventionWatts: 0,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Estimates avoided energy if MPH lighting had been left on at 75% (480 W) until afternoon dispersal (5.0 h).',
        assumptions: [
          `MPH lighting rated capacity: ${mphSpec?.lights.totalWatts ?? 640} W.`,
          'Intermittent auditorium usage — fans and AV array tracked on separate circuits in same group.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (mph-01 lights)',
      },
      {
        id: 'sim-intv-mph01-post-assembly-fans',
        idempotencyKey: 'seed-sim-mph01-assembly-fans-d2',
        eventGroupId: 'grp-sim-mph01-assembly-d2',
        parentEventId: 'sim-intv-mph01-post-assembly-lights',
        roomId: 'mph-01',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-2, 8, 45),
        startTsMs: istMs(-2, 8, 55),
        endTsMs: istMs(-2, 13, 55),
        triggerCategory: 'schedule',
        triggerSummary: 'Post-assembly MPH vacancy shutoff — auditorium BLDC fans',
        evidenceSummary: 'Companion fan shutdown in Multipurpose Hall after assembly dispersal.',
        sensorSnapshot: {
          pirStatus: 'Vacancy Confirmed',
          lastMotionMinutesAgo: 10,
          temperatureC: 28.8,
          humidityPercent: 60,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Intermittent Hall Vacancy Shutoff (MPH-01)',
        affectedCircuitId: 'mph-01-fans',
        affectedCircuitName: 'Auditorium BLDC Fans (S1–S8, 320 W rated)',
        circuitType: 'fan',
        previousState: '60% (192 W)',
        newState: 'OFF (0 W)',
        actionPerformed: 'Stopped all 8 auditorium fan sectors after morning assembly',
        actionStatus: 'completed',
        actor: 'ROOMWISE Schedule & PIR Guard (Simulated)',
        counterfactualBaselineWatts: 192,
        postInterventionWatts: 0,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Estimates avoided energy if auditorium fans had continued at 60% (192 W) for 5.0 unoccupied hours.',
        assumptions: [
          `MPH fan rated capacity: ${mphSpec?.fans.totalWatts ?? 320} W.`,
          'Independent circuit from mph-01-lights under grp-sim-mph01-assembly-d2.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (mph-01 fans)',
      },

      // 7. Old Building Adaptive BLDC Fan Speed Step-Down on Cooler Morning
      {
        id: 'sim-intv-ob101-fan-thermal',
        idempotencyKey: 'seed-sim-ob101-fan-thermal-d3',
        eventGroupId: 'grp-sim-ob101-thermal-d3',
        roomId: 'ob-101',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-3, 8, 10),
        startTsMs: istMs(-3, 8, 10),
        endTsMs: istMs(-3, 10, 40),
        triggerCategory: 'thermal_comfort',
        triggerSummary: 'Morning indoor heat index < 27.5°C — BLDC fan speed reduced',
        evidenceSummary: 'OB-101 indoor DHT11 read 25.9°C / 55% RH (HI 26.8°C); fans stepped down from 80% (112 W) to 40% (56 W).',
        sensorSnapshot: {
          pirStatus: 'Motion Active',
          temperatureC: 25.9,
          humidityPercent: 55,
          heatIndexC: 26.8,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Adaptive Thermal Comfort Curve (HI < 28°C → 40% BLDC fan target)',
        affectedCircuitId: 'ob-101-fans',
        affectedCircuitName: 'BLDC Ceiling Fans (S1–S4, 140 W rated)',
        circuitType: 'fan',
        previousState: '80% (112 W)',
        newState: '40% AUTO (56 W)',
        actionPerformed: 'Reduced BLDC fan sectors from 80% to 40% while maintaining airflow comfort',
        actionStatus: 'completed',
        actor: 'ROOMWISE Adaptive Controller (Simulated)',
        counterfactualBaselineWatts: 112,
        postInterventionWatts: 56,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Compares 40% adaptive draw (56 W) against previous 80% setting (112 W) over 2.5 morning hours.',
        assumptions: [
          `OB-101 fan rated power: ${ob101Spec?.fans.totalWatts ?? 140} W.`,
          'Non-AC classroom; comfort governed solely by BLDC fan modulation and cross-ventilation.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (ob-101 fans)',
      },

      // 8. Pre-Primary Early Dismissal Schedule Cut-Off (12:30 IST)
      {
        id: 'sim-intv-pp01-dismissal',
        idempotencyKey: 'seed-sim-pp01-dismissal-d3',
        eventGroupId: 'grp-sim-pp01-dismissal-d3',
        roomId: 'pp-01',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(-3, 12, 35),
        startTsMs: istMs(-3, 12, 43),
        endTsMs: istMs(-3, 14, 30),
        triggerCategory: 'schedule',
        triggerSummary: 'Pre-Primary early dismissal (12:30 IST) — classroom lighting auto-shed',
        evidenceSummary: 'PP-01 Nursery Wing dismissed at 12:30 IST; PIR confirmed empty after 8 min grace while LED array remained at 100% (160 W).',
        sensorSnapshot: {
          pirStatus: 'Vacancy Confirmed',
          lastMotionMinutesAgo: 8,
          naturalDaylightLux: 295,
          ambientLux: 295,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Pre-Primary Dismissal + PIR Vacancy Cut-Off',
        affectedCircuitId: 'pp-01-lights',
        affectedCircuitName: 'LED Lighting Fixtures (L1–L4, 160 W rated)',
        circuitType: 'lights',
        previousState: '100% (160 W)',
        newState: 'OFF (0 W)',
        actionPerformed: 'Switched off Pre-Primary Nursery lights after early dismissal',
        actionStatus: 'completed',
        actor: 'ROOMWISE Schedule & PIR Guard (Simulated)',
        counterfactualBaselineWatts: pp01Spec?.lights.totalWatts ?? 160,
        postInterventionWatts: 0,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Estimates avoided draw over 1.78 h between Pre-Primary dismissal (12:43 IST) and full-school closing (14:30 IST).',
        assumptions: [
          'Pre-Primary wing operates shorter ~08:00–12:30 schedule than senior blocks.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (pp-01 lights)',
      },

      // 9. Active / Ongoing Intervention (Missing End Timestamp -> Explicitly NOT calculable, zero fabricated savings!)
      {
        id: 'sim-intv-g3201-active-open',
        idempotencyKey: 'seed-sim-g3201-active-open-d0',
        eventGroupId: 'grp-sim-g3201-daylight-d0',
        roomId: 'g3-201',
        source: 'simulated',
        isDemonstrationData: true,
        triggerTsMs: istMs(0, 9, 45),
        startTsMs: istMs(0, 9, 45),
        endTsMs: null,
        triggerCategory: 'ambient_light',
        triggerSummary: 'Active daylight-dimming intervention in Physics Lab (in progress)',
        evidenceSummary: 'Perimeter window lux rose above 350 lx in G3-201; LED bank dimmed to 60%. Duration open until lighting state changes.',
        sensorSnapshot: {
          pirStatus: 'Motion Active',
          naturalDaylightLux: 355,
          ambientLux: 410,
          temperatureC: 28.4,
          humidityPercent: 57,
          dataOrigin: 'simulated_node',
        },
        ruleLogic: 'ROOMWISE Closed-Loop Daylight Harvesting (Lab Target = 400 lx)',
        affectedCircuitId: 'g3-201-lights',
        affectedCircuitName: 'Lab LED Array (L1–L8, 320 W rated)',
        circuitType: 'lights',
        previousState: '100% (320 W)',
        newState: '60% AUTO (192 W)',
        actionPerformed: 'Dimmed Physics Lab LED fixtures from 100% to 60% (ongoing)',
        actionStatus: 'active',
        actor: 'ROOMWISE Adaptive Controller (Simulated)',
        counterfactualBaselineWatts: 320,
        postInterventionWatts: 192,
        baselineMethod: 'previous_state_power',
        baselineExplanation: 'Counterfactual power difference is 128 W, but intervention is still active with no completed end timestamp; avoided kWh is withheld until completion.',
        assumptions: [
          'Open/active interventions are never assigned fabricated durations or premature avoided-kWh totals.',
        ],
        loadRatingSource: 'ROOM_APPLIANCE_SPECS (g3-201 lights)',
      },
    ];

    for (const seed of seeds) {
      this.recordIntervention(seed);
    }
  }
}

export const interventionLedgerService = new InterventionLedgerService();
