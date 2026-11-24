/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Printer,
  FileText,
  Landmark,
  CheckCircle2,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { SCHOOL_DAYS_PER_MONTH } from '../../data/roomApplianceSpecs';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { PageHeader, SegmentedControl } from '../common/DesignSystem';
import { NationalPolicyAlignmentSection } from './NationalPolicyAlignmentSection';

type ReportsSubTab = 'summary' | 'policy';

export const ReportsView: React.FC = () => {
  const { settings, campusSummary, staffList, currentStaff } = useEnergy();
  const [activeSubTab, setActiveSubTab] = useState<ReportsSubTab>('summary');

  const handlePrint = () => {
    window.print();
  };

  const monthlyActualKWhNum = campusSummary.dailyActualKWh * SCHOOL_DAYS_PER_MONTH;
  const monthlyBaselineKWhNum = campusSummary.dailyBaselineKWh * SCHOOL_DAYS_PER_MONTH;
  const monthlySavedKWhNum = campusSummary.dailySavedKWh * SCHOOL_DAYS_PER_MONTH;
  const monthlySavingsINRNum = campusSummary.dailyCostSavedINR * SCHOOL_DAYS_PER_MONTH;
  const monthlyCarbonAbatementNum =
    (campusSummary.dailyEmissionsAvoidedKgCO2 * SCHOOL_DAYS_PER_MONTH) / 1000;
  const efficiencyPct =
    campusSummary.dailyBaselineKWh > 0
      ? ((campusSummary.dailySavedKWh / campusSummary.dailyBaselineKWh) * 100).toFixed(1)
      : '0.0';

  const formattedReportDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      {/* Header Controls */}
      <PageHeader
        className="print:hidden"
        kicker={
          <>
            <span>Energy Reporting · 25-Node Scope</span>
            <span aria-hidden="true">·</span>
            <span>DAV Model School, IIT Kharagpur</span>
          </>
        }
        title="Energy Reports & BEE Readiness Summary"
        subtitle={
          activeSubTab === 'summary'
            ? 'Printable operational energy summary across 25 monitored rooms using room-weighted school hours and WBSEDCL tariff parameters.'
            : 'Connecting India’s energy-efficiency, sustainability and renewable-energy priorities with campus-level intelligence.'
        }
        action={
          activeSubTab === 'summary' ? (
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rw-btn-forest text-xs font-semibold rounded-xl shadow-xs shrink-0 whitespace-nowrap"
            >
              <Printer className="w-4 h-4 text-emerald-300" />
              <span>Print Energy Summary</span>
            </button>
          ) : undefined
        }
      />

      {/* Section Switcher */}
      <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<ReportsSubTab>
          ariaLabel="Reports & BEE sections"
          layoutId="reports-subtab-indicator"
          value={activeSubTab}
          onChange={setActiveSubTab}
          options={[
            { id: 'summary', label: 'Energy Summary', icon: FileText },
            { id: 'policy', label: 'National Policy Alignment', icon: Landmark },
          ]}
        />
      </div>

      {activeSubTab === 'policy' ? (
        <NationalPolicyAlignmentSection />
      ) : (
        /* Summary Sheet (Printable) */
        <div className="rw-surface rounded-2xl p-4 sm:p-8 space-y-6 print:border-none print:shadow-none print:p-0">
          {/* Institutional Letterhead */}
          <div className="border-b-2 border-neutral-900 pb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs uppercase tracking-wider">
                <FileText className="w-4 h-4 shrink-0" />
                <span>Campus Energy Balance Summary</span>
              </div>
              <h2 className="text-2xl font-black text-neutral-900 tracking-tight mt-1">
                {settings.institutionName}
              </h2>
              <p className="text-xs text-neutral-600 mt-0.5">
                {settings.campusLocation} · 25 Monitored Room Nodes across 5 Campus Blocks
              </p>
            </div>

            <div className="text-left sm:text-right font-mono text-xs text-neutral-600 tabular-nums">
              <div className="font-bold text-neutral-900">REF: ROOMWISE-25NODE</div>
              <div>Generated: {formattedReportDate}</div>
              <div>Tariff: WBSEDCL HT-2 (₹{settings.tariffPerKWhINR.toFixed(2)}/kWh)</div>
            </div>
          </div>

          {/* 4 Quantitative Balance Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-3.5 sm:p-4 rounded-xl border border-neutral-200/90">
              <div className="text-[11px] text-neutral-500 font-medium">Monthly Demand</div>
              <div className="text-lg sm:text-xl font-bold font-mono text-neutral-900 mt-1 tabular-nums">
                <AnimatedNumber value={monthlyActualKWhNum} decimals={1} />{' '}
                <span className="text-xs font-normal text-neutral-500">kWh</span>
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5 tabular-nums">
                vs {monthlyBaselineKWhNum.toFixed(1)} kWh Pre-Retrofit Ref
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 rw-card-alive print:bg-emerald-50">
              <div className="text-[11px] text-emerald-800 font-medium">Est. Energy Saved</div>
              <div className="text-lg sm:text-xl font-bold font-mono text-emerald-900 mt-1 tabular-nums">
                <AnimatedNumber value={monthlySavedKWhNum} decimals={1} />{' '}
                <span className="text-xs font-normal text-emerald-800/80">kWh</span>
              </div>
              <div className="text-[11px] text-emerald-800 font-semibold mt-0.5 tabular-nums">
                {efficiencyPct}% vs Ref ({SCHOOL_DAYS_PER_MONTH} school days/mo)
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl border border-neutral-200/90">
              <div className="text-[11px] text-neutral-500 font-medium">Est. Cost Savings</div>
              <div className="text-lg sm:text-xl font-bold font-mono text-neutral-900 mt-1 tabular-nums">
                <AnimatedNumber value={monthlySavingsINRNum} decimals={2} prefix="₹" />
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5 tabular-nums">
                Tariff: ₹{settings.tariffPerKWhINR}/kWh (25-node scope)
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl border border-neutral-200/90">
              <div className="text-[11px] text-neutral-500 font-medium">Est. Carbon Offset</div>
              <div className="text-lg sm:text-xl font-bold font-mono text-neutral-900 mt-1 tabular-nums">
                <AnimatedNumber value={monthlyCarbonAbatementNum} decimals={2} />{' '}
                <span className="text-xs font-normal text-neutral-500">t CO₂</span>
              </div>
              <div className="text-[11px] text-neutral-500 mt-0.5 tabular-nums">
                CEA Eastern Grid: {settings.gridCarbonFactorKgCO2PerKWh} kg/kWh
              </div>
            </div>
          </div>

          {/* Subtle BEE / ECBC Readiness Reference Strip */}
          <div className="px-4 py-3 rounded-xl border border-neutral-200/80 bg-neutral-50/75 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-600">
            <div>
              <span className="font-semibold text-neutral-800">BEE / ECBC Readiness:</span>{' '}
              Formal whole-campus EPI and BEE Star certification require 12-month utility bills, surveyed built-up area, and accredited inspection.
            </div>
            <span className="text-[11px] font-mono text-neutral-500 shrink-0">
              Internal reference
            </span>
          </div>

          {/* Review & Sign-off Routing */}
          <div className="pt-6 border-t border-neutral-200 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-neutral-700">
              Internal Review &amp; Verification Routing
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-3">
                <div>
                  <div className="text-xs font-bold text-neutral-900">{currentStaff.name}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5">{currentStaff.role}</div>
                </div>
                <div className="pt-3 border-t border-dashed border-neutral-300 flex items-center justify-between text-[11px] text-neutral-500">
                  <span>Prepared By</span>
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>SIGNED</span>
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-3">
                <div>
                  <div className="text-xs font-bold text-neutral-900">{staffList[1].name}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5">{staffList[1].role}</div>
                </div>
                <div className="pt-3 border-t border-dashed border-neutral-300 flex items-center justify-between text-[11px] text-neutral-500">
                  <span>Meter Audit</span>
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>SIGNED</span>
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-3">
                <div>
                  <div className="text-xs font-bold text-neutral-900">{staffList[2].name}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5">{staffList[2].role}</div>
                </div>
                <div className="pt-3 border-t border-dashed border-neutral-300 flex items-center justify-between text-[11px] text-neutral-500">
                  <span>Principal Sign-Off</span>
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>SIGNED</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Subtle Footer */}
          <div className="pt-4 border-t border-neutral-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-neutral-400">
            <span>
              Generated by ROOMWISE Energy Platform · DAV Model School, IIT Kharagpur
            </span>
            <span className="font-mono">
              Modelled 25-node scope · {SCHOOL_DAYS_PER_MONTH} school days/mo
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
