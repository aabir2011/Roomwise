/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import type { Appliance, AuditFinding, Classroom, SchoolSettings } from '../src/types/energy.ts';
import {
  INITIAL_CLASSROOMS,
  INITIAL_SCHOOL_SETTINGS,
} from '../src/data/initialClassrooms.ts';
import {
  OPERATING_HOURS_PER_DAY,
  ROOM_APPLIANCE_SPECS,
  SCHOOL_DAYS_PER_MONTH,
  SCHOOL_DAYS_PER_YEAR,
  TOTAL_CAMPUS_RATED_POWER_WATTS,
  buildExpandedAppliancesFromSpec,
  computeAppliancesRatedPowerWatts,
  getRoomApplianceSpec,
} from '../src/data/roomApplianceSpecs.ts';
import {
  computeAdaptiveTargetFanPercent,
  computeAdaptiveTargetLightPercent,
  expandClassroomAppliances,
  formatCapacityKW,
  getRoomActivityState,
} from '../src/utils/applianceUtils.ts';
import {
  computeEcbcCompliancePercent,
  evaluateLiveAuditFindings,
} from '../src/utils/auditEngine.ts';
import { formatRoomNameForSpeech } from '../src/utils/voicePronunciation.ts';
import type {
  VoiceClientNavigationAction,
  VoiceServerMessage,
  VoiceSnapshotPayload,
  VoiceUiActionPayload,
} from '../src/types/voice.ts';
import {
  energyHistoryService,
  resolveNaturalDateQuery,
} from './energyHistoryService.ts';
import { spaceIntelligenceService } from './spaceIntelligenceService.ts';
import {
  buildModernVoiceSystemInstruction,
  createInitialVoiceSessionMemory,
  createRoomwiseCapabilityRegistry,
  interpretAndExecuteVoiceCommand,
  resolveClassroomRobust,
  type InterpretedVoiceCommandResult,
  type VoiceCapabilityRegistry,
  type VoiceSessionMemory,
} from './voiceCapabilityRegistry.ts';

const LIVE_MODEL = 'gemini-3.8-live';
const IDLE_TIMEOUT_MS = 25_000;
const SPEECH_RMS_ACTIVITY_THRESHOLD = 0.012;

/**
 * Computes normalized RMS amplitude (0..1) of a base64-encoded 16-bit signed
 * little-endian PCM chunk so the server distinguishes actual vocal speech from
 * background/silence frames when managing the inactivity timeout.
 */
export function computeBase64Pcm16Rms(base64: string): number {
  if (!base64) return 0;
  try {
    const buf = Buffer.from(base64, 'base64');
    const samples = Math.floor(buf.length / 2);
    if (samples === 0) return 0;
    let sumSq = 0;
    for (let i = 0; i < samples; i++) {
      const sample = buf.readInt16LE(i * 2) / 32768;
      sumSq += sample * sample;
    }
    return Math.sqrt(sumSq / samples);
  } catch {
    return 0;
  }
}

export interface VoiceAdminIdentity {
  sessionId: string;
  adminId: string;
  adminName: string;
  role: string;
  deviceName: string;
}

export interface ServerApplianceCommandInput {
  roomId: string;
  action: 'set_unit' | 'restore_unit_auto' | 'set_group' | 'restore_room_auto';
  applianceId?: string;
  type?: 'lights' | 'fan' | 'projector' | 'ac' | 'all';
  outputPercent?: number;
  targetPercent?: number;
  targetLightPercent?: number;
  targetFanPercent?: number;
  isVacant?: boolean;
  admin: VoiceAdminIdentity;
}

export interface ServerApplianceCommandOutput {
  ok: boolean;
  error?: string;
  roomId?: string;
  roomCode?: string;
  appliances?: Appliance[];
  totalPowerWatts?: number;
  summary?: string;
}

export interface CampusOptimizationInput {
  scope: 'all' | 'vacant_only' | 'room';
  roomId?: string;
  roomTargets?: Record<
    string,
    { isVacant: boolean; targetLightPercent: number; targetFanPercent: number }
  >;
  admin: VoiceAdminIdentity;
  sourceLabel?: string;
}

export interface CampusOptimizationOutput {
  ok: boolean;
  error?: string;
  optimizedRooms: Array<{
    roomId: string;
    roomCode: string;
    appliances: Appliance[];
    totalPowerWatts: number;
  }>;
  curtailedWatts: number;
  summary: string;
}

export interface BatchApplianceControlInput {
  scope: 'building' | 'floor' | 'campus' | 'vacant_only';
  building?: string;
  floor?: string;
  targetType: 'lights' | 'fan' | 'projector' | 'ac' | 'all';
  mode: 'set' | 'restore_auto';
  outputPercent?: number;
  roomMetaById?: Record<
    string,
    {
      building: string;
      floor: string;
      isVacant: boolean;
      targetLightPercent: number;
      targetFanPercent: number;
    }
  >;
  admin: VoiceAdminIdentity;
}

export interface BatchApplianceControlOutput {
  ok: boolean;
  error?: string;
  optimizedRooms: Array<{
    roomId: string;
    roomCode: string;
    appliances: Appliance[];
    totalPowerWatts: number;
  }>;
  affectedRoomCodes: string[];
  curtailedWatts: number;
  deltaWatts: number;
  summary: string;
}

export interface SecurityAuditStaffOutput {
  staffDirectory: Array<{
    id: string;
    name: string;
    role: string;
    assignedBuilding: string;
    hasPasskey: boolean;
    passkeyCount: number;
  }>;
  activeAdminSessionsCount?: number;
  auditTrailRestricted: boolean;
  auditTrail: Array<{
    id: string;
    type: string;
    summary: string;
    staffName?: string;
    deviceName?: string;
    timestamp: number;
  }>;
}

export interface VoiceLiveBridgeDeps {
  resolveAdminFromWs: (
    req: IncomingMessage,
    explicitToken?: string | null
  ) => VoiceAdminIdentity | null;
  getServerRoomsMap: () => Map<
    string,
    {
      roomId: string;
      roomCode: string;
      isVacantDefault: boolean;
      commandSeq: number;
      updatedAt: number;
      appliances: Appliance[];
    }
  >;
  executeApplianceCommand: (input: ServerApplianceCommandInput) => ServerApplianceCommandOutput;
  executeCampusOptimization: (input: CampusOptimizationInput) => CampusOptimizationOutput;
  executeBatchApplianceControl: (
    input: BatchApplianceControlInput
  ) => BatchApplianceControlOutput;
  getSecurityAuditAndStaff: (includeAuditTrail: boolean) => SecurityAuditStaffOutput;
}

interface CampusSnapshotState {
  activeTab: string;
  selectedRoomId: string | null;
  settings: SchoolSettings;
  classrooms: Classroom[];
  auditFindings: AuditFinding[];
  resolvedFindingIds: string[];
  snapshotTimestamp: number;
}

const DEFAULT_EXPANDED_CLASSROOMS: Classroom[] = INITIAL_CLASSROOMS.map((room) => {
  const spec = getRoomApplianceSpec(room.id);
  if (!spec) return expandClassroomAppliances(room);
  const appliances = buildExpandedAppliancesFromSpec(spec);
  const currentPowerWatts = appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
  const ratedPowerWatts = computeAppliancesRatedPowerWatts(appliances);
  return {
    ...room,
    appliances,
    currentPowerWatts,
    ratedPowerWatts,
    dailyActualKWh: Number(((currentPowerWatts * OPERATING_HOURS_PER_DAY) / 1000).toFixed(2)),
  };
});

function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bclass\b/g, '')
    .replace(/\broom\b/g, '')
    .replace(/\bblock\b/g, '')
    .replace(/\bxii\b/g, '12')
    .replace(/\bxi\b/g, '11')
    .replace(/\bix\b/g, '9')
    .replace(/\bviii\b/g, '8')
    .replace(/\bvii\b/g, '7')
    .replace(/\bvi\b/g, '6')
    .replace(/\bx\b/g, '10')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCompact(raw: string): string {
  return normalizeText(raw).replace(/\s+/g, '');
}

function resolveClassroom(
  classrooms: Classroom[],
  query: string | undefined
): { match?: Classroom; ambiguous?: Classroom[] } {
  if (!query || !query.trim()) return {};
  const qNorm = normalizeText(query);
  const qCompact = normalizeCompact(query);

  // Exact roomCode / id match first
  const exact = classrooms.find(
    (c) =>
      c.roomCode.toLowerCase() === query.trim().toLowerCase() ||
      c.id.toLowerCase() === query.trim().toLowerCase() ||
      normalizeCompact(c.roomCode) === qCompact ||
      normalizeCompact(c.name) === qCompact
  );
  if (exact) return { match: exact };

  // Substring match
  const candidates = classrooms.filter((c) => {
    const code = normalizeCompact(c.roomCode);
    const name = normalizeCompact(c.name);
    const nameWords = normalizeText(c.name);
    return (
      code.includes(qCompact) ||
      name.includes(qCompact) ||
      nameWords.includes(qNorm) ||
      qCompact.includes(name)
    );
  });

  if (candidates.length === 1) {
    return { match: candidates[0] };
  }
  if (candidates.length > 1) {
    return { ambiguous: candidates.slice(0, 5) };
  }
  return {};
}

function mergeSnapshotWithServerAppliances(
  base: CampusSnapshotState,
  deps: VoiceLiveBridgeDeps
): Classroom[] {
  const serverRooms = deps.getServerRoomsMap();
  return base.classrooms.map((room) => {
    const serverState = serverRooms.get(room.id);
    if (!serverState) return room;
    const totalPowerWatts = serverState.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    const ratedPowerWatts = computeAppliancesRatedPowerWatts(serverState.appliances);
    return {
      ...room,
      appliances: serverState.appliances,
      currentPowerWatts: totalPowerWatts,
      ratedPowerWatts,
      dailyActualKWh: Number(((totalPowerWatts * OPERATING_HOURS_PER_DAY) / 1000).toFixed(2)),
    };
  });
}

function formatVoiceRoomActivity(room: Classroom): 'Motion detected' | 'No recent motion detected' | 'Sensor unavailable' {
  return getRoomActivityState(room);
}

function computeDerivedCampusSummary(rooms: Classroom[], settings: SchoolSettings) {
  let totalCurrentPowerWatts = 0;
  let totalRatedPowerWatts = 0;
  let totalBaselinePowerWatts = 0;
  let dailyActualKWh = 0;
  let dailyBaselineKWh = 0;
  let totalConfiguredSeatCapacity = 0;
  let motionDetectedRoomsCount = 0;
  let totalRoomsCalibrated = 0;

  for (const room of rooms) {
    totalCurrentPowerWatts += room.currentPowerWatts;
    totalRatedPowerWatts +=
      room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
    totalBaselinePowerWatts += room.baselinePowerWatts;
    dailyActualKWh += room.dailyActualKWh;
    dailyBaselineKWh += room.dailyBaselineKWh;
    totalConfiguredSeatCapacity += room.capacity;
    if (formatVoiceRoomActivity(room) === 'Motion detected') motionDetectedRoomsCount++;
    if (room.calibration.isCalibrated) totalRoomsCalibrated++;
  }

  const effectiveRatedWatts = totalRatedPowerWatts || TOTAL_CAMPUS_RATED_POWER_WATTS;
  const curtailedFromRatedWatts = Math.max(0, effectiveRatedWatts - totalCurrentPowerWatts);
  const ratedUtilizationPercent =
    effectiveRatedWatts > 0
      ? Number(((totalCurrentPowerWatts / effectiveRatedWatts) * 100).toFixed(1))
      : 0;
  const powerSavedWatts = Math.max(0, totalBaselinePowerWatts - totalCurrentPowerWatts);
  const dailySavedKWh = Math.max(0, dailyBaselineKWh - dailyActualKWh);
  const dailyCostSavedINR = Number((dailySavedKWh * settings.tariffPerKWhINR).toFixed(2));
  const dailyEmissionsAvoidedKgCO2 = Number(
    (dailySavedKWh * settings.gridCarbonFactorKgCO2PerKWh).toFixed(2)
  );
  const savingsPercent =
    totalBaselinePowerWatts > 0
      ? Number(((powerSavedWatts / totalBaselinePowerWatts) * 100).toFixed(1))
      : 0;

  const installedCapacityDifferenceWatts = Math.max(
    0,
    totalBaselinePowerWatts - effectiveRatedWatts
  );
  const installedCapacityDifferencePercent =
    totalBaselinePowerWatts > 0
      ? Number(((installedCapacityDifferenceWatts / totalBaselinePowerWatts) * 100).toFixed(1))
      : 0;

  return {
    totalRooms: rooms.length,
    motionDetectedRoomsCount,
    noRecentMotionRoomsCount: rooms.length - motionDetectedRoomsCount,
    totalRoomsCalibrated,
    totalConfiguredSeatCapacity,
    totalCurrentPowerWatts,
    totalCurrentPowerKW: Number((totalCurrentPowerWatts / 1000).toFixed(2)),
    totalRatedPowerWatts: effectiveRatedWatts,
    totalRatedPowerKW: Number((effectiveRatedWatts / 1000).toFixed(2)),
    curtailedFromRatedWatts,
    ratedUtilizationPercent,
    totalBaselinePowerWatts,
    totalBaselinePowerKW: Number((totalBaselinePowerWatts / 1000).toFixed(3)),
    installedCapacityDifferenceWatts,
    installedCapacityDifferencePercent,
    powerSavedWatts,
    savingsPercent,
    dailyActualKWh: Number(dailyActualKWh.toFixed(2)),
    dailyBaselineKWh: Number(dailyBaselineKWh.toFixed(2)),
    dailySavedKWh: Number(dailySavedKWh.toFixed(2)),
    dailyCostSavedINR,
    dailyEmissionsAvoidedKgCO2,
  };
}

function generateDeterministicPeriodMetrics(
  baseActualKWh: number,
  baseBaselineKWh: number,
  tariff: number,
  carbonFactor: number,
  period: string
) {
  const normalized = (period || 'today').toLowerCase();
  if (normalized === 'today' || normalized === 'day' || normalized === 'daily') {
    const saved = Math.max(0, baseBaselineKWh - baseActualKWh);
    return {
      period: 'Today (7.0 Operating Hours: 07:30–14:30)',
      actualKWh: Number(baseActualKWh.toFixed(2)),
      baselineKWh: Number(baseBaselineKWh.toFixed(2)),
      savedKWh: Number(saved.toFixed(2)),
      costSavedINR: Number((saved * tariff).toFixed(2)),
      co2AvoidedKg: Number((saved * carbonFactor).toFixed(2)),
      dataClassification: 'Simulated Campus Daily Energy Total & Calculated Estimate',
    };
  }
  if (normalized === '7d' || normalized === 'week' || normalized === 'weekly') {
    // 6 school operating days per week
    const actual = Number((baseActualKWh * 5.82).toFixed(2));
    const baseline = Number((baseBaselineKWh * 6.0).toFixed(2));
    const saved = Number(Math.max(0, baseline - actual).toFixed(2));
    return {
      period: 'Last 7 Days (6 School Days)',
      actualKWh: actual,
      baselineKWh: baseline,
      savedKWh: saved,
      costSavedINR: Number((saved * tariff).toFixed(2)),
      co2AvoidedKg: Number((saved * carbonFactor).toFixed(2)),
      dataClassification: 'Simulated Historical Estimate (Extrapolated from 6 Operating Days)',
    };
  }
  // 30d / monthly (~24 school days)
  const actual = Number((baseActualKWh * 23.4).toFixed(2));
  const baseline = Number((baseBaselineKWh * 24.0).toFixed(2));
  const saved = Number(Math.max(0, baseline - actual).toFixed(2));
  return {
    period: 'Last 30 Days (~24 School Operating Days)',
    actualKWh: actual,
    baselineKWh: baseline,
    savedKWh: saved,
    costSavedINR: Number((saved * tariff).toFixed(2)),
    co2AvoidedKg: Number((saved * carbonFactor).toFixed(2)),
    dataClassification: 'Simulated Historical Estimate (Extrapolated Monthly Campus Model)',
  };
}

const ROOMWISE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_campus_overview',
    description:
      'Returns the overall ROOMWISE campus snapshot for DAV Model School, IIT Kharagpur: blocks, room counts, PIR motion activity state (motion detected vs no recent motion), configured seating capacity, current power draw vs baseline, active tab, and current user role.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_current_energy_summary',
    description:
      'Returns current campus power (Watts & kW), baseline load, power conserved, WBSEDCL tariff INR savings, and CEA carbon avoidance.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_energy_consumption_history',
    description:
      'Queries persisted historical campus, building, or classroom energy records (kWh, baseline comparison, INR cost, CO2, lighting/fan/aux breakdown, and top blocks/rooms) over any date range in Asia/Kolkata IST. Supports natural queries like "yesterday", "today", "last week", "this week", "last 7 days", "last 30 days", "this month", "last month", "October", or explicit dates.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        period: {
          type: Type.STRING,
          description:
            'Time period preset or natural query: "today", "yesterday", "7d", "30d", "this_month", "previous_month", "last week", "October", etc.',
        },
        naturalQuery: {
          type: Type.STRING,
          description: 'Optional natural language timeframe (e.g. "yesterday", "last week", "October").',
        },
        startDate: {
          type: Type.STRING,
          description: 'Optional explicit start date YYYY-MM-DD in Asia/Kolkata.',
        },
        endDate: {
          type: Type.STRING,
          description: 'Optional explicit end date YYYY-MM-DD in Asia/Kolkata.',
        },
        building: {
          type: Type.STRING,
          description: 'Optional building block filter.',
        },
      },
    },
  },
  {
    name: 'compare_energy_periods',
    description:
      'Compares persisted historical campus energy consumption, daily averages, cost, and block shifts between two date ranges (e.g., "today" vs "last 7 days", "yesterday" vs "last week", "this_month" vs "previous_month", "this week" vs "last week").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        periodA: { type: Type.STRING, description: 'First period: today, yesterday, last week, 7d, 30d, this_month, previous_month, October, etc.' },
        periodB: { type: Type.STRING, description: 'Second period to compare against.' },
        building: { type: Type.STRING, description: 'Optional building filter.' },
      },
    },
  },
  {
    name: 'get_time_of_day_profile',
    description:
      'Analyzes the 24-hour Asia/Kolkata time-of-day electrical demand curve (kW by hour, school hours 07:30-14:30 vs off-hours/post-hours share, peak demand hour, lowest hour, and occupancy correlation). Use for "When does the school experience peak demand?" or post-hours usage questions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        period: { type: Type.STRING, description: 'Natural timeframe or preset (default "7d").' },
        building: { type: Type.STRING, description: 'Optional building filter.' },
        roomQuery: { type: Type.STRING, description: 'Optional specific classroom.' },
      },
    },
  },
  {
    name: 'get_historical_anomalies',
    description:
      'Retrieves detected historical energy anomalies from stored interval records: excess consumption above comparable baseline, unexpected post-hours runtime while vacant, daytime vacancy lighting active, and abnormal fan/thermal patterns, complete with evidence and caveats.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        period: { type: Type.STRING, description: 'Natural timeframe or preset (e.g. "yesterday", "7d", "30d", "last month").' },
        building: { type: Type.STRING, description: 'Optional building filter.' },
        roomQuery: { type: Type.STRING, description: 'Optional specific classroom.' },
      },
    },
  },
  {
    name: 'investigate_energy_reason',
    description:
      'Investigates WHY energy consumption was higher, lower, or unusual during a target date or period (e.g., "Why was energy consumption higher yesterday?", "Why did consumption spike last week?"). Retrieves target total vs comparable historical baseline, top contributing blocks & rooms, lighting/fan/aux split, post-hours draw, anomalies, and control events.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        naturalQuery: {
          type: Type.STRING,
          description: 'Date or timeframe to investigate, e.g. "yesterday", "today", "last week", "2026-11-12".',
        },
        building: { type: Type.STRING, description: 'Optional building filter.' },
        roomQuery: { type: Type.STRING, description: 'Optional specific classroom.' },
      },
      required: ['naturalQuery'],
    },
  },
  {
    name: 'get_energy_savings_estimate',
    description:
      'Returns calculated energy, rupee cost (INR), and CO2 savings estimates across daily, monthly, and annual horizons.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        horizon: {
          type: Type.STRING,
          description: 'Projection horizon: "daily", "monthly", or "annual".',
        },
      },
    },
  },
  {
    name: 'list_classrooms',
    description:
      'Lists classrooms with room codes, names, building, occupancy status, and current power watts. Can filter by building name or occupancy status.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building: {
          type: Type.STRING,
          description: 'Optional building filter, e.g. "G+3 Block", "New Building", "Pre-Primary Block", "Old Building", "Multipurpose Hall".',
        },
        occupancyFilter: {
          type: Type.STRING,
          description: 'Optional filter: "Occupied", "Unoccupied", or "all".',
        },
      },
    },
  },
  {
    name: 'get_classroom_status',
    description:
      'Gets comprehensive status for a specific classroom: occupancy, power watts, baseline, lights/fans summary, active adaptive rule, and manual overrides.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: {
          type: Type.STRING,
          description: 'Classroom name or room code, e.g. "Class X-A", "G3-G01", "Physics Lab", "Computer Lab".',
        },
      },
      required: ['roomQuery'],
    },
  },
  {
    name: 'get_classroom_telemetry',
    description:
      'Gets detailed simulated environmental sensor telemetry for a classroom: ambient lux, natural daylight lux, temperature, humidity, heat index, CO2 ppm, PIR motion state, and daylight alpha/thermal beta.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: {
          type: Type.STRING,
          description: 'Classroom name or room code.',
        },
      },
      required: ['roomQuery'],
    },
  },
  {
    name: 'get_classroom_energy_history',
    description:
      'Gets persisted historical kWh consumption, lighting vs fan breakdown, occupancy %, average temperature, post-hours draw, and comparison vs prior period for a specific classroom.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: { type: Type.STRING, description: 'Classroom name or room code.' },
        period: { type: Type.STRING, description: 'Optional timeframe: today, yesterday, last week, 7d, 30d, this_month, previous_month, or YYYY-MM-DD.' },
      },
      required: ['roomQuery'],
    },
  },
  {
    name: 'compare_classrooms',
    description:
      'Compares two classrooms side-by-side on power draw, baseline savings, occupancy, daylight lux, and appliance modes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQueryA: { type: Type.STRING, description: 'First classroom name or room code.' },
        roomQueryB: { type: Type.STRING, description: 'Second classroom name or room code.' },
      },
      required: ['roomQueryA', 'roomQueryB'],
    },
  },
  {
    name: 'get_occupancy_status',
    description:
      'Gets PIR motion activity state ("Motion detected" or "No recent motion detected") and configured seating capacity across the campus or for a specific classroom. Note: PIR sensors detect movement, not individual student headcounts; for register-based attendance, use get_space_intelligence_summary.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: { type: Type.STRING, description: 'Optional classroom name or room code.' },
      },
    },
  },
  {
    name: 'get_lighting_status',
    description:
      'Gets per-fixture lighting output percentages, watts, and AUTO/MANUAL mode for a classroom (or top lighting consumers campus-wide).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: { type: Type.STRING, description: 'Optional classroom name or room code.' },
      },
    },
  },
  {
    name: 'get_fan_status',
    description:
      'Gets per-sector BLDC fan speeds, output percentages, watts, and AUTO/MANUAL mode for a classroom (or top fan consumers campus-wide).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: { type: Type.STRING, description: 'Optional classroom name or room code.' },
      },
    },
  },
  {
    name: 'get_appliance_configuration',
    description:
      'Lists every individual light fixture, fan sector, projector, and AC unit configured in a specific classroom with exact IDs and ratings.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: { type: Type.STRING, description: 'Classroom name or room code.' },
      },
      required: ['roomQuery'],
    },
  },
  {
    name: 'identify_unusual_consumption',
    description:
      'Identifies classrooms with high current power ratios, manual overrides above adaptive targets, or active thermal/over-illumination audit flags.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'identify_vacant_classroom_consumption',
    description:
      'Finds all unoccupied classrooms across the campus that are still drawing positive wattage (phantom loads or manual overrides left on).',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'generate_energy_audit_summary',
    description:
      'Generates a structured summary of unresolved and resolved campus energy audit findings, estimated wasted watts, and monthly cost waste in INR.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'explain_energy_trend',
    description:
      'Provides grounded engineering metrics explaining why energy consumption or savings look the way they do across buildings, daylight harvesting, and occupancy.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: 'Optional topic such as daylight, fans, vacant rooms, or building.' },
      },
    },
  },
  {
    name: 'navigate_roomwise',
    description:
      'Navigates the ROOMWISE interface to a specific section, opens a classroom detail modal, opens a classroom QR placard, or opens the administrator login dialog.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description:
            'Must be one of: "dashboard", "digital-twin", "classrooms", "analytics", "history", "space-intelligence", "audit", "reports", "settings", "admin-login", or "classroom".',
        },
        roomQuery: {
          type: Type.STRING,
          description: 'Required if target is "classroom" — specifies which room modal or placard to open.',
        },
        openQrPlacard: {
          type: Type.BOOLEAN,
          description: 'If true and target is "classroom", opens the Classroom QR Placard modal instead of telemetry detail.',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'control_classroom_appliance',
    description:
      'ADMIN ONLY: Adjusts individual light output, individual fan sector speed, projector, AC, or groups ("lights_group", "fans_group", "projector_group", "ac_group", "all_group"), or restores automatic adaptive control ("room_auto"). Strictly checks verified server admin session; returns permission denial in Student Mode. For multi-unit overrides or turning off active occupied equipment, set confirmed=false first to preview and confirm unless the administrator explicitly requested an immediate action.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: {
          type: Type.STRING,
          description: 'Classroom name or room code (e.g. "Class X-A", "G3-G01", "Physics Lab").',
        },
        targetType: {
          type: Type.STRING,
          description:
            'Must be one of: "unit" (single light, fan sector, projector, or AC), "lights_group" (all lights in room), "fans_group" (all fan sectors in room), "projector_group" (projectors in room), "ac_group" (AC units in room), "all_group" (every appliance in room), or "room_auto" (restore entire room to adaptive AUTO).',
        },
        unitQuery: {
          type: Type.STRING,
          description: 'Unit code or name when targetType is "unit", e.g. "L1", "Light 2", "Fan Sector 1", "Projector", "AC".',
        },
        mode: {
          type: Type.STRING,
          description: '"set" to set a specific output percentage (0-100), or "restore_auto" to return the unit/room to AUTO control.',
        },
        outputPercent: {
          type: Type.NUMBER,
          description: 'Target intensity percentage from 0 (OFF) to 100 (Full). Required when mode is "set".',
        },
        confirmed: {
          type: Type.BOOLEAN,
          description: 'Set to true when the administrator explicitly commanded or confirmed this override.',
        },
      },
      required: ['roomQuery', 'targetType', 'mode'],
    },
  },
  {
    name: 'control_building_or_campus_appliances',
    description:
      'ADMIN ONLY: Executes batch appliance control across an entire building block (e.g. "G+3 Block", "Pre-Primary Block", "New Building", "Old Building", "Multipurpose Hall"), a specific floor (e.g. "Ground Floor", "1st Floor", "2nd Floor", "3rd Floor"), vacant rooms only, or the whole 25-room campus (e.g., "turn off all lights in Pre-Primary Block", "set all fans on 2nd floor to 60%", "turn off all projectors campus-wide", or "restore New Building to AUTO"). Strictly verified admin only.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scope: {
          type: Type.STRING,
          description: '"building", "floor", "campus", or "vacant_only".',
        },
        building: {
          type: Type.STRING,
          description: 'Building filter, e.g. "G+3 Block", "New Building", "Pre-Primary Block", "Old Building", "Multipurpose Hall".',
        },
        floor: {
          type: Type.STRING,
          description: 'Floor filter, e.g. "Ground Floor", "1st Floor", "2nd Floor", "3rd Floor".',
        },
        targetType: {
          type: Type.STRING,
          description: 'Appliance category: "lights", "fan", "projector", "ac", or "all".',
        },
        mode: {
          type: Type.STRING,
          description: '"set" to apply a manual percentage (0-100), or "restore_auto" to return matching appliances to adaptive AUTO.',
        },
        outputPercent: {
          type: Type.NUMBER,
          description: 'Percentage 0 (OFF) to 100 (Full) when mode is "set".',
        },
        confirmed: {
          type: Type.BOOLEAN,
          description: 'True when directly commanded or confirmed by the administrator; false to preview impacted rooms first.',
        },
      },
      required: ['scope', 'targetType', 'mode'],
    },
  },
  {
    name: 'optimize_campus_energy',
    description:
      'ADMIN ONLY: Executes ROOMWISE One-Click Campus Optimization or single-room audit remediation. Sheds unoccupied vacant classroom loads to 0W, removes inefficient MANUAL overrides, restores closed-loop daylight & thermal AUTO curves across all 25 classrooms (or a target room), and updates live Energy Audit status. Pass confirmed=true when the verified administrator directly asks to run optimization or fix audit issues.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scope: {
          type: Type.STRING,
          description:
            '"all" for full One-Click Campus Optimization across all 25 classrooms, "vacant_only" to shed only unoccupied classrooms drawing power, or "room" to optimize/remediate one specific classroom audit finding.',
        },
        roomQuery: {
          type: Type.STRING,
          description: 'Required when scope is "room" (e.g., "G3-301", "Computer Lab", "NB-102").',
        },
        confirmed: {
          type: Type.BOOLEAN,
          description:
            'Set to true to execute optimization immediately when explicitly commanded or confirmed by the administrator; set false to preview waste findings first.',
        },
      },
      required: ['scope'],
    },
  },
  {
    name: 'resolve_audit_finding',
    description:
      'ADMIN ONLY: Resolves a specific Energy Audit finding (by findingId or classroom name/code), remediating the room anomaly on the server and marking the finding resolved in the live Energy Audit dashboard.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        findingId: {
          type: Type.STRING,
          description: 'Optional exact audit finding ID from generate_energy_audit_summary.',
        },
        roomQuery: {
          type: Type.STRING,
          description: 'Classroom code or name associated with the finding (e.g. "NB-102", "Computer Lab").',
        },
      },
    },
  },
  {
    name: 'recalibrate_classroom',
    description:
      'ADMIN ONLY: Triggers ROOMWISE multi-sensor Bayesian α (daylight penetration) & β (thermal dissipation) recalibration for a single classroom, an entire building block, or all 25 campus classrooms ("all").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scope: {
          type: Type.STRING,
          description: '"room", "building", or "all" (recalibrate all 25 rooms). Defaults to "room".',
        },
        roomQuery: {
          type: Type.STRING,
          description: 'Classroom name or code when scope is "room".',
        },
        building: {
          type: Type.STRING,
          description: 'Building name when scope is "building".',
        },
      },
    },
  },
  {
    name: 'update_classroom_parameters',
    description:
      'ADMIN ONLY: Updates per-room configured calibration targets & limits: target desk lux (100-800), max permitted fan speed (1-5), autoEcoMode (true/false), and overtimeAllowed (true/false) for a single classroom or an entire building.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roomQuery: {
          type: Type.STRING,
          description: 'Classroom name or code. Omit only if specifying building.',
        },
        building: {
          type: Type.STRING,
          description: 'Optional building name to update parameters across every room in that block.',
        },
        targetLux: {
          type: Type.NUMBER,
          description: 'Target desk illumination in lux (100 to 800).',
        },
        maxFanSpeed: {
          type: Type.NUMBER,
          description: 'Maximum permitted fan speed index (1 to 5, typically 3, 4, or 5).',
        },
        autoEcoMode: {
          type: Type.BOOLEAN,
          description: 'Autonomous load-shedding when vacant (true/false).',
        },
        overtimeAllowed: {
          type: Type.BOOLEAN,
          description: 'Allow post-hours operation override (true/false).',
        },
      },
    },
  },
  {
    name: 'update_campus_settings',
    description:
      'ADMIN ONLY: Updates ROOMWISE campus operational policy settings: institution name, campus location, WBSEDCL electricity tariff (INR/kWh), grid carbon factor (kg CO2/kWh), target desk illumination (standard classroom or lab lux), PIR inactivity grace period (minutes), adaptive learning mode, lowPowerMode, and schoolHoursStart/schoolHoursEnd.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        institutionName: {
          type: Type.STRING,
          description: 'School or institution display name.',
        },
        campusLocation: {
          type: Type.STRING,
          description: 'Campus location / address label.',
        },
        tariffPerKWhINR: {
          type: Type.NUMBER,
          description: 'Electricity tariff rate in INR per kWh (e.g. 7.40).',
        },
        gridCarbonFactorKgCO2PerKWh: {
          type: Type.NUMBER,
          description: 'Grid CO2 emission factor in kg CO2 per kWh (e.g. 0.716).',
        },
        standardClassroomTargetLux: {
          type: Type.NUMBER,
          description: 'Target illumination for standard classrooms in lux (e.g. 300).',
        },
        labTargetLux: {
          type: Type.NUMBER,
          description: 'Target illumination for laboratories in lux (e.g. 400).',
        },
        defaultInactivityGraceMinutes: {
          type: Type.NUMBER,
          description: 'PIR vacancy grace window in minutes (e.g. 8).',
        },
        learningMode: {
          type: Type.STRING,
          description: 'Adaptive policy profile: "Adaptive Active", "Conservative", or "High Comfort".',
        },
        lowPowerMode: {
          type: Type.BOOLEAN,
          description: 'Enable or disable Low-Power & GPU Acceleration saver mode.',
        },
        schoolHoursStart: {
          type: Type.STRING,
          description: 'School schedule start time in HH:MM 24h format (e.g. "07:30").',
        },
        schoolHoursEnd: {
          type: Type.STRING,
          description: 'School schedule end time in HH:MM 24h format (e.g. "14:30").',
        },
      },
    },
  },
  {
    name: 'execute_app_action',
    description:
      'Performs ROOMWISE interface, export, session, or assistant actions that a user can click in the UI: closing open modals, opening a standalone classroom live telemetry page (/classroom/:code), opening the phone QR scanner modal, pausing or resuming live IoT sensor simulation, exporting the 25-room Energy Audit CSV, printing the official BEE Audit Report, muting standby, locking/logging out Admin Mode, or closing the voice overlay.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            'Must be one of: "close_modals", "open_classroom_page", "open_phone_qr_scanner", "set_simulation", "export_analytics_csv", "print_audit_report", "logout_admin", "mute_standby", "close_overlay".',
        },
        roomQuery: {
          type: Type.STRING,
          description: 'Required when action is "open_classroom_page" (room code or name).',
        },
        enabled: {
          type: Type.BOOLEAN,
          description: 'For "set_simulation" (true=run live drift, false=pause) or "mute_standby" (true=mute, false=unmute).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'get_security_audit_and_staff',
    description:
      'Returns the Campus Energy Management Committee staff directory (names, roles, assigned building blocks, biometric passkey readiness) and, when signed in as an administrator, recent server security, login, QR pairing, and appliance command audit log events.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'rank_and_filter_classrooms',
    description:
      'Ranks and filters all 25 classrooms by a specific metric (power_desc, power_asc, waste_desc, efficiency_desc, efficiency_asc, temperature_desc, co2_desc, daylight_asc, manual_overrides) with optional building and occupancy filters.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sortBy: {
          type: Type.STRING,
          description:
            'Metric to rank by: "power_desc", "power_asc", "waste_desc", "efficiency_desc", "efficiency_asc", "temperature_desc", "co2_desc", "daylight_asc", or "manual_overrides".',
        },
        building: {
          type: Type.STRING,
          description: 'Optional building filter.',
        },
        occupancyFilter: {
          type: Type.STRING,
          description: 'Optional "Occupied", "Unoccupied", or "all".',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Number of top matching classrooms to return (default 5, max 25).',
        },
      },
    },
  },
  {
    name: 'compare_buildings',
    description:
      'Compares all 5 campus building blocks (G+3 Block, New Building, Pre-Primary Block, Old Building, Multipurpose Hall) side-by-side on room count, occupancy, current watts, baseline watts, savings %, daily kWh, and daily INR savings.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'simulate_policy_what_if',
    description:
      'Runs a non-destructive financial and carbon what-if forecast if the campus adjusts electricity tariff, grid carbon factor, or achieves an additional percentage reduction in daily kWh.',
    parameters: {
      type: Type.OBJECT,
      properties: {
          proposedTariffPerKWhINR: {
          type: Type.NUMBER,
          description: 'Hypothetical tariff in INR/kWh.',
        },
        proposedCarbonFactor: {
          type: Type.NUMBER,
          description: 'Hypothetical grid carbon factor in kg CO2/kWh.',
        },
        additionalSavingsPercent: {
          type: Type.NUMBER,
          description: 'Additional percentage reduction on current actual kWh draw (0 to 50).',
        },
      },
    },
  },
  {
    name: 'get_space_intelligence_summary',
    description:
      'Returns Space Intelligence (Attendance-Aware Classroom Allocation) summary for DAV Model School: registered section enrolled strength, register-based attendance counts for the requested or latest recorded instructional date, classroom max seating capacities, and high-level allocation run summary.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        attendanceDate: {
          type: Type.STRING,
          description: 'Optional YYYY-MM-DD instructional date in Asia/Kolkata IST. Defaults to latest recorded date.',
        },
      },
    },
  },
  {
    name: 'get_space_allocation_recommendations',
    description:
      'Returns attendance-aware classroom reallocation proposals (from existing room to proposed room for whole class sections, net kWh energy savings, INR & CO2 savings, capacity & timetable safety traces, and why alternative rooms were rejected) as well as sections where "No reallocation recommended" applies.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        attendanceDate: {
          type: Type.STRING,
          description: 'Optional YYYY-MM-DD instructional date. If no saved run exists for that date or fresh analysis is needed, runs/retrieves allocation recommendations.',
        },
      },
    },
  },
  {
    name: 'get_space_allocation_history',
    description:
      'Returns the persistent administrator approval and rejection log for classroom reallocation proposals in Space Intelligence.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of recent history entries to retrieve (default 15).',
        },
      },
    },
  },
];

function buildSystemInstruction(
  admin: VoiceAdminIdentity | null,
  activeTab: string
): string {
  const roleDesc = admin
    ? `Authenticated Administrator: ${admin.adminName} (${admin.role}). You are AUTHORISED to execute every control & configuration action across ROOMWISE: single & group appliance controls (lights, fan sectors, projectors, AC), block/floor/campus batch controls, One-Click Campus Optimization, individual audit finding remediation, classroom recalibration, classroom & campus settings updates, admin logout, and security audit inspection.`
    : `Student Mode (Read-Only Guest at session start). Navigation, analytics, building comparisons, rankings, what-if forecasts, telemetry, committee directory, CSV export, print preview, Space Intelligence inspection, and energy audit inspection are allowed. Appliance controls, batch overrides, campus optimization, recalibration, room/campus parameter updates, and security audit log inspection require administrator sign-in.`;

  return `You are ROOMWISE Voice Intelligence for DAV Model School, IIT Kharagpur — an institutional smart-campus energy management AI assistant capable of performing everything a human operator can do across ROOMWISE and advanced cross-campus analytics & batch automation.

CURRENT SESSION CONTEXT:
- Active View: ${activeTab}
- Session Authority: ${roleDesc}
- Wake word activation is strictly a hands-free UI trigger and NEVER elevates privileges or bypasses server authentication.

VOICE PERSONA & ACCENT CONSISTENCY (CRITICAL):
- Always speak with Charon's calm, steady, neutral default voice and accent from the very first wake acknowledgement through every single turn of the conversation.
- NEVER begin in or adopt an Indian English accent or regional English inflection, even though the school is located in India. Keep English pronunciation consistently in Charon's neutral default voice without ever switching accents mid-session.

MULTILINGUAL & VERNACULAR SPEECH RECOGNITION & RESPONSE (CRITICAL):
- Automatically identify the user's spoken language from incoming audio — including English, Hindi (हिन्दी), Bengali (বাংলা), other regional languages, or natural code-switching.
- Respond naturally in the same language the user spoke, ensuring transcripts use authentic native script (Devanagari / देवनागरी for Hindi, Bengali script / বাংলা লিপি for Bengali, Latin script for English). Never output broken phonetic transliteration or gibberish when clear Hindi or Bengali speech is heard.
- Keep technical room codes, units, and telemetry values accurate ('G3-G01', '13.39 kW', '18.635 kW', '5,245 W', 'ROOMWISE') even inside Hindi or Bengali responses, and execute all ROOMWISE tools normally regardless of spoken language.

DYNAMIC AUTHORIZATION RULE (CRITICAL):
- The user can sign in or sign out as an administrator at ANY moment during the conversation, or right before repeating a request.
- NEVER refuse a control, optimization, calibration, or settings request based solely on earlier turns in the conversation or earlier Student Mode status!
- Whenever the user asks to control appliances, optimize the campus, resolve audit findings, recalibrate, or change settings, ALWAYS invoke the matching tool directly. The ROOMWISE server validates the live session token on every single tool invocation:
  - If the user has signed in, the tool succeeds immediately and executes the action.
  - Only if the tool explicitly returns PERMISSION_DENIED should you explain that administrator sign-in is required and offer navigate_roomwise(target="admin-login").

CAPABILITIES & DOMAIN REASONING:
- Full Control & Configuration (Admin): Single/group appliance controls in any room (lights, fan sectors, projector, AC, or whole room), batch controls by block, floor, vacant rooms, or whole campus (control_building_or_campus_appliances), One-Click Campus Optimization (optimize_campus_energy), single finding remediation (resolve_audit_finding), Bayesian α/β recalibration per room/block/campus (recalibrate_classroom), per-room target lux / max fan speed / auto eco / overtime overrides (update_classroom_parameters), and full campus policy settings (update_campus_settings).
- Full UI & Session Actions (execute_app_action): Navigate to Space Intelligence ("space-intelligence"), Energy History ("history"), open standalone /classroom/:code telemetry pages, open Phone QR Scanner, close modals, export 25-room Analytics CSV, open & print BEE Audit Report, pause/resume live IoT drift simulation, mute standby, close voice overlay, or lock/logout admin.
- Space Intelligence (Attendance-Aware Allocation): Query register-based section attendance, enrolled class strength, room max seating capacities, energy-saving reallocation proposals, rejection reasons, and approval history (get_space_intelligence_summary, get_space_allocation_recommendations, get_space_allocation_history).
- Historical Intelligence & Diagnostic Reasoning (Asia/Kolkata): Query real stored interval records across up to 90 days (get_energy_consumption_history, compare_energy_periods, get_classroom_energy_history, get_time_of_day_profile, get_historical_anomalies, investigate_energy_reason).
- Deep Intelligence & Analytics: Side-by-side 5-block comparison (compare_buildings), multi-metric 25-room ranking & filtering (rank_and_filter_classrooms), non-destructive what-if tariff/carbon/efficiency modeling (simulate_policy_what_if), anomaly & phantom load detection, and security audit & committee directory (get_security_audit_and_staff).
- Proactively call tools before quoting numbers or confirming actions — NEVER guess wattages, kWh totals, room states, audit counts, attendance counts, or claim an action happened without a tool confirming ok=true.

PIR SENSOR VS ATTENDANCE HONESTY RULE (CRITICAL):
- ROOMWISE PIR sensors detect physical movement ONLY ("Motion detected" or "No recent motion detected") — they do NOT count students!
- NEVER claim that PIR sensors measured a specific number of students present or a live physical occupancy percentage.
- When asked about attendance or class size, distinguish clearly:
  1. Enrolled strength (static administrative record, e.g., "Enrolled strength: 44 students"),
  2. Register attendance (from the imported attendance register in Space Intelligence, e.g., "Attendance recorded: 31/44 on YYYY-MM-DD"), and
  3. Room activity (live PIR sensor motion state: "Motion detected" or "No recent motion detected").

HISTORICAL DIAGNOSTIC RULES (CRITICAL):
- When asked about past consumption ("yesterday", "last week", "October", "past 30 days"), highest-consuming classrooms/blocks over a period, peak hours, unusual consumption patterns, or "Why was energy higher...?", ALWAYS query the historical tools (especially investigate_energy_reason for "why" questions!).
- Cite concrete retrieved numbers (kWh, % change, comparable baseline, block/room drivers, lighting vs fan vs aux share, post-hours kWh).
- Distinguish correlation from causation honestly, note when Today is an incomplete partial day, and state caveats when relevant.
- NEVER respond to a historical diagnostic question with a vague dismissal like "Everything is optimised."

OPERATIONAL & SAFETY RULES:
1. Keep spoken replies concise, clear, and calm (2–4 sentences unless deeper breakdown is requested).
2. Distinguish data provenance accurately when discussing metrics:
   - Live room power, lux, and PIR motion state come from ROOMWISE's 25 Simulated IoT Nodes.
   - Attendance figures come from the persistent school attendance register (Space Intelligence).
   - Historical kWh totals are integrated (Power kW × Time hours) in the persistent ROOMWISE SQLite store in Asia/Kolkata timezone.
   - Rupee & CO2 savings are calculated estimates using the active WBSEDCL tariff and CEA grid factor.
3. For One-Click Campus Optimization / Audit Remediation:
   - When asked about audit issues, call generate_energy_audit_summary to read live room-by-room inefficiencies.
   - When an authenticated administrator directly instructs you to run One-Click Campus Optimization, optimize the campus, or fix audit issues, call optimize_campus_energy (passing confirmed=true) or resolve_audit_finding and report exact curtailed watts and updated rooms.
   - Only pass confirmed=false when the administrator asks an exploratory question ("what would happen if we optimize?").
4. For manual single/group/block appliance overrides:
   - When the administrator gives a clear, direct command (e.g. "turn off all lights in Pre-Primary Block", "set fans in Class X-A to 60%", "restore Lab to auto"), execute it cleanly; use confirmed=false preview only when the request is ambiguous or exploratory ("what happens if we shut down occupied labs?").
5. Installed Capacity vs Estimated Pre-Retrofit Reference Capacity (CRITICAL TERMINOLOGY RULE):
   - Installed Rated Maximum across all ${ROOM_APPLIANCE_SPECS.length} rooms at 100% is ${formatCapacityKW(TOTAL_CAMPUS_RATED_POWER_WATTS)} kW (${TOTAL_CAMPUS_RATED_POWER_WATTS} W) — the exact combined rated power of all 268 currently installed appliances. Use this as the primary reference for live campus load, rated utilisation (100% at 13.39 kW), and curtailment.
   - Estimated Pre-Retrofit Reference Capacity is 18.635 kW (18,635 W) — derived from pre-retrofit baselinePowerWatts estimates representing conventional lighting and induction fan configurations. NEVER round 18.635 kW down to 18.63 kW, and clearly state it is a comparative engineering reference rather than current installed capacity or measured historical electricity consumption.
   - The difference between them (18,635 W vs 13,390 W) is 5,245 W (5.245 kW, or ~28.1% lower installed rated capacity), representing an Installed Capacity Difference vs Pre-Retrofit Reference — NEVER call this static capacity difference "Energy Saved", "Actual Savings", or "Consumption Reduction", and note that actual electricity savings depend on operating hours (7.0 h/day), occupancy, appliance usage, and adaptive control.`;
}

function resolveApplianceUnit(appliances: Appliance[], unitQuery: string): Appliance | null {
  const q = unitQuery.toLowerCase().trim();
  const qCompact = q.replace(/[^a-z0-9]/g, '');

  // Match exact ID or unitCode (e.g., "L1", "FS2", "PRJ1")
  const direct = appliances.find(
    (a) =>
      a.id.toLowerCase() === q ||
      (a.unitCode && a.unitCode.toLowerCase() === q) ||
      (a.unitCode && a.unitCode.toLowerCase() === qCompact)
  );
  if (direct) return direct;

  // Match friendly spoken references: "fan sector 2", "sector 2", "light 1", "projector"
  const numMatch = q.match(/(\d+)/);
  const idxNum = numMatch ? Number(numMatch[1]) : null;
  if (idxNum !== null) {
    if (q.includes('fan') || q.includes('sector')) {
      const fanMatch = appliances.find(
        (a) =>
          a.type === 'fan' &&
          (a.sectorIndex === idxNum ||
            a.unitCode?.toLowerCase() === `fs${idxNum}` ||
            a.name.toLowerCase().includes(`sector ${idxNum}`))
      );
      if (fanMatch) return fanMatch;
    }
    if (q.includes('light') || q.includes('lamp') || q.includes('led')) {
      const lightMatch = appliances.find(
        (a) =>
          a.type === 'lights' &&
          (a.sectorIndex === idxNum ||
            a.unitCode?.toLowerCase() === `l${idxNum}` ||
            a.name.toLowerCase().includes(`#${idxNum}`))
      );
      if (lightMatch) return lightMatch;
    }
  }

  return (
    appliances.find(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(qCompact)
    ) || null
  );
}

export function registerVoiceLiveWebSocket(
  httpServer: HttpServer,
  deps: VoiceLiveBridgeDeps
): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return;
    }

    if (pathname !== '/api/voice/live') {
      // Leave other upgrade paths (e.g. Vite) untouched
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const sendJson = (msg: VoiceServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    const reqUrl = new URL(req.url || '/', 'http://localhost');
    let explicitToken = reqUrl.searchParams.get('token');
    let currentSnapshot: CampusSnapshotState = {
      activeTab: 'dashboard',
      selectedRoomId: null,
      settings: INITIAL_SCHOOL_SETTINGS,
      classrooms: DEFAULT_EXPANDED_CLASSROOMS,
      auditFindings: evaluateLiveAuditFindings(
        DEFAULT_EXPANDED_CLASSROOMS,
        INITIAL_SCHOOL_SETTINGS
      ),
      resolvedFindingIds: [],
      snapshotTimestamp: Date.now(),
    };

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      sendJson({
        type: 'error',
        code: 'MISSING_API_KEY',
        message:
          'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets to enable the ROOMWISE voice assistant.',
      });
      ws.close(1008, 'GEMINI_API_KEY missing');
      return;
    }

    let liveSession: Session | null = null;
    let isClosing = false;
    let lastActivityAt = Date.now();
    let isModelTurnActive = false;
    let hasReceivedUserSpeech = false;
    let consecutiveAudioSendErrors = 0;
    let lastInputTranscript = '';
    let lastOutputTranscript = '';

    const capabilityRegistry: VoiceCapabilityRegistry = createRoomwiseCapabilityRegistry(
      ROOMWISE_FUNCTION_DECLARATIONS
    );
    const sessionMemory: VoiceSessionMemory = createInitialVoiceSessionMemory(
      currentSnapshot.activeTab,
      currentSnapshot.selectedRoomId
    );

    const idleInterval = setInterval(() => {
      if (isClosing || isModelTurnActive) return;
      if (Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) {
        sendJson({
          type: 'idle_timeout',
          message: 'Voice session returned to wake-word standby after inactivity.',
        });
        cleanup();
      }
    }, 3000);
    idleInterval.unref?.();

    const cleanup = () => {
      if (isClosing) return;
      isClosing = true;
      clearInterval(idleInterval);
      try {
        liveSession?.close();
      } catch {
        // ignore
      }
      liveSession = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const executeToolCall = async (
      name: string,
      rawArgs: Record<string, unknown> | undefined
    ): Promise<Record<string, unknown>> => {
      const args = rawArgs || {};
      const rooms = mergeSnapshotWithServerAppliances(currentSnapshot, deps);
      const settings = currentSnapshot.settings;
      const summary = computeDerivedCampusSummary(rooms, settings);
      const adminIdentity = deps.resolveAdminFromWs(req, explicitToken);

      switch (name) {
        case 'get_campus_overview': {
          const buildingMap = new Map<
            string,
            { building: string; totalRooms: number; motionDetectedRooms: number; currentWatts: number; baselineWatts: number }
          >();
          for (const r of rooms) {
            const b = buildingMap.get(r.building) || {
              building: r.building,
              totalRooms: 0,
              motionDetectedRooms: 0,
              currentWatts: 0,
              baselineWatts: 0,
            };
            b.totalRooms++;
            if (formatVoiceRoomActivity(r) === 'Motion detected') b.motionDetectedRooms++;
            b.currentWatts += r.currentPowerWatts;
            b.baselineWatts += r.baselinePowerWatts;
            buildingMap.set(r.building, b);
          }

          return {
            institution: settings.institutionName,
            location: settings.campusLocation,
            operatingHours: `${settings.schoolHours.start}–${settings.schoolHours.end}`,
            learningMode: settings.learningMode,
            activeTab: currentSnapshot.activeTab,
            sessionRole: adminIdentity ? 'admin' : 'student',
            authenticatedAdmin: adminIdentity?.adminName || null,
            ...summary,
            blocks: Array.from(buildingMap.values()),
            dataClassification: 'Simulated IoT Node Telemetry (25 Nodes) & Calculated Baseline Estimates',
          };
        }

        case 'get_current_energy_summary': {
          return {
            totalCurrentPowerWatts: summary.totalCurrentPowerWatts,
            totalCurrentPowerKW: summary.totalCurrentPowerKW,
            installedRatedMaxWatts: summary.totalRatedPowerWatts,
            installedRatedMaxKW: summary.totalRatedPowerKW,
            totalRatedPowerWatts: summary.totalRatedPowerWatts,
            totalRatedPowerKW: summary.totalRatedPowerKW,
            curtailedFromRatedWatts: summary.curtailedFromRatedWatts,
            ratedUtilizationPercent: summary.ratedUtilizationPercent,
            estimatedPreRetrofitReferenceWatts: summary.totalBaselinePowerWatts,
            estimatedPreRetrofitReferenceKW: summary.totalBaselinePowerKW,
            installedCapacityDifferenceWatts: summary.installedCapacityDifferenceWatts,
            installedCapacityDifferencePercent: summary.installedCapacityDifferencePercent,
            totalBaselinePowerWatts: summary.totalBaselinePowerWatts,
            totalBaselinePowerKW: summary.totalBaselinePowerKW,
            powerSavedWatts: summary.powerSavedWatts,
            savingsPercent: summary.savingsPercent,
            dailyActualKWh: summary.dailyActualKWh,
            dailyBaselineKWh: summary.dailyBaselineKWh,
            dailySavedKWh: summary.dailySavedKWh,
            tariffPerKWhINR: settings.tariffPerKWhINR,
            dailyCostSavedINR: summary.dailyCostSavedINR,
            gridCarbonFactorKgCO2PerKWh: settings.gridCarbonFactorKgCO2PerKWh,
            dailyEmissionsAvoidedKgCO2: summary.dailyEmissionsAvoidedKgCO2,
            baselineComparisonNote:
              `Installed Rated Maximum at 100% is ${formatCapacityKW(summary.totalRatedPowerWatts)} kW (${summary.totalRatedPowerWatts} W); Estimated Pre-Retrofit Reference Capacity is ${formatCapacityKW(summary.totalBaselinePowerWatts)} kW (${summary.totalBaselinePowerWatts} W), an Installed Capacity Difference of ${summary.installedCapacityDifferenceWatts} W (~${summary.installedCapacityDifferencePercent}% lower installed rated capacity; actual electricity savings depend on operating hours, occupancy, appliance usage, and adaptive control).`,
            dataClassification: 'Simulated Node Power Draw & Comparative Engineering Estimates',
          };
        }

        case 'get_energy_consumption_history': {
          const naturalQuery =
            typeof args.naturalQuery === 'string' && args.naturalQuery.trim()
              ? args.naturalQuery.trim()
              : typeof args.period === 'string'
              ? args.period.trim()
              : '7d';
          const resolvedRange =
            typeof args.startDate === 'string' && typeof args.endDate === 'string'
              ? { preset: 'custom', startDate: args.startDate.trim(), endDate: args.endDate.trim() }
              : resolveNaturalDateQuery(naturalQuery);

          const buildingFilter =
            typeof args.building === 'string' && args.building.trim() ? args.building.trim() : null;

          const overview = energyHistoryService.getOverview({
            preset: resolvedRange.preset,
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
            building: buildingFilter,
            settings,
          });

          return {
            range: overview.range,
            kpis: overview.kpis,
            blocks: overview.blocks,
            topClassrooms: overview.classrooms.slice(0, 6),
            dailyOrHourlyHighlights: overview.series.slice(-14).map((p) => ({
              label: p.subLabel || p.label,
              dateIst: p.dateIst,
              actualKWh: p.actualKWh,
              baselineKWh: p.baselineKWh,
              avgOccupancyPercent: p.avgOccupancyPercent,
              isPartial: Boolean(p.isPartial),
            })),
            dataClassification: overview.dataClassification,
          };
        }

        case 'compare_energy_periods': {
          const qA = typeof args.periodA === 'string' ? args.periodA.trim() : 'today';
          const qB = typeof args.periodB === 'string' ? args.periodB.trim() : 'last 7 days';
          const rA = resolveNaturalDateQuery(qA);
          const rB = resolveNaturalDateQuery(qB);
          const buildingFilter =
            typeof args.building === 'string' && args.building.trim() ? args.building.trim() : null;

          const ovA = energyHistoryService.getOverview({
            preset: rA.preset,
            startDate: rA.startDate,
            endDate: rA.endDate,
            building: buildingFilter,
            settings,
          });
          const ovB = energyHistoryService.getOverview({
            preset: rB.preset,
            startDate: rB.startDate,
            endDate: rB.endDate,
            building: buildingFilter,
            settings,
          });

          const avgDeltaPct =
            ovB.kpis.averageDailyKWh > 0.05
              ? Number(
                  (
                    ((ovA.kpis.averageDailyKWh - ovB.kpis.averageDailyKWh) /
                      ovB.kpis.averageDailyKWh) *
                    100
                  ).toFixed(1)
                )
              : null;

          return {
            periodA: {
              query: qA,
              range: ovA.range,
              totalActualKWh: ovA.kpis.totalActualKWh,
              averageDailyKWh: ovA.kpis.averageDailyKWh,
              savingsPercent: ovA.kpis.savingsPercent,
              estimatedCostINR: ovA.kpis.estimatedCostINR,
              blocks: ovA.blocks,
            },
            periodB: {
              query: qB,
              range: ovB.range,
              totalActualKWh: ovB.kpis.totalActualKWh,
              averageDailyKWh: ovB.kpis.averageDailyKWh,
              savingsPercent: ovB.kpis.savingsPercent,
              estimatedCostINR: ovB.kpis.estimatedCostINR,
              blocks: ovB.blocks,
            },
            dailyRateChangePercent: avgDeltaPct,
            dataClassification: ovA.dataClassification,
          };
        }

        case 'get_time_of_day_profile': {
          const q = typeof args.period === 'string' ? args.period.trim() : 'last 7 days';
          const rRange = resolveNaturalDateQuery(q);
          const buildingFilter =
            typeof args.building === 'string' && args.building.trim() ? args.building.trim() : null;
          let roomIdFilter: string | null = null;
          if (typeof args.roomQuery === 'string' && args.roomQuery.trim()) {
            const res = resolveClassroom(rooms, args.roomQuery);
            if (res.match) roomIdFilter = res.match.id;
          }
          const profile = energyHistoryService.getTimeOfDayProfile({
            preset: rRange.preset,
            startDate: rRange.startDate,
            endDate: rRange.endDate,
            building: buildingFilter,
            roomId: roomIdFilter,
            settings,
          });
          return {
            range: profile.range,
            schoolHoursWindow: profile.schoolHoursWindow,
            summary: profile.summary,
            notableHours: profile.hours.filter((h) => h.flag !== 'normal' || h.band === 'school_hours'),
          };
        }

        case 'get_historical_anomalies': {
          const q = typeof args.period === 'string' ? args.period.trim() : 'last 7 days';
          const rRange = resolveNaturalDateQuery(q);
          const buildingFilter =
            typeof args.building === 'string' && args.building.trim() ? args.building.trim() : null;
          let roomIdFilter: string | null = null;
          if (typeof args.roomQuery === 'string' && args.roomQuery.trim()) {
            const res = resolveClassroom(rooms, args.roomQuery);
            if (res.match) roomIdFilter = res.match.id;
          }
          return {
            ...energyHistoryService.getAnomalies({
              preset: rRange.preset,
              startDate: rRange.startDate,
              endDate: rRange.endDate,
              building: buildingFilter,
              roomId: roomIdFilter,
            }),
          };
        }

        case 'investigate_energy_reason': {
          const q = typeof args.naturalQuery === 'string' ? args.naturalQuery.trim() : 'yesterday';
          const buildingFilter =
            typeof args.building === 'string' && args.building.trim() ? args.building.trim() : null;
          let roomIdFilter: string | null = null;
          if (typeof args.roomQuery === 'string' && args.roomQuery.trim()) {
            const res = resolveClassroom(rooms, args.roomQuery);
            if (res.match) roomIdFilter = res.match.id;
          }
          return {
            ...energyHistoryService.investigatePeriod({
              naturalQuery: q,
              building: buildingFilter,
              roomId: roomIdFilter,
            }),
          };
        }

        case 'get_energy_savings_estimate': {
          const daily = generateDeterministicPeriodMetrics(
            summary.dailyActualKWh,
            summary.dailyBaselineKWh,
            settings.tariffPerKWhINR,
            settings.gridCarbonFactorKgCO2PerKWh,
            'today'
          );
          const monthlySavedKWh = Number((daily.savedKWh * SCHOOL_DAYS_PER_MONTH).toFixed(1));
          const annualSavedKWh = Number((daily.savedKWh * SCHOOL_DAYS_PER_YEAR).toFixed(0));
          return {
            tariffPerKWhINR: settings.tariffPerKWhINR,
            carbonFactorKgPerKWh: settings.gridCarbonFactorKgCO2PerKWh,
            schoolDaysPerMonth: SCHOOL_DAYS_PER_MONTH,
            schoolDaysPerYear: SCHOOL_DAYS_PER_YEAR,
            daily: {
              savedKWh: daily.savedKWh,
              costSavedINR: daily.costSavedINR,
              co2AvoidedKg: daily.co2AvoidedKg,
            },
            monthlySchoolDays: {
              daysBasis: SCHOOL_DAYS_PER_MONTH,
              savedKWh: monthlySavedKWh,
              costSavedINR: Number((monthlySavedKWh * settings.tariffPerKWhINR).toFixed(0)),
              co2AvoidedKg: Number((monthlySavedKWh * settings.gridCarbonFactorKgCO2PerKWh).toFixed(1)),
            },
            annualSchoolDays: {
              daysBasis: SCHOOL_DAYS_PER_YEAR,
              savedKWh: annualSavedKWh,
              costSavedINR: Number((annualSavedKWh * settings.tariffPerKWhINR).toFixed(0)),
              co2AvoidedKg: Number((annualSavedKWh * settings.gridCarbonFactorKgCO2PerKWh).toFixed(0)),
            },
            dataClassification: 'Calculated Estimate based on WBSEDCL HT-2, CEA Grid Factor & 22/225 Day-School Calendar',
          };
        }

        case 'list_classrooms': {
          const bFilter = typeof args.building === 'string' ? args.building.toLowerCase().trim() : '';
          const occFilter = typeof args.occupancyFilter === 'string' ? args.occupancyFilter.toLowerCase().trim() : '';
          const filtered = rooms.filter((r) => {
            if (bFilter && !r.building.toLowerCase().includes(bFilter)) return false;
            if (occFilter && occFilter !== 'all' && r.occupancyStatus.toLowerCase() !== occFilter) return false;
            return true;
          });
          return {
            count: filtered.length,
            classrooms: filtered.map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              building: r.building,
              floor: r.floor,
              roomActivity: formatVoiceRoomActivity(r),
              configuredSeatCapacity: r.capacity,
              currentPowerWatts: r.currentPowerWatts,
              baselinePowerWatts: r.baselinePowerWatts,
            })),
            dataClassification: 'Simulated IoT Node Inventory (PIR motion only, no headcounts)',
          };
        }

        case 'get_classroom_status': {
          const query = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          const res = resolveClassroom(rooms, query);
          if (res.ambiguous) {
            return {
              found: false,
              ambiguous: true,
              matches: res.ambiguous.map((r) => ({ roomCode: r.roomCode, name: r.name, building: r.building })),
              message: 'Multiple classrooms matched that query. Please clarify which one.',
            };
          }
          if (!res.match) {
            return { found: false, message: `No classroom found matching "${query}".` };
          }
          const r = res.match;
          const lights = r.appliances.filter((a) => a.type === 'lights');
          const fans = r.appliances.filter((a) => a.type === 'fan');
          const manualCount = r.appliances.filter((a) => a.operatingMode === 'MANUAL' || a.isManualOverride).length;
          const ratedPowerWatts =
            r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances);
          return {
            found: true,
            roomCode: r.roomCode,
            name: r.name,
            building: r.building,
            floor: r.floor,
            type: r.type,
            roomActivity: formatVoiceRoomActivity(r),
            configuredSeatCapacity: r.capacity,
            currentPowerWatts: r.currentPowerWatts,
            ratedPowerWatts,
            curtailedFromRatedWatts: Math.max(0, ratedPowerWatts - r.currentPowerWatts),
            baselinePowerWatts: r.baselinePowerWatts,
            powerSavedWatts: Math.max(0, r.baselinePowerWatts - r.currentPowerWatts),
            manualOverrideUnits: manualCount,
            lightsActive: lights.filter((l) => (l.outputPercent ?? 0) > 0).length,
            lightsTotal: lights.length,
            fansActive: fans.filter((f) => (f.outputPercent ?? 0) > 0).length,
            fansTotal: fans.length,
            ruleExplanation: r.decision.ruleExplanation,
            dataClassification: 'Simulated Node State (PIR detects movement, not student counts)',
          };
        }

        case 'get_classroom_telemetry': {
          const query = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          const res = resolveClassroom(rooms, query);
          if (!res.match) {
            return {
              found: false,
              ambiguous: Boolean(res.ambiguous),
              matches: res.ambiguous?.map((r) => ({ roomCode: r.roomCode, name: r.name })),
              message: `Could not resolve a single classroom for "${query}".`,
            };
          }
          const r = res.match;
          return {
            found: true,
            roomCode: r.roomCode,
            name: r.name,
            environment: r.environment,
            targetLux: r.calibration.manualParameters.targetLux,
            pir: r.pir,
            learnedParameters: r.calibration.learnedParameters,
            isCalibrated: r.calibration.isCalibrated,
            dataClassification: 'Simulated IoT Node Environmental Telemetry',
          };
        }

        case 'get_classroom_energy_history': {
          const query = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          const period = typeof args.period === 'string' ? args.period : 'last 7 days';
          const res = resolveClassroom(rooms, query);
          if (!res.match) {
            return {
              found: false,
              ambiguous: Boolean(res.ambiguous),
              matches: res.ambiguous?.map((r) => ({ roomCode: r.roomCode, name: r.name })),
            };
          }
          const r = res.match;
          const resolvedRange = resolveNaturalDateQuery(period);
          const roomHist = energyHistoryService.getRoomHistory({
            roomId: r.id,
            preset: resolvedRange.preset,
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
            settings,
          });
          return {
            found: true,
            roomCode: r.roomCode,
            name: r.name,
            currentPowerWatts: r.currentPowerWatts,
            baselinePowerWatts: r.baselinePowerWatts,
            history: roomHist,
          };
        }

        case 'compare_classrooms': {
          const resA = resolveClassroom(rooms, typeof args.roomQueryA === 'string' ? args.roomQueryA : '');
          const resB = resolveClassroom(rooms, typeof args.roomQueryB === 'string' ? args.roomQueryB : '');
          if (!resA.match || !resB.match) {
            return {
              found: false,
              message: 'Could not uniquely resolve both classrooms to compare.',
              matchesA: resA.ambiguous?.map((r) => `${r.roomCode} (${r.name})`),
              matchesB: resB.ambiguous?.map((r) => `${r.roomCode} (${r.name})`),
            };
          }
          const summarize = (r: Classroom) => ({
            roomCode: r.roomCode,
            name: r.name,
            building: r.building,
            roomActivity: formatVoiceRoomActivity(r),
            configuredSeatCapacity: r.capacity,
            currentPowerWatts: r.currentPowerWatts,
            baselinePowerWatts: r.baselinePowerWatts,
            dailyActualKWh: r.dailyActualKWh,
            dailySavedKWh: Number(Math.max(0, r.dailyBaselineKWh - r.dailyActualKWh).toFixed(2)),
            ambientLux: r.environment.ambientLux,
            temperatureC: r.environment.temperature,
          });
          return {
            classroomA: summarize(resA.match),
            classroomB: summarize(resB.match),
            dataClassification: 'Simulated Node Comparison & Calculated Savings',
          };
        }

        case 'get_occupancy_status': {
          const query = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          if (query) {
            const res = resolveClassroom(rooms, query);
            if (!res.match) {
              return { found: false, matches: res.ambiguous?.map((r) => `${r.roomCode} (${r.name})`) };
            }
            return {
              found: true,
              roomCode: res.match.roomCode,
              name: res.match.name,
              roomActivity: formatVoiceRoomActivity(res.match),
              configuredSeatCapacity: res.match.capacity,
              pir: res.match.pir,
              note: 'PIR detects physical movement only, not headcounts. Use Space Intelligence for register attendance.',
              dataClassification: 'Simulated PIR Motion Sensor State',
            };
          }
          return {
            totalRooms: rooms.length,
            motionDetectedRoomsCount: summary.motionDetectedRoomsCount,
            noRecentMotionRoomsCount: summary.noRecentMotionRoomsCount,
            totalConfiguredSeatCapacity: summary.totalConfiguredSeatCapacity,
            noRecentMotionRooms: rooms
              .filter((r) => formatVoiceRoomActivity(r) !== 'Motion detected')
              .map((r) => ({ roomCode: r.roomCode, name: r.name, currentPowerWatts: r.currentPowerWatts })),
            note: 'PIR detects movement only, never individual student counts. Register attendance is tracked in Space Intelligence.',
            dataClassification: 'Simulated Campus PIR Motion Overview',
          };
        }

        case 'get_lighting_status': {
          const query = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          if (query) {
            const res = resolveClassroom(rooms, query);
            if (!res.match) return { found: false, message: `No single classroom matched "${query}".` };
            const lights = res.match.appliances.filter((a) => a.type === 'lights');
            return {
              found: true,
              roomCode: res.match.roomCode,
              name: res.match.name,
              totalLightingWatts: lights.reduce((acc, l) => acc + l.currentPowerWatts, 0),
              units: lights.map((l) => ({
                id: l.id,
                unitCode: l.unitCode,
                name: l.name,
                outputPercent: l.outputPercent ?? 0,
                currentPowerWatts: l.currentPowerWatts,
                operatingMode: l.operatingMode || 'AUTO',
              })),
            };
          }
          const topLighting = [...rooms]
            .map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              lightingWatts: r.appliances.filter((a) => a.type === 'lights').reduce((acc, a) => acc + a.currentPowerWatts, 0),
            }))
            .sort((a, b) => b.lightingWatts - a.lightingWatts)
            .slice(0, 6);
          return { topLightingConsumers: topLighting, dataClassification: 'Simulated Lighting Node State' };
        }

        case 'get_fan_status': {
          const query = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          if (query) {
            const res = resolveClassroom(rooms, query);
            if (!res.match) return { found: false, message: `No single classroom matched "${query}".` };
            const fans = res.match.appliances.filter((a) => a.type === 'fan');
            return {
              found: true,
              roomCode: res.match.roomCode,
              name: res.match.name,
              totalFanWatts: fans.reduce((acc, f) => acc + f.currentPowerWatts, 0),
              sectors: fans.map((f) => ({
                id: f.id,
                unitCode: f.unitCode,
                name: f.name,
                outputPercent: f.outputPercent ?? 0,
                fanSpeed: f.fanSpeed ?? 0,
                currentPowerWatts: f.currentPowerWatts,
                operatingMode: f.operatingMode || 'AUTO',
              })),
            };
          }
          const topFans = [...rooms]
            .map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              fanWatts: r.appliances.filter((a) => a.type === 'fan').reduce((acc, a) => acc + a.currentPowerWatts, 0),
            }))
            .sort((a, b) => b.fanWatts - a.fanWatts)
            .slice(0, 6);
          return { topFanConsumers: topFans, dataClassification: 'Simulated BLDC Fan Node State' };
        }

        case 'get_appliance_configuration': {
          const query = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          const res = resolveClassroom(rooms, query);
          if (!res.match) return { found: false, message: `No single classroom matched "${query}".` };
          return {
            found: true,
            roomCode: res.match.roomCode,
            name: res.match.name,
            totalPowerWatts: res.match.currentPowerWatts,
            appliances: res.match.appliances.map((a) => ({
              id: a.id,
              unitCode: a.unitCode,
              name: a.name,
              type: a.type,
              powerRatingWatts: a.powerRatingWatts,
              currentPowerWatts: a.currentPowerWatts,
              outputPercent: a.outputPercent ?? 0,
              operatingMode: a.operatingMode || (a.isManualOverride ? 'MANUAL' : 'AUTO'),
            })),
          };
        }

        case 'identify_unusual_consumption': {
          const liveFindings = evaluateLiveAuditFindings(
            rooms,
            settings,
            currentSnapshot.resolvedFindingIds
          );
          const manualOverrides = rooms
            .filter((r) => r.appliances.some((a) => a.operatingMode === 'MANUAL' || a.isManualOverride))
            .map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              occupancyStatus: r.occupancyStatus,
              currentPowerWatts: r.currentPowerWatts,
              manualUnits: r.appliances
                .filter((a) => a.operatingMode === 'MANUAL' || a.isManualOverride)
                .map((a) => `${a.unitCode || a.name} (${a.outputPercent}%)`),
            }));

          const highUtilization = rooms
            .map((r) => {
              const ratedW =
                r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances);
              return { r, ratedW, ratio: ratedW > 0 ? r.currentPowerWatts / ratedW : 0 };
            })
            .filter(({ ratio }) => ratio >= 0.72)
            .map(({ r, ratedW, ratio }) => ({
              roomCode: r.roomCode,
              name: r.name,
              utilizationPercent: Math.round(ratio * 100),
              currentPowerWatts: r.currentPowerWatts,
              ratedPowerWatts: ratedW,
              baselinePowerWatts: r.baselinePowerWatts,
            }));

          const openAuditAlerts = liveFindings
            .filter((f) => !f.isResolved)
            .map((f) => ({
              id: f.id,
              roomCode: f.roomCode,
              classroomName: f.classroomName,
              severity: f.severity,
              type: f.type,
              title: f.title,
              estimatedWasteWatts: f.estimatedWasteWatts,
            }));

          return {
            manualOverrideRooms: manualOverrides,
            highLoadRatioRooms: highUtilization,
            unresolvedAuditAlerts: openAuditAlerts,
            dataClassification: 'Live Room-Wise Anomaly Scan over Simulated Node Telemetry',
          };
        }

        case 'identify_vacant_classroom_consumption': {
          const vacantWithLoad = rooms
            .filter((r) => r.occupancyStatus === 'Unoccupied' && r.currentPowerWatts > 0)
            .map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              building: r.building,
              roomActivity: formatVoiceRoomActivity(r),
              currentPowerWatts: r.currentPowerWatts,
              activeUnits: r.appliances
                .filter((a) => a.currentPowerWatts > 0)
                .map((a) => `${a.unitCode || a.name}: ${a.outputPercent}% (${a.currentPowerWatts}W)`),
            }));
          const allNoMotion = rooms.filter((r) => r.occupancyStatus === 'Unoccupied').length;
          return {
            totalRoomsWithNoRecentMotion: allNoMotion,
            noMotionRoomsDrawingPowerCount: vacantWithLoad.length,
            noMotionRoomsDrawingPower: vacantWithLoad,
            dataClassification: 'Simulated PIR Motion & Load Correlation',
          };
        }

        case 'generate_energy_audit_summary': {
          const liveFindings = evaluateLiveAuditFindings(
            rooms,
            settings,
            currentSnapshot.resolvedFindingIds
          );
          const open = liveFindings.filter((f) => !f.isResolved);
          const resolved = liveFindings.filter((f) => f.isResolved);
          const openWasteWatts = open.reduce((acc, f) => acc + f.estimatedWasteWatts, 0);
          const openMonthlyCostINR = open.reduce((acc, f) => acc + f.monthlyCostWasteINR, 0);
          const ecbcCompliancePercent = computeEcbcCompliancePercent(liveFindings, rooms.length);
          return {
            ecbcCompliancePercent,
            openFindingsCount: open.length,
            resolvedFindingsCount: resolved.length,
            openWasteWatts,
            openMonthlyCostWasteINR: Number(openMonthlyCostINR.toFixed(2)),
            openFindings: open.map((f) => ({
              id: f.id,
              roomCode: f.roomCode,
              classroomName: f.classroomName,
              severity: f.severity,
              type: f.type,
              title: f.title,
              estimatedWasteWatts: f.estimatedWasteWatts,
              monthlyCostWasteINR: f.monthlyCostWasteINR,
              remediationAction: f.remediationAction,
            })),
            dataClassification: 'Live Room-Wise Energy Audit Model',
          };
        }

        case 'explain_energy_trend': {
          const topSavers = [...rooms]
            .map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              savedKWh: Number(Math.max(0, r.dailyBaselineKWh - r.dailyActualKWh).toFixed(2)),
              daylightAlpha: r.calibration.learnedParameters.daylightPenetrationAlpha,
              naturalDaylightLux: r.environment.naturalDaylightLux,
            }))
            .sort((a, b) => b.savedKWh - a.savedKWh)
            .slice(0, 5);
          return {
            campusSavingsPercent: summary.savingsPercent,
            learningMode: settings.learningMode,
            topDaylightAndAdaptiveSavers: topSavers,
            highestCurrentConsumers: [...rooms]
              .sort((a, b) => b.currentPowerWatts - a.currentPowerWatts)
              .slice(0, 5)
              .map((r) => ({
                roomCode: r.roomCode,
                name: r.name,
                currentPowerWatts: r.currentPowerWatts,
                type: r.type,
              })),
            dataClassification: 'Engineering Interpretation of Simulated Telemetry',
          };
        }

        case 'navigate_roomwise': {
          const target = typeof args.target === 'string' ? args.target : 'dashboard';
          const allowedTargets = new Set([
            'dashboard',
            'digital-twin',
            'classrooms',
            'analytics',
            'history',
            'space-intelligence',
            'audit',
            'reports',
            'settings',
            'admin-login',
            'classroom',
          ]);
          if (!allowedTargets.has(target)) {
            return { ok: false, error: `Navigation target "${target}" is not supported.` };
          }

          const action: VoiceClientNavigationAction = {
            target: target as VoiceClientNavigationAction['target'],
          };

          if (target === 'classroom') {
            const rq = typeof args.roomQuery === 'string' ? args.roomQuery : '';
            const res = resolveClassroom(rooms, rq);
            if (!res.match) {
              return {
                ok: false,
                ambiguous: Boolean(res.ambiguous),
                matches: res.ambiguous?.map((r) => `${r.roomCode} (${r.name})`),
                message: `Clarify which classroom to open for "${rq}".`,
              };
            }
            action.roomId = res.match.id;
            action.roomCode = res.match.roomCode;
            action.openQrPlacard = Boolean(args.openQrPlacard);
          }

          sendJson({ type: 'client_navigation', action });
          sendJson({
            type: 'tool_status',
            toolName: 'navigate_roomwise',
            status: 'completed',
            message:
              action.target === 'classroom'
                ? `Opened ${action.roomCode}`
                : `Navigated to ${action.target}`,
          });

          return {
            ok: true,
            navigatedTo: action.target,
            roomCode: action.roomCode,
          };
        }

        case 'control_classroom_appliance': {
          // 1. Live Server-Side Authentication Check (never trust wake-word or client flag)
          if (!adminIdentity) {
            sendJson({
              type: 'tool_status',
              toolName: 'control_classroom_appliance',
              status: 'denied',
              message: 'Blocked: Administrator authentication required',
            });
            return {
              ok: false,
              authorized: false,
              error:
                'PERMISSION_DENIED: Appliance control is blocked in Student Mode. Only a signed-in ROOMWISE administrator can modify classroom lights or fans.',
              actionRequired: 'admin_login',
            };
          }

          const roomQuery = typeof args.roomQuery === 'string' ? args.roomQuery : '';
          const resolvedRoom = resolveClassroom(rooms, roomQuery);
          if (resolvedRoom.ambiguous) {
            return {
              ok: false,
              ambiguous: true,
              matches: resolvedRoom.ambiguous.map((r) => ({ roomCode: r.roomCode, name: r.name })),
              message: 'Multiple classrooms matched. Ask the administrator to confirm the exact classroom.',
            };
          }
          if (!resolvedRoom.match) {
            return { ok: false, error: `No classroom found matching "${roomQuery}".` };
          }

          const room = resolvedRoom.match;
          const targetType = typeof args.targetType === 'string' ? args.targetType : 'unit';
          const mode = typeof args.mode === 'string' ? args.mode : 'set';
          const unitQuery = typeof args.unitQuery === 'string' ? args.unitQuery : '';
          const confirmed = Boolean(args.confirmed);
          const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;

          if (mode === 'set' && (typeof args.outputPercent !== 'number' || !Number.isFinite(args.outputPercent))) {
            return { ok: false, error: 'Numeric outputPercent (0 to 100) is required when mode is "set".' };
          }
          const clampedPct =
            typeof args.outputPercent === 'number'
              ? Math.max(0, Math.min(100, Math.round(args.outputPercent)))
              : 0;

          let action: ServerApplianceCommandInput['action'];
          let targetUnit: Appliance | null = null;
          let groupType: ServerApplianceCommandInput['type'] | undefined;
          let affectedCount = 1;
          let targetDesc = '';

          if (targetType === 'room_auto') {
            action = 'restore_room_auto';
            affectedCount = room.appliances.length;
            targetDesc = `All ${affectedCount} appliances in ${room.name} (${room.roomCode}) -> Adaptive AUTO`;
          } else if (
            targetType === 'lights_group' ||
            targetType === 'fans_group' ||
            targetType === 'projector_group' ||
            targetType === 'ac_group' ||
            targetType === 'all_group'
          ) {
            groupType =
              targetType === 'lights_group'
                ? 'lights'
                : targetType === 'fans_group'
                ? 'fan'
                : targetType === 'projector_group'
                ? 'projector'
                : targetType === 'ac_group'
                ? 'ac'
                : 'all';
            action = mode === 'restore_auto' ? 'restore_room_auto' : 'set_group';
            const matchedApps =
              groupType === 'all'
                ? room.appliances
                : room.appliances.filter((a) => a.type === groupType);
            affectedCount = matchedApps.length;
            const groupLabel =
              groupType === 'all'
                ? 'appliances'
                : groupType === 'lights'
                ? 'lights'
                : groupType === 'fan'
                ? 'fan sectors'
                : groupType === 'projector'
                ? 'projectors'
                : 'AC units';
            targetDesc =
              mode === 'restore_auto'
                ? `All ${affectedCount} ${groupLabel} in ${room.name} -> AUTO`
                : `All ${affectedCount} ${groupLabel} in ${room.name} -> ${clampedPct === 0 ? 'OFF' : `${clampedPct}%`}`;
          } else {
            if (!unitQuery) {
              return {
                ok: false,
                error: 'unitQuery is required when targetType is "unit". List units with get_appliance_configuration first.',
              };
            }
            targetUnit = resolveApplianceUnit(room.appliances, unitQuery);
            if (!targetUnit) {
              return {
                ok: false,
                error: `Appliance "${unitQuery}" not found in ${room.roomCode}.`,
                availableUnits: room.appliances.map((a) => `${a.unitCode || a.id}: ${a.name}`),
              };
            }
            action = mode === 'restore_auto' ? 'restore_unit_auto' : 'set_unit';
            targetDesc = `${targetUnit.unitCode || targetUnit.name} in ${room.name} (${room.roomCode}) -> ${
              mode === 'restore_auto' ? 'Adaptive AUTO' : clampedPct === 0 ? 'OFF' : `${clampedPct}%`
            }`;
          }

          // Require explicit confirmation ONLY if confirmed===false is explicitly passed
          const isExplicitPreview = args.confirmed === false;
          if (isExplicitPreview) {
            return {
              ok: false,
              confirmationRequired: true,
              preview: {
                roomCode: room.roomCode,
                roomName: room.name,
                roomActivity: formatVoiceRoomActivity(room),
                targetDescription: targetDesc,
                affectedUnitsCount: affectedCount,
                currentRoomPowerWatts: room.currentPowerWatts,
              },
              message:
                'Confirmation required before applying this override. Briefly describe the planned change and ask the administrator to confirm.',
            };
          }

          const result = deps.executeApplianceCommand({
            roomId: room.id,
            action,
            applianceId: targetUnit?.id,
            type: groupType,
            outputPercent: clampedPct,
            isVacant,
            admin: adminIdentity,
          });

          if (!result.ok || !result.appliances) {
            return { ok: false, error: result.error || 'Failed to execute appliance command.' };
          }

          // Keep session snapshot current
          currentSnapshot.classrooms = currentSnapshot.classrooms.map((c) => {
            if (c.id !== room.id) return c;
            const updatedWatts = result.totalPowerWatts ?? c.currentPowerWatts;
            const ratedW = computeAppliancesRatedPowerWatts(result.appliances!);
            return {
              ...c,
              appliances: result.appliances!,
              currentPowerWatts: updatedWatts,
              ratedPowerWatts: ratedW,
              dailyActualKWh: Number(((updatedWatts * OPERATING_HOURS_PER_DAY) / 1000).toFixed(2)),
            };
          });
          const postSingleSummary = computeDerivedCampusSummary(
            mergeSnapshotWithServerAppliances(currentSnapshot, deps),
            settings
          );

          sendJson({
            type: 'appliance_state_updated',
            payload: {
              roomId: room.id,
              roomCode: room.roomCode,
              appliances: result.appliances,
              totalPowerWatts: result.totalPowerWatts ?? 0,
              summary: result.summary || targetDesc,
            },
          });
          sendJson({
            type: 'tool_status',
            toolName: 'control_classroom_appliance',
            status: 'completed',
            message: result.summary || targetDesc,
          });

          return {
            ok: true,
            authorizedBy: adminIdentity.adminName,
            roomCode: room.roomCode,
            roomName: room.name,
            summary: result.summary || targetDesc,
            newTotalPowerWatts: result.totalPowerWatts,
            campusTotalCurrentPowerWatts: postSingleSummary.totalCurrentPowerWatts,
            campusTotalCurrentPowerKW: postSingleSummary.totalCurrentPowerKW,
            campusInstalledRatedMaxKW: postSingleSummary.totalRatedPowerKW,
          };
        }

        case 'control_building_or_campus_appliances': {
          if (!adminIdentity) {
            sendJson({
              type: 'tool_status',
              toolName: 'control_building_or_campus_appliances',
              status: 'denied',
              message: 'Blocked: Administrator authentication required for batch control',
            });
            return {
              ok: false,
              authorized: false,
              error:
                'PERMISSION_DENIED: Building-wide and campus-wide appliance controls require a signed-in ROOMWISE administrator.',
              actionRequired: 'admin_login',
            };
          }

          const rawScope = typeof args.scope === 'string' ? args.scope : 'campus';
          const scope: BatchApplianceControlInput['scope'] =
            rawScope === 'building' || rawScope === 'floor' || rawScope === 'vacant_only'
              ? rawScope
              : 'campus';
          const building = typeof args.building === 'string' ? args.building.trim() : undefined;
          const floor = typeof args.floor === 'string' ? args.floor.trim() : undefined;
          const rawTarget = typeof args.targetType === 'string' ? args.targetType : 'lights';
          const targetType: BatchApplianceControlInput['targetType'] =
            rawTarget === 'fan' || rawTarget === 'projector' || rawTarget === 'ac' || rawTarget === 'all'
              ? rawTarget
              : 'lights';
          const mode: BatchApplianceControlInput['mode'] =
            args.mode === 'restore_auto' ? 'restore_auto' : 'set';
          const outputPercent =
            typeof args.outputPercent === 'number' && Number.isFinite(args.outputPercent)
              ? Math.max(0, Math.min(100, Math.round(args.outputPercent)))
              : undefined;

          if (mode === 'set' && outputPercent === undefined) {
            return {
              ok: false,
              error: 'Numeric outputPercent (0 to 100) is required when mode is "set".',
            };
          }

          if (args.confirmed === false) {
            const matched = rooms.filter((r) => {
              if (scope === 'vacant_only' && r.occupancyStatus === 'Occupied' && r.currentOccupants > 0) {
                return false;
              }
              if (building && !r.building.toLowerCase().includes(building.toLowerCase())) return false;
              if (floor && !r.floor.toLowerCase().includes(floor.toLowerCase())) return false;
              return true;
            });
            return {
              ok: false,
              confirmationRequired: true,
              preview: {
                scope,
                building: building || 'All Buildings',
                floor: floor || 'All Floors',
                targetType,
                mode,
                outputPercent,
                matchedRoomsCount: matched.length,
                sampleRooms: matched.slice(0, 6).map((r) => `${r.roomCode} (${r.name})`),
              },
              message: 'Ask the administrator to confirm this multi-room batch change.',
            };
          }

          const roomMetaById: NonNullable<BatchApplianceControlInput['roomMetaById']> = {};
          for (const r of rooms) {
            const isVacant = r.occupancyStatus === 'Unoccupied' || r.currentOccupants === 0;
            roomMetaById[r.id] = {
              building: r.building,
              floor: r.floor,
              isVacant,
              targetLightPercent: isVacant ? 0 : computeAdaptiveTargetLightPercent(r),
              targetFanPercent: isVacant ? 0 : computeAdaptiveTargetFanPercent(r),
            };
          }

          const batchResult = deps.executeBatchApplianceControl({
            scope,
            building,
            floor,
            targetType,
            mode,
            outputPercent,
            roomMetaById,
            admin: adminIdentity,
          });

          if (!batchResult.ok) {
            return { ok: false, error: batchResult.error };
          }

          const touchedMap = new Map(batchResult.optimizedRooms.map((r) => [r.roomId, r]));
          currentSnapshot.classrooms = currentSnapshot.classrooms.map((c) => {
            const o = touchedMap.get(c.id);
            if (!o) return c;
            const ratedW = computeAppliancesRatedPowerWatts(o.appliances);
            return {
              ...c,
              appliances: o.appliances,
              currentPowerWatts: o.totalPowerWatts,
              ratedPowerWatts: ratedW,
              dailyActualKWh: Number(((o.totalPowerWatts * OPERATING_HOURS_PER_DAY) / 1000).toFixed(2)),
            };
          });
          const postBatchSummary = computeDerivedCampusSummary(
            mergeSnapshotWithServerAppliances(currentSnapshot, deps),
            settings
          );

          sendJson({
            type: 'campus_optimized',
            payload: {
              optimizedRooms: batchResult.optimizedRooms,
              resolvedFindingIds: [],
              curtailedWatts: batchResult.curtailedWatts,
              summary: batchResult.summary,
            },
          });
          sendJson({
            type: 'tool_status',
            toolName: 'control_building_or_campus_appliances',
            status: 'completed',
            message: batchResult.summary,
          });

          return {
            ok: true,
            authorizedBy: adminIdentity.adminName,
            affectedRoomsCount: batchResult.optimizedRooms.length,
            affectedRoomCodes: batchResult.affectedRoomCodes,
            curtailedWatts: batchResult.curtailedWatts,
            deltaWatts: batchResult.deltaWatts,
            campusTotalCurrentPowerWatts: postBatchSummary.totalCurrentPowerWatts,
            campusTotalCurrentPowerKW: postBatchSummary.totalCurrentPowerKW,
            campusInstalledRatedMaxWatts: postBatchSummary.totalRatedPowerWatts,
            campusInstalledRatedMaxKW: postBatchSummary.totalRatedPowerKW,
            campusRatedUtilizationPercent: postBatchSummary.ratedUtilizationPercent,
            campusEstimatedPreRetrofitReferenceKW: postBatchSummary.totalBaselinePowerKW,
            installedCapacityDifferenceWatts: postBatchSummary.installedCapacityDifferenceWatts,
            reconciliationNote: `Live campus load is ${postBatchSummary.totalCurrentPowerKW} kW (${postBatchSummary.ratedUtilizationPercent}% of ${postBatchSummary.totalRatedPowerKW} kW Installed Rated Maximum; Estimated Pre-Retrofit Reference Capacity is ${formatCapacityKW(postBatchSummary.totalBaselinePowerWatts)} kW).`,
            summary: batchResult.summary,
          };
        }

        case 'optimize_campus_energy': {
          if (!adminIdentity) {
            sendJson({
              type: 'tool_status',
              toolName: 'optimize_campus_energy',
              status: 'denied',
              message: 'Blocked: Administrator authentication required for campus optimization',
            });
            return {
              ok: false,
              authorized: false,
              error:
                'PERMISSION_DENIED: Campus-wide optimization and Energy Audit remediation require an authenticated ROOMWISE administrator.',
              actionRequired: 'admin_login',
            };
          }

          const rawScope = typeof args.scope === 'string' ? args.scope : 'all';
          const scope: CampusOptimizationInput['scope'] =
            rawScope === 'vacant_only' || rawScope === 'room' ? rawScope : 'all';
          const confirmed = args.confirmed === undefined ? true : Boolean(args.confirmed);

          let targetRoom: Classroom | undefined;
          if (scope === 'room') {
            const rq = typeof args.roomQuery === 'string' ? args.roomQuery : '';
            const res = resolveClassroom(rooms, rq);
            if (res.ambiguous) {
              return {
                ok: false,
                ambiguous: true,
                matches: res.ambiguous.map((r) => ({ roomCode: r.roomCode, name: r.name })),
                message: 'Multiple classrooms matched that query. Please clarify which room to optimize.',
              };
            }
            if (!res.match) {
              return { ok: false, error: `No classroom found matching "${rq}".` };
            }
            targetRoom = res.match;
          }

          const liveFindings = evaluateLiveAuditFindings(
            rooms,
            settings,
            currentSnapshot.resolvedFindingIds
          );
          const relevantOpenFindings = liveFindings.filter((f) => {
            if (f.isResolved) return false;
            if (scope === 'room' && targetRoom) return f.classroomId === targetRoom.id;
            if (scope === 'vacant_only') return f.type === 'empty_room_runtime' || f.type === 'phantom_load';
            return true;
          });

          const previewWasteWatts = relevantOpenFindings.reduce(
            (acc, f) => acc + f.estimatedWasteWatts,
            0
          );
          const previewMonthlyINR = relevantOpenFindings.reduce(
            (acc, f) => acc + f.monthlyCostWasteINR,
            0
          );

          if (!confirmed) {
            return {
              ok: false,
              confirmationRequired: true,
              preview: {
                scope,
                targetRoom: targetRoom ? `${targetRoom.roomCode} (${targetRoom.name})` : 'All 25 Campus Nodes',
                openFindingsCount: relevantOpenFindings.length,
                estimatedWasteWatts: previewWasteWatts,
                estimatedMonthlyCostWasteINR: Number(previewMonthlyINR.toFixed(2)),
                sampleFindings: relevantOpenFindings.slice(0, 5).map((f) => ({
                  roomCode: f.roomCode,
                  title: f.title,
                  estimatedWasteWatts: f.estimatedWasteWatts,
                })),
              },
              message:
                'Summarize this optimization preview and ask the administrator to confirm execution.',
            };
          }

          const roomTargets: NonNullable<CampusOptimizationInput['roomTargets']> = {};
          for (const room of rooms) {
            const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
            roomTargets[room.id] = {
              isVacant,
              targetLightPercent: isVacant ? 0 : computeAdaptiveTargetLightPercent(room),
              targetFanPercent: isVacant ? 0 : computeAdaptiveTargetFanPercent(room),
            };
          }

          const optResult = deps.executeCampusOptimization({
            scope,
            roomId: targetRoom?.id,
            roomTargets,
            sourceLabel: 'Voice One-Click Campus Optimization',
            admin: adminIdentity,
          });

          if (!optResult.ok) {
            return { ok: false, error: optResult.error || 'Optimization failed on controller.' };
          }

          const resolvedFindingIds = relevantOpenFindings.map((f) => f.id);
          const mergedResolved = Array.from(
            new Set([...currentSnapshot.resolvedFindingIds, ...resolvedFindingIds])
          );
          currentSnapshot.resolvedFindingIds = mergedResolved;

          const optMap = new Map(optResult.optimizedRooms.map((r) => [r.roomId, r]));
          currentSnapshot.classrooms = currentSnapshot.classrooms.map((c) => {
            const o = optMap.get(c.id);
            if (!o) return c;
            return {
              ...c,
              appliances: o.appliances,
              currentPowerWatts: o.totalPowerWatts,
              ratedPowerWatts: computeAppliancesRatedPowerWatts(o.appliances),
              dailyActualKWh: Number(((o.totalPowerWatts * OPERATING_HOURS_PER_DAY) / 1000).toFixed(2)),
            };
          });
          const postOptSummary = computeDerivedCampusSummary(
            mergeSnapshotWithServerAppliances(currentSnapshot, deps),
            settings
          );

          const totalCurtailedWatts =
            optResult.curtailedWatts > 0 ? optResult.curtailedWatts : previewWasteWatts;

          sendJson({
            type: 'campus_optimized',
            payload: {
              optimizedRooms: optResult.optimizedRooms,
              resolvedFindingIds,
              curtailedWatts: totalCurtailedWatts,
              summary: optResult.summary,
            },
          });
          sendJson({
            type: 'tool_status',
            toolName: 'optimize_campus_energy',
            status: 'completed',
            message: optResult.summary,
          });

          return {
            ok: true,
            authorizedBy: adminIdentity.adminName,
            scope,
            remediatedFindingsCount: relevantOpenFindings.length,
            optimizedRoomsCount: optResult.optimizedRooms.length,
            curtailedWatts: totalCurtailedWatts,
            campusTotalCurrentPowerWatts: postOptSummary.totalCurrentPowerWatts,
            campusTotalCurrentPowerKW: postOptSummary.totalCurrentPowerKW,
            campusInstalledRatedMaxKW: postOptSummary.totalRatedPowerKW,
            summary: optResult.summary,
          };
        }

        case 'resolve_audit_finding': {
          if (!adminIdentity) {
            sendJson({
              type: 'tool_status',
              toolName: 'resolve_audit_finding',
              status: 'denied',
              message: 'Blocked: Administrator authentication required to resolve audit findings',
            });
            return {
              ok: false,
              authorized: false,
              error:
                'PERMISSION_DENIED: Only an authenticated ROOMWISE administrator can resolve energy audit findings.',
              actionRequired: 'admin_login',
            };
          }

          const liveFindings = evaluateLiveAuditFindings(
            rooms,
            settings,
            currentSnapshot.resolvedFindingIds
          );
          const findingId = typeof args.findingId === 'string' ? args.findingId.trim() : '';
          const rq = typeof args.roomQuery === 'string' ? args.roomQuery.trim() : '';

          let targetFinding = findingId
            ? liveFindings.find((f) => f.id === findingId)
            : undefined;
          let targetRoom: Classroom | undefined;

          if (!targetFinding && rq) {
            const resolved = resolveClassroom(rooms, rq);
            if (resolved.match) {
              targetRoom = resolved.match;
              targetFinding =
                liveFindings.find((f) => f.classroomId === targetRoom!.id && !f.isResolved) ||
                liveFindings.find((f) => f.classroomId === targetRoom!.id);
            }
          }

          if (targetFinding && !targetRoom) {
            targetRoom = rooms.find((r) => r.id === targetFinding!.classroomId);
          }

          if (!targetRoom) {
            return {
              ok: false,
              error: 'No matching audit finding or classroom found to resolve.',
              openFindings: liveFindings
                .filter((f) => !f.isResolved)
                .map((f) => ({ id: f.id, roomCode: f.roomCode, title: f.title })),
            };
          }

          const isVacant = targetRoom.occupancyStatus === 'Unoccupied' || targetRoom.currentOccupants === 0;
          const optResult = deps.executeCampusOptimization({
            scope: 'room',
            roomId: targetRoom.id,
            roomTargets: {
              [targetRoom.id]: {
                isVacant,
                targetLightPercent: isVacant ? 0 : computeAdaptiveTargetLightPercent(targetRoom),
                targetFanPercent: isVacant ? 0 : computeAdaptiveTargetFanPercent(targetRoom),
              },
            },
            sourceLabel: `Voice Audit Fix (${targetRoom.roomCode})`,
            admin: adminIdentity,
          });

          if (!optResult.ok) {
            return { ok: false, error: optResult.error };
          }

          const matchingFindingIds = liveFindings
            .filter((f) => f.classroomId === targetRoom!.id && (!findingId || f.id === findingId))
            .map((f) => f.id);
          currentSnapshot.resolvedFindingIds = Array.from(
            new Set([...currentSnapshot.resolvedFindingIds, ...matchingFindingIds])
          );

          const optMap = new Map(optResult.optimizedRooms.map((r) => [r.roomId, r]));
          currentSnapshot.classrooms = currentSnapshot.classrooms.map((c) => {
            const o = optMap.get(c.id);
            return o ? { ...c, appliances: o.appliances, currentPowerWatts: o.totalPowerWatts } : c;
          });

          const totalCurtailed =
            optResult.curtailedWatts > 0
              ? optResult.curtailedWatts
              : targetFinding?.estimatedWasteWatts || 0;

          sendJson({
            type: 'campus_optimized',
            payload: {
              optimizedRooms: optResult.optimizedRooms,
              resolvedFindingIds: matchingFindingIds,
              curtailedWatts: totalCurtailed,
              summary: optResult.summary,
            },
          });
          sendJson({
            type: 'tool_status',
            toolName: 'resolve_audit_finding',
            status: 'completed',
            message: optResult.summary,
          });

          return {
            ok: true,
            authorizedBy: adminIdentity.adminName,
            roomCode: targetRoom.roomCode,
            resolvedFindingIds: matchingFindingIds,
            curtailedWatts: totalCurtailed,
            summary: optResult.summary,
          };
        }

        case 'recalibrate_classroom': {
          if (!adminIdentity) {
            sendJson({
              type: 'tool_status',
              toolName: 'recalibrate_classroom',
              status: 'denied',
              message: 'Blocked: Administrator authentication required for calibration',
            });
            return {
              ok: false,
              authorized: false,
              error:
                'PERMISSION_DENIED: Only an authenticated administrator can run classroom sensor recalibration.',
              actionRequired: 'admin_login',
            };
          }

          const rawScope = typeof args.scope === 'string' ? args.scope : 'room';
          const rq = typeof args.roomQuery === 'string' ? args.roomQuery.trim() : '';
          const building = typeof args.building === 'string' ? args.building.trim() : '';

          let targetRooms: Classroom[] = [];
          if (rawScope === 'all') {
            targetRooms = rooms;
          } else if (rawScope === 'building' || (!rq && building)) {
            const bq = (building || rq).toLowerCase();
            targetRooms = rooms.filter((r) => r.building.toLowerCase().includes(bq));
          } else {
            const resolved = resolveClassroom(rooms, rq);
            if (resolved.ambiguous) {
              return {
                ok: false,
                ambiguous: true,
                matches: resolved.ambiguous.map((r) => ({ roomCode: r.roomCode, name: r.name })),
              };
            }
            if (resolved.match) targetRooms = [resolved.match];
          }

          if (targetRooms.length === 0) {
            return { ok: false, error: 'No matching classrooms found to recalibrate.' };
          }

          const roomIds = targetRooms.map((r) => r.id);
          const summaryMsg =
            targetRooms.length === 1
              ? `Recalibrated Bayesian α & β models for ${targetRooms[0].roomCode} (${targetRooms[0].name})`
              : `Recalibrated Bayesian α & β models across ${targetRooms.length} classroom nodes`;

          sendJson({
            type: 'room_recalibrated',
            roomIds,
            summary: summaryMsg,
          });
          sendJson({
            type: 'tool_status',
            toolName: 'recalibrate_classroom',
            status: 'completed',
            message: summaryMsg,
          });

          return {
            ok: true,
            authorizedBy: adminIdentity.adminName,
            recalibratedCount: targetRooms.length,
            roomCodes: targetRooms.map((r) => r.roomCode),
            summary: summaryMsg,
          };
        }

        case 'update_classroom_parameters': {
          if (!adminIdentity) {
            sendJson({
              type: 'tool_status',
              toolName: 'update_classroom_parameters',
              status: 'denied',
              message: 'Blocked: Administrator authentication required to edit room parameters',
            });
            return {
              ok: false,
              authorized: false,
              error:
                'PERMISSION_DENIED: Only an authenticated administrator can update classroom calibration setpoints.',
              actionRequired: 'admin_login',
            };
          }

          const rq = typeof args.roomQuery === 'string' ? args.roomQuery.trim() : '';
          const building = typeof args.building === 'string' ? args.building.trim() : '';
          let targetRooms: Classroom[] = [];

          if (building && !rq) {
            targetRooms = rooms.filter((r) =>
              r.building.toLowerCase().includes(building.toLowerCase())
            );
          } else if (rq) {
            const res = resolveClassroom(rooms, rq);
            if (res.ambiguous) {
              return {
                ok: false,
                ambiguous: true,
                matches: res.ambiguous.map((r) => ({ roomCode: r.roomCode, name: r.name })),
              };
            }
            if (res.match) targetRooms = [res.match];
          }

          if (targetRooms.length === 0) {
            return { ok: false, error: 'Specify a valid classroom or building to update parameters.' };
          }

          const params: {
            targetLux?: number;
            maxFanSpeed?: number;
            autoEcoMode?: boolean;
            overtimeAllowed?: boolean;
          } = {};
          const descParts: string[] = [];

          if (typeof args.targetLux === 'number' && Number.isFinite(args.targetLux)) {
            params.targetLux = Math.max(100, Math.min(800, Math.round(args.targetLux)));
            descParts.push(`targetLux ${params.targetLux} lx`);
          }
          if (typeof args.maxFanSpeed === 'number' && Number.isFinite(args.maxFanSpeed)) {
            params.maxFanSpeed = Math.max(1, Math.min(5, Math.round(args.maxFanSpeed)));
            descParts.push(`maxFanSpeed ${params.maxFanSpeed}`);
          }
          if (typeof args.autoEcoMode === 'boolean') {
            params.autoEcoMode = args.autoEcoMode;
            descParts.push(`autoEcoMode ${params.autoEcoMode ? 'ON' : 'OFF'}`);
          }
          if (typeof args.overtimeAllowed === 'boolean') {
            params.overtimeAllowed = args.overtimeAllowed;
            descParts.push(`overtimeAllowed ${params.overtimeAllowed ? 'ON' : 'OFF'}`);
          }

          if (descParts.length === 0) {
            return {
              ok: false,
              error: 'Provide at least one parameter: targetLux, maxFanSpeed, autoEcoMode, or overtimeAllowed.',
            };
          }

          const roomIds = targetRooms.map((r) => r.id);
          const targetIdSet = new Set(roomIds);
          currentSnapshot.classrooms = currentSnapshot.classrooms.map((c) =>
            targetIdSet.has(c.id)
              ? {
                  ...c,
                  calibration: {
                    ...c.calibration,
                    manualParameters: {
                      ...c.calibration.manualParameters,
                      ...params,
                    },
                  },
                }
              : c
          );

          const scopeDesc =
            targetRooms.length === 1
              ? `${targetRooms[0].roomCode} (${targetRooms[0].name})`
              : `${targetRooms.length} rooms in ${building || 'selected block'}`;
          const summaryMsg = `${scopeDesc}: updated ${descParts.join(', ')}`;

          sendJson({
            type: 'room_params_updated',
            roomIds,
            params,
            summary: summaryMsg,
          });
          sendJson({
            type: 'tool_status',
            toolName: 'update_classroom_parameters',
            status: 'completed',
            message: summaryMsg,
          });

          return {
            ok: true,
            authorizedBy: adminIdentity.adminName,
            updatedRoomsCount: targetRooms.length,
            params,
            summary: summaryMsg,
          };
        }

        case 'update_campus_settings': {
          if (!adminIdentity) {
            sendJson({
              type: 'tool_status',
              toolName: 'update_campus_settings',
              status: 'denied',
              message: 'Blocked: Administrator authentication required to modify settings',
            });
            return {
              ok: false,
              authorized: false,
              error:
                'PERMISSION_DENIED: Only an authenticated administrator can change tariff, lux targets, or learning policies.',
              actionRequired: 'admin_login',
            };
          }

          const patch: Partial<SchoolSettings> = {};
          const changes: string[] = [];

          if (typeof args.institutionName === 'string' && args.institutionName.trim()) {
            patch.institutionName = args.institutionName.trim();
            changes.push(`institution "${patch.institutionName}"`);
          }
          if (typeof args.campusLocation === 'string' && args.campusLocation.trim()) {
            patch.campusLocation = args.campusLocation.trim();
            changes.push(`location "${patch.campusLocation}"`);
          }
          if (typeof args.tariffPerKWhINR === 'number' && Number.isFinite(args.tariffPerKWhINR) && args.tariffPerKWhINR > 0) {
            patch.tariffPerKWhINR = Number(args.tariffPerKWhINR.toFixed(2));
            changes.push(`tariff ₹${patch.tariffPerKWhINR}/kWh`);
          }
          if (
            typeof args.gridCarbonFactorKgCO2PerKWh === 'number' &&
            Number.isFinite(args.gridCarbonFactorKgCO2PerKWh) &&
            args.gridCarbonFactorKgCO2PerKWh > 0
          ) {
            patch.gridCarbonFactorKgCO2PerKWh = Number(args.gridCarbonFactorKgCO2PerKWh.toFixed(3));
            changes.push(`carbon factor ${patch.gridCarbonFactorKgCO2PerKWh} kg/kWh`);
          }
          if (
            typeof args.standardClassroomTargetLux === 'number' &&
            Number.isFinite(args.standardClassroomTargetLux)
          ) {
            patch.standardClassroomTargetLux = Math.max(100, Math.min(800, Math.round(args.standardClassroomTargetLux)));
            changes.push(`classroom target ${patch.standardClassroomTargetLux} lx`);
          }
          if (typeof args.labTargetLux === 'number' && Number.isFinite(args.labTargetLux)) {
            patch.labTargetLux = Math.max(100, Math.min(900, Math.round(args.labTargetLux)));
            changes.push(`lab target ${patch.labTargetLux} lx`);
          }
          if (
            typeof args.defaultInactivityGraceMinutes === 'number' &&
            Number.isFinite(args.defaultInactivityGraceMinutes)
          ) {
            patch.defaultInactivityGraceMinutes = Math.max(1, Math.min(60, Math.round(args.defaultInactivityGraceMinutes)));
            changes.push(`PIR grace ${patch.defaultInactivityGraceMinutes} min`);
          }
          if (
            args.learningMode === 'Adaptive Active' ||
            args.learningMode === 'Conservative' ||
            args.learningMode === 'High Comfort'
          ) {
            patch.learningMode = args.learningMode;
            changes.push(`mode ${patch.learningMode}`);
          }
          if (typeof args.lowPowerMode === 'boolean') {
            patch.lowPowerMode = args.lowPowerMode;
            changes.push(`lowPowerMode ${args.lowPowerMode ? 'ON' : 'OFF'}`);
          }
          const hStart = typeof args.schoolHoursStart === 'string' ? args.schoolHoursStart.trim() : '';
          const hEnd = typeof args.schoolHoursEnd === 'string' ? args.schoolHoursEnd.trim() : '';
          if (hStart || hEnd) {
            patch.schoolHours = {
              start: hStart || currentSnapshot.settings.schoolHours.start,
              end: hEnd || currentSnapshot.settings.schoolHours.end,
            };
            changes.push(`hours ${patch.schoolHours.start}–${patch.schoolHours.end}`);
          }

          if (changes.length === 0) {
            return {
              ok: false,
              error: 'No valid settings parameter provided to update.',
            };
          }

          currentSnapshot.settings = { ...currentSnapshot.settings, ...patch };
          const summaryMsg = `Updated ${changes.join(', ')}`;

          sendJson({
            type: 'settings_updated',
            settings: patch,
            summary: summaryMsg,
          });
          sendJson({
            type: 'tool_status',
            toolName: 'update_campus_settings',
            status: 'completed',
            message: summaryMsg,
          });

          return {
            ok: true,
            authorizedBy: adminIdentity.adminName,
            updated: patch,
            summary: summaryMsg,
          };
        }

        case 'execute_app_action': {
          const kind = typeof args.action === 'string' ? args.action.trim() : '';
          const allowed = new Set<VoiceUiActionPayload['kind']>([
            'close_modals',
            'open_classroom_page',
            'open_phone_qr_scanner',
            'set_simulation',
            'export_analytics_csv',
            'print_audit_report',
            'logout_admin',
            'mute_standby',
            'close_overlay',
          ]);

          if (!allowed.has(kind as VoiceUiActionPayload['kind'])) {
            return { ok: false, error: `Unsupported app action '${kind}'.` };
          }

          if (kind === 'logout_admin' && !adminIdentity) {
            return {
              ok: false,
              error: 'Already in Student Mode (no active administrator session to sign out).',
            };
          }

          const payload: VoiceUiActionPayload = {
            kind: kind as VoiceUiActionPayload['kind'],
          };
          let summaryMsg = '';

          if (kind === 'open_classroom_page') {
            const rq = typeof args.roomQuery === 'string' ? args.roomQuery : '';
            const res = resolveClassroom(rooms, rq);
            if (!res.match) {
              return {
                ok: false,
                ambiguous: Boolean(res.ambiguous),
                matches: res.ambiguous?.map((r) => `${r.roomCode} (${r.name})`),
                error: `Clarify which classroom page to open for "${rq}".`,
              };
            }
            payload.roomCode = res.match.roomCode;
            summaryMsg = `Opened standalone telemetry page for ${res.match.roomCode} (${res.match.name})`;
          } else if (kind === 'set_simulation') {
            payload.enabled = typeof args.enabled === 'boolean' ? args.enabled : true;
            summaryMsg = payload.enabled ? 'Resumed live IoT telemetry drift simulation' : 'Paused live IoT drift simulation';
          } else if (kind === 'mute_standby') {
            payload.enabled = typeof args.enabled === 'boolean' ? args.enabled : true;
            summaryMsg = payload.enabled ? 'Muted wake-word standby' : 'Unmuted wake-word standby';
          } else if (kind === 'export_analytics_csv') {
            summaryMsg = `Exported ${rooms.length}-room Energy Audit CSV`;
          } else if (kind === 'print_audit_report') {
            summaryMsg = 'Opened BEE Energy Audit Report & Print Preview';
          } else if (kind === 'open_phone_qr_scanner') {
            summaryMsg = 'Opened Phone Computer QR Scanner';
          } else if (kind === 'close_modals') {
            summaryMsg = 'Closed open classroom & QR dialogs';
          } else if (kind === 'logout_admin') {
            summaryMsg = 'Initiated administrator logout';
          } else if (kind === 'close_overlay') {
            summaryMsg = 'Closed voice assistant overlay and returned to standby';
          }

          sendJson({
            type: 'ui_action',
            action: payload,
            summary: summaryMsg,
          });
          sendJson({
            type: 'tool_status',
            toolName: 'execute_app_action',
            status: 'completed',
            message: summaryMsg,
          });

          return { ok: true, action: kind, summary: summaryMsg };
        }

        case 'get_security_audit_and_staff': {
          return { ...deps.getSecurityAuditAndStaff(Boolean(adminIdentity)) };
        }

        case 'rank_and_filter_classrooms': {
          const sortBy = typeof args.sortBy === 'string' ? args.sortBy : 'power_desc';
          const bFilter = typeof args.building === 'string' ? args.building.toLowerCase().trim() : '';
          const occFilter = typeof args.occupancyFilter === 'string' ? args.occupancyFilter.toLowerCase().trim() : '';
          const limit =
            typeof args.limit === 'number' && Number.isFinite(args.limit)
              ? Math.max(1, Math.min(25, Math.round(args.limit)))
              : 5;

          const liveFindings = evaluateLiveAuditFindings(
            rooms,
            settings,
            currentSnapshot.resolvedFindingIds
          );
          const wasteByRoom = new Map<string, number>();
          for (const f of liveFindings) {
            if (!f.isResolved) {
              wasteByRoom.set(f.classroomId, (wasteByRoom.get(f.classroomId) || 0) + f.estimatedWasteWatts);
            }
          }

          let pool = rooms.filter((r) => {
            if (bFilter && !r.building.toLowerCase().includes(bFilter)) return false;
            if (occFilter && occFilter !== 'all' && r.occupancyStatus.toLowerCase() !== occFilter) return false;
            return true;
          });

          if (sortBy === 'manual_overrides') {
            pool = pool.filter((r) =>
              r.appliances.some((a) => a.operatingMode === 'MANUAL' || a.isManualOverride)
            );
          }

          const efficiencyOf = (r: Classroom) =>
            r.dailyBaselineKWh > 0 ? Math.max(0, r.dailyBaselineKWh - r.dailyActualKWh) / r.dailyBaselineKWh : 0;

          pool.sort((a, b) => {
            switch (sortBy) {
              case 'power_asc':
                return a.currentPowerWatts - b.currentPowerWatts;
              case 'waste_desc':
                return (wasteByRoom.get(b.id) || 0) - (wasteByRoom.get(a.id) || 0);
              case 'efficiency_desc':
                return efficiencyOf(b) - efficiencyOf(a);
              case 'efficiency_asc':
                return efficiencyOf(a) - efficiencyOf(b);
              case 'temperature_desc':
                return b.environment.temperature - a.environment.temperature;
              case 'co2_desc':
                return b.environment.co2Ppm - a.environment.co2Ppm;
              case 'daylight_asc':
                return a.environment.naturalDaylightLux - b.environment.naturalDaylightLux;
              case 'power_desc':
              default:
                return b.currentPowerWatts - a.currentPowerWatts;
            }
          });

          return {
            sortBy,
            totalMatched: pool.length,
            results: pool.slice(0, limit).map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              building: r.building,
              floor: r.floor,
              occupancyStatus: r.occupancyStatus,
              currentPowerWatts: r.currentPowerWatts,
              baselinePowerWatts: r.baselinePowerWatts,
              efficiencyPercent: Number((efficiencyOf(r) * 100).toFixed(1)),
              estimatedWasteWatts: wasteByRoom.get(r.id) || 0,
              temperatureC: r.environment.temperature,
              co2Ppm: r.environment.co2Ppm,
              naturalDaylightLux: r.environment.naturalDaylightLux,
              manualUnitsCount: r.appliances.filter((a) => a.operatingMode === 'MANUAL' || a.isManualOverride).length,
            })),
          };
        }

        case 'compare_buildings': {
          const map = new Map<
            string,
            {
              building: string;
              roomCount: number;
              motionDetectedRooms: number;
              totalSeatCapacity: number;
              currentWatts: number;
              ratedWatts: number;
              baselineWatts: number;
              dailyActualKWh: number;
              dailyBaselineKWh: number;
            }
          >();
          for (const r of rooms) {
            const b = map.get(r.building) || {
              building: r.building,
              roomCount: 0,
              motionDetectedRooms: 0,
              totalSeatCapacity: 0,
              currentWatts: 0,
              ratedWatts: 0,
              baselineWatts: 0,
              dailyActualKWh: 0,
              dailyBaselineKWh: 0,
            };
            b.roomCount++;
            if (formatVoiceRoomActivity(r) === 'Motion detected') b.motionDetectedRooms++;
            b.totalSeatCapacity += r.capacity;
            b.currentWatts += r.currentPowerWatts;
            b.ratedWatts += r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances);
            b.baselineWatts += r.baselinePowerWatts;
            b.dailyActualKWh += r.dailyActualKWh;
            b.dailyBaselineKWh += r.dailyBaselineKWh;
            map.set(r.building, b);
          }

          return {
            buildings: Array.from(map.values()).map((b) => {
              const powerSavedWatts = Math.max(0, b.baselineWatts - b.currentWatts);
              const curtailedFromRatedWatts = Math.max(0, b.ratedWatts - b.currentWatts);
              const dailySavedKWh = Math.max(0, b.dailyBaselineKWh - b.dailyActualKWh);
              return {
                building: b.building,
                roomCount: b.roomCount,
                motionDetectedRooms: b.motionDetectedRooms,
                totalSeatCapacity: b.totalSeatCapacity,
                currentWatts: b.currentWatts,
                ratedWatts: b.ratedWatts,
                curtailedFromRatedWatts,
                ratedUtilizationPercent:
                  b.ratedWatts > 0 ? Number(((b.currentWatts / b.ratedWatts) * 100).toFixed(1)) : 0,
                baselineWatts: b.baselineWatts,
                powerSavedWatts,
                savingsPercent:
                  b.baselineWatts > 0
                    ? Number(((powerSavedWatts / b.baselineWatts) * 100).toFixed(1))
                    : 0,
                dailyActualKWh: Number(b.dailyActualKWh.toFixed(2)),
                dailyBaselineKWh: Number(b.dailyBaselineKWh.toFixed(2)),
                dailySavedKWh: Number(dailySavedKWh.toFixed(2)),
                dailyCostSavedINR: Number((dailySavedKWh * settings.tariffPerKWhINR).toFixed(2)),
              };
            }),
          };
        }

        case 'simulate_policy_what_if': {
          const newTariff =
            typeof args.proposedTariffPerKWhINR === 'number' && args.proposedTariffPerKWhINR > 0
              ? args.proposedTariffPerKWhINR
              : settings.tariffPerKWhINR;
          const newCarbon =
            typeof args.proposedCarbonFactor === 'number' && args.proposedCarbonFactor > 0
              ? args.proposedCarbonFactor
              : settings.gridCarbonFactorKgCO2PerKWh;
          const extraPct =
            typeof args.additionalSavingsPercent === 'number' && Number.isFinite(args.additionalSavingsPercent)
              ? Math.max(0, Math.min(50, args.additionalSavingsPercent))
              : 0;

          const currentActualKWh = summary.dailyActualKWh;
          const currentSavedKWh = summary.dailySavedKWh;
          const projectedActualKWh = Number((currentActualKWh * (1 - extraPct / 100)).toFixed(2));
          const projectedSavedKWh = Number(
            Math.max(0, summary.dailyBaselineKWh - projectedActualKWh).toFixed(2)
          );

          const currentDailyBillINR = Number((currentActualKWh * settings.tariffPerKWhINR).toFixed(2));
          const projectedDailyBillINR = Number((projectedActualKWh * newTariff).toFixed(2));
          const currentDailySavedINR = summary.dailyCostSavedINR;
          const projectedDailySavedINR = Number((projectedSavedKWh * newTariff).toFixed(2));

          return {
            assumptions: {
              currentTariffINR: settings.tariffPerKWhINR,
              proposedTariffINR: newTariff,
              currentCarbonFactor: settings.gridCarbonFactorKgCO2PerKWh,
              proposedCarbonFactor: newCarbon,
              additionalReductionPercent: extraPct,
            },
            daily: {
              currentSavedKWh,
              projectedSavedKWh,
              currentDailyBillINR,
              projectedDailyBillINR,
              currentDailyCostSavedINR: currentDailySavedINR,
              projectedDailyCostSavedINR: projectedDailySavedINR,
              projectedDailyCO2AvoidedKg: Number((projectedSavedKWh * newCarbon).toFixed(2)),
            },
            annual220SchoolDays: {
              projectedSavedKWh: Number((projectedSavedKWh * 220).toFixed(0)),
              projectedAnnualCostSavedINR: Number((projectedDailySavedINR * 220).toFixed(0)),
              projectedAnnualCO2AvoidedKg: Number((projectedSavedKWh * newCarbon * 220).toFixed(0)),
            },
          };
        }

        case 'get_space_intelligence_summary': {
          const requestedDate =
            typeof args.attendanceDate === 'string' && args.attendanceDate.trim()
              ? args.attendanceDate.trim()
              : undefined;
          const bootstrap = spaceIntelligenceService.getBootstrapPayload(requestedDate);
          const recorded = bootstrap.latestSectionAttendance.filter((s) => s.hasRecordForSelectedDate);
          const totalEnrolled = bootstrap.sections.reduce((acc, s) => acc + s.enrolledStrength, 0);
          const totalPresent = recorded.reduce((acc, s) => acc + (s.presentCount ?? 0), 0);

          return {
            attendanceDate: bootstrap.latestAttendanceDate,
            availableDatesCount: bootstrap.availableAttendanceDates.length,
            totalSections: bootstrap.sections.length,
            recordedSectionsCount: recorded.length,
            missingAttendanceSectionsCount: bootstrap.sections.length - recorded.length,
            totalEnrolledStrength: totalEnrolled,
            totalRecordedPresent: totalPresent,
            latestRun: bootstrap.latestRun
              ? {
                  runId: bootstrap.latestRun.runId,
                  attendanceDate: bootstrap.latestRun.attendanceDate,
                  horizonLabel: bootstrap.latestRun.horizonLabel,
                  summary: bootstrap.latestRun.summary,
                }
              : null,
            sectionsOverview: bootstrap.latestSectionAttendance.map((s) => ({
              sectionCode: s.section.sectionCode,
              displayName: s.section.displayName,
              homeRoomCode: s.section.homeRoomCode,
              enrolledStrength: s.section.enrolledStrength,
              attendanceRecorded:
                s.hasRecordForSelectedDate && s.presentCount !== null
                  ? `${s.presentCount}/${s.section.enrolledStrength}`
                  : 'Unknown (no record)',
              attendanceSource: s.source,
              policy: s.section.policy,
            })),
            dataClassification: 'Persistent Space Intelligence Register & Classroom Inventory (SQLite)',
          };
        }

        case 'get_space_allocation_recommendations': {
          const requestedDate =
            typeof args.attendanceDate === 'string' && args.attendanceDate.trim()
              ? args.attendanceDate.trim()
              : undefined;
          let run = spaceIntelligenceService.getLatestAllocationRun();
          if (!run || (requestedDate && run.attendanceDate !== requestedDate)) {
            run = spaceIntelligenceService.runAllocationAnalysis({
              attendanceDate: requestedDate,
            });
          }
          return {
            runId: run.runId,
            attendanceDate: run.attendanceDate,
            analysisMode: run.analysisMode,
            horizonLabel: run.horizonLabel,
            summary: run.summary,
            proposals: run.proposals.map((p) => ({
              proposalId: p.proposalId,
              sectionCode: p.sectionCode,
              sectionDisplayName: p.sectionDisplayName,
              enrolledStrength: p.enrolledStrength,
              attendanceRecorded: `${p.presentCount}/${p.enrolledStrength}`,
              existingRoom: `${p.existingRoomCode} (${p.existingRoomName})`,
              proposedRoom: `${p.proposedRoomCode} (${p.proposedRoomName}, max ${p.proposedRoomMaxOccupancy} seats)`,
              windowLabel: p.windowLabel,
              netEnergySavingsKWh: p.netEnergySavingsKWh,
              costSavingsINR: p.costSavingsINR,
              co2AvoidedKg: p.co2AvoidedKg,
              status: p.status,
              explanationTrace: p.explanationTrace,
              rejectedAlternatives: p.rejectedAlternatives.slice(0, 4),
            })),
            unchangedSectionsSample: run.unchangedSections.slice(0, 8).map((u) => ({
              sectionCode: u.sectionCode,
              homeRoomCode: u.homeRoomCode,
              outcome: u.outcome,
              primaryReason: u.primaryReason,
            })),
            dataClassification: 'Attendance-Aware Global Conflict-Free Allocation Engine',
          };
        }

        case 'get_space_allocation_history': {
          const limit =
            typeof args.limit === 'number' && Number.isFinite(args.limit)
              ? Math.max(1, Math.min(50, Math.round(args.limit)))
              : 15;
          const entries = spaceIntelligenceService.listAllocationHistory(limit);
          return {
            count: entries.length,
            entries,
            dataClassification: 'Persistent Space Allocation Decision Log',
          };
        }

        default:
          return { ok: false, error: `Unknown tool: ${name}` };
      }
    };

    const executeRegistryToolCall = async (
      name: string,
      args: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
      const adminIdentity = deps.resolveAdminFromWs(req, explicitToken);
      const mergedRooms = mergeSnapshotWithServerAppliances(currentSnapshot, deps);
      const snapshotPayload: VoiceSnapshotPayload = {
        activeTab: currentSnapshot.activeTab,
        activeSubTab: sessionMemory.activeSubTab,
        selectedRoomId: currentSnapshot.selectedRoomId,
        isAdmin: Boolean(adminIdentity),
        adminName: adminIdentity?.adminName,
        adminRole: adminIdentity?.role,
        settings: currentSnapshot.settings,
        classrooms: mergedRooms,
        resolvedFindingIds: currentSnapshot.resolvedFindingIds,
        timestamp: currentSnapshot.snapshotTimestamp,
      };
      return capabilityRegistry.execute(name, args, {
        snapshot: snapshotPayload,
        rooms: mergedRooms,
        settings: currentSnapshot.settings,
        adminIdentity,
        memory: sessionMemory,
        emitClientMessage: sendJson,
        delegateLegacyTool: executeToolCall,
      });
    };

    const pendingMessages: Record<string, unknown>[] = [];
    let lastKnownAdminId: string | null = deps.resolveAdminFromWs(req, explicitToken)?.adminId ?? null;

    const handleClientMessage = (parsed: Record<string, unknown>) => {
      if (isClosing) return;
      const msgType = parsed.type;

      if (msgType === 'end_session') {
        cleanup();
        return;
      }

      if (msgType === 'interrupt') {
        lastActivityAt = Date.now();
        isModelTurnActive = false;
        sendJson({ type: 'interrupted' });
        return;
      }

      if (msgType === 'confirm_action') {
        lastActivityAt = Date.now();
        const confirmed = Boolean(parsed.confirmed);
        void executeRegistryToolCall(
          confirmed ? 'confirm_pending_action' : 'cancel_pending_action',
          {}
        ).then((res) => {
          const msgText =
            typeof res.summary === 'string'
              ? res.summary
              : typeof res.message === 'string'
              ? res.message
              : typeof res.error === 'string'
              ? res.error
              : confirmed
              ? 'Confirmed action executed.'
              : 'Pending action cancelled.';
          sendJson({
            type: 'output_transcript',
            text: formatRoomNameForSpeech(msgText),
            isFinal: true,
          });
        });
        return;
      }

      if (msgType === 'auth_token' && (typeof parsed.token === 'string' || parsed.token === null)) {
        lastActivityAt = Date.now();
        explicitToken = typeof parsed.token === 'string' ? parsed.token : null;
        const nextAdmin = deps.resolveAdminFromWs(req, explicitToken);
        const nextAdminId = nextAdmin?.adminId ?? null;
        if (nextAdminId !== lastKnownAdminId) {
          lastKnownAdminId = nextAdminId;
          sendJson({
            type: 'live_ready',
            model: LIVE_MODEL,
            role: nextAdmin ? 'admin' : 'student',
            staffName: nextAdmin?.adminName,
            capabilitiesCount: capabilityRegistry.list({ availableOnly: true }).length,
          });
          if (liveSession) {
            try {
              liveSession.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: nextAdmin
                          ? `[SYSTEM SESSION AUTH UPDATE]: Administrator ${nextAdmin.adminName} (${nextAdmin.role}) has signed in and verified this session. All admin tools are now AUTHORISED.`
                          : '[SYSTEM SESSION AUTH UPDATE]: Administrator session ended. The session is back in Student Mode.',
                      },
                    ],
                  },
                ],
                turnComplete: false,
              });
            } catch {
              // ignore transient send failures
            }
          }
        }
        return;
      }

      if (msgType === 'context_snapshot' && parsed.snapshot && typeof parsed.snapshot === 'object') {
        const snap = parsed.snapshot as Partial<CampusSnapshotState> & { activeSubTab?: string | null };
        currentSnapshot = {
          activeTab: typeof snap.activeTab === 'string' ? snap.activeTab : currentSnapshot.activeTab,
          selectedRoomId:
            typeof snap.selectedRoomId === 'string' || snap.selectedRoomId === null
              ? snap.selectedRoomId
              : currentSnapshot.selectedRoomId,
          settings: snap.settings || currentSnapshot.settings,
          classrooms:
            Array.isArray(snap.classrooms) && snap.classrooms.length > 0
              ? snap.classrooms
              : currentSnapshot.classrooms,
          auditFindings: Array.isArray(snap.auditFindings)
            ? snap.auditFindings
            : currentSnapshot.auditFindings,
          resolvedFindingIds: Array.isArray(snap.resolvedFindingIds)
            ? snap.resolvedFindingIds.filter((x): x is string => typeof x === 'string')
            : currentSnapshot.resolvedFindingIds,
          snapshotTimestamp: Date.now(),
        };
        sessionMemory.activeTab = currentSnapshot.activeTab;
        if (typeof snap.activeSubTab === 'string' || snap.activeSubTab === null) {
          sessionMemory.activeSubTab = snap.activeSubTab ?? null;
        }
        if (currentSnapshot.selectedRoomId) {
          sessionMemory.selectedRoomId = currentSnapshot.selectedRoomId;
          if (!sessionMemory.lastMentionedRoomId) {
            sessionMemory.lastMentionedRoomId = currentSnapshot.selectedRoomId;
          }
        }
        return;
      }

      if (!liveSession) {
        // Queue bounded pre-roll audio & text turns while Gemini Live finishes connecting
        if (pendingMessages.length < 96) {
          pendingMessages.push(parsed);
        }
        return;
      }

      if (msgType === 'audio_in' && typeof parsed.data === 'string') {
        const rms =
          typeof parsed.rms === 'number' && Number.isFinite(parsed.rms)
            ? parsed.rms
            : computeBase64Pcm16Rms(parsed.data);

        // CRITICAL FIX: Only reset inactivity timer on actual vocal energy, NOT silent PCM frames!
        if (rms >= SPEECH_RMS_ACTIVITY_THRESHOLD) {
          lastActivityAt = Date.now();
          hasReceivedUserSpeech = true;
        }

        try {
          liveSession.sendRealtimeInput({
            audio: {
              data: parsed.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
          consecutiveAudioSendErrors = 0;
        } catch (err) {
          consecutiveAudioSendErrors += 1;
          console.warn('[voice] sendRealtimeInput failed:', err);
          if (consecutiveAudioSendErrors >= 5) {
            sendJson({
              type: 'error',
              code: 'AUDIO_STREAM_FAILED',
              message: 'Live audio uplink was interrupted. Please tap Retry or say Hey ROOMWISE again.',
            });
            cleanup();
          }
        }
      } else if (msgType === 'wake_greeting') {
        // Only acknowledge if user has NOT already started speaking a command after the wake word
        if (hasReceivedUserSpeech) return;
        lastActivityAt = Date.now();
        try {
          liveSession.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'The user said "Hey ROOMWISE" and is waiting. Reply concisely in 2 words ("Yes, listening.") and wait for their command.',
                  },
                ],
              },
            ],
            turnComplete: true,
          });
        } catch (err) {
          console.warn('[voice] wake_greeting send failed:', err);
        }
      } else if (msgType === 'text_turn' && typeof parsed.text === 'string') {
        const clean = parsed.text.trim();
        if (!clean) return;
        lastActivityAt = Date.now();
        hasReceivedUserSpeech = true;
        try {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: clean }] }],
            turnComplete: true,
          });
        } catch (err) {
          console.warn('[voice] text_turn send failed:', err);
          sendJson({
            type: 'error',
            code: 'TEXT_TURN_FAILED',
            message: 'Unable to send text command to live voice session.',
          });
        }
      }
    };

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        handleClientMessage(parsed);
      } catch {
        // ignore invalid JSON frames
      }
    });

    ws.on('close', () => {
      cleanup();
    });

    ws.on('error', () => {
      cleanup();
    });

    try {
      const initialAdmin = deps.resolveAdminFromWs(req, explicitToken);
      const mergedInitialRooms = mergeSnapshotWithServerAppliances(currentSnapshot, deps);
      const initialSummary = computeDerivedCampusSummary(mergedInitialRooms, currentSnapshot.settings);
      const initialSnapshotPayload: VoiceSnapshotPayload = {
        activeTab: currentSnapshot.activeTab,
        activeSubTab: sessionMemory.activeSubTab,
        selectedRoomId: currentSnapshot.selectedRoomId,
        isAdmin: Boolean(initialAdmin),
        adminName: initialAdmin?.adminName,
        adminRole: initialAdmin?.role,
        settings: currentSnapshot.settings,
        classrooms: mergedInitialRooms,
        resolvedFindingIds: currentSnapshot.resolvedFindingIds,
        timestamp: currentSnapshot.snapshotTimestamp,
      };

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const connectedSession = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: buildModernVoiceSystemInstruction({
            snapshot: initialSnapshotPayload,
            adminIdentity: initialAdmin,
            registry: capabilityRegistry,
            memory: sessionMemory,
            summary: {
              ...initialSummary,
              occupiedCount: initialSummary.motionDetectedRoomsCount,
            },
          }),
          tools: [{ functionDeclarations: capabilityRegistry.getFunctionDeclarations() }],
        },
        callbacks: {
          onmessage: async (message: LiveServerMessage) => {
            lastActivityAt = Date.now();

            if (message.serverContent?.interrupted) {
              isModelTurnActive = false;
              sendJson({ type: 'interrupted' });
            }

            const rawInputText = message.serverContent?.inputTranscription?.text?.trim();
            if (rawInputText && rawInputText !== lastInputTranscript) {
              lastInputTranscript = rawInputText;
              hasReceivedUserSpeech = true;
              sendJson({
                type: 'input_transcript',
                text: rawInputText,
              });
            }

            const rawOutputText = message.serverContent?.outputTranscription?.text?.trim();
            if (rawOutputText && rawOutputText !== lastOutputTranscript) {
              lastOutputTranscript = rawOutputText;
              sendJson({
                type: 'output_transcript',
                text: rawOutputText,
              });
            }

            const parts = message.serverContent?.modelTurn?.parts;
            if (Array.isArray(parts)) {
              isModelTurnActive = true;
              for (const part of parts) {
                if (part.inlineData?.data) {
                  sendJson({
                    type: 'audio_out',
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                  });
                }
              }
            }

            if (message.serverContent?.turnComplete) {
              isModelTurnActive = false;
              lastInputTranscript = '';
              lastOutputTranscript = '';
              sendJson({ type: 'turn_complete' });
            }

            if (message.toolCall?.functionCalls && message.toolCall.functionCalls.length > 0 && liveSession) {
              const functionResponses = [];
              const customStatusTools = new Set([
                'navigate_roomwise',
                'control_classroom_appliance',
                'control_building_or_campus_appliances',
                'optimize_campus_energy',
                'resolve_audit_finding',
                'recalibrate_classroom',
                'update_classroom_parameters',
                'update_campus_settings',
                'execute_app_action',
              ]);
              for (const fc of message.toolCall.functionCalls) {
                const fcName = fc.name || '';
                sendJson({
                  type: 'tool_status',
                  toolName: fcName,
                  status: 'running',
                  message: `Running ${fcName.replace(/_/g, ' ')}`,
                });
                const response = await executeRegistryToolCall(
                  fcName,
                  (fc.args || {}) as Record<string, unknown>
                );
                if (!customStatusTools.has(fcName)) {
                  sendJson({
                    type: 'tool_status',
                    toolName: fcName,
                    status: response.ok === false ? 'error' : 'completed',
                    message:
                      typeof response.summary === 'string'
                        ? response.summary
                        : typeof response.error === 'string'
                        ? response.error
                        : undefined,
                  });
                }
                functionResponses.push({
                  id: fc.id,
                  name: fcName,
                  response,
                });
              }

              try {
                liveSession.sendToolResponse({ functionResponses });
              } catch (err) {
                console.warn('[voice] Failed sending tool response to Gemini Live:', err);
              }
            }
          },
          onerror: (errEvent) => {
            const msg =
              errEvent?.message ||
              (errEvent instanceof Error ? errEvent.message : 'Gemini Live API connection error.');
            console.error('[voice] Gemini Live session error:', msg);
            sendJson({
              type: 'error',
              code: 'GEMINI_LIVE_ERROR',
              message: msg,
            });
          },
          onclose: (closeEvent: unknown) => {
            isModelTurnActive = false;
            const ce = closeEvent as { code?: number; reason?: string } | undefined;
            if (!isClosing && ce && typeof ce.code === 'number' && ce.code !== 1000 && ce.code !== 1005) {
              console.warn(`[voice] Gemini Live closed unexpectedly (code=${ce.code}, reason=${ce.reason || 'none'})`);
              sendJson({
                type: 'error',
                code: 'LIVE_SESSION_CLOSED',
                message: ce.reason || `Live voice session closed unexpectedly (code ${ce.code}).`,
              });
            }
            cleanup();
          },
        },
      });

      if (isClosing) {
        try {
          connectedSession.close();
        } catch {
          // ignore
        }
        return;
      }

      liveSession = connectedSession;
      sendJson({
        type: 'live_ready',
        model: LIVE_MODEL,
        role: initialAdmin ? 'admin' : 'student',
        staffName: initialAdmin?.adminName,
        capabilitiesCount: capabilityRegistry.list({ availableOnly: true }).length,
      });

      while (pendingMessages.length > 0 && !isClosing) {
        const queued = pendingMessages.shift();
        if (queued) handleClientMessage(queued);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to initialize Gemini Live session.';
      console.error('[voice] Failed to connect Gemini Live:', errMsg);
      sendJson({
        type: 'error',
        code: 'LIVE_CONNECT_FAILED',
        message: errMsg,
      });
      cleanup();
    }
  });
}

/**
 * Shared server-side Voice Command & Capability Executor backed by the exact
 * same central VoiceCapabilityRegistry used by Gemini Live. Powers:
 *  - GET /api/voice/capabilities
 *  - POST /api/voice/command (reliable text/fallback command execution)
 *  - Automated multi-turn integration tests across all 11 ROOMWISE sections
 */
export function createRoomwiseVoiceCommandExecutor(deps: VoiceLiveBridgeDeps) {
  const registry = createRoomwiseCapabilityRegistry(ROOMWISE_FUNCTION_DECLARATIONS);
  const sessions = new Map<string, VoiceSessionMemory>();

  const getOrCreateSession = (sessionId: string, activeTab = 'dashboard', selectedRoomId: string | null = null) => {
    let mem = sessions.get(sessionId);
    if (!mem) {
      mem = createInitialVoiceSessionMemory(activeTab, selectedRoomId);
      sessions.set(sessionId, mem);
      if (sessions.size > 100) {
        const oldestKey = sessions.keys().next().value;
        if (oldestKey) sessions.delete(oldestKey);
      }
    } else {
      mem.activeTab = activeTab;
      if (selectedRoomId !== undefined) mem.selectedRoomId = selectedRoomId;
    }
    return mem;
  };

  const buildSnapshotRooms = (inputRooms?: Classroom[]): Classroom[] => {
    const base = Array.isArray(inputRooms) && inputRooms.length > 0 ? inputRooms : DEFAULT_EXPANDED_CLASSROOMS;
    const store = deps.getServerRoomsMap();
    return base.map((c) => {
      const serverRec = store.get(c.id);
      if (!serverRec) return c;
      const ratedW = computeAppliancesRatedPowerWatts(serverRec.appliances);
      const currentW = serverRec.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      return {
        ...c,
        appliances: serverRec.appliances,
        currentPowerWatts: currentW,
        ratedPowerWatts: ratedW,
      };
    });
  };

  const executeLegacyTool = async (
    name: string,
    args: Record<string, unknown>,
    rooms: Classroom[],
    settings: SchoolSettings,
    adminIdentity: VoiceAdminIdentity | null,
    resolvedFindingIds: string[],
    memory: VoiceSessionMemory,
    emitClientMessage: (msg: VoiceServerMessage) => void
  ): Promise<Record<string, unknown>> => {
    const summary = computeDerivedCampusSummary(rooms, settings);
    switch (name) {
      case 'get_campus_overview':
        return {
          institutionName: settings.institutionName,
          campusLocation: settings.campusLocation,
          totalClassrooms: rooms.length,
          occupiedClassrooms: summary.motionDetectedRoomsCount,
          vacantClassrooms: summary.noRecentMotionRoomsCount,
          totalCurrentPowerWatts: summary.totalCurrentPowerWatts,
          totalCurrentPowerKW: summary.totalCurrentPowerKW,
          totalRatedPowerKW: summary.totalRatedPowerKW,
          ratedUtilizationPercent: summary.ratedUtilizationPercent,
          savingsPercent: summary.savingsPercent,
        };
      case 'get_current_energy_summary':
        return {
          totalCurrentPowerWatts: summary.totalCurrentPowerWatts,
          totalCurrentPowerKW: summary.totalCurrentPowerKW,
          dailyActualKWh: summary.dailyActualKWh,
          dailyBaselineKWh: summary.dailyBaselineKWh,
          savingsPercent: summary.savingsPercent,
        };
      case 'get_energy_savings_estimate': {
        const dailySaved = Number(Math.max(0, summary.dailyBaselineKWh - summary.dailyActualKWh).toFixed(2));
        return {
          savingsPercent: summary.savingsPercent,
          dailySavedKWh: dailySaved,
          monthlySavedKWh: Number((dailySaved * SCHOOL_DAYS_PER_MONTH).toFixed(1)),
          annualSavedKWh: Number((dailySaved * SCHOOL_DAYS_PER_YEAR).toFixed(0)),
          schoolDaysPerMonth: SCHOOL_DAYS_PER_MONTH,
          schoolDaysPerYear: SCHOOL_DAYS_PER_YEAR,
        };
      }
      case 'list_classrooms':
        return {
          count: rooms.length,
          classrooms: rooms.map((r) => ({
            roomCode: r.roomCode,
            name: r.name,
            building: r.building,
            floor: r.floor,
            currentPowerWatts: r.currentPowerWatts,
          })),
        };
      case 'get_classroom_status': {
        const res = resolveClassroomRobust(rooms, String(args.roomQuery || ''), memory);
        if (!res.match) return { ok: false, found: false, error: `No classroom found for "${String(args.roomQuery || '')}".` };
        const r = res.match;
        return {
          ok: true,
          found: true,
          roomId: r.id,
          roomCode: r.roomCode,
          name: r.name,
          building: r.building,
          floor: r.floor,
          currentPowerWatts: r.currentPowerWatts,
          occupancyStatus: r.occupancyStatus,
          roomActivity: formatVoiceRoomActivity(r),
        };
      }
      case 'get_classroom_telemetry': {
        const res = resolveClassroomRobust(rooms, String(args.roomQuery || ''), memory);
        if (!res.match) return { ok: false, found: false, error: `No classroom found for "${String(args.roomQuery || '')}".` };
        const r = res.match;
        return {
          ok: true,
          found: true,
          roomId: r.id,
          roomCode: r.roomCode,
          name: r.name,
          building: r.building,
          environment: r.environment,
          currentPowerWatts: r.currentPowerWatts,
          roomActivity: formatVoiceRoomActivity(r),
        };
      }
      case 'compare_buildings': {
        const map = new Map<string, { building: string; rooms: number; currentPowerWatts: number }>();
        for (const r of rooms) {
          const cur = map.get(r.building) || { building: r.building, rooms: 0, currentPowerWatts: 0 };
          cur.rooms += 1;
          cur.currentPowerWatts += r.currentPowerWatts;
          map.set(r.building, cur);
        }
        return { ok: true, buildings: Array.from(map.values()) };
      }
      case 'rank_and_filter_classrooms': {
        const limit = typeof args.limit === 'number' ? args.limit : 5;
        const sorted = [...rooms].sort((a, b) => b.currentPowerWatts - a.currentPowerWatts).slice(0, limit);
        return {
          ok: true,
          results: sorted.map((r) => ({
            roomCode: r.roomCode,
            name: r.name,
            building: r.building,
            currentPowerWatts: r.currentPowerWatts,
          })),
        };
      }
      case 'get_energy_consumption_history': {
        const period = typeof args.period === 'string' ? args.period : 'last_7_days';
        const range = resolveNaturalDateQuery(period);
        const overview = energyHistoryService.getOverview({
          startDate: range.startDate,
          endDate: range.endDate,
          settings,
        });
        return { ok: true, period, range, totals: overview.kpis };
      }
      case 'get_classroom_energy_history': {
        const res = resolveClassroomRobust(rooms, String(args.roomQuery || ''), memory);
        if (!res.match) return { ok: false, error: 'Classroom not found.' };
        const period = typeof args.period === 'string' ? args.period : 'last_7_days';
        const range = resolveNaturalDateQuery(period);
        const detail = energyHistoryService.getRoomHistory({
          roomId: res.match.id,
          startDate: range.startDate,
          endDate: range.endDate,
          settings,
        });
        return { ok: true, roomId: res.match.id, roomCode: res.match.roomCode, name: res.match.name, detail };
      }
      case 'get_space_intelligence_summary': {
        const requestedDate =
          typeof args.attendanceDate === 'string' && args.attendanceDate.trim()
            ? args.attendanceDate.trim()
            : undefined;
        const boot = spaceIntelligenceService.getBootstrapPayload(requestedDate);
        const recorded = boot.latestSectionAttendance.filter((s) => s.hasRecordForSelectedDate);
        return {
          ok: true,
          attendanceDate: boot.latestAttendanceDate,
          totalRooms: boot.rooms.length,
          totalSections: boot.sections.length,
          recordedSectionsCount: recorded.length,
          latestRun: boot.latestRun,
          pendingProposals: (boot.latestRun?.proposals ?? []).filter((p) => p.status === 'pending').length,
        };
      }
      case 'get_space_allocation_recommendations': {
        const requestedDate =
          typeof args.attendanceDate === 'string' && args.attendanceDate.trim()
            ? args.attendanceDate.trim()
            : undefined;
        let run = spaceIntelligenceService.getLatestAllocationRun();
        if (!run || (requestedDate && run.attendanceDate !== requestedDate)) {
          run = spaceIntelligenceService.runAllocationAnalysis({ attendanceDate: requestedDate });
        }
        return { ok: true, count: run.proposals.length, proposals: run.proposals.slice(0, 8), summary: run.summary };
      }
      case 'get_space_allocation_history': {
        const entries = spaceIntelligenceService.listAllocationHistory(15);
        return { ok: true, count: entries.length, entries };
      }
      case 'generate_energy_audit_summary': {
        const findings = evaluateLiveAuditFindings(rooms, settings, resolvedFindingIds);
        const open = findings.filter((f) => !f.isResolved);
        return {
          ok: true,
          ecbcCompliancePercent: computeEcbcCompliancePercent(findings, rooms.length),
          openFindingsCount: open.length,
          openWasteWatts: open.reduce((acc, f) => acc + f.estimatedWasteWatts, 0),
        };
      }
      case 'identify_vacant_classroom_consumption': {
        const vacant = rooms.filter((r) => r.occupancyStatus === 'Unoccupied' && r.currentPowerWatts > 0);
        return {
          ok: true,
          noMotionRoomsDrawingPowerCount: vacant.length,
          noMotionRoomsDrawingPower: vacant.map((r) => ({
            roomCode: r.roomCode,
            name: r.name,
            currentPowerWatts: r.currentPowerWatts,
          })),
        };
      }
      case 'control_classroom_appliance': {
        if (!adminIdentity) return { ok: false, authorized: false, error: 'Administrator login required.' };
        const res = resolveClassroomRobust(rooms, String(args.roomQuery || ''), memory);
        if (!res.match) return { ok: false, error: 'Classroom not found.' };
        const room = res.match;
        const targetType = String(args.targetType || 'lights_group');
        const mode = String(args.mode || 'set');
        const pct = typeof args.outputPercent === 'number' ? Math.max(0, Math.min(100, Math.round(args.outputPercent))) : 0;
        const groupType =
          targetType === 'fans_group' ? 'fan' : targetType === 'ac_group' ? 'ac' : targetType === 'all_group' ? 'all' : 'lights';
        const cmdRes = deps.executeApplianceCommand({
          roomId: room.id,
          action: mode === 'restore_auto' ? 'restore_room_auto' : 'set_group',
          type: groupType,
          outputPercent: pct,
          isVacant: room.occupancyStatus === 'Unoccupied',
          admin: adminIdentity,
        });
        if (cmdRes.ok && cmdRes.appliances) {
          emitClientMessage({
            type: 'appliance_state_updated',
            payload: {
              roomId: room.id,
              roomCode: room.roomCode,
              appliances: cmdRes.appliances,
              totalPowerWatts: cmdRes.totalPowerWatts ?? 0,
              summary: cmdRes.summary || `Updated ${room.roomCode}`,
            },
          });
        }
        return {
          ok: cmdRes.ok,
          roomId: room.id,
          roomCode: room.roomCode,
          name: room.name,
          summary: cmdRes.summary,
          newTotalPowerWatts: cmdRes.totalPowerWatts,
          error: cmdRes.error,
        };
      }
      case 'control_building_or_campus_appliances': {
        if (!adminIdentity) return { ok: false, authorized: false, error: 'Administrator login required.' };
        const batchRes = deps.executeBatchApplianceControl({
          scope: (args.scope as BatchApplianceControlInput['scope']) || 'campus',
          building: typeof args.building === 'string' ? args.building : undefined,
          targetType: (args.targetType as BatchApplianceControlInput['targetType']) || 'lights',
          mode: args.mode === 'restore_auto' ? 'restore_auto' : 'set',
          outputPercent: typeof args.outputPercent === 'number' ? args.outputPercent : 0,
          admin: adminIdentity,
        });
        if (batchRes.ok) {
          emitClientMessage({
            type: 'campus_optimized',
            payload: {
              optimizedRooms: batchRes.optimizedRooms,
              resolvedFindingIds: [],
              curtailedWatts: batchRes.curtailedWatts,
              summary: batchRes.summary,
            },
          });
        }
        return { ok: batchRes.ok, summary: batchRes.summary, affectedRoomsCount: batchRes.optimizedRooms.length, error: batchRes.error };
      }
      case 'optimize_campus_energy': {
        if (!adminIdentity) return { ok: false, authorized: false, error: 'Administrator login required.' };
        const optRes = deps.executeCampusOptimization({
          scope: 'all',
          sourceLabel: 'Voice Command Optimization',
          admin: adminIdentity,
        });
        if (optRes.ok) {
          emitClientMessage({
            type: 'campus_optimized',
            payload: {
              optimizedRooms: optRes.optimizedRooms,
              resolvedFindingIds: [],
              curtailedWatts: optRes.curtailedWatts,
              summary: optRes.summary,
            },
          });
        }
        return { ok: optRes.ok, summary: optRes.summary, curtailedWatts: optRes.curtailedWatts, error: optRes.error };
      }
      case 'update_campus_settings': {
        if (!adminIdentity) return { ok: false, authorized: false, error: 'Administrator login required.' };
        const patch: Partial<SchoolSettings> = {};
        if (typeof args.tariffPerKWhINR === 'number' && args.tariffPerKWhINR > 0) {
          patch.tariffPerKWhINR = Number(args.tariffPerKWhINR.toFixed(2));
        }
        const summaryMsg = `Updated campus settings (${Object.keys(patch).join(', ') || 'policy'})`;
        emitClientMessage({ type: 'settings_updated', settings: patch, summary: summaryMsg });
        return { ok: true, updated: patch, summary: summaryMsg };
      }
      case 'execute_app_action': {
        const kind = String(args.action || 'close_modals') as VoiceUiActionPayload['kind'];
        const summaryMsg = `Executed workspace action: ${kind}`;
        emitClientMessage({ type: 'ui_action', action: { kind }, summary: summaryMsg });
        return { ok: true, action: kind, summary: summaryMsg };
      }
      case 'get_security_audit_and_staff':
        return { ...deps.getSecurityAuditAndStaff(Boolean(adminIdentity)) };
      default:
        return { ok: false, error: `Unsupported tool "${name}".` };
    }
  };

  return {
    registry,
    getCapabilities: () => registry.list({ availableOnly: true }),
    executeCommand: async (params: {
      sessionId: string;
      text: string;
      activeTab?: string;
      selectedRoomId?: string | null;
      settings?: SchoolSettings;
      classrooms?: Classroom[];
      resolvedFindingIds?: string[];
      adminIdentity: VoiceAdminIdentity | null;
    }): Promise<InterpretedVoiceCommandResult> => {
      const rooms = buildSnapshotRooms(params.classrooms);
      const settings = params.settings || INITIAL_SCHOOL_SETTINGS;
      const memory = getOrCreateSession(
        params.sessionId,
        params.activeTab || 'dashboard',
        params.selectedRoomId ?? null
      );
      const snapshot: VoiceSnapshotPayload = {
        activeTab: memory.activeTab,
        activeSubTab: memory.activeSubTab,
        selectedRoomId: memory.selectedRoomId,
        isAdmin: Boolean(params.adminIdentity),
        adminName: params.adminIdentity?.adminName,
        adminRole: params.adminIdentity?.role,
        settings,
        classrooms: rooms,
        resolvedFindingIds: params.resolvedFindingIds || [],
        timestamp: Date.now(),
      };

      const legacyEmits: VoiceServerMessage[] = [];
      const result = await interpretAndExecuteVoiceCommand(params.text, registry, {
        snapshot,
        rooms,
        settings,
        adminIdentity: params.adminIdentity,
        memory,
        emitClientMessage: () => undefined,
        delegateLegacyTool: (toolName, args) =>
          executeLegacyTool(
            toolName,
            args,
            rooms,
            settings,
            params.adminIdentity,
            params.resolvedFindingIds || [],
            memory,
            (msg) => legacyEmits.push(msg)
          ),
      });
      if (legacyEmits.length > 0) {
        result.emittedMessages.push(...legacyEmits);
      }
      return result;
    },
  };
}

