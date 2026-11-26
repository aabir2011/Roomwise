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
import { getCampusMeasurementByRoomwiseBuilding } from '../../data/campusBuildingMeasurements';
import { getRoomActivityState, summarizeApplianceGroup } from '../../utils/applianceUtils';
import { authFetch } from '../../context/AuthContext';
import type {
  CampusRoomVisualState,
  HistoricalSnapshotFrame,
  TimelinePresetId,
} from './types';
import { GlassSurface } from '../reactbits';
import { ActionButton, IconButton } from '../common/DesignSystem';

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
      <GlassSurface
        as="aside"
        aria-label={`${scopeTitle} summary`}
        borderRadius={12}
        distortionScale={-32}
        className="w-80 max-w-[calc(100vw-1.25rem)] max-h-full rounded-xl flex flex-col overflow-hidden pointer-events-auto text-[#f8faf9]"
      >
        <div className="px-4 py-3 border-b border-white/14 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <ActionButton
              variant="dark-ghost"
              size="xs"
              onClick={onBackOneLevel}
              icon={<ArrowLeft className="w-3.5 h-3.5" />}
              className="!bg-transparent !border-transparent hover:!bg-white/10 !px-1.5"
            >
              Campus Overview
            </ActionButton>
            <IconButton
              variant="dark-ghost"
              size="xs"
              label="Close overview panel"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </IconButton>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#34d399]">
              {selectedBuilding ? (
                <Building2 className="w-3 h-3 shrink-0" />
              ) : (
                <Layers className="w-3 h-3 shrink-0" />
              )}
              <span>{scopeTag}</span>
            </div>
            <h2 className="font-display text-base font-semibold text-white mt-0.5 truncate">{scopeTitle}</h2>
            <p className="text-[11px] text-[#cad8d2]">
              {scopedRooms.length} {scopedRooms.length === 1 ? 'classroom' : 'classrooms'} · Select
              a room to inspect details
            </p>
          </div>
        </div>

        <div className="p-3.5 sm:p-4 overflow-y-auto rw-dark-scrollbar space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
              <div className="text-[10px] font-medium text-[#cad8d2]">
                {isHistoricalMode ? 'Interval Energy' : 'Current Load'}
              </div>
              <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                {isHistoricalMode && scopedHistoricalKWh !== null
                  ? `${scopedHistoricalKWh.toFixed(2)} kWh`
                  : `${(totalCurrentW / 1000).toFixed(2)} kW`}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
              <div className="text-[10px] font-medium text-[#cad8d2]">Installed Rated Max</div>
              <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                {(totalRatedW / 1000).toFixed(2)} kW
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-[#dde8e3]">
                {isHistoricalMode ? 'Mean Interval Utilisation' : 'Installed Rated Utilisation'}
              </span>
              <span className="font-mono font-semibold text-emerald-200 tabular-nums">
                {utilPct}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/18 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(totalCurrentW > 0 ? 3 : 0, utilPct))}%` }}
              />
            </div>
          </div>

          {selectedBuilding && (() => {
            const geom = getCampusMeasurementByRoomwiseBuilding(selectedBuilding);
            if (!geom) return null;
            return (
              <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                    Building Footprint
                  </span>
                  <span className="text-[9.5px] font-mono text-[#d5e2dd] truncate">
                    {geom.areaProvenance}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 tabular-nums">
                  <span className="font-mono text-xs font-semibold text-white">
                    {geom.authoritativeFootprintAreaM2.toLocaleString()} m²
                    <span className="text-[10px] font-normal text-[#cad8d2] ml-1">
                      ({geom.authoritativeFootprintAreaFt2.toLocaleString()} ft²)
                    </span>
                  </span>
                  {geom.suppliedPerimeterM !== null ? (
                    <span className="font-mono text-[10.5px] text-[#d5e2dd]">
                      Perim. {geom.suppliedPerimeterM.toLocaleString()} m
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-[#cad8d2]">
                      Indiv. perim.: Not available
                    </span>
                  )}
                </div>
                {geom.combinedComplexRef && (
                  <p className="text-[10px] text-emerald-100 leading-snug">
                    OB + NB measured jointly: {geom.combinedComplexRef.suppliedCombinedAreaM2.toLocaleString()} m²
                    ({geom.combinedComplexRef.suppliedCombinedPerimeterM} m perimeter · Supplied calculated area).
                    Wing share: {geom.combinedComplexRef.proportionalSharePercent}%.
                  </p>
                )}
                <p className="text-[10px] text-[#c2d2cc] leading-snug">
                  Source: {geom.measurementSource}. Vertical height &amp; roof profile: {geom.verticalGeometryProvenance}.
                </p>
              </div>
            );
          })()}

          <div className="space-y-3 pt-1">
            {groups.map((grp) => (
              <div key={grp.heading}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#cad8d2] mb-1.5">
                  {grp.heading}
                </div>
                <div className="space-y-1">
                  {grp.rooms.map((rm) => {
                    const st = visualStatesByRoomId.get(rm.id);
                    const watts = st?.powerWatts ?? rm.currentPowerWatts;
                    const dotColor =
                      watts <= 0
                        ? 'bg-slate-400'
                        : st?.intensityTier === 'elevated'
                        ? 'bg-amber-400'
                        : 'bg-emerald-400';

                    return (
                      <button
                        key={rm.id}
                        type="button"
                        onClick={() => onSelectRoom(rm.id)}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#091a15]/78 hover:bg-[#112c23]/90 border border-white/14 hover:border-emerald-400/50 transition-all active:scale-[0.99] text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                          <span className="font-mono text-[11px] font-semibold text-emerald-200 shrink-0">
                            {rm.roomCode}
                          </span>
                          <span className="text-[11px] text-[#edf4f1] truncate">{rm.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-mono text-[11px] font-medium text-white tabular-nums">
                            {isHistoricalMode && st?.historicalIntervalKWh !== undefined
                              ? `${st.historicalIntervalKWh.toFixed(2)} kWh`
                              : `${watts} W`}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-[#cad8d2]" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </GlassSurface>
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
      ? 'bg-amber-500/26 text-amber-100 border-amber-400/50'
      : currentW === 0
      ? 'bg-white/12 text-[#dde8e3] border-white/20'
      : 'bg-emerald-500/24 text-emerald-100 border-emerald-400/45';

  return (
    <GlassSurface
      as="aside"
      aria-label={`${selectedRoom.roomCode} classroom details`}
      borderRadius={12}
      distortionScale={-32}
      className="w-80 lg:w-[20.5rem] max-w-[calc(100vw-1.25rem)] max-h-full rounded-xl flex flex-col overflow-hidden pointer-events-auto text-[#f8faf9]"
    >
      {/* Header with Clear Step-Back Navigation */}
      <div className="px-4 py-3 border-b border-white/14 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <ActionButton
            variant="dark-ghost"
            size="xs"
            onClick={onBackOneLevel}
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
            className="!bg-transparent !border-transparent hover:!bg-white/10 !px-1.5 min-w-0 max-w-[82%]"
          >
            <span className="truncate">Back to {backLabel}</span>
          </ActionButton>
          <IconButton
            variant="dark-ghost"
            size="xs"
            label="Close classroom inspector"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#34d399]">
              <span className="font-mono">{selectedRoom.roomCode}</span>
              <span className="text-white/40">·</span>
              <span className="truncate text-[#d5e2dd]">{selectedRoom.building}</span>
            </div>
            <h2 className="font-display text-base font-semibold text-white mt-0.5 leading-snug">
              {selectedRoom.name}
            </h2>
            <p className="text-[11px] text-[#cad8d2] mt-0.5">
              {selectedRoom.floor} · {selectedRoom.type} · Cap {selectedRoom.capacity}
            </p>
          </div>

          <span
            className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border shrink-0 mt-0.5 whitespace-nowrap ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Provenance Strip */}
      <div
        className={`px-4 py-1.5 border-b text-[10.5px] flex items-center gap-1.5 ${
          isHistoricalMode
            ? 'bg-amber-950/60 border-amber-500/35 text-amber-100'
            : 'bg-[#06130f]/65 border-white/12 text-[#d5e2dd]'
        }`}
      >
        {isHistoricalMode ? (
          <>
            <Clock className="w-3 h-3 shrink-0 text-amber-200" />
            <span className="truncate">
              Historical Record · {activeHistoricalFrame?.label} ({activeHistoricalFrame?.subLabel})
            </span>
          </>
        ) : (
          <>
            <Activity className="w-3 h-3 shrink-0 text-emerald-300" />
            <span>Live Node · Confirmed State</span>
          </>
        )}
      </div>

      {/* Body */}
      <div className="p-3.5 sm:p-4 overflow-y-auto rw-dark-scrollbar space-y-3 text-xs">
        {/* Primary Metrics Strip */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
            <div className="text-[10px] text-[#cad8d2]">
              {isHistoricalMode ? 'Mean Load' : 'Current Load'}
            </div>
            <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
              {currentW} W
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
            <div className="text-[10px] text-[#cad8d2]">Rated Max</div>
            <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
              {ratedMaxW} W
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
            <div className="text-[10px] text-[#cad8d2]">Utilisation</div>
            <div className="font-mono text-sm font-semibold text-emerald-200 mt-0.5 tabular-nums">
              {ratedUtilPct}%
            </div>
          </div>
        </div>

        <div>
          <div className="w-full h-1.5 rounded-full bg-white/18 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                visualState?.intensityTier === 'elevated'
                  ? 'bg-amber-400'
                  : visualState?.intensityTier === 'inactive'
                  ? 'bg-slate-400'
                  : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min(100, Math.max(currentW > 0 ? 3 : 0, ratedUtilPct))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-[#cad8d2] mt-1.5 tabular-nums">
            <span>Installed Rated Max: {ratedMaxW} W</span>
            <span>Available Headroom: {Math.max(0, ratedMaxW - currentW)} W</span>
          </div>
        </div>

        {!isHistoricalMode ? (
          <>
            {/* Live Appliance States */}
            <div className="space-y-1.5 pt-1 border-t border-white/14">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#cad8d2] pt-1">
                Appliance Telemetry ({selectedRoom.appliances.length} Units)
              </div>

              <div className="p-2.5 rounded-xl bg-[#091a15]/78 border border-white/14 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sun className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-white">Lighting Array</div>
                    <div className="text-[10.5px] text-[#d5e2dd]">
                      {lightSummary.activeCount}/{lightSummary.totalCount} active ·{' '}
                      {lightSummary.avgPercent === 0 ? 'OFF' : `${lightSummary.avgPercent}% output`}
                    </div>
                  </div>
                </div>
                <span className="font-mono font-semibold text-amber-200 tabular-nums shrink-0">
                  {lightSummary.totalWatts} W
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-[#091a15]/78 border border-white/14 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Fan className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-white">BLDC Fan Sectors</div>
                    <div className="text-[10.5px] text-[#d5e2dd]">
                      {fanSummary.activeCount}/{fanSummary.totalCount} active ·{' '}
                      {fanSummary.avgPercent === 0 ? 'OFF' : `${fanSummary.avgPercent}% output`}
                    </div>
                  </div>
                </div>
                <span className="font-mono font-semibold text-white tabular-nums shrink-0">
                  {fanSummary.totalWatts} W
                </span>
              </div>

              {auxUnits.map((aux) => (
                <div
                  key={aux.id}
                  className="p-2.5 rounded-xl bg-[#091a15]/78 border border-white/14 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className="w-3.5 h-3.5 text-teal-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">{aux.name}</div>
                      <div className="text-[10.5px] text-[#d5e2dd]">
                        {aux.operatingMode || 'AUTO'} ·{' '}
                        {(aux.outputPercent ?? 0) === 0 ? 'OFF' : `${aux.outputPercent}%`}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono font-semibold text-white tabular-nums shrink-0">
                    {aux.currentPowerWatts} W
                  </span>
                </div>
              ))}
            </div>

            {/* PIR & Environmental Sensors */}
            <div className="space-y-1.5 pt-1 border-t border-white/14">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#cad8d2] pt-1">
                Occupancy &amp; Environment
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
                  <div className="text-[10px] text-[#cad8d2]">PIR Sensor</div>
                  <div className="font-medium text-white mt-0.5 text-[11px]">{pirLabel}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
                  <div className="text-[10px] text-[#cad8d2]">Desk Illuminance</div>
                  <div className="font-mono font-semibold text-white mt-0.5 tabular-nums">
                    {selectedRoom.environment.ambientLux} lx
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14 flex items-center gap-2">
                  <Thermometer className="w-3.5 h-3.5 text-[#cad8d2] shrink-0" />
                  <div>
                    <div className="text-[10px] text-[#cad8d2]">Temp / Heat Index</div>
                    <div className="font-mono font-semibold text-white tabular-nums">
                      {selectedRoom.environment.temperature}°C / {selectedRoom.environment.heatIndex}°C
                    </div>
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14 flex items-center gap-2">
                  <Droplets className="w-3.5 h-3.5 text-[#cad8d2] shrink-0" />
                  <div>
                    <div className="text-[10px] text-[#cad8d2]">Humidity / CO₂</div>
                    <div className="font-mono font-semibold text-white tabular-nums">
                      {selectedRoom.environment.humidity}% · {selectedRoom.environment.co2Ppm} ppm
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Control Override / Active Audit Status */}
            {(manualCount > 0 || roomFindings.length > 0) && (
              <div className="p-2.5 rounded-xl bg-amber-950/65 border border-amber-400/40 text-amber-100 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>
                    {roomFindings.length > 0
                      ? roomFindings[0].title
                      : `${manualCount} unit${manualCount === 1 ? '' : 's'} under manual override`}
                  </span>
                </div>
                {roomFindings.length > 0 && (
                  <p className="text-[10.5px] text-amber-100 leading-relaxed">
                    {roomFindings[0].description}
                  </p>
                )}
              </div>
            )}

            {/* Read-only notice + optional jump to existing ROOMWISE control modal */}
            <div className="pt-2.5 border-t border-white/14 flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#cad8d2] whitespace-nowrap">Read-only 3D view</span>
              <ActionButton
                variant="forest"
                size="sm"
                onClick={() => onOpenControlModal(selectedRoom.id)}
                icon={<SlidersHorizontal className="w-3 h-3" />}
              >
                Appliance Controls
              </ActionButton>
            </div>
          </>
        ) : (
          /* Historical Interval Breakdown (Strictly reconstructed from SQLite records) */
          <div className="space-y-2.5 pt-1 border-t border-white/14">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#cad8d2] pt-1">
              Recorded Interval Breakdown
            </div>

            {isLoadingHistory ? (
              <div className="py-5 flex items-center justify-center gap-2 text-[#cad8d2]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300" />
                <span>Loading interval record...</span>
              </div>
            ) : matchedHistoryPoint ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
                    <div className="text-[10px] text-[#cad8d2]">Recorded Energy</div>
                    <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                      {matchedHistoryPoint.actualKWh.toFixed(3)} kWh
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14">
                    <div className="text-[10px] text-[#cad8d2]">Occupancy / Temp</div>
                    <div className="font-mono text-sm font-semibold text-white mt-0.5 tabular-nums">
                      {Math.round(matchedHistoryPoint.occupancyPercent)}% ·{' '}
                      {matchedHistoryPoint.temperatureC.toFixed(1)}°C
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[#091a15]/78 border border-white/14 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#d5e2dd]">Lighting Energy</span>
                    <span className="font-mono font-medium text-white tabular-nums">
                      {matchedHistoryPoint.lightingKWh.toFixed(3)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#d5e2dd]">Fan Sectors Energy</span>
                    <span className="font-mono font-medium text-white tabular-nums">
                      {matchedHistoryPoint.fanKWh.toFixed(3)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#d5e2dd]">Auxiliary Equipment</span>
                    <span className="font-mono font-medium text-white tabular-nums">
                      {matchedHistoryPoint.auxKWh.toFixed(3)} kWh
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] pt-1.5 border-t border-white/14">
                    <span className="text-[#d5e2dd]">Manual Override Share</span>
                    <span className="font-mono font-medium text-white tabular-nums">
                      {Math.round(matchedHistoryPoint.manualSharePercent)}%
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-2.5 rounded-xl bg-[#091a15]/78 border border-white/14">
                <div className="text-[11px] text-[#d5e2dd]">
                  Recorded interval energy:{' '}
                  <span className="font-mono font-semibold text-white">
                    {(visualState?.historicalIntervalKWh ?? 0).toFixed(3)} kWh
                  </span>
                </div>
              </div>
            )}

            <div className="p-2.5 rounded-xl bg-[#06130f]/75 border border-white/14 flex items-start gap-2 text-[10.5px] text-[#d5e2dd] leading-relaxed">
              <Info className="w-3.5 h-3.5 text-[#cad8d2] shrink-0 mt-0.5" />
              <span>
                Historical SQLite intervals store room-level energy splits, occupancy, and
                temperature; individual fixture dimming levels are not logged historically.
              </span>
            </div>
          </div>
        )}
      </div>
    </GlassSurface>
  );
};
