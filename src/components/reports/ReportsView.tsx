/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Printer, FileText, Landmark, CheckCircle2 } from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { SCHOOL_DAYS_PER_MONTH } from '../../data/roomApplianceSpecs';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { ActionButton, PageHeader, SegmentedControl } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';
import { NationalPolicyAlignmentSection } from './NationalPolicyAlignmentSection';

type ReportsSubTab = 'summary' | 'policy';

export const ReportsView: React.FC = () => {
  const { settings, campusSummary, staffList, currentStaff } = useEnergy();
  const [activeSubTab, setActiveSubTab] = useState<ReportsSubTab>('summary');

  const handlePrint = () => {
    window.print();
  };

  const monthlyActualKWhNum = campusSummary.monthlyActualKWh;
  const monthlyRatedCeilingKWhNum = Number(
    (campusSummary.dailyRatedCeilingKWh * SCHOOL_DAYS_PER_MONTH).toFixed(1)
  );
  const monthlyCostINRNum = campusSummary.monthlyCostINR;
  const monthlyCarbonFootprintNum = campusSummary.monthlyEmissionsTonnesCO2;

  const formattedReportDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="px-4 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-7 lg:pb-10 space-y-5 sm:space-y-6 max-w-[1200px] mx-auto">
      {/* Header Controls */}
      <PageHeader
        className="print:hidden"
        kicker={
          <>
            <span>Institutional Governance &amp; Reporting</span>
            <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
            <span className="font-mono text-[#62706a]">25-Node Scope</span>
          </>
        }
        title="Energy Reports & BEE Readiness"
        subtitle={
          activeSubTab === 'summary'
            ? 'Printable institutional energy balance dossier using room-weighted school hours and WBSEDCL tariff parameters.'
            : 'Connecting India’s energy-efficiency, sustainability and renewable-energy priorities with campus-level intelligence.'
        }
        action={
          activeSubTab === 'summary' ? (
            <ActionButton
              variant="forest"
              size="md"
              onClick={handlePrint}
              icon={<Printer className="w-4 h-4 text-emerald-200" />}
            >
              Print Energy Summary
            </ActionButton>
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
            { id: 'summary', label: 'Energy Summary Dossier', icon: FileText },
            { id: 'policy', label: 'National Policy Alignment', icon: Landmark },
          ]}
        />
      </div>

      {activeSubTab === 'policy' ? (
        <NationalPolicyAlignmentSection />
      ) : (
        /* Museum-Grade Printable Engineering Dossier */
        <article className="rw-surface rounded-xl overflow-hidden print:border-none print:shadow-none">
          {/* Formal Institutional Masthead */}
          <div className="p-4 sm:p-6 lg:p-7 rw-obsidian-panel border-none rounded-none shadow-none text-white print:bg-none print:bg-white print:text-[#111916] print:border-b-2 print:border-[#111916] flex flex-col sm:flex-row sm:items-end justify-between gap-3.5 sm:gap-4">
            <div>
              <div className="text-[11px] font-mono text-emerald-300 print:text-[#0b6e4f]">
                CAMPUS ENERGY BALANCE DOSSIER · REF ROOMWISE-25NODE
              </div>
              <h2 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight mt-1">
                {settings.institutionName}
              </h2>
              <p className="text-xs text-[#9bb3a8] print:text-[#46544e] mt-1">
                {settings.campusLocation} · 25 Monitored Room Nodes across 5 Campus Blocks
              </p>
            </div>

            <div className="text-left sm:text-right font-mono text-[11px] text-[#a5bab0] print:text-[#46544e] tabular-nums space-y-0.5">
              <div className="text-white print:text-[#111916] font-semibold">
                Issued: {formattedReportDate}
              </div>
              <div>
                Tariff: <AcronymHint term="WBSEDCL" /> <AcronymHint term="HT-2" /> (₹{settings.tariffPerKWhINR.toFixed(2)}/kWh)
              </div>
              <div>
                Grid Factor: <AcronymHint term="CEA" /> {settings.gridCarbonFactorKgCO2PerKWh} kg CO₂/kWh
              </div>
            </div>
          </div>

          {/* 4-Column Quantitative Balance Ledger */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#111916]/10 border-b border-[#111916]/10">
            <div className="p-3.5 sm:p-5 bg-white">
              <div className="text-[10.5px] sm:text-[11px] font-medium text-[#46544e]">Monthly Demand</div>
              <div className="text-lg sm:text-2xl font-bold font-mono text-[#111916] mt-1 sm:mt-1.5 tabular-nums">
                <AnimatedNumber value={monthlyActualKWhNum} decimals={1} />{' '}
                <span className="text-xs font-normal text-[#62706a]">kWh</span>
              </div>
              <div className="text-[10.5px] sm:text-[11px] font-mono text-[#62706a] mt-1 tabular-nums">
                Ceiling: {monthlyRatedCeilingKWhNum.toFixed(1)} kWh max
              </div>
            </div>

            <div className="p-3.5 sm:p-5 bg-gradient-to-br from-[#f6fbf8] to-[#e9f4ee]">
              <div className="text-[10.5px] sm:text-[11px] font-semibold text-[#0b6e4f]">Rated Utilisation</div>
              <div className="text-lg sm:text-2xl font-bold font-mono text-[#08543c] mt-1 sm:mt-1.5 tabular-nums">
                <AnimatedNumber value={campusSummary.ratedUtilizationPercent} decimals={1} />
                <span className="text-xs font-normal text-[#0b6e4f]">%</span>
              </div>
              <div className="text-[10.5px] sm:text-[11px] font-mono text-[#0b6e4f] mt-1 tabular-nums">
                {campusSummary.headroomPercent}% headroom ({SCHOOL_DAYS_PER_MONTH}d/mo)
              </div>
            </div>

            <div className="p-3.5 sm:p-5 bg-white">
              <div className="text-[10.5px] sm:text-[11px] font-medium text-[#46544e]">Est. Monthly Cost</div>
              <div className="text-lg sm:text-2xl font-bold font-mono text-[#111916] mt-1 sm:mt-1.5 tabular-nums">
                <AnimatedNumber value={monthlyCostINRNum} decimals={2} prefix="₹" />
              </div>
              <div className="text-[10.5px] sm:text-[11px] font-mono text-[#62706a] mt-1 tabular-nums">
                ₹{settings.tariffPerKWhINR}/kWh (25-node scope)
              </div>
            </div>

            <div className="p-3.5 sm:p-5 bg-white">
              <div className="text-[10.5px] sm:text-[11px] font-medium text-[#46544e]">Est. Monthly Emissions</div>
              <div className="text-lg sm:text-2xl font-bold font-mono text-[#111916] mt-1 sm:mt-1.5 tabular-nums">
                <AnimatedNumber value={monthlyCarbonFootprintNum} decimals={2} />{' '}
                <span className="text-xs font-normal text-[#62706a]">t CO₂</span>
              </div>
              <div className="text-[10.5px] sm:text-[11px] font-mono text-[#62706a] mt-1 tabular-nums">
                <AcronymHint term="CEA" /> Eastern Grid
              </div>
            </div>
          </div>

          {/* Reference Operating Scenario (ROS) & Modelled Avoidance Reconciliation */}
          <div className="px-4 py-3.5 sm:px-6 bg-[#f7faf8] border-b border-[#111916]/10 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-[10.5px] font-medium text-[#46544e]">
                Monthly <AcronymHint term="ROS" />
              </div>
              <div className="font-mono font-bold text-[#111916] mt-0.5 tabular-nums">
                {campusSummary.monthlyRosKWh.toFixed(1)} kWh
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-medium text-[#46544e]">
                ROOMWISE Adaptive Operation
              </div>
              <div className="font-mono font-bold text-[#111916] mt-0.5 tabular-nums">
                {monthlyActualKWhNum.toFixed(1)} kWh
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-medium text-[#0b6e4f]">
                Modelled Energy Avoided
              </div>
              <div className="font-mono font-bold text-[#08543c] mt-0.5 tabular-nums">
                {campusSummary.monthlyAvoidedKWh.toFixed(1)} kWh ({campusSummary.rosSavingsPercent}%)
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-medium text-[#0b6e4f]">
                Modelled Cost Avoided
              </div>
              <div className="font-mono font-bold text-[#08543c] mt-0.5 tabular-nums">
                ₹{campusSummary.monthlyCostAvoidedINR.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-5">
            {/* BEE / ECBC Readiness Qualification */}
            <div className="px-4 py-3.5 rounded-lg border border-[#111916]/10 bg-[#f8f9f7] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#46544e]">
              <div className="leading-relaxed">
                <strong className="text-[#111916]">
                  <AcronymHint term="BEE" /> / <AcronymHint term="ECBC" /> Readiness Qualification:
                </strong>{' '}
                Formal whole-campus EPI and BEE Star certification require 12-month utility bills, surveyed built-up area, and accredited inspection.
              </div>
              <span className="text-[11px] font-mono text-[#62706a] shrink-0">
                Internal reference
              </span>
            </div>

            {/* Institutional Review & Sign-off Routing Table */}
            <div className="space-y-3">
              <div className="font-display text-xs font-bold text-[#111916]">
                Internal Review &amp; Verification Sign-Off
              </div>

              <div className="border border-[#111916]/12 rounded-lg overflow-hidden grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#111916]/10">
                {[
                  { staff: currentStaff, roleLabel: 'Prepared By' },
                  { staff: staffList[1], roleLabel: 'Meter Audit' },
                  { staff: staffList[2], roleLabel: 'Principal Sign-Off' },
                ].map(({ staff, roleLabel }) => (
                  <div key={roleLabel} className="p-4 flex flex-col justify-between gap-4 bg-white">
                    <div>
                      <div className="text-[10px] font-mono text-[#62706a]">{roleLabel}</div>
                      <div className="font-display text-sm font-bold text-[#111916] mt-1">
                        {staff.name}
                      </div>
                      <div className="text-[11px] text-[#46544e] mt-0.5">{staff.role}</div>
                    </div>
                    <div className="pt-3 border-t border-dashed border-[#111916]/15 flex items-center justify-between text-[11px]">
                      <span className="font-mono text-[#62706a]">{formattedReportDate}</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[#0b6e4f] font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>SIGNED</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Formal Dossier Footer */}
            <div className="pt-4 border-t border-[#111916]/10 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-[#62706a]">
              <span>ROOMWISE Campus Intelligence Platform · {settings.institutionName}</span>
              <span className="font-mono">
                Modelled 25-node scope · {SCHOOL_DAYS_PER_MONTH} school days/month
              </span>
            </div>
          </div>
        </article>
      )}
    </div>
  );
};
