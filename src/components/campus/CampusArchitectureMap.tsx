/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Compass, Lightbulb, Fan, Users } from 'lucide-react';
import { BuildingName, Classroom } from '../../types/energy';
import { computeAppliancesRatedPowerWatts } from '../../data/roomApplianceSpecs';
import { getRoomActivityState } from '../../utils/applianceUtils';
import { ROOMWISE_EASE } from '../../utils/motion';
import { InlineActionLink } from '../common/DesignSystem';

interface CampusArchitectureMapProps {
  classrooms: Classroom[];
  onSelectRoom: (roomId: string) => void;
  onExploreBuilding?: (building: BuildingName) => void;
  lowPowerMode?: boolean;
}

interface BlockLayoutSpec {
  name: BuildingName;
  shortLabel: string;
  floorsLabel: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
}

const BLOCK_LAYOUTS: BlockLayoutSpec[] = [
  {
    name: 'G+3 Block',
    shortLabel: 'G+3 Academic & Labs',
    floorsLabel: 'Ground – 3rd Floor',
    x: 24,
    y: 22,
    w: 392,
    h: 192,
    anchorX: 416,
    anchorY: 118,
  },
  {
    name: 'New Building',
    shortLabel: 'New Building',
    floorsLabel: 'Ground – 2nd Floor',
    x: 484,
    y: 22,
    w: 392,
    h: 192,
    anchorX: 484,
    anchorY: 118,
  },
  {
    name: 'Pre-Primary Block',
    shortLabel: 'Pre-Primary Wing',
    floorsLabel: 'Ground Floor',
    x: 24,
    y: 256,
    w: 258,
    h: 148,
    anchorX: 282,
    anchorY: 312,
  },
  {
    name: 'Old Building',
    shortLabel: 'Old Heritage Wing',
    floorsLabel: 'Ground – 2nd Floor',
    x: 318,
    y: 256,
    w: 318,
    h: 148,
    anchorX: 477,
    anchorY: 256,
  },
  {
    name: 'Multipurpose Hall',
    shortLabel: 'Multipurpose Hall',
    floorsLabel: 'Auditorium',
    x: 672,
    y: 256,
    w: 204,
    h: 148,
    anchorX: 672,
    anchorY: 312,
  },
];

/**
 * Architectural campus schematic rendering all 5 physical blocks, 25 classroom nodes,
 * and live proportional energy distribution paths driven by live classroom telemetry.
 */
export const CampusArchitectureMap: React.FC<CampusArchitectureMapProps> = ({
  classrooms,
  onSelectRoom,
  onExploreBuilding,
  lowPowerMode = false,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [focusedBuilding, setFocusedBuilding] = useState<BuildingName | null>(null);

  const animateStreams = !prefersReducedMotion && !lowPowerMode;

  const blockMetrics = useMemo(() => {
    const map = new Map<
      BuildingName,
      {
        rooms: Classroom[];
        watts: number;
        ratedWatts: number;
        utilPct: number;
        occupiedCount: number;
        overrideCount: number;
      }
    >();

    for (const spec of BLOCK_LAYOUTS) {
      const rooms = classrooms.filter((r) => r.building === spec.name);
      const watts = rooms.reduce((sum, r) => sum + r.currentPowerWatts, 0);
      const ratedWatts = rooms.reduce(
        (sum, r) => sum + (r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances)),
        0
      );
      const utilPct = ratedWatts > 0 ? Math.min(100, Math.round((watts / ratedWatts) * 100)) : 0;
      const occupiedCount = rooms.filter((r) => r.occupancyStatus === 'Occupied').length;
      const overrideCount = rooms.filter((r) =>
        r.appliances.some((a) => a.isManualOverride || a.operatingMode === 'MANUAL')
      ).length;
      map.set(spec.name, { rooms, watts, ratedWatts, utilPct, occupiedCount, overrideCount });
    }
    return map;
  }, [classrooms]);

  const hoveredRoom = useMemo(
    () => classrooms.find((c) => c.id === hoveredRoomId) || null,
    [classrooms, hoveredRoomId]
  );

  const totalLiveWatts = useMemo(
    () => classrooms.reduce((sum, r) => sum + r.currentPowerWatts, 0),
    [classrooms]
  );

  return (
    <section
      aria-label="Live Campus Architectural Energy Flow Schematic"
      className="rw-surface rounded-2xl overflow-hidden"
    >
      {/* Top Map Toolbar */}
      <div className="px-5 py-4 border-b border-neutral-200/75 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#fafbfb]">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#111815]">
            <span>Campus Energy Topology · 5 Buildings, 25 Nodes</span>
          </div>
          <p className="text-[11px] text-[#64726b] mt-0.5">
            Proportional distribution bus scaled by live node wattage. Select any room to open telemetry &amp; controls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#4a5851] shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
            <span>Active Load</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
            <span>Manual Override</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-neutral-200 border border-neutral-300 inline-block" />
            <span>Zero-Draw Shed</span>
          </span>
        </div>
      </div>

      {/* Interactive Architectural Schematic SVG */}
      <div className="p-3 sm:p-5 bg-gradient-to-b from-[#fafbfb] to-[#f3f5f4]/60">
        <div className="w-full overflow-x-auto">
          <svg
            viewBox="0 0 900 426"
            className="w-full min-w-[660px] h-auto block select-none"
            role="img"
            aria-label="Interactive architectural floorplan of DAV Model School IIT Kharagpur campus blocks and live electrical distribution bus"
          >
            <defs>
              <pattern id="rw-arch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M 24 0 L 0 0 0 24"
                  fill="none"
                  stroke="rgba(17, 24, 21, 0.038)"
                  strokeWidth="1"
                />
              </pattern>
              <linearGradient id="rw-breezeway-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(13, 148, 136, 0.06)" />
                <stop offset="50%" stopColor="rgba(16, 185, 129, 0.14)" />
                <stop offset="100%" stopColor="rgba(13, 148, 136, 0.06)" />
              </linearGradient>
              <radialGradient id="rw-hub-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(16, 185, 129, 0.25)" />
                <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
              </radialGradient>
            </defs>

            {/* Architectural Drafting Grid */}
            <rect x="0" y="0" width="900" height="426" rx="14" fill="url(#rw-arch-grid)" />

            {/* Passive Ventilation Breezeway (between G+3 Block & New Building) */}
            <rect
              x="420"
              y="30"
              width="60"
              height="176"
              rx="8"
              fill="url(#rw-breezeway-grad)"
              stroke="rgba(13, 148, 136, 0.22)"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            <text
              x="450"
              y="108"
              textAnchor="middle"
              fill="#0f766e"
              fontSize="8.5"
              fontWeight="600"
              letterSpacing="0.06em"
              transform="rotate(-90 450 108)"
            >
              PASSIVE BREEZEWAY · 1.4 m/s
            </text>

            {/* Main Campus Electrical Distribution Conduit Spine */}
            <g aria-hidden="true">
              {BLOCK_LAYOUTS.map((spec) => {
                const metrics = blockMetrics.get(spec.name);
                const utilRatio = metrics ? metrics.utilPct / 100 : 0;
                const isActive = (metrics?.watts || 0) > 0;
                const hubX = 450;
                const hubY = 232;
                const d =
                  spec.name === 'Old Building'
                    ? `M ${hubX} ${hubY} L ${spec.anchorX} ${spec.anchorY}`
                    : `M ${hubX} ${hubY} L ${hubX} ${spec.anchorY} L ${spec.anchorX} ${spec.anchorY}`;
                const strokeW = isActive ? Math.max(1.75, 1.5 + utilRatio * 3.2) : 1.25;

                return (
                  <g key={`conduit-${spec.name}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke="rgba(17, 24, 21, 0.10)"
                      strokeWidth={strokeW + 1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={isActive ? '#059669' : 'rgba(17, 24, 21, 0.16)'}
                      strokeWidth={strokeW}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={isActive ? 0.65 + utilRatio * 0.35 : 0.6}
                    />
                    {animateStreams && isActive && (
                      <path
                        d={d}
                        fill="none"
                        stroke="#a7f3d0"
                        strokeWidth={Math.max(1.5, strokeW * 0.7)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="rw-flow-stream"
                        style={{
                          animationDuration: `${Math.max(1.1, 2.8 - utilRatio * 1.4).toFixed(2)}s`,
                        }}
                      />
                    )}
                  </g>
                );
              })}

              {/* Central Campus Substation / Telemetry Hub */}
              <circle cx="450" cy="232" r="24" fill="url(#rw-hub-glow)" />
              <rect
                x="414"
                y="218"
                width="72"
                height="28"
                rx="14"
                fill="#0b2e22"
                stroke="rgba(167, 243, 208, 0.45)"
                strokeWidth="1"
              />
              <text
                x="450"
                y="235"
                textAnchor="middle"
                fill="#ecfdf5"
                fontSize="10"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {(totalLiveWatts / 1000).toFixed(2)} kW
              </text>
            </g>

            {/* 5 Architectural Building Blocks + Interactive Room Footprints */}
            {BLOCK_LAYOUTS.map((spec) => {
              const metrics = blockMetrics.get(spec.name);
              const rooms = metrics?.rooms || [];
              const cols = spec.name === 'Multipurpose Hall' ? 1 : spec.name === 'Pre-Primary Block' ? 3 : 3;
              const padX = 14;
              const headerH = 44;
              const footerH = 14;
              const innerW = spec.w - padX * 2;
              const innerH = spec.h - headerH - footerH;
              const rows = Math.max(1, Math.ceil(rooms.length / cols));
              const gap = 7;
              const cellW = (innerW - gap * (cols - 1)) / cols;
              const cellH = (innerH - gap * (rows - 1)) / rows;
              const isFocused = focusedBuilding === spec.name;

              return (
                <g
                  key={spec.name}
                  onMouseEnter={() => setFocusedBuilding(spec.name)}
                  onMouseLeave={() => setFocusedBuilding(null)}
                >
                  {/* Building Footprint */}
                  <rect
                    x={spec.x}
                    y={spec.y}
                    width={spec.w}
                    height={spec.h}
                    rx="14"
                    fill="#ffffff"
                    stroke={isFocused ? 'rgba(5, 150, 105, 0.5)' : 'rgba(17, 24, 21, 0.11)'}
                    strokeWidth={isFocused ? '1.5' : '1'}
                  />

                  {/* Building Header */}
                  <text
                    x={spec.x + 16}
                    y={spec.y + 22}
                    fill="#111815"
                    fontSize="11.5"
                    fontWeight="700"
                  >
                    {spec.shortLabel}
                  </text>
                  <text
                    x={spec.x + 16}
                    y={spec.y + 35}
                    fill="#64726b"
                    fontSize="9.5"
                    fontWeight="500"
                  >
                    {spec.floorsLabel} · {metrics?.occupiedCount || 0}/{rooms.length} motion
                  </text>

                  {/* Building Power Summary Right */}
                  <text
                    x={spec.x + spec.w - 16}
                    y={spec.y + 22}
                    textAnchor="end"
                    fill="#065f46"
                    fontSize="11"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {((metrics?.watts || 0) / 1000).toFixed(2)} kW
                  </text>
                  <text
                    x={spec.x + spec.w - 16}
                    y={spec.y + 35}
                    textAnchor="end"
                    fill="#64726b"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    /{((metrics?.ratedWatts || 0) / 1000).toFixed(2)} max ({metrics?.utilPct || 0}%)
                  </text>

                  {/* Classroom Node Cells */}
                  {rooms.map((room, idx) => {
                    const col = idx % cols;
                    const row = Math.floor(idx / cols);
                    const rx = spec.x + padX + col * (cellW + gap);
                    const ry = spec.y + headerH + row * (cellH + gap);
                    const isOccupied = room.occupancyStatus === 'Occupied';
                    const hasOverride = room.appliances.some(
                      (a) => a.isManualOverride || a.operatingMode === 'MANUAL'
                    );
                    const isActivePower = room.currentPowerWatts > 0;
                    const isHovered = hoveredRoomId === room.id;

                    const fill = hasOverride
                      ? isHovered
                        ? 'rgba(254, 243, 199, 0.95)'
                        : 'rgba(255, 251, 235, 0.95)'
                      : isOccupied && isActivePower
                      ? isHovered
                        ? 'rgba(209, 250, 229, 0.88)'
                        : 'rgba(236, 253, 245, 0.85)'
                      : isActivePower
                      ? 'rgba(240, 253, 244, 0.7)'
                      : isHovered
                      ? '#f3f5f4'
                      : '#fafbfb';

                    const stroke = isHovered
                      ? '#059669'
                      : hasOverride
                      ? 'rgba(217, 119, 6, 0.55)'
                      : isOccupied
                      ? 'rgba(5, 150, 105, 0.42)'
                      : 'rgba(17, 24, 21, 0.10)';

                    return (
                      <g
                        key={room.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${room.roomCode} ${room.name}, ${room.currentPowerWatts} watts, ${getRoomActivityState(room)}`}
                        onClick={() => onSelectRoom(room.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectRoom(room.id);
                          }
                        }}
                        onMouseEnter={() => setHoveredRoomId(room.id)}
                        onMouseLeave={() => setHoveredRoomId(null)}
                        className="cursor-pointer focus:outline-none"
                      >
                        <rect
                          x={rx}
                          y={ry}
                          width={cellW}
                          height={cellH}
                          rx="8"
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={isHovered ? '1.5' : '1'}
                        />

                        {/* Top-left code */}
                        <text
                          x={rx + 8}
                          y={ry + 16}
                          fill="#111815"
                          fontSize="9.5"
                          fontWeight="700"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {room.roomCode}
                        </text>

                        {/* Occupancy / Override tiny architectural indicator */}
                        <rect
                          x={rx + cellW - 14}
                          y={ry + 9}
                          width="6"
                          height="6"
                          rx="3"
                          fill={
                            hasOverride
                              ? '#d97706'
                              : isOccupied
                              ? '#059669'
                              : '#cbd5e1'
                          }
                        />

                        {/* Room short name & watts */}
                        {cellH >= 48 ? (
                          <>
                            <text
                              x={rx + 8}
                              y={ry + 31}
                              fill="#4a5851"
                              fontSize="9"
                              fontWeight="500"
                            >
                              {room.name.length > 15 ? `${room.name.slice(0, 14)}…` : room.name}
                            </text>
                            <text
                              x={rx + 8}
                              y={ry + cellH - 8}
                              fill={isActivePower ? '#065f46' : '#64726b'}
                              fontSize="9"
                              fontWeight="700"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {room.currentPowerWatts}W · {room.environment.ambientLux}lx
                            </text>
                          </>
                        ) : (
                          <>
                            <text
                              x={rx + 8}
                              y={ry + cellH - 8}
                              fill={isActivePower ? '#065f46' : '#64726b'}
                              fontSize="9"
                              fontWeight="700"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {room.currentPowerWatts}W · {room.environment.ambientLux}lx
                            </text>
                          </>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Contextual Bottom Readout Strip — displays live hovered room or campus overview */}
      <div className="px-5 py-3 border-t border-neutral-200/75 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        {hoveredRoom ? (
          <motion.div
            key={hoveredRoom.id}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: ROOMWISE_EASE }}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[#111815]"
          >
            <span className="font-mono font-bold text-emerald-900">{hoveredRoom.roomCode}</span>
            <span className="font-semibold">{hoveredRoom.name}</span>
            <span className="text-[#64726b]">{hoveredRoom.building} · {hoveredRoom.floor}</span>
            <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[#4a5851]">
              <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
              {hoveredRoom.environment.ambientLux} lx
            </span>
            <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[#4a5851]">
              <Fan className="w-3.5 h-3.5 text-emerald-700" />
              {hoveredRoom.environment.temperature}°C
            </span>
            <span className="inline-flex items-center gap-1 text-[#4a5851]">
              <Users className="w-3.5 h-3.5 text-neutral-500" />
              {getRoomActivityState(hoveredRoom)}
            </span>
            <span className="font-mono font-bold text-emerald-800 tabular-nums">
              {hoveredRoom.currentPowerWatts} W active
            </span>
          </motion.div>
        ) : (
          <div className="flex items-center gap-2 text-[#4a5851]">
            <Compass className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>
              Hover any classroom footprint to preview photometrics &amp; wattage, or click to inspect controls.
            </span>
          </div>
        )}

        {onExploreBuilding && (
          <InlineActionLink
            onClick={() => onExploreBuilding(focusedBuilding || 'G+3 Block')}
            trailingIcon={<ArrowUpRight className="w-3.5 h-3.5" />}
          >
            Open Digital Twin
          </InlineActionLink>
        )}
      </div>
    </section>
  );
};
