/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Appliance, ApplianceOperatingMode, Classroom } from '../types/energy.ts';

export interface ApplianceGroupSummary {
  totalCount: number;
  activeCount: number;
  manualCount: number;
  avgPercent: number;
  totalWatts: number;
  maxWatts: number;
  modeStatus: 'AUTO' | 'MANUAL' | 'MIXED';
  operatingLabel: string;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Formats wattage in kW while preserving exact 3rd-decimal precision when non-zero
 * (e.g. 18635 W -> "18.635", 13390 W -> "13.39", 5245 W -> "5.245") so the
 * Estimated Pre-Retrofit Reference Capacity (18.635 kW) is never rounded down to 18.63 kW.
 */
export function formatCapacityKW(watts: number): string {
  if (!Number.isFinite(watts)) return '0.00';
  const fixed3 = (watts / 1000).toFixed(3);
  return fixed3.endsWith('0') ? fixed3.slice(0, -1) : fixed3;
}

export function getRoomActivityState(
  room: Pick<Classroom, 'occupancyStatus' | 'pir'>
): 'Motion detected' | 'No recent motion detected' | 'Sensor unavailable' {
  if (!room.pir || !room.pir.status) return 'Sensor unavailable';
  if (
    room.occupancyStatus === 'Occupied' ||
    room.pir.status === 'Motion Active' ||
    room.pir.status === 'Grace Window Active'
  ) {
    return 'Motion detected';
  }
  return 'No recent motion detected';
}

export function computeApplianceWatts(
  type: Appliance['type'],
  powerRatingWatts: number,
  outputPercent: number
): number {
  const pct = clampPercent(outputPercent);
  if (pct === 0) {
    if (type === 'projector' && powerRatingWatts <= 250) {
      return 0;
    }
    return 0;
  }
  if (type === 'fan') {
    // Low non-zero fan settings draw minimal BLDC drive power distinct from 0W OFF
    return Math.max(2, Math.round((powerRatingWatts * pct) / 100));
  }
  return Math.max(1, Math.round((powerRatingWatts * pct) / 100));
}

export function formatApplianceStateText(
  type: Appliance['type'],
  pct: number,
  mode: ApplianceOperatingMode,
  isVacant?: boolean
): string {
  const cleanPct = clampPercent(pct);
  if (cleanPct === 0) {
    if (mode === 'AUTO') {
      return isVacant ? 'OFF (Vacant Auto-Shed)' : 'OFF (Auto)';
    }
    return 'OFF (Manual)';
  }
  if (mode === 'AUTO') {
    return `${cleanPct}% · AUTO`;
  }
  return `${cleanPct}% · MANUAL`;
}

export function applyApplianceState(
  app: Appliance,
  outputPercent: number,
  mode: ApplianceOperatingMode,
  options?: { isVacant?: boolean; timestamp?: number; sourceNote?: string }
): Appliance {
  const pct = clampPercent(outputPercent);
  const watts = computeApplianceWatts(app.type, app.powerRatingWatts, pct);
  const now = options?.timestamp ?? Date.now();
  const isManual = mode === 'MANUAL';

  const lastActivePercent =
    pct > 0 ? pct : app.lastActivePercent && app.lastActivePercent > 0 ? app.lastActivePercent : undefined;

  const stateText = formatApplianceStateText(app.type, pct, mode, options?.isVacant);
  const reportedLabel = options?.sourceNote
    ? `${options.sourceNote}: ${pct === 0 ? 'OFF (0W)' : `${pct}% (${watts}W)`}`
    : `${pct === 0 ? 'OFF (0W)' : `${pct}% (${watts}W)`} · ${mode}`;

  return {
    ...app,
    outputPercent: pct,
    operatingMode: mode,
    isManualOverride: isManual,
    currentPowerWatts: watts,
    currentState: stateText,
    reportedState: reportedLabel,
    lastUpdatedAt: now,
    lastActivePercent,
    dimmingLevel: app.type === 'lights' ? pct : app.dimmingLevel,
    fanSpeed:
      app.type === 'fan'
        ? pct === 0
          ? 0
          : Math.max(1, Math.min(5, Math.ceil(pct / 20)))
        : app.fanSpeed,
    overrideExpiresAt: isManual ? 'Manual hold (until restored to AUTO)' : undefined,
  };
}

function inferUnitCountFromAppliance(app: Appliance): number {
  const match = app.name.match(/\((\d+)\s*(?:Fixtures|Units|Fans)\)/i);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 24) {
      return parsed;
    }
  }
  if (app.type === 'fan') {
    if (app.powerRatingWatts === 240) return 4; // Lab exhaust & ceiling ventilation
    return Math.max(2, Math.round(app.powerRatingWatts / 35));
  }
  if (app.type === 'lights') {
    if (app.powerRatingWatts === 300) return 6;
    return Math.max(2, Math.round(app.powerRatingWatts / 40));
  }
  return 1;
}

function splitWattsEvenly(totalWatts: number, count: number): number[] {
  const base = Math.floor(totalWatts / count);
  const remainder = totalWatts - base * count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i === count - 1 ? base + remainder : base);
  }
  return out;
}

export function expandClassroomAppliances(room: Classroom): Classroom {
  const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
  const expanded: Appliance[] = [];
  const now = Date.now();

  for (const app of room.appliances) {
    // Already expanded granular unit
    if (typeof app.outputPercent === 'number' && app.unitCode) {
      expanded.push(app);
      continue;
    }

    if (app.type === 'lights') {
      const count = inferUnitCountFromAppliance(app);
      const wattShares = splitWattsEvenly(app.powerRatingWatts, count);
      const initialPct =
        typeof app.dimmingLevel === 'number'
          ? clampPercent(app.dimmingLevel)
          : app.currentPowerWatts <= 0
          ? 0
          : clampPercent((app.currentPowerWatts / Math.max(1, app.powerRatingWatts)) * 100);

      for (let i = 1; i <= count; i++) {
        const unitRating = wattShares[i - 1];
        const baseUnit: Appliance = {
          id: `${room.id}-light-${i}`,
          name: `Light L${i}`,
          unitCode: `L${i}`,
          sectorIndex: i,
          type: 'lights',
          powerRatingWatts: unitRating,
          currentState: '',
          currentPowerWatts: 0,
          outputPercent: initialPct,
          operatingMode: app.isManualOverride ? 'MANUAL' : 'AUTO',
          dimmingLevel: initialPct,
          isManualOverride: Boolean(app.isManualOverride),
          lastActivePercent: initialPct > 0 ? initialPct : 60,
        };
        expanded.push(
          applyApplianceState(baseUnit, initialPct, baseUnit.operatingMode ?? 'AUTO', {
            isVacant,
            timestamp: now,
            sourceNote: 'Simulated Node',
          })
        );
      }
    } else if (app.type === 'fan') {
      const count = inferUnitCountFromAppliance(app);
      const wattShares = splitWattsEvenly(app.powerRatingWatts, count);
      const initialPct =
        typeof app.fanSpeed === 'number'
          ? clampPercent(app.fanSpeed * 20)
          : app.currentPowerWatts <= 0
          ? 0
          : clampPercent((app.currentPowerWatts / Math.max(1, app.powerRatingWatts)) * 100);

      for (let i = 1; i <= count; i++) {
        const sectorRating = wattShares[i - 1];
        const baseSector: Appliance = {
          id: `${room.id}-fan-${i}`,
          name: `Fan Sector S${i}`,
          unitCode: `S${i}`,
          sectorIndex: i,
          type: 'fan',
          powerRatingWatts: sectorRating,
          currentState: '',
          currentPowerWatts: 0,
          outputPercent: initialPct,
          operatingMode: app.isManualOverride ? 'MANUAL' : 'AUTO',
          fanSpeed: app.fanSpeed,
          isManualOverride: Boolean(app.isManualOverride),
          lastActivePercent: initialPct > 0 ? initialPct : 60,
        };
        expanded.push(
          applyApplianceState(baseSector, initialPct, baseSector.operatingMode ?? 'AUTO', {
            isVacant,
            timestamp: now,
            sourceNote: 'Simulated Node',
          })
        );
      }
    } else {
      const auxPct =
        app.currentPowerWatts <= 5
          ? 0
          : clampPercent((app.currentPowerWatts / Math.max(1, app.powerRatingWatts)) * 100);
      const auxUnit: Appliance = {
        ...app,
        unitCode: 'AUX',
        sectorIndex: 1,
        outputPercent: auxPct,
        operatingMode: app.isManualOverride ? 'MANUAL' : 'AUTO',
        reportedState: `${app.currentState} (Simulated Node)`,
        lastUpdatedAt: now,
        lastActivePercent: auxPct > 0 ? auxPct : 100,
      };
      expanded.push(auxUnit);
    }
  }

  const totalPowerWatts = expanded.reduce((acc, a) => acc + a.currentPowerWatts, 0);
  const ratedPowerWatts = expanded.reduce((acc, a) => acc + a.powerRatingWatts, 0);

  return {
    ...room,
    appliances: expanded,
    currentPowerWatts: totalPowerWatts,
    ratedPowerWatts,
  };
}

export function computeAdaptiveTargetLightPercent(room: Classroom): number {
  const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
  if (isVacant) return 0;

  const alpha = room.calibration.learnedParameters.daylightPenetrationAlpha;
  const naturalContribution = Math.round(room.environment.naturalDaylightLux * alpha);
  const targetLux = room.calibration.manualParameters.targetLux || 300;
  const luxDeficit = Math.max(0, targetLux - naturalContribution);

  if (luxDeficit <= 0) return 0;
  // Smooth adaptive brightness percentage scaling between 25% and 100%
  return clampPercent(Math.min(100, Math.max(25, Math.round((luxDeficit / 220) * 100))));
}

export function computeAdaptiveTargetFanPercent(room: Classroom): number {
  const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
  if (isVacant) return 0;

  const maxSpeed = room.calibration.manualParameters.maxFanSpeed || 5;
  const maxPct = clampPercent(maxSpeed * 20);
  const hi = room.environment.heatIndex;

  let desiredPct = 60;
  if (hi < 25) desiredPct = 20;
  else if (hi < 28) desiredPct = 40;
  else if (hi < 31) desiredPct = 60;
  else if (hi < 34) desiredPct = 80;
  else desiredPct = 100;

  return Math.min(desiredPct, maxPct);
}

export function summarizeApplianceGroup(
  appliances: Appliance[],
  type: 'lights' | 'fan'
): ApplianceGroupSummary {
  const items = appliances.filter((a) => a.type === type);
  const totalCount = items.length;
  if (totalCount === 0) {
    return {
      totalCount: 0,
      activeCount: 0,
      manualCount: 0,
      avgPercent: 0,
      totalWatts: 0,
      maxWatts: 0,
      modeStatus: 'AUTO',
      operatingLabel: 'None',
    };
  }

  let activeCount = 0;
  let manualCount = 0;
  let sumPercent = 0;
  let totalWatts = 0;
  let maxWatts = 0;

  for (const item of items) {
    const pct = clampPercent(item.outputPercent ?? 0);
    if (pct > 0) activeCount++;
    if (item.operatingMode === 'MANUAL' || item.isManualOverride) manualCount++;
    sumPercent += pct;
    totalWatts += item.currentPowerWatts;
    maxWatts += item.powerRatingWatts;
  }

  const avgPercent = Math.round(sumPercent / totalCount);
  const modeStatus: ApplianceGroupSummary['modeStatus'] =
    manualCount === 0 ? 'AUTO' : manualCount === totalCount ? 'MANUAL' : 'MIXED';

  const operatingLabel =
    activeCount === 0 ? 'OFF' : activeCount === totalCount ? 'Active' : `${activeCount}/${totalCount} On`;

  return {
    totalCount,
    activeCount,
    manualCount,
    avgPercent,
    totalWatts,
    maxWatts,
    modeStatus,
    operatingLabel,
  };
}
