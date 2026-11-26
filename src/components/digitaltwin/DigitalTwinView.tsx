/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers,
  Sun,
  Thermometer,
  Zap,
  Users,
  Sparkles,
  Compass,
  Building2,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { BuildingName, Floor } from '../../types/energy';
import { formatCapacityKW, getRoomActivityState } from '../../utils/applianceUtils';
import { computeAppliancesRatedPowerWatts } from '../../data/roomApplianceSpecs';
import { computeClassroomCanonicalMetrics } from '../../utils/canonicalEnergy';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { EmptyState, FilterChipButton, InlineActionLink, PageHeader } from '../common/DesignSystem';
import { FadeContent, SpotlightCard } from '../reactbits';
import { ROOMWISE_EASE } from '../../utils/motion';

type HeatmapMode = 'power' | 'lux' | 'thermal' | 'occupancy' | 'calibration';

const BUILDINGS_LIST: BuildingName[] = [
  'G+3 Block',
  'New Building',
  'Pre-Primary Block',
  'Old Building',
  'Multipurpose Hall',
];

const FLOORS_LIST: Floor[] = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];

const OVERLAY_LEGENDS: Record<
  HeatmapMode,
  { title: string; stops: Array<{ swatch: string; label: string }> }
> = {
  power: {
    title: 'Active Electrical Load',
    stops: [
      { swatch: 'bg-[#ecefe9] border-[#c8d0cb]', label: '0 W Standby' },
      { swatch: 'bg-[#e7f5ee] border-[#0b6e4f]/40', label: '< 220 W Eco' },
      { swatch: 'bg-[#e6f2fa] border-[#0e6ba8]/40', label: '220–450 W Nominal' },
      { swatch: 'bg-[#fef3e2] border-[#b45309]/45', label: '450+ W Peak' },
    ],
  },
  lux: {
    title: 'Desk Illuminance (lx)',
    stops: [
      { swatch: 'bg-[#f6f7f5] border-[#c8d0cb]', label: '< 250 lx Supplemental' },
      { swatch: 'bg-[#fef6e4] border-[#d97706]/40', label: '250–350 lx Target' },
      { swatch: 'bg-[#fde7b7] border-[#b45309]/50', label: '350+ lx Daylight Rich' },
    ],
  },
  thermal: {
    title: 'Indoor Temperature & Heat Index',
    stops: [
      { swatch: 'bg-[#e6f2fa] border-[#0e6ba8]/40', label: '< 26°C Cool' },
      { swatch: 'bg-[#e7f5ee] border-[#0b6e4f]/40', label: '26–28°C Comfort' },
      { swatch: 'bg-[#feece5] border-[#c2410c]/45', label: '28+°C High Thermal' },
    ],
  },
  occupancy: {
    title: 'PIR Motion Sensing',
    stops: [
      { swatch: 'bg-[#ecefe9] border-[#c8d0cb]', label: 'No Recent Motion' },
      { swatch: 'bg-[#e7f5ee] border-[#0b6e4f]/45', label: 'Motion Detected' },
    ],
  },
  calibration: {
    title: 'Sensor Data Sufficiency',
    stops: [
      { swatch: 'bg-[#fef3e2] border-[#b45309]/40', label: '< 95% Learning' },
      { swatch: 'bg-[#e6f5f3] border-[#0f766e]/40', label: '95–98% Fitted' },
      { swatch: 'bg-[#e7f5ee] border-[#0b6e4f]/45', label: '98%+ Calibrated' },
    ],
  },
};

// Spatial 2D Architectural Campus Site Footprint Blueprint Geometry
const SITE_BLOCK_RECTS: Array<{
  name: BuildingName;
  shortLabel: string;
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: string;
}> = [
  { name: 'G+3 Block', shortLabel: 'G+3 Block', x: 34, y: 26, w: 230, h: 86, orientation: 'North Academic Wing' },
  { name: 'New Building', shortLabel: 'New Building', x: 296, y: 26, w: 196, h: 86, orientation: 'East Senior Wing' },
  { name: 'Multipurpose Hall', shortLabel: 'Multipurpose Hall', x: 524, y: 26, w: 142, h: 176, orientation: 'East Assembly Hall' },
  { name: 'Old Building', shortLabel: 'Old Building', x: 34, y: 152, w: 230, h: 72, orientation: 'South Heritage Block' },
  { name: 'Pre-Primary Block', shortLabel: 'Pre-Primary', x: 296, y: 152, w: 196, h: 72, orientation: 'South-East Comfort Wing' },
];

export const DigitalTwinView: React.FC = () => {
  const { classrooms, setSelectedRoomId, settings } = useEnergy();
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingName | 'All'>('All');
  const [selectedFloor, setSelectedFloor] = useState<Floor | 'All'>('All');
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('power');

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
  const displayedDailyCostINR = displayedRooms.reduce(
    (acc, r) => acc + computeClassroomCanonicalMetrics(r, settings).dailyCostINR,
    0
  );
  const totalRegisteredSeats = displayedRooms.reduce((acc, r) => acc + r.capacity, 0);
  const roomsWithMotion = displayedRooms.filter((r) => getRoomActivityState(r) === 'Motion detected').length;
  const availableHeadroomWatts = Math.max(0, totalRated - totalPower);
  const headroomPct =
    totalRated > 0 ? Math.max(0, Math.round((availableHeadroomWatts / totalRated) * 100)) : 0;
  const ratedUtilPct =
    totalRated > 0 ? Math.min(100, Math.round((totalPower / totalRated) * 100)) : 0;

  const getRoomHeatmapStyle = (room: (typeof classrooms)[0]) => {
    switch (heatmapMode) {
      case 'power': {
        if (room.currentPowerWatts === 0)
          return 'bg-[#f1f3f0] border-[#d2d8d3] text-[#46544e]';
        if (room.currentPowerWatts < 220)
          return 'bg-[#eaf6f0] border-[#0b6e4f]/35 text-[#092e21]';
        if (room.currentPowerWatts < 450)
          return 'bg-[#eaf4fb] border-[#0e6ba8]/35 text-[#0b2f4a]';
        return 'bg-[#fef4e4] border-[#b45309]/40 text-[#4c2405]';
      }
      case 'lux': {
        const lux = room.environment.ambientLux;
        if (lux < 250) return 'bg-[#f6f7f5] border-[#cfd6d1] text-[#111916]';
        if (lux < 350) return 'bg-[#fef7e6] border-[#d97706]/35 text-[#4c2405]';
        return 'bg-[#fde9bc] border-[#b45309]/45 text-[#421f04]';
      }
      case 'thermal': {
        const temp = room.environment.temperature;
        if (temp < 26) return 'bg-[#eaf4fb] border-[#0e6ba8]/35 text-[#0b2f4a]';
        if (temp < 28) return 'bg-[#eaf6f0] border-[#0b6e4f]/35 text-[#092e21]';
        return 'bg-[#feeee7] border-[#c2410c]/40 text-[#4b1a06]';
      }
      case 'occupancy': {
        if (room.occupancyStatus === 'Unoccupied')
          return 'bg-[#f1f3f0] border-[#d2d8d3] text-[#62706a]';
        return 'bg-[#eaf6f0] border-[#0b6e4f]/40 text-[#092e21]';
      }
      case 'calibration': {
        const suf = room.calibration.dataSufficiencyPercent;
        if (suf >= 98) return 'bg-[#eaf6f0] border-[#0b6e4f]/40 text-[#092e21]';
        if (suf >= 95) return 'bg-[#e7f5f3] border-[#0f766e]/35 text-[#0c3531]';
        return 'bg-[#fef4e4] border-[#b45309]/40 text-[#4c2405]';
      }
      default:
        return 'bg-white border-[#dde2dc] text-[#111916]';
    }
  };

  const getBlockOverlaySummary = (bldg: BuildingName) => {
    const rooms = classrooms.filter((r) => r.building === bldg);
    const watts = rooms.reduce((acc, r) => acc + r.currentPowerWatts, 0);
    const rated = rooms.reduce(
      (acc, r) => acc + (r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances)),
      0
    );
    const avgLux = rooms.length
      ? Math.round(rooms.reduce((a, r) => a + r.environment.ambientLux, 0) / rooms.length)
      : 0;
    const avgTemp = rooms.length
      ? (rooms.reduce((a, r) => a + r.environment.temperature, 0) / rooms.length).toFixed(1)
      : '0.0';
    const motionCount = rooms.filter((r) => r.occupancyStatus === 'Occupied').length;
    const avgCal = rooms.length
      ? Math.round(rooms.reduce((a, r) => a + r.calibration.dataSufficiencyPercent, 0) / rooms.length)
      : 0;

    let metric = `${(watts / 1000).toFixed(2)} kW`;
    let fill = '#eaf6f0';
    let stroke = '#0b6e4f';

    if (heatmapMode === 'power') {
      const util = rated > 0 ? watts / rated : 0;
      fill = util === 0 ? '#eef1ec' : util < 0.35 ? '#e4f4ec' : util < 0.65 ? '#e3f1fa' : '#fef0d7';
      stroke = util === 0 ? '#9aa8a0' : util < 0.35 ? '#0b6e4f' : util < 0.65 ? '#0e6ba8' : '#b45309';
    } else if (heatmapMode === 'lux') {
      metric = `${avgLux} lx avg`;
      fill = avgLux < 250 ? '#f3f5f2' : avgLux < 350 ? '#fef5df' : '#fde5b2';
      stroke = avgLux < 250 ? '#8a9890' : '#b45309';
    } else if (heatmapMode === 'thermal') {
      metric = `${avgTemp}°C avg`;
      const t = Number(avgTemp);
      fill = t < 26 ? '#e3f1fa' : t < 28 ? '#e4f4ec' : '#fde7dc';
      stroke = t < 26 ? '#0e6ba8' : t < 28 ? '#0b6e4f' : '#c2410c';
    } else if (heatmapMode === 'occupancy') {
      metric = `${motionCount}/${rooms.length} motion`;
      fill = motionCount > 0 ? '#e4f4ec' : '#eef1ec';
      stroke = motionCount > 0 ? '#0b6e4f' : '#9aa8a0';
    } else {
      metric = `${avgCal}% cal`;
      fill = avgCal >= 98 ? '#e4f4ec' : avgCal >= 95 ? '#e3f4f2' : '#fef0d7';
      stroke = avgCal >= 98 ? '#0b6e4f' : avgCal >= 95 ? '#0f766e' : '#b45309';
    }

    return { roomsCount: rooms.length, metric, fill, stroke };
  };

  const getHeatmapMetricLabel = (room: (typeof classrooms)[0]) => {
    switch (heatmapMode) {
      case 'power':
        return `${room.currentPowerWatts} W`;
      case 'lux':
        return `${room.environment.ambientLux} lx · α ${room.calibration.learnedParameters.daylightPenetrationAlpha}`;
      case 'thermal':
        return `${room.environment.temperature}°C · HI ${room.environment.heatIndex}°C`;
      case 'occupancy':
        return `${getRoomActivityState(room)} · ${room.capacity} seats`;
      case 'calibration':
        return `${room.calibration.dataSufficiencyPercent}% sufficiency`;
    }
  };

  const heatmapModes: Array<{
    id: HeatmapMode;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'power', label: 'Power Draw', icon: Zap },
    { id: 'lux', label: 'Daylight & Lux', icon: Sun },
    { id: 'thermal', label: 'Thermal & HI', icon: Thermometer },
    { id: 'occupancy', label: 'PIR Activity', icon: Users },
    { id: 'calibration', label: 'Calibration α/β', icon: Sparkles },
  ];

  const activeLegend = OVERLAY_LEGENDS[heatmapMode];

  return (
    <div className="px-4 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-7 lg:pb-10 space-y-5 sm:space-y-6 max-w-[1440px] mx-auto">
      {/* Atlas Header */}
      <PageHeader
        kicker={
          <>
            <span>2D Interactive Architectural Atlas</span>
            <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
            <span className="font-mono text-[#62706a]">22.3121°N, 87.2994°E</span>
          </>
        }
        title="Campus Digital Twin"
        subtitle="Two-dimensional architectural plan and thermal-photometric overlay matrix across all five institutional blocks."
        action={
          <div className="flex items-center gap-2 text-xs text-[#46544e] font-mono tabular-nums">
            <Compass className="w-4 h-4 text-[#0b6e4f]" />
            <span>IIT Kharagpur Microclimate Grid</span>
          </div>
        }
      />

      {/* Precision Blueprint Control Console */}
      <FadeContent duration={0.18}>
        <div className="rw-surface rounded-xl divide-y divide-[#111916]/10">
          {/* Row 1: Building & Floor Elevation Controls */}
          <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex flex-nowrap md:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full pb-0.5 md:pb-0">
              <span className="text-[11px] font-medium text-[#62706a] mr-0.5 shrink-0">Block:</span>
              {(['All', ...BUILDINGS_LIST] as const).map((bldg) => {
                const count =
                  bldg === 'All'
                    ? classrooms.length
                    : classrooms.filter((r) => r.building === bldg).length;
                const isSelected = selectedBuilding === bldg;
                return (
                  <FilterChipButton
                    key={bldg}
                    active={isSelected}
                    layoutId="twin-bldg-active"
                    onClick={() => setSelectedBuilding(bldg)}
                  >
                    {bldg === 'All' ? `All (${count})` : `${bldg.replace(' Block', '').replace(' Building', '')} (${count})`}
                  </FilterChipButton>
                );
              })}
            </div>

            <div className="flex flex-nowrap md:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full pb-0.5 md:pb-0">
              <span className="text-[11px] font-medium text-[#62706a] mr-0.5 shrink-0">Level:</span>
              {(['All', ...FLOORS_LIST] as const).map((fl) => {
                const isSelected = selectedFloor === fl;
                return (
                  <FilterChipButton
                    key={fl}
                    active={isSelected}
                    layoutId="twin-floor-active"
                    tone="forest"
                    onClick={() => setSelectedFloor(fl)}
                  >
                    {fl === 'All' ? 'All' : fl.replace(' Floor', '')}
                  </FilterChipButton>
                );
              })}
            </div>
          </div>

          {/* Row 2: Overlay Layer Selector + Dynamic Scale Legend */}
          <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 sm:gap-3 bg-[#f8f9f7] rounded-b-xl">
            <div className="flex flex-nowrap lg:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full pb-0.5 lg:pb-0">
              <span className="text-[11px] font-medium text-[#46544e] mr-0.5 flex items-center gap-1.5 shrink-0">
                <Layers className="w-3.5 h-3.5 text-[#0b6e4f]" />
                <span>Overlay:</span>
              </span>
              {heatmapModes.map((mode) => {
                const Icon = mode.icon;
                const isSelected = heatmapMode === mode.id;
                return (
                  <FilterChipButton
                    key={mode.id}
                    active={isSelected}
                    layoutId="twin-heatmap-active"
                    onClick={() => setHeatmapMode(mode.id)}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{mode.label}</span>
                  </FilterChipButton>
                );
              })}
            </div>

            {/* Active Overlay Quantitative Legend */}
            <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1 text-[10.5px] sm:text-[11px] text-[#46544e]">
              {activeLegend.stops.map((stop) => (
                <span key={stop.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-[3px] border ${stop.swatch}`} />
                  <span>{stop.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </FadeContent>

      {/* Main Blueprint Stage (9 Cols) + Architectural Telemetry Sheet (3 Cols) */}
      <FadeContent delay={0.04} duration={0.2}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start">
          {/* Left 9 Cols: 2D Blueprint Drafting Surface */}
          <div className="lg:col-span-9 rw-blueprint-grid border border-[#111916]/12 rounded-xl overflow-hidden min-w-0">
            {/* Blueprint Title Strip */}
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-white/90 border-b border-[#111916]/10 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm sm:text-base font-bold text-[#111916]">
                    {selectedBuilding === 'All' ? 'Campus Site & Floor-Plate Plan' : selectedBuilding}
                  </h2>
                  {selectedBuilding !== 'All' && (
                    <InlineActionLink
                      onClick={() => {
                        setSelectedBuilding('All');
                        setSelectedFloor('All');
                      }}
                      icon={<RotateCcw className="w-3 h-3" />}
                    >
                      All Blocks
                    </InlineActionLink>
                  )}
                </div>
                <p className="text-[11px] text-[#62706a] font-mono tabular-nums mt-0.5">
                  {activeLegend.title} · Level: {selectedFloor} · {displayedRooms.length} visible nodes
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-[#0b6e4f] tabular-nums">
                {totalRated > 0 && totalPower >= totalRated
                  ? '100% Rated Max'
                  : `${ratedUtilPct}% Rated · ${headroomPct}% headroom`}
              </span>
            </div>

            {/* Interactive 2D Architectural Campus Site Schematic */}
            <div className="p-3 sm:p-5 border-b border-[#111916]/10 bg-white/45">
              <div className="flex items-center justify-between text-[11px] text-[#46544e] mb-2">
                <span className="font-medium truncate">
                  Interactive 2D Site Footprint — Select any block to isolate its floor plates
                </span>
                <span className="font-mono text-[#62706a] hidden sm:inline shrink-0">N ↑ · Scale Schematic</span>
              </div>

              <div className="w-full overflow-x-auto no-scrollbar">
                <svg
                  viewBox="0 0 700 246"
                  className="w-full min-w-[460px] sm:min-w-0 h-auto select-none"
                  role="img"
                  aria-label="2D architectural site schematic of the 5 DAV Model School blocks"
                >
                  {/* Courtyard & Passive Ventilation Breezeway Band */}
                  <rect
                    x="34"
                    y="120"
                    width="458"
                    height="24"
                    rx="3"
                    fill="#eaf4fb"
                    stroke="#0e6ba8"
                    strokeOpacity="0.35"
                    strokeDasharray="4 3"
                  />
                  <text
                    x="263"
                    y="135"
                    textAnchor="middle"
                    className="fill-[#0e6ba8] text-[9.5px] font-mono"
                  >
                    PASSIVE VENTILATION BREEZEWAY &amp; COURTYARD MICROCLIMATE (~1.4 m/s)
                  </text>

                  {/* North Compass Stamp */}
                  <g transform="translate(678, 224)">
                    <circle r="12" fill="#ffffff" stroke="#111916" strokeOpacity="0.18" />
                    <path d="M0,-7 L3,3 L0,1 L-3,3 Z" fill="#0b6e4f" />
                    <text y="10" textAnchor="middle" className="fill-[#111916] text-[7px] font-mono font-bold">
                      N
                    </text>
                  </g>

                  {SITE_BLOCK_RECTS.map((rect) => {
                    const info = getBlockOverlaySummary(rect.name);
                    const isFocused = selectedBuilding === rect.name;
                    const isDimmed = selectedBuilding !== 'All' && !isFocused;

                    return (
                      <g
                        key={rect.name}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isFocused}
                        aria-label={`${rect.shortLabel} (${rect.orientation}): ${info.metric}, ${info.roomsCount} nodes`}
                        onClick={() =>
                          setSelectedBuilding((prev) => (prev === rect.name ? 'All' : rect.name))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedBuilding((prev) => (prev === rect.name ? 'All' : rect.name));
                          }
                        }}
                        className="cursor-pointer group focus:outline-none focus-visible:[&_rect]:stroke-[#0b6e4f] focus-visible:[&_rect]:stroke-[2.5]"
                        style={{ opacity: isDimmed ? 0.42 : 1, transition: 'opacity 180ms ease' }}
                      >
                        <rect
                          x={rect.x}
                          y={rect.y}
                          width={rect.w}
                          height={rect.h}
                          rx="6"
                          fill={info.fill}
                          stroke={isFocused ? '#0b1713' : info.stroke}
                          strokeWidth={isFocused ? 2.4 : 1.3}
                          className="group-hover:brightness-[0.975]"
                          style={{ transition: 'fill 220ms ease, stroke 180ms ease, filter 150ms ease' }}
                        />
                        <text
                          x={rect.x + 12}
                          y={rect.y + 22}
                          className="fill-[#111916] text-[12px] font-bold"
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {rect.shortLabel}
                        </text>
                        <text
                          x={rect.x + 12}
                          y={rect.y + 37}
                          className="fill-[#46544e] text-[9.5px]"
                        >
                          {rect.orientation}
                        </text>
                        <text
                          x={rect.x + 12}
                          y={rect.y + rect.h - 14}
                          className="fill-[#0b1713] text-[11px] font-mono font-semibold"
                        >
                          {info.metric}
                        </text>
                        <text
                          x={rect.x + rect.w - 12}
                          y={rect.y + rect.h - 14}
                          textAnchor="end"
                          className="fill-[#62706a] text-[9.5px] font-mono"
                        >
                          {info.roomsCount} nodes
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* 2D Architectural Room-Plate Grid */}
            <div className="p-3.5 sm:p-5 space-y-5">
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
                  className="bg-white"
                />
              ) : (
                <AnimatePresence mode="popLayout">
                  {BUILDINGS_LIST.map((bldg) => {
                    const bldgRooms = displayedRooms.filter((r) => r.building === bldg);
                    if (bldgRooms.length === 0) return null;

                    return (
                      <motion.div
                        key={bldg}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
                        className="space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-[#111916]/12 pb-1.5">
                          <span className="font-display text-xs font-bold text-[#111916] flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-[#0b6e4f]" />
                            <span>{bldg}</span>
                          </span>
                          <span className="text-[11px] font-mono text-[#62706a] tabular-nums">
                            {bldgRooms.length} {bldgRooms.length === 1 ? 'Plate' : 'Plates'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                          {bldgRooms.map((room) => (
                            <SpotlightCard
                              key={room.id}
                              layout
                              transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
                              whileHover={{ y: -1 }}
                              whileTap={{ scale: 0.992 }}
                              spotlightColor="rgba(11, 110, 79, 0.11)"
                              spotlightRadius={200}
                              onClick={() => setSelectedRoomId(room.id)}
                              className={`p-3.5 rounded-lg border text-left transition-colors ${getRoomHeatmapStyle(
                                room
                              )}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] font-bold bg-[#0b1713] text-white px-1.5 py-0.5 rounded-[4px] whitespace-nowrap">
                                  {room.roomCode}
                                </span>
                                <span className="text-[10px] font-mono text-[#46544e] whitespace-nowrap">
                                  {room.floor}
                                </span>
                              </div>
                              <div className="font-display font-bold text-sm mt-2 truncate text-[#111916]">
                                {room.name}
                              </div>
                              <div className="mt-1.5 text-xs font-mono font-semibold tabular-nums">
                                {getHeatmapMetricLabel(room)}
                              </div>
                              <div className="mt-2.5 pt-2 border-t border-black/8 flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate opacity-80">{getRoomActivityState(room)}</span>
                                <span className="font-semibold flex items-center gap-0.5 shrink-0 whitespace-nowrap">
                                  <span>Inspect</span>
                                  <ChevronRight className="w-3 h-3" />
                                </span>
                              </div>
                            </SpotlightCard>
                          ))}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </div>

          {/* Right 3 Cols: Single-Elevation Architectural Telemetry Sheet */}
          <aside className="lg:col-span-3 rw-surface rounded-xl divide-y divide-[#111916]/10 lg:sticky lg:top-16">
            <div className="p-4">
              <h3 className="font-display text-sm font-bold text-[#111916]">
                Selection Telemetry
              </h3>
              <p className="text-[11px] text-[#62706a] mt-0.5">
                {selectedBuilding === 'All' ? 'All 5 Campus Blocks' : selectedBuilding} · {selectedFloor}
              </p>
            </div>

            <div className="p-4 space-y-1">
              <div className="text-[11px] font-medium text-[#46544e]">Filtered Electrical Demand</div>
              <div className="text-2xl font-bold font-mono text-[#111916] tabular-nums">
                <AnimatedNumber value={totalPower / 1000} decimals={2} suffix=" kW" />
              </div>
              <div className="text-[11px] font-mono text-[#62706a] tabular-nums">
                Max: {formatCapacityKW(totalRated)} kW · Free: {formatCapacityKW(availableHeadroomWatts)} kW
              </div>
            </div>

            <div className="p-4 space-y-1">
              <div className="text-[11px] font-medium text-[#46544e]">PIR Motion Activity</div>
              <div className="text-2xl font-bold font-mono text-[#111916] tabular-nums">
                <AnimatedNumber value={roomsWithMotion} suffix={` / ${displayedRooms.length}`} />
              </div>
              <div className="text-[11px] text-[#62706a] tabular-nums">
                Configured seating: {totalRegisteredSeats} seats (motion-verified)
              </div>
            </div>

            <div className="p-4 space-y-1 bg-[#f1f7f4]">
              <div className="text-[11px] font-semibold text-[#0b6e4f]">Est. Daily Operating Cost</div>
              <div className="text-2xl font-bold font-mono text-[#08543c] tabular-nums">
                <AnimatedNumber value={displayedDailyCostINR} decimals={2} prefix="₹" />
              </div>
              <div className="text-[11px] text-[#46544e]">
                Room-weighted schedule · WBSEDCL HT-2
              </div>
            </div>

            <div className="p-4 space-y-2 text-[11px] text-[#46544e] leading-relaxed">
              <div className="font-display font-bold text-xs text-[#111916]">
                Architectural Block Notes
              </div>
              <p>
                <strong className="text-[#111916]">G+3 Block</strong> houses senior secondary labs with high vertical solar exposure.{' '}
                <strong className="text-[#111916]">Pre-Primary Block</strong> enforces gentle thermal caps.{' '}
                <strong className="text-[#111916]">Multipurpose Hall</strong> runs automated vacancy shedding.
              </p>
            </div>
          </aside>
        </div>
      </FadeContent>
    </div>
  );
};
