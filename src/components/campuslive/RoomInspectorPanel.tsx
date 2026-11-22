/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  X,
  ArrowLeft,
  Zap,
  Sun,
  Fan,
  Thermometer,
  Droplets,
  AlertTriangle,
  SlidersHorizontal,
  Building2,
  Layers,
  Clock,
  Activity,
  ChevronRight,
  Info,
  Loader2,
} from 'lucide-react';
import type { AuditFinding, BuildingName, Classroom, Floor } from '../../types/energy';
import type { RoomHistoryDetailResponse } from '../../types/history';
import { computeAppliancesRatedPowerWatts } from '../../data/roomApplianceSpecs';
import { getRoomActivityState, summarizeApplianceGroup } from '../../utils/applianceUtils';
import { authFetch } from '../../context/AuthContext';
import type {
  CampusRoomVisualState,
  HistoricalSnapshotFrame,
  TimelinePresetId,
} from './types';

interface RoomInspectorPanelProps {
  selectedRoom: Classroom | null;
  selectedBuilding: BuildingName | null;
  selectedFloor: Floor | 'All';
  allClassrooms: Classroom[];
  visualState: CampusRoomVisualState | null;
  visualStatesByRoomId: Map<string, CampusRoomVisualState>;
  auditFindings: AuditFinding[];
  isHistoricalMode: boolean;
  historicalPreset: TimelinePresetId;
  activeHistoricalFrame: HistoricalSnapshotFrame | null;
  onBackOneLevel: () => void;
  onClose: () => void;
  onSelectRoom: (roomId: string) => void;
  onOpenControlModal: (roomId: string) => void;
}

export const RoomInspectorPanel: React.FC<RoomInspectorPanelProps> = ({
  selectedRoom,
  selectedBuilding,
  selectedFloor,
  allClassrooms,
  visualState,
  visualStatesByRoomId,
  auditFindings,
  isHistoricalMode,
  historicalPreset,
  activeHistoricalFrame,
  onBackOneLevel,
  onClose,
  onSelectRoom,
  onOpenControlModal,
}) => {
  const [roomHistory, setRoomHistory] = useState<RoomHistoryDetailResponse | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    if (!isHistoricalMode || !selectedRoom) {
      setRoomHistory(null);
      return;
    }
    let cancelled = false;
    setIsLoadingHistory(true);
    authFetch(
      `/api/history/room/${encodeURIComponent(selectedRoom.id)}?preset=${encodeURIComponent(
        historicalPreset
      )}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RoomHistoryDetailResponse | null) => {
        if (!cancelled) {
          setRoomHistory(data && data.ok ? data : null);
        }
      })
      .catch(() => {
        if (!cancelled) setRoomHistory(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isHistoricalMode, selectedRoom?.id, historicalPreset]);

  const hasScopeSelection = Boolean(selectedBuilding) || selectedFloor !== 'All';
  if (!selectedRoom && !hasScopeSelection) return null;

  // ---------------------------------------------------------------------------
  // LEVEL 1: BUILDING AND/OR FLOOR OVERVIEW PANEL (no specific classroom chosen)
  // ---------------------------------------------------------------------------
  if (!selectedRoom && hasScopeSelection) {
    const scopedRooms = allClassrooms.filter((r) => {
      if (selectedBuilding && r.building !== selectedBuilding) return false;
      if (selectedFloor !== 'All' && r.floor !== selectedFloor) return false;
      return true;
    });

    const totalRatedW = scopedRooms.reduce(
      (sum, r) => sum + (r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances)),
      0
    );
    const totalCurrentW = scopedRooms.reduce(
      (sum, r) => sum + (visualStatesByRoomId.get(r.id)?.powerWatts ?? r.currentPowerWatts),
      0
    );
    const utilPct =
      totalRatedW > 0 ? Math.min(100, Math.round((totalCurrentW / totalRatedW) * 100)) : 0;

    const scopedHistoricalKWh =
      isHistoricalMode && activeHistoricalFrame
        ? scopedRooms.reduce(
            (sum, r) => sum + (visualStatesByRoomId.get(r.id)?.historicalIntervalKWh ?? 0),
            0
          )
        : null;

    // Group by floor when a single building is chosen, or by building when a floor is isolated campus-wide
    const groups = selectedBuilding
      ? ['3rd Floor', '2nd Floor', '1st Floor', 'Ground Floor']
          .map((fl) => ({
            heading: fl,
            rooms: scopedRooms.filter((r) => r.floor === fl),
          }))
          .filter((g) => g.rooms.length > 0)
      : Array.from(new Set(scopedRooms.map((r) => r.building))).map((bldg) => ({
          heading: bldg,
          rooms: scopedRooms.filter((r) => r.building === bldg),
        }));

    const scopeTag =
      selectedBuilding && selectedFloor !== 'All'
        ? 'Block · Floor Scope'
        : selectedBuilding
        ? 'Block Overview'
        : 'Floor Level Overview';

    const scopeTitle =
      selectedBuilding && selectedFloor !== 'All'
        ? `${selectedBuilding} · ${selectedFloor}`
        : selectedBuilding
        ? selectedBuilding
        : selectedFloor;

    return (
      <aside
        aria-label={`${scopeTitle} summary`}
        className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-11rem)] sm:max-h-[calc(100vh-12rem)] bg-[#161d21]/95 border border-white/12 rounded-2xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto text-[#edf2f0]"
      >
        <div className="px-4 py-3 border-b border-white/10 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBackOneLevel}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9eb0a9] hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Campus Overview</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-[#8d9d97] hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close overview panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              {selectedBuilding ? (
                <Building2 className="w-3 h-3 shrink-0" />
              ) : (
                <Layers className="w-3 h-3 shrink-0" />
              )}
              <span>{scopeTag}</span>
            </div>
            <h2 className="text-sm font-semibold text-[#f3f7f5] mt-0.5 truncate">{scopeTitle}</h2>
            <p className="text-[11px] text-[#8d9d97]">
              {scopedRooms.length} {scopedRooms.length === 1 ? 'classroom' : 'classrooms'} · Select
              a room to inspect details
            </p>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
              <div className="text-[10px] font-medium text-[#8d9d97]">
                {isHistoricalMode ? 'Interval Energy' : 'Current Load'}
              </div>
              <div className="font-mono text-sm font-semibold text-[#f3f7f5] mt-0.5 tabular-nums">
                {isHistoricalMode && scopedHistoricalKWh !== null
                  ? `${scopedHistoricalKWh.toFixed(2)} kWh`
                  : `${(totalCurrentW / 1000).toFixed(2)} kW`}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
              <div className="text-[10px] font-medium text-[#8d9d97]">Installed Rated Max</div>
              <div className="font-mono text-sm font-semibold text-[#f3f7f5] mt-0.5 tabular-nums">
                {(totalRatedW / 1000).toFixed(2)} kW
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-[#9eb0a9]">
                {isHistoricalMode ? 'Mean Interval Utilisation' : 'Installed Rated Utilisation'}
              </span>
              <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                {utilPct}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(totalCurrentW > 0 ? 3 : 0, utilPct))}%` }}
              />
            </div>
          </div>

          <div className="space-y-3 pt-1">
            {groups.map((grp) => (
              <div key={grp.heading}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8d9d97] mb-1.5">
                  {grp.heading}
                </div>
                <div className="space-y-1">
                  {grp.rooms.map((rm) => {
                    const st = visualStatesByRoomId.get(rm.id);
                    const watts = st?.powerWatts ?? rm.currentPowerWatts;
                    const dotColor =
                      watts <= 0
                        ? 'bg-slate-500'
                        : st?.intensityTier === 'elevated'
                        ? 'bg-amber-400'
                        : 'bg-emerald-400';

                    return (
                      <button
                        key={rm.id}
                        type="button"
                        onClick={() => onSelectRoom(rm.id)}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#1c252a] hover:bg-[#243036] border border-white/8 hover:border-emerald-400/35 transition-colors text-left"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                          <span className="font-mono text-[11px] font-semibold text-emerald-300 shrink-0">
                            {rm.roomCode}
                          </span>
                          <span className="text-[11px] text-[#cfd9d5] truncate">{rm.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-mono text-[11px] font-medium text-[#f3f7f5] tabular-nums">
                            {isHistoricalMode && st?.historicalIntervalKWh !== undefined
                              ? `${st.historicalIntervalKWh.toFixed(2)} kWh`
                              : `${watts} W`}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-[#7f918b]" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  // ---------------------------------------------------------------------------
  // LEVEL 2: INDIVIDUAL CLASSROOM CONTEXTUAL INSPECTOR
  // ---------------------------------------------------------------------------
  if (!selectedRoom) return null;

  const ratedMaxW =
    selectedRoom.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(selectedRoom.appliances);
  const currentW = visualState?.powerWatts ?? selectedRoom.currentPowerWatts;
  const ratedUtilPct =
    ratedMaxW > 0 ? Math.min(100, Math.round((currentW / ratedMaxW) * 100)) : 0;

  const lightSummary = summarizeApplianceGroup(selectedRoom.appliances, 'lights');
  const fanSummary = summarizeApplianceGroup(selectedRoom.appliances, 'fan');
  const auxUnits = selectedRoom.appliances.filter(
    (a) => a.type === 'ac' || a.type === 'projector' || a.type === 'equipment'
  );
  const roomFindings = auditFindings.filter(
    (f) => f.classroomId === selectedRoom.id && !f.isResolved
  );
  const manualCount = selectedRoom.appliances.filter(
    (a) => a.operatingMode === 'MANUAL' || a.isManualOverride
  ).length;
  const pirLabel = getRoomActivityState(selectedRoom);

  const matchedHistoryPoint =
    isHistoricalMode && roomHistory && activeHistoricalFrame
      ? roomHistory.series.find((pt) => pt.key === activeHistoricalFrame.key) || null
      : null;

  const backLabel =
    selectedFloor !== 'All'
      ? selectedFloor
      : selectedBuilding || 'Campus Overview';

  const statusLabel =
    roomFindings.length > 0
      ? 'Alert'
      : currentW === 0
      ? 'Eco-Shed · 0 W'
      : 'Active';

  const statusClass =
    roomFindings.length > 0
      ? 'bg-amber-500/20 text-amber-200 border-amber-400/35'
      : currentW === 0
      ? 'bg-white/8 text-[#9eb0a9] border-white/12'
      : 'bg-emerald-500/18 text-emerald-200 border-emerald-400/35';

  return (
    <aside
      aria-label={`${selectedRoom.roomCode} classroom details`}
      className="w-84 max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-11rem)] sm:max-h-[calc(100vh-12rem)] bg-[#161d21]/95 border border-white/12 rounded-2xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto text-[#edf2f0]"
    >
      {/* Header with Clear Step-Back Navigation */}
      <div className="px-4 py-3 border-b border-white/10 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBackOneLevel}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9eb0a9] hover:text-white transition-colors truncate"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Back to {backLabel}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#8d9d97] hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label="Close classroom inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              <span className="font-mono">{selectedRoom.roomCode}</span>
              <span className="text-white/20">·</span>
              <span className="truncate text-[#9eb0a9]">{selectedRoom.building}</span>
            </div>
            <h2 className="text-sm font-semibold text-[#f3f7f5] mt-0.5 leading-snug">
              {selectedRoom.name}
            </h2>
            <p className="text-[11px] text-[#8d9d97] mt-0.5">
              {selectedRoom.floor} · {selectedRoom.type} · Cap {selectedRoom.capacity}
            </p>
          </div>

          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border shrink-0 mt-0.5 whitespace-nowrap ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Provenance Strip */}
      <div
        className={`px-4 py-1.5 border-b text-[10.5px] flex items-center gap-1.5 ${
          isHistoricalMode
            ? 'bg-amber-950/45 border-amber-500/25 text-amber-200'
            : 'bg-[#11171a] border-white/8 text-[#9eb0a9]'
        }`}
      >
        {isHistoricalMode ? (
          <>
            <Clock className="w-3 h-3 shrink-0 text-amber-300" />
            <span className="truncate">
              Historical Record · {activeHistoricalFrame?.label} ({activeHistoricalFrame?.subLabel})
            </span>
          </>
        ) : (
          <>
            <Activity className="w-3 h-3 shrink-0 text-emerald-400" />
            <span>Live Node · Confirmed State</span>
          </>
        )}
      </div>

      {/* Body */}
      <div className="p-4 overflow-y-auto space-y-3.5 text-xs">
        {/* Primary Metrics Strip */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
            <div className="text-[10px] text-[#8d9d97]">
              {isHistoricalMode ? 'Mean Load' : 'Current Load'}
            </div>
            <div className="font-mono text-sm font-semibold text-[#f3f7f5] mt-0.5 tabular-nums">
              {currentW} W
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
            <div className="text-[10px] text-[#8d9d97]">Rated Max</div>
            <div className="font-mono text-sm font-semibold text-[#f3f7f5] mt-0.5 tabular-nums">
              {ratedMaxW} W
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
            <div className="text-[10px] text-[#8d9d97]">Utilisation</div>
            <div className="font-mono text-sm font-semibold text-emerald-300 mt-0.5 tabular-nums">
              {ratedUtilPct}%
            </div>
          </div>
        </div>

        <div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                visualState?.intensityTier === 'elevated'
                  ? 'bg-amber-400'
                  : visualState?.intensityTier === 'inactive'
                  ? 'bg-slate-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(currentW > 0 ? 3 : 0, ratedUtilPct))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-[#8d9d97] mt-1.5 tabular-nums">
            <span>Installed Rated Max: {ratedMaxW} W</span>
            <span>Pre-Retrofit Ref: {selectedRoom.baselinePowerWatts} W</span>
          </div>
        </div>

        {!isHistoricalMode ? (
          <>
            {/* Live Appliance States */}
            <div className="space-y-1.5 pt-1 border-t border-white/8">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8d9d97] pt-1">
                Appliance Telemetry ({selectedRoom.appliances.length} Units)
              </div>

              <div className="p-2.5 rounded-xl bg-[#1c252a] border border-white/8 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sun className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-[#f3f7f5]">Lighting Array</div>
                    <div className="text-[10.5px] text-[#9eb0a9]">
                      {lightSummary.activeCount}/{lightSummary.totalCount} active ·{' '}
                      {lightSummary.avgPercent === 0 ? 'OFF' : `${lightSummary.avgPercent}% output`}
                    </div>
                  </div>
                </div>
                <span className="font-mono font-semibold text-amber-200 tabular-nums shrink-0">
                  {lightSummary.totalWatts} W
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-[#1c252a] border border-white/8 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Fan className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-[#f3f7f5]">BLDC Fan Sectors</div>
                    <div className="text-[10.5px] text-[#9eb0a9]">
                      {fanSummary.activeCount}/{fanSummary.totalCount} active ·{' '}
                      {fanSummary.avgPercent === 0 ? 'OFF' : `${fanSummary.avgPercent}% output`}
                    </div>
                  </div>
                </div>
                <span className="font-mono font-semibold text-[#f3f7f5] tabular-nums shrink-0">
                  {fanSummary.totalWatts} W
                </span>
              </div>

              {auxUnits.map((aux) => (
                <div
                  key={aux.id}
                  className="p-2.5 rounded-xl bg-[#1c252a] border border-white/8 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className="w-3.5 h-3.5 text-teal-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-[#f3f7f5] truncate">{aux.name}</div>
                      <div className="text-[10.5px] text-[#9eb0a9]">
                        {aux.operatingMode || 'AUTO'} ·{' '}
                        {(aux.outputPercent ?? 0) === 0 ? 'OFF' : `${aux.outputPercent}%`}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono font-semibold text-[#f3f7f5] tabular-nums shrink-0">
                    {aux.currentPowerWatts} W
                  </span>
                </div>
              ))}
            </div>

            {/* PIR & Environmental Sensors */}
            <div className="space-y-1.5 pt-1 border-t border-white/8">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8d9d97] pt-1">
                Occupancy &amp; Environment
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
                  <div className="text-[10px] text-[#8d9d97]">PIR Sensor</div>
                  <div className="font-medium text-[#edf2f0] mt-0.5 text-[11px]">{pirLabel}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
                  <div className="text-[10px] text-[#8d9d97]">Desk Illuminance</div>
                  <div className="font-mono font-semibold text-[#f3f7f5] mt-0.5 tabular-nums">
                    {selectedRoom.environment.ambientLux} lx
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8 flex items-center gap-2">
                  <Thermometer className="w-3.5 h-3.5 text-[#8d9d97] shrink-0" />
                  <div>
                    <div className="text-[10px] text-[#8d9d97]">Temp / Heat Index</div>
                    <div className="font-mono font-semibold text-[#f3f7f5] tabular-nums">
                      {selectedRoom.environment.temperature}°C / {selectedRoom.environment.heatIndex}°C
                    </div>
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8 flex items-center gap-2">
                  <Droplets className="w-3.5 h-3.5 text-[#8d9d97] shrink-0" />
                  <div>
                    <div className="text-[10px] text-[#8d9d97]">Humidity / CO₂</div>
                    <div className="font-mono font-semibold text-[#f3f7f5] tabular-nums">
                      {selectedRoom.environment.humidity}% · {selectedRoom.environment.co2Ppm} ppm
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Control Override / Active Audit Status */}
            {(manualCount > 0 || roomFindings.length > 0) && (
              <div className="p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/30 text-amber-100 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>
                    {roomFindings.length > 0
                      ? roomFindings[0].title
                      : `${manualCount} unit${manualCount === 1 ? '' : 's'} under manual override`}
                  </span>
                </div>
                {roomFindings.length > 0 && (
                  <p className="text-[10.5px] text-amber-200/85 leading-relaxed">
                    {roomFindings[0].description}
                  </p>
                )}
              </div>
            )}

            {/* Read-only notice + optional jump to existing ROOMWISE control modal */}
            <div className="pt-2.5 border-t border-white/10 flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#8d9d97] whitespace-nowrap">Read-only 3D view</span>
              <button
                type="button"
                onClick={() => onOpenControlModal(selectedRoom.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Appliance Controls</span>
              </button>
            </div>
          </>
        ) : (
          /* Historical Interval Breakdown (Strictly reconstructed from SQLite records) */
          <div className="space-y-2.5 pt-1 border-t border-white/8">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8d9d97] pt-1">
              Recorded Interval Breakdown
            </div>

            {isLoadingHistory ? (
              <div className="py-5 flex items-center justify-center gap-2 text-[#8d9d97]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                <span>Loading interval record...</span>
              </div>
            ) : matchedHistoryPoint ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
                    <div className="text-[10px] text-[#8d9d97]">Recorded Energy</div>
                    <div className="font-mono text-sm font-semibold text-[#f3f7f5] mt-0.5 tabular-nums">
                      {matchedHistoryPoint.actualKWh.toFixed(3)} kWh
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8">
                    <div className="text-[10px] text-[#8d9d97]">Occupancy / Temp</div>
                    <div className="font-mono text-sm font-semibold text-[#f3f7f5] mt-0.5 tabular-nums">
                      {Math.round(matchedHistoryPoint.occupancyPercent)}% ·{' '}
                      {matchedHistoryPoint.temperatureC.toFixed(1)}°C
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[#1c252a] border border-white/8 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#9eb0a9]">Lighting Energy</span>
                    <span className="font-mono font-medium text-[#f3f7f5] tabular-nums">
                      {matchedHistoryPoint.lightingKWh.toFixed(3)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#9eb0a9]">Fan Sectors Energy</span>
                    <span className="font-mono font-medium text-[#f3f7f5] tabular-nums">
                      {matchedHistoryPoint.fanKWh.toFixed(3)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#9eb0a9]">Auxiliary Equipment</span>
                    <span className="font-mono font-medium text-[#f3f7f5] tabular-nums">
                      {matchedHistoryPoint.auxKWh.toFixed(3)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] pt-1.5 border-t border-white/8">
                    <span className="text-[#9eb0a9]">Manual Override Share</span>
                    <span className="font-mono font-medium text-[#f3f7f5] tabular-nums">
                      {Math.round(matchedHistoryPoint.manualSharePercent)}%
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-2.5 rounded-xl bg-[#1c252a] border border-white/8">
                <div className="text-[11px] text-[#9eb0a9]">
                  Recorded interval energy:{' '}
                  <span className="font-mono font-semibold text-[#f3f7f5]">
                    {(visualState?.historicalIntervalKWh ?? 0).toFixed(3)} kWh
                  </span>
                </div>
              </div>
            )}

            <div className="p-2.5 rounded-xl bg-[#101518] border border-white/8 flex items-start gap-2 text-[10.5px] text-[#9eb0a9] leading-relaxed">
              <Info className="w-3.5 h-3.5 text-[#8d9d97] shrink-0 mt-0.5" />
              <span>
                Historical SQLite intervals store room-level energy splits, occupancy, and
                temperature; individual fixture dimming levels are not logged historically.
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
