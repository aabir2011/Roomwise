/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Sun,
  Thermometer,
  Users,
  Lightbulb,
  Fan,
  Cpu,
  RotateCcw,
  Sliders,
  CheckCircle2,
  Clock,
  Sparkles,
  QrCode,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  SlidersHorizontal,
  Lock,
  KeyRound,
  Shield,
} from 'lucide-react';
import { Classroom } from '../../types/energy';
import { useEnergy } from '../../context/EnergyContext';
import { authFetch, useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { getRoomActivityState, summarizeApplianceGroup } from '../../utils/applianceUtils';
import { ApplianceControlDrawer } from './ApplianceControlDrawer';
import { AnimatedNumber, ToggleSwitch } from '../common/MotionPrimitives';
import { AcronymHint } from '../common/AcronymHint';
import {
  backdropVariants,
  modalVariants,
  tabContentVariants,
  SPRING_SNAPPY,
} from '../../utils/motion';

interface Props {
  room: Classroom;
  onClose: () => void;
}

export const RoomDetailModal: React.FC<Props> = ({ room: initialRoom, onClose }) => {
  const {
    classrooms,
    triggerRoomRecalibration,
    resetRoomToAdaptive,
    updateRoomManualParams,
    updateRoomCapacity,
    setQrModalRoom,
    settings,
    currentStaff,
  } = useEnergy();
  const { isAdminUnlocked, openAuthModal, requestLogout } = useAuth();
  const toast = useToast();

  const room = classrooms.find((c) => c.id === initialRoom.id) || initialRoom;

  const [activeTab, setActiveTab] = useState<'controls' | 'reasoning' | 'calibration'>('controls');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFocus, setDrawerFocus] = useState<'lights' | 'fan' | null>(null);
  const [targetLuxInput, setTargetLuxInput] = useState<number>(
    room.calibration.manualParameters.targetLux
  );
  const [maxFanSpeedInput, setMaxFanSpeedInput] = useState<number>(
    room.calibration.manualParameters.maxFanSpeed
  );
  const [maxOccupancyInput, setMaxOccupancyInput] = useState<number>(room.capacity);
  const [ecoModeInput, setEcoModeInput] = useState<boolean>(
    room.calibration.manualParameters.autoEcoMode
  );
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [isResettingAdaptive, setIsResettingAdaptive] = useState(false);
  const [isRecalibrating, setIsRecalibrating] = useState(false);
  const [calibrationStage, setCalibrationStage] = useState<number>(0);
  const [recalibrationComplete, setRecalibrationComplete] = useState(false);

  useEffect(() => {
    setTargetLuxInput(room.calibration.manualParameters.targetLux);
    setMaxFanSpeedInput(room.calibration.manualParameters.maxFanSpeed);
    setMaxOccupancyInput(room.capacity);
    setEcoModeInput(room.calibration.manualParameters.autoEcoMode);
  }, [
    room.id,
    room.capacity,
    room.calibration.manualParameters.targetLux,
    room.calibration.manualParameters.maxFanSpeed,
    room.calibration.manualParameters.autoEcoMode,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !drawerOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onClose]);

  const handleAdminAction = (action: () => void) => {
    if (!isAdminUnlocked) {
      openAuthModal(action);
    } else {
      action();
    }
  };

  const handleRunRecalibration = () => {
    handleAdminAction(() => {
      if (isRecalibrating) return;
      setIsRecalibrating(true);
      setCalibrationStage(1);
      setRecalibrationComplete(false);

      setTimeout(() => {
        setCalibrationStage(2);
        setTimeout(() => {
          setCalibrationStage(3);
          setTimeout(() => {
            setCalibrationStage(4);
            triggerRoomRecalibration(room.id);
            setIsRecalibrating(false);
            setRecalibrationComplete(true);
            toast.success(
              `${room.roomCode} calibration updated`,
              'Solar penetration α and thermal β weights fitted.'
            );
            setTimeout(() => setRecalibrationComplete(false), 3500);
          }, 520);
        }, 520);
      }, 520);
    });
  };

  const handleResetToAdaptive = () => {
    handleAdminAction(async () => {
      if (isResettingAdaptive) return;
      setIsResettingAdaptive(true);
      try {
        const result = await resetRoomToAdaptive(room.id);
        if (result.ok) {
          toast.success(
            `${room.roomCode} restored to AUTO`,
            isVacant
              ? 'Vacant classroom eco-shedding applied (0W).'
              : 'Autonomous closed-loop control resumed.'
          );
          try {
            const audioCtx = new (window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
          } catch {
            // audio optional
          }
        } else if (result.error) {
          toast.error('Failed to resume adaptive control', result.error);
        }
      } finally {
        setIsResettingAdaptive(false);
      }
    });
  };

  const handleSaveParams = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedLux = Math.min(800, Math.max(100, Number(targetLuxInput) || 300));
    const sanitizedMaxOcc = Math.min(400, Math.max(10, Math.round(Number(maxOccupancyInput) || room.capacity)));
    setTargetLuxInput(sanitizedLux);
    setMaxOccupancyInput(sanitizedMaxOcc);
    handleAdminAction(async () => {
      updateRoomManualParams(room.id, {
        targetLux: sanitizedLux,
        maxFanSpeed: Number(maxFanSpeedInput),
        autoEcoMode: ecoModeInput,
      });

      if (sanitizedMaxOcc !== room.capacity) {
        try {
          const res = await authFetch(`/api/space/rooms/${encodeURIComponent(room.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ maxOccupancy: sanitizedMaxOcc }),
          });
          if (res.ok) {
            updateRoomCapacity(room.id, sanitizedMaxOcc);
          } else {
            const errBody = await res.json().catch(() => ({}));
            toast.error('Room capacity update failed', errBody?.error || 'Server rejected update');
          }
        } catch {
          toast.error('Network error updating room capacity');
        }
      }

      setSaveSuccess(true);
      toast.success(
        `${room.roomCode} setpoints saved`,
        `Target ${sanitizedLux} lx · Max Fan ${maxFanSpeedInput} · Max Occ ${sanitizedMaxOcc}`
      );
      setTimeout(() => setSaveSuccess(false), 2000);
    });
  };

  const lightSummary = summarizeApplianceGroup(room.appliances, 'lights');
  const fanSummary = summarizeApplianceGroup(room.appliances, 'fan');
  const auxAppliances = room.appliances.filter((a) => a.type !== 'lights' && a.type !== 'fan');
  const hasManualOverride = room.appliances.some(
    (a) => a.operatingMode === 'MANUAL' || a.isManualOverride
  );
  const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
  const alpha = room.calibration.learnedParameters.daylightPenetrationAlpha;
  const naturalDeliveredLux = Math.round(room.environment.naturalDaylightLux * alpha);
  const artificialDeficit = Math.max(
    0,
    room.calibration.manualParameters.targetLux - naturalDeliveredLux
  );

  const openDrawer = (section: 'lights' | 'fan' | null) => {
    setDrawerFocus(section);
    setDrawerOpen(true);
  };

  const tabs = [
    { id: 'controls' as const, label: 'Controls & Overrides', icon: Sliders },
    { id: 'reasoning' as const, label: 'Adaptive Automation Logic', icon: Cpu },
    { id: 'calibration' as const, label: 'Learned Calibration Profile', icon: Sparkles },
  ];

  return (
    <motion.div
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-neutral-900/55 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`${room.roomCode} ${room.name} Inspection`}
    >
      <motion.div
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="glass-modal rounded-2xl sm:rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden bg-white"
      >
        {/* Streamlined Modal Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-neutral-200/80 bg-neutral-50/75 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold bg-neutral-900 text-white px-2 py-0.5 rounded-md">
                {room.roomCode}
              </span>
              <h2 className="text-sm sm:text-base font-bold text-neutral-900 truncate">
                {room.name}
              </h2>
              <span className="text-xs text-neutral-500 font-medium hidden sm:inline">
                · {room.building} ({room.floor})
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-0.5 truncate tabular-nums">
              {settings.institutionName} · {room.type} · Configured capacity: {room.capacity} seats
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setQrModalRoom(room)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors active:scale-[0.98]"
              title="Print classroom QR door placard"
            >
              <QrCode className="w-3.5 h-3.5 text-emerald-700" />
              <span className="hidden sm:inline">QR Placard</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-xl hover:bg-neutral-100 transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Clean 4-Stat Telemetry Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 p-3 sm:p-4 bg-white border-b border-neutral-100">
          <div className="p-2.5 sm:p-3 rounded-xl bg-neutral-50/85 border border-neutral-200/75">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>Desk Illumination</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-neutral-900 mt-0.5 font-mono">
              <AnimatedNumber value={room.environment.ambientLux} />{' '}
              <span className="text-xs font-normal text-neutral-500">lx</span>
            </div>
            <div className="text-[10px] sm:text-[11px] text-neutral-500 mt-0.5 tabular-nums">
              Target: {room.calibration.manualParameters.targetLux} lx · Nat: {naturalDeliveredLux} lx
            </div>
          </div>

          <div className="p-2.5 sm:p-3 rounded-xl bg-neutral-50/85 border border-neutral-200/75">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
              <Thermometer className="w-3.5 h-3.5 text-rose-500" />
              <span>Thermal & Comfort</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-neutral-900 mt-0.5 font-mono">
              <AnimatedNumber value={room.environment.temperature} decimals={1} suffix="°C" />
            </div>
            <div className="text-[11px] text-neutral-600 mt-0.5 tabular-nums">
              <AcronymHint term="HI" /> {room.environment.heatIndex}°C · RH {room.environment.humidity}%
            </div>
          </div>

          <div className="p-2.5 sm:p-3 rounded-xl bg-neutral-50/85 border border-neutral-200/75">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
              <Users className="w-3.5 h-3.5 text-blue-500" />
              <span>Room Activity (<AcronymHint term="PIR" />)</span>
            </div>
            <div className="text-sm sm:text-base font-bold text-neutral-900 mt-0.5 leading-snug">
              {getRoomActivityState(room)}
            </div>
            <div className="text-[11px] text-neutral-600 mt-0.5 truncate tabular-nums">
              Max occupancy: {room.capacity} seats · Last motion {room.pir.lastMotionMinutesAgo}m ago
            </div>
          </div>

          <div className="p-2.5 sm:p-3 rounded-xl bg-emerald-50/75 border border-emerald-200/80">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-800">
              <Cpu className="w-3.5 h-3.5 text-emerald-600" />
              <span>Active Draw & Rated Max</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-emerald-900 mt-0.5 font-mono">
              <AnimatedNumber value={room.currentPowerWatts} />{' '}
              <span className="text-xs font-normal text-emerald-700">W</span>
            </div>
            {(() => {
              const ratedW =
                room.ratedPowerWatts ??
                room.appliances.reduce((acc, a) => acc + a.powerRatingWatts, 0);
              const headroomW = Math.max(0, ratedW - room.currentPowerWatts);
              const ratedPct = ratedW > 0 ? Math.round((room.currentPowerWatts / ratedW) * 100) : 0;
              return (
                <div
                  className="text-[11px] text-emerald-800 mt-0.5 font-medium tabular-nums"
                  title={`Installed Rated Max: ${ratedW}W · Available Headroom: ${headroomW}W`}
                >
                  {headroomW === 0
                    ? `100% of ${ratedW}W max`
                    : `${headroomW}W headroom · ${ratedPct}% of ${ratedW}W max`}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Tab Navigation with Gliding layoutId Indicator */}
        <div className="flex items-center gap-2 px-3 sm:px-6 border-b border-neutral-200 text-xs font-medium bg-neutral-50/50 overflow-x-auto whitespace-nowrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative py-2.5 px-2.5 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'text-emerald-900 font-semibold'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {tab.id === 'controls' && hasManualOverride && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-amber-500"
                    title="Manual override active"
                  />
                )}
                {isActive && (
                  <motion.span
                    layoutId={`room-modal-tab-underline-${room.id}`}
                    transition={SPRING_SNAPPY}
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-3 sm:p-6 overflow-y-auto flex-1 bg-white">
          <AnimatePresence mode="wait" initial={false}>
            {activeTab === 'controls' && (
              <motion.div
                key="controls"
                variants={tabContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-4"
              >
                {/* Admin Authorization Ribbon */}
                {!isAdminUnlocked ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-50/80 border border-amber-300/80 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-900 flex items-center justify-center shrink-0">
                        <Lock className="w-4 h-4 text-amber-800" />
                      </div>
                      <div>
                        <div className="font-bold text-neutral-900 flex items-center gap-2">
                          <span>Viewer Mode</span>
                          <span className="text-[11px] font-medium text-amber-800">
                            · Manual Overrides Protected
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-600 mt-0.5">
                          Students & viewers can inspect telemetry. Teacher overrides require verification.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAuthModal()}
                      className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all active:scale-[0.98]"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                      <span>Unlock Admin Controls</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-300/80 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-900 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4 text-emerald-700" />
                      </div>
                      <div>
                        <div className="font-bold text-emerald-950">
                          Admin Overrides Unlocked
                        </div>
                        <div className="text-[11px] text-emerald-800 mt-0.5">
                          {currentStaff.name} · {currentStaff.role}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={requestLogout}
                      className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-white border border-neutral-300 text-neutral-700 text-xs font-semibold hover:bg-neutral-50 transition-colors"
                    >
                      Logout Admin
                    </button>
                  </div>
                )}

                {/* Automation State Summary & Reset */}
                <div
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border transition-colors ${
                    hasManualOverride
                      ? isVacant
                        ? 'border-amber-300 bg-amber-50/70'
                        : 'border-amber-200 bg-neutral-50/70'
                      : isVacant
                      ? 'border-emerald-200/90 bg-emerald-50/40'
                      : 'border-neutral-200/80 bg-neutral-50/60'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-neutral-900">Automation State:</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          hasManualOverride
                            ? 'text-amber-800'
                            : 'text-emerald-800'
                        }`}
                      >
                        {hasManualOverride
                          ? isVacant
                            ? `Manual Override Active (${room.currentPowerWatts}W · no recent motion)`
                            : 'Manual Override Active'
                          : isVacant
                          ? 'No Recent Motion · Autonomous Eco-Shed (0W)'
                          : 'Autonomous Closed-Loop Active'}
                      </span>
                    </div>

                    <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                      {hasManualOverride
                        ? isVacant
                          ? `No recent PIR motion detected, yet manual overrides hold appliances active (${room.currentPowerWatts}W). Restoring adaptive control will immediately shed loads to 0W.`
                          : 'Teacher overrides temporarily hold selected outputs. Roomwise auto-resumes closed-loop modulation when motion stops beyond grace window.'
                        : isVacant
                        ? 'No recent PIR motion detected beyond the grace window. Closed-loop automation has shed luminaire banks and ceiling fans to 0W.'
                        : 'Roomwise continuously modulates lighting and BLDC fan speeds based on real-time daylight harvesting and heat index.'}
                    </p>
                  </div>

                  {hasManualOverride && (
                    <button
                      type="button"
                      onClick={handleResetToAdaptive}
                      disabled={isResettingAdaptive}
                      className={`self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-60 shrink-0 ${
                        isVacant
                          ? 'border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      <RotateCcw
                        className={`w-3.5 h-3.5 ${isResettingAdaptive ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {isResettingAdaptive
                          ? isVacant
                            ? 'Shedding loads...'
                            : 'Restoring...'
                          : isVacant
                          ? 'Resume Adaptive Control (0W Shed)'
                          : 'Resume Adaptive Control'}
                      </span>
                    </button>
                  )}
                </div>

                {/* Hairline Progressive-Disclosure Appliance Group Rows */}
                <div className="rounded-xl border border-neutral-200/90 bg-white divide-y divide-neutral-100 overflow-hidden">
                  {/* Lighting Summary */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50/50 transition-colors">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-center shrink-0">
                        <Lightbulb className="w-5 h-5 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-neutral-900">
                            Lighting ({lightSummary.totalCount} Units)
                          </span>
                          <span className="text-neutral-300" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider ${
                              lightSummary.modeStatus === 'AUTO'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {lightSummary.modeStatus}
                          </span>
                        </div>
                        <div className="text-xs font-mono tabular-nums text-neutral-700 mt-0.5">
                          {lightSummary.avgPercent}% average · {lightSummary.activeCount}/
                          {lightSummary.totalCount} active ·{' '}
                          <strong className="text-neutral-900">{lightSummary.totalWatts}W</strong>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openDrawer('lights')}
                      className="self-start sm:self-auto px-3.5 py-2 min-h-[38px] rounded-xl border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 text-xs font-bold text-neutral-900 flex items-center gap-1.5 transition-all active:scale-[0.98] shrink-0"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                      <span>Adjust Lights</span>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                    </button>
                  </div>

                  {/* Fan Sectors Summary */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50/50 transition-colors">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-center justify-center shrink-0">
                        <Fan className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-neutral-900">
                            Fans ({fanSummary.totalCount} Sectors)
                          </span>
                          <span className="text-neutral-300" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider ${
                              fanSummary.modeStatus === 'AUTO'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {fanSummary.modeStatus}
                          </span>
                        </div>
                        <div className="text-xs font-mono tabular-nums text-neutral-700 mt-0.5">
                          {fanSummary.operatingLabel} · {fanSummary.activeCount}/
                          {fanSummary.totalCount} sectors · {fanSummary.avgPercent}% avg ·{' '}
                          <strong className="text-neutral-900">{fanSummary.totalWatts}W</strong>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openDrawer('fan')}
                      className="self-start sm:self-auto px-3.5 py-2 min-h-[38px] rounded-xl border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 text-xs font-bold text-neutral-900 flex items-center gap-1.5 transition-all active:scale-[0.98] shrink-0"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Adjust Fans</span>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                    </button>
                  </div>

                  {/* Auxiliary Summary */}
                  {auxAppliances.map((aux) => (
                    <div
                      key={aux.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50/50 transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200/60 flex items-center justify-center shrink-0">
                          <Cpu className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-neutral-900 truncate">
                              {aux.name}
                            </span>
                            <span className="text-neutral-300" aria-hidden="true">
                              ·
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider ${
                                aux.operatingMode === 'MANUAL' || aux.isManualOverride
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {aux.operatingMode === 'MANUAL' || aux.isManualOverride
                                ? 'MANUAL'
                                : 'AUTO'}
                            </span>
                          </div>
                          <div className="text-xs font-mono tabular-nums text-neutral-700 mt-0.5">
                            {aux.outputPercent === 0 ? 'OFF' : `${aux.outputPercent}%`} ·{' '}
                            <strong className="text-neutral-900">{aux.currentPowerWatts}W</strong> /{' '}
                            {aux.powerRatingWatts}W
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openDrawer(null)}
                        className="self-start sm:self-auto px-3.5 py-2 min-h-[38px] rounded-xl border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 text-xs font-bold text-neutral-900 flex items-center gap-1.5 transition-all active:scale-[0.98] shrink-0"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Adjust</span>
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'reasoning' && (() => {
              const graceMinutes = room.calibration.learnedParameters.occupancyDecayMinutes;
              return (
              <motion.div
                key="reasoning"
                variants={tabContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-4"
              >
                <div className="p-4 rounded-xl border border-neutral-200/90 bg-white">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-emerald-600" />
                      <span>Deterministic Control &amp; Sensor Trace</span>
                    </h3>
                    <span className="text-[11px] text-neutral-500 font-mono tabular-nums">
                      Evaluation: {room.decision.timestamp}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/75">
                      <div className="flex items-center gap-2 text-xs font-bold text-neutral-900">
                        <Lightbulb className="w-4 h-4 text-amber-500" />
                        <span>Daylight Harvesting &amp; Lighting Modulation</span>
                      </div>
                      <div className="text-xs text-neutral-700 mt-1.5 pl-6 space-y-1">
                        <p>
                          <strong>Decision:</strong> {room.decision.lightingAction}
                        </p>
                        <p className="text-neutral-600">{room.decision.lightingReason}</p>
                        <div className="text-[11px] text-neutral-500 font-mono tabular-nums bg-white p-2 rounded-lg border border-neutral-200/70 mt-2">
                          Deficit = Target ({room.calibration.manualParameters.targetLux} lx) − [Ext (
                          {room.environment.naturalDaylightLux} lx) × α ({alpha})] ={' '}
                          {artificialDeficit} lx required
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/75">
                      <div className="flex items-center gap-2 text-xs font-bold text-neutral-900">
                        <Thermometer className="w-4 h-4 text-blue-500" />
                        <span>Adaptive Thermal Index &amp; Fan Regulation</span>
                      </div>
                      <div className="text-xs text-neutral-700 mt-1.5 pl-6 space-y-1">
                        <p>
                          <strong>Decision:</strong> {room.decision.fanAction}
                        </p>
                        <p className="text-neutral-600">{room.decision.fanReason}</p>
                        <div className="text-[11px] text-neutral-500 font-mono tabular-nums bg-white p-2 rounded-lg border border-neutral-200/70 mt-2">
                          Temp {room.environment.temperature}°C · HI {room.environment.heatIndex}°C ·
                          RH {room.environment.humidity}% · Ceiling: Speed{' '}
                          {room.calibration.manualParameters.maxFanSpeed}
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/75">
                      <div className="flex items-center gap-2 text-xs font-bold text-neutral-900">
                        <Users className="w-4 h-4 text-emerald-600" />
                        <span>PIR Presence &amp; Stillness Decay Filter</span>
                      </div>
                      <div className="text-xs text-neutral-700 mt-1.5 pl-6 space-y-1">
                        <p>
                          <strong>Observation:</strong> {room.pir.detectionSummary}
                        </p>
                        <p className="text-neutral-600">
                          Inactivity window: {room.pir.lastMotionMinutesAgo}m (Grace period:{' '}
                          {graceMinutes}m).{' '}
                          {isVacant
                            ? hasManualOverride
                              ? `Manual override holds ${room.currentPowerWatts}W active despite vacancy.`
                              : 'Eco-shedding applied beyond grace window (0W).'
                            : 'Power remains sustained to protect examination periods.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
              );
            })()}

            {activeTab === 'calibration' && (
              <motion.div
                key="calibration"
                variants={tabContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-4"
              >
                <div className="p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/45 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Sparkles className="w-4 h-4 text-emerald-700" />
                      <span className="text-xs font-bold text-emerald-900">
                        Multi-Day Autonomous Calibration Engine
                      </span>
                      <span className="text-[11px] font-mono text-emerald-800 font-semibold">
                        · {room.calibration.isCalibrated ? 'Trained' : 'Training'} (
                        {room.calibration.dataSufficiencyPercent}%)
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-600 mt-1">
                      Continuously correlates internal lux, solar geometry, thermal lag, and occupancy patterns.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunRecalibration}
                    disabled={isRecalibrating}
                    className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-50 shrink-0"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isRecalibrating ? 'animate-spin' : ''}`} />
                    <span>{isRecalibrating ? 'Calibrating...' : 'Trigger Recalibration'}</span>
                  </button>
                </div>

                <AnimatePresence>
                  {isRecalibrating && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="p-3 rounded-xl bg-neutral-900 text-white text-xs font-mono space-y-1.5 overflow-hidden"
                    >
                      <div className="flex items-center justify-between text-neutral-400">
                        <span>STEP {calibrationStage} OF 4</span>
                        <span>IIT Kharagpur Microclimate Solver</span>
                      </div>
                      <div className="text-emerald-400 font-bold">
                        {calibrationStage === 1 &&
                          '> Sampling lux variance against outdoor reference sensor...'}
                        {calibrationStage === 2 && '> Fitting daylight penetration coefficient (α)...'}
                        {calibrationStage === 3 &&
                          '> Validating thermal inertia & ventilation rate (β)...'}
                        {calibrationStage === 4 && '> Updating local closed-loop parameter weights...'}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {recalibrationComplete && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="p-3 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-medium flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>
                        Calibration updated successfully with validated IIT Kharagpur solar coefficients.
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-neutral-200/90 bg-neutral-50/60">
                    <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Learned Parameters</span>
                    </h4>
                    <div className="divide-y divide-neutral-200/60 text-xs">
                      <div className="flex justify-between items-center py-2">
                        <div>
                          <div className="font-semibold text-neutral-800">Daylight Penetration (α)</div>
                          <div className="text-[10px] text-neutral-500">
                            Window-to-desk solar fraction
                          </div>
                        </div>
                        <span className="font-mono font-bold text-neutral-900 tabular-nums">
                          {alpha}
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-2">
                        <div>
                          <div className="font-semibold text-neutral-800">Thermal Dissipation (β)</div>
                          <div className="text-[10px] text-neutral-500">
                            Natural cooling with cross ventilation
                          </div>
                        </div>
                        <span className="font-mono font-bold text-neutral-900 tabular-nums">
                          {room.calibration.learnedParameters.thermalDissipationBeta} °C/hr
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-2">
                        <div>
                          <div className="font-semibold text-neutral-800">Inactivity Grace Window</div>
                          <div className="text-[10px] text-neutral-500">
                            Stillness tolerance during examinations
                          </div>
                        </div>
                        <span className="font-mono font-bold text-neutral-900 tabular-nums">
                          {room.calibration.learnedParameters.occupancyDecayMinutes} min
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-2">
                        <div>
                          <div className="font-semibold text-neutral-800">Luminaire Efficiency</div>
                          <div className="text-[10px] text-neutral-500">
                            Observed output per input watt
                          </div>
                        </div>
                        <span className="font-mono font-bold text-neutral-900 tabular-nums">
                          {room.calibration.learnedParameters.luminaireEfficiencyLmPerW} lm/W
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-neutral-200/90 bg-white">
                    <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-4 h-4 text-neutral-700" />
                      <span>Configured Targets & Limits</span>
                    </h4>

                    <form onSubmit={handleSaveParams} className="space-y-3 text-xs">
                      <div>
                        <label className="block font-medium text-neutral-700">
                          Room Max Occupancy (Seats)
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={400}
                          value={maxOccupancyInput}
                          onChange={(e) => setMaxOccupancyInput(Number(e.target.value))}
                          className="mt-1 w-full px-3 py-1.5 glass-input rounded-lg font-mono text-xs tabular-nums focus:outline-none"
                        />
                        <p className="text-[11px] text-neutral-600 mt-0.5">
                          Used by Space Intelligence as the hard seating limit.
                        </p>
                      </div>

                      <div>
                        <label className="block font-medium text-neutral-700">
                          Target Desk Lux (<AcronymHint term="NBC 2016" />)
                        </label>
                        <input
                          type="number"
                          min={100}
                          max={800}
                          value={targetLuxInput}
                          onChange={(e) => setTargetLuxInput(Number(e.target.value))}
                          className="mt-1 w-full px-3 py-1.5 glass-input rounded-lg font-mono text-xs tabular-nums focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-neutral-700">
                          Max Permitted Fan Speed
                        </label>
                        <select
                          value={maxFanSpeedInput}
                          onChange={(e) => setMaxFanSpeedInput(Number(e.target.value))}
                          className="mt-1 w-full px-3 py-1.5 glass-input rounded-lg text-xs focus:outline-none"
                        >
                          <option value={3}>Speed 3 (Whisper quiet)</option>
                          <option value={4}>Speed 4 (Balanced comfort)</option>
                          <option value={5}>Speed 5 (Max high velocity)</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div>
                          <div className="font-medium text-neutral-800">Auto Eco Mode</div>
                          <div className="text-[10px] text-neutral-500">
                            Autonomous load-shedding when vacant
                          </div>
                        </div>
                        <ToggleSwitch
                          checked={ecoModeInput}
                          onChange={setEcoModeInput}
                          ariaLabel="Toggle Auto Eco Mode"
                          size="sm"
                        />
                      </div>

                      <div className="pt-2">
                        <button
                          type="submit"
                          className="w-full py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-all active:scale-[0.98]"
                        >
                          {saveSuccess ? 'Setpoints Saved' : 'Save Configured Setpoints'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>

                {/* Calibration History Log */}
                <div className="p-4 rounded-xl border border-neutral-200/90 bg-white">
                  <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-neutral-500" />
                    <span>Recent Calibration Event Trail</span>
                  </h4>
                  {room.calibration.calibrationHistory.length === 0 ? (
                    <div className="text-neutral-400 text-xs py-3 text-center">
                      Baseline parameter set verified. No seasonal drift adjustments recorded today.
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {room.calibration.calibrationHistory.map((item, idx) => (
                        <div
                          key={idx}
                          className="py-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] font-bold text-neutral-800 tabular-nums">
                                {item.timestamp}
                              </span>
                              <span className="font-mono text-[10px] text-neutral-500">
                                · {item.parameter}
                              </span>
                            </div>
                            <div className="text-[11px] text-neutral-600 mt-0.5">
                              {item.rationale}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs font-mono tabular-nums shrink-0">
                            <span className="text-neutral-400 line-through">{item.previousValue}</span>
                            <ArrowRight className="w-3 h-3 text-emerald-600" />
                            <span className="font-bold text-emerald-700">{item.calibratedValue}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Streamlined Modal Footer */}
        <div className="px-4 py-3 sm:px-6 bg-neutral-50 border-t border-neutral-200/80 flex items-center justify-between text-xs text-neutral-500">
          {(() => {
            const ratedW =
              room.ratedPowerWatts ??
              room.appliances.reduce((acc, a) => acc + a.powerRatingWatts, 0);
            const headroomW = Math.max(0, ratedW - room.currentPowerWatts);
            return (
              <div className="text-[11px] text-neutral-600 truncate tabular-nums">
                Tariff: ₹{settings.tariffPerKWhINR}/kWh (<AcronymHint term="WBSEDCL" />) · Installed Max: {ratedW}W · Available Headroom: {headroomW}W
              </div>
            );
          })()}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-800 transition-all active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </motion.div>

      <ApplianceControlDrawer
        room={room}
        isOpen={drawerOpen}
        focusSection={drawerFocus}
        onClose={() => setDrawerOpen(false)}
      />
    </motion.div>
  );
};
