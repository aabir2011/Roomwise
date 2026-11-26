/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Lightbulb,
  Fan,
  Cpu,
  RotateCcw,
  Lock,
  KeyRound,
  AlertCircle,
  Radio,
  Check,
  Loader2,
} from 'lucide-react';
import { Appliance, Classroom } from '../../types/energy';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { clampPercent, summarizeApplianceGroup } from '../../utils/applianceUtils';
import { AnimatedNumber, ToggleSwitch, Tooltip } from '../common/MotionPrimitives';
import { ActionButton, IconButton, InlineActionLink } from '../common/DesignSystem';
import { ROOMWISE_EASE, backdropVariants } from '../../utils/motion';

interface Props {
  room: Classroom;
  isOpen: boolean;
  focusSection?: 'lights' | 'fan' | null;
  onClose: () => void;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

interface ContinuousSliderProps {
  value: number;
  disabled?: boolean;
  isPending?: boolean;
  accentColor: 'amber' | 'emerald' | 'indigo';
  ariaLabel: string;
  onCommit: (nextValue: number) => void;
}

const ContinuousSlider: React.FC<ContinuousSliderProps> = ({
  value,
  disabled = false,
  isPending = false,
  accentColor,
  ariaLabel,
  onCommit,
}) => {
  const [localValue, setLocalValue] = useState<number>(clampPercent(value));
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const draggingRef = useRef<boolean>(false);
  const latestValueRef = useRef<number>(clampPercent(value));
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!draggingRef.current && !isPending) {
      const clean = clampPercent(value);
      setLocalValue(clean);
      latestValueRef.current = clean;
    }
  }, [value, isPending]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const commitIfChanged = (nextVal: number) => {
    const clean = clampPercent(nextVal);
    if (clean !== clampPercent(value)) {
      onCommit(clean);
    }
  };

  const handlePointerDown = () => {
    if (disabled) return;
    draggingRef.current = true;
    setIsDragging(true);
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  const handlePointerRelease = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    commitIfChanged(latestValueRef.current);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onGlobalUp = () => handlePointerRelease();
    window.addEventListener('pointerup', onGlobalUp);
    window.addEventListener('touchend', onGlobalUp);
    return () => {
      window.removeEventListener('pointerup', onGlobalUp);
      window.removeEventListener('touchend', onGlobalUp);
    };
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = clampPercent(Number(e.target.value));
    setLocalValue(next);
    latestValueRef.current = next;

    if (!draggingRef.current) {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        commitIfChanged(next);
      }, 220);
    }
  };

  const fillColor =
    accentColor === 'amber'
      ? '#d97706'
      : accentColor === 'indigo'
      ? '#4f46e5'
      : '#059669';

  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <div className="relative flex-1 flex items-center min-h-[32px]">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={localValue}
          disabled={disabled}
          aria-label={ariaLabel}
          onPointerDown={handlePointerDown}
          onTouchStart={handlePointerDown}
          onChange={handleChange}
          style={
            {
              background: `linear-gradient(to right, ${fillColor} ${localValue}%, #e2e8f0 ${localValue}%)`,
              '--slider-accent': fillColor,
            } as React.CSSProperties
          }
          className="roomwise-slider w-full cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
        />
      </div>
      <div className="w-14 text-right shrink-0 font-mono tabular-nums text-xs font-bold">
        {isPending ? (
          <span className="inline-flex items-center gap-1 text-neutral-500 text-[11px]">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{localValue}%</span>
          </span>
        ) : localValue === 0 ? (
          <span className="text-neutral-400">OFF</span>
        ) : (
          <span
            className={`transition-colors ${
              isDragging ? 'text-emerald-700' : 'text-neutral-900'
            }`}
          >
            {localValue}%
          </span>
        )}
      </div>
    </div>
  );
};

interface UnitRowProps {
  appliance: Appliance;
  disabled: boolean;
  isPending: boolean;
  accentColor: 'amber' | 'emerald' | 'indigo';
  onSetPercent: (pct: number) => void;
  onRestoreAuto: () => void;
}

const ApplianceUnitRow: React.FC<UnitRowProps> = ({
  appliance,
  disabled,
  isPending,
  accentColor,
  onSetPercent,
  onRestoreAuto,
}) => {
  const pct = clampPercent(appliance.outputPercent ?? 0);
  const isOn = pct > 0;
  const isManual = appliance.operatingMode === 'MANUAL' || appliance.isManualOverride;
  const restoreTarget = clampPercent(appliance.lastActivePercent ?? 100) || 100;

  return (
    <div
      data-testid={`appliance-row-${appliance.id}`}
      className={`py-3.5 px-4 transition-colors ${
        isManual ? 'bg-amber-50/35' : 'bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${
              isOn
                ? accentColor === 'amber'
                  ? 'bg-amber-50 text-amber-900 border-amber-200'
                  : accentColor === 'indigo'
                  ? 'bg-indigo-50 text-indigo-900 border-indigo-200'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : 'bg-neutral-100 text-neutral-500 border-neutral-200'
            }`}
          >
            {appliance.unitCode || appliance.name}
          </span>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-neutral-900 truncate">
                {appliance.type === 'lights'
                  ? `Luminaires ${appliance.unitCode}`
                  : appliance.type === 'fan'
                  ? `Fan Sector ${appliance.unitCode}`
                  : appliance.name}
              </span>
              <span className="text-neutral-300" aria-hidden="true">
                ·
              </span>
              <span
                className={`text-[10px] font-bold tracking-wider uppercase ${
                  isManual ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {isManual ? 'MANUAL' : 'AUTO'}
              </span>
            </div>
            <div className="text-[11px] text-neutral-500 font-mono tabular-nums">
              {appliance.currentPowerWatts}W / {appliance.powerRatingWatts}W rated
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <AnimatePresence initial={false}>
            {isManual && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.14, ease: ROOMWISE_EASE }}
              >
                <ActionButton
                  variant="soft"
                  size="xs"
                  disabled={disabled || isPending}
                  onClick={onRestoreAuto}
                  title={`Restore ${appliance.unitCode || appliance.name} to AUTO`}
                  icon={<RotateCcw className="w-3 h-3 text-emerald-700" />}
                >
                  Auto
                </ActionButton>
              </motion.div>
            )}
          </AnimatePresence>

          <ToggleSwitch
            checked={isOn}
            onChange={(nextChecked) => onSetPercent(nextChecked ? restoreTarget : 0)}
            disabled={disabled || isPending}
            size="sm"
            accent={accentColor}
            ariaLabel={`Toggle ${appliance.name} ${isOn ? 'OFF' : 'ON'}`}
          />
        </div>
      </div>

      <ContinuousSlider
        value={pct}
        disabled={disabled}
        isPending={isPending}
        accentColor={accentColor}
        ariaLabel={`${appliance.name} percentage output`}
        onCommit={onSetPercent}
      />
    </div>
  );
};

export const ApplianceControlDrawer: React.FC<Props> = ({
  room: initialRoom,
  isOpen,
  focusSection,
  onClose,
}) => {
  const {
    classrooms,
    pendingRooms,
    pendingAppliances,
    applianceControlError,
    clearApplianceControlError,
    setApplianceOutput,
    setGroupOutput,
    restoreApplianceAuto,
    resetRoomToAdaptive,
  } = useEnergy();
  const { isAdminUnlocked, openAuthModal } = useAuth();
  const toast = useToast();
  const isDesktop = useIsDesktop();

  const room = classrooms.find((c) => c.id === initialRoom.id) || initialRoom;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [highlightedSection, setHighlightedSection] = useState<'lights' | 'fan' | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !focusSection) {
      setHighlightedSection(null);
      return;
    }
    setHighlightedSection(focusSection);
    const scrollTimer = window.setTimeout(() => {
      const targetId =
        focusSection === 'lights' ? 'drawer-section-lights' : 'drawer-section-fan';
      const el = document.getElementById(targetId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    const clearTimer = window.setTimeout(() => setHighlightedSection(null), 1600);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [isOpen, focusSection]);

  const lights = room.appliances.filter((a) => a.type === 'lights');
  const fans = room.appliances.filter((a) => a.type === 'fan');
  const auxUnits = room.appliances.filter((a) => a.type !== 'lights' && a.type !== 'fan');

  const lightSummary = summarizeApplianceGroup(room.appliances, 'lights');
  const fanSummary = summarizeApplianceGroup(room.appliances, 'fan');
  const hasAnyManual = room.appliances.some(
    (a) => a.operatingMode === 'MANUAL' || a.isManualOverride
  );
  const isRoomPending = Boolean(pendingRooms[room.id]);
  const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
  const controlsDisabled = !isAdminUnlocked;

  const handleUnitPercent = async (unit: Appliance, pct: number) => {
    const res = await setApplianceOutput(room.id, unit.id, pct);
    if (res.ok) {
      toast.success(
        `${unit.unitCode || unit.name} ${pct === 0 ? 'switched OFF' : `set to ${pct}%`}`,
        `${room.roomCode} · Manual override confirmed`
      );
    } else if (res.error) {
      toast.error('Unit command rejected', res.error);
    }
  };

  const handleUnitRestoreAuto = async (unit: Appliance) => {
    const res = await restoreApplianceAuto(room.id, unit.id);
    if (res.ok) {
      toast.success(
        `${unit.unitCode || unit.name} restored to AUTO`,
        `${room.roomCode} · Closed-loop automation resumed`
      );
    } else if (res.error) {
      toast.error('Restore AUTO failed', res.error);
    }
  };

  const handleGroupPercent = async (type: 'lights' | 'fan', pct: number) => {
    const res = await setGroupOutput(room.id, type, pct);
    const label = type === 'lights' ? 'All Lights' : 'All Fan Sectors';
    if (res.ok) {
      toast.success(
        `${label} ${pct === 0 ? 'switched OFF' : `set to ${pct}%`}`,
        `${room.roomCode} · Group command applied`
      );
    } else if (res.error) {
      toast.error('Group command failed', res.error);
    }
  };

  const handleRestoreAllAuto = async () => {
    const res = await resetRoomToAdaptive(room.id);
    if (res.ok) {
      toast.success(
        `${room.roomCode} restored to AUTO`,
        isVacant ? 'Vacant classroom eco-shed active (0W)' : 'All units back under adaptive control'
      );
    } else if (res.error) {
      toast.error('Could not restore AUTO', res.error);
    }
  };

  const toggleAllLights = () => {
    if (controlsDisabled) return;
    const allOff = lightSummary.activeCount === 0;
    const fallbackPct =
      lights.find((l) => (l.lastActivePercent ?? 0) > 0)?.lastActivePercent || 100;
    void handleGroupPercent('lights', allOff ? fallbackPct : 0);
  };

  const toggleAllFans = () => {
    if (controlsDisabled) return;
    const allOff = fanSummary.activeCount === 0;
    const fallbackPct =
      fans.find((f) => (f.lastActivePercent ?? 0) > 0)?.lastActivePercent || 75;
    void handleGroupPercent('fan', allOff ? fallbackPct : 0);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-[60] flex justify-end items-end md:items-stretch bg-neutral-900/45 backdrop-blur-[2px]"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Advanced appliance controls for ${room.roomCode}`}
        >
          <motion.div
            initial={isDesktop ? { x: '100%' } : { y: '100%' }}
            animate={isDesktop ? { x: 0 } : { y: 0 }}
            exit={isDesktop ? { x: '100%' } : { y: '100%' }}
            transition={{ duration: 0.28, ease: ROOMWISE_EASE }}
            onClick={(e) => e.stopPropagation()}
            className="w-full md:w-[470px] lg:w-[500px] rw-glass-float md:h-full max-h-[90vh] md:max-h-full rounded-t-3xl md:rounded-none md:border-l border-neutral-200/80 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Mobile Sheet Handle */}
            <div className="md:hidden pt-2.5 pb-1 flex justify-center bg-[#0b1713] border-b border-white/10">
              <div className="w-10 h-1 rounded-full bg-white/25" />
            </div>

            {/* Obsidian-Pine Drawer Header */}
            <div className="px-5 py-4 border-b border-white/10 bg-[#0b1713] text-[#f4f6f4] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold bg-[#132922] text-[#34d399] border border-[#34d399]/30 px-2 py-0.5 rounded">
                    {room.roomCode}
                  </span>
                  <h2 className="font-display text-base font-semibold text-white tracking-tight truncate">
                    {room.name}
                  </h2>
                </div>

                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#9cb0a7] flex-wrap">
                  <Tooltip content="Modelled classroom controller synced with server validation">
                    <span className="inline-flex items-center gap-1 text-[#34d399] font-medium">
                      <Radio className="w-3 h-3" />
                      <span>Node · Server Synced</span>
                    </span>
                  </Tooltip>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono font-semibold text-white">
                    <AnimatedNumber value={room.currentPowerWatts} suffix="W live" />
                  </span>
                  {isVacant && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#c5d4ce] font-medium">No recent motion</span>
                    </>
                  )}
                </div>
              </div>

              <IconButton
                variant="dark-ghost"
                size="md"
                label="Close appliance panel"
                onClick={onClose}
              >
                <X className="w-5 h-5" />
              </IconButton>
            </div>

            {/* Authorization & Restoration Ribbon */}
            <div className="px-5 py-3 border-b border-[rgba(17,25,22,0.1)] bg-white space-y-2.5">
              {!isAdminUnlocked ? (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#fafbf9] border border-[rgba(17,25,22,0.1)]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Lock className="w-4 h-4 text-[#5c6a64] shrink-0" />
                    <div className="text-xs min-w-0">
                      <div className="font-semibold text-[#111916]">Student Read-Only View</div>
                      <div className="text-[11px] text-[#5c6a64] truncate">
                        Sign in as authorized staff to adjust classroom units.
                      </div>
                    </div>
                  </div>
                  <ActionButton
                    variant="forest"
                    size="md"
                    onClick={() => openAuthModal()}
                    icon={<KeyRound className="w-3.5 h-3.5" />}
                  >
                    Teacher Sign-In
                  </ActionButton>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-[#4a5851] min-w-0">
                    <Check className="w-4 h-4 text-[#0b6e4f] shrink-0" />
                    <span className="truncate">
                      {hasAnyManual
                        ? `${room.appliances.filter((a) => a.operatingMode === 'MANUAL' || a.isManualOverride).length} manual override(s) active`
                        : isVacant
                        ? 'All units in AUTO (No-motion 0W eco-shed)'
                        : 'All units in autonomous closed-loop AUTO'}
                    </span>
                  </div>
                  <ActionButton
                    variant={hasAnyManual ? 'forest' : 'secondary'}
                    size="sm"
                    disabled={!hasAnyManual || isRoomPending}
                    loading={isRoomPending}
                    onClick={() => void handleRestoreAllAuto()}
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                  >
                    Restore All AUTO
                  </ActionButton>
                </div>
              )}

              <AnimatePresence>
                {applianceControlError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-2.5 rounded-lg bg-[#fef2f2] border border-[#b91c1c]/25 text-xs text-[#991b1b] flex items-center justify-between gap-2 overflow-hidden"
                  >
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-[#b91c1c] shrink-0" />
                      <span>{applianceControlError}</span>
                    </div>
                    <InlineActionLink
                      tone="rose"
                      onClick={clearApplianceControlError}
                      className="shrink-0"
                    >
                      Dismiss
                    </InlineActionLink>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Scrollable Sections Body */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-6 bg-[#f4f5f3]"
            >
              {/* SECTION 1: LIGHTING */}
              <section
                id="drawer-section-lights"
                className={`space-y-2.5 rounded-xl transition-all duration-300 ${
                  highlightedSection === 'lights' ? 'ring-2 ring-[#b45309]/40 bg-[#fffbeb]/40 p-2 -m-2' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-[#b45309]" />
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#111916]">
                      Lighting ({lights.length} Units)
                    </h3>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-neutral-600">
                    <span className="font-bold text-neutral-900">{lightSummary.avgPercent}% avg</span>
                    <span aria-hidden="true"> · </span>
                    <span>{lightSummary.totalWatts}W</span>
                    <span aria-hidden="true"> · </span>
                    <span
                      className={
                        lightSummary.modeStatus === 'AUTO'
                          ? 'text-emerald-700 font-bold'
                          : 'text-amber-700 font-bold'
                      }
                    >
                      {lightSummary.modeStatus}
                    </span>
                  </div>
                </div>

                {/* Combined Lighting Surface (Master + Hairline-Separated Units) */}
                <div className="rounded-xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden divide-y divide-neutral-100">
                  <div className="p-4 bg-neutral-50/55 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-neutral-900">Master Brightness</div>
                        <div className="text-[11px] text-neutral-500">
                          Applies to all {lights.length} lights; refine individual units below
                        </div>
                      </div>
                      <ActionButton
                        variant={lightSummary.activeCount > 0 ? 'primary' : 'amber'}
                        size="sm"
                        disabled={controlsDisabled || Boolean(pendingAppliances[`${room.id}:group:lights`])}
                        onClick={toggleAllLights}
                      >
                        {lightSummary.activeCount > 0 ? 'All Lights OFF' : 'All Lights ON'}
                      </ActionButton>
                    </div>
                    <ContinuousSlider
                      value={lightSummary.avgPercent}
                      disabled={controlsDisabled}
                      isPending={Boolean(pendingAppliances[`${room.id}:group:lights`])}
                      accentColor="amber"
                      ariaLabel="Master brightness percentage for all lights"
                      onCommit={(pct) => void handleGroupPercent('lights', pct)}
                    />
                  </div>

                  {lights.map((light) => (
                    <ApplianceUnitRow
                      key={light.id}
                      appliance={light}
                      disabled={controlsDisabled}
                      isPending={Boolean(pendingAppliances[light.id])}
                      accentColor="amber"
                      onSetPercent={(pct) => void handleUnitPercent(light, pct)}
                      onRestoreAuto={() => void handleUnitRestoreAuto(light)}
                    />
                  ))}
                </div>
              </section>

              {/* SECTION 2: FAN SECTORS */}
              <section
                id="drawer-section-fan"
                className={`space-y-2.5 pt-2 border-t border-neutral-200/80 rounded-2xl transition-all duration-300 ${
                  highlightedSection === 'fan' ? 'ring-2 ring-emerald-500/45 bg-emerald-50/20 p-2 -m-2' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Fan className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-900">
                      Fan Sectors ({fans.length} Sectors)
                    </h3>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-neutral-600">
                    <span className="font-bold text-neutral-900">{fanSummary.avgPercent}% avg</span>
                    <span aria-hidden="true"> · </span>
                    <span>{fanSummary.totalWatts}W</span>
                    <span aria-hidden="true"> · </span>
                    <span
                      className={
                        fanSummary.modeStatus === 'AUTO'
                          ? 'text-emerald-700 font-bold'
                          : 'text-amber-700 font-bold'
                      }
                    >
                      {fanSummary.modeStatus}
                    </span>
                  </div>
                </div>

                {/* Combined Fan Surface (Master + Hairline-Separated Sectors) */}
                <div className="rounded-xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden divide-y divide-neutral-100">
                  <div className="p-4 bg-neutral-50/55 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-neutral-900">Master Fan Speed</div>
                        <div className="text-[11px] text-neutral-500">
                          Applies to all {fans.length} sectors; tune sectors independently below
                        </div>
                      </div>
                      <ActionButton
                        variant={fanSummary.activeCount > 0 ? 'primary' : 'forest'}
                        size="sm"
                        disabled={controlsDisabled || Boolean(pendingAppliances[`${room.id}:group:fan`])}
                        onClick={toggleAllFans}
                      >
                        {fanSummary.activeCount > 0 ? 'All Fans OFF' : 'All Fans ON'}
                      </ActionButton>
                    </div>
                    <ContinuousSlider
                      value={fanSummary.avgPercent}
                      disabled={controlsDisabled}
                      isPending={Boolean(pendingAppliances[`${room.id}:group:fan`])}
                      accentColor="emerald"
                      ariaLabel="Master fan speed percentage for all sectors"
                      onCommit={(pct) => void handleGroupPercent('fan', pct)}
                    />
                  </div>

                  {fans.map((sector) => (
                    <ApplianceUnitRow
                      key={sector.id}
                      appliance={sector}
                      disabled={controlsDisabled}
                      isPending={Boolean(pendingAppliances[sector.id])}
                      accentColor="emerald"
                      onSetPercent={(pct) => void handleUnitPercent(sector, pct)}
                      onRestoreAuto={() => void handleUnitRestoreAuto(sector)}
                    />
                  ))}
                </div>
              </section>

              {/* SECTION 3: AUXILIARY */}
              {auxUnits.length > 0 && (
                <section className="space-y-2.5 pt-2 border-t border-neutral-200/80">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-900">
                      Auxiliary Equipment
                    </h3>
                  </div>
                  <div className="rounded-xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden divide-y divide-neutral-100">
                    {auxUnits.map((aux) => (
                      <ApplianceUnitRow
                        key={aux.id}
                        appliance={aux}
                        disabled={controlsDisabled}
                        isPending={Boolean(pendingAppliances[aux.id])}
                        accentColor="indigo"
                        onSetPercent={(pct) => void handleUnitPercent(aux, pct)}
                        onRestoreAuto={() => void handleUnitRestoreAuto(aux)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
