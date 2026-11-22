/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type BuildingName =
  | 'G+3 Block'
  | 'New Building'
  | 'Pre-Primary Block'
  | 'Old Building'
  | 'Multipurpose Hall';

export type Floor = 'Ground Floor' | '1st Floor' | '2nd Floor' | '3rd Floor';

export type RoomType =
  | 'General Classroom'
  | 'Science Lab'
  | 'Computer Lab'
  | 'Smart Classroom'
  | 'Staff Room'
  | 'Library'
  | 'Pre-Primary Activity Room'
  | 'Auditorium';

export type OccupancyStatus = 'Occupied' | 'Unoccupied' | 'Standby';

export interface PIRState {
  lastMotionMinutesAgo: number;
  motionEventsPastHour: number;
  graceWindowRemainingMinutes: number;
  status: 'Motion Active' | 'Grace Window Active' | 'Vacancy Confirmed';
  detectionSummary: string;
}

export interface EnvironmentalReading {
  ambientLux: number;
  naturalDaylightLux: number;
  temperature: number; // Celsius
  humidity: number; // % RH
  heatIndex: number; // Apparent temperature Celsius
  co2Ppm: number;
}

export interface CalibrationProfile {
  isCalibrated: boolean;
  dataSufficiencyPercent: number;
  observationDaysCount: number;
  lastCalibratedDate: string;
  learnedParameters: {
    daylightPenetrationAlpha: number; // Ratio of natural window light arriving at student desk surface
    thermalDissipationBeta: number; // Room thermal decay rate under fan circulation (°C/hr)
    occupancyDecayMinutes: number; // Learned quiet-listening duration before PIR vacancy verification
    luminaireEfficiencyLmPerW: number; // Verified lumens/watt output from sensor degradation observation
  };
  manualParameters: {
    targetLux: number; // Default 300 lx for classroom, 400 lx for lab
    maxFanSpeed: number; // 1-5
    comfortTempMin: number; // 24.0°C
    comfortTempMax: number; // 28.5°C
    autoEcoMode: boolean;
    overtimeAllowed: boolean;
  };
  calibrationHistory: Array<{
    timestamp: string;
    parameter: string;
    previousValue: string;
    calibratedValue: string;
    rationale: string;
  }>;
}

export type ApplianceOperatingMode = 'AUTO' | 'MANUAL';

export interface Appliance {
  id: string;
  name: string;
  unitCode?: string;
  sectorIndex?: number;
  type: 'lights' | 'fan' | 'projector' | 'ac' | 'equipment';
  powerRatingWatts: number;
  currentState: string;
  currentPowerWatts: number;
  outputPercent?: number; // 0 - 100 continuous control output
  operatingMode?: ApplianceOperatingMode;
  reportedState?: string;
  lastUpdatedAt?: number;
  lastActivePercent?: number;
  dimmingLevel?: number; // 0 - 100%
  fanSpeed?: number; // 0 - 5 derived compatibility
  isManualOverride: boolean;
  overrideExpiresAt?: string;
}

export interface AdaptiveDecision {
  timestamp: string;
  lightingAction: string;
  lightingReason: string;
  fanAction: string;
  fanReason: string;
  projectorAction?: string;
  energyImpactWatts: number;
  ruleExplanation: string;
}

export interface Classroom {
  id: string;
  roomCode: string;
  name: string;
  building: BuildingName;
  floor: Floor;
  type: RoomType;
  capacity: number;
  currentOccupants: number;
  occupancyStatus: OccupancyStatus;
  pir: PIRState;
  environment: EnvironmentalReading;
  calibration: CalibrationProfile;
  appliances: Appliance[];
  currentPowerWatts: number;
  ratedPowerWatts?: number; // Sum of installed appliance nameplate power ratings in this room (100% max)
  baselinePowerWatts: number; // Estimated pre-retrofit reference capacity (conventional induction fans & non-dimmable fixtures)
  dailyActualKWh: number;
  dailyBaselineKWh: number;
  decision: AdaptiveDecision;
  qrCodeData: string;
  coordinates: {
    gridCol: number;
    gridRow: number;
    widthCols: number;
    heightRows: number;
  };
}

export interface CampusCoordinates {
  latitude: number;
  longitude: number;
  label?: string;
  verifiedByAdmin?: boolean;
  verifiedAt?: string;
}

export interface SchoolSettings {
  institutionName: string;
  campusLocation: string;
  campusCoordinates?: CampusCoordinates;
  tariffPerKWhINR: number; // ₹ per kWh
  gridCarbonFactorKgCO2PerKWh: number; // kg CO2 per kWh
  standardClassroomTargetLux: number;
  labTargetLux: number;
  defaultInactivityGraceMinutes: number;
  learningMode: 'Adaptive Active' | 'Conservative' | 'High Comfort';
  lowPowerMode: boolean;
  schoolHours: {
    start: string;
    end: string;
  };
}

export interface StaffProfile {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  assignedBuilding: string;
  avatarInitials: string;
}

export interface AuditFinding {
  id: string;
  classroomId: string;
  classroomName: string;
  roomCode: string;
  building: BuildingName;
  type: 'phantom_load' | 'over_illumination' | 'empty_room_runtime' | 'thermal_mismatch';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  estimatedWasteWatts: number;
  dailyKWhWaste: number;
  monthlyCostWasteINR: number;
  remediationAction: string;
  isResolved: boolean;
  detectedAt: string;
}

export interface CampusEnergySummary {
  totalCurrentPowerWatts: number;
  totalRatedPowerWatts: number; // Canonical sum of all installed appliance ratings at 100% (13,390 W / 13.39 kW)
  curtailedFromRatedWatts: number; // max(0, totalRatedPowerWatts - totalCurrentPowerWatts)
  ratedUtilizationPercent: number; // (totalCurrentPowerWatts / totalRatedPowerWatts) * 100
  totalBaselinePowerWatts: number; // Estimated pre-retrofit reference capacity (18,635 W / 18.635 kW)
  powerSavedWatts: number;
  dailyActualKWh: number;
  dailyBaselineKWh: number;
  dailySavedKWh: number;
  dailyCostSavedINR: number;
  dailyEmissionsAvoidedKgCO2: number;
  activeOccupancyCount: number;
  totalRoomsOccupied: number;
  totalRoomsCalibrated: number;
}
