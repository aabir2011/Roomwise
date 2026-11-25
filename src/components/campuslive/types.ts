/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BuildingName, Floor, RoomType } from '../../types/energy';

export type CampusVisualMode = 'architectural' | 'lighting' | 'intensity' | 'environmental';

export type CameraPresetId = 'isometric' | 'courtyard' | 'top' | 'elevation';

export type TimelinePresetId = 'today' | 'yesterday' | 'last_7_days';

export type EnergyIntensityTier = 'inactive' | 'efficient' | 'moderate' | 'elevated';

export interface CampusRoomVisualState {
  roomId: string;
  roomCode: string;
  name: string;
  building: BuildingName;
  floor: Floor;
  type: RoomType;
  /** Current watts (live) or interval average watts (historical) */
  powerWatts: number;
  /** Installed rated maximum from canonical ROOM_APPLIANCE_SPECS */
  ratedPowerWatts: number;
  /** Available headroom vs installed rated max (0-ratedPowerWatts) */
  availableHeadroomWatts: number;
  /** Relative utilisation percentage vs installed rated maximum (0-100) */
  ratedUtilizationPercent: number;
  /** Average lighting dimming % (0-100) for live mode, or derived lighting load share proxy for historical */
  lightingLevel: number;
  /** Average fan output % (0-100) for live mode; 0 in historical mode (individual RPM not logged) */
  fanLevel: number;
  /** True when lightingLevel is derived from historical aggregate kWh rather than direct fixture telemetry */
  isHistoricalAggregate: boolean;
  /** Recorded energy in kWh for the active historical interval (undefined in live mode) */
  historicalIntervalKWh?: number;
  /** Motion/occupancy active indicator */
  isOccupied: boolean;
  /** Ambient temperature in Celsius */
  temperatureC: number;
  /** Ambient desk illuminance in lux (live mode) */
  ambientLux: number;
  /** Whether room has an active unresolved audit alert or manual override */
  hasAlert: boolean;
  hasManualOverride: boolean;
  intensityTier: EnergyIntensityTier;
}

export interface RoomGeometrySpec {
  roomId: string;
  roomCode: string;
  building: BuildingName;
  floor: Floor;
  floorIndex: number;
  /** Center position local to the floor (or wing) group (X, Z) */
  localX: number;
  localZ: number;
  /** Optional local Y-axis rotation in radians relative to building root (for multi-wing buildings like NB / PP) */
  localRotationY?: number;
  /** Optional wing identifier for multi-wing footprints */
  wingId?: string;
  /** Width (X), Depth (Z) inside the floor plate */
  width: number;
  depth: number;
  /** Ceiling height for this storey */
  height: number;
  /** Which facade faces the courtyard/corridor for door & glazing placement */
  corridorSide: 'south' | 'north' | 'east' | 'west';
  /** Room type hint for restrained architectural interior detailing */
  interiorStyle:
    | 'classroom'
    | 'lab'
    | 'computer-lab'
    | 'staff'
    | 'library'
    | 'pre-primary'
    | 'auditorium';
}

export interface WingPlateSpec {
  id: string;
  /** Center offset relative to building origin (X, Z) */
  offsetX: number;
  offsetZ: number;
  /** Rotation in radians relative to building root */
  rotationY: number;
  width: number;
  depth: number;
  corridorSide: 'south' | 'north' | 'east' | 'west';
  corridorDepth: number;
  /** Edges flush-joined to a sibling wing so no overlapping walls, parapets, or plinth overhangs are generated */
  joinedEdges?: Array<'north' | 'south' | 'east' | 'west'>;
}

export interface FloorPlateSpec {
  building: BuildingName;
  floor: Floor;
  floorIndex: number;
  baseY: number;
  storeyHeight: number;
  slabWidth: number;
  slabDepth: number;
  corridorSide: 'south' | 'north' | 'east' | 'west';
  corridorDepth: number;
  /** Optional multi-wing architectural plate definitions (e.g. G+3 notched wing, PP L-shape, NB angled courtyard wings) */
  wings?: WingPlateSpec[];
  rooms: RoomGeometrySpec[];
}

export type ArchitecturalStyleKind =
  | 'g3-notched'
  | 'mph-extension'
  | 'ob-heritage'
  | 'nb-courtyard'
  | 'pp-l-wing';

export interface BuildingSchemaSpec {
  id: BuildingName;
  shortLabel: string;
  mapCode: string;
  subtitle: string;
  /** World center (X, Z) on the campus terrain */
  worldX: number;
  worldZ: number;
  /** Rotation around vertical Y axis in radians matching the satellite reference orientation */
  rotationY: number;
  /** Bounding/primary width and depth in scene units */
  width: number;
  depth: number;
  /** Exact non-self-intersecting 2D perimeter polygon in building-local [x, z] coordinates (CCW in X-North) */
  footprintPts: Array<[number, number]>;
  storeyHeight: number;
  corridorSide: 'south' | 'north' | 'east' | 'west';
  roofStyle: 'modern-flat' | 'heritage-parapet' | 'pavilion-clerestory' | 'auditorium-vault';
  architecturalStyle: ArchitecturalStyleKind;
  /** Optional parent building link (e.g., MPH attached to G+3 Block) */
  attachedToBuilding?: BuildingName;
  /** World position where the conceptual energy riser enters this building */
  riserWorldPos: [number, number, number];
  /** Ideal camera offset (in world coordinates) when focusing this building */
  focusCameraOffset: [number, number, number];
  /** Anchor offset for subtle 3D-projected building label above roof */
  labelLocalOffset: [number, number, number];
  floors: FloorPlateSpec[];
}

export interface ArchitecturalConnectorSpec {
  id: string;
  label: string;
  startWorld: [number, number];
  endWorld: [number, number];
  width: number;
  height: number;
}

export interface CampusLandmarkLabelSpec {
  id: string;
  label: string;
  subLabel?: string;
  kind: 'building' | 'sports' | 'gate';
  buildingId?: BuildingName;
  worldPos: [number, number, number];
}

export interface HistoricalSnapshotFrame {
  key: string;
  label: string;
  subLabel: string;
  dateIst: string;
  hourIst?: number;
  dayType?: 'school' | 'saturday' | 'holiday' | 'sunday';
  isPartial?: boolean;
  granularity: 'hourly' | 'daily';
  totalActualKWh: number;
  totalRatedMaxKWh: number;
  lightingKWh: number;
  fanKWh: number;
  auxKWh: number;
  avgOccupancyPercent: number;
  avgTempC: number;
  byBuildingKWh: Record<string, number>;
  byRoomKWh: Record<string, number>;
}

export interface TourStep {
  id: string;
  title: string;
  subtitle: string;
  cameraPreset?: CameraPresetId;
  focusBuilding?: BuildingName | null;
  focusRoomId?: string | null;
  selectedFloor?: Floor | 'All';
  exploded: boolean;
  cutaway: boolean;
  visualMode: CampusVisualMode;
  showEnergyFlow: boolean;
  durationMs: number;
}
