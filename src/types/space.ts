/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BuildingName, Floor, RoomType } from './energy.ts';

export type SectionAllocationPolicy =
  | 'fixed_home_room'
  | 'approved_flexible_block'
  | 'restricted';

export type RoomActivityState =
  | 'Motion detected'
  | 'No recent motion detected'
  | 'Sensor unavailable';

export type AttendanceSourceType = 'Preloaded' | 'Administrator Import';

export type AllocationProposalStatus = 'pending' | 'approved' | 'rejected';

export type AnalysisHorizonMode = 'actual' | 'projected';

export interface SpaceRoomRecord {
  roomId: string;
  roomCode: string;
  roomName: string;
  building: BuildingName;
  floor: Floor;
  roomType: RoomType;
  maxOccupancy: number;
  homeSectionId: string | null;
  suitabilityTags: string[];
  isGeneralPoolEligible: boolean;
  isSpecialisedLab: boolean;
  isRestricted: boolean;
  ratedPowerWatts: number;
  estimatedOperatingWatts: number;
  daylightAlpha: number;
  notes: string;
  updatedAt: number;
}

export interface SpaceSectionRecord {
  sectionId: string;
  sectionCode: string; // e.g. 'X-A', 'XI-A', 'Nursery'
  className: string; // e.g. 'X', 'XI', 'Nursery'
  sectionLabel: string; // e.g. 'A', 'B', ''
  displayName: string; // e.g. 'Class X-A'
  gradeGroup: 'pre_primary' | 'middle' | 'secondary' | 'senior_secondary';
  homeRoomId: string;
  homeRoomCode: string;
  enrolledStrength: number;
  policy: SectionAllocationPolicy;
  policyNotes: string;
  updatedAt: number;
}

export interface TimetableSlot {
  slotId: string;
  dayOfWeek: number; // 1 = Mon .. 6 = Sat
  periodCode: string; // 'P1' .. 'P8'
  startTime: string; // 'HH:MM' IST
  endTime: string; // 'HH:MM' IST
  durationHours: number;
  sectionId: string;
  roomId: string;
  subject: string;
  teacherCode: string;
  requiresLabFacility: boolean;
  isMovableBlock: boolean;
  blockWindowLabel: string; // e.g. 'P5–P6'
}

export interface AttendanceRecord {
  id: string;
  attendanceDate: string; // YYYY-MM-DD (IST)
  sectionId: string;
  presentCount: number;
  enrolledStrengthSnapshot: number;
  source: AttendanceSourceType;
  importBatchId?: string | null;
  notes?: string | null;
  recordedAt: number;
}

export interface SectionLatestAttendanceSummary {
  section: SpaceSectionRecord;
  attendanceDate: string | null;
  presentCount: number | null;
  attendancePercent: number | null;
  source: AttendanceSourceType | null;
  hasRecordForSelectedDate: boolean;
}

export interface CandidateRejectionReason {
  roomId: string;
  roomCode: string;
  roomName: string;
  building: BuildingName;
  maxOccupancy: number;
  reasonCategory:
    | 'capacity_shortfall'
    | 'timetable_conflict'
    | 'room_restriction'
    | 'policy_restriction'
    | 'already_allocated'
    | 'insufficient_energy_savings';
  reasonDetail: string;
}

export interface AllocationProposal {
  proposalId: string;
  runId: string;
  attendanceDate: string;
  analysisMode: AnalysisHorizonMode;
  sectionId: string;
  sectionCode: string;
  sectionDisplayName: string;
  enrolledStrength: number;
  presentCount: number;
  safetyMarginApplied: number;
  effectiveRequiredSeats: number;
  attendanceSource: AttendanceSourceType;
  existingRoomId: string;
  existingRoomCode: string;
  existingRoomName: string;
  existingRoomBuilding: BuildingName;
  existingRoomFloor: Floor;
  existingRoomMaxOccupancy: number;
  proposedRoomId: string;
  proposedRoomCode: string;
  proposedRoomName: string;
  proposedRoomBuilding: BuildingName;
  proposedRoomFloor: Floor;
  proposedRoomMaxOccupancy: number;
  windowLabel: string; // e.g. 'P5–P6 (10:45–12:05 IST)'
  periodCodes: string[];
  subjectSummary: string;
  durationHours: number;
  existingEnergyKWh: number;
  proposedEnergyKWh: number;
  netEnergySavingsKWh: number;
  transitionPenaltyKWh: number;
  netScoreKWh: number;
  costSavingsINR: number;
  co2AvoidedKg: number;
  utilizationExistingPercent: number;
  utilizationProposedPercent: number;
  status: AllocationProposalStatus;
  explanationTrace: string[];
  rejectedAlternatives: CandidateRejectionReason[];
  reviewedBy?: string | null;
  reviewedAt?: number | null;
  reviewNote?: string | null;
}

export interface UnchangedSectionEvaluation {
  sectionId: string;
  sectionCode: string;
  sectionDisplayName: string;
  homeRoomId: string;
  homeRoomCode: string;
  homeRoomName: string;
  enrolledStrength: number;
  presentCount: number | null;
  attendanceDate: string | null;
  attendanceSource: AttendanceSourceType | null;
  outcome: 'No reallocation recommended';
  primaryReason: string;
  rejectedAlternatives: CandidateRejectionReason[];
}

export interface AllocationRunResult {
  ok: true;
  runId: string;
  attendanceDate: string;
  targetDayOfWeek: number;
  analysisMode: AnalysisHorizonMode;
  horizonLabel: string;
  createdAt: number;
  summary: {
    evaluatedSectionsCount: number;
    recommendedMovesCount: number;
    unchangedSectionsCount: number;
    unknownAttendanceCount: number;
    totalProjectedSavingsKWh: number;
    totalProjectedSavingsINR: number;
    totalProjectedCo2AvoidedKg: number;
  };
  proposals: AllocationProposal[];
  unchangedSections: UnchangedSectionEvaluation[];
}

export interface AllocationHistoryEntry {
  historyId: string;
  proposalId: string;
  runId: string;
  attendanceDate: string;
  sectionId: string;
  sectionCode: string;
  sectionDisplayName: string;
  existingRoomId: string;
  existingRoomCode: string;
  proposedRoomId: string;
  proposedRoomCode: string;
  windowLabel: string;
  periodCodes: string[];
  decision: 'approved' | 'rejected';
  actorName: string;
  note: string | null;
  netEnergySavingsKWh: number;
  costSavingsINR: number;
  co2AvoidedKg: number;
  decidedAt: number;
}

export interface ColumnMappingSelection {
  attendanceDate: string;
  className: string;
  section: string;
  presentCount: string;
}

export interface ColumnMappingSuggestion {
  field: keyof ColumnMappingSelection;
  label: string;
  suggestedColumn: string | null;
  confidence: 'high' | 'medium' | 'none';
}

export interface ParsedAttendanceRowPreview {
  rowNumber: number;
  rawDate: string;
  normalizedDate: string | null;
  rawClass: string;
  rawSection: string;
  matchedSectionId: string | null;
  matchedSectionCode: string | null;
  enrolledStrength: number | null;
  presentCount: number | null;
  isValid: boolean;
  errors: string[];
}

export interface SpreadsheetParseResult {
  ok: true;
  fileName: string;
  sheetNames: string[];
  activeSheet: string;
  headers: string[];
  totalRawRows: number;
  skippedBlankRows: number;
  mappingSuggestions: ColumnMappingSuggestion[];
  activeMapping: ColumnMappingSelection;
  needsMappingConfirmation: boolean;
  validRowsCount: number;
  invalidRowsCount: number;
  duplicateCount: number;
  exceedsStrengthCount: number;
  unknownSectionsList: string[];
  detectedDates: string[];
  missingSectionsByDate: Array<{
    attendanceDate: string;
    missingSectionCodes: string[];
  }>;
  rows: ParsedAttendanceRowPreview[];
}

export interface SpaceBootstrapPayload {
  ok: true;
  todayIst: string;
  latestAttendanceDate: string;
  availableAttendanceDates: Array<{
    attendanceDate: string;
    recordedSectionsCount: number;
    totalSectionsCount: number;
    sourceSummary: string;
  }>;
  rooms: SpaceRoomRecord[];
  sections: SpaceSectionRecord[];
  latestSectionAttendance: SectionLatestAttendanceSummary[];
  timetableSlots: TimetableSlot[];
  latestRun: AllocationRunResult | null;
  history: AllocationHistoryEntry[];
  tariffPerKWhINR: number;
  gridCarbonFactorKgCO2PerKWh: number;
}
