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
import { ActionButton, IconButton } from '../common/DesignSystem';
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
        className="glass-modal rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden bg-white"
      >
        {/* Obsidian-Pine Architectural Modal Masthead */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 rw-obsidian-panel border-x-0 border-t-0 rounded-none shadow-none text-[#f4f6f4] border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-xs font-semibold bg-[#132922] text-[#34d399] border border-[#34d399]/30 px-2 py-0.5 rounded">
                {room.roomCode}
              </span>
              <h2 className="font-display text-base sm:text-lg font-semibold text-white tracking-tight truncate">
                {room.name}
              </h2>
              <span className="text-xs text-[#9cb0a7] font-medium hidden sm:inline">
                · {room.building} ({room.floor})
              </span>
            </div>
            <p className="text-[11px] text-[#9cb0a7] mt-1 truncate tabular-nums">
              {settings.institutionName} · {room.type} · Configured capacity: {room.capacity} seats
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <ActionButton
              variant="dark-ghost"
              size="sm"
              onClick={() => setQrModalRoom(room)}
              icon={<QrCode className="w-3.5 h-3.5 text-[#34d399]" />}
              title="Print classroom QR door placard"
            >
              <span className="hidden sm:inline">QR Placard</span>
            </ActionButton>
            <IconButton
              variant="dark-ghost"
              size="sm"
              label="Close dialog"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </IconButton>
          </div>
        </div>

        {/* Single-Sheet 4-Column Hairline Telemetry Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[rgba(17,25,22,0.09)] bg-[#fafbf9] border-b border-[rgba(17,25,22,0.1)]">
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5c6a64]">
              <Sun className="w-3.5 h-3.5 text-[#b45309]" />
              <span>Desk Illumination</span>
            </div>
            <div className="text-lg font-semibold text-[#111916] mt-1 font-mono tabular-nums">
              <AnimatedNumber value={room.environment.ambientLux} />{' '}
              <span className="text-xs font-normal text-[#5c6a64]">lx</span>
            </div>
            <div className="text-[11px] text-[#5c6a64] mt-0.5 tabular-nums font-mono">
              Target {room.calibration.manualParameters.targetLux} · Nat {naturalDeliveredLux} lx
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5c6a64]">
              <Thermometer className="w-3.5 h-3.5 text-[#b91c1c]" />
              <span>Thermal &amp; Comfort</span>
            </div>
            <div className="text-lg font-semibold text-[#111916] mt-1 font-mono tabular-nums">
              <AnimatedNumber value={room.environment.temperature} decimals={1} suffix="°C" />
            </div>
            <div className="text-[11px] text-[#5c6a64] mt-0.5 tabular-nums font-mono">
              <AcronymHint term="HI" /> {room.environment.heatIndex}°C · RH {room.environment.humidity}%
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5c6a64]">
              <Users className="w-3.5 h-3.5 text-[#0e6ba8]" />
              <span>Room Activity (<AcronymHint term="PIR" />)</span>
            </div>
            <div className="text-sm sm:text-[15px] font-semibold text-[#111916] mt-1 leading-snug">
              {getRoomActivityState(room)}
            </div>
            <div className="text-[11px] text-[#5c6a64] mt-0.5 truncate tabular-nums">
              Max {room.capacity} seats · Motion {room.pir.lastMotionMinutesAgo}m ago
            </div>
          </div>

          <div className="px-4 py-3 bg-gradient-to-br from-[#f6fbf8] to-[#e9f4ee]">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0b6e4f]">
              <Cpu className="w-3.5 h-3.5 text-[#0b6e4f]" />
              <span>Active Draw &amp; Envelope</span>
            </div>
            <div className="text-lg font-semibold text-[#0b1713] mt-1 font-mono tabular-nums">
              <AnimatedNumber value={room.currentPowerWatts} />{' '}
              <span className="text-xs font-normal text-[#0b6e4f]">W</span>
            </div>
            {(() => {
              const ratedW =
                room.ratedPowerWatts ??
                room.appliances.reduce((acc, a) => acc + a.powerRatingWatts, 0);
              const headroomW = Math.max(0, ratedW - room.currentPowerWatts);
              const ratedPct = ratedW > 0 ? Math.round((room.currentPowerWatts / ratedW) * 100) : 0;
              return (
                <div
                  className="text-[11px] text-[#0b6e4f] mt-0.5 font-mono font-medium tabular-nums"
                  title={`Installed Rated Max: ${ratedW}W · Available Headroom: ${headroomW}W`}
                >
                  {headroomW === 0
                    ? `100% of ${ratedW}W max`
                    : `${headroomW}W headroom · ${ratedPct}% of ${ratedW}W`}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Tab Navigation with Gliding layoutId Indicator */}
        <div className="flex items-center gap-4 px-4 sm:px-6 border-b border-[rgba(17,25,22,0.1)] text-xs font-medium bg-white overflow-x-auto whitespace-nowrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative py-3 px-1 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6e4f] rounded-t-md ${
                  isActive
                    ? 'text-[#0b1713] font-semibold'
                    : 'text-[#5c6a64] hover:text-[#111916]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#0b6e4f]' : ''}`} />
                <span>{tab.label}</span>
                {tab.id === 'controls' && hasManualOverride && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#b45309]"
                    title="Manual override active"
                  />
                )}
                {isActive && (
                  <motion.span
                    layoutId={`room-modal-tab-underline-${room.id}`}
                    transition={SPRING_SNAPPY}
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#0b6e4f]"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-[#f4f5f3]">
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
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#fffbeb] border border-[#f59e0b]/40 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#fef3c7] text-[#92400e] flex items-center justify-center shrink-0">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-[#111916] flex items-center gap-2">
                          <span>Viewer Mode</span>
                          <span className="text-[11px] font-medium text-[#b45309]">
                            · Manual Overrides Protected
                          </span>
                        </div>
                        <div className="text-[11px] text-[#5c6a64] mt-0.5">
                          Students &amp; viewers can inspect telemetry. Teacher overrides require verification.
                        </div>
                      </div>
                    </div>
                    <ActionButton
                      variant="primary"
                      size="sm"
                      onClick={() => openAuthModal()}
                      icon={<KeyRound className="w-3.5 h-3.5 text-[#34d399]" />}
                      className="self-start sm:self-auto"
                    >
                      Unlock Admin Controls
                    </ActionButton>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#eef6f2] border border-[#0b6e4f]/25 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#0b6e4f]/12 text-[#0b6e4f] flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-[#0b1713]">
                          Admin Overrides Unlocked
                        </div>
                        <div className="text-[11px] text-[#0b6e4f] mt-0.5">
                          {currentStaff.name} · {currentStaff.role}
                        </div>
                      </div>
                    </div>
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      onClick={requestLogout}
                      className="self-start sm:self-auto"
                    >
                      Logout Admin
                    </ActionButton>
                  </div>
                )}

                {/* Automation State Summary & Reset */}
                <div
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border transition-colors ${
                    hasManualOverride
                      ? isVacant
                        ? 'border-[#b45309]/40 bg-[#fffbeb]'
                        : 'border-[#b45309]/30 bg-white'
                      : isVacant
                      ? 'border-[#0b6e4f]/25 bg-white'
                      : 'border-[rgba(17,25,22,0.1)] bg-white'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[#111916]">Automation State:</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          hasManualOverride
                            ? 'text-[#b45309]'
                            : 'text-[#0b6e4f]'
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

                    <p className="text-[11px] text-[#5c6a64] mt-1 leading-relaxed">
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
                    <ActionButton
                      variant={isVacant ? 'forest' : 'soft'}
                      size="sm"
                      onClick={handleResetToAdaptive}
                      loading={isResettingAdaptive}
                      icon={<RotateCcw className="w-3.5 h-3.5" />}
                      className="self-start sm:self-auto"
                    >
                      {isResettingAdaptive
                        ? isVacant
                          ? 'Shedding loads...'
                          : 'Restoring...'
                        : isVacant
                        ? 'Resume Adaptive Control (0W Shed)'
                        : 'Resume Adaptive Control'}
                    </ActionButton>
                  )}
                </div>

                {/* Hairline Progressive-Disclosure Appliance Group Rows */}
                <div className="rounded-xl border border-[rgba(17,25,22,0.1)] bg-white divide-y divide-[rgba(17,25,22,0.08)] overflow-hidden">
                  {/* Lighting Summary */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#fafbf9] transition-colors">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-[#fffbeb] border border-[#b45309]/20 flex items-center justify-center shrink-0">
                        <Lightbulb className="w-4 h-4 text-[#b45309]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-[#111916]">
                            Lighting ({lightSummary.totalCount} Units)
                          </span>
                          <span className="text-[#c5cec9]" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${
                              lightSummary.modeStatus === 'AUTO'
                                ? 'text-[#0b6e4f]'
                                : 'text-[#b45309]'
                            }`}
                          >
                            {lightSummary.modeStatus}
                          </span>
                        </div>
                        <div className="text-xs font-mono tabular-nums text-[#5c6a64] mt-0.5">
                          {lightSummary.avgPercent}% average · {lightSummary.activeCount}/
                          {lightSummary.totalCount} active ·{' '}
                          <strong className="text-[#111916]">{lightSummary.totalWatts}W</strong>
                        </div>
                      </div>
                    </div>

                    <ActionButton
                      variant="secondary"
                      size="md"
                      onClick={() => openDrawer('lights')}
                      icon={<SlidersHorizontal className="w-3.5 h-3.5 text-[#b45309]" />}
                      trailingIcon={<ChevronRight className="w-3.5 h-3.5 text-[#5c6a64]" />}
                      className="self-start sm:self-auto"
                    >
                      Adjust Lights
                    </ActionButton>
                  </div>

                  {/* Fan Sectors Summary */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#fafbf9] transition-colors">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-[#eef6f2] border border-[#0b6e4f]/20 flex items-center justify-center shrink-0">
                        <Fan className="w-4 h-4 text-[#0b6e4f]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-[#111916]">
                            Fans ({fanSummary.totalCount} Sectors)
                          </span>
                          <span className="text-[#c5cec9]" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${
                              fanSummary.modeStatus === 'AUTO'
                                ? 'text-[#0b6e4f]'
                                : 'text-[#b45309]'
                            }`}
                          >
                            {fanSummary.modeStatus}
                          </span>
                        </div>
                        <div className="text-xs font-mono tabular-nums text-[#5c6a64] mt-0.5">
                          {fanSummary.operatingLabel} · {fanSummary.activeCount}/
                          {fanSummary.totalCount} sectors · {fanSummary.avgPercent}% avg ·{' '}
                          <strong className="text-[#111916]">{fanSummary.totalWatts}W</strong>
                        </div>
                      </div>
                    </div>

                    <ActionButton
                      variant="secondary"
                      size="md"
                      onClick={() => openDrawer('fan')}
                      icon={<SlidersHorizontal className="w-3.5 h-3.5 text-[#0b6e4f]" />}
                      trailingIcon={<ChevronRight className="w-3.5 h-3.5 text-[#5c6a64]" />}
                      className="self-start sm:self-auto"
                    >
                      Adjust Fans
                    </ActionButton>
                  </div>

                  {/* Auxiliary Summary */}
                  {auxAppliances.map((aux) => (
                    <div
                      key={aux.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#fafbf9] transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-[#eff6ff] border border-[#0e6ba8]/20 flex items-center justify-center shrink-0">
                          <Cpu className="w-4 h-4 text-[#0e6ba8]" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-[#111916] truncate">
                              {aux.name}
                            </span>
                            <span className="text-[#c5cec9]" aria-hidden="true">
                              ·
                            </span>
                            <span
                              className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${
                                aux.operatingMode === 'MANUAL' || aux.isManualOverride
                                  ? 'text-[#b45309]'
                                  : 'text-[#0b6e4f]'
                              }`}
                            >
                              {aux.operatingMode === 'MANUAL' || aux.isManualOverride
                                ? 'MANUAL'
                                : 'AUTO'}
                            </span>
                          </div>
                          <div className="text-xs font-mono tabular-nums text-[#5c6a64] mt-0.5">
                            {aux.outputPercent === 0 ? 'OFF' : `${aux.outputPercent}%`} ·{' '}
                            <strong className="text-[#111916]">{aux.currentPowerWatts}W</strong> /{' '}
                            {aux.powerRatingWatts}W
                          </div>
                        </div>
                      </div>

                      <ActionButton
                        variant="secondary"
                        size="md"
                        onClick={() => openDrawer(null)}
                        icon={<SlidersHorizontal className="w-3.5 h-3.5 text-[#0e6ba8]" />}
                        trailingIcon={<ChevronRight className="w-3.5 h-3.5 text-[#5c6a64]" />}
                        className="self-start sm:self-auto"
                      >
                        Adjust
                      </ActionButton>
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
                {/* Architectural 3-Stage Closed-Loop Signal Schematic */}
                <div className="rounded-xl border border-[rgba(17,25,22,0.12)] bg-white overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#0b1713] text-[#f4f6f4] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#34d399]">
                      <Cpu className="w-3.5 h-3.5" />
                      <span>Closed-Loop Control Schematic</span>
                    </div>
                    <span className="text-[11px] text-[#9cb0a7] font-mono tabular-nums">
                      Cycle: {room.decision.timestamp}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[rgba(17,25,22,0.09)]">
                    {/* Stage 01: Sensor Inputs */}
                    <div className="p-4 space-y-2 bg-[#fafbf9]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.1em] text-[#0b6e4f]">
                          01 · Sensor Field
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#8a9992] hidden md:block" />
                      </div>
                      <div className="text-xs font-semibold text-[#111916]">Live Node Observations</div>
                      <div className="space-y-1 text-[11px] font-mono tabular-nums text-[#4a5851] pt-1">
                        <div className="flex justify-between">
                          <span>Ext Daylight</span>
                          <strong className="text-[#111916]">{room.environment.naturalDaylightLux} lx</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Desk / HI</span>
                          <strong className="text-[#111916]">
                            {room.environment.ambientLux} lx · {room.environment.heatIndex}°C
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>PIR Motion</span>
                          <strong className="text-[#111916]">{room.pir.lastMotionMinutesAgo}m ago</strong>
                        </div>
                      </div>
                    </div>

                    {/* Stage 02: Rule Evaluation */}
                    <div className="p-4 space-y-2 bg-white">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.1em] text-[#0e6ba8]">
                          02 · Rule Solver (α / β)
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#8a9992] hidden md:block" />
                      </div>
                      <div className="text-xs font-semibold text-[#111916]">Deterministic Thresholds</div>
                      <div className="space-y-1 text-[11px] font-mono tabular-nums text-[#4a5851] pt-1">
                        <div className="flex justify-between">
                          <span>Lux Deficit</span>
                          <strong className="text-[#111916]">{artificialDeficit} lx</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Coefs (α / β)</span>
                          <strong className="text-[#111916]">
                            {alpha} / {room.calibration.learnedParameters.thermalDissipationBeta}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Grace Window</span>
                          <strong className="text-[#111916]">{graceMinutes} min</strong>
                        </div>
                      </div>
                    </div>

                    {/* Stage 03: Appliance Response */}
                    <div className="p-4 space-y-2 bg-[#f2f7f4]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.1em] text-[#0b6e4f]">
                          03 · Actuation Output
                        </span>
                        <span className="text-[10px] font-mono font-semibold text-[#0b6e4f]">
                          {hasManualOverride ? 'OVERRIDE' : 'CLOSED-LOOP'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-[#111916]">Applied Circuit Load</div>
                      <div className="space-y-1 text-[11px] font-mono tabular-nums text-[#4a5851] pt-1">
                        <div className="flex justify-between">
                          <span>Lighting Bank</span>
                          <strong className="text-[#111916]">
                            {lightSummary.avgPercent}% ({lightSummary.totalWatts}W)
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>BLDC Sectors</span>
                          <strong className="text-[#111916]">
                            {fanSummary.avgPercent}% ({fanSummary.totalWatts}W)
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Room Draw</span>
                          <strong className="text-[#0b6e4f]">{room.currentPowerWatts} W</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detailed Rule Trace Ledger */}
                <div className="rounded-xl border border-[rgba(17,25,22,0.1)] bg-white divide-y divide-[rgba(17,25,22,0.08)] overflow-hidden">
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#111916]">
                      <Lightbulb className="w-4 h-4 text-[#b45309]" />
                      <span>Daylight Harvesting &amp; Lighting Modulation</span>
                    </div>
                    <div className="text-xs text-[#313e38] pl-6 space-y-1">
                      <p>
                        <strong className="text-[#111916]">Decision:</strong> {room.decision.lightingAction}
                      </p>
                      <p className="text-[#5c6a64]">{room.decision.lightingReason}</p>
                      <div className="text-[11px] text-[#313e38] font-mono tabular-nums bg-[#f4f5f3] px-3 py-2 rounded-lg border border-[rgba(17,25,22,0.08)] mt-2">
                        Deficit = Target ({room.calibration.manualParameters.targetLux} lx) − [Ext (
                        {room.environment.naturalDaylightLux} lx) × α ({alpha})] ={' '}
                        {artificialDeficit} lx required
                      </div>
                    </div>
                  </div>

                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#111916]">
                      <Thermometer className="w-4 h-4 text-[#0e6ba8]" />
                      <span>Adaptive Thermal Index &amp; Fan Regulation</span>
                    </div>
                    <div className="text-xs text-[#313e38] pl-6 space-y-1">
                      <p>
                        <strong className="text-[#111916]">Decision:</strong> {room.decision.fanAction}
                      </p>
                      <p className="text-[#5c6a64]">{room.decision.fanReason}</p>
                      <div className="text-[11px] text-[#313e38] font-mono tabular-nums bg-[#f4f5f3] px-3 py-2 rounded-lg border border-[rgba(17,25,22,0.08)] mt-2">
                        Temp {room.environment.temperature}°C · HI {room.environment.heatIndex}°C ·
                        RH {room.environment.humidity}% · Ceiling: Speed{' '}
                        {room.calibration.manualParameters.maxFanSpeed}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#111916]">
                      <Users className="w-4 h-4 text-[#0b6e4f]" />
                      <span>PIR Presence &amp; Stillness Decay Filter</span>
                    </div>
                    <div className="text-xs text-[#313e38] pl-6 space-y-1">
                      <p>
                        <strong className="text-[#111916]">Observation:</strong> {room.pir.detectionSummary}
                      </p>
                      <p className="text-[#5c6a64]">
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
                <div className="p-4 rounded-xl border border-[#0b6e4f]/25 bg-[#eef6f2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Sparkles className="w-4 h-4 text-[#0b6e4f]" />
                      <span className="text-xs font-semibold text-[#0b1713]">
                        Multi-Day Autonomous Calibration Engine
                      </span>
                      <span className="text-[11px] font-mono text-[#0b6e4f] font-semibold">
                        · {room.calibration.isCalibrated ? 'Trained' : 'Training'} (
                        {room.calibration.dataSufficiencyPercent}%)
                      </span>
                    </div>
                    <p className="text-[11px] text-[#4a5851] mt-1">
                      Continuously correlates internal lux, solar geometry, thermal lag, and occupancy patterns.
                    </p>
                  </div>

                  <ActionButton
                    variant="forest"
                    size="sm"
                    onClick={handleRunRecalibration}
                    loading={isRecalibrating}
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                    className="self-start sm:self-auto"
                  >
                    {isRecalibrating ? 'Calibrating...' : 'Trigger Recalibration'}
                  </ActionButton>
                </div>

                <AnimatePresence>
                  {isRecalibrating && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="p-3.5 rounded-xl bg-[#0b1713] text-white text-xs font-mono space-y-1.5 overflow-hidden border border-white/10"
                    >
                      <div className="flex items-center justify-between text-[#9cb0a7]">
                        <span>STEP {calibrationStage} OF 4</span>
                        <span>IIT Kharagpur Microclimate Solver</span>
                      </div>
                      <div className="text-[#34d399] font-semibold">
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
                      className="p-3 rounded-xl bg-[#eef6f2] border border-[#0b6e4f]/30 text-[#0b1713] text-xs font-medium flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4 text-[#0b6e4f] shrink-0" />
                      <span>
                        Calibration updated successfully with validated IIT Kharagpur solar coefficients.
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-[rgba(17,25,22,0.1)] bg-white">
                    <h4 className="text-[11px] font-semibold text-[#111916] uppercase tracking-[0.08em] mb-3 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#0b6e4f]" />
                      <span>Learned Parameters</span>
                    </h4>
                    <div className="divide-y divide-[rgba(17,25,22,0.08)] text-xs">
                      <div className="flex justify-between items-center py-2.5">
                        <div>
                          <div className="font-semibold text-[#111916]">Daylight Penetration (α)</div>
                          <div className="text-[10px] text-[#5c6a64]">
                            Window-to-desk solar fraction
                          </div>
                        </div>
                        <span className="font-mono font-semibold text-[#111916] tabular-nums">
                          {alpha}
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-2.5">
                        <div>
                          <div className="font-semibold text-[#111916]">Thermal Dissipation (β)</div>
                          <div className="text-[10px] text-[#5c6a64]">
                            Natural cooling with cross ventilation
                          </div>
                        </div>
                        <span className="font-mono font-semibold text-[#111916] tabular-nums">
                          {room.calibration.learnedParameters.thermalDissipationBeta} °C/hr
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-2.5">
                        <div>
                          <div className="font-semibold text-[#111916]">Inactivity Grace Window</div>
                          <div className="text-[10px] text-[#5c6a64]">
                            Stillness tolerance during examinations
                          </div>
                        </div>
                        <span className="font-mono font-semibold text-[#111916] tabular-nums">
                          {room.calibration.learnedParameters.occupancyDecayMinutes} min
                        </span>
                      </div>

                      <div className="flex justify-between items-center py-2.5">
                        <div>
                          <div className="font-semibold text-[#111916]">Luminaire Efficiency</div>
                          <div className="text-[10px] text-[#5c6a64]">
                            Observed output per input watt
                          </div>
                        </div>
                        <span className="font-mono font-semibold text-[#111916] tabular-nums">
                          {room.calibration.learnedParameters.luminaireEfficiencyLmPerW} lm/W
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-[rgba(17,25,22,0.1)] bg-white">
                    <h4 className="text-[11px] font-semibold text-[#111916] uppercase tracking-[0.08em] mb-3 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-4 h-4 text-[#4a5851]" />
                      <span>Configured Targets &amp; Limits</span>
                    </h4>

                    <form onSubmit={handleSaveParams} className="space-y-3 text-xs">
                      <div>
                        <label className="block font-medium text-[#313e38]">
                          Room Max Occupancy (Seats)
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={400}
                          value={maxOccupancyInput}
                          onChange={(e) => setMaxOccupancyInput(Number(e.target.value))}
                          className="mt-1 w-full px-3 py-1.5 rw-input rounded-lg font-mono text-xs tabular-nums focus:outline-none"
                        />
                        <p className="text-[11px] text-[#5c6a64] mt-0.5">
                          Used by Space Intelligence as the hard seating limit.
                        </p>
                      </div>

                      <div>
                        <label className="block font-medium text-[#313e38]">
                          Target Desk Lux (<AcronymHint term="NBC 2016" />)
                        </label>
                        <input
                          type="number"
                          min={100}
                          max={800}
                          value={targetLuxInput}
                          onChange={(e) => setTargetLuxInput(Number(e.target.value))}
                          className="mt-1 w-full px-3 py-1.5 rw-input rounded-lg font-mono text-xs tabular-nums focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-[#313e38]">
                          Max Permitted Fan Speed
                        </label>
                        <select
                          value={maxFanSpeedInput}
                          onChange={(e) => setMaxFanSpeedInput(Number(e.target.value))}
                          className="mt-1 w-full px-3 py-1.5 rw-input rounded-lg text-xs focus:outline-none"
                        >
                          <option value={3}>Speed 3 (Whisper quiet)</option>
                          <option value={4}>Speed 4 (Balanced comfort)</option>
                          <option value={5}>Speed 5 (Max high velocity)</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div>
                          <div className="font-medium text-[#111916]">Auto Eco Mode</div>
                          <div className="text-[10px] text-[#5c6a64]">
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
                        <ActionButton
                          type="submit"
                          variant="primary"
                          size="md"
                          fullWidth
                        >
                          {saveSuccess ? 'Setpoints Saved' : 'Save Configured Setpoints'}
                        </ActionButton>
                      </div>
                    </form>
                  </div>
                </div>

                {/* Calibration History Log */}
                <div className="p-4 rounded-xl border border-[rgba(17,25,22,0.1)] bg-white">
                  <h4 className="text-[11px] font-semibold text-[#111916] uppercase tracking-[0.08em] mb-2 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-[#5c6a64]" />
                    <span>Recent Calibration Event Trail</span>
                  </h4>
                  {room.calibration.calibrationHistory.length === 0 ? (
                    <div className="text-[#5c6a64] text-xs py-3 text-center">
                      Baseline parameter set verified. No seasonal drift adjustments recorded today.
                    </div>
                  ) : (
                    <div className="divide-y divide-[rgba(17,25,22,0.08)]">
                      {room.calibration.calibrationHistory.map((item, idx) => (
                        <div
                          key={idx}
                          className="py-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] font-semibold text-[#111916] tabular-nums">
                                {item.timestamp}
                              </span>
                              <span className="font-mono text-[10px] text-[#5c6a64]">
                                · {item.parameter}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#4a5851] mt-0.5">
                              {item.rationale}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs font-mono tabular-nums shrink-0">
                            <span className="text-[#8a9992] line-through">{item.previousValue}</span>
                            <ArrowRight className="w-3 h-3 text-[#0b6e4f]" />
                            <span className="font-semibold text-[#0b6e4f]">{item.calibratedValue}</span>
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
        <div className="px-4 py-3 sm:px-6 bg-white border-t border-[rgba(17,25,22,0.1)] flex items-center justify-between text-xs text-[#5c6a64]">
          {(() => {
            const ratedW =
              room.ratedPowerWatts ??
              room.appliances.reduce((acc, a) => acc + a.powerRatingWatts, 0);
            const headroomW = Math.max(0, ratedW - room.currentPowerWatts);
            return (
              <div className="text-[11px] text-[#5c6a64] truncate font-mono tabular-nums">
                Tariff: ₹{settings.tariffPerKWhINR}/kWh (<AcronymHint term="WBSEDCL" />) · Rated Max: {ratedW}W · Headroom: {headroomW}W
              </div>
            );
          })()}
          <ActionButton
            variant="primary"
            size="sm"
            onClick={onClose}
          >
            Done
          </ActionButton>
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
