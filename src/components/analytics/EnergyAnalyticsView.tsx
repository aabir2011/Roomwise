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
import { PageHeader, SegmentedControl } from '../common/DesignSystem';
import { MathText } from '../common/MathText';
import { AcronymHint } from '../common/AcronymHint';
import { SCHOOL_DAYS_PER_MONTH } from '../../data/roomApplianceSpecs';
import { formatCapacityKW } from '../../utils/applianceUtils';
import { computeClassroomCanonicalMetrics } from '../../utils/canonicalEnergy';
import { ROOMWISE_EASE } from '../../utils/motion';

export const EnergyAnalyticsView: React.FC = () => {
  const { classrooms, settings, campusSummary, exportAnalyticsCsv, setActiveTab } = useEnergy();
  const toast = useToast();
  const [selectedSort, setSelectedSort] = useState<'kwh' | 'power' | 'headroom'>('kwh');
  const [hoveredBuilding, setHoveredBuilding] = useState<string | null>(null);

  const enrichedClassrooms = useMemo(() => {
    return classrooms.map((room) => ({
      room,
      metrics: computeClassroomCanonicalMetrics(room, settings),
    }));
  }, [classrooms, settings]);

  // Sorted classroom list
  const sortedClassrooms = useMemo(() => {
    return [...enrichedClassrooms].sort((a, b) => {
      if (selectedSort === 'kwh') return b.metrics.dailyActualKWh - a.metrics.dailyActualKWh;
      if (selectedSort === 'power') return b.metrics.currentPowerWatts - a.metrics.currentPowerWatts;
      return b.metrics.headroomPercent - a.metrics.headroomPercent;
    });
  }, [enrichedClassrooms, selectedSort]);

  // Building-level aggregation for comparison chart
  const buildingBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        building: string;
        actualKWh: number;
        ratedCeilingKWh: number;
        currentWatts: number;
        ratedWatts: number;
        roomCount: number;
      }
    >();
    enrichedClassrooms.forEach(({ room, metrics }) => {
      const existing = map.get(room.building) || {
        building: room.building,
        actualKWh: 0,
        ratedCeilingKWh: 0,
        currentWatts: 0,
        ratedWatts: 0,
        roomCount: 0,
      };
      existing.actualKWh += metrics.dailyActualKWh;
      existing.ratedCeilingKWh += metrics.dailyRatedCeilingKWh;
      existing.currentWatts += metrics.currentPowerWatts;
      existing.ratedWatts += metrics.ratedPowerWatts;
      existing.roomCount += 1;
      map.set(room.building, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.ratedCeilingKWh - a.ratedCeilingKWh);
  }, [enrichedClassrooms]);

  const maxBuildingCeiling = useMemo(
    () => Math.max(1, ...buildingBreakdown.map((b) => b.ratedCeilingKWh)),
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
      <PageHeader
        kicker={
          <>
            <span className="whitespace-nowrap">Energy Accounting (25-Node Scope)</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">DAV Model School, IIT Kharagpur</span>
          </>
        }
        title="Campus Energy Analytics & Defensible Formulas"
        subtitle="Room-weighted day-school consumption, installed rated capacity utilisation, WBSEDCL HT-2 tariff, and CEA carbon estimates."
        action={
          <>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl rw-btn-forest text-xs font-semibold shadow-xs shrink-0 whitespace-nowrap"
            >
              <History className="w-3.5 h-3.5 text-emerald-300" />
              <span>Open Energy History</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 rounded-xl rw-btn-primary text-xs font-semibold shadow-xs shrink-0 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Analytics Dataset (.csv)</span>
            </button>
          </>
        }
      />

      {/* Campus Installed Capacity & Live Load Reconciliation */}
      <div className="p-5 rounded-2xl glass-card space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-neutral-900 tracking-tight">
            <Info className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Campus Installed Capacity &amp; Rated Headroom (25 Nodes)</span>
          </div>
          <span className="text-[11px] font-mono text-neutral-600">
            Single Canonical Source · 25 Monitored Spaces
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-semibold text-neutral-600">Live Campus Load</div>
            <div className="text-lg font-bold font-mono text-neutral-900 mt-1 tabular-nums">
              {(campusSummary.totalCurrentPowerWatts / 1000).toFixed(2)} kW
            </div>
            <div className="text-[11px] text-neutral-600 mt-0.5 font-mono tabular-nums">
              {campusSummary.totalCurrentPowerWatts.toLocaleString('en-IN')} W active draw
            </div>
          </div>

          <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200/70">
            <div className="text-[11px] font-semibold text-emerald-800">Installed Rated Maximum (100%)</div>
            <div className="text-lg font-bold font-mono text-emerald-950 mt-1 tabular-nums">
              {formatCapacityKW(campusSummary.totalRatedPowerWatts)} kW
            </div>
            <div className="text-[11px] text-emerald-800 mt-0.5 font-mono tabular-nums">
              {campusSummary.totalRatedPowerWatts.toLocaleString('en-IN')} W nameplate ceiling
            </div>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-semibold text-neutral-600">Rated Utilisation</div>
            <div className="text-lg font-bold font-mono text-neutral-900 mt-1 tabular-nums">
              {campusSummary.ratedUtilizationPercent}%
            </div>
            <div className="text-[11px] text-neutral-600 mt-0.5 font-mono tabular-nums">
              {campusSummary.dailyActualKWh.toFixed(2)} / {campusSummary.dailyRatedCeilingKWh.toFixed(2)} kWh/day
            </div>
          </div>

          <div className="p-3.5 bg-neutral-50/80 rounded-xl border border-neutral-200/70">
            <div className="text-[11px] font-semibold text-neutral-600">Available Rated Headroom</div>
            <div className="text-lg font-bold font-mono text-neutral-900 mt-1 tabular-nums">
              {(campusSummary.availableHeadroomWatts / 1000).toFixed(2)} kW
            </div>
            <div className="text-[11px] text-neutral-600 mt-0.5 font-mono tabular-nums">
              {campusSummary.availableHeadroomWatts.toLocaleString('en-IN')} W ({campusSummary.headroomPercent}% unused capacity)
            </div>
          </div>
        </div>

        <div className="px-3.5 py-2.5 rounded-xl bg-neutral-50/80 border border-neutral-200/70 flex flex-col md:flex-row md:items-center justify-between gap-2 text-[11px] leading-relaxed">
          <div className="text-neutral-700">
            <strong className="text-neutral-900">Capacity vs Energy Distinction:</strong>{' '}
            Available Rated Headroom ({(campusSummary.availableHeadroomWatts / 1000).toFixed(2)} kW) shows unused connected capacity below the {formatCapacityKW(campusSummary.totalRatedPowerWatts)} kW nameplate ceiling, not counterfactual savings.
          </div>
          <div className="text-neutral-600 md:text-right">
            Daily kWh integrates room-weighted operating hours.
          </div>
        </div>
      </div>

      {/* Engineering Calculation Formulas Card */}
      <div className="p-5 rounded-2xl glass-card rw-card-alive space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-neutral-900 tracking-tight">
          <Info className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Calculation Methodology &amp; Institutional Parameters</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 bg-white/80 rounded-xl border border-neutral-200/75 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-bold text-neutral-800">1. Operating Energy</div>
              <div className="mt-2 py-1.5 px-2 rounded-lg bg-[#f6f9f7] border border-emerald-900/8 text-emerald-950 overflow-x-auto">
                <MathText
                  tex="E_{\mathrm{kWh}} = \dfrac{P \cdot t_{\mathrm{room}}}{1000}"
                  display
                  compact
                  className="text-[13px]"
                  ariaLabel="E sub kWh equals P times t sub room divided by 1000"
                />
              </div>
            </div>
            <p className="text-[11px] text-neutral-600 mt-2 leading-relaxed">
              Room-weighted Indian day-school schedule within 07:30–14:30 (2.0h MPH, 4.2h labs, 4.5h Pre-Primary, 5.8h classrooms, 6.5h staff).
            </p>
          </div>

          <div className="p-3.5 bg-white/80 rounded-xl border border-neutral-200/75 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-bold text-neutral-800">2. Available Rated Headroom</div>
              <div className="mt-2 py-1.5 px-2 rounded-lg bg-[#f6f9f7] border border-emerald-900/8 text-emerald-950 overflow-x-auto">
                <MathText
                  tex="P_{\mathrm{headroom}} = P_{\mathrm{rated}} - P_{\mathrm{actual}}"
                  display
                  compact
                  className="text-[13px]"
                  ariaLabel="P sub headroom equals P sub rated minus P sub actual"
                />
              </div>
            </div>
            <p className="text-[11px] text-neutral-600 mt-2 leading-relaxed">
              Installed Rated Maximum across 25 rooms is {formatCapacityKW(campusSummary.totalRatedPowerWatts)} kW across 268 calibrated appliances.
            </p>
          </div>

          <div className="p-3.5 bg-white/80 rounded-xl border border-neutral-200/75 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-bold text-neutral-800">3. Operational Cost</div>
              <div className="mt-2 py-1.5 px-2 rounded-lg bg-[#f6f9f7] border border-emerald-900/8 text-emerald-950 overflow-x-auto">
                <MathText
                  tex={`\\mathrm{Cost} = E_{\\mathrm{kWh}} \\times ${settings.tariffPerKWhINR.toFixed(2)}\\;\\mathrm{INR/kWh}`}
                  display
                  compact
                  className="text-[13px]"
                  ariaLabel={`Cost equals E sub kWh times ${settings.tariffPerKWhINR.toFixed(2)} INR per kWh`}
                />
              </div>
            </div>
            <p className="text-[11px] text-neutral-600 mt-2 leading-relaxed">
              <AcronymHint term="WBSEDCL" /> Educational <AcronymHint term="HT-2" /> tariff schedule (₹{settings.tariffPerKWhINR.toFixed(2)}/kWh, editable in Settings).
            </p>
          </div>

          <div className="p-3.5 bg-white/80 rounded-xl border border-neutral-200/75 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-bold text-neutral-800">4. Scope-2 Grid Emissions</div>
              <div className="mt-2 py-1.5 px-2 rounded-lg bg-[#f6f9f7] border border-emerald-900/8 text-emerald-950 overflow-x-auto">
                <MathText
                  tex={`\\mathrm{CO}_{2} = E_{\\mathrm{kWh}} \\times ${settings.gridCarbonFactorKgCO2PerKWh}\\;\\mathrm{kg/kWh}`}
                  display
                  compact
                  className="text-[13px]"
                  ariaLabel={`CO2 equals E sub kWh times ${settings.gridCarbonFactorKgCO2PerKWh} kg per kWh`}
                />
              </div>
            </div>
            <p className="text-[11px] text-neutral-600 mt-2 leading-relaxed">
              <AcronymHint term="CEA" /> Eastern regional grid emission factor ({settings.gridCarbonFactorKgCO2PerKWh} kg CO₂/kWh).
            </p>
          </div>
        </div>
      </div>

      {/* Monthly Projections Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl glass-card rw-card-alive-alt">
          <div className="text-xs text-neutral-600 font-medium">Est. Monthly Campus Energy (25 Nodes)</div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber value={campusSummary.monthlyActualKWh} decimals={1} />{' '}
            <span className="text-sm font-normal text-neutral-600">kWh</span>
          </div>
          <div className="text-xs text-emerald-800 font-semibold mt-1">
            Scaled across {SCHOOL_DAYS_PER_MONTH} working school days/month
          </div>
        </div>

        <div className="p-5 rounded-2xl glass-card">
          <div className="text-xs text-neutral-600 font-medium">Est. Monthly Electricity Cost</div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber value={campusSummary.monthlyCostINR} decimals={2} prefix="₹" />
          </div>
          <div className="text-xs text-emerald-800 font-semibold mt-1">
            25-node operational estimate · <AcronymHint term="WBSEDCL" /> <AcronymHint term="HT-2" />
          </div>
        </div>

        <div className="p-5 rounded-2xl glass-card">
          <div className="text-xs text-neutral-600 font-medium">Est. Monthly Scope-2 Carbon Footprint</div>
          <div className="text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber value={campusSummary.monthlyEmissionsTonnesCO2} decimals={2} />{' '}
            <span className="text-sm font-normal text-neutral-600">Tonnes CO₂</span>
          </div>
          <div className="text-xs text-teal-900 font-semibold mt-1">
            <AcronymHint term="CEA" /> India Eastern Grid factor ({settings.gridCarbonFactorKgCO2PerKWh} kg/kWh)
          </div>
        </div>
      </div>

      {/* Building-by-Building Consumption vs Installed Rated Ceiling Chart */}
      <div className="p-5 rounded-2xl glass-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Block-Wise Daily Consumption vs Installed Rated Ceiling</span>
            </h3>
            <p className="text-xs text-neutral-600 mt-0.5">
              Hover any campus block to inspect daily kWh demand against its full nameplate rated daily ceiling.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-neutral-600 shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
              <span>Actual (kWh)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-neutral-200 inline-block" />
              <span>Rated Ceiling (kWh)</span>
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {buildingBreakdown.map((b) => {
            const ceilingPct = (b.ratedCeilingKWh / maxBuildingCeiling) * 100;
            const actualPct = (b.actualKWh / maxBuildingCeiling) * 100;
            const utilPct =
              b.ratedCeilingKWh > 0 ? Math.round((b.actualKWh / b.ratedCeilingKWh) * 100) : 0;
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
                    <span className="text-[11px] text-neutral-600">
                      · {b.roomCount} {b.roomCount === 1 ? 'zone' : 'rooms'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
                    <span className="text-neutral-900 font-semibold">
                      {b.actualKWh.toFixed(1)} kWh
                    </span>
                    <span className="text-neutral-600">of {b.ratedCeilingKWh.toFixed(1)} kWh max</span>
                    <span className="text-emerald-800 font-bold">{utilPct}%</span>
                  </div>
                </div>

                <div className="relative h-2.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: ceilingPct / 100 }}
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

      {/* 25-Classroom Operational League Table */}
      <div className="p-4 sm:p-5 rounded-2xl glass-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-neutral-900">
              Classroom Energy &amp; Headroom Breakdown (All {classrooms.length} Rooms)
            </h3>
            <p className="text-xs text-neutral-600">
              Live power, room-weighted daily consumption, installed rated capacity, and available headroom.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs max-w-full">
            <span className="text-[#64726b] shrink-0 whitespace-nowrap">Sort by:</span>
            <SegmentedControl<'kwh' | 'power' | 'headroom'>
              layoutId="analytics-sort-pill"
              size="sm"
              tone="light"
              ariaLabel="Sort classroom energy table"
              value={selectedSort}
              onChange={setSelectedSort}
              options={[
                { id: 'kwh', label: 'Daily kWh' },
                { id: 'power', label: 'Power (W)' },
                { id: 'headroom', label: 'Headroom %' },
              ]}
            />
          </div>
        </div>

        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-left text-xs border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-neutral-50/80 border-b border-neutral-200 text-neutral-600 font-semibold text-[11px]">
                <th className="py-2.5 px-3 whitespace-nowrap">Rank</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Room</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Name</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Building</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Live / Rated (W)</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Daily kWh</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Rated Max kWh</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Daily Cost</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Headroom %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/70">
              {sortedClassrooms.map(({ room, metrics }, idx) => (
                <tr key={room.id} className="hover:bg-neutral-50/90 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-neutral-500 font-bold tabular-nums">
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
                    {metrics.currentPowerWatts} / {metrics.ratedPowerWatts} W
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-neutral-900 tabular-nums">
                    {metrics.dailyActualKWh.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-neutral-600 tabular-nums">
                    {metrics.dailyRatedCeilingKWh.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-neutral-900 tabular-nums">
                    ₹{metrics.dailyCostINR.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-800 tabular-nums">
                    {metrics.headroomPercent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
