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
import { AnimatedNumber } from '../common/MotionPrimitives';
import {
  ROOMWISE_EASE,
  staggerContainerVariants,
  staggerItemVariants,
} from '../../utils/motion';

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
    const base = rooms.reduce((acc, r) => acc + r.baselinePowerWatts, 0);
    const occupied = rooms.filter((r) => r.occupancyStatus === 'Occupied').length;
    const curtailedPct =
      ratedWatts > 0 ? Math.max(0, Math.round(((ratedWatts - watts) / ratedWatts) * 100)) : 0;
    const utilPct = ratedWatts > 0 ? Math.min(100, Math.round((watts / ratedWatts) * 100)) : 0;
    return { name, rooms, watts, ratedWatts, base, occupied, curtailedPct, utilPct };
  });

  const liveActualKW = Number((campusSummary.totalCurrentPowerWatts / 1000).toFixed(2));
  const liveRatedKWText = formatCapacityKW(campusSummary.totalRatedPowerWatts);
  const liveBaseKW = Number((campusSummary.totalBaselinePowerWatts / 1000).toFixed(3));
  const liveBaseKWText = formatCapacityKW(campusSummary.totalBaselinePowerWatts);
  const curtailedFromRatedPct =
    campusSummary.totalRatedPowerWatts > 0
      ? Math.max(
          0,
          Math.round(
            (campusSummary.curtailedFromRatedWatts / campusSummary.totalRatedPowerWatts) * 100
          )
        )
      : 0;
  const dailyReductionPct =
    campusSummary.dailyBaselineKWh > 0
      ? ((campusSummary.dailySavedKWh / campusSummary.dailyBaselineKWh) * 100).toFixed(1)
      : '0.0';

  const hourlyData = [
    { hour: '07:30', actual: 1.6, baseline: 3.4 },
    { hour: '08:30', actual: 3.8, baseline: 11.2 },
    { hour: '09:30', actual: 4.6, baseline: 14.8 },
    { hour: '10:30', actual: liveActualKW, baseline: liveBaseKW },
    { hour: '11:30', actual: 4.8, baseline: 15.6 },
    { hour: '12:30', actual: 2.6, baseline: 12.8 },
    { hour: '13:30', actual: 4.4, baseline: 14.2 },
    { hour: '14:30', actual: 0.8, baseline: 4.5 },
  ];

  const maxHourValue = Math.max(19, Math.ceil(liveBaseKW * 1.15));

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 max-w-7xl mx-auto">
      {/* Title & Audit Alert */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-800">
            <span className="whitespace-nowrap">Adaptive Automation Active</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">WBSEDCL Educational HT-2</span>
          </div>
          <h1 className="text-lg sm:text-2xl font-bold text-neutral-900 tracking-tight mt-0.5">
            Campus Energy Dashboard
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5 hidden sm:block">
            Autonomous environmental telemetry and closed-loop decisions across 25 classroom nodes in 5 blocks at{' '}
            {settings.institutionName}.
          </p>
        </div>

        {unresolvedAuditCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className="flex items-center gap-3 p-3 sm:px-4 sm:py-3 glass-card-interactive border-amber-300/80 hover:border-amber-400 bg-amber-50/70 rounded-xl sm:rounded-2xl text-left group relative overflow-hidden shrink-0"
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
        )}
      </div>

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
            <div className="text-[11px] text-emerald-100/75">
              Daylight Harvesting & BLDC Modulation across 25 Campus Nodes
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-4 relative z-10 text-xs pt-2 sm:pt-0 border-t border-white/10 sm:border-0">
          <div className="text-left sm:text-right">
            <div className="text-[10px] text-emerald-300 font-mono uppercase tracking-wider">
              vs Installed Rated Max ({liveRatedKWText} kW)
            </div>
            <div className="font-mono font-bold text-sm text-white">
              <AnimatedNumber
                value={campusSummary.curtailedFromRatedWatts / 1000}
                decimals={2}
                suffix=" kW curtailed"
              />{' '}
              <span className="text-[11px] font-normal text-emerald-300 tabular-nums">
                ({campusSummary.ratedUtilizationPercent}% utilised · Ref: {liveBaseKWText} kW)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Core Quantitative KPI Cards */}
      <motion.div
        variants={staggerContainerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
      >
        <motion.div
          variants={staggerItemVariants}
          className="p-3.5 sm:p-5 rounded-2xl glass-card-interactive relative overflow-hidden min-w-0"
        >
          <div className="absolute top-0 left-0 right-0 h-1 gradient-rim-emerald" />
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 truncate">Campus Load</span>
            <span className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-200/60 text-emerald-700 shrink-0">
              <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="mt-2.5 sm:mt-3 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-3xl font-bold text-neutral-900 font-mono">
              <AnimatedNumber value={campusSummary.totalCurrentPowerWatts / 1000} decimals={2} />
            </span>
            <span className="text-xs font-bold text-neutral-500">kW</span>
          </div>
          <div className="mt-1.5 text-[11px] sm:text-xs text-emerald-800 font-bold flex items-center gap-1 truncate tabular-nums">
            <TrendingDown className="w-3 h-3 text-emerald-600 shrink-0" />
            <span>
              {campusSummary.curtailedFromRatedWatts === 0
                ? '100% Rated Utilisation · 0% curtailed'
                : `${campusSummary.ratedUtilizationPercent}% utilised · ${curtailedFromRatedPct}% curtailed`}
            </span>
          </div>
          <div
            className="text-[10px] sm:text-[11px] text-neutral-400 mt-0.5 font-mono truncate tabular-nums"
            title={`Installed Rated Maximum across 25 nodes is ${liveRatedKWText} kW (${campusSummary.totalRatedPowerWatts} W). Comparative Estimated Pre-Retrofit Reference Capacity is ${liveBaseKWText} kW (${campusSummary.totalBaselinePowerWatts} W).`}
          >
            Installed Max: {liveRatedKWText} kW · Pre-Retrofit Ref: {liveBaseKWText} kW
          </div>
        </motion.div>

        <motion.div
          variants={staggerItemVariants}
          className="p-3.5 sm:p-5 rounded-2xl glass-card-interactive relative overflow-hidden min-w-0"
        >
          <div className="absolute top-0 left-0 right-0 h-1 gradient-rim-blue" />
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 truncate">Energy Conserved</span>
            <span className="p-1.5 rounded-lg bg-sky-50 border border-sky-200/60 text-sky-700 shrink-0">
              <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="mt-2.5 sm:mt-3 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-3xl font-bold text-neutral-900 font-mono">
              <AnimatedNumber value={campusSummary.dailySavedKWh} decimals={1} />
            </span>
            <span className="text-xs font-bold text-neutral-500">kWh</span>
          </div>
          <div className="mt-1.5 text-[11px] sm:text-xs text-neutral-600 font-medium truncate tabular-nums">
            Actual:{' '}
            <span className="font-mono font-bold text-neutral-900">
              {campusSummary.dailyActualKWh}
            </span>{' '}
            kWh
          </div>
          <div className="text-[10px] sm:text-[11px] text-neutral-400 mt-0.5 truncate tabular-nums">
            Est. Pre-Retrofit Ref: {campusSummary.dailyBaselineKWh} kWh (room-weighted)
          </div>
        </motion.div>

        <motion.div
          variants={staggerItemVariants}
          className="p-3.5 sm:p-5 rounded-2xl glass-card-interactive relative overflow-hidden min-w-0"
        >
          <div className="absolute top-0 left-0 right-0 h-1 gradient-rim-teal" />
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 truncate">Cost Saved Today</span>
            <span className="p-1.5 rounded-lg bg-teal-50 border border-teal-200/60 text-teal-700 shrink-0">
              <IndianRupee className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="mt-2.5 sm:mt-3 flex items-baseline gap-1">
            <span className="text-xs sm:text-sm font-bold text-neutral-500">₹</span>
            <span className="text-xl sm:text-3xl font-bold text-neutral-900 font-mono">
              <AnimatedNumber value={campusSummary.dailyCostSavedINR} decimals={0} />
            </span>
          </div>
          <div className="mt-1.5 text-[11px] sm:text-xs text-emerald-800 font-bold truncate tabular-nums">
            Rate: ₹{settings.tariffPerKWhINR.toFixed(2)}/kWh
          </div>
          <div className="text-[10px] sm:text-[11px] text-neutral-400 mt-0.5 truncate tabular-nums">
            Month est ({SCHOOL_DAYS_PER_MONTH}d): ₹{(campusSummary.dailyCostSavedINR * SCHOOL_DAYS_PER_MONTH).toFixed(0)}
          </div>
        </motion.div>

        <motion.div
          variants={staggerItemVariants}
          className="p-3.5 sm:p-5 rounded-2xl glass-card-interactive relative overflow-hidden min-w-0"
        >
          <div className="absolute top-0 left-0 right-0 h-1 gradient-rim-emerald" />
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 truncate">CO₂ Abated</span>
            <span className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-200/60 text-emerald-700 shrink-0">
              <Leaf className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </div>
          <div className="mt-2.5 sm:mt-3 flex items-baseline gap-1.5">
            <span className="text-xl sm:text-3xl font-bold text-neutral-900 font-mono">
              <AnimatedNumber value={campusSummary.dailyEmissionsAvoidedKgCO2} decimals={1} />
            </span>
            <span className="text-xs font-bold text-neutral-500">kg</span>
          </div>
          <div className="mt-1.5 text-[11px] sm:text-xs text-teal-900 font-bold truncate tabular-nums">
            CEA Factor: {settings.gridCarbonFactorKgCO2PerKWh}
          </div>
          <div className="text-[10px] sm:text-[11px] text-neutral-400 mt-0.5 truncate">
            Avoided grid emissions
          </div>
        </motion.div>
      </motion.div>

      {/* Main Grid: Load Profile & 5 Buildings Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
        <div className="lg:col-span-2 p-4 sm:p-6 rounded-2xl glass-card relative overflow-hidden min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-neutral-900">
                School-Day Electrical Demand Profile (25 Nodes)
              </h3>
              <p className="text-xs text-neutral-500">
                Modelled day-school load curve (10:30 reflects active node state) vs Pre-Retrofit Reference (Installed Max: {liveRatedKWText} kW · Ref: {liveBaseKWText} kW)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold shrink-0">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-3 h-3 rounded-sm bg-emerald-600 inline-block shrink-0" />
                <span className="text-neutral-800 font-medium">Adaptive Actual</span>
              </div>
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-3 h-2 rounded-xs bg-neutral-200 border border-neutral-300 inline-block shrink-0" />
                <span className="text-neutral-500 font-normal">Pre-Retrofit Ref</span>
              </div>
            </div>
          </div>

          <div className="h-56 flex items-end gap-2 sm:gap-3 pt-8 pb-2 border-b border-neutral-200/80 overflow-x-auto">
            {hourlyData.map((d, i) => {
              const actualHeightPercent = Math.min(100, (d.actual / maxHourValue) * 100);
              const baselineHeightPercent = Math.min(100, (d.baseline / maxHourValue) * 100);
              const isCurrent = d.hour === '10:30';

              return (
                <div
                  key={d.hour}
                  className="flex-1 flex flex-col items-center h-full justify-end group relative min-w-[34px]"
                >
                  <div className="absolute top-0 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 bg-neutral-900 text-white text-[10px] py-1 px-2 rounded-lg pointer-events-none whitespace-nowrap z-20 font-mono tabular-nums shadow-md">
                    {d.hour}
                    {isCurrent ? ' (Active Sim)' : ' (Illustrative)'} · {d.actual} kW / {d.baseline} kW ref
                  </div>

                  <div className="w-full flex items-end justify-center gap-1 h-full">
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.36, delay: i * 0.03, ease: ROOMWISE_EASE }}
                      className="w-2.5 sm:w-3.5 bg-neutral-200/90 rounded-t origin-bottom"
                      style={{ height: `${baselineHeightPercent}%` }}
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
                    className={`text-[10px] mt-2 font-mono tabular-nums ${
                      isCurrent ? 'font-bold text-emerald-800' : 'text-neutral-500'
                    }`}
                  >
                    {d.hour}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between text-[11px] text-neutral-500 gap-2">
            <span>Peak Daylighting: 09:30 – 13:00 (Perimeter banks dimmed)</span>
            <span className="font-bold text-emerald-800 tabular-nums">
              Est. Daily Diff vs Pre-Retrofit Ref: {dailyReductionPct}% (room-weighted schedule)
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
                  title={`Installed Rated Max: ${formatCapacityKW(b.ratedWatts)} kW · Pre-Retrofit Ref: ${formatCapacityKW(b.base)} kW`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-neutral-900">{b.name}</span>
                    <span className="text-[11px] font-mono font-bold text-emerald-800 tabular-nums">
                      {b.curtailedPct === 0 ? '100% max' : `-${b.curtailedPct}%`}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-baseline justify-between text-[11px]">
                    <span className="text-neutral-500">
                      {b.rooms.length} Rooms · {b.occupied} motion
                    </span>
                    <span className="font-mono font-bold text-neutral-900 tabular-nums">
                      {(b.watts / 1000).toFixed(2)}{' '}
                      <span className="font-normal text-neutral-400">
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

      {/* Compact 7-Day Historical Summary Strip */}
      {historySnap && historySnap.series.length > 0 && (
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
              className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer shadow-2xs"
            >
              <span>Energy History</span>
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* 25-Classroom Spatial Matrix */}
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
    </div>
  );
};
