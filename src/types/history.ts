/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type HistoryDatePreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'previous_month'
  | 'custom';

export type HistoryGroupingMode = 'total' | 'building' | 'classroom';

export type HistoryAnomalyType =
  | 'excess_over_comparable'
  | 'post_hours_usage'
  | 'vacant_lighting_active'
  | 'abnormal_fan_pattern'
  | 'block_spike';

export type HistorySeverity = 'high' | 'medium' | 'low';
export type HistoryConfidence = 'high' | 'moderate' | 'low';

export interface HistoryRangeMeta {
  preset: HistoryDatePreset;
  startDate: string; // YYYY-MM-DD in Asia/Kolkata
  endDate: string; // YYYY-MM-DD in Asia/Kolkata
  previousStartDate: string;
  previousEndDate: string;
  timezone: 'Asia/Kolkata';
  daysCount: number;
  granularity: 'hourly' | 'daily';
  includesToday: boolean;
  isPartial: boolean;
  recordedRoomIntervals: number;
  expectedRoomIntervals: number;
  completenessPercent: number;
  lastRecordedIstLabel: string;
  note?: string;
}

export interface HistoryKpiMetrics {
  totalActualKWh: number;
  ratedCapacityKWh: number;
  ratedUtilizationPercent: number;
  averageDailyKWh: number;
  estimatedCostINR: number;
  estimatedCo2Kg: number;
  lightingKWh: number;
  fanKWh: number;
  auxKWh: number;
  peakPoint: {
    label: string;
    dateIst: string;
    hourIst?: number;
    actualKWh: number;
    ratedMaxKWh: number;
    occupancyPercent: number;
    note?: string;
  } | null;
  lowestDay: {
    dateIst: string;
    label: string;
    actualKWh: number;
    dayType: string;
  } | null;
  comparison: {
    available: boolean;
    previousTotalKWh: number | null;
    previousAverageDailyKWh: number | null;
    changeKWh: number | null;
    changePercent: number | null;
    note: string;
  };
}

export interface HistoryTrendPoint {
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
  comparableAvgKWh?: number | null;
  lightingKWh: number;
  fanKWh: number;
  auxKWh: number;
  avgOccupancyPercent: number;
  avgTempC: number;
  coveragePercent: number;
  byBuilding: Record<string, number>;
  byRoom?: Record<string, number>;
}

export interface HistoryBlockRanking {
  building: string;
  roomCount: number;
  actualKWh: number;
  ratedMaxKWh: number;
  ratedUtilizationPercent: number;
  sharePercent: number;
  changeVsPrevPercent: number | null;
  lightingKWh: number;
  fanKWh: number;
  auxKWh: number;
  avgOccupancyPercent: number;
  topConsumerRoomCode: string;
  topConsumerRoomName: string;
}

export interface HistoryClassroomRanking {
  roomId: string;
  roomCode: string;
  name: string;
  building: string;
  floor: string;
  roomType: string;
  actualKWh: number;
  ratedMaxKWh: number;
  ratedUtilizationPercent: number;
  sharePercent: number;
  changeVsPrevPercent: number | null;
  lightingKWh: number;
  fanKWh: number;
  auxKWh: number;
  avgOccupancyPercent: number;
  avgTempC: number;
  postHoursKWh: number;
  manualOverrideSharePercent: number;
  anomalyCount: number;
}

export interface HistoryOverviewResponse {
  ok: true;
  range: HistoryRangeMeta;
  tariffPerKWhINR: number;
  gridCarbonFactorKgCO2PerKWh: number;
  kpis: HistoryKpiMetrics;
  series: HistoryTrendPoint[];
  blocks: HistoryBlockRanking[];
  classrooms: HistoryClassroomRanking[];
  installedRatedMaxKW: number;
  dataClassification: string;
}

export interface HistoryEventRecord {
  id: string;
  tsMs: number;
  dateIst: string;
  hourIst: number;
  timeIstLabel: string;
  roomId: string;
  roomCode: string;
  building: string;
  eventType: string;
  summary: string;
  actor: string;
  beforeWatts: number;
  afterWatts: number;
  deltaWatts: number;
}

export interface RoomHistoryPoint {
  key: string;
  label: string;
  dateIst: string;
  hourIst?: number;
  actualKWh: number;
  ratedMaxKWh: number;
  lightingKWh: number;
  fanKWh: number;
  auxKWh: number;
  occupancyPercent: number;
  avgOccupants: number;
  temperatureC: number;
  humidityPercent: number;
  manualSharePercent: number;
  coveragePercent: number;
}

export interface RoomHistoryDetailResponse {
  ok: true;
  room: {
    id: string;
    roomCode: string;
    name: string;
    building: string;
    floor: string;
    type: string;
    capacity: number;
    ratedPowerWatts: number;
  };
  range: HistoryRangeMeta;
  totals: {
    actualKWh: number;
    ratedMaxKWh: number;
    ratedUtilizationPercent: number;
    lightingKWh: number;
    fanKWh: number;
    auxKWh: number;
    postHoursKWh: number;
    avgOccupancyPercent: number;
    avgTempC: number | null;
    changeVsPrevPercent: number | null;
    estimatedCostINR: number;
  };
  series: RoomHistoryPoint[];
  events: HistoryEventRecord[];
  anomalies: HistoricalAnomaly[];
  temperatureSupported: boolean;
}

export interface TimeOfDayHourBucket {
  hourIst: number;
  hourLabel: string; // e.g. "07:00"
  band: 'pre_hours' | 'school_hours' | 'post_hours';
  totalKWh: number;
  avgKW: number;
  ratedMaxKW: number;
  lightingAvgKW: number;
  fanAvgKW: number;
  auxAvgKW: number;
  avgOccupancyPercent: number;
  avgTempC: number;
  sampleDays: number;
  flag: 'peak' | 'low' | 'unusual_spike' | 'post_hours_draw' | 'normal';
  flagReason?: string;
}

export interface TimeOfDayProfileResponse {
  ok: true;
  range: HistoryRangeMeta;
  buildingFilter: string | null;
  roomIdFilter: string | null;
  schoolHoursWindow: { start: string; end: string };
  hours: TimeOfDayHourBucket[];
  summary: {
    peakHourLabel: string;
    peakAvgKW: number;
    peakOccupancyPercent: number;
    lowestHourLabel: string;
    lowestAvgKW: number;
    schoolHoursKWh: number;
    schoolHoursSharePercent: number;
    offHoursKWh: number;
    offHoursSharePercent: number;
    postHoursTotalKWh: number;
    postHoursVacantSharePercent: number;
  };
}

export interface HistoricalAnomaly {
  id: string;
  dateIst: string;
  hourIst: number | null;
  timeWindowLabel: string;
  roomId: string | null;
  roomCode: string | null;
  roomName: string | null;
  building: string;
  type: HistoryAnomalyType;
  severity: HistorySeverity;
  confidence: HistoryConfidence;
  observedKWh: number;
  comparableExpectedKWh: number;
  deviationKWh: number;
  deviationPercent: number;
  title: string;
  explanation: string;
  evidence: string[];
  caveat: string;
}

export interface HistoricalAnomaliesResponse {
  ok: true;
  range: HistoryRangeMeta;
  totalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  anomalies: HistoricalAnomaly[];
}

export interface HistoricalInvestigationResponse {
  ok: true;
  targetPeriod: {
    label: string;
    startDate: string;
    endDate: string;
    actualKWh: number;
    ratedMaxKWh: number;
    comparableHistoricalAvgKWh: number | null;
    deltaVsComparableKWh: number | null;
    deltaVsComparablePercent: number | null;
    isPartial: boolean;
    completenessPercent: number;
  };
  componentDrivers: {
    lightingKWh: number;
    fanKWh: number;
    auxKWh: number;
    postHoursKWh: number;
    avgTempC: number;
    avgOccupancyPercent: number;
  };
  topContributingBlocks: Array<{
    building: string;
    actualKWh: number;
    comparableAvgKWh: number | null;
    deltaKWh: number | null;
    deltaPercent: number | null;
    sharePercent: number;
  }>;
  topContributingRooms: Array<{
    roomCode: string;
    name: string;
    building: string;
    actualKWh: number;
    comparableAvgKWh: number | null;
    deltaKWh: number | null;
    deltaPercent: number | null;
    postHoursKWh: number;
    manualSharePercent: number;
    avgOccupancyPercent: number;
  }>;
  anomalies: HistoricalAnomaly[];
  events: HistoryEventRecord[];
  narrativeSummary: string;
  uncertaintyNotes: string[];
  dayContext?: {
    targetDayTypes: string[];
    isWeekendOrHolidayOnly: boolean;
    comparableSampleDays: number;
    recordedIntervals: number;
    hasData: boolean;
    isUnusuallyHigh: boolean;
    comparisonVerdict:
      | 'elevated'
      | 'within_normal_range'
      | 'below_typical'
      | 'weekend_or_holiday_low'
      | 'no_data'
      | 'insufficient_reference';
    peakHourLabel: string | null;
    peakHourKWh: number | null;
  };
}
