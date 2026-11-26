/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Leaf,
  School,
  Sun,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { InlineActionLink, SectionHeading } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';

interface OfficialSourceLink {
  label: string;
  url: string;
}

interface PolicyAlignmentItem {
  index: string;
  id: string;
  themeLabel: string;
  initiativeName: string;
  organisation: string;
  isPrincipal?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  policyObjective: string;
  roomwiseContribution: string;
  scopeQualification?: string;
  relatedModule: {
    tabId: string;
    label: string;
  };
  sources: OfficialSourceLink[];
}

const POLICY_ALIGNMENTS: PolicyAlignmentItem[] = [
  {
    index: '01',
    id: 'bee',
    themeLabel: '01 — National Energy Efficiency',
    initiativeName: 'Bureau of Energy Efficiency (BEE)',
    organisation: 'Ministry of Power, Government of India',
    isPrincipal: true,
    icon: Building2,
    policyObjective:
      'Advances building energy conservation, institutional metering discipline, and occupancy- and daylight-responsive lighting controls across public buildings.',
    roomwiseContribution:
      'Delivers 25-node occupancy/daylight control, ROS-benchmarked energy tracking, and automated audit diagnostics across five campus blocks.',
    relatedModule: {
      tabId: 'audit',
      label: 'Open Energy Audit',
    },
    sources: [
      {
        label: 'Bureau of Energy Efficiency (BEE)',
        url: 'https://beeindia.gov.in/',
      },
    ],
  },
  {
    index: '02',
    id: 'mission-life',
    themeLabel: '02 — Sustainable Lifestyles',
    initiativeName: 'Mission LiFE — Lifestyle for Environment',
    organisation: 'Ministry of Environment, Forest and Climate Change (MoEF&CC)',
    icon: Leaf,
    policyObjective:
      'Promotes everyday resource conservation under its Save Energy theme, eliminating standby waste and unused appliance runtime.',
    roomwiseContribution:
      'Automates PIR vacancy shutoff and BLDC fan modulation across school schedules, reducing reliance on manual switching between periods.',
    relatedModule: {
      tabId: 'classrooms',
      label: 'View Classrooms (25)',
    },
    sources: [
      {
        label: 'Mission LiFE Portal',
        url: 'https://missionlife-moefcc.nic.in/',
      },
      {
        label: 'MoEF&CC',
        url: 'https://moef.gov.in/',
      },
    ],
  },
  {
    index: '03',
    id: 'pm-shri',
    themeLabel: '03 — Green Educational Infrastructure',
    initiativeName: 'PM SHRI & Green School Objectives',
    organisation: 'Department of School Education & Literacy · Ministry of Education',
    icon: School,
    policyObjective:
      'Encourages eco-conscious school infrastructure combining LED efficiency, solar awareness, and resource-transparent campus operations.',
    roomwiseContribution:
      'Provides room-by-room energy visibility, occupancy-aware space allocation, and student-accessible environmental telemetry.',
    scopeQualification:
      'Context only — D A V Model School, IIT Kharagpur is not represented as a PM SHRI participant or recipient.',
    relatedModule: {
      tabId: 'analytics',
      label: 'Open Energy Analytics',
    },
    sources: [
      {
        label: 'PM SHRI Schools Portal',
        url: 'https://pmshrischools.education.gov.in/',
      },
    ],
  },
  {
    index: '04',
    id: 'mnre',
    themeLabel: '04 — Renewable Energy',
    initiativeName: 'Ministry of New and Renewable Energy (MNRE)',
    organisation: 'Government of India',
    icon: Sun,
    policyObjective:
      'Supports structured institutional adoption of grid-connected rooftop solar generation and clean daytime load matching.',
    roomwiseContribution:
      'Models rooftop kWp capacity and monthly PVGIS yield over verified campus building footprints for preliminary solar feasibility.',
    scopeQualification:
      'Preliminary feasibility only — requires on-site structural, shading, and WBERC net-metering assessment.',
    relatedModule: {
      tabId: 'environmental-solar',
      label: 'Open Environmental & Solar',
    },
    sources: [
      {
        label: 'MNRE Official Portal',
        url: 'https://mnre.gov.in/',
      },
    ],
  },
];

export const NationalPolicyAlignmentSection: React.FC = () => {
  const { setActiveTab } = useEnergy();

  return (
    <section
      aria-labelledby="policy-alignment-heading"
      className="space-y-4 sm:space-y-5"
    >
      {/* Compact Header */}
      <div className="rounded-xl border border-[#111916]/12 bg-white px-5 py-4 sm:px-6 sm:py-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1 max-w-2xl">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] font-semibold text-[#0b6e4f]">
            Institutional Policy Context · India
          </div>
          <h2
            id="policy-alignment-heading"
            className="font-display text-lg sm:text-xl font-bold text-[#111916] tracking-tight leading-snug"
          >
            ROOMWISE &amp; National Sustainability Frameworks
          </h2>
          <p className="text-xs sm:text-[13px] text-[#47534d] leading-relaxed">
            Concise alignment between public-sector policy objectives and ROOMWISE&apos;s campus intelligence capabilities.
          </p>
        </div>

        <div className="text-[11px] font-mono text-[#5c6862] tabular-nums shrink-0">
          4 Frameworks · Verified Official Portals
        </div>
      </div>

      {/* Four Clean, Scannable Policy Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {POLICY_ALIGNMENTS.map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={item.id}
              className={`rounded-xl border bg-white p-5 flex flex-col justify-between gap-4 ${
                item.isPrincipal ? 'border-[#0b6e4f]/30' : 'border-[#111916]/12'
              }`}
            >
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      <span className="font-mono font-semibold text-[#0b6e4f]">
                        {item.themeLabel}
                      </span>
                      {item.isPrincipal && (
                        <>
                          <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
                          <span className="font-semibold text-[#111916]">Principal Alignment</span>
                        </>
                      )}
                    </div>
                    <h3 className="font-display text-[15px] sm:text-base font-bold text-[#111916] tracking-tight leading-snug">
                      {item.initiativeName}
                    </h3>
                    <div className="text-[11px] text-[#5c6862]">{item.organisation}</div>
                  </div>

                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      item.isPrincipal
                        ? 'bg-[#0b1713] text-[#34d399]'
                        : 'bg-[#f4f5f3] border border-[#111916]/10 text-[#0b6e4f]'
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                {/* Clear 2-Row Separation: Policy Objective vs ROOMWISE Contribution */}
                <div className="border-y border-neutral-200/80 divide-y divide-neutral-200/70">
                  <div className="py-2.5 space-y-0.5">
                    <div className="text-[10px] font-mono uppercase tracking-[0.08em] font-semibold text-[#64726b]">
                      Policy Objective
                    </div>
                    <p className="text-xs text-[#4a5851] leading-relaxed">
                      {item.policyObjective}
                    </p>
                  </div>

                  <div className="py-2.5 space-y-0.5">
                    <div className="text-[10px] font-mono uppercase tracking-[0.08em] font-semibold text-[#0b6e4f]">
                      ROOMWISE Contribution
                    </div>
                    <p className="text-xs text-[#111815] leading-relaxed font-medium">
                      {item.roomwiseContribution}
                    </p>
                  </div>
                </div>

                {item.scopeQualification && (
                  <p className="text-[11px] text-[#64726b] leading-relaxed">
                    {item.scopeQualification}
                  </p>
                )}
              </div>

              {/* Card Footer: Verified Official Links + Module Jump */}
              <div className="pt-1 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  {item.sources.map((src) => (
                    <a
                      key={src.url}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline decoration-emerald-700/35 hover:decoration-emerald-800 underline-offset-2 transition-colors"
                    >
                      <span>{src.label}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ))}
                </div>

                <InlineActionLink
                  tone="neutral"
                  onClick={() => setActiveTab(item.relatedModule.tabId)}
                  trailingIcon={<ArrowRight className="w-3 h-3" aria-hidden="true" />}
                  className="shrink-0"
                >
                  {item.relatedModule.label}
                </InlineActionLink>
              </div>
            </article>
          );
        })}
      </div>

      {/* Compact Technical Reference: Energy Conservation Building Code (ECBC) */}
      <div className="rounded-xl border border-[#111916]/12 bg-white p-5 space-y-3">
        <SectionHeading
          title={<>Technical Reference: Energy Conservation Building Code (<AcronymHint term="ECBC" />)</>}
          meta={<><AcronymHint term="BEE" /> Reference Framework</>}
          action={
            <a
              href="https://beeindia.gov.in/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0b6e4f] hover:text-[#0b1713] underline decoration-[#0b6e4f]/35 hover:decoration-[#0b6e4f] underline-offset-2 transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>BEE Portal</span>
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </a>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[#47534d] leading-relaxed">
          <p>
            <strong className="text-[#111916]">Referenced Practices:</strong>{' '}
            <AcronymHint term="ECBC" /> outlines automatic lighting shutoff, occupancy sensors in enclosed rooms, and daylight-responsive perimeter controls—providing technical context for ROOMWISE&apos;s classroom architecture.
          </p>
          <p>
            <strong className="text-[#111916]">Applicability Boundary:</strong> Mandatory <AcronymHint term="ECBC" /> rules depend on connected load, built-up area, and state notification; ROOMWISE makes no compliance or certification claim.
          </p>
        </div>
      </div>

      {/* Mandatory Independence Clarification */}
      <div
        role="note"
        aria-label="Independent project notice"
        className="px-4 sm:px-5 py-3.5 rounded-xl bg-[#ecefe9]/85 border border-[#111916]/10 text-xs text-[#111916] leading-relaxed"
      >
        ROOMWISE is an independently developed student project. Its alignment with these initiatives
        does not imply government sponsorship, endorsement, certification or formal regulatory
        compliance.
      </div>
    </section>
  );
};
