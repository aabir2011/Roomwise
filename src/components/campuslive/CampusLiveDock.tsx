/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Building2,
  Layers,
  Scissors,
  GitBranch,
  RotateCcw,
  Maximize2,
  Minimize2,
  Clock,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Presentation,
  ChevronDown,
  ChevronUp,
  Sun,
  CloudSun,
  Zap,
  Thermometer,
  Box,
  Loader2,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import type { BuildingName, Floor } from '../../types/energy';
import { BUILDING_ORDER, CAMERA_PRESETS, FLOOR_ORDER } from './campusLayoutSchema';
import type {
  CameraPresetId,
  CampusVisualMode,
  HistoricalSnapshotFrame,
  TimelinePresetId,
  TourStep,
} from './types';

interface CampusLiveDockProps {
  visualMode: CampusVisualMode;
  selectedBuilding: BuildingName | null;
  selectedFloor: Floor | 'All';
  exploded: boolean;
  cutaway: boolean;
  showEnergyFlow: boolean;
  weatherAtmosphereEnabled: boolean;
  weatherAtmosphereLabel: string;
  isFullscreen: boolean;
  controlsCollapsed: boolean;
  toolsOpen: boolean;
  // Historical Timeline
  isTimelineOpen: boolean;
  isHistoricalMode: boolean;
  historicalPreset: TimelinePresetId;
  historicalFrames: HistoricalSnapshotFrame[];
  historicalIndex: number;
  isHistoricalLoading: boolean;
  isHistoricalPlaying: boolean;
  // Guided Presentation Tour
  isTourActive: boolean;
  isTourPaused: boolean;
  tourStepIndex: number;
  tourSteps: TourStep[];
  // Handlers
  onSetVisualMode: (mode: CampusVisualMode) => void;
  onSelectBuilding: (building: BuildingName | null) => void;
  onSelectFloor: (floor: Floor | 'All') => void;
  onToggleExploded: () => void;
  onToggleCutaway: () => void;
  onToggleEnergyFlow: () => void;
  onToggleWeatherAtmosphere: () => void;
  onCameraPreset: (preset: CameraPresetId) => void;
  onResetView: () => void;
  onToggleFullscreen: () => void;
  onToggleControlsCollapsed: () => void;
  onToggleToolsOpen: () => void;
  onToggleTimelineOpen: () => void;
  onSwitchToLive: () => void;
  onSelectHistoricalPreset: (preset: TimelinePresetId) => void;
  onSetHistoricalIndex: (index: number) => void;
  onToggleHistoricalPlay: () => void;
  onStartTour: () => void;
  onExitTour: () => void;
  onToggleTourPause: () => void;
  onStepTour: (delta: number) => void;
}

const MODE_OPTIONS: Array<{
  id: CampusVisualMode;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'architectural', label: 'Model', icon: Box },
  { id: 'lighting', label: 'Lighting', icon: Sun },
  { id: 'intensity', label: 'Intensity', icon: Zap },
  { id: 'environmental', label: 'Climate', icon: Thermometer },
];

const FLOOR_SHORT: Record<Floor | 'All', string> = {
  All: 'All',
  'Ground Floor': 'G',
  '1st Floor': '1F',
  '2nd Floor': '2F',
  '3rd Floor': '3F',
};

export const CampusLiveDock: React.FC<CampusLiveDockProps> = ({
  visualMode,
  selectedBuilding,
  selectedFloor,
  exploded,
  cutaway,
  showEnergyFlow,
  weatherAtmosphereEnabled,
  weatherAtmosphereLabel,
  isFullscreen,
  controlsCollapsed,
  toolsOpen,
  isTimelineOpen,
  isHistoricalMode,
  historicalPreset,
  historicalFrames,
  historicalIndex,
  isHistoricalLoading,
  isHistoricalPlaying,
  isTourActive,
  isTourPaused,
  tourStepIndex,
  tourSteps,
  onSetVisualMode,
  onSelectBuilding,
  onSelectFloor,
  onToggleExploded,
  onToggleCutaway,
  onToggleEnergyFlow,
  onToggleWeatherAtmosphere,
  onCameraPreset,
  onResetView,
  onToggleFullscreen,
  onToggleControlsCollapsed,
  onToggleToolsOpen,
  onToggleTimelineOpen,
  onSwitchToLive,
  onSelectHistoricalPreset,
  onSetHistoricalIndex,
  onToggleHistoricalPlay,
  onStartTour,
  onExitTour,
  onToggleTourPause,
  onStepTour,
}) => {
  // Count active secondary options so the collapsed Tools button gives subtle feedback
  const activeToolCount =
    (selectedBuilding ? 1 : 0) +
    (exploded ? 1 : 0) +
    (cutaway ? 1 : 0) +
    (showEnergyFlow ? 1 : 0);

  // ---------------------------------------------------------------------------
  // GUIDED EXHIBITION PRESENTATION MODE OVERLAY
  // ---------------------------------------------------------------------------
  if (isTourActive) {
    const step = tourSteps[tourStepIndex] || tourSteps[0];
    return (
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 w-[min(660px,calc(100vw-2rem))] pointer-events-auto">
        <div className="bg-[#161d21]/96 border border-white/12 rounded-2xl shadow-2xl px-5 py-3.5 space-y-2.5 text-[#edf2f0]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <span>Guided Exhibition Tour</span>
                <span className="text-white/20">·</span>
                <span className="font-mono tabular-nums text-[#9eb0a9]">
                  Step {tourStepIndex + 1} / {tourSteps.length}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-[#f3f7f5] mt-0.5">{step.title}</h3>
              <p className="text-xs text-[#9eb0a9] mt-0.5 leading-relaxed">{step.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onExitTour}
              className="p-1.5 rounded-lg text-[#8d9d97] hover:text-white hover:bg-white/10 transition-colors shrink-0"
              aria-label="Exit guided tour"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
            <div className="flex items-center gap-1.5">
              {tourSteps.map((s, idx) => (
                <span
                  key={s.id}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === tourStepIndex
                      ? 'w-6 bg-emerald-400'
                      : idx < tourStepIndex
                      ? 'w-2.5 bg-emerald-500/45'
                      : 'w-2 bg-white/15'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onStepTour(-1)}
                disabled={tourStepIndex === 0}
                className="p-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] disabled:opacity-35 text-[#edf2f0] transition-colors"
                aria-label="Previous tour stop"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onToggleTourPause}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                {isTourPaused ? (
                  <>
                    <Play className="w-3 h-3" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3" />
                    <span>Pause</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onStepTour(1)}
                disabled={tourStepIndex === tourSteps.length - 1}
                className="p-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] disabled:opacity-35 text-[#edf2f0] transition-colors"
                aria-label="Next tour stop"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeFrame =
    isHistoricalMode && historicalFrames[historicalIndex]
      ? historicalFrames[historicalIndex]
      : null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 max-w-[calc(100vw-1.5rem)] pointer-events-none">
      {/* Secondary Expandable Tray: Spatial Tools, Building Focus & Camera Presets */}
      {toolsOpen && !controlsCollapsed && (
        <div className="w-[min(700px,calc(100vw-1.5rem))] bg-[#161d21]/96 border border-white/12 rounded-2xl shadow-2xl px-3.5 py-2.5 pointer-events-auto flex flex-wrap items-center justify-between gap-2.5 text-[#edf2f0]">
          {/* Building Focus */}
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-[#8d9d97] shrink-0" />
            <select
              aria-label="Focus campus building"
              value={selectedBuilding || 'All'}
              onChange={(e) => {
                const v = e.target.value;
                onSelectBuilding(v === 'All' ? null : (v as BuildingName));
              }}
              className="text-[11px] font-medium text-[#edf2f0] bg-[#1e272c] border border-white/12 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-400/70"
            >
              <option value="All">All 5 Blocks</option>
              {BUILDING_ORDER.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Spatial Exploration Toggles */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleExploded}
              title="Separate floors vertically (E)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
                exploded
                  ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200 font-semibold'
                  : 'bg-[#1e272c] border-white/10 text-[#b7c4bf] hover:text-white hover:bg-[#263137]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>{exploded ? 'Assemble' : 'Explode'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleCutaway}
              title="Architectural section cutaway (C)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
                cutaway
                  ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200 font-semibold'
                  : 'bg-[#1e272c] border-white/10 text-[#b7c4bf] hover:text-white hover:bg-[#263137]'
              }`}
            >
              <Scissors className="w-3.5 h-3.5 shrink-0" />
              <span>Cutaway</span>
            </button>

            <button
              type="button"
              onClick={onToggleEnergyFlow}
              title="Toggle conceptual energy-flow pathways"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
                showEnergyFlow
                  ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200 font-semibold'
                  : 'bg-[#1e272c] border-white/10 text-[#b7c4bf] hover:text-white hover:bg-[#263137]'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span>Energy Flow</span>
            </button>

            <button
              type="button"
              onClick={onToggleWeatherAtmosphere}
              title="Toggle weather-responsive sky, lighting & atmosphere"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
                weatherAtmosphereEnabled
                  ? 'bg-sky-500/20 border-sky-400/45 text-sky-200 font-semibold'
                  : 'bg-[#1e272c] border-white/10 text-[#b7c4bf] hover:text-white hover:bg-[#263137]'
              }`}
            >
              <CloudSun className="w-3.5 h-3.5 shrink-0" />
              <span>
                {weatherAtmosphereEnabled ? `Sky: ${weatherAtmosphereLabel}` : 'Sky: Default'}
              </span>
            </button>
          </div>

          {/* Camera Views, Guided Tour & Fullscreen */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#11171a] border border-white/8">
              {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((presetKey) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => onCameraPreset(presetKey)}
                  className="px-2 py-1 rounded-md text-[10.5px] font-medium text-[#9eb0a9] hover:text-white hover:bg-white/10 transition-colors"
                >
                  {CAMERA_PRESETS[presetKey].label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onStartTour}
              title="Start guided exhibition presentation tour"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] text-[#edf2f0] text-[11px] font-medium transition-colors"
            >
              <Presentation className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Tour</span>
            </button>

            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="p-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] text-[#b7c4bf] hover:text-white transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Compact Historical Timeline Scrubber (only visible when Timeline drawer is active) */}
      {isTimelineOpen && !controlsCollapsed && (
        <div className="w-[min(700px,calc(100vw-1.5rem))] bg-[#161d21]/96 border border-white/12 rounded-2xl shadow-2xl px-4 py-2.5 pointer-events-auto space-y-2 text-[#edf2f0]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onSwitchToLive}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  !isHistoricalMode
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#1e272c] border border-white/10 text-[#9eb0a9] hover:text-white'
                }`}
              >
                Live
              </button>
              {(
                [
                  { id: 'today', label: 'Today (Hourly)' },
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: 'last_7_days', label: 'Last 7 Days' },
                ] as Array<{ id: TimelinePresetId; label: string }>
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectHistoricalPreset(p.id)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    isHistoricalMode && historicalPreset === p.id
                      ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40 font-semibold'
                      : 'bg-[#1e272c] border border-white/10 text-[#9eb0a9] hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-[#9eb0a9] tabular-nums">
              {isHistoricalLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                  <span>Loading SQLite archive...</span>
                </span>
              ) : activeFrame ? (
                <span>
                  {activeFrame.label} · {activeFrame.subLabel} ·{' '}
                  <strong className="text-[#f3f7f5]">
                    {activeFrame.totalActualKWh.toFixed(2)} kWh
                  </strong>
                  {activeFrame.isPartial ? ' (in progress)' : ''}
                </span>
              ) : (
                <span>Synchronized with Live ROOMWISE State</span>
              )}
            </div>
          </div>

          {isHistoricalMode && historicalFrames.length > 0 && (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => onSetHistoricalIndex(Math.max(0, historicalIndex - 1))}
                disabled={historicalIndex <= 0}
                className="p-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] disabled:opacity-35 text-[#edf2f0]"
                aria-label="Previous recorded interval"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onToggleHistoricalPlay}
                className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                aria-label={isHistoricalPlaying ? 'Pause historical playback' : 'Play historical timeline'}
              >
                {isHistoricalPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  onSetHistoricalIndex(Math.min(historicalFrames.length - 1, historicalIndex + 1))
                }
                disabled={historicalIndex >= historicalFrames.length - 1}
                className="p-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] disabled:opacity-35 text-[#edf2f0]"
                aria-label="Next recorded interval"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              <input
                type="range"
                min={0}
                max={Math.max(0, historicalFrames.length - 1)}
                step={1}
                value={historicalIndex}
                onChange={(e) => onSetHistoricalIndex(Number(e.target.value))}
                aria-label="Historical interval scrubber"
                className="roomwise-slider flex-1 bg-white/15 accent-emerald-500"
              />

              <span className="text-[10.5px] font-mono text-[#8d9d97] tabular-nums shrink-0">
                {historicalIndex + 1}/{historicalFrames.length}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Primary Minimal Architectural Control Dock */}
      {controlsCollapsed ? (
        <button
          type="button"
          onClick={onToggleControlsCollapsed}
          className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#161d21]/95 border border-white/12 shadow-xl text-xs font-semibold text-[#edf2f0] hover:bg-[#1e272c] transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5 text-emerald-400" />
          <span>Controls</span>
          <span className="text-[10px] font-mono text-[#8d9d97]">H</span>
        </button>
      ) : (
        <div className="pointer-events-auto bg-[#161d21]/95 border border-white/12 rounded-2xl shadow-2xl px-2.5 py-2 flex flex-wrap items-center justify-center gap-2">
          {/* 1. Primary: Visualisation Mode */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-xl bg-[#101518] border border-white/8"
            role="group"
            aria-label="Visualisation mode"
          >
            {MODE_OPTIONS.map((m) => {
              const Icon = m.icon;
              const active = visualMode === m.id;
              const activeStyle =
                m.id === 'lighting'
                  ? 'bg-amber-500/22 text-amber-200 border border-amber-400/40 font-semibold'
                  : 'bg-emerald-600 text-white border border-emerald-500/50 font-semibold';
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSetVisualMode(m.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                    active
                      ? activeStyle
                      : 'text-[#9eb0a9] hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>

          <span className="h-5 w-px bg-white/10 hidden sm:inline-block" aria-hidden="true" />

          {/* 2. Primary: Floor Level Isolation */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-xl bg-[#101518] border border-white/8"
            role="group"
            aria-label="Select floor level"
          >
            {(['All', ...FLOOR_ORDER] as Array<Floor | 'All'>).map((fl) => {
              const active = selectedFloor === fl;
              return (
                <button
                  key={fl}
                  type="button"
                  onClick={() => onSelectFloor(fl)}
                  title={fl === 'All' ? 'Show all floors' : `Isolate ${fl}`}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-colors ${
                    active
                      ? 'bg-[#263238] text-white font-semibold border border-white/15'
                      : 'text-[#8d9d97] hover:text-white border border-transparent'
                  }`}
                >
                  {FLOOR_SHORT[fl]}
                </button>
              );
            })}
          </div>

          <span className="h-5 w-px bg-white/10 hidden sm:inline-block" aria-hidden="true" />

          {/* 3. Progressive Disclosure Triggers: Tools, Timeline, Reset, Hide */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleWeatherAtmosphere}
              title={
                weatherAtmosphereEnabled
                  ? `Weather Atmosphere active (${weatherAtmosphereLabel}) — click for default daylight`
                  : 'Switch to live Open-Meteo Weather Atmosphere'
              }
              aria-label="Toggle weather atmosphere"
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
                weatherAtmosphereEnabled
                  ? 'bg-sky-500/18 border-sky-400/40 text-sky-200 font-semibold'
                  : 'bg-[#1e272c] border-white/10 text-[#b7c4bf] hover:text-white hover:bg-[#263137]'
              }`}
            >
              <CloudSun className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">{weatherAtmosphereLabel}</span>
            </button>

            <button
              type="button"
              onClick={onToggleToolsOpen}
              title="Spatial tools, building focus & camera views"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
                toolsOpen || activeToolCount > 0
                  ? 'bg-emerald-500/18 border-emerald-400/40 text-emerald-200 font-semibold'
                  : 'bg-[#1e272c] border-white/10 text-[#b7c4bf] hover:text-white hover:bg-[#263137]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">View Tools</span>
              {activeToolCount > 0 && (
                <span className="font-mono text-[10px] px-1 rounded bg-emerald-500/25 text-emerald-200 tabular-nums">
                  {activeToolCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleTimelineOpen}
              title="Explore historical energy intervals"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap ${
                isTimelineOpen || isHistoricalMode
                  ? 'bg-amber-500/20 border-amber-400/40 text-amber-200 font-semibold'
                  : 'bg-[#1e272c] border-white/10 text-[#b7c4bf] hover:text-white hover:bg-[#263137]'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{isHistoricalMode ? 'History' : 'Timeline'}</span>
            </button>

            <button
              type="button"
              onClick={onResetView}
              title="Reset view to campus overview (R)"
              aria-label="Reset camera and view"
              className="p-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] text-[#b7c4bf] hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleControlsCollapsed}
              title="Hide controls (H)"
              aria-label="Hide controls"
              className="p-1.5 rounded-lg border border-white/10 bg-[#1e272c] hover:bg-[#263137] text-[#b7c4bf] hover:text-white transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
