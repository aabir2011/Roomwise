/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PvgisTechnology = 'crystSi' | 'CIS' | 'CdTe' | 'Unknown';
export type PvgisMountingPlace = 'building' | 'free';
export type PvgisRadiationDatabaseChoice = 'PVGIS-SARAH3' | 'PVGIS-ERA5' | 'auto';

export type BuildingSelectionStatus = 'confirmed' | 'provisional' | 'unassigned' | 'excluded';
export type BuildingDataConfidence = 'high' | 'medium' | 'low';
export type RoofMetadataStatus = 'mapped' | 'partial' | 'assumed';

export type BuildingSourceKind = 'image_reconstructed' | 'osm' | 'manual';
export type CampusFeatureKind = 'academic_building' | 'connected_wing' | 'sports_ground';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface BuildingPolygon {
  outer: GeoPoint[];
  holes?: GeoPoint[][];
}

export interface CampusRoadFeature {
  id: string;
  label?: string;
  kind: 'perimeter_road' | 'internal_road' | 'pathway';
  widthMeters: number;
  points: GeoPoint[];
}

export interface CampusGateFeature {
  id: string;
  label: string;
  position: GeoPoint;
  description: string;
}

export interface CampusTreeFeature {
  id: string;
  center: GeoPoint;
  radiusMeters: number;
}

export interface CampusVisualOverlay {
  sourceLabel: string;
  referenceNote: string;
  campusParcel: BuildingPolygon;
  roads: CampusRoadFeature[];
  gates: CampusGateFeature[];
  trees: CampusTreeFeature[];
}

export type SolarPlanningScenarioId =
  | 'conservative'
  | 'moderate'
  | 'high_theoretical'
  | 'custom';

export interface SolarPlanningScenarioPreset {
  id: Exclude<SolarPlanningScenarioId, 'custom'>;
  label: string;
  shortLabel: string;
  usableRoofFractionPercent: number;
  packingFactorPercent: number;
  netRoofCoveragePercent: number;
  summary: string;
}

export const SOLAR_PLANNING_SCENARIOS: Record<
  Exclude<SolarPlanningScenarioId, 'custom'>,
  SolarPlanningScenarioPreset
> = {
  conservative: {
    id: 'conservative',
    label: 'Conservative Rooftop Scenario',
    shortLabel: 'Conservative',
    usableRoofFractionPercent: 45,
    packingFactorPercent: 65,
    netRoofCoveragePercent: 29.3,
    summary:
      'Accounts generously for RCC parapets, overhead water tanks, staircase headrooms, shading setbacks, and wide maintenance walkways.',
  },
  moderate: {
    id: 'moderate',
    label: 'Moderate Planning Scenario (Default)',
    shortLabel: 'Moderate',
    usableRoofFractionPercent: 55,
    packingFactorPercent: 72,
    netRoofCoveragePercent: 39.6,
    summary:
      'Balanced institutional flat-RCC roof layout with standard perimeter setbacks, walkway clearances, and 10° tilted inter-row pitch.',
  },
  high_theoretical: {
    id: 'high_theoretical',
    label: 'High-Utilisation Theoretical Ceiling',
    shortLabel: 'High-Utilisation',
    usableRoofFractionPercent: 65,
    packingFactorPercent: 80,
    netRoofCoveragePercent: 52.0,
    summary:
      'Upper-bound physical envelope assuming minimal roof obstructions and tight inter-row spacing — requires structural & shading confirmation.',
  },
};

export interface SolarAssumptions {
  searchRadiusMeters: number;
  planningScenario?: SolarPlanningScenarioId;
  usableRoofFractionPercent: number;
  panelRatedWatts: number;
  panelAreaM2: number;
  packingFactorPercent: number;
  systemLossesPercent: number;
  flatRoofTiltDegrees: number;
  flatRoofAspectDegrees: number;
  pvTechnology: PvgisTechnology;
  mountingPlace: PvgisMountingPlace;
  radiationDatabase: PvgisRadiationDatabaseChoice;
  provisionalFallbackRoofAreaM2: number;
  currency: 'INR';
  updatedAtMs?: number;
  updatedBy?: string | null;
}

export const DEFAULT_SOLAR_ASSUMPTIONS: SolarAssumptions = {
  searchRadiusMeters: 500,
  planningScenario: 'moderate',
  usableRoofFractionPercent: 55,
  panelRatedWatts: 550,
  panelAreaM2: 2.58,
  packingFactorPercent: 72,
  systemLossesPercent: 14,
  flatRoofTiltDegrees: 10,
  flatRoofAspectDegrees: 0,
  pvTechnology: 'crystSi',
  mountingPlace: 'free',
  radiationDatabase: 'PVGIS-SARAH3',
  provisionalFallbackRoofAreaM2: 500,
  currency: 'INR',
};

export interface BuildingSolarOverride {
  buildingId: string;
  selectionStatus: BuildingSelectionStatus;
  customName: string | null;
  campusLabel: string | null;
  usableRoofFractionPercent: number | null;
  roofTypeOverride: string | null;
  tiltDegreesOverride: number | null;
  aspectDegreesOverride: number | null;
  mountingPlaceOverride: PvgisMountingPlace | null;
  pvTechnologyOverride: PvgisTechnology | null;
  systemLossesOverride: number | null;
  manualCapacityKwpOverride: number | null;
  grossAreaOverrideM2: number | null;
  /** Separate visual placement offset (meters) — never overwrites confirmed analytical m² */
  offsetEastMeters?: number | null;
  offsetNorthMeters?: number | null;
  /** Optional admin-edited visual boundary polygon */
  customPolygons?: BuildingPolygon[] | null;
  /** Explicit admin confirmation of analytical roof dimensions */
  analyticalConfirmed?: boolean | null;
  relationshipNote?: string | null;
  updatedAtMs: number;
  updatedBy: string | null;
}

export interface PvgisMonthlyPoint {
  month: number;
  monthLabel: string;
  dailyAvgGenerationKwh: number;
  monthlyGenerationKwh: number;
  dailyInPlaneIrradiationKwhM2: number | null;
  monthlyInPlaneIrradiationKwhM2: number | null;
  monthlyStdDevKwh: number | null;
}

export interface PvgisSystemLosses {
  angleOfIncidencePercent: number | null;
  spectralEffectsPercent: number | null;
  temperatureAndLowIrradiancePercent: number | null;
  configuredSystemLossPercent: number;
  combinedLossPercent: number | null;
}

export interface PvgisModelMetadata {
  requestedDatabase: PvgisRadiationDatabaseChoice;
  usedRadiationDatabase: string;
  fallbackNotice: string | null;
  meteoDatabase: string | null;
  yearMin: number | null;
  yearMax: number | null;
  elevationMeters: number | null;
  horizonDatabase: string | null;
  useHorizon: boolean;
}

export type SolarEstimateProvenance =
  | 'pvgis_modelled'
  | 'pvgis_cached_last_successful'
  | 'preliminary_local_estimate';

export interface BuildingPvgisResult {
  provenance: SolarEstimateProvenance;
  provenanceLabel: string;
  configHash: string;
  calculatedAtMs: number;
  calculatedAtIst: string;
  latitude: number;
  longitude: number;
  peakPowerKwp: number;
  tiltDegrees: number;
  aspectDegrees: number;
  pvTechnology: PvgisTechnology;
  mountingPlace: PvgisMountingPlace;
  systemLossesPercent: number;
  annualGenerationKwh: number;
  monthlyAvgGenerationKwh: number;
  dailyAvgGenerationKwh: number;
  specificYieldKwhPerKwp: number;
  annualInPlaneIrradiationKwhM2: number | null;
  annualStdDevKwh: number | null;
  monthly: PvgisMonthlyPoint[];
  losses: PvgisSystemLosses;
  metadata: PvgisModelMetadata;
  fromCache: boolean;
  stale: boolean;
  warningNote: string | null;
}

export interface DiscoveredBuilding {
  id: string;
  source: BuildingSourceKind;
  sourceLabel: 'Image-reconstructed' | 'Administrator-confirmed' | 'Mapped geometry';
  featureKind: CampusFeatureKind;
  solarEligible: boolean;
  osmType: 'way' | 'relation' | 'manual' | 'reconstructed';
  osmId: string;
  displayName: string;
  shortLabel?: string;
  osmName: string | null;
  customName: string | null;
  campusLabel: string | null;
  buildingType: string | null;
  levels: number | null;
  heightMeters: number | null;
  parentBuildingId: string | null;
  relationshipNote: string | null;
  linkedRoomwiseBuilding: string | null;
  linkedRoomCount: number;
  linkedRatedCapacityWatts: number;
  analyticalConfirmed: boolean;
  visualMeta?: {
    roofColor: string;
    wallColor: string;
    orientationDeg: number;
    courtKind?: 'basketball' | 'football';
    roofDetailKind?: 'g3_notched' | 'mph_hall' | 'pp_l_wing' | 'ob_linear' | 'nb_courtyard' | 'generic';
  };
  tags: Record<string, string>;
  polygons: BuildingPolygon[];
  centroid: GeoPoint;
  distanceFromCampusMeters: number;
  insideSchoolBoundary: boolean;
  selectionStatus: BuildingSelectionStatus;
  geometry: {
    visualFootprintAreaM2: number;
    grossFootprintAreaM2: number;
    grossAreaSource: 'image_reconstructed' | 'osm_geometry' | 'admin_override' | 'manual_geometry';
    componentCount: number;
    hasInvalidGeometryWarning: boolean;
    duplicateOverlapNote: string | null;
  };
  roofConfig: {
    roofType: string;
    roofMetadataStatus: RoofMetadataStatus;
    tiltDegrees: number;
    tiltSource: 'osm_tag' | 'admin_override' | 'assumed_flat_default';
    aspectDegrees: number;
    aspectSource: 'osm_roof_direction' | 'admin_override' | 'assumed_south_default';
    osmRoofShape: string | null;
    osmRoofAngle: number | null;
    osmRoofDirection: string | null;
    osmRoofOrientation: string | null;
    osmRoofMaterial: string | null;
    osmRoofColour: string | null;
    roofOrientationNote: string | null;
    pvTechnology: PvgisTechnology;
    mountingPlace: PvgisMountingPlace;
    systemLossesPercent: number;
  };
  capacity: {
    usableRoofFractionPercent: number;
    usableRoofAreaM2: number;
    obstructionSetbackAreaM2: number;
    packingFactorPercent: number;
    effectivePackingAreaM2: number;
    estimatedPanelCount: number;
    estimatedPanelAreaM2: number;
    remainingUsableRoofAreaM2: number;
    rowSpacingWalkwayAreaM2: number;
    calculatedCapacityKwp: number;
    effectiveCapacityKwp: number;
    isManualCapacityOverride: boolean;
  };
  confidence: {
    level: BuildingDataConfidence;
    scorePercent: number;
    reasons: string[];
  };
  solarEstimate: BuildingPvgisResult | null;
  override: BuildingSolarOverride | null;
}

export interface SchoolBoundaryContext {
  osmId: string;
  name: string | null;
  polygons: BuildingPolygon[];
  areaM2: number;
}

export interface DiscoveryCacheMeta {
  status: 'ok' | 'stale' | 'empty' | 'unavailable';
  fromCache: boolean;
  stale: boolean;
  endpointUsed: string | null;
  searchRadiusMeters: number;
  fetchedAtMs: number | null;
  fetchedAtIst: string | null;
  cacheTtlDays: number;
  osmBuildingsCount: number;
  errorMessage: string | null;
}

export interface CampusMonthlySolarPoint {
  month: number;
  monthLabel: string;
  generationKwh: number;
  avgIrradiationKwhM2: number | null;
}

export interface SolarScenarioComparisonRow {
  scenarioId: Exclude<SolarPlanningScenarioId, 'custom'>;
  label: string;
  shortLabel: string;
  usableRoofFractionPercent: number;
  packingFactorPercent: number;
  netRoofCoveragePercent: number;
  usableRoofAreaM2: number;
  obstructionSetbackAreaM2: number;
  rowSpacingWalkwayAreaM2: number;
  estimatedPanelCount: number;
  estimatedPanelAreaM2: number;
  capacityKwp: number;
  annualGenerationKwh: number;
  monthlyGeneration: CampusMonthlySolarPoint[];
  summary: string;
}

export interface GridFeasibilityItem {
  id: string;
  label: string;
  status: 'unknown_pending_verification' | 'modelled_assumption';
  valueLabel: string;
  note: string;
}

export interface CampusSolarSummary {
  mode: 'mapped_buildings' | 'provisional_fallback';
  modeLabel: string;
  activeScenarioId: SolarPlanningScenarioId;
  activeScenarioLabel: string;
  discoveredBuildingsCount: number;
  selectedBuildingsCount: number;
  confirmedBuildingsCount: number;
  provisionalBuildingsCount: number;
  excludedBuildingsCount: number;
  calculatedBuildingsCount: number;
  combinedGrossFootprintAreaM2: number;
  combinedObstructionSetbackAreaM2: number;
  combinedUsableRoofAreaM2: number;
  combinedEstimatedPanelCount: number;
  combinedEstimatedPanelAreaM2: number;
  combinedRemainingUsableRoofAreaM2: number;
  combinedRowSpacingWalkwayAreaM2: number;
  combinedCapacityKwp: number;
  combinedAnnualGenerationKwh: number;
  combinedMonthlyAvgGenerationKwh: number;
  combinedDailyAvgGenerationKwh: number;
  weightedSpecificYieldKwhPerKwp: number;
  combinedMonthlyGeneration: CampusMonthlySolarPoint[];
  scenarioComparisons: SolarScenarioComparisonRow[];
  gridFeasibilityChecklist: GridFeasibilityItem[];
  provenanceLabel: string;
  fallbackNotice: string | null;
  provisionalScenarioEstimate: BuildingPvgisResult | null;
}

export interface RoomwiseDemandBenchmark {
  provenance: 'roomwise_sqlite_history' | 'provisional_demand_fallback';
  observedWindowDays: number;
  observedWindowKwh: number;
  observedAvgDailyKwh: number;
  annualizedEstimatedDemandKwh: number;
  annualizedEstimateDisclosure: string;
  installedRatedMaxKw: number;
  preRetrofitReferenceKw: number;
  currentTariffINR: number;
  gridCarbonFactorKgPerKwh: number;
  monthlyObservedKwh: Record<number, number>;
}

export interface MonthlyDemandVsSolarPoint {
  month: number;
  monthLabel: string;
  solarGenerationKwh: number;
  observedDemandKwh: number | null;
  estimatedMonthlyDemandKwh: number;
}

export interface CampusDemandComparison {
  provenance: 'roomwise_calculated_comparison';
  demandScopeNote: string;
  estimatedAnnualDemandKwh: number;
  estimatedAnnualSolarGenerationKwh: number;
  rawSolarContributionPercent: number;
  cappedDemandCoveragePercent: number;
  daytimeCoincidenceFactorUsed: number;
  activeSchoolDayShareUsed: number;
  estimatedDirectSelfConsumptionKwh: number;
  estimatedAnnualGridReductionPotentialKwh: number;
  remainingAnnualDemandKwh: number;
  surplusAnnualGenerationKwh: number;
  monthlyComparison: MonthlyDemandVsSolarPoint[];
  disclaimers: string[];
}

export interface ShortTermSkyContext {
  available: boolean;
  source: 'open-meteo';
  currentCloudCoverPercent: number | null;
  currentGhiWm2: number | null;
  todayPeakGhiWm2: number | null;
  todayPeakGtiWm2: number | null;
  fetchedAtIst: string | null;
  separationNote: string;
}

export interface PvgisHistoryRecord {
  id: string;
  scope: 'building' | 'campus' | 'provisional';
  targetLabel: string;
  configHash: string;
  createdAtMs: number;
  createdAtIst: string;
  latitude: number;
  longitude: number;
  peakPowerKwp: number;
  pvTech: PvgisTechnology;
  mountingPlace: PvgisMountingPlace;
  tiltDegrees: number;
  aspectDegrees: number;
  lossPercent: number;
  usedRadiationDatabase: string;
  annualGenerationKwh: number;
  specificYieldKwhPerKwp: number;
  provenance: SolarEstimateProvenance;
}

export interface SolarWorkspaceResponse {
  ok: boolean;
  campus: {
    institutionName: string;
    locationLabel: string;
    latitude: number;
    longitude: number;
    coordinatesVerifiedByAdmin: boolean;
  };
  assumptions: SolarAssumptions;
  discovery: DiscoveryCacheMeta;
  campusLayout: CampusVisualOverlay;
  schoolBoundaries: SchoolBoundaryContext[];
  buildings: DiscoveredBuilding[];
  campusSummary: CampusSolarSummary;
  roomwiseDemand: RoomwiseDemandBenchmark;
  demandComparison: CampusDemandComparison;
  shortTermSkyContext: ShortTermSkyContext;
  history: PvgisHistoryRecord[];
  attributions: {
    osm: {
      text: string;
      url: string;
      licenseText: string;
      licenseUrl: string;
    };
    pvgis: {
      text: string;
      url: string;
    };
  };
  limitations: string[];
  generatedAtIst: string;
}
