/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BuildingPolygon,
  CampusFeatureKind,
  CampusVisualOverlay,
  GeoPoint,
} from '../src/types/solar.ts';
import {
  getCampusMeasurementById,
  type AuthoritativeCampusFeatureRecord,
} from '../src/data/campusBuildingMeasurements.ts';
import {
  computePolygonsAreaM2,
  computePolygonsCentroid,
  haversineDistanceMeters,
} from './overpassService.ts';

// WGS84 ellipsoid constants for inverse tangent-plane metric -> geographic projection
const WGS84_A = 6378137.0;
const WGS84_E2 = 0.006694379990141316;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Converts local metric offsets (eastMeters, northMeters) relative to the canonical
 * campus anchor coordinate (22.3121°N, 87.2994°E) into WGS84 GeoPoints.
 */
export function metersOffsetToGeoPoint(
  eastMeters: number,
  northMeters: number,
  ref: GeoPoint
): GeoPoint {
  const phi = degToRad(ref.lat);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const primeVertical = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const meridional =
    (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sinPhi * sinPhi, 1.5);

  const dLonDeg = (eastMeters / (primeVertical * cosPhi)) * (180 / Math.PI);
  const dLatDeg = (northMeters / meridional) * (180 / Math.PI);

  return {
    lat: Number((ref.lat + dLatDeg).toFixed(6)),
    lon: Number((ref.lon + dLonDeg).toFixed(6)),
  };
}

/**
 * Shifts an entire BuildingPolygon array by a metric offset (East/North meters).
 */
export function shiftPolygonsByMeters(
  polygons: BuildingPolygon[],
  eastMeters: number,
  northMeters: number,
  ref: GeoPoint
): BuildingPolygon[] {
  if (Math.abs(eastMeters) < 0.01 && Math.abs(northMeters) < 0.01) return polygons;
  const phi = degToRad(ref.lat);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const primeVertical = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const meridional =
    (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sinPhi * sinPhi, 1.5);

  const dLonDeg = (eastMeters / (primeVertical * cosPhi)) * (180 / Math.PI);
  const dLatDeg = (northMeters / meridional) * (180 / Math.PI);

  const shiftRing = (ring: GeoPoint[]) =>
    ring.map((p) => ({
      lat: Number((p.lat + dLatDeg).toFixed(6)),
      lon: Number((p.lon + dLonDeg).toFixed(6)),
    }));

  return polygons.map((poly) => ({
    outer: shiftRing(poly.outer),
    holes: poly.holes ? poly.holes.map(shiftRing) : undefined,
  }));
}

/**
 * Rotates a local [east, north] point around (cx, cy) by angleDeg (counterclockwise positive).
 */
function rotatePt(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angleDeg: number
): [number, number] {
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function scalePtAround(
  x: number,
  y: number,
  cx: number,
  cy: number,
  factor: number
): [number, number] {
  return [cx + (x - cx) * factor, cy + (y - cy) * factor];
}

function buildClosedGeoPolygon(
  localPts: Array<[number, number]>,
  ref: GeoPoint
): BuildingPolygon {
  const geo = localPts.map(([e, n]) => metersOffsetToGeoPoint(e, n, ref));
  if (geo.length > 0) {
    geo.push({ ...geo[0] });
  }
  return { outer: geo };
}

function buildRotatedRectPoints(
  cx: number,
  cy: number,
  widthM: number,
  heightM: number,
  angleDeg: number
): Array<[number, number]> {
  const hw = widthM / 2;
  const hh = heightM / 2;
  const corners: Array<[number, number]> = [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ];
  return corners.map(([x, y]) => rotatePt(x, y, cx, cy, angleDeg));
}

export interface ReconstructedCampusStructure {
  id: string;
  name: string;
  shortLabel: string;
  campusLabel: string;
  featureKind: CampusFeatureKind;
  solarEligible: boolean;
  buildingType: string;
  levels: number | null;
  heightMeters: number | null;
  parentBuildingId: string | null;
  relationshipNote: string | null;
  linkedRoomwiseBuilding: string | null;
  defaultRoofType: string;
  defaultTiltDegrees: number;
  defaultAspectDegrees: number;
  visualMeta: {
    roofColor: string;
    wallColor: string;
    orientationDeg: number;
    courtKind?: 'basketball' | 'football';
    roofDetailKind?: 'g3_notched' | 'mph_hall' | 'pp_l_wing' | 'ob_linear' | 'nb_courtyard' | 'generic';
  };
  tags: Record<string, string>;
  polygons: BuildingPolygon[];
  centroid: GeoPoint;
  /** Authoritative horizontal footprint area (m²) from supplied Google Maps Measure Distance dataset */
  grossFootprintAreaM2: number;
  /** Polygon-recalculated horizontal area (m²) retained for geometric consistency auditing */
  polygonCalculatedAreaM2: number;
  /** Linked authoritative geometric measurement record (single source of truth) */
  measurementRecord: AuthoritativeCampusFeatureRecord | null;
  distanceFromCampusMeters: number;
}

// Uniform scaling factor calibrating the traced OB + NB vector outlines to the exact
// supplied Google Maps Measure Distance combined complex area (1,209.21 m² vs prior 1,752.45 m²).
const OB_NB_COMPLEX_SCALE = Math.sqrt(1209.21 / 1752.45);
const OB_NB_SCALE_PIVOT: [number, number] = [2.0, 2.0];

/**
 * Reconstructs the DAV Model School, IIT Kharagpur campus layout calibrated directly to
 * the user-supplied Google Maps Measure Distance polygon measurements, anchored to
 * canonical coordinates (22.3121°N, 87.2994°E).
 *
 * Authoritative supplied areas (total academic buildings = 2,366.80 m²):
 * - G+3 Block: 601.55 m² (perimeter 133.98 m) — NW multi-storey notched academic block.
 * - MPH: 168.51 m² (perimeter 52.27 m) — outward ground-floor extension flush on G+3 south flank.
 * - Pre-Primary Block (PP): 387.53 m² (perimeter 105.86 m) — single-storey L-wing south of MPH.
 * - Old Building (OB) + New Building (NB) Connected Complex: 1,209.21 m² combined (perimeter 285.74 m),
 *   proportionally apportioned as OB = 298.46 m² and NB = 910.75 m² (sum === 1,209.21 m²).
 * - Football Ground (non-building, non-solar): 5,300.83 m² (perimeter 344.17 m).
 * - Basketball Court (non-building, non-solar): 737.14 m² (perimeter 113.93 m).
 * - Eastern residential zone is strictly excluded.
 */
export function buildReconstructedCampusStructures(
  campusRef: GeoPoint
): ReconstructedCampusStructure[] {
  // 1. G+3 Block — Calibrated to supplied 601.55 m² (notched NW academic block, +8° campus axis)
  // Includes the NW corner step-in and SE courtyard notch visible in the supplied satellite trace.
  const g3BaseLocal: Array<[number, number]> = [
    [-63.0, 36.0],   // SW corner meeting MPH flush along south facade
    [-48.8, 36.0],   // South facade east termination
    [-48.8, 50.0],   // Inner SE courtyard notch corner
    [-37.71, 50.0],  // SE tip of upper wing
    [-37.71, 66.5],  // NE corner near Northern Road / Gate 1
    [-59.2, 66.5],   // North edge before NW step-in
    [-59.2, 62.7],   // NW subtle corner recess
    [-63.0, 62.7],   // West facade north termination
  ].map(([x, y]) => rotatePt(x, y, -50, 51, 8));

  // 2. MPH (Multipurpose Hall — Outward Attached Extension immediately south of G+3 Block)
  // Calibrated to supplied 168.51 m² & 52.27 m perimeter (11.57 m E–W × 14.57 m N–S, +8° axis)
  // flush against G+3's southern wall at y = 36.0, with a clear open gap separating it from PP.
  const mphBaseLocal: Array<[number, number]> = [
    [-63.0, 21.43],  // SW corner of MPH extension
    [-51.43, 21.43], // SE corner of MPH extension
    [-51.43, 36.0],  // NE corner flush against G+3 Block south facade
    [-63.0, 36.0],   // NW corner flush against G+3 Block south facade
  ].map(([x, y]) => rotatePt(x, y, -50, 51, 8));

  // 3. PP — Pre-Primary Block (Distinct single-storey L-wing south of MPH)
  // Calibrated to supplied 387.53 m² & 105.86 m perimeter (24.40 m S × 28.53 m W, wing widths 8.95 m / 8.58 m),
  // separated from MPH by a clear ~14.9 m open landscaped walkway above Gate 2 driveway.
  const ppBaseLocal: Array<[number, number]> = [
    [-63.0, -22.03],  // SW corner above Gate 2 / Internal Campus Driveway
    [-38.6, -22.03],  // SE corner of eastward classroom wing
    [-38.6, -13.45],  // NE corner of eastward wing
    [-54.05, -13.45], // Inner L-corner nook
    [-54.05, 6.5],    // NE corner of vertical western wing (clearly separated from MPH)
    [-63.0, 6.5],     // NW corner of vertical western wing
  ].map(([x, y]) => rotatePt(x, y, -50, 51, 8));

  // 4. Old Building (OB) — NW–SE diagonal linear wing traced from top-down Google Maps outline,
  // uniformly scaled with NB to match the exact supplied combined OB+NB area (1,209.21 m²).
  const obLocal: Array<[number, number]> = [
    [-2.2, 34.9],  // NW-W corner
    [6.8, 40.8],   // NW-E corner
    [29.0, 18.6],  // NE edge before SE step-in
    [27.8, 17.5],  // NE subtle step-in corner
    [33.1, 12.0],  // SE-NE corner
    [24.9, 5.7],   // SE-SW corner
  ].map(([x, y]) => scalePtAround(x, y, OB_NB_SCALE_PIVOT[0], OB_NB_SCALE_PIVOT[1], OB_NB_COMPLEX_SCALE));

  // 5. New Building (NB) — C-shaped angled courtyard complex traced from Google Maps outline,
  // uniformly scaled with OB to match the exact supplied combined OB+NB area (1,209.21 m²).
  const nbLocal: Array<[number, number]> = [
    [-14.5, 25.0], // NW apex
    [-26.3, -2.1], // Westernmost sharp elbow
    [-9.5, -26.8], // Southernmost sharp apex above internal driveway
    [4.8, -16.5],  // South-central inner bend (west)
    [6.9, -15.8],  // South-central inner bend (east)
    [26.6, -25.0], // SE wing outer south-east corner
    [32.3, -11.7], // SE wing outer north-east corner
    [22.5, -7.2],  // SE wing subtle north step-out
    [22.0, -8.4],  // SE wing inner step-in
    [6.1, 0.5],    // Inner courtyard south-east apex
    [-7.5, -9.1],  // Inner courtyard south-west pocket
    [-13.2, -1.7], // Inner courtyard west elbow
    [-12.8, 2.8],  // Inner courtyard west-north bend
    [-10.4, 10.2], // Inner courtyard north-west corner
    [2.8, 2.8],    // North-Central Arm inner south knuckle
    [8.2, 2.5],    // North-Central Arm connector landing (south)
    [11.2, 5.2],   // North-Central Arm eastern knuckle (meets OB–NB connecting path)
    [9.3, 12.2],   // North-Central Arm north-east shoulder (meets OB–NB connecting path)
    [6.2, 11.4],   // Shallow recess beneath campus pin
    [2.8, 17.2],   // North-Central Arm north shoulder
  ].map(([x, y]) => scalePtAround(x, y, OB_NB_SCALE_PIVOT[0], OB_NB_SCALE_PIVOT[1], OB_NB_COMPLEX_SCALE));

  // 6. Football Ground — Calibrated to supplied 5,300.83 m² & 344.17 m perimeter (131.90 m × 40.19 m, +7°)
  const footballLocal = buildRotatedRectPoints(3.5, -57.5, 131.9, 40.19, 7);

  // 7. Basketball Court (BB) — Calibrated to supplied 737.14 m² & 113.93 m perimeter (19.87 m × 37.09 m, +8°)
  const basketballLocal = buildRotatedRectPoints(83.5, -47.0, 19.87, 37.09, 8);

  const defs: Array<{
    id: string;
    name: string;
    shortLabel: string;
    campusLabel: string;
    featureKind: CampusFeatureKind;
    solarEligible: boolean;
    buildingType: string;
    levels: number | null;
    heightMeters: number | null;
    parentBuildingId: string | null;
    relationshipNote: string | null;
    linkedRoomwiseBuilding: string | null;
    defaultRoofType: string;
    defaultTiltDegrees: number;
    defaultAspectDegrees: number;
    visualMeta: ReconstructedCampusStructure['visualMeta'];
    tags: Record<string, string>;
    localPts: Array<[number, number]>;
  }> = [
    {
      id: 'campus/g3-block',
      name: 'G+3 Block',
      shortLabel: 'G+3 Block',
      campusLabel: 'Northwest Multi-Storey Academic Block (Ground + 3 Floors)',
      featureKind: 'academic_building',
      solarEligible: true,
      buildingType: 'school',
      levels: 4,
      heightMeters: 14.5,
      parentBuildingId: null,
      relationshipNote:
        'Primary 4-storey academic block (G+3) in the northwest campus corner (supplied footprint 601.55 m², perimeter 133.98 m), paired with the outward Multipurpose Hall (MPH) extension on its southern flank.',
      linkedRoomwiseBuilding: 'G+3 Block',
      defaultRoofType: 'flat (concrete — provisional plan area)',
      defaultTiltDegrees: 10,
      defaultAspectDegrees: 0,
      visualMeta: {
        roofColor: '#cfd5d1',
        wallColor: '#e3d8c3',
        orientationDeg: 8,
        roofDetailKind: 'g3_notched',
      },
      tags: {
        building: 'school',
        'building:levels': '4',
        'roof:shape': 'flat',
        source: 'supplied_google_maps_measure_distance',
      },
      localPts: g3BaseLocal,
    },
    {
      id: 'campus/mph',
      name: 'MPH',
      shortLabel: 'MPH (2F Ht)',
      campusLabel: 'Multipurpose Hall — Outward Ground-Floor Extension of G+3',
      featureKind: 'connected_wing',
      solarEligible: true,
      buildingType: 'school_hall',
      levels: 2,
      heightMeters: 8.2,
      parentBuildingId: 'campus/g3-block',
      relationshipNote:
        'Outward Multipurpose Hall attached to the southern flank of G+3 Block (supplied footprint 168.51 m², perimeter 52.27 m), separated from Pre-Primary Block (PP) by a clear open space.',
      linkedRoomwiseBuilding: 'Multipurpose Hall',
      defaultRoofType: 'flat (hall roof — provisional plan area)',
      defaultTiltDegrees: 10,
      defaultAspectDegrees: 0,
      visualMeta: {
        roofColor: '#d9d4c7',
        wallColor: '#ddd0b7',
        orientationDeg: 8,
        roofDetailKind: 'mph_hall',
      },
      tags: {
        building: 'school',
        'building:part': 'hall',
        'building:levels': '2',
        'roof:shape': 'flat',
        source: 'supplied_google_maps_measure_distance',
      },
      localPts: mphBaseLocal,
    },
    {
      id: 'campus/pre-primary-block',
      name: 'Pre-Primary Block (PP)',
      shortLabel: 'Pre-Primary (PP)',
      campusLabel: 'Southwest L-Shaped Ground-Floor Pre-Primary Wing (PP)',
      featureKind: 'academic_building',
      solarEligible: true,
      buildingType: 'kindergarten',
      levels: 1,
      heightMeters: 4.4,
      parentBuildingId: null,
      relationshipNote:
        'Single-storey L-shaped Pre-Primary Block (supplied footprint 387.53 m², perimeter 105.86 m) positioned south of MPH with a clear open space between them, immediately north of the Internal Campus Driveway near Gate 2.',
      linkedRoomwiseBuilding: 'Pre-Primary Block',
      defaultRoofType: 'flat (concrete / terrace — provisional plan area)',
      defaultTiltDegrees: 10,
      defaultAspectDegrees: 0,
      visualMeta: {
        roofColor: '#d4c3b6',
        wallColor: '#dfcfc0',
        orientationDeg: 8,
        roofDetailKind: 'pp_l_wing',
      },
      tags: {
        building: 'school',
        'building:levels': '1',
        'roof:shape': 'flat',
        source: 'supplied_google_maps_measure_distance',
      },
      localPts: ppBaseLocal,
    },
    {
      id: 'campus/old-building',
      name: 'Old Building (OB)',
      shortLabel: 'Old Building (OB)',
      campusLabel: 'Central-North Diagonal Academic Wing (OB — Part of OB+NB Complex)',
      featureKind: 'academic_building',
      solarEligible: true,
      buildingType: 'school',
      levels: 3,
      heightMeters: 10.6,
      parentBuildingId: null,
      relationshipNote:
        'Elongated NW–SE diagonal academic block connected directly to New Building (NB) via the covered central connecting corridor. Measured jointly with NB as one 1,209.21 m² complex (perimeter 285.74 m); 298.46 m² allocated proportionally to OB.',
      linkedRoomwiseBuilding: 'Old Building',
      defaultRoofType: 'flat (concrete — provisional plan area)',
      defaultTiltDegrees: 10,
      defaultAspectDegrees: 0,
      visualMeta: {
        roofColor: '#c9cfd1',
        wallColor: '#d6d4cc',
        orientationDeg: -44,
        roofDetailKind: 'ob_linear',
      },
      tags: {
        building: 'school',
        'building:levels': '3',
        'roof:shape': 'flat',
        source: 'supplied_google_maps_measure_distance_combined_complex',
      },
      localPts: obLocal,
    },
    {
      id: 'campus/new-building',
      name: 'New Building (NB)',
      shortLabel: 'New Building (NB)',
      campusLabel: 'Central Multi-Wing Courtyard Complex (NB — Part of OB+NB Complex)',
      featureKind: 'academic_building',
      solarEligible: true,
      buildingType: 'school',
      levels: 3,
      heightMeters: 11.4,
      parentBuildingId: null,
      relationshipNote:
        'Central C-shaped courtyard complex wrapping the shaded courtyard tree and linked directly to Old Building (OB) via a covered connecting corridor. Measured jointly with OB as one 1,209.21 m² complex (perimeter 285.74 m); 910.75 m² allocated proportionally to NB.',
      linkedRoomwiseBuilding: 'New Building',
      defaultRoofType: 'flat (concrete — provisional plan area)',
      defaultTiltDegrees: 10,
      defaultAspectDegrees: 0,
      visualMeta: {
        roofColor: '#c6cdd0',
        wallColor: '#dad8d0',
        orientationDeg: -26,
        roofDetailKind: 'nb_courtyard',
      },
      tags: {
        building: 'school',
        'building:levels': '3',
        'roof:shape': 'flat',
        source: 'supplied_google_maps_measure_distance_combined_complex',
      },
      localPts: nbLocal,
    },
    {
      id: 'campus/basketball-court',
      name: 'Basketball Court (BB)',
      shortLabel: 'Basketball Court (BB)',
      campusLabel: 'Southeast Outdoor Sports Court (Non-Building)',
      featureKind: 'sports_ground',
      solarEligible: false,
      buildingType: 'sports_court',
      levels: null,
      heightMeters: null,
      parentBuildingId: null,
      relationshipNote:
        'Outdoor basketball court adjacent to the eastern edge of the Football Ground (supplied area 737.14 m², perimeter 113.93 m). Excluded from building footprint and rooftop PV totals.',
      linkedRoomwiseBuilding: null,
      defaultRoofType: 'open sports court (non-roof)',
      defaultTiltDegrees: 0,
      defaultAspectDegrees: 0,
      visualMeta: {
        roofColor: '#4c657d',
        wallColor: '#9b5852',
        orientationDeg: 8,
        courtKind: 'basketball',
      },
      tags: {
        leisure: 'pitch',
        sport: 'basketball',
        source: 'supplied_google_maps_measure_distance',
      },
      localPts: basketballLocal,
    },
    {
      id: 'campus/football-ground',
      name: 'Football Ground',
      shortLabel: 'Football Ground',
      campusLabel: 'Main Southern Sports Field (Non-Building)',
      featureKind: 'sports_ground',
      solarEligible: false,
      buildingType: 'sports_field',
      levels: null,
      heightMeters: null,
      parentBuildingId: null,
      relationshipNote:
        'Primary open-air football and assembly field south of the internal campus driveway (supplied area 5,300.83 m², perimeter 344.17 m). Excluded from building footprint and rooftop PV totals.',
      linkedRoomwiseBuilding: null,
      defaultRoofType: 'open playing field (non-roof)',
      defaultTiltDegrees: 0,
      defaultAspectDegrees: 0,
      visualMeta: {
        roofColor: '#b8a982',
        wallColor: '#7c946e',
        orientationDeg: 7,
        courtKind: 'football',
      },
      tags: {
        leisure: 'pitch',
        sport: 'soccer',
        source: 'supplied_google_maps_measure_distance',
      },
      localPts: footballLocal,
    },
  ];

  return defs.map((d) => {
    const polygons = [buildClosedGeoPolygon(d.localPts, campusRef)];
    const { areaM2: polygonCalculatedAreaM2 } = computePolygonsAreaM2(polygons);
    const centroid = computePolygonsCentroid(polygons);
    const distanceFromCampusMeters = Math.round(haversineDistanceMeters(campusRef, centroid));
    const measurementRecord = getCampusMeasurementById(d.id) ?? null;

    // Never silently overwrite authoritative supplied footprint area with recalculated polygon area.
    const authoritativeAreaM2 = measurementRecord
      ? measurementRecord.authoritativeFootprintAreaM2
      : polygonCalculatedAreaM2;

    return {
      id: d.id,
      name: d.name,
      shortLabel: d.shortLabel,
      campusLabel: d.campusLabel,
      featureKind: d.featureKind,
      solarEligible: d.solarEligible,
      buildingType: d.buildingType,
      levels: d.levels,
      heightMeters: d.heightMeters,
      parentBuildingId: d.parentBuildingId,
      relationshipNote: d.relationshipNote,
      linkedRoomwiseBuilding: d.linkedRoomwiseBuilding,
      defaultRoofType: d.defaultRoofType,
      defaultTiltDegrees: d.defaultTiltDegrees,
      defaultAspectDegrees: d.defaultAspectDegrees,
      visualMeta: d.visualMeta,
      tags: d.tags,
      polygons,
      centroid,
      grossFootprintAreaM2: authoritativeAreaM2,
      polygonCalculatedAreaM2,
      measurementRecord,
      distanceFromCampusMeters,
    };
  });
}

/**
 * Builds the campus boundary parcel (explicitly excluding the eastern residential area),
 * perimeter & internal roads, OB-NB connecting corridor, Gate 1 & Gate 2 markers, and restrained trees.
 */
export function buildReconstructedCampusOverlay(campusRef: GeoPoint): CampusVisualOverlay {
  const toGeo = (pts: Array<[number, number]>) =>
    pts.map(([e, n]) => metersOffsetToGeoPoint(e, n, campusRef));

  const parcelLocal: Array<[number, number]> = [
    [-76, 68],
    [42, 74],
    [48, 22],
    [52, -16],
    [100, -14],
    [102, -72],
    [-64, -88],
    [-70, -34],
  ];

  const obNbPathLocal: Array<[number, number]> = (
    [
      [9.2, 7.8],
      [13.4, 11.2],
      [17.8, 14.8],
    ] as Array<[number, number]>
  ).map(([x, y]) => scalePtAround(x, y, OB_NB_SCALE_PIVOT[0], OB_NB_SCALE_PIVOT[1], OB_NB_COMPLEX_SCALE));

  const roads: CampusVisualOverlay['roads'] = [
    {
      id: 'road-north',
      label: 'Northern Campus Road',
      kind: 'perimeter_road',
      widthMeters: 7.5,
      points: toGeo([
        [-112, 66],
        [-50, 72],
        [15, 76],
        [82, 79],
        [124, 52],
      ]),
    },
    {
      id: 'road-west',
      label: 'Western Perimeter Road',
      kind: 'perimeter_road',
      widthMeters: 7.5,
      points: toGeo([
        [-84, 88],
        [-75, 20],
        [-68, -37],
        [-60, -96],
      ]),
    },
    {
      id: 'road-internal',
      label: 'Internal Campus Driveway',
      kind: 'internal_road',
      widthMeters: 6.2,
      points: toGeo([
        [-96, -43],
        [-68, -37],
        [-10, -31.5],
        [52, -23.5],
        [112, -16],
      ]),
    },
    {
      id: 'road-south',
      label: 'Southern Perimeter Road',
      kind: 'perimeter_road',
      widthMeters: 6.5,
      points: toGeo([
        [-66, -94],
        [15, -85],
        [118, -69],
      ]),
    },
    {
      id: 'path-gate1-plaza',
      kind: 'pathway',
      widthMeters: 3.0,
      points: toGeo([
        [-12, 73],
        [-18, 48],
        [-34, 30],
        [-36, 12],
        [-29, -31],
      ]),
    },
    {
      id: 'path-ob-nb-connector',
      label: 'OB–NB Connecting Corridor',
      kind: 'pathway',
      widthMeters: 4.8,
      points: toGeo(obNbPathLocal),
    },
    {
      id: 'path-mph-pp-gap',
      label: 'MPH–PP Open Space Walkway',
      kind: 'pathway',
      widthMeters: 3.0,
      points: toGeo([
        [-70, 13],
        [-54, 14.5],
        [-36, 14.5],
      ]),
    },
    {
      id: 'path-central-courtyard',
      kind: 'pathway',
      widthMeters: 2.8,
      points: toGeo([
        [-18, 48],
        [-8, 36],
        [3, 25],
      ]),
    },
  ];

  const gates: CampusVisualOverlay['gates'] = [
    {
      id: 'gate-1',
      label: 'Gate 1',
      position: metersOffsetToGeoPoint(-12, 73, campusRef),
      description: 'Main northern entrance between G+3 Block and Old Building (OB)',
    },
    {
      id: 'gate-2',
      label: 'Gate 2',
      position: metersOffsetToGeoPoint(-68, -37, campusRef),
      description: 'Western driveway entrance adjacent to Pre-Primary Block (PP) and Football Ground',
    },
  ];

  // Restrained, natural canopy clusters positioned cleanly around G+3, MPH, PP, NB & OB (zero roof overlap)
  const treeCoords: Array<[number, number, number]> = [
    [-26, 58, 6.0],
    [-25, 40, 5.6],
    [-38, 22, 5.4],  // Foliage pocket between MPH and NB
    [-36, 2, 5.2],   // Open nook between PP and NB west wing
    [-3.4, -0.9, 4.4], // Signature central NB courtyard shade tree
    [38, 2, 6.0],
    [40, -10, 5.8],
    [22, 56, 6.8],
    [36, 46, 6.2],
    [-42, -84, 6.4],
    [-16, -83, 6.6],
    [16, -81, 6.8],
    [45, -77, 6.4],
    [60, -74, 5.6],
  ];

  const trees: CampusVisualOverlay['trees'] = treeCoords.map(([e, n, r], idx) => ({
    id: `tree-${idx + 1}`,
    center: metersOffsetToGeoPoint(e, n, campusRef),
    radiusMeters: r,
  }));

  return {
    sourceLabel: 'Supplied Google Maps footprint geometry',
    referenceNote:
      'Horizontal building footprints calibrated to supplied Google Maps Measure Distance measurements (2,366.80 m² total academic building footprint across G+3 Block, MPH extension, Pre-Primary Block, Old Building & New Building; Football Ground 5,300.83 m² and Basketball Court 737.14 m² excluded from building and solar totals), anchored to 22.3121°N, 87.2994°E.',
    campusParcel: buildClosedGeoPolygon(parcelLocal, campusRef),
    roads,
    gates,
    trees,
  };
}
