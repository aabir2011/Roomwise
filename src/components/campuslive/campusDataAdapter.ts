/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuditFinding, Classroom } from '../../types/energy';
import type { HistoryOverviewResponse } from '../../types/history';
import {
  computeAppliancesRatedPowerWatts,
  OPERATING_HOURS_PER_DAY,
} from '../../data/roomApplianceSpecs';
import { getRoomActivityState, summarizeApplianceGroup } from '../../utils/applianceUtils';
import type {
  CampusRoomVisualState,
  EnergyIntensityTier,
  HistoricalSnapshotFrame,
  TourStep,
} from './types';

function classifyIntensityTier(
  powerWatts: number,
  ratedUtilizationPercent: number,
  isOccupied: boolean,
  hasAlert: boolean
): EnergyIntensityTier {
  if (powerWatts <= 2) return 'inactive';
  if (hasAlert || (!isOccupied && powerWatts > 15) || ratedUtilizationPercent > 80) {
    return 'elevated';
  }
  if (ratedUtilizationPercent <= 55) return 'efficient';
  return 'moderate';
}

/**
 * Derives 3D visual state for all 25 classrooms purely from canonical live ROOMWISE state.
 */
export function buildLiveVisualStates(
  classrooms: Classroom[],
  auditFindings: AuditFinding[]
): CampusRoomVisualState[] {
  const unresolvedByRoom = new Set(
    auditFindings.filter((f) => !f.isResolved).map((f) => f.classroomId)
  );

  return classrooms.map((room) => {
    const ratedPowerWatts =
      room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
    const ratedUtilizationPercent =
      ratedPowerWatts > 0
        ? Math.min(100, Math.round((room.currentPowerWatts / ratedPowerWatts) * 100))
        : 0;
    const lights = summarizeApplianceGroup(room.appliances, 'lights');
    const fans = summarizeApplianceGroup(room.appliances, 'fan');
    const isOccupied = getRoomActivityState(room) === 'Motion detected';
    const hasAlert = unresolvedByRoom.has(room.id);
    const hasManualOverride = room.appliances.some(
      (a) => a.operatingMode === 'MANUAL' || a.isManualOverride
    );

    return {
      roomId: room.id,
      roomCode: room.roomCode,
      name: room.name,
      building: room.building,
      floor: room.floor,
      type: room.type,
      powerWatts: room.currentPowerWatts,
      ratedPowerWatts,
      baselinePowerWatts: room.baselinePowerWatts,
      ratedUtilizationPercent,
      lightingLevel: lights.avgPercent,
      fanLevel: fans.avgPercent,
      isHistoricalAggregate: false,
      isOccupied,
      temperatureC: room.environment.temperature,
      ambientLux: room.environment.ambientLux,
      hasAlert,
      hasManualOverride,
      intensityTier: classifyIntensityTier(
        room.currentPowerWatts,
        ratedUtilizationPercent,
        isOccupied,
        hasAlert
      ),
    };
  });
}

export function extractHistoricalFrames(
  overview: HistoryOverviewResponse
): HistoricalSnapshotFrame[] {
  const granularity = overview.range.granularity;
  return overview.series.map((pt) => ({
    key: pt.key,
    label: pt.label,
    subLabel: pt.subLabel || pt.dateIst,
    dateIst: pt.dateIst,
    hourIst: pt.hourIst,
    dayType: pt.dayType,
    isPartial: pt.isPartial,
    granularity,
    totalActualKWh: pt.actualKWh,
    totalBaselineKWh: pt.baselineKWh,
    lightingKWh: pt.lightingKWh,
    fanKWh: pt.fanKWh,
    auxKWh: pt.auxKWh,
    avgOccupancyPercent: pt.avgOccupancyPercent,
    avgTempC: pt.avgTempC,
    byBuildingKWh: pt.byBuilding || {},
    byRoomKWh: pt.byRoom || {},
  }));
}

/**
 * Reconstructs room-level 3D visual state strictly from recorded historical interval kWh.
 * Does NOT fabricate individual fixture switching states: uses recorded interval kWh
 * divided by interval duration to derive mean interval load vs installed rated max.
 */
export function buildHistoricalVisualStates(
  classrooms: Classroom[],
  frame: HistoricalSnapshotFrame
): CampusRoomVisualState[] {
  // For hourly granularity, 1 kWh == 1,000 W mean draw over the hour.
  // For daily granularity, divide by canonical institutional operating hours (7.0 h/day) for active-day mean load.
  const divisorHours = frame.granularity === 'hourly' ? 1 : OPERATING_HOURS_PER_DAY;
  const campusLightShare =
    frame.totalActualKWh > 0.001
      ? Math.min(1, Math.max(0, frame.lightingKWh / frame.totalActualKWh))
      : 0;

  return classrooms.map((room) => {
    const ratedPowerWatts =
      room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
    const recordedKWh = frame.byRoomKWh[room.roomCode] ?? 0;
    const meanWatts = Math.max(0, Math.round((recordedKWh / divisorHours) * 1000));
    const ratedUtilizationPercent =
      ratedPowerWatts > 0 ? Math.min(100, Math.round((meanWatts / ratedPowerWatts) * 100)) : 0;

    // Conservative lighting luminance proxy derived strictly from recorded kWh utilisation & campus lighting share
    const lightingProxy =
      recordedKWh <= 0.002
        ? 0
        : Math.min(100, Math.round(ratedUtilizationPercent * (0.65 + campusLightShare * 0.55)));

    const inferredActive = recordedKWh > 0.01 && frame.avgOccupancyPercent > 5;
    const isOffHoursDraw =
      frame.granularity === 'hourly' &&
      typeof frame.hourIst === 'number' &&
      (frame.hourIst >= 15 || frame.hourIst <= 6) &&
      meanWatts > 60;

    return {
      roomId: room.id,
      roomCode: room.roomCode,
      name: room.name,
      building: room.building,
      floor: room.floor,
      type: room.type,
      powerWatts: meanWatts,
      ratedPowerWatts,
      baselinePowerWatts: room.baselinePowerWatts,
      ratedUtilizationPercent,
      lightingLevel: lightingProxy,
      fanLevel: 0, // Individual fan RPM is not stored in historical aggregate records
      isHistoricalAggregate: true,
      historicalIntervalKWh: recordedKWh,
      isOccupied: inferredActive,
      temperatureC: frame.avgTempC || room.environment.temperature,
      ambientLux: recordedKWh > 0.01 ? Math.round(140 + lightingProxy * 2.2) : 60,
      hasAlert: isOffHoursDraw,
      hasManualOverride: false,
      intensityTier: classifyIntensityTier(
        meanWatts,
        ratedUtilizationPercent,
        !isOffHoursDraw && inferredActive,
        isOffHoursDraw
      ),
    };
  });
}

export const CAMPUS_TOUR_STEPS: TourStep[] = [
  {
    id: 'assembled',
    title: 'DAV Model School — 1:1 Campus Replica',
    subtitle:
      'Spatial reconstruction of G+3 Block with its attached ground-floor MPH extension, Pre-Primary (PP), Old Building (OB), and New Building (NB) synced to live ROOMWISE telemetry.',
    cameraPreset: 'isometric',
    focusBuilding: null,
    focusRoomId: null,
    selectedFloor: 'All',
    exploded: false,
    cutaway: false,
    visualMode: 'architectural',
    showEnergyFlow: false,
    durationMs: 6500,
  },
  {
    id: 'g3-explode',
    title: 'Vertical Floor Separation — G+3 Block',
    subtitle:
      'Separating the four storeys of the northwest flagship block above its ground-floor MPH link reveals classrooms, science labs, and the 3rd-floor Computer & AI Lab.',
    focusBuilding: 'G+3 Block',
    focusRoomId: null,
    selectedFloor: 'All',
    exploded: true,
    cutaway: true,
    visualMode: 'architectural',
    showEnergyFlow: false,
    durationMs: 7000,
  },
  {
    id: 'lab-focus',
    title: 'Active High-Capacity Node — G3-301',
    subtitle:
      'Inspecting the Computer & AI Innovation Lab with real-time rated utilisation, lighting output, and inverter climate load.',
    focusBuilding: null,
    focusRoomId: 'g3-301',
    selectedFloor: 'All',
    exploded: true,
    cutaway: true,
    visualMode: 'lighting',
    showEnergyFlow: false,
    durationMs: 7000,
  },
  {
    id: 'vacant-shed',
    title: 'Vacant Eco-Shed Node — NB-102',
    subtitle:
      'Inside the central New Building courtyard complex, rooms with no recent PIR motion automatically curtail lighting and BLDC fan sectors to 0 W.',
    focusBuilding: null,
    focusRoomId: 'nb-102',
    selectedFloor: 'All',
    exploded: true,
    cutaway: true,
    visualMode: 'intensity',
    showEnergyFlow: false,
    durationMs: 6800,
  },
  {
    id: 'energy-flow',
    title: 'Campus Energy Intensity & Distribution',
    subtitle:
      'Relative rated utilisation across all 25 canonical rooms with conceptual distribution pathways linking all five school blocks.',
    cameraPreset: 'courtyard',
    focusBuilding: null,
    focusRoomId: null,
    selectedFloor: 'All',
    exploded: false,
    cutaway: true,
    visualMode: 'intensity',
    showEnergyFlow: true,
    durationMs: 7200,
  },
  {
    id: 'complete-overview',
    title: 'Complete Campus Overview',
    subtitle:
      'Returning to the aerial campus overview. Orbit, zoom, click any building or classroom, or switch to Top Plan and Ground View.',
    cameraPreset: 'isometric',
    focusBuilding: null,
    focusRoomId: null,
    selectedFloor: 'All',
    exploded: false,
    cutaway: false,
    visualMode: 'architectural',
    showEnergyFlow: false,
    durationMs: 6500,
  },
];
