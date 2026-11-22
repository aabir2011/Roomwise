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
  grossFootprintAreaM2: number;
  distanceFromCampusMeters: number;
}

/**
 * Reconstructs the DAV Model School, IIT Kharagpur campus layout directly from the
 * annotated top-down visual reference images, anchored to canonical coordinates (22.3121, 87.2994).
 *
 * Spatial frame (meters relative to DAV Model School pin at origin 0, 0):
 * - G+3 Block: Northwest multi-storey notched academic block near Gate 1 & Western Road.
 * - MPH: Separate ground-floor rectangular hall extension positioned directly south of G+3 Block.
 * - Pre-Primary Block (PP): Single-storey L-shaped ground-floor block south of MPH along the Gate 2 driveway.
 * - Old Building (OB): Diagonal NW-SE linear academic block northeast of the central pin.
 * - New Building (NB): Central-west angled courtyard academic complex around the central pin.
 * - Football Ground: Elongated southern sports field south of the internal school-bus driveway.
 * - Basketball Court (BB): Paved court directly east of the Football Ground.
 * - Red-marked eastern zone is strictly excluded (zero campus structures or features placed there).
 */
export function buildReconstructedCampusStructures(
  campusRef: GeoPoint
): ReconstructedCampusStructure[] {
  // 1. G+3 Block (Northwest multi-storey L/notched academic block, tilted +8° matching perimeter roads)
  const g3BaseLocal: Array<[number, number]> = [
    [-64, 36], // SW corner overlooking MPH extension
    [-44, 36], // S step inward
    [-44, 46], // Inner courtyard notch corner
    [-33, 46], // SE tip of upper wing
    [-33, 66], // NE corner near Northern Road / Gate 1
    [-64, 66], // NW corner near Western/Northern Road junction
  ].map(([x, y]) => rotatePt(x, y, -50, 51, 8));

  // 2. MPH (Multipurpose Hall — Compact Attached Extension immediately south of G+3 Block)
  // Compact footprint (~12m E-W × 12.5m N-S, aligned flush with G+3 Block's +8° axis)
  // rising to 2nd-floor level (~8.2m), with a clear open space separating it from PP to the south.
  const mphBaseLocal: Array<[number, number]> = [
    [-63, 23.5], // SW corner of compact MPH extension
    [-51, 23.5], // SE corner of compact MPH extension
    [-51, 36.0], // NE corner flush against G+3 Block south facade
    [-63, 36.0], // NW corner flush against G+3 Block south facade
  ].map(([x, y]) => rotatePt(x, y, -50, 51, 8));

  // 3. PP — Pre-Primary Block (Distinct L-shaped single-storey ground-level block south of MPH,
  // separated from MPH by a clear ~13.5m open space/walkway and positioned north of Gate 2 driveway)
  const ppBaseLocal: Array<[number, number]> = [
    [-63, -24], // SW corner above Gate 2 / Internal Campus Driveway
    [-39, -24], // SE corner of eastward classroom wing along driveway
    [-39, -14], // NE corner of eastward wing
    [-51, -14], // Inner L-corner nook
    [-51, 10],  // NE corner of vertical western wing (clearly separated from MPH)
    [-63, 10],  // NW corner of vertical western wing
  ].map(([x, y]) => rotatePt(x, y, -50, 51, 8));

  // 4. Old Building (OB) — Exact NW–SE diagonal linear wing traced from top-down vector outline,
  // including its distinctive subtle NE recess step near the southeastern end-cap
  const obLocal: Array<[number, number]> = [
    [-2.2, 34.9],  // NW-W corner
    [6.8, 40.8],   // NW-E corner
    [29.0, 18.6],  // NE edge before SE step-in
    [27.8, 17.5],  // NE subtle step-in corner
    [33.1, 12.0],  // SE-NE corner
    [24.9, 5.7],   // SE-SW corner
  ];

  // 5. New Building (NB) — Exact C/U-shaped angled courtyard complex traced from top-down vector outline,
  // wrapping the shaded central courtyard with North-Central, West, Southwest & Southeast wings
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
  ];

  // 6. Football Ground — Large southern field south of the internal school-bus road
  const footballLocal = buildRotatedRectPoints(3, -57, 114, 42, 7);

  // 7. Basketball Court (BB) — Paved court immediately east of the Football Ground
  const basketballLocal = buildRotatedRectPoints(76, -47, 19, 33, 8);

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
        'Primary 4-storey academic block (G+3) in the northwest campus corner, paired with the compact Multipurpose Hall (MPH) extension on its southern flank.',
      linkedRoomwiseBuilding: 'G+3 Block',
      defaultRoofType: 'flat (concrete)',
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
        source: 'campus_image_reconstruction',
      },
      localPts: g3BaseLocal,
    },
    {
      id: 'campus/mph',
      name: 'MPH',
      shortLabel: 'MPH (2F Ht)',
      campusLabel: 'Multipurpose Hall — Compact Extension of G+3 (2nd-Floor Level Height)',
      featureKind: 'connected_wing',
      solarEligible: true,
      buildingType: 'school_hall',
      levels: 2,
      heightMeters: 8.2,
      parentBuildingId: 'campus/g3-block',
      relationshipNote:
        'Compact Multipurpose Hall attached to the southern flank of G+3 Block and rising to 2nd-floor level (~8.2 m), separated from Pre-Primary Block (PP) by a clear open space.',
      linkedRoomwiseBuilding: 'Multipurpose Hall',
      defaultRoofType: 'flat (2nd-floor level hall roof)',
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
        source: 'campus_image_reconstruction',
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
        'Single-storey L-shaped Pre-Primary Block positioned south of MPH with a clear open space between them, immediately north of the Internal Campus Driveway near Gate 2.',
      linkedRoomwiseBuilding: 'Pre-Primary Block',
      defaultRoofType: 'flat (concrete / terrace)',
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
        source: 'campus_image_reconstruction',
      },
      localPts: ppBaseLocal,
    },
    {
      id: 'campus/old-building',
      name: 'Old Building (OB)',
      shortLabel: 'Old Building (OB)',
      campusLabel: 'Central-North Diagonal Academic Wing (OB)',
      featureKind: 'academic_building',
      solarEligible: true,
      buildingType: 'school',
      levels: 3,
      heightMeters: 10.6,
      parentBuildingId: null,
      relationshipNote:
        'Elongated NW–SE diagonal academic block connected directly to New Building (NB) via the covered central connecting corridor.',
      linkedRoomwiseBuilding: 'Old Building',
      defaultRoofType: 'flat (concrete)',
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
        source: 'campus_image_reconstruction',
      },
      localPts: obLocal,
    },
    {
      id: 'campus/new-building',
      name: 'New Building (NB)',
      shortLabel: 'New Building (NB)',
      campusLabel: 'Central Multi-Wing Courtyard Complex (NB)',
      featureKind: 'academic_building',
      solarEligible: true,
      buildingType: 'school',
      levels: 3,
      heightMeters: 11.4,
      parentBuildingId: null,
      relationshipNote:
        'Central multi-segment C-shaped courtyard complex wrapping the shaded courtyard tree and linked directly to Old Building (OB) via a covered connecting corridor.',
      linkedRoomwiseBuilding: 'New Building',
      defaultRoofType: 'flat (concrete)',
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
        source: 'campus_image_reconstruction',
      },
      localPts: nbLocal,
    },
    {
      id: 'campus/basketball-court',
      name: 'Basketball Court (BB)',
      shortLabel: 'Basketball Court (BB)',
      campusLabel: 'Southeast Outdoor Sports Court',
      featureKind: 'sports_ground',
      solarEligible: false,
      buildingType: 'sports_court',
      levels: null,
      heightMeters: null,
      parentBuildingId: null,
      relationshipNote:
        'Outdoor basketball court adjacent to the eastern edge of the Football Ground. Represented as a non-roof campus sports facility.',
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
        source: 'campus_image_reconstruction',
      },
      localPts: basketballLocal,
    },
    {
      id: 'campus/football-ground',
      name: 'Football Ground',
      shortLabel: 'Football Ground',
      campusLabel: 'Main Southern Sports Field',
      featureKind: 'sports_ground',
      solarEligible: false,
      buildingType: 'sports_field',
      levels: null,
      heightMeters: null,
      parentBuildingId: null,
      relationshipNote:
        'Primary open-air football and assembly field south of the internal campus driveway. Represented as a non-roof campus ground.',
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
        source: 'campus_image_reconstruction',
      },
      localPts: footballLocal,
    },
  ];

  return defs.map((d) => {
    const polygons = [buildClosedGeoPolygon(d.localPts, campusRef)];
    const { areaM2 } = computePolygonsAreaM2(polygons);
    const centroid = computePolygonsCentroid(polygons);
    const distanceFromCampusMeters = Math.round(haversineDistanceMeters(campusRef, centroid));
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
      grossFootprintAreaM2: areaM2,
      distanceFromCampusMeters,
    };
  });
}

/**
 * Builds the campus boundary parcel (explicitly excluding the red-marked eastern area),
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
    [94, -14],
    [96, -70],
    [-60, -86],
    [-70, -34],
  ];

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
        [108, -16],
      ]),
    },
    {
      id: 'road-south',
      label: 'Southern Perimeter Road',
      kind: 'perimeter_road',
      widthMeters: 6.5,
      points: toGeo([
        [-64, -94],
        [15, -85],
        [114, -69],
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
      widthMeters: 5.8,
      points: toGeo([
        [9.2, 7.8],
        [13.4, 11.2],
        [17.8, 14.8],
      ]),
    },
    {
      id: 'path-mph-pp-gap',
      label: 'MPH–PP Open Space Walkway',
      kind: 'pathway',
      widthMeters: 3.0,
      points: toGeo([
        [-70, 14],
        [-54, 15.5],
        [-36, 15.5],
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
    [-4.5, -1.5, 5.0], // Signature central NB courtyard shade tree
    [38, 2, 6.0],
    [40, -10, 5.8],
    [22, 56, 6.8],
    [36, 46, 6.2],
    [-42, -82, 6.4],
    [-16, -81, 6.6],
    [16, -79, 6.8],
    [45, -75, 6.4],
    [60, -72, 5.6],
  ];

  const trees: CampusVisualOverlay['trees'] = treeCoords.map(([e, n, r], idx) => ({
    id: `tree-${idx + 1}`,
    center: metersOffsetToGeoPoint(e, n, campusRef),
    radiusMeters: r,
  }));

  return {
    sourceLabel: 'Image-reconstructed campus layout',
    referenceNote:
      'Campus footprint reconstructed from top-down aerial reference of DAV Model School, IIT Kharagpur (including G+3 Block, MPH extension, Pre-Primary Block, Old Building, New Building, Football Ground, and Basketball Court), anchored to configured campus coordinates (22.3121°N, 87.2994°E).',
    campusParcel: buildClosedGeoPolygon(parcelLocal, campusRef),
    roads,
    gates,
    trees,
  };
}
