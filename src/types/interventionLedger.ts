/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type InterventionSource = 'simulated' | 'hardware_telemetry' | 'meter_data';

export type InterventionVerificationStatus =
  | 'estimated'
  | 'meter_backed'
  | 'meter_verified';

export type InterventionTriggerCategory =
  | 'pir_vacancy'
  | 'ambient_light'
  | 'thermal_comfort'
  | 'schedule'
  | 'manual_override'
  | 'audit_remediation';

export type InterventionActionStatus =
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'unresolved';

export type InterventionCircuitType =
  | 'lights'
  | 'fan'
  | 'ac'
  | 'projector'
  | 'equipment'
  | 'room_combined';

export type CounterfactualBaselineMethod =
  | 'previous_state_power'
  | 'configured_appliance_rating'
  | 'roomwise_pre_retrofit_reference'
  | 'unavailable';

export type OverlapAttributionStatus =
  | 'counted_full'
  | 'counted_partial_overlap_trimmed'
  | 'excluded_overlap_duplicate'
  | 'not_calculable_missing_data';

export interface InterventionSensorSnapshot {
  pirStatus?: string;
  lastMotionMinutesAgo?: number | null;
  naturalDaylightLux?: number | null;
  ambientLux?: number | null;
  temperatureC?: number | null;
  humidityPercent?: number | null;
  heatIndexC?: number | null;
  capturedAtIst?: string | null;
  dataOrigin: 'simulated_node' | 'hardware_sensor' | 'unavailable';
}

export interface InterventionEnergyCalculation {
  calculable: boolean;
  unavailableReason: string | null;
  counterfactualBaselineWatts: number | null;
  postInterventionWatts: number | null;
  powerDifferenceWatts: number | null;
  rawDurationHours: number | null;
  attributedDurationHours: number | null;
  rawEnergyAvoidedWh: number | null;
  attributedEnergyAvoidedWh: number | null;
  attributedEnergyAvoidedKwh: number | null;
  formulaExpression: string;
  baselineMethod: CounterfactualBaselineMethod;
  baselineExplanation: string;
  assumptions: string[];
  loadRatingSource: string;
  calculationMethodVersion: string;
}

export interface InterventionOverlapInfo {
  status: OverlapAttributionStatus;
  countedInTotals: boolean;
  overlappingEventIds: string[];
  trimmedOverlapMinutes: number;
  explanation: string;
}

export interface InterventionCorrectionEntry {
  id: string;
  interventionId: string;
  createdAtMs: number;
  createdAtIst: string;
  actor: string;
  reason: string;
  previousSummary: string;
  newSummary: string;
}

export interface InterventionRecord {
  // A. Identification and location
  id: string;
  idempotencyKey: string;
  eventGroupId: string;
  parentEventId: string | null;
  roomId: string;
  roomCode: string;
  roomName: string;
  building: string;
  floor: string;
  source: InterventionSource;
  isDemonstrationData: boolean;

  // B. Timing
  triggerTsMs: number;
  triggerAtIst: string;
  startTsMs: number;
  startAtIst: string;
  endTsMs: number | null;
  endAtIst: string | null;
  durationMinutes: number | null;
  recordedAtMs: number;
  recordedAtIst: string;
  dateIst: string;
  timezone: 'Asia/Kolkata';

  // C. Trigger and evidence
  triggerCategory: InterventionTriggerCategory;
  triggerSummary: string;
  evidenceSummary: string;
  sensorSnapshot: InterventionSensorSnapshot;
  ruleLogic: string;

  // D. Control action
  affectedCircuitId: string;
  affectedCircuitName: string;
  circuitType: InterventionCircuitType;
  previousState: string;
  newState: string;
  actionPerformed: string;
  actionStatus: InterventionActionStatus;
  actor: string;
  relatedActionCountInGroup: number;

  // E. Energy calculation & anti-double-counting
  energyCalculation: InterventionEnergyCalculation;
  overlap: InterventionOverlapInfo;

  // F. Provenance and verification
  verificationStatus: InterventionVerificationStatus;
  verificationBasis: string;
}

export interface InterventionLedgerSummary {
  totalInterventions: number;
  countedInterventions: number;
  overlapAdjustedCount: number;
  excludedOverlapCount: number;
  notCalculableCount: number;
  estimatedAvoidedKwh: number;
  estimatedAvoidedWh: number;
  meterBackedAvoidedKwh: number;
  meterVerifiedAvoidedKwh: number;
  simulatedEventCount: number;
  hardwareEventCount: number;
  meterDataEventCount: number;
  byBuilding: Array<{
    building: string;
    interventionsCount: number;
    estimatedAvoidedKwh: number;
    meterVerifiedAvoidedKwh: number;
  }>;
  byRoom: Array<{
    roomId: string;
    roomCode: string;
    roomName: string;
    building: string;
    interventionsCount: number;
    estimatedAvoidedKwh: number;
  }>;
}

export interface InterventionLedgerQueryParams {
  startDate?: string;
  endDate?: string;
  preset?: string;
  building?: string;
  roomId?: string;
  triggerCategory?: string;
  circuitType?: string;
  actionStatus?: string;
  source?: string;
  verificationStatus?: string;
  search?: string;
  sortBy?: 'timestamp' | 'energy' | 'duration' | 'room';
  sortDir?: 'asc' | 'desc';
}

export interface InterventionLedgerListResponse {
  ok: true;
  range: {
    startDate: string;
    endDate: string;
    timezone: 'Asia/Kolkata';
  };
  provenanceDisclosure: string;
  summary: InterventionLedgerSummary;
  records: InterventionRecord[];
  filterOptions: {
    buildings: string[];
    rooms: Array<{ roomId: string; roomCode: string; roomName: string; building: string }>;
    triggers: InterventionTriggerCategory[];
    circuitTypes: InterventionCircuitType[];
    statuses: InterventionActionStatus[];
    sources: InterventionSource[];
    verificationStatuses: InterventionVerificationStatus[];
  };
}

export interface InterventionDetailResponse {
  ok: true;
  record: InterventionRecord;
  relatedGroupEvents: InterventionRecord[];
  corrections: InterventionCorrectionEntry[];
}

export interface CreateInterventionInput {
  id?: string;
  idempotencyKey?: string;
  eventGroupId?: string;
  parentEventId?: string | null;
  roomId: string;
  source: InterventionSource;
  requestedVerificationStatus?: InterventionVerificationStatus;
  hasDocumentedBaselineVerification?: boolean;
  isDemonstrationData?: boolean;
  triggerTsMs: number;
  startTsMs: number;
  endTsMs: number | null;
  triggerCategory: InterventionTriggerCategory;
  triggerSummary: string;
  evidenceSummary: string;
  sensorSnapshot: InterventionSensorSnapshot;
  ruleLogic: string;
  affectedCircuitId: string;
  affectedCircuitName: string;
  circuitType: InterventionCircuitType;
  previousState: string;
  newState: string;
  actionPerformed: string;
  actionStatus: InterventionActionStatus;
  actor: string;
  counterfactualBaselineWatts: number | null;
  postInterventionWatts: number | null;
  baselineMethod: CounterfactualBaselineMethod;
  baselineExplanation: string;
  assumptions?: string[];
  loadRatingSource: string;
}
