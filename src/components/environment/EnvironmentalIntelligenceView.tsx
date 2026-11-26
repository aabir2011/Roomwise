/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CloudSun,
  RefreshCw,
  Thermometer,
  Droplets,
  Wind,
  Sun,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Calendar,
  History,
  Activity,
  ExternalLink,
  ChevronDown,
  Lock,
  Sparkles,
  Gauge,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth, authFetch } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  ActionButton,
  InlineActionLink,
  PageHeader,
  SectionHeading,
  SegmentedControl,
} from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';
import { MathText } from '../common/MathText';
import type { EnvironmentalOverviewResponse } from '../../types/environmental';

type EnvSection = 'overview' | 'forecast' | 'air-quality' | 'radiation' | 'archive';

const ENV_CACHE_TTL_MS = 3 * 60 * 1000;
const cachedEnvOverview = new Map<string, { data: EnvironmentalOverviewResponse; fetchedAt: number }>();

interface EnvironmentalIntelligenceViewProps {
  embedded?: boolean;
  onNavigateSolar?: () => void;
}

function fmtNum(val: number | null | undefined, digits = 1, suffix = ''): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `${val.toFixed(digits)}${suffix}`;
}

export const EnvironmentalIntelligenceView: React.FC<EnvironmentalIntelligenceViewProps> = ({
  embedded = false,
  onNavigateSolar,
}) => {
  const { setSelectedRoomId, setActiveTab } = useEnergy();
  const { isAdminUnlocked, openAuthModal } = useAuth();
  const toast = useToast();

  // Configurable GTI panel orientation for Open-Meteo solar radiation
  const [gtiTilt, setGtiTilt] = useState<number>(22);
  const [gtiAzimuth, setGtiAzimuth] = useState<number>(0);

  const initialCacheEntry = cachedEnvOverview.get('22_0');
  const [data, setData] = useState<EnvironmentalOverviewResponse | null>(
    () => initialCacheEntry?.data ?? null
  );
  const [loading, setLoading] = useState(!initialCacheEntry);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<EnvSection>('overview');

  const fetchOverview = useCallback(
    async (opts?: { tilt?: number; azimuth?: number; forceAdminRefresh?: boolean; silent?: boolean }) => {
      const tilt = opts?.tilt ?? gtiTilt;
      const azimuth = opts?.azimuth ?? gtiAzimuth;
      const cacheKey = `${tilt}_${azimuth}`;
      if (opts?.forceAdminRefresh) {
        setRefreshing(true);
      } else if (!opts?.silent) {
        setLoading((prev) => (cachedEnvOverview.has(cacheKey) ? prev : true));
      }
      setError(null);

      try {
        let res: Response;
        if (opts?.forceAdminRefresh) {
          res = await authFetch('/api/environment/refresh', {
            method: 'POST',
            body: JSON.stringify({ tiltDeg: tilt, azimuthDeg: azimuth }),
          });
        } else {
          res = await authFetch(
            `/api/environment/overview?tilt=${encodeURIComponent(tilt)}&azimuth=${encodeURIComponent(azimuth)}`
          );
        }
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Environmental service returned HTTP ${res.status}.`);
        }
        const payload = json as EnvironmentalOverviewResponse;
        cachedEnvOverview.set(cacheKey, { data: payload, fetchedAt: Date.now() });
        setData(payload);
        if (opts?.forceAdminRefresh) {
          toast.success('Environmental data refreshed', 'Fetched latest Open-Meteo model feeds.');
        }
      } catch (err: any) {
        const msg = err?.message || 'Unable to load Open-Meteo environmental data.';
        if (!cachedEnvOverview.has(cacheKey)) {
          setError(msg);
        }
        if (opts?.forceAdminRefresh) {
          toast.error('Refresh failed', msg);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [gtiTilt, gtiAzimuth, toast]
  );

  useEffect(() => {
    const entry = cachedEnvOverview.get(`${gtiTilt}_${gtiAzimuth}`);
    if (entry && Date.now() - entry.fetchedAt < ENV_CACHE_TTL_MS) {
      setData(entry.data);
      setLoading(false);
      return;
    }
    void fetchOverview({ silent: Boolean(entry) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefreshClick = () => {
    if (!isAdminUnlocked) {
      openAuthModal(() => {
        void fetchOverview({ forceAdminRefresh: true });
      });
      return;
    }
    void fetchOverview({ forceAdminRefresh: true });
  };

  const timeline72h = useMemo(() => {
    if (!data) return [];
    const past = data.hourlyPast24h.slice(-24);
    const future = data.hourlyForecast.slice(0, 48);
    return [...past, ...future].map((h) => ({
      time: h.hourIst,
      fullLabel: h.labelIst,
      phase: h.isHistorical ? 'Past 24h' : 'Forecast',
      temp: h.temperatureC,
      apparent: h.apparentTemperatureC,
      humidity: h.relativeHumidityPercent,
      cloud: h.cloudCoverPercent,
      precipProb: h.precipitationProbabilityPercent,
    }));
  }, [data]);

  const radiationChartData = useMemo(() => {
    if (!data?.solarRadiation) return [];
    return data.solarRadiation.hourlySeries.map((p) => ({
      time: p.hourIst,
      fullLabel: p.labelIst,
      ghi: p.ghiWm2,
      gti: p.gtiWm2,
      dni: p.dniWm2,
      diffuse: p.diffuseWm2,
    }));
  }, [data]);

  const airQualityChartData = useMemo(() => {
    if (!data?.airQuality) return [];
    return data.airQuality.hourlyForecast.slice(0, 36).map((p) => ({
      time: p.hourIst,
      fullLabel: p.labelIst,
      pm25: p.pm25UgM3,
      pm10: p.pm10UgM3,
      o3: p.o3UgM3,
    }));
  }, [data]);

  const archiveChartData = useMemo(() => {
    if (!data?.historicalArchive) return [];
    return data.historicalArchive.days.map((d) => ({
      date: d.label,
      maxTemp: d.maxTemperatureC,
      minTemp: d.minTemperatureC,
      rain: d.precipitationSumMm,
      sunHours: d.sunshineDurationHours,
    }));
  }, [data]);

  const content = (
    <div className="space-y-5 sm:space-y-6">
      {/* Sub-navigation + Freshness & Refresh bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="overflow-x-auto -mx-1 px-1 pb-0.5 max-w-full">
          <SegmentedControl
            layoutId="env-internal-tabs"
            size="sm"
            tone="light"
            value={section}
            onChange={setSection}
            options={[
              { id: 'overview', label: 'Overview', icon: CloudSun },
              { id: 'forecast', label: '72h Forecast', icon: Calendar },
              { id: 'air-quality', label: 'Air Quality', icon: Wind },
              { id: 'radiation', label: 'Radiation', icon: Sun },
              { id: 'archive', label: 'Historical', icon: History },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          {data && (
            <span className="font-mono tabular-nums whitespace-nowrap">
              {data.campus.latitude.toFixed(4)}°N, {data.campus.longitude.toFixed(4)}°E
              {data.freshness.forecast.fetchedAtIst
                ? ` · ${data.freshness.forecast.fetchedAtIst} IST`
                : ''}
            </span>
          )}
          <ActionButton
            variant="secondary"
            size="sm"
            loading={refreshing}
            onClick={handleRefreshClick}
            icon={
              !isAdminUnlocked ? (
                <Lock className="w-3.5 h-3.5 text-[#5c6a64]" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-[#0b6e4f]" />
              )
            }
            title={
              isAdminUnlocked
                ? 'Force refresh Open-Meteo feeds'
                : 'Sign in as admin to force an uncached refresh'
            }
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </ActionButton>
        </div>
      </div>

      {/* Loading / Error State */}
      {loading && !data && (
        <div className="rw-surface rounded-2xl p-10 text-center space-y-2">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-700 mx-auto" />
          <div className="text-xs font-semibold text-neutral-800">
            Loading Open-Meteo environmental feeds for Kharagpur...
          </div>
          <div className="text-[11px] text-neutral-500">
            Fetching Forecast, CAMS Air Quality, Solar Radiation, and Historical Reanalysis server-side.
          </div>
        </div>
      )}

      {error && !data && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">External Open-Meteo feed unavailable</div>
              <div className="text-amber-900 mt-0.5">{error}</div>
            </div>
          </div>
          <ActionButton
            variant="amber"
            size="sm"
            onClick={() => void fetchOverview()}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry
          </ActionButton>
        </div>
      )}

      {data && (
        <>
          {/* Stale / Partial Feed Notice */}
          {(data.freshness.forecast.status !== 'ok' ||
            data.freshness.airQuality.status !== 'ok' ||
            data.freshness.archive.status !== 'ok') && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-[11px] text-amber-950 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>
                One or more Open-Meteo feeds are serving cached or partial data (Forecast:{' '}
                <strong>{data.freshness.forecast.status}</strong>, Air Quality:{' '}
                <strong>{data.freshness.airQuality.status}</strong>, Archive:{' '}
                <strong>{data.freshness.archive.status}</strong>). Local ROOMWISE classroom sensors
                continue operating independently.
              </span>
            </div>
          )}

          {/* TAB 1: OVERVIEW & CLASSROOM CONTEXT */}
          {section === 'overview' && (
            <div className="space-y-5">
              {/* Signature Atmospheric Observatory Hero Strip (Obsidian-Pine + Sky Gradient + 3-Col Hairline Sheet) */}
              <div className="rounded-xl border border-[rgba(17,25,22,0.12)] bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-12 shadow-[0_1px_2px_rgba(11,23,19,0.03)]">
                <div className="lg:col-span-4 bg-[radial-gradient(circle_at_top_right,rgba(14,107,168,0.28),transparent_56%),radial-gradient(circle_at_bottom_left,rgba(52,211,153,0.16),transparent_60%),linear-gradient(155deg,#091511_0%,#0d221b_54%,#102b24_100%)] text-[#f4f6f4] p-5 flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.1em] text-[#34d399]">
                    <span>Outdoor Microclimate · Kharagpur</span>
                    <Thermometer className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-mono text-3xl sm:text-4xl font-semibold text-white tabular-nums tracking-tight">
                        {fmtNum(data.current?.temperatureC, 1, '°C')}
                      </span>
                      <span className="text-xs text-[#9cb0a7] font-mono tabular-nums">
                        Feels {fmtNum(data.current?.apparentTemperatureC, 1, '°C')}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[#d6e4de] truncate">
                      {data.current?.condition.description || 'Unavailable'}
                    </div>
                  </div>
                  <div className="pt-2.5 border-t border-white/10 text-[10.5px] font-mono text-[#8ba097] flex items-center justify-between">
                    <span>Open-Meteo model-derived</span>
                    <span>22.31°N · 87.31°E</span>
                  </div>
                </div>

                <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[rgba(17,25,22,0.09)]">
                  <div className="p-5 flex flex-col justify-between gap-2">
                    <div className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.07em] text-[#5c6a64] font-semibold">
                      <span>Humidity &amp; Wind</span>
                      <Droplets className="w-3.5 h-3.5 text-[#0e6ba8]" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-semibold font-mono text-[#111916] tabular-nums">
                      {fmtNum(data.current?.relativeHumidityPercent, 0, '%')}
                    </div>
                    <div className="space-y-0.5 text-[11px] font-mono text-[#5c6a64] tabular-nums">
                      <div>
                        Dew {fmtNum(data.current?.dewPointC, 1, '°C')} · Wind{' '}
                        {fmtNum(data.current?.windSpeedKmh, 1, ' km/h')}
                      </div>
                      <div className="text-[10.5px] text-[#7a8982]">
                        Pressure {fmtNum(data.current?.surfacePressureHpa, 0, ' hPa')}
                      </div>
                    </div>
                  </div>

                  <div className="p-5 flex flex-col justify-between gap-2">
                    <div className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.07em] text-[#5c6a64] font-semibold">
                      <span>Sky &amp; Solar Flux</span>
                      <Sun className="w-3.5 h-3.5 text-[#b45309]" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-semibold font-mono text-[#111916] tabular-nums">
                      {fmtNum(data.current?.cloudCoverPercent, 0, '%')}
                    </div>
                    <div className="space-y-0.5 text-[11px] font-mono text-[#5c6a64] tabular-nums">
                      <div>
                        Cloud · <AcronymHint term="GHI" /> {fmtNum(data.current?.shortwaveRadiationWm2, 0, ' W/m²')}
                      </div>
                      <div className="text-[10.5px] text-[#7a8982]">
                        Peak 24h GHI {fmtNum(data.solarRadiation?.todayPeakGhiWm2, 0, ' W/m²')}
                      </div>
                    </div>
                  </div>

                  <div className="p-5 flex flex-col justify-between gap-2 bg-gradient-to-br from-[#f6fbf8] to-[#e9f4ee]">
                    <div className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.07em] text-[#0b6e4f] font-semibold">
                      <span>Campus Indoor Avg</span>
                      <Gauge className="w-3.5 h-3.5 text-[#0b6e4f]" />
                    </div>
                    <div className="text-2xl sm:text-3xl font-semibold font-mono text-[#0b1713] tabular-nums">
                      {data.indoorCampusSnapshot.avgIndoorTempC.toFixed(1)}°C
                    </div>
                    <div className="space-y-0.5 text-[11px] font-mono text-[#0b6e4f] tabular-nums">
                      <div>
                        {data.indoorCampusSnapshot.avgIndoorHumidityPercent}% RH ·{' '}
                        {data.indoorCampusSnapshot.avgNaturalDaylightLux} lx <AcronymHint term="LDR" />
                      </div>
                      <div className="text-[10.5px] text-[#4a5851]">
                        25 local room nodes
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Unified 3-Column Hairline Advisory Matrix */}
              <div className="rounded-xl border border-[rgba(17,25,22,0.1)] bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-[rgba(17,25,22,0.09)]">
                <div className="p-5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] font-mono font-semibold uppercase tracking-[0.08em] text-[#0b6e4f]">
                        01 · Cooling Anticipation
                      </span>
                      <span
                        className={`text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded border ${
                          data.insights.coolingAnticipation.advisoryLevel === 'elevated'
                            ? 'bg-[#fffbeb] text-[#92400e] border-[#f59e0b]/40'
                            : data.insights.coolingAnticipation.advisoryLevel === 'moderate'
                            ? 'bg-[#eff6ff] text-[#0e6ba8] border-[#0e6ba8]/25'
                            : 'bg-[#eef6f2] text-[#0b6e4f] border-[#0b6e4f]/25'
                        }`}
                      >
                        {data.insights.coolingAnticipation.advisoryLevel}
                      </span>
                    </div>
                    <h3 className="font-display text-[15px] font-semibold text-[#111916] leading-snug">
                      {data.insights.coolingAnticipation.headline}
                    </h3>
                    <p className="text-xs text-[#4a5851] leading-relaxed">
                      {data.insights.coolingAnticipation.summary}
                    </p>
                  </div>
                  <p className="text-[11px] text-[#5c6a64] border-t border-[rgba(17,25,22,0.08)] pt-2.5 leading-relaxed">
                    {data.insights.coolingAnticipation.recommendedAction}
                  </p>
                </div>

                <div className="p-5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] font-mono font-semibold uppercase tracking-[0.08em] text-[#0b6e4f]">
                        02 · Daylight Intelligence
                      </span>
                      <span className="text-[10.5px] font-mono font-semibold text-[#5c6a64] tabular-nums">
                        {data.insights.daylightIntelligence.highDaylightRoomsCount}/25 high-lux
                      </span>
                    </div>
                    <h3 className="font-display text-[15px] font-semibold text-[#111916] leading-snug">
                      {data.insights.daylightIntelligence.headline}
                    </h3>
                    <p className="text-xs text-[#4a5851] leading-relaxed">
                      {data.insights.daylightIntelligence.summary}
                    </p>
                  </div>
                  <p className="text-[11px] text-[#0b6e4f] font-medium border-t border-[rgba(17,25,22,0.08)] pt-2.5 leading-relaxed">
                    {data.insights.daylightIntelligence.authorityNotice}
                  </p>
                </div>

                <div className="p-5 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] font-mono font-semibold uppercase tracking-[0.08em] text-[#0b6e4f]">
                        03 · Weather-Aware Outlook
                      </span>
                      <Sparkles className="w-3.5 h-3.5 text-[#0b6e4f]" />
                    </div>
                    <h3 className="font-display text-[15px] font-semibold text-[#111916] leading-snug">
                      {data.insights.energyOutlook.headline}
                    </h3>
                    <p className="text-xs text-[#4a5851] leading-relaxed">
                      {data.insights.energyOutlook.narrative}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-[#313e38] border-t border-[rgba(17,25,22,0.08)] pt-2.5 tabular-nums">
                    <span>
                      30d avg:{' '}
                      <strong className="text-[#111916]">
                        {fmtNum(data.insights.energyOutlook.historical30DayAvgDailyKWh, 1, ' kWh/d')}
                      </strong>
                    </span>
                    <span>
                      7d avg:{' '}
                      <strong className="text-[#111916]">
                        {fmtNum(data.insights.energyOutlook.recent7DayAvgDailyKWh, 1, ' kWh/d')}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Environmental Anomalies (only prominent when detected) */}
              {data.insights.anomalies.length > 0 && (
                <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-3">
                  <SectionHeading
                    title="Cross-Check Advisories (Indoor vs Outdoor)"
                    subtitle="Flags classrooms where local DHT11/LDR or load readings diverge meaningfully from external sky & thermal conditions."
                    meta={`${data.insights.anomalies.length} items`}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {data.insights.anomalies.map((item) => (
                      <div
                        key={item.id}
                        className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                          item.severity === 'warning'
                            ? 'bg-amber-50/70 border-amber-200'
                            : 'bg-neutral-50 border-neutral-200/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-neutral-900">{item.title}</span>
                          {item.roomId && (
                            <InlineActionLink
                              tone="emerald"
                              onClick={() => setSelectedRoomId(item.roomId!)}
                              trailingIcon={<ArrowRight className="w-3 h-3" />}
                              className="shrink-0"
                            >
                              Inspect Room
                            </InlineActionLink>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-600 leading-relaxed">
                          {item.explanation}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-mono text-neutral-700">
                          <span>Indoor: {item.indoorMetric}</span>
                          <span>Outdoor: {item.outdoorMetric}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Room-by-Room Indoor vs Outdoor Table */}
              <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-3">
                <SectionHeading
                  title="Classroom Sensor Context (25 Local Nodes vs Outdoor Model)"
                  subtitle="Local room PIR, LDR, and DHT11 states govern classroom automation; Open-Meteo provides regional outdoor context."
                  action={
                    <InlineActionLink
                      tone="emerald"
                      onClick={onNavigateSolar ?? (() => setActiveTab('solar'))}
                      icon={<Sun className="w-3.5 h-3.5" />}
                      trailingIcon={<ArrowRight className="w-3.5 h-3.5" />}
                    >
                      Open Solar PVGIS Model
                    </InlineActionLink>
                  }
                />

                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full min-w-[680px] text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        <th className="py-2.5 px-3 whitespace-nowrap">Room</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Indoor Temp</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap normal-case">
                          <MathText tex="\Delta T_{\mathrm{out}}" ariaLabel="Delta outdoor temperature" />
                        </th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Natural LDR</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Live Load</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Context</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {data.insights.roomComparisons.map((r) => (
                        <tr
                          key={r.roomId}
                          onClick={() => setSelectedRoomId(r.roomId)}
                          className="hover:bg-emerald-50/40 cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-neutral-900 font-mono">{r.roomCode}</div>
                            <div className="text-[11px] text-neutral-500 truncate max-w-[160px]">
                              {r.name}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`text-[11px] font-semibold ${
                                r.occupancyStatus === 'Occupied'
                                  ? 'text-emerald-800'
                                  : 'text-neutral-500'
                              }`}
                            >
                              {r.occupancyStatus}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-neutral-900">
                            {r.indoorTempC.toFixed(1)}°C
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {r.tempDeltaVsOutdoorC === null
                              ? '—'
                              : `${r.tempDeltaVsOutdoorC >= 0 ? '+' : ''}${r.tempDeltaVsOutdoorC.toFixed(1)}°C`}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-neutral-700">
                            {r.indoorNaturalLux} lx
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-neutral-900">
                            {r.currentPowerWatts} W
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-neutral-600 max-w-[260px]">
                            {r.contextNote}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 72-HOUR & MULTI-DAY FORECAST */}
          {section === 'forecast' && (
            <div className="space-y-5 sm:space-y-6">
              <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
                <SectionHeading
                  title="72-Hour Continuous Temperature & Cloud Profile (IST)"
                  subtitle="Past 24h model continuity combined with the next 48h Open-Meteo hourly forecast."
                  meta={`${timeline72h.length} hourly points`}
                />
                <div className="h-64 sm:h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeline72h} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,25,22,0.08)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#5c6a64' }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis yAxisId="temp" tick={{ fontSize: 10, fill: '#5c6a64' }} unit="°C" />
                      <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10, fill: '#5c6a64' }} domain={[0, 100]} unit="%" />
                      <RechartsTooltip
                        contentStyle={{
                          fontSize: 11,
                          borderRadius: 10,
                          backgroundColor: '#0b1713',
                          borderColor: 'rgba(255,255,255,0.14)',
                          color: '#f4f6f4',
                        }}
                        itemStyle={{ color: '#e4ece8' }}
                        labelStyle={{ color: '#34d399', fontFamily: 'IBM Plex Mono, monospace', marginBottom: 4 }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ''}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area
                        yAxisId="pct"
                        type="monotone"
                        dataKey="cloud"
                        name="Cloud Cover (%)"
                        fill="#bae6fd"
                        fillOpacity={0.32}
                        stroke="#0e6ba8"
                        strokeWidth={1.5}
                      />
                      <Line
                        yAxisId="temp"
                        type="monotone"
                        dataKey="temp"
                        name="Air Temp (°C)"
                        stroke="#0b6e4f"
                        strokeWidth={2.2}
                        dot={false}
                      />
                      <Line
                        yAxisId="temp"
                        type="monotone"
                        dataKey="apparent"
                        name="Feels Like (°C)"
                        stroke="#b45309"
                        strokeWidth={1.8}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
                <SectionHeading
                  title={`Multi-Day Forecast (${data.dailyForecast.length} Days Returned)`}
                  subtitle="Daily outdoor extremes, sunrise/sunset in IST, sunshine duration, and precipitation probability."
                />
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full min-w-[680px] text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-neutral-200 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        <th className="py-2.5 px-3 whitespace-nowrap">Date (IST)</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Condition</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">High / Low</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Rain</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Sunshine</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">UV Max</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Sunrise / Sunset</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {data.dailyForecast.map((d) => (
                        <tr key={d.dateKey} className="hover:bg-neutral-50/70">
                          <td className="py-2.5 px-3 font-semibold text-neutral-900 whitespace-nowrap">
                            {d.label}
                          </td>
                          <td className="py-2.5 px-3 text-neutral-700">{d.condition.description}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                            <span className="text-neutral-900">{fmtNum(d.maxTemperatureC, 1, '°')}</span>
                            <span className="text-neutral-400"> / </span>
                            <span className="text-neutral-600">{fmtNum(d.minTemperatureC, 1, '°')}</span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-neutral-700">
                            {fmtNum(d.precipitationProbabilityMaxPercent, 0, '%')} ·{' '}
                            {fmtNum(d.precipitationSumMm, 1, ' mm')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-neutral-700">
                            {fmtNum(d.sunshineDurationHours, 1, ' h')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-neutral-700">
                            {fmtNum(d.uvIndexMax, 1)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-neutral-600 whitespace-nowrap">
                            {d.sunriseIst || '—'} / {d.sunsetIst || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AIR QUALITY (COPERNICUS CAMS VIA OPEN-METEO) */}
          {section === 'air-quality' && (
            <div className="space-y-5 sm:space-y-6">
              {data.airQuality ? (
                <>
                  <div className="rounded-2xl border border-sky-200/80 bg-sky-50/60 p-3.5 sm:p-4 text-xs text-sky-950 flex items-start gap-2.5">
                    <Activity className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-bold">{data.airQuality.modelLabel}</div>
                      <p className="text-[11px] text-sky-900 leading-relaxed">
                        {data.airQuality.limitationsNote}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      { label: 'PM2.5', val: data.airQuality.current?.pm25UgM3, unit: 'μg/m³' },
                      { label: 'PM10', val: data.airQuality.current?.pm10UgM3, unit: 'μg/m³' },
                      { label: 'Ozone (O₃)', val: data.airQuality.current?.o3UgM3, unit: 'μg/m³' },
                      { label: 'Nitrogen Dioxide (NO₂)', val: data.airQuality.current?.no2UgM3, unit: 'μg/m³' },
                      { label: 'Sulphur Dioxide (SO₂)', val: data.airQuality.current?.so2UgM3, unit: 'μg/m³' },
                      { label: 'Carbon Monoxide (CO)', val: data.airQuality.current?.coUgM3, unit: 'μg/m³' },
                      { label: 'Mineral Dust', val: data.airQuality.current?.dustUgM3, unit: 'μg/m³' },
                      { label: 'UV Index', val: data.airQuality.current?.uvIndex, unit: 'index' },
                    ].map((p) => (
                      <div key={p.label} className="rw-surface rounded-2xl p-4">
                        <div className="text-[11px] font-semibold text-neutral-500">{p.label}</div>
                        <div className="mt-1.5 flex items-baseline gap-1.5">
                          <span className="text-xl sm:text-2xl font-bold font-mono text-neutral-900 tabular-nums">
                            {fmtNum(p.val, p.label.includes('CO') ? 0 : 1)}
                          </span>
                          <span className="text-[11px] text-neutral-500">{p.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
                    <SectionHeading
                      title="Short-Term Regional Pollutant Forecast (36h, IST)"
                      subtitle="Modelled hourly PM2.5, PM10, and surface Ozone concentrations (μg/m³)."
                      meta={data.airQuality.current?.timeIst || 'IST'}
                    />
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={airQualityChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={26} />
                          <YAxis tick={{ fontSize: 10 }} unit=" μg/m³" />
                          <RechartsTooltip
                            contentStyle={{ fontSize: 11, borderRadius: 12, borderColor: '#d1d5db' }}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ''}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Area
                            type="monotone"
                            dataKey="pm10"
                            name="PM10 (μg/m³)"
                            fill="#fde68a"
                            fillOpacity={0.35}
                            stroke="#d97706"
                            strokeWidth={1.6}
                          />
                          <Line
                            type="monotone"
                            dataKey="pm25"
                            name="PM2.5 (μg/m³)"
                            stroke="#b91c1c"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="o3"
                            name="Ozone O₃ (μg/m³)"
                            stroke="#0369a1"
                            strokeWidth={1.8}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rw-surface rounded-2xl p-8 text-center text-xs text-neutral-500">
                  Open-Meteo CAMS Air Quality feed is currently unavailable.
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SOLAR RADIATION (OPEN-METEO) */}
          {section === 'radiation' && (
            <div className="space-y-5 sm:space-y-6">
              {data.solarRadiation ? (
                <>
                  <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-neutral-200/70 pb-4">
                      <div>
                        <h2 className="text-sm sm:text-[15px] font-bold text-neutral-900">
                          Hourly Solar Irradiance Profile (W/m²)
                        </h2>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {data.solarRadiation.next24hClearSkySummary}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-end gap-2.5 text-xs">
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold text-neutral-600">
                            GTI Tilt (°)
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={90}
                            value={gtiTilt}
                            onChange={(e) => setGtiTilt(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
                            className="w-20 px-2.5 py-1.5 glass-input rounded-lg font-mono text-xs tabular-nums"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold text-neutral-600">
                            Azimuth (0°=S)
                          </span>
                          <input
                            type="number"
                            min={-180}
                            max={180}
                            value={gtiAzimuth}
                            onChange={(e) =>
                              setGtiAzimuth(Math.max(-180, Math.min(180, Number(e.target.value) || 0)))
                            }
                            className="w-24 px-2.5 py-1.5 glass-input rounded-lg font-mono text-xs tabular-nums"
                          />
                        </label>
                        <ActionButton
                          variant="primary"
                          size="sm"
                          onClick={() => void fetchOverview({ tilt: gtiTilt, azimuth: gtiAzimuth })}
                        >
                          Update GTI
                        </ActionButton>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl bg-neutral-50 border border-neutral-200/80 p-3.5">
                        <div className="text-[11px] font-semibold text-neutral-500">
                          Peak 24h <AcronymHint term="GHI" /> (Horizontal)
                        </div>
                        <div className="text-xl font-bold font-mono text-neutral-900 mt-1 tabular-nums">
                          {fmtNum(data.solarRadiation.todayPeakGhiWm2, 0, ' W/m²')}
                        </div>
                      </div>
                      <div className="rounded-xl bg-emerald-50/50 border border-emerald-200/70 p-3.5">
                        <div className="text-[11px] font-semibold text-emerald-900">
                          Peak 24h <AcronymHint term="GTI" /> ({data.solarRadiation.configuredTiltDeg}° / {data.solarRadiation.configuredAzimuthDeg}°)
                        </div>
                        <div className="text-xl font-bold font-mono text-emerald-950 mt-1 tabular-nums">
                          {fmtNum(data.solarRadiation.todayPeakGtiWm2, 0, ' W/m²')}
                        </div>
                      </div>
                      <div className="rounded-xl bg-neutral-50 border border-neutral-200/80 p-3.5">
                        <div className="text-[11px] font-semibold text-neutral-500">
                          Peak 24h Direct Normal (<AcronymHint term="DNI" />)
                        </div>
                        <div className="text-xl font-bold font-mono text-neutral-900 mt-1 tabular-nums">
                          {fmtNum(data.solarRadiation.todayPeakDniWm2, 0, ' W/m²')}
                        </div>
                      </div>
                    </div>

                    <div className="h-64 sm:h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={radiationChartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={26} />
                          <YAxis tick={{ fontSize: 10 }} unit=" W/m²" />
                          <RechartsTooltip
                            contentStyle={{ fontSize: 11, borderRadius: 12, borderColor: '#d1d5db' }}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ''}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Area
                            type="monotone"
                            dataKey="gti"
                            name="Tilted GTI (W/m²)"
                            fill="#a7f3d0"
                            fillOpacity={0.35}
                            stroke="#047857"
                            strokeWidth={2}
                          />
                          <Line
                            type="monotone"
                            dataKey="ghi"
                            name="Shortwave GHI (W/m²)"
                            stroke="#d97706"
                            strokeWidth={1.8}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="diffuse"
                            name="Diffuse DHI (W/m²)"
                            stroke="#0284c7"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                      {data.solarRadiation.temporalResolutionNote} {data.solarRadiation.azimuthConventionNote}
                    </p>
                  </div>
                </>
              ) : (
                <div className="rw-surface rounded-2xl p-8 text-center text-xs text-neutral-500">
                  Open-Meteo solar radiation data is currently unavailable.
                </div>
              )}
            </div>
          )}

          {/* TAB 5: HISTORICAL REANALYSIS */}
          {section === 'archive' && (
            <div className="space-y-5 sm:space-y-6">
              {data.historicalArchive ? (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    <div className="rw-surface rounded-2xl p-4">
                      <div className="text-[11px] font-semibold text-neutral-500">
                        Reanalysis Window
                      </div>
                      <div className="mt-1.5 text-lg font-bold font-mono text-neutral-900 tabular-nums">
                        {data.historicalArchive.daysCovered} Days
                      </div>
                      <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                        {data.historicalArchive.startDate} → {data.historicalArchive.endDate}
                      </div>
                    </div>
                    <div className="rw-surface rounded-2xl p-4">
                      <div className="text-[11px] font-semibold text-neutral-500">
                        Mean High / Low
                      </div>
                      <div className="mt-1.5 text-lg font-bold font-mono text-neutral-900 tabular-nums">
                        {fmtNum(data.historicalArchive.meanMaxTempC, 1, '°')} /{' '}
                        {fmtNum(data.historicalArchive.meanMinTempC, 1, '°')}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">ERA5 reanalysis daily avg</div>
                    </div>
                    <div className="rw-surface rounded-2xl p-4">
                      <div className="text-[11px] font-semibold text-neutral-500">
                        Cumulative Rainfall
                      </div>
                      <div className="mt-1.5 text-lg font-bold font-mono text-neutral-900 tabular-nums">
                        {fmtNum(data.historicalArchive.totalPrecipitationMm, 1, ' mm')}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">Across archive window</div>
                    </div>
                    <div className="rw-surface rounded-2xl p-4">
                      <div className="text-[11px] font-semibold text-neutral-500">
                        Mean Daily Sunshine
                      </div>
                      <div className="mt-1.5 text-lg font-bold font-mono text-neutral-900 tabular-nums">
                        {fmtNum(data.historicalArchive.meanDailySunshineHours, 1, ' h/day')}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">Direct solar duration</div>
                    </div>
                  </div>

                  <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
                    <SectionHeading
                      title="Historical Daily Temperature & Rainfall (ERA5 Reanalysis)"
                      subtitle={data.historicalArchive.limitationNote}
                    />
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={archiveChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} />
                          <YAxis yAxisId="temp" tick={{ fontSize: 10 }} unit="°C" />
                          <YAxis yAxisId="rain" orientation="right" tick={{ fontSize: 10 }} unit=" mm" />
                          <RechartsTooltip
                            contentStyle={{ fontSize: 11, borderRadius: 12, borderColor: '#d1d5db' }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar yAxisId="rain" dataKey="rain" name="Rain (mm)" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                          <Line
                            yAxisId="temp"
                            type="monotone"
                            dataKey="maxTemp"
                            name="Daily Max (°C)"
                            stroke="#d97706"
                            strokeWidth={2}
                          />
                          <Line
                            yAxisId="temp"
                            type="monotone"
                            dataKey="minTemp"
                            name="Daily Min (°C)"
                            stroke="#047857"
                            strokeWidth={2}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rw-surface rounded-2xl p-8 text-center text-xs text-neutral-500">
                  Open-Meteo Historical Reanalysis feed is currently unavailable.
                </div>
              )}
            </div>
          )}

          {/* Collapsible Methodology & Limitations + Required CC BY 4.0 Attribution */}
          <div className="space-y-3 pt-1">
            <details className="rw-surface rounded-2xl p-4 group">
              <summary className="flex items-center justify-between cursor-pointer list-none text-xs font-bold text-neutral-800">
                <span>Methodology, Provenance &amp; Data Limitations</span>
                <ChevronDown className="w-4 h-4 text-neutral-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 pt-3 border-t border-neutral-200/70 grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-neutral-600 leading-relaxed">
                <div>
                  <strong className="text-neutral-900 block mb-0.5">
                    Model-Derived Weather vs On-Site Sensors
                  </strong>
                  Open-Meteo current conditions and forecasts come from numerical weather prediction
                  models interpolated to campus coordinates — not an on-campus weather station.
                  Local ROOMWISE <AcronymHint term="PIR" />, <AcronymHint term="LDR" />, and <AcronymHint term="DHT11" /> nodes remain solely authoritative for classroom
                  appliances.
                </div>
                <div>
                  <strong className="text-neutral-900 block mb-0.5">
                    Air Quality &amp; Archive Reanalysis Scope
                  </strong>
                  Air quality values originate from Copernicus <AcronymHint term="CAMS" /> global atmospheric modelling
                  (~40 km grid) and are displayed in μg/m³ without converting to an invented Indian
                  CPCB AQI. Historical weather uses gridded <AcronymHint term="ERA5" /> reanalysis (~5-day lag).
                </div>
              </div>
            </details>

            <footer className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1 text-[11px] text-neutral-500">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>{data.attribution.text}</span>
                <a
                  href={data.attribution.providerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-emerald-800 hover:underline"
                >
                  <span>open-meteo.com</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span>·</span>
                <a
                  href={data.attribution.licenseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-neutral-700 hover:underline"
                >
                  <span>{data.attribution.licenseLabel}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="font-mono tabular-nums text-[10.5px]">
                No API key required · Server-cached ({data.freshness.forecast.ttlMinutes}m /{' '}
                {data.freshness.airQuality.ttlMinutes}m / {Math.round(data.freshness.archive.ttlMinutes / 60)}h)
              </div>
            </footer>
          </div>
        </>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="px-3.5 pt-2.5 pb-6 sm:px-5 sm:pt-3 sm:pb-7 lg:px-7 lg:pt-3 lg:pb-8 space-y-4 sm:space-y-5 max-w-7xl mx-auto">
      <PageHeader
        kicker="Open-Meteo External Feeds · DAV Model School, IIT Kharagpur"
        title="Environmental Intelligence"
        subtitle="Model-derived outdoor weather, CAMS air quality, solar radiation, and ERA5 reanalysis paired with ROOMWISE's 25 local classroom nodes."
      />
      {content}
    </div>
  );
};
