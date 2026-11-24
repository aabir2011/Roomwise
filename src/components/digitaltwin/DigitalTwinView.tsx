/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Layers,
  Sun,
  Thermometer,
  Zap,
  Users,
  Sparkles,
  Info,
  Compass,
  Building2,
  ChevronRight,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { BuildingName, Floor } from '../../types/energy';
import { formatCapacityKW, getRoomActivityState } from '../../utils/applianceUtils';
import { computeAppliancesRatedPowerWatts } from '../../data/roomApplianceSpecs';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { EmptyState, PageHeader } from '../common/DesignSystem';
import { ROOMWISE_EASE, SPRING_SNAPPY } from '../../utils/motion';

type HeatmapMode = 'power' | 'lux' | 'thermal' | 'occupancy' | 'calibration';

export const DigitalTwinView: React.FC = () => {
  const { classrooms, setSelectedRoomId, settings } = useEnergy();
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingName | 'All'>('All');
  const [selectedFloor, setSelectedFloor] = useState<Floor | 'All'>('All');
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('power');

  const buildingsList: BuildingName[] = [
    'G+3 Block',
    'New Building',
    'Pre-Primary Block',
    'Old Building',
    'Multipurpose Hall',
  ];

  const floorsList: Floor[] = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];

  const displayedRooms = classrooms.filter((r) => {
    const matchBldg = selectedBuilding === 'All' || r.building === selectedBuilding;
    const matchFloor = selectedFloor === 'All' || r.floor === selectedFloor;
    return matchBldg && matchFloor;
  });

  const totalPower = displayedRooms.reduce((acc, r) => acc + r.currentPowerWatts, 0);
  const totalRated = displayedRooms.reduce(
    (acc, r) => acc + (r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances)),
    0
  );
  const totalBase = displayedRooms.reduce((acc, r) => acc + r.baselinePowerWatts, 0);
  const displayedDailySavedKWh = displayedRooms.reduce(
    (acc, r) => acc + Math.max(0, r.dailyBaselineKWh - r.dailyActualKWh),
    0
  );
  const totalRegisteredSeats = displayedRooms.reduce((acc, r) => acc + r.capacity, 0);
  const roomsWithMotion = displayedRooms.filter((r) => getRoomActivityState(r) === 'Motion detected').length;
  const curtailedFromRatedPct =
    totalRated > 0 ? Math.max(0, Math.round(((totalRated - totalPower) / totalRated) * 100)) : 0;
  const savingsPct = totalBase > 0 ? Math.round(((totalBase - totalPower) / totalBase) * 100) : 0;

  const getRoomHeatmapStyle = (room: (typeof classrooms)[0]) => {
    switch (heatmapMode) {
      case 'power': {
        if (room.currentPowerWatts === 0)
          return 'bg-neutral-100/90 border-neutral-200 text-neutral-600';
        if (room.currentPowerWatts < 220)
          return 'bg-emerald-50/75 border-emerald-300/90 text-emerald-950';
        if (room.currentPowerWatts < 450)
          return 'bg-sky-50/75 border-sky-300/90 text-sky-950';
        return 'bg-amber-50/80 border-amber-300/90 text-amber-950';
      }
      case 'lux': {
        const lux = room.environment.ambientLux;
        if (lux < 250) return 'bg-amber-50/45 border-amber-200 text-neutral-900';
        if (lux < 350) return 'bg-amber-50/85 border-amber-300 text-amber-950';
        return 'bg-amber-100/75 border-amber-400 text-amber-950';
      }
      case 'thermal': {
        const temp = room.environment.temperature;
        if (temp < 26) return 'bg-sky-50/75 border-sky-300 text-sky-950';
        if (temp < 28) return 'bg-emerald-50/75 border-emerald-300 text-emerald-950';
        return 'bg-orange-50/80 border-orange-300 text-orange-950';
      }
      case 'occupancy': {
        if (room.occupancyStatus === 'Unoccupied')
          return 'bg-neutral-100/90 border-neutral-200 text-neutral-500';
        return 'bg-emerald-50/85 border-emerald-300 text-emerald-950';
      }
      case 'calibration': {
        const suf = room.calibration.dataSufficiencyPercent;
        if (suf >= 98) return 'bg-emerald-50/80 border-emerald-300 text-emerald-950';
        if (suf >= 95) return 'bg-teal-50/80 border-teal-300 text-teal-950';
        return 'bg-amber-50/80 border-amber-300 text-amber-950';
      }
      default:
        return 'bg-white border-neutral-200 text-neutral-900';
    }
  };

  const getHeatmapMetricLabel = (room: (typeof classrooms)[0]) => {
    switch (heatmapMode) {
      case 'power':
        return `${room.currentPowerWatts} W`;
      case 'lux':
        return `${room.environment.ambientLux} lx (α: ${room.calibration.learnedParameters.daylightPenetrationAlpha})`;
      case 'thermal':
        return `${room.environment.temperature}°C (HI: ${room.environment.heatIndex}°C)`;
      case 'occupancy':
        return `${getRoomActivityState(room)} · Cap ${room.capacity}`;
      case 'calibration':
        return `${room.calibration.dataSufficiencyPercent}% Data Sufficiency`;
    }
  };

  const heatmapModes: Array<{
    id: HeatmapMode;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'power', label: 'Power Draw (W)', icon: Zap },
    { id: 'lux', label: 'Daylighting & Desk Lux', icon: Sun },
    { id: 'thermal', label: 'Thermal Comfort & HI', icon: Thermometer },
    { id: 'occupancy', label: 'PIR Room Activity', icon: Users },
    { id: 'calibration', label: 'Calibration Sufficiency', icon: Sparkles },
  ];

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Page Title */}
      <PageHeader
        kicker={
          <>
            <span className="whitespace-nowrap">Spatial Architectural Twin</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{settings.institutionName}</span>
          </>
        }
        title="Campus Digital Twin (5 Buildings)"
        subtitle="Architectural simulation across G+3 Block, New Building, Pre-Primary Block, Old Building, and Multipurpose Hall."
        action={
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-neutral-200/90 text-xs text-[#4a5851] whitespace-nowrap">
            <Compass className="w-3.5 h-3.5 text-emerald-700" />
            <span className="font-mono text-[11px] font-semibold text-[#111815]">
              IIT Kharagpur Microclimate Grid
            </span>
          </div>
        }
      />

      {/* Building & Floor Selectors */}
      <div className="p-4 rw-surface rounded-2xl space-y-3">
        <div>
          <div className="text-[11px] font-bold text-[#4a5851] uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-emerald-700" />
            <span>Select Campus Building</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['All', ...buildingsList] as const).map((bldg) => {
              const count =
                bldg === 'All'
                  ? classrooms.length
                  : classrooms.filter((r) => r.building === bldg).length;
              const isSelected = selectedBuilding === bldg;
              return (
                <button
                  key={bldg}
                  type="button"
                  onClick={() => setSelectedBuilding(bldg)}
                  className={`relative px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'text-white'
                      : 'bg-white/85 hover:bg-white text-[#4a5851] hover:text-[#111815] border border-neutral-200/80'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="twin-bldg-active"
                      transition={SPRING_SNAPPY}
                      className="absolute inset-0 rounded-xl bg-[#0b2e22] shadow-xs"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">
                    {bldg === 'All' ? `All 5 Buildings (${count})` : `${bldg} (${count})`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2.5 border-t border-neutral-200/70 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-[#64726b] uppercase tracking-wider mr-1">
              Floor:
            </span>
            {(['All', ...floorsList] as const).map((fl) => {
              const isSelected = selectedFloor === fl;
              return (
                <button
                  key={fl}
                  type="button"
                  onClick={() => setSelectedFloor(fl)}
                  className={`relative px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'text-white font-semibold'
                      : 'bg-white/85 text-[#4a5851] hover:text-[#111815] hover:bg-white border border-neutral-200/80'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="twin-floor-active"
                      transition={SPRING_SNAPPY}
                      className="absolute inset-0 rounded-lg bg-[#111815] shadow-2xs"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{fl === 'All' ? 'All Floors' : fl}</span>
                </button>
              );
            })}
          </div>

          <div className="text-xs text-[#64726b] font-medium tabular-nums">
            Showing <strong className="text-[#111815]">{displayedRooms.length}</strong> classrooms
          </div>
        </div>
      </div>

      {/* Heatmap Overlay Selector Bar */}
      <div className="p-3.5 rw-surface rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-bold text-[#4a5851] uppercase tracking-wider text-[11px] flex items-center gap-1.5 shrink-0">
          <Layers className="w-3.5 h-3.5 text-emerald-700" />
          <span>Heatmap Overlay</span>
        </span>

        <div className="flex flex-wrap gap-1.5">
          {heatmapModes.map((mode) => {
            const Icon = mode.icon;
            const isSelected = heatmapMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setHeatmapMode(mode.id)}
                className={`relative px-3 py-1.5 rounded-xl font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  isSelected
                    ? 'text-white'
                    : 'bg-white/85 text-[#4a5851] hover:text-[#111815] hover:bg-white border border-neutral-200/80'
                }`}
              >
                {isSelected && (
                  <motion.span
                    layoutId="twin-heatmap-active"
                    transition={SPRING_SNAPPY}
                    className="absolute inset-0 rounded-xl bg-[#0b2e22] shadow-2xs"
                    aria-hidden="true"
                  />
                )}
                <Icon className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">{mode.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Floor Plan & Room Matrix Viewport */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 sm:gap-6">
        <div className="lg:col-span-3 p-4 sm:p-6 rounded-2xl glass-card space-y-5 sm:space-y-6 min-w-0">
          <div className="flex items-center justify-between border-b border-neutral-200/80 pb-3 flex-wrap gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-neutral-900">
                {selectedBuilding === 'All' ? 'Campus-Wide Building Layout' : selectedBuilding}
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                {settings.institutionName} · Floor: {selectedFloor}
              </p>
            </div>
            <span
              className="text-xs font-mono font-bold text-emerald-800 tabular-nums whitespace-nowrap"
              title={`Estimated Pre-Retrofit Reference: ${formatCapacityKW(totalBase)} kW (${savingsPct}% vs ref)`}
            >
              {totalRated > 0 && totalPower >= totalRated
                ? '100% of Installed Rated Max'
                : `-${curtailedFromRatedPct}% vs Installed Rated Max`}
            </span>
          </div>

          {displayedRooms.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No rooms on this building / floor combination"
              description="Reset the floor filter to inspect all configured levels for this building."
              actionLabel="Show All Classrooms"
              onAction={() => {
                setSelectedBuilding('All');
                setSelectedFloor('All');
              }}
              className="border-0 shadow-none bg-transparent"
            />
          ) : (
            buildingsList.map((bldg) => {
              const bldgRooms = displayedRooms.filter((r) => r.building === bldg);
              if (bldgRooms.length === 0) return null;

              return (
                <div key={bldg} className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-neutral-800 uppercase tracking-wider border-b border-neutral-100 pb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-emerald-600" />
                      <span>{bldg}</span>
                    </span>
                    <span className="text-neutral-400 font-normal tabular-nums">
                      {bldgRooms.length} {bldgRooms.length === 1 ? 'Node' : 'Nodes'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {bldgRooms.map((room) => (
                      <motion.button
                        key={room.id}
                        type="button"
                        layout
                        transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
                        whileHover={{ y: -1.5 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => setSelectedRoomId(room.id)}
                        className={`p-4 rounded-2xl border text-left transition-colors relative ${getRoomHeatmapStyle(
                          room
                        )}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-xs font-bold bg-neutral-900/10 px-2 py-0.5 rounded-md whitespace-nowrap">
                              {room.roomCode}
                            </span>
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                room.occupancyStatus === 'Occupied'
                                  ? 'bg-emerald-600'
                                  : 'bg-neutral-400/60'
                              }`}
                              title={getRoomActivityState(room)}
                            />
                          </div>
                          <span className="text-[10px] font-semibold text-neutral-500 whitespace-nowrap shrink-0">
                            {room.floor}
                          </span>
                        </div>
                        <div className="font-bold text-sm mt-1.5 truncate text-neutral-900">
                          {room.name}
                        </div>
                        <div className="mt-2 text-xs font-mono font-bold tabular-nums">
                          {getHeatmapMetricLabel(room)}
                        </div>
                        <div className="mt-2 pt-2 border-t border-black/8 flex items-center justify-between gap-2 text-[11px] opacity-85">
                          <span className="truncate">{getRoomActivityState(room)}</span>
                          <span className="font-semibold flex items-center gap-0.5 shrink-0 whitespace-nowrap">
                            <span>Inspect</span>
                            <ChevronRight className="w-3 h-3" />
                          </span>
                        </div>
                      </motion.button>
                    ))}
                  </div>

                  {bldg === 'G+3 Block' && (
                    <div className="p-3 px-4 rounded-xl bg-sky-50/70 border border-dashed border-sky-300 flex items-center justify-between text-xs text-sky-950 my-2">
                      <div className="flex items-center gap-2 font-semibold">
                        <Compass className="w-4 h-4 text-sky-700 shrink-0" />
                        <span>Inter-Building Passive Ventilation Breezeway & Courtyard Microclimate</span>
                      </div>
                      <span className="text-[10px] text-sky-800 font-mono hidden sm:inline tabular-nums">
                        Convective Flow: ~1.4 m/s
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Telemetry Panel */}
        <div className="p-5 rounded-2xl glass-card space-y-4 h-fit">
          <div>
            <h3 className="text-sm font-bold text-neutral-900">Selection Telemetry</h3>
            <p className="text-xs text-neutral-500 mt-0.5">{settings.institutionName}</p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 bg-neutral-50/85 rounded-xl border border-neutral-200/80">
              <div className="text-neutral-500 font-medium">Filtered Electrical Demand</div>
              <div className="text-xl font-bold font-mono text-neutral-900 mt-1">
                <AnimatedNumber value={totalPower / 1000} decimals={2} suffix=" kW" />
              </div>
              <div className="text-[11px] text-neutral-400 mt-0.5 tabular-nums">
                Installed Max: {formatCapacityKW(totalRated)} kW · Pre-Retrofit Ref: {formatCapacityKW(totalBase)} kW
              </div>
            </div>

            <div className="p-3.5 bg-neutral-50/85 rounded-xl border border-neutral-200/80">
              <div className="text-neutral-500 font-medium">PIR Room Activity</div>
              <div className="text-xl font-bold font-mono text-neutral-900 mt-1">
                <AnimatedNumber value={roomsWithMotion} suffix={` / ${displayedRooms.length} Motion`} />
              </div>
              <div className="text-[11px] text-neutral-400 mt-0.5 tabular-nums">
                Configured seating: {totalRegisteredSeats} seats (PIR detects movement only)
              </div>
            </div>

            <div className="p-3.5 bg-emerald-50/75 rounded-xl border border-emerald-200/80">
              <div className="text-emerald-800 font-semibold">Est. Daily Diff vs Pre-Retrofit Ref</div>
              <div className="text-xl font-bold font-mono text-emerald-900 mt-1">
                <AnimatedNumber
                  value={displayedDailySavedKWh * settings.tariffPerKWhINR}
                  decimals={2}
                  prefix="₹"
                />
              </div>
              <div className="text-[11px] text-emerald-700 mt-0.5">
                Room-weighted schedule · WBSEDCL educational tariff
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/75 text-xs space-y-2">
            <div className="font-bold text-neutral-800 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-neutral-500" />
              <span>Campus Building Notes</span>
            </div>
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              <strong>G+3 Block</strong> houses senior secondary labs with high vertical solar exposure.{' '}
              <strong>Pre-Primary Block</strong> operates comfort caps.{' '}
              <strong>Multipurpose Hall</strong> uses automated vacancy shedding.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
