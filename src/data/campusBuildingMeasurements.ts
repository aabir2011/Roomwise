/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BuildingName } from '../types/energy';

/**
 * Exact provenance labels required across CAMPUS LIVE, Solar/PVGIS, and institutional disclosures.
 */
export type MeasurementProvenanceLabel =
  | 'Supplied measured data'
  | 'Supplied calculated area'
  | 'Derived from supplied geometry'
  | 'Approximate visual geometry'
  | 'Not available';

export type GeometryVerificationStatus =
  | 'supplied_verified'
  | 'derived_from_supplied_complex'
  | 'approximate_visual';

export type GeometryConfidence = 'high' | 'medium' | 'low';

export const SQ_FEET_PER_SQ_METER = 10.763910416709722;
export const FEET_PER_METER = 3.280839895013123;

export function m2ToFt2(areaM2: number): number {
  return Math.round(areaM2 * SQ_FEET_PER_SQ_METER * 100) / 100;
}

export function metersToFt(meters: number): number {
  return Math.round(meters * FEET_PER_METER * 100) / 100;
}

export interface CombinedComplexMeasurement {
  complexId: string;
  complexName: string;
  memberBuildingIds: string[];
  memberRoomwiseBuildings: BuildingName[];
  suppliedCombinedAreaM2: number;
  suppliedCombinedAreaFt2: number;
  suppliedCombinedPerimeterM: number;
  suppliedCombinedPerimeterFt: number;
  areaProvenance: MeasurementProvenanceLabel;
  perimeterProvenance: MeasurementProvenanceLabel;
  measurementSource: string;
  measurementMethod: string;
  referenceScreenshot: string;
  lastUpdated: string;
  disclosureNote: string;
}

export interface AuthoritativeCampusFeatureRecord {
  /** Canonical ID shared with server/campusReconstruction.ts and solarService.ts */
  id: string;
  /** Display name */
  name: string;
  shortLabel: string;
  /** Linked ROOMWISE BuildingName (null for non-building outdoor sports grounds) */
  linkedRoomwiseBuilding: BuildingName | null;
  /** Whether this feature counts toward campus building footprint area */
  isBuildingFootprint: boolean;
  /** Whether this feature is eligible for rooftop PV feasibility assessment */
  solarEligible: boolean;
  /** Parent building ID when attached as an extension (e.g., MPH -> G+3 Block) */
  parentBuildingId: string | null;
  /** Authoritative horizontal footprint area (m²) used across ROOMWISE */
  authoritativeFootprintAreaM2: number;
  /** Authoritative horizontal footprint area (ft²) */
  authoritativeFootprintAreaFt2: number;
  /** Directly supplied single-structure Google Maps area (m²), or null if only measured as a combined complex */
  suppliedDirectAreaM2: number | null;
  suppliedDirectAreaFt2: number | null;
  /** Directly supplied single-structure Google Maps perimeter (m), or null if only measured as a combined complex */
  suppliedPerimeterM: number | null;
  suppliedPerimeterFt: number | null;
  /** Prior image-reconstructed estimate before supplied measurement integration (for discrepancy audit) */
  priorEstimatedAreaM2: number;
  /** Exact provenance labels */
  areaProvenance: MeasurementProvenanceLabel;
  perimeterProvenance: MeasurementProvenanceLabel;
  verticalGeometryProvenance: MeasurementProvenanceLabel;
  roofSurfaceAreaProvenance: MeasurementProvenanceLabel;
  /** Metadata */
  measurementSource: string;
  measurementMethod: string;
  referenceScreenshot: string;
  verificationStatus: GeometryVerificationStatus;
  geometryConfidence: GeometryConfidence;
  lastUpdated: string;
  /** Non-null for OB and NB, which were measured together as one unified connected polygon */
  combinedComplexRef: {
    complexId: string;
    complexName: string;
    suppliedCombinedAreaM2: number;
    suppliedCombinedAreaFt2: number;
    suppliedCombinedPerimeterM: number;
    suppliedCombinedPerimeterFt: number;
    proportionalSharePercent: number;
  } | null;
  /** Concise transparent note on horizontal footprint vs unmeasured vertical/rooftop parameters */
  geometryNote: string;
}

export const MEASUREMENT_LAST_UPDATED = '2026-11-23';
export const MEASUREMENT_SOURCE_LABEL = 'Google Maps Measure Distance';
export const MEASUREMENT_METHOD_LABEL =
  'Closed-polygon horizontal footprint & perimeter trace on Google Maps imagery';

/**
 * Authoritative combined measurement for the Old Building (OB) + New Building (NB)
 * connected academic complex (measured as one unified closed polygon including the
 * OB–NB connecting corridor in Google Maps Measure Distance).
 */
export const OB_NB_COMBINED_MEASUREMENT: CombinedComplexMeasurement = {
  complexId: 'campus/ob-nb-complex',
  complexName: 'Old Building (OB) + New Building (NB) Connected Complex',
  memberBuildingIds: ['campus/old-building', 'campus/new-building'],
  memberRoomwiseBuildings: ['Old Building', 'New Building'],
  suppliedCombinedAreaM2: 1209.21,
  suppliedCombinedAreaFt2: 13015.87,
  suppliedCombinedPerimeterM: 285.74,
  suppliedCombinedPerimeterFt: 937.47,
  areaProvenance: 'Supplied calculated area',
  perimeterProvenance: 'Supplied measured data',
  measurementSource: MEASUREMENT_SOURCE_LABEL,
  measurementMethod: MEASUREMENT_METHOD_LABEL,
  referenceScreenshot: 'Screenshot 2026-11-23 202949.png',
  lastUpdated: MEASUREMENT_LAST_UPDATED,
  disclosureNote:
    'Old Building (OB) and New Building (NB) were measured together as one unified connected complex (1,209.21 m² / 13,015.87 ft²; perimeter 285.74 m / 937.47 ft). Per-wing footprints are apportioned proportionally from the traced geometry so OB + NB equals exactly 1,209.21 m² without double-counting.',
};

/**
 * Single authoritative geometric reference registry for DAV Model School, IIT Kharagpur.
 * Shared across CAMPUS LIVE (3D twin & inspector), Solar/PVGIS backend, and UI panels.
 *
 * Academic building total (5 buildings):
 *   601.55 (G+3) + 168.51 (MPH) + 387.53 (PP) + 298.46 (OB) + 910.75 (NB) = 2,366.80 m² (25,475.99 ft²)
 *   where OB (298.46 m²) + NB (910.75 m²) === 1,209.21 m² exact supplied combined complex area.
 *
 * Non-building outdoor grounds (excluded from building footprint & rooftop solar totals):
 *   Football Ground:  5,300.83 m² (57,057.63 ft²), perimeter 344.17 m (1,129.16 ft)
 *   Basketball Court:   737.14 m²  (7,934.47 ft²), perimeter 113.93 m   (373.78 ft)
 */
export const AUTHORITATIVE_CAMPUS_FEATURES: AuthoritativeCampusFeatureRecord[] = [
  {
    id: 'campus/g3-block',
    name: 'G+3 Block',
    shortLabel: 'G+3 Block',
    linkedRoomwiseBuilding: 'G+3 Block',
    isBuildingFootprint: true,
    solarEligible: true,
    parentBuildingId: null,
    authoritativeFootprintAreaM2: 601.55,
    authoritativeFootprintAreaFt2: 6475.02,
    suppliedDirectAreaM2: 601.55,
    suppliedDirectAreaFt2: 6475.02,
    suppliedPerimeterM: 133.98,
    suppliedPerimeterFt: 439.58,
    priorEstimatedAreaM2: 820.59,
    areaProvenance: 'Supplied calculated area',
    perimeterProvenance: 'Supplied measured data',
    verticalGeometryProvenance: 'Approximate visual geometry',
    roofSurfaceAreaProvenance: 'Not available',
    measurementSource: MEASUREMENT_SOURCE_LABEL,
    measurementMethod: MEASUREMENT_METHOD_LABEL,
    referenceScreenshot: 'Screenshot 2026-11-23 203355.png',
    verificationStatus: 'supplied_verified',
    geometryConfidence: 'high',
    lastUpdated: MEASUREMENT_LAST_UPDATED,
    combinedComplexRef: null,
    geometryNote:
      'Horizontal building footprint (601.55 m², perimeter 133.98 m) from supplied Google Maps Measure Distance polygon. Vertical storey height, parapets, stairwell mumty, and actual roof-surface area are not measured in this dataset.',
  },
  {
    id: 'campus/mph',
    name: 'MPH',
    shortLabel: 'MPH (2F Ht)',
    linkedRoomwiseBuilding: 'Multipurpose Hall',
    isBuildingFootprint: true,
    solarEligible: true,
    parentBuildingId: 'campus/g3-block',
    authoritativeFootprintAreaM2: 168.51,
    authoritativeFootprintAreaFt2: 1813.81,
    suppliedDirectAreaM2: 168.51,
    suppliedDirectAreaFt2: 1813.81,
    suppliedPerimeterM: 52.27,
    suppliedPerimeterFt: 171.5,
    priorEstimatedAreaM2: 149.86,
    areaProvenance: 'Supplied calculated area',
    perimeterProvenance: 'Supplied measured data',
    verticalGeometryProvenance: 'Approximate visual geometry',
    roofSurfaceAreaProvenance: 'Not available',
    measurementSource: MEASUREMENT_SOURCE_LABEL,
    measurementMethod: MEASUREMENT_METHOD_LABEL,
    referenceScreenshot: 'Screenshot 2026-11-23 203038.png',
    verificationStatus: 'supplied_verified',
    geometryConfidence: 'high',
    lastUpdated: MEASUREMENT_LAST_UPDATED,
    combinedComplexRef: null,
    geometryNote:
      'Outward ground-floor extension attached to the southern flank of G+3 Block (168.51 m², perimeter 52.27 m) from supplied Google Maps Measure Distance polygon. Vertical height and roof construction details are approximate visual geometry.',
  },
  {
    id: 'campus/pre-primary-block',
    name: 'Pre-Primary Block (PP)',
    shortLabel: 'Pre-Primary (PP)',
    linkedRoomwiseBuilding: 'Pre-Primary Block',
    isBuildingFootprint: true,
    solarEligible: true,
    parentBuildingId: null,
    authoritativeFootprintAreaM2: 387.53,
    authoritativeFootprintAreaFt2: 4171.29,
    suppliedDirectAreaM2: 387.53,
    suppliedDirectAreaFt2: 4171.29,
    suppliedPerimeterM: 105.86,
    suppliedPerimeterFt: 347.3,
    priorEstimatedAreaM2: 527.24,
    areaProvenance: 'Supplied calculated area',
    perimeterProvenance: 'Supplied measured data',
    verticalGeometryProvenance: 'Approximate visual geometry',
    roofSurfaceAreaProvenance: 'Not available',
    measurementSource: MEASUREMENT_SOURCE_LABEL,
    measurementMethod: MEASUREMENT_METHOD_LABEL,
    referenceScreenshot: 'Screenshot 2026-11-23 203104.png',
    verificationStatus: 'supplied_verified',
    geometryConfidence: 'high',
    lastUpdated: MEASUREMENT_LAST_UPDATED,
    combinedComplexRef: null,
    geometryNote:
      'Single-storey L-shaped wing separated south of MPH (387.53 m², perimeter 105.86 m) from supplied Google Maps Measure Distance polygon. Vertical height and actual roof-surface area are not measured.',
  },
  {
    id: 'campus/old-building',
    name: 'Old Building (OB)',
    shortLabel: 'Old Building (OB)',
    linkedRoomwiseBuilding: 'Old Building',
    isBuildingFootprint: true,
    solarEligible: true,
    parentBuildingId: null,
    authoritativeFootprintAreaM2: 298.46,
    authoritativeFootprintAreaFt2: m2ToFt2(298.46),
    suppliedDirectAreaM2: null,
    suppliedDirectAreaFt2: null,
    suppliedPerimeterM: null,
    suppliedPerimeterFt: null,
    priorEstimatedAreaM2: 432.54,
    areaProvenance: 'Derived from supplied geometry',
    perimeterProvenance: 'Not available',
    verticalGeometryProvenance: 'Approximate visual geometry',
    roofSurfaceAreaProvenance: 'Not available',
    measurementSource: MEASUREMENT_SOURCE_LABEL,
    measurementMethod:
      'Proportional wing allocation (24.68%) derived from the supplied unified OB + NB connected polygon (1,209.21 m²)',
    referenceScreenshot: 'Screenshot 2026-11-23 202949.png',
    verificationStatus: 'derived_from_supplied_complex',
    geometryConfidence: 'medium',
    lastUpdated: MEASUREMENT_LAST_UPDATED,
    combinedComplexRef: {
      complexId: OB_NB_COMBINED_MEASUREMENT.complexId,
      complexName: OB_NB_COMBINED_MEASUREMENT.complexName,
      suppliedCombinedAreaM2: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaM2,
      suppliedCombinedAreaFt2: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaFt2,
      suppliedCombinedPerimeterM: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedPerimeterM,
      suppliedCombinedPerimeterFt: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedPerimeterFt,
      proportionalSharePercent: 24.68,
    },
    geometryNote:
      'Measured jointly with New Building (NB) as one connected complex (1,209.21 m² total, 285.74 m combined perimeter). Individual OB wing allocation (298.46 m²) is derived proportionally from the traced geometry so OB + NB equals exactly 1,209.21 m².',
  },
  {
    id: 'campus/new-building',
    name: 'New Building (NB)',
    shortLabel: 'New Building (NB)',
    linkedRoomwiseBuilding: 'New Building',
    isBuildingFootprint: true,
    solarEligible: true,
    parentBuildingId: null,
    authoritativeFootprintAreaM2: 910.75,
    authoritativeFootprintAreaFt2: m2ToFt2(910.75),
    suppliedDirectAreaM2: null,
    suppliedDirectAreaFt2: null,
    suppliedPerimeterM: null,
    suppliedPerimeterFt: null,
    priorEstimatedAreaM2: 1319.91,
    areaProvenance: 'Derived from supplied geometry',
    perimeterProvenance: 'Not available',
    verticalGeometryProvenance: 'Approximate visual geometry',
    roofSurfaceAreaProvenance: 'Not available',
    measurementSource: MEASUREMENT_SOURCE_LABEL,
    measurementMethod:
      'Proportional wing allocation (75.32%) derived from the supplied unified OB + NB connected polygon (1,209.21 m²)',
    referenceScreenshot: 'Screenshot 2026-11-23 202949.png',
    verificationStatus: 'derived_from_supplied_complex',
    geometryConfidence: 'medium',
    lastUpdated: MEASUREMENT_LAST_UPDATED,
    combinedComplexRef: {
      complexId: OB_NB_COMBINED_MEASUREMENT.complexId,
      complexName: OB_NB_COMBINED_MEASUREMENT.complexName,
      suppliedCombinedAreaM2: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaM2,
      suppliedCombinedAreaFt2: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedAreaFt2,
      suppliedCombinedPerimeterM: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedPerimeterM,
      suppliedCombinedPerimeterFt: OB_NB_COMBINED_MEASUREMENT.suppliedCombinedPerimeterFt,
      proportionalSharePercent: 75.32,
    },
    geometryNote:
      'Measured jointly with Old Building (OB) as one connected complex (1,209.21 m² total, 285.74 m combined perimeter). Individual NB complex allocation (910.75 m²) is derived proportionally from the traced geometry so OB + NB equals exactly 1,209.21 m².',
  },
  {
    id: 'campus/football-ground',
    name: 'Football Ground',
    shortLabel: 'Football Ground',
    linkedRoomwiseBuilding: null,
    isBuildingFootprint: false,
    solarEligible: false,
    parentBuildingId: null,
    authoritativeFootprintAreaM2: 5300.83,
    authoritativeFootprintAreaFt2: 57057.63,
    suppliedDirectAreaM2: 5300.83,
    suppliedDirectAreaFt2: 57057.63,
    suppliedPerimeterM: 344.17,
    suppliedPerimeterFt: 1129.16,
    priorEstimatedAreaM2: 4788.26,
    areaProvenance: 'Supplied calculated area',
    perimeterProvenance: 'Supplied measured data',
    verticalGeometryProvenance: 'Not available',
    roofSurfaceAreaProvenance: 'Not available',
    measurementSource: MEASUREMENT_SOURCE_LABEL,
    measurementMethod: MEASUREMENT_METHOD_LABEL,
    referenceScreenshot: 'Screenshot 2026-11-23 203827.png',
    verificationStatus: 'supplied_verified',
    geometryConfidence: 'high',
    lastUpdated: MEASUREMENT_LAST_UPDATED,
    combinedComplexRef: null,
    geometryNote:
      'Open-air sports field (5,300.83 m², perimeter 344.17 m) from supplied Google Maps Measure Distance polygon. Explicitly excluded from academic building footprint and rooftop solar capacity totals.',
  },
  {
    id: 'campus/basketball-court',
    name: 'Basketball Court (BB)',
    shortLabel: 'Basketball Court (BB)',
    linkedRoomwiseBuilding: null,
    isBuildingFootprint: false,
    solarEligible: false,
    parentBuildingId: null,
    authoritativeFootprintAreaM2: 737.14,
    authoritativeFootprintAreaFt2: 7934.47,
    suppliedDirectAreaM2: 737.14,
    suppliedDirectAreaFt2: 7934.47,
    suppliedPerimeterM: 113.93,
    suppliedPerimeterFt: 373.78,
    priorEstimatedAreaM2: 626.45,
    areaProvenance: 'Supplied calculated area',
    perimeterProvenance: 'Supplied measured data',
    verticalGeometryProvenance: 'Not available',
    roofSurfaceAreaProvenance: 'Not available',
    measurementSource: MEASUREMENT_SOURCE_LABEL,
    measurementMethod: MEASUREMENT_METHOD_LABEL,
    referenceScreenshot: 'Screenshot 2026-11-23 203900.png',
    verificationStatus: 'supplied_verified',
    geometryConfidence: 'high',
    lastUpdated: MEASUREMENT_LAST_UPDATED,
    combinedComplexRef: null,
    geometryNote:
      'Open-air paved basketball court (737.14 m², perimeter 113.93 m) from supplied Google Maps Measure Distance polygon. Explicitly excluded from academic building footprint and rooftop solar capacity totals.',
  },
];

export const CAMPUS_FEATURE_BY_ID: ReadonlyMap<string, AuthoritativeCampusFeatureRecord> = new Map(
  AUTHORITATIVE_CAMPUS_FEATURES.map((rec) => [rec.id, rec])
);

export const CAMPUS_FEATURE_BY_ROOMWISE_BUILDING: ReadonlyMap<
  BuildingName,
  AuthoritativeCampusFeatureRecord
> = new Map(
  AUTHORITATIVE_CAMPUS_FEATURES.filter((rec) => rec.linkedRoomwiseBuilding !== null).map((rec) => [
    rec.linkedRoomwiseBuilding as BuildingName,
    rec,
  ])
);

export function getCampusMeasurementById(
  id: string
): AuthoritativeCampusFeatureRecord | undefined {
  return CAMPUS_FEATURE_BY_ID.get(id);
}

export function getCampusMeasurementByRoomwiseBuilding(
  building: BuildingName
): AuthoritativeCampusFeatureRecord | undefined {
  return CAMPUS_FEATURE_BY_ROOMWISE_BUILDING.get(building);
}

/** Authoritative total academic building horizontal footprint area across all 5 buildings (m²). */
export const TOTAL_ACADEMIC_BUILDING_FOOTPRINT_M2 = Math.round(
  AUTHORITATIVE_CAMPUS_FEATURES.filter((f) => f.isBuildingFootprint).reduce(
    (sum, f) => sum + f.authoritativeFootprintAreaM2,
    0
  ) * 100
) / 100; // 2,366.80 m²

export const TOTAL_ACADEMIC_BUILDING_FOOTPRINT_FT2 = Math.round(
  AUTHORITATIVE_CAMPUS_FEATURES.filter((f) => f.isBuildingFootprint).reduce(
    (sum, f) => sum + f.authoritativeFootprintAreaFt2,
    0
  ) * 100
) / 100; // 25,475.99 ft²

/** Authoritative total outdoor sports ground area (strictly excluded from building & solar sums). */
export const TOTAL_OUTDOOR_SPORTS_AREA_M2 = Math.round(
  AUTHORITATIVE_CAMPUS_FEATURES.filter((f) => !f.isBuildingFootprint).reduce(
    (sum, f) => sum + f.authoritativeFootprintAreaM2,
    0
  ) * 100
) / 100; // 6,037.97 m²
