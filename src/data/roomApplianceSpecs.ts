/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Appliance, RoomType } from '../types/energy.ts';
import { applyApplianceState, clampPercent } from '../utils/applianceUtils.ts';

export interface RoomApplianceSpec {
  roomId: string;
  roomCode: string;
  isVacant: boolean;
  lights: {
    count: number;
    totalWatts: number;
    initialPct: number;
  };
  fans: {
    count: number;
    totalWatts: number;
    initialPct: number;
  };
  aux?: {
    id: string;
    name: string;
    type: 'projector' | 'ac' | 'equipment';
    powerRatingWatts: number;
    initialPct: number;
  };
}

export const ROOM_APPLIANCE_SPECS: RoomApplianceSpec[] = [
  { roomId: 'g3-g01', roomCode: 'G3-G01', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'g3-g02', roomCode: 'G3-G02', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'g3-101', roomCode: 'G3-101', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 80 } },
  { roomId: 'g3-102', roomCode: 'G3-102', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  {
    roomId: 'g3-201',
    roomCode: 'G3-201',
    isVacant: false,
    lights: { count: 8, totalWatts: 320, initialPct: 100 },
    fans: { count: 4, totalWatts: 140, initialPct: 40 },
    aux: { id: 'g3201-rails', name: 'Regulated DC Experiment Rail', type: 'projector', powerRatingWatts: 200, initialPct: 48 },
  },
  { roomId: 'g3-202', roomCode: 'G3-202', isVacant: false, lights: { count: 8, totalWatts: 320, initialPct: 100 }, fans: { count: 4, totalWatts: 240, initialPct: 40 } },
  {
    roomId: 'g3-203',
    roomCode: 'G3-203',
    isVacant: false,
    lights: { count: 6, totalWatts: 300, initialPct: 100 },
    fans: { count: 4, totalWatts: 140, initialPct: 60 },
    aux: { id: 'g3203-inc', name: 'Specimen Incubator', type: 'equipment', powerRatingWatts: 120, initialPct: 29 },
  },
  {
    roomId: 'g3-301',
    roomCode: 'G3-301',
    isVacant: false,
    lights: { count: 8, totalWatts: 320, initialPct: 60 },
    fans: { count: 4, totalWatts: 140, initialPct: 40 },
    aux: { id: 'g3301-ac', name: 'Inverter Climate Unit (2x 2.0 TR)', type: 'ac', powerRatingWatts: 2400, initialPct: 52 },
  },
  { roomId: 'g3-302', roomCode: 'G3-302', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 100 }, fans: { count: 4, totalWatts: 140, initialPct: 40 } },
  { roomId: 'nb-g01', roomCode: 'NB-G01', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'nb-g02', roomCode: 'NB-G02', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'nb-101', roomCode: 'NB-101', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 40 } },
  { roomId: 'nb-102', roomCode: 'NB-102', isVacant: true, lights: { count: 6, totalWatts: 240, initialPct: 0 }, fans: { count: 4, totalWatts: 140, initialPct: 0 } },
  { roomId: 'nb-103', roomCode: 'NB-103', isVacant: false, lights: { count: 4, totalWatts: 160, initialPct: 100 }, fans: { count: 3, totalWatts: 105, initialPct: 40 } },
  { roomId: 'nb-201', roomCode: 'NB-201', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 80 } },
  { roomId: 'nb-202', roomCode: 'NB-202', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'pp-01', roomCode: 'PP-01', isVacant: false, lights: { count: 4, totalWatts: 160, initialPct: 100 }, fans: { count: 3, totalWatts: 105, initialPct: 40 } },
  { roomId: 'pp-02', roomCode: 'PP-02', isVacant: false, lights: { count: 4, totalWatts: 160, initialPct: 100 }, fans: { count: 3, totalWatts: 105, initialPct: 40 } },
  { roomId: 'pp-03', roomCode: 'PP-03', isVacant: false, lights: { count: 4, totalWatts: 160, initialPct: 100 }, fans: { count: 3, totalWatts: 105, initialPct: 40 } },
  { roomId: 'ob-g01', roomCode: 'OB-G01', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'ob-g02', roomCode: 'OB-G02', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'ob-101', roomCode: 'OB-101', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'ob-102', roomCode: 'OB-102', isVacant: false, lights: { count: 6, totalWatts: 240, initialPct: 50 }, fans: { count: 4, totalWatts: 140, initialPct: 60 } },
  { roomId: 'ob-201', roomCode: 'OB-201', isVacant: false, lights: { count: 10, totalWatts: 400, initialPct: 60 }, fans: { count: 6, totalWatts: 210, initialPct: 40 } },
  {
    roomId: 'mph-01',
    roomCode: 'MPH-01',
    isVacant: true,
    lights: { count: 16, totalWatts: 640, initialPct: 0 },
    fans: { count: 8, totalWatts: 320, initialPct: 0 },
    aux: { id: 'mph01-av', name: 'Auditorium Laser Projector & Sound Array', type: 'projector', powerRatingWatts: 420, initialPct: 0 },
  },
];

function splitWatts(totalWatts: number, count: number): number[] {
  const base = Math.floor(totalWatts / count);
  const remainder = totalWatts - base * count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i === count - 1 ? base + remainder : base);
  }
  return out;
}

export function buildExpandedAppliancesFromSpec(spec: RoomApplianceSpec): Appliance[] {
  const now = Date.now();
  const list: Appliance[] = [];

  const lightWatts = splitWatts(spec.lights.totalWatts, spec.lights.count);
  const lightPct = clampPercent(spec.lights.initialPct);
  for (let i = 1; i <= spec.lights.count; i++) {
    const unit: Appliance = {
      id: `${spec.roomId}-light-${i}`,
      name: `Light L${i}`,
      unitCode: `L${i}`,
      sectorIndex: i,
      type: 'lights',
      powerRatingWatts: lightWatts[i - 1],
      currentState: '',
      currentPowerWatts: 0,
      outputPercent: lightPct,
      operatingMode: 'AUTO',
      dimmingLevel: lightPct,
      isManualOverride: false,
      lastActivePercent: lightPct > 0 ? lightPct : 60,
    };
    list.push(
      applyApplianceState(unit, lightPct, 'AUTO', {
        isVacant: spec.isVacant,
        timestamp: now,
        sourceNote: 'Simulated Node',
      })
    );
  }

  const fanWatts = splitWatts(spec.fans.totalWatts, spec.fans.count);
  const fanPct = clampPercent(spec.fans.initialPct);
  for (let i = 1; i <= spec.fans.count; i++) {
    const unit: Appliance = {
      id: `${spec.roomId}-fan-${i}`,
      name: `Fan Sector S${i}`,
      unitCode: `S${i}`,
      sectorIndex: i,
      type: 'fan',
      powerRatingWatts: fanWatts[i - 1],
      currentState: '',
      currentPowerWatts: 0,
      outputPercent: fanPct,
      operatingMode: 'AUTO',
      isManualOverride: false,
      lastActivePercent: fanPct > 0 ? fanPct : 60,
    };
    list.push(
      applyApplianceState(unit, fanPct, 'AUTO', {
        isVacant: spec.isVacant,
        timestamp: now,
        sourceNote: 'Simulated Node',
      })
    );
  }

  if (spec.aux) {
    const auxPct = clampPercent(spec.aux.initialPct);
    const auxUnit: Appliance = {
      id: spec.aux.id,
      name: spec.aux.name,
      unitCode: 'AUX',
      sectorIndex: 1,
      type: spec.aux.type,
      powerRatingWatts: spec.aux.powerRatingWatts,
      currentState: '',
      currentPowerWatts: 0,
      outputPercent: auxPct,
      operatingMode: 'AUTO',
      isManualOverride: false,
      lastActivePercent: auxPct > 0 ? auxPct : 100,
    };
    list.push(
      applyApplianceState(auxUnit, auxPct, 'AUTO', {
        isVacant: spec.isVacant,
        timestamp: now,
        sourceNote: 'Simulated Node',
      })
    );
  }

  return list;
}

export const OPERATING_HOURS_PER_DAY = 7.0; // 07:30–14:30 institutional school window
export const SCHOOL_DAYS_PER_MONTH = 22; // Realistic Indian CBSE day-school working days/month (excl. Sundays, 2nd/4th Sat, holidays)
export const SCHOOL_DAYS_PER_YEAR = 225; // Approximate active academic days/year for DAV Model School, IIT Kharagpur

export interface RoomOperatingProfile {
  activeHoursPerSchoolDay: number;
  baselineDutyFactor: number;
  scheduleNote: string;
}

const ROOM_OPERATING_PROFILES: Record<RoomType, RoomOperatingProfile> = {
  'General Classroom': {
    activeHoursPerSchoolDay: 5.8,
    baselineDutyFactor: 0.84,
    scheduleNote: '07:30–14:00 day-school timetable excluding assembly, recess & transitions',
  },
  'Smart Classroom': {
    activeHoursPerSchoolDay: 5.8,
    baselineDutyFactor: 0.84,
    scheduleNote: '07:30–14:00 scheduled interactive teaching periods',
  },
  'Science Lab': {
    activeHoursPerSchoolDay: 4.2,
    baselineDutyFactor: 0.78,
    scheduleNote: 'Scheduled practical batches during mid-day periods (intermittent)',
  },
  'Computer Lab': {
    activeHoursPerSchoolDay: 5.2,
    baselineDutyFactor: 0.82,
    scheduleNote: 'Scheduled ICT batches; designated AC space (only AC-equipped room in 25-node scope)',
  },
  'Pre-Primary Activity Room': {
    activeHoursPerSchoolDay: 4.5,
    baselineDutyFactor: 0.82,
    scheduleNote: 'Shorter early-childhood morning day-school schedule (~08:00–12:30)',
  },
  'Staff Room': {
    activeHoursPerSchoolDay: 6.5,
    baselineDutyFactor: 0.85,
    scheduleNote: 'Faculty occupancy across institutional hours including prep periods',
  },
  Library: {
    activeHoursPerSchoolDay: 6.0,
    baselineDutyFactor: 0.8,
    scheduleNote: 'Continuous reading & reference hours across school day',
  },
  Auditorium: {
    activeHoursPerSchoolDay: 2.0,
    baselineDutyFactor: 0.6,
    scheduleNote: 'Intermittent assembly, seminar & cultural event usage (not continuous daily load)',
  },
};

export function getRoomOperatingProfile(roomType?: RoomType): RoomOperatingProfile {
  if (roomType && roomType in ROOM_OPERATING_PROFILES) {
    return ROOM_OPERATING_PROFILES[roomType];
  }
  return ROOM_OPERATING_PROFILES['General Classroom'];
}

const SPEC_BY_ROOM_ID = new Map<string, RoomApplianceSpec>(
  ROOM_APPLIANCE_SPECS.map((s) => [s.roomId, s])
);

export function getRoomApplianceSpec(roomId: string): RoomApplianceSpec | undefined {
  return SPEC_BY_ROOM_ID.get(roomId);
}

export function computeSpecRatedPowerWatts(spec: RoomApplianceSpec): number {
  return spec.lights.totalWatts + spec.fans.totalWatts + (spec.aux?.powerRatingWatts || 0);
}

export function computeRoomRatedPowerWatts(roomId: string): number {
  const spec = SPEC_BY_ROOM_ID.get(roomId);
  return spec ? computeSpecRatedPowerWatts(spec) : 0;
}

export function computeAppliancesRatedPowerWatts(
  appliances: ReadonlyArray<Pick<Appliance, 'powerRatingWatts'>>
): number {
  let total = 0;
  for (const app of appliances) {
    if (Number.isFinite(app.powerRatingWatts)) {
      total += app.powerRatingWatts;
    }
  }
  return total;
}

export const TOTAL_CAMPUS_RATED_POWER_WATTS: number = ROOM_APPLIANCE_SPECS.reduce(
  (acc, spec) => acc + computeSpecRatedPowerWatts(spec),
  0
);

