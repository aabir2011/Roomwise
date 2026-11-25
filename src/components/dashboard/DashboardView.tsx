/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Zap,
  TrendingDown,
  IndianRupee,
  Leaf,
  Sun,
  ShieldAlert,
  ArrowUpRight,
  Building2,
  ExternalLink,
  History,
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
import { PageHeader } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';
import { CountUp, FadeContent, MagicBento, MagicBentoCard, StarBorder } from '../reactbits';
import { ROOMWISE_EASE } from '../../utils/motion';

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

  const buildingsList: BuildingName[] = [
    'G+3 Block',
    'New Building',
    'Pre-Primary Block',
    'Old Building',
    'Multipurpose Hall',
  ];

  const buildingsData = buildingsList.map((name) => {
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

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 max-w-7xl mx-auto">
      {/* Title & Audit Alert */}
      <PageHeader
        kicker={
          <>
            <StarBorder active={isAdaptiveAutomationActive} innerClassName="text-[11px] font-bold">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isAdaptiveAutomationActive ? 'bg-emerald-600' : 'bg-amber-600'
                }`}
              />
              <span className="whitespace-nowrap">
                {isAdaptiveAutomationActive ? 'Adaptive Automation Active' : 'Manual Override Active'}
              </span>
            </StarBorder>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              <AcronymHint term="WBSEDCL" /> Educational <AcronymHint term="HT-2" />
            </span>
          </>
        }
        title="Campus Energy Overview"
        subtitle={`Autonomous environmental telemetry and closed-loop decisions across 25 classroom nodes in 5 blocks at ${settings.institutionName}.`}
        action={
          unresolvedAuditCount > 0 ? (
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className="flex items-center gap-3 px-3.5 py-2.5 rw-surface-interactive border-amber-300/80 hover:border-amber-400 bg-amber-50/70 rounded-xl sm:rounded-2xl text-left group relative overflow-hidden shrink-0"
            >
              <div className="absolute top-0 left-0 right-0 h-0.5 gradient-rim-amber" />
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-300/50 flex items-center justify-center text-amber-700 shrink-0">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-amber-950 flex items-center gap-1">
                  <span>{unresolvedAuditCount} Inefficiency Findings</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-amber-700 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
                <div className="text-[11px] text-amber-800 truncate max-w-[240px] sm:max-w-none">
                  Actionable phantom loads identified
                </div>
              </div>
            </button>
          ) : undefined
        }
      />

      {/* Live Campus Energy Flow Ribbon */}
      <div className="p-3.5 sm:p-4 px-4 sm:px-5 rounded-2xl glass-dark text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 overflow-hidden relative">
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/35 flex items-center justify-center text-emerald-400 shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold tracking-wide text-white">
              Autonomous Closed-Loop Energy Grid
            </div>
            <div className="text-[11px] text-emerald-100/80">
              Daylight Harvesting &amp; <AcronymHint term="BLDC" /> Modulation across 25 Campus Nodes
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-4 relative z-10 text-xs pt-2 sm:pt-0 border-t border-white/10 sm:border-0">
          <div className="text-left sm:text-right">
            <div className="text-[11px] text-emerald-300 font-mono uppercase tracking-wider">
              Available Rated Headroom (vs {liveRatedKWText} kW Max)
            </div>
            <div className="font-mono font-bold text-sm text-white">
              <CountUp
                to={campusSummary.availableHeadroomWatts / 1000}
                decimals={2}
                duration={0.75}
                delay={0.05}
                metricKey="overview-headroom"
                suffix=" kW headroom"
              />{' '}
              <span className="text-[11px] font-normal text-emerald-200 tabular-nums">
                ({campusSummary.ratedUtilizationPercent}% utilised · {campusSummary.headroomPercent}% unused)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Asymmetric Editorial Magic Bento KPI Composition (5+7 / 7+5 staggered rhythm, zero dead space) */}
      <MagicBento
        spotlightRadius={280}
        className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-3.5 sm:gap-4"
      >
        {/* Top-Left Hero Tile: Live Campus Load */}
        <MagicBentoCard
          cardId="kpi-campus-load"
          accentRimClassName="gradient-rim-emerald gradient-rim-static"
          className="md:col-span-3 lg:col-span-5 p-4 sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-neutral-800 tracking-tight">
                Campus Load
              </span>
              <div className="text-[11px] text-neutral-500 mt-0.5">
                Live Active Draw · 25 Nodes
              </div>
            </div>
            <span className="p-2 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 shrink-0">
              <Zap className="w-4 h-4" />
            </span>
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-neutral-900 font-mono tracking-tight">
              <CountUp
                to={campusSummary.totalCurrentPowerWatts / 1000}
                decimals={2}
                duration={0.8}
                delay={0.08}
                metricKey="overview-load"
              />
            </span>
            <span className="text-xs sm:text-sm font-bold text-neutral-500">kW</span>
          </div>

          <div className="mt-3.5 pt-3 border-t border-neutral-100 space-y-2">
            <div>
              <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-emerald-800 tabular-nums mb-1.5">
                <span className="flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>
                    {campusSummary.availableHeadroomWatts === 0
                      ? '100% Rated Utilisation · 0% headroom'
                      : `${campusSummary.ratedUtilizationPercent}% utilised · ${campusSummary.headroomPercent}% headroom`}
                  </span>
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-neutral-100 border border-neutral-200/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-[width] duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(4, campusSummary.ratedUtilizationPercent))}%`,
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600 tabular-nums">
              <span
                className="font-mono truncate"
                title={`Installed Rated Maximum across 25 nodes is ${liveRatedKWText} kW (${campusSummary.totalRatedPowerWatts} W). Unused capacity below nameplate max is Available Rated Headroom.`}
              >
                Installed Max: {liveRatedKWText} kW ({campusSummary.totalRatedPowerWatts.toLocaleString('en-IN')} W)
              </span>
              <span className="text-neutral-500 font-medium whitespace-nowrap">
                {campusSummary.totalRoomsOccupied} / {classrooms.length} motion active
              </span>
            </div>
          </div>
        </MagicBentoCard>

        {/* Top-Right Wide Tile: Daily Campus Energy */}
        <MagicBentoCard
          cardId="kpi-daily-energy"
          accentRimClassName="gradient-rim-blue gradient-rim-static"
          className="md:col-span-3 lg:col-span-7 p-4 sm:p-5"
        >
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-bold text-neutral-800 truncate">Daily Campus Energy</span>
            <span className="p-1.5 rounded-lg bg-sky-50 border border-sky-200/60 text-sky-700 shrink-0">
              <Sun className="w-4 h-4" />
            </span>
          </div>

          <div className="mt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-4 flex-1">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-bold text-neutral-900 font-mono">
                  <CountUp
                    to={campusSummary.dailyActualKWh}
                    decimals={1}
                    duration={0.85}
                    delay={0.11}
                    metricKey="overview-energy"
                  />
                </span>
                <span className="text-xs font-bold text-neutral-500">kWh</span>
              </div>
              <div className="mt-1.5 text-[11px] sm:text-xs text-neutral-700 font-medium tabular-nums">
                Rated Ceiling:{' '}
                <span className="font-mono font-bold text-neutral-900">
                  {campusSummary.dailyRatedCeilingKWh}
                </span>{' '}
                kWh/day
              </div>
            </div>

            <div className="sm:text-right sm:min-w-[210px] space-y-1.5">
              {(() => {
                const dailySharePct =
                  campusSummary.dailyRatedCeilingKWh > 0
                    ? Math.min(
                        100,
                        Math.round(
                          (campusSummary.dailyActualKWh / campusSummary.dailyRatedCeilingKWh) * 100
                        )
                      )
                    : 0;
                return (
                  <>
                    <div className="flex items-center sm:justify-end justify-between gap-2 text-[11px] text-neutral-600 tabular-nums">
                      <span>Daily Ceiling Ratio</span>
                      <span className="font-mono font-bold text-sky-800">{dailySharePct}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-neutral-100 border border-neutral-200/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sky-600 transition-[width] duration-300"
                        style={{ width: `${Math.max(4, dailySharePct)}%` }}
                      />
                    </div>
                  </>
                );
              })()}
              <div className="text-[11px] text-neutral-600 truncate tabular-nums">
                Month ({SCHOOL_DAYS_PER_MONTH}d): {campusSummary.monthlyActualKWh} kWh (25-node scope)
              </div>
            </div>
          </div>
        </MagicBentoCard>

        {/* Bottom-Left Wide Tile: Daily Cost Estimate */}
        <MagicBentoCard
          cardId="kpi-daily-cost"
          accentRimClassName="gradient-rim-teal gradient-rim-static"
          className="md:col-span-3 lg:col-span-7 p-4 sm:p-5"
        >
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-bold text-neutral-800 truncate">Daily Cost Estimate</span>
            <span className="p-1.5 rounded-lg bg-teal-50 border border-teal-200/60 text-teal-700 shrink-0">
              <IndianRupee className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="flex items-baseline gap-1">
              <span className="text-xs sm:text-sm font-bold text-neutral-500">₹</span>
              <span className="text-2xl sm:text-3xl font-bold text-neutral-900 font-mono">
                <CountUp
                  to={campusSummary.dailyCostINR}
                  decimals={0}
                  locale="en-IN"
                  duration={0.88}
                  delay={0.14}
                  metricKey="overview-cost"
                />
              </span>
            </div>
            <div className="sm:text-right">
              <div className="text-[11px] sm:text-xs text-emerald-800 font-bold truncate tabular-nums">
                <AcronymHint term="HT-2" /> Rate: ₹{settings.tariffPerKWhINR.toFixed(2)}/kWh
              </div>
              <div className="text-[11px] text-neutral-600 mt-0.5 truncate tabular-nums">
                Month est ({SCHOOL_DAYS_PER_MONTH}d): ₹{campusSummary.monthlyCostINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        </MagicBentoCard>

        {/* Bottom-Right Tile: Daily Grid CO2 */}
        <MagicBentoCard
          cardId="kpi-daily-co2"
          accentRimClassName="gradient-rim-emerald gradient-rim-static"
          className="md:col-span-3 lg:col-span-5 p-4 sm:p-5"
        >
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-bold text-neutral-800 truncate">Daily Grid CO₂</span>
            <span className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-200/60 text-emerald-700 shrink-0">
              <Leaf className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-bold text-neutral-900 font-mono">
                <CountUp
                  to={campusSummary.dailyEmissionsKgCO2}
                  decimals={1}
                  duration={0.84}
                  delay={0.17}
                  metricKey="overview-co2"
                />
              </span>
              <span className="text-xs font-bold text-neutral-500">kg</span>
            </div>
            <div className="sm:text-right">
              <div className="text-[11px] sm:text-xs text-teal-900 font-bold truncate tabular-nums">
                <AcronymHint term="CEA" /> Factor: {settings.gridCarbonFactorKgCO2PerKWh} kg/kWh
              </div>
              <div className="text-[11px] text-neutral-600 mt-0.5 truncate tabular-nums">
                Month ({SCHOOL_DAYS_PER_MONTH}d): {campusSummary.monthlyEmissionsTonnesCO2} t CO₂
              </div>
            </div>
          </div>
        </MagicBentoCard>
      </MagicBento>

      {/* Main Grid: Load Profile & 5 Buildings Distribution */}
      <FadeContent delay={0.05} duration={0.22}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
        <div className="lg:col-span-2 p-4 sm:p-6 rounded-2xl glass-card rw-card-alive relative overflow-hidden min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-neutral-900">
                School-Day Electrical Demand Profile (25 Nodes)
              </h3>
              <p className="text-xs text-neutral-600">
                {demandProfile.isWithinSchoolHours
                  ? `Modelled day-school load curve (${demandProfile.activeLabel} reflects active node state) vs Installed Rated Max (${liveRatedKWText} kW)`
                  : `Modelled day-school curve (07:30–14:30) + live active node state at ${demandProfile.currentTimeIst} vs Installed Rated Max (${liveRatedKWText} kW)`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold shrink-0">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-3 h-3 rounded-sm bg-emerald-600 inline-block shrink-0" />
                <span className="text-neutral-800 font-medium">Adaptive Actual</span>
              </div>
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-3 h-2 rounded-xs bg-neutral-200 border border-neutral-300 inline-block shrink-0" />
                <span className="text-neutral-600 font-normal">Installed Rated Max</span>
              </div>
            </div>
          </div>

          <div className="h-56 flex items-end gap-2 sm:gap-3 pt-8 pb-2 border-b border-neutral-200/80 overflow-x-auto">
            {hourlyData.map((d, i) => {
              const actualHeightPercent = Math.min(100, (d.actual / maxHourValue) * 100);
              const ratedHeightPercent = Math.min(100, (d.ratedMaxKW / maxHourValue) * 100);
              const isCurrent = d.isCurrent;

              return (
                <div
                  key={d.key}
                  className={`flex-1 flex flex-col items-center h-full justify-end group relative min-w-[36px] ${
                    d.isAfterHoursLive ? 'pl-2.5 sm:pl-3 border-l border-dashed border-emerald-600/35' : ''
                  }`}
                >
                  <div className="absolute top-0 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 bg-neutral-900 text-white text-[10px] py-1 px-2 rounded-lg pointer-events-none whitespace-nowrap z-20 font-mono tabular-nums shadow-md">
                    {d.hour}
                    {isCurrent ? ' IST (Live Node State)' : ' (School Schedule)'} · {d.actual} kW / {d.ratedMaxKW} kW max
                  </div>

                  <div className="w-full flex items-end justify-center gap-1 h-full">
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.36, delay: i * 0.03, ease: ROOMWISE_EASE }}
                      className="w-2.5 sm:w-3.5 bg-neutral-200/90 rounded-t origin-bottom"
                      style={{ height: `${ratedHeightPercent}%` }}
                    />
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{
                        duration: 0.4,
                        delay: 0.05 + i * 0.03,
                        ease: ROOMWISE_EASE,
                      }}
                      className={`w-2.5 sm:w-3.5 rounded-t origin-bottom transition-colors ${
                        isCurrent
                          ? 'bg-emerald-600 ring-2 ring-emerald-400/70'
                          : 'bg-emerald-500/85 group-hover:bg-emerald-600'
                      }`}
                      style={{ height: `${actualHeightPercent}%` }}
                    />
                  </div>
                  <span
                    className={`text-[11px] mt-2 font-mono tabular-nums whitespace-nowrap ${
                      isCurrent ? 'font-bold text-emerald-800' : 'text-neutral-600'
                    }`}
                  >
                    {d.isAfterHoursLive ? `${d.hour}*` : d.hour}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between text-[11px] text-neutral-600 gap-2">
            <span>Peak Daylighting: 09:30 – 13:00 (Perimeter banks dimmed)</span>
            <span className="font-bold text-emerald-800 tabular-nums">
              Rated Utilisation: {campusSummary.ratedUtilizationPercent}% ({campusSummary.headroomPercent}% unused headroom)
            </span>
          </div>
        </div>

        {/* 5 Campus Buildings Breakdown */}
        <div className="p-4 sm:p-6 rounded-2xl glass-card flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-1.5 whitespace-nowrap">
                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>5 Campus Buildings</span>
              </h3>
              <span className="text-xs text-neutral-500 font-medium truncate">{settings.institutionName.split(',')[0]}</span>
            </div>

            <div className="divide-y divide-neutral-100">
              {buildingsData.map((b) => (
                <div
                  key={b.name}
                  className="py-2.5 first:pt-1 last:pb-1"
                  title={`Installed Rated Max: ${formatCapacityKW(b.ratedWatts)} kW · Available Headroom: ${formatCapacityKW(Math.max(0, b.ratedWatts - b.watts))} kW (${b.headroomPct}%)`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-neutral-900">{b.name}</span>
                    <span className="text-[11px] font-mono font-bold text-emerald-800 tabular-nums">
                      {b.utilPct}% rated
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-baseline justify-between text-[11px]">
                    <span className="text-neutral-600">
                      {b.rooms.length} Rooms · {b.occupied} motion
                    </span>
                    <span className="font-mono font-bold text-neutral-900 tabular-nums">
                      {(b.watts / 1000).toFixed(2)}{' '}
                      <span className="font-normal text-neutral-600">
                        / {(b.ratedWatts / 1000).toFixed(2)} kW
                      </span>
                    </span>
                  </div>

                  <div className="w-full bg-neutral-200/70 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(4, b.utilPct)}%` }}
                      transition={{ duration: 0.4, ease: ROOMWISE_EASE }}
                      className="bg-emerald-600 h-full rounded-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-neutral-100 mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActiveTab('digital-twin')}
              className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1 transition-colors"
            >
              <span>Explore Digital Twin</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      </FadeContent>

      {/* Compact 7-Day Historical Summary Strip */}
      {historySnap && historySnap.series.length > 0 && (
        <FadeContent delay={0.08} duration={0.22}>
        <div className="p-4 sm:p-5 rounded-2xl glass-card flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-900">
              <History className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>7-Day Historical Consumption Snapshot (IST)</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600 tabular-nums">
              <span>
                7-Day Total:{' '}
                <strong className="font-mono text-neutral-900">
                  {historySnap.kpis.totalActualKWh} kWh
                </strong>
              </span>
              <span>
                Daily Avg:{' '}
                <strong className="font-mono text-neutral-900">
                  {historySnap.kpis.averageDailyKWh} kWh
                </strong>
              </span>
              {historySnap.series.length >= 2 && (
                <span>
                  Yesterday:{' '}
                  <strong className="font-mono text-neutral-900">
                    {historySnap.series[historySnap.series.length - 2].actualKWh} kWh
                  </strong>
                </span>
              )}
              {historySnap.series[historySnap.series.length - 1]?.isPartial && (
                <span className="text-[11px] text-amber-800 font-semibold">
                  Today: {historySnap.series[historySnap.series.length - 1].actualKWh} kWh (in progress)
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 shrink-0">
            <div className="h-10 flex items-end gap-1.5" aria-label="7-day daily kWh trend">
              {historySnap.series.map((d) => {
                const maxVal = Math.max(1, ...historySnap.series.map((s) => s.actualKWh));
                const h = Math.max(15, Math.round((d.actualKWh / maxVal) * 100));
                return (
                  <div
                    key={d.key}
                    title={`${d.label}: ${d.actualKWh} kWh${d.isPartial ? ' (partial today)' : ''}`}
                    className={`w-2.5 rounded-t ${
                      d.isPartial ? 'bg-emerald-400 border border-emerald-700/60' : 'bg-emerald-600/85'
                    }`}
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className="px-3.5 py-2 rounded-xl rw-btn-forest text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-2xs"
            >
              <span>Energy History</span>
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
            </button>
          </div>
        </div>
        </FadeContent>
      )}

      {/* 25-Classroom Spatial Matrix */}
      <FadeContent delay={0.1} duration={0.22}>
      <div className="p-4 sm:p-6 rounded-2xl glass-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-neutral-900">
              Campus Classroom Matrix (All 25 Nodes)
            </h3>
            <p className="text-xs text-neutral-500">
              Select any room to inspect daylight alpha, thermal beta, PIR history, and live appliance controls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums shrink-0">
            <span className="flex items-center gap-1.5 text-neutral-800 font-semibold whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
              <span>Motion detected ({campusSummary.totalRoomsOccupied})</span>
            </span>
            <span className="text-neutral-300 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="flex items-center gap-1.5 text-neutral-500 font-medium whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-neutral-300 shrink-0" />
              <span>No recent motion ({classrooms.length - campusSummary.totalRoomsOccupied})</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {classrooms.map((room) => {
            const isOccupied = room.occupancyStatus === 'Occupied';
            const hasOverride = room.appliances.some((a) => a.isManualOverride);

            return (
              <button
                key={room.id}
                type="button"
                onClick={() => setSelectedRoomId(room.id)}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  isOccupied
                    ? 'glass-card-interactive border-emerald-200/90'
                    : 'bg-neutral-50/75 border-neutral-200/80 text-neutral-600 hover:bg-white hover:border-neutral-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-neutral-900">
                    {room.roomCode}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {hasOverride && (
                      <span
                        className="w-2 h-2 rounded-full bg-amber-500"
                        title="Manual override active"
                      />
                    )}
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isOccupied ? 'bg-emerald-500' : 'bg-neutral-300'
                      }`}
                      title={isOccupied ? 'Motion detected' : 'No recent motion detected'}
                    />
                  </div>
                </div>

                <div className="text-xs font-bold text-neutral-900 truncate mt-1">
                  {room.name}
                </div>
                <div className="text-[10px] text-neutral-500 truncate">
                  {room.building}
                </div>

                <div className="mt-2 pt-2 border-t border-neutral-100 flex items-center justify-between text-[11px]">
                  <span className="text-neutral-800 font-mono font-bold tabular-nums">
                    {room.currentPowerWatts}W
                  </span>
                  <span className="text-neutral-500 font-mono tabular-nums">
                    {room.environment.ambientLux} lx
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      </FadeContent>
    </div>
  );
};
