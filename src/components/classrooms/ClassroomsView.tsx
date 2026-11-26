/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  Grid,
  List,
  QrCode,
  ChevronRight,
  School,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { BuildingName, Floor } from '../../types/energy';
import { getRoomActivityState } from '../../utils/applianceUtils';
import { computeAppliancesRatedPowerWatts } from '../../data/roomApplianceSpecs';
import { ActionButton, EmptyState, IconButton, LedgerStrip, PageHeader, SegmentedControl } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';
import { FadeContent, SpotlightCard } from '../reactbits';
import { ROOMWISE_EASE } from '../../utils/motion';

const BUILDINGS_LIST: BuildingName[] = [
  'G+3 Block',
  'New Building',
  'Pre-Primary Block',
  'Old Building',
  'Multipurpose Hall',
];

const FLOORS_LIST: Floor[] = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];

export const ClassroomsView: React.FC = () => {
  const { classrooms, setSelectedRoomId, setQrModalRoom } = useEnergy();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('All');
  const [selectedFloor, setSelectedFloor] = useState<string>('All');
  const [selectedOccupancy, setSelectedOccupancy] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const filteredRooms = useMemo(() => {
    return classrooms.filter((room) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        room.name.toLowerCase().includes(q) ||
        room.roomCode.toLowerCase().includes(q) ||
        room.type.toLowerCase().includes(q);

      const matchesBuilding = selectedBuilding === 'All' || room.building === selectedBuilding;
      const matchesFloor = selectedFloor === 'All' || room.floor === selectedFloor;
      const matchesOccupancy =
        selectedOccupancy === 'All' || room.occupancyStatus === selectedOccupancy;

      return matchesSearch && matchesBuilding && matchesFloor && matchesOccupancy;
    });
  }, [classrooms, searchQuery, selectedBuilding, selectedFloor, selectedOccupancy]);

  const aggregateStats = useMemo(() => {
    const count = filteredRooms.length;
    const motionCount = filteredRooms.filter((r) => r.occupancyStatus === 'Occupied').length;
    const totalW = filteredRooms.reduce((s, r) => s + r.currentPowerWatts, 0);
    const totalRatedW = filteredRooms.reduce(
      (s, r) => s + (r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances)),
      0
    );
    const avgLux = count
      ? Math.round(filteredRooms.reduce((s, r) => s + r.environment.ambientLux, 0) / count)
      : 0;
    const avgTemp = count
      ? (filteredRooms.reduce((s, r) => s + r.environment.temperature, 0) / count).toFixed(1)
      : '0.0';
    const overrideCount = filteredRooms.filter((r) =>
      r.appliances.some((a) => a.isManualOverride)
    ).length;
    return { count, motionCount, totalW, totalRatedW, avgLux, avgTemp, overrideCount };
  }, [filteredRooms]);

  const hasActiveFilters =
    Boolean(searchQuery) ||
    selectedBuilding !== 'All' ||
    selectedFloor !== 'All' ||
    selectedOccupancy !== 'All';

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedBuilding('All');
    setSelectedFloor('All');
    setSelectedOccupancy('All');
  };

  return (
    <div className="px-4 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-7 lg:pb-10 space-y-5 sm:space-y-6 max-w-[1440px] mx-auto">
      {/* Page Header */}
      <PageHeader
        kicker={
          <>
            <span>Room Intelligence Directory</span>
            <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
            <span className="font-mono text-[#62706a]">25 Connected Nodes</span>
          </>
        }
        title="Classrooms & Laboratories"
        subtitle={
          <>
            Room-level environmental telemetry, <AcronymHint term="PIR" /> motion verification, daylight alpha calibration, and{' '}
            <AcronymHint term="BLDC" /> appliance control.
          </>
        }
        action={
          <SegmentedControl<'grid' | 'table'>
            layoutId="classrooms-view-mode"
            ariaLabel="Classroom view layout"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { id: 'grid', label: 'Dossier Grid', icon: Grid },
              { id: 'table', label: 'Data Ledger', icon: List },
            ]}
          />
        }
      />

      {/* Aggregate Telemetry Strip */}
      <FadeContent duration={0.18}>
        <LedgerStrip
          columns={4}
          items={[
            {
              label: 'Filtered Active Draw',
              value: `${(aggregateStats.totalW / 1000).toFixed(2)}`,
              unit: 'kW',
              detail: `of ${(aggregateStats.totalRatedW / 1000).toFixed(2)} kW rated ceiling`,
              highlight: true,
            },
            {
              label: 'PIR Motion Status',
              value: `${aggregateStats.motionCount} / ${aggregateStats.count}`,
              detail:
                aggregateStats.overrideCount > 0
                  ? `${aggregateStats.overrideCount} manual override active`
                  : 'All rooms in autonomous mode',
            },
            {
              label: 'Mean Desk Illuminance',
              value: `${aggregateStats.avgLux}`,
              unit: 'lx',
              detail: 'Target: 300 lx classrooms · 450 lx labs',
            },
            {
              label: 'Mean Indoor Thermal',
              value: `${aggregateStats.avgTemp}`,
              unit: '°C',
              detail: 'Calibrated with indoor Heat Index',
            },
          ]}
        />
      </FadeContent>

      {/* Precision Filter Toolbar */}
      <div className="p-3 sm:p-3.5 rw-surface rounded-xl flex flex-col lg:flex-row lg:items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-[#62706a] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter by classroom, lab, or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[38px] sm:min-h-[36px] pl-9 pr-3 py-1.5 rw-input rounded-lg text-xs"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 shrink-0">
          <select
            value={selectedBuilding}
            onChange={(e) => setSelectedBuilding(e.target.value)}
            aria-label="Filter by building"
            className="min-h-[38px] sm:min-h-[36px] px-2.5 py-1.5 rw-input rounded-lg text-xs"
          >
            <option value="All">All 5 Buildings</option>
            {BUILDINGS_LIST.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            value={selectedFloor}
            onChange={(e) => setSelectedFloor(e.target.value)}
            aria-label="Filter by floor"
            className="min-h-[38px] sm:min-h-[36px] px-2.5 py-1.5 rw-input rounded-lg text-xs"
          >
            <option value="All">All Floors</option>
            {FLOORS_LIST.map((fl) => (
              <option key={fl} value={fl}>
                {fl}
              </option>
            ))}
          </select>

          <select
            value={selectedOccupancy}
            onChange={(e) => setSelectedOccupancy(e.target.value)}
            aria-label="Filter by room activity"
            className="col-span-2 sm:col-span-1 min-h-[38px] sm:min-h-[36px] px-2.5 py-1.5 rw-input rounded-lg text-xs"
          >
            <option value="All">All Activity States</option>
            <option value="Occupied">Motion Detected</option>
            <option value="Unoccupied">No Recent Motion</option>
          </select>
        </div>

        {hasActiveFilters && (
          <ActionButton
            variant="soft"
            size="sm"
            onClick={resetFilters}
            className="self-start lg:self-auto"
          >
            Reset Filters
          </ActionButton>
        )}
      </div>

      {/* Empty State or Populated Views */}
      {filteredRooms.length === 0 ? (
        <EmptyState
          icon={School}
          title="No matching classrooms found"
          description="No classrooms or laboratories match your active search query or building filters. Reset filters to view all 25 campus nodes."
          actionLabel="Reset All Filters"
          onAction={resetFilters}
        />
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {viewMode === 'grid' ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4"
            >
              {filteredRooms.map((room) => {
                const activityState = getRoomActivityState(room);
                const isMotionDetected = activityState === 'Motion detected';
                const hasOverride = room.appliances.some((a) => a.isManualOverride);
                const ratedWatts =
                  room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
                const headroomWatts = Math.max(0, ratedWatts - room.currentPowerWatts);
                const ratedUtilPct =
                  ratedWatts > 0 ? Math.round((room.currentPowerWatts / ratedWatts) * 100) : 0;

                return (
                  <SpotlightCard
                    as="div"
                    key={room.id}
                    spotlightColor="rgba(11, 110, 79, 0.11)"
                    spotlightRadius={230}
                    className="rounded-xl rw-surface-interactive flex flex-col group min-w-0"
                    innerClassName="flex flex-col justify-between flex-1 w-full"
                  >
                    {/* Header Spec Row */}
                    <div className="p-4 pb-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[11px] flex-wrap">
                            <span className="font-mono text-[11px] font-bold bg-[#0b1713] text-white px-2 py-0.5 rounded-[4px] whitespace-nowrap">
                              {room.roomCode}
                            </span>
                            <span
                              className={`font-medium whitespace-nowrap ${
                                isMotionDetected
                                  ? 'text-[#0b6e4f]'
                                  : hasOverride
                                  ? 'text-amber-700'
                                  : 'text-[#62706a]'
                              }`}
                            >
                              {activityState}
                            </span>
                            {hasOverride && (
                              <>
                                <span aria-hidden="true" className="text-[#c8d0cb]">·</span>
                                <span className="font-semibold text-amber-700 whitespace-nowrap">
                                  Manual Override
                                </span>
                              </>
                            )}
                          </div>
                          <h3 className="font-display font-bold text-[#111916] text-[15px] mt-2 truncate">
                            {room.name}
                          </h3>
                          <p className="text-[11px] text-[#62706a] truncate tabular-nums mt-0.5">
                            {room.building} · {room.floor} · {room.capacity} seats
                          </p>
                        </div>

                        <IconButton
                          variant="secondary"
                          size="sm"
                          label={`QR placard for ${room.roomCode}`}
                          title="View classroom QR door placard"
                          onClick={() => setQrModalRoom(room)}
                        >
                          <QrCode className="w-4 h-4" />
                        </IconButton>
                      </div>
                    </div>

                    {/* Hairline 3-Column Telemetry Strip (Zero Pastel Mini-Cards) */}
                    <div className="grid grid-cols-3 divide-x divide-[#111916]/10 border-y border-[#111916]/10 bg-[#f8f9f7]">
                      <div className="px-3 py-2.5 min-w-0">
                        <div className="text-[10px] text-[#62706a] font-medium">Illuminance</div>
                        <div className="font-mono text-sm font-bold text-[#111916] mt-0.5 tabular-nums truncate">
                          {room.environment.ambientLux}{' '}
                          <span className="text-[10px] font-normal text-[#62706a]">lx</span>
                        </div>
                        <div className="text-[10px] font-mono text-[#46544e] tabular-nums truncate">
                          α {room.calibration.learnedParameters.daylightPenetrationAlpha}
                        </div>
                      </div>

                      <div className="px-3 py-2.5 min-w-0">
                        <div className="text-[10px] text-[#62706a] font-medium">Thermal</div>
                        <div className="font-mono text-sm font-bold text-[#111916] mt-0.5 tabular-nums truncate">
                          {room.environment.temperature}°C
                        </div>
                        <div className="text-[10px] font-mono text-[#46544e] tabular-nums truncate">
                          <AcronymHint term="HI" /> {room.environment.heatIndex}°C
                        </div>
                      </div>

                      <div
                        className="px-3 py-2.5 min-w-0"
                        title={`Installed Rated Max: ${ratedWatts}W · Available Headroom: ${headroomWatts}W (${ratedUtilPct}% active)`}
                      >
                        <div className="text-[10px] text-[#62706a] font-medium">Active Load</div>
                        <div className="font-mono text-sm font-bold text-[#111916] mt-0.5 tabular-nums truncate">
                          {room.currentPowerWatts}{' '}
                          <span className="text-[10px] font-normal text-[#62706a]">W</span>
                        </div>
                        <div className="text-[10px] font-mono text-[#0b6e4f] font-medium tabular-nums truncate">
                          {headroomWatts === 0 ? '100% rated' : `${headroomWatts}W free`}
                        </div>
                      </div>
                    </div>

                    {/* Rule Explanation & Inspect Footer */}
                    <div className="p-4 pt-3 flex flex-col justify-between gap-3 flex-1">
                      <div className="text-[11px] leading-snug">
                        <div className="font-semibold text-[#111916] line-clamp-1">
                          {room.decision.lightingAction}
                        </div>
                        <div className="text-[#62706a] line-clamp-1 mt-0.5">
                          {room.decision.ruleExplanation}
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-[#111916]/8 flex items-center justify-between">
                        <span className="text-[11px] font-mono text-[#62706a] tabular-nums">
                          Cal: <strong className="text-[#111916]">{room.calibration.dataSufficiencyPercent}%</strong>
                        </span>
                        <ActionButton
                          variant="primary"
                          size="sm"
                          onClick={() => setSelectedRoomId(room.id)}
                          trailingIcon={<ChevronRight className="w-3.5 h-3.5" />}
                        >
                          Inspect
                        </ActionButton>
                      </div>
                    </div>
                  </SpotlightCard>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="table"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16, ease: ROOMWISE_EASE }}
              className="rw-surface rounded-xl overflow-hidden"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[840px]">
                  <thead>
                    <tr className="bg-[#f4f6f3] border-b border-[#111916]/12 text-[#46544e] font-semibold text-[11px]">
                      <th className="py-2.5 px-4 whitespace-nowrap">Code</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Classroom</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Building &amp; Floor</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">PIR Status</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Desk Lux</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">
                        Temp / <AcronymHint term="HI" />
                      </th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Learned α</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Active</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Headroom</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#111916]/8">
                    {filteredRooms.map((room) => {
                      const activityState = getRoomActivityState(room);
                      const isMotionDetected = activityState === 'Motion detected';
                      const ratedWatts =
                        room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
                      const headroomWatts = Math.max(0, ratedWatts - room.currentPowerWatts);

                      return (
                        <tr key={room.id} className="hover:bg-[#f6f8f5] transition-colors">
                          <td className="py-2.5 px-4 font-mono font-bold text-[#111916] whitespace-nowrap">
                            {room.roomCode}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-[#111916] whitespace-nowrap">
                              {room.name}
                            </div>
                            <div className="text-[10px] font-mono text-[#62706a] tabular-nums whitespace-nowrap">
                              Cap {room.capacity} seats
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-[#46544e] whitespace-nowrap">
                            <span className="font-medium text-[#111916]">{room.building}</span>{' '}
                            <span className="text-[#62706a]">· {room.floor}</span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span
                              className={`font-medium text-[11px] ${
                                isMotionDetected ? 'text-[#0b6e4f]' : 'text-[#62706a]'
                              }`}
                            >
                              {activityState}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            {room.environment.ambientLux} lx
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            {room.environment.temperature}°C / {room.environment.heatIndex}°C
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#0b6e4f] tabular-nums whitespace-nowrap">
                            {room.calibration.learnedParameters.daylightPenetrationAlpha}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-[#111916] tabular-nums whitespace-nowrap">
                            {room.currentPowerWatts} W
                          </td>
                          <td
                            className="py-2.5 px-4 text-right font-mono font-semibold text-[#0b6e4f] tabular-nums whitespace-nowrap"
                            title={`Installed Rated Max: ${ratedWatts}W · Available Headroom: ${headroomWatts}W`}
                          >
                            {headroomWatts === 0 ? '0 W (100%)' : `${headroomWatts} W`}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <IconButton
                                variant="secondary"
                                size="xs"
                                label={`QR placard for ${room.roomCode}`}
                                title="QR Placard"
                                onClick={() => setQrModalRoom(room)}
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </IconButton>
                              <ActionButton
                                variant="primary"
                                size="xs"
                                onClick={() => setSelectedRoomId(room.id)}
                                trailingIcon={<ChevronRight className="w-3 h-3" />}
                              >
                                Inspect
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};
