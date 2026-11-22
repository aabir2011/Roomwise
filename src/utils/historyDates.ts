/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryDatePreset } from '../types/history.ts';

const IST_TIMEZONE = 'Asia/Kolkata';

const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const istTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const istHumanDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const istShortDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIMEZONE,
  day: 'numeric',
  month: 'short',
});

const istWeekdayShortFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIMEZONE,
  weekday: 'short',
});

export function getIstDateString(date: Date = new Date()): string {
  return istDateFormatter.format(date);
}

export function getIstHourAndMinute(date: Date = new Date()): { hour: number; minute: number } {
  const parts = istTimeFormatter.format(date).split(':');
  return {
    hour: Number(parts[0]) || 0,
    minute: Number(parts[1]) || 0,
  };
}

/**
 * Parses YYYY-MM-DD as midnight Asia/Kolkata (+05:30).
 */
export function parseIstDateToUtcMs(dateIst: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIst.trim());
  if (!match) return Date.now();
  return Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000+05:30`);
}

export function shiftIstDate(dateIst: string, deltaDays: number): string {
  const baseMs = parseIstDateToUtcMs(dateIst);
  // Step cleanly across fixed IST days (India has no DST)
  return getIstDateString(new Date(baseMs + deltaDays * 86_400_000 + 43_200_000));
}

export function enumerateIstDates(startDate: string, endDate: string): string[] {
  if (startDate > endDate) return [];
  const dates: string[] = [];
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 400) {
    dates.push(cursor);
    cursor = shiftIstDate(cursor, 1);
    guard++;
  }
  return dates;
}

export function getIstDayOfWeek(dateIst: string): number {
  // 0 = Sunday, 6 = Saturday
  const ms = parseIstDateToUtcMs(dateIst) + 43_200_000;
  return new Date(ms).getUTCDay();
}

export function formatIstShortLabel(dateIst: string): string {
  const d = new Date(parseIstDateToUtcMs(dateIst) + 43_200_000);
  return istShortDateFormatter.format(d);
}

export function formatIstFullLabel(dateIst: string): string {
  const d = new Date(parseIstDateToUtcMs(dateIst) + 43_200_000);
  return `${istWeekdayShortFormatter.format(d)}, ${istHumanDateFormatter.format(d)}`;
}

export function formatIstTimestampLabel(tsMs: number): string {
  const d = new Date(tsMs);
  return `${istShortDateFormatter.format(d)} · ${istTimeFormatter.format(d)} IST`;
}

export function isValidIstDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T12:00:00.000+05:30`);
  if (!Number.isFinite(ms)) return false;
  return getIstDateString(new Date(ms)) === value;
}

export function resolveHistoryPresetRange(
  preset: HistoryDatePreset,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date()
): { startDate: string; endDate: string } {
  const today = getIstDateString(now);
  const [yrStr, moStr] = today.split('-');
  const yr = Number(yrStr);
  const mo = Number(moStr);

  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'yesterday': {
      const y = shiftIstDate(today, -1);
      return { startDate: y, endDate: y };
    }
    case 'last_7_days':
      return { startDate: shiftIstDate(today, -6), endDate: today };
    case 'last_30_days':
      return { startDate: shiftIstDate(today, -29), endDate: today };
    case 'this_month': {
      const firstOfMonth = `${yrStr}-${moStr}-01`;
      return { startDate: firstOfMonth, endDate: today };
    }
    case 'previous_month': {
      const prevYear = mo === 1 ? yr - 1 : yr;
      const prevMonth = mo === 1 ? 12 : mo - 1;
      const prevMoStr = String(prevMonth).padStart(2, '0');
      const firstPrev = `${prevYear}-${prevMoStr}-01`;
      const firstCurr = `${yrStr}-${moStr}-01`;
      const lastPrev = shiftIstDate(firstCurr, -1);
      return { startDate: firstPrev, endDate: lastPrev };
    }
    case 'custom': {
      const s = isValidIstDate(customStart) ? customStart : shiftIstDate(today, -6);
      const e = isValidIstDate(customEnd) ? customEnd : today;
      return s <= e ? { startDate: s, endDate: e } : { startDate: e, endDate: s };
    }
    default:
      return { startDate: shiftIstDate(today, -6), endDate: today };
  }
}

export function computePrecedingEquivalentRange(
  startDate: string,
  endDate: string
): { previousStartDate: string; previousEndDate: string; daysCount: number } {
  const days = enumerateIstDates(startDate, endDate);
  const daysCount = Math.max(1, days.length);
  const previousEndDate = shiftIstDate(startDate, -1);
  const previousStartDate = shiftIstDate(previousEndDate, -(daysCount - 1));
  return { previousStartDate, previousEndDate, daysCount };
}
