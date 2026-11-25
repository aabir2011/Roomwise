/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
import { GlassSurface, Stepper } from '../reactbits';
import { ROOMWISE_EASE } from '../../utils/motion';

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
  onJumpTourStep: (index: number) => void;
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
  onJumpTourStep,
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
    const tourStepperItems = tourSteps.map((s) => ({
      id: s.id,
      label: s.title,
      description: s.subtitle,
    }));

    return (
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 w-[min(680px,calc(100vw-2rem))] pointer-events-auto">
        <GlassSurface className="rounded-2xl px-5 py-3.5 space-y-3 text-[#f8faf9]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                <span>Guided Exhibition Tour</span>
                <span className="text-white/40">·</span>
                <span className="font-mono tabular-nums text-[#d5e2dd]">
                  Step {tourStepIndex + 1} / {tourSteps.length}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-white mt-0.5">{step.title}</h3>
              <p className="text-xs text-[#d5e2dd] mt-0.5 leading-relaxed">{step.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onExitTour}
              className="p-1.5 rounded-lg text-[#cad8d2] hover:text-white hover:bg-white/14 transition-colors shrink-0"
              aria-label="Exit guided tour"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2.5 border-t border-white/14">
            <div className="flex-1 min-w-0">
              <Stepper
                steps={tourStepperItems}
                currentStep={tourStepIndex}
                onStepClick={(idx) => onJumpTourStep(idx)}
                tone="dark"
                compact
                allowJumpAny
                ariaLabel="Campus Live guided tour stops"
              />
            </div>

            <div className="flex items-center justify-end gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onStepTour(-1)}
                disabled={tourStepIndex === 0}
                className="p-1.5 rounded-lg border border-white/18 bg-[#0b1b16]/85 hover:bg-[#122b23] disabled:opacity-35 text-white transition-colors"
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
                className="p-1.5 rounded-lg border border-white/18 bg-[#0b1b16]/85 hover:bg-[#122b23] disabled:opacity-35 text-white transition-colors"
                aria-label="Next tour stop"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </GlassSurface>
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
      <AnimatePresence>
      {toolsOpen && !controlsCollapsed && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.985 }}
          transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
          className="w-[min(700px,calc(100vw-1.5rem))] pointer-events-auto"
        >
        <GlassSurface className="w-full rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-[#f8faf9]">
          {/* Building Focus */}
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-[#cad8d2] shrink-0" />
            <select
              aria-label="Focus campus building"
              value={selectedBuilding || 'All'}
              onChange={(e) => {
                const v = e.target.value;
                onSelectBuilding(v === 'All' ? null : (v as BuildingName));
              }}
              className="text-[11px] font-medium text-white bg-[#0b1b16]/90 border border-white/18 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-400/80"
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
                  ? 'bg-emerald-500/28 border-emerald-400/55 text-emerald-100 font-semibold'
                  : 'bg-[#0b1b16]/85 border-white/16 text-[#dde8e3] hover:text-white hover:bg-[#122b23]'
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
                  ? 'bg-emerald-500/28 border-emerald-400/55 text-emerald-100 font-semibold'
                  : 'bg-[#0b1b16]/85 border-white/16 text-[#dde8e3] hover:text-white hover:bg-[#122b23]'
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
                  ? 'bg-emerald-500/28 border-emerald-400/55 text-emerald-100 font-semibold'
                  : 'bg-[#0b1b16]/85 border-white/16 text-[#dde8e3] hover:text-white hover:bg-[#122b23]'
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
                  ? 'bg-sky-500/28 border-sky-400/55 text-sky-100 font-semibold'
                  : 'bg-[#0b1b16]/85 border-white/16 text-[#dde8e3] hover:text-white hover:bg-[#122b23]'
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
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#05100c]/80 border border-white/14">
              {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((presetKey) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => onCameraPreset(presetKey)}
                  className="px-2 py-1 rounded-md text-[10.5px] font-medium text-[#d5e2dd] hover:text-white hover:bg-white/14 transition-colors"
                >
                  {CAMERA_PRESETS[presetKey].label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onStartTour}
              title="Start guided exhibition presentation tour"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/16 bg-[#0b1b16]/85 hover:bg-[#122b23] text-white text-[11px] font-medium transition-colors"
            >
              <Presentation className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              <span>Tour</span>
            </button>

            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="p-1.5 rounded-lg border border-white/16 bg-[#0b1b16]/85 hover:bg-[#122b23] text-[#dde8e3] hover:text-white transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </GlassSurface>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Compact Historical Timeline Scrubber (only visible when Timeline drawer is active) */}
      <AnimatePresence>
      {isTimelineOpen && !controlsCollapsed && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.985 }}
          transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
          className="w-[min(700px,calc(100vw-1.5rem))] pointer-events-auto"
        >
        <GlassSurface className="w-full rounded-2xl px-4 py-2.5 space-y-2 text-[#f8faf9]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onSwitchToLive}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  !isHistoricalMode
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#0b1b16]/85 border border-white/16 text-[#dde8e3] hover:text-white'
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
                      ? 'bg-amber-500/28 text-amber-100 border border-amber-400/55 font-semibold'
                      : 'bg-[#0b1b16]/85 border border-white/16 text-[#dde8e3] hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-[#d5e2dd] tabular-nums">
              {isHistoricalLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-emerald-300" />
                  <span>Loading SQLite archive...</span>
                </span>
              ) : activeFrame ? (
                <span>
                  {activeFrame.label} · {activeFrame.subLabel} ·{' '}
                  <strong className="text-white">
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
                className="p-1.5 rounded-lg border border-white/16 bg-[#0b1b16]/85 hover:bg-[#122b23] disabled:opacity-35 text-white"
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
                className="p-1.5 rounded-lg border border-white/16 bg-[#0b1b16]/85 hover:bg-[#122b23] disabled:opacity-35 text-white"
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
                className="roomwise-slider flex-1 bg-white/25 accent-emerald-500"
              />

              <span className="text-[10.5px] font-mono text-[#cad8d2] tabular-nums shrink-0">
                {historicalIndex + 1}/{historicalFrames.length}
              </span>
            </div>
          )}
        </GlassSurface>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Primary Minimal Architectural Control Dock */}
      {controlsCollapsed ? (
        <GlassSurface className="pointer-events-auto rounded-xl">
          <button
            type="button"
            onClick={onToggleControlsCollapsed}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5 text-emerald-300" />
            <span>Controls</span>
            <span className="text-[10px] font-mono text-[#cad8d2]">H</span>
          </button>
        </GlassSurface>
      ) : (
        <GlassSurface className="pointer-events-auto rounded-2xl px-2.5 py-2 flex flex-wrap items-center justify-center gap-2">
          {/* 1. Primary: Visualisation Mode */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-xl bg-[#05100c]/75 border border-white/14"
            role="group"
            aria-label="Visualisation mode"
          >
            {MODE_OPTIONS.map((m) => {
              const Icon = m.icon;
              const active = visualMode === m.id;
              const activeStyle =
                m.id === 'lighting'
                  ? 'bg-amber-500/28 text-amber-100 border border-amber-400/50 font-semibold'
                  : 'bg-emerald-600 text-white border border-emerald-400/55 font-semibold';
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSetVisualMode(m.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                    active
                      ? activeStyle
                      : 'text-[#d5e2dd] hover:text-white border border-transparent'
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>

          <span className="h-5 w-px bg-white/18 hidden sm:inline-block" aria-hidden="true" />

          {/* 2. Primary: Floor Level Isolation */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-xl bg-[#05100c]/75 border border-white/14"
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
                      ? 'bg-emerald-600/85 text-white font-semibold border border-emerald-400/50'
                      : 'text-[#cad8d2] hover:text-white border border-transparent'
                  }`}
                >
                  {FLOOR_SHORT[fl]}
                </button>
              );
            })}
          </div>

          <span className="h-5 w-px bg-white/18 hidden sm:inline-block" aria-hidden="true" />

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
                  ? 'bg-sky-500/24 border-sky-400/50 text-sky-100 font-semibold'
                  : 'bg-[#0b1b16]/85 border-white/16 text-[#dde8e3] hover:text-white hover:bg-[#122b23]'
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
                  ? 'bg-emerald-500/26 border-emerald-400/50 text-emerald-100 font-semibold'
                  : 'bg-[#0b1b16]/85 border-white/16 text-[#dde8e3] hover:text-white hover:bg-[#122b23]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">View Tools</span>
              {activeToolCount > 0 && (
                <span className="font-mono text-[10px] px-1 rounded bg-emerald-500/35 text-emerald-100 tabular-nums">
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
                  ? 'bg-amber-500/28 border-amber-400/55 text-amber-100 font-semibold'
                  : 'bg-[#0b1b16]/85 border-white/16 text-[#dde8e3] hover:text-white hover:bg-[#122b23]'
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
              className="p-1.5 rounded-lg border border-white/16 bg-[#0b1b16]/85 hover:bg-[#122b23] text-[#dde8e3] hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleControlsCollapsed}
              title="Hide controls (H)"
              aria-label="Hide controls"
              className="p-1.5 rounded-lg border border-white/16 bg-[#0b1b16]/85 hover:bg-[#122b23] text-[#dde8e3] hover:text-white transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </GlassSurface>
      )}
    </div>
  );
};
