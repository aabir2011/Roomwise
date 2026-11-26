/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Download, History } from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useToast } from '../../context/ToastContext';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { ActionButton, LedgerStrip, PageHeader, SegmentedControl } from '../common/DesignSystem';
import { MathText } from '../common/MathText';
import { AcronymHint } from '../common/AcronymHint';
import { SCHOOL_DAYS_PER_MONTH } from '../../data/roomApplianceSpecs';
import { formatCapacityKW } from '../../utils/applianceUtils';
import { computeClassroomCanonicalMetrics } from '../../utils/canonicalEnergy';
import { FadeContent } from '../reactbits';
import { ROOMWISE_EASE } from '../../utils/motion';

export const EnergyAnalyticsView: React.FC = () => {
  const { classrooms, settings, campusSummary, exportAnalyticsCsv, setActiveTab, setSelectedRoomId } =
    useEnergy();
  const toast = useToast();
  const [selectedSort, setSelectedSort] = useState<'kwh' | 'power' | 'headroom'>('kwh');
  const [hoveredBuilding, setHoveredBuilding] = useState<string | null>(null);

  const enrichedClassrooms = useMemo(() => {
    return classrooms.map((room) => ({
      room,
      metrics: computeClassroomCanonicalMetrics(room, settings),
    }));
  }, [classrooms, settings]);

  const sortedClassrooms = useMemo(() => {
    return [...enrichedClassrooms].sort((a, b) => {
      if (selectedSort === 'kwh') return b.metrics.dailyActualKWh - a.metrics.dailyActualKWh;
      if (selectedSort === 'power') return b.metrics.currentPowerWatts - a.metrics.currentPowerWatts;
      return b.metrics.headroomPercent - a.metrics.headroomPercent;
    });
  }, [enrichedClassrooms, selectedSort]);

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

  const handleExportCSV = () => {
    const { count } = exportAnalyticsCsv();
    toast.success('Analytics dataset exported', `${count} classroom records saved as CSV.`);
  };

  return (
    <div className="px-4 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-7 lg:pb-10 space-y-5 sm:space-y-6 max-w-[1440px] mx-auto">
      {/* Header */}
      <PageHeader
        kicker={
          <>
            <span>Canonical Energy Accounting</span>
            <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
            <span className="font-mono text-[#62706a]">25-Node Scope · 268 Calibrated Appliances</span>
          </>
        }
        title="Energy Analytics & Defensible Formulas"
        subtitle="Room-weighted day-school consumption, installed rated capacity utilisation, WBSEDCL HT-2 tariff, and CEA Scope-2 carbon estimates."
        action={
          <>
            <ActionButton
              variant="secondary"
              size="md"
              onClick={() => setActiveTab('history')}
              icon={<History className="w-3.5 h-3.5 text-[#0b6e4f]" />}
            >
              Energy History
            </ActionButton>

            <ActionButton
              variant="forest"
              size="md"
              onClick={handleExportCSV}
              icon={<Download className="w-3.5 h-3.5 text-emerald-200" />}
            >
              Export Dataset (.csv)
            </ActionButton>
          </>
        }
      />

      {/* Unified Capacity & Rated Headroom Reconciliation Strip */}
      <FadeContent duration={0.18}>
        <div className="space-y-2">
          <LedgerStrip
            columns={4}
            items={[
              {
                label: 'Live Campus Load',
                value: (campusSummary.totalCurrentPowerWatts / 1000).toFixed(2),
                unit: 'kW',
                detail: `${campusSummary.totalCurrentPowerWatts.toLocaleString('en-IN')} W active draw`,
              },
              {
                label: 'Installed Rated Maximum',
                value: formatCapacityKW(campusSummary.totalRatedPowerWatts),
                unit: 'kW',
                detail: `${campusSummary.totalRatedPowerWatts.toLocaleString('en-IN')} W nameplate ceiling`,
                highlight: true,
              },
              {
                label: 'Rated Utilisation',
                value: `${campusSummary.ratedUtilizationPercent}`,
                unit: '%',
                detail: `${campusSummary.dailyActualKWh.toFixed(2)} / ${campusSummary.dailyRatedCeilingKWh.toFixed(2)} kWh/day`,
              },
              {
                label: 'Available Rated Headroom',
                value: (campusSummary.availableHeadroomWatts / 1000).toFixed(2),
                unit: 'kW',
                detail: `${campusSummary.availableHeadroomWatts.toLocaleString('en-IN')} W (${campusSummary.headroomPercent}% unused)`,
              },
            ]}
          />
          <p className="text-[11px] text-[#46544e] px-1 leading-relaxed">
            <strong className="text-[#111916]">Capacity vs. ROS Avoidance Distinction:</strong> Available Rated Headroom (
            {(campusSummary.availableHeadroomWatts / 1000).toFixed(2)} kW) represents unused connected capacity below the{' '}
            {formatCapacityKW(campusSummary.totalRatedPowerWatts)} kW nameplate ceiling, not avoided energy.{' '}
            <strong className="text-[#111916]">Modelled Energy Avoided</strong> compares ROOMWISE Adaptive Operation against a{' '}
            <AcronymHint term="ROS" /> under comparable occupancy, schedule, and ambient heat index.
          </p>
        </div>
      </FadeContent>

      {/* Modelled Performance vs Reference Operating Scenario (ROS) + Separated 70-Classroom Survey Estimate */}
      <FadeContent delay={0.025} duration={0.18}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <section className="lg:col-span-7 rw-surface rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-3 bg-gradient-to-br from-white via-white to-[#f4faf6]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2.5 border-b border-[#111916]/10">
              <div>
                <h2 className="font-display text-sm sm:text-base font-bold text-[#111916]">
                  25-Node Modelled Avoidance vs. <AcronymHint term="ROS" />
                </h2>
                <p className="text-[11px] text-[#46544e] mt-0.5">
                  ROOMWISE Adaptive Operation ({campusSummary.dailyActualKWh.toFixed(2)} kWh/d) vs Reference Operating Scenario ({campusSummary.dailyRosKWh.toFixed(2)} kWh/d)
                </p>
              </div>
              <span className="font-mono text-[11px] text-[#0b6e4f] font-semibold">
                {campusSummary.rosSavingsPercent >= 0 ? '−' : '+'}
                {Math.abs(campusSummary.rosSavingsPercent).toFixed(1)}% vs ROS
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div>
                <div className="text-[10.5px] font-medium text-[#46544e]">Modelled Energy Avoided</div>
                <div className="font-mono text-lg font-bold text-[#111916] tabular-nums mt-0.5">
                  {campusSummary.dailyAvoidedKWh.toFixed(2)}{' '}
                  <span className="text-[11px] font-normal text-[#62706a]">kWh/d</span>
                </div>
                <div className="font-mono text-[10.5px] text-[#62706a] tabular-nums">
                  {campusSummary.monthlyAvoidedKWh} kWh/mo
                </div>
              </div>

              <div>
                <div className="text-[10.5px] font-medium text-[#46544e]">Modelled Cost Avoided</div>
                <div className="font-mono text-lg font-bold text-[#08543c] tabular-nums mt-0.5">
                  ₹{campusSummary.dailyCostAvoidedINR.toFixed(0)}
                  <span className="text-[11px] font-normal text-[#62706a]">/d</span>
                </div>
                <div className="font-mono text-[10.5px] text-[#62706a] tabular-nums">
                  ₹{campusSummary.monthlyCostAvoidedINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/mo
                </div>
              </div>

              <div>
                <div className="text-[10.5px] font-medium text-[#46544e]">ROS Reference Draw</div>
                <div className="font-mono text-lg font-bold text-[#111916] tabular-nums mt-0.5">
                  {(campusSummary.totalRosPowerWatts / 1000).toFixed(2)}{' '}
                  <span className="text-[11px] font-normal text-[#62706a]">kW</span>
                </div>
                <div className="font-mono text-[10.5px] text-[#62706a] tabular-nums">
                  {campusSummary.monthlyRosKWh} kWh/mo
                </div>
              </div>

              <div>
                <div className="text-[10.5px] font-medium text-[#46544e]">Annualized (225d)</div>
                <div className="font-mono text-lg font-bold text-[#111916] tabular-nums mt-0.5">
                  ₹{campusSummary.annualCostAvoidedINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
                <div className="font-mono text-[10.5px] text-[#62706a] tabular-nums">
                  {campusSummary.annualAvoidedKWh} kWh/yr
                </div>
              </div>
            </div>
          </section>

          <aside className="lg:col-span-5 rw-surface rounded-xl p-4 sm:p-5 bg-[#fafbf9] flex flex-col justify-between gap-2.5">
            <div className="flex items-baseline justify-between gap-2 pb-2 border-b border-[#111916]/10">
              <h2 className="font-display text-sm font-bold text-[#111916]">
                70-Classroom Survey-Based Potential Savings Estimate
              </h2>
              <span className="text-[10px] font-mono text-[#62706a] whitespace-nowrap">
                Separate Scope
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
              <div>
                <div className="text-[10px] text-[#62706a]">Annual Potential</div>
                <div className="text-sm font-bold text-[#111916]">10,080 kWh</div>
              </div>
              <div>
                <div className="text-[10px] text-[#62706a]">Est. Cost Value</div>
                <div className="text-sm font-bold text-[#08543c]">₹70,560/yr</div>
              </div>
              <div>
                <div className="text-[10px] text-[#62706a]">Est. Payback</div>
                <div className="text-sm font-bold text-[#111916]">~1.29 yr</div>
              </div>
            </div>
            <p className="text-[11px] text-[#46544e] leading-relaxed">
              Analytical full-school projection (540 W conventional load · 80 min/day vacancy shutoff · 200 school days/yr @ ₹7/kWh). Kept strictly separate from 25-node telemetry and pending empirical <AcronymHint term="RCEM" /> validation.
            </p>
          </aside>
        </div>
      </FadeContent>

      {/* Asymmetric Split: Block-Wise Comparison (7 Cols) + Monthly Institutional Ledger (5 Cols) */}
      <FadeContent delay={0.04} duration={0.2}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left 7 Cols: Block-Wise Daily Consumption vs Rated Ceiling */}
          <section className="lg:col-span-7 rw-surface rounded-xl p-4 sm:p-5 flex flex-col justify-between min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-4 border-b border-[#111916]/10">
              <div>
                <h2 className="font-display text-base font-bold text-[#111916]">
                  Block-Wise Daily Consumption vs. Rated Ceiling
                </h2>
                <p className="text-xs text-[#46544e] mt-0.5">
                  Daily kWh demand measured against full nameplate rated ceiling across all 5 blocks.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[#46544e] shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-[#0b6e4f]" />
                  <span>Actual</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-[#dde2dc]" />
                  <span>Rated Ceiling</span>
                </span>
              </div>
            </div>

            <div className="divide-y divide-[#111916]/8 mt-2">
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
                    className={`py-3 px-2 -mx-2 rounded-md transition-colors ${
                      isHovered ? 'bg-[#f4f6f3]' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs mb-2">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-[#111916]">{b.building}</span>
                        <span className="text-[11px] font-mono text-[#62706a]">
                          {b.roomCount} {b.roomCount === 1 ? 'zone' : 'rooms'}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-3 font-mono text-[11px] tabular-nums">
                        <span className="text-[#111916] font-semibold">
                          {b.actualKWh.toFixed(1)} kWh
                        </span>
                        <span className="text-[#62706a]">/ {b.ratedCeilingKWh.toFixed(1)} max</span>
                        <span className="text-[#0b6e4f] font-bold">{utilPct}%</span>
                      </div>
                    </div>

                    <div className="relative h-2 w-full rounded-sm bg-[#ecefe9] overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: ceilingPct / 100 }}
                        transition={{ duration: 0.4, ease: ROOMWISE_EASE }}
                        style={{ transformOrigin: 'left center' }}
                        className="absolute inset-y-0 left-0 w-full bg-[#d3dbd5]"
                      />
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: actualPct / 100 }}
                        transition={{ duration: 0.4, ease: ROOMWISE_EASE }}
                        style={{ transformOrigin: 'left center' }}
                        className={`absolute inset-y-0 left-0 w-full transition-colors ${
                          isHovered
                            ? 'bg-gradient-to-r from-[#064e3b] via-[#0b6e4f] to-[#10b981]'
                            : 'bg-gradient-to-r from-[#08543c] to-[#10b981]'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right 5 Cols: Monthly Institutional Projections Sheet */}
          <aside className="lg:col-span-5 rw-surface rounded-xl divide-y divide-[#111916]/10 flex flex-col justify-between overflow-hidden">
            <div className="px-5 py-4 rw-obsidian-panel border-none rounded-none shadow-none text-white">
              <div className="text-[11px] font-mono text-emerald-300">
                Institutional Monthly Projections ({SCHOOL_DAYS_PER_MONTH} School Days)
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-bold tracking-tight tabular-nums">
                  <AnimatedNumber value={campusSummary.monthlyActualKWh} decimals={1} />
                </span>
                <span className="font-mono text-xs text-[#95ada2]">kWh / month</span>
              </div>
              <div className="text-[11px] text-[#9bb3a8] mt-1">
                25-node modelled operating demand across 5 blocks
              </div>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-center">
              <div className="text-[11px] font-medium text-[#46544e]">
                Estimated Monthly Electricity Cost
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-[#111916] tabular-nums">
                <AnimatedNumber value={campusSummary.monthlyCostINR} decimals={2} prefix="₹" />
              </div>
              <div className="text-xs text-[#0b6e4f] font-medium mt-1">
                <AcronymHint term="WBSEDCL" /> <AcronymHint term="HT-2" /> tariff · ₹{settings.tariffPerKWhINR.toFixed(2)}/kWh
              </div>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-center">
              <div className="text-[11px] font-medium text-[#46544e]">
                Estimated Monthly Scope-2 Carbon Footprint
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold text-[#111916] tabular-nums">
                  <AnimatedNumber value={campusSummary.monthlyEmissionsTonnesCO2} decimals={2} />
                </span>
                <span className="font-mono text-xs text-[#62706a]">Tonnes CO₂</span>
              </div>
              <div className="text-xs text-[#46544e] mt-1">
                <AcronymHint term="CEA" /> Eastern Grid factor ({settings.gridCarbonFactorKgCO2PerKWh} kg CO₂/kWh)
              </div>
            </div>
          </aside>
        </div>
      </FadeContent>

      {/* Mathematical Methodology Reference Sheet (4 Hairline Columns) */}
      <FadeContent delay={0.06} duration={0.2}>
        <section className="rw-surface rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#111916]/10 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold text-[#111916]">
              Calculation Methodology &amp; Institutional Parameters
            </h2>
            <span className="text-[11px] font-mono text-[#62706a]">
              Single Canonical Formula Specification
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#111916]/10">
            <div className="p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold text-[#111916]">01. Operating Energy</div>
                <div className="mt-2 py-2 px-2.5 rounded-md bg-[#f4f6f3] border border-[#111916]/8 text-[#08543c] overflow-x-auto">
                  <MathText
                    tex="E_{\mathrm{kWh}} = \dfrac{P \cdot t_{\mathrm{room}}}{1000}"
                    display
                    compact
                    className="text-[13px]"
                    ariaLabel="E sub kWh equals P times t sub room divided by 1000"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#46544e] leading-relaxed">
                Room-weighted day-school schedule within 07:30–14:30 (2.0h MPH, 4.2h labs, 4.5h Pre-Primary, 5.8h classrooms, 6.5h staff).
              </p>
            </div>

            <div className="p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold text-[#111916]">02. Available Rated Headroom</div>
                <div className="mt-2 py-2 px-2.5 rounded-md bg-[#f4f6f3] border border-[#111916]/8 text-[#08543c] overflow-x-auto">
                  <MathText
                    tex="P_{\mathrm{headroom}} = P_{\mathrm{rated}} - P_{\mathrm{actual}}"
                    display
                    compact
                    className="text-[13px]"
                    ariaLabel="P sub headroom equals P sub rated minus P sub actual"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#46544e] leading-relaxed">
                Installed Rated Maximum across 25 rooms is {formatCapacityKW(campusSummary.totalRatedPowerWatts)} kW across 268 calibrated appliances.
              </p>
            </div>

            <div className="p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold text-[#111916]">03. Operational Cost</div>
                <div className="mt-2 py-2 px-2.5 rounded-md bg-[#f4f6f3] border border-[#111916]/8 text-[#08543c] overflow-x-auto">
                  <MathText
                    tex={`\\mathrm{Cost} = E_{\\mathrm{kWh}} \\times ${settings.tariffPerKWhINR.toFixed(2)}\\;\\mathrm{INR/kWh}`}
                    display
                    compact
                    className="text-[13px]"
                    ariaLabel={`Cost equals E sub kWh times ${settings.tariffPerKWhINR.toFixed(2)} INR per kWh`}
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#46544e] leading-relaxed">
                <AcronymHint term="WBSEDCL" /> Educational <AcronymHint term="HT-2" /> tariff schedule (₹{settings.tariffPerKWhINR.toFixed(2)}/kWh, editable in Settings).
              </p>
            </div>

            <div className="p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold text-[#111916]">04. Scope-2 Grid Emissions</div>
                <div className="mt-2 py-2 px-2.5 rounded-md bg-[#f4f6f3] border border-[#111916]/8 text-[#08543c] overflow-x-auto">
                  <MathText
                    tex={`\\mathrm{CO}_{2} = E_{\\mathrm{kWh}} \\times ${settings.gridCarbonFactorKgCO2PerKWh}\\;\\mathrm{kg/kWh}`}
                    display
                    compact
                    className="text-[13px]"
                    ariaLabel={`CO2 equals E sub kWh times ${settings.gridCarbonFactorKgCO2PerKWh} kg per kWh`}
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#46544e] leading-relaxed">
                <AcronymHint term="CEA" /> Eastern regional grid emission factor ({settings.gridCarbonFactorKgCO2PerKWh} kg CO₂/kWh).
              </p>
            </div>
          </div>
        </section>
      </FadeContent>

      {/* 25-Classroom Operational League Table */}
      <section className="rw-surface rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#111916]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-[#111916]">
              Classroom Operational League Table ({classrooms.length} Nodes)
            </h2>
            <p className="text-xs text-[#46544e] mt-0.5">
              Select any row to open full room inspection. Live power, room-weighted daily kWh, rated ceiling, and headroom.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#62706a] whitespace-nowrap">Sort by:</span>
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

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-[#f4f6f3] border-b border-[#111916]/10 text-[#46544e] font-semibold text-[11px]">
                <th className="py-2.5 px-4 whitespace-nowrap">#</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Room</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Name</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Building</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Live / Rated (W)</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Daily kWh</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Rated Max kWh</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Daily Cost</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Headroom</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#111916]/8">
              {sortedClassrooms.map(({ room, metrics }, idx) => (
                <tr
                  key={room.id}
                  onClick={() => setSelectedRoomId(room.id)}
                  className="hover:bg-[#f4f8f5] transition-colors cursor-pointer"
                >
                  <td className="py-2.5 px-4 font-mono text-[#62706a] tabular-nums">
                    {String(idx + 1).padStart(2, '0')}
                  </td>
                  <td className="py-2.5 px-4 font-mono font-bold text-[#111916] whitespace-nowrap">
                    {room.roomCode}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-[#111916]">
                    {room.name}
                  </td>
                  <td className="py-2.5 px-4 text-[#46544e] whitespace-nowrap">
                    {room.building}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-[#111916]">{metrics.currentPowerWatts}</span>
                    <span className="text-[#62706a]"> / {metrics.ratedPowerWatts} W</span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#111916] tabular-nums">
                    {metrics.dailyActualKWh.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-[#62706a] tabular-nums">
                    {metrics.dailyRatedCeilingKWh.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#111916] tabular-nums">
                    ₹{metrics.dailyCostINR.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#0b6e4f] tabular-nums">
                    {metrics.headroomPercent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
