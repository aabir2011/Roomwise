/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Filter,
  GitBranch,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { authFetch } from '../../context/AuthContext';
import { useEnergy } from '../../context/EnergyContext';
import type { HistoryDatePreset } from '../../types/history';
import type {
  InterventionActionStatus,
  InterventionCircuitType,
  InterventionDetailResponse,
  InterventionLedgerListResponse,
  InterventionRecord,
  InterventionSource,
  InterventionTriggerCategory,
  InterventionVerificationStatus,
} from '../../types/interventionLedger';
import { getIstDateString, shiftIstDate } from '../../utils/historyDates';

const PRESET_OPTIONS: Array<{ id: HistoryDatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'previous_month', label: 'Previous month' },
  { id: 'custom', label: 'Custom' },
];

const TRIGGER_LABELS: Record<InterventionTriggerCategory, string> = {
  pir_vacancy: 'PIR Vacancy Hold',
  ambient_light: 'Daylight Harvesting',
  thermal_comfort: 'Thermal Comfort',
  schedule: 'Campus Schedule',
  manual_override: 'Manual Control',
  audit_remediation: 'Audit Remediation',
};

const CIRCUIT_LABELS: Record<InterventionCircuitType, string> = {
  lights: 'Lighting Circuit',
  fan: 'Fan Circuit',
  ac: 'Air Conditioning',
  projector: 'Projector',
  equipment: 'Lab / Aux Equipment',
  room_combined: 'Room Combined Load',
};

const STATUS_LABELS: Record<InterventionActionStatus, string> = {
  completed: 'Completed',
  active: 'Active (Open)',
  cancelled: 'Cancelled',
  unresolved: 'Unresolved',
};

const SOURCE_LABELS: Record<InterventionSource, string> = {
  simulated: 'Modelled',
  hardware_telemetry: 'Hardware',
  meter_data: 'Meter',
};

const VERIFICATION_LABELS: Record<InterventionVerificationStatus, string> = {
  estimated: 'Estimated',
  meter_backed: 'Meter-Backed',
  meter_verified: 'Meter-Verified',
};

function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return 'Open / Pending';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hrs = Math.floor(minutes / 60);
  const rem = Math.round(minutes % 60);
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function getSourceBadgeClasses(source: InterventionSource): string {
  if (source === 'meter_data') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
  if (source === 'hardware_telemetry') {
    return 'bg-sky-50 text-sky-800 border-sky-200';
  }
  return 'bg-neutral-100 text-neutral-600 border-neutral-200';
}

function getVerificationBadgeClasses(status: InterventionVerificationStatus): string {
  if (status === 'meter_verified') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
  if (status === 'meter_backed') {
    return 'bg-teal-50 text-teal-800 border-teal-200';
  }
  return 'bg-neutral-100 text-neutral-700 border-neutral-200';
}

function getActionStatusBadgeClasses(status: InterventionActionStatus): string {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (status === 'active') return 'bg-sky-50 text-sky-800 border-sky-200';
  if (status === 'cancelled') return 'bg-neutral-100 text-neutral-600 border-neutral-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

export const InterventionLedgerView: React.FC = () => {
  const { voiceNavDirective, clearVoiceNavDirective } = useEnergy();
  const todayIst = useMemo(() => getIstDateString(), []);

  // Filters & query state
  const [preset, setPreset] = useState<HistoryDatePreset>('last_30_days');
  const [customStart, setCustomStart] = useState<string>(() => shiftIstDate(todayIst, -29));
  const [customEnd, setCustomEnd] = useState<string>(() => todayIst);
  const [building, setBuilding] = useState<string>('All');
  const [roomId, setRoomId] = useState<string>('All');
  const [triggerCategory, setTriggerCategory] = useState<string>('All');
  const [circuitType, setCircuitType] = useState<string>('All');
  const [actionStatus, setActionStatus] = useState<string>('All');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [verificationFilter, setVerificationFilter] = useState<string>('All');
  const [search, setSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<'timestamp' | 'energy' | 'duration' | 'room'>('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (!voiceNavDirective || voiceNavDirective.target !== 'history' || voiceNavDirective.subTab !== 'interventions') {
      return;
    }
    const f = voiceNavDirective.historyFilters;
    if (f?.preset) {
      setPreset(f.preset as HistoryDatePreset);
    }
    if (f?.building) {
      setBuilding(f.building);
    }
    if (f?.verificationStatus) {
      setVerificationFilter(f.verificationStatus === 'all' ? 'All' : f.verificationStatus);
    }
    if (f?.roomId) {
      setRoomId(f.roomId);
    }
    clearVoiceNavDirective(voiceNavDirective.id);
  }, [voiceNavDirective, clearVoiceNavDirective]);

  // Data state
  const [data, setData] = useState<InterventionLedgerListResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Detail drawer state
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<InterventionDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);

  const loadLedger = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams();
      qs.set('preset', preset);
      if (preset === 'custom') {
        qs.set('startDate', customStart);
        qs.set('endDate', customEnd);
      }
      if (building !== 'All') qs.set('building', building);
      if (roomId !== 'All') qs.set('roomId', roomId);
      if (triggerCategory !== 'All') qs.set('triggerCategory', triggerCategory);
      if (circuitType !== 'All') qs.set('circuitType', circuitType);
      if (actionStatus !== 'All') qs.set('actionStatus', actionStatus);
      if (sourceFilter !== 'All') qs.set('source', sourceFilter);
      if (verificationFilter !== 'All') qs.set('verificationStatus', verificationFilter);
      if (search.trim()) qs.set('search', search.trim());
      qs.set('sortBy', sortBy);
      qs.set('sortDir', sortDir);

      const res = await authFetch(`/api/history/interventions?${qs.toString()}`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || 'Failed to load intervention ledger.');
      }
      const json = (await res.json()) as InterventionLedgerListResponse;
      setData(json);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load energy intervention ledger.');
    } finally {
      setIsLoading(false);
    }
  }, [
    preset,
    customStart,
    customEnd,
    building,
    roomId,
    triggerCategory,
    circuitType,
    actionStatus,
    sourceFilter,
    verificationFilter,
    search,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  useEffect(() => {
    if (!selectedEventId) {
      setDetailData(null);
      return;
    }
    let cancelled = false;
    setIsDetailLoading(true);
    authFetch(`/api/history/interventions/${encodeURIComponent(selectedEventId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: InterventionDetailResponse | null) => {
        if (!cancelled) setDetailData(json);
      })
      .catch(() => {
        if (!cancelled) setDetailData(null);
      })
      .finally(() => {
        if (!cancelled) setIsDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEventId]);

  const availableRooms = useMemo(() => {
    const list = data?.filterOptions.rooms ?? [];
    if (building === 'All') return list;
    return list.filter((r) => r.building === building);
  }, [data, building]);

  useEffect(() => {
    if (roomId !== 'All' && !availableRooms.some((r) => r.roomId === roomId)) {
      setRoomId('All');
    }
  }, [availableRooms, roomId]);

  const handleResetFilters = () => {
    setPreset('last_30_days');
    setBuilding('All');
    setRoomId('All');
    setTriggerCategory('All');
    setCircuitType('All');
    setActionStatus('All');
    setSourceFilter('All');
    setVerificationFilter('All');
    setSearch('');
    setSortBy('timestamp');
    setSortDir('desc');
  };

  const hasActiveFilters =
    building !== 'All' ||
    roomId !== 'All' ||
    triggerCategory !== 'All' ||
    circuitType !== 'All' ||
    actionStatus !== 'All' ||
    sourceFilter !== 'All' ||
    verificationFilter !== 'All' ||
    search.trim().length > 0;

  const summary = data?.summary;

  return (
    <div className="space-y-5">
      {/* Summary Indicators Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-2xl glass-card">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>Total Interventions</span>
            <Layers className="w-3.5 h-3.5 text-neutral-500" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-neutral-900 tabular-nums">
            {summary ? summary.totalInterventions : '—'}
          </div>
          <div className="mt-1.5 text-[11px] text-neutral-600 flex flex-wrap gap-x-2 gap-y-0.5">
            <span>{summary?.countedInterventions ?? 0} counted</span>
            {summary && summary.excludedOverlapCount > 0 && (
              <span className="text-amber-700 font-medium">
                · {summary.excludedOverlapCount} overlap-excluded
              </span>
            )}
            {summary && summary.notCalculableCount > 0 && (
              <span className="text-neutral-500">
                · {summary.notCalculableCount} open/non-calculable
              </span>
            )}
          </div>
        </div>

        <div className="p-4 rounded-2xl glass-card">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>Estimated Avoided Energy</span>
            <Zap className="w-3.5 h-3.5 text-emerald-700" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-emerald-800 tabular-nums">
              {summary ? summary.estimatedAvoidedKwh.toFixed(3) : '—'}
            </span>
            <span className="text-xs font-semibold text-neutral-500">kWh</span>
          </div>
          <div className="mt-1.5 text-[11px] text-neutral-500 flex items-center justify-between gap-2">
            <span className="tabular-nums">
              {summary ? `${summary.estimatedAvoidedWh.toFixed(1)} Wh` : '—'} · Modelled, deduped
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl glass-card">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>Meter-Verified Savings</span>
            <ShieldCheck className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-neutral-700 tabular-nums">
              {summary ? summary.meterVerifiedAvoidedKwh.toFixed(3) : '0.000'}
            </span>
            <span className="text-xs font-semibold text-neutral-500">kWh</span>
          </div>
          <div className="mt-1.5 text-[11px] text-neutral-500">
            {summary && summary.meterDataEventCount > 0
              ? `${summary.meterBackedAvoidedKwh.toFixed(3)} kWh meter-backed`
              : 'Sub-meter integration pending'}
          </div>
        </div>

        <div className="p-4 rounded-2xl glass-card">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>Anti-Double-Count Guard</span>
            <GitBranch className="w-3.5 h-3.5 text-emerald-700" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-neutral-900">
            Circuit-Interval Isolation Active
          </div>
          <p className="mt-1 text-[11px] text-neutral-600 leading-snug">
            {summary
              ? `${summary.overlapAdjustedCount} trimmed · ${summary.excludedOverlapCount} excluded · ${summary.simulatedEventCount} modelled / ${summary.hardwareEventCount} hardware`
              : 'Checking room + circuit interval overlaps...'}
          </p>
        </div>
      </div>

      {/* Building-Level Estimated Breakdown Strip */}
      {summary && summary.byBuilding.length > 0 && (
        <div className="p-3.5 sm:p-4 rounded-2xl glass-card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <span className="text-xs font-bold text-neutral-800">
              Estimated Avoided Energy by Campus Building
            </span>
            <span className="text-[11px] text-neutral-500">
              Range: {data?.range.startDate} to {data?.range.endDate} (IST)
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {summary.byBuilding.map((b) => (
              <button
                key={b.building}
                type="button"
                onClick={() => setBuilding(building === b.building ? 'All' : b.building)}
                className={`text-left p-2.5 rounded-xl border transition-colors cursor-pointer ${
                  building === b.building
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-neutral-50/70 border-neutral-200/80 hover:bg-neutral-100/70'
                }`}
              >
                <div className="text-[11px] font-semibold text-neutral-800 truncate">{b.building}</div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-emerald-800 tabular-nums">
                    {b.estimatedAvoidedKwh.toFixed(3)} kWh
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {b.interventionsCount} evt{b.interventionsCount === 1 ? '' : 's'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter, Search & Sort Controls */}
      <div className="p-3.5 sm:p-4 rounded-2xl glass-card space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-neutral-600 mr-1">
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
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/80'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-[11px] font-semibold cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadLedger()}
              aria-label="Refresh intervention ledger"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-[11px] font-semibold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-600">
              <span>From (IST):</span>
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-white text-neutral-900 text-xs"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-600">
              <span>To (IST):</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={todayIst}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-white text-neutral-900 text-xs"
              />
            </label>
          </div>
        )}

        {/* Dropdown Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1 border-t border-neutral-200/70">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search room, rule, circuit, ID..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <select
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            aria-label="Filter by building"
            className="px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
          >
            <option value="All">All Buildings</option>
            {(data?.filterOptions.buildings ?? []).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            aria-label="Filter by room"
            className="px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
          >
            <option value="All">All 25 Classrooms</option>
            {availableRooms.map((r) => (
              <option key={r.roomId} value={r.roomId}>
                {r.roomCode} · {r.roomName}
              </option>
            ))}
          </select>

          <select
            value={triggerCategory}
            onChange={(e) => setTriggerCategory(e.target.value)}
            aria-label="Filter by trigger type"
            className="px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
          >
            <option value="All">All Trigger Types</option>
            {(data?.filterOptions.triggers ?? []).map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>

          <select
            value={circuitType}
            onChange={(e) => setCircuitType(e.target.value)}
            aria-label="Filter by affected circuit"
            className="px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
          >
            <option value="All">All Circuits</option>
            {(data?.filterOptions.circuitTypes ?? []).map((c) => (
              <option key={c} value={c}>
                {CIRCUIT_LABELS[c]}
              </option>
            ))}
          </select>

          <select
            value={actionStatus}
            onChange={(e) => setActionStatus(e.target.value)}
            aria-label="Filter by action status"
            className="px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
          >
            <option value="All">All Action Statuses</option>
            {(data?.filterOptions.statuses ?? []).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Filter by data source"
            className="px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
          >
            <option value="All">All Data Sources</option>
            {(data?.filterOptions.sources ?? []).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <select
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value)}
              aria-label="Filter by verification status"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="All">All Evidence Levels</option>
              {(data?.filterOptions.verificationStatuses ?? []).map((v) => (
                <option key={v} value={v}>
                  {VERIFICATION_LABELS[v]}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'timestamp' | 'energy' | 'duration' | 'room')
              }
              aria-label="Sort interventions by"
              className="px-2 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-emerald-600"
            >
              <option value="timestamp">Sort: Time</option>
              <option value="energy">Sort: Energy</option>
              <option value="duration">Sort: Duration</option>
              <option value="room">Sort: Room</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              title={`Sort direction: ${sortDir === 'desc' ? 'Descending' : 'Ascending'}`}
              className="p-1.5 rounded-xl bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700 cursor-pointer shrink-0"
            >
              {sortDir === 'desc' ? (
                <ArrowDown className="w-3.5 h-3.5" />
              ) : (
                <ArrowUp className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error State */}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Event Table */}
      <div className="rounded-2xl glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-2 bg-neutral-50/60">
          <div className="flex items-center gap-2 text-xs font-bold text-neutral-800">
            <Filter className="w-3.5 h-3.5 text-emerald-700" />
            <span>Recorded Interventions</span>
            <span className="text-[11px] font-medium text-neutral-500">
              ({data?.records.length ?? 0} matching events · Click any row to inspect calculation & evidence)
            </span>
          </div>
          <span className="text-[11px] text-neutral-500">
            Formula: ΔW × Attributed Hours = Wh (÷1000 = kWh)
          </span>
        </div>

        {isLoading && !data ? (
          <div className="p-10 flex items-center justify-center gap-2 text-xs text-neutral-500">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
            <span>Loading intervention ledger...</span>
          </div>
        ) : !data || data.records.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-neutral-800">
              No interventions match the current filters
            </p>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              Expand the date range (e.g., Last 30 days) or clear building/room/trigger filters to inspect logged interventions.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/40 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  <th className="py-2.5 px-4">Timestamp (IST)</th>
                  <th className="py-2.5 px-3">Room & Building</th>
                  <th className="py-2.5 px-3">Trigger / Reason</th>
                  <th className="py-2.5 px-3">Action & Circuit</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3 text-right">Est. Avoided Energy</th>
                  <th className="py-2.5 px-3">Provenance & Status</th>
                  <th className="py-2.5 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200/60 text-xs">
                {data.records.map((rec: InterventionRecord) => {
                  const isExcluded = rec.overlap.status === 'excluded_overlap_duplicate';
                  const isTrimmed = rec.overlap.status === 'counted_partial_overlap_trimmed';
                  const notCalc = !rec.energyCalculation.calculable;

                  return (
                    <tr
                      key={rec.id}
                      onClick={() => setSelectedEventId(rec.id)}
                      className="hover:bg-emerald-50/40 transition-colors cursor-pointer align-top"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-neutral-900 tabular-nums">
                          {rec.startAtIst}
                        </div>
                        <div className="text-[10px] text-neutral-500 font-mono mt-0.5 flex items-center gap-1.5">
                          <span>{rec.id}</span>
                          {rec.relatedActionCountInGroup > 1 && (
                            <span className="px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-neutral-600 font-sans font-semibold">
                              Group ({rec.relatedActionCountInGroup})
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-neutral-900">
                          {rec.roomCode} · {rec.roomName}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {rec.building} · {rec.floor}
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-xs">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-[10px] font-semibold text-neutral-700 mb-1">
                          {TRIGGER_LABELS[rec.triggerCategory]}
                        </span>
                        <div className="text-neutral-800 leading-snug line-clamp-2">
                          {rec.triggerSummary}
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-xs">
                        <div className="font-semibold text-neutral-900">
                          {rec.affectedCircuitName}
                        </div>
                        <div className="text-[11px] text-neutral-600 mt-0.5">
                          {rec.previousState} → <span className="font-semibold text-neutral-900">{rec.newState}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 font-medium text-neutral-800 tabular-nums">
                          <Clock className="w-3 h-3 text-neutral-400" />
                          <span>{formatDuration(rec.durationMinutes)}</span>
                        </div>
                        <div className="mt-1">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold ${getActionStatusBadgeClasses(
                              rec.actionStatus
                            )}`}
                          >
                            {STATUS_LABELS[rec.actionStatus]}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {notCalc ? (
                          <div>
                            <span className="inline-block px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-[10px] font-semibold text-neutral-600">
                              Unavailable
                            </span>
                            <div className="text-[10px] text-neutral-500 mt-0.5">
                              Not fabricated
                            </div>
                          </div>
                        ) : isExcluded ? (
                          <div>
                            <span className="font-bold text-neutral-500 tabular-nums">0.0 Wh</span>
                            <div className="text-[10px] font-semibold text-amber-700 mt-0.5">
                              Overlap Excluded
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-bold text-emerald-800 tabular-nums">
                              {rec.energyCalculation.attributedEnergyAvoidedWh?.toFixed(1)} Wh
                            </div>
                            <div className="text-[10px] text-neutral-500 tabular-nums">
                              ({rec.energyCalculation.attributedEnergyAvoidedKwh?.toFixed(3)} kWh)
                            </div>
                            {isTrimmed && (
                              <div className="text-[10px] font-semibold text-amber-700 mt-0.5">
                                Overlap Trimmed
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-bold tracking-wide ${getSourceBadgeClasses(
                              rec.source
                            )}`}
                          >
                            {SOURCE_LABELS[rec.source]}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${getVerificationBadgeClasses(
                              rec.verificationStatus
                            )}`}
                          >
                            {VERIFICATION_LABELS[rec.verificationStatus]}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-neutral-400">
                        <ChevronRight className="w-4 h-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event Detail Drawer Modal */}
      {selectedEventId && (
        <div
          className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-[2px] flex justify-end"
          onClick={() => setSelectedEventId(null)}
        >
          <div
            className="w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl border-l border-neutral-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-xs border-b border-neutral-200 px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono font-semibold text-neutral-500">
                    {selectedEventId}
                  </span>
                  {detailData?.record && (
                    <>
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold ${getSourceBadgeClasses(
                          detailData.record.source
                        )}`}
                      >
                        {SOURCE_LABELS[detailData.record.source]}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${getVerificationBadgeClasses(
                          detailData.record.verificationStatus
                        )}`}
                      >
                        {VERIFICATION_LABELS[detailData.record.verificationStatus]}
                      </span>
                    </>
                  )}
                </div>
                <h2 className="text-base font-bold text-neutral-900 mt-1">
                  {detailData?.record
                    ? `${detailData.record.roomCode} · ${detailData.record.affectedCircuitName}`
                    : 'Intervention Audit Record'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEventId(null)}
                aria-label="Close intervention details"
                className="p-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-5 space-y-5 text-xs flex-1">
              {isDetailLoading || !detailData ? (
                <div className="py-16 flex items-center justify-center gap-2 text-neutral-500">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                  <span>Loading full audit record...</span>
                </div>
              ) : (
                <>
                  {/* Section A & B: Identification & Timing */}
                  <section className="p-4 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                      A & B · Identification, Location & Timing (IST)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <div className="text-[10px] text-neutral-500">Classroom & Building</div>
                        <div className="font-semibold text-neutral-900">
                          {detailData.record.roomCode} — {detailData.record.roomName}
                        </div>
                        <div className="text-[11px] text-neutral-600">
                          {detailData.record.building} · {detailData.record.floor}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-500">Event Group & Idempotency Key</div>
                        <div className="font-mono text-[11px] text-neutral-800 break-all">
                          {detailData.record.eventGroupId}
                        </div>
                        <div className="font-mono text-[10px] text-neutral-500 break-all">
                          {detailData.record.idempotencyKey}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-500">Trigger / Start Time (IST)</div>
                        <div className="font-medium text-neutral-900 tabular-nums">
                          Triggered: {detailData.record.triggerAtIst}
                        </div>
                        <div className="text-neutral-700 tabular-nums">
                          Started: {detailData.record.startAtIst}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-500">End Time & Duration</div>
                        <div className="font-medium text-neutral-900 tabular-nums">
                          Ended: {detailData.record.endAtIst ?? 'Open / Not yet completed'}
                        </div>
                        <div className="text-neutral-700 tabular-nums">
                          Duration: {formatDuration(detailData.record.durationMinutes)} · Recorded:{' '}
                          {detailData.record.recordedAtIst}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Section C: Trigger & Evidence */}
                  <section className="p-4 rounded-xl bg-white border border-neutral-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        C · Trigger, Rule Logic & Sensor Evidence
                      </span>
                      <span className="px-2 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-[10px] font-semibold text-neutral-700">
                        {TRIGGER_LABELS[detailData.record.triggerCategory]}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="font-semibold text-neutral-900">
                        {detailData.record.triggerSummary}
                      </div>
                      <p className="text-neutral-600 leading-relaxed">
                        {detailData.record.evidenceSummary}
                      </p>
                      <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200/70 text-[11px]">
                        <span className="font-semibold text-neutral-700">Control Rule: </span>
                        <span className="text-neutral-800">{detailData.record.ruleLogic}</span>
                      </div>
                    </div>

                    {/* Sensor Snapshot Grid */}
                    <div className="pt-2 border-t border-neutral-100">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-2">
                        <Cpu className="w-3 h-3" />
                        <span>
                          Sensor Snapshot ({detailData.record.sensorSnapshot.dataOrigin.replace('_', ' ')})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {detailData.record.sensorSnapshot.pirStatus && (
                          <div className="p-2 rounded-lg bg-neutral-50 border border-neutral-200/70">
                            <div className="text-[10px] text-neutral-500">PIR Motion</div>
                            <div className="font-semibold text-neutral-900">
                              {detailData.record.sensorSnapshot.pirStatus}
                            </div>
                          </div>
                        )}
                        {detailData.record.sensorSnapshot.naturalDaylightLux !== undefined &&
                          detailData.record.sensorSnapshot.naturalDaylightLux !== null && (
                            <div className="p-2 rounded-lg bg-neutral-50 border border-neutral-200/70">
                              <div className="text-[10px] text-neutral-500">Daylight (Lux)</div>
                              <div className="font-semibold text-neutral-900 tabular-nums">
                                {detailData.record.sensorSnapshot.naturalDaylightLux} lx
                              </div>
                            </div>
                          )}
                        {detailData.record.sensorSnapshot.temperatureC !== undefined &&
                          detailData.record.sensorSnapshot.temperatureC !== null && (
                            <div className="p-2 rounded-lg bg-neutral-50 border border-neutral-200/70">
                              <div className="text-[10px] text-neutral-500">Temperature</div>
                              <div className="font-semibold text-neutral-900 tabular-nums">
                                {detailData.record.sensorSnapshot.temperatureC} °C
                              </div>
                            </div>
                          )}
                        {detailData.record.sensorSnapshot.humidityPercent !== undefined &&
                          detailData.record.sensorSnapshot.humidityPercent !== null && (
                            <div className="p-2 rounded-lg bg-neutral-50 border border-neutral-200/70">
                              <div className="text-[10px] text-neutral-500">Humidity</div>
                              <div className="font-semibold text-neutral-900 tabular-nums">
                                {detailData.record.sensorSnapshot.humidityPercent}% RH
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  </section>

                  {/* Section D: Control Action */}
                  <section className="p-4 rounded-xl bg-white border border-neutral-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        D · Control Action
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${getActionStatusBadgeClasses(
                          detailData.record.actionStatus
                        )}`}
                      >
                        {STATUS_LABELS[detailData.record.actionStatus]}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <div className="text-[10px] text-neutral-500">Affected Circuit</div>
                        <div className="font-semibold text-neutral-900">
                          {detailData.record.affectedCircuitName}
                        </div>
                        <div className="text-[11px] text-neutral-500 font-mono">
                          {detailData.record.affectedCircuitId} ({CIRCUIT_LABELS[detailData.record.circuitType]})
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-500">State Transition & Actor</div>
                        <div className="font-semibold text-neutral-900">
                          {detailData.record.previousState} → {detailData.record.newState}
                        </div>
                        <div className="text-[11px] text-neutral-600">
                          Actor: {detailData.record.actor}
                        </div>
                      </div>
                    </div>
                    <div className="text-neutral-700 pt-1">
                      <span className="font-semibold">Action Performed: </span>
                      {detailData.record.actionPerformed}
                    </div>
                  </section>

                  {/* Section E: Counterfactual Energy Calculation & Overlap Isolation */}
                  <section className="p-4 rounded-xl bg-emerald-50/40 border border-emerald-200/80 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                        E · Counterfactual Energy Calculation & Overlap Guard
                      </span>
                      <span className="font-mono text-[10px] text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded">
                        {detailData.record.energyCalculation.calculationMethodVersion}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200/80">
                        <div className="text-[10px] text-neutral-500">Baseline Power</div>
                        <div className="font-bold text-neutral-900 tabular-nums">
                          {detailData.record.energyCalculation.counterfactualBaselineWatts !== null
                            ? `${detailData.record.energyCalculation.counterfactualBaselineWatts} W`
                            : 'Unavailable'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200/80">
                        <div className="text-[10px] text-neutral-500">Post-Action Power</div>
                        <div className="font-bold text-neutral-900 tabular-nums">
                          {detailData.record.energyCalculation.postInterventionWatts !== null
                            ? `${detailData.record.energyCalculation.postInterventionWatts} W`
                            : 'Unavailable'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200/80">
                        <div className="text-[10px] text-neutral-500">Power Difference (ΔW)</div>
                        <div className="font-bold text-emerald-800 tabular-nums">
                          {detailData.record.energyCalculation.powerDifferenceWatts !== null
                            ? `${detailData.record.energyCalculation.powerDifferenceWatts} W`
                            : 'Unavailable'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200/80">
                        <div className="text-[10px] text-neutral-500">Attributed Avoided</div>
                        <div className="font-bold text-emerald-800 tabular-nums">
                          {detailData.record.energyCalculation.calculable &&
                          detailData.record.energyCalculation.attributedEnergyAvoidedWh !== null
                            ? `${detailData.record.energyCalculation.attributedEnergyAvoidedWh} Wh`
                            : 'Unavailable'}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-white border border-neutral-200 font-mono text-[11px] text-neutral-900">
                      {detailData.record.energyCalculation.formulaExpression}
                    </div>

                    <div className="space-y-1.5 text-[11px] text-neutral-700">
                      <div>
                        <span className="font-semibold text-neutral-900">Baseline Method: </span>
                        {detailData.record.energyCalculation.baselineMethod} —{' '}
                        {detailData.record.energyCalculation.baselineExplanation}
                      </div>
                      <div>
                        <span className="font-semibold text-neutral-900">Load Rating Source: </span>
                        {detailData.record.energyCalculation.loadRatingSource}
                      </div>
                      {detailData.record.energyCalculation.assumptions.length > 0 && (
                        <div>
                          <div className="font-semibold text-neutral-900 mb-0.5">
                            Documented Assumptions:
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-neutral-600">
                            {detailData.record.energyCalculation.assumptions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Overlap Attribution Callout */}
                    <div
                      className={`p-3 rounded-lg border text-[11px] space-y-1 ${
                        detailData.record.overlap.status === 'excluded_overlap_duplicate' ||
                        detailData.record.overlap.status === 'counted_partial_overlap_trimmed'
                          ? 'bg-amber-50 border-amber-200 text-amber-950'
                          : detailData.record.overlap.status === 'not_calculable_missing_data'
                          ? 'bg-neutral-100 border-neutral-200 text-neutral-700'
                          : 'bg-white border-emerald-200 text-emerald-950'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold">
                        {detailData.record.overlap.countedInTotals ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        ) : (
                          <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        )}
                        <span>
                          Attribution Status: {detailData.record.overlap.status.replace(/_/g, ' ')} ·{' '}
                          {detailData.record.overlap.countedInTotals
                            ? 'Counted in Totals'
                            : 'Excluded from Totals'}
                        </span>
                      </div>
                      <p className="leading-relaxed">{detailData.record.overlap.explanation}</p>
                      {detailData.record.overlap.overlappingEventIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="font-semibold">Conflicting Event(s):</span>
                          {detailData.record.overlap.overlappingEventIds.map((oid) => (
                            <button
                              key={oid}
                              type="button"
                              onClick={() => setSelectedEventId(oid)}
                              className="px-2 py-0.5 rounded bg-white border border-amber-300 font-mono text-[10px] text-amber-900 hover:bg-amber-100 cursor-pointer"
                            >
                              {oid}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Section F: Provenance & Verification */}
                  <section className="p-4 rounded-xl bg-white border border-neutral-200 space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                      F · Provenance & Verification Evidence
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold ${getSourceBadgeClasses(
                          detailData.record.source
                        )}`}
                      >
                        Source: {SOURCE_LABELS[detailData.record.source]}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${getVerificationBadgeClasses(
                          detailData.record.verificationStatus
                        )}`}
                      >
                        Evidence: {VERIFICATION_LABELS[detailData.record.verificationStatus]}
                      </span>
                    </div>
                    <p className="text-neutral-600 leading-relaxed">
                      {detailData.record.verificationBasis}
                    </p>
                  </section>

                  {/* Related Actions in Same Event Group */}
                  {detailData.relatedGroupEvents.length > 0 && (
                    <section className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-2.5">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                        Related Circuit Actions in Same Event Group ({detailData.record.eventGroupId})
                      </div>
                      <div className="space-y-2">
                        {detailData.relatedGroupEvents.map((rel) => (
                          <button
                            key={rel.id}
                            type="button"
                            onClick={() => setSelectedEventId(rel.id)}
                            className="w-full text-left p-2.5 rounded-lg bg-white border border-neutral-200 hover:border-emerald-400 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                          >
                            <div>
                              <div className="font-semibold text-neutral-900">
                                {rel.affectedCircuitName}
                              </div>
                              <div className="text-[11px] text-neutral-600">
                                {rel.previousState} → {rel.newState} · {rel.energyCalculation.attributedEnergyAvoidedWh ?? 0} Wh
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Correction & Recalculation Audit Trail */}
                  <section className="p-4 rounded-xl bg-white border border-neutral-200 space-y-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                      Correction & Recalculation Audit Trail
                    </div>
                    {detailData.corrections.length === 0 ? (
                      <p className="text-[11px] text-neutral-500">
                        No overlap trims, exclusions, or post-hoc recalculations recorded for this event.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {detailData.corrections.map((c) => (
                          <div
                            key={c.id}
                            className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/80 space-y-1 text-[11px]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-amber-950">{c.reason}</span>
                              <span className="text-[10px] text-neutral-500 tabular-nums">
                                {c.createdAtIst}
                              </span>
                            </div>
                            <div className="text-neutral-700">
                              <span className="font-semibold">Previous:</span> {c.previousSummary}
                            </div>
                            <div className="text-neutral-900">
                              <span className="font-semibold">Updated:</span> {c.newSummary}
                            </div>
                            <div className="text-[10px] text-neutral-500">Actor: {c.actor}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
