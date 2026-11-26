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
import { ActionButton, IconButton } from '../common/DesignSystem';
import { ROOMWISE_EASE, SPRING_SNAPPY } from '../../utils/motion';

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
  hasInspectorOpen?: boolean;
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
  hasInspectorOpen = false,
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
      <div
        className={`absolute bottom-3.5 z-20 pointer-events-auto transition-[left,width] duration-200 ${
          hasInspectorOpen
            ? 'left-1/2 -translate-x-1/2 lg:left-[calc((100%-21.5rem)/2)] w-[min(640px,calc(100%-1.5rem))] lg:w-[min(640px,calc(100%-23rem))]'
            : 'left-1/2 -translate-x-1/2 w-[min(680px,calc(100%-2rem))]'
        }`}
      >
        <GlassSurface borderRadius={12} className="rounded-xl px-4 sm:px-5 py-3 space-y-2.5 text-[#f8faf9]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#34d399]">
                <span>Guided Exhibition Tour</span>
                <span className="text-white/40">·</span>
                <span className="font-mono tabular-nums text-[#d5e2dd]">
                  Step {tourStepIndex + 1} / {tourSteps.length}
                </span>
              </div>
              <h3 className="font-display text-sm font-semibold text-white mt-0.5">{step.title}</h3>
              <p className="text-xs text-[#d5e2dd] mt-0.5 leading-relaxed">{step.subtitle}</p>
            </div>
            <IconButton
              variant="dark-ghost"
              size="xs"
              label="Exit guided tour"
              onClick={onExitTour}
              className="shrink-0"
            >
              <X className="w-4 h-4" />
            </IconButton>
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
              <IconButton
                variant="dark-ghost"
                size="xs"
                label="Previous tour stop"
                onClick={() => onStepTour(-1)}
                disabled={tourStepIndex === 0}
              >
                <SkipBack className="w-3.5 h-3.5" />
              </IconButton>
              <ActionButton
                variant="forest"
                size="xs"
                onClick={onToggleTourPause}
                icon={isTourPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              >
                {isTourPaused ? 'Resume' : 'Pause'}
              </ActionButton>
              <IconButton
                variant="dark-ghost"
                size="xs"
                label="Next tour stop"
                onClick={() => onStepTour(1)}
                disabled={tourStepIndex === tourSteps.length - 1}
              >
                <SkipForward className="w-3.5 h-3.5" />
              </IconButton>
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
    <div
      className={`absolute bottom-2.5 sm:bottom-3.5 z-20 flex flex-col items-center gap-1.5 sm:gap-2 pointer-events-none transition-[left,max-width] duration-200 ${
        hasInspectorOpen
          ? 'left-1/2 -translate-x-1/2 lg:left-[calc((100%-21.5rem)/2)] max-w-[calc(100%-1rem)] lg:max-w-[calc(100%-23rem)]'
          : 'left-1/2 -translate-x-1/2 max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-2rem)]'
      }`}
    >
      {/* Secondary Expandable Tray: Spatial Tools, Building Focus & Camera Presets */}
      <AnimatePresence>
      {toolsOpen && !controlsCollapsed && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.985 }}
          transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
          className="w-[min(660px,100%)] pointer-events-auto"
        >
        <GlassSurface borderRadius={12} className="w-full max-h-[min(220px,calc(100dvh-14rem))] overflow-y-auto rw-dark-scrollbar rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[#f8faf9]">
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
            <ActionButton
              variant={exploded ? 'forest' : 'dark-ghost'}
              size="xs"
              onClick={onToggleExploded}
              title="Separate floors vertically (E)"
              icon={<Layers className="w-3.5 h-3.5" />}
            >
              {exploded ? 'Assemble' : 'Explode'}
            </ActionButton>

            <ActionButton
              variant={cutaway ? 'forest' : 'dark-ghost'}
              size="xs"
              onClick={onToggleCutaway}
              title="Architectural section cutaway (C)"
              icon={<Scissors className="w-3.5 h-3.5" />}
            >
              Cutaway
            </ActionButton>

            <ActionButton
              variant={showEnergyFlow ? 'forest' : 'dark-ghost'}
              size="xs"
              onClick={onToggleEnergyFlow}
              title="Toggle conceptual energy-flow pathways"
              icon={<GitBranch className="w-3.5 h-3.5" />}
            >
              Energy Flow
            </ActionButton>

            <ActionButton
              variant="dark-ghost"
              size="xs"
              onClick={onToggleWeatherAtmosphere}
              title="Toggle weather-responsive sky, lighting & atmosphere"
              icon={<CloudSun className="w-3.5 h-3.5" />}
              className={
                weatherAtmosphereEnabled
                  ? '!bg-sky-500/28 !border-sky-400/55 !text-sky-100 font-semibold'
                  : ''
              }
            >
              {weatherAtmosphereEnabled ? `Sky: ${weatherAtmosphereLabel}` : 'Sky: Default'}
            </ActionButton>
          </div>

          {/* Camera Views, Guided Tour & Fullscreen */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#05100c]/85 border border-white/14">
              {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((presetKey) => (
                <motion.button
                  key={presetKey}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onCameraPreset(presetKey)}
                  className="px-2 py-1 rounded-[6px] text-[10.5px] font-medium text-[#d5e2dd] hover:text-white hover:bg-white/[0.1] border border-transparent hover:border-emerald-400/35 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                >
                  {CAMERA_PRESETS[presetKey].label}
                </motion.button>
              ))}
            </div>

            <ActionButton
              variant="dark-ghost"
              size="xs"
              onClick={onStartTour}
              title="Start guided exhibition presentation tour"
              icon={<Presentation className="w-3.5 h-3.5 text-emerald-300" />}
            >
              Tour
            </ActionButton>

            <IconButton
              variant="dark-ghost"
              size="xs"
              label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </IconButton>
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
          className="w-[min(660px,100%)] pointer-events-auto"
        >
        <GlassSurface borderRadius={12} className="w-full max-h-[min(220px,calc(100dvh-14rem))] overflow-y-auto rw-dark-scrollbar rounded-xl px-3.5 py-2.5 space-y-2 text-[#f8faf9]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5">
              <ActionButton
                variant={!isHistoricalMode ? 'forest' : 'dark-ghost'}
                size="xs"
                onClick={onSwitchToLive}
              >
                Live
              </ActionButton>
              {(
                [
                  { id: 'today', label: 'Today (Hourly)' },
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: 'last_7_days', label: 'Last 7 Days' },
                ] as Array<{ id: TimelinePresetId; label: string }>
              ).map((p) => {
                const isActive = isHistoricalMode && historicalPreset === p.id;
                return (
                  <ActionButton
                    key={p.id}
                    variant="dark-ghost"
                    size="xs"
                    onClick={() => onSelectHistoricalPreset(p.id)}
                    className={
                      isActive
                        ? '!bg-amber-500/28 !text-amber-100 !border-amber-400/55 font-semibold'
                        : ''
                    }
                  >
                    {p.label}
                  </ActionButton>
                );
              })}
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
              <IconButton
                variant="dark-ghost"
                size="xs"
                label="Previous recorded interval"
                onClick={() => onSetHistoricalIndex(Math.max(0, historicalIndex - 1))}
                disabled={historicalIndex <= 0}
              >
                <SkipBack className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                variant="forest"
                size="xs"
                label={isHistoricalPlaying ? 'Pause historical playback' : 'Play historical timeline'}
                onClick={onToggleHistoricalPlay}
              >
                {isHistoricalPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </IconButton>
              <IconButton
                variant="dark-ghost"
                size="xs"
                label="Next recorded interval"
                onClick={() =>
                  onSetHistoricalIndex(Math.min(historicalFrames.length - 1, historicalIndex + 1))
                }
                disabled={historicalIndex >= historicalFrames.length - 1}
              >
                <SkipForward className="w-3.5 h-3.5" />
              </IconButton>

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
        <GlassSurface borderRadius={10} className="pointer-events-auto rounded-lg">
          <ActionButton
            variant="dark-ghost"
            size="sm"
            onClick={onToggleControlsCollapsed}
            icon={<ChevronUp className="w-3.5 h-3.5 text-[#34d399]" />}
            className="!bg-transparent !border-0 hover:!bg-white/10"
          >
            <span>Controls</span>
            <span className="text-[10px] font-mono text-[#cad8d2]">H</span>
          </ActionButton>
        </GlassSurface>
      ) : (
        <GlassSurface borderRadius={12} className="pointer-events-auto rounded-xl px-2 py-1.5 flex flex-nowrap items-center justify-start sm:justify-center gap-1.5 max-w-full overflow-x-auto no-scrollbar">
          {/* 1. Primary: Visualisation Mode */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-[10px] bg-[#05100c]/80 border border-white/14 shrink-0"
            role="group"
            aria-label="Visualisation mode"
          >
            {MODE_OPTIONS.map((m) => {
              const Icon = m.icon;
              const active = visualMode === m.id;
              return (
                <motion.button
                  key={m.id}
                  type="button"
                  aria-pressed={active}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onSetVisualMode(m.id)}
                  className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[11px] transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
                    active
                      ? m.id === 'lighting'
                        ? 'text-amber-50 font-semibold'
                        : 'text-white font-semibold'
                      : 'text-[#d5e2dd] font-medium hover:text-white hover:bg-white/[0.07]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-visual-mode-pill"
                      transition={SPRING_SNAPPY}
                      className={`absolute inset-0 rounded-[8px] ${
                        m.id === 'lighting'
                          ? 'bg-amber-600/80 border border-amber-300/45'
                          : 'bg-[#0b6e4f] border border-emerald-400/40'
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="relative z-10 w-3 h-3 shrink-0" />
                  <span className="relative z-10 hidden sm:inline">{m.label}</span>
                </motion.button>
              );
            })}
          </div>

          <span className="h-5 w-px bg-white/18 hidden sm:inline-block" aria-hidden="true" />

          {/* 2. Primary: Floor Level Isolation */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-[10px] bg-[#05100c]/80 border border-white/14 shrink-0"
            role="group"
            aria-label="Select floor level"
          >
            {(['All', ...FLOOR_ORDER] as Array<Floor | 'All'>).map((fl) => {
              const active = selectedFloor === fl;
              return (
                <motion.button
                  key={fl}
                  type="button"
                  aria-pressed={active}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onSelectFloor(fl)}
                  title={fl === 'All' ? 'Show all floors' : `Isolate ${fl}`}
                  className={`relative px-2.5 py-1 rounded-[8px] text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
                    active
                      ? 'text-white font-semibold'
                      : 'text-[#cad8d2] hover:text-white hover:bg-white/[0.07]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-floor-pill"
                      transition={SPRING_SNAPPY}
                      className="absolute inset-0 rounded-[8px] bg-[#0b6e4f] border border-emerald-400/40"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{FLOOR_SHORT[fl]}</span>
                </motion.button>
              );
            })}
          </div>

          <span className="h-5 w-px bg-white/18 hidden sm:inline-block" aria-hidden="true" />

          {/* 3. Progressive Disclosure Triggers: Tools, Timeline, Reset, Hide */}
          <div className="flex items-center gap-1 shrink-0">
            <IconButton
              variant="dark-ghost"
              size="xs"
              label="Toggle weather atmosphere"
              onClick={onToggleWeatherAtmosphere}
              title={
                weatherAtmosphereEnabled
                  ? `Weather Atmosphere active (${weatherAtmosphereLabel}) — click for default daylight`
                  : 'Switch to live Open-Meteo Weather Atmosphere'
              }
              className={
                weatherAtmosphereEnabled
                  ? '!bg-sky-500/24 !border-sky-400/50 !text-sky-100'
                  : ''
              }
            >
              <CloudSun className="w-3.5 h-3.5 shrink-0" />
            </IconButton>

            <ActionButton
              variant={toolsOpen || activeToolCount > 0 ? 'forest' : 'dark-ghost'}
              size="xs"
              onClick={onToggleToolsOpen}
              title="Spatial tools, building focus & camera views"
              icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            >
              <span className="hidden sm:inline">View Tools</span>
              {activeToolCount > 0 && (
                <span className="font-mono text-[10px] px-1 rounded bg-emerald-400/30 text-emerald-50 tabular-nums">
                  {activeToolCount}
                </span>
              )}
            </ActionButton>

            <ActionButton
              variant="dark-ghost"
              size="xs"
              onClick={onToggleTimelineOpen}
              title="Explore historical energy intervals"
              icon={<Clock className="w-3.5 h-3.5" />}
              className={
                isTimelineOpen || isHistoricalMode
                  ? '!bg-amber-500/28 !border-amber-400/55 !text-amber-100 font-semibold'
                  : ''
              }
            >
              <span className="hidden sm:inline">{isHistoricalMode ? 'History' : 'Timeline'}</span>
            </ActionButton>

            <IconButton
              variant="dark-ghost"
              size="xs"
              label="Reset camera and view"
              title="Reset view to campus overview (R)"
              onClick={onResetView}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </IconButton>

            <IconButton
              variant="dark-ghost"
              size="xs"
              label="Hide controls"
              title="Hide controls (H)"
              onClick={onToggleControlsCollapsed}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        </GlassSurface>
      )}
    </div>
  );
};
