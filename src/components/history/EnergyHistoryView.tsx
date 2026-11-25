/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  ClipboardList,
  Clock,
  Download,
  Fan,
  History,
  Info,
  Layers,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Sigma,
  Thermometer,
  Users,
  Zap,
} from 'lucide-react';
import { authFetch } from '../../context/AuthContext';
import { useEnergy } from '../../context/EnergyContext';
import { useToast } from '../../context/ToastContext';
import { MathText } from '../common/MathText';
import type {
  HistoricalAnomaliesResponse,
  HistoricalInvestigationResponse,
  HistoryDatePreset,
  HistoryGroupingMode,
  HistoryOverviewResponse,
  RoomHistoryDetailResponse,
  TimeOfDayProfileResponse,
} from '../../types/history';
import { getIstDateString, shiftIstDate } from '../../utils/historyDates';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { AcronymHint } from '../common/AcronymHint';
import {
  ErrorBanner,
  LoadingState,
  PageHeader,
  SegmentedControl,
} from '../common/DesignSystem';
import { ROOMWISE_EASE, tabContentVariants } from '../../utils/motion';
import { InterventionLedgerView } from './InterventionLedgerView';
import { RcemModelPanel } from './RcemModelPanel';

const PRESET_OPTIONS: Array<{ id: HistoryDatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'previous_month', label: 'Previous month' },
  { id: 'custom', label: 'Custom' },
];

const BLOCK_COLORS: Record<string, string> = {
  'G+3 Block': '#059669',
  'New Building': '#0d9488',
  'Old Building': '#3b82f6',
  'Pre-Primary Block': '#f59e0b',
  'Multipurpose Hall': '#52525b',
};

const ROOM_SERIES_COLORS = ['#059669', '#0d9488', '#2563eb', '#d97706', '#7c3aed', '#a3a3a3'];

export const EnergyHistoryView: React.FC = () => {
  const { settings, voiceNavDirective, clearVoiceNavDirective } = useEnergy();
  const toast = useToast();

  const todayIst = useMemo(() => getIstDateString(), []);
  const [activeSubView, setActiveSubView] = useState<'consumption' | 'interventions'>('consumption');
  const [preset, setPreset] = useState<HistoryDatePreset>('last_7_days');
  const [customStart, setCustomStart] = useState<string>(() => shiftIstDate(todayIst, -6));
  const [customEnd, setCustomEnd] = useState<string>(() => todayIst);
  const [selectedBuilding, setSelectedBuilding] = useState<string>('All');
  const [groupingMode, setGroupingMode] = useState<HistoryGroupingMode>('total');
  const [roomSearch, setRoomSearch] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('g3-301');

  useEffect(() => {
    if (!voiceNavDirective || voiceNavDirective.target !== 'history') return;
    if (voiceNavDirective.subTab === 'interventions') {
      setActiveSubView('interventions');
    } else if (voiceNavDirective.subTab === 'consumption') {
      setActiveSubView('consumption');
      if (voiceNavDirective.historyFilters?.preset) {
        setPreset(voiceNavDirective.historyFilters.preset as HistoryDatePreset);
      }
      if (voiceNavDirective.historyFilters?.building) {
        setSelectedBuilding(voiceNavDirective.historyFilters.building);
      }
      clearVoiceNavDirective(voiceNavDirective.id);
    } else {
      if (voiceNavDirective.historyFilters?.preset) {
        setPreset(voiceNavDirective.historyFilters.preset as HistoryDatePreset);
      }
      if (voiceNavDirective.historyFilters?.building) {
        setSelectedBuilding(voiceNavDirective.historyFilters.building);
      }
      clearVoiceNavDirective(voiceNavDirective.id);
    }
  }, [voiceNavDirective, clearVoiceNavDirective]);

  const [overview, setOverview] = useState<HistoryOverviewResponse | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayProfileResponse | null>(null);
  const [anomaliesData, setAnomaliesData] = useState<HistoricalAnomaliesResponse | null>(null);
  const [investigation, setInvestigation] = useState<HistoricalInvestigationResponse | null>(null);
  const [roomDetail, setRoomDetail] = useState<RoomHistoryDetailResponse | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRoomLoading, setIsRoomLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hoveredSeriesIdx, setHoveredSeriesIdx] = useState<number | null>(null);
  const [hoveredHourIdx, setHoveredHourIdx] = useState<number | null>(null);
  const [showInvestigation, setShowInvestigation] = useState<boolean>(false);
  const [isInvestigating, setIsInvestigating] = useState<boolean>(false);

  const buildQueryString = useCallback(() => {
    const qs = new URLSearchParams();
    qs.set('preset', preset);
    if (preset === 'custom') {
      qs.set('startDate', customStart);
      qs.set('endDate', customEnd);
    }
    if (selectedBuilding !== 'All') {
      qs.set('building', selectedBuilding);
    }
    return qs.toString();
  }, [preset, customStart, customEnd, selectedBuilding]);

  const loadHistoryData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const qs = buildQueryString();
      const [ovRes, todRes, anomRes] = await Promise.all([
        authFetch(`/api/history/overview?${qs}`),
        authFetch(`/api/history/time-of-day?${qs}`),
        authFetch(`/api/history/anomalies?${qs}`),
      ]);

      if (!ovRes.ok) {
        const errBody = await ovRes.json().catch(() => ({}));
        throw new Error(errBody?.error || 'Failed to load energy history overview.');
      }

      const [ovJson, todJson, anomJson] = (await Promise.all([
        ovRes.json(),
        todRes.ok ? todRes.json() : Promise.resolve(null),
        anomRes.ok ? anomRes.json() : Promise.resolve(null),
      ])) as [
        HistoryOverviewResponse,
        TimeOfDayProfileResponse | null,
        HistoricalAnomaliesResponse | null,
      ];

      setOverview(ovJson);
      if (todJson) setTimeOfDay(todJson);
      if (anomJson) setAnomaliesData(anomJson);

      if (ovJson.classrooms.length > 0) {
        const stillExists = ovJson.classrooms.some((c) => c.roomId === selectedRoomId);
        if (!stillExists) {
          setSelectedRoomId(ovJson.classrooms[0].roomId);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch energy history.');
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryString, selectedRoomId]);

  useEffect(() => {
    void loadHistoryData();
  }, [loadHistoryData]);

  useEffect(() => {
    if (!selectedRoomId) return;
    let cancelled = false;
    setIsRoomLoading(true);
    const qs = new URLSearchParams();
    qs.set('preset', preset);
    if (preset === 'custom') {
      qs.set('startDate', customStart);
      qs.set('endDate', customEnd);
    }

    authFetch(`/api/history/room/${encodeURIComponent(selectedRoomId)}?${qs.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RoomHistoryDetailResponse | null) => {
        if (!cancelled && data) {
          setRoomDetail(data);
        }
      })
      .catch(() => {
        // handled cleanly in room panel empty state
      })
      .finally(() => {
        if (!cancelled) setIsRoomLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRoomId, preset, customStart, customEnd]);

  const handleRunInvestigation = async () => {
    setShowInvestigation(true);
    setIsInvestigating(true);
    try {
      const qs = buildQueryString();
      const res = await authFetch(`/api/history/investigate?${qs}`);
      if (res.ok) {
        const json = (await res.json()) as HistoricalInvestigationResponse;
        setInvestigation(json);
      }
    } catch {
      toast.error('Investigation failed', 'Could not analyze drivers for this period.');
    } finally {
      setIsInvestigating(false);
    }
  };

  useEffect(() => {
    if (!showInvestigation) return;
    const qs = buildQueryString();
    authFetch(`/api/history/investigate?${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: HistoricalInvestigationResponse | null) => {
        if (json) setInvestigation(json);
      })
      .catch(() => {});
  }, [showInvestigation, buildQueryString]);

  const filteredClassrooms = useMemo(() => {
    if (!overview) return [];
    const q = roomSearch.trim().toLowerCase();
    if (!q) return overview.classrooms;
    return overview.classrooms.filter(
      (c) =>
        c.roomCode.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.building.toLowerCase().includes(q)
    );
  }, [overview, roomSearch]);

  const topFiveRoomCodes = useMemo(() => {
    if (!overview) return [];
    return overview.classrooms.slice(0, 5).map((c) => c.roomCode);
  }, [overview]);

  const maxTrendValue = useMemo(() => {
    if (!overview || overview.series.length === 0) return 1;
    return Math.max(0.5, ...overview.series.map((p) => p.actualKWh));
  }, [overview]);

  const maxHourKW = useMemo(() => {
    if (!timeOfDay || timeOfDay.hours.length === 0) return 1;
    return Math.max(0.5, ...timeOfDay.hours.map((h) => h.avgKW));
  }, [timeOfDay]);

  const handleExportHistoryCsv = () => {
    if (!overview) return;
    const headers = [
      'Period_Start_IST',
      'Period_End_IST',
      'Room_Code',
      'Room_Name',
      'Building',
      'Actual_kWh',
      'Rated_Max_kWh',
      'Rated_Utilisation_Pct',
      'Lighting_kWh',
      'Fan_kWh',
      'Aux_kWh',
      'Post_Hours_kWh',
      'Avg_Occupancy_Pct',
      'Avg_Temp_C',
      'Share_Pct',
      'Change_Vs_Prev_Pct',
    ];
    const rows = overview.classrooms.map((c) => [
      overview.range.startDate,
      overview.range.endDate,
      c.roomCode,
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.building}"`,
      c.actualKWh,
      c.ratedMaxKWh,
      c.ratedUtilizationPercent,
      c.lightingKWh,
      c.fanKWh,
      c.auxKWh,
      c.postHoursKWh,
      c.avgOccupancyPercent,
      c.avgTempC,
      c.sharePercent,
      c.changeVsPrevPercent === null ? 'N/A' : c.changeVsPrevPercent,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roomwise-energy-history-${overview.range.startDate}-to-${overview.range.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(
      'Historical dataset exported',
      `${overview.classrooms.length} classroom records (${overview.range.startDate} to ${overview.range.endDate}).`
    );
  };

  const hoveredPoint =
    overview && hoveredSeriesIdx !== null ? overview.series[hoveredSeriesIdx] || null : null;
  const hoveredHour =
    timeOfDay && hoveredHourIdx !== null ? timeOfDay.hours[hoveredHourIdx] || null : null;

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header & Controls */}
      <PageHeader
        kicker={
          <>
            <span>Persisted Time-Series Ledger</span>
            <span aria-hidden="true">·</span>
            <span>Asia/Kolkata (IST)</span>
          </>
        }
        title="Energy History & Historical Intelligence"
        subtitle={
          <>
            Retained <MathText tex="\mathrm{kW}\cdot\mathrm{h}" ariaLabel="kilowatt-hours" /> integration
            across all 25 classroom nodes at {settings.institutionName}, with comparable baselines,
            time-of-day profiling, and intervention records.
          </>
        }
        action={
          activeSubView === 'consumption' ? (
            <>
              <button
                type="button"
                onClick={() => void handleRunInvestigation()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl rw-btn-forest text-xs font-semibold shadow-xs whitespace-nowrap"
              >
                <Activity className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
                <span>Explain Period Drivers</span>
              </button>

              <button
                type="button"
                onClick={handleExportHistoryCsv}
                disabled={!overview}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl rw-btn-primary disabled:opacity-50 text-xs font-semibold shadow-xs whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Export Range (.csv)</span>
              </button>

              <button
                type="button"
                onClick={() => void loadHistoryData()}
                aria-label="Refresh historical data"
                className="p-2 rounded-xl rw-btn-secondary text-[#4a5851]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
              </button>
            </>
          ) : undefined
        }
      />

      {/* Sub-Navigation inside Energy History: Consumption History vs Intervention Ledger */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<'consumption' | 'interventions'>
          layoutId="history-subview-tabs"
          tone="light"
          ariaLabel="Energy History Views"
          value={activeSubView}
          onChange={setActiveSubView}
          options={[
            { id: 'consumption', label: 'Consumption History', icon: History },
            { id: 'interventions', label: 'Intervention Ledger', icon: ClipboardList },
          ]}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#64726b]">
          <p>
            {activeSubView === 'consumption'
              ? 'Persisted hourly & daily energy consumption across all 25 campus rooms.'
              : 'Auditable event-level control actions, counterfactual energy estimates, and overlap isolation.'}
          </p>
          <span aria-hidden="true" className="hidden sm:inline text-neutral-300">·</span>
          <button
            type="button"
            onClick={() => {
              document
                .getElementById('rcem-model-panel')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:text-emerald-950 transition-colors whitespace-nowrap"
          >
            <Sigma className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span><AcronymHint term="RCEM" /> Mathematical Model</span>
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
      {activeSubView === 'interventions' ? (
        <motion.div
          key="interventions"
          variants={tabContentVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <InterventionLedgerView />
        </motion.div>
      ) : (
        <motion.div
          key="consumption"
          variants={tabContentVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="space-y-6"
        >
      {/* Date Range & Scope Filter Strip */}
      <div className="p-3.5 sm:p-4 rounded-2xl rw-surface space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#4a5851] mr-1">
              <Calendar className="w-3.5 h-3.5 text-emerald-700" />
              <span>Period:</span>
            </span>
            {PRESET_OPTIONS.map((opt) => {
              const active = preset === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPreset(opt.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    active
                      ? 'bg-[#0b2e22] text-white shadow-2xs'
                      : 'bg-[#f3f5f4] text-[#4a5851] hover:text-[#111815] hover:bg-neutral-200/70'
                  }`}
                >
                  <span>{opt.label}</span>
                  {opt.id === 'today' && (
                    <span
                      className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded font-bold ${
                        active ? 'bg-emerald-500/25 text-emerald-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200/70'
                      }`}
                    >
                      Live
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="history-block-filter" className="text-[11px] font-semibold text-[#64726b]">
              Block:
            </label>
            <select
              id="history-block-filter"
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg glass-input text-xs font-semibold text-[#111815]"
            >
              <option value="All">All 5 Campus Blocks</option>
              <option value="G+3 Block">G+3 Block</option>
              <option value="New Building">New Building</option>
              <option value="Pre-Primary Block">Pre-Primary Block</option>
              <option value="Old Building">Old Building</option>
              <option value="Multipurpose Hall">Multipurpose Hall</option>
            </select>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500 font-medium">From (IST):</span>
              <input
                type="date"
                value={customStart}
                max={todayIst}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-white font-mono text-xs text-neutral-900"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500 font-medium">To (IST):</span>
              <input
                type="date"
                value={customEnd}
                max={todayIst}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-white font-mono text-xs text-neutral-900"
              />
            </div>
          </div>
        )}

        {overview && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-100 text-[11px] text-neutral-500">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold text-neutral-800">
                {overview.range.startDate} → {overview.range.endDate}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Resolution:{' '}
                <strong className="text-neutral-800">
                  {overview.range.granularity === 'hourly' ? 'Hourly intervals' : `${overview.range.daysCount}-day daily rollups`}
                </strong>
              </span>
              {overview.range.isPartial && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200/80 text-amber-900 font-semibold">
                  <Clock className="w-3 h-3" />
                  <span>Today in-progress (partial day)</span>
                </span>
              )}
            </div>
            <div className="font-mono tabular-nums">
              Interval coverage: <strong className="text-neutral-800">{overview.range.completenessPercent}%</strong> · Updated {overview.range.lastRecordedIstLabel}
            </div>
          </div>
        )}
      </div>

      {errorMsg && (
        <ErrorBanner message={errorMsg} onRetry={() => void loadHistoryData()} />
      )}

      {isLoading && !overview ? (
        <LoadingState message="Querying persisted campus energy intervals..." />
      ) : overview ? (
        <>
          {/* 5 Overview KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-3.5">
            <div className="p-3.5 sm:p-4 rounded-2xl glass-card relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5 gradient-rim-emerald" />
              <div className="text-[11px] font-semibold text-neutral-500">Total Consumption</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono text-neutral-900 tabular-nums">
                  <AnimatedNumber value={overview.kpis.totalActualKWh} decimals={1} />
                </span>
                <span className="text-xs font-bold text-neutral-500">kWh</span>
              </div>
              <div className="mt-1.5 text-[11px] text-neutral-600 font-mono tabular-nums">
                Est. bill ₹{overview.kpis.estimatedCostINR.toLocaleString('en-IN')} · {overview.kpis.ratedUtilizationPercent}% of rated cap.
              </div>
            </div>

            <div className="p-4 rounded-2xl glass-card">
              <div className="text-[11px] font-semibold text-neutral-500">Average Daily Use</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono text-neutral-900 tabular-nums">
                  <AnimatedNumber value={overview.kpis.averageDailyKWh} decimals={1} />
                </span>
                <span className="text-xs font-bold text-neutral-500">kWh/day</span>
              </div>
              <div className="mt-1.5 text-[11px] text-neutral-500 tabular-nums">
                Lights {overview.kpis.lightingKWh} · Fans {overview.kpis.fanKWh} · Aux {overview.kpis.auxKWh} kWh
              </div>
            </div>

            <div className="p-4 rounded-2xl glass-card">
              <div className="text-[11px] font-semibold text-neutral-500">
                {overview.range.granularity === 'hourly' ? 'Peak Hour Load' : 'Peak Consumption Day'}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono text-neutral-900 tabular-nums">
                  {overview.kpis.peakPoint ? overview.kpis.peakPoint.actualKWh.toFixed(1) : '—'}
                </span>
                <span className="text-xs font-bold text-neutral-500">kWh</span>
              </div>
              <div className="mt-1.5 text-[11px] text-neutral-600 font-medium truncate">
                {overview.kpis.peakPoint
                  ? `${overview.kpis.peakPoint.label} (${overview.kpis.peakPoint.occupancyPercent}% occ)`
                  : 'No interval recorded'}
              </div>
            </div>

            <div className="p-4 rounded-2xl glass-card">
              <div className="text-[11px] font-semibold text-neutral-500">Lowest Consumption Day</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono text-neutral-900 tabular-nums">
                  {overview.kpis.lowestDay ? overview.kpis.lowestDay.actualKWh.toFixed(1) : '—'}
                </span>
                <span className="text-xs font-bold text-neutral-500">kWh</span>
              </div>
              <div className="mt-1.5 text-[11px] text-neutral-600 font-medium truncate">
                {overview.kpis.lowestDay
                  ? `${overview.kpis.lowestDay.label} (${overview.kpis.lowestDay.dayType})`
                  : 'Single-day scope'}
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-2xl glass-card col-span-2 lg:col-span-1">
              <div className="text-[11px] font-semibold text-neutral-500">vs Preceding Period</div>
              {overview.kpis.comparison.available && overview.kpis.comparison.changePercent !== null ? (
                <>
                  <div className="mt-2 flex items-center gap-1.5">
                    {overview.kpis.comparison.changePercent >= 0 ? (
                      <ArrowUpRight className="w-5 h-5 text-amber-600 shrink-0" />
                    ) : (
                      <ArrowDownRight className="w-5 h-5 text-emerald-700 shrink-0" />
                    )}
                    <span
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        overview.kpis.comparison.changePercent > 5
                          ? 'text-amber-700'
                          : overview.kpis.comparison.changePercent < -2
                          ? 'text-emerald-800'
                          : 'text-neutral-900'
                      }`}
                    >
                      {overview.kpis.comparison.changePercent >= 0 ? '+' : ''}
                      {overview.kpis.comparison.changePercent}%
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-neutral-500 font-mono tabular-nums">
                    Prior: {overview.kpis.comparison.previousTotalKWh} kWh (
                    {overview.kpis.comparison.changeKWh !== null && overview.kpis.comparison.changeKWh >= 0 ? '+' : ''}
                    {overview.kpis.comparison.changeKWh} kWh)
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-2 text-lg font-bold text-neutral-400 font-mono">Unavailable</div>
                  <div className="mt-1.5 text-[11px] text-neutral-500">
                    No prior baseline records in store
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Interactive Driver Investigation Banner (Expandable) */}
          {showInvestigation && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
              className="p-5 rounded-2xl glass-card border border-emerald-200/80 space-y-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                    Diagnostic Driver Investigation
                  </div>
                  <h2 className="text-sm sm:text-base font-bold text-neutral-900 mt-0.5">
                    {isInvestigating
                      ? 'Evaluating comparable baselines and anomalies...'
                      : investigation?.targetPeriod.label || 'Period Breakdown'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInvestigation(false)}
                  className="text-xs font-semibold text-neutral-500 hover:text-neutral-800 px-2 py-1 rounded-lg hover:bg-neutral-100"
                >
                  Hide
                </button>
              </div>

              {investigation && !isInvestigating && (
                <div className="space-y-4">
                  <p className="text-xs sm:text-sm text-neutral-800 leading-relaxed bg-emerald-50/60 border border-emerald-200/60 rounded-xl p-3.5">
                    {investigation.narrativeSummary}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3.5 rounded-xl bg-neutral-50/80 border border-neutral-200/70 space-y-2">
                      <div className="text-xs font-bold text-neutral-900">Top Block Variances vs Comparable Baseline</div>
                      <div className="space-y-1.5">
                        {investigation.topContributingBlocks.slice(0, 5).map((b) => (
                          <div key={b.building} className="flex items-center justify-between text-xs">
                            <span className="font-medium text-neutral-700">{b.building}</span>
                            <span className="font-mono tabular-nums text-neutral-900">
                              {b.actualKWh} kWh{' '}
                              {b.deltaPercent !== null && (
                                <span
                                  className={`ml-1 font-bold ${
                                    b.deltaPercent > 8
                                      ? 'text-amber-700'
                                      : b.deltaPercent < -5
                                      ? 'text-emerald-700'
                                      : 'text-neutral-500'
                                  }`}
                                >
                                  ({b.deltaPercent >= 0 ? '+' : ''}
                                  {b.deltaPercent}%)
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-neutral-50/80 border border-neutral-200/70 space-y-2">
                      <div className="text-xs font-bold text-neutral-900">Top Classroom Contributors</div>
                      <div className="space-y-1.5">
                        {investigation.topContributingRooms.slice(0, 5).map((r) => (
                          <div key={r.roomCode} className="flex items-center justify-between text-xs gap-2">
                            <span className="truncate text-neutral-700">
                              <strong className="font-mono text-neutral-900">{r.roomCode}</strong> · {r.name}
                            </span>
                            <span className="font-mono tabular-nums text-neutral-900 shrink-0">
                              {r.actualKWh} kWh
                              {r.postHoursKWh > 0.5 && (
                                <span className="text-amber-700 ml-1 text-[11px]">
                                  ({r.postHoursKWh} post-hr)
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-neutral-500 flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                    <span>{investigation.uncertaintyNotes.join(' ')}</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Main Interactive Consumption Trend Chart */}
          <div className="p-5 sm:p-6 rounded-2xl glass-card rw-card-alive space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-neutral-900">
                  Consumption Trend ({overview.range.granularity === 'hourly' ? 'Hourly Profile (IST)' : 'Daily Consumption'})
                </h2>
                <p className="text-xs text-neutral-600 mt-0.5">
                  Actual integrated consumption (
                  <MathText tex="\mathrm{kW}\cdot\mathrm{h}" ariaLabel="kilowatt-hours" />) across monitored campus nodes (Installed Rated Max:{' '}
                  {(overview.installedRatedMaxKW ?? 13.39).toFixed(2)} kW).
                </p>
              </div>

              <SegmentedControl<HistoryGroupingMode>
                layoutId="history-grouping-tabs"
                size="sm"
                tone="light"
                ariaLabel="Consumption trend grouping"
                value={groupingMode}
                onChange={setGroupingMode}
                className="shrink-0 self-start sm:self-auto"
                options={[
                  { id: 'total', label: 'Total School' },
                  { id: 'building', label: 'Block-wise' },
                  { id: 'classroom', label: 'Classroom-wise' },
                ]}
              />
            </div>

            {/* Interactive Hover Readout Bar */}
            <div className="min-h-[34px] px-3 py-2 rounded-xl bg-neutral-50/90 border border-neutral-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
              {hoveredPoint ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 font-medium text-neutral-800">
                    <span className="font-mono font-bold text-neutral-900">
                      {hoveredPoint.subLabel && hoveredPoint.hourIst === undefined
                        ? hoveredPoint.subLabel
                        : `${hoveredPoint.label} IST`}
                    </span>
                    {hoveredPoint.dayType && hoveredPoint.dayType !== 'school' && (
                      <span className="px-1.5 py-0.5 rounded bg-neutral-200/70 text-[10px] font-semibold uppercase text-neutral-700">
                        {hoveredPoint.dayType}
                      </span>
                    )}
                    {hoveredPoint.isPartial && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-[10px] font-semibold text-amber-900">
                        Partial
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
                    <span className="font-bold text-emerald-800">
                      Actual: {hoveredPoint.actualKWh} kWh
                    </span>
                    <span className="text-neutral-600">Rated Ceiling: {hoveredPoint.ratedMaxKWh} kWh</span>
                    <span className="text-neutral-700">Occ: {hoveredPoint.avgOccupancyPercent}%</span>
                    <span className="text-neutral-700">{hoveredPoint.avgTempC}°C</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between w-full gap-2 text-[11px] text-neutral-600">
                  <span>Hover or tap any bar to inspect exact kWh, rated ceiling, occupancy, and temperature.</span>
                  <div className="flex flex-wrap items-center gap-3">
                    {groupingMode === 'total' && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
                        <span>Actual Consumption (kWh)</span>
                      </span>
                    )}
                    {groupingMode === 'building' &&
                      Object.entries(BLOCK_COLORS).map(([blk, col]) => (
                        <span key={blk} className="inline-flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: col }} />
                          <span>{blk}</span>
                        </span>
                      ))}
                    {groupingMode === 'classroom' &&
                      topFiveRoomCodes.map((rc, i) => (
                        <span key={rc} className="inline-flex items-center gap-1 font-mono">
                          <span
                            className="w-2.5 h-2.5 rounded-xs"
                            style={{ backgroundColor: ROOM_SERIES_COLORS[i] }}
                          />
                          <span>{rc}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {overview.series.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-xs text-neutral-500 border border-dashed border-neutral-200 rounded-xl">
                No historical telemetry intervals available for this date selection.
              </div>
            ) : (
              <div className="overflow-x-auto pb-2">
                <div
                  className="h-60 flex items-end gap-1.5 pt-6 pb-2 border-b border-neutral-200/80"
                  style={{ minWidth: overview.series.length > 20 ? `${overview.series.length * 24}px` : '100%' }}
                >
                  {overview.series.map((pt, idx) => {
                    const actualH = Math.max(2, (pt.actualKWh / maxTrendValue) * 100);
                    const isHovered = hoveredSeriesIdx === idx;
                    const showLabel =
                      overview.series.length <= 14 ||
                      idx === 0 ||
                      idx === overview.series.length - 1 ||
                      idx % Math.ceil(overview.series.length / 10) === 0;

                    return (
                      <div
                        key={pt.key}
                        onMouseEnter={() => setHoveredSeriesIdx(idx)}
                        onMouseLeave={() => setHoveredSeriesIdx(null)}
                        onClick={() => setHoveredSeriesIdx(idx)}
                        className="flex-1 min-w-[14px] h-full flex flex-col items-center justify-end group cursor-pointer"
                      >
                        <div className="w-full h-full flex items-end justify-center gap-0.5 px-0.5">
                          {groupingMode === 'total' && (
                            <div
                              className={`w-3 sm:w-4 max-w-[22px] rounded-t transition-all ${
                                pt.isPartial
                                  ? 'bg-emerald-400 border border-dashed border-emerald-700'
                                  : isHovered
                                  ? 'bg-emerald-700'
                                  : 'bg-emerald-600/90'
                              }`}
                              style={{ height: `${actualH}%` }}
                            />
                          )}

                          {groupingMode === 'building' && (
                            <div
                              className="w-3 sm:w-5 max-w-[26px] rounded-t overflow-hidden flex flex-col-reverse"
                              style={{ height: `${actualH}%` }}
                            >
                              {Object.keys(BLOCK_COLORS).map((blk) => {
                                const val = pt.byBuilding[blk] || 0;
                                const pct = pt.actualKWh > 0 ? (val / pt.actualKWh) * 100 : 0;
                                if (pct <= 0) return null;
                                return (
                                  <div
                                    key={blk}
                                    style={{
                                      height: `${pct}%`,
                                      backgroundColor: BLOCK_COLORS[blk],
                                    }}
                                  />
                                );
                              })}
                            </div>
                          )}

                          {groupingMode === 'classroom' && (
                            <div
                              className="w-3 sm:w-5 max-w-[26px] rounded-t overflow-hidden flex flex-col-reverse"
                              style={{ height: `${actualH}%` }}
                            >
                              {topFiveRoomCodes.map((rc, ci) => {
                                const val = pt.byRoom?.[rc] || 0;
                                const pct = pt.actualKWh > 0 ? (val / pt.actualKWh) * 100 : 0;
                                if (pct <= 0) return null;
                                return (
                                  <div
                                    key={rc}
                                    style={{
                                      height: `${pct}%`,
                                      backgroundColor: ROOM_SERIES_COLORS[ci],
                                    }}
                                  />
                                );
                              })}
                              {(() => {
                                const topSum = topFiveRoomCodes.reduce(
                                  (s, rc) => s + (pt.byRoom?.[rc] || 0),
                                  0
                                );
                                const rest = Math.max(0, pt.actualKWh - topSum);
                                const restPct = pt.actualKWh > 0 ? (rest / pt.actualKWh) * 100 : 0;
                                return restPct > 0 ? (
                                  <div
                                    style={{
                                      height: `${restPct}%`,
                                      backgroundColor: ROOM_SERIES_COLORS[5],
                                    }}
                                  />
                                ) : null;
                              })()}
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-[10px] mt-1.5 font-mono tabular-nums whitespace-nowrap ${
                            isHovered ? 'font-bold text-neutral-900' : 'text-neutral-500'
                          }`}
                        >
                          {showLabel ? pt.label : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Ranked Blocks + Classroom Comparison + Drill-Down */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Cols: Block Ranking & Ranked Classrooms */}
            <div className="lg:col-span-7 space-y-6">
              {/* Ranked Block Comparison */}
              <div className="p-5 rounded-2xl glass-card space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-700" />
                    <span>Block-Wise Historical Contribution</span>
                  </h3>
                  <span className="text-[11px] text-neutral-500">Ranked by kWh consumed</span>
                </div>

                <div className="space-y-2.5">
                  {overview.blocks.map((b) => (
                    <div
                      key={b.building}
                      className="p-3 rounded-xl bg-neutral-50/75 border border-neutral-200/70 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: BLOCK_COLORS[b.building] || '#059669' }}
                          />
                          <span className="font-bold text-neutral-900">{b.building}</span>
                          <span className="text-[11px] text-neutral-500">
                            · {b.roomCount} rooms · Top: {b.topConsumerRoomCode}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 font-mono text-[11px] tabular-nums">
                          <span className="font-bold text-neutral-900">{b.actualKWh} kWh</span>
                          <span className="text-neutral-500">{b.sharePercent}% share</span>
                          {b.changeVsPrevPercent !== null && (
                            <span
                              className={`font-bold ${
                                b.changeVsPrevPercent > 5
                                  ? 'text-amber-700'
                                  : b.changeVsPrevPercent < -2
                                  ? 'text-emerald-700'
                                  : 'text-neutral-600'
                              }`}
                            >
                              {b.changeVsPrevPercent >= 0 ? '+' : ''}
                              {b.changeVsPrevPercent}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-neutral-200/70 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, b.sharePercent)}%`,
                            backgroundColor: BLOCK_COLORS[b.building] || '#059669',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ranked Classrooms Table */}
              <div className="p-5 rounded-2xl glass-card space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-neutral-900">
                      Classroom Comparison ({filteredClassrooms.length})
                    </h3>
                    <p className="text-[11px] text-neutral-500">
                      Click any classroom row to inspect detailed load splits, occupancy, and temperature trends.
                    </p>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={roomSearch}
                      onChange={(e) => setRoomSearch(e.target.value)}
                      placeholder="Filter room or code..."
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs text-neutral-800 w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>

                <div className="max-h-[420px] overflow-y-auto overflow-x-auto border border-neutral-200/75 rounded-xl">
                  <table className="w-full min-w-[460px] text-left border-collapse text-xs">
                    <thead className="bg-neutral-50/95 sticky top-0 z-10 border-b border-neutral-200/80 text-[11px] text-neutral-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Classroom</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right whitespace-nowrap">kWh</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right whitespace-nowrap">Share</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right whitespace-nowrap">vs Prior</th>
                        <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {filteredClassrooms.map((c) => {
                        const isSelected = selectedRoomId === c.roomId;
                        return (
                          <tr
                            key={c.roomId}
                            onClick={() => setSelectedRoomId(c.roomId)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-emerald-50/85'
                                : 'bg-white/70 hover:bg-neutral-50'
                            }`}
                          >
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-neutral-900">
                                  {c.roomCode}
                                </span>
                                <span className="font-medium text-neutral-800 truncate max-w-[170px]">
                                  {c.name}
                                </span>
                              </div>
                              <div className="text-[10px] text-neutral-500">{c.building}</div>
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono font-bold text-neutral-900 tabular-nums">
                              {c.actualKWh}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono text-neutral-600 tabular-nums">
                              {c.sharePercent}%
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                              {c.changeVsPrevPercent === null ? (
                                <span className="text-neutral-400">—</span>
                              ) : (
                                <span
                                  className={`font-semibold ${
                                    c.changeVsPrevPercent > 10
                                      ? 'text-amber-700'
                                      : c.changeVsPrevPercent < -5
                                      ? 'text-emerald-700'
                                      : 'text-neutral-600'
                                  }`}
                                >
                                  {c.changeVsPrevPercent >= 0 ? '+' : ''}
                                  {c.changeVsPrevPercent}%
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {c.anomalyCount > 0 ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold font-mono">
                                  {c.anomalyCount}
                                </span>
                              ) : (
                                <span className="text-[10px] text-emerald-700 font-semibold">Normal</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right 5 Cols: Classroom Drill-Down Detail Panel */}
            <div className="lg:col-span-5">
              <div className="p-4 sm:p-5 rounded-2xl glass-card space-y-4 lg:sticky lg:top-20">
                <div className="flex items-start justify-between gap-2 border-b border-neutral-100 pb-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                      Classroom Drill-Down
                    </div>
                    <h3 className="text-base font-bold text-neutral-900 mt-0.5">
                      {roomDetail ? `${roomDetail.room.roomCode} · ${roomDetail.room.name}` : 'Select a room'}
                    </h3>
                    {roomDetail && (
                      <div className="text-[11px] text-neutral-600 tabular-nums">
                        {roomDetail.room.building} · {roomDetail.room.floor} · Cap {roomDetail.room.capacity}
                        {typeof roomDetail.room.ratedPowerWatts === 'number'
                          ? ` · Installed Rated Max ${roomDetail.room.ratedPowerWatts}W`
                          : ''}
                      </div>
                    )}
                  </div>
                  {isRoomLoading && <Loader2 className="w-4 h-4 animate-spin text-emerald-700 shrink-0" />}
                </div>

                {roomDetail ? (
                  <div className="space-y-4">
                    {/* Room KPI Summary */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                        <div className="text-[10px] text-neutral-500 font-semibold">Room Total</div>
                        <div className="font-mono text-sm font-bold text-neutral-900 mt-0.5 tabular-nums">
                          {roomDetail.totals.actualKWh} kWh
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                        <div className="text-[10px] text-neutral-500 font-semibold">Avg Occupancy</div>
                        <div className="font-mono text-sm font-bold text-neutral-900 mt-0.5 tabular-nums flex items-center justify-center gap-1">
                          <Users className="w-3 h-3 text-emerald-700" />
                          <span>{roomDetail.totals.avgOccupancyPercent}%</span>
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                        <div className="text-[10px] text-neutral-500 font-semibold">Mean Temp</div>
                        <div className="font-mono text-sm font-bold text-neutral-900 mt-0.5 tabular-nums flex items-center justify-center gap-1">
                          <Thermometer className="w-3 h-3 text-amber-600" />
                          <span>
                            {roomDetail.temperatureSupported && roomDetail.totals.avgTempC !== null
                              ? `${roomDetail.totals.avgTempC}°C`
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Lighting vs Fan vs Aux Split */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-neutral-800">
                        Appliance Energy Contribution
                      </div>
                      {(() => {
                        const tot = Math.max(0.01, roomDetail.totals.actualKWh);
                        const lPct = Math.round((roomDetail.totals.lightingKWh / tot) * 100);
                        const fPct = Math.round((roomDetail.totals.fanKWh / tot) * 100);
                        const aPct = Math.max(0, 100 - lPct - fPct);
                        return (
                          <div className="space-y-2">
                            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-neutral-100">
                              <div className="bg-amber-400 h-full" style={{ width: `${lPct}%` }} />
                              <div className="bg-emerald-600 h-full" style={{ width: `${fPct}%` }} />
                              {aPct > 0 && (
                                <div className="bg-sky-600 h-full" style={{ width: `${aPct}%` }} />
                              )}
                            </div>
                            <div className="flex flex-wrap items-center justify-between text-[11px] font-mono tabular-nums text-neutral-700 gap-2">
                              <span className="inline-flex items-center gap-1">
                                <Lightbulb className="w-3 h-3 text-amber-600" />
                                Lights: {roomDetail.totals.lightingKWh} kWh ({lPct}%)
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Fan className="w-3 h-3 text-emerald-700" />
                                Fans: {roomDetail.totals.fanKWh} kWh ({fPct}%)
                              </span>
                              {roomDetail.totals.auxKWh > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <Zap className="w-3 h-3 text-sky-700" />
                                  Aux: {roomDetail.totals.auxKWh} kWh ({aPct}%)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Room Series Mini Trend (kWh + Occupancy %) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-neutral-800">Consumption & Occupancy Trend</span>
                        <span className="text-[10px] text-neutral-500">
                          Post-hours: {roomDetail.totals.postHoursKWh} kWh
                        </span>
                      </div>
                      {roomDetail.series.length > 0 ? (
                        <div className="h-32 flex items-end gap-1 pt-4 pb-1 border-b border-neutral-200/80">
                          {roomDetail.series.slice(-24).map((pt) => {
                            const maxRoomPt = Math.max(
                              0.2,
                              ...roomDetail.series.slice(-24).map((s) => s.actualKWh)
                            );
                            const hPct = Math.max(4, (pt.actualKWh / maxRoomPt) * 100);
                            return (
                              <div
                                key={pt.key}
                                title={`${pt.label}: ${pt.actualKWh} kWh · ${pt.occupancyPercent}% occ · ${pt.temperatureC}°C`}
                                className="flex-1 h-full flex flex-col items-center justify-end group relative"
                              >
                                <div
                                  className="w-full max-w-[12px] rounded-t bg-emerald-600/85 group-hover:bg-emerald-700 transition-colors"
                                  style={{ height: `${hPct}%` }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="py-6 text-center text-xs text-neutral-400">No room intervals</div>
                      )}
                    </div>

                    {/* Room Events Log */}
                    <div className="space-y-2 pt-1">
                      <div className="text-xs font-bold text-neutral-800">
                        Recorded Control & Override Events ({roomDetail.events.length})
                      </div>
                      {roomDetail.events.length === 0 ? (
                        <div className="text-[11px] text-neutral-500 bg-neutral-50 rounded-xl p-2.5 border border-neutral-200/60">
                          No manual overrides or audit events recorded for {roomDetail.room.roomCode} in this window.
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {roomDetail.events.slice(0, 5).map((ev) => (
                            <div
                              key={ev.id}
                              className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70 text-[11px]"
                            >
                              <div className="flex items-center justify-between font-mono text-[10px] text-neutral-500">
                                <span>{ev.timeIstLabel}</span>
                                <span>{ev.afterWatts}W</span>
                              </div>
                              <div className="text-neutral-800 font-medium mt-0.5">{ev.summary}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-neutral-500">
                    Select any classroom to inspect historical details.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Time-of-Day School Demand Analysis */}
          {timeOfDay && (
            <div className="p-5 sm:p-6 rounded-2xl glass-card space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-neutral-900 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-700" />
                    <span>Time-of-Day Demand Profile (00:00 – 23:00 IST)</span>
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Mean hourly load separating scheduled school operating hours ({timeOfDay.schoolHoursWindow.start}–{timeOfDay.schoolHoursWindow.end} IST) from off-hours & post-hours runtime.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-900 font-semibold whitespace-nowrap">
                    Peak: {timeOfDay.summary.peakHourLabel} ({timeOfDay.summary.peakAvgKW} kW · {timeOfDay.summary.peakOccupancyPercent}% occ)
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-700 font-semibold whitespace-nowrap">
                    School Hours: {timeOfDay.summary.schoolHoursSharePercent}% of kWh
                  </span>
                  {timeOfDay.summary.postHoursTotalKWh > 0.2 && (
                    <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200/80 text-amber-900 font-semibold whitespace-nowrap">
                      Post-Hours: {timeOfDay.summary.postHoursTotalKWh} kWh ({timeOfDay.summary.postHoursVacantSharePercent}% vacant)
                    </span>
                  )}
                </div>
              </div>

              <div className="min-h-[30px] px-3 py-1.5 rounded-xl bg-neutral-50/90 border border-neutral-200/70 flex flex-wrap items-center justify-between text-[11px] text-neutral-600">
                {hoveredHour ? (
                  <>
                    <span className="font-mono font-bold text-neutral-900">
                      {hoveredHour.hourLabel} IST ·{' '}
                      {hoveredHour.band === 'school_hours'
                        ? 'School Operating Window'
                        : hoveredHour.band === 'pre_hours'
                        ? 'Pre-Hours Standby'
                        : 'Post-Hours Window'}
                    </span>
                    <span className="font-mono tabular-nums">
                      Avg: <strong>{hoveredHour.avgKW} kW</strong> (Rated Max {hoveredHour.ratedMaxKW} kW) · Occ:{' '}
                      <strong>{hoveredHour.avgOccupancyPercent}%</strong>
                      {hoveredHour.flagReason ? ` · ${hoveredHour.flagReason}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <span>Shaded central band marks standard campus operating hours (07:00–14:59 IST).</span>
                    <span>Amber bars denote post-hours draw or unusual spikes relative to occupancy.</span>
                  </>
                )}
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="h-48 min-w-[540px] flex items-end gap-1 pt-5 pb-2 border-b border-neutral-200/80">
                  {timeOfDay.hours.map((h, i) => {
                    const hPct = Math.max(2, (h.avgKW / maxHourKW) * 100);
                    const isSchool = h.band === 'school_hours';
                    const isFlagged = h.flag === 'post_hours_draw' || h.flag === 'unusual_spike';
                    const isPeak = h.flag === 'peak';
                    return (
                      <div
                        key={h.hourIst}
                        onMouseEnter={() => setHoveredHourIdx(i)}
                        onMouseLeave={() => setHoveredHourIdx(null)}
                        className={`flex-1 h-full flex flex-col items-center justify-end rounded-t px-0.5 transition-colors cursor-pointer ${
                          isSchool ? 'bg-emerald-50/45' : ''
                        }`}
                      >
                        <div
                          className={`w-full max-w-[16px] rounded-t transition-all ${
                            isFlagged
                              ? 'bg-amber-500'
                              : isPeak
                              ? 'bg-emerald-800'
                              : isSchool
                              ? 'bg-emerald-600/85'
                              : 'bg-neutral-400/75'
                          }`}
                          style={{ height: `${hPct}%` }}
                        />
                        <span className="text-[9px] mt-1.5 font-mono text-neutral-500 tabular-nums">
                          {h.hourIst % 3 === 0 ? `${String(h.hourIst).padStart(2, '0')}h` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Historical Intelligence & Anomaly Evidence Panel */}
          {anomaliesData && (
            <div className="p-5 sm:p-6 rounded-2xl glass-card space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-neutral-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Historical Anomalies & Baseline Deviations</span>
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Events detected against each room&apos;s trailing 21-day comparable baseline and post-hours vacancy rules.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
                  <span className="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold whitespace-nowrap">
                    {anomaliesData.highCount} High
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold whitespace-nowrap">
                    {anomaliesData.mediumCount} Medium
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-700 font-bold whitespace-nowrap">
                    {anomaliesData.lowCount} Low
                  </span>
                </div>
              </div>

              {anomaliesData.anomalies.length === 0 ? (
                <div className="p-6 text-center rounded-xl bg-emerald-50/50 border border-emerald-200/70 text-xs text-emerald-900">
                  No significant baseline deviations or post-hours vacancy anomalies were detected across this period.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {anomaliesData.anomalies.map((anom) => (
                    <div
                      key={anom.id}
                      onClick={() => {
                        if (anom.roomId) setSelectedRoomId(anom.roomId);
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        anom.severity === 'high'
                          ? 'bg-red-50/40 border-red-200/80 hover:border-red-300'
                          : anom.severity === 'medium'
                          ? 'bg-amber-50/40 border-amber-200/80 hover:border-amber-300'
                          : 'bg-neutral-50/75 border-neutral-200/80 hover:border-neutral-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                            <span
                              className={`px-1.5 py-0.5 rounded ${
                                anom.severity === 'high'
                                  ? 'bg-red-100 text-red-900'
                                  : anom.severity === 'medium'
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-neutral-200 text-neutral-800'
                              }`}
                            >
                              {anom.severity}
                            </span>
                            <span className="text-neutral-500">{anom.timeWindowLabel}</span>
                            <span className="text-neutral-400">·</span>
                            <span className="text-neutral-600">{anom.confidence} confidence</span>
                          </div>
                          <h4 className="text-xs font-bold text-neutral-900 mt-1.5">{anom.title}</h4>
                        </div>
                        <div className="text-right font-mono shrink-0">
                          <div className="text-xs font-bold text-neutral-900 tabular-nums">
                            {anom.observedKWh} kWh
                          </div>
                          <div className="text-[10px] text-amber-800 font-semibold tabular-nums">
                            +{anom.deviationKWh} kWh ({anom.deviationPercent >= 0 ? '+' : ''}
                            {anom.deviationPercent}%)
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-neutral-700 mt-2 leading-relaxed">
                        {anom.explanation}
                      </p>

                      <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-600">
                        {anom.evidence.map((ev, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="text-emerald-700 font-bold">·</span>
                            <span>{ev}</span>
                          </li>
                        ))}
                      </ul>

                      <div className="mt-2 pt-2 border-t border-neutral-200/60 text-[10px] text-neutral-500 italic">
                        Note: {anom.caveat}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
        </motion.div>
      )}
      </AnimatePresence>

      {/* ROOMWISE Counterfactual Energy Model (RCEM) Mathematical Specification */}
      <RcemModelPanel />
    </div>
  );
};
