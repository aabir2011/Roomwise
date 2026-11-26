/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ShieldAlert,
  ArrowUpRight,
  History,
  ChevronRight,
  Sigma,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { authFetch } from '../../context/AuthContext';
import { BuildingName } from '../../types/energy';
import type { HistoryOverviewResponse } from '../../types/history';
import {
  SCHOOL_DAYS_PER_MONTH,
  computeAppliancesRatedPowerWatts,
} from '../../data/roomApplianceSpecs';
import { formatCapacityKW } from '../../utils/applianceUtils';
import { buildSchoolDayDemandProfile } from '../../utils/demandProfile';
import { ActionButton, FilterChipButton, InlineActionLink, PageHeader } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';
import { CountUp, FadeContent, MagicBento, MagicBentoCard, StarBorder } from '../reactbits';
import { CampusNavTiles } from './CampusNavTiles';
import { ROOMWISE_EASE } from '../../utils/motion';

const BUILDINGS_LIST: BuildingName[] = [
  'G+3 Block',
  'New Building',
  'Pre-Primary Block',
  'Old Building',
  'Multipurpose Hall',
];

export const DashboardView: React.FC = () => {
  const {
    campusSummary,
    classrooms,
    settings,
    auditFindings,
    setSelectedRoomId,
    setActiveTab,
  } = useEnergy();

  const [historySnap, setHistorySnap] = useState<HistoryOverviewResponse | null>(null);
  const [clockNow, setClockNow] = useState<Date>(() => new Date());
  const [matrixFilter, setMatrixFilter] = useState<BuildingName | 'All'>('All');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNow(new Date());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      authFetch('/api/history/overview?preset=last_7_days')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: HistoryOverviewResponse | null) => {
          if (!cancelled && data?.ok) {
            setHistorySnap(data);
          }
        })
        .catch(() => {});
    }, historySnap ? 350 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [campusSummary.totalCurrentPowerWatts]);

  const unresolvedAuditCount = auditFindings.filter((f) => !f.isResolved).length;

  const buildingsData = BUILDINGS_LIST.map((name) => {
    const rooms = classrooms.filter((r) => r.building === name);
    const watts = rooms.reduce((acc, r) => acc + r.currentPowerWatts, 0);
    const ratedWatts = rooms.reduce(
      (acc, r) => acc + (r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances)),
      0
    );
    const occupied = rooms.filter((r) => r.occupancyStatus === 'Occupied').length;
    const headroomPct =
      ratedWatts > 0 ? Math.max(0, Math.round(((ratedWatts - watts) / ratedWatts) * 100)) : 0;
    const utilPct = ratedWatts > 0 ? Math.min(100, Math.round((watts / ratedWatts) * 100)) : 0;
    return { name, rooms, watts, ratedWatts, occupied, headroomPct, utilPct };
  });

  const liveActualKW = Number((campusSummary.totalCurrentPowerWatts / 1000).toFixed(2));
  const liveRatedKW = Number((campusSummary.totalRatedPowerWatts / 1000).toFixed(2));
  const liveRatedKWText = formatCapacityKW(campusSummary.totalRatedPowerWatts);

  const demandProfile = buildSchoolDayDemandProfile({
    liveActualKW,
    installedRatedMaxKW: liveRatedKW,
    now: clockNow,
  });
  const hourlyData = demandProfile.slots;
  const maxHourValue = Math.max(15, Math.ceil(liveRatedKW * 1.15));

  const isAdaptiveAutomationActive = classrooms.some((room) =>
    room.appliances.some((app) => app.operatingMode === 'AUTO')
  );

  const dailySharePct =
    campusSummary.dailyRatedCeilingKWh > 0
      ? Math.min(
          100,
          Math.round((campusSummary.dailyActualKWh / campusSummary.dailyRatedCeilingKWh) * 100)
        )
      : 0;

  const visibleMatrixRooms =
    matrixFilter === 'All'
      ? classrooms
      : classrooms.filter((r) => r.building === matrixFilter);

  return (
    <div className="px-4 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-7 lg:pb-10 space-y-5 sm:space-y-6 max-w-[1440px] mx-auto">
      {/* Institutional Command Header */}
      <PageHeader
        kicker={
          <>
            <StarBorder active={isAdaptiveAutomationActive}>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isAdaptiveAutomationActive ? 'bg-[#0b6e4f]' : 'bg-amber-600'
                }`}
              />
              <span>
                {isAdaptiveAutomationActive ? 'Adaptive Automation Active' : 'Manual Override Active'}
              </span>
            </StarBorder>
            <span aria-hidden="true" className="hidden sm:inline text-[#b8c2bc]">
              ·
            </span>
            <span className="text-[#46544e] whitespace-nowrap">
              <AcronymHint term="WBSEDCL" /> Educational <AcronymHint term="HT-2" />
            </span>
            <span aria-hidden="true" className="text-[#b8c2bc]">
              ·
            </span>
            <span className="font-mono text-[#62706a] tabular-nums">
              25 Nodes / 5 Blocks
            </span>
          </>
        }
        title="Campus Energy Command"
        subtitle={`Real-time environmental calibration, daylight harvesting, and BLDC modulation across ${settings.institutionName}.`}
        action={
          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2.5 w-full lg:w-auto">
            {unresolvedAuditCount > 0 && (
              <ActionButton
                variant="amber"
                size="sm"
                onClick={() => setActiveTab('audit')}
                icon={<ShieldAlert className="w-4 h-4 text-amber-700" />}
                trailingIcon={<ArrowUpRight className="w-3.5 h-3.5 text-amber-700" />}
                className="justify-between sm:justify-center self-stretch sm:self-center"
              >
                {unresolvedAuditCount} Audit Findings
              </ActionButton>
            )}

            <CampusNavTiles
              onOpenDigitalTwin={() => setActiveTab('digital-twin')}
              onOpenCampusLive={() => setActiveTab('campus-live')}
            />
          </div>
        }
      />

      {/* Unified MagicBento Grid: Obsidian Load Chamber (7) + Daily Ledger (5) + Modelled Energy Avoided (6) + Modelled Cost Avoided (6) */}
      <MagicBento
        spotlightRadius={310}
        glowRgb="16, 185, 129"
        enableTilt={true}
        className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-4 items-stretch"
      >
        {/* Left 7 Cols: Deep Obsidian-Pine Live Campus Load Chamber */}
        <MagicBentoCard
          cardId="command-load-chamber"
          tone="obsidian"
          className="lg:col-span-7 p-4 sm:p-5 lg:p-6 justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2.5">
              <div className="text-[11px] font-medium text-[#95ada2] truncate">
                Live Campus Electrical Draw · 25 Monitored Nodes
              </div>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/12 border border-emerald-400/25 text-[11px] font-medium text-emerald-300 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                <span>Active</span>
              </span>
            </div>

            <div className="mt-2.5 sm:mt-3 flex items-baseline gap-2">
              <span className="font-mono text-[44px] sm:text-[58px] lg:text-[66px] font-bold text-white tracking-[-0.035em] leading-none tabular-nums">
                <CountUp
                  to={campusSummary.totalCurrentPowerWatts / 1000}
                  decimals={2}
                  duration={0.8}
                  delay={0.05}
                  metricKey="overview-load"
                />
              </span>
              <span className="font-mono text-xs font-normal text-[#8ea69b]">kW</span>
            </div>
          </div>

          {/* Precision Utilization Envelope Bar */}
          <div className="mt-5 space-y-2">
            <div className="text-[11px] font-mono text-[#95ada2] tabular-nums">
              {Math.round(campusSummary.ratedUtilizationPercent)}% of {liveRatedKWText} kW rated ·{' '}
              <CountUp
                to={campusSummary.availableHeadroomWatts / 1000}
                decimals={2}
                duration={0.75}
                delay={0.08}
                metricKey="overview-headroom"
              />{' '}
              kW headroom
            </div>

            <div className="relative h-2.5 w-full rounded-sm bg-white/[0.1] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#0b6e4f] via-emerald-500 to-emerald-300 transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, Math.max(3, campusSummary.ratedUtilizationPercent))}%`,
                }}
              />
              {/* 25%, 50%, 75% calibration ticks */}
              <span className="absolute inset-y-0 left-1/4 w-px bg-[#0b1713]/50" aria-hidden="true" />
              <span className="absolute inset-y-0 left-1/2 w-px bg-[#0b1713]/50" aria-hidden="true" />
              <span className="absolute inset-y-0 left-3/4 w-px bg-[#0b1713]/50" aria-hidden="true" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9bb3a8] pt-1">
              <span>
                Daylight Harvesting &amp; <AcronymHint term="BLDC" /> Closed-Loop Modulation
              </span>
              <span className="font-mono text-white tabular-nums">
                {campusSummary.totalRoomsOccupied} / {classrooms.length} rooms with motion
              </span>
            </div>
          </div>

          {/* Embedded 5-Block Proportional Strip (Directly bound to live building telemetry) */}
          <div className="mt-4 sm:mt-5 pt-3.5 sm:pt-4 border-t border-white/[0.09] grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-2.5">
            {buildingsData.map((b) => (
              <button
                key={b.name}
                type="button"
                onClick={() => setMatrixFilter((prev) => (prev === b.name ? 'All' : b.name))}
                className={`text-left rounded-md px-2 py-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
                  matrixFilter === b.name
                    ? 'bg-emerald-500/20 border border-emerald-400/35'
                    : 'hover:bg-white/[0.06] border border-transparent'
                }`}
              >
                <div className="text-[10px] text-[#95ada2] truncate">{b.name}</div>
                <div className="font-mono text-xs font-semibold text-white tabular-nums mt-0.5">
                  {(b.watts / 1000).toFixed(2)} kW
                </div>
                <div className="w-full h-1 bg-white/[0.1] rounded-full mt-1 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#0b6e4f] to-emerald-400"
                    style={{ width: `${Math.max(4, b.utilPct)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </MagicBentoCard>

        {/* Right 5 Cols: Single-Sheet Daily Accounting Ledger (3 Hairline Rows) */}
        <MagicBentoCard
          cardId="command-daily-ledger"
          tone="light"
          className="lg:col-span-5 divide-y divide-[#111916]/10"
        >
          {/* Row 1: Daily Campus Energy */}
          <div className="p-4 sm:px-5 sm:py-4 flex-1 flex flex-col justify-center bg-gradient-to-br from-white/40 via-transparent to-[#e8f5ee]/55">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium text-[#46544e]">
                  Daily Campus Energy
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-2xl sm:text-[26px] font-bold text-[#111916] tracking-tight tabular-nums">
                    <CountUp
                      to={campusSummary.dailyActualKWh}
                      decimals={1}
                      duration={0.85}
                      delay={0.09}
                      metricKey="overview-energy"
                    />
                  </span>
                  <span className="font-mono text-xs text-[#62706a]">kWh/day</span>
                </div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-xs font-semibold text-[#0b6e4f]">{dailySharePct}% ceiling</div>
                <div className="text-[11px] text-[#62706a]">
                  Max {campusSummary.dailyRatedCeilingKWh} kWh
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-[#ecefe9] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#08543c] via-[#0b6e4f] to-emerald-400 transition-[width] duration-300"
                  style={{ width: `${Math.max(4, dailySharePct)}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-[#62706a] tabular-nums whitespace-nowrap">
                {SCHOOL_DAYS_PER_MONTH}d: {campusSummary.monthlyActualKWh} kWh
              </span>
            </div>
          </div>

          {/* Row 2: Daily Cost Estimate */}
          <div className="p-4 sm:px-5 sm:py-4 flex-1 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium text-[#46544e]">Daily Cost Estimate</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-sm font-semibold text-[#62706a]">₹</span>
                <span className="font-mono text-2xl sm:text-[26px] font-bold text-[#111916] tracking-tight tabular-nums">
                  <CountUp
                    to={campusSummary.dailyCostINR}
                    decimals={0}
                    locale="en-IN"
                    duration={0.88}
                    delay={0.12}
                    metricKey="overview-cost"
                  />
                </span>
              </div>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-xs font-medium text-[#111916]">
                <AcronymHint term="HT-2" /> · ₹{settings.tariffPerKWhINR.toFixed(2)}/kWh
              </div>
              <div className="text-[11px] font-mono text-[#62706a] mt-0.5">
                {SCHOOL_DAYS_PER_MONTH}d est: ₹
                {campusSummary.monthlyCostINR.toLocaleString('en-IN', {
                  maximumFractionDigits: 0,
                })}
              </div>
            </div>
          </div>

          {/* Row 3: Daily Grid CO2 */}
          <div className="p-4 sm:px-5 sm:py-4 flex-1 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium text-[#46544e]">Daily Grid CO₂</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl sm:text-[26px] font-bold text-[#111916] tracking-tight tabular-nums">
                  <CountUp
                    to={campusSummary.dailyEmissionsKgCO2}
                    decimals={1}
                    duration={0.84}
                    delay={0.15}
                    metricKey="overview-co2"
                  />
                </span>
                <span className="font-mono text-xs text-[#62706a]">kg CO₂</span>
              </div>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-xs font-medium text-[#111916]">
                <AcronymHint term="CEA" /> · {settings.gridCarbonFactorKgCO2PerKWh} kg/kWh
              </div>
              <div className="text-[11px] font-mono text-[#62706a] mt-0.5">
                {SCHOOL_DAYS_PER_MONTH}d est: {campusSummary.monthlyEmissionsTonnesCO2} t CO₂
              </div>
            </div>
          </div>
        </MagicBentoCard>

        {/* Bottom Bento Row: Modelled Energy Avoided (6 cols) + Modelled Cost Avoided (6 cols) */}
        <MagicBentoCard
          cardId="command-avoided-energy"
          tone="light"
          className="lg:col-span-6 p-4 sm:px-5 sm:py-4.5 justify-between gap-3 bg-gradient-to-br from-white via-[#fcfefd] to-[#f2faf5]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-[#46544e]">
                <span>Modelled Energy Avoided</span>
                <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
                <span className="font-mono text-[#0b6e4f]">
                  vs <AcronymHint term="ROS" />
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-2xl sm:text-[28px] font-bold tracking-tight tabular-nums ${
                    campusSummary.dailyAvoidedKWh < 0 ? 'text-rose-700' : 'text-[#111916]'
                  }`}
                >
                  {campusSummary.dailyAvoidedKWh >= 0 ? (
                    <CountUp
                      to={campusSummary.dailyAvoidedKWh}
                      decimals={2}
                      duration={0.82}
                      delay={0.06}
                      metricKey="overview-avoided-kwh"
                    />
                  ) : (
                    campusSummary.dailyAvoidedKWh.toFixed(2)
                  )}
                </span>
                <span className="font-mono text-xs text-[#62706a]">kWh/day</span>
              </div>
            </div>

            <div className="text-right font-mono tabular-nums shrink-0">
              <div
                className={`text-xs font-semibold ${
                  campusSummary.rosSavingsPercent < 0 ? 'text-rose-700' : 'text-[#0b6e4f]'
                }`}
              >
                {campusSummary.rosSavingsPercent >= 0 ? '−' : '+'}
                {Math.abs(campusSummary.rosSavingsPercent).toFixed(1)}% vs ROS
              </div>
              <div className="text-[11px] text-[#62706a] mt-0.5">
                {SCHOOL_DAYS_PER_MONTH}d: {campusSummary.monthlyAvoidedKWh} kWh
              </div>
            </div>
          </div>

          <div className="pt-2.5 border-t border-[#111916]/8 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-mono text-[#46544e] tabular-nums">
              ROS {campusSummary.dailyRosKWh.toFixed(1)} kWh/d → Adaptive{' '}
              {campusSummary.dailyActualKWh.toFixed(1)} kWh/d
            </span>
            <InlineActionLink
              onClick={() => setActiveTab('history')}
              icon={<Sigma className="w-3 h-3" aria-hidden="true" />}
              trailingIcon={<ChevronRight className="w-3 h-3" aria-hidden="true" />}
              title="View RCEM mathematical specification — empirical meter inputs pending"
            >
              RCEM pending empirical inputs
            </InlineActionLink>
          </div>
        </MagicBentoCard>

        <MagicBentoCard
          cardId="command-avoided-cost"
          tone="light"
          className="lg:col-span-6 p-4 sm:px-5 sm:py-4.5 justify-between gap-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-[#46544e]">
                <span>Modelled Cost Avoided</span>
                <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
                <span className="font-mono text-[#62706a]">
                  <AcronymHint term="HT-2" /> ₹{settings.tariffPerKWhINR.toFixed(2)}/kWh
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="font-mono text-sm font-semibold text-[#62706a]">₹</span>
                <span
                  className={`font-mono text-2xl sm:text-[28px] font-bold tracking-tight tabular-nums ${
                    campusSummary.dailyCostAvoidedINR < 0 ? 'text-rose-700' : 'text-[#111916]'
                  }`}
                >
                  {campusSummary.dailyCostAvoidedINR >= 0 ? (
                    <CountUp
                      to={campusSummary.dailyCostAvoidedINR}
                      decimals={0}
                      locale="en-IN"
                      duration={0.85}
                      delay={0.08}
                      metricKey="overview-avoided-cost"
                    />
                  ) : (
                    campusSummary.dailyCostAvoidedINR.toFixed(0)
                  )}
                </span>
                <span className="font-mono text-xs text-[#62706a] ml-0.5">/day</span>
              </div>
            </div>

            <div className="text-right font-mono tabular-nums shrink-0">
              <div className="text-xs font-semibold text-[#111916]">
                ₹
                {campusSummary.monthlyCostAvoidedINR.toLocaleString('en-IN', {
                  maximumFractionDigits: 0,
                })}
                <span className="text-[11px] font-normal text-[#62706a]"> /mo</span>
              </div>
              <div className="text-[11px] text-[#62706a] mt-0.5">
                225d: ₹
                {campusSummary.annualCostAvoidedINR.toLocaleString('en-IN', {
                  maximumFractionDigits: 0,
                })}
              </div>
            </div>
          </div>

          <div className="pt-2.5 border-t border-[#111916]/8 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-[#46544e]">
              25-node ROOMWISE Adaptive Operation vs <AcronymHint term="ROS" />
            </span>
            <InlineActionLink
              onClick={() => setActiveTab('analytics')}
              trailingIcon={<ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            >
              Methodology
            </InlineActionLink>
          </div>
        </MagicBentoCard>
      </MagicBento>

      {/* Middle Analytical Grid: School-Day Demand Curve (8 cols) + Building & History Ledger (4 cols) */}
      <FadeContent delay={0.04} duration={0.2}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Left 8 Cols: Precision Demand Curve */}
          <section className="lg:col-span-8 rw-surface rounded-xl p-4 sm:p-5 lg:p-6 flex flex-col justify-between min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 pb-3.5 border-b border-[#111916]/8">
              <div className="min-w-0">
                <h2 className="font-display text-sm sm:text-base font-bold text-[#111916]">
                  School-Day Electrical Demand Profile
                </h2>
                <p className="text-[11.5px] sm:text-xs text-[#46544e] mt-0.5 leading-snug">
                  {demandProfile.isWithinSchoolHours
                    ? `Modelled day-school curve (${demandProfile.activeLabel} reflects live ROOMWISE Adaptive draw) vs Installed Rated Max (${liveRatedKWText} kW)`
                    : `Modelled day-school curve (07:30–14:30) + live ROOMWISE Adaptive state at ${demandProfile.currentTimeIst} vs ${liveRatedKWText} kW max`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-[#46544e] shrink-0">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-[#0b6e4f]" />
                  <span className="font-medium text-[#111916]">ROOMWISE Adaptive</span>
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-[#dde2dc]" />
                  <span>Rated Ceiling</span>
                </span>
              </div>
            </div>

            {/* Scientific Plot Area with Calibrated Reference Lines */}
            <div className="relative mt-4 sm:mt-5">
              {/* Reference guide lines */}
              <div
                className="pointer-events-none absolute inset-x-0 top-6 bottom-7 flex flex-col justify-between"
                aria-hidden="true"
              >
                <div className="border-t border-dashed border-[#111916]/10 flex justify-end">
                  <span className="text-[10px] font-mono text-[#62706a] -mt-2.5 bg-white px-1 tabular-nums">
                    {maxHourValue} kW
                  </span>
                </div>
                <div className="border-t border-dashed border-[#111916]/10 flex justify-end">
                  <span className="text-[10px] font-mono text-[#62706a] -mt-2.5 bg-white px-1 tabular-nums">
                    {(maxHourValue / 2).toFixed(1)} kW
                  </span>
                </div>
                <div className="border-t border-[#111916]/15" />
              </div>

              <div className="h-48 sm:h-56 flex items-end gap-1 sm:gap-2.5 pt-8 pb-1 overflow-x-auto no-scrollbar relative z-10">
                {hourlyData.map((d, i) => {
                  const actualHeightPercent = Math.min(100, (d.actual / maxHourValue) * 100);
                  const ratedHeightPercent = Math.min(100, (d.ratedMaxKW / maxHourValue) * 100);
                  const isCurrent = d.isCurrent;

                  return (
                    <div
                      key={d.key}
                      tabIndex={0}
                      aria-label={`${d.hour}${isCurrent ? ' IST Live' : ''}: ${d.actual} kW active vs ${d.ratedMaxKW} kW rated ceiling`}
                      className={`flex-1 flex flex-col items-center h-full justify-end group relative min-w-[26px] sm:min-w-[34px] rounded-md px-0.5 hover:bg-[#0b6e4f]/[0.04] focus-visible:bg-[#0b6e4f]/[0.06] transition-colors outline-none ${
                        d.isAfterHoursLive
                          ? 'pl-1.5 sm:pl-3 border-l border-dashed border-[#0b6e4f]/40'
                          : ''
                      }`}
                    >
                      <div className="absolute top-0 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-within:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 bg-[#0b1713] text-white text-[10px] py-1 px-2 rounded-md pointer-events-none whitespace-nowrap z-20 font-mono tabular-nums shadow-md border border-white/10">
                        {d.hour}
                        {isCurrent ? ' IST (Live)' : ''} · {d.actual} kW / {d.ratedMaxKW} kW
                      </div>

                      <div className="w-full flex items-end justify-center gap-1 h-full">
                        <motion.div
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={{ duration: 0.32, delay: i * 0.025, ease: ROOMWISE_EASE }}
                          className="w-2.5 sm:w-3.5 bg-gradient-to-t from-[#cfd6d0] to-[#e4e8e4] rounded-t-[2px] origin-bottom"
                          style={{ height: `${ratedHeightPercent}%` }}
                        />
                        <motion.div
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={{
                            duration: 0.36,
                            delay: 0.04 + i * 0.025,
                            ease: ROOMWISE_EASE,
                          }}
                          className={`w-2.5 sm:w-3.5 rounded-t-[2px] origin-bottom transition-colors ${
                            isCurrent
                              ? 'bg-gradient-to-t from-[#0b1713] via-[#0b6e4f] to-[#34d399] ring-1 ring-[#0b6e4f]/50'
                              : 'bg-gradient-to-t from-[#08543c] to-[#10b981] group-hover:from-[#063f2d] group-hover:to-[#0b6e4f]'
                          }`}
                          style={{ height: `${actualHeightPercent}%` }}
                        />
                      </div>
                      <span
                        className={`text-[11px] mt-2 font-mono tabular-nums whitespace-nowrap ${
                          isCurrent ? 'font-bold text-[#0b6e4f]' : 'text-[#62706a]'
                        }`}
                      >
                        {d.isAfterHoursLive ? `${d.hour}*` : d.hour}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#111916]/8 flex flex-wrap items-center justify-between text-[11px] text-[#46544e] gap-2">
              <span>Peak Daylighting Window: 09:30 – 13:00 (Perimeter banks dimmed)</span>
              <span className="font-mono font-semibold text-[#0b6e4f] tabular-nums">
                {campusSummary.ratedUtilizationPercent}% rated · {campusSummary.headroomPercent}% headroom
              </span>
            </div>
          </section>

          {/* Right 4 Cols: 5-Block Structural Ledger + 7-Day Historical Strip */}
          <aside className="lg:col-span-4 rw-surface rounded-xl flex flex-col justify-between overflow-hidden min-w-0">
            <div className="p-5 pb-3">
              <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-[#111916]/10">
                <h2 className="font-display text-base font-bold text-[#111916]">
                  5 Campus Blocks
                </h2>
                <InlineActionLink
                  onClick={() => setActiveTab('digital-twin')}
                  trailingIcon={<ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  Floor Atlas
                </InlineActionLink>
              </div>

              <div className="divide-y divide-[#111916]/8 mt-1">
                {buildingsData.map((b) => {
                  const isFiltered = matrixFilter === b.name;
                  return (
                    <button
                      key={b.name}
                      type="button"
                      onClick={() => setMatrixFilter((prev) => (prev === b.name ? 'All' : b.name))}
                      aria-pressed={isFiltered}
                      className={`w-full text-left py-2.5 px-2 -mx-2 rounded-md transition-all active:scale-[0.992] ${
                        isFiltered
                          ? 'bg-[#eef6f2] ring-1 ring-[#0b6e4f]/30'
                          : 'hover:bg-[#f6faf8]'
                      }`}
                      title={`Filter node matrix by ${b.name} · Installed Rated Max: ${formatCapacityKW(b.ratedWatts)} kW · Headroom: ${formatCapacityKW(Math.max(0, b.ratedWatts - b.watts))} kW`}
                    >
                      <div className="flex items-baseline justify-between text-xs">
                        <span className={`font-semibold ${isFiltered ? 'text-[#08543c]' : 'text-[#111916]'}`}>
                          {b.name}
                        </span>
                        <span className="font-mono font-semibold text-[#111916] tabular-nums">
                          {(b.watts / 1000).toFixed(2)}{' '}
                          <span className="text-[11px] font-normal text-[#62706a]">
                            / {(b.ratedWatts / 1000).toFixed(2)} kW
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-[#62706a] tabular-nums">
                        <span>
                          {b.rooms.length} rooms · {b.occupied} motion
                        </span>
                        <span className="font-mono text-[#0b6e4f] font-medium">
                          {b.utilPct}% rated
                        </span>
                      </div>
                      <div className="w-full bg-[#ecefe9] h-1 rounded-full mt-1.5 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(4, b.utilPct)}%` }}
                          transition={{ duration: 0.38, ease: ROOMWISE_EASE }}
                          className="bg-gradient-to-r from-[#08543c] to-[#10b981] h-full rounded-full"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Integrated 7-Day Historical Snapshot Footer */}
            {historySnap && historySnap.series.length > 0 && (
              <div className="px-5 py-4 bg-[#f4f6f3] border-t border-[#111916]/10 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#111916]">
                    <History className="w-3.5 h-3.5 text-[#0b6e4f]" />
                    <span>7-Day Ledger (IST)</span>
                  </div>
                  <InlineActionLink
                    onClick={() => setActiveTab('history')}
                    trailingIcon={<ArrowUpRight className="w-3 h-3" aria-hidden="true" />}
                  >
                    History
                  </InlineActionLink>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="text-[11px] text-[#46544e] space-y-0.5 tabular-nums">
                    <div>
                      7d Total:{' '}
                      <strong className="font-mono text-[#111916]">
                        {historySnap.kpis.totalActualKWh} kWh
                      </strong>
                    </div>
                    <div>
                      Daily Avg:{' '}
                      <strong className="font-mono text-[#111916]">
                        {historySnap.kpis.averageDailyKWh} kWh
                      </strong>
                    </div>
                  </div>

                  <div className="h-9 flex items-end gap-1 shrink-0" aria-label="7-day daily kWh trend">
                    {historySnap.series.map((d) => {
                      const maxVal = Math.max(1, ...historySnap.series.map((s) => s.actualKWh));
                      const h = Math.max(16, Math.round((d.actualKWh / maxVal) * 100));
                      return (
                        <div
                          key={d.key}
                          title={`${d.label}: ${d.actualKWh} kWh${d.isPartial ? ' (partial today)' : ''}`}
                          className={`w-2 rounded-t-[2px] ${
                            d.isPartial ? 'bg-emerald-400 border border-[#0b6e4f]' : 'bg-[#0b6e4f]'
                          }`}
                          style={{ height: `${h}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </FadeContent>

      {/* Architectural 25-Node Hairline Matrix */}
      <FadeContent delay={0.07} duration={0.2}>
        <section className="rw-surface rounded-xl overflow-hidden">
          <div className="px-4 py-3.5 sm:px-5 sm:py-4 border-b border-[#111916]/10 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="font-display text-sm sm:text-base font-bold text-[#111916]">
                  Classroom Node Matrix
                </h2>
                <span className="text-[11px] font-mono text-[#62706a] tabular-nums">
                  {campusSummary.totalRoomsOccupied} motion · {classrooms.length - campusSummary.totalRoomsOccupied} quiet
                </span>
              </div>
              <p className="text-[11.5px] sm:text-xs text-[#46544e] mt-0.5">
                Select any node to inspect sensor telemetry, daylight alpha, thermal beta, and live controls.
              </p>
            </div>

            <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full pb-0.5 sm:pb-0">
              {(['All', ...BUILDINGS_LIST] as const).map((b) => {
                const active = matrixFilter === b;
                return (
                  <FilterChipButton
                    key={b}
                    active={active}
                    layoutId="overview-matrix-filter"
                    onClick={() => setMatrixFilter(b)}
                  >
                    {b === 'All' ? 'All (25)' : b.replace(' Block', '').replace(' Building', '')}
                  </FilterChipButton>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-px bg-[#111916]/10">
            {visibleMatrixRooms.map((room) => {
              const isOccupied = room.occupancyStatus === 'Occupied';
              const hasOverride = room.appliances.some((a) => a.isManualOverride);
              const ratedWatts =
                room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
              const utilPct =
                ratedWatts > 0 ? Math.min(100, Math.round((room.currentPowerWatts / ratedWatts) * 100)) : 0;

              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedRoomId(room.id)}
                  className={`p-3 sm:p-3.5 text-left transition-[background-color,box-shadow,transform] duration-150 group active:scale-[0.992] hover:shadow-[inset_0_0_0_1px_rgba(11,110,79,0.22)] ${
                    isOccupied
                      ? 'bg-white hover:bg-[#f2f8f5]'
                      : 'bg-[#f8f9f7] hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-[#111916]">
                      {room.roomCode}
                    </span>
                    <span
                      className={`text-[10px] font-medium ${
                        hasOverride
                          ? 'text-amber-700'
                          : isOccupied
                          ? 'text-[#0b6e4f]'
                          : 'text-[#7c8a83]'
                      }`}
                    >
                      {hasOverride ? 'Manual' : isOccupied ? 'Motion' : 'Quiet'}
                    </span>
                  </div>

                  <div className="text-xs font-semibold text-[#111916] group-hover:text-[#0b6e4f] transition-colors truncate mt-1">
                    {room.name}
                  </div>
                  <div className="text-[10px] text-[#62706a] truncate">
                    {room.building}
                  </div>

                  <div className="mt-2.5 flex items-baseline justify-between font-mono text-[11px] tabular-nums">
                    <span className="font-semibold text-[#111916]">{room.currentPowerWatts} W</span>
                    <span className="text-[#62706a]">{room.environment.ambientLux} lx</span>
                  </div>

                  <div className="w-full h-[3px] bg-[#e9ede8] mt-1.5 overflow-hidden">
                    <div
                      className={`h-full ${
                        hasOverride ? 'bg-amber-600' : isOccupied ? 'bg-[#0b6e4f]' : 'bg-[#b5c0ba]'
                      }`}
                      style={{ width: `${Math.max(room.currentPowerWatts > 0 ? 5 : 0, utilPct)}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </FadeContent>
    </div>
  );
};
