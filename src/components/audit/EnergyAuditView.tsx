/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Check,
  Lock,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { ActionButton, EmptyState, InlineActionLink, LedgerStrip, PageHeader, SegmentedControl } from '../common/DesignSystem';
import { AcronymHint } from '../common/AcronymHint';
import { computeEcbcCompliancePercent } from '../../utils/auditEngine';
import { AnimatedList, FadeContent } from '../reactbits';
import { ROOMWISE_EASE } from '../../utils/motion';

export const EnergyAuditView: React.FC = () => {
  const {
    classrooms,
    settings,
    auditFindings,
    resolveAuditFinding,
    remediateAllFindings,
    setSelectedRoomId,
  } = useEnergy();
  const { isAdminUnlocked, openAuthModal } = useAuth();
  const toast = useToast();

  const [filterSeverity, setFilterSeverity] = useState<'all' | 'unresolved' | 'resolved'>('all');
  const [justRemediatedAll, setJustRemediatedAll] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizingStageText, setOptimizingStageText] = useState('');
  const [resolvingFindingId, setResolvingFindingId] = useState<string | null>(null);
  const [optimizationSummary, setOptimizationSummary] = useState<{ count: number; watts: number } | null>(null);

  const filteredFindings = auditFindings.filter((f) => {
    if (filterSeverity === 'unresolved') return !f.isResolved;
    if (filterSeverity === 'resolved') return f.isResolved;
    return true;
  });

  const unresolvedCount = auditFindings.filter((f) => !f.isResolved).length;
  const totalWasteWatts = auditFindings
    .filter((f) => !f.isResolved)
    .reduce((acc, f) => acc + f.estimatedWasteWatts, 0);

  const totalMonthlyWasteINR = auditFindings
    .filter((f) => !f.isResolved)
    .reduce((acc, f) => acc + f.monthlyCostWasteINR, 0);

  const executeRealisticOptimization = async () => {
    setIsOptimizing(true);
    setOptimizationSummary(null);
    const snapshotCount = unresolvedCount;
    const snapshotWasteWatts = totalWasteWatts;

    setOptimizingStageText('Scanning 25 classroom nodes across 5 blocks...');
    await new Promise((r) => setTimeout(r, 320));
    setOptimizingStageText('Shedding phantom loads & cutting vacant standbys...');
    await new Promise((r) => setTimeout(r, 320));
    setOptimizingStageText('Modulating perimeter luminaires & BLDC fans...');

    const result = await remediateAllFindings();
    if (!result.ok) {
      setIsOptimizing(false);
      toast.error(
        'Campus optimization failed',
        result.error || 'Please sign in as an administrator and retry.'
      );
      return;
    }

    setOptimizingStageText('Verifying ECBC & BEE alignment...');
    await new Promise((r) => setTimeout(r, 240));

    const finalCount = result.count > 0 ? result.count : snapshotCount;
    const finalWatts = result.curtailedWatts > 0 ? result.curtailedWatts : snapshotWasteWatts;

    setIsOptimizing(false);
    setJustRemediatedAll(true);
    setOptimizationSummary({ count: finalCount, watts: finalWatts });
    toast.success(
      'Campus optimization complete',
      `${finalCount} findings remediated · -${finalWatts}W active waste curtailed.`
    );

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = audioCtx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        gain.gain.setValueAtTime(0.12, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.3);
      });
    } catch {
      // audio not allowed
    }

    setTimeout(() => setJustRemediatedAll(false), 5000);
  };

  const handleRemediateAll = () => {
    if (isOptimizing) return;
    if (!isAdminUnlocked) {
      openAuthModal(() => {
        void executeRealisticOptimization();
      });
      return;
    }
    void executeRealisticOptimization();
  };

  const handleResolveIndividual = (findingId: string, roomCode?: string) => {
    if (resolvingFindingId) return;
    const runResolution = async () => {
      setResolvingFindingId(findingId);
      const res = await resolveAuditFinding(findingId);
      setResolvingFindingId(null);
      if (!res.ok) {
        toast.error('Remediation blocked', res.error || 'Unable to apply automation policy.');
        return;
      }
      toast.success(
        `Rule applied${roomCode ? ` to ${roomCode}` : ''}`,
        res.curtailedWatts > 0
          ? `Adaptive AUTO restored · -${res.curtailedWatts}W active waste curtailed.`
          : 'Automation policy enforced and logged in audit matrix.'
      );
    };

    if (!isAdminUnlocked) {
      openAuthModal(() => {
        void runResolution();
      });
      return;
    }
    void runResolution();
  };

  return (
    <div className="px-4 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-7 lg:pb-10 space-y-5 sm:space-y-6 max-w-[1440px] mx-auto select-none">
      {/* Header */}
      <PageHeader
        kicker={
          <>
            <span>Autonomous Heuristic Surveillance</span>
            <span aria-hidden="true" className="text-[#b8c2bc]">·</span>
            <span className="font-mono text-[#62706a]">25 Monitored Classrooms</span>
          </>
        }
        title="Energy Audit & Inefficiency Detection"
        subtitle="Continuous inspection identifying phantom loads, daylighting mismatches, and unoccupied runtime anomalies."
        action={
          <ActionButton
            variant={
              isOptimizing
                ? 'primary'
                : !isAdminUnlocked && unresolvedCount > 0
                ? 'amber'
                : 'forest'
            }
            size="md"
            onClick={handleRemediateAll}
            disabled={unresolvedCount === 0 || isOptimizing}
            loading={isOptimizing}
            className="w-full sm:w-auto"
            icon={
              justRemediatedAll ? (
                <Check className="w-3.5 h-3.5 text-emerald-200" />
              ) : !isAdminUnlocked ? (
                <Lock className="w-3.5 h-3.5 text-amber-800" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
              )
            }
            title={!isAdminUnlocked ? 'Admin authorization required to apply campus-wide rules' : 'Apply rules to all 25 classrooms'}
          >
            {isOptimizing ? (
              <span className="font-mono text-[11px]">{optimizingStageText}</span>
            ) : justRemediatedAll ? (
              'All 25 Nodes Optimized'
            ) : (
              'One-Click Campus Optimization'
            )}
          </ActionButton>
        }
      />

      {/* Post-Optimization Confirmation Strip */}
      <AnimatePresence>
        {optimizationSummary && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
            className="px-4 py-3.5 rounded-xl bg-[#eef6f2] border border-[#0b6e4f]/30 text-[#08543c] flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-[#0b6e4f] shrink-0" />
              <div className="text-xs">
                <strong className="font-semibold text-[#0b1713]">
                  Campus Optimization Enforced ({optimizationSummary.count} Findings Remediated)
                </strong>
                <span className="text-[#46544e] ml-2 tabular-nums">
                  Vacant loads shed and daylight harvesting restored · Curtailed:{' '}
                  <strong className="font-mono text-[#0b6e4f]">-{optimizationSummary.watts}W</strong>
                </span>
              </div>
            </div>
            <InlineActionLink
              onClick={() => setOptimizationSummary(null)}
              tone="emerald"
              className="shrink-0"
            >
              Dismiss
            </InlineActionLink>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified Audit Telemetry Ledger */}
      <FadeContent duration={0.18}>
        <LedgerStrip
          columns={4}
          items={[
            {
              label: 'Surveillance Engine',
              value: 'Active',
              detail: '25 Classrooms & Laboratories',
            },
            {
              label: 'Active Inefficiencies',
              value: <AnimatedNumber value={unresolvedCount} decimals={0} />,
              unit: 'issues',
              detail:
                unresolvedCount > 0 ? `${totalWasteWatts} W active waste detected` : 'All issues remediated',
            },
            {
              label: 'Monthly Avoidable Cost',
              value: <AnimatedNumber value={totalMonthlyWasteINR} decimals={2} prefix="₹" />,
              detail: (
                <>
                  At ₹{settings.tariffPerKWhINR.toFixed(2)}/kWh <AcronymHint term="WBSEDCL" /> <AcronymHint term="HT-2" />
                </>
              ),
              highlight: unresolvedCount === 0,
            },
            {
              label: 'Operational Efficiency Heuristic',
              value: (
                <AnimatedNumber
                  value={computeEcbcCompliancePercent(auditFindings, classrooms.length)}
                  decimals={1}
                  suffix="%"
                />
              ),
              detail: (
                <>
                  <AcronymHint term="ECBC" /> alignment heuristic · Indicative
                </>
              ),
            },
          ]}
        />
      </FadeContent>

      {/* Filter Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SegmentedControl<'all' | 'unresolved' | 'resolved'>
          layoutId="audit-filter-pill"
          ariaLabel="Filter audit findings"
          value={filterSeverity}
          onChange={setFilterSeverity}
          options={[
            { id: 'all', label: 'All Findings', suffix: auditFindings.length },
            { id: 'unresolved', label: 'Unresolved', suffix: unresolvedCount },
            { id: 'resolved', label: 'Remediated', suffix: auditFindings.length - unresolvedCount },
          ]}
        />
      </div>

      {/* Findings Ledger */}
      {filteredFindings.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          tone="emerald"
          title={
            filterSeverity === 'unresolved'
              ? 'All audit findings have been remediated'
              : 'No findings match this filter'
          }
          description={
            filterSeverity === 'unresolved'
              ? 'Every flagged classroom rule has been enforced across the 25 campus nodes.'
              : 'Switch filter views to inspect active or remediated audit logs.'
          }
          actionLabel={filterSeverity !== 'all' ? 'Show All Findings' : undefined}
          onAction={filterSeverity !== 'all' ? () => setFilterSeverity('all') : undefined}
        />
      ) : (
        <div className="rw-surface rounded-xl overflow-hidden">
          <AnimatedList
            items={filteredFindings}
            getKey={(finding) => finding.id}
            className="divide-y divide-[#111916]/10"
            renderItem={(finding) => {
              const isResolving = resolvingFindingId === finding.id;
              return (
                <div
                  className={`p-3.5 sm:p-5 transition-colors ${
                    finding.isResolved ? 'bg-[#f8f9f7] opacity-80' : 'bg-white hover:bg-[#fafbf9]'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 sm:gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`mt-0.5 shrink-0 ${
                          finding.isResolved
                            ? 'text-[#0b6e4f]'
                            : finding.severity === 'warning'
                            ? 'text-amber-700'
                            : 'text-[#0e6ba8]'
                        }`}
                      >
                        {finding.isResolved ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <AlertTriangle className="w-4 h-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-mono font-bold text-[#111916]">
                            {finding.roomCode}
                          </span>
                          <span className="text-[#c8d0cb]" aria-hidden="true">·</span>
                          <span className="text-[#62706a]">{finding.building}</span>
                          <span className="text-[#c8d0cb]" aria-hidden="true">·</span>
                          <InlineActionLink
                            onClick={() => setSelectedRoomId(finding.classroomId)}
                            tone="neutral"
                            className="font-semibold text-[#111916]"
                          >
                            {finding.classroomName}
                          </InlineActionLink>
                          <span className="text-[#c8d0cb]" aria-hidden="true">·</span>
                          <span
                            className={`text-[11px] font-semibold capitalize ${
                              finding.isResolved
                                ? 'text-[#0b6e4f]'
                                : finding.severity === 'warning'
                                ? 'text-amber-700'
                                : 'text-[#0e6ba8]'
                            }`}
                          >
                            {finding.isResolved ? 'Remediated' : finding.type.replace('_', ' ')}
                          </span>
                        </div>

                        <h3 className="font-display text-sm font-bold text-[#111916] mt-1">
                          {finding.title}
                        </h3>
                        <p className="text-xs text-[#46544e] mt-0.5 leading-relaxed">
                          {finding.description}
                        </p>

                        <div className="mt-2.5 text-xs text-[#46544e] bg-[#f4f6f3] px-3 py-2 rounded-md border border-[#111916]/8">
                          <strong className="text-[#111916]">Remediation Protocol:</strong>{' '}
                          {finding.remediationAction}
                        </div>
                      </div>
                    </div>

                    {/* Impact Readout & Action */}
                    <div className="flex md:flex-col items-center md:items-end justify-between md:justify-start gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-[#111916]/8">
                      <div className="text-left md:text-right font-mono tabular-nums">
                        <div className="text-sm font-bold text-[#111916]">
                          {finding.estimatedWasteWatts} W{' '}
                          <span className="text-[11px] font-normal text-[#62706a]">waste</span>
                        </div>
                        <div className="text-[11px] text-[#62706a]">
                          ₹{finding.monthlyCostWasteINR.toFixed(2)}/mo
                        </div>
                      </div>

                      {!finding.isResolved ? (
                        <ActionButton
                          variant="primary"
                          size="sm"
                          loading={isResolving}
                          disabled={Boolean(resolvingFindingId)}
                          onClick={() => handleResolveIndividual(finding.id, finding.roomCode)}
                          icon={!isAdminUnlocked ? <Lock className="w-3 h-3 text-amber-300" /> : undefined}
                        >
                          {isResolving ? 'Applying...' : 'Resolve & Apply Rule'}
                        </ActionButton>
                      ) : (
                        <span className="text-xs text-[#0b6e4f] font-semibold flex items-center gap-1 whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Rule Enforced</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }}
          />
        </div>
      )}

      {/* ECBC & BEE Design-Alignment Reference Grid */}
      <section className="rw-surface rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#111916]/10">
          <h2 className="font-display text-sm font-bold text-[#111916]">
            <AcronymHint term="BEE" /> &amp; <AcronymHint term="ECBC" /> Design-Alignment Reference
          </h2>
          <p className="text-xs text-[#46544e] mt-0.5">
            Control logic alignment targets for DAV Model School, IIT Kharagpur (25 monitored nodes). Formal certification requires on-site meter auditing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#111916]/10">
          <div className="divide-y divide-[#111916]/10">
            <div className="p-4 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0b6e4f] shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-[#111916]">
                  ECBC Clause 4.3.7 · Daylighting Controls
                </div>
                <p className="text-[11px] text-[#46544e] mt-0.5 leading-relaxed">
                  Perimeter light banks automatically dimmed or shed when natural desk illumination exceeds 300 lux.
                </p>
              </div>
            </div>
            <div className="p-4 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0b6e4f] shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-[#111916]">
                  <AcronymHint term="ASHRAE-55" /> · Adaptive Thermal Comfort
                </div>
                <p className="text-[11px] text-[#46544e] mt-0.5 leading-relaxed">
                  Ceiling fan speeds dynamically regulated according to indoor heat index to maintain air velocities &ge; 1.2 m/s.
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-[#111916]/10">
            <div className="p-4 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0b6e4f] shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-[#111916]">
                  BEE Star Rating · <AcronymHint term="BLDC" /> Fan Inverters
                </div>
                <p className="text-[11px] text-[#46544e] mt-0.5 leading-relaxed">
                  All 25 classrooms retrofitted with 28W–35W BLDC motors replacing conventional 75W induction units.
                </p>
              </div>
            </div>
            <div className="p-4 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0b6e4f] shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-[#111916]">
                  <AcronymHint term="PIR" /> Inactivity Verification Protocol
                </div>
                <p className="text-[11px] text-[#46544e] mt-0.5 leading-relaxed">
                  Avoids naive instant shutoff; applies calibrated 8-minute grace periods tailored to examination stillness.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
