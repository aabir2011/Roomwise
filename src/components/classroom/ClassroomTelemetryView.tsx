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
      <div className="min-h-screen bg-app-ambient text-neutral-900 select-none pb-12">
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
            <button
              type="button"
              onClick={onNavigateHome}
              className="px-3 py-1.5 rounded-xl rw-btn-primary text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />
              <span>Campus Dashboard</span>
            </button>
          )}
        </header>

        <main className="max-w-xl mx-auto p-4 sm:p-8 mt-8">
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
                <button
                  type="button"
                  onClick={onNavigateHome}
                  className="px-4 py-2 rounded-xl rw-btn-forest text-xs font-semibold flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Return to Campus Overview</span>
                </button>
              )}
              {onSelectRoomCode && classrooms[0] && (
                <button
                  type="button"
                  onClick={() => onSelectRoomCode(classrooms[0].roomCode)}
                  className="px-4 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-semibold"
                >
                  Open {classrooms[0].roomCode} ({classrooms[0].name})
                </button>
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
  const curtailedFromRatedWatts = Math.max(0, ratedWatts - room.currentPowerWatts);
  const ratedUtilPercent =
    ratedWatts > 0 ? Math.min(100, Math.round((room.currentPowerWatts / ratedWatts) * 100)) : 0;
  const curtailedPercent = Math.max(0, 100 - ratedUtilPercent);

  const openDrawerFor = (section: 'lights' | 'fan' | null) => {
    setDrawerFocus(section);
    setDrawerOpen(true);
  };

  return (
    <div className="min-h-screen bg-app-ambient text-neutral-900 select-none pb-12">
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
            <button
              type="button"
              onClick={openPhoneQrModal}
              className="px-2.5 py-1.5 rounded-xl border border-emerald-300/90 bg-emerald-50 hover:bg-emerald-100 text-emerald-950 text-xs font-bold transition-all active:scale-[0.98] flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="Scan Computer QR Code to authorise a laptop or desktop"
            >
              <QrCode className="w-3.5 h-3.5 text-emerald-700" />
              <span>Scan PC QR</span>
            </button>
          )}

          {onNavigateHome && (
            <button
              type="button"
              onClick={onNavigateHome}
              className="px-3 py-1.5 rounded-xl rw-btn-primary text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>Campus Dashboard</span>
              <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (!isAdminUnlocked) {
                openAuthModal(() => openDrawerFor(null));
              } else {
                openDrawerFor(null);
              }
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
              isAdminUnlocked
                ? 'rw-btn-forest'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300/85 transition-colors'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {isAdminUnlocked ? `${currentStaff.name} (Controls)` : 'Teacher Override'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setQrModalRoom(room)}
            className="p-2 rounded-xl bg-white/90 hover:bg-white border border-neutral-200/85 text-neutral-700 hover:text-neutral-900 transition-colors"
            title="Display Classroom Door Placard QR"
            aria-label="QR Placard"
          >
            <QrCode className="w-4 h-4 text-emerald-700" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <motion.main
        key={room.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: ROOMWISE_EASE }}
        className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5"
      >
        {/* Classroom Identity Card */}
        <div className="p-5 sm:p-6 rounded-3xl glass-card relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 gradient-rim-emerald" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-mono text-sm font-bold bg-neutral-900 text-white px-2.5 py-0.5 rounded-lg">
                  {room.roomCode}
                </span>
                <span
                  className={`font-semibold ${
                    isOccupied ? 'text-emerald-800' : 'text-neutral-600'
                  }`}
                >
                  {getRoomActivityState(room)}
                </span>
                <span className="text-neutral-400 hidden sm:inline tabular-nums">
                  · Configured capacity {room.capacity} seats
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight mt-2">
                {room.name}
              </h1>

              <div className="flex items-center gap-2 text-xs text-neutral-600 mt-1 flex-wrap">
                <span className="font-semibold text-neutral-800">{room.building}</span>
                <span aria-hidden="true">·</span>
                <span>{room.floor}</span>
                <span aria-hidden="true">·</span>
                <span>{room.type}</span>
              </div>
            </div>

            {onSelectRoomCode && (
              <div className="self-start sm:self-auto shrink-0 bg-neutral-50/90 p-2.5 rounded-2xl border border-neutral-200/80">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">
                  Quick Room Switcher
                </label>
                <select
                  value={room.roomCode}
                  onChange={(e) => onSelectRoomCode(e.target.value)}
                  className="px-2.5 py-1.5 glass-input rounded-xl text-xs font-semibold text-[#111815]"
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

          <div className="mt-4 pt-4 border-t border-neutral-200/60 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Last Update:</span>
              <strong className="text-neutral-800">{room.decision.timestamp}</strong>
            </div>

            <div className="flex items-center gap-3 text-[11px]">
              {isAdminUnlocked && (
                <span className="text-emerald-800 font-semibold flex items-center gap-1">
                  <Shield className="w-3 h-3 text-emerald-600" />
                  <span>Authority: {currentStaff.name}</span>
                </span>
              )}
              <span>
                PIR: <span className="font-semibold text-neutral-800">{room.pir.status}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Lighting & Thermal Primary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card 1: Ambient Lighting */}
          <div className="p-5 rounded-2xl glass-card space-y-3">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span className="font-bold text-neutral-900 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Sun className="w-4 h-4 text-amber-500" />
                <span>Ambient Illumination</span>
              </span>
              <span className="font-mono text-[11px] text-amber-800 font-semibold tabular-nums">
                Target {room.calibration.manualParameters.targetLux} lx
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black font-mono text-neutral-900">
                <AnimatedNumber value={room.environment.ambientLux} />
              </span>
              <span className="text-xs font-bold text-neutral-500">lux (desk surface)</span>
            </div>

            <div className="p-3 rounded-xl bg-neutral-50/90 border border-neutral-200/70 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Daylight Contribution</span>
                <span className="font-mono font-bold text-neutral-900 tabular-nums">
                  {naturalDeliveredLux} lx (α={room.calibration.learnedParameters.daylightPenetrationAlpha})
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Artificial Deficit</span>
                <span className="font-mono font-bold text-emerald-800 tabular-nums">
                  {Math.max(0, room.calibration.manualParameters.targetLux - naturalDeliveredLux)} lx
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-neutral-200/60 gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-neutral-700 flex items-center gap-1">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>Lighting</span>
                    <span className="text-neutral-300" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        lightSummary.modeStatus === 'AUTO' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {lightSummary.modeStatus}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-neutral-800 mt-0.5 truncate">
                    {lightSummary.avgPercent}% avg · {lightSummary.activeCount}/{lightSummary.totalCount}{' '}
                    active
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openDrawerFor('lights')}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white hover:bg-neutral-100 border border-neutral-200 text-[11px] font-bold text-neutral-800 flex items-center gap-1 transition-all active:scale-[0.98]"
                >
                  <SlidersHorizontal className="w-3 h-3 text-amber-600" />
                  <span>Adjust</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] text-neutral-500 flex items-center justify-between">
              <span>Lighting Draw ({lightSummary.totalCount} units)</span>
              <span className="font-mono font-bold text-neutral-800">
                <AnimatedNumber value={lightSummary.totalWatts} suffix=" W" />
              </span>
            </div>
          </div>

          {/* Card 2: Thermal Comfort & Airflow */}
          <div className="p-5 rounded-2xl glass-card space-y-3">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span className="font-bold text-neutral-900 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Thermometer className="w-4 h-4 text-rose-500" />
                <span>Thermal State & Comfort</span>
              </span>
              <span className="font-mono text-[11px] text-rose-800 font-semibold tabular-nums">
                RH {room.environment.humidity}%
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black font-mono text-neutral-900">
                <AnimatedNumber value={room.environment.temperature} decimals={1} suffix="°C" />
              </span>
              <span className="text-xs font-semibold text-neutral-500 tabular-nums">
                (HI: <strong className="text-neutral-800 font-mono">{room.environment.heatIndex}°C</strong>)
              </span>
            </div>

            <div className="p-3 rounded-xl bg-neutral-50/90 border border-neutral-200/70 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Thermal Dissipation (β)</span>
                <span className="font-mono font-bold text-neutral-900 tabular-nums">
                  {room.calibration.learnedParameters.thermalDissipationBeta} °C/hr
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Target Range</span>
                <span className="font-mono font-semibold text-neutral-800 tabular-nums">
                  {room.calibration.manualParameters.comfortTempMin}°C –{' '}
                  {room.calibration.manualParameters.comfortTempMax}°C
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-neutral-200/60 gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-neutral-700 flex items-center gap-1">
                    <Fan className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Fans</span>
                    <span className="text-neutral-300" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        fanSummary.modeStatus === 'AUTO' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {fanSummary.modeStatus}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-neutral-800 mt-0.5 truncate">
                    {fanSummary.operatingLabel} · {fanSummary.activeCount}/{fanSummary.totalCount}{' '}
                    sectors · {fanSummary.avgPercent}% avg
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openDrawerFor('fan')}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white hover:bg-neutral-100 border border-neutral-200 text-[11px] font-bold text-neutral-800 flex items-center gap-1 transition-all active:scale-[0.98]"
                >
                  <SlidersHorizontal className="w-3 h-3 text-emerald-600" />
                  <span>Adjust</span>
                </button>
              </div>
            </div>

            <div className="text-[11px] text-neutral-500 flex items-center justify-between">
              <span>Fan Draw ({fanSummary.totalCount} sectors)</span>
              <span className="font-mono font-bold text-neutral-800">
                <AnimatedNumber value={fanSummary.totalWatts} suffix=" W" />
              </span>
            </div>
          </div>
        </div>

        {/* Energy Balance & Decision Summary */}
        <div className="p-5 sm:p-6 rounded-2xl glass-card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-600" />
              <h2 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                Classroom Capacity &amp; Energy Balance
              </h2>
            </div>
            <span className="text-xs font-bold text-emerald-800 tabular-nums">
              {ratedUtilPercent}% Rated Utilisation ({curtailedPercent}% curtailed vs {ratedWatts} W max)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/75">
              <div className="text-[11px] text-neutral-500">Live Active Demand</div>
              <div className="text-lg font-bold font-mono text-neutral-900 mt-0.5">
                <AnimatedNumber value={room.currentPowerWatts} />{' '}
                <span className="text-xs font-normal text-neutral-500">W</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/75">
              <div className="text-[11px] text-neutral-500">Installed Rated Max</div>
              <div className="text-lg font-bold font-mono text-neutral-900 mt-0.5 tabular-nums">
                {ratedWatts} <span className="text-xs font-normal text-neutral-500">W</span>
              </div>
              <div className="text-[10px] text-neutral-400 mt-0.5 tabular-nums">
                Pre-Retrofit Ref: {room.baselinePowerWatts} W
              </div>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50/75 border border-emerald-200/80">
              <div className="text-[11px] text-emerald-800 font-medium">Curtailed vs Rated Max</div>
              <div className="text-lg font-bold font-mono text-emerald-900 mt-0.5">
                <AnimatedNumber value={curtailedFromRatedWatts} />{' '}
                <span className="text-xs font-normal text-emerald-700">W</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-teal-50/75 border border-teal-200/80">
              <div className="text-[11px] text-teal-800 font-medium">Est. Daily Diff vs Ref</div>
              <div className="text-lg font-bold font-mono text-teal-900 mt-0.5 tabular-nums">
                {Math.max(0, room.dailyBaselineKWh - room.dailyActualKWh).toFixed(1)}{' '}
                <span className="text-xs font-normal text-teal-700">kWh</span>
              </div>
              <div className="text-[10px] text-teal-700 mt-0.5 tabular-nums">
                {roomOperatingHours.toFixed(1)} h/day room-weighted
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-neutral-50/70 border border-neutral-200/80 space-y-1.5">
            <div className="text-xs font-bold text-neutral-900 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Adaptive Closed-Loop Decision</span>
            </div>
            <p className="text-xs text-neutral-700 leading-relaxed">
              {room.decision.ruleExplanation}
            </p>
          </div>
        </div>

        {/* Role Access Notice */}
        <div className="p-4 rounded-2xl bg-neutral-100/70 border border-neutral-200/80 text-xs text-neutral-600 flex items-start gap-3">
          <Info className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-neutral-900 flex items-center gap-2">
              <span>{isAdminUnlocked ? 'Admin Session Active' : 'Student Read-Only Portal'}</span>
              {isAdminUnlocked && (
                <span className="text-[11px] text-emerald-800 font-semibold">
                  · {currentStaff.role}
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
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
