/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Sun,
  Thermometer,
  Lightbulb,
  Fan,
  Zap,
  Shield,
  Clock,
  QrCode,
  Info,
  CheckCircle2,
  ExternalLink,
  SlidersHorizontal,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth } from '../../context/AuthContext';
import { useDeviceClassification } from '../../utils/deviceDetection';
import { RoomwiseLogo } from '../common/RoomwiseLogo';
import { getRoomActivityState, summarizeApplianceGroup } from '../../utils/applianceUtils';
import {
  computeAppliancesRatedPowerWatts,
  getRoomOperatingProfile,
} from '../../data/roomApplianceSpecs';
import { ApplianceControlDrawer } from '../classrooms/ApplianceControlDrawer';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { AcronymHint } from '../common/AcronymHint';
import { AmbientBackdrop } from '../common/AmbientBackdrop';
import { ActionButton, IconButton } from '../common/DesignSystem';
import { ROOMWISE_EASE } from '../../utils/motion';

interface Props {
  roomCode: string;
  onNavigateHome?: () => void;
  onSelectRoomCode?: (code: string) => void;
}

export const ClassroomTelemetryView: React.FC<Props> = ({
  roomCode,
  onNavigateHome,
  onSelectRoomCode,
}) => {
  const { classrooms, setQrModalRoom, currentStaff } = useEnergy();
  const { isAdminUnlocked, openAuthModal, openPhoneQrModal } = useAuth();
  const device = useDeviceClassification();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFocus, setDrawerFocus] = useState<'lights' | 'fan' | null>(null);

  const normalizedCode = roomCode.trim().toLowerCase();
  const room = useMemo(() => {
    if (!normalizedCode) return null;
    return (
      classrooms.find(
        (c) =>
          c.roomCode.toLowerCase() === normalizedCode ||
          c.id.toLowerCase() === normalizedCode
      ) || null
    );
  }, [classrooms, normalizedCode]);

  const lightSummary = useMemo(
    () => (room ? summarizeApplianceGroup(room.appliances, 'lights') : null),
    [room]
  );
  const fanSummary = useMemo(
    () => (room ? summarizeApplianceGroup(room.appliances, 'fan') : null),
    [room]
  );

  if (!room || !lightSummary || !fanSummary) {
    return (
      <div className="min-h-screen bg-app-ambient relative text-neutral-900 select-none pb-12">
        <AmbientBackdrop />
        <header className="sticky top-0 z-30 glass-header px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <RoomwiseLogo size="sm" showSubtitle={false} />
            <div className="hidden sm:block border-l border-neutral-200 pl-3 min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-800 truncate">
                DAV Model School, IIT Kharagpur
              </div>
              <div className="text-xs text-neutral-500 font-medium truncate">
                Classroom Telemetry Node
              </div>
            </div>
          </div>

          {onNavigateHome && (
            <ActionButton
              variant="primary"
              size="sm"
              onClick={onNavigateHome}
              icon={<ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />}
            >
              Campus Dashboard
            </ActionButton>
          )}
        </header>

        <main className="relative z-10 max-w-xl mx-auto p-4 sm:p-8 mt-8">
          <div className="p-6 sm:p-8 rounded-3xl glass-card relative overflow-hidden space-y-5 text-center">
            <div className="absolute top-0 left-0 right-0 h-1 gradient-rim-amber" />
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h1 className="text-xl font-bold text-neutral-900">Classroom Node Not Found</h1>
              <p className="text-xs text-neutral-600 leading-relaxed">
                No monitored classroom matches the identifier{' '}
                <span className="font-mono font-bold text-neutral-900 bg-neutral-100 px-1.5 py-0.5 rounded">
                  {roomCode || '(empty)'}
                </span>
                . Check the door QR placard or select a valid classroom below.
              </p>
            </div>

            {onSelectRoomCode && classrooms.length > 0 && (
              <div className="text-left bg-neutral-50/90 p-3.5 rounded-2xl border border-neutral-200/80 space-y-1.5">
                <label
                  htmlFor="invalid-room-switcher"
                  className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500"
                >
                  Open a Monitored Classroom (25 Nodes)
                </label>
                <select
                  id="invalid-room-switcher"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) onSelectRoomCode(e.target.value);
                  }}
                  className="w-full px-3 py-2 glass-input rounded-xl text-xs font-semibold text-[#111815]"
                >
                  <option value="" disabled>
                    Select classroom code...
                  </option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.roomCode}>
                      {c.roomCode} — {c.name} ({c.building})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              {onNavigateHome && (
                <ActionButton
                  variant="forest"
                  size="md"
                  onClick={onNavigateHome}
                  icon={<ArrowLeft className="w-3.5 h-3.5 text-emerald-300" />}
                >
                  Return to Campus Overview
                </ActionButton>
              )}
              {onSelectRoomCode && classrooms[0] && (
                <ActionButton
                  variant="secondary"
                  size="md"
                  onClick={() => onSelectRoomCode(classrooms[0].roomCode)}
                >
                  Open {classrooms[0].roomCode} ({classrooms[0].name})
                </ActionButton>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const isOccupied = room.occupancyStatus === 'Occupied';
  const roomOperatingHours = getRoomOperatingProfile(room.type).activeHoursPerSchoolDay;
  const naturalDeliveredLux = Math.round(
    room.environment.naturalDaylightLux * room.calibration.learnedParameters.daylightPenetrationAlpha
  );
  const ratedWatts =
    room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
  const availableHeadroomWatts = Math.max(0, ratedWatts - room.currentPowerWatts);
  const ratedUtilPercent =
    ratedWatts > 0 ? Math.min(100, Math.round((room.currentPowerWatts / ratedWatts) * 100)) : 0;
  const headroomPercent = Math.max(0, 100 - ratedUtilPercent);

  const openDrawerFor = (section: 'lights' | 'fan' | null) => {
    setDrawerFocus(section);
    setDrawerOpen(true);
  };

  return (
    <div className="min-h-screen bg-app-ambient relative text-neutral-900 select-none pb-12">
      <AmbientBackdrop />
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 glass-header px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <RoomwiseLogo size="sm" showSubtitle={false} />
          <div className="hidden sm:block border-l border-neutral-200 pl-3 min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-800 truncate">
              DAV Model School, IIT Kharagpur
            </div>
            <div className="text-xs text-neutral-500 font-medium truncate">
              Classroom Telemetry Node
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAdminUnlocked && device.isPhone && (
            <ActionButton
              variant="soft"
              size="sm"
              onClick={openPhoneQrModal}
              icon={<QrCode className="w-3.5 h-3.5" />}
              title="Scan Computer QR Code to authorise a laptop or desktop"
            >
              Scan PC QR
            </ActionButton>
          )}

          {onNavigateHome && (
            <ActionButton
              variant="primary"
              size="sm"
              onClick={onNavigateHome}
              trailingIcon={<ExternalLink className="w-3.5 h-3.5 text-emerald-400" />}
              nudgeTrailing={false}
            >
              Campus Dashboard
            </ActionButton>
          )}

          <ActionButton
            variant={isAdminUnlocked ? 'forest' : 'amber'}
            size="sm"
            onClick={() => {
              if (!isAdminUnlocked) {
                openAuthModal(() => openDrawerFor(null));
              } else {
                openDrawerFor(null);
              }
            }}
            icon={<Shield className="w-3.5 h-3.5" />}
          >
            <span className="hidden sm:inline">
              {isAdminUnlocked ? `${currentStaff.name} (Controls)` : 'Teacher Override'}
            </span>
          </ActionButton>

          <IconButton
            variant="secondary"
            size="sm"
            onClick={() => setQrModalRoom(room)}
            title="Display Classroom Door Placard QR"
            label="QR Placard"
          >
            <QrCode className="w-4 h-4 text-[#0b6e4f]" />
          </IconButton>
        </div>
      </header>

      {/* Main Container */}
      <motion.main
        key={room.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: ROOMWISE_EASE }}
        className="relative z-10 max-w-4xl mx-auto p-4 sm:p-6 space-y-5"
      >
        {/* Obsidian-Pine Classroom Identity Masthead */}
        <div className="rounded-xl rw-obsidian-panel text-[#f4f6f4] p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap text-xs">
                <span className="font-mono text-sm font-semibold bg-[#132922] text-[#34d399] border border-[#34d399]/30 px-2.5 py-0.5 rounded">
                  {room.roomCode}
                </span>
                <span
                  className={`font-semibold ${
                    isOccupied ? 'text-[#34d399]' : 'text-[#9cb0a7]'
                  }`}
                >
                  {getRoomActivityState(room)}
                </span>
                <span className="text-[#8ba097] hidden sm:inline tabular-nums">
                  · Configured capacity {room.capacity} seats
                </span>
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white tracking-tight mt-2">
                {room.name}
              </h1>

              <div className="flex items-center gap-2 text-xs text-[#9cb0a7] mt-1 flex-wrap">
                <span className="font-semibold text-[#e4ece8]">{room.building}</span>
                <span aria-hidden="true">·</span>
                <span>{room.floor}</span>
                <span aria-hidden="true">·</span>
                <span>{room.type}</span>
              </div>
            </div>

            {onSelectRoomCode && (
              <div className="self-start sm:self-auto shrink-0 bg-[#12241d] p-2.5 rounded-lg border border-white/12">
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9cb0a7] mb-1">
                  Quick Room Switcher
                </label>
                <select
                  value={room.roomCode}
                  onChange={(e) => onSelectRoomCode(e.target.value)}
                  className="px-2.5 py-1.5 bg-[#0b1713] border border-white/15 rounded-md text-xs font-medium text-white focus:outline-none focus:border-[#34d399]"
                >
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.roomCode}>
                      {c.roomCode} — {c.name} ({c.building})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-[#9cb0a7]">
            <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
              <Clock className="w-3.5 h-3.5 text-[#34d399]" />
              <span>Last Update:</span>
              <strong className="text-white">{room.decision.timestamp}</strong>
            </div>

            <div className="flex items-center gap-3 text-[11px]">
              {isAdminUnlocked && (
                <span className="text-[#34d399] font-semibold flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  <span>Authority: {currentStaff.name}</span>
                </span>
              )}
              <span>
                PIR: <span className="font-semibold text-white">{room.pir.status}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Lighting & Thermal Primary Architectural Sheets */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card 1: Ambient Lighting */}
          <div className="p-5 rounded-xl bg-white border border-[rgba(17,25,22,0.1)] space-y-3">
            <div className="flex items-center justify-between text-xs text-[#5c6a64]">
              <span className="font-semibold text-[#111916] flex items-center gap-1.5 uppercase tracking-[0.08em] text-[10.5px]">
                <Sun className="w-4 h-4 text-[#b45309]" />
                <span>Ambient Illumination</span>
              </span>
              <span className="font-mono text-[11px] text-[#b45309] font-semibold tabular-nums">
                Target {room.calibration.manualParameters.targetLux} lx
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold font-mono text-[#111916] tabular-nums">
                <AnimatedNumber value={room.environment.ambientLux} />
              </span>
              <span className="text-xs font-medium text-[#5c6a64]">lux (desk surface)</span>
            </div>

            <div className="p-3 rounded-lg bg-[#fafbf9] border border-[rgba(17,25,22,0.08)] space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[#5c6a64]">Daylight Contribution</span>
                <span className="font-mono font-semibold text-[#111916] tabular-nums">
                  {naturalDeliveredLux} lx (α={room.calibration.learnedParameters.daylightPenetrationAlpha})
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#5c6a64]">Artificial Deficit</span>
                <span className="font-mono font-semibold text-[#0b6e4f] tabular-nums">
                  {Math.max(0, room.calibration.manualParameters.targetLux - naturalDeliveredLux)} lx
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-[rgba(17,25,22,0.08)] gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-[#313e38] flex items-center gap-1">
                    <Lightbulb className="w-3.5 h-3.5 text-[#b45309] shrink-0" />
                    <span>Lighting</span>
                    <span className="text-[#c5cec9]" aria-hidden="true">·</span>
                    <span
                      className={`text-[10px] font-mono font-semibold uppercase ${
                        lightSummary.modeStatus === 'AUTO' ? 'text-[#0b6e4f]' : 'text-[#b45309]'
                      }`}
                    >
                      {lightSummary.modeStatus}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#313e38] mt-0.5 truncate">
                    {lightSummary.avgPercent}% avg · {lightSummary.activeCount}/{lightSummary.totalCount}{' '}
                    active
                  </div>
                </div>
                <ActionButton
                  variant="secondary"
                  size="xs"
                  onClick={() => openDrawerFor('lights')}
                  icon={<SlidersHorizontal className="w-3 h-3 text-[#b45309]" />}
                >
                  Adjust
                </ActionButton>
              </div>
            </div>

            <div className="text-[11px] text-[#5c6a64] flex items-center justify-between">
              <span>Lighting Draw ({lightSummary.totalCount} units)</span>
              <span className="font-mono font-semibold text-[#111916]">
                <AnimatedNumber value={lightSummary.totalWatts} suffix=" W" />
              </span>
            </div>
          </div>

          {/* Card 2: Thermal Comfort & Airflow */}
          <div className="p-5 rounded-xl bg-white border border-[rgba(17,25,22,0.1)] space-y-3">
            <div className="flex items-center justify-between text-xs text-[#5c6a64]">
              <span className="font-semibold text-[#111916] flex items-center gap-1.5 uppercase tracking-[0.08em] text-[10.5px]">
                <Thermometer className="w-4 h-4 text-[#b91c1c]" />
                <span>Thermal State &amp; Comfort</span>
              </span>
              <span className="font-mono text-[11px] text-[#b91c1c] font-semibold tabular-nums">
                RH {room.environment.humidity}%
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold font-mono text-[#111916] tabular-nums">
                <AnimatedNumber value={room.environment.temperature} decimals={1} suffix="°C" />
              </span>
              <span className="text-xs font-medium text-[#5c6a64] tabular-nums">
                (<AcronymHint term="HI" />: <strong className="text-[#111916] font-mono">{room.environment.heatIndex}°C</strong>)
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#fafbf9] border border-[rgba(17,25,22,0.08)] space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[#5c6a64]">Thermal Dissipation (β)</span>
                <span className="font-mono font-semibold text-[#111916] tabular-nums">
                  {room.calibration.learnedParameters.thermalDissipationBeta} °C/hr
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#5c6a64]">Target Range</span>
                <span className="font-mono font-semibold text-[#111916] tabular-nums">
                  {room.calibration.manualParameters.comfortTempMin}°C –{' '}
                  {room.calibration.manualParameters.comfortTempMax}°C
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-[rgba(17,25,22,0.08)] gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-[#313e38] flex items-center gap-1">
                    <Fan className="w-3.5 h-3.5 text-[#0b6e4f] shrink-0" />
                    <span>Fans</span>
                    <span className="text-[#c5cec9]" aria-hidden="true">·</span>
                    <span
                      className={`text-[10px] font-mono font-semibold uppercase ${
                        fanSummary.modeStatus === 'AUTO' ? 'text-[#0b6e4f]' : 'text-[#b45309]'
                      }`}
                    >
                      {fanSummary.modeStatus}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#313e38] mt-0.5 truncate">
                    {fanSummary.operatingLabel} · {fanSummary.activeCount}/{fanSummary.totalCount}{' '}
                    sectors · {fanSummary.avgPercent}% avg
                  </div>
                </div>
                <ActionButton
                  variant="secondary"
                  size="xs"
                  onClick={() => openDrawerFor('fan')}
                  icon={<SlidersHorizontal className="w-3 h-3 text-[#0b6e4f]" />}
                >
                  Adjust
                </ActionButton>
              </div>
            </div>

            <div className="text-[11px] text-[#5c6a64] flex items-center justify-between">
              <span>Fan Draw ({fanSummary.totalCount} sectors)</span>
              <span className="font-mono font-semibold text-[#111916]">
                <AnimatedNumber value={fanSummary.totalWatts} suffix=" W" />
              </span>
            </div>
          </div>
        </div>

        {/* Hairline Energy Balance & Decision Summary */}
        <div className="rounded-xl bg-white border border-[rgba(17,25,22,0.1)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(17,25,22,0.08)] flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#0b6e4f]" />
              <h2 className="text-[11px] font-semibold text-[#111916] uppercase tracking-[0.08em]">
                Classroom Capacity &amp; Energy Balance
              </h2>
            </div>
            <span className="text-xs font-mono font-semibold text-[#0b6e4f] tabular-nums">
              {ratedUtilPercent}% Rated Utilisation ({headroomPercent}% headroom below {ratedWatts} W max)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[rgba(17,25,22,0.08)] text-xs">
            <div className="p-4">
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-[#5c6a64]">Live Active Demand</div>
              <div className="text-lg font-semibold font-mono text-[#111916] mt-1 tabular-nums">
                <AnimatedNumber value={room.currentPowerWatts} />{' '}
                <span className="text-xs font-normal text-[#5c6a64]">W</span>
              </div>
            </div>

            <div className="p-4">
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-[#5c6a64]">Installed Rated Max</div>
              <div className="text-lg font-semibold font-mono text-[#111916] mt-1 tabular-nums">
                {ratedWatts} <span className="text-xs font-normal text-[#5c6a64]">W</span>
              </div>
              <div className="text-[11px] text-[#5c6a64] mt-0.5 tabular-nums">
                100% Connected Ceiling
              </div>
            </div>

            <div className="p-4 bg-[#f2f7f4]">
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-[#0b6e4f] font-medium">Available Headroom</div>
              <div className="text-lg font-semibold font-mono text-[#0b1713] mt-1 tabular-nums">
                <AnimatedNumber value={availableHeadroomWatts} />{' '}
                <span className="text-xs font-normal text-[#0b6e4f]">W</span>
              </div>
            </div>

            <div className="p-4">
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-[#5c6a64]">Est. Daily Usage</div>
              <div className="text-lg font-semibold font-mono text-[#111916] mt-1 tabular-nums">
                {room.dailyActualKWh.toFixed(2)}{' '}
                <span className="text-xs font-normal text-[#5c6a64]">kWh</span>
              </div>
              <div className="text-[11px] text-[#5c6a64] mt-0.5 font-mono tabular-nums">
                {roomOperatingHours.toFixed(1)} h/day weighted
              </div>
            </div>
          </div>

          <div className="p-4 bg-[#fafbf9] border-t border-[rgba(17,25,22,0.08)] space-y-1.5">
            <div className="text-xs font-semibold text-[#111916] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#0b6e4f]" />
              <span>Adaptive Closed-Loop Decision</span>
            </div>
            <p className="text-xs text-[#4a5851] leading-relaxed">
              {room.decision.ruleExplanation}
            </p>
          </div>
        </div>

        {/* Role Access Notice */}
        <div className="p-4 rounded-xl bg-white border border-[rgba(17,25,22,0.1)] text-xs text-[#5c6a64] flex items-start gap-3">
          <Info className="w-4 h-4 text-[#5c6a64] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-[#111916] flex items-center gap-2">
              <span>{isAdminUnlocked ? 'Admin Session Active' : 'Student Read-Only Portal'}</span>
              {isAdminUnlocked && (
                <span className="text-[11px] text-[#0b6e4f] font-semibold">
                  · {currentStaff.role}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#5c6a64] leading-relaxed">
              {isAdminUnlocked
                ? `Authorized administrator session for ${currentStaff.name} (${currentStaff.role}, ${currentStaff.assignedBuilding}). You can adjust units, set lux targets, or restore AUTO.`
                : `Classroom lighting and BLDC ceiling fans are modulated by Roomwise based on daylighting sensors, indoor photometrics, and PIR occupancy tracking. Students have read-only access. Contact ${currentStaff.name} (${currentStaff.role}) for examination adjustments.`}
            </p>
          </div>
        </div>
      </motion.main>

      <ApplianceControlDrawer
        room={room}
        isOpen={drawerOpen}
        focusSection={drawerFocus}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
};
