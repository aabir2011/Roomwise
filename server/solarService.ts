/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  isSqliteCorruptionError,
  openResilientDatabase,
  resetAndReopenDatabase,
} from './sqliteResilience.ts';
import type { SchoolSettings } from '../src/types/energy.ts';
import {
  DEFAULT_SOLAR_ASSUMPTIONS,
  SOLAR_PLANNING_SCENARIOS,
  type BuildingDataConfidence,
  type BuildingPolygon,
  type BuildingPvgisResult,
  type BuildingSelectionStatus,
  type BuildingSolarOverride,
  type BuildingSourceKind,
  type CampusDemandComparison,
  type CampusFeatureKind,
  type CampusMonthlySolarPoint,
  type CampusSolarSummary,
  type DiscoveredBuilding,
  type DiscoveryCacheMeta,
  type GeoPoint,
  type GridFeasibilityItem,
  type MonthlyDemandVsSolarPoint,
  type PvgisHistoryRecord,
  type PvgisMonthlyPoint,
  type PvgisMountingPlace,
  type PvgisRadiationDatabaseChoice,
  type PvgisTechnology,
  type RoofMetadataStatus,
  type RoomwiseDemandBenchmark,
  type ShortTermSkyContext,
  type SolarAssumptions,
  type SolarEstimateProvenance,
  type SolarPlanningScenarioId,
  type SolarScenarioComparisonRow,
  type SolarWorkspaceResponse,
} from '../src/types/solar.ts';
import { INITIAL_CLASSROOMS } from '../src/data/initialClassrooms.ts';
import { ROOM_APPLIANCE_SPECS } from '../src/data/roomApplianceSpecs.ts';
import {
  m2ToFt2,
  OB_NB_COMBINED_MEASUREMENT,
  type AuthoritativeCampusFeatureRecord,
  type MeasurementProvenanceLabel,
} from '../src/data/campusBuildingMeasurements.ts';
import { getIstDateString, shiftIstDate } from '../src/utils/historyDates.ts';
import { energyHistoryService } from './energyHistoryService.ts';
import { environmentalService } from './environmentalService.ts';
import {
  computePolygonsAreaM2,
  computePolygonsCentroid,
  discoverBuildingsViaOverpass,
  haversineDistanceMeters,
  parseOsmRoofDirectionToPvgisAspect,
  type OverpassDiscoveryPayload,
} from './overpassService.ts';
import {
  buildReconstructedCampusOverlay,
  buildReconstructedCampusStructures,
  shiftPolygonsByMeters,
} from './campusReconstruction.ts';

const PVGIS_BASE_URL = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
const PVGIS_TIMEOUT_MS = 22_000;
const OVERPASS_CACHE_TTL_DAYS = 30;
const OVERPASS_CACHE_TTL_MS = OVERPASS_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

const SOLAR_DB_PATH = path.resolve(process.cwd(), '.roomwise-solar.db');

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const PRELIMINARY_MONTHLY_WEIGHTS = [
  0.078, 0.084, 0.102, 0.104, 0.101, 0.072,
  0.064, 0.067, 0.072, 0.088, 0.086, 0.082,
];

function formatIstTimestamp(ms: number): string {
  const ist = new Date(ms + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm} IST`;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sha256Short(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function parseNumericTag(raw: string | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[^\d.\-+]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function getRoomwiseBuildingStats(linkedBuildingName: string | null): {
  roomCount: number;
  ratedCapacityWatts: number;
} {
  if (!linkedBuildingName) {
    return { roomCount: 0, ratedCapacityWatts: 0 };
  }
  const specMap = new Map(ROOM_APPLIANCE_SPECS.map((s) => [s.roomId, s]));
  const matchingRooms = INITIAL_CLASSROOMS.filter((r) => r.building === linkedBuildingName);

  let ratedWatts = 0;
  for (const room of matchingRooms) {
    const spec = specMap.get(room.id);
    if (spec) {
      ratedWatts +=
        spec.lights.totalWatts + spec.fans.totalWatts + (spec.aux?.powerRatingWatts ?? 0);
    } else if (typeof room.ratedPowerWatts === 'number') {
      ratedWatts += room.ratedPowerWatts;
    }
  }

  return {
    roomCount: matchingRooms.length,
    ratedCapacityWatts: Math.round(ratedWatts),
  };
}

function inferPlanningScenarioId(
  usableRoofFractionPercent: number,
  packingFactorPercent: number
): SolarPlanningScenarioId {
  for (const preset of Object.values(SOLAR_PLANNING_SCENARIOS)) {
    if (
      Math.abs(usableRoofFractionPercent - preset.usableRoofFractionPercent) < 0.2 &&
      Math.abs(packingFactorPercent - preset.packingFactorPercent) < 0.2
    ) {
      return preset.id;
    }
  }
  return 'custom';
}

function buildGridFeasibilityChecklist(
  assumptions: SolarAssumptions,
  combinedCapacityKwp: number
): GridFeasibilityItem[] {
  return [
    {
      id: 'sanctioned-load',
      label: 'Sanctioned Load / Contract Demand',
      status: 'unknown_pending_verification',
      valueLabel: 'Unknown — Pending Electricity Bill',
      note: 'Grid-connected rooftop PV in West Bengal is typically capped relative to sanctioned contract demand (kVA/kW). Verify against the school’s actual WBSEDCL / IIT Kharagpur utility bill.',
    },
    {
      id: 'transformer-interconnection',
      label: 'Transformer & LT/HT Interconnection Limit',
      status: 'unknown_pending_verification',
      valueLabel: 'Unknown — Pending Electrical Audit',
      note: `Physical rooftop array (${combinedCapacityKwp} kWp DC) does not imply distribution transformer headroom or feeder export permission. Campus HT/LT switchgear review is required.`,
    },
    {
      id: 'inverter-dc-ac',
      label: 'Inverter Sizing & DC/AC Ratio',
      status: 'modelled_assumption',
      valueLabel: 'Not Yet Engineered (Typ. 1.10–1.25 DC/AC)',
      note: 'PVGIS 5.3 models DC peak power with 14% aggregate system losses; actual inverter clipping, string sizing, and MPPT voltage windows require detailed EPC design.',
    },
    {
      id: 'discom-net-metering',
      label: 'WBSEDCL / WBERC Net-Metering / Net-Billing Policy',
      status: 'unknown_pending_verification',
      valueLabel: 'Unknown — Regulatory Approval Required',
      note: 'Surplus weekend/vacation export credit depends on prevailing WBERC rooftop solar regulations (net-metering vs gross/net-billing caps and institutional eligibility).',
    },
    {
      id: 'structural-roof-audit',
      label: 'Structural RCC Roof Load & Mounting Audit',
      status: 'unknown_pending_verification',
      valueLabel: 'Unverified — Civil Inspection Required',
      note: `Assumes ${
        assumptions.mountingPlace === 'free'
          ? 'elevated / ballasted open-rack mounting (ventilated)'
          : 'flush building-integrated mounting'
      } at ${assumptions.flatRoofTiltDegrees}° tilt. Structural dead/wind-load capacity and waterproofing must be verified on-site, especially on Old Building & MPH.`,
    },
  ];
}

function sanitizeAssumptions(raw: Partial<SolarAssumptions> | null | undefined): SolarAssumptions {
  const base = { ...DEFAULT_SOLAR_ASSUMPTIONS };
  if (!raw || typeof raw !== 'object') return base;

  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(parsed, min, max);
  };

  const validTech: PvgisTechnology[] = ['crystSi', 'CIS', 'CdTe', 'Unknown'];
  const validMount: PvgisMountingPlace[] = ['building', 'free'];
  const validDb: PvgisRadiationDatabaseChoice[] = ['PVGIS-SARAH3', 'PVGIS-ERA5', 'auto'];

  // If caller explicitly passed a preset scenario without custom fractions, apply preset fractions
  let usableRaw = raw.usableRoofFractionPercent;
  let packingRaw = raw.packingFactorPercent;
  if (
    raw.planningScenario &&
    raw.planningScenario !== 'custom' &&
    raw.planningScenario in SOLAR_PLANNING_SCENARIOS
  ) {
    const preset = SOLAR_PLANNING_SCENARIOS[raw.planningScenario];
    if (usableRaw === undefined) usableRaw = preset.usableRoofFractionPercent;
    if (packingRaw === undefined) packingRaw = preset.packingFactorPercent;
  }

  const usableRoofFractionPercent = round1(
    num(usableRaw, base.usableRoofFractionPercent, 10, 100)
  );
  const packingFactorPercent = round1(num(packingRaw, base.packingFactorPercent, 30, 100));

  return {
    searchRadiusMeters: Math.round(num(raw.searchRadiusMeters, base.searchRadiusMeters, 100, 2000)),
    planningScenario: inferPlanningScenarioId(usableRoofFractionPercent, packingFactorPercent),
    usableRoofFractionPercent,
    panelRatedWatts: Math.round(num(raw.panelRatedWatts, base.panelRatedWatts, 100, 1000)),
    panelAreaM2: round2(num(raw.panelAreaM2, base.panelAreaM2, 0.5, 5)),
    packingFactorPercent,
    systemLossesPercent: round1(num(raw.systemLossesPercent, base.systemLossesPercent, 0, 50)),
    flatRoofTiltDegrees: Math.round(num(raw.flatRoofTiltDegrees, base.flatRoofTiltDegrees, 0, 90)),
    flatRoofAspectDegrees: Math.round(
      num(raw.flatRoofAspectDegrees, base.flatRoofAspectDegrees, -180, 180)
    ),
    pvTechnology: validTech.includes(raw.pvTechnology as PvgisTechnology)
      ? (raw.pvTechnology as PvgisTechnology)
      : base.pvTechnology,
    mountingPlace: validMount.includes(raw.mountingPlace as PvgisMountingPlace)
      ? (raw.mountingPlace as PvgisMountingPlace)
      : base.mountingPlace,
    radiationDatabase: validDb.includes(raw.radiationDatabase as PvgisRadiationDatabaseChoice)
      ? (raw.radiationDatabase as PvgisRadiationDatabaseChoice)
      : base.radiationDatabase,
    provisionalFallbackRoofAreaM2: Math.round(
      num(raw.provisionalFallbackRoofAreaM2, base.provisionalFallbackRoofAreaM2, 50, 10000)
    ),
    currency: 'INR',
    updatedAtMs: typeof raw.updatedAtMs === 'number' ? raw.updatedAtMs : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
  };
}

interface ManualBuildingRow {
  id: string;
  name: string;
  campus_label: string | null;
  building_type: string | null;
  polygons_json: string;
  tags_json: string;
  created_at_ms: number;
  updated_at_ms: number;
  created_by: string | null;
}

class SolarService {
  private db: DatabaseSync;

  constructor() {
    this.db = openResilientDatabase(SOLAR_DB_PATH, 'solar-cache');
    try {
      this.initSchema();
    } catch (err) {
      if (!isSqliteCorruptionError(err)) throw err;
      this.db = resetAndReopenDatabase(this.db, SOLAR_DB_PATH, 'solar-cache');
      this.initSchema();
    }
  }

  private hasTableColumn(tableName: string, columnName: string): boolean {
    try {
      const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
      }>;
      return rows.some((r) => r.name === columnName);
    } catch {
      return false;
    }
  }

  private initSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');

    if (!this.hasTableColumn('pvgis_cache', 'config_hash')) {
      this.db.exec('DROP TABLE IF EXISTS pvgis_cache;');
    }
    if (!this.hasTableColumn('pvgis_history', 'scope')) {
      this.db.exec('DROP TABLE IF EXISTS pvgis_history;');
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS solar_assumptions (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        updated_by TEXT
      );

      CREATE TABLE IF NOT EXISTS overpass_cache (
        cache_key TEXT PRIMARY KEY,
        fetched_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        endpoint_used TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS building_overrides (
        building_id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        updated_by TEXT
      );

      CREATE TABLE IF NOT EXISTS manual_buildings (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        campus_label TEXT,
        building_type TEXT,
        polygons_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        created_by TEXT
      );

      CREATE TABLE IF NOT EXISTS pvgis_cache (
        config_hash TEXT PRIMARY KEY,
        building_key TEXT,
        fetched_at_ms INTEGER NOT NULL,
        result_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pvgis_history (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        target_label TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        peak_power_kwp REAL NOT NULL,
        pv_tech TEXT NOT NULL,
        mounting_place TEXT NOT NULL,
        tilt_degrees INTEGER NOT NULL,
        aspect_degrees INTEGER NOT NULL,
        loss_percent REAL NOT NULL,
        used_radiation_db TEXT NOT NULL,
        annual_generation_kwh REAL NOT NULL,
        specific_yield REAL NOT NULL,
        provenance TEXT NOT NULL
      );
    `);
  }

  // ---------------------------------------------------------------------------
  // 1. Admin-Editable Solar Assumptions (Standard Defaults)
  // ---------------------------------------------------------------------------

  getAssumptions(): SolarAssumptions {
    const row = this.db
      .prepare('SELECT json, updated_at_ms, updated_by FROM solar_assumptions WHERE id = ?')
      .get('default') as { json: string; updated_at_ms: number; updated_by: string | null } | undefined;

    if (!row) {
      return { ...DEFAULT_SOLAR_ASSUMPTIONS };
    }

    try {
      const parsed = JSON.parse(row.json);
      // One-time safe upgrade for untouched legacy system defaults (65%/80%/building -> Moderate 55%/72%/free).
      // Never overwrites administrator-saved custom assumptions.
      const isUntouchedLegacySystemRow =
        (!row.updated_by || row.updated_by === 'system') &&
        parsed?.usableRoofFractionPercent === 65 &&
        parsed?.packingFactorPercent === 80 &&
        parsed?.mountingPlace === 'building';
      if (isUntouchedLegacySystemRow) {
        return { ...DEFAULT_SOLAR_ASSUMPTIONS };
      }
      return sanitizeAssumptions({
        ...parsed,
        updatedAtMs: row.updated_at_ms,
        updatedBy: row.updated_by,
      });
    } catch {
      return { ...DEFAULT_SOLAR_ASSUMPTIONS };
    }
  }

  updateAssumptions(patch: Partial<SolarAssumptions>, actor: string): SolarAssumptions {
    const current = this.getAssumptions();
    const now = Date.now();
    const next = sanitizeAssumptions({
      ...current,
      ...patch,
      currency: 'INR',
      updatedAtMs: now,
      updatedBy: actor,
    });

    this.db
      .prepare(
        `INSERT INTO solar_assumptions (id, json, updated_at_ms, updated_by)
         VALUES ('default', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           json = excluded.json,
           updated_at_ms = excluded.updated_at_ms,
           updated_by = excluded.updated_by`
      )
      .run(JSON.stringify(next), now, actor);

    return next;
  }

  resetAssumptions(actor: string): SolarAssumptions {
    const now = Date.now();
    const next: SolarAssumptions = {
      ...DEFAULT_SOLAR_ASSUMPTIONS,
      updatedAtMs: now,
      updatedBy: actor,
    };

    this.db
      .prepare(
        `INSERT INTO solar_assumptions (id, json, updated_at_ms, updated_by)
         VALUES ('default', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           json = excluded.json,
           updated_at_ms = excluded.updated_at_ms,
           updated_by = excluded.updated_by`
      )
      .run(JSON.stringify(next), now, actor);

    return next;
  }

  // ---------------------------------------------------------------------------
  // 2. Building Overrides, Visual vs Analytical Edits & Manual Custom Buildings
  // ---------------------------------------------------------------------------

  private getAllOverrides(): Map<string, BuildingSolarOverride> {
    const rows = this.db
      .prepare('SELECT building_id, json, updated_at_ms, updated_by FROM building_overrides')
      .all() as Array<{
      building_id: string;
      json: string;
      updated_at_ms: number;
      updated_by: string | null;
    }>;

    const map = new Map<string, BuildingSolarOverride>();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.json);
        map.set(row.building_id, {
          ...parsed,
          buildingId: row.building_id,
          updatedAtMs: row.updated_at_ms,
          updatedBy: row.updated_by,
        });
      } catch {
        // Skip corrupt override row
      }
    }
    return map;
  }

  upsertBuildingOverride(
    buildingId: string,
    patch: Partial<BuildingSolarOverride>,
    actor: string
  ): BuildingSolarOverride {
    const existing = this.getAllOverrides().get(buildingId);
    const now = Date.now();

    const validStatuses: BuildingSelectionStatus[] = [
      'confirmed',
      'provisional',
      'unassigned',
      'excluded',
    ];
    const validTech: PvgisTechnology[] = ['crystSi', 'CIS', 'CdTe', 'Unknown'];
    const validMount: PvgisMountingPlace[] = ['building', 'free'];

    const optNum = (
      val: unknown,
      prev: number | null,
      min: number,
      max: number
    ): number | null => {
      if (val === undefined) return prev;
      if (val === null || val === '') return null;
      const n = Number(val);
      return Number.isFinite(n) ? clamp(n, min, max) : prev;
    };

    const optStr = (val: unknown, prev: string | null): string | null => {
      if (val === undefined) return prev;
      if (val === null) return null;
      const trimmed = String(val).trim();
      return trimmed.length > 0 ? trimmed.slice(0, 160) : null;
    };

    const defaultStatus: BuildingSelectionStatus = buildingId.startsWith('campus/')
      ? buildingId === 'campus/basketball-court' || buildingId === 'campus/football-ground'
        ? 'excluded'
        : 'provisional'
      : 'unassigned';

    const nextSelectionStatus = validStatuses.includes(
      patch.selectionStatus as BuildingSelectionStatus
    )
      ? (patch.selectionStatus as BuildingSelectionStatus)
      : existing?.selectionStatus ?? defaultStatus;

    const nextAnalyticalConfirmed =
      typeof patch.analyticalConfirmed === 'boolean'
        ? patch.analyticalConfirmed
        : patch.selectionStatus === 'confirmed'
        ? true
        : existing?.analyticalConfirmed ?? false;

    const next: BuildingSolarOverride = {
      buildingId,
      selectionStatus: nextSelectionStatus,
      customName: optStr(patch.customName, existing?.customName ?? null),
      campusLabel: optStr(patch.campusLabel, existing?.campusLabel ?? null),
      usableRoofFractionPercent: optNum(
        patch.usableRoofFractionPercent,
        existing?.usableRoofFractionPercent ?? null,
        10,
        100
      ),
      roofTypeOverride: optStr(patch.roofTypeOverride, existing?.roofTypeOverride ?? null),
      tiltDegreesOverride:
        optNum(patch.tiltDegreesOverride, existing?.tiltDegreesOverride ?? null, 0, 90) !== null
          ? Math.round(
              optNum(patch.tiltDegreesOverride, existing?.tiltDegreesOverride ?? null, 0, 90)!
            )
          : null,
      aspectDegreesOverride:
        optNum(patch.aspectDegreesOverride, existing?.aspectDegreesOverride ?? null, -180, 180) !==
        null
          ? Math.round(
              optNum(
                patch.aspectDegreesOverride,
                existing?.aspectDegreesOverride ?? null,
                -180,
                180
              )!
            )
          : null,
      mountingPlaceOverride:
        patch.mountingPlaceOverride === undefined
          ? existing?.mountingPlaceOverride ?? null
          : patch.mountingPlaceOverride === null
          ? null
          : validMount.includes(patch.mountingPlaceOverride)
          ? patch.mountingPlaceOverride
          : existing?.mountingPlaceOverride ?? null,
      pvTechnologyOverride:
        patch.pvTechnologyOverride === undefined
          ? existing?.pvTechnologyOverride ?? null
          : patch.pvTechnologyOverride === null
          ? null
          : validTech.includes(patch.pvTechnologyOverride)
          ? patch.pvTechnologyOverride
          : existing?.pvTechnologyOverride ?? null,
      systemLossesOverride: optNum(
        patch.systemLossesOverride,
        existing?.systemLossesOverride ?? null,
        0,
        50
      ),
      manualCapacityKwpOverride: optNum(
        patch.manualCapacityKwpOverride,
        existing?.manualCapacityKwpOverride ?? null,
        0.1,
        5000
      ),
      grossAreaOverrideM2: optNum(
        patch.grossAreaOverrideM2,
        existing?.grossAreaOverrideM2 ?? null,
        5,
        100000
      ),
      offsetEastMeters: optNum(
        patch.offsetEastMeters,
        existing?.offsetEastMeters ?? null,
        -150,
        150
      ),
      offsetNorthMeters: optNum(
        patch.offsetNorthMeters,
        existing?.offsetNorthMeters ?? null,
        -150,
        150
      ),
      customPolygons:
        patch.customPolygons === undefined
          ? existing?.customPolygons ?? null
          : Array.isArray(patch.customPolygons) && patch.customPolygons.length > 0
          ? patch.customPolygons
          : null,
      analyticalConfirmed: nextAnalyticalConfirmed,
      relationshipNote: optStr(patch.relationshipNote, existing?.relationshipNote ?? null),
      updatedAtMs: now,
      updatedBy: actor,
    };

    this.db
      .prepare(
        `INSERT INTO building_overrides (building_id, json, updated_at_ms, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(building_id) DO UPDATE SET
           json = excluded.json,
           updated_at_ms = excluded.updated_at_ms,
           updated_by = excluded.updated_by`
      )
      .run(buildingId, JSON.stringify(next), now, actor);

    return next;
  }

  /**
   * Restores all image-reconstructed campus structures (campus/*) back to their
   * original visual positions, boundaries, and defaults without deleting OSM cache or history.
   */
  restoreReconstructedCampus(): number {
    const res = this.db
      .prepare("DELETE FROM building_overrides WHERE building_id LIKE 'campus/%'")
      .run();
    return Number(res.changes || 0);
  }

  private getManualBuildingsRaw(campusRef: GeoPoint): Array<{
    id: string;
    name: string;
    campusLabel: string | null;
    buildingType: string | null;
    polygons: BuildingPolygon[];
    tags: Record<string, string>;
    centroid: GeoPoint;
    grossFootprintAreaM2: number;
    distanceFromCampusMeters: number;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM manual_buildings ORDER BY created_at_ms DESC')
      .all() as unknown as ManualBuildingRow[];

    const result: Array<{
      id: string;
      name: string;
      campusLabel: string | null;
      buildingType: string | null;
      polygons: BuildingPolygon[];
      tags: Record<string, string>;
      centroid: GeoPoint;
      grossFootprintAreaM2: number;
      distanceFromCampusMeters: number;
    }> = [];

    for (const row of rows) {
      try {
        const polygons: BuildingPolygon[] = JSON.parse(row.polygons_json);
        const tags: Record<string, string> = JSON.parse(row.tags_json || '{}');
        const { areaM2 } = computePolygonsAreaM2(polygons);
        const centroid = computePolygonsCentroid(polygons);
        result.push({
          id: row.id,
          name: row.name,
          campusLabel: row.campus_label,
          buildingType: row.building_type,
          polygons,
          tags,
          centroid,
          grossFootprintAreaM2: Math.max(5, areaM2),
          distanceFromCampusMeters: Math.round(haversineDistanceMeters(campusRef, centroid)),
        });
      } catch {
        // Ignore malformed row
      }
    }
    return result;
  }

  createManualBuilding(
    input: {
      name: string;
      campusLabel?: string | null;
      buildingType?: string | null;
      polygonPoints?: GeoPoint[];
      footprintAreaM2?: number;
      centroid?: GeoPoint;
    },
    campusRef: GeoPoint,
    actor: string
  ): { id: string } {
    const id = `manual/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const cleanName = String(input.name || 'Custom Campus Building').trim().slice(0, 120);

    let polygons: BuildingPolygon[] = [];
    if (Array.isArray(input.polygonPoints) && input.polygonPoints.length >= 3) {
      const validPts = input.polygonPoints
        .filter(
          (p) =>
            p &&
            typeof p.lat === 'number' &&
            typeof p.lon === 'number' &&
            Number.isFinite(p.lat) &&
            Number.isFinite(p.lon)
        )
        .map((p) => ({ lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)) }));

      if (validPts.length >= 3) {
        const closed = [...validPts];
        const first = closed[0];
        const last = closed[closed.length - 1];
        if (Math.abs(first.lat - last.lat) > 1e-6 || Math.abs(first.lon - last.lon) > 1e-6) {
          closed.push({ ...first });
        }
        polygons = [{ outer: closed }];
      }
    }

    if (polygons.length === 0) {
      const areaM2 = clamp(Number(input.footprintAreaM2) || 250, 10, 50000);
      const center = input.centroid || campusRef;
      const halfSideM = Math.sqrt(areaM2) / 2;
      const dLat = halfSideM / 110740;
      const dLon = halfSideM / (111320 * Math.cos((center.lat * Math.PI) / 180));
      polygons = [
        {
          outer: [
            { lat: center.lat - dLat, lon: center.lon - dLon },
            { lat: center.lat - dLat, lon: center.lon + dLon },
            { lat: center.lat + dLat, lon: center.lon + dLon },
            { lat: center.lat + dLat, lon: center.lon - dLon },
            { lat: center.lat - dLat, lon: center.lon - dLon },
          ],
        },
      ];
    }

    this.db
      .prepare(
        `INSERT INTO manual_buildings
         (id, name, campus_label, building_type, polygons_json, tags_json, created_at_ms, updated_at_ms, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        cleanName,
        input.campusLabel ? String(input.campusLabel).trim().slice(0, 80) : null,
        input.buildingType ? String(input.buildingType).trim().slice(0, 60) : 'school',
        JSON.stringify(polygons),
        JSON.stringify({ source: 'administrator_drawn_footprint' }),
        now,
        now,
        actor
      );

    this.upsertBuildingOverride(
      id,
      {
        selectionStatus: 'confirmed',
        analyticalConfirmed: true,
        customName: cleanName,
        campusLabel: input.campusLabel || null,
      },
      actor
    );

    return { id };
  }

  deleteManualBuilding(id: string): boolean {
    if (!id.startsWith('manual/')) return false;
    const res = this.db.prepare('DELETE FROM manual_buildings WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM building_overrides WHERE building_id = ?').run(id);
    return Number(res.changes || 0) > 0;
  }

  // ---------------------------------------------------------------------------
  // 3. OpenStreetMap Overpass Discovery with 30-Day SQLite Cache (Supplementary)
  // ---------------------------------------------------------------------------

  private buildOverpassCacheKey(lat: number, lon: number, radiusMeters: number): string {
    return `${lat.toFixed(5)}_${lon.toFixed(5)}_${Math.round(radiusMeters)}`;
  }

  async getOrDiscoverBuildings(
    settings: SchoolSettings,
    assumptions: SolarAssumptions,
    options: { forceRefresh?: boolean; allowLiveFetch?: boolean } = {}
  ): Promise<{
    payload: OverpassDiscoveryPayload | null;
    meta: DiscoveryCacheMeta;
  }> {
    const lat = settings.campusCoordinates?.latitude ?? 22.3121;
    const lon = settings.campusCoordinates?.longitude ?? 87.2994;
    const radius = assumptions.searchRadiusMeters;
    const cacheKey = this.buildOverpassCacheKey(lat, lon, radius);
    const now = Date.now();

    const cachedRow = this.db
      .prepare(
        'SELECT fetched_at_ms, expires_at_ms, endpoint_used, payload_json FROM overpass_cache WHERE cache_key = ?'
      )
      .get(cacheKey) as
      | {
          fetched_at_ms: number;
          expires_at_ms: number;
          endpoint_used: string;
          payload_json: string;
        }
      | undefined;

    let cachedPayload: OverpassDiscoveryPayload | null = null;
    if (cachedRow) {
      try {
        cachedPayload = JSON.parse(cachedRow.payload_json) as OverpassDiscoveryPayload;
      } catch {
        cachedPayload = null;
      }
    }

    const cacheFresh = Boolean(cachedRow && cachedPayload && cachedRow.expires_at_ms > now);
    if (!options.forceRefresh && cacheFresh && cachedRow && cachedPayload) {
      return {
        payload: cachedPayload,
        meta: {
          status: cachedPayload.buildings.length > 0 ? 'ok' : 'empty',
          fromCache: true,
          stale: false,
          endpointUsed: cachedRow.endpoint_used,
          searchRadiusMeters: radius,
          fetchedAtMs: cachedRow.fetched_at_ms,
          fetchedAtIst: formatIstTimestamp(cachedRow.fetched_at_ms),
          cacheTtlDays: OVERPASS_CACHE_TTL_DAYS,
          osmBuildingsCount: cachedPayload.buildings.length,
          errorMessage: null,
        },
      };
    }

    if (options.allowLiveFetch === false) {
      if (cachedPayload && cachedRow) {
        return {
          payload: cachedPayload,
          meta: {
            status: 'stale',
            fromCache: true,
            stale: true,
            endpointUsed: cachedRow.endpoint_used,
            searchRadiusMeters: radius,
            fetchedAtMs: cachedRow.fetched_at_ms,
            fetchedAtIst: formatIstTimestamp(cachedRow.fetched_at_ms),
            cacheTtlDays: OVERPASS_CACHE_TTL_DAYS,
            osmBuildingsCount: cachedPayload.buildings.length,
            errorMessage: null,
          },
        };
      }
      return {
        payload: null,
        meta: {
          status: 'empty',
          fromCache: false,
          stale: false,
          endpointUsed: null,
          searchRadiusMeters: radius,
          fetchedAtMs: null,
          fetchedAtIst: null,
          cacheTtlDays: OVERPASS_CACHE_TTL_DAYS,
          osmBuildingsCount: 0,
          errorMessage: null,
        },
      };
    }

    const live = await discoverBuildingsViaOverpass({
      latitude: lat,
      longitude: lon,
      searchRadiusMeters: radius,
    });

    if (live.ok && live.payload) {
      const expiresAt = now + OVERPASS_CACHE_TTL_MS;
      this.db
        .prepare(
          `INSERT INTO overpass_cache (cache_key, fetched_at_ms, expires_at_ms, endpoint_used, payload_json)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
             fetched_at_ms = excluded.fetched_at_ms,
             expires_at_ms = excluded.expires_at_ms,
             endpoint_used = excluded.endpoint_used,
             payload_json = excluded.payload_json`
        )
        .run(cacheKey, now, expiresAt, live.payload.endpointUsed, JSON.stringify(live.payload));

      return {
        payload: live.payload,
        meta: {
          status: live.payload.buildings.length > 0 ? 'ok' : 'empty',
          fromCache: false,
          stale: false,
          endpointUsed: live.payload.endpointUsed,
          searchRadiusMeters: radius,
          fetchedAtMs: now,
          fetchedAtIst: formatIstTimestamp(now),
          cacheTtlDays: OVERPASS_CACHE_TTL_DAYS,
          osmBuildingsCount: live.payload.buildings.length,
          errorMessage: null,
        },
      };
    }

    if (cachedPayload && cachedRow) {
      return {
        payload: cachedPayload,
        meta: {
          status: 'stale',
          fromCache: true,
          stale: true,
          endpointUsed: cachedRow.endpoint_used,
          searchRadiusMeters: radius,
          fetchedAtMs: cachedRow.fetched_at_ms,
          fetchedAtIst: formatIstTimestamp(cachedRow.fetched_at_ms),
          cacheTtlDays: OVERPASS_CACHE_TTL_DAYS,
          osmBuildingsCount: cachedPayload.buildings.length,
          errorMessage: null,
        },
      };
    }

    return {
      payload: null,
      meta: {
        status: 'unavailable',
        fromCache: false,
        stale: false,
        endpointUsed: null,
        searchRadiusMeters: radius,
        fetchedAtMs: null,
        fetchedAtIst: null,
        cacheTtlDays: OVERPASS_CACHE_TTL_DAYS,
        osmBuildingsCount: 0,
        errorMessage: null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 4. PVGIS 5.3 Calculation Engine + Persistent Input-Hash Cache + Fallback
  // ---------------------------------------------------------------------------

  private computePvgisConfigHash(params: {
    latitude: number;
    longitude: number;
    peakPowerKwp: number;
    pvTechnology: PvgisTechnology;
    mountingPlace: PvgisMountingPlace;
    tiltDegrees: number;
    aspectDegrees: number;
    systemLossesPercent: number;
    radiationDatabase: PvgisRadiationDatabaseChoice;
  }): string {
    return sha256Short(
      JSON.stringify({
        lat: Number(params.latitude.toFixed(5)),
        lon: Number(params.longitude.toFixed(5)),
        kwp: Number(params.peakPowerKwp.toFixed(3)),
        tech: params.pvTechnology,
        mount: params.mountingPlace,
        tilt: Math.round(params.tiltDegrees),
        aspect: Math.round(params.aspectDegrees),
        loss: Number(params.systemLossesPercent.toFixed(1)),
        db: params.radiationDatabase,
        horizon: 1,
      })
    );
  }

  private getCachedPvgisByHash(configHash: string): BuildingPvgisResult | null {
    const row = this.db
      .prepare('SELECT result_json FROM pvgis_cache WHERE config_hash = ?')
      .get(configHash) as { result_json: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.result_json) as BuildingPvgisResult;
      return { ...parsed, fromCache: true };
    } catch {
      return null;
    }
  }

  private getLastSuccessfulPvgisForBuilding(buildingKey: string): BuildingPvgisResult | null {
    const row = this.db
      .prepare(
        'SELECT result_json FROM pvgis_cache WHERE building_key = ? ORDER BY fetched_at_ms DESC LIMIT 1'
      )
      .get(buildingKey) as { result_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.result_json) as BuildingPvgisResult;
    } catch {
      return null;
    }
  }

  private savePvgisCache(
    configHash: string,
    buildingKey: string,
    result: BuildingPvgisResult
  ): void {
    this.db
      .prepare(
        `INSERT INTO pvgis_cache (config_hash, building_key, fetched_at_ms, result_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(config_hash) DO UPDATE SET
           building_key = excluded.building_key,
           fetched_at_ms = excluded.fetched_at_ms,
           result_json = excluded.result_json`
      )
      .run(configHash, buildingKey, result.calculatedAtMs, JSON.stringify(result));
  }

  private recordPvgisHistory(params: {
    scope: 'building' | 'campus' | 'provisional';
    targetLabel: string;
    configHash: string;
    latitude: number;
    longitude: number;
    peakPowerKwp: number;
    pvTechnology: PvgisTechnology;
    mountingPlace: PvgisMountingPlace;
    tiltDegrees: number;
    aspectDegrees: number;
    systemLossesPercent: number;
    usedRadiationDatabase: string;
    annualGenerationKwh: number;
    specificYieldKwhPerKwp: number;
    provenance: SolarEstimateProvenance;
  }): void {
    const id = `pvgis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO pvgis_history (
          id, scope, target_label, config_hash, created_at_ms,
          latitude, longitude, peak_power_kwp, pv_tech, mounting_place,
          tilt_degrees, aspect_degrees, loss_percent, used_radiation_db,
          annual_generation_kwh, specific_yield, provenance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.scope,
        params.targetLabel.slice(0, 120),
        params.configHash,
        now,
        params.latitude,
        params.longitude,
        round2(params.peakPowerKwp),
        params.pvTechnology,
        params.mountingPlace,
        Math.round(params.tiltDegrees),
        Math.round(params.aspectDegrees),
        round1(params.systemLossesPercent),
        params.usedRadiationDatabase,
        round1(params.annualGenerationKwh),
        round1(params.specificYieldKwhPerKwp),
        params.provenance
      );
  }

  getHistory(limit = 30): PvgisHistoryRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM pvgis_history ORDER BY created_at_ms DESC LIMIT ?')
      .all(clamp(Math.round(limit), 1, 100)) as Array<Record<string, any>>;

    return rows.map((r) => ({
      id: String(r.id),
      scope: r.scope as 'building' | 'campus' | 'provisional',
      targetLabel: String(r.target_label),
      configHash: String(r.config_hash),
      createdAtMs: Number(r.created_at_ms),
      createdAtIst: formatIstTimestamp(Number(r.created_at_ms)),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      peakPowerKwp: Number(r.peak_power_kwp),
      pvTech: r.pv_tech as PvgisTechnology,
      mountingPlace: r.mounting_place as PvgisMountingPlace,
      tiltDegrees: Number(r.tilt_degrees),
      aspectDegrees: Number(r.aspect_degrees),
      lossPercent: Number(r.loss_percent),
      usedRadiationDatabase: String(r.used_radiation_db),
      annualGenerationKwh: Number(r.annual_generation_kwh),
      specificYieldKwhPerKwp: Number(r.specific_yield),
      provenance: r.provenance as SolarEstimateProvenance,
    }));
  }

  private buildPreliminaryFallbackEstimate(params: {
    configHash: string;
    latitude: number;
    longitude: number;
    peakPowerKwp: number;
    tiltDegrees: number;
    aspectDegrees: number;
    pvTechnology: PvgisTechnology;
    mountingPlace: PvgisMountingPlace;
    systemLossesPercent: number;
    requestedDatabase: PvgisRadiationDatabaseChoice;
    reason: string;
  }): BuildingPvgisResult {
    const now = Date.now();
    const latFactor = clamp(1 - Math.abs(Math.abs(params.latitude) - 22) * 0.008, 0.72, 1.08);
    const lossFactor = clamp((100 - params.systemLossesPercent) / 86, 0.55, 1.12);
    const tiltDeviation = Math.abs(params.tiltDegrees - Math.min(35, Math.abs(params.latitude)));
    const tiltFactor = clamp(1 - tiltDeviation * 0.0032, 0.78, 1.03);
    const aspectFactor = clamp(1 - (Math.abs(params.aspectDegrees) / 180) * 0.16, 0.82, 1.0);

    const specificYield = round1(1380 * latFactor * lossFactor * tiltFactor * aspectFactor);
    const annualGenerationKwh = round1(params.peakPowerKwp * specificYield);

    const monthly: PvgisMonthlyPoint[] = MONTH_LABELS.map((label, idx) => {
      const mKwh = round1(annualGenerationKwh * PRELIMINARY_MONTHLY_WEIGHTS[idx]);
      return {
        month: idx + 1,
        monthLabel: label,
        dailyAvgGenerationKwh: round2(mKwh / DAYS_IN_MONTH[idx]),
        monthlyGenerationKwh: mKwh,
        dailyInPlaneIrradiationKwhM2: null,
        monthlyInPlaneIrradiationKwhM2: null,
        monthlyStdDevKwh: null,
      };
    });

    return {
      provenance: 'preliminary_local_estimate',
      provenanceLabel: 'Preliminary estimate',
      configHash: params.configHash,
      calculatedAtMs: now,
      calculatedAtIst: formatIstTimestamp(now),
      latitude: params.latitude,
      longitude: params.longitude,
      peakPowerKwp: round2(params.peakPowerKwp),
      tiltDegrees: Math.round(params.tiltDegrees),
      aspectDegrees: Math.round(params.aspectDegrees),
      pvTechnology: params.pvTechnology,
      mountingPlace: params.mountingPlace,
      systemLossesPercent: round1(params.systemLossesPercent),
      annualGenerationKwh,
      monthlyAvgGenerationKwh: round1(annualGenerationKwh / 12),
      dailyAvgGenerationKwh: round2(annualGenerationKwh / 365),
      specificYieldKwhPerKwp: specificYield,
      annualInPlaneIrradiationKwhM2: null,
      annualStdDevKwh: null,
      monthly,
      losses: {
        angleOfIncidencePercent: null,
        spectralEffectsPercent: null,
        temperatureAndLowIrradiancePercent: null,
        configuredSystemLossPercent: round1(params.systemLossesPercent),
        combinedLossPercent: null,
      },
      metadata: {
        requestedDatabase: params.requestedDatabase,
        usedRadiationDatabase: 'Pending PVGIS 5.3 run',
        fallbackNotice: params.reason,
        meteoDatabase: null,
        yearMin: null,
        yearMax: null,
        elevationMeters: null,
        horizonDatabase: null,
        useHorizon: true,
      },
      fromCache: false,
      stale: false,
      warningNote: `Preliminary estimate (${params.reason}). Run PVGIS 5.3 to calculate modelled generation.`,
    };
  }

  private async queryPvgisRaw(params: {
    latitude: number;
    longitude: number;
    peakPowerKwp: number;
    pvTechnology: PvgisTechnology;
    mountingPlace: PvgisMountingPlace;
    tiltDegrees: number;
    aspectDegrees: number;
    systemLossesPercent: number;
    radiationDatabase: 'PVGIS-SARAH3' | 'PVGIS-ERA5' | null;
  }): Promise<{ ok: boolean; status: number; data: any; errorMessage?: string }> {
    const url = new URL(PVGIS_BASE_URL);
    url.searchParams.set('lat', params.latitude.toFixed(5));
    url.searchParams.set('lon', params.longitude.toFixed(5));
    url.searchParams.set('pvcalculation', '1');
    url.searchParams.set('peakpower', Math.max(0.1, params.peakPowerKwp).toFixed(3));
    url.searchParams.set('loss', params.systemLossesPercent.toFixed(1));
    url.searchParams.set('pvtechchoice', params.pvTechnology);
    url.searchParams.set('mountingplace', params.mountingPlace);
    url.searchParams.set('angle', String(Math.round(params.tiltDegrees)));
    url.searchParams.set('aspect', String(Math.round(params.aspectDegrees)));
    url.searchParams.set('usehorizon', '1');
    url.searchParams.set('outputformat', 'json');
    if (params.radiationDatabase) {
      url.searchParams.set('raddatabase', params.radiationDatabase);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ROOMWISE-Campus-Energy-Monitor/1.0',
        },
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok || !parsed?.outputs?.totals?.fixed) {
        const msg =
          parsed?.message ||
          (res.status === 400
            ? 'PVGIS rejected parameters or radiation database spatial coverage.'
            : `PVGIS returned HTTP ${res.status}.`);
        return { ok: false, status: res.status, data: parsed, errorMessage: msg };
      }

      return { ok: true, status: res.status, data: parsed };
    } catch (err: any) {
      return {
        ok: false,
        status: 0,
        data: null,
        errorMessage:
          err?.name === 'AbortError'
            ? 'European Commission PVGIS request timed out.'
            : err?.message || 'Network error reaching PVGIS 5.3.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async calculatePvgis(params: {
    buildingKey: string;
    latitude: number;
    longitude: number;
    peakPowerKwp: number;
    pvTechnology: PvgisTechnology;
    mountingPlace: PvgisMountingPlace;
    tiltDegrees: number;
    aspectDegrees: number;
    systemLossesPercent: number;
    radiationDatabase: PvgisRadiationDatabaseChoice;
    forceRefresh?: boolean;
  }): Promise<BuildingPvgisResult> {
    const safeKwp = Math.max(0.1, round2(params.peakPowerKwp));
    const configHash = this.computePvgisConfigHash({
      ...params,
      peakPowerKwp: safeKwp,
    });

    if (!params.forceRefresh) {
      const cached = this.getCachedPvgisByHash(configHash);
      if (cached) {
        return cached;
      }
    }

    const initialDb: 'PVGIS-SARAH3' | 'PVGIS-ERA5' | null =
      params.radiationDatabase === 'auto' ? null : params.radiationDatabase;

    let fallbackNotice: string | null = null;
    let res = await this.queryPvgisRaw({
      ...params,
      peakPowerKwp: safeKwp,
      radiationDatabase: initialDb,
    });

    if (!res.ok && res.status === 400 && initialDb === 'PVGIS-SARAH3') {
      fallbackNotice =
        'PVGIS-SARAH3 does not cover this longitude; automatically fell back to PVGIS-ERA5 reanalysis database.';
      res = await this.queryPvgisRaw({
        ...params,
        peakPowerKwp: safeKwp,
        radiationDatabase: 'PVGIS-ERA5',
      });
    }

    if (!res.ok || !res.data) {
      const lastSuccess = this.getLastSuccessfulPvgisForBuilding(params.buildingKey);
      if (lastSuccess) {
        return {
          ...lastSuccess,
          provenance: 'pvgis_cached_last_successful',
          provenanceLabel: 'Last successful calculation',
          fromCache: true,
          stale: true,
          warningNote: `PVGIS live request failed (${res.errorMessage || 'service unavailable'}). Showing last successful PVGIS calculation from ${lastSuccess.calculatedAtIst}.`,
        };
      }

      return this.buildPreliminaryFallbackEstimate({
        configHash,
        latitude: params.latitude,
        longitude: params.longitude,
        peakPowerKwp: safeKwp,
        tiltDegrees: params.tiltDegrees,
        aspectDegrees: params.aspectDegrees,
        pvTechnology: params.pvTechnology,
        mountingPlace: params.mountingPlace,
        systemLossesPercent: params.systemLossesPercent,
        requestedDatabase: params.radiationDatabase,
        reason: res.errorMessage || 'PVGIS 5.3 endpoint unreachable',
      });
    }

    const data = res.data;
    const fixedTotals = data.outputs.totals.fixed;
    const fixedMonthly: any[] = Array.isArray(data.outputs.monthly?.fixed)
      ? data.outputs.monthly.fixed
      : [];

    const now = Date.now();
    const annualGenerationKwh = round1(Number(fixedTotals.E_y || 0));
    const monthlyAvgGenerationKwh = round1(Number(fixedTotals.E_m || annualGenerationKwh / 12));
    const dailyAvgGenerationKwh = round2(Number(fixedTotals.E_d || annualGenerationKwh / 365));
    const specificYieldKwhPerKwp = safeKwp > 0 ? round1(annualGenerationKwh / safeKwp) : 0;

    const monthly: PvgisMonthlyPoint[] = MONTH_LABELS.map((label, idx) => {
      const mRow = fixedMonthly.find((m) => Number(m.month) === idx + 1);
      return {
        month: idx + 1,
        monthLabel: label,
        dailyAvgGenerationKwh: round2(Number(mRow?.E_d ?? dailyAvgGenerationKwh)),
        monthlyGenerationKwh: round1(Number(mRow?.E_m ?? monthlyAvgGenerationKwh)),
        dailyInPlaneIrradiationKwhM2:
          typeof mRow?.['H(i)_d'] === 'number' ? round2(mRow['H(i)_d']) : null,
        monthlyInPlaneIrradiationKwhM2:
          typeof mRow?.['H(i)_m'] === 'number' ? round1(mRow['H(i)_m']) : null,
        monthlyStdDevKwh: typeof mRow?.SD_m === 'number' ? round1(mRow.SD_m) : null,
      };
    });

    const usedDb =
      data.inputs?.meteo_data?.radiation_db ||
      (fallbackNotice ? 'PVGIS-ERA5' : initialDb || 'PVGIS-ERA5');

    const result: BuildingPvgisResult = {
      provenance: 'pvgis_modelled',
      provenanceLabel: 'Modelled by PVGIS',
      configHash,
      calculatedAtMs: now,
      calculatedAtIst: formatIstTimestamp(now),
      latitude: params.latitude,
      longitude: params.longitude,
      peakPowerKwp: safeKwp,
      tiltDegrees: Math.round(params.tiltDegrees),
      aspectDegrees: Math.round(params.aspectDegrees),
      pvTechnology: params.pvTechnology,
      mountingPlace: params.mountingPlace,
      systemLossesPercent: round1(params.systemLossesPercent),
      annualGenerationKwh,
      monthlyAvgGenerationKwh,
      dailyAvgGenerationKwh,
      specificYieldKwhPerKwp,
      annualInPlaneIrradiationKwhM2:
        typeof fixedTotals['H(i)_y'] === 'number' ? round1(fixedTotals['H(i)_y']) : null,
      annualStdDevKwh: typeof fixedTotals.SD_y === 'number' ? round1(fixedTotals.SD_y) : null,
      monthly,
      losses: {
        angleOfIncidencePercent:
          typeof fixedTotals.l_aoi === 'number' ? round2(fixedTotals.l_aoi) : null,
        spectralEffectsPercent:
          typeof fixedTotals.l_spec === 'number' ? round2(fixedTotals.l_spec) : null,
        temperatureAndLowIrradiancePercent:
          typeof fixedTotals.l_tg === 'number' ? round2(fixedTotals.l_tg) : null,
        configuredSystemLossPercent: round1(params.systemLossesPercent),
        combinedLossPercent:
          typeof fixedTotals.l_total === 'number' ? round2(fixedTotals.l_total) : null,
      },
      metadata: {
        requestedDatabase: params.radiationDatabase,
        usedRadiationDatabase: String(usedDb),
        fallbackNotice,
        meteoDatabase: data.inputs?.meteo_data?.meteo_db || null,
        yearMin:
          typeof data.inputs?.meteo_data?.year_min === 'number'
            ? data.inputs.meteo_data.year_min
            : null,
        yearMax:
          typeof data.inputs?.meteo_data?.year_max === 'number'
            ? data.inputs.meteo_data.year_max
            : null,
        elevationMeters:
          typeof data.inputs?.location?.elevation === 'number'
            ? Math.round(data.inputs.location.elevation)
            : null,
        horizonDatabase: data.inputs?.meteo_data?.horizon_db || null,
        useHorizon: true,
      },
      fromCache: false,
      stale: false,
      warningNote: fallbackNotice,
    };

    this.savePvgisCache(configHash, params.buildingKey, result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // 5. Building Enrichment (Visual vs Analytical Separation, Roof & PV Sizing)
  // ---------------------------------------------------------------------------

  private computeRoofAndCapacityForBuilding(
    raw: {
      id: string;
      source: BuildingSourceKind;
      featureKind: CampusFeatureKind;
      solarEligible: boolean;
      osmType: 'way' | 'relation' | 'manual' | 'reconstructed';
      osmId: string;
      osmName: string | null;
      shortLabel?: string;
      defaultCampusLabel?: string | null;
      buildingType: string | null;
      levels: number | null;
      heightMeters: number | null;
      parentBuildingId?: string | null;
      relationshipNote?: string | null;
      linkedRoomwiseBuilding?: string | null;
      defaultRoofType?: string | null;
      visualMeta?: DiscoveredBuilding['visualMeta'];
      tags: Record<string, string>;
      polygons: BuildingPolygon[];
      centroid: GeoPoint;
      grossFootprintAreaM2: number;
      measurementRecord?: AuthoritativeCampusFeatureRecord | null;
      componentCount: number;
      hasInvalidGeometryWarning: boolean;
      distanceFromCampusMeters: number;
      insideSchoolBoundary: boolean;
      duplicateOverlapNote: string | null;
    },
    campusRef: GeoPoint,
    assumptions: SolarAssumptions,
    override: BuildingSolarOverride | null
  ): DiscoveredBuilding {
    const tags = raw.tags || {};
    const mRec = raw.measurementRecord ?? null;

    // Apply visual-only polygon overrides / position offsets WITHOUT silently overwriting analytical m²
    let visualPolygons =
      override?.customPolygons && override.customPolygons.length > 0
        ? override.customPolygons
        : raw.polygons;

    const offsetE = override?.offsetEastMeters ?? 0;
    const offsetN = override?.offsetNorthMeters ?? 0;
    if (Math.abs(offsetE) > 0.01 || Math.abs(offsetN) > 0.01) {
      visualPolygons = shiftPolygonsByMeters(visualPolygons, offsetE, offsetN, campusRef);
    }

    const { areaM2: visualFootprintAreaM2 } = computePolygonsAreaM2(visualPolygons);
    const centroid = computePolygonsCentroid(visualPolygons);
    const distanceFromCampusMeters = Math.round(haversineDistanceMeters(campusRef, centroid));

    // Selection status defaults
    const defaultStatus: BuildingSelectionStatus = !raw.solarEligible
      ? 'excluded'
      : raw.source === 'manual'
      ? 'confirmed'
      : raw.source === 'image_reconstructed'
      ? 'provisional'
      : 'unassigned';

    const selectionStatus: BuildingSelectionStatus = !raw.solarEligible
      ? 'excluded'
      : override?.selectionStatus ?? defaultStatus;

    const analyticalConfirmed = Boolean(
      override?.analyticalConfirmed ||
        override?.grossAreaOverrideM2 != null ||
        selectionStatus === 'confirmed'
    );

    // Analytical gross footprint area is strictly distinct from decorative visual positioning
    const grossFootprintAreaM2 =
      override?.grossAreaOverrideM2 != null
        ? round2(override.grossAreaOverrideM2)
        : mRec
        ? round2(mRec.authoritativeFootprintAreaM2)
        : round2(raw.grossFootprintAreaM2);

    const grossFootprintAreaFt2 =
      override?.grossAreaOverrideM2 != null
        ? m2ToFt2(grossFootprintAreaM2)
        : mRec
        ? mRec.authoritativeFootprintAreaFt2
        : m2ToFt2(grossFootprintAreaM2);

    const grossAreaSource: DiscoveredBuilding['geometry']['grossAreaSource'] =
      override?.grossAreaOverrideM2 != null
        ? 'admin_override'
        : mRec
        ? 'supplied_measured'
        : raw.source === 'image_reconstructed'
        ? 'image_reconstructed'
        : raw.source === 'manual'
        ? 'manual_geometry'
        : 'osm_geometry';

    const sourceLabel: DiscoveredBuilding['sourceLabel'] = analyticalConfirmed
      ? 'Administrator-confirmed'
      : mRec
      ? 'Supplied footprint'
      : raw.source === 'image_reconstructed'
      ? 'Image-reconstructed'
      : 'Mapped geometry';

    const areaProvenanceLabel: MeasurementProvenanceLabel =
      override?.grossAreaOverrideM2 != null
        ? 'Supplied measured data'
        : mRec
        ? mRec.areaProvenance
        : raw.source === 'osm'
        ? 'Derived from supplied geometry'
        : 'Approximate visual geometry';

    const perimeterProvenanceLabel: MeasurementProvenanceLabel = mRec
      ? mRec.perimeterProvenance
      : 'Not available';

    const verticalGeometryProvenanceLabel: MeasurementProvenanceLabel = mRec
      ? mRec.verticalGeometryProvenance
      : 'Approximate visual geometry';

    const roofSurfaceAreaProvenanceLabel: MeasurementProvenanceLabel = mRec
      ? mRec.roofSurfaceAreaProvenance
      : 'Not available';

    const polygonVsAuthoritativeDeltaM2 =
      grossFootprintAreaM2 > 0 ? round2(visualFootprintAreaM2 - grossFootprintAreaM2) : null;
    const polygonVsAuthoritativeDeltaPercent =
      grossFootprintAreaM2 > 0 && polygonVsAuthoritativeDeltaM2 !== null
        ? round2((polygonVsAuthoritativeDeltaM2 / grossFootprintAreaM2) * 100)
        : null;

    const combinedComplexNote = mRec?.combinedComplexRef
      ? `Measured together with ${
          mRec.id === 'campus/old-building' ? 'New Building (NB)' : 'Old Building (OB)'
        } as one unified ${mRec.combinedComplexRef.suppliedCombinedAreaM2.toLocaleString()} m² (${mRec.combinedComplexRef.suppliedCombinedAreaFt2.toLocaleString()} ft²) complex (perimeter ${mRec.combinedComplexRef.suppliedCombinedPerimeterM} m). Apportioned at ${mRec.combinedComplexRef.proportionalSharePercent}% so OB + NB = 1,209.21 m² exactly.`
      : null;

    // Roof metadata parsing — strictly distinguish roof:direction from roof:orientation
    const osmRoofShape = tags['roof:shape'] || null;
    const osmRoofAngle = parseNumericTag(tags['roof:angle']);
    const osmRoofDirection = tags['roof:direction'] || null;
    const osmRoofOrientation = tags['roof:orientation'] || null;
    const osmRoofMaterial = tags['roof:material'] || null;
    const osmRoofColour = tags['roof:colour'] || tags['roof:color'] || null;

    const roofOrientationNote = osmRoofOrientation
      ? `OSM roof:orientation="${osmRoofOrientation}" indicates ridge orientation (along/across), not panel facing direction; PVGIS aspect requires roof:direction or an administrator setting.`
      : null;

    const parsedDirectionAspect = parseOsmRoofDirectionToPvgisAspect(osmRoofDirection);

    let roofType =
      override?.roofTypeOverride ||
      raw.defaultRoofType ||
      osmRoofShape ||
      'flat (assumed)';
    if (osmRoofShape === 'flat' && !override?.roofTypeOverride && !raw.defaultRoofType) {
      roofType = 'flat';
    }

    let tiltDegrees = raw.solarEligible ? assumptions.flatRoofTiltDegrees : 0;
    let tiltSource: 'osm_tag' | 'admin_override' | 'assumed_flat_default' = 'assumed_flat_default';
    if (override?.tiltDegreesOverride != null) {
      tiltDegrees = clamp(Math.round(override.tiltDegreesOverride), 0, 90);
      tiltSource = 'admin_override';
    } else if (osmRoofAngle != null && osmRoofAngle >= 0 && osmRoofAngle <= 90) {
      tiltDegrees = Math.round(osmRoofAngle);
      tiltSource = 'osm_tag';
    }

    let aspectDegrees = raw.solarEligible ? assumptions.flatRoofAspectDegrees : 0;
    let aspectSource: 'osm_roof_direction' | 'admin_override' | 'assumed_south_default' =
      'assumed_south_default';
    if (override?.aspectDegreesOverride != null) {
      aspectDegrees = clamp(Math.round(override.aspectDegreesOverride), -180, 180);
      aspectSource = 'admin_override';
    } else if (parsedDirectionAspect !== null) {
      aspectDegrees = parsedDirectionAspect;
      aspectSource = 'osm_roof_direction';
    }

    let roofMetadataStatus: RoofMetadataStatus = 'assumed';
    if (
      osmRoofShape &&
      (osmRoofShape === 'flat' || osmRoofAngle !== null || parsedDirectionAspect !== null)
    ) {
      roofMetadataStatus = 'mapped';
    } else if (
      osmRoofShape ||
      osmRoofAngle !== null ||
      osmRoofDirection ||
      osmRoofOrientation ||
      osmRoofMaterial ||
      override?.roofTypeOverride ||
      override?.tiltDegreesOverride != null ||
      override?.aspectDegreesOverride != null
    ) {
      roofMetadataStatus = 'partial';
    }

    const pvTechnology = override?.pvTechnologyOverride ?? assumptions.pvTechnology;
    const mountingPlace = override?.mountingPlaceOverride ?? assumptions.mountingPlace;
    const systemLossesPercent =
      override?.systemLossesOverride ?? assumptions.systemLossesPercent;

    // Usable roof area & whole-panel PV capacity (strictly 0 for non-roof sports grounds!)
    const usableRoofFractionPercent = raw.solarEligible
      ? override?.usableRoofFractionPercent ?? assumptions.usableRoofFractionPercent
      : 0;
    const usableRoofAreaM2 = raw.solarEligible
      ? round2(grossFootprintAreaM2 * (usableRoofFractionPercent / 100))
      : 0;
    const packingFactorPercent = raw.solarEligible ? assumptions.packingFactorPercent : 0;
    const effectivePackingAreaM2 = raw.solarEligible
      ? round2(usableRoofAreaM2 * (packingFactorPercent / 100))
      : 0;
    const maxPhysicalPanels = raw.solarEligible
      ? Math.floor(usableRoofAreaM2 / assumptions.panelAreaM2)
      : 0;
    const estimatedPanelCount = raw.solarEligible
      ? Math.min(
          maxPhysicalPanels,
          Math.max(0, Math.floor(effectivePackingAreaM2 / assumptions.panelAreaM2))
        )
      : 0;
    const estimatedPanelAreaM2 = round2(estimatedPanelCount * assumptions.panelAreaM2);
    const obstructionSetbackAreaM2 = raw.solarEligible
      ? round2(Math.max(0, grossFootprintAreaM2 - usableRoofAreaM2))
      : 0;
    const remainingUsableRoofAreaM2 = round2(Math.max(0, usableRoofAreaM2 - estimatedPanelAreaM2));
    const rowSpacingWalkwayAreaM2 = remainingUsableRoofAreaM2;
    const calculatedCapacityKwp = raw.solarEligible
      ? round2((estimatedPanelCount * assumptions.panelRatedWatts) / 1000)
      : 0;
    const isManualCapacityOverride = Boolean(
      raw.solarEligible && override?.manualCapacityKwpOverride != null
    );
    const effectiveCapacityKwp = !raw.solarEligible
      ? 0
      : isManualCapacityOverride
      ? round2(override!.manualCapacityKwpOverride!)
      : calculatedCapacityKwp;

    // Data confidence scoring
    let score = 50;
    const reasons: string[] = [];
    if (mRec?.verificationStatus === 'supplied_verified') {
      score += 28;
      reasons.push(
        `Horizontal footprint (${mRec.authoritativeFootprintAreaM2} m², perimeter ${mRec.suppliedPerimeterM} m) grounded in supplied Google Maps Measure Distance polygon`
      );
    } else if (mRec?.verificationStatus === 'derived_from_supplied_complex') {
      score += 22;
      reasons.push(
        `Derived proportionally (${mRec.combinedComplexRef?.proportionalSharePercent}%) from supplied unified OB+NB complex (${OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaM2} m²)`
      );
    } else if (raw.source === 'image_reconstructed') {
      score += 18;
      reasons.push('Footprint reconstructed from top-down campus aerial reference');
    } else if (raw.source === 'osm') {
      score += 15;
      reasons.push('Building footprint mapped from OpenStreetMap');
    } else {
      score += 20;
      reasons.push('Custom campus footprint mapped by administrator');
    }
    if (analyticalConfirmed) {
      score += 15;
      reasons.push('Analytical roof parameters confirmed by administrator');
    } else if (selectionStatus === 'provisional') {
      score += 6;
      reasons.push('Usable roof fraction, obstructions, and actual roof surface remain provisional pending site roof survey');
    }
    if (roofMetadataStatus === 'mapped') {
      score += 6;
      reasons.push('Flat concrete roof plan classification identified');
    }
    if (raw.hasInvalidGeometryWarning) {
      score -= 20;
      reasons.push('Minor polygon ring geometry warning');
    }
    if (raw.duplicateOverlapNote) {
      score -= 15;
      reasons.push('Possible overlapping footprint nearby');
    }

    score = clamp(Math.round(score), 20, 98);
    const level: BuildingDataConfidence = score >= 75 ? 'high' : score >= 52 ? 'medium' : 'low';

    // Exact cached PVGIS lookup for eligible solar roofs
    let solarEstimate: BuildingPvgisResult | null = null;
    if (raw.solarEligible && effectiveCapacityKwp >= 0.1) {
      const configHash = this.computePvgisConfigHash({
        latitude: centroid.lat,
        longitude: centroid.lon,
        peakPowerKwp: effectiveCapacityKwp,
        pvTechnology,
        mountingPlace,
        tiltDegrees,
        aspectDegrees,
        systemLossesPercent,
        radiationDatabase: assumptions.radiationDatabase,
      });
      solarEstimate = this.getCachedPvgisByHash(configHash);
    }

    const linkedStats = getRoomwiseBuildingStats(raw.linkedRoomwiseBuilding ?? null);

    const displayName =
      override?.customName ||
      raw.osmName ||
      (override?.campusLabel ? `${override.campusLabel}` : null) ||
      (raw.buildingType && raw.buildingType !== 'yes'
        ? `${raw.buildingType.charAt(0).toUpperCase()}${raw.buildingType.slice(1)} Building (${raw.osmId})`
        : `Building ${raw.osmId}`);

    return {
      id: raw.id,
      source: raw.source,
      sourceLabel,
      featureKind: raw.featureKind,
      solarEligible: raw.solarEligible,
      osmType: raw.osmType,
      osmId: raw.osmId,
      displayName,
      shortLabel: override?.customName || raw.shortLabel || displayName,
      osmName: raw.osmName,
      customName: override?.customName ?? null,
      campusLabel: override?.campusLabel ?? raw.defaultCampusLabel ?? null,
      buildingType: raw.buildingType,
      levels: raw.levels,
      heightMeters: raw.heightMeters,
      parentBuildingId: raw.parentBuildingId ?? null,
      relationshipNote: override?.relationshipNote ?? raw.relationshipNote ?? null,
      linkedRoomwiseBuilding: raw.linkedRoomwiseBuilding ?? null,
      linkedRoomCount: linkedStats.roomCount,
      linkedRatedCapacityWatts: linkedStats.ratedCapacityWatts,
      analyticalConfirmed,
      visualMeta: raw.visualMeta,
      tags,
      polygons: visualPolygons,
      centroid,
      distanceFromCampusMeters,
      insideSchoolBoundary: raw.insideSchoolBoundary,
      selectionStatus,
      geometry: {
        visualFootprintAreaM2: round2(visualFootprintAreaM2),
        grossFootprintAreaM2,
        grossFootprintAreaFt2,
        grossAreaSource,
        suppliedDirectAreaM2: mRec?.suppliedDirectAreaM2 ?? null,
        suppliedDirectAreaFt2: mRec?.suppliedDirectAreaFt2 ?? null,
        suppliedPerimeterM: mRec?.suppliedPerimeterM ?? null,
        suppliedPerimeterFt: mRec?.suppliedPerimeterFt ?? null,
        estimatedRoofPlanAreaM2: raw.solarEligible ? grossFootprintAreaM2 : null,
        actualRoofSurfaceAreaM2: null,
        areaProvenanceLabel,
        perimeterProvenanceLabel,
        verticalGeometryProvenanceLabel,
        roofSurfaceAreaProvenanceLabel,
        measurementSource: mRec?.measurementSource ?? null,
        measurementMethod: mRec?.measurementMethod ?? null,
        polygonVsAuthoritativeDeltaM2,
        polygonVsAuthoritativeDeltaPercent,
        combinedComplexNote,
        lastUpdated: mRec?.lastUpdated ?? null,
        componentCount: visualPolygons.length,
        hasInvalidGeometryWarning: raw.hasInvalidGeometryWarning,
        duplicateOverlapNote: raw.duplicateOverlapNote,
      },
      roofConfig: {
        roofType,
        roofMetadataStatus,
        tiltDegrees,
        tiltSource,
        aspectDegrees,
        aspectSource,
        osmRoofShape,
        osmRoofAngle,
        osmRoofDirection,
        osmRoofOrientation,
        osmRoofMaterial,
        osmRoofColour,
        roofOrientationNote,
        pvTechnology,
        mountingPlace,
        systemLossesPercent,
      },
      capacity: {
        usableRoofFractionPercent,
        usableRoofAreaM2,
        obstructionSetbackAreaM2,
        packingFactorPercent,
        effectivePackingAreaM2,
        estimatedPanelCount,
        estimatedPanelAreaM2,
        remainingUsableRoofAreaM2,
        rowSpacingWalkwayAreaM2,
        calculatedCapacityKwp,
        effectiveCapacityKwp,
        isManualCapacityOverride,
      },
      confidence: {
        level,
        scorePercent: score,
        reasons,
      },
      solarEstimate,
      override,
    };
  }

  private assembleEnrichedBuildings(
    settings: SchoolSettings,
    assumptions: SolarAssumptions,
    overpassPayload: OverpassDiscoveryPayload | null
  ): DiscoveredBuilding[] {
    const campusRef: GeoPoint = {
      lat: settings.campusCoordinates?.latitude ?? 22.3121,
      lon: settings.campusCoordinates?.longitude ?? 87.2994,
    };
    const overrides = this.getAllOverrides();
    const enriched: DiscoveredBuilding[] = [];

    // 1. Primary Image-Reconstructed DAV Model School Campus Structures (always persisted independently of OSM!)
    const reconstructed = buildReconstructedCampusStructures(campusRef);
    for (const r of reconstructed) {
      enriched.push(
        this.computeRoofAndCapacityForBuilding(
          {
            id: r.id,
            source: 'image_reconstructed',
            featureKind: r.featureKind,
            solarEligible: r.solarEligible,
            osmType: 'reconstructed',
            osmId: r.id.replace('campus/', ''),
            osmName: r.name,
            shortLabel: r.shortLabel,
            defaultCampusLabel: r.campusLabel,
            buildingType: r.buildingType,
            levels: r.levels,
            heightMeters: r.heightMeters,
            parentBuildingId: r.parentBuildingId,
            relationshipNote: r.relationshipNote,
            linkedRoomwiseBuilding: r.linkedRoomwiseBuilding,
            defaultRoofType: r.defaultRoofType,
            visualMeta: r.visualMeta,
            tags: r.tags,
            polygons: r.polygons,
            centroid: r.centroid,
            grossFootprintAreaM2: r.grossFootprintAreaM2,
            measurementRecord: r.measurementRecord,
            componentCount: r.polygons.length,
            hasInvalidGeometryWarning: false,
            distanceFromCampusMeters: r.distanceFromCampusMeters,
            insideSchoolBoundary: true,
            duplicateOverlapNote: null,
          },
          campusRef,
          assumptions,
          overrides.get(r.id) ?? null
        )
      );
    }

    // 2. Administrator-drawn manual campus buildings
    const manualList = this.getManualBuildingsRaw(campusRef);
    for (const m of manualList) {
      enriched.push(
        this.computeRoofAndCapacityForBuilding(
          {
            id: m.id,
            source: 'manual',
            featureKind: 'academic_building',
            solarEligible: true,
            osmType: 'manual',
            osmId: m.id.replace('manual/', ''),
            osmName: m.name,
            defaultCampusLabel: m.campusLabel,
            buildingType: m.buildingType,
            levels: null,
            heightMeters: null,
            tags: m.tags,
            polygons: m.polygons,
            centroid: m.centroid,
            grossFootprintAreaM2: m.grossFootprintAreaM2,
            componentCount: m.polygons.length,
            hasInvalidGeometryWarning: false,
            distanceFromCampusMeters: m.distanceFromCampusMeters,
            insideSchoolBoundary: true,
            duplicateOverlapNote: null,
          },
          campusRef,
          assumptions,
          overrides.get(m.id) ?? null
        )
      );
    }

    // 3. Supplementary OpenStreetMap discovered buildings (never overwrite reconstructed campus)
    if (overpassPayload) {
      for (const b of overpassPayload.buildings) {
        enriched.push(
          this.computeRoofAndCapacityForBuilding(
            {
              ...b,
              source: 'osm',
              featureKind: 'academic_building',
              solarEligible: true,
            },
            campusRef,
            assumptions,
            overrides.get(b.id) ?? null
          )
        );
      }
    }

    return enriched;
  }

  // ---------------------------------------------------------------------------
  // 6. Provisional Fallback Scenario (only if all solar-eligible buildings are excluded)
  // ---------------------------------------------------------------------------

  private computeProvisionalSizing(assumptions: SolarAssumptions) {
    const grossArea = assumptions.provisionalFallbackRoofAreaM2;
    const usableArea = round2(grossArea * (assumptions.usableRoofFractionPercent / 100));
    const effectivePacking = round2(usableArea * (assumptions.packingFactorPercent / 100));
    const maxPanels = Math.floor(usableArea / assumptions.panelAreaM2);
    const panelCount = Math.min(
      maxPanels,
      Math.max(1, Math.floor(effectivePacking / assumptions.panelAreaM2))
    );
    const panelArea = round2(panelCount * assumptions.panelAreaM2);
    const remainingArea = round2(Math.max(0, usableArea - panelArea));
    const capacityKwp = round2((panelCount * assumptions.panelRatedWatts) / 1000);
    return {
      grossArea,
      usableArea,
      panelCount,
      panelArea,
      remainingArea,
      capacityKwp,
    };
  }

  private getProvisionalScenarioEstimate(
    settings: SchoolSettings,
    assumptions: SolarAssumptions
  ): BuildingPvgisResult {
    const lat = settings.campusCoordinates?.latitude ?? 22.3121;
    const lon = settings.campusCoordinates?.longitude ?? 87.2994;
    const sizing = this.computeProvisionalSizing(assumptions);

    const configHash = this.computePvgisConfigHash({
      latitude: lat,
      longitude: lon,
      peakPowerKwp: sizing.capacityKwp,
      pvTechnology: assumptions.pvTechnology,
      mountingPlace: assumptions.mountingPlace,
      tiltDegrees: assumptions.flatRoofTiltDegrees,
      aspectDegrees: assumptions.flatRoofAspectDegrees,
      systemLossesPercent: assumptions.systemLossesPercent,
      radiationDatabase: assumptions.radiationDatabase,
    });

    const cached = this.getCachedPvgisByHash(configHash);
    if (cached) return cached;

    return this.buildPreliminaryFallbackEstimate({
      configHash,
      latitude: lat,
      longitude: lon,
      peakPowerKwp: sizing.capacityKwp,
      tiltDegrees: assumptions.flatRoofTiltDegrees,
      aspectDegrees: assumptions.flatRoofAspectDegrees,
      pvTechnology: assumptions.pvTechnology,
      mountingPlace: assumptions.mountingPlace,
      systemLossesPercent: assumptions.systemLossesPercent,
      requestedDatabase: assumptions.radiationDatabase,
      reason: 'Awaiting live PVGIS 5.3 run for provisional planning scenario',
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Campus Solar Summary Aggregation + ROOMWISE Demand Comparison
  // ---------------------------------------------------------------------------

  private buildCampusSummary(
    settings: SchoolSettings,
    assumptions: SolarAssumptions,
    buildings: DiscoveredBuilding[],
    subsetIds?: string[]
  ): CampusSolarSummary {
    const solarBuildings = buildings.filter((b) => b.solarEligible);
    const confirmed = solarBuildings.filter((b) => b.selectionStatus === 'confirmed');
    const provisional = solarBuildings.filter((b) => b.selectionStatus === 'provisional');
    const excluded = solarBuildings.filter((b) => b.selectionStatus === 'excluded');

    const activePool =
      Array.isArray(subsetIds) && subsetIds.length > 0
        ? solarBuildings.filter((b) => subsetIds.includes(b.id))
        : [...confirmed, ...provisional];

    const activeScenarioId = inferPlanningScenarioId(
      assumptions.usableRoofFractionPercent,
      assumptions.packingFactorPercent
    );
    const activeScenarioLabel =
      activeScenarioId === 'custom'
        ? `Custom (${assumptions.usableRoofFractionPercent}% usable × ${assumptions.packingFactorPercent}% packing)`
        : SOLAR_PLANNING_SCENARIOS[activeScenarioId].label;

    if (activePool.length === 0) {
      const sizing = this.computeProvisionalSizing(assumptions);
      const provEstimate = this.getProvisionalScenarioEstimate(settings, assumptions);
      const obstructionSetbackAreaM2 = round1(Math.max(0, sizing.grossArea - sizing.usableArea));

      return {
        mode: 'provisional_fallback',
        modeLabel: 'Provisional planning scenario',
        activeScenarioId,
        activeScenarioLabel,
        discoveredBuildingsCount: solarBuildings.length,
        selectedBuildingsCount: 0,
        confirmedBuildingsCount: confirmed.length,
        provisionalBuildingsCount: provisional.length,
        excludedBuildingsCount: excluded.length,
        calculatedBuildingsCount: provEstimate.provenance === 'pvgis_modelled' ? 1 : 0,
        combinedGrossFootprintAreaM2: sizing.grossArea,
        combinedGrossFootprintAreaFt2: m2ToFt2(sizing.grossArea),
        combinedEstimatedRoofPlanAreaM2: sizing.grossArea,
        actualRoofSurfaceAreaLabel: 'Not available',
        combinedObstructionSetbackAreaM2: obstructionSetbackAreaM2,
        combinedUsableRoofAreaM2: sizing.usableArea,
        combinedEstimatedPanelCount: sizing.panelCount,
        combinedEstimatedPanelAreaM2: sizing.panelArea,
        combinedRemainingUsableRoofAreaM2: sizing.remainingArea,
        combinedRowSpacingWalkwayAreaM2: sizing.remainingArea,
        combinedCapacityKwp: sizing.capacityKwp,
        combinedAnnualGenerationKwh: provEstimate.annualGenerationKwh,
        combinedMonthlyAvgGenerationKwh: provEstimate.monthlyAvgGenerationKwh,
        combinedDailyAvgGenerationKwh: provEstimate.dailyAvgGenerationKwh,
        weightedSpecificYieldKwhPerKwp: provEstimate.specificYieldKwhPerKwp,
        combinedMonthlyGeneration: provEstimate.monthly.map((m) => ({
          month: m.month,
          monthLabel: m.monthLabel,
          generationKwh: m.monthlyGenerationKwh,
          avgIrradiationKwhM2: m.monthlyInPlaneIrradiationKwhM2,
        })),
        scenarioComparisons: [],
        gridFeasibilityChecklist: buildGridFeasibilityChecklist(assumptions, sizing.capacityKwp),
        provenanceLabel: provEstimate.provenanceLabel,
        fallbackNotice: `All academic roofs are currently excluded. Showing the editable ${sizing.grossArea} m² provisional planning scenario.`,
        provisionalScenarioEstimate: provEstimate,
      };
    }

    let combinedGross = 0;
    let combinedObstructionSetback = 0;
    let combinedUsable = 0;
    let combinedPanels = 0;
    let combinedPanelArea = 0;
    let combinedRemaining = 0;
    let combinedKwp = 0;
    let combinedAnnualKwh = 0;
    let calculatedCount = 0;
    let anyPreliminary = false;
    let anyStaleCache = false;
    let anyDbFallbackNotice: string | null = null;

    const monthlyTotals = new Array(12).fill(0);
    const monthlyIrradWeighted = new Array(12).fill(0);
    const monthlyIrradWeight = new Array(12).fill(0);
    const perBuildingNormalizedYield = new Map<
      string,
      { annualYieldPerKwp: number; monthlyYieldPerKwp: number[] }
    >();

    for (const b of activePool) {
      combinedGross += b.geometry.grossFootprintAreaM2;
      combinedObstructionSetback += b.capacity.obstructionSetbackAreaM2;
      combinedUsable += b.capacity.usableRoofAreaM2;
      combinedPanels += b.capacity.estimatedPanelCount;
      combinedPanelArea += b.capacity.estimatedPanelAreaM2;
      combinedRemaining += b.capacity.remainingUsableRoofAreaM2;
      combinedKwp += b.capacity.effectiveCapacityKwp;

      let est = b.solarEstimate;
      if (est && est.provenance === 'pvgis_modelled') {
        calculatedCount += 1;
        if (est.metadata.fallbackNotice && !anyDbFallbackNotice) {
          anyDbFallbackNotice = est.metadata.fallbackNotice;
        }
      } else if (est && est.provenance === 'pvgis_cached_last_successful') {
        calculatedCount += 1;
        anyStaleCache = true;
      } else {
        anyPreliminary = true;
        est = this.buildPreliminaryFallbackEstimate({
          configHash: `pending_${b.id}`,
          latitude: b.centroid.lat,
          longitude: b.centroid.lon,
          peakPowerKwp: Math.max(0.1, b.capacity.effectiveCapacityKwp),
          tiltDegrees: b.roofConfig.tiltDegrees,
          aspectDegrees: b.roofConfig.aspectDegrees,
          pvTechnology: b.roofConfig.pvTechnology,
          mountingPlace: b.roofConfig.mountingPlace,
          systemLossesPercent: b.roofConfig.systemLossesPercent,
          requestedDatabase: assumptions.radiationDatabase,
          reason: 'Awaiting PVGIS 5.3 execution',
        });
      }

      const denomKwp = Math.max(0.1, est.peakPowerKwp || b.capacity.effectiveCapacityKwp);
      perBuildingNormalizedYield.set(b.id, {
        annualYieldPerKwp: est.annualGenerationKwh / denomKwp,
        monthlyYieldPerKwp: Array.from({ length: 12 }, (_, idx) => {
          const m = est!.monthly[idx];
          return m ? m.monthlyGenerationKwh / denomKwp : 0;
        }),
      });

      combinedAnnualKwh += est.annualGenerationKwh;
      for (let i = 0; i < 12; i++) {
        const m = est.monthly[i];
        if (!m) continue;
        monthlyTotals[i] += m.monthlyGenerationKwh;
        if (m.monthlyInPlaneIrradiationKwhM2 !== null && b.capacity.effectiveCapacityKwp > 0) {
          monthlyIrradWeighted[i] +=
            m.monthlyInPlaneIrradiationKwhM2 * b.capacity.effectiveCapacityKwp;
          monthlyIrradWeight[i] += b.capacity.effectiveCapacityKwp;
        }
      }
    }

    const combinedMonthlyGeneration: CampusMonthlySolarPoint[] = MONTH_LABELS.map((label, idx) => ({
      month: idx + 1,
      monthLabel: label,
      generationKwh: round1(monthlyTotals[idx]),
      avgIrradiationKwhM2:
        monthlyIrradWeight[idx] > 0
          ? round1(monthlyIrradWeighted[idx] / monthlyIrradWeight[idx])
          : null,
    }));

    // Build Conservative / Moderate / High-Utilisation Theoretical comparison scenarios
    // using exact building footprints and PVGIS linear specific yield per orientation.
    const scenarioComparisons: SolarScenarioComparisonRow[] = (
      ['conservative', 'moderate', 'high_theoretical'] as const
    ).map((scenarioId) => {
      const preset = SOLAR_PLANNING_SCENARIOS[scenarioId];
      let scUsable = 0;
      let scSetback = 0;
      let scWalkway = 0;
      let scPanels = 0;
      let scPanelArea = 0;
      let scKwp = 0;
      let scAnnualKwh = 0;
      const scMonthly = new Array(12).fill(0);

      for (const b of activePool) {
        const gross = b.geometry.grossFootprintAreaM2;
        const usable = round2(gross * (preset.usableRoofFractionPercent / 100));
        const effPacking = round2(usable * (preset.packingFactorPercent / 100));
        const maxPanels = Math.floor(usable / assumptions.panelAreaM2);
        const panels = Math.min(maxPanels, Math.max(0, Math.floor(effPacking / assumptions.panelAreaM2)));
        const panelArea = round2(panels * assumptions.panelAreaM2);
        const kwp = round2((panels * assumptions.panelRatedWatts) / 1000);
        const norm = perBuildingNormalizedYield.get(b.id);

        scUsable += usable;
        scSetback += Math.max(0, gross - usable);
        scWalkway += Math.max(0, usable - panelArea);
        scPanels += panels;
        scPanelArea += panelArea;
        scKwp += kwp;

        if (norm) {
          scAnnualKwh += kwp * norm.annualYieldPerKwp;
          for (let i = 0; i < 12; i++) {
            scMonthly[i] += kwp * (norm.monthlyYieldPerKwp[i] || 0);
          }
        }
      }

      return {
        scenarioId,
        label: preset.label,
        shortLabel: preset.shortLabel,
        usableRoofFractionPercent: preset.usableRoofFractionPercent,
        packingFactorPercent: preset.packingFactorPercent,
        netRoofCoveragePercent: preset.netRoofCoveragePercent,
        usableRoofAreaM2: round1(scUsable),
        obstructionSetbackAreaM2: round1(scSetback),
        rowSpacingWalkwayAreaM2: round1(scWalkway),
        estimatedPanelCount: scPanels,
        estimatedPanelAreaM2: round1(scPanelArea),
        capacityKwp: round2(scKwp),
        annualGenerationKwh: round1(scAnnualKwh),
        monthlyGeneration: MONTH_LABELS.map((label, idx) => ({
          month: idx + 1,
          monthLabel: label,
          generationKwh: round1(scMonthly[idx]),
          avgIrradiationKwhM2: combinedMonthlyGeneration[idx]?.avgIrradiationKwhM2 ?? null,
        })),
        summary: preset.summary,
      };
    });

    const weightedSpecificYield =
      combinedKwp > 0 ? round1(combinedAnnualKwh / combinedKwp) : 0;

    let provenanceLabel = 'Modelled by PVGIS (Hypothetical Scenario — Not Installed)';
    if (calculatedCount === 0) {
      provenanceLabel = 'Preliminary estimate · Run PVGIS 5.3 to calculate';
    } else if (anyPreliminary) {
      provenanceLabel = `${calculatedCount}/${activePool.length} PVGIS modelled · remaining preliminary`;
    } else if (anyStaleCache) {
      provenanceLabel = 'Cached PVGIS calculation (Hypothetical Scenario)';
    }

    return {
      mode: 'mapped_buildings',
      modeLabel:
        Array.isArray(subsetIds) && subsetIds.length > 0
          ? `Selected subset (${activePool.length} campus roofs)`
          : confirmed.length > 0 && provisional.length === 0
          ? `Administrator-confirmed campus roofs (${activePool.length})`
          : `Active campus roofs (${activePool.length} · supplied horizontal footprints)`,
      activeScenarioId,
      activeScenarioLabel,
      discoveredBuildingsCount: solarBuildings.length,
      selectedBuildingsCount: activePool.length,
      confirmedBuildingsCount: confirmed.length,
      provisionalBuildingsCount: provisional.length,
      excludedBuildingsCount: excluded.length,
      calculatedBuildingsCount: calculatedCount,
      combinedGrossFootprintAreaM2: round2(combinedGross),
      combinedGrossFootprintAreaFt2: m2ToFt2(round2(combinedGross)),
      combinedEstimatedRoofPlanAreaM2: round2(combinedGross),
      actualRoofSurfaceAreaLabel: 'Not available',
      combinedObstructionSetbackAreaM2: round1(combinedObstructionSetback),
      combinedUsableRoofAreaM2: round1(combinedUsable),
      combinedEstimatedPanelCount: combinedPanels,
      combinedEstimatedPanelAreaM2: round1(combinedPanelArea),
      combinedRemainingUsableRoofAreaM2: round1(combinedRemaining),
      combinedRowSpacingWalkwayAreaM2: round1(combinedRemaining),
      combinedCapacityKwp: round2(combinedKwp),
      combinedAnnualGenerationKwh: round1(combinedAnnualKwh),
      combinedMonthlyAvgGenerationKwh: round1(combinedAnnualKwh / 12),
      combinedDailyAvgGenerationKwh: round2(combinedAnnualKwh / 365),
      weightedSpecificYieldKwhPerKwp: weightedSpecificYield,
      combinedMonthlyGeneration,
      scenarioComparisons,
      gridFeasibilityChecklist: buildGridFeasibilityChecklist(assumptions, round2(combinedKwp)),
      provenanceLabel,
      fallbackNotice: anyDbFallbackNotice,
      provisionalScenarioEstimate: null,
    };
  }

  private getRoomwiseDemandBenchmark(settings: SchoolSettings): RoomwiseDemandBenchmark {
    const installedWatts = ROOM_APPLIANCE_SPECS.reduce(
      (sum, spec) =>
        sum + spec.lights.totalWatts + spec.fans.totalWatts + (spec.aux?.powerRatingWatts ?? 0),
      0
    );
    const preRetrofitWatts = INITIAL_CLASSROOMS.reduce(
      (sum, room) => sum + (room.baselinePowerWatts || 0),
      0
    );
    const installedRatedMaxKw = round2(installedWatts / 1000); // 13.39 kW
    const preRetrofitReferenceKw = Math.round(preRetrofitWatts) / 1000; // 18.635 kW

    try {
      const endDate = getIstDateString(new Date());
      const startDate = shiftIstDate(endDate, -89);
      const overview = energyHistoryService.getOverview({
        preset: 'custom',
        startDate,
        endDate,
        settings,
      });

      const days = Math.max(1, overview.range.daysCount || 90);
      const observedWindowKwh = round1(overview.kpis.totalActualKWh || 0);
      const observedAvgDailyKwh = round2(overview.kpis.averageDailyKWh || observedWindowKwh / days);
      const annualizedEstimatedDemandKwh = round1(observedAvgDailyKwh * 365);

      const monthlyObservedKwh: Record<number, number> = {};
      for (const pt of overview.series || []) {
        const mStr = String(pt.dateIst || '').slice(5, 7);
        const mNum = Number(mStr);
        if (mNum >= 1 && mNum <= 12) {
          monthlyObservedKwh[mNum] = round1((monthlyObservedKwh[mNum] || 0) + (pt.actualKWh || 0));
        }
      }

      return {
        provenance: 'roomwise_sqlite_history',
        observedWindowDays: days,
        observedWindowKwh,
        observedAvgDailyKwh,
        annualizedEstimatedDemandKwh,
        annualizedEstimateDisclosure: `Annualised campus demand (${annualizedEstimatedDemandKwh.toLocaleString()} kWh/yr) is extrapolated linearly from ${days} days of recorded ROOMWISE SQLite energy history (${observedWindowKwh.toLocaleString()} kWh observed) and does not account for unrecorded summer vacations or exam breaks.`,
        installedRatedMaxKw,
        preRetrofitReferenceKw,
        currentTariffINR: settings.tariffPerKWhINR,
        gridCarbonFactorKgPerKwh: settings.gridCarbonFactorKgCO2PerKWh,
        monthlyObservedKwh,
      };
    } catch {
      const fallbackAnnual = 10540;
      return {
        provenance: 'provisional_demand_fallback',
        observedWindowDays: 90,
        observedWindowKwh: 2600,
        observedAvgDailyKwh: 28.89,
        annualizedEstimatedDemandKwh: fallbackAnnual,
        annualizedEstimateDisclosure:
          'ROOMWISE 90-day SQLite history was temporarily unavailable; using provisional campus demand reference.',
        installedRatedMaxKw,
        preRetrofitReferenceKw,
        currentTariffINR: settings.tariffPerKWhINR,
        gridCarbonFactorKgPerKwh: settings.gridCarbonFactorKgCO2PerKWh,
        monthlyObservedKwh: {},
      };
    }
  }

  private buildDemandComparison(
    campusSummary: CampusSolarSummary,
    demand: RoomwiseDemandBenchmark
  ): CampusDemandComparison {
    const annualDemand = Math.max(1, demand.annualizedEstimatedDemandKwh);
    const annualGen = Math.max(0, campusSummary.combinedAnnualGenerationKwh);

    // Indian day school (~225 active academic days/yr = ~62% of calendar days, operating 07:30-14:30 IST).
    // Without battery storage, direct daytime self-consumption cannot equal 100% of annual demand:
    // ~72% of day-school demand coincides with usable daytime PV output (remaining ~28% covers
    // early morning startup, monsoon/heavy-cloud periods, and after-hours standby).
    const activeSchoolDayShareUsed = 0.62;
    const daytimeCoincidenceFactorUsed = 0.72;

    const rawSolarContributionPercent = round1((annualGen / annualDemand) * 100);
    const estimatedDirectSelfConsumptionKwh = round1(
      Math.min(annualGen * activeSchoolDayShareUsed, annualDemand * daytimeCoincidenceFactorUsed)
    );
    const cappedDemandCoveragePercent = round1(
      Math.min(100, (estimatedDirectSelfConsumptionKwh / annualDemand) * 100)
    );
    const estimatedAnnualGridReductionPotentialKwh = estimatedDirectSelfConsumptionKwh;
    const remainingAnnualDemandKwh = round1(
      Math.max(0, annualDemand - estimatedDirectSelfConsumptionKwh)
    );
    const surplusAnnualGenerationKwh = round1(
      Math.max(0, annualGen - estimatedDirectSelfConsumptionKwh)
    );

    const monthlyComparison: MonthlyDemandVsSolarPoint[] =
      campusSummary.combinedMonthlyGeneration.map((m, idx) => {
        const estimatedMonthDemand = round1(demand.observedAvgDailyKwh * DAYS_IN_MONTH[idx]);
        const obs = demand.monthlyObservedKwh[m.month] ?? null;
        return {
          month: m.month,
          monthLabel: m.monthLabel,
          solarGenerationKwh: m.generationKwh,
          observedDemandKwh: obs,
          estimatedMonthlyDemandKwh: estimatedMonthDemand,
        };
      });

    return {
      provenance: 'roomwise_calculated_comparison',
      demandScopeNote:
        'ROOMWISE demand reflects the 25 simulated monitored campus spaces (13.39 kW installed rated max), NOT whole-campus utility billing (which also includes unmonitored classrooms, administrative offices, corridors, water pumps, and outdoor lighting). Whole-school rooftop sizing should be reconciled against 12 months of actual electricity bills.',
      estimatedAnnualDemandKwh: round1(annualDemand),
      estimatedAnnualSolarGenerationKwh: round1(annualGen),
      rawSolarContributionPercent,
      cappedDemandCoveragePercent,
      daytimeCoincidenceFactorUsed,
      activeSchoolDayShareUsed,
      estimatedDirectSelfConsumptionKwh,
      estimatedAnnualGridReductionPotentialKwh,
      remainingAnnualDemandKwh,
      surplusAnnualGenerationKwh,
      monthlyComparison,
      disclaimers: [
        'Direct self-consumption is conservatively capped at 72% daytime coincidence on active school days (~62% of calendar days, ~225 CBSE working days/yr) without battery storage — rooftop PV does NOT automatically offset 100% of annual electricity demand.',
        'Surplus generation on Sundays, vacations, and midday peaks cannot reduce bills unless WBSEDCL / WBERC approves a net-metering or net-billing interconnection within the school’s sanctioned contract demand.',
        'Connected power capacity (13.39 kW installed rated max across 25 monitored spaces; 18.635 kW estimated pre-retrofit reference) is distinct from annual electrical energy (kWh/yr).',
        'ROOMWISE intentionally does not fabricate export tariffs, installation capital cost, payback periods, subsidies, or formal carbon-credit claims.',
      ],
    };
  }

  private getShortTermSkyContext(): ShortTermSkyContext {
    const snap = environmentalService.getCachedSkyAndRadiationSnapshot();
    if (!snap) {
      return {
        available: false,
        source: 'open-meteo',
        currentCloudCoverPercent: null,
        currentGhiWm2: null,
        todayPeakGhiWm2: null,
        todayPeakGtiWm2: null,
        fetchedAtIst: null,
        separationNote:
          'Open-Meteo short-term sky conditions are loaded independently under Environmental Conditions and are never merged into PVGIS long-term annual totals.',
      };
    }

    return {
      available: true,
      source: 'open-meteo',
      currentCloudCoverPercent: snap.currentCloudCoverPercent,
      currentGhiWm2: snap.currentGhiWm2,
      todayPeakGhiWm2: snap.todayPeakGhiWm2,
      todayPeakGtiWm2: snap.todayPeakGtiWm2,
      fetchedAtIst: snap.fetchedAtIst,
      separationNote:
        'Short-term sky conditions from Open-Meteo describe current weather only and are strictly separated from PVGIS multi-year climatological generation estimates.',
    };
  }

  // ---------------------------------------------------------------------------
  // 8. Public Orchestration Methods
  // ---------------------------------------------------------------------------

  async getWorkspace(
    settings: SchoolSettings,
    options: { allowLiveDiscovery?: boolean; subsetBuildingIds?: string[] } = {}
  ): Promise<SolarWorkspaceResponse> {
    const assumptions = this.getAssumptions();
    const campusRef: GeoPoint = {
      lat: settings.campusCoordinates?.latitude ?? 22.3121,
      lon: settings.campusCoordinates?.longitude ?? 87.2994,
    };

    const { payload, meta } = await this.getOrDiscoverBuildings(settings, assumptions, {
      forceRefresh: false,
      allowLiveFetch: options.allowLiveDiscovery ?? false,
    });

    const buildings = this.assembleEnrichedBuildings(settings, assumptions, payload);
    const campusSummary = this.buildCampusSummary(
      settings,
      assumptions,
      buildings,
      options.subsetBuildingIds
    );
    const roomwiseDemand = this.getRoomwiseDemandBenchmark(settings);
    const demandComparison = this.buildDemandComparison(campusSummary, roomwiseDemand);
    const shortTermSkyContext = this.getShortTermSkyContext();
    const campusLayout = buildReconstructedCampusOverlay(campusRef);

    return {
      ok: true,
      campus: {
        institutionName: settings.institutionName || 'DAV Model School, IIT Kharagpur',
        locationLabel:
          settings.campusCoordinates?.label ||
          settings.campusLocation ||
          'IIT Kharagpur Campus, West Bengal, India',
        latitude: campusRef.lat,
        longitude: campusRef.lon,
        coordinatesVerifiedByAdmin: Boolean(settings.campusCoordinates?.verifiedByAdmin),
      },
      assumptions,
      discovery: meta,
      campusLayout,
      schoolBoundaries: payload?.schoolBoundaries || [],
      buildings,
      campusSummary,
      roomwiseDemand,
      demandComparison,
      shortTermSkyContext,
      history: this.getHistory(25),
      attributions: {
        osm: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          licenseText: 'Open Database License (ODbL)',
          licenseUrl: 'https://opendatacommons.org/licenses/odbl/',
        },
        pvgis: {
          text: 'European Commission Joint Research Centre — PVGIS 5.3',
          url: 'https://re.jrc.ec.europa.eu/pvg_tools/en/',
        },
      },
      limitations: [
        'Horizontal building footprints (2,366.80 m² across 5 academic buildings) are grounded in supplied Google Maps Measure Distance polygons anchored to 22.3121°N, 87.2994°E. Old Building (OB) and New Building (NB) were measured together as one unified 1,209.21 m² complex (perimeter 285.74 m) and apportioned proportionally with zero double-counting.',
        'Building footprint area is a horizontal plan projection, NOT actual roof-surface area or usable solar installation area. Actual roof-surface area, slopes, parapets, overhangs, water tanks, stairhead mumties, HVAC obstructions, and tree/building shading are not measured in this dataset and remain provisional until an on-site roof survey is performed.',
        'Open-air sports grounds (Football Ground 5,300.83 m² and Basketball Court 737.14 m²) are retained strictly for campus spatial orientation and are excluded from building footprint totals and rooftop PV calculations.',
        'PVGIS 5.3 outputs represent multi-year climatological averages for a hypothetical rooftop array and do not guarantee single-year generation, structural roof load capacity, or utility net-metering approval.',
      ],
      generatedAtIst: formatIstTimestamp(Date.now()),
    };
  }

  async refreshDiscovery(
    settings: SchoolSettings,
    radiusOverride?: number,
    actor?: string
  ): Promise<SolarWorkspaceResponse> {
    if (typeof radiusOverride === 'number' && Number.isFinite(radiusOverride) && actor) {
      this.updateAssumptions({ searchRadiusMeters: radiusOverride }, actor);
    }
    const assumptions = this.getAssumptions();
    await this.getOrDiscoverBuildings(settings, assumptions, {
      forceRefresh: true,
      allowLiveFetch: true,
    });
    return this.getWorkspace(settings, { allowLiveDiscovery: false });
  }

  async calculateSingleBuilding(
    settings: SchoolSettings,
    buildingId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<{
    building: DiscoveredBuilding;
    result: BuildingPvgisResult;
    workspace: SolarWorkspaceResponse;
  }> {
    const assumptions = this.getAssumptions();
    const { payload } = await this.getOrDiscoverBuildings(settings, assumptions, {
      forceRefresh: false,
      allowLiveFetch: false,
    });
    const buildings = this.assembleEnrichedBuildings(settings, assumptions, payload);
    const target = buildings.find((b) => b.id === buildingId);
    if (!target) {
      throw new Error(`Building ${buildingId} was not found in the campus footprint dataset.`);
    }
    if (!target.solarEligible) {
      throw new Error(`${target.displayName} is an open campus sports facility, not a solar roof.`);
    }

    const result = await this.calculatePvgis({
      buildingKey: target.id,
      latitude: target.centroid.lat,
      longitude: target.centroid.lon,
      peakPowerKwp: Math.max(0.1, target.capacity.effectiveCapacityKwp),
      pvTechnology: target.roofConfig.pvTechnology,
      mountingPlace: target.roofConfig.mountingPlace,
      tiltDegrees: target.roofConfig.tiltDegrees,
      aspectDegrees: target.roofConfig.aspectDegrees,
      systemLossesPercent: target.roofConfig.systemLossesPercent,
      radiationDatabase: assumptions.radiationDatabase,
      forceRefresh: Boolean(options.forceRefresh),
    });

    this.recordPvgisHistory({
      scope: 'building',
      targetLabel: target.displayName,
      configHash: result.configHash,
      latitude: result.latitude,
      longitude: result.longitude,
      peakPowerKwp: result.peakPowerKwp,
      pvTechnology: result.pvTechnology,
      mountingPlace: result.mountingPlace,
      tiltDegrees: result.tiltDegrees,
      aspectDegrees: result.aspectDegrees,
      systemLossesPercent: result.systemLossesPercent,
      usedRadiationDatabase: result.metadata.usedRadiationDatabase,
      annualGenerationKwh: result.annualGenerationKwh,
      specificYieldKwhPerKwp: result.specificYieldKwhPerKwp,
      provenance: result.provenance,
    });

    const workspace = await this.getWorkspace(settings, { allowLiveDiscovery: false });
    const updatedBuilding = workspace.buildings.find((b) => b.id === buildingId) || {
      ...target,
      solarEstimate: result,
    };
    return { building: updatedBuilding, result, workspace };
  }

  async calculateCampusOrSubset(
    settings: SchoolSettings,
    options: { buildingIds?: string[]; forceRefresh?: boolean } = {}
  ): Promise<SolarWorkspaceResponse> {
    const assumptions = this.getAssumptions();
    const { payload } = await this.getOrDiscoverBuildings(settings, assumptions, {
      forceRefresh: false,
      allowLiveFetch: false,
    });
    const buildings = this.assembleEnrichedBuildings(settings, assumptions, payload);
    const solarBuildings = buildings.filter((b) => b.solarEligible);

    const targets =
      Array.isArray(options.buildingIds) && options.buildingIds.length > 0
        ? solarBuildings.filter((b) => options.buildingIds!.includes(b.id))
        : solarBuildings.filter(
            (b) => b.selectionStatus === 'confirmed' || b.selectionStatus === 'provisional'
          );

    if (targets.length === 0) {
      const lat = settings.campusCoordinates?.latitude ?? 22.3121;
      const lon = settings.campusCoordinates?.longitude ?? 87.2994;
      const sizing = this.computeProvisionalSizing(assumptions);

      const provResult = await this.calculatePvgis({
        buildingKey: 'provisional_campus_scenario',
        latitude: lat,
        longitude: lon,
        peakPowerKwp: sizing.capacityKwp,
        pvTechnology: assumptions.pvTechnology,
        mountingPlace: assumptions.mountingPlace,
        tiltDegrees: assumptions.flatRoofTiltDegrees,
        aspectDegrees: assumptions.flatRoofAspectDegrees,
        systemLossesPercent: assumptions.systemLossesPercent,
        radiationDatabase: assumptions.radiationDatabase,
        forceRefresh: Boolean(options.forceRefresh),
      });

      this.recordPvgisHistory({
        scope: 'provisional',
        targetLabel: `Provisional planning scenario (${sizing.grossArea} m²)`,
        configHash: provResult.configHash,
        latitude: provResult.latitude,
        longitude: provResult.longitude,
        peakPowerKwp: provResult.peakPowerKwp,
        pvTechnology: provResult.pvTechnology,
        mountingPlace: provResult.mountingPlace,
        tiltDegrees: provResult.tiltDegrees,
        aspectDegrees: provResult.aspectDegrees,
        systemLossesPercent: provResult.systemLossesPercent,
        usedRadiationDatabase: provResult.metadata.usedRadiationDatabase,
        annualGenerationKwh: provResult.annualGenerationKwh,
        specificYieldKwhPerKwp: provResult.specificYieldKwhPerKwp,
        provenance: provResult.provenance,
      });

      return this.getWorkspace(settings, { allowLiveDiscovery: false });
    }

    let liveCallCount = 0;
    for (const b of targets) {
      if (b.capacity.effectiveCapacityKwp < 0.1) continue;
      if (
        !options.forceRefresh &&
        b.solarEstimate &&
        b.solarEstimate.provenance === 'pvgis_modelled'
      ) {
        continue;
      }
      if (liveCallCount > 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
      await this.calculatePvgis({
        buildingKey: b.id,
        latitude: b.centroid.lat,
        longitude: b.centroid.lon,
        peakPowerKwp: b.capacity.effectiveCapacityKwp,
        pvTechnology: b.roofConfig.pvTechnology,
        mountingPlace: b.roofConfig.mountingPlace,
        tiltDegrees: b.roofConfig.tiltDegrees,
        aspectDegrees: b.roofConfig.aspectDegrees,
        systemLossesPercent: b.roofConfig.systemLossesPercent,
        radiationDatabase: assumptions.radiationDatabase,
        forceRefresh: Boolean(options.forceRefresh),
      });
      liveCallCount += 1;
    }

    const workspace = await this.getWorkspace(settings, {
      allowLiveDiscovery: false,
      subsetBuildingIds: options.buildingIds,
    });

    const summary = workspace.campusSummary;
    this.recordPvgisHistory({
      scope: 'campus',
      targetLabel: summary.modeLabel,
      configHash: sha256Short(
        targets.map((t) => `${t.id}:${t.capacity.effectiveCapacityKwp}`).join('|')
      ),
      latitude: workspace.campus.latitude,
      longitude: workspace.campus.longitude,
      peakPowerKwp: summary.combinedCapacityKwp,
      pvTechnology: assumptions.pvTechnology,
      mountingPlace: assumptions.mountingPlace,
      tiltDegrees: assumptions.flatRoofTiltDegrees,
      aspectDegrees: assumptions.flatRoofAspectDegrees,
      systemLossesPercent: assumptions.systemLossesPercent,
      usedRadiationDatabase:
        workspace.buildings.find((b) => targets.some((t) => t.id === b.id) && b.solarEstimate)
          ?.solarEstimate?.metadata.usedRadiationDatabase || assumptions.radiationDatabase,
      annualGenerationKwh: summary.combinedAnnualGenerationKwh,
      specificYieldKwhPerKwp: summary.weightedSpecificYieldKwhPerKwp,
      provenance:
        summary.calculatedBuildingsCount === summary.selectedBuildingsCount
          ? 'pvgis_modelled'
          : 'preliminary_local_estimate',
    });

    return workspace;
  }
}

export const solarService = new SolarService();
