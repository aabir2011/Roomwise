/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CloudSun, Sun, X, ArrowUpRight } from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { authFetch } from '../../context/AuthContext';
import type { BuildingName, Floor } from '../../types/energy';
import type { HistoryOverviewResponse } from '../../types/history';
import type { EnvironmentalOverviewResponse } from '../../types/environmental';
import { TOTAL_CAMPUS_RATED_POWER_WATTS } from '../../data/roomApplianceSpecs';
import { CampusLiveScene, type ProjectedLabelPos } from './CampusLiveScene';
import { CampusLiveDock } from './CampusLiveDock';
import { RoomInspectorPanel } from './RoomInspectorPanel';
import { WebGLFallbackView } from './WebGLFallbackView';
import { CAMPUS_LANDMARK_LABELS } from './campusLayoutSchema';
import { deriveCampusAtmosphere } from './campusAtmosphere';
import {
  buildHistoricalVisualStates,
  buildLiveVisualStates,
  CAMPUS_TOUR_STEPS,
  extractHistoricalFrames,
} from './campusDataAdapter';
import type {
  CameraPresetId,
  CampusVisualMode,
  HistoricalSnapshotFrame,
  TimelinePresetId,
} from './types';

export const CampusLiveView: React.FC = () => {
  const {
    classrooms,
    campusSummary,
    auditFindings,
    setSelectedRoomId: openRoomControlModal,
    setActiveTab,
  } = useEnergy();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CampusLiveScene | null>(null);

  const [webglError, setWebglError] = useState<string | null>(null);
  const [visualMode, setVisualMode] = useState<CampusVisualMode>('architectural');
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingName | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<Floor | 'All'>('All');
  const [inspectedRoomId, setInspectedRoomId] = useState<string | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const [showEnergyFlow, setShowEnergyFlow] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reduced motion preference
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  // Historical Timeline State (backed by real /api/history/overview SQLite records)
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [isHistoricalMode, setIsHistoricalMode] = useState(false);
  const [historicalPreset, setHistoricalPreset] = useState<TimelinePresetId>('today');
  const [historicalFrames, setHistoricalFrames] = useState<HistoricalSnapshotFrame[]>([]);
  const [historicalIndex, setHistoricalIndex] = useState(0);
  const [isHistoricalLoading, setIsHistoricalLoading] = useState(false);
  const [isHistoricalPlaying, setIsHistoricalPlaying] = useState(false);

  // Guided Exhibition Presentation Tour
  const [isTourActive, setIsTourActive] = useState(false);
  const [isTourPaused, setIsTourPaused] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);

  // Restrained campus-level external environmental context (cached server-side via Open-Meteo)
  const [envContext, setEnvContext] = useState<EnvironmentalOverviewResponse | null>(null);
  const [envDrawerOpen, setEnvDrawerOpen] = useState(false);
  const [weatherAtmosphereEnabled, setWeatherAtmosphereEnabled] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem('rw_campus_live_weather_atmosphere');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const handleToggleWeatherAtmosphere = useCallback(() => {
    setWeatherAtmosphereEnabled((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem('rw_campus_live_weather_atmosphere', String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const activeAtmosphere = useMemo(
    () => deriveCampusAtmosphere(envContext, weatherAtmosphereEnabled),
    [envContext, weatherAtmosphereEnabled]
  );

  useEffect(() => {
    let active = true;
    authFetch('/api/environment/overview')
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as EnvironmentalOverviewResponse;
      })
      .then((json) => {
        if (!active || !json?.ok) return;
        setEnvContext(json);
      })
      .catch(() => {
        // Non-blocking: Campus Live operates independently if weather is unavailable
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Track Fullscreen API transitions
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Load real historical intervals from ROOMWISE backend when Historical mode is activated
  const loadHistoricalPreset = useCallback(async (preset: TimelinePresetId) => {
    setIsHistoricalLoading(true);
    setIsHistoricalPlaying(false);
    try {
      const res = await authFetch(`/api/history/overview?preset=${encodeURIComponent(preset)}`);
      if (!res.ok) throw new Error(`History API status ${res.status}`);
      const data = (await res.json()) as HistoryOverviewResponse;
      if (data && data.ok && Array.isArray(data.series) && data.series.length > 0) {
        const frames = extractHistoricalFrames(data);
        setHistoricalFrames(frames);
        const peakIdx = frames.reduce(
          (best, f, idx) => (f.totalActualKWh > frames[best].totalActualKWh ? idx : best),
          0
        );
        setHistoricalIndex(peakIdx);
      } else {
        setHistoricalFrames([]);
        setHistoricalIndex(0);
      }
    } catch {
      setHistoricalFrames([]);
      setHistoricalIndex(0);
    } finally {
      setIsHistoricalLoading(false);
    }
  }, []);

  const handleSelectHistoricalPreset = useCallback(
    (preset: TimelinePresetId) => {
      setIsHistoricalMode(true);
      setHistoricalPreset(preset);
      void loadHistoricalPreset(preset);
    },
    [loadHistoricalPreset]
  );

  const handleSwitchToLive = useCallback(() => {
    setIsHistoricalPlaying(false);
    setIsHistoricalMode(false);
  }, []);

  // Historical playback interval timer
  useEffect(() => {
    if (!isHistoricalMode || !isHistoricalPlaying || historicalFrames.length <= 1) return;
    const timer = window.setInterval(() => {
      setHistoricalIndex((prev) => (prev + 1) % historicalFrames.length);
    }, 1700);
    return () => window.clearInterval(timer);
  }, [isHistoricalMode, isHistoricalPlaying, historicalFrames.length]);

  const activeHistoricalFrame =
    isHistoricalMode && historicalFrames[historicalIndex]
      ? historicalFrames[historicalIndex]
      : null;

  // Compute canonical visual states for all 25 rooms
  const roomVisualStates = useMemo(() => {
    if (isHistoricalMode && activeHistoricalFrame) {
      return buildHistoricalVisualStates(classrooms, activeHistoricalFrame);
    }
    return buildLiveVisualStates(classrooms, auditFindings);
  }, [classrooms, auditFindings, isHistoricalMode, activeHistoricalFrame]);

  const visualStatesByRoomId = useMemo(
    () => new Map(roomVisualStates.map((r) => [r.roomId, r])),
    [roomVisualStates]
  );

  // Store latest selection callbacks for Three.js raycast handler without recreating WebGL
  const onSelectRoomFrom3DRef = useRef<(roomId: string | null) => void>(() => {});
  onSelectRoomFrom3DRef.current = (roomId: string | null) => {
    if (isTourActive) return;
    if (roomId) {
      const rm = classrooms.find((c) => c.id === roomId);
      setInspectedRoomId(roomId);
      if (rm) setSelectedBuilding(rm.building);
    } else {
      setInspectedRoomId(null);
    }
  };

  const onSelectBuildingFrom3DRef = useRef<(building: BuildingName) => void>(() => {});
  onSelectBuildingFrom3DRef.current = (building: BuildingName) => {
    if (isTourActive) return;
    setInspectedRoomId(null);
    setSelectedBuilding(building);
  };

  // Direct DOM refs for 60fps zero-re-render 3D-projected campus landmark labels
  const labelDomRefs = useRef<Record<string, HTMLElement | null>>({});
  const handleProjectLabels = useCallback((positions: ProjectedLabelPos[]) => {
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const el = labelDomRefs.current[p.id];
      if (!el) continue;
      if (p.visible) {
        el.style.opacity = '1';
        el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      } else {
        el.style.opacity = '0';
      }
    }
  }, []);

  // Mount Three.js scene ONCE on isolated container
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    let engine: CampusLiveScene | null = null;
    try {
      engine = new CampusLiveScene(container, {
        onSelectRoom: (id) => onSelectRoomFrom3DRef.current(id),
        onSelectBuilding: (b) => onSelectBuildingFrom3DRef.current(b),
        onHoverRoom: (id) => setHoveredRoomId(id),
        onProjectLabels: handleProjectLabels,
        onWebGLContextLost: () => {
          setWebglError('The browser graphics context was interrupted.');
        },
      });
      sceneRef.current = engine;
    } catch (err) {
      setWebglError(
        err instanceof Error ? err.message : 'WebGL rendering could not be initialized.'
      );
      return;
    }

    return () => {
      engine?.dispose();
      sceneRef.current = null;
    };
  }, [handleProjectLabels]);

  // Push live/historical room data into Three.js smoothly without remounting
  useEffect(() => {
    sceneRef.current?.updateRoomData(roomVisualStates);
  }, [roomVisualStates]);

  // Push live weather-responsive atmosphere preset into Three.js smoothly
  useEffect(() => {
    sceneRef.current?.setAtmosphere(activeAtmosphere);
  }, [activeAtmosphere]);

  // Push scene view configuration updates into Three.js
  useEffect(() => {
    sceneRef.current?.updateConfig({
      visualMode,
      selectedFloor,
      selectedBuilding,
      selectedRoomId: inspectedRoomId,
      exploded,
      cutaway,
      showEnergyFlow,
      reducedMotion,
    });
  }, [
    visualMode,
    selectedFloor,
    selectedBuilding,
    inspectedRoomId,
    exploded,
    cutaway,
    showEnergyFlow,
    reducedMotion,
  ]);

  // Re-project landmark labels immediately whenever they remount
  useEffect(() => {
    if (!inspectedRoomId && !controlsCollapsed) {
      sceneRef.current?.requestRender();
    }
  }, [inspectedRoomId, controlsCollapsed]);

  // Apply Guided Exhibition Presentation Tour step
  const applyTourStep = useCallback((idx: number) => {
    const step = CAMPUS_TOUR_STEPS[idx];
    if (!step) return;
    setIsHistoricalMode(false);
    setIsHistoricalPlaying(false);
    setIsTimelineOpen(false);
    setToolsOpen(false);
    setVisualMode(step.visualMode);
    setSelectedFloor(step.selectedFloor ?? 'All');
    setSelectedBuilding(step.focusBuilding ?? null);
    setInspectedRoomId(step.focusRoomId ?? null);
    setExploded(step.exploded);
    setCutaway(step.cutaway);
    setShowEnergyFlow(step.showEnergyFlow);
    if (step.cameraPreset) {
      sceneRef.current?.applyCameraPreset(step.cameraPreset);
    }
  }, []);

  useEffect(() => {
    if (!isTourActive) return;
    applyTourStep(tourStepIndex);
  }, [isTourActive, tourStepIndex, applyTourStep]);

  useEffect(() => {
    if (!isTourActive || isTourPaused) return;
    const step = CAMPUS_TOUR_STEPS[tourStepIndex];
    if (!step) return;
    const timer = window.setTimeout(() => {
      if (tourStepIndex < CAMPUS_TOUR_STEPS.length - 1) {
        setTourStepIndex((prev) => prev + 1);
      } else {
        setIsTourPaused(true);
      }
    }, step.durationMs);
    return () => window.clearTimeout(timer);
  }, [isTourActive, isTourPaused, tourStepIndex]);

  const handleResetView = useCallback(() => {
    setSelectedBuilding(null);
    setSelectedFloor('All');
    setInspectedRoomId(null);
    setExploded(false);
    setCutaway(false);
    setShowEnergyFlow(false);
    setVisualMode('architectural');
    setToolsOpen(false);
    sceneRef.current?.applyCameraPreset('isometric');
  }, []);

  // Step up cleanly by one level in the exploration hierarchy
  const handleBackOneLevel = useCallback(() => {
    if (inspectedRoomId) {
      setInspectedRoomId(null);
      return;
    }
    if (selectedFloor !== 'All' && selectedBuilding) {
      setSelectedFloor('All');
      setExploded(false);
      return;
    }
    setSelectedBuilding(null);
    setSelectedFloor('All');
    setExploded(false);
    sceneRef.current?.applyCameraPreset('isometric');
  }, [inspectedRoomId, selectedFloor, selectedBuilding]);

  const handleCloseInspector = useCallback(() => {
    setInspectedRoomId(null);
    setSelectedBuilding(null);
    setSelectedFloor('All');
    setExploded(false);
    sceneRef.current?.applyCameraPreset('isometric');
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial on restricted iframes
    }
  }, []);

  // Keyboard shortcuts for fluid desktop exploration
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      if (e.key === 'Escape') {
        if (isTourActive) {
          setIsTourActive(false);
          return;
        }
        handleBackOneLevel();
      } else if (e.key === 'h' || e.key === 'H') {
        setControlsCollapsed((v) => !v);
      } else if (e.key === 'r' || e.key === 'R') {
        handleResetView();
      } else if (e.key === 'e' || e.key === 'E') {
        setExploded((v) => !v);
      } else if (e.key === 'c' || e.key === 'C') {
        setCutaway((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTourActive, handleBackOneLevel, handleResetView]);

  const inspectedRoom = useMemo(
    () => (inspectedRoomId ? classrooms.find((c) => c.id === inspectedRoomId) || null : null),
    [classrooms, inspectedRoomId]
  );

  const hoveredRoomVisual = hoveredRoomId ? visualStatesByRoomId.get(hoveredRoomId) || null : null;

  const liveLoadKW = (campusSummary.totalCurrentPowerWatts / 1000).toFixed(2);
  const ratedMaxKW = (TOTAL_CAMPUS_RATED_POWER_WATTS / 1000).toFixed(2);
  const isCampusOverview = !selectedBuilding && selectedFloor === 'All' && !inspectedRoom;

  return (
    <section
      ref={rootRef}
      aria-label="ROOMWISE Campus Live 3D Architectural Exploration"
      className={`relative w-full overflow-hidden bg-[#cad6dd] select-none ${
        isFullscreen ? 'h-screen w-screen' : 'h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-3.75rem)]'
      }`}
    >
      {/* 3D WebGL Canvas Mount (Isolated Empty Container) or Honest 2D Fallback */}
      {webglError ? (
        <WebGLFallbackView
          reason={webglError}
          visualMode={visualMode}
          selectedFloor={selectedFloor}
          selectedRoomId={inspectedRoomId}
          visualStatesByRoomId={visualStatesByRoomId}
          onSelectRoom={(id) => {
            const rm = classrooms.find((c) => c.id === id);
            setInspectedRoomId(id);
            if (rm) setSelectedBuilding(rm.building);
          }}
          onSelectBuilding={(b) => {
            setInspectedRoomId(null);
            setSelectedBuilding(b);
          }}
        />
      ) : (
        <div
          ref={canvasMountRef}
          className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        />
      )}

      {/* Restrained 3D-Projected Building Labels (5 structures only, hidden during room focus or Zen collapse) */}
      {!webglError && !inspectedRoom && !controlsCollapsed && (
        <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
          {CAMPUS_LANDMARK_LABELS.map((item) => {
            if (!item.buildingId) return null;
            const isSelectedBldg = selectedBuilding === item.buildingId;
            const isDimmed = Boolean(selectedBuilding) && item.buildingId !== selectedBuilding;

            return (
              <button
                key={item.id}
                ref={(el) => {
                  labelDomRefs.current[item.id] = el;
                }}
                type="button"
                onClick={() => {
                  if (isTourActive) return;
                  setInspectedRoomId(null);
                  setSelectedBuilding(item.buildingId!);
                }}
                style={{ opacity: 0 }}
                className={`absolute top-0 left-0 pointer-events-auto whitespace-nowrap px-2 py-0.5 rounded-md text-[10px] font-medium tracking-tight transition-colors shadow-sm cursor-pointer ${
                  isSelectedBldg
                    ? 'bg-[#0f3d2e]/95 text-emerald-100 border border-emerald-400/70 font-semibold'
                    : isDimmed
                    ? 'bg-[#161d21]/50 text-[#c2cec9]/70 border border-white/10 hover:bg-[#161d21]/85 hover:text-white'
                    : 'bg-[#161d21]/82 text-[#f1f5f3] border border-white/16 hover:bg-[#10382b]/95 hover:border-emerald-400/60'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Top-Left Minimal Architectural Context Header + Interactive Breadcrumb */}
      <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-10 pointer-events-none flex flex-col gap-2 max-w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-2rem)]">
        <div className="bg-[#161d21]/94 border border-white/12 rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-xl pointer-events-auto text-[#edf2f0]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h1 className="text-[11px] font-semibold tracking-wider text-emerald-400 uppercase whitespace-nowrap">
              Campus Live
            </h1>
            <span className="text-white/20 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="text-[11px] text-[#9eb0a9] hidden sm:inline whitespace-nowrap">
              DAV Model School · 1:1 Replica
            </span>
            <span className="text-white/20" aria-hidden="true">
              ·
            </span>
            <span className="text-[11px] font-mono tabular-nums">
              {isHistoricalMode && activeHistoricalFrame ? (
                <span className="text-amber-300 font-semibold">
                  {activeHistoricalFrame.label} · {activeHistoricalFrame.totalActualKWh.toFixed(2)}{' '}
                  kWh
                </span>
              ) : (
                <>
                  <span className="font-semibold text-[#f3f7f5]">{liveLoadKW} kW</span>
                  <span className="text-[#8d9d97]">
                    {' '}
                    / {ratedMaxKW} kW ({campusSummary.ratedUtilizationPercent}%)
                  </span>
                </>
              )}
            </span>
          </div>

          {/* Interactive Exploration Breadcrumb */}
          <nav
            aria-label="Campus exploration path"
            className="flex flex-wrap items-center gap-1 mt-1.5 text-[11px]"
          >
            <button
              type="button"
              onClick={handleCloseInspector}
              className={`transition-colors ${
                isCampusOverview
                  ? 'text-[#f3f7f5] font-semibold'
                  : 'text-[#9eb0a9] hover:text-white'
              }`}
            >
              Campus Overview
            </button>

            {selectedBuilding && (
              <>
                <ChevronRight className="w-3 h-3 text-white/25 shrink-0" />
                <button
                  type="button"
                  onClick={() => {
                    setInspectedRoomId(null);
                  }}
                  className={`transition-colors ${
                    !inspectedRoom && selectedFloor === 'All'
                      ? 'text-emerald-300 font-semibold'
                      : 'text-[#9eb0a9] hover:text-white'
                  }`}
                >
                  {selectedBuilding}
                </button>
              </>
            )}

            {selectedFloor !== 'All' && (
              <>
                <ChevronRight className="w-3 h-3 text-white/25 shrink-0" />
                <button
                  type="button"
                  onClick={() => setInspectedRoomId(null)}
                  className={`transition-colors ${
                    !inspectedRoom
                      ? 'text-emerald-300 font-semibold'
                      : 'text-[#9eb0a9] hover:text-white'
                  }`}
                >
                  {selectedFloor}
                </button>
              </>
            )}

            {inspectedRoom && (
              <>
                <ChevronRight className="w-3 h-3 text-white/25 shrink-0" />
                <span className="font-mono font-semibold text-emerald-300">
                  {inspectedRoom.roomCode}
                </span>
              </>
            )}

            {isCampusOverview && (
              <span className="hidden md:inline text-[10.5px] text-[#7f918b] ml-1.5">
                — Click any building or room to inspect · Drag to orbit
              </span>
            )}
          </nav>
        </div>

        {/* Restrained Campus-Level Environmental Context Indicator (tertiary visual weight) */}
        {envContext?.current && (
          <div className="pointer-events-auto self-start">
            <button
              type="button"
              onClick={() => setEnvDrawerOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#161d21]/88 hover:bg-[#1b2429]/95 border border-white/10 text-[11px] text-[#cfd9d5] shadow-md transition-colors cursor-pointer"
              title="Toggle outdoor campus environmental context (Open-Meteo model)"
            >
              <CloudSun className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-mono font-semibold text-[#edf2f0] tabular-nums">
                {envContext.current.temperatureC !== null
                  ? `${envContext.current.temperatureC.toFixed(1)}°C`
                  : '—'}
              </span>
              <span className="text-white/25">·</span>
              <span className="truncate max-w-[140px]">
                {envContext.current.condition.description || 'External Weather'}
              </span>
              {envContext.current.relativeHumidityPercent !== null && (
                <>
                  <span className="text-white/25 hidden sm:inline">·</span>
                  <span className="hidden sm:inline font-mono text-[#9eb0a9] tabular-nums">
                    {Math.round(envContext.current.relativeHumidityPercent)}% RH
                  </span>
                </>
              )}
            </button>

            {envDrawerOpen && (
              <div className="mt-2 w-72 sm:w-80 rounded-2xl bg-[#161d21]/95 border border-white/12 p-3.5 shadow-2xl text-[#edf2f0] space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                  <div className="flex items-center gap-1.5 font-semibold text-[11px] text-emerald-300 uppercase tracking-wider">
                    <CloudSun className="w-3.5 h-3.5" />
                    <span>Outdoor Campus Context</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnvDrawerOpen(false)}
                    className="p-1 rounded-lg hover:bg-white/10 text-[#9eb0a9] hover:text-white cursor-pointer"
                    aria-label="Close outdoor weather context"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums">
                  <div className="rounded-lg bg-white/5 p-2">
                    <div className="text-[10px] font-sans text-[#9eb0a9]">Outdoor</div>
                    <div className="font-semibold text-white">
                      {envContext.current.temperatureC !== null
                        ? `${envContext.current.temperatureC.toFixed(1)}°C`
                        : '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <div className="text-[10px] font-sans text-[#9eb0a9]">Cloud</div>
                    <div className="font-semibold text-white">
                      {envContext.current.cloudCoverPercent !== null
                        ? `${Math.round(envContext.current.cloudCoverPercent)}%`
                        : '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <div className="text-[10px] font-sans text-[#9eb0a9]">Indoor Avg</div>
                    <div className="font-semibold text-emerald-300">
                      {envContext.indoorCampusSnapshot.avgIndoorTempC.toFixed(1)}°C
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-xl bg-white/6 border border-white/10 px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-white">
                      Weather Atmosphere
                    </div>
                    <div className="text-[10px] text-[#9eb0a9] truncate">
                      {weatherAtmosphereEnabled
                        ? `Active: ${activeAtmosphere.label} lighting`
                        : 'Studio Daylight (fixed)'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={weatherAtmosphereEnabled}
                    onClick={handleToggleWeatherAtmosphere}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                      weatherAtmosphereEnabled
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                        : 'bg-white/10 text-[#cfd9d5] hover:bg-white/15'
                    }`}
                  >
                    {weatherAtmosphereEnabled ? 'On' : 'Off'}
                  </button>
                </div>

                <p className="text-[11px] text-[#9eb0a9] leading-relaxed">
                  Open-Meteo model-derived conditions ({envContext.freshness.forecast.fetchedAtIst || 'IST'}). Local room DHT11/LDR sensors remain authoritative.
                </p>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('environmental')}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-[11px] font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <span>Environmental</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('solar')}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/25 text-[11px] font-medium text-emerald-200 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Sun className="w-3 h-3" />
                    <span>Solar Potential</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* High-Contrast Contextual Legend (only rendered when heatmap mode or energy flow is active) */}
        {(showEnergyFlow || visualMode !== 'architectural') && (
          <div className="bg-[#161d21]/94 border border-white/12 rounded-xl px-3 py-1.5 text-[10.5px] text-[#c7d3ce] flex flex-wrap items-center gap-x-3 gap-y-1 shadow-lg">
            {visualMode === 'lighting' && (
              <>
                <span className="font-semibold text-amber-200">Lighting Heatmap</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#1e2529] border border-white/25" />
                  <span>0% OFF</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#9c6e2c]" />
                  <span>1–45%</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#e39e38]" />
                  <span>46–78%</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#ffdf82]" />
                  <span>79–100%</span>
                </span>
                {isHistoricalMode && (
                  <span className="text-[#8d9d97]">(Derived from historical kWh)</span>
                )}
              </>
            )}

            {visualMode === 'intensity' && (
              <>
                <span className="font-semibold text-emerald-300">Rated Utilisation</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#232b30] border border-white/20" />
                  <span>0 W Inactive</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#2c8c68]" />
                  <span>≤55% Rated</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#37999c]" />
                  <span>56–80%</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#e08c2e]" />
                  <span>&gt;80% / Alert</span>
                </span>
              </>
            )}

            {visualMode === 'environmental' && (
              <>
                <span className="font-semibold text-sky-300">Thermal</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#3a7ca5]" />
                  <span>&lt;25.5°C</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#36916d]" />
                  <span>25.5–27.4°C</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#d67438]" />
                  <span>&gt;27.4°C</span>
                </span>
              </>
            )}

            {showEnergyFlow && (
              <span className="text-emerald-300 font-medium">
                Conceptual Energy-Flow Pathways
              </span>
            )}
          </div>
        )}
      </div>

      {/* Subtle Hover Readout (Bottom-Left, non-blocking) */}
      {hoveredRoomVisual && !isTourActive && (
        <div className="hidden md:flex absolute bottom-20 left-4 z-10 pointer-events-none bg-[#161d21]/95 border border-white/12 rounded-xl px-3 py-2 shadow-xl items-center gap-2.5 text-xs text-[#edf2f0]">
          <span className="font-mono font-semibold text-emerald-300">
            {hoveredRoomVisual.roomCode}
          </span>
          <span className="text-[#f3f7f5] font-medium max-w-44 truncate">
            {hoveredRoomVisual.name}
          </span>
          <span className="text-white/20">·</span>
          <span className="font-mono text-[#b7c4bf] tabular-nums">
            {visualMode === 'lighting'
              ? hoveredRoomVisual.lightingLevel <= 0
                ? 'Lights OFF · 0 W'
                : `${hoveredRoomVisual.lightingLevel}% Light · ${hoveredRoomVisual.powerWatts} W`
              : visualMode === 'environmental'
              ? `${hoveredRoomVisual.temperatureC.toFixed(1)}°C · ${hoveredRoomVisual.powerWatts} W`
              : isHistoricalMode && hoveredRoomVisual.historicalIntervalKWh !== undefined
              ? `${hoveredRoomVisual.historicalIntervalKWh.toFixed(2)} kWh`
              : `${hoveredRoomVisual.powerWatts} W (${hoveredRoomVisual.ratedUtilizationPercent}%)`}
          </span>
        </div>
      )}

      {/* Contextual Right-Side Inspector (Only visible when a classroom, floor, or block is selected) */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none flex flex-col items-end">
        <RoomInspectorPanel
          selectedRoom={inspectedRoom}
          selectedBuilding={selectedBuilding}
          selectedFloor={selectedFloor}
          allClassrooms={classrooms}
          visualState={inspectedRoom ? visualStatesByRoomId.get(inspectedRoom.id) || null : null}
          visualStatesByRoomId={visualStatesByRoomId}
          auditFindings={auditFindings}
          isHistoricalMode={isHistoricalMode}
          historicalPreset={historicalPreset}
          activeHistoricalFrame={activeHistoricalFrame}
          onBackOneLevel={handleBackOneLevel}
          onClose={handleCloseInspector}
          onSelectRoom={(id) => {
            const rm = classrooms.find((c) => c.id === id);
            setInspectedRoomId(id);
            if (rm) setSelectedBuilding(rm.building);
          }}
          onOpenControlModal={(id) => openRoomControlModal(id)}
        />
      </div>

      {/* Single Collapsible Bottom Architectural Control Dock / Secondary Tools / Timeline / Guided Tour */}
      <CampusLiveDock
        visualMode={visualMode}
        selectedBuilding={selectedBuilding}
        selectedFloor={selectedFloor}
        exploded={exploded}
        cutaway={cutaway}
        showEnergyFlow={showEnergyFlow}
        weatherAtmosphereEnabled={weatherAtmosphereEnabled}
        weatherAtmosphereLabel={activeAtmosphere.label}
        isFullscreen={isFullscreen}
        controlsCollapsed={controlsCollapsed}
        toolsOpen={toolsOpen}
        isTimelineOpen={isTimelineOpen}
        isHistoricalMode={isHistoricalMode}
        historicalPreset={historicalPreset}
        historicalFrames={historicalFrames}
        historicalIndex={historicalIndex}
        isHistoricalLoading={isHistoricalLoading}
        isHistoricalPlaying={isHistoricalPlaying}
        isTourActive={isTourActive}
        isTourPaused={isTourPaused}
        tourStepIndex={tourStepIndex}
        tourSteps={CAMPUS_TOUR_STEPS}
        onSetVisualMode={setVisualMode}
        onSelectBuilding={(b) => {
          setInspectedRoomId(null);
          setSelectedBuilding(b);
          if (!b) sceneRef.current?.applyCameraPreset('isometric');
        }}
        onSelectFloor={(fl) => {
          setSelectedFloor(fl);
          setInspectedRoomId(null);
          if (fl !== 'All' && fl !== 'Ground Floor') {
            setExploded(true);
          } else if (fl === 'All') {
            setExploded(false);
          }
        }}
        onToggleExploded={() => setExploded((v) => !v)}
        onToggleCutaway={() => setCutaway((v) => !v)}
        onToggleEnergyFlow={() => setShowEnergyFlow((v) => !v)}
        onToggleWeatherAtmosphere={handleToggleWeatherAtmosphere}
        onCameraPreset={(p: CameraPresetId) => sceneRef.current?.applyCameraPreset(p)}
        onResetView={handleResetView}
        onToggleFullscreen={() => void handleToggleFullscreen()}
        onToggleControlsCollapsed={() => setControlsCollapsed((v) => !v)}
        onToggleToolsOpen={() => {
          setToolsOpen((v) => {
            const next = !v;
            if (next) setIsTimelineOpen(false);
            return next;
          });
        }}
        onToggleTimelineOpen={() => {
          setIsTimelineOpen((v) => {
            const next = !v;
            if (next) setToolsOpen(false);
            return next;
          });
        }}
        onSwitchToLive={handleSwitchToLive}
        onSelectHistoricalPreset={handleSelectHistoricalPreset}
        onSetHistoricalIndex={(idx) => {
          setIsHistoricalPlaying(false);
          setHistoricalIndex(idx);
        }}
        onToggleHistoricalPlay={() => setIsHistoricalPlaying((v) => !v)}
        onStartTour={() => {
          setToolsOpen(false);
          setTourStepIndex(0);
          setIsTourPaused(false);
          setIsTourActive(true);
        }}
        onExitTour={() => {
          setIsTourActive(false);
          setIsTourPaused(false);
          handleResetView();
        }}
        onToggleTourPause={() => setIsTourPaused((v) => !v)}
        onStepTour={(delta) => {
          setIsTourPaused(true);
          setTourStepIndex((prev) =>
            Math.max(0, Math.min(CAMPUS_TOUR_STEPS.length - 1, prev + delta))
          );
        }}
      />
    </section>
  );
};
