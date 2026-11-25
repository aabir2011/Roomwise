/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CampusEnergySummary, Classroom, SchoolSettings } from '../types/energy.ts';
import {
  SCHOOL_DAYS_PER_MONTH,
  SCHOOL_DAYS_PER_YEAR,
  computeAppliancesRatedPowerWatts,
  getRoomOperatingProfile,
} from '../data/roomApplianceSpecs.ts';

export const ACRONYM_GLOSSARY: Record<string, { short: string; full: string }> = {
  'HT-2': {
    short: 'HT-2',
    full: 'WBSEDCL High-Tension Category 2 (Educational Institutional Tariff)',
  },
  WBSEDCL: {
    short: 'WBSEDCL',
    full: 'West Bengal State Electricity Distribution Company Limited',
  },
  WBERC: {
    short: 'WBERC',
    full: 'West Bengal Electricity Regulatory Commission',
  },
  CEA: {
    short: 'CEA',
    full: 'Central Electricity Authority (India Eastern Grid CO₂ emission factor)',
  },
  BEE: {
    short: 'BEE',
    full: 'Bureau of Energy Efficiency (Ministry of Power, Government of India)',
  },
  ECBC: {
    short: 'ECBC',
    full: 'Energy Conservation Building Code (BEE building efficiency framework)',
  },
  PVGIS: {
    short: 'PVGIS',
    full: 'Photovoltaic Geographical Information System (European Commission JRC)',
  },
  PIR: {
    short: 'PIR',
    full: 'Passive Infrared motion sensor (detects movement, not exact headcount)',
  },
  LDR: {
    short: 'LDR',
    full: 'Light-Dependent Resistor (ambient daylight illuminance sensor)',
  },
  DHT11: {
    short: 'DHT11',
    full: 'Digital Humidity and Temperature ambient comfort sensor',
  },
  BLDC: {
    short: 'BLDC',
    full: 'Brushless Direct Current high-efficiency ceiling fan motor',
  },
  HI: {
    short: 'HI',
    full: 'Heat Index (apparent temperature combining air temperature and relative humidity)',
  },
  'NBC 2016': {
    short: 'NBC 2016',
    full: 'National Building Code of India (2016) lighting and ventilation standards',
  },
  'ASHRAE-55': {
    short: 'ASHRAE-55',
    full: 'ASHRAE Standard 55 — Thermal Environmental Conditions for Human Occupancy',
  },
  GHI: {
    short: 'GHI',
    full: 'Global Horizontal Irradiance (total solar power received on a horizontal surface, W/m²)',
  },
  GTI: {
    short: 'GTI',
    full: 'Global Tilted Irradiance (solar irradiance on an inclined PV panel plane, W/m²)',
  },
  DNI: {
    short: 'DNI',
    full: 'Direct Normal Irradiance (solar beam irradiance perpendicular to sun rays, W/m²)',
  },
  CAMS: {
    short: 'CAMS',
    full: 'Copernicus Atmosphere Monitoring Service (European atmospheric air-quality model)',
  },
  ERA5: {
    short: 'ERA5',
    full: 'ECMWF 5th-generation global climate & solar reanalysis dataset',
  },
  RCEM: {
    short: 'RCEM',
    full: 'ROOMWISE Counterfactual Energy Model (time-integrated power difference framework)',
  },
};

export function getAcronymTitle(code: string): string {
  return ACRONYM_GLOSSARY[code]?.full ?? code;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function computeDailyKWhFromWatts(watts: number, roomType?: Classroom['type']): number {
  const { activeHoursPerSchoolDay } = getRoomOperatingProfile(roomType);
  return roundTo((Math.max(0, watts) * activeHoursPerSchoolDay) / 1000, 2);
}

export interface RoomCanonicalMetrics {
  currentPowerWatts: number;
  ratedPowerWatts: number;
  availableHeadroomWatts: number;
  ratedUtilizationPercent: number;
  headroomPercent: number;
  activeHoursPerSchoolDay: number;
  dailyActualKWh: number;
  dailyRatedCeilingKWh: number;
  dailyCostINR: number;
  monthlyActualKWh: number;
  monthlyCostINR: number;
  dailyEmissionsKgCO2: number;
}

export function computeClassroomCanonicalMetrics(
  room: Pick<Classroom, 'currentPowerWatts' | 'ratedPowerWatts' | 'appliances' | 'type'>,
  settings: Pick<SchoolSettings, 'tariffPerKWhINR' | 'gridCarbonFactorKgCO2PerKWh'>
): RoomCanonicalMetrics {
  const ratedPowerWatts =
    room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
  const currentPowerWatts = Math.max(0, Math.round(room.currentPowerWatts));
  const availableHeadroomWatts = Math.max(0, ratedPowerWatts - currentPowerWatts);
  const ratedUtilizationPercent =
    ratedPowerWatts > 0 ? roundTo((currentPowerWatts / ratedPowerWatts) * 100, 1) : 0;
  const headroomPercent =
    ratedPowerWatts > 0 ? roundTo(Math.max(0, 100 - ratedUtilizationPercent), 1) : 0;

  const { activeHoursPerSchoolDay } = getRoomOperatingProfile(room.type);
  const dailyActualKWh = roundTo((currentPowerWatts * activeHoursPerSchoolDay) / 1000, 2);
  const dailyRatedCeilingKWh = roundTo((ratedPowerWatts * activeHoursPerSchoolDay) / 1000, 2);

  const tariff = settings.tariffPerKWhINR;
  const carbon = settings.gridCarbonFactorKgCO2PerKWh;

  const dailyCostINR = roundTo(dailyActualKWh * tariff, 2);
  const monthlyActualKWh = roundTo(dailyActualKWh * SCHOOL_DAYS_PER_MONTH, 1);
  const monthlyCostINR = roundTo(monthlyActualKWh * tariff, 2);
  const dailyEmissionsKgCO2 = roundTo(dailyActualKWh * carbon, 2);

  return {
    currentPowerWatts,
    ratedPowerWatts,
    availableHeadroomWatts,
    ratedUtilizationPercent,
    headroomPercent,
    activeHoursPerSchoolDay,
    dailyActualKWh,
    dailyRatedCeilingKWh,
    dailyCostINR,
    monthlyActualKWh,
    monthlyCostINR,
    dailyEmissionsKgCO2,
  };
}

export function computeCampusCanonicalSummary(
  classrooms: ReadonlyArray<Classroom>,
  settings: Pick<SchoolSettings, 'tariffPerKWhINR' | 'gridCarbonFactorKgCO2PerKWh'>
): CampusEnergySummary {
  let totalCurrentPowerWatts = 0;
  let totalRatedPowerWatts = 0;
  let rawDailyActualKWh = 0;
  let rawDailyRatedCeilingKWh = 0;
  let activeOccupancyCount = 0;
  let totalRoomsOccupied = 0;
  let totalRoomsCalibrated = 0;

  for (const room of classrooms) {
    const metrics = computeClassroomCanonicalMetrics(room, settings);
    totalCurrentPowerWatts += metrics.currentPowerWatts;
    totalRatedPowerWatts += metrics.ratedPowerWatts;
    rawDailyActualKWh += metrics.dailyActualKWh;
    rawDailyRatedCeilingKWh += metrics.dailyRatedCeilingKWh;
    activeOccupancyCount += room.currentOccupants;
    if (room.occupancyStatus === 'Occupied') totalRoomsOccupied += 1;
    if (room.calibration.isCalibrated) totalRoomsCalibrated += 1;
  }

  const availableHeadroomWatts = Math.max(0, totalRatedPowerWatts - totalCurrentPowerWatts);
  const ratedUtilizationPercent =
    totalRatedPowerWatts > 0
      ? roundTo((totalCurrentPowerWatts / totalRatedPowerWatts) * 100, 1)
      : 0;
  const headroomPercent =
    totalRatedPowerWatts > 0 ? roundTo(Math.max(0, 100 - ratedUtilizationPercent), 1) : 0;

  const dailyActualKWh = roundTo(rawDailyActualKWh, 2);
  const dailyRatedCeilingKWh = roundTo(rawDailyRatedCeilingKWh, 2);

  const tariff = settings.tariffPerKWhINR;
  const carbon = settings.gridCarbonFactorKgCO2PerKWh;

  const dailyCostINR = roundTo(dailyActualKWh * tariff, 2);
  const dailyEmissionsKgCO2 = roundTo(dailyActualKWh * carbon, 2);

  const monthlyActualKWh = roundTo(dailyActualKWh * SCHOOL_DAYS_PER_MONTH, 1);
  const monthlyCostINR = roundTo(monthlyActualKWh * tariff, 2);
  const monthlyEmissionsTonnesCO2 = roundTo((monthlyActualKWh * carbon) / 1000, 2);

  const annualActualKWh = roundTo(dailyActualKWh * SCHOOL_DAYS_PER_YEAR, 1);
  const annualCostINR = roundTo(annualActualKWh * tariff, 2);
  const annualEmissionsTonnesCO2 = roundTo((annualActualKWh * carbon) / 1000, 2);

  return {
    totalCurrentPowerWatts,
    totalRatedPowerWatts,
    availableHeadroomWatts,
    ratedUtilizationPercent,
    headroomPercent,
    dailyActualKWh,
    dailyRatedCeilingKWh,
    dailyCostINR,
    dailyEmissionsKgCO2,
    monthlyActualKWh,
    monthlyCostINR,
    monthlyEmissionsTonnesCO2,
    annualActualKWh,
    annualCostINR,
    annualEmissionsTonnesCO2,
    activeOccupancyCount,
    totalRoomsOccupied,
    totalRoomsCalibrated,
  };
}

// =============================================================================
// Physical Environmental & Daylight Coupling (Single Physics Contract)
// =============================================================================

export function computeHeatIndexCelsius(tempC: number, relativeHumidityPct: number): number {
  const tf = (tempC * 9) / 5 + 32;
  const hif = 0.5 * (tf + 61.0 + (tf - 68.0) * 1.2 + relativeHumidityPct * 0.094);
  const hic = ((hif - 32) * 5) / 9;
  return roundTo(Math.max(tempC, hic), 1);
}

/**
 * Converts outdoor shortwave Global Horizontal Irradiance (GHI in W/m²)
 * to approximate horizontal outdoor illuminance (lux).
 * Returns 0 lx during night / astronomical darkness (GHI <= 2 W/m²).
 */
export function computeOutdoorIlluminanceLux(
  ghiWm2: number | null | undefined,
  cloudCoverPercent: number | null | undefined = 25
): number {
  if (ghiWm2 === null || ghiWm2 === undefined || !Number.isFinite(ghiWm2) || ghiWm2 <= 2) {
    return 0;
  }
  const cloudFrac = Math.min(1, Math.max(0, (cloudCoverPercent ?? 25) / 100));
  const luminousEfficacy = 105 * (1 - 0.08 * cloudFrac);
  return Math.max(0, Math.round(ghiWm2 * luminousEfficacy));
}

/**
 * Computes indoor natural daylight reaching student desks (lux) from live outdoor GHI,
 * cloud cover, and calibrated room daylight penetration alpha.
 * Enforces physical consistency: when outdoor GHI <= 2 W/m² (night), naturalDaylightLux is strictly 0 lx.
 */
export function computeIndoorNaturalDaylightLux(params: {
  ghiWm2: number | null | undefined;
  cloudCoverPercent?: number | null;
  daylightPenetrationAlpha: number;
  floorMultiplier?: number;
}): number {
  const outdoorLux = computeOutdoorIlluminanceLux(params.ghiWm2, params.cloudCoverPercent);
  if (outdoorLux <= 0) return 0;
  const floorMult = params.floorMultiplier ?? 1;
  const alpha = Math.min(0.95, Math.max(0.25, params.daylightPenetrationAlpha));
  const raw = outdoorLux * 0.0065 * alpha * floorMult;
  return Math.min(520, Math.max(0, Math.round(raw)));
}

export function computeArtificialDeskLux(avgLightPercent: number): number {
  const pct = Math.min(100, Math.max(0, avgLightPercent));
  return Math.round((pct / 100) * 240);
}
