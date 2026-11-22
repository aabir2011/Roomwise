/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type EnvironmentalDataProvenance =
  | 'open_meteo_current_model'
  | 'open_meteo_forecast_model'
  | 'open_meteo_reanalysis'
  | 'open_meteo_cams_air_quality'
  | 'open_meteo_solar_radiation'
  | 'roomwise_sensor_measurement'
  | 'roomwise_calculated_estimate';

export interface EnvironmentalConditionSummary {
  wmoCode: number | null;
  category: string;
  description: string;
  isDaytime: boolean | null;
}

export interface CurrentConditionsData {
  provenance: 'open_meteo_current_model';
  modelTimeIso: string | null;
  modelTimeIst: string | null;
  condition: EnvironmentalConditionSummary;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  dewPointC: number | null;
  cloudCoverPercent: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  surfacePressureHpa: number | null;
  uvIndex: number | null;
  shortwaveRadiationWm2: number | null;
}

export interface HourlyWeatherPoint {
  provenance: 'open_meteo_forecast_model';
  isHistorical: boolean;
  startTimeIso: string;
  labelIst: string;
  hourIst: string;
  dateIst: string;
  condition: EnvironmentalConditionSummary;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  precipitationProbabilityPercent: number | null;
  precipitationMm: number | null;
  cloudCoverPercent: number | null;
  windSpeedKmh: number | null;
  uvIndex: number | null;
  sunshineDurationMinutes: number | null;
  shortwaveRadiationWm2: number | null;
  directRadiationWm2: number | null;
  diffuseRadiationWm2: number | null;
  dniWm2: number | null;
  gtiWm2: number | null;
}

export interface DailyForecastDay {
  provenance: 'open_meteo_forecast_model';
  dateKey: string;
  label: string;
  condition: EnvironmentalConditionSummary;
  maxTemperatureC: number | null;
  minTemperatureC: number | null;
  apparentMaxC: number | null;
  apparentMinC: number | null;
  precipitationProbabilityMaxPercent: number | null;
  precipitationSumMm: number | null;
  uvIndexMax: number | null;
  sunshineDurationHours: number | null;
  shortwaveRadiationSumMjM2: number | null;
  sunriseIst: string | null;
  sunsetIst: string | null;
}

export interface HistoricalArchiveDay {
  dateKey: string;
  label: string;
  maxTemperatureC: number | null;
  minTemperatureC: number | null;
  meanTemperatureC: number | null;
  precipitationSumMm: number | null;
  sunshineDurationHours: number | null;
  shortwaveRadiationSumMjM2: number | null;
  windSpeedMaxKmh: number | null;
}

export interface HistoricalReanalysisOverview {
  provenance: 'open_meteo_reanalysis';
  datasetLabel: string;
  startDate: string;
  endDate: string;
  daysCovered: number;
  meanMaxTempC: number | null;
  meanMinTempC: number | null;
  totalPrecipitationMm: number | null;
  meanDailySunshineHours: number | null;
  days: HistoricalArchiveDay[];
  limitationNote: string;
}

export interface AirQualityPollutantSnapshot {
  timeIso: string | null;
  timeIst: string | null;
  pm25UgM3: number | null;
  pm10UgM3: number | null;
  no2UgM3: number | null;
  so2UgM3: number | null;
  o3UgM3: number | null;
  coUgM3: number | null;
  dustUgM3: number | null;
  uvIndex: number | null;
}

export interface AirQualityHourlyPoint {
  timeIso: string;
  labelIst: string;
  hourIst: string;
  pm25UgM3: number | null;
  pm10UgM3: number | null;
  o3UgM3: number | null;
  no2UgM3: number | null;
  uvIndex: number | null;
}

export interface AirQualityOverview {
  provenance: 'open_meteo_cams_air_quality';
  modelLabel: string;
  current: AirQualityPollutantSnapshot | null;
  hourlyForecast: AirQualityHourlyPoint[];
  limitationsNote: string;
}

export interface SolarRadiationContext {
  provenance: 'open_meteo_solar_radiation';
  configuredTiltDeg: number;
  configuredAzimuthDeg: number;
  azimuthConventionNote: string;
  temporalResolutionNote: string;
  todayPeakGhiWm2: number | null;
  todayPeakGtiWm2: number | null;
  todayPeakDniWm2: number | null;
  next24hClearSkySummary: string;
  hourlySeries: Array<{
    timeIso: string;
    labelIst: string;
    hourIst: string;
    ghiWm2: number | null;
    directWm2: number | null;
    diffuseWm2: number | null;
    dniWm2: number | null;
    gtiWm2: number | null;
    cloudCoverPercent: number | null;
  }>;
}

export interface EnvironmentalEndpointFreshness {
  status: 'ok' | 'stale' | 'unavailable';
  fromCache: boolean;
  stale: boolean;
  fetchedAtMs: number | null;
  fetchedAtIst: string | null;
  ttlMinutes: number;
  errorMessage?: string;
}

export interface CoolingAnticipationInsight {
  provenance: 'roomwise_calculated_estimate';
  advisoryLevel: 'low' | 'moderate' | 'elevated';
  headline: string;
  summary: string;
  peakOutdoorTempC: number | null;
  peakApparentTempC: number | null;
  peakHourIst: string | null;
  indoorAvgTempC: number;
  indoorOutdoorDeltaC: number | null;
  recommendedAction: string;
}

export interface DaylightIntelligenceInsight {
  provenance: 'roomwise_calculated_estimate';
  skyRegime: 'clear_bright' | 'mixed_cloud' | 'overcast_or_rain' | 'night' | 'unknown';
  headline: string;
  summary: string;
  externalCloudCoverPercent: number | null;
  currentGhiWm2: number | null;
  campusAvgNaturalLux: number;
  campusAvgAmbientLux: number;
  highDaylightRoomsCount: number;
  lowDaylightRoomsCount: number;
  authorityNotice: string;
}

export interface EnvironmentalAnomalyItem {
  id: string;
  severity: 'info' | 'warning';
  roomId?: string;
  roomCode?: string;
  roomName?: string;
  title: string;
  explanation: string;
  indoorMetric: string;
  outdoorMetric: string;
  recommendedCheck: string;
}

export interface WeatherAwareEnergyOutlook {
  provenance: 'roomwise_calculated_estimate';
  headline: string;
  narrative: string;
  historical30DayAvgDailyKWh: number | null;
  recent7DayAvgDailyKWh: number | null;
  expectedDemandBias: 'lower_than_typical' | 'typical' | 'higher_than_typical' | 'insufficient_data';
  coolingDemandDriver: string;
  lightingDemandDriver: string;
  disclaimer: string;
}

export interface RoomEnvironmentalContextRow {
  roomId: string;
  roomCode: string;
  name: string;
  building: string;
  floor: string;
  occupancyStatus: string;
  indoorTempC: number;
  indoorHumidityPercent: number;
  indoorNaturalLux: number;
  indoorAmbientLux: number;
  targetLux: number;
  currentPowerWatts: number;
  tempDeltaVsOutdoorC: number | null;
  daylightFlag: 'aligned' | 'check_glare_or_sensor' | 'check_shading_or_lights';
  contextNote: string;
}

export interface EnvironmentalOverviewResponse {
  ok: boolean;
  provider: 'open-meteo';
  campus: {
    institutionName: string;
    locationLabel: string;
    latitude: number;
    longitude: number;
    timezone: string;
    elevationMeters: number | null;
    coordinatesVerifiedByAdmin: boolean;
  };
  current: CurrentConditionsData | null;
  hourlyForecast: HourlyWeatherPoint[];
  hourlyPast24h: HourlyWeatherPoint[];
  dailyForecast: DailyForecastDay[];
  historicalArchive: HistoricalReanalysisOverview | null;
  airQuality: AirQualityOverview | null;
  solarRadiation: SolarRadiationContext | null;
  indoorCampusSnapshot: {
    provenance: 'roomwise_sensor_measurement';
    roomCount: number;
    occupiedRooms: number;
    avgIndoorTempC: number;
    avgIndoorHumidityPercent: number;
    avgNaturalDaylightLux: number;
    avgAmbientLux: number;
    totalLivePowerWatts: number;
  };
  insights: {
    coolingAnticipation: CoolingAnticipationInsight;
    daylightIntelligence: DaylightIntelligenceInsight;
    anomalies: EnvironmentalAnomalyItem[];
    energyOutlook: WeatherAwareEnergyOutlook;
    roomComparisons: RoomEnvironmentalContextRow[];
  };
  freshness: {
    forecast: EnvironmentalEndpointFreshness;
    airQuality: EnvironmentalEndpointFreshness;
    archive: EnvironmentalEndpointFreshness;
  };
  attribution: {
    text: string;
    providerUrl: string;
    licenseLabel: string;
    licenseUrl: string;
  };
  generatedAtIst: string;
}
