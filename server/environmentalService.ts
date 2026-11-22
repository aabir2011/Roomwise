/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Classroom, SchoolSettings } from '../src/types/energy.ts';
import type {
  AirQualityHourlyPoint,
  AirQualityOverview,
  CoolingAnticipationInsight,
  CurrentConditionsData,
  DailyForecastDay,
  DaylightIntelligenceInsight,
  EnvironmentalAnomalyItem,
  EnvironmentalConditionSummary,
  EnvironmentalEndpointFreshness,
  EnvironmentalOverviewResponse,
  HistoricalArchiveDay,
  HistoricalReanalysisOverview,
  HourlyWeatherPoint,
  RoomEnvironmentalContextRow,
  SolarRadiationContext,
  WeatherAwareEnergyOutlook,
} from '../src/types/environmental.ts';
import { energyHistoryService } from './energyHistoryService.ts';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const OPEN_METEO_AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const DEFAULT_LAT = 22.3121;
const DEFAULT_LNG = 87.2994;
const CAMPUS_TIMEZONE = 'Asia/Kolkata';

const FORECAST_TTL_MS = 15 * 60 * 1000; // 15 minutes
const AIR_QUALITY_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ARCHIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const UPSTREAM_TIMEOUT_MS = 12_000;

interface CacheEntry<T> {
  key: string;
  data: T;
  fetchedAtMs: number;
  expiresAtMs: number;
}

interface ForecastBundle {
  elevationMeters: number | null;
  current: CurrentConditionsData | null;
  hourlyPast24h: HourlyWeatherPoint[];
  hourlyForecast: HourlyWeatherPoint[];
  dailyForecast: DailyForecastDay[];
  solarRadiation: SolarRadiationContext;
}

export interface SkyAndRadiationSnapshot {
  available: boolean;
  currentCloudCoverPercent: number | null;
  currentGhiWm2: number | null;
  todayPeakGhiWm2: number | null;
  todayPeakGtiWm2: number | null;
  fetchedAtIst: string | null;
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function roundOrNull(val: number | null, decimals = 1): number | null {
  if (val === null || !Number.isFinite(val)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function formatIstDateTime(msOrIso: number | string | null | undefined): string | null {
  if (msOrIso === null || msOrIso === undefined) return null;
  const d = typeof msOrIso === 'number' ? new Date(msOrIso) : new Date(msOrIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', {
    timeZone: CAMPUS_TIMEZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatIstHour(isoLocal: string): { labelIst: string; hourIst: string; dateIst: string } {
  // Open-Meteo with timezone=Asia/Kolkata returns local ISO strings like "2026-11-21T14:00"
  const normalized = isoLocal.includes('+') || isoLocal.endsWith('Z') ? isoLocal : `${isoLocal}+05:30`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    return { labelIst: isoLocal, hourIst: isoLocal, dateIst: isoLocal.slice(0, 10) };
  }
  const hourIst = d.toLocaleTimeString('en-IN', {
    timeZone: CAMPUS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const dateIst = d.toLocaleDateString('en-IN', {
    timeZone: CAMPUS_TIMEZONE,
    day: '2-digit',
    month: 'short',
  });
  return {
    labelIst: `${dateIst}, ${hourIst}`,
    hourIst,
    dateIst,
  };
}

function formatIstTimeOnly(isoLocal: string | null | undefined): string | null {
  if (!isoLocal) return null;
  const normalized = isoLocal.includes('+') || isoLocal.endsWith('Z') ? isoLocal : `${isoLocal}+05:30`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return isoLocal;
  return d.toLocaleTimeString('en-IN', {
    timeZone: CAMPUS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString('en-IN', {
    timeZone: CAMPUS_TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

function formatIsoDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mapWmoWeatherCode(
  codeRaw: unknown,
  isDaytimeRaw: unknown
): EnvironmentalConditionSummary {
  const code = toFiniteNumber(codeRaw);
  const isDaytime =
    typeof isDaytimeRaw === 'number'
      ? isDaytimeRaw === 1
      : typeof isDaytimeRaw === 'boolean'
      ? isDaytimeRaw
      : null;

  if (code === null) {
    return { wmoCode: null, category: 'UNKNOWN', description: 'Unavailable', isDaytime };
  }

  switch (Math.round(code)) {
    case 0:
      return { wmoCode: 0, category: 'CLEAR', description: 'Clear sky', isDaytime };
    case 1:
      return { wmoCode: 1, category: 'MAINLY_CLEAR', description: 'Mainly clear', isDaytime };
    case 2:
      return { wmoCode: 2, category: 'PARTLY_CLOUDY', description: 'Partly cloudy', isDaytime };
    case 3:
      return { wmoCode: 3, category: 'OVERCAST', description: 'Overcast', isDaytime };
    case 45:
      return { wmoCode: 45, category: 'FOG', description: 'Fog', isDaytime };
    case 48:
      return { wmoCode: 48, category: 'FOG', description: 'Depositing rime fog', isDaytime };
    case 51:
      return { wmoCode: 51, category: 'DRIZZLE', description: 'Light drizzle', isDaytime };
    case 53:
      return { wmoCode: 53, category: 'DRIZZLE', description: 'Moderate drizzle', isDaytime };
    case 55:
      return { wmoCode: 55, category: 'DRIZZLE', description: 'Dense drizzle', isDaytime };
    case 56:
    case 57:
      return { wmoCode: Math.round(code), category: 'FREEZING_DRIZZLE', description: 'Freezing drizzle', isDaytime };
    case 61:
      return { wmoCode: 61, category: 'RAIN', description: 'Slight rain', isDaytime };
    case 63:
      return { wmoCode: 63, category: 'RAIN', description: 'Moderate rain', isDaytime };
    case 65:
      return { wmoCode: 65, category: 'RAIN', description: 'Heavy rain', isDaytime };
    case 66:
    case 67:
      return { wmoCode: Math.round(code), category: 'FREEZING_RAIN', description: 'Freezing rain', isDaytime };
    case 71:
    case 73:
    case 75:
    case 77:
      return { wmoCode: Math.round(code), category: 'SNOW', description: 'Snowfall', isDaytime };
    case 80:
      return { wmoCode: 80, category: 'RAIN_SHOWERS', description: 'Slight rain showers', isDaytime };
    case 81:
      return { wmoCode: 81, category: 'RAIN_SHOWERS', description: 'Moderate rain showers', isDaytime };
    case 82:
      return { wmoCode: 82, category: 'RAIN_SHOWERS', description: 'Violent rain showers', isDaytime };
    case 95:
      return { wmoCode: 95, category: 'THUNDERSTORM', description: 'Thunderstorm', isDaytime };
    case 96:
    case 99:
      return { wmoCode: Math.round(code), category: 'THUNDERSTORM', description: 'Thunderstorm with hail', isDaytime };
    default:
      return { wmoCode: Math.round(code), category: 'OTHER', description: `WMO code ${Math.round(code)}`, isDaytime };
  }
}

async function fetchJsonWithTimeout(url: string): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ROOMWISE-Campus-Energy-Monitor/1.0',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok || parsed?.error === true) {
      const reason =
        parsed?.reason ||
        (res.status === 429
          ? 'Open-Meteo rate limit reached (HTTP 429). Serving cached data if available.'
          : `Open-Meteo upstream returned HTTP ${res.status}.`);
      return { ok: false, status: res.status, data: parsed, error: reason };
    }
    return { ok: true, status: res.status, data: parsed };
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      error: isAbort ? 'Open-Meteo request timed out.' : err?.message || 'Network error calling Open-Meteo.',
    };
  } finally {
    clearTimeout(timer);
  }
}

class EnvironmentalService {
  private forecastCache: CacheEntry<ForecastBundle> | null = null;
  private airQualityCache: CacheEntry<AirQualityOverview> | null = null;
  private archiveCache: CacheEntry<HistoricalReanalysisOverview> | null = null;

  public invalidateCache(): void {
    this.forecastCache = null;
    this.airQualityCache = null;
    this.archiveCache = null;
  }

  public getCachedSkyAndRadiationSnapshot(): SkyAndRadiationSnapshot {
    const entry = this.forecastCache;
    if (!entry) {
      return {
        available: false,
        currentCloudCoverPercent: null,
        currentGhiWm2: null,
        todayPeakGhiWm2: null,
        todayPeakGtiWm2: null,
        fetchedAtIst: null,
      };
    }
    return {
      available: true,
      currentCloudCoverPercent: entry.data.current?.cloudCoverPercent ?? null,
      currentGhiWm2: entry.data.current?.shortwaveRadiationWm2 ?? null,
      todayPeakGhiWm2: entry.data.solarRadiation.todayPeakGhiWm2,
      todayPeakGtiWm2: entry.data.solarRadiation.todayPeakGtiWm2,
      fetchedAtIst: formatIstDateTime(entry.fetchedAtMs),
    };
  }

  private async getForecastBundle(
    lat: number,
    lng: number,
    tiltDeg: number,
    azimuthDeg: number,
    forceRefresh: boolean
  ): Promise<{ data: ForecastBundle | null; freshness: EnvironmentalEndpointFreshness }> {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)},${Math.round(tiltDeg)},${Math.round(azimuthDeg)}`;
    const now = Date.now();
    if (
      !forceRefresh &&
      this.forecastCache &&
      this.forecastCache.key === key &&
      now < this.forecastCache.expiresAtMs
    ) {
      return {
        data: this.forecastCache.data,
        freshness: {
          status: 'ok',
          fromCache: true,
          stale: false,
          fetchedAtMs: this.forecastCache.fetchedAtMs,
          fetchedAtIst: formatIstDateTime(this.forecastCache.fetchedAtMs),
          ttlMinutes: Math.round(FORECAST_TTL_MS / 60_000),
        },
      };
    }

    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      timezone: CAMPUS_TIMEZONE,
      past_days: '1',
      forecast_days: '10',
      tilt: String(Math.max(0, Math.min(90, Math.round(tiltDeg)))),
      azimuth: String(Math.max(-180, Math.min(180, Math.round(azimuthDeg)))),
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'dew_point_2m',
        'is_day',
        'precipitation',
        'rain',
        'weather_code',
        'cloud_cover',
        'surface_pressure',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m',
        'shortwave_radiation',
      ].join(','),
      hourly: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'precipitation_probability',
        'precipitation',
        'weather_code',
        'cloud_cover',
        'wind_speed_10m',
        'uv_index',
        'is_day',
        'sunshine_duration',
        'shortwave_radiation',
        'direct_radiation',
        'diffuse_radiation',
        'direct_normal_irradiance',
        'global_tilted_irradiance',
      ].join(','),
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'apparent_temperature_max',
        'apparent_temperature_min',
        'sunrise',
        'sunset',
        'sunshine_duration',
        'uv_index_max',
        'precipitation_sum',
        'precipitation_probability_max',
        'shortwave_radiation_sum',
      ].join(','),
    });

    const resp = await fetchJsonWithTimeout(`${OPEN_METEO_FORECAST_URL}?${params.toString()}`);

    if (!resp.ok || !resp.data) {
      if (this.forecastCache && this.forecastCache.key === key) {
        return {
          data: this.forecastCache.data,
          freshness: {
            status: 'stale',
            fromCache: true,
            stale: true,
            fetchedAtMs: this.forecastCache.fetchedAtMs,
            fetchedAtIst: formatIstDateTime(this.forecastCache.fetchedAtMs),
            ttlMinutes: Math.round(FORECAST_TTL_MS / 60_000),
            errorMessage: resp.error,
          },
        };
      }
      return {
        data: null,
        freshness: {
          status: 'unavailable',
          fromCache: false,
          stale: false,
          fetchedAtMs: null,
          fetchedAtIst: null,
          ttlMinutes: Math.round(FORECAST_TTL_MS / 60_000),
          errorMessage: resp.error,
        },
      };
    }

    const raw = resp.data;
    const cur = raw.current || null;
    const currentTimeIso: string | null = typeof cur?.time === 'string' ? cur.time : null;
    const currentMs = currentTimeIso
      ? new Date(
          currentTimeIso.includes('+') || currentTimeIso.endsWith('Z')
            ? currentTimeIso
            : `${currentTimeIso}+05:30`
        ).getTime()
      : now;

    // Parse hourly series
    const hourly = raw.hourly || {};
    const times: string[] = Array.isArray(hourly.time) ? hourly.time : [];
    const allHourly: HourlyWeatherPoint[] = [];

    for (let i = 0; i < times.length; i++) {
      const iso = times[i];
      if (!iso) continue;
      const pointMs = new Date(
        iso.includes('+') || iso.endsWith('Z') ? iso : `${iso}+05:30`
      ).getTime();
      const istParts = formatIstHour(iso);
      const sunshineSec = toFiniteNumber(hourly.sunshine_duration?.[i]);

      allHourly.push({
        provenance: 'open_meteo_forecast_model',
        isHistorical: Number.isFinite(pointMs) && pointMs < currentMs,
        startTimeIso: iso,
        labelIst: istParts.labelIst,
        hourIst: istParts.hourIst,
        dateIst: istParts.dateIst,
        condition: mapWmoWeatherCode(hourly.weather_code?.[i], hourly.is_day?.[i]),
        temperatureC: roundOrNull(toFiniteNumber(hourly.temperature_2m?.[i]), 1),
        apparentTemperatureC: roundOrNull(toFiniteNumber(hourly.apparent_temperature?.[i]), 1),
        relativeHumidityPercent: roundOrNull(toFiniteNumber(hourly.relative_humidity_2m?.[i]), 0),
        precipitationProbabilityPercent: roundOrNull(
          toFiniteNumber(hourly.precipitation_probability?.[i]),
          0
        ),
        precipitationMm: roundOrNull(toFiniteNumber(hourly.precipitation?.[i]), 2),
        cloudCoverPercent: roundOrNull(toFiniteNumber(hourly.cloud_cover?.[i]), 0),
        windSpeedKmh: roundOrNull(toFiniteNumber(hourly.wind_speed_10m?.[i]), 1),
        uvIndex: roundOrNull(toFiniteNumber(hourly.uv_index?.[i]), 1),
        sunshineDurationMinutes:
          sunshineSec !== null ? Math.round(sunshineSec / 60) : null,
        shortwaveRadiationWm2: roundOrNull(toFiniteNumber(hourly.shortwave_radiation?.[i]), 1),
        directRadiationWm2: roundOrNull(toFiniteNumber(hourly.direct_radiation?.[i]), 1),
        diffuseRadiationWm2: roundOrNull(toFiniteNumber(hourly.diffuse_radiation?.[i]), 1),
        dniWm2: roundOrNull(toFiniteNumber(hourly.direct_normal_irradiance?.[i]), 1),
        gtiWm2: roundOrNull(toFiniteNumber(hourly.global_tilted_irradiance?.[i]), 1),
      });
    }

    const hourlyPast24h = allHourly.filter((h) => h.isHistorical).slice(-24);
    const hourlyForecast = allHourly.filter((h) => !h.isHistorical).slice(0, 72);

    // Match current UV index from nearest forecast hour if not directly in current block
    const currentHourMatch = hourlyForecast[0] || hourlyPast24h[hourlyPast24h.length - 1] || null;

    const current: CurrentConditionsData | null = cur
      ? {
          provenance: 'open_meteo_current_model',
          modelTimeIso: currentTimeIso,
          modelTimeIst: currentTimeIso ? formatIstHour(currentTimeIso).labelIst : formatIstDateTime(now),
          condition: mapWmoWeatherCode(cur.weather_code, cur.is_day),
          temperatureC: roundOrNull(toFiniteNumber(cur.temperature_2m), 1),
          apparentTemperatureC: roundOrNull(toFiniteNumber(cur.apparent_temperature), 1),
          relativeHumidityPercent: roundOrNull(toFiniteNumber(cur.relative_humidity_2m), 0),
          dewPointC: roundOrNull(toFiniteNumber(cur.dew_point_2m), 1),
          cloudCoverPercent: roundOrNull(toFiniteNumber(cur.cloud_cover), 0),
          precipitationMm: roundOrNull(toFiniteNumber(cur.precipitation), 2),
          rainMm: roundOrNull(toFiniteNumber(cur.rain), 2),
          windSpeedKmh: roundOrNull(toFiniteNumber(cur.wind_speed_10m), 1),
          windDirectionDeg: roundOrNull(toFiniteNumber(cur.wind_direction_10m), 0),
          windGustKmh: roundOrNull(toFiniteNumber(cur.wind_gusts_10m), 1),
          surfacePressureHpa: roundOrNull(toFiniteNumber(cur.surface_pressure), 1),
          uvIndex: currentHourMatch?.uvIndex ?? null,
          shortwaveRadiationWm2: roundOrNull(toFiniteNumber(cur.shortwave_radiation), 1),
        }
      : null;

    // Parse daily forecast (drop yesterday's past_day entry by matching >= today IST)
    const todayDateKey = formatIsoDate(new Date(now));
    const daily = raw.daily || {};
    const dailyTimes: string[] = Array.isArray(daily.time) ? daily.time : [];
    const dailyForecast: DailyForecastDay[] = [];

    for (let i = 0; i < dailyTimes.length; i++) {
      const dateKey = dailyTimes[i];
      if (!dateKey || dateKey < todayDateKey) continue;
      const sunSec = toFiniteNumber(daily.sunshine_duration?.[i]);
      dailyForecast.push({
        provenance: 'open_meteo_forecast_model',
        dateKey,
        label: formatDayLabel(dateKey),
        condition: mapWmoWeatherCode(daily.weather_code?.[i], true),
        maxTemperatureC: roundOrNull(toFiniteNumber(daily.temperature_2m_max?.[i]), 1),
        minTemperatureC: roundOrNull(toFiniteNumber(daily.temperature_2m_min?.[i]), 1),
        apparentMaxC: roundOrNull(toFiniteNumber(daily.apparent_temperature_max?.[i]), 1),
        apparentMinC: roundOrNull(toFiniteNumber(daily.apparent_temperature_min?.[i]), 1),
        precipitationProbabilityMaxPercent: roundOrNull(
          toFiniteNumber(daily.precipitation_probability_max?.[i]),
          0
        ),
        precipitationSumMm: roundOrNull(toFiniteNumber(daily.precipitation_sum?.[i]), 1),
        uvIndexMax: roundOrNull(toFiniteNumber(daily.uv_index_max?.[i]), 1),
        sunshineDurationHours: sunSec !== null ? roundOrNull(sunSec / 3600, 1) : null,
        shortwaveRadiationSumMjM2: roundOrNull(
          toFiniteNumber(daily.shortwave_radiation_sum?.[i]),
          2
        ),
        sunriseIst: formatIstTimeOnly(daily.sunrise?.[i]),
        sunsetIst: formatIstTimeOnly(daily.sunset?.[i]),
      });
    }

    // Build 48-hour solar radiation context (past 6h + next 42h)
    const radiationWindow = [...hourlyPast24h.slice(-6), ...hourlyForecast.slice(0, 42)];
    const next24h = hourlyForecast.slice(0, 24);
    const todayPeakGhiWm2 = next24h.reduce<number | null>(
      (max, p) => (p.shortwaveRadiationWm2 !== null && (max === null || p.shortwaveRadiationWm2 > max) ? p.shortwaveRadiationWm2 : max),
      null
    );
    const todayPeakGtiWm2 = next24h.reduce<number | null>(
      (max, p) => (p.gtiWm2 !== null && (max === null || p.gtiWm2 > max) ? p.gtiWm2 : max),
      null
    );
    const todayPeakDniWm2 = next24h.reduce<number | null>(
      (max, p) => (p.dniWm2 !== null && (max === null || p.dniWm2 > max) ? p.dniWm2 : max),
      null
    );

    const daylightNext24 = next24h.filter((h) => (h.shortwaveRadiationWm2 ?? 0) > 40);
    const avgDaylightCloud =
      daylightNext24.length > 0
        ? Math.round(
            daylightNext24.reduce((s, h) => s + (h.cloudCoverPercent ?? 0), 0) /
              daylightNext24.length
          )
        : null;

    const next24hClearSkySummary =
      avgDaylightCloud === null
        ? 'Insufficient daylight hours in the active forecast window.'
        : avgDaylightCloud <= 25
        ? `Predominantly clear daylight sky expected (~${avgDaylightCloud}% mean cloud cover); peak horizontal irradiance ~${todayPeakGhiWm2 ?? '—'} W/m².`
        : avgDaylightCloud <= 65
        ? `Intermittent cloud cover (~${avgDaylightCloud}% mean during daylight); expect variable direct vs diffuse irradiance.`
        : `Predominantly cloudy daylight sky (~${avgDaylightCloud}% mean cloud cover); diffuse irradiance will dominate over direct beam.`;

    const solarRadiation: SolarRadiationContext = {
      provenance: 'open_meteo_solar_radiation',
      configuredTiltDeg: Math.round(tiltDeg),
      configuredAzimuthDeg: Math.round(azimuthDeg),
      azimuthConventionNote:
        'Open-Meteo GTI azimuth convention: 0° = South, -90° = East, +90° = West (matches PVGIS convention).',
      temporalResolutionNote:
        'Hourly model-derived irradiance (W/m²) for Kharagpur. High-frequency 15-minute satellite radiation is not assumed for eastern India. Radiation (W/m²) is incident solar power flux, not electrical PV generation (kW/kWh).',
      todayPeakGhiWm2: roundOrNull(todayPeakGhiWm2, 0),
      todayPeakGtiWm2: roundOrNull(todayPeakGtiWm2, 0),
      todayPeakDniWm2: roundOrNull(todayPeakDniWm2, 0),
      next24hClearSkySummary,
      hourlySeries: radiationWindow.map((h) => ({
        timeIso: h.startTimeIso,
        labelIst: h.labelIst,
        hourIst: h.hourIst,
        ghiWm2: h.shortwaveRadiationWm2,
        directWm2: h.directRadiationWm2,
        diffuseWm2: h.diffuseRadiationWm2,
        dniWm2: h.dniWm2,
        gtiWm2: h.gtiWm2,
        cloudCoverPercent: h.cloudCoverPercent,
      })),
    };

    const bundle: ForecastBundle = {
      elevationMeters: roundOrNull(toFiniteNumber(raw.elevation), 1),
      current,
      hourlyPast24h,
      hourlyForecast,
      dailyForecast,
      solarRadiation,
    };

    this.forecastCache = {
      key,
      data: bundle,
      fetchedAtMs: now,
      expiresAtMs: now + FORECAST_TTL_MS,
    };

    return {
      data: bundle,
      freshness: {
        status: 'ok',
        fromCache: false,
        stale: false,
        fetchedAtMs: now,
        fetchedAtIst: formatIstDateTime(now),
        ttlMinutes: Math.round(FORECAST_TTL_MS / 60_000),
      },
    };
  }

  private async getAirQuality(
    lat: number,
    lng: number,
    forceRefresh: boolean
  ): Promise<{ data: AirQualityOverview | null; freshness: EnvironmentalEndpointFreshness }> {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const now = Date.now();
    if (
      !forceRefresh &&
      this.airQualityCache &&
      this.airQualityCache.key === key &&
      now < this.airQualityCache.expiresAtMs
    ) {
      return {
        data: this.airQualityCache.data,
        freshness: {
          status: 'ok',
          fromCache: true,
          stale: false,
          fetchedAtMs: this.airQualityCache.fetchedAtMs,
          fetchedAtIst: formatIstDateTime(this.airQualityCache.fetchedAtMs),
          ttlMinutes: Math.round(AIR_QUALITY_TTL_MS / 60_000),
        },
      };
    }

    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      timezone: CAMPUS_TIMEZONE,
      forecast_days: '3',
      current: [
        'pm2_5',
        'pm10',
        'nitrogen_dioxide',
        'sulphur_dioxide',
        'ozone',
        'carbon_monoxide',
        'dust',
        'uv_index',
      ].join(','),
      hourly: ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'uv_index'].join(','),
    });

    const resp = await fetchJsonWithTimeout(`${OPEN_METEO_AIR_QUALITY_URL}?${params.toString()}`);

    if (!resp.ok || !resp.data) {
      if (this.airQualityCache && this.airQualityCache.key === key) {
        return {
          data: this.airQualityCache.data,
          freshness: {
            status: 'stale',
            fromCache: true,
            stale: true,
            fetchedAtMs: this.airQualityCache.fetchedAtMs,
            fetchedAtIst: formatIstDateTime(this.airQualityCache.fetchedAtMs),
            ttlMinutes: Math.round(AIR_QUALITY_TTL_MS / 60_000),
            errorMessage: resp.error,
          },
        };
      }
      return {
        data: null,
        freshness: {
          status: 'unavailable',
          fromCache: false,
          stale: false,
          fetchedAtMs: null,
          fetchedAtIst: null,
          ttlMinutes: Math.round(AIR_QUALITY_TTL_MS / 60_000),
          errorMessage: resp.error,
        },
      };
    }

    const raw = resp.data;
    const cur = raw.current || null;
    const curTimeIso = typeof cur?.time === 'string' ? cur.time : null;
    const currentMs = curTimeIso
      ? new Date(
          curTimeIso.includes('+') || curTimeIso.endsWith('Z') ? curTimeIso : `${curTimeIso}+05:30`
        ).getTime()
      : now;

    const hourly = raw.hourly || {};
    const times: string[] = Array.isArray(hourly.time) ? hourly.time : [];
    const hourlyForecast: AirQualityHourlyPoint[] = [];

    for (let i = 0; i < times.length; i++) {
      const iso = times[i];
      if (!iso) continue;
      const ptMs = new Date(iso.includes('+') || iso.endsWith('Z') ? iso : `${iso}+05:30`).getTime();
      if (Number.isFinite(ptMs) && ptMs < currentMs - 3600_000) continue;
      const ist = formatIstHour(iso);
      hourlyForecast.push({
        timeIso: iso,
        labelIst: ist.labelIst,
        hourIst: ist.hourIst,
        pm25UgM3: roundOrNull(toFiniteNumber(hourly.pm2_5?.[i]), 1),
        pm10UgM3: roundOrNull(toFiniteNumber(hourly.pm10?.[i]), 1),
        o3UgM3: roundOrNull(toFiniteNumber(hourly.ozone?.[i]), 1),
        no2UgM3: roundOrNull(toFiniteNumber(hourly.nitrogen_dioxide?.[i]), 1),
        uvIndex: roundOrNull(toFiniteNumber(hourly.uv_index?.[i]), 1),
      });
      if (hourlyForecast.length >= 48) break;
    }

    const overview: AirQualityOverview = {
      provenance: 'open_meteo_cams_air_quality',
      modelLabel: 'Copernicus CAMS Global Atmospheric Composition Forecast (via Open-Meteo)',
      current: cur
        ? {
            timeIso: curTimeIso,
            timeIst: curTimeIso ? formatIstHour(curTimeIso).labelIst : formatIstDateTime(now),
            pm25UgM3: roundOrNull(toFiniteNumber(cur.pm2_5), 1),
            pm10UgM3: roundOrNull(toFiniteNumber(cur.pm10), 1),
            no2UgM3: roundOrNull(toFiniteNumber(cur.nitrogen_dioxide), 1),
            so2UgM3: roundOrNull(toFiniteNumber(cur.sulphur_dioxide), 1),
            o3UgM3: roundOrNull(toFiniteNumber(cur.ozone), 1),
            coUgM3: roundOrNull(toFiniteNumber(cur.carbon_monoxide), 0),
            dustUgM3: roundOrNull(toFiniteNumber(cur.dust), 1),
            uvIndex: roundOrNull(toFiniteNumber(cur.uv_index), 1),
          }
        : null,
      hourlyForecast,
      limitationsNote:
        'Regional atmospheric model estimate (~40 km CAMS global grid) — NOT an on-campus air quality sensor. Individual pollutant concentrations are shown in μg/m³ without substituting European AQI or inventing an unverified Indian CPCB composite AQI.',
    };

    this.airQualityCache = {
      key,
      data: overview,
      fetchedAtMs: now,
      expiresAtMs: now + AIR_QUALITY_TTL_MS,
    };

    return {
      data: overview,
      freshness: {
        status: 'ok',
        fromCache: false,
        stale: false,
        fetchedAtMs: now,
        fetchedAtIst: formatIstDateTime(now),
        ttlMinutes: Math.round(AIR_QUALITY_TTL_MS / 60_000),
      },
    };
  }

  private async getHistoricalArchive(
    lat: number,
    lng: number,
    forceRefresh: boolean
  ): Promise<{ data: HistoricalReanalysisOverview | null; freshness: EnvironmentalEndpointFreshness }> {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const now = Date.now();
    if (
      !forceRefresh &&
      this.archiveCache &&
      this.archiveCache.key === key &&
      now < this.archiveCache.expiresAtMs
    ) {
      return {
        data: this.archiveCache.data,
        freshness: {
          status: 'ok',
          fromCache: true,
          stale: false,
          fetchedAtMs: this.archiveCache.fetchedAtMs,
          fetchedAtIst: formatIstDateTime(this.archiveCache.fetchedAtMs),
          ttlMinutes: Math.round(ARCHIVE_TTL_MS / 60_000),
        },
      };
    }

    // Account for ~5-day reanalysis archive publication lag
    const endDate = formatIsoDate(new Date(now - 5 * 86_400_000));
    const startDate = formatIsoDate(new Date(now - 19 * 86_400_000));

    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      start_date: startDate,
      end_date: endDate,
      timezone: CAMPUS_TIMEZONE,
      daily: [
        'temperature_2m_max',
        'temperature_2m_min',
        'temperature_2m_mean',
        'precipitation_sum',
        'sunshine_duration',
        'shortwave_radiation_sum',
        'wind_speed_10m_max',
      ].join(','),
    });

    const resp = await fetchJsonWithTimeout(`${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`);

    if (!resp.ok || !resp.data) {
      if (this.archiveCache && this.archiveCache.key === key) {
        return {
          data: this.archiveCache.data,
          freshness: {
            status: 'stale',
            fromCache: true,
            stale: true,
            fetchedAtMs: this.archiveCache.fetchedAtMs,
            fetchedAtIst: formatIstDateTime(this.archiveCache.fetchedAtMs),
            ttlMinutes: Math.round(ARCHIVE_TTL_MS / 60_000),
            errorMessage: resp.error,
          },
        };
      }
      return {
        data: null,
        freshness: {
          status: 'unavailable',
          fromCache: false,
          stale: false,
          fetchedAtMs: null,
          fetchedAtIst: null,
          ttlMinutes: Math.round(ARCHIVE_TTL_MS / 60_000),
          errorMessage: resp.error,
        },
      };
    }

    const daily = resp.data.daily || {};
    const times: string[] = Array.isArray(daily.time) ? daily.time : [];
    const days: HistoricalArchiveDay[] = [];

    for (let i = 0; i < times.length; i++) {
      const dateKey = times[i];
      if (!dateKey) continue;
      const sunSec = toFiniteNumber(daily.sunshine_duration?.[i]);
      days.push({
        dateKey,
        label: formatDayLabel(dateKey),
        maxTemperatureC: roundOrNull(toFiniteNumber(daily.temperature_2m_max?.[i]), 1),
        minTemperatureC: roundOrNull(toFiniteNumber(daily.temperature_2m_min?.[i]), 1),
        meanTemperatureC: roundOrNull(toFiniteNumber(daily.temperature_2m_mean?.[i]), 1),
        precipitationSumMm: roundOrNull(toFiniteNumber(daily.precipitation_sum?.[i]), 1),
        sunshineDurationHours: sunSec !== null ? roundOrNull(sunSec / 3600, 1) : null,
        shortwaveRadiationSumMjM2: roundOrNull(
          toFiniteNumber(daily.shortwave_radiation_sum?.[i]),
          2
        ),
        windSpeedMaxKmh: roundOrNull(toFiniteNumber(daily.wind_speed_10m_max?.[i]), 1),
      });
    }

    const validMax = days.map((d) => d.maxTemperatureC).filter((v): v is number => v !== null);
    const validMin = days.map((d) => d.minTemperatureC).filter((v): v is number => v !== null);
    const validPrecip = days.map((d) => d.precipitationSumMm).filter((v): v is number => v !== null);
    const validSun = days.map((d) => d.sunshineDurationHours).filter((v): v is number => v !== null);

    const overview: HistoricalReanalysisOverview = {
      provenance: 'open_meteo_reanalysis',
      datasetLabel: 'Open-Meteo Historical Weather Reanalysis (ERA5 / ERA5-Land)',
      startDate,
      endDate,
      daysCovered: days.length,
      meanMaxTempC:
        validMax.length > 0
          ? roundOrNull(validMax.reduce((a, b) => a + b, 0) / validMax.length, 1)
          : null,
      meanMinTempC:
        validMin.length > 0
          ? roundOrNull(validMin.reduce((a, b) => a + b, 0) / validMin.length, 1)
          : null,
      totalPrecipitationMm:
        validPrecip.length > 0
          ? roundOrNull(validPrecip.reduce((a, b) => a + b, 0), 1)
          : null,
      meanDailySunshineHours:
        validSun.length > 0
          ? roundOrNull(validSun.reduce((a, b) => a + b, 0) / validSun.length, 1)
          : null,
      days,
      limitationNote:
        'Historical reanalysis dataset (gridded atmospheric reconstruction) ending ~5 days prior to today due to reanalysis publication delay — not direct weather-station observations.',
    };

    this.archiveCache = {
      key,
      data: overview,
      fetchedAtMs: now,
      expiresAtMs: now + ARCHIVE_TTL_MS,
    };

    return {
      data: overview,
      freshness: {
        status: 'ok',
        fromCache: false,
        stale: false,
        fetchedAtMs: now,
        fetchedAtIst: formatIstDateTime(now),
        ttlMinutes: Math.round(ARCHIVE_TTL_MS / 60_000),
      },
    };
  }

  private buildClassroomInsights(
    classrooms: Classroom[],
    current: CurrentConditionsData | null,
    hourlyForecast: HourlyWeatherPoint[],
    dailyForecast: DailyForecastDay[]
  ): EnvironmentalOverviewResponse['insights'] {
    const roomCount = Math.max(1, classrooms.length);
    const avgIndoorTempC = Number(
      (classrooms.reduce((s, r) => s + r.environment.temperature, 0) / roomCount).toFixed(1)
    );
    const avgNaturalLux = Math.round(
      classrooms.reduce((s, r) => s + r.environment.naturalDaylightLux, 0) / roomCount
    );
    const avgAmbientLux = Math.round(
      classrooms.reduce((s, r) => s + r.environment.ambientLux, 0) / roomCount
    );

    // 1. Advisory Cooling Anticipation (never overrides local classroom control)
    const next12h = hourlyForecast.slice(0, 12);
    let peakTemp: number | null = current?.temperatureC ?? null;
    let peakApparent: number | null = current?.apparentTemperatureC ?? null;
    let peakHourIst: string | null = current?.modelTimeIst ?? null;

    for (const h of next12h) {
      if (h.temperatureC !== null && (peakTemp === null || h.temperatureC > peakTemp)) {
        peakTemp = h.temperatureC;
        peakApparent = h.apparentTemperatureC;
        peakHourIst = h.hourIst;
      }
    }

    const indoorOutdoorDeltaC =
      current?.temperatureC !== null && current?.temperatureC !== undefined
        ? roundOrNull(avgIndoorTempC - current.temperatureC, 1)
        : null;

    let advisoryLevel: CoolingAnticipationInsight['advisoryLevel'] = 'low';
    let coolingHeadline = 'Mild outdoor thermal load expected';
    let coolingRecommended =
      'Maintain standard adaptive BLDC fan curves driven by each classroom’s local DHT11 heat index.';

    const effectiveHeat = peakApparent ?? peakTemp;
    if (effectiveHeat !== null && effectiveHeat >= 35) {
      advisoryLevel = 'elevated';
      coolingHeadline = `High outdoor heat load ahead (feels like ${effectiveHeat.toFixed(1)}°C)`;
      coolingRecommended =
        'Expect sustained afternoon BLDC fan demand and higher thermal gain in top-floor G+3 and west-facing rooms. Pre-ventilate during cooler morning periods while keeping local PIR/DHT11 control authoritative.';
    } else if (effectiveHeat !== null && effectiveHeat >= 29) {
      advisoryLevel = 'moderate';
      coolingHeadline = `Moderate warm spell forecast (peak ~${(peakTemp ?? effectiveHeat).toFixed(1)}°C)`;
      coolingRecommended =
        'Monitor cross-ventilation in occupied classrooms during midday transitions; local DHT11 sensors will step BLDC fan speeds automatically.';
    }

    const coolingSummary =
      current?.temperatureC !== null && current?.temperatureC !== undefined
        ? `Open-Meteo model outdoor temperature is ${current.temperatureC.toFixed(1)}°C${
            current.apparentTemperatureC !== null
              ? ` (feels like ${current.apparentTemperatureC.toFixed(1)}°C)`
              : ''
          }, compared to a ${avgIndoorTempC.toFixed(1)}°C campus indoor DHT11 average (${
            indoorOutdoorDeltaC !== null
              ? `${indoorOutdoorDeltaC >= 0 ? '+' : ''}${indoorOutdoorDeltaC.toFixed(1)}°C indoor vs outdoor`
              : 'delta unavailable'
          }).`
        : 'Outdoor model temperature is temporarily unavailable; classroom thermal control continues locally via DHT11 sensors.';

    const coolingAnticipation: CoolingAnticipationInsight = {
      provenance: 'roomwise_calculated_estimate',
      advisoryLevel,
      headline: coolingHeadline,
      summary: coolingSummary,
      peakOutdoorTempC: roundOrNull(peakTemp, 1),
      peakApparentTempC: roundOrNull(peakApparent, 1),
      peakHourIst,
      indoorAvgTempC: avgIndoorTempC,
      indoorOutdoorDeltaC,
      recommendedAction: coolingRecommended,
    };

    // 2. Daylight Intelligence (Local LDR remains authoritative)
    const cloudPct = current?.cloudCoverPercent ?? null;
    const currentGhi = current?.shortwaveRadiationWm2 ?? null;
    const isDay = current?.condition.isDaytime;

    let skyRegime: DaylightIntelligenceInsight['skyRegime'] = 'unknown';
    let daylightHeadline = 'External sky conditions unavailable';
    let daylightSummary =
      'Local classroom LDR sensors continue governing LED dimming independently.';

    if (isDay === false) {
      skyRegime = 'night';
      daylightHeadline = 'Nighttime / zero solar daylight availability';
      daylightSummary =
        'External solar irradiance is absent. Occupied rooms rely on indoor LED lighting controlled by local PIR and LDR nodes.';
    } else if (cloudPct !== null) {
      if (cloudPct <= 30 && (currentGhi === null || currentGhi >= 250)) {
        skyRegime = 'clear_bright';
        daylightHeadline = `Bright sky (${Math.round(cloudPct)}% cloud cover) — strong daylight harvesting window`;
        daylightSummary = `High external sky clarity supports strong perimeter daylighting across campus (indoor LDR natural daylight avg: ${avgNaturalLux} lx).`;
      } else if (cloudPct <= 70) {
        skyRegime = 'mixed_cloud';
        daylightHeadline = `Partly cloudy sky (${Math.round(cloudPct)}% cloud cover) — variable natural daylight`;
        daylightSummary = `Intermittent cloud cover may cause short-term lux swings; each room’s local LDR smoothly trims LED output to hold NBC desk lux targets.`;
      } else {
        skyRegime = 'overcast_or_rain';
        daylightHeadline = `Overcast / dense cloud (${Math.round(cloudPct)}% cloud cover) — higher artificial lighting demand`;
        daylightSummary = `Reduced sky luminance increases supplemental LED lighting usage in deeper classrooms (campus indoor natural avg: ${avgNaturalLux} lx).`;
      }
    }

    const highDaylightRoomsCount = classrooms.filter((r) => r.environment.naturalDaylightLux >= 220).length;
    const lowDaylightRoomsCount = classrooms.filter((r) => r.environment.naturalDaylightLux < 110).length;

    const daylightIntelligence: DaylightIntelligenceInsight = {
      provenance: 'roomwise_calculated_estimate',
      skyRegime,
      headline: daylightHeadline,
      summary: daylightSummary,
      externalCloudCoverPercent: cloudPct,
      currentGhiWm2: currentGhi,
      campusAvgNaturalLux: avgNaturalLux,
      campusAvgAmbientLux: avgAmbientLux,
      highDaylightRoomsCount,
      lowDaylightRoomsCount,
      authorityNotice:
        'Advisory context only — local classroom LDR and PIR sensors remain solely authoritative for lighting control.',
    };

    // 3. Room-by-Room Comparisons & Environmental Anomalies
    const anomalies: EnvironmentalAnomalyItem[] = [];
    const roomComparisons: RoomEnvironmentalContextRow[] = classrooms.map((room) => {
      const tempDelta =
        current?.temperatureC !== null && current?.temperatureC !== undefined
          ? roundOrNull(room.environment.temperature - current.temperatureC, 1)
          : null;

      let daylightFlag: RoomEnvironmentalContextRow['daylightFlag'] = 'aligned';
      let contextNote = 'Indoor DHT11 & LDR readings align with outdoor sky & temperature.';

      const lightsOn = room.appliances.some(
        (a) => a.type === 'lights' && (a.outputPercent ?? 0) >= 65
      );

      if (
        isDay !== false &&
        cloudPct !== null &&
        cloudPct <= 30 &&
        room.environment.naturalDaylightLux < 95 &&
        room.occupancyStatus === 'Occupied'
      ) {
        daylightFlag = 'check_shading_or_lights';
        contextNote =
          'Outdoor sky is clear, yet indoor natural lux is low — check blinds/curtains or window obstruction.';
        if (anomalies.length < 6) {
          anomalies.push({
            id: `anom-daylight-${room.id}`,
            severity: 'info',
            roomId: room.id,
            roomCode: room.roomCode,
            roomName: room.name,
            title: `${room.roomCode}: Low indoor daylight under clear sky`,
            explanation:
              'External cloud cover is low while measured indoor natural daylight remains low.',
            indoorMetric: `${room.environment.naturalDaylightLux} lx natural LDR`,
            outdoorMetric: `${Math.round(cloudPct)}% cloud cover`,
            recommendedCheck:
              'Verify curtains, window grilles, or LDR sensor lens orientation; do not override LDR blindly.',
          });
        }
      } else if (
        isDay !== false &&
        room.environment.naturalDaylightLux >= 260 &&
        lightsOn
      ) {
        daylightFlag = 'check_glare_or_sensor';
        contextNote =
          'Strong natural daylight present while lighting units remain high — verify manual override or target lux.';
        if (anomalies.length < 6) {
          anomalies.push({
            id: `anom-lights-${room.id}`,
            severity: 'warning',
            roomId: room.id,
            roomCode: room.roomCode,
            roomName: room.name,
            title: `${room.roomCode}: High artificial lighting despite bright daylight`,
            explanation:
              'Classroom lighting output is elevated even though local natural daylight is abundant.',
            indoorMetric: `${room.environment.naturalDaylightLux} lx natural · ${room.currentPowerWatts} W`,
            outdoorMetric:
              cloudPct !== null ? `${Math.round(cloudPct)}% cloud` : 'Daytime model',
            recommendedCheck:
              'Check whether a manual lighting override is active in this room.',
          });
        }
      } else if (tempDelta !== null && tempDelta >= 5.0) {
        contextNote = `Indoor temperature is +${tempDelta.toFixed(1)}°C warmer than modelled outdoor air — inspect ventilation or heat retention.`;
        if (anomalies.length < 6) {
          anomalies.push({
            id: `anom-thermal-${room.id}`,
            severity: 'warning',
            roomId: room.id,
            roomCode: room.roomCode,
            roomName: room.name,
            title: `${room.roomCode}: Elevated indoor heat retention (+${tempDelta.toFixed(1)}°C)`,
            explanation:
              'Indoor DHT11 temperature significantly exceeds the Open-Meteo outdoor model temperature.',
            indoorMetric: `${room.environment.temperature.toFixed(1)}°C (${room.environment.humidity}% RH)`,
            outdoorMetric: `${current!.temperatureC!.toFixed(1)}°C outdoor model`,
            recommendedCheck:
              'Inspect cross-ventilation, solar roof heat gain, or high room occupancy density.',
          });
        }
      }

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        name: room.name,
        building: room.building,
        floor: room.floor,
        occupancyStatus: room.occupancyStatus,
        indoorTempC: room.environment.temperature,
        indoorHumidityPercent: room.environment.humidity,
        indoorNaturalLux: room.environment.naturalDaylightLux,
        indoorAmbientLux: room.environment.ambientLux,
        targetLux: room.calibration.manualParameters.targetLux,
        currentPowerWatts: room.currentPowerWatts,
        tempDeltaVsOutdoorC: tempDelta,
        daylightFlag,
        contextNote,
      };
    });

    // 4. Weather-Aware Energy Outlook grounded in actual SQLite 30-day & 7-day history
    let avg30dKwh: number | null = null;
    let avg7dKwh: number | null = null;
    try {
      const hist30 = energyHistoryService.getOverview({ preset: 'last_30_days' });
      if (hist30.kpis.averageDailyKWh > 0) {
        avg30dKwh = roundOrNull(hist30.kpis.averageDailyKWh, 2);
      }
      const hist7 = energyHistoryService.getOverview({ preset: 'last_7_days' });
      if (hist7.kpis.averageDailyKWh > 0) {
        avg7dKwh = roundOrNull(hist7.kpis.averageDailyKWh, 2);
      }
    } catch {
      // Keep null if history unavailable
    }

    const next3Days = dailyForecast.slice(0, 3);
    const maxUpcomingTemp = next3Days.reduce<number | null>(
      (m, d) => (d.maxTemperatureC !== null && (m === null || d.maxTemperatureC > m) ? d.maxTemperatureC : m),
      null
    );
    const rainyDaysCount = next3Days.filter(
      (d) => (d.precipitationProbabilityMaxPercent ?? 0) >= 55 || (d.precipitationSumMm ?? 0) >= 3
    ).length;

    let expectedDemandBias: WeatherAwareEnergyOutlook['expectedDemandBias'] = 'typical';
    if (maxUpcomingTemp === null) {
      expectedDemandBias = 'insufficient_data';
    } else if (maxUpcomingTemp >= 34 || rainyDaysCount >= 2) {
      expectedDemandBias = 'higher_than_typical';
    } else if (maxUpcomingTemp <= 26 && rainyDaysCount === 0) {
      expectedDemandBias = 'lower_than_typical';
    }

    const coolingDemandDriver =
      maxUpcomingTemp === null
        ? 'Outdoor temperature forecast unavailable.'
        : maxUpcomingTemp >= 33
        ? `Upcoming daytime highs up to ${maxUpcomingTemp.toFixed(1)}°C indicate elevated afternoon BLDC fan demand.`
        : maxUpcomingTemp <= 26
        ? `Mild highs (≤${maxUpcomingTemp.toFixed(1)}°C) support lower afternoon fan speeds.`
        : `Moderate highs (~${maxUpcomingTemp.toFixed(1)}°C) align with typical school-day ventilation loads.`;

    const lightingDemandDriver =
      rainyDaysCount >= 2
        ? `${rainyDaysCount} of the next 3 days show elevated rain/cloud probability — expect greater supplemental LED lighting during school hours.`
        : 'Mostly dry skies over the next 3 days favor natural daylight harvesting across perimeter classrooms.';

    const energyOutlook: WeatherAwareEnergyOutlook = {
      provenance: 'roomwise_calculated_estimate',
      headline:
        expectedDemandBias === 'higher_than_typical'
          ? 'Slightly elevated school-day demand bias over the next 72 hours'
          : expectedDemandBias === 'lower_than_typical'
          ? 'Favorable weather conditions for lower-than-typical campus load'
          : expectedDemandBias === 'typical'
          ? 'Expected campus energy demand aligns with recent 30-day baseline'
          : 'Weather outlook unavailable — refer to local ROOMWISE history',
      narrative: `${coolingDemandDriver} ${lightingDemandDriver}`,
      historical30DayAvgDailyKWh: avg30dKwh,
      recent7DayAvgDailyKWh: avg7dKwh,
      expectedDemandBias,
      coolingDemandDriver,
      lightingDemandDriver,
      disclaimer:
        'Qualitative energy guidance combining ROOMWISE 30-day SQLite demand history with Open-Meteo forecast trends; not a guaranteed kWh forecast.',
    };

    return {
      coolingAnticipation,
      daylightIntelligence,
      anomalies,
      energyOutlook,
      roomComparisons,
    };
  }

  public async getOverview(params: {
    settings: SchoolSettings;
    classrooms: Classroom[];
    forceRefresh?: boolean;
    tiltDeg?: number;
    azimuthDeg?: number;
  }): Promise<EnvironmentalOverviewResponse> {
    const lat = params.settings.campusCoordinates?.latitude ?? DEFAULT_LAT;
    const lng = params.settings.campusCoordinates?.longitude ?? DEFAULT_LNG;
    const tiltDeg = typeof params.tiltDeg === 'number' && Number.isFinite(params.tiltDeg) ? params.tiltDeg : 22;
    const azimuthDeg =
      typeof params.azimuthDeg === 'number' && Number.isFinite(params.azimuthDeg)
        ? params.azimuthDeg
        : 0;
    const force = Boolean(params.forceRefresh);

    const [forecastResult, airQualityResult, archiveResult] = await Promise.allSettled([
      this.getForecastBundle(lat, lng, tiltDeg, azimuthDeg, force),
      this.getAirQuality(lat, lng, force),
      this.getHistoricalArchive(lat, lng, force),
    ]);

    const forecastBundle =
      forecastResult.status === 'fulfilled' ? forecastResult.value.data : null;
    const forecastFreshness: EnvironmentalEndpointFreshness =
      forecastResult.status === 'fulfilled'
        ? forecastResult.value.freshness
        : {
            status: 'unavailable',
            fromCache: false,
            stale: false,
            fetchedAtMs: null,
            fetchedAtIst: null,
            ttlMinutes: Math.round(FORECAST_TTL_MS / 60_000),
            errorMessage: 'Forecast request failed unexpectedly.',
          };

    const airQuality =
      airQualityResult.status === 'fulfilled' ? airQualityResult.value.data : null;
    const airQualityFreshness: EnvironmentalEndpointFreshness =
      airQualityResult.status === 'fulfilled'
        ? airQualityResult.value.freshness
        : {
            status: 'unavailable',
            fromCache: false,
            stale: false,
            fetchedAtMs: null,
            fetchedAtIst: null,
            ttlMinutes: Math.round(AIR_QUALITY_TTL_MS / 60_000),
            errorMessage: 'Air quality request failed unexpectedly.',
          };

    const historicalArchive =
      archiveResult.status === 'fulfilled' ? archiveResult.value.data : null;
    const archiveFreshness: EnvironmentalEndpointFreshness =
      archiveResult.status === 'fulfilled'
        ? archiveResult.value.freshness
        : {
            status: 'unavailable',
            fromCache: false,
            stale: false,
            fetchedAtMs: null,
            fetchedAtIst: null,
            ttlMinutes: Math.round(ARCHIVE_TTL_MS / 60_000),
            errorMessage: 'Historical reanalysis request failed unexpectedly.',
          };

    const rooms = params.classrooms;
    const roomCount = Math.max(1, rooms.length);
    const occupiedRooms = rooms.filter((r) => r.occupancyStatus === 'Occupied').length;
    const avgIndoorTempC = Number(
      (rooms.reduce((s, r) => s + r.environment.temperature, 0) / roomCount).toFixed(1)
    );
    const avgIndoorHumidityPercent = Math.round(
      rooms.reduce((s, r) => s + r.environment.humidity, 0) / roomCount
    );
    const avgNaturalDaylightLux = Math.round(
      rooms.reduce((s, r) => s + r.environment.naturalDaylightLux, 0) / roomCount
    );
    const avgAmbientLux = Math.round(
      rooms.reduce((s, r) => s + r.environment.ambientLux, 0) / roomCount
    );
    const totalLivePowerWatts = Math.round(
      rooms.reduce((s, r) => s + r.currentPowerWatts, 0)
    );

    const insights = this.buildClassroomInsights(
      rooms,
      forecastBundle?.current ?? null,
      forecastBundle?.hourlyForecast ?? [],
      forecastBundle?.dailyForecast ?? []
    );

    return {
      ok: true,
      provider: 'open-meteo',
      campus: {
        institutionName: params.settings.institutionName,
        locationLabel:
          params.settings.campusCoordinates?.label || params.settings.campusLocation,
        latitude: lat,
        longitude: lng,
        timezone: CAMPUS_TIMEZONE,
        elevationMeters: forecastBundle?.elevationMeters ?? null,
        coordinatesVerifiedByAdmin: Boolean(
          params.settings.campusCoordinates?.verifiedByAdmin
        ),
      },
      current: forecastBundle?.current ?? null,
      hourlyForecast: forecastBundle?.hourlyForecast ?? [],
      hourlyPast24h: forecastBundle?.hourlyPast24h ?? [],
      dailyForecast: forecastBundle?.dailyForecast ?? [],
      historicalArchive,
      airQuality,
      solarRadiation: forecastBundle?.solarRadiation ?? null,
      indoorCampusSnapshot: {
        provenance: 'roomwise_sensor_measurement',
        roomCount: rooms.length,
        occupiedRooms,
        avgIndoorTempC,
        avgIndoorHumidityPercent,
        avgNaturalDaylightLux,
        avgAmbientLux,
        totalLivePowerWatts,
      },
      insights,
      freshness: {
        forecast: forecastFreshness,
        airQuality: airQualityFreshness,
        archive: archiveFreshness,
      },
      attribution: {
        text: 'Weather and environmental data by Open-Meteo',
        providerUrl: 'https://open-meteo.com/',
        licenseLabel: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      },
      generatedAtIst: formatIstDateTime(Date.now()) || new Date().toISOString(),
    };
  }
}

export const environmentalService = new EnvironmentalService();
