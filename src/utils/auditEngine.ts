/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuditFinding, Classroom, SchoolSettings } from '../types/energy.ts';
import {
  SCHOOL_DAYS_PER_MONTH,
  getRoomOperatingProfile,
} from '../data/roomApplianceSpecs.ts';
import {
  computeAdaptiveTargetFanPercent,
  computeAdaptiveTargetLightPercent,
  summarizeApplianceGroup,
} from './applianceUtils.ts';

/**
 * Evaluates live room-by-room inefficiencies directly from real-time classroom
 * occupancy, daylight lux, thermal index, and appliance operating states.
 *
 * Optionally accepts `resolvedSnapshots` so recently remediated findings remain
 * visible in the "Remediated" tab unless the classroom subsequently develops a
 * new live violation.
 */
export function evaluateLiveAuditFindings(
  classrooms: Classroom[],
  settings: SchoolSettings,
  resolvedFindingIds: ReadonlySet<string> | Record<string, boolean> | readonly string[] = {},
  resolvedSnapshots?: Record<string, AuditFinding>
): AuditFinding[] {
  const resolvedSet =
    resolvedFindingIds instanceof Set
      ? resolvedFindingIds
      : Array.isArray(resolvedFindingIds)
      ? new Set<string>(resolvedFindingIds)
      : null;
  const resolvedRecord = resolvedSet ? null : (resolvedFindingIds as Record<string, boolean>);
  const isIdResolved = (id: string): boolean =>
    resolvedSet ? resolvedSet.has(id) : Boolean(resolvedRecord?.[id]);

  const findings: AuditFinding[] = [];
  const emittedIds = new Set<string>();
  const schoolDaysPerMonth = SCHOOL_DAYS_PER_MONTH;
  const tariff = settings.tariffPerKWhINR || 7.4;

  for (const room of classrooms) {
    const operatingHoursPerDay = getRoomOperatingProfile(room.type).activeHoursPerSchoolDay;
    const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
    const manualApps = room.appliances.filter((a) => a.operatingMode === 'MANUAL' || a.isManualOverride);

    // 1. Unoccupied room still drawing significant load (> 5W)
    if (isVacant && room.currentPowerWatts > 5) {
      const id = `live-vacant-${room.id}`;
      emittedIds.add(id);
      const wasteWatts = room.currentPowerWatts;
      const dailyKWhWaste = Number(((wasteWatts * operatingHoursPerDay) / 1000).toFixed(2));
      const monthlyCostWasteINR = Number((dailyKWhWaste * schoolDaysPerMonth * tariff).toFixed(2));
      const activeUnits = room.appliances
        .filter((a) => a.currentPowerWatts > 0)
        .map((a) => `${a.unitCode || a.name} (${a.currentPowerWatts}W)`)
        .slice(0, 4)
        .join(', ');

      findings.push({
        id,
        classroomId: room.id,
        classroomName: room.name,
        roomCode: room.roomCode,
        building: room.building,
        type: 'empty_room_runtime',
        severity: wasteWatts >= 100 ? 'critical' : 'warning',
        title: `Idle-Motion Room Drawing ${wasteWatts}W Active Load`,
        description: `${room.name} (${room.roomCode}) reports no recent PIR motion detected, yet active appliances remain powered: ${activeUnits}.`,
        estimatedWasteWatts: wasteWatts,
        dailyKWhWaste,
        monthlyCostWasteINR,
        remediationAction: 'Shut down active loads in vacant room and restore autonomous PIR vacancy cut-off (0W).',
        isResolved: false,
        detectedAt: 'Live Telemetry Sync',
      });
      continue;
    }

    // 2. Vacant room with residual standby phantom draw (1W - 5W)
    if (isVacant && room.currentPowerWatts > 0 && room.currentPowerWatts <= 5) {
      const id = `live-phantom-${room.id}`;
      emittedIds.add(id);
      const resolved = isIdResolved(id);
      const wasteWatts = room.currentPowerWatts;
      const dailyKWhWaste = Number(((wasteWatts * 24) / 1000).toFixed(2));
      const monthlyCostWasteINR = Number((dailyKWhWaste * 30 * tariff).toFixed(2));

      findings.push({
        id,
        classroomId: room.id,
        classroomName: room.name,
        roomCode: room.roomCode,
        building: room.building,
        type: 'phantom_load',
        severity: 'info',
        title: `Residual AV / Standby Phantom Draw (${wasteWatts}W)`,
        description: `Vacant node ${room.roomCode} draws ${wasteWatts}W in peripheral equipment standby during idle hours.`,
        estimatedWasteWatts: wasteWatts,
        dailyKWhWaste,
        monthlyCostWasteINR,
        remediationAction: 'Enforce deep standby relay isolation on confirmed classroom vacancy.',
        isResolved: resolved,
        detectedAt: 'Live Telemetry Sync',
      });
    }

    // 3. Over-illumination / manual lighting above adaptive daylight-harvested target
    const lightSummary = summarizeApplianceGroup(room.appliances, 'lights');
    const targetLightPct = computeAdaptiveTargetLightPercent(room);
    const excessLightPct = Math.max(0, lightSummary.avgPercent - targetLightPct);
    const totalLightRated = room.appliances
      .filter((a) => a.type === 'lights')
      .reduce((acc, a) => acc + a.powerRatingWatts, 0);
    const estimatedLightWasteWatts = Math.round((totalLightRated * excessLightPct) / 100);

    if (!isVacant && excessLightPct >= 15 && estimatedLightWasteWatts >= 20) {
      const id = `live-overlux-${room.id}`;
      emittedIds.add(id);
      const resolved = isIdResolved(id) && manualApps.every((a) => a.type !== 'lights');
      const dailyKWhWaste = Number(((estimatedLightWasteWatts * operatingHoursPerDay) / 1000).toFixed(2));
      const monthlyCostWasteINR = Number((dailyKWhWaste * schoolDaysPerMonth * tariff).toFixed(2));

      findings.push({
        id,
        classroomId: room.id,
        classroomName: room.name,
        roomCode: room.roomCode,
        building: room.building,
        type: 'over_illumination',
        severity: estimatedLightWasteWatts >= 80 ? 'warning' : 'info',
        title: `Over-Illumination vs Daylight Target (${lightSummary.avgPercent}% vs ${targetLightPct}% target)`,
        description: `Natural window daylight is ${room.environment.naturalDaylightLux} lx (α=${room.calibration.learnedParameters.daylightPenetrationAlpha}), leaving lights ${excessLightPct}% above NBC adaptive target.`,
        estimatedWasteWatts: estimatedLightWasteWatts,
        dailyKWhWaste,
        monthlyCostWasteINR,
        remediationAction: `Dim perimeter luminaires to adaptive ${targetLightPct}% target to reclaim ~${estimatedLightWasteWatts}W.`,
        isResolved: resolved,
        detectedAt: 'Live Telemetry Sync',
      });
    }

    // 4. Thermal mismatch / high AC or fan overdrive relative to adaptive comfort curve
    const fanSummary = summarizeApplianceGroup(room.appliances, 'fan');
    const targetFanPct = computeAdaptiveTargetFanPercent(room);
    const acUnits = room.appliances.filter((a) => a.type === 'ac');
    const acWatts = acUnits.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    const manualFans = room.appliances.filter(
      (a) => a.type === 'fan' && (a.operatingMode === 'MANUAL' || a.isManualOverride)
    );
    const excessFanPct = Math.max(0, fanSummary.avgPercent - targetFanPct);
    const totalFanRated = room.appliances
      .filter((a) => a.type === 'fan')
      .reduce((acc, a) => acc + a.powerRatingWatts, 0);
    const fanExcessWatts = Math.round((totalFanRated * excessFanPct) / 100);

    if (
      !isVacant &&
      ((manualFans.length > 0 && fanExcessWatts >= 18) ||
        (acWatts >= 1200 && room.environment.heatIndex >= 29.0))
    ) {
      const id = `live-thermal-${room.id}`;
      emittedIds.add(id);
      const resolved = isIdResolved(id) && manualFans.length === 0;
      const wasteWatts = acWatts >= 1200 ? Math.round(acWatts * 0.18) : fanExcessWatts;
      const dailyKWhWaste = Number(((wasteWatts * operatingHoursPerDay) / 1000).toFixed(2));
      const monthlyCostWasteINR = Number((dailyKWhWaste * schoolDaysPerMonth * tariff).toFixed(2));

      findings.push({
        id,
        classroomId: room.id,
        classroomName: room.name,
        roomCode: room.roomCode,
        building: room.building,
        type: 'thermal_mismatch',
        severity: wasteWatts >= 150 ? 'warning' : 'info',
        title:
          acWatts >= 1200
            ? `High Inverter AC Thermal Load (${room.environment.heatIndex}°C Heat Index)`
            : `Fan Sector Override Above Thermal Curve (${fanSummary.avgPercent}% vs ${targetFanPct}%)`,
        description:
          acWatts >= 1200
            ? `Indoor heat index (${room.environment.heatIndex}°C) drives ${acWatts}W AC draw; solar shading & BLDC balance can trim compressor load.`
            : `${manualFans.length} fan sector(s) pinned in MANUAL mode above adaptive ${targetFanPct}% comfort target.`,
        estimatedWasteWatts: wasteWatts,
        dailyKWhWaste,
        monthlyCostWasteINR,
        remediationAction:
          acWatts >= 1200
            ? `Trim AC setpoint/shading buffer and balance BLDC airflow (${wasteWatts}W estimated load reduction).`
            : `Restore fan sectors to closed-loop AUTO (${targetFanPct}% adaptive speed).`,
        isResolved: resolved,
        detectedAt: 'Live Telemetry Sync',
      });
    }
  }

  // Keep recently remediated findings visible in the "Remediated" tab until they re-violate
  if (resolvedSnapshots) {
    for (const [id, snap] of Object.entries(resolvedSnapshots)) {
      if (!emittedIds.has(id) && isIdResolved(id)) {
        findings.push({
          ...snap,
          isResolved: true,
        });
      }
    }
  }

  // Sort unresolved before resolved; critical -> warning -> info; highest waste first
  const severityRank: Record<AuditFinding['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return findings.sort((a, b) => {
    if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    return b.estimatedWasteWatts - a.estimatedWasteWatts;
  });
}

export function computeEcbcCompliancePercent(findings: AuditFinding[], totalRooms: number): number {
  const unresolvedPenalty = findings
    .filter((f) => !f.isResolved)
    .reduce((acc, f) => {
      if (f.severity === 'critical') return acc + 2.4;
      if (f.severity === 'warning') return acc + 1.2;
      return acc + 0.5;
    }, 0);
  const baseScore = totalRooms > 0 ? 99.2 : 96.4;
  return Number(Math.max(72.0, Math.min(99.8, baseScore - unresolvedPenalty)).toFixed(1));
}
