/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BuildingName, Floor } from '../../types/energy';
import type {
  ArchitecturalConnectorSpec,
  BuildingSchemaSpec,
  CameraPresetId,
  CampusLandmarkLabelSpec,
  FloorPlateSpec,
  RoomGeometrySpec,
} from './types';

/**
 * =============================================================================
 * DAV MODEL SCHOOL, IIT KHARAGPUR — 1:1 ARCHITECTURAL CAMPUS SCHEMA
 * =============================================================================
 * Coordinate convention:
 *   +X = East, -X = West, -Z = North, +Z = South, +Y = Up
 *   Architectural scale: 1 scene unit ≈ 2.65 meters horizontally.
 *
 * Every building defines a single unified non-self-intersecting 2D polygon
 * (`footprintPts`) so plinths, floor slabs, exterior facade bands, and roofs
 * extrude as watertight architectural shells with zero wing overlap or Z-fighting.
 *
 * Spatial faithfully matches the top-down satellite & Google Maps vector outline:
 *   - G+3 Block (NW): 4-storey notched academic block near Gate 1 & Western Road.
 *   - MPH (West-Mid): Compact hall attached to G+3 Block's southern flank, rising
 *     to 2nd-floor level height (~5.0 scene units), separated from PP by a clear
 *     open walkway space.
 *   - PP (SW): Single-storey L-shaped Pre-Primary Block south of MPH along the
 *     internal campus driveway near Gate 2 (NOT adjoining MPH).
 *   - OB (Central-NE): Elongated NW–SE diagonal 3-storey wing with subtle NE step-in
 *     near its SE end-cap.
 *   - NB (Center): Exact multi-segment C-shaped 3-storey courtyard complex wrapping
 *     the central courtyard shade tree, directly linked to OB via a covered
 *     OB–NB Connecting Corridor.
 *   - Football Ground & Basketball Court (BB): Proportioned aesthetically along
 *     the southern apron below the internal campus driveway.
 *   - Red-marked eastern residential zone: Strictly excluded.
 */

export const CAMPUS_SITE_WIDTH = 72;
export const CAMPUS_SITE_DEPTH = 56;

/** World-space origin of the conceptual campus feeder plinth */
export const CAMPUS_FEEDER_WORLD_POS: [number, number, number] = [-8.5, 0.35, 11.4];

/** Vertical separation added per floor index when Exploded View is active */
export const FLOOR_EXPLODE_GAP = 2.4;

export const FLOOR_ORDER: Floor[] = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];

export const BUILDING_ORDER: BuildingName[] = [
  'G+3 Block',
  'Multipurpose Hall',
  'Pre-Primary Block',
  'New Building',
  'Old Building',
];

export interface CameraViewpoint {
  position: [number, number, number];
  target: [number, number, number];
  label: string;
}

export const CAMERA_PRESETS: Record<CameraPresetId, CameraViewpoint> = {
  isometric: {
    position: [-25, 27, 36],
    target: [-2.5, 2.0, -0.5],
    label: 'Aerial',
  },
  courtyard: {
    position: [-5.0, 12.5, 21.0],
    target: [0.5, 2.8, -1.5],
    label: 'Courtyard',
  },
  top: {
    position: [-2.0, 60, 7.0],
    target: [-2.0, 0.5, 1.5],
    label: 'Top Plan',
  },
  elevation: {
    position: [-33, 6.8, 22.0],
    target: [-4.5, 3.6, -2.5],
    label: 'Ground View',
  },
};

/**
 * Physical covered connecting corridor bridging NB's North-Central Arm eastern knuckle
 * directly to OB's southwestern flank (matching the top-down vector outline).
 */
export const OB_NB_CONNECTOR_SPEC: ArchitecturalConnectorSpec = {
  id: 'ob-nb-connecting-corridor',
  label: 'OB–NB Connecting Corridor',
  startWorld: [5.9, 0.31],
  endWorld: [9.09, -2.28],
  width: 2.15,
  height: 5.1,
};

function makeRoom(
  building: BuildingName,
  floor: Floor,
  floorIndex: number,
  height: number,
  spec: {
    roomId: string;
    roomCode: string;
    localX: number;
    localZ: number;
    localRotationY?: number;
    width: number;
    depth: number;
    corridorSide: RoomGeometrySpec['corridorSide'];
    interiorStyle: RoomGeometrySpec['interiorStyle'];
  }
): RoomGeometrySpec {
  return {
    roomId: spec.roomId,
    roomCode: spec.roomCode,
    building,
    floor,
    floorIndex,
    localX: spec.localX,
    localZ: spec.localZ,
    localRotationY: spec.localRotationY ?? 0,
    width: spec.width,
    depth: spec.depth,
    height,
    corridorSide: spec.corridorSide,
    interiorStyle: spec.interiorStyle,
  };
}

// =============================================================================
// 1. G+3 BLOCK (Northwest 4-Storey Notched Academic Flagship — 9 Canonical Rooms)
// =============================================================================
const G3_FOOTPRINT: Array<[number, number]> = [
  [-5.9, 5.7],  // SW corner meeting MPH
  [1.7, 5.7],   // S step inward
  [1.7, 1.9],   // Inner courtyard notch
  [5.9, 1.9],   // SE tip of north wing
  [5.9, -5.7],  // NE corner near Gate 1
  [-5.9, -5.7], // NW corner near Western Road
];

function buildG3Floors(): FloorPlateSpec[] {
  const h = 2.35;
  return [
    {
      building: 'G+3 Block',
      floor: 'Ground Floor',
      floorIndex: 0,
      baseY: 0.28,
      storeyHeight: h,
      slabWidth: 11.8,
      slabDepth: 11.4,
      corridorSide: 'south',
      corridorDepth: 1.3,
      rooms: [
        makeRoom('G+3 Block', 'Ground Floor', 0, h, {
          roomId: 'g3-g01',
          roomCode: 'G3-G01',
          localX: 0.0,
          localZ: -2.1,
          width: 9.2,
          depth: 4.5,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
        makeRoom('G+3 Block', 'Ground Floor', 0, h, {
          roomId: 'g3-g02',
          roomCode: 'G3-G02',
          localX: -2.1,
          localZ: 3.4,
          width: 5.4,
          depth: 3.0,
          corridorSide: 'east',
          interiorStyle: 'classroom',
        }),
      ],
    },
    {
      building: 'G+3 Block',
      floor: '1st Floor',
      floorIndex: 1,
      baseY: 0.28 + h,
      storeyHeight: h,
      slabWidth: 11.8,
      slabDepth: 11.4,
      corridorSide: 'south',
      corridorDepth: 1.3,
      rooms: [
        makeRoom('G+3 Block', '1st Floor', 1, h, {
          roomId: 'g3-101',
          roomCode: 'G3-101',
          localX: 0.0,
          localZ: -2.1,
          width: 9.2,
          depth: 4.5,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
        makeRoom('G+3 Block', '1st Floor', 1, h, {
          roomId: 'g3-102',
          roomCode: 'G3-102',
          localX: -2.1,
          localZ: 3.4,
          width: 5.4,
          depth: 3.0,
          corridorSide: 'east',
          interiorStyle: 'classroom',
        }),
      ],
    },
    {
      building: 'G+3 Block',
      floor: '2nd Floor',
      floorIndex: 2,
      baseY: 0.28 + h * 2,
      storeyHeight: h,
      slabWidth: 11.8,
      slabDepth: 11.4,
      corridorSide: 'south',
      corridorDepth: 1.3,
      rooms: [
        makeRoom('G+3 Block', '2nd Floor', 2, h, {
          roomId: 'g3-201',
          roomCode: 'G3-201',
          localX: -2.4,
          localZ: -2.1,
          width: 4.4,
          depth: 4.5,
          corridorSide: 'south',
          interiorStyle: 'lab',
        }),
        makeRoom('G+3 Block', '2nd Floor', 2, h, {
          roomId: 'g3-202',
          roomCode: 'G3-202',
          localX: 2.4,
          localZ: -2.1,
          width: 4.4,
          depth: 4.5,
          corridorSide: 'south',
          interiorStyle: 'lab',
        }),
        makeRoom('G+3 Block', '2nd Floor', 2, h, {
          roomId: 'g3-203',
          roomCode: 'G3-203',
          localX: -2.1,
          localZ: 3.4,
          width: 5.4,
          depth: 3.0,
          corridorSide: 'east',
          interiorStyle: 'lab',
        }),
      ],
    },
    {
      building: 'G+3 Block',
      floor: '3rd Floor',
      floorIndex: 3,
      baseY: 0.28 + h * 3,
      storeyHeight: h,
      slabWidth: 11.8,
      slabDepth: 11.4,
      corridorSide: 'south',
      corridorDepth: 1.3,
      rooms: [
        makeRoom('G+3 Block', '3rd Floor', 3, h, {
          roomId: 'g3-301',
          roomCode: 'G3-301',
          localX: 0.0,
          localZ: -2.1,
          width: 9.2,
          depth: 4.5,
          corridorSide: 'south',
          interiorStyle: 'computer-lab',
        }),
        makeRoom('G+3 Block', '3rd Floor', 3, h, {
          roomId: 'g3-302',
          roomCode: 'G3-302',
          localX: -2.1,
          localZ: 3.4,
          width: 5.4,
          depth: 3.0,
          corridorSide: 'east',
          interiorStyle: 'staff',
        }),
      ],
    },
  ];
}

// =============================================================================
// 2. MPH — MULTI-PURPOSE HALL (Compact Extension of G+3, Height = 2nd-Floor Level)
// =============================================================================
// Compact 4.8 × 5.0 footprint attached flush to G+3's SW south wall, rising cleanly
// to G+3's 2nd-floor level (4.95 units above plinth -> roof at y ≈ 5.23), leaving a
// distinct ~4.8-unit open landscaped gap north of Pre-Primary Block (PP).
const MPH_FOOTPRINT: Array<[number, number]> = [
  [-2.4, 2.5],
  [2.4, 2.5],
  [2.4, -2.5],
  [-2.4, -2.5],
];

function buildMultipurposeHallFloors(): FloorPlateSpec[] {
  const h = 4.95; // Reaches G+3 Block's 2nd-floor elevation (double-height clear-span hall)
  return [
    {
      building: 'Multipurpose Hall',
      floor: 'Ground Floor',
      floorIndex: 0,
      baseY: 0.28,
      storeyHeight: h,
      slabWidth: 4.8,
      slabDepth: 5.0,
      corridorSide: 'east',
      corridorDepth: 0.9,
      rooms: [
        makeRoom('Multipurpose Hall', 'Ground Floor', 0, h, {
          roomId: 'mph-01',
          roomCode: 'MPH-01',
          localX: 0,
          localZ: 0,
          width: 3.7,
          depth: 3.9,
          corridorSide: 'east',
          interiorStyle: 'auditorium',
        }),
      ],
    },
  ];
}

// =============================================================================
// 3. PP — PRE-PRIMARY BLOCK (L-Shaped Single-Storey Wing, Separated South of MPH)
// =============================================================================
const PP_FOOTPRINT: Array<[number, number]> = [
  [-5.0, 6.2],  // SW corner near Gate 2
  [4.4, 6.2],   // SE corner of eastward wing
  [4.4, 2.2],   // NE corner of eastward wing
  [-0.4, 2.2],  // Inner L-nook
  [-0.4, -6.2], // NE corner of vertical wing (separated from MPH by clear gap)
  [-5.0, -6.2], // NW corner of vertical wing
];

function buildPrePrimaryFloors(): FloorPlateSpec[] {
  const h = 2.45;
  return [
    {
      building: 'Pre-Primary Block',
      floor: 'Ground Floor',
      floorIndex: 0,
      baseY: 0.28,
      storeyHeight: h,
      slabWidth: 9.4,
      slabDepth: 12.4,
      corridorSide: 'north',
      corridorDepth: 1.0,
      rooms: [
        makeRoom('Pre-Primary Block', 'Ground Floor', 0, h, {
          roomId: 'pp-01',
          roomCode: 'PP-01',
          localX: -2.7,
          localZ: -3.5,
          width: 3.4,
          depth: 4.0,
          corridorSide: 'east',
          interiorStyle: 'pre-primary',
        }),
        makeRoom('Pre-Primary Block', 'Ground Floor', 0, h, {
          roomId: 'pp-02',
          roomCode: 'PP-02',
          localX: -2.7,
          localZ: 1.6,
          width: 3.4,
          depth: 4.0,
          corridorSide: 'east',
          interiorStyle: 'pre-primary',
        }),
        makeRoom('Pre-Primary Block', 'Ground Floor', 0, h, {
          roomId: 'pp-03',
          roomCode: 'PP-03',
          localX: 2.0,
          localZ: 4.2,
          width: 3.8,
          depth: 2.9,
          corridorSide: 'north',
          interiorStyle: 'pre-primary',
        }),
      ],
    },
  ];
}

// =============================================================================
// 4. OB — OLD BUILDING (Vector-Traced NW–SE Diagonal Wing — 3 Storeys, 5 Rooms)
// =============================================================================
// Exact stepped NW–SE diagonal polygon centered at world (8.4, -5.4).
const OB_FOOTPRINT: Array<[number, number]> = [
  [-6.71, -4.31], // NW-W corner
  [-3.38, -6.5],  // NW-E corner
  [4.83, 1.72],   // NE before SE step-in
  [4.39, 2.12],   // NE subtle step-in corner
  [6.35, 4.16],   // SE-NE corner
  [3.31, 6.49],   // SE-SW corner
];

function buildOldBuildingFloors(): FloorPlateSpec[] {
  const h = 2.35;
  const obRotY = -0.827; // Aligns local +X cleanly down OB's NW->SE diagonal spine
  return [
    {
      building: 'Old Building',
      floor: 'Ground Floor',
      floorIndex: 0,
      baseY: 0.28,
      storeyHeight: h,
      slabWidth: 14.6,
      slabDepth: 4.0,
      corridorSide: 'south',
      corridorDepth: 1.0,
      rooms: [
        makeRoom('Old Building', 'Ground Floor', 0, h, {
          roomId: 'ob-g01',
          roomCode: 'OB-G01',
          localX: -2.2,
          localZ: -2.4,
          localRotationY: obRotY,
          width: 5.4,
          depth: 2.8,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
        makeRoom('Old Building', 'Ground Floor', 0, h, {
          roomId: 'ob-g02',
          roomCode: 'OB-G02',
          localX: 2.1,
          localZ: 2.3,
          localRotationY: obRotY,
          width: 5.2,
          depth: 2.8,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
      ],
    },
    {
      building: 'Old Building',
      floor: '1st Floor',
      floorIndex: 1,
      baseY: 0.28 + h,
      storeyHeight: h,
      slabWidth: 14.6,
      slabDepth: 4.0,
      corridorSide: 'south',
      corridorDepth: 1.0,
      rooms: [
        makeRoom('Old Building', '1st Floor', 1, h, {
          roomId: 'ob-101',
          roomCode: 'OB-101',
          localX: -2.2,
          localZ: -2.4,
          localRotationY: obRotY,
          width: 5.4,
          depth: 2.8,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
        makeRoom('Old Building', '1st Floor', 1, h, {
          roomId: 'ob-102',
          roomCode: 'OB-102',
          localX: 2.1,
          localZ: 2.3,
          localRotationY: obRotY,
          width: 5.2,
          depth: 2.8,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
      ],
    },
    {
      building: 'Old Building',
      floor: '2nd Floor',
      floorIndex: 2,
      baseY: 0.28 + h * 2,
      storeyHeight: h + 0.2,
      slabWidth: 14.6,
      slabDepth: 4.0,
      corridorSide: 'south',
      corridorDepth: 1.0,
      rooms: [
        makeRoom('Old Building', '2nd Floor', 2, h + 0.2, {
          roomId: 'ob-201',
          roomCode: 'OB-201',
          localX: -0.1,
          localZ: -0.1,
          localRotationY: obRotY,
          width: 10.8,
          depth: 2.8,
          corridorSide: 'south',
          interiorStyle: 'library',
        }),
      ],
    },
  ];
}

// =============================================================================
// 5. NB — NEW BUILDING (Exact Vector-Traced C-Shaped Courtyard Complex — 7 Rooms)
// =============================================================================
// Exact 20-vertex continuous polygon matching the Google Maps vector outline,
// centered at world (2.5, 3.2), connecting directly to OB via OB_NB_CONNECTOR_SPEC.
const NB_FOOTPRINT: Array<[number, number]> = [
  [-5.37, -9.25], // NW apex
  [-9.73, 0.78],  // Westernmost sharp elbow
  [-3.52, 9.92],  // Southernmost sharp apex above internal driveway
  [1.78, 6.11],   // South-central inner knee (west)
  [2.55, 5.85],   // South-central inner knee (east)
  [9.84, 9.25],   // SE wing outer SE corner
  [11.95, 4.33],  // SE wing outer NE corner
  [8.33, 2.66],   // SE wing subtle north step-out
  [8.14, 3.11],   // SE wing inner step-in
  [2.26, -0.19],  // Inner courtyard SE apex
  [-2.78, 3.37],  // Inner courtyard SW pocket
  [-4.88, 0.63],  // Inner courtyard W elbow
  [-4.74, -1.04], // Inner courtyard W-N bend
  [-3.85, -3.77], // Inner courtyard NW corner
  [1.04, -1.04],  // North-Central Arm inner south knuckle
  [3.03, -0.93],  // North-Central Arm bridge base south
  [4.14, -1.92],  // North-Central Arm eastern knuckle (meets OB–NB corridor)
  [3.44, -4.51],  // North-Central Arm NE shoulder (meets OB–NB corridor)
  [2.29, -4.22],  // Shallow recess beneath campus pin
  [1.04, -6.36],  // North-Central Arm north shoulder
];

function buildNewBuildingFloors(): FloorPlateSpec[] {
  const h = 2.35;
  return [
    {
      building: 'New Building',
      floor: 'Ground Floor',
      floorIndex: 0,
      baseY: 0.28,
      storeyHeight: h,
      slabWidth: 21.7,
      slabDepth: 19.2,
      corridorSide: 'east',
      corridorDepth: 1.1,
      rooms: [
        makeRoom('New Building', 'Ground Floor', 0, h, {
          roomId: 'nb-g01',
          roomCode: 'NB-G01',
          localX: -5.3,
          localZ: 3.6,
          localRotationY: -0.97,
          width: 5.2,
          depth: 2.8,
          corridorSide: 'north',
          interiorStyle: 'classroom',
        }),
        makeRoom('New Building', 'Ground Floor', 0, h, {
          roomId: 'nb-g02',
          roomCode: 'NB-G02',
          localX: 6.4,
          localZ: 4.8,
          localRotationY: -0.43,
          width: 6.4,
          depth: 3.1,
          corridorSide: 'north',
          interiorStyle: 'classroom',
        }),
      ],
    },
    {
      building: 'New Building',
      floor: '1st Floor',
      floorIndex: 1,
      baseY: 0.28 + h,
      storeyHeight: h,
      slabWidth: 21.7,
      slabDepth: 19.2,
      corridorSide: 'east',
      corridorDepth: 1.1,
      rooms: [
        makeRoom('New Building', '1st Floor', 1, h, {
          roomId: 'nb-101',
          roomCode: 'NB-101',
          localX: -1.3,
          localZ: -4.6,
          localRotationY: -0.53,
          width: 5.0,
          depth: 2.9,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
        makeRoom('New Building', '1st Floor', 1, h, {
          roomId: 'nb-102',
          roomCode: 'NB-102',
          localX: -5.3,
          localZ: 3.6,
          localRotationY: -0.97,
          width: 5.2,
          depth: 2.8,
          corridorSide: 'north',
          interiorStyle: 'classroom',
        }),
        makeRoom('New Building', '1st Floor', 1, h, {
          roomId: 'nb-103',
          roomCode: 'NB-103',
          localX: 6.4,
          localZ: 4.8,
          localRotationY: -0.43,
          width: 6.4,
          depth: 3.1,
          corridorSide: 'north',
          interiorStyle: 'staff',
        }),
      ],
    },
    {
      building: 'New Building',
      floor: '2nd Floor',
      floorIndex: 2,
      baseY: 0.28 + h * 2,
      storeyHeight: h,
      slabWidth: 21.7,
      slabDepth: 19.2,
      corridorSide: 'east',
      corridorDepth: 1.1,
      rooms: [
        makeRoom('New Building', '2nd Floor', 2, h, {
          roomId: 'nb-201',
          roomCode: 'NB-201',
          localX: -1.3,
          localZ: -4.6,
          localRotationY: -0.53,
          width: 5.0,
          depth: 2.9,
          corridorSide: 'south',
          interiorStyle: 'classroom',
        }),
        makeRoom('New Building', '2nd Floor', 2, h, {
          roomId: 'nb-202',
          roomCode: 'NB-202',
          localX: 6.4,
          localZ: 4.8,
          localRotationY: -0.43,
          width: 6.4,
          depth: 3.1,
          corridorSide: 'north',
          interiorStyle: 'classroom',
        }),
      ],
    },
  ];
}

// =============================================================================
// COMPLETE 1:1 DAV MODEL SCHOOL CAMPUS BUILDING REGISTRY
// =============================================================================
export const CAMPUS_BUILDINGS_SCHEMA: BuildingSchemaSpec[] = [
  {
    id: 'G+3 Block',
    shortLabel: 'G+3 Block',
    mapCode: 'G+3',
    subtitle: '4 Storeys · 9 Rooms · Senior Secondary & Labs',
    worldX: -16.4,
    worldZ: -15.9,
    rotationY: 0.14,
    width: 11.8,
    depth: 11.4,
    footprintPts: G3_FOOTPRINT,
    storeyHeight: 2.35,
    corridorSide: 'south',
    roofStyle: 'modern-flat',
    architecturalStyle: 'g3-notched',
    riserWorldPos: [-13.4, 0.35, -10.4],
    focusCameraOffset: [14, 15.5, 22],
    labelLocalOffset: [-0.8, 11.5, -1.2],
    floors: buildG3Floors(),
  },
  {
    id: 'Multipurpose Hall',
    shortLabel: 'MPH (2F Ht)',
    mapCode: 'MPH',
    subtitle: 'Compact Extension of G+3 · 2nd-Floor Height · 1 Hall',
    worldX: -18.72,
    worldZ: -7.21,
    rotationY: 0.14, // Aligned flush with G+3 Block's SW wing with zero Z-fighting seam
    width: 4.8,
    depth: 5.0,
    footprintPts: MPH_FOOTPRINT,
    storeyHeight: 4.95,
    corridorSide: 'east',
    roofStyle: 'auditorium-vault',
    architecturalStyle: 'mph-extension',
    attachedToBuilding: 'G+3 Block',
    riserWorldPos: [-16.0, 0.35, -7.0],
    focusCameraOffset: [12, 10.5, 15],
    labelLocalOffset: [0, 6.8, 0],
    floors: buildMultipurposeHallFloors(),
  },
  {
    id: 'Pre-Primary Block',
    shortLabel: 'Pre-Primary (PP)',
    mapCode: 'PP',
    subtitle: 'Ground Floor L-Wing · Separated South of MPH · 3 Rooms',
    worldX: -14.25,
    worldZ: 5.8,
    rotationY: 0.14,
    width: 9.4,
    depth: 12.4,
    footprintPts: PP_FOOTPRINT,
    storeyHeight: 2.45,
    corridorSide: 'north',
    roofStyle: 'pavilion-clerestory',
    architecturalStyle: 'pp-l-wing',
    riserWorldPos: [-11.8, 0.35, 6.2],
    focusCameraOffset: [12, 10.5, 16.5],
    labelLocalOffset: [-1.8, 4.3, 1.5],
    floors: buildPrePrimaryFloors(),
  },
  {
    id: 'New Building',
    shortLabel: 'New Building (NB)',
    mapCode: 'NB',
    subtitle: '3 Storeys · 7 Rooms · C-Shaped Courtyard Complex',
    worldX: 2.5,
    worldZ: 3.2,
    rotationY: 0,
    width: 21.7,
    depth: 19.2,
    footprintPts: NB_FOOTPRINT,
    storeyHeight: 2.35,
    corridorSide: 'east',
    roofStyle: 'modern-flat',
    architecturalStyle: 'nb-courtyard',
    riserWorldPos: [-1.2, 0.35, 6.8],
    focusCameraOffset: [-13, 15.5, 22],
    labelLocalOffset: [-1.8, 9.2, 3.6],
    floors: buildNewBuildingFloors(),
  },
  {
    id: 'Old Building',
    shortLabel: 'Old Building (OB)',
    mapCode: 'OB',
    subtitle: '3 Storeys · 5 Rooms · Diagonal Heritage Wing & Library',
    worldX: 8.4,
    worldZ: -5.4,
    rotationY: 0,
    width: 14.6,
    depth: 13.0,
    footprintPts: OB_FOOTPRINT,
    storeyHeight: 2.35,
    corridorSide: 'south',
    roofStyle: 'heritage-parapet',
    architecturalStyle: 'ob-heritage',
    riserWorldPos: [6.8, 0.35, -3.5],
    focusCameraOffset: [-13, 13.5, 19],
    labelLocalOffset: [0, 9.2, 0],
    floors: buildOldBuildingFloors(),
  },
];

/**
 * Clean, minimal 5-building semantic labels (keeps the 3D viewport uncluttered).
 */
export const CAMPUS_LANDMARK_LABELS: CampusLandmarkLabelSpec[] = CAMPUS_BUILDINGS_SCHEMA.map((b) => {
  const cosR = Math.cos(b.rotationY);
  const sinR = Math.sin(b.rotationY);
  const [lx, ly, lz] = b.labelLocalOffset;
  return {
    id: `label-${b.id}`,
    label: b.shortLabel,
    subLabel: b.mapCode,
    kind: 'building' as const,
    buildingId: b.id,
    worldPos: [
      b.worldX + lx * cosR + lz * sinR,
      ly,
      b.worldZ - lx * sinR + lz * cosR,
    ] as [number, number, number],
  };
});

export const ROOM_GEOMETRY_MAP: Map<
  string,
  { building: BuildingSchemaSpec; floor: FloorPlateSpec; room: RoomGeometrySpec }
> = new Map();

for (const b of CAMPUS_BUILDINGS_SCHEMA) {
  for (const f of b.floors) {
    for (const r of f.rooms) {
      ROOM_GEOMETRY_MAP.set(r.roomId, { building: b, floor: f, room: r });
    }
  }
}

/**
 * Computes exact world-space center of any canonical classroom, taking building
 * rotation and exploded-view vertical separation into account.
 */
export function getRoomWorldCenter(
  roomId: string,
  explodeFactor: number
): [number, number, number] | null {
  const entry = ROOM_GEOMETRY_MAP.get(roomId);
  if (!entry) return null;
  const { building, floor, room } = entry;
  const cosR = Math.cos(building.rotationY);
  const sinR = Math.sin(building.rotationY);
  const wx = building.worldX + room.localX * cosR + room.localZ * sinR;
  const wz = building.worldZ - room.localX * sinR + room.localZ * cosR;
  const y = floor.baseY + floor.floorIndex * FLOOR_EXPLODE_GAP * explodeFactor + room.height * 0.45;
  return [wx, y, wz];
}

/**
 * Restrained sculptural campus trees positioned cleanly outside building footprints,
 * corridors, roads, and sports grounds (zero clipping or visual clutter).
 */
export const CAMPUS_TREE_POSITIONS: Array<{
  x: number;
  z: number;
  scale: number;
  variant: number;
}> = [
  // Signature central courtyard shade tree inside NB's inner courtyard pocket
  { x: 0.7, z: 3.1, scale: 1.15, variant: 0 },

  // Light framing between G+3/MPH and NB
  { x: -11.4, z: -7.6, scale: 0.92, variant: 1 },
  { x: -11.6, z: -2.2, scale: 0.88, variant: 0 },

  // Northern boundary grove flanking Gate 1 & behind OB
  { x: -2.8, z: -18.5, scale: 1.0, variant: 0 },
  { x: 11.8, z: -16.8, scale: 1.04, variant: 1 },
  { x: -24.0, z: -18.8, scale: 0.92, variant: 1 },

  // Eastern campus margin (away from excluded residential zone)
  { x: 18.2, z: -3.2, scale: 0.98, variant: 0 },
  { x: 17.8, z: 6.0, scale: 0.92, variant: 1 },

  // Restrained southern perimeter accents framing the sports apron
  { x: -20.5, z: 26.8, scale: 0.92, variant: 0 },
  { x: 8.5, z: 26.8, scale: 0.9, variant: 1 },
  { x: 25.0, z: 25.4, scale: 0.94, variant: 0 },
];
