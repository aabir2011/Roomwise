/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import * as XLSX from 'xlsx';
import { energyHistoryService } from './energyHistoryService.ts';
import type { BuildingName, Classroom, Floor, RoomType } from '../src/types/energy.ts';
import type {
  AllocationHistoryEntry,
  AllocationProposal,
  AllocationRunResult,
  AnalysisHorizonMode,
  AttendanceSourceType,
  CandidateRejectionReason,
  ColumnMappingSelection,
  ColumnMappingSuggestion,
  ParsedAttendanceRowPreview,
  SectionAllocationPolicy,
  SectionLatestAttendanceSummary,
  SpaceBootstrapPayload,
  SpaceRoomRecord,
  SpaceSectionRecord,
  SpreadsheetParseResult,
  TimetableSlot,
  UnchangedSectionEvaluation,
} from '../src/types/space.ts';
import { INITIAL_CLASSROOMS, INITIAL_SCHOOL_SETTINGS } from '../src/data/initialClassrooms.ts';
import { ROOM_APPLIANCE_SPECS } from '../src/data/roomApplianceSpecs.ts';
import {
  computeAdaptiveTargetFanPercent,
  computeAdaptiveTargetLightPercent,
  computeApplianceWatts,
} from '../src/utils/applianceUtils.ts';
import {
  getIstDateString,
  getIstDayOfWeek,
  getIstHourAndMinute,
  shiftIstDate,
} from '../src/utils/historyDates.ts';

const SPACE_SEED_VERSION = 'v1-space-exhibition-2026';
const MIN_ACTIONABLE_SAVINGS_KWH = 0.12;
const MIN_NET_SCORE_KWH = 0.06;

const baseRoomById = new Map<string, Classroom>(INITIAL_CLASSROOMS.map((r) => [r.id, r]));
const specByRoomId = new Map(ROOM_APPLIANCE_SPECS.map((s) => [s.roomId, s]));

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

function computeSpecWattsAtPct(
  roomId: string,
  lightPct: number,
  fanPct: number,
  auxActivePct: number | null = null
): number {
  const spec = specByRoomId.get(roomId);
  if (!spec) {
    const base = baseRoomById.get(roomId);
    return base ? Math.round((base.baselinePowerWatts * (lightPct + fanPct)) / 200) : 200;
  }

  let lightsW = 0;
  const lClamped = Math.max(0, Math.min(100, Math.round(lightPct)));
  if (lClamped > 0) {
    const perLight = Math.floor(spec.lights.totalWatts / spec.lights.count);
    const remLight = spec.lights.totalWatts - perLight * spec.lights.count;
    for (let i = 0; i < spec.lights.count; i++) {
      const unitW = i === spec.lights.count - 1 ? perLight + remLight : perLight;
      lightsW += computeApplianceWatts('lights', unitW, lClamped);
    }
  }

  let fansW = 0;
  const fClamped = Math.max(0, Math.min(100, Math.round(fanPct)));
  if (fClamped > 0) {
    const perFan = Math.floor(spec.fans.totalWatts / spec.fans.count);
    const remFan = spec.fans.totalWatts - perFan * spec.fans.count;
    for (let i = 0; i < spec.fans.count; i++) {
      const unitW = i === spec.fans.count - 1 ? perFan + remFan : perFan;
      fansW += computeApplianceWatts('fan', unitW, fClamped);
    }
  }

  let auxW = 0;
  if (spec.aux) {
    const aPct =
      auxActivePct !== null
        ? Math.max(0, Math.min(100, Math.round(auxActivePct)))
        : spec.aux.initialPct;
    if (aPct > 0) {
      auxW = computeApplianceWatts(spec.aux.type, spec.aux.powerRatingWatts, aPct);
    }
  }

  return lightsW + fansW + auxW;
}

interface CanonicalSectionSeed {
  sectionId: string;
  sectionCode: string;
  className: string;
  sectionLabel: string;
  displayName: string;
  gradeGroup: SpaceSectionRecord['gradeGroup'];
  homeRoomId: string;
  enrolledStrength: number;
  policy: SectionAllocationPolicy;
  policyNotes: string;
  baselineAttendanceRatio: number;
}

const CANONICAL_SECTION_SEEDS: CanonicalSectionSeed[] = [
  {
    sectionId: 'nursery',
    sectionCode: 'Nursery',
    className: 'Nursery',
    sectionLabel: '',
    displayName: 'Class Nursery',
    gradeGroup: 'pre_primary',
    homeRoomId: 'pp-01',
    enrolledStrength: 25,
    policy: 'fixed_home_room',
    policyNotes: 'Pre-Primary Wing: ground-floor child-safe room only.',
    baselineAttendanceRatio: 0.88,
  },
  {
    sectionId: 'lkg',
    sectionCode: 'LKG',
    className: 'LKG',
    sectionLabel: '',
    displayName: 'Class LKG',
    gradeGroup: 'pre_primary',
    homeRoomId: 'pp-02',
    enrolledStrength: 25,
    policy: 'fixed_home_room',
    policyNotes: 'Pre-Primary Wing: ground-floor child-safe room only.',
    baselineAttendanceRatio: 0.9,
  },
  {
    sectionId: 'ukg',
    sectionCode: 'UKG',
    className: 'UKG',
    sectionLabel: '',
    displayName: 'Class UKG',
    gradeGroup: 'pre_primary',
    homeRoomId: 'pp-03',
    enrolledStrength: 28,
    policy: 'fixed_home_room',
    policyNotes: 'Pre-Primary Wing: ground-floor child-safe room only.',
    baselineAttendanceRatio: 0.91,
  },
  {
    sectionId: 'vi-a',
    sectionCode: 'VI-A',
    className: 'VI',
    sectionLabel: 'A',
    displayName: 'Class VI-A',
    gradeGroup: 'middle',
    homeRoomId: 'nb-g01',
    enrolledStrength: 42,
    policy: 'approved_flexible_block',
    policyNotes: 'May shift within Middle/General classrooms during afternoon blocks.',
    baselineAttendanceRatio: 0.9,
  },
  {
    sectionId: 'vi-b',
    sectionCode: 'VI-B',
    className: 'VI',
    sectionLabel: 'B',
    displayName: 'Class VI-B',
    gradeGroup: 'middle',
    homeRoomId: 'nb-g02',
    enrolledStrength: 42,
    policy: 'approved_flexible_block',
    policyNotes: 'May shift within Middle/General classrooms during afternoon blocks.',
    baselineAttendanceRatio: 0.88,
  },
  {
    sectionId: 'vii-a',
    sectionCode: 'VII-A',
    className: 'VII',
    sectionLabel: 'A',
    displayName: 'Class VII-A',
    gradeGroup: 'middle',
    homeRoomId: 'nb-101',
    enrolledStrength: 40,
    policy: 'approved_flexible_block',
    policyNotes: 'Eligible for energy-saving block reallocation when unoccupied rooms match strength.',
    baselineAttendanceRatio: 0.91,
  },
  {
    sectionId: 'vii-b',
    sectionCode: 'VII-B',
    className: 'VII',
    sectionLabel: 'B',
    displayName: 'Class VII-B',
    gradeGroup: 'middle',
    homeRoomId: 'nb-102',
    enrolledStrength: 40,
    policy: 'approved_flexible_block',
    policyNotes: 'Home room NB-102 becomes available during Lab/Library afternoon periods.',
    baselineAttendanceRatio: 0.89,
  },
  {
    sectionId: 'viii-a',
    sectionCode: 'VIII-A',
    className: 'VIII',
    sectionLabel: 'A',
    displayName: 'Class VIII-A',
    gradeGroup: 'middle',
    homeRoomId: 'nb-201',
    enrolledStrength: 42,
    policy: 'approved_flexible_block',
    policyNotes: 'Eligible for whole-section reallocation across general classrooms.',
    baselineAttendanceRatio: 0.92,
  },
  {
    sectionId: 'viii-b',
    sectionCode: 'VIII-B',
    className: 'VIII',
    sectionLabel: 'B',
    displayName: 'Class VIII-B',
    gradeGroup: 'middle',
    homeRoomId: 'nb-202',
    enrolledStrength: 42,
    policy: 'approved_flexible_block',
    policyNotes: 'Eligible for whole-section reallocation across general classrooms.',
    baselineAttendanceRatio: 0.87,
  },
  {
    sectionId: 'ix-a',
    sectionCode: 'IX-A',
    className: 'IX',
    sectionLabel: 'A',
    displayName: 'Class IX-A',
    gradeGroup: 'secondary',
    homeRoomId: 'ob-g01',
    enrolledStrength: 40,
    policy: 'fixed_home_room',
    policyNotes: 'Fixed Home Room policy: anchor classroom for Secondary Wing.',
    baselineAttendanceRatio: 0.92,
  },
  {
    sectionId: 'ix-b',
    sectionCode: 'IX-B',
    className: 'IX',
    sectionLabel: 'B',
    displayName: 'Class IX-B',
    gradeGroup: 'secondary',
    homeRoomId: 'ob-g02',
    enrolledStrength: 40,
    policy: 'approved_flexible_block',
    policyNotes: 'Eligible when attendance & daylight savings justify movement.',
    baselineAttendanceRatio: 0.925,
  },
  {
    sectionId: 'x-a',
    sectionCode: 'X-A',
    className: 'X',
    sectionLabel: 'A',
    displayName: 'Class X-A',
    gradeGroup: 'secondary',
    homeRoomId: 'g3-g01',
    enrolledStrength: 42,
    policy: 'fixed_home_room',
    policyNotes: 'Board Class Fixed Home Room: continuity protected across academic blocks.',
    baselineAttendanceRatio: 0.94,
  },
  {
    sectionId: 'x-b',
    sectionCode: 'X-B',
    className: 'X',
    sectionLabel: 'B',
    displayName: 'Class X-B',
    gradeGroup: 'secondary',
    homeRoomId: 'g3-g02',
    enrolledStrength: 42,
    policy: 'approved_flexible_block',
    policyNotes: 'Flexible block enabled during non-board elective periods.',
    baselineAttendanceRatio: 0.9,
  },
  {
    sectionId: 'xi-a',
    sectionCode: 'XI-A',
    className: 'XI',
    sectionLabel: 'A',
    displayName: 'Class XI-A (PCM)',
    gradeGroup: 'senior_secondary',
    homeRoomId: 'g3-101',
    enrolledStrength: 44,
    policy: 'approved_flexible_block',
    policyNotes: 'Stream theory blocks scheduled in AC lab annex can shift to daylight rooms.',
    baselineAttendanceRatio: 0.705,
  },
  {
    sectionId: 'xi-b',
    sectionCode: 'XI-B',
    className: 'XI',
    sectionLabel: 'B',
    displayName: 'Class XI-B (PCB)',
    gradeGroup: 'senior_secondary',
    homeRoomId: 'g3-102',
    enrolledStrength: 43,
    policy: 'approved_flexible_block',
    policyNotes: 'Stream theory seminars in high-draw bio wing can shift to vacant daylight rooms.',
    baselineAttendanceRatio: 0.675,
  },
  {
    sectionId: 'xii-a',
    sectionCode: 'XII-A',
    className: 'XII',
    sectionLabel: 'A',
    displayName: 'Class XII-A',
    gradeGroup: 'senior_secondary',
    homeRoomId: 'ob-101',
    enrolledStrength: 42,
    policy: 'approved_flexible_block',
    policyNotes: 'Senior elective blocks eligible for same-block classroom consolidation.',
    baselineAttendanceRatio: 0.64,
  },
  {
    sectionId: 'xii-b',
    sectionCode: 'XII-B',
    className: 'XII',
    sectionLabel: 'B',
    displayName: 'Class XII-B',
    gradeGroup: 'senior_secondary',
    homeRoomId: 'ob-102',
    enrolledStrength: 42,
    policy: 'approved_flexible_block',
    policyNotes: 'Home room OB-102 opens up during afternoon CS Lab practicals.',
    baselineAttendanceRatio: 0.88,
  },
];

const PERIOD_DEFS: Array<{
  code: string;
  start: string;
  end: string;
  durationHours: number;
  hourIst: number;
}> = [
  { code: 'P1', start: '07:45', end: '08:25', durationHours: 0.667, hourIst: 8 },
  { code: 'P2', start: '08:25', end: '09:05', durationHours: 0.667, hourIst: 8 },
  { code: 'P3', start: '09:05', end: '09:45', durationHours: 0.667, hourIst: 9 },
  { code: 'P4', start: '09:45', end: '10:25', durationHours: 0.667, hourIst: 10 },
  { code: 'P5', start: '10:45', end: '11:25', durationHours: 0.667, hourIst: 11 },
  { code: 'P6', start: '11:25', end: '12:05', durationHours: 0.667, hourIst: 11 },
  { code: 'P7', start: '12:05', end: '12:45', durationHours: 0.667, hourIst: 12 },
  { code: 'P8', start: '12:45', end: '13:25', durationHours: 0.667, hourIst: 13 },
];

const SUITABILITY_BY_ROOM_ID: Record<
  string,
  {
    tags: string[];
    isGeneralPoolEligible: boolean;
    isSpecialisedLab: boolean;
    isRestricted: boolean;
    notes: string;
  }
> = {
  'g3-g01': {
    tags: ['general_classroom', 'secondary', 'board_class'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Ground-floor secondary classroom (α=0.68 daylight penetration).',
  },
  'g3-g02': {
    tags: ['general_classroom', 'secondary'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Ground-floor secondary classroom with adaptive luminaire & BLDC control.',
  },
  'g3-101': {
    tags: ['general_classroom', 'senior_secondary'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: '1st Floor PCM Wing classroom with cross ventilation.',
  },
  'g3-102': {
    tags: ['general_classroom', 'senior_secondary'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: '1st Floor PCB Wing classroom (high natural light α=0.72).',
  },
  'g3-201': {
    tags: ['science_lab', 'physics_lab'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: true,
    isRestricted: false,
    notes: 'Specialised Physics Lab with DC experiment rails (avoid for unrelated lectures).',
  },
  'g3-202': {
    tags: ['science_lab', 'chemistry_lab'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: true,
    isRestricted: false,
    notes: 'Specialised Chemistry Lab with fume exhaust ventilation.',
  },
  'g3-203': {
    tags: ['science_lab', 'biology_lab'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: true,
    isRestricted: false,
    notes: 'Specialised Biology Lab with AC Specimen Incubator.',
  },
  'g3-301': {
    tags: ['computer_lab', 'ac_cooled'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: true,
    isRestricted: false,
    notes: 'AC-cooled Computer & AI Lab (2×2.0TR Inverter AC, 2860W peak rating).',
  },
  'g3-302': {
    tags: ['staff_room', 'restricted'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: false,
    isRestricted: true,
    notes: 'Restricted Senior Faculty Staff & Research Room.',
  },
  'nb-g01': {
    tags: ['general_classroom', 'middle'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Middle wing ground classroom with strong courtyard daylight.',
  },
  'nb-g02': {
    tags: ['general_classroom', 'middle'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Middle wing ground classroom.',
  },
  'nb-101': {
    tags: ['general_classroom', 'middle'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'New Building 1st floor general classroom (α=0.63).',
  },
  'nb-102': {
    tags: ['general_classroom', 'middle'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'New Building 1st floor passive daylight classroom (free during lab/library blocks).',
  },
  'nb-103': {
    tags: ['staff_room', 'restricted'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: false,
    isRestricted: true,
    notes: 'Restricted Middle Wing Faculty Room.',
  },
  'nb-201': {
    tags: ['general_classroom', 'middle'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'New Building 2nd floor general classroom (high solar exposure α=0.62).',
  },
  'nb-202': {
    tags: ['general_classroom', 'middle'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'New Building 2nd floor general classroom.',
  },
  'pp-01': {
    tags: ['pre_primary', 'restricted'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: false,
    isRestricted: true,
    notes: 'Pre-Primary Wing Nursery room (age & furniture restriction).',
  },
  'pp-02': {
    tags: ['pre_primary', 'restricted'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: false,
    isRestricted: true,
    notes: 'Pre-Primary Wing LKG room (age & furniture restriction).',
  },
  'pp-03': {
    tags: ['pre_primary', 'restricted'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: false,
    isRestricted: true,
    notes: 'Pre-Primary Wing UKG room (age & furniture restriction).',
  },
  'ob-g01': {
    tags: ['general_classroom', 'secondary'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Old Building ground floor classroom (high natural illumination).',
  },
  'ob-g02': {
    tags: ['general_classroom', 'secondary'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Old Building ground floor classroom.',
  },
  'ob-101': {
    tags: ['general_classroom', 'senior_secondary'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Old Building 1st floor daylight classroom (α=0.71).',
  },
  'ob-102': {
    tags: ['general_classroom', 'senior_secondary'],
    isGeneralPoolEligible: true,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Old Building 1st floor daylight classroom (free during XII-B Computer practicals).',
  },
  'ob-201': {
    tags: ['library', 'reading_hall'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: false,
    isRestricted: false,
    notes: 'Large 80-seat Library & Reading Hall (10 luminaires + 6 fans; higher overhead draw).',
  },
  'mph-01': {
    tags: ['auditorium', 'restricted'],
    isGeneralPoolEligible: false,
    isSpecialisedLab: false,
    isRestricted: true,
    notes: '250-seat Multipurpose Hall reserved for assemblies & board examinations.',
  },
};

function buildCoherentWeeklyTimetable(): TimetableSlot[] {
  const slots: TimetableSlot[] = [];
  const homeRoomBySection = new Map<string, string>(
    CANONICAL_SECTION_SEEDS.map((s) => [s.sectionId, s.homeRoomId])
  );

  // Per-day period schedule overrides for realistic school rotations (all other periods stay in home room!)
  // Carefully verified for zero room collisions and zero teacher collisions per (dayOfWeek, periodCode).
  for (let dayOfWeek = 1; dayOfWeek <= 6; dayOfWeek++) {
    const periodsForDay = dayOfWeek === 6 ? PERIOD_DEFS.slice(0, 5) : PERIOD_DEFS;

    for (const p of periodsForDay) {
      for (const sec of CANONICAL_SECTION_SEEDS) {
        let roomId = homeRoomBySection.get(sec.sectionId)!;
        let subject = `${sec.gradeGroup === 'pre_primary' ? 'Foundational Activity' : 'Core Curriculum'} (${sec.sectionCode})`;
        let teacherCode = `T-HR-${sec.sectionId.toUpperCase()}`;
        let requiresLabFacility = false;
        let isMovableBlock = sec.policy === 'approved_flexible_block';
        let blockWindowLabel = p.code;

        // Mon-Fri scheduled rotations that naturally create realistic energy-saving optimization windows
        if (dayOfWeek <= 5) {
          // 1. P5-P6 (10:45 - 12:05 IST):
          //    - VII-B (home nb-102) goes to Central Library & Middle Lab (ob-201), freeing NB-102 (Cap 40, low passive watts).
          //    - X-B uses G3-101 for a combined Smart Projection Seminar (freeing g3-g02? No, keeping g3-101 busy so XI-A picks NB-102 when attendance <= 40!).
          //    - XI-A (home g3-101) has "Computer Science & AI Theory" scheduled in AC-cooled G3-301 (Computer Lab) even though it's theory-only!
          if (p.code === 'P5' || p.code === 'P6') {
            blockWindowLabel = 'P5–P6';
            if (sec.sectionId === 'vii-b') {
              roomId = 'ob-201';
              subject = 'Library Research & Reading Workshop';
              teacherCode = 'T-LIB-01';
              requiresLabFacility = true;
              isMovableBlock = false;
            } else if (sec.sectionId === 'x-b') {
              roomId = 'g3-101';
              subject = 'Board Science Integrated Colloquium';
              teacherCode = 'T-SCI-04';
              requiresLabFacility = false;
              isMovableBlock = false;
            } else if (sec.sectionId === 'xi-a') {
              roomId = 'g3-301';
              subject = 'Computer Science Theory Lecture (No Workstations Needed)';
              teacherCode = 'T-CS-01';
              requiresLabFacility = false;
              isMovableBlock = true;
            } else if (sec.sectionId === 'vi-a') {
              // VI-A does practical science in Physics Lab in P5-P6
              roomId = 'g3-201';
              subject = 'Middle Science Hands-On Lab';
              teacherCode = 'T-PHY-01';
              requiresLabFacility = true;
              isMovableBlock = false;
            }
          }

          // 2. P7-P8 (12:05 - 13:25 IST):
          //    - XII-B (home ob-102) has mandatory Computer Science Practicals in G3-301 (Computer Lab), freeing OB-102 (Cap 42, same floor Old Bldg!).
          //    - XII-A (home ob-101) has an afternoon Humanities/Economics Tutorial scheduled in OB-201 (large 80-seat Library Hall ~324W, freeing ob-101 for VIII-B or keeping XII-A in OB-201!).
          //      Wait: if XII-A is in OB-201 (~324W) while OB-102 (Cap 42, ~152W) is vacant on the SAME floor, XII-A moving OB-201 -> OB-102 is a clean same-floor consolidation!
          //    - Also XI-B has Biotech/Environmental Seminar (Theory) scheduled in G3-203 (Biology Lab + Incubator ~438W), while VIII-A goes to MPH-01 (Sports/PE Indoor) freeing NB-201 (Cap 42, ~156W)!
          if (p.code === 'P7' || p.code === 'P8') {
            blockWindowLabel = 'P7–P8';
            if (sec.sectionId === 'xii-b') {
              roomId = 'g3-301';
              subject = 'CS & Python Board Practical Lab';
              teacherCode = 'T-CS-01';
              requiresLabFacility = true;
              isMovableBlock = false;
            } else if (sec.sectionId === 'xii-a') {
              roomId = 'ob-201';
              subject = 'Economics & English Seminar (Theory Tutorial)';
              teacherCode = 'T-HUM-02';
              requiresLabFacility = false;
              isMovableBlock = true;
            } else if (sec.sectionId === 'viii-a') {
              roomId = 'mph-01';
              subject = 'Co-Curricular Physical Ed & Assembly Prep';
              teacherCode = 'T-PE-01';
              requiresLabFacility = true;
              isMovableBlock = false;
            } else if (sec.sectionId === 'xi-b') {
              roomId = 'g3-203';
              subject = 'Environmental & Biotech Theory Seminar';
              teacherCode = 'T-BIO-01';
              requiresLabFacility = false;
              isMovableBlock = true;
            }
          }

          // 3. P3-P4 (09:05 - 10:25 IST): IX-B stays in home room ob-g02 for Core Math/Sci, X-A stays fixed in g3-g01, VIII-B in Chemistry Lab on Wed/Fri
          if ((p.code === 'P3' || p.code === 'P4') && (dayOfWeek === 3 || dayOfWeek === 5)) {
            blockWindowLabel = 'P3–P4';
            if (sec.sectionId === 'viii-b') {
              roomId = 'g3-202';
              subject = 'General Chemistry Lab Practical';
              teacherCode = 'T-CHM-01';
              requiresLabFacility = true;
              isMovableBlock = false;
            }
          }
        } else {
          // Saturday half-day (P1-P5): XI-A has CS Theory in G3-301 during P4-P5 while VII-B is in OB-201 Library
          if (p.code === 'P4' || p.code === 'P5') {
            blockWindowLabel = 'P4–P5';
            if (sec.sectionId === 'vii-b') {
              roomId = 'ob-201';
              subject = 'Saturday Library Project Session';
              teacherCode = 'T-LIB-01';
              requiresLabFacility = true;
              isMovableBlock = false;
            } else if (sec.sectionId === 'xi-a') {
              roomId = 'g3-301';
              subject = 'Algorithm Design & Flowcharts (Theory)';
              teacherCode = 'T-CS-01';
              requiresLabFacility = false;
              isMovableBlock = true;
            }
          }
        }

        slots.push({
          slotId: `tt-d${dayOfWeek}-${p.code}-${sec.sectionId}`,
          dayOfWeek,
          periodCode: p.code,
          startTime: p.start,
          endTime: p.end,
          durationHours: p.durationHours,
          sectionId: sec.sectionId,
          roomId,
          subject,
          teacherCode,
          requiresLabFacility,
          isMovableBlock,
          blockWindowLabel,
        });
      }
    }
  }

  // Self-verify zero room double-booking or teacher double-booking in seeded timetable
  const roomSlotKeys = new Set<string>();
  const teacherSlotKeys = new Set<string>();
  for (const s of slots) {
    const rk = `${s.dayOfWeek}:${s.periodCode}:${s.roomId}`;
    if (roomSlotKeys.has(rk)) {
      throw new Error(`Seed timetable room collision detected at ${rk} (${s.sectionId})`);
    }
    roomSlotKeys.add(rk);

    const tk = `${s.dayOfWeek}:${s.periodCode}:${s.teacherCode}`;
    if (teacherSlotKeys.has(tk)) {
      throw new Error(`Seed timetable teacher collision detected at ${tk} (${s.sectionId})`);
    }
    teacherSlotKeys.add(tk);
  }

  return slots;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function normalizeDateCell(raw: unknown): { normalized: string | null; rawDisplay: string; error?: string } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { normalized: null, rawDisplay: '', error: 'Missing attendance date' };
  }

  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    const ist = getIstDateString(raw);
    return { normalized: ist, rawDisplay: ist };
  }

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 25000 && raw < 80000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const y = String(parsed.y).padStart(4, '0');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      const iso = `${y}-${m}-${d}`;
      return { normalized: iso, rawDisplay: iso };
    }
  }

  const str = String(raw).trim();

  // YYYY-MM-DD or YYYY/MM/DD
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(str);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const iso = validateCalendarDate(y, mo, d);
    return iso
      ? { normalized: iso, rawDisplay: str }
      : { normalized: null, rawDisplay: str, error: `Invalid calendar date '${str}'` };
  }

  // DD-MM-YYYY or DD/MM/YYYY
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(str);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    const iso = validateCalendarDate(y, mo, d);
    return iso
      ? { normalized: iso, rawDisplay: str }
      : { normalized: null, rawDisplay: str, error: `Invalid calendar date '${str}'` };
  }

  // DD-MMM-YYYY (e.g. 18-Nov-2026)
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(20\d{2})$/.exec(str);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTH_MAP[m[2].toLowerCase()];
    const y = Number(m[3]);
    const iso = mo ? validateCalendarDate(y, mo, d) : null;
    return iso
      ? { normalized: iso, rawDisplay: str }
      : { normalized: null, rawDisplay: str, error: `Invalid date format '${str}'` };
  }

  return {
    normalized: null,
    rawDisplay: str,
    error: `Unrecognized date '${str}' (expected YYYY-MM-DD or DD-MM-YYYY)`,
  };
}

function validateCalendarDate(year: number, month: number, day: number): string | null {
  if (year < 2020 || year > 2035 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ms = Date.parse(`${iso}T12:00:00.000+05:30`);
  if (!Number.isFinite(ms)) return null;
  return getIstDateString(new Date(ms)) === iso ? iso : null;
}

class SpaceIntelligenceService {
  private initialized = false;

  private get db(): DatabaseSync {
    return energyHistoryService.getDb();
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.createSchema();
      this.ensureSeedData();
    } catch (err) {
      this.initialized = false;
      throw err;
    }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS space_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS space_rooms (
        room_id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        room_name TEXT NOT NULL,
        building TEXT NOT NULL,
        floor TEXT NOT NULL,
        room_type TEXT NOT NULL,
        max_occupancy INTEGER NOT NULL,
        home_section_id TEXT,
        suitability_tags_json TEXT NOT NULL,
        is_general_pool_eligible INTEGER NOT NULL DEFAULT 0,
        is_specialised_lab INTEGER NOT NULL DEFAULT 0,
        is_restricted INTEGER NOT NULL DEFAULT 0,
        rated_power_watts INTEGER NOT NULL,
        estimated_operating_watts INTEGER NOT NULL,
        daylight_alpha REAL NOT NULL,
        notes TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS space_sections (
        section_id TEXT PRIMARY KEY,
        section_code TEXT NOT NULL UNIQUE,
        class_name TEXT NOT NULL,
        section_label TEXT NOT NULL,
        display_name TEXT NOT NULL,
        grade_group TEXT NOT NULL,
        home_room_id TEXT NOT NULL,
        home_room_code TEXT NOT NULL,
        enrolled_strength INTEGER NOT NULL,
        policy TEXT NOT NULL,
        policy_notes TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS space_timetable (
        slot_id TEXT PRIMARY KEY,
        day_of_week INTEGER NOT NULL,
        period_code TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        duration_hours REAL NOT NULL,
        section_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        teacher_code TEXT NOT NULL,
        requires_lab_facility INTEGER NOT NULL DEFAULT 0,
        is_movable_block INTEGER NOT NULL DEFAULT 1,
        block_window_label TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_space_tt_day_period
        ON space_timetable(day_of_week, period_code);

      CREATE TABLE IF NOT EXISTS space_attendance (
        id TEXT PRIMARY KEY,
        attendance_date TEXT NOT NULL,
        section_id TEXT NOT NULL,
        present_count INTEGER NOT NULL,
        enrolled_strength_snapshot INTEGER NOT NULL,
        source TEXT NOT NULL,
        import_batch_id TEXT,
        notes TEXT,
        recorded_at INTEGER NOT NULL,
        UNIQUE(attendance_date, section_id)
      );

      CREATE INDEX IF NOT EXISTS idx_space_att_date
        ON space_attendance(attendance_date, section_id);

      CREATE TABLE IF NOT EXISTS space_allocation_runs (
        run_id TEXT PRIMARY KEY,
        attendance_date TEXT NOT NULL,
        target_day_of_week INTEGER NOT NULL,
        analysis_mode TEXT NOT NULL,
        horizon_label TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        unchanged_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS space_allocation_proposals (
        proposal_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        attendance_date TEXT NOT NULL,
        analysis_mode TEXT NOT NULL,
        section_id TEXT NOT NULL,
        existing_room_id TEXT NOT NULL,
        proposed_room_id TEXT NOT NULL,
        window_label TEXT NOT NULL,
        period_codes_json TEXT NOT NULL,
        net_energy_savings_kwh REAL NOT NULL,
        net_score_kwh REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload_json TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        review_note TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_space_prop_run
        ON space_allocation_proposals(run_id);

      CREATE TABLE IF NOT EXISTS space_allocation_history (
        history_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        attendance_date TEXT NOT NULL,
        section_id TEXT NOT NULL,
        section_code TEXT NOT NULL,
        section_display_name TEXT NOT NULL,
        existing_room_id TEXT NOT NULL,
        existing_room_code TEXT NOT NULL,
        proposed_room_id TEXT NOT NULL,
        proposed_room_code TEXT NOT NULL,
        window_label TEXT NOT NULL,
        period_codes_json TEXT NOT NULL,
        decision TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        note TEXT,
        net_energy_savings_kwh REAL NOT NULL,
        cost_savings_inr REAL NOT NULL,
        co2_avoided_kg REAL NOT NULL,
        decided_at INTEGER NOT NULL
      );
    `);
  }

  private getLatestSeededInstructionalDate(todayIst: string): string {
    // Latest completed instructional day is strictly before todayIst (skip Sunday)
    let cursor = shiftIstDate(todayIst, -1);
    while (getIstDayOfWeek(cursor) === 0) {
      cursor = shiftIstDate(cursor, -1);
    }
    return cursor;
  }

  private ensureSeedData(): void {
    const metaRow = this.db
      .prepare('SELECT value FROM space_meta WHERE key = ?')
      .get('seed_version') as { value: string } | undefined;

    if (metaRow?.value === SPACE_SEED_VERSION) {
      // Top up any missing recent instructional dates cleanly without overwriting user edits/imports
      this.topUpMissingPreloadedAttendance();
      return;
    }

    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // Seed canonical 25 rooms preserving exact INITIAL_CLASSROOMS.capacity
      const insertRoom = this.db.prepare(`
        INSERT OR IGNORE INTO space_rooms (
          room_id, room_code, room_name, building, floor, room_type,
          max_occupancy, home_section_id, suitability_tags_json,
          is_general_pool_eligible, is_specialised_lab, is_restricted,
          rated_power_watts, estimated_operating_watts, daylight_alpha,
          notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const homeSectionByRoomId = new Map<string, string>(
        CANONICAL_SECTION_SEEDS.map((s) => [s.homeRoomId, s.sectionId])
      );

      for (const room of INITIAL_CLASSROOMS) {
        const suit = SUITABILITY_BY_ROOM_ID[room.id] || {
          tags: ['general_classroom'],
          isGeneralPoolEligible: room.type === 'General Classroom',
          isSpecialisedLab: room.type === 'Science Lab' || room.type === 'Computer Lab',
          isRestricted: room.type === 'Staff Room' || room.type === 'Pre-Primary Activity Room',
          notes: `${room.building} · ${room.floor}`,
        };
        const spec = specByRoomId.get(room.id);
        const ratedWatts = spec
          ? spec.lights.totalWatts + spec.fans.totalWatts + (spec.aux?.powerRatingWatts || 0)
          : room.baselinePowerWatts;
        const estWatts = computeSpecWattsAtPct(
          room.id,
          computeAdaptiveTargetLightPercent(room),
          computeAdaptiveTargetFanPercent(room),
          spec?.aux ? spec.aux.initialPct : null
        );

        insertRoom.run(
          room.id,
          room.roomCode,
          room.name,
          room.building,
          room.floor,
          room.type,
          room.capacity,
          homeSectionByRoomId.get(room.id) || null,
          JSON.stringify(suit.tags),
          suit.isGeneralPoolEligible ? 1 : 0,
          suit.isSpecialisedLab ? 1 : 0,
          suit.isRestricted ? 1 : 0,
          ratedWatts,
          Math.max(95, estWatts || Math.round(room.baselinePowerWatts * 0.45)),
          room.calibration.learnedParameters.daylightPenetrationAlpha,
          suit.notes,
          now
        );
      }

      // Seed 17 canonical school sections with single canonical enrolledStrength
      const insertSection = this.db.prepare(`
        INSERT OR IGNORE INTO space_sections (
          section_id, section_code, class_name, section_label, display_name,
          grade_group, home_room_id, home_room_code, enrolled_strength,
          policy, policy_notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const sec of CANONICAL_SECTION_SEEDS) {
        const homeRoom = baseRoomById.get(sec.homeRoomId);
        insertSection.run(
          sec.sectionId,
          sec.sectionCode,
          sec.className,
          sec.sectionLabel,
          sec.displayName,
          sec.gradeGroup,
          sec.homeRoomId,
          homeRoom?.roomCode || sec.homeRoomId.toUpperCase(),
          sec.enrolledStrength,
          sec.policy,
          sec.policyNotes,
          now
        );
      }

      // Seed coherent conflict-free Mon-Sat timetable
      const insertTt = this.db.prepare(`
        INSERT OR REPLACE INTO space_timetable (
          slot_id, day_of_week, period_code, start_time, end_time,
          duration_hours, section_id, room_id, subject, teacher_code,
          requires_lab_facility, is_movable_block, block_window_label
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const slot of buildCoherentWeeklyTimetable()) {
        insertTt.run(
          slot.slotId,
          slot.dayOfWeek,
          slot.periodCode,
          slot.startTime,
          slot.endTime,
          slot.durationHours,
          slot.sectionId,
          slot.roomId,
          slot.subject,
          slot.teacherCode,
          slot.requiresLabFacility ? 1 : 0,
          slot.isMovableBlock ? 1 : 0,
          slot.blockWindowLabel
        );
      }

      this.db
        .prepare('INSERT OR REPLACE INTO space_meta (key, value) VALUES (?, ?)')
        .run('seed_version', SPACE_SEED_VERSION);

      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    this.topUpMissingPreloadedAttendance();

    // Pre-populate an initial allocation run so dashboard/demo views also have immediate history context if opened
    const runCountRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM space_allocation_runs')
      .get() as { cnt: number };
    if (!runCountRow || runCountRow.cnt === 0) {
      const todayIst = getIstDateString();
      const latestDate = this.getLatestSeededInstructionalDate(todayIst);
      this.runAllocationAnalysis({ attendanceDate: latestDate });
    }
  }

  private topUpMissingPreloadedAttendance(): void {
    const todayIst = getIstDateString();
    const latestCompleted = this.getLatestSeededInstructionalDate(todayIst);
    const sections = this.listSections();
    const seedById = new Map(CANONICAL_SECTION_SEEDS.map((s) => [s.sectionId, s]));

    // Seed 35 completed instructional days up to latestCompleted (skip Sundays)
    const datesToEnsure: string[] = [];
    let cursor = latestCompleted;
    let guard = 0;
    while (datesToEnsure.length < 34 && guard < 60) {
      const dow = getIstDayOfWeek(cursor);
      if (dow !== 0) {
        datesToEnsure.push(cursor);
      }
      cursor = shiftIstDate(cursor, -1);
      guard++;
    }

    const existingKeys = new Set<string>();
    const existingRows = this.db
      .prepare('SELECT attendance_date, section_id FROM space_attendance')
      .all() as Array<{ attendance_date: string; section_id: string }>;
    for (const r of existingRows) {
      existingKeys.add(`${r.attendance_date}:${r.section_id}`);
    }

    const insertAtt = this.db.prepare(`
      INSERT OR IGNORE INTO space_attendance (
        id, attendance_date, section_id, present_count,
        enrolled_strength_snapshot, source, import_batch_id, notes, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (let dIdx = 0; dIdx < datesToEnsure.length; dIdx++) {
        const dateStr = datesToEnsure[dIdx];
        const isLatestDay = dateStr === latestCompleted;
        const dow = getIstDayOfWeek(dateStr);

        for (const sec of sections) {
          if (existingKeys.has(`${dateStr}:${sec.sectionId}`)) continue;
          const seed = seedById.get(sec.sectionId);
          const baseRatio = seed?.baselineAttendanceRatio ?? 0.88;

          let presentCount: number;
          if (isLatestDay) {
            // Exhibition-calibrated latest completed day:
            // XI-A: 31/44 (fits NB-102 cap 40, moves out of AC Computer Lab G3-301)
            // XII-A: 26/42 (fits OB-102 cap 42, moves out of Library Hall OB-201)
            // XI-B: 29/43 (fits NB-201 cap 42, moves out of Biology Lab G3-203)
            // X-B: 38/42, IX-B: 37/40, X-A: 40/42, IX-A: 38/40, VII-A: 36/40, VI-A: 39/42, VI-B: 37/42
            if (sec.sectionId === 'xi-a') presentCount = Math.min(sec.enrolledStrength, 31);
            else if (sec.sectionId === 'xii-a') presentCount = Math.min(sec.enrolledStrength, 26);
            else if (sec.sectionId === 'xi-b') presentCount = Math.min(sec.enrolledStrength, 29);
            else {
              const jitter = (seededUnit(`${dateStr}:${sec.sectionId}`) - 0.45) * 0.06;
              presentCount = Math.max(
                1,
                Math.min(
                  sec.enrolledStrength,
                  Math.round(sec.enrolledStrength * (baseRatio + jitter))
                )
              );
            }
          } else {
            const satDip = dow === 6 ? -0.05 : 0;
            const noise = (seededUnit(`${dateStr}:${sec.sectionId}`) - 0.5) * 0.14;
            const ratio = Math.max(0.54, Math.min(0.98, baseRatio + satDip + noise));
            presentCount = Math.max(
              1,
              Math.min(sec.enrolledStrength, Math.round(sec.enrolledStrength * ratio))
            );
          }

          insertAtt.run(
            `att-${dateStr}-${sec.sectionId}`,
            dateStr,
            sec.sectionId,
            presentCount,
            sec.enrolledStrength,
            'Preloaded',
            null,
            'Preloaded School Register',
            now
          );
        }
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public listRooms(): SpaceRoomRecord[] {
    this.init();
    const rows = this.db
      .prepare('SELECT * FROM space_rooms ORDER BY room_code ASC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      roomId: String(r.room_id),
      roomCode: String(r.room_code),
      roomName: String(r.room_name),
      building: String(r.building) as BuildingName,
      floor: String(r.floor) as Floor,
      roomType: String(r.room_type) as RoomType,
      maxOccupancy: Number(r.max_occupancy),
      homeSectionId: r.home_section_id ? String(r.home_section_id) : null,
      suitabilityTags: JSON.parse(String(r.suitability_tags_json || '[]')) as string[],
      isGeneralPoolEligible: Number(r.is_general_pool_eligible) === 1,
      isSpecialisedLab: Number(r.is_specialised_lab) === 1,
      isRestricted: Number(r.is_restricted) === 1,
      ratedPowerWatts: Number(r.rated_power_watts),
      estimatedOperatingWatts: Number(r.estimated_operating_watts),
      daylightAlpha: Number(r.daylight_alpha),
      notes: String(r.notes),
      updatedAt: Number(r.updated_at),
    }));
  }

  public listSections(): SpaceSectionRecord[] {
    this.init();
    const rows = this.db
      .prepare('SELECT * FROM space_sections ORDER BY section_id ASC')
      .all() as Array<Record<string, unknown>>;

    const orderMap = new Map(CANONICAL_SECTION_SEEDS.map((s, idx) => [s.sectionId, idx]));
    const parsed = rows.map((r) => ({
      sectionId: String(r.section_id),
      sectionCode: String(r.section_code),
      className: String(r.class_name),
      sectionLabel: String(r.section_label),
      displayName: String(r.display_name),
      gradeGroup: String(r.grade_group) as SpaceSectionRecord['gradeGroup'],
      homeRoomId: String(r.home_room_id),
      homeRoomCode: String(r.home_room_code),
      enrolledStrength: Number(r.enrolled_strength),
      policy: String(r.policy) as SectionAllocationPolicy,
      policyNotes: String(r.policy_notes),
      updatedAt: Number(r.updated_at),
    }));

    return parsed.sort((a, b) => (orderMap.get(a.sectionId) ?? 99) - (orderMap.get(b.sectionId) ?? 99));
  }

  public listTimetableSlots(dayOfWeek?: number): TimetableSlot[] {
    this.init();
    const rows = (
      typeof dayOfWeek === 'number'
        ? this.db
            .prepare('SELECT * FROM space_timetable WHERE day_of_week = ? ORDER BY period_code, section_id')
            .all(dayOfWeek)
        : this.db
            .prepare('SELECT * FROM space_timetable ORDER BY day_of_week, period_code, section_id')
            .all()
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      slotId: String(r.slot_id),
      dayOfWeek: Number(r.day_of_week),
      periodCode: String(r.period_code),
      startTime: String(r.start_time),
      endTime: String(r.end_time),
      durationHours: Number(r.duration_hours),
      sectionId: String(r.section_id),
      roomId: String(r.room_id),
      subject: String(r.subject),
      teacherCode: String(r.teacher_code),
      requiresLabFacility: Number(r.requires_lab_facility) === 1,
      isMovableBlock: Number(r.is_movable_block) === 1,
      blockWindowLabel: String(r.block_window_label),
    }));
  }

  public getBootstrapPayload(
    selectedDate?: string,
    overrides?: { tariffPerKWhINR?: number; gridCarbonFactorKgCO2PerKWh?: number }
  ): SpaceBootstrapPayload {
    this.init();
    const todayIst = getIstDateString();
    const rooms = this.listRooms();
    const sections = this.listSections();

    const dateRows = this.db
      .prepare(`
        SELECT attendance_date,
               COUNT(*) AS recorded_count,
               GROUP_CONCAT(DISTINCT source) AS sources
        FROM space_attendance
        GROUP BY attendance_date
        ORDER BY attendance_date DESC
        LIMIT 45
      `)
      .all() as Array<{ attendance_date: string; recorded_count: number; sources: string }>;

    const availableAttendanceDates = dateRows.map((d) => ({
      attendanceDate: d.attendance_date,
      recordedSectionsCount: Number(d.recorded_count),
      totalSectionsCount: sections.length,
      sourceSummary: String(d.sources || 'Preloaded'),
    }));

    const latestRun = this.getLatestAllocationRun();
    const runDateAvailable =
      latestRun && availableAttendanceDates.some((d) => d.attendanceDate === latestRun.attendanceDate)
        ? latestRun.attendanceDate
        : undefined;

    const latestAttendanceDate =
      (selectedDate && availableAttendanceDates.some((d) => d.attendanceDate === selectedDate)
        ? selectedDate
        : runDateAvailable || availableAttendanceDates[0]?.attendanceDate) ||
      this.getLatestSeededInstructionalDate(todayIst);

    const attForDateRows = this.db
      .prepare('SELECT * FROM space_attendance WHERE attendance_date = ?')
      .all(latestAttendanceDate) as Array<Record<string, unknown>>;
    const attBySection = new Map(attForDateRows.map((a) => [String(a.section_id), a]));

    const latestSectionAttendance: SectionLatestAttendanceSummary[] = sections.map((section) => {
      const rec = attBySection.get(section.sectionId);
      if (!rec) {
        return {
          section,
          attendanceDate: latestAttendanceDate,
          presentCount: null,
          attendancePercent: null,
          source: null,
          hasRecordForSelectedDate: false,
        };
      }
      const presentCount = Number(rec.present_count);
      const pct =
        section.enrolledStrength > 0
          ? round1((presentCount / section.enrolledStrength) * 100)
          : 0;
      return {
        section,
        attendanceDate: latestAttendanceDate,
        presentCount,
        attendancePercent: pct,
        source: String(rec.source) as AttendanceSourceType,
        hasRecordForSelectedDate: true,
      };
    });

    const targetDow = getIstDayOfWeek(latestAttendanceDate) || 1;
    const timetableSlots = this.listTimetableSlots(targetDow);
    const history = this.listAllocationHistory(40);

    return {
      ok: true,
      todayIst,
      latestAttendanceDate,
      availableAttendanceDates,
      rooms,
      sections,
      latestSectionAttendance,
      timetableSlots,
      latestRun,
      history,
      tariffPerKWhINR: overrides?.tariffPerKWhINR ?? INITIAL_SCHOOL_SETTINGS.tariffPerKWhINR,
      gridCarbonFactorKgCO2PerKWh:
        overrides?.gridCarbonFactorKgCO2PerKWh ?? INITIAL_SCHOOL_SETTINGS.gridCarbonFactorKgCO2PerKWh,
    };
  }

  public resetTemporaryAllocationState(overrides?: {
    tariffPerKWhINR?: number;
    gridCarbonFactorKgCO2PerKWh?: number;
  }): AllocationRunResult {
    this.init();
    this.topUpMissingPreloadedAttendance();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.exec('DELETE FROM space_allocation_history;');
      this.db.exec('DELETE FROM space_allocation_proposals;');
      this.db.exec('DELETE FROM space_allocation_runs;');
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    const todayIst = getIstDateString();
    const baselineDate = this.getLatestSeededInstructionalDate(todayIst);
    return this.runAllocationAnalysis({
      attendanceDate: baselineDate,
      mode: 'actual',
      tariffPerKWhINR: overrides?.tariffPerKWhINR,
      gridCarbonFactorKgCO2PerKWh: overrides?.gridCarbonFactorKgCO2PerKWh,
    });
  }

  public getLatestAllocationRun(): AllocationRunResult | null {
    this.init();
    const row = this.db
      .prepare('SELECT * FROM space_allocation_runs ORDER BY created_at DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    if (!row) return null;

    const propRows = this.db
      .prepare('SELECT * FROM space_allocation_proposals WHERE run_id = ? ORDER BY net_score_kwh DESC')
      .all(String(row.run_id)) as Array<Record<string, unknown>>;

    const proposals: AllocationProposal[] = propRows.map((p) => {
      const payload = JSON.parse(String(p.payload_json)) as AllocationProposal;
      return {
        ...payload,
        status: String(p.status) as AllocationProposal['status'],
        reviewedBy: p.reviewed_by ? String(p.reviewed_by) : null,
        reviewedAt: p.reviewed_at ? Number(p.reviewed_at) : null,
        reviewNote: p.review_note ? String(p.review_note) : null,
      };
    });

    const summary = JSON.parse(String(row.summary_json)) as AllocationRunResult['summary'];
    const unchangedSections = JSON.parse(
      String(row.unchanged_json)
    ) as UnchangedSectionEvaluation[];

    return {
      ok: true,
      runId: String(row.run_id),
      attendanceDate: String(row.attendance_date),
      targetDayOfWeek: Number(row.target_day_of_week),
      analysisMode: String(row.analysis_mode) as AnalysisHorizonMode,
      horizonLabel: String(row.horizon_label),
      createdAt: Number(row.created_at),
      summary,
      proposals,
      unchangedSections,
    };
  }

  public listAllocationHistory(limit = 50): AllocationHistoryEntry[] {
    this.init();
    const rows = this.db
      .prepare('SELECT * FROM space_allocation_history ORDER BY decided_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      historyId: String(r.history_id),
      proposalId: String(r.proposal_id),
      runId: String(r.run_id),
      attendanceDate: String(r.attendance_date),
      sectionId: String(r.section_id),
      sectionCode: String(r.section_code),
      sectionDisplayName: String(r.section_display_name),
      existingRoomId: String(r.existing_room_id),
      existingRoomCode: String(r.existing_room_code),
      proposedRoomId: String(r.proposed_room_id),
      proposedRoomCode: String(r.proposed_room_code),
      windowLabel: String(r.window_label),
      periodCodes: JSON.parse(String(r.period_codes_json || '[]')) as string[],
      decision: String(r.decision) as 'approved' | 'rejected',
      actorName: String(r.actor_name),
      note: r.note ? String(r.note) : null,
      netEnergySavingsKWh: Number(r.net_energy_savings_kwh),
      costSavingsINR: Number(r.cost_savings_inr),
      co2AvoidedKg: Number(r.co2_avoided_kg),
      decidedAt: Number(r.decided_at),
    }));
  }

  public buildTemplateCsv(): string {
    this.init();
    const sections = this.listSections();
    const todayIst = getIstDateString();
    const sampleDate = this.getLatestSeededInstructionalDate(todayIst);
    const lines = ['attendance_date,class,section,present_count'];
    for (const sec of sections) {
      const attRow = this.db
        .prepare('SELECT present_count FROM space_attendance WHERE attendance_date = ? AND section_id = ?')
        .get(sampleDate, sec.sectionId) as { present_count: number } | undefined;
      const sampleCount = attRow?.present_count ?? Math.round(sec.enrolledStrength * 0.88);
      lines.push(`${sampleDate},${sec.className},${sec.sectionLabel || '-'},${sampleCount}`);
    }
    return lines.join('\n') + '\n';
  }

  private resolveSectionMatch(rawClass: string, rawSection: string): SpaceSectionRecord | null {
    const sections = this.listSections();
    const cClean = rawClass
      .replace(/^class\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    const sClean = rawSection.replace(/\s+/g, ' ').trim().toUpperCase();

    // Exact combined tokens like "X-A", "XI-B", "NURSERY", "LKG", "UKG"
    const combinedDirect =
      sClean && sClean !== '-' && sClean !== 'A' && !cClean.includes(sClean)
        ? `${cClean}-${sClean}`
        : sClean && sClean !== '-' && !cClean.includes('-')
        ? `${cClean}-${sClean}`
        : cClean;

    for (const sec of sections) {
      const codeUp = sec.sectionCode.toUpperCase();
      const clsUp = sec.className.toUpperCase();
      const lblUp = sec.sectionLabel.toUpperCase();

      if (cClean === codeUp || combinedDirect === codeUp) {
        return sec;
      }
      if (lblUp) {
        if (cClean === clsUp && sClean === lblUp) return sec;
        if (cClean === `${clsUp} ${lblUp}`) return sec;
      } else {
        // Nursery / LKG / UKG (optional '-' or 'A' in section column)
        if (cClean === clsUp && (sClean === '' || sClean === '-' || sClean === 'A' || sClean === clsUp)) {
          return sec;
        }
      }
    }

    return null;
  }

  public parseAttendanceSpreadsheet(input: {
    fileName: string;
    fileBase64?: string;
    csvText?: string;
    sheetName?: string;
    columnMapping?: Partial<ColumnMappingSelection>;
  }): SpreadsheetParseResult {
    this.init();

    let workbook: XLSX.WorkBook;
    if (input.fileBase64) {
      const cleanBase64 = input.fileBase64.includes(',')
        ? input.fileBase64.split(',').pop() || ''
        : input.fileBase64;
      const buf = Buffer.from(cleanBase64, 'base64');
      workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
    } else if (typeof input.csvText === 'string' && input.csvText.trim().length > 0) {
      workbook = XLSX.read(input.csvText, { type: 'string', cellDates: true });
    } else {
      throw new Error('No spreadsheet content received. Upload a CSV or XLSX file.');
    }

    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      throw new Error('Workbook contains zero worksheets.');
    }

    const activeSheet =
      input.sheetName && sheetNames.includes(input.sheetName) ? input.sheetName : sheetNames[0];
    const ws = workbook.Sheets[activeSheet];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: '',
    });

    // Scan top 10 rows to locate best header row (row with >=2 non-empty string cells)
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(10, matrix.length); i++) {
      const row = matrix[i] || [];
      const nonEmpty = row.filter((c) => String(c ?? '').trim().length > 0);
      if (nonEmpty.length >= 2) {
        headerRowIndex = i;
        break;
      }
    }

    const rawHeaderRow = matrix[headerRowIndex] || [];
    const headers: string[] = rawHeaderRow
      .map((cell, idx) => {
        const text = String(cell ?? '').trim();
        return text || `Column_${idx + 1}`;
      })
      .filter((h, idx, arr) => h.length > 0 && arr.indexOf(h) === idx);

    const normalizeHeaderKey = (h: string) =>
      h
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const suggestField = (
      field: keyof ColumnMappingSelection,
      label: string,
      highAliases: string[],
      mediumAliases: string[]
    ): ColumnMappingSuggestion => {
      for (const h of headers) {
        const k = normalizeHeaderKey(h);
        if (highAliases.includes(k)) {
          return { field, label, suggestedColumn: h, confidence: 'high' };
        }
      }
      for (const h of headers) {
        const k = normalizeHeaderKey(h);
        if (mediumAliases.some((m) => k.includes(m))) {
          return { field, label, suggestedColumn: h, confidence: 'medium' };
        }
      }
      return { field, label, suggestedColumn: null, confidence: 'none' };
    };

    const sDate = suggestField(
      'attendanceDate',
      'Attendance Date',
      ['attendance_date', 'date', 'record_date', 'session_date'],
      ['date', 'day']
    );
    const sClass = suggestField(
      'className',
      'Class / Grade',
      ['class', 'grade', 'class_name', 'standard', 'std', 'class_section'],
      ['class', 'grade', 'std']
    );
    const sSection = suggestField(
      'section',
      'Section',
      ['section', 'sec', 'section_name', 'division'],
      ['sec', 'div']
    );
    const sPresent = suggestField(
      'presentCount',
      'Present Count',
      ['present_count', 'present', 'students_present', 'attended', 'attendance_count'],
      ['present', 'attend', 'count']
    );

    const mappingSuggestions: ColumnMappingSuggestion[] = [sDate, sClass, sSection, sPresent];

    const hasExplicitMapping = Boolean(
      input.columnMapping &&
        (input.columnMapping.attendanceDate ||
          input.columnMapping.className ||
          input.columnMapping.section ||
          input.columnMapping.presentCount)
    );

    // If sheet uses combined "class_section" column and no dedicated section column
    const combinedClassCol =
      sSection.confidence === 'none' &&
      sClass.suggestedColumn &&
      /class.*sec|section/i.test(sClass.suggestedColumn)
        ? sClass.suggestedColumn
        : '';

    const activeMapping: ColumnMappingSelection = {
      attendanceDate: input.columnMapping?.attendanceDate ?? (sDate.suggestedColumn || ''),
      className: input.columnMapping?.className ?? (sClass.suggestedColumn || ''),
      section:
        input.columnMapping?.section ?? (sSection.suggestedColumn || combinedClassCol || ''),
      presentCount: input.columnMapping?.presentCount ?? (sPresent.suggestedColumn || ''),
    };

    const needsMappingConfirmation =
      !hasExplicitMapping &&
      (!activeMapping.attendanceDate ||
        !activeMapping.className ||
        !activeMapping.presentCount ||
        sDate.confidence !== 'high' ||
        sClass.confidence !== 'high' ||
        sPresent.confidence !== 'high' ||
        (sSection.confidence !== 'high' && !combinedClassCol));

    const headerIndexMap = new Map<string, number>();
    rawHeaderRow.forEach((cell, idx) => {
      const h = String(cell ?? '').trim() || `Column_${idx + 1}`;
      if (!headerIndexMap.has(h)) headerIndexMap.set(h, idx);
    });

    const dateIdx = headerIndexMap.get(activeMapping.attendanceDate) ?? -1;
    const classIdx = headerIndexMap.get(activeMapping.className) ?? -1;
    const sectionIdx = headerIndexMap.get(activeMapping.section) ?? -1;
    const presentIdx = headerIndexMap.get(activeMapping.presentCount) ?? -1;

    const sections = this.listSections();
    const seenKeys = new Set<string>();
    const rows: ParsedAttendanceRowPreview[] = [];
    const unknownSet = new Set<string>();
    const dateSet = new Set<string>();
    const presentSectionsByDate = new Map<string, Set<string>>();

    let skippedBlankRows = 0;
    let totalRawRows = 0;
    let validRowsCount = 0;
    let invalidRowsCount = 0;
    let duplicateCount = 0;
    let exceedsStrengthCount = 0;

    for (let rIdx = headerRowIndex + 1; rIdx < matrix.length; rIdx++) {
      const rowArr = matrix[rIdx] || [];
      const isBlank = rowArr.every((cell) => String(cell ?? '').trim() === '');
      if (isBlank) {
        skippedBlankRows++;
        continue;
      }

      totalRawRows++;
      const rowErrors: string[] = [];

      const rawDateCell = dateIdx >= 0 ? rowArr[dateIdx] : '';
      const dateParsed = normalizeDateCell(rawDateCell);
      if (dateParsed.error) rowErrors.push(dateParsed.error);
      if (dateParsed.normalized) dateSet.add(dateParsed.normalized);

      let rawClass = classIdx >= 0 ? String(rowArr[classIdx] ?? '').trim() : '';
      let rawSection = sectionIdx >= 0 ? String(rowArr[sectionIdx] ?? '').trim() : '';

      // Support combined Class-Section when both mapped to same column or user omitted section for Pre-Primary
      if (sectionIdx === classIdx && rawClass.includes('-')) {
        const [cPart, sPart] = rawClass.split('-').map((x) => x.trim());
        rawClass = cPart || rawClass;
        rawSection = sPart || '';
      }

      if (!rawClass) {
        rowErrors.push('Missing Class value');
      }

      const matched = rawClass ? this.resolveSectionMatch(rawClass, rawSection) : null;
      if (!matched && rawClass) {
        const displayUnknown = rawSection && rawSection !== '-' ? `${rawClass}-${rawSection}` : rawClass;
        unknownSet.add(displayUnknown);
        rowErrors.push(
          `Unknown section '${displayUnknown}'. Must match one of the ${sections.length} existing campus sections.`
        );
      }

      const rawPresentCell = presentIdx >= 0 ? rowArr[presentIdx] : '';
      const rawPresentStr = String(rawPresentCell ?? '').trim();
      let presentCount: number | null = null;
      if (rawPresentStr === '') {
        rowErrors.push('Missing present_count (leave out row or enter integer; blank is not treated as 0)');
      } else {
        const num = Number(rawPresentStr);
        if (!Number.isFinite(num) || !Number.isInteger(num)) {
          rowErrors.push(`Invalid present_count '${rawPresentStr}' (must be an integer)`);
        } else if (num < 0) {
          rowErrors.push(`Negative present_count (${num}) rejected`);
        } else {
          presentCount = num;
        }
      }

      if (matched && presentCount !== null && presentCount > matched.enrolledStrength) {
        exceedsStrengthCount++;
        rowErrors.push(
          `Present count (${presentCount}) exceeds enrolled strength (${matched.enrolledStrength}) for ${matched.sectionCode}. Correct attendance or update canonical class strength.`
        );
      }

      if (dateParsed.normalized && matched) {
        const dupKey = `${dateParsed.normalized}:${matched.sectionId}`;
        if (seenKeys.has(dupKey)) {
          duplicateCount++;
          rowErrors.push(`Duplicate record for ${matched.sectionCode} on ${dateParsed.normalized}`);
        } else {
          seenKeys.add(dupKey);
          if (!presentSectionsByDate.has(dateParsed.normalized)) {
            presentSectionsByDate.set(dateParsed.normalized, new Set());
          }
          presentSectionsByDate.get(dateParsed.normalized)!.add(matched.sectionId);
        }
      }

      const isValid = rowErrors.length === 0;
      if (isValid) validRowsCount++;
      else invalidRowsCount++;

      rows.push({
        rowNumber: rIdx + 1,
        rawDate: dateParsed.rawDisplay,
        normalizedDate: dateParsed.normalized,
        rawClass,
        rawSection,
        matchedSectionId: matched?.sectionId ?? null,
        matchedSectionCode: matched?.sectionCode ?? null,
        enrolledStrength: matched?.enrolledStrength ?? null,
        presentCount,
        isValid,
        errors: rowErrors,
      });
    }

    const detectedDates = Array.from(dateSet).sort();
    const missingSectionsByDate = detectedDates.map((d) => {
      const presentSet = presentSectionsByDate.get(d) || new Set<string>();
      const missingSectionCodes = sections
        .filter((s) => !presentSet.has(s.sectionId))
        .map((s) => s.sectionCode);
      return { attendanceDate: d, missingSectionCodes };
    });

    return {
      ok: true,
      fileName: input.fileName || 'attendance_upload',
      sheetNames,
      activeSheet,
      headers,
      totalRawRows,
      skippedBlankRows,
      mappingSuggestions,
      activeMapping,
      needsMappingConfirmation,
      validRowsCount,
      invalidRowsCount,
      duplicateCount,
      exceedsStrengthCount,
      unknownSectionsList: Array.from(unknownSet),
      detectedDates,
      missingSectionsByDate,
      rows,
    };
  }

  public commitValidatedAttendance(input: {
    rows: Array<{
      attendanceDate: string;
      sectionId: string;
      presentCount: number;
    }>;
    actorName: string;
    fileName?: string;
  }): {
    ok: boolean;
    committedCount: number;
    datesAffected: string[];
    batchId: string;
  } {
    this.init();
    if (!Array.isArray(input.rows) || input.rows.length === 0) {
      throw new Error('No validated attendance rows supplied.');
    }

    const sectionsById = new Map(this.listSections().map((s) => [s.sectionId, s]));
    const batchId = `imp-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    const now = Date.now();
    const seen = new Set<string>();
    const validatedToInsert: Array<{
      attendanceDate: string;
      section: SpaceSectionRecord;
      presentCount: number;
    }> = [];

    for (const r of input.rows) {
      const dateStr = String(r.attendanceDate || '').trim();
      const dateCheck = normalizeDateCell(dateStr);
      if (!dateCheck.normalized) {
        throw new Error(`Invalid attendanceDate '${dateStr}'.`);
      }
      const sec = sectionsById.get(r.sectionId);
      if (!sec) {
        throw new Error(`Unknown canonical section '${r.sectionId}'.`);
      }
      const count = Number(r.presentCount);
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`Invalid presentCount '${r.presentCount}' for ${sec.sectionCode}.`);
      }
      if (count > sec.enrolledStrength) {
        throw new Error(
          `Attendance (${count}) exceeds canonical enrolled strength (${sec.enrolledStrength}) for ${sec.sectionCode}.`
        );
      }
      const key = `${dateCheck.normalized}:${sec.sectionId}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate entry for ${sec.sectionCode} on ${dateCheck.normalized}.`);
      }
      seen.add(key);
      validatedToInsert.push({
        attendanceDate: dateCheck.normalized,
        section: sec,
        presentCount: count,
      });
    }

    const upsert = this.db.prepare(`
      INSERT INTO space_attendance (
        id, attendance_date, section_id, present_count,
        enrolled_strength_snapshot, source, import_batch_id, notes, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attendance_date, section_id) DO UPDATE SET
        present_count = excluded.present_count,
        enrolled_strength_snapshot = excluded.enrolled_strength_snapshot,
        source = excluded.source,
        import_batch_id = excluded.import_batch_id,
        notes = excluded.notes,
        recorded_at = excluded.recorded_at
    `);

    const datesSet = new Set<string>();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const item of validatedToInsert) {
        datesSet.add(item.attendanceDate);
        upsert.run(
          `att-${item.attendanceDate}-${item.section.sectionId}`,
          item.attendanceDate,
          item.section.sectionId,
          item.presentCount,
          item.section.enrolledStrength,
          'Administrator Import',
          batchId,
          `Imported by ${input.actorName}${input.fileName ? ` (${input.fileName})` : ''}`,
          now
        );
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    return {
      ok: true,
      committedCount: validatedToInsert.length,
      datesAffected: Array.from(datesSet).sort(),
      batchId,
    };
  }

  public updateSectionConfig(
    sectionId: string,
    patch: { enrolledStrength?: number; policy?: SectionAllocationPolicy; policyNotes?: string }
  ): SpaceSectionRecord {
    this.init();
    const sections = this.listSections();
    const existing = sections.find((s) => s.sectionId === sectionId);
    if (!existing) {
      throw new Error(`Section '${sectionId}' not found.`);
    }

    const nextStrength =
      typeof patch.enrolledStrength === 'number' && Number.isFinite(patch.enrolledStrength)
        ? Math.max(10, Math.min(120, Math.round(patch.enrolledStrength)))
        : existing.enrolledStrength;
    const nextPolicy =
      patch.policy === 'fixed_home_room' ||
      patch.policy === 'approved_flexible_block' ||
      patch.policy === 'restricted'
        ? patch.policy
        : existing.policy;
    const nextNotes =
      typeof patch.policyNotes === 'string' && patch.policyNotes.trim()
        ? patch.policyNotes.trim()
        : existing.policyNotes;
    const now = Date.now();

    this.db
      .prepare(`
        UPDATE space_sections
        SET enrolled_strength = ?, policy = ?, policy_notes = ?, updated_at = ?
        WHERE section_id = ?
      `)
      .run(nextStrength, nextPolicy, nextNotes, now, sectionId);

    return {
      ...existing,
      enrolledStrength: nextStrength,
      policy: nextPolicy,
      policyNotes: nextNotes,
      updatedAt: now,
    };
  }

  public updateRoomMaxOccupancy(roomId: string, maxOccupancy: number): SpaceRoomRecord {
    this.init();
    const rooms = this.listRooms();
    const existing = rooms.find((r) => r.roomId === roomId);
    if (!existing) {
      throw new Error(`Classroom '${roomId}' not found.`);
    }
    if (!Number.isFinite(maxOccupancy) || maxOccupancy < 10 || maxOccupancy > 400) {
      throw new Error('Room maximum occupancy must be between 10 and 400 seats.');
    }
    const clean = Math.round(maxOccupancy);
    const now = Date.now();
    this.db
      .prepare('UPDATE space_rooms SET max_occupancy = ?, updated_at = ? WHERE room_id = ?')
      .run(clean, now, roomId);

    return {
      ...existing,
      maxOccupancy: clean,
      updatedAt: now,
    };
  }

  private getHistoricalRoomWindowWatts(
    roomId: string,
    attendanceDate: string,
    periodCodes: string[],
    slotsForDay: TimetableSlot[]
  ): number | null {
    const hours = Array.from(
      new Set(
        slotsForDay
          .filter((s) => periodCodes.includes(s.periodCode))
          .map((s) => {
            const p = PERIOD_DEFS.find((pd) => pd.code === s.periodCode);
            return p?.hourIst ?? 11;
          })
      )
    );
    if (hours.length === 0) return null;

    const placeholders = hours.map(() => '?').join(', ');
    try {
      const row = this.db
        .prepare(`
          SELECT AVG(total_watts) AS avg_watts, COUNT(*) AS cnt
          FROM energy_intervals
          WHERE room_id = ? AND date_ist = ? AND hour_ist IN (${placeholders})
        `)
        .get(roomId, attendanceDate, ...hours) as { avg_watts: number | null; cnt: number } | undefined;

      if (row && Number(row.cnt) > 0 && row.avg_watts !== null && Number.isFinite(row.avg_watts)) {
        return Math.round(Number(row.avg_watts));
      }
    } catch {
      // energy_intervals may not yet exist on brand-new isolated test runs
    }
    return null;
  }

  private estimateRoomPowerForOccupiedBlock(
    room: SpaceRoomRecord,
    effectiveSeats: number,
    attendanceDate: string,
    periodCodes: string[],
    slotsForDay: TimetableSlot[],
    isExistingRoom: boolean
  ): { watts: number; sourceNote: string } {
    const baseRoom = baseRoomById.get(room.roomId);
    const spec = specByRoomId.get(room.roomId);

    if (isExistingRoom) {
      const histWatts = this.getHistoricalRoomWindowWatts(
        room.roomId,
        attendanceDate,
        periodCodes,
        slotsForDay
      );
      if (histWatts !== null && histWatts > 40) {
        return {
          watts: histWatts,
          sourceNote: `Actual historical interval profile on ${attendanceDate} (${histWatts}W avg)`,
        };
      }
    }

    // Physics-derived ROOMWISE model using learned daylight alpha & heat index curve
    const lightPct = baseRoom ? computeAdaptiveTargetLightPercent(baseRoom) : 50;
    const baseFanPct = baseRoom ? computeAdaptiveTargetFanPercent(baseRoom) : 60;
    // Slight comfort scaling if attendance is lower in a well-ventilated room
    const loadRatio = Math.min(1, effectiveSeats / Math.max(1, room.maxOccupancy));
    const tunedFanPct = loadRatio < 0.72 ? Math.max(20, baseFanPct - 20) : baseFanPct;
    const watts = computeSpecWattsAtPct(
      room.roomId,
      lightPct,
      tunedFanPct,
      spec?.aux ? spec.aux.initialPct : null
    );

    return {
      watts,
      sourceNote: `ROOMWISE appliance model (α=${room.daylightAlpha}, ${lightPct}% lighting, ${tunedFanPct}% BLDC fans${spec?.aux ? ` + ${spec.aux.name}` : ''})`,
    };
  }

  private computeTransitionPenaltyKWh(fromRoom: SpaceRoomRecord, toRoom: SpaceRoomRecord): number {
    if (fromRoom.roomId === toRoom.roomId) return 0;
    if (fromRoom.building === toRoom.building && fromRoom.floor === toRoom.floor) {
      return 0.03; // minimal same-corridor transition
    }
    if (fromRoom.building === toRoom.building) {
      return 0.055; // intra-building staircase transition
    }
    return 0.085; // adjacent courtyard wing transition
  }

  public runAllocationAnalysis(input?: {
    attendanceDate?: string;
    mode?: AnalysisHorizonMode;
    tariffPerKWhINR?: number;
    gridCarbonFactorKgCO2PerKWh?: number;
  }): AllocationRunResult {
    this.init();

    const todayIst = getIstDateString();
    const { hour: currentHourIst } = getIstHourAndMinute();
    const rooms = this.listRooms();
    const roomById = new Map(rooms.map((r) => [r.roomId, r]));
    const sections = this.listSections();

    const dateRows = this.db
      .prepare('SELECT DISTINCT attendance_date FROM space_attendance ORDER BY attendance_date DESC')
      .all() as Array<{ attendance_date: string }>;
    const attendanceDate =
      input?.attendanceDate && dateRows.some((d) => d.attendance_date === input.attendanceDate)
        ? input.attendanceDate
        : dateRows[0]?.attendance_date || this.getLatestSeededInstructionalDate(todayIst);

    // Choose non-Sunday instructional timetable day matching selected date
    const rawDow = getIstDayOfWeek(attendanceDate);
    const targetDayOfWeek = rawDow === 0 ? 1 : rawDow;
    const analysisMode: AnalysisHorizonMode =
      input?.mode ||
      (attendanceDate >= todayIst && currentHourIst < 14 ? 'projected' : 'actual');
    const horizonLabel =
      analysisMode === 'projected'
        ? 'Projected Upcoming / Same-Day Instructional Block (+2 seat safety buffer)'
        : `Completed Instructional Day Evaluation (${attendanceDate}, Actual Register & Energy History)`;

    const slotsForDay = this.listTimetableSlots(targetDayOfWeek);
    const attRows = this.db
      .prepare('SELECT * FROM space_attendance WHERE attendance_date = ?')
      .all(attendanceDate) as Array<Record<string, unknown>>;
    const attBySectionId = new Map(attRows.map((a) => [String(a.section_id), a]));

    // Track already-approved room allocations so solver never double-books approved slots
    const approvedRows = this.db
      .prepare(
        `SELECT proposed_room_id, period_codes_json FROM space_allocation_history WHERE attendance_date = ? AND decision = 'approved'`
      )
      .all(attendanceDate) as Array<{ proposed_room_id: string; period_codes_json: string }>;

    const claimedRoomPeriods = new Set<string>();
    for (const app of approvedRows) {
      const pCodes = JSON.parse(String(app.period_codes_json || '[]')) as string[];
      for (const pc of pCodes) {
        claimedRoomPeriods.add(`${app.proposed_room_id}:${pc}`);
      }
    }

    // Build room occupancy map from timetable for fast conflict checks
    const occupiedInTimetable = new Map<string, TimetableSlot>();
    for (const slot of slotsForDay) {
      occupiedInTimetable.set(`${slot.roomId}:${slot.periodCode}`, slot);
    }

    const tariff = input?.tariffPerKWhINR ?? INITIAL_SCHOOL_SETTINGS.tariffPerKWhINR;
    const carbon = input?.gridCarbonFactorKgCO2PerKWh ?? INITIAL_SCHOOL_SETTINGS.gridCarbonFactorKgCO2PerKWh;
    const runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    const safetyMarginApplied = analysisMode === 'projected' ? 2 : 0;

    interface CandidateProposalDraft {
      proposal: AllocationProposal;
    }
    const candidateDrafts: CandidateProposalDraft[] = [];
    const unchangedSections: UnchangedSectionEvaluation[] = [];
    let unknownAttendanceCount = 0;

    // Step 1: Evaluate each canonical section independently to gather best feasible candidates & rejection traces
    for (const section of sections) {
      const attRec = attBySectionId.get(section.sectionId);
      const homeRoom = roomById.get(section.homeRoomId) || rooms[0];

      if (!attRec) {
        unknownAttendanceCount++;
        unchangedSections.push({
          sectionId: section.sectionId,
          sectionCode: section.sectionCode,
          sectionDisplayName: section.displayName,
          homeRoomId: homeRoom.roomId,
          homeRoomCode: homeRoom.roomCode,
          homeRoomName: homeRoom.roomName,
          enrolledStrength: section.enrolledStrength,
          presentCount: null,
          attendanceDate,
          attendanceSource: null,
          outcome: 'No reallocation recommended',
          primaryReason: `Attendance unknown for ${section.sectionCode} on ${attendanceDate} (missing rows are never treated as zero).`,
          rejectedAlternatives: [],
        });
        continue;
      }

      const presentCount = Number(attRec.present_count);
      const attendanceSource = String(attRec.source) as AttendanceSourceType;
      const effectiveRequiredSeats = Math.min(
        section.enrolledStrength,
        presentCount + safetyMarginApplied
      );

      // Policy gate: fixed home room or restricted sections never relocate
      if (section.policy !== 'approved_flexible_block') {
        unchangedSections.push({
          sectionId: section.sectionId,
          sectionCode: section.sectionCode,
          sectionDisplayName: section.displayName,
          homeRoomId: homeRoom.roomId,
          homeRoomCode: homeRoom.roomCode,
          homeRoomName: homeRoom.roomName,
          enrolledStrength: section.enrolledStrength,
          presentCount,
          attendanceDate,
          attendanceSource,
          outcome: 'No reallocation recommended',
          primaryReason:
            section.policy === 'fixed_home_room'
              ? `Fixed Home Room policy preserves continuous room identity (${section.policyNotes}).`
              : `Restricted allocation policy prevents relocation (${section.policyNotes}).`,
          rejectedAlternatives: [],
        });
        continue;
      }

      // Group section's movable, non-lab-dependent contiguous block windows for that day
      const sectionSlots = slotsForDay.filter((s) => s.sectionId === section.sectionId);
      const blocksMap = new Map<string, TimetableSlot[]>();
      for (const s of sectionSlots) {
        if (!s.isMovableBlock || s.requiresLabFacility) continue;
        const arr = blocksMap.get(s.blockWindowLabel) || [];
        arr.push(s);
        blocksMap.set(s.blockWindowLabel, arr);
      }

      // Focus on coherent multi-period instructional windows (>= 2 periods) or single periods if high-draw
      const windows = Array.from(blocksMap.entries())
        .map(([label, wSlots]) => ({
          label,
          slots: wSlots.sort((a, b) => a.periodCode.localeCompare(b.periodCode)),
          totalHours: round2(wSlots.reduce((acc, x) => acc + x.durationHours, 0)),
        }))
        .filter((w) => w.slots.length >= 2)
        .sort((a, b) => b.totalHours - a.totalHours);

      let bestDraftForSection: AllocationProposal | null = null;
      const allRejectedForSection: CandidateRejectionReason[] = [];

      for (const win of windows) {
        const existingRoom = roomById.get(win.slots[0].roomId) || homeRoom;
        const periodCodes = win.slots.map((s) => s.periodCode);
        const startStr = win.slots[0].startTime;
        const endStr = win.slots[win.slots.length - 1].endTime;
        const windowFullLabel = `${win.label} (${startStr}–${endStr} IST)`;

        const existingEst = this.estimateRoomPowerForOccupiedBlock(
          existingRoom,
          presentCount,
          attendanceDate,
          periodCodes,
          slotsForDay,
          true
        );
        const existingEnergyKWh = round3((existingEst.watts / 1000) * win.totalHours);

        const rejectedForWindow: CandidateRejectionReason[] = [];

        for (const candidate of rooms) {
          if (candidate.roomId === existingRoom.roomId) continue;

          // Constraint 1: Room restriction / suitability / lab protection
          if (candidate.isRestricted || candidate.isSpecialisedLab || !candidate.isGeneralPoolEligible) {
            let detail = 'Restricted administrative or age-specific room.';
            if (candidate.suitabilityTags.includes('staff_room')) {
              detail = 'Restricted Staff Room — cannot host student instructional blocks.';
            } else if (candidate.suitabilityTags.includes('pre_primary')) {
              detail = 'Restricted Pre-Primary Wing — furniture & floor reserved for Nursery–UKG.';
            } else if (candidate.suitabilityTags.includes('auditorium')) {
              detail = 'Multipurpose Hall reserved for assemblies & examinations (high base draw).';
            } else if (candidate.isSpecialisedLab) {
              detail = 'Specialised laboratory reserved for practical instrumentation sessions.';
            } else if (candidate.suitabilityTags.includes('library')) {
              detail = 'Library & Reading Hall is not a general relocation destination.';
            }
            rejectedForWindow.push({
              roomId: candidate.roomId,
              roomCode: candidate.roomCode,
              roomName: candidate.roomName,
              building: candidate.building,
              maxOccupancy: candidate.maxOccupancy,
              reasonCategory: 'room_restriction',
              reasonDetail: detail,
            });
            continue;
          }

          // Constraint 2: Hard seating capacity check (effective attendance <= room maxOccupancy)
          if (effectiveRequiredSeats > candidate.maxOccupancy) {
            rejectedForWindow.push({
              roomId: candidate.roomId,
              roomCode: candidate.roomCode,
              roomName: candidate.roomName,
              building: candidate.building,
              maxOccupancy: candidate.maxOccupancy,
              reasonCategory: 'capacity_shortfall',
              reasonDetail: `Effective required seats (${effectiveRequiredSeats}${safetyMarginApplied > 0 ? ` = ${presentCount}+${safetyMarginApplied} buffer` : ''}) exceed room Max Occupancy (${candidate.maxOccupancy}).`,
            });
            continue;
          }

          // Constraint 3: Timetable availability across ENTIRE proposed window
          const conflictingSlots = periodCodes
            .map((pc) => occupiedInTimetable.get(`${candidate.roomId}:${pc}`))
            .filter((x): x is TimetableSlot => Boolean(x));

          if (conflictingSlots.length > 0) {
            const first = conflictingSlots[0];
            rejectedForWindow.push({
              roomId: candidate.roomId,
              roomCode: candidate.roomCode,
              roomName: candidate.roomName,
              building: candidate.building,
              maxOccupancy: candidate.maxOccupancy,
              reasonCategory: 'timetable_conflict',
              reasonDetail: `Occupied at ${conflictingSlots.map((c) => c.periodCode).join(', ')} by ${first.sectionId.toUpperCase()} (${first.subject}).`,
            });
            continue;
          }

          // Constraint 4: Check pre-approved allocation conflict
          const preClaimed = periodCodes.some((pc) => claimedRoomPeriods.has(`${candidate.roomId}:${pc}`));
          if (preClaimed) {
            rejectedForWindow.push({
              roomId: candidate.roomId,
              roomCode: candidate.roomCode,
              roomName: candidate.roomName,
              building: candidate.building,
              maxOccupancy: candidate.maxOccupancy,
              reasonCategory: 'already_allocated',
              reasonDetail: `Already committed to an approved reallocation for ${windowFullLabel}.`,
            });
            continue;
          }

          // Constraint 5: ROOMWISE physics Energy Calculation (kW × time hours)
          const proposedEst = this.estimateRoomPowerForOccupiedBlock(
            candidate,
            effectiveRequiredSeats,
            attendanceDate,
            periodCodes,
            slotsForDay,
            false
          );
          const proposedEnergyKWh = round3((proposedEst.watts / 1000) * win.totalHours);
          const netEnergySavingsKWh = round3(existingEnergyKWh - proposedEnergyKWh);
          const transitionPenaltyKWh = this.computeTransitionPenaltyKWh(existingRoom, candidate);
          const netScoreKWh = round3(netEnergySavingsKWh - transitionPenaltyKWh);

          if (netEnergySavingsKWh < MIN_ACTIONABLE_SAVINGS_KWH || netScoreKWh < MIN_NET_SCORE_KWH) {
            rejectedForWindow.push({
              roomId: candidate.roomId,
              roomCode: candidate.roomCode,
              roomName: candidate.roomName,
              building: candidate.building,
              maxOccupancy: candidate.maxOccupancy,
              reasonCategory: 'insufficient_energy_savings',
              reasonDetail: `Net ΔE (${netEnergySavingsKWh >= 0 ? '+' : ''}${netEnergySavingsKWh} kWh) is below ${MIN_ACTIONABLE_SAVINGS_KWH} kWh threshold after ${transitionPenaltyKWh} kWh operational transition weighting.`,
            });
            continue;
          }

          const costSavingsINR = round2(netEnergySavingsKWh * tariff);
          const co2AvoidedKg = round3(netEnergySavingsKWh * carbon);
          const utilizationExistingPercent = round1(
            (presentCount / Math.max(1, existingRoom.maxOccupancy)) * 100
          );
          const utilizationProposedPercent = round1(
            (presentCount / Math.max(1, candidate.maxOccupancy)) * 100
          );

          const trace: string[] = [
            `Attendance verification: ${section.displayName} recorded ${presentCount}/${section.enrolledStrength} students (${attendanceSource}, ${attendanceDate})${safetyMarginApplied > 0 ? ` with +${safetyMarginApplied} projection buffer (${effectiveRequiredSeats} required seats)` : ''}.`,
            `Capacity safety check: ${candidate.roomCode} (${candidate.roomName}) Max Occupancy = ${candidate.maxOccupancy} seats >= ${effectiveRequiredSeats} required seats (${utilizationProposedPercent}% utilisation vs ${utilizationExistingPercent}% in ${existingRoom.roomCode}).`,
            `Timetable verification: ${candidate.roomCode} is verified vacant across all ${periodCodes.length} periods in ${windowFullLabel} with zero class or teacher overlap.`,
            `Room suitability & policy: ${section.policyNotes} Target room ${candidate.roomCode} meets general classroom requirements for "${win.slots[0].subject}".`,
            `Energy savings physics (kW × h): Existing ${existingRoom.roomCode} = ${existingEst.watts}W × ${win.totalHours}h = ${existingEnergyKWh} kWh (${existingEst.sourceNote}). Proposed ${candidate.roomCode} = ${proposedEst.watts}W × ${win.totalHours}h = ${proposedEnergyKWh} kWh (${proposedEst.sourceNote}).`,
            `Net impact: ΔE = +${netEnergySavingsKWh} kWh saved (₹${costSavingsINR} WBSEDCL tariff · ${co2AvoidedKg} kg CO₂ avoided) across ${win.totalHours}h after accounting for ${transitionPenaltyKWh} kWh movement friction.`,
          ];

          if (!bestDraftForSection || netScoreKWh > bestDraftForSection.netScoreKWh) {
            bestDraftForSection = {
              proposalId: `prop-${runId}-${section.sectionId}`,
              runId,
              attendanceDate,
              analysisMode,
              sectionId: section.sectionId,
              sectionCode: section.sectionCode,
              sectionDisplayName: section.displayName,
              enrolledStrength: section.enrolledStrength,
              presentCount,
              safetyMarginApplied,
              effectiveRequiredSeats,
              attendanceSource,
              existingRoomId: existingRoom.roomId,
              existingRoomCode: existingRoom.roomCode,
              existingRoomName: existingRoom.roomName,
              existingRoomBuilding: existingRoom.building,
              existingRoomFloor: existingRoom.floor,
              existingRoomMaxOccupancy: existingRoom.maxOccupancy,
              proposedRoomId: candidate.roomId,
              proposedRoomCode: candidate.roomCode,
              proposedRoomName: candidate.roomName,
              proposedRoomBuilding: candidate.building,
              proposedRoomFloor: candidate.floor,
              proposedRoomMaxOccupancy: candidate.maxOccupancy,
              windowLabel: windowFullLabel,
              periodCodes,
              subjectSummary: win.slots[0].subject,
              durationHours: win.totalHours,
              existingEnergyKWh,
              proposedEnergyKWh,
              netEnergySavingsKWh,
              transitionPenaltyKWh,
              netScoreKWh,
              costSavingsINR,
              co2AvoidedKg,
              utilizationExistingPercent,
              utilizationProposedPercent,
              status: 'pending',
              explanationTrace: trace,
              rejectedAlternatives: [],
            };
          }
        }

        // Preserve concise sample of rejected alternatives (prioritizing capacity shortfalls, timetable conflicts, insufficient savings, restrictions)
        if (allRejectedForSection.length === 0 && rejectedForWindow.length > 0) {
          const priorityOrder: Record<CandidateRejectionReason['reasonCategory'], number> = {
            capacity_shortfall: 1,
            already_allocated: 2,
            insufficient_energy_savings: 3,
            timetable_conflict: 4,
            room_restriction: 5,
            policy_restriction: 6,
          };
          const sortedRej = [...rejectedForWindow].sort(
            (a, b) => priorityOrder[a.reasonCategory] - priorityOrder[b.reasonCategory]
          );
          allRejectedForSection.push(...sortedRej.slice(0, 6));
        }
      }

      if (bestDraftForSection) {
        bestDraftForSection.rejectedAlternatives = allRejectedForSection;
        candidateDrafts.push({ proposal: bestDraftForSection });
      } else {
        unchangedSections.push({
          sectionId: section.sectionId,
          sectionCode: section.sectionCode,
          sectionDisplayName: section.displayName,
          homeRoomId: homeRoom.roomId,
          homeRoomCode: homeRoom.roomCode,
          homeRoomName: homeRoom.roomName,
          enrolledStrength: section.enrolledStrength,
          presentCount,
          attendanceDate,
          attendanceSource,
          outcome: 'No reallocation recommended',
          primaryReason:
            allRejectedForSection.length > 0
              ? `Keeping ${section.sectionCode} in current schedule: no conflict-free alternate classroom meets both ${effectiveRequiredSeats}-seat capacity and minimum ${MIN_ACTIONABLE_SAVINGS_KWH} kWh savings threshold.`
              : `Keeping ${section.sectionCode} in ${homeRoom.roomCode}: all periods require fixed practical facilities or already operate at optimal baseline.`,
          rejectedAlternatives: allRejectedForSection,
        });
      }
    }

    // Step 2: Global conflict-free ranking (prevents two sections being booked into the same room+period!)
    candidateDrafts.sort((a, b) => {
      if (b.proposal.netScoreKWh !== a.proposal.netScoreKWh) {
        return b.proposal.netScoreKWh - a.proposal.netScoreKWh;
      }
      return a.proposal.sectionId.localeCompare(b.proposal.sectionId);
    });

    const finalProposals: AllocationProposal[] = [];
    for (const draft of candidateDrafts) {
      const p = draft.proposal;
      const collision = p.periodCodes.some((pc) => claimedRoomPeriods.has(`${p.proposedRoomId}:${pc}`));
      if (collision) {
        unchangedSections.push({
          sectionId: p.sectionId,
          sectionCode: p.sectionCode,
          sectionDisplayName: p.sectionDisplayName,
          homeRoomId: p.existingRoomId,
          homeRoomCode: p.existingRoomCode,
          homeRoomName: p.existingRoomName,
          enrolledStrength: p.enrolledStrength,
          presentCount: p.presentCount,
          attendanceDate,
          attendanceSource: p.attendanceSource,
          outcome: 'No reallocation recommended',
          primaryReason: `Candidate destination ${p.proposedRoomCode} for ${p.windowLabel} was assigned to a higher-priority energy savings move in global conflict resolution.`,
          rejectedAlternatives: [
            {
              roomId: p.proposedRoomId,
              roomCode: p.proposedRoomCode,
              roomName: p.proposedRoomName,
              building: p.proposedRoomBuilding,
              maxOccupancy: p.proposedRoomMaxOccupancy,
              reasonCategory: 'already_allocated',
              reasonDetail: `Destination ${p.proposedRoomCode} claimed in this solver pass by a higher net-ΔE allocation.`,
            },
            ...p.rejectedAlternatives.slice(0, 4),
          ],
        });
        continue;
      }

      for (const pc of p.periodCodes) {
        claimedRoomPeriods.add(`${p.proposedRoomId}:${pc}`);
      }
      finalProposals.push(p);
    }

    const totalProjectedSavingsKWh = round2(
      finalProposals.reduce((acc, p) => acc + p.netEnergySavingsKWh, 0)
    );
    const totalProjectedSavingsINR = round2(
      finalProposals.reduce((acc, p) => acc + p.costSavingsINR, 0)
    );
    const totalProjectedCo2AvoidedKg = round2(
      finalProposals.reduce((acc, p) => acc + p.co2AvoidedKg, 0)
    );

    const summary: AllocationRunResult['summary'] = {
      evaluatedSectionsCount: sections.length,
      recommendedMovesCount: finalProposals.length,
      unchangedSectionsCount: unchangedSections.length,
      unknownAttendanceCount,
      totalProjectedSavingsKWh,
      totalProjectedSavingsINR,
      totalProjectedCo2AvoidedKg,
    };

    const createdAt = Date.now();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare(`
          INSERT INTO space_allocation_runs (
            run_id, attendance_date, target_day_of_week, analysis_mode,
            horizon_label, summary_json, unchanged_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          runId,
          attendanceDate,
          targetDayOfWeek,
          analysisMode,
          horizonLabel,
          JSON.stringify(summary),
          JSON.stringify(unchangedSections),
          createdAt
        );

      const insertProp = this.db.prepare(`
        INSERT INTO space_allocation_proposals (
          proposal_id, run_id, attendance_date, analysis_mode, section_id,
          existing_room_id, proposed_room_id, window_label, period_codes_json,
          net_energy_savings_kwh, net_score_kwh, status, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const prop of finalProposals) {
        insertProp.run(
          prop.proposalId,
          runId,
          prop.attendanceDate,
          prop.analysisMode,
          prop.sectionId,
          prop.existingRoomId,
          prop.proposedRoomId,
          prop.windowLabel,
          JSON.stringify(prop.periodCodes),
          prop.netEnergySavingsKWh,
          prop.netScoreKWh,
          'pending',
          JSON.stringify(prop),
          createdAt
        );
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    return {
      ok: true,
      runId,
      attendanceDate,
      targetDayOfWeek,
      analysisMode,
      horizonLabel,
      createdAt,
      summary,
      proposals: finalProposals,
      unchangedSections,
    };
  }

  public reviewProposal(input: {
    proposalId: string;
    decision: 'approved' | 'rejected';
    actorName: string;
    note?: string;
  }): { ok: true; proposal: AllocationProposal; historyEntry: AllocationHistoryEntry } {
    this.init();

    const row = this.db
      .prepare('SELECT * FROM space_allocation_proposals WHERE proposal_id = ?')
      .get(input.proposalId) as Record<string, unknown> | undefined;

    if (!row) {
      const err = new Error(`Allocation proposal '${input.proposalId}' not found.`);
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    const prop = JSON.parse(String(row.payload_json)) as AllocationProposal;
    const now = Date.now();
    const noteClean = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;

    if (String(row.status) === input.decision) {
      const existingHist = this.db
        .prepare('SELECT * FROM space_allocation_history WHERE proposal_id = ? ORDER BY decided_at DESC LIMIT 1')
        .get(input.proposalId) as Record<string, unknown> | undefined;
      if (existingHist) {
        return {
          ok: true,
          proposal: {
            ...prop,
            status: input.decision,
            reviewedBy: row.reviewed_by ? String(row.reviewed_by) : input.actorName,
            reviewedAt: row.reviewed_at ? Number(row.reviewed_at) : now,
            reviewNote: noteClean,
          },
          historyEntry: {
            historyId: String(existingHist.history_id),
            proposalId: String(existingHist.proposal_id),
            runId: String(existingHist.run_id),
            attendanceDate: String(existingHist.attendance_date),
            sectionId: String(existingHist.section_id),
            sectionCode: String(existingHist.section_code),
            sectionDisplayName: String(existingHist.section_display_name),
            existingRoomId: String(existingHist.existing_room_id),
            existingRoomCode: String(existingHist.existing_room_code),
            proposedRoomId: String(existingHist.proposed_room_id),
            proposedRoomCode: String(existingHist.proposed_room_code),
            windowLabel: String(existingHist.window_label),
            periodCodes: JSON.parse(String(existingHist.period_codes_json || '[]')) as string[],
            decision: String(existingHist.decision) as 'approved' | 'rejected',
            actorName: String(existingHist.actor_name),
            note: existingHist.note ? String(existingHist.note) : null,
            netEnergySavingsKWh: Number(existingHist.net_energy_savings_kwh),
            costSavingsINR: Number(existingHist.cost_savings_inr),
            co2AvoidedKg: Number(existingHist.co2_avoided_kg),
            decidedAt: Number(existingHist.decided_at),
          },
        };
      }
    }

    // Live re-validation on approval: guarantee capacity & zero double-booking against committed history
    if (input.decision === 'approved') {
      const room = this.listRooms().find((r) => r.roomId === prop.proposedRoomId);
      if (!room) {
        const err = new Error(`Target room '${prop.proposedRoomCode}' no longer exists.`);
        (err as Error & { statusCode?: number }).statusCode = 409;
        throw err;
      }
      if (prop.effectiveRequiredSeats > room.maxOccupancy) {
        const err = new Error(
          `Capacity re-check failed: ${prop.effectiveRequiredSeats} required seats now exceed ${room.roomCode} Max Occupancy (${room.maxOccupancy}).`
        );
        (err as Error & { statusCode?: number }).statusCode = 409;
        throw err;
      }

      const overlapping = this.db
        .prepare(`
          SELECT section_code, window_label, period_codes_json
          FROM space_allocation_history
          WHERE attendance_date = ? AND proposed_room_id = ? AND decision = 'approved' AND proposal_id != ?
        `)
        .all(prop.attendanceDate, prop.proposedRoomId, prop.proposalId) as Array<{
          section_code: string;
          window_label: string;
          period_codes_json: string;
        }>;

      for (const other of overlapping) {
        const otherPeriods = JSON.parse(String(other.period_codes_json || '[]')) as string[];
        if (prop.periodCodes.some((pc) => otherPeriods.includes(pc))) {
          const err = new Error(
            `Double-booking prevented: ${prop.proposedRoomCode} is already approved for ${other.section_code} during ${other.window_label}.`
          );
          (err as Error & { statusCode?: number }).statusCode = 409;
          throw err;
        }
      }
    }

    const historyId = `hist-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    const updatedProp: AllocationProposal = {
      ...prop,
      status: input.decision,
      reviewedBy: input.actorName,
      reviewedAt: now,
      reviewNote: noteClean,
    };

    const historyEntry: AllocationHistoryEntry = {
      historyId,
      proposalId: prop.proposalId,
      runId: prop.runId,
      attendanceDate: prop.attendanceDate,
      sectionId: prop.sectionId,
      sectionCode: prop.sectionCode,
      sectionDisplayName: prop.sectionDisplayName,
      existingRoomId: prop.existingRoomId,
      existingRoomCode: prop.existingRoomCode,
      proposedRoomId: prop.proposedRoomId,
      proposedRoomCode: prop.proposedRoomCode,
      windowLabel: prop.windowLabel,
      periodCodes: prop.periodCodes,
      decision: input.decision,
      actorName: input.actorName,
      note: noteClean,
      netEnergySavingsKWh: prop.netEnergySavingsKWh,
      costSavingsINR: prop.costSavingsINR,
      co2AvoidedKg: prop.co2AvoidedKg,
      decidedAt: now,
    };

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare(`
          UPDATE space_allocation_proposals
          SET status = ?, payload_json = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?
          WHERE proposal_id = ?
        `)
        .run(
          input.decision,
          JSON.stringify(updatedProp),
          input.actorName,
          now,
          noteClean,
          prop.proposalId
        );

      this.db
        .prepare(`
          INSERT INTO space_allocation_history (
            history_id, proposal_id, run_id, attendance_date, section_id,
            section_code, section_display_name, existing_room_id, existing_room_code,
            proposed_room_id, proposed_room_code, window_label, period_codes_json,
            decision, actor_name, note, net_energy_savings_kwh, cost_savings_inr,
            co2_avoided_kg, decided_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          historyId,
          prop.proposalId,
          prop.runId,
          prop.attendanceDate,
          prop.sectionId,
          prop.sectionCode,
          prop.sectionDisplayName,
          prop.existingRoomId,
          prop.existingRoomCode,
          prop.proposedRoomId,
          prop.proposedRoomCode,
          prop.windowLabel,
          JSON.stringify(prop.periodCodes),
          input.decision,
          input.actorName,
          noteClean,
          prop.netEnergySavingsKWh,
          prop.costSavingsINR,
          prop.co2AvoidedKg,
          now
        );

      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    return { ok: true, proposal: updatedProp, historyEntry };
  }
}

export const spaceIntelligenceService = new SpaceIntelligenceService();
