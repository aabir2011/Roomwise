/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Info, Zap } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SectionHeading, TelemetryReadout } from '../common/DesignSystem';
import type { SolarWorkspaceResponse } from '../../types/solar';

interface CampusEnergyComparisonPanelProps {
  workspace: SolarWorkspaceResponse;
}

export const CampusEnergyComparisonPanel: React.FC<CampusEnergyComparisonPanelProps> = ({
  workspace,
}) => {
  const [showDisclosures, setShowDisclosures] = useState(false);
  const { roomwiseDemand, demandComparison, campusSummary } = workspace;

  return (
    <div className="space-y-5">
      {/* Power vs Energy Canonical Distinction Strip */}
      <div className="rw-surface rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-neutral-900 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-emerald-700" />
            Monitored 25-Node Load &amp; Energy Scope
          </div>
          <p className="text-[11px] text-neutral-700 leading-relaxed max-w-2xl">
            {demandComparison.demandScopeNote}
          </p>
          <p className="text-[11px] text-neutral-500 leading-relaxed max-w-2xl">
            {roomwiseDemand.annualizedEstimateDisclosure}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs shrink-0">
          <div className="px-2.5 sm:px-3 py-2 rounded-xl bg-[#f6f8f7] border border-neutral-200/80 min-w-0">
            <div className="text-[10px] text-neutral-500 whitespace-nowrap truncate">Rated Max</div>
            <div className="font-mono font-bold text-neutral-900 whitespace-nowrap">
              {roomwiseDemand.installedRatedMaxKw.toFixed(2)} kW
            </div>
          </div>
          <div className="px-2.5 sm:px-3 py-2 rounded-xl bg-[#f6f8f7] border border-neutral-200/80 min-w-0">
            <div className="text-[10px] text-neutral-500 whitespace-nowrap truncate">Pre-Retrofit</div>
            <div className="font-mono font-bold text-neutral-700 whitespace-nowrap">
              {roomwiseDemand.preRetrofitReferenceKw.toFixed(2)} kW
            </div>
          </div>
          <div className="px-2.5 sm:px-3 py-2 rounded-xl bg-emerald-50/60 border border-emerald-200/80 min-w-0">
            <div className="text-[10px] text-emerald-900 whitespace-nowrap truncate">
              {roomwiseDemand.observedWindowDays}d Energy
            </div>
            <div className="font-mono font-bold text-emerald-950 whitespace-nowrap">
              {Math.round(roomwiseDemand.observedWindowKwh).toLocaleString()} kWh
            </div>
          </div>
        </div>
      </div>

      {/* Primary Annual Comparison KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <TelemetryReadout
          label="Annual 25-Node Demand"
          value={Math.round(demandComparison.estimatedAnnualDemandKwh).toLocaleString()}
          unit="kWh/yr"
          detail={`${roomwiseDemand.observedAvgDailyKwh} kWh/day modelled avg (25 nodes)`}
          footnote="25 monitored room nodes"
        />
        <TelemetryReadout
          tone="emerald"
          label="Modelled Roof PV Potential"
          value={Math.round(demandComparison.estimatedAnnualSolarGenerationKwh).toLocaleString()}
          unit="kWh/yr"
          detail={`${campusSummary.combinedCapacityKwp} kWp · ${campusSummary.activeScenarioLabel}`}
          footnote={campusSummary.provenanceLabel}
        />
        <TelemetryReadout
          tone="forest"
          label="Est. Direct Daytime Offset"
          value={`${demandComparison.cappedDemandCoveragePercent.toFixed(1)}%`}
          detail={`${Math.round(demandComparison.estimatedDirectSelfConsumptionKwh).toLocaleString()} kWh/yr direct self-consumption`}
          footnote={`Capped at ${Math.round(demandComparison.daytimeCoincidenceFactorUsed * 100)}% daytime coincidence (no battery)`}
        />
        <TelemetryReadout
          label="Remaining Grid Import & Surplus"
          value={Math.round(demandComparison.remainingAnnualDemandKwh).toLocaleString()}
          unit="kWh/yr import"
          detail={`${Math.round(demandComparison.surplusAnnualGenerationKwh).toLocaleString()} kWh/yr potential surplus`}
          footnote="Surplus export requires WBSEDCL/WBERC approval"
        />
      </div>

      {/* Monthly Solar Generation vs Campus Demand Chart */}
      <div className="rw-surface rounded-2xl p-4 sm:p-5 space-y-4">
        <SectionHeading
          title="Monthly Solar Potential vs 25-Node Demand"
          subtitle="Compares PVGIS climatological monthly solar output across mapped roofs against 25-node modelled room demand."
        />

        <div className="h-[290px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={demandComparison.monthlyComparison}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e9e7" vertical={false} />
              <XAxis
                dataKey="monthLabel"
                tick={{ fontSize: 11, fill: '#4a5851' }}
                axisLine={{ stroke: '#d4dcd8' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#4a5851' }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#d4dcd8',
                  borderRadius: '12px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar
                dataKey="solarGenerationKwh"
                name="PVGIS Solar Generation (kWh)"
                fill="#0b5d42"
                radius={[5, 5, 0, 0]}
                maxBarSize={28}
              />
              <Line
                type="monotone"
                dataKey="estimatedMonthlyDemandKwh"
                name="Estimated Monthly Demand (kWh)"
                stroke="#334155"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="observedDemandKwh"
                name="Observed SQLite Demand (kWh)"
                stroke="#d97706"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: '#d97706' }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Collapsible Engineering Disclosures (No Invented Financial or Carbon Claims) */}
      <div className="rounded-2xl border border-neutral-200 bg-[#f8faf9] p-4">
        <button
          type="button"
          onClick={() => setShowDisclosures((v) => !v)}
          aria-expanded={showDisclosures}
          className="w-full flex items-center justify-between gap-2 text-xs font-bold text-neutral-900 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-emerald-800 shrink-0" />
            Methodological Scope &amp; Non-Fabrication Disclosure ({demandComparison.disclaimers.length})
          </span>
          {showDisclosures ? (
            <ChevronUp className="w-4 h-4 text-neutral-500 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-neutral-500 shrink-0" />
          )}
        </button>
        {showDisclosures && (
          <ul className="mt-3 pt-3 border-t border-neutral-200/70 space-y-1.5 text-xs text-neutral-600 leading-relaxed">
            {demandComparison.disclaimers.map((d, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
