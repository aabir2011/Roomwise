/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Download,
  History,
  Info,
  BarChart3,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useToast } from '../../context/ToastContext';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { SCHOOL_DAYS_PER_MONTH } from '../../data/roomApplianceSpecs';
import { formatCapacityKW } from '../../utils/applianceUtils';
import { ROOMWISE_EASE, SPRING_SNAPPY } from '../../utils/motion';

export const EnergyAnalyticsView: React.FC = () => {
  const { classrooms, settings, campusSummary, exportAnalyticsCsv, setActiveTab } = useEnergy();
  const toast = useToast();
  const [selectedSort, setSelectedSort] = useState<'saved' | 'power' | 'efficiency'>('saved');
  const [hoveredBuilding, setHoveredBuilding] = useState<string | null>(null);

  // Sorted classroom list
  const sortedClassrooms = useMemo(() => {
    return [...classrooms].sort((a, b) => {
      const savedA = a.dailyBaselineKWh - a.dailyActualKWh;
      const savedB = b.dailyBaselineKWh - b.dailyActualKWh;
      if (selectedSort === 'saved') return savedB - savedA;
      if (selectedSort === 'power') return b.currentPowerWatts - a.currentPowerWatts;
      const effA = a.dailyBaselineKWh > 0 ? savedA / a.dailyBaselineKWh : 0;
      const effB = b.dailyBaselineKWh > 0 ? savedB / b.dailyBaselineKWh : 0;
      return effB - effA;
    });
  }, [classrooms, selectedSort]);

  // Building-level aggregation for comparison chart
  const buildingBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { building: string; actualKWh: number; baselineKWh: number; savedKWh: number; roomCount: number }
    >();
    classrooms.forEach((room) => {
      const existing = map.get(room.building) || {
        building: room.building,
        actualKWh: 0,
        baselineKWh: 0,
        savedKWh: 0,
        roomCount: 0,
      };
      existing.actualKWh += room.dailyActualKWh;
      existing.baselineKWh += room.dailyBaselineKWh;
      existing.savedKWh += Math.max(0, room.dailyBaselineKWh - room.dailyActualKWh);
      existing.roomCount += 1;
      map.set(room.building, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.baselineKWh - a.baselineKWh);
  }, [classrooms]);

  const maxBuildingBaseline = useMemo(
    () => Math.max(1, ...buildingBreakdown.map((b) => b.baselineKWh)),
    [buildingBreakdown]
  );

  // Export CSV Handler
  const handleExportCSV = () => {
    const { count } = exportAnalyticsCsv();
    toast.success('Analytics dataset exported', `${count} classroom records saved as CSV.`);
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs font-semibold text-emerald-800">
            <span className="whitespace-nowrap">Energy Accounting (25-Node Scope)</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">DAV Model School, IIT Kharagpur</span>
          </div>
          <h1 className="text-lg sm:text-2xl font-bold text-neutral-900 tracking-tight mt-0.5">
            Campus Energy Analytics &amp; Defensible Formulas
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Room-weighted day-school consumption, pre-retrofit reference comparisons, WBSEDCL tariff, and CEA carbon estimates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors shadow-xs shrink-0 whitespace-nowrap cursor-pointer"
          >
            <History className="w-3.5 h-3.5" />
            <span>Open Energy History</span>
          </button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-xs shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Analytics Dataset (.csv)</span>
          </motion.button>
        </div>
      </div>

      {/* Campus Installed Capacity vs Pre-Retrofit Reference Reconciliation */}
      <div className="p-5 rounded-2xl glass-card space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-neutral-900 tracking-tight">
            <Info className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Campus Installed Capacity vs Pre-Retrofit Reference (25 Nodes)</span>
          </div>
          <span className="text-[11px] font-mono text-neutral-500">
            Single Source of Truth · Installed LED/BLDC vs Estimated Pre-Retrofit Reference
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-semibold text-neutral-500">Live Campus Load</div>
            <div className="text-lg font-bold font-mono text-neutral-900 mt-1 tabular-nums">
              {(campusSummary.totalCurrentPowerWatts / 1000).toFixed(2)} kW
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5 font-mono tabular-nums">
              {campusSummary.totalCurrentPowerWatts.toLocaleString('en-IN')} W active draw
            </div>
          </div>

          <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200/70">
            <div className="text-[11px] font-semibold text-emerald-800">Installed Rated Maximum (100%)</div>
            <div className="text-lg font-bold font-mono text-emerald-950 mt-1 tabular-nums">
              {formatCapacityKW(campusSummary.totalRatedPowerWatts)} kW
            </div>
            <div className="text-[11px] text-emerald-800 mt-0.5 font-mono tabular-nums">
              {campusSummary.totalRatedPowerWatts.toLocaleString('en-IN')} W nameplate ceiling (not continuous load)
            </div>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-semibold text-neutral-500">Rated Utilisation</div>
            <div className="text-lg font-bold font-mono text-neutral-900 mt-1 tabular-nums">
              {campusSummary.ratedUtilizationPercent}%
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5 font-mono tabular-nums">
              {(campusSummary.curtailedFromRatedWatts / 1000).toFixed(2)} kW curtailed vs max
            </div>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-semibold text-neutral-500">Est. Pre-Retrofit Ref Capacity</div>
            <div className="text-lg font-bold font-mono text-neutral-900 mt-1 tabular-nums">
              {formatCapacityKW(campusSummary.totalBaselinePowerWatts)} kW
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5 font-mono tabular-nums">
              {campusSummary.totalBaselinePowerWatts.toLocaleString('en-IN')} W · {campusSummary.dailyBaselineKWh.toFixed(2)} kWh/day ref
            </div>
          </div>
        </div>

        {(() => {
          const capDiffWatts = Math.max(
            0,
            campusSummary.totalBaselinePowerWatts - campusSummary.totalRatedPowerWatts
          );
          const capDiffPct =
            campusSummary.totalBaselinePowerWatts > 0
              ? ((capDiffWatts / campusSummary.totalBaselinePowerWatts) * 100).toFixed(1)
              : '0.0';
          return (
            <div className="px-3.5 py-2.5 rounded-xl bg-neutral-50/80 border border-neutral-200/70 flex flex-col md:flex-row md:items-center justify-between gap-2 text-[11px] leading-relaxed">
              <div className="text-neutral-700">
                <strong className="text-neutral-900">
                  Capacity Difference vs Pre-Retrofit Reference:
                </strong>{' '}
                <span className="font-mono font-bold text-neutral-900">
                  {capDiffWatts.toLocaleString('en-IN')} W ({formatCapacityKW(capDiffWatts)} kW · ~{capDiffPct}% lower rated capacity)
                </span>
              </div>
              <div className="text-neutral-500 md:text-right">
                Comparative engineering reference · Actual energy depends on school hours &amp; adaptive control.
              </div>
            </div>
          );
        })()}
      </div>

      {/* Engineering Calculation Formulas Card */}
      <div className="p-5 rounded-2xl glass-card space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-neutral-900 tracking-tight">
          <Info className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Calculation Methodology &amp; Institutional Parameters</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-bold text-neutral-800">1. Operating Energy</div>
            <div className="font-mono text-emerald-800 font-semibold mt-1 tabular-nums">
              kWh = W × Room Hours / 1000
            </div>
            <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
              Room-weighted Indian day-school schedule within 07:30–14:30 (2.0h MPH, 4.2h labs, 4.5h Pre-Primary, 5.8h classrooms, 6.5h staff).
            </p>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-bold text-neutral-800">2. Est. Energy vs Pre-Retrofit Ref</div>
            <div className="font-mono text-emerald-800 font-semibold mt-1 tabular-nums">
              E_diff = E_pre_retrofit − E_actual
            </div>
            <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
              Estimated Pre-Retrofit Reference ({formatCapacityKW(campusSummary.totalBaselinePowerWatts)} kW) models conventional fixtures; Installed Rated Maximum is {formatCapacityKW(campusSummary.totalRatedPowerWatts)} kW.
            </p>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-bold text-neutral-800">3. Financial Saving</div>
            <div className="font-mono text-emerald-800 font-semibold mt-1 tabular-nums">
              Cost = E_saved × ₹{settings.tariffPerKWhINR}
            </div>
            <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
              WBSEDCL Educational HT-2 tariff schedule (editable in Settings).
            </p>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-bold text-neutral-800">4. Emissions Avoided</div>
            <div className="font-mono text-emerald-800 font-semibold mt-1 tabular-nums">
              CO₂ = E_saved × {settings.gridCarbonFactorKgCO2PerKWh} kg
            </div>
            <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
              Central Electricity Authority (CEA India) baseline emission factor for Eastern regional grid.
            </p>
          </div>
        </div>
      </div>

      {/* Monthly Projections Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl glass-card">
          <div className="text-xs text-neutral-500 font-medium">Est. Monthly Avoided Energy (25 Nodes)</div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber value={campusSummary.dailySavedKWh * SCHOOL_DAYS_PER_MONTH} decimals={1} />{' '}
            <span className="text-sm font-normal text-neutral-500">kWh</span>
          </div>
          <div className="text-xs text-emerald-800 font-semibold mt-1">
            Estimated across {SCHOOL_DAYS_PER_MONTH} working school days/month
          </div>
        </div>

        <div className="p-5 rounded-2xl glass-card">
          <div className="text-xs text-neutral-500 font-medium">Est. Monthly Cost Savings</div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber value={campusSummary.dailyCostSavedINR * SCHOOL_DAYS_PER_MONTH} decimals={2} prefix="₹" />
          </div>
          <div className="text-xs text-emerald-800 font-semibold mt-1">
            Modelled 25-node estimate · WBSEDCL HT-2
          </div>
        </div>

        <div className="p-5 rounded-2xl glass-card">
          <div className="text-xs text-neutral-500 font-medium">Est. Monthly Scope-2 Carbon Offset</div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber
              value={(campusSummary.dailyEmissionsAvoidedKgCO2 * SCHOOL_DAYS_PER_MONTH) / 1000}
              decimals={2}
            />{' '}
            <span className="text-sm font-normal text-neutral-500">Tonnes CO₂</span>
          </div>
          <div className="text-xs text-teal-900 font-semibold mt-1">
            Estimated via CEA India Eastern Grid factor ({settings.gridCarbonFactorKgCO2PerKWh} kg/kWh)
          </div>
        </div>
      </div>

      {/* Building-by-Building Consumption vs Baseline Comparison Chart */}
      <div className="p-5 rounded-2xl glass-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Block-Wise Daily Consumption vs Estimated Pre-Retrofit Reference</span>
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Hover any campus block to inspect daily kWh demand against estimated pre-retrofit reference usage.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-neutral-600 shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
              <span>Actual (kWh)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-neutral-200 inline-block" />
              <span>Pre-Retrofit Ref (kWh)</span>
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {buildingBreakdown.map((b) => {
            const baselinePct = (b.baselineKWh / maxBuildingBaseline) * 100;
            const actualPct = (b.actualKWh / maxBuildingBaseline) * 100;
            const reductionPct =
              b.baselineKWh > 0 ? Math.round((b.savedKWh / b.baselineKWh) * 100) : 0;
            const isHovered = hoveredBuilding === b.building;

            return (
              <div
                key={b.building}
                onMouseEnter={() => setHoveredBuilding(b.building)}
                onMouseLeave={() => setHoveredBuilding(null)}
                className={`p-3 rounded-xl border transition-colors ${
                  isHovered
                    ? 'bg-neutral-50/90 border-neutral-300/80'
                    : 'bg-white/60 border-neutral-200/70'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-900">{b.building}</span>
                    <span className="text-[11px] text-neutral-500">
                      · {b.roomCount} {b.roomCount === 1 ? 'zone' : 'rooms'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
                    <span className="text-neutral-900 font-semibold">
                      {b.actualKWh.toFixed(1)} kWh
                    </span>
                    <span className="text-neutral-400">of {b.baselineKWh.toFixed(1)} kWh</span>
                    <span className="text-emerald-800 font-bold">-{reductionPct}%</span>
                  </div>
                </div>

                <div className="relative h-2.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: baselinePct / 100 }}
                    transition={{ duration: 0.45, ease: ROOMWISE_EASE }}
                    style={{ transformOrigin: 'left center' }}
                    className="absolute inset-y-0 left-0 w-full bg-neutral-200/90 rounded-full"
                  />
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: actualPct / 100 }}
                    transition={{ duration: 0.45, ease: ROOMWISE_EASE }}
                    style={{ transformOrigin: 'left center' }}
                    className={`absolute inset-y-0 left-0 w-full rounded-full transition-colors ${
                      isHovered ? 'bg-emerald-500' : 'bg-emerald-600'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 25-Classroom Efficiency League Table */}
      <div className="p-4 sm:p-5 rounded-2xl glass-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-neutral-900">
              Classroom Efficiency League Table (All {classrooms.length} Rooms)
            </h3>
            <p className="text-xs text-neutral-500">
              Ranked comparison of daily consumption vs estimated pre-retrofit reference.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs max-w-full">
            <span className="text-neutral-500 shrink-0 whitespace-nowrap">Sort by:</span>
            <div className="flex items-center p-1 bg-neutral-100 rounded-xl border border-neutral-200/60 overflow-x-auto max-w-full">
              {(
                [
                  { id: 'saved', label: 'Energy Saved' },
                  { id: 'power', label: 'Power (W)' },
                  { id: 'efficiency', label: 'Efficiency %' },
                ] as const
              ).map((tab) => {
                const active = selectedSort === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSelectedSort(tab.id)}
                    className={`relative px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      active ? 'text-neutral-900 font-semibold' : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="analytics-sort-pill"
                        transition={SPRING_SNAPPY}
                        className="absolute inset-0 bg-white rounded-lg shadow-xs border border-neutral-200/60"
                      />
                    )}
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-left text-xs border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-neutral-50/80 border-b border-neutral-200 text-neutral-500 font-semibold text-[11px]">
                <th className="py-2.5 px-3 whitespace-nowrap">Rank</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Room</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Name</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Building</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Actual kWh</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Base kWh</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Saved kWh</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Saved INR</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Reduction %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/70">
              {sortedClassrooms.map((room, idx) => {
                const savedKWh = Math.max(0, room.dailyBaselineKWh - room.dailyActualKWh);
                const percent =
                  room.dailyBaselineKWh > 0 ? Math.round((savedKWh / room.dailyBaselineKWh) * 100) : 0;
                const costSaved = (savedKWh * settings.tariffPerKWhINR).toFixed(2);

                return (
                  <tr key={room.id} className="hover:bg-neutral-50/90 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-neutral-400 font-bold tabular-nums">
                      #{idx + 1}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-neutral-900 whitespace-nowrap">
                      {room.roomCode}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-neutral-800">
                      {room.name}
                    </td>
                    <td className="py-2.5 px-3 text-neutral-600 font-medium whitespace-nowrap">
                      {room.building}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {room.dailyActualKWh.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-neutral-400 tabular-nums">
                      {room.dailyBaselineKWh.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800 tabular-nums">
                      +{savedKWh.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-neutral-900 tabular-nums">
                      ₹{costSaved}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-800 tabular-nums">
                      -{percent}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
