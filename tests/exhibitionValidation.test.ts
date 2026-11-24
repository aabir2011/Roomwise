/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import {
  getPathForTab,
  normalizePathname,
  parseRouteLocation,
  VALID_WORKSPACE_TABS,
} from '../src/utils/routing.ts';
import { INITIAL_CLASSROOMS, INITIAL_SCHOOL_SETTINGS } from '../src/data/initialClassrooms.ts';
import {
  buildExpandedAppliancesFromSpec,
  computeAppliancesRatedPowerWatts,
  computeRoomRatedPowerWatts,
  getRoomApplianceSpec,
  getRoomOperatingProfile,
  ROOM_APPLIANCE_SPECS,
  SCHOOL_DAYS_PER_MONTH,
  TOTAL_CAMPUS_RATED_POWER_WATTS,
} from '../src/data/roomApplianceSpecs.ts';
import { evaluateLiveAuditFindings } from '../src/utils/auditEngine.ts';
import { CAMPUS_BUILDINGS_SCHEMA, CAMPUS_LANDMARK_LABELS } from '../src/components/campuslive/campusLayoutSchema.ts';
import { buildSchoolDayDemandProfile } from '../src/utils/demandProfile.ts';
import {
  AUTHORITATIVE_CAMPUS_FEATURES,
  getCampusMeasurementById,
  m2ToFt2,
  metersToFt,
  OB_NB_COMBINED_MEASUREMENT,
  TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2,
  TOTAL_OUTDOOR_SPORTS_AREA_M2,
} from '../src/data/campusBuildingMeasurements.ts';
import { buildReconstructedCampusStructures } from '../server/campusReconstruction.ts';
import { solarService } from '../server/solarService.ts';

test('URL routing resolves all canonical workspace sections, aliases, QR routes, auth routes, and 404s', () => {
  // Root & canonical sections
  assert.deepEqual(parseRouteLocation({ pathname: '/' }), { type: 'dashboard', tab: 'dashboard' });
  assert.deepEqual(parseRouteLocation({ pathname: '/overview' }), { type: 'dashboard', tab: 'dashboard' });
  assert.deepEqual(parseRouteLocation({ pathname: '/digital-twin/' }), { type: 'dashboard', tab: 'digital-twin' });
  assert.deepEqual(parseRouteLocation({ pathname: '/campus-live' }), { type: 'dashboard', tab: 'campus-live' });
  assert.deepEqual(parseRouteLocation({ pathname: '/classrooms' }), { type: 'dashboard', tab: 'classrooms' });
  assert.deepEqual(parseRouteLocation({ pathname: '/environmental-solar' }), {
    type: 'dashboard',
    tab: 'environmental-solar',
  });
  assert.deepEqual(parseRouteLocation({ pathname: '/environmental' }), { type: 'dashboard', tab: 'environmental' });
  assert.deepEqual(parseRouteLocation({ pathname: '/solar' }), { type: 'dashboard', tab: 'solar' });
  assert.deepEqual(parseRouteLocation({ pathname: '/analytics' }), { type: 'dashboard', tab: 'analytics' });
  assert.deepEqual(parseRouteLocation({ pathname: '/history' }), { type: 'dashboard', tab: 'history' });
  assert.deepEqual(parseRouteLocation({ pathname: '/space-intelligence' }), {
    type: 'dashboard',
    tab: 'space-intelligence',
  });
  assert.deepEqual(parseRouteLocation({ pathname: '/audit' }), { type: 'dashboard', tab: 'audit' });
  assert.deepEqual(parseRouteLocation({ pathname: '/reports' }), { type: 'dashboard', tab: 'reports' });
  assert.deepEqual(parseRouteLocation({ pathname: '/settings' }), { type: 'dashboard', tab: 'settings' });

  // Classroom QR & query routes (valid and invalid codes preserve exact code for error screen)
  assert.deepEqual(parseRouteLocation({ pathname: '/classroom/G3-G01' }), {
    type: 'classroom',
    roomCode: 'G3-G01',
  });
  assert.deepEqual(parseRouteLocation({ pathname: '/classroom/INVALID-999' }), {
    type: 'classroom',
    roomCode: 'INVALID-999',
  });
  assert.deepEqual(parseRouteLocation({ pathname: '/', search: '?room=NB-102' }), {
    type: 'classroom',
    roomCode: 'NB-102',
  });

  // Auth & Access Card routes
  assert.deepEqual(parseRouteLocation({ pathname: '/access-card' }), { type: 'access-card' });
  assert.deepEqual(parseRouteLocation({ pathname: '/mobile-access' }), { type: 'access-card' });
  assert.deepEqual(parseRouteLocation({ pathname: '/', search: '?c=abc123' }), { type: 'access-card' });
  assert.deepEqual(parseRouteLocation({ pathname: '/admin-login' }), { type: 'admin-login' });
  assert.deepEqual(parseRouteLocation({ pathname: '/admin' }), { type: 'admin-login' });

  // Unrecognized paths resolve to explicit 404 route (never silent dashboard fallback)
  assert.deepEqual(parseRouteLocation({ pathname: '/nonexistent-page' }), {
    type: 'not-found',
    pathname: '/nonexistent-page',
  });
  assert.deepEqual(parseRouteLocation({ pathname: '/classroom/' }), {
    type: 'not-found',
    pathname: '/classroom/',
  });

  // Round-trip every valid workspace tab
  for (const tab of VALID_WORKSPACE_TABS) {
    const path = getPathForTab(tab);
    const parsed = parseRouteLocation({ pathname: path });
    assert.equal(parsed.type, 'dashboard');
    if (parsed.type === 'dashboard') {
      assert.equal(parsed.tab, tab);
    }
  }

  assert.equal(normalizePathname('//analytics///'), '/analytics');
});

test('25-node classroom dataset & appliance specifications maintain exact dimensional consistency', () => {
  assert.equal(INITIAL_CLASSROOMS.length, 25, 'Campus must contain exactly 25 monitored rooms');
  assert.equal(ROOM_APPLIANCE_SPECS.length, 25, 'Specs must exist for all 25 rooms');

  let sumRated = 0;
  let sumCurrent = 0;
  let sumBaseline = 0;
  let sumDailyActualKWh = 0;
  let sumDailyBaselineKWh = 0;

  for (const room of INITIAL_CLASSROOMS) {
    const spec = getRoomApplianceSpec(room.id);
    assert.ok(spec, `Missing appliance spec for room ${room.id}`);
    const appliances = buildExpandedAppliancesFromSpec(spec);
    const ratedW = computeAppliancesRatedPowerWatts(appliances);
    assert.equal(ratedW, computeRoomRatedPowerWatts(room.id));

    const currentW = appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    assert.ok(currentW >= 0 && currentW <= ratedW, `${room.roomCode}: current power ${currentW}W must be within 0..${ratedW}W`);

    const profile = getRoomOperatingProfile(room.type);
    const dailyActual = Number(((currentW * profile.activeHoursPerSchoolDay) / 1000).toFixed(2));
    const dailyBaseline = Number(
      ((room.baselinePowerWatts * profile.activeHoursPerSchoolDay * profile.baselineDutyFactor) / 1000).toFixed(2)
    );

    sumRated += ratedW;
    sumCurrent += currentW;
    sumBaseline += room.baselinePowerWatts;
    sumDailyActualKWh += dailyActual;
    sumDailyBaselineKWh += dailyBaseline;
  }

  assert.equal(sumRated, TOTAL_CAMPUS_RATED_POWER_WATTS);
  assert.ok(sumRated > 10000 && sumRated < 20000, `Installed rated capacity (${sumRated}W) should be physically realistic for 25 school rooms`);
  assert.ok(sumBaseline >= sumRated, 'Pre-retrofit reference capacity should not be lower than post-retrofit LED/BLDC rated capacity');
  assert.ok(sumCurrent > 0 && sumCurrent < sumRated, 'Active draw should be strictly between 0W and rated max');

  // Verify Dashboard, Analytics, DigitalTwin, and Reports share identical daily/monthly math
  const dailySavedKWh = Math.max(0, sumDailyBaselineKWh - sumDailyActualKWh);
  const dailyCostINR = Number((dailySavedKWh * INITIAL_SCHOOL_SETTINGS.tariffPerKWhINR).toFixed(2));
  const dailyCO2Kg = Number((dailySavedKWh * INITIAL_SCHOOL_SETTINGS.gridCarbonFactorKgCO2PerKWh).toFixed(2));
  const monthlySavedKWh = dailySavedKWh * SCHOOL_DAYS_PER_MONTH;

  assert.ok(dailySavedKWh > 0);
  assert.ok(Math.abs(dailyCostINR - dailySavedKWh * INITIAL_SCHOOL_SETTINGS.tariffPerKWhINR) <= 0.01);
  assert.ok(Math.abs(dailyCO2Kg - dailySavedKWh * INITIAL_SCHOOL_SETTINGS.gridCarbonFactorKgCO2PerKWh) <= 0.01);
  assert.equal(SCHOOL_DAYS_PER_MONTH, 22);
  assert.ok(monthlySavedKWh > dailySavedKWh * 20);
});

test('Audit engine detects anomalies accurately on live appliance states without false positives on vacant 0W rooms', () => {
  const expanded = INITIAL_CLASSROOMS.map((room) => {
    const spec = getRoomApplianceSpec(room.id)!;
    const appliances = buildExpandedAppliancesFromSpec(spec);
    const currentPowerWatts = appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    return { ...room, appliances, currentPowerWatts };
  });

  const findings = evaluateLiveAuditFindings(expanded, INITIAL_SCHOOL_SETTINGS);
  assert.ok(Array.isArray(findings));
  // Vacant rooms at 0W (NB-102 and MPH-01) should not trigger vacant phantom-load alerts
  const nb102VacantWaste = findings.find(
    (f) => f.classroomId === 'nb-102' && f.type === 'empty_room_runtime' && !f.isResolved
  );
  assert.equal(nb102VacantWaste, undefined);
});

test('70-classroom school-wide reference scenario arithmetic is dimensionally exact', () => {
  const baselineRoomPowerW = 540; // e.g., 4x 40W tube lights + 4x 95W conventional fans = 540W -> 0.54 kW
  const baselineRoomPowerKW = baselineRoomPowerW / 1000;
  const avoidedMinutesPerDay = 80;
  const avoidedHoursPerDay = avoidedMinutesPerDay / 60;
  const roomDailyKWh = baselineRoomPowerKW * avoidedHoursPerDay;
  const schoolDaysPerYear = 200;
  const roomAnnualKWh = roomDailyKWh * schoolDaysPerYear;
  const classroomCount = 70;
  const campusAnnualKWh = roomAnnualKWh * classroomCount;
  const tariffINR = 7;
  const campusAnnualINR = campusAnnualKWh * tariffINR;

  assert.ok(Math.abs(roomDailyKWh - 0.72) < 1e-9);
  assert.ok(Math.abs(roomAnnualKWh - 144) < 1e-9);
  assert.ok(Math.abs(campusAnnualKWh - 10080) < 1e-9);
  assert.ok(Math.abs(campusAnnualINR - 70560) < 1e-9);
});

test('RCEM discrete and continuous formulations render cleanly in strict KaTeX and preserve exact notation', () => {
  const discreteTex =
    '\\boxed{E_{\\mathrm{RCEM}} = \\frac{1}{1000} \\sum_{i=1}^{N} (P_{\\mathrm{B},i} - P_{\\mathrm{RW},i}) \\Delta t_i}';
  const continuousTex =
    '\\boxed{E_{\\mathrm{RCEM}} = \\frac{1}{1000} \\int_{t_0}^{t_1} \\left[P_{\\mathrm{B}}(t) - P_{\\mathrm{RW}}(t)\\right] dt}';

  const discreteHtml = katex.renderToString(discreteTex, {
    displayMode: true,
    throwOnError: true,
    strict: 'error',
  });
  const continuousHtml = katex.renderToString(continuousTex, {
    displayMode: true,
    throwOnError: true,
    strict: 'error',
  });

  assert.ok(discreteHtml.includes('RCEM'));
  assert.ok(continuousHtml.includes('RCEM'));

  // Verify discrete formula sign-handling & watt-hour to kWh conversion
  const calcRcemDiscrete = (intervals: Array<{ pB: number; pRW: number; dtHours: number }>) =>
    intervals.reduce((acc, x) => acc + (x.pB - x.pRW) * x.dtHours, 0) / 1000;

  assert.ok(Math.abs(calcRcemDiscrete([{ pB: 540, pRW: 240, dtHours: 1.0 }]) - 0.3) < 1e-9);
  assert.ok(calcRcemDiscrete([{ pB: 300, pRW: 400, dtHours: 1.0 }]) < 0, 'Negative sign when P_RW > P_B must be preserved');
});

test('Campus Live 3D architectural layout contains exactly the 5 academic blocks and excludes residential zone', () => {
  assert.equal(CAMPUS_BUILDINGS_SCHEMA.length, 5);
  const names = CAMPUS_BUILDINGS_SCHEMA.map((b) => b.id).sort();
  assert.deepEqual(names, [
    'G+3 Block',
    'Multipurpose Hall',
    'New Building',
    'Old Building',
    'Pre-Primary Block',
  ]);
  const landmarkBuildingIds = CAMPUS_LANDMARK_LABELS.filter((l) => l.buildingId).map((l) => l.buildingId);
  assert.equal(landmarkBuildingIds.length, 5);
});

test('Overview demand profile tracks live IST school-day hour dynamically and appends a live bar outside school hours', () => {
  // 08:45 IST (03:15 UTC) -> 08:30 slot active (not hardcoded 10:30)
  const morning = buildSchoolDayDemandProfile({
    liveActualKW: 5.12,
    liveBaseKW: 16.4,
    now: new Date('2026-11-23T03:15:00Z'),
  });
  assert.equal(morning.isWithinSchoolHours, true);
  assert.equal(morning.activeLabel, '08:30 IST');
  assert.equal(morning.slots.length, 8);
  assert.equal(morning.slots.find((s) => s.hour === '08:30')?.isCurrent, true);
  assert.equal(morning.slots.find((s) => s.hour === '08:30')?.actual, 5.12);
  assert.equal(morning.slots.find((s) => s.hour === '10:30')?.isCurrent, false);

  // 13:50 IST (08:20 UTC) -> 13:30 slot active
  const afternoon = buildSchoolDayDemandProfile({
    liveActualKW: 4.95,
    liveBaseKW: 16.4,
    now: new Date('2026-11-23T08:20:00Z'),
  });
  assert.equal(afternoon.isWithinSchoolHours, true);
  assert.equal(afternoon.activeLabel, '13:30 IST');
  assert.equal(afternoon.slots.find((s) => s.hour === '13:30')?.isCurrent, true);
  assert.equal(afternoon.slots.find((s) => s.hour === '10:30')?.isCurrent, false);

  // 19:37 IST (14:07 UTC) -> outside school hours, appends dedicated live bar at 19:37
  const evening = buildSchoolDayDemandProfile({
    liveActualKW: 4.5,
    liveBaseKW: 16.4,
    now: new Date('2026-11-23T14:07:00Z'),
  });
  assert.equal(evening.isWithinSchoolHours, false);
  assert.equal(evening.activeLabel, '19:37 IST');
  assert.equal(evening.slots.length, 9);
  assert.equal(evening.slots.find((s) => s.hour === '10:30')?.isCurrent, false);
  const liveBar = evening.slots[evening.slots.length - 1];
  assert.equal(liveBar.isCurrent, true);
  assert.equal(liveBar.isAfterHoursLive, true);
  assert.equal(liveBar.hour, '19:37');
  assert.equal(liveBar.actual, 4.5);
});

function polygonArea2D(pts: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

function pointInPolygon2D(px: number, pz: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsProperlyIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number]
): boolean {
  const orient = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 1e-6 && o2 < -1e-6) || (o1 < -1e-6 && o2 > 1e-6)) &&
    ((o3 > 1e-6 && o4 < -1e-6) || (o3 < -1e-6 && o4 > 1e-6));
}

function isSimplePolygon(pts: Array<[number, number]>): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (segmentsProperlyIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

test('Authoritative supplied Google Maps measurements preserve exact areas, perimeters, unit conversions, and non-building exclusions', () => {
  const g3 = getCampusMeasurementById('campus/g3-block')!;
  const mph = getCampusMeasurementById('campus/mph')!;
  const pp = getCampusMeasurementById('campus/pre-primary-block')!;
  const ob = getCampusMeasurementById('campus/old-building')!;
  const nb = getCampusMeasurementById('campus/new-building')!;
  const fb = getCampusMeasurementById('campus/football-ground')!;
  const bb = getCampusMeasurementById('campus/basketball-court')!;

  // Exact supplied areas & perimeters
  assert.equal(g3.authoritativeFootprintAreaM2, 601.55);
  assert.equal(g3.suppliedPerimeterM, 133.98);
  assert.equal(mph.authoritativeFootprintAreaM2, 168.51);
  assert.equal(mph.suppliedPerimeterM, 52.27);
  assert.equal(pp.authoritativeFootprintAreaM2, 387.53);
  assert.equal(pp.suppliedPerimeterM, 105.86);
  assert.equal(OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaM2, 1209.21);
  assert.equal(OB_NB_COMBINED_MEASUREMENT.suppliedCombinedPerimeterM, 285.74);
  assert.equal(
    Number((ob.authoritativeFootprintAreaM2 + nb.authoritativeFootprintAreaM2).toFixed(2)),
    1209.21,
    'OB + NB apportioned footprints must equal supplied 1,209.21 m² exactly with zero double-counting'
  );
  assert.equal(fb.authoritativeFootprintAreaM2, 5300.83);
  assert.equal(fb.suppliedPerimeterM, 344.17);
  assert.equal(fb.isBuildingFootprint, false);
  assert.equal(fb.solarEligible, false);
  assert.equal(bb.authoritativeFootprintAreaM2, 737.14);
  assert.equal(bb.suppliedPerimeterM, 113.93);
  assert.equal(bb.isBuildingFootprint, false);
  assert.equal(bb.solarEligible, false);

  // Totals
  assert.equal(TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2, 2366.8);
  assert.equal(TOTAL_OUTDOOR_SPORTS_AREA_M2, 6037.97);
  assert.equal(AUTHORITATIVE_CAMPUS_FEATURES.filter((f) => f.isBuildingFootprint).length, 5);

  // Exact supplied ft² preservation (never silently overwritten by re-rounding)
  assert.equal(g3.authoritativeFootprintAreaFt2, 6475.02);
  assert.equal(mph.authoritativeFootprintAreaFt2, 1813.81);
  assert.equal(pp.authoritativeFootprintAreaFt2, 4171.29);
  assert.equal(OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaFt2, 13015.87);
  assert.equal(fb.authoritativeFootprintAreaFt2, 57057.63);
  assert.equal(bb.authoritativeFootprintAreaFt2, 7934.47);

  // SI conversion verification (max 2-decimal m²->ft² rounding bound = 0.005 * 10.7639 ≈ 0.054 ft²)
  assert.ok(Math.abs(m2ToFt2(601.55) - 6475.02) < 0.06);
  assert.ok(Math.abs(m2ToFt2(168.51) - 1813.81) < 0.06);
  assert.ok(Math.abs(m2ToFt2(387.53) - 4171.29) < 0.06);
  assert.ok(Math.abs(m2ToFt2(1209.21) - 13015.87) < 0.06);
  assert.ok(Math.abs(m2ToFt2(5300.83) - 57057.63) < 0.1);
  assert.ok(Math.abs(m2ToFt2(737.14) - 7934.47) < 0.06);
  assert.ok(Math.abs(metersToFt(133.98) - 439.58) < 0.05);
  assert.ok(Math.abs(metersToFt(285.74) - 937.47) < 0.05);
});

test('Reconstructed 2D campus polygons and CAMPUS LIVE 3D footprints match supplied measurements and contain all 25 rooms cleanly', () => {
  const ref = { lat: 22.3121, lon: 87.2994 };
  const structures = buildReconstructedCampusStructures(ref);

  // Every reconstructed polygon is closed and matches authoritative area within 1%
  for (const s of structures) {
    const ring = s.polygons[0].outer;
    assert.ok(ring.length >= 4);
    assert.equal(ring[0].lat, ring[ring.length - 1].lat);
    assert.equal(ring[0].lon, ring[ring.length - 1].lon);
    const relErr = Math.abs(s.polygonCalculatedAreaM2 - s.grossFootprintAreaM2) / s.grossFootprintAreaM2;
    assert.ok(
      relErr < 0.01,
      `Structure ${s.id} polygon area ${s.polygonCalculatedAreaM2} m² drifted >1% from authoritative ${s.grossFootprintAreaM2} m²`
    );
  }

  // CAMPUS LIVE 3D footprints: non-self-intersecting, calibrated to supplied areas @ 2.65 m/u, all 25 rooms strictly inside!
  const sqMetersPerUnit2 = 2.65 * 2.65;
  let liveAcademicAreaM2 = 0;
  let roomChecks = 0;
  for (const b of CAMPUS_BUILDINGS_SCHEMA) {
    assert.ok(isSimplePolygon(b.footprintPts), `CAMPUS LIVE polygon for ${b.id} must not self-intersect`);
    const areaM2 = polygonArea2D(b.footprintPts) * sqMetersPerUnit2;
    liveAcademicAreaM2 += areaM2;

    for (const fl of b.floors) {
      for (const r of fl.rooms) {
        roomChecks += 1;
        const rotY = r.localRotationY ?? 0;
        const cosR = Math.cos(rotY);
        const sinR = Math.sin(rotY);
        const hw = r.width / 2;
        const hd = r.depth / 2;
        const corners: Array<[number, number]> = [
          [-hw, -hd],
          [hw, -hd],
          [hw, hd],
          [-hw, hd],
        ].map(([cx, cz]) => [
          r.localX + cx * cosR + cz * sinR,
          r.localZ - cx * sinR + cz * cosR,
        ]);

        for (const [px, pz] of corners) {
          assert.ok(
            pointInPolygon2D(px, pz, b.footprintPts),
            `Room ${r.roomCode} corner (${px.toFixed(2)}, ${pz.toFixed(2)}) protrudes outside ${b.id} footprint`
          );
        }
      }
    }
  }
  assert.equal(roomChecks, 25, 'All 25 canonical classrooms must be verified inside building footprints');
  assert.ok(
    Math.abs(liveAcademicAreaM2 - TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2) / TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2 < 0.005,
    `CAMPUS LIVE total academic area (${liveAcademicAreaM2.toFixed(2)} m²) must align with authoritative 2,366.80 m²`
  );

  // Verify MPH is attached flush to G+3's SW wall (outward extension, not detached or overlapping)
  const g3 = CAMPUS_BUILDINGS_SCHEMA.find((b) => b.id === 'G+3 Block')!;
  const mph = CAMPUS_BUILDINGS_SCHEMA.find((b) => b.id === 'Multipurpose Hall')!;
  assert.equal(mph.attachedToBuilding, 'G+3 Block');
  const cosG = Math.cos(g3.rotationY);
  const sinG = Math.sin(g3.rotationY);
  const g3SwWorld: [number, number] = [
    g3.worldX + -4.77 * cosG + 5.76 * sinG,
    g3.worldZ - -4.77 * sinG + 5.76 * cosG,
  ];
  const mphNwWorld: [number, number] = [
    mph.worldX + -2.18 * cosG + -2.75 * sinG,
    mph.worldZ - -2.18 * sinG + -2.75 * cosG,
  ];
  const seamGap = Math.hypot(g3SwWorld[0] - mphNwWorld[0], g3SwWorld[1] - mphNwWorld[1]);
  assert.ok(seamGap < 0.05, `MPH NW corner must meet G+3 SW corner flush (got seam gap ${seamGap.toFixed(3)} units)`);
});

test('Solar workspace integrates authoritative 2,366.80 m² academic footprints, separates footprint from usable roof area, and excludes sports grounds', async () => {
  const ws = await solarService.getWorkspace(INITIAL_SCHOOL_SETTINGS, { allowLiveDiscovery: false });
  assert.equal(ws.campusSummary.combinedGrossFootprintAreaM2, 2366.8);
  assert.equal(ws.campusSummary.actualRoofSurfaceAreaLabel, 'Not available');
  assert.ok(
    ws.campusSummary.combinedUsableRoofAreaM2 < ws.campusSummary.combinedGrossFootprintAreaM2,
    'Usable PV roof area must be strictly less than horizontal building footprint area'
  );
  assert.ok(ws.campusSummary.combinedCapacityKwp > 0);
  assert.ok(ws.campusSummary.combinedAnnualGenerationKwh > 0);

  const football = ws.buildings.find((b) => b.id === 'campus/football-ground')!;
  const basketball = ws.buildings.find((b) => b.id === 'campus/basketball-court')!;
  assert.equal(football.solarEligible, false);
  assert.equal(football.capacity.usableRoofAreaM2, 0);
  assert.equal(football.capacity.effectiveCapacityKwp, 0);
  assert.equal(football.geometry.grossFootprintAreaM2, 5300.83);
  assert.equal(basketball.solarEligible, false);
  assert.equal(basketball.capacity.usableRoofAreaM2, 0);
  assert.equal(basketball.capacity.effectiveCapacityKwp, 0);
  assert.equal(basketball.geometry.grossFootprintAreaM2, 737.14);

  const ob = ws.buildings.find((b) => b.id === 'campus/old-building')!;
  const nb = ws.buildings.find((b) => b.id === 'campus/new-building')!;
  assert.ok(ob.geometry.combinedComplexNote?.includes('1,209.21'));
  assert.ok(nb.geometry.combinedComplexNote?.includes('1,209.21'));
  assert.equal(ob.geometry.actualRoofSurfaceAreaM2, null);
  assert.equal(nb.geometry.actualRoofSurfaceAreaM2, null);
});

