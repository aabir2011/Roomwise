/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DemandProfileSlot {
  key: string;
  hour: string;
  actual: number;
  baseline: number;
  isCurrent: boolean;
  isAfterHoursLive?: boolean;
}

export interface SchoolDayDemandProfile {
  slots: DemandProfileSlot[];
  activeLabel: string;
  currentTimeIst: string;
  isWithinSchoolHours: boolean;
}

interface BaseSchoolSlot {
  hour: string;
  startMinutes: number;
  actual: number;
  baseline: number;
}

const SCHOOL_DAY_BASE_SLOTS: ReadonlyArray<BaseSchoolSlot> = [
  { hour: '07:30', startMinutes: 7 * 60 + 30, actual: 1.6, baseline: 3.4 },
  { hour: '08:30', startMinutes: 8 * 60 + 30, actual: 3.8, baseline: 11.2 },
  { hour: '09:30', startMinutes: 9 * 60 + 30, actual: 4.6, baseline: 14.8 },
  { hour: '10:30', startMinutes: 10 * 60 + 30, actual: 4.7, baseline: 15.2 },
  { hour: '11:30', startMinutes: 11 * 60 + 30, actual: 4.8, baseline: 15.6 },
  { hour: '12:30', startMinutes: 12 * 60 + 30, actual: 2.6, baseline: 12.8 },
  { hour: '13:30', startMinutes: 13 * 60 + 30, actual: 4.4, baseline: 14.2 },
  { hour: '14:30', startMinutes: 14 * 60 + 30, actual: 0.8, baseline: 4.5 },
];

const SCHOOL_WINDOW_START_MINUTES = 7 * 60 + 30; // 07:30 IST
const SCHOOL_WINDOW_END_MINUTES = 15 * 60 + 30; // 15:30 IST (end of 14:30 hourly bucket)

export function getIstClockParts(date: Date = new Date()): {
  hours: number;
  minutes: number;
  totalMinutes: number;
  formattedHHMM: string;
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minStr = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const hours = Number(hourStr) % 24;
  const minutes = Number(minStr) % 60;
  const formattedHHMM = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return {
    hours,
    minutes,
    totalMinutes: hours * 60 + minutes,
    formattedHHMM,
  };
}

export function buildSchoolDayDemandProfile(params: {
  liveActualKW: number;
  liveBaseKW: number;
  now?: Date;
}): SchoolDayDemandProfile {
  const { liveActualKW, liveBaseKW, now = new Date() } = params;
  const ist = getIstClockParts(now);

  const isWithinSchoolHours =
    ist.totalMinutes >= SCHOOL_WINDOW_START_MINUTES &&
    ist.totalMinutes < SCHOOL_WINDOW_END_MINUTES;

  if (isWithinSchoolHours) {
    const activeIndex = Math.min(
      SCHOOL_DAY_BASE_SLOTS.length - 1,
      Math.max(0, Math.floor((ist.totalMinutes - SCHOOL_WINDOW_START_MINUTES) / 60))
    );

    const slots: DemandProfileSlot[] = SCHOOL_DAY_BASE_SLOTS.map((slot, idx) => {
      const isCurrent = idx === activeIndex;
      return {
        key: slot.hour,
        hour: slot.hour,
        actual: isCurrent ? liveActualKW : slot.actual,
        baseline: isCurrent ? liveBaseKW : slot.baseline,
        isCurrent,
      };
    });

    return {
      slots,
      activeLabel: `${SCHOOL_DAY_BASE_SLOTS[activeIndex].hour} IST`,
      currentTimeIst: `${ist.formattedHHMM} IST`,
      isWithinSchoolHours: true,
    };
  }

  // Outside 07:30–15:29 IST: keep the 8 school-day profile bars clean and append a dedicated Live Now bar
  const slots: DemandProfileSlot[] = [
    ...SCHOOL_DAY_BASE_SLOTS.map((slot) => ({
      key: slot.hour,
      hour: slot.hour,
      actual: slot.actual,
      baseline: slot.baseline,
      isCurrent: false,
    })),
    {
      key: 'live-now',
      hour: ist.formattedHHMM,
      actual: liveActualKW,
      baseline: liveBaseKW,
      isCurrent: true,
      isAfterHoursLive: true,
    },
  ];

  return {
    slots,
    activeLabel: `${ist.formattedHHMM} IST`,
    currentTimeIst: `${ist.formattedHHMM} IST`,
    isWithinSchoolHours: false,
  };
}
