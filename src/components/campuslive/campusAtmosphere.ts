/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EnvironmentalOverviewResponse } from '../../types/environmental';
import { ARCHITECTURAL_PALETTE } from './sceneMaterials';

export type AtmosphereConditionId =
  | 'default'
  | 'sunny'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rainy'
  | 'sunrise_sunset'
  | 'night';

export interface CampusAtmospherePreset {
  id: AtmosphereConditionId;
  label: string;
  skyColor: number;
  fogNear: number;
  fogFar: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  fillColor: number;
  fillIntensity: number;
  exposure: number;
  envIntensity: number;
  rainIntensity: number;
  nightGlowMultiplier: number;
}

export const DEFAULT_CAMPUS_ATMOSPHERE: CampusAtmospherePreset = {
  id: 'default',
  label: 'Studio Daylight',
  skyColor: ARCHITECTURAL_PALETTE.studioBg,
  fogNear: 86,
  fogFar: 195,
  hemiSkyColor: 0xedf4f8,
  hemiGroundColor: 0x6f7c6b,
  hemiIntensity: 0.92,
  sunColor: 0xfff5e2,
  sunIntensity: 1.82,
  sunPosition: [34, 48, 28],
  fillColor: 0xaec6d9,
  fillIntensity: 0.48,
  exposure: 1.05,
  envIntensity: 0.42,
  rainIntensity: 0,
  nightGlowMultiplier: 1.0,
};

const ATMOSPHERE_PRESETS: Record<AtmosphereConditionId, CampusAtmospherePreset> = {
  default: DEFAULT_CAMPUS_ATMOSPHERE,
  sunny: {
    id: 'sunny',
    label: 'Sunny',
    skyColor: 0xc9dbe8,
    fogNear: 94,
    fogFar: 215,
    hemiSkyColor: 0xf1f7fc,
    hemiGroundColor: 0x74826f,
    hemiIntensity: 0.94,
    sunColor: 0xfff4dc,
    sunIntensity: 1.94,
    sunPosition: [36, 50, 26],
    fillColor: 0xb2cde2,
    fillIntensity: 0.48,
    exposure: 1.07,
    envIntensity: 0.45,
    rainIntensity: 0,
    nightGlowMultiplier: 1.0,
  },
  partly_cloudy: {
    id: 'partly_cloudy',
    label: 'Partly Cloudy',
    skyColor: 0xc5d2da,
    fogNear: 84,
    fogFar: 192,
    hemiSkyColor: 0xe6eff5,
    hemiGroundColor: 0x6d796a,
    hemiIntensity: 0.95,
    sunColor: 0xfff6e8,
    sunIntensity: 1.56,
    sunPosition: [32, 46, 28],
    fillColor: 0xb0c4d4,
    fillIntensity: 0.52,
    exposure: 1.03,
    envIntensity: 0.4,
    rainIntensity: 0,
    nightGlowMultiplier: 1.04,
  },
  cloudy: {
    id: 'cloudy',
    label: 'Overcast',
    skyColor: 0xb8c3ca,
    fogNear: 72,
    fogFar: 170,
    hemiSkyColor: 0xd8e0e6,
    hemiGroundColor: 0x667067,
    hemiIntensity: 1.04,
    sunColor: 0xedf2f7,
    sunIntensity: 1.06,
    sunPosition: [26, 44, 24],
    fillColor: 0xaab9c4,
    fillIntensity: 0.58,
    exposure: 0.98,
    envIntensity: 0.36,
    rainIntensity: 0,
    nightGlowMultiplier: 1.12,
  },
  rainy: {
    id: 'rainy',
    label: 'Rain',
    skyColor: 0x9aaab5,
    fogNear: 60,
    fogFar: 148,
    hemiSkyColor: 0xc5d2db,
    hemiGroundColor: 0x54605b,
    hemiIntensity: 0.96,
    sunColor: 0xdce6ee,
    sunIntensity: 0.78,
    sunPosition: [22, 42, 20],
    fillColor: 0x8ea4b5,
    fillIntensity: 0.55,
    exposure: 0.94,
    envIntensity: 0.34,
    rainIntensity: 0.62,
    nightGlowMultiplier: 1.24,
  },
  sunrise_sunset: {
    id: 'sunrise_sunset',
    label: 'Twilight',
    skyColor: 0xd8c4b4,
    fogNear: 78,
    fogFar: 185,
    hemiSkyColor: 0xf4dec9,
    hemiGroundColor: 0x6c6862,
    hemiIntensity: 0.84,
    sunColor: 0xffcfa0,
    sunIntensity: 1.48,
    sunPosition: [46, 22, 24],
    fillColor: 0x9ab0cc,
    fillIntensity: 0.52,
    exposure: 1.01,
    envIntensity: 0.38,
    rainIntensity: 0,
    nightGlowMultiplier: 1.28,
  },
  night: {
    id: 'night',
    label: 'Night',
    skyColor: 0x263544,
    fogNear: 72,
    fogFar: 175,
    hemiSkyColor: 0x627d9c,
    hemiGroundColor: 0x2d383f,
    hemiIntensity: 0.68,
    sunColor: 0x9ebae0,
    sunIntensity: 0.68,
    sunPosition: [-28, 42, -24],
    fillColor: 0x4f6885,
    fillIntensity: 0.42,
    exposure: 0.95,
    envIntensity: 0.28,
    rainIntensity: 0,
    nightGlowMultiplier: 1.62,
  },
};

function getIstMinutesNow(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return h * 60 + m;
    }
  } catch {
    // Fallback below
  }
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function parseClockMinutes(clockStr: string | null | undefined, fallbackMinutes: number): number {
  if (!clockStr) return fallbackMinutes;
  const match = clockStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return fallbackMinutes;
  let hours = Number(match[1]);
  const mins = Number(match[2]);
  if (/pm/i.test(clockStr) && hours < 12) hours += 12;
  if (/am/i.test(clockStr) && hours === 12) hours = 0;
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return fallbackMinutes;
  return hours * 60 + mins;
}

/**
 * Derives a subtle, architecturally readable atmosphere preset from the existing
 * Open-Meteo overview response and campus local time (Asia/Kolkata).
 * Falls back silently to the neutral default daylight preset when disabled or unavailable.
 */
export function deriveCampusAtmosphere(
  env: EnvironmentalOverviewResponse | null,
  enabled: boolean
): CampusAtmospherePreset {
  if (!enabled || !env?.current) {
    return DEFAULT_CAMPUS_ATMOSPHERE;
  }

  const cur = env.current;
  const today = env.dailyForecast?.[0];
  const nowMinutes = getIstMinutesNow();
  const sunriseMinutes = parseClockMinutes(today?.sunriseIst, 5 * 60 + 45);
  const sunsetMinutes = parseClockMinutes(today?.sunsetIst, 17 * 60 + 45);

  const isNearSunrise = Math.abs(nowMinutes - sunriseMinutes) <= 45;
  const isNearSunset = Math.abs(nowMinutes - sunsetMinutes) <= 45;

  const precipMm = Math.max(cur.rainMm ?? 0, cur.precipitationMm ?? 0);
  const category = cur.condition?.category ?? 'unknown';
  const wmoCode = cur.condition?.wmoCode ?? null;
  const isRaining =
    precipMm > 0.1 ||
    category === 'rain' ||
    category === 'drizzle' ||
    category === 'thunderstorm' ||
    (wmoCode !== null && ((wmoCode >= 51 && wmoCode <= 67) || (wmoCode >= 80 && wmoCode <= 99)));

  const isDay =
    cur.condition?.isDaytime !== null && cur.condition?.isDaytime !== undefined
      ? cur.condition.isDaytime
      : nowMinutes >= sunriseMinutes && nowMinutes <= sunsetMinutes;

  // Nighttime takes visual lighting priority while keeping rain streaks if raining at night
  if (!isDay && !isNearSunrise && !isNearSunset) {
    if (isRaining) {
      return {
        ...ATMOSPHERE_PRESETS.night,
        id: 'rainy',
        label: 'Night Rain',
        skyColor: 0x202d38,
        fogNear: 58,
        fogFar: 145,
        rainIntensity: precipMm > 2.5 || category === 'thunderstorm' ? 0.8 : 0.5,
      };
    }
    return ATMOSPHERE_PRESETS.night;
  }

  if (isRaining) {
    return {
      ...ATMOSPHERE_PRESETS.rainy,
      rainIntensity: precipMm > 2.5 || category === 'thunderstorm' ? 0.85 : 0.55,
    };
  }

  if (isNearSunrise || isNearSunset) {
    return {
      ...ATMOSPHERE_PRESETS.sunrise_sunset,
      label: isNearSunrise ? 'Sunrise' : 'Sunset',
      sunPosition: isNearSunrise ? [46, 20, -18] : [-44, 22, 24],
    };
  }

  const cloudPct = cur.cloudCoverPercent;
  if (
    category === 'overcast' ||
    category === 'fog' ||
    (cloudPct !== null && cloudPct >= 75)
  ) {
    return ATMOSPHERE_PRESETS.cloudy;
  }

  if (
    category === 'partly_cloudy' ||
    (cloudPct !== null && cloudPct >= 30)
  ) {
    return ATMOSPHERE_PRESETS.partly_cloudy;
  }

  return ATMOSPHERE_PRESETS.sunny;
}
