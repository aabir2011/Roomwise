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
import { SectionHeading } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';

interface OfficialSourceLink {
  label: string;
  url: string;
  note?: string;
}

interface PolicyAlignmentItem {
  index: string;
  id: string;
  initiativeName: string;
  organisation: string;
  isPrincipal?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  policyObjective: string;
  nationalObjective: string;
  roomwiseCapability: string;
  institutionalRelevance: string;
  roomwiseConnection: string;
  scopeQualification?: string;
  relatedModule?: {
    tabId: string;
    label: string;
  };
  sources: OfficialSourceLink[];
  accessedDate: string;
}

const POLICY_ALIGNMENTS: PolicyAlignmentItem[] = [
  {
    index: '01',
    id: 'bee',
    initiativeName: 'Bureau of Energy Efficiency (BEE)',
    organisation: 'Ministry of Power, Government of India',
    isPrincipal: true,
    icon: Building2,
    policyObjective:
      'Advances national energy conservation, building-level energy management, awareness and education, and automated lighting control practices such as occupancy-responsive shutoff where referenced in official building-efficiency frameworks.',
    nationalObjective: 'Building-level energy conservation & efficiency',
    roomwiseCapability:
      'Occupancy-responsive classroom operation, Energy Analytics & Energy Audit',
    institutionalRelevance:
      'Clearer room-level visibility to support informed institutional energy management',
    roomwiseConnection:
      'Connects ROOMWISE’s occupancy- and daylight-responsive classroom controls with structured 25-node energy monitoring, audit diagnostics, and institutional energy-balance summaries.',
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
    accessedDate: 'Verified Nov 2026',
  },
  {
    index: '02',
    id: 'mission-life',
    initiativeName: 'Mission LiFE — Lifestyle for Environment',
    organisation: 'Ministry of Environment, Forest and Climate Change (MoEF&CC)',
    icon: Leaf,
    policyObjective:
      'Encourages everyday resource-conscious habits under its Save Energy theme—including switching off unused appliances, using efficient LED lighting, adopting smart switches, and avoiding unnecessary standby draw.',
    nationalObjective: 'Responsible everyday energy-use practices',
    roomwiseCapability:
      'Automated classroom responses to occupancy & daylight conditions',
    institutionalRelevance:
      'Translates conservation practices into infrastructure-level automation with reduced reliance on manual switch-off',
    roomwiseConnection:
      'Supports energy-conscious operation across active school schedules by reducing dependence on manual switch-off between periods and after classes conclude.',
    relatedModule: {
      tabId: 'classrooms',
      label: 'View Classrooms (25)',
    },
    sources: [
      {
        label: 'Mission LiFE Official Portal',
        url: 'https://missionlife-moefcc.nic.in/',
      },
      {
        label: 'About Mission LiFE',
        url: 'https://missionlife-moefcc.nic.in/aboutLiFE.php',
      },
      {
        label: 'MoEF&CC',
        url: 'https://moef.gov.in/',
      },
    ],
    accessedDate: 'Verified Nov 2026',
  },
  {
    index: '03',
    id: 'pm-shri',
    initiativeName: 'PM SHRI & Green School Objectives',
    organisation: 'Department of School Education & Literacy · Ministry of Education',
    icon: School,
    policyObjective:
      'Promotes sustainable, resource-conscious school environments (“Green Schools”) integrating energy conservation, LED efficiency, solar awareness, environmental education, and eco-conscious campus operations.',
    nationalObjective: 'Sustainable, resource-conscious school infrastructure',
    roomwiseCapability:
      'Campus-level visibility, classroom monitoring, energy auditing & solar assessment',
    institutionalRelevance:
      'Improves institutional visibility into classroom energy demand and environmental planning',
    roomwiseConnection:
      'Reflects broader Green School sustainability themes through campus energy visibility, classroom monitoring, operational audits, and environmental assessment.',
    scopeQualification:
      'Included solely for broader policy context. DAV Model School, IIT Kharagpur is not represented as a PM SHRI school, scheme participant, or funding recipient.',
    relatedModule: {
      tabId: 'analytics',
      label: 'Open Energy Analytics',
    },
    sources: [
      {
        label: 'PM SHRI Schools Official Portal',
        url: 'https://pmshrischools.education.gov.in/',
      },
    ],
    accessedDate: 'Verified Nov 2026',
  },
  {
    index: '04',
    id: 'mnre',
    initiativeName: 'Ministry of New and Renewable Energy (MNRE)',
    organisation: 'Government of India',
    icon: Sun,
    policyObjective:
      'Guides national renewable-energy adoption, grid-connected rooftop solar expansion, and structured solar capacity planning across institutional and public infrastructure.',
    nationalObjective: 'Renewable-energy adoption & rooftop solar planning',
    roomwiseCapability:
      'PVGIS-based solar feasibility modelling & capacity estimation',
    institutionalRelevance:
      'Enables structured, preliminary evaluation of campus rooftop solar potential',
    roomwiseConnection:
      'Connects directly to ROOMWISE’s Environmental & Solar Intelligence module, which uses PVGIS irradiance data to estimate monthly generation and illustrative rooftop array sizing.',
    scopeQualification:
      'Planning reference only. ROOMWISE is not affiliated with PM Surya Ghar and its solar assessment does not indicate government subsidy eligibility.',
    relatedModule: {
      tabId: 'environmental-solar',
      label: 'Open Environmental & Solar',
    },
    sources: [
      {
        label: 'MNRE Grid-Connected Rooftop Solar Programme',
        url: 'https://mnre.gov.in/en/grid-connected-rooftop-solar-programme',
      },
      {
        label: 'MNRE Official Portal',
        url: 'https://mnre.gov.in/',
      },
    ],
    accessedDate: 'Verified Nov 2026',
  },
];

export const NationalPolicyAlignmentSection: React.FC = () => {
  const { setActiveTab } = useEnergy();

  return (
    <section
      aria-labelledby="policy-alignment-heading"
      className="space-y-5 sm:space-y-6"
    >
      {/* Section Overview Header */}
      <div className="rw-surface rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-4 border-b border-neutral-200/75">
          <div className="space-y-1 max-w-2xl">
            <div className="text-[11px] font-semibold tracking-wide text-emerald-800">
              Institutional Policy Context · India
            </div>
            <h2
              id="policy-alignment-heading"
              className="text-lg sm:text-xl font-bold text-[#111815] tracking-tight leading-snug"
            >
              ROOMWISE &amp; India&apos;s Sustainability Priorities
            </h2>
            <p className="text-xs sm:text-[13px] text-[#4a5851] leading-relaxed">
              Connecting national energy-efficiency objectives with practical campus-level intelligence.
            </p>
          </div>

          <div className="text-[11px] font-mono text-[#64726b] tabular-nums shrink-0">
            4 Policy Frameworks · Official Sources Linked
          </div>
        </div>

        {/* Relationship Structure Legend */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] text-[#4a5851]">
          <span className="font-semibold text-[#111815]">Mapping Structure:</span>
          <span>National objective</span>
          <ArrowRight className="w-3 h-3 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>ROOMWISE capability</span>
          <ArrowRight className="w-3 h-3 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>Practical institutional relevance</span>
        </div>
      </div>

      {/* Four Policy Alignment Cards — Responsive 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {POLICY_ALIGNMENTS.map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={item.id}
              className={`rw-surface rounded-2xl p-5 sm:p-6 flex flex-col justify-between gap-4 ${
                item.isPrincipal ? 'border-emerald-700/25 rw-card-alive-alt' : ''
              }`}
            >
              <div className="space-y-4">
                {/* Card Header: Clean text-based identity, zero pills/logos */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#64726b]">
                      <span className="font-mono font-semibold text-emerald-800 tabular-nums">
                        {item.index}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.organisation}</span>
                      {item.isPrincipal && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-emerald-800">
                            Principal Technical Alignment
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="text-[15px] sm:text-base font-bold text-[#111815] tracking-tight leading-snug">
                      {item.initiativeName}
                    </h3>
                  </div>

                  <div
                    className="w-9 h-9 rounded-xl bg-[#eef3f0] border border-emerald-700/15 text-emerald-800 flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                {/* Short Policy Objective */}
                <p className="text-xs text-[#4a5851] leading-relaxed">
                  {item.policyObjective}
                </p>

                {/* Structured Relationship Chain (hairline separated, no nested cards) */}
                <div className="border-y border-neutral-200/80 py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-0 sm:divide-x sm:divide-neutral-200/80">
                  <div className="sm:pr-3 space-y-1">
                    <div className="text-[10px] font-semibold tracking-wide text-[#64726b]">
                      National Objective
                    </div>
                    <div className="text-xs font-medium text-[#111815] leading-snug">
                      {item.nationalObjective}
                    </div>
                  </div>

                  <div className="sm:px-3 space-y-1">
                    <div className="text-[10px] font-semibold tracking-wide text-emerald-800 flex items-center gap-1">
                      <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>ROOMWISE Capability</span>
                    </div>
                    <div className="text-xs font-medium text-[#111815] leading-snug">
                      {item.roomwiseCapability}
                    </div>
                  </div>

                  <div className="sm:pl-3 space-y-1">
                    <div className="text-[10px] font-semibold tracking-wide text-[#64726b] flex items-center gap-1">
                      <ArrowRight className="w-3 h-3 text-emerald-700 shrink-0" aria-hidden="true" />
                      <span>Institutional Relevance</span>
                    </div>
                    <div className="text-xs font-medium text-[#111815] leading-snug">
                      {item.institutionalRelevance}
                    </div>
                  </div>
                </div>

                {/* ROOMWISE Connection & Scope Qualification */}
                <div className="space-y-1.5">
                  <p className="text-xs text-[#4a5851] leading-relaxed">
                    <span className="font-semibold text-[#111815]">ROOMWISE connection:</span>{' '}
                    {item.roomwiseConnection}
                  </p>
                  {item.scopeQualification && (
                    <p className="text-[11px] text-[#64726b] leading-relaxed">
                      {item.scopeQualification}
                    </p>
                  )}
                </div>
              </div>

              {/* Footer: Official Sources & Optional Module Jump */}
              <div className="pt-3 border-t border-neutral-200/70 flex flex-col sm:flex-row sm:items-end justify-between gap-2.5">
                <div className="space-y-1 min-w-0">
                  <div className="text-[10px] font-mono text-[#64726b] tabular-nums">
                    Official Source · {item.accessedDate}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                </div>

                {item.relatedModule && (
                  <button
                    type="button"
                    onClick={() => setActiveTab(item.relatedModule!.tabId)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4a5851] hover:text-[#111815] transition-colors whitespace-nowrap shrink-0 self-start sm:self-end"
                  >
                    <span>{item.relatedModule.label}</span>
                    <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Compact Technical Reference: Energy Conservation Building Code (ECBC) */}
      <div className="rw-surface rounded-2xl p-5 sm:p-6 space-y-4">
        <SectionHeading
          title={<>Technical Reference: Energy Conservation Building Code (<AcronymHint term="ECBC" />)</>}
          meta={<><AcronymHint term="BEE" /> Building-Efficiency Framework</>}
          subtitle="Contextual engineering reference for automated lighting controls and occupancy sensing."
          action={
            <a
              href="https://beeindia.gov.in/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline decoration-emerald-700/35 hover:decoration-emerald-800 underline-offset-2 transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>BEE Portal</span>
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </a>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 text-xs text-[#4a5851] leading-relaxed">
          <div className="space-y-1.5">
            <div className="font-semibold text-[#111815]">
              Control Practices Referenced in ECBC
            </div>
            <p>
              BEE&apos;s Energy Conservation Building Code (ECBC, evolving under the Energy
              Conservation and Sustainable Building Code framework) outlines building-efficiency
              practices including automatic lighting shutoff, occupancy sensors in designated
              enclosed spaces, and daylight-responsive perimeter controls for applicable commercial
              buildings. These principles provide relevant technical context for ROOMWISE&apos;s
              occupancy-responsive classroom lighting architecture.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-semibold text-[#111815]">
              Applicability &amp; Non-Certification Scope
            </div>
            <p>
              Mandatory ECBC applicability depends on building category, connected load or built-up
              area thresholds, and state-level notification. ROOMWISE does not claim ECBC
              compliance, ECBC certification, BEE assessment or approval, or that ECBC necessarily
              applies to DAV Model School, IIT Kharagpur.
            </p>
          </div>
        </div>
      </div>

      {/* Mandatory Independence Disclaimer */}
      <div
        role="note"
        aria-label="Independent project notice"
        className="px-4 sm:px-5 py-3.5 rounded-2xl bg-[#f3f5f4]/90 border border-neutral-200/85 text-[11px] sm:text-xs text-[#4a5851] leading-relaxed"
      >
        <span className="font-semibold text-[#111815]">Note:</span> ROOMWISE is an independently
        developed student project. The policy references presented here illustrate alignment with
        relevant national objectives and do not imply government sponsorship, endorsement,
        certification, regulatory compliance or funding.
      </div>
    </section>
  );
};
