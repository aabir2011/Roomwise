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
  Sun,
  Thermometer,
  Zap,
  QrCode,
  ChevronRight,
  School,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { BuildingName, Floor } from '../../types/energy';
import { getRoomActivityState } from '../../utils/applianceUtils';
import { computeAppliancesRatedPowerWatts } from '../../data/roomApplianceSpecs';
import { ROOMWISE_EASE, SPRING_SNAPPY } from '../../utils/motion';

export const ClassroomsView: React.FC = () => {
  const { classrooms, setSelectedRoomId, setQrModalRoom } = useEnergy();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('All');
  const [selectedFloor, setSelectedFloor] = useState<string>('All');
  const [selectedOccupancy, setSelectedOccupancy] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const buildingsList: BuildingName[] = [
    'G+3 Block',
    'New Building',
    'Pre-Primary Block',
    'Old Building',
    'Multipurpose Hall',
  ];

  const floorsList: Floor[] = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];

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
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-800">
            <span className="whitespace-nowrap">25 Connected Classroom Nodes</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">DAV Model School, IIT Kharagpur</span>
          </div>
          <h1 className="text-lg sm:text-2xl font-bold text-neutral-900 tracking-tight mt-0.5">
            Classrooms & Laboratories Directory
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Environmental telemetry, PIR motion tracking, and explainable lighting and BLDC fan automation.
          </p>
        </div>

        {/* View Switcher */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex items-center p-1 glass-card rounded-xl">
            {(['grid', 'table'] as const).map((mode) => {
              const Icon = mode === 'grid' ? Grid : List;
              const isSelected = viewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`relative p-1.5 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    isSelected ? 'text-white' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                  title={mode === 'grid' ? 'Card Grid View' : 'Dense Data Table'}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="classrooms-view-mode"
                      transition={SPRING_SNAPPY}
                      className="absolute inset-0 rounded-lg bg-neutral-900 shadow-2xs"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="relative z-10 w-3.5 h-3.5" />
                  <span className="relative z-10 capitalize">{mode}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-3.5 sm:p-4 glass-card rounded-2xl space-y-2.5">
        <div className="flex flex-col md:flex-row gap-2.5 text-xs">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by class (e.g. X-A, Physics, G3-G01)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[38px] pl-9 pr-3 py-2 glass-input rounded-xl text-xs focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0 md:w-auto">
            <select
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              aria-label="Filter by building"
              className="w-full min-h-[38px] px-3 py-2 glass-input rounded-xl text-xs focus:outline-none"
            >
              <option value="All">All Buildings</option>
              {buildingsList.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <select
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
              aria-label="Filter by floor"
              className="w-full min-h-[38px] px-3 py-2 glass-input rounded-xl text-xs focus:outline-none"
            >
              <option value="All">All Floors</option>
              {floorsList.map((fl) => (
                <option key={fl} value={fl}>
                  {fl}
                </option>
              ))}
            </select>

            <select
              value={selectedOccupancy}
              onChange={(e) => setSelectedOccupancy(e.target.value)}
              aria-label="Filter by room activity"
              className="w-full min-h-[38px] px-3 py-2 glass-input rounded-xl text-xs focus:outline-none"
            >
              <option value="All">All Activity States</option>
              <option value="Occupied">Motion Detected</option>
              <option value="Unoccupied">No Recent Motion</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-neutral-500 pt-1">
          <span className="tabular-nums">
            Showing <strong className="text-neutral-900">{filteredRooms.length}</strong> of{' '}
            {classrooms.length} classrooms
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-emerald-700 hover:text-emerald-900 font-semibold transition-colors"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Empty State or Populated Views */}
      {filteredRooms.length === 0 ? (
        <div className="p-10 sm:p-12 rounded-2xl glass-card text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-neutral-100 border border-neutral-200 text-neutral-500 flex items-center justify-center mx-auto">
            <School className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-neutral-900">No matching classrooms found</h3>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              No classrooms or laboratories match your active search query or building filters. Reset filters to view all 25 campus nodes.
            </p>
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold transition-all active:scale-[0.98]"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {viewMode === 'grid' ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {filteredRooms.map((room) => {
                const activityState = getRoomActivityState(room);
                const isMotionDetected = activityState === 'Motion detected';
                const hasOverride = room.appliances.some((a) => a.isManualOverride);
                const ratedWatts =
                  room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
                const curtailedWatts = Math.max(0, ratedWatts - room.currentPowerWatts);

                return (
                  <div
                    key={room.id}
                    className="p-4 sm:p-5 rounded-2xl glass-card-interactive flex flex-col justify-between group relative overflow-hidden min-w-0"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[11px] text-neutral-500 flex-wrap">
                            <span className="font-mono text-xs font-bold bg-neutral-900 text-white px-2 py-0.5 rounded-md whitespace-nowrap">
                              {room.roomCode}
                            </span>
                            <span
                              className={`font-semibold whitespace-nowrap ${
                                isMotionDetected
                                  ? 'text-emerald-800'
                                  : hasOverride
                                  ? 'text-amber-800'
                                  : 'text-neutral-500'
                              }`}
                            >
                              {activityState}
                            </span>
                            {hasOverride && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-amber-700 whitespace-nowrap">Manual Override</span>
                              </>
                            )}
                          </div>
                          <h3 className="font-bold text-neutral-900 text-sm mt-2 truncate">
                            {room.name}
                          </h3>
                          <p className="text-[11px] text-neutral-500 font-medium truncate tabular-nums">
                            {room.building} · {room.floor} · Cap {room.capacity} seats
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setQrModalRoom(room)}
                          className="p-2 text-neutral-500 hover:text-neutral-900 rounded-xl hover:bg-neutral-100/80 transition-colors shrink-0"
                          title="View classroom QR door placard"
                          aria-label={`QR placard for ${room.roomCode}`}
                        >
                          <QrCode className="w-4 h-4 text-emerald-700" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                        <div className="p-2 sm:p-2.5 bg-amber-50/60 rounded-xl border border-amber-200/60 min-w-0">
                          <div className="text-[10px] text-amber-800 font-medium flex items-center gap-1 whitespace-nowrap">
                            <Sun className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Lux</span>
                          </div>
                          <div className="font-mono font-bold text-neutral-900 mt-0.5 tabular-nums truncate">
                            {room.environment.ambientLux}
                          </div>
                          <div className="text-[10px] text-neutral-500 tabular-nums truncate">
                            α: {room.calibration.learnedParameters.daylightPenetrationAlpha}
                          </div>
                        </div>

                        <div className="p-2 sm:p-2.5 bg-rose-50/60 rounded-xl border border-rose-200/60 min-w-0">
                          <div className="text-[10px] text-rose-800 font-medium flex items-center gap-1 whitespace-nowrap">
                            <Thermometer className="w-3 h-3 text-rose-600 shrink-0" />
                            <span>Temp</span>
                          </div>
                          <div className="font-mono font-bold text-neutral-900 mt-0.5 tabular-nums truncate">
                            {room.environment.temperature}°C
                          </div>
                          <div className="text-[10px] text-neutral-500 tabular-nums truncate">
                            HI: {room.environment.heatIndex}°C
                          </div>
                        </div>

                        <div
                          className="p-2 sm:p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-200/60 min-w-0"
                          title={`Installed Rated Max: ${ratedWatts}W · Est. Pre-Retrofit Ref: ${room.baselinePowerWatts}W`}
                        >
                          <div className="text-[10px] text-emerald-800 font-medium flex items-center gap-1 whitespace-nowrap">
                            <Zap className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>Power</span>
                          </div>
                          <div className="font-mono font-bold text-neutral-900 mt-0.5 tabular-nums truncate">
                            {room.currentPowerWatts}W
                          </div>
                          <div className="text-[10px] text-emerald-700 font-semibold tabular-nums truncate">
                            {curtailedWatts === 0
                              ? `/${ratedWatts}W (100%)`
                              : `-${curtailedWatts}W`}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-neutral-100 text-[11px] text-neutral-600">
                        <div className="font-semibold text-neutral-800 line-clamp-1">
                          {room.decision.lightingAction}
                        </div>
                        <div className="text-[10px] text-neutral-500 line-clamp-1 mt-0.5">
                          {room.decision.ruleExplanation}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
                      <span className="text-[11px] text-neutral-500 tabular-nums">
                        Sufficiency: <strong className="text-neutral-800">{room.calibration.dataSufficiencyPercent}%</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedRoomId(room.id)}
                        className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold transition-all active:scale-[0.98] flex items-center gap-1"
                      >
                        <span>Inspect</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="table"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
              className="glass-card rounded-2xl overflow-hidden"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse min-w-[820px]">
                  <thead>
                    <tr className="bg-neutral-50/85 border-b border-neutral-200/80 text-neutral-500 font-bold uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-4 whitespace-nowrap">Code</th>
                      <th className="py-3 px-4 whitespace-nowrap">Classroom Name</th>
                      <th className="py-3 px-4 whitespace-nowrap">Building & Floor</th>
                      <th className="py-3 px-4 whitespace-nowrap">Room Activity</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Desk Lux</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Temp / HI</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Learned α</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Power</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">vs Max</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200/70">
                    {filteredRooms.map((room) => {
                      const activityState = getRoomActivityState(room);
                      const isMotionDetected = activityState === 'Motion detected';
                      const ratedWatts =
                        room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
                      const curtailedWatts = Math.max(0, ratedWatts - room.currentPowerWatts);

                      return (
                        <tr key={room.id} className="hover:bg-neutral-50/90 transition-colors">
                          <td className="py-2.5 px-4 font-mono font-bold text-neutral-900 whitespace-nowrap">
                            {room.roomCode}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-neutral-900">
                            <div className="whitespace-nowrap">{room.name}</div>
                            <div className="text-[10px] font-normal text-neutral-500 tabular-nums whitespace-nowrap">
                              Configured capacity: {room.capacity} seats
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-neutral-600 whitespace-nowrap">
                            <span className="font-medium text-neutral-800">{room.building}</span>{' '}
                            <span className="text-neutral-400">({room.floor})</span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span
                              className={`font-semibold text-[11px] ${
                                isMotionDetected ? 'text-emerald-700' : 'text-neutral-500'
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
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-800 tabular-nums whitespace-nowrap">
                            {room.calibration.learnedParameters.daylightPenetrationAlpha}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-neutral-900 tabular-nums whitespace-nowrap">
                            {room.currentPowerWatts} W
                          </td>
                          <td
                            className="py-2.5 px-4 text-right font-mono font-bold text-emerald-700 tabular-nums whitespace-nowrap"
                            title={`Installed Rated Max: ${ratedWatts}W · Est. Pre-Retrofit Ref: ${room.baselinePowerWatts}W`}
                          >
                            {curtailedWatts === 0 ? '0 W (100%)' : `-${curtailedWatts} W`}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setQrModalRoom(room)}
                                className="p-1.5 text-neutral-500 hover:text-neutral-900 rounded-lg hover:bg-neutral-100 transition-colors"
                                title="QR Placard"
                                aria-label={`QR placard for ${room.roomCode}`}
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedRoomId(room.id)}
                                className="px-2.5 py-1 rounded-lg bg-neutral-900 text-white font-semibold hover:bg-neutral-800 text-[11px] transition-all active:scale-[0.98]"
                              >
                                Inspect
                              </button>
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
