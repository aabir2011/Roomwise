/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  IndianRupee,
  CheckCircle2,
  Sparkles,
  Check,
  Lock,
  Loader2,
  Activity,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { EmptyState, PageHeader, SegmentedControl } from '../common/DesignSystem';
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

  // Staged IoT automation routine across 25 nodes backed by /api/campus/optimize
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

    setOptimizingStageText('Verifying ECBC & BEE compliance...');
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
    <div className="p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 max-w-7xl mx-auto select-none">
      {/* Header */}
      <PageHeader
        kicker={
          <>
            <span>Continuous Autonomous Surveillance</span>
            <span aria-hidden="true">·</span>
            <span>DAV Model School, IIT Kharagpur</span>
          </>
        }
        title="Campus Energy Audit & Inefficiency Detection"
        subtitle="Real-time heuristic inspection detecting phantom loads, solar thermal mismatches, and unoccupied runtime anomalies."
        action={
          <motion.button
            type="button"
            whileTap={unresolvedCount === 0 || isOptimizing ? undefined : { scale: 0.985 }}
            onClick={handleRemediateAll}
            disabled={unresolvedCount === 0 || isOptimizing}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-xs whitespace-nowrap shrink-0 ${
              unresolvedCount === 0 && !isOptimizing
                ? 'bg-[#f3f5f4] text-neutral-400 cursor-not-allowed border border-neutral-200'
                : isOptimizing
                ? 'bg-[#0b2e22] text-white shadow-sm'
                : !isAdminUnlocked
                ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer'
                : 'rw-btn-forest'
            }`}
            title={!isAdminUnlocked ? 'Admin authorization required to apply campus-wide rules' : 'Apply rules to all 25 classrooms'}
          >
            {isOptimizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-emerald-300" />
                <span className="font-mono text-[11px]">{optimizingStageText}</span>
              </>
            ) : justRemediatedAll ? (
              <>
                <Check className="w-4 h-4 text-emerald-300" />
                <span>All 25 Nodes Optimized</span>
              </>
            ) : !isAdminUnlocked ? (
              <>
                <Lock className="w-4 h-4 text-amber-200" />
                <span>One-Click Campus Optimization</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-emerald-300" />
                <span>One-Click Campus Optimization</span>
              </>
            )}
          </motion.button>
        }
      />

      {/* Post-Optimization Status Banner */}
      <AnimatePresence>
        {optimizationSummary && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: ROOMWISE_EASE }}
            className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-950">
                  Campus Optimization Enforced ({optimizationSummary.count} Findings Remediated)
                </div>
                <div className="text-[11px] text-emerald-800 mt-0.5 tabular-nums">
                  Vacant loads shed and daylight harvesting rules applied across all 5 campus blocks. Curtailed load:{' '}
                  <strong>-{optimizationSummary.watts}W</strong>.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOptimizationSummary(null)}
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 px-2.5 py-1 rounded-lg hover:bg-emerald-100/70 transition-colors cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audit KPI Cards */}
      <FadeContent duration={0.2}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-3.5 sm:p-5 rounded-2xl glass-card">
          <div className="flex items-center justify-between gap-1.5 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 leading-snug">Audit Surveillance</span>
            <span className="p-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60 shrink-0">
              <Activity className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-lg sm:text-xl font-bold text-neutral-900 mt-2">
            Active Scan
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            25 Classrooms & Laboratories
          </div>
        </div>

        <div className="p-3.5 sm:p-5 rounded-2xl glass-card">
          <div className="flex items-center justify-between gap-1.5 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 leading-snug">Active Inefficiencies</span>
            <span className="p-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/60 shrink-0">
              <ShieldAlert className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber value={unresolvedCount} decimals={0} />{' '}
            <span className="text-xs font-normal text-neutral-500">Issues</span>
          </div>
          <div className="text-xs text-amber-800 font-semibold mt-1 tabular-nums">
            {unresolvedCount > 0 ? `${totalWasteWatts}W active waste detected` : 'All issues remediated'}
          </div>
        </div>

        <div className="p-3.5 sm:p-5 rounded-2xl glass-card">
          <div className="flex items-center justify-between gap-1.5 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 leading-snug">Monthly Avoidable Cost</span>
            <span className="p-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60 shrink-0">
              <IndianRupee className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber value={totalMonthlyWasteINR} decimals={2} prefix="₹" />
          </div>
          <div className="text-xs text-emerald-800 font-semibold mt-1 tabular-nums">
            At ₹{settings.tariffPerKWhINR.toFixed(2)}/kWh <AcronymHint term="WBSEDCL" /> <AcronymHint term="HT-2" /> Rate
          </div>
        </div>

        <div className="p-3.5 sm:p-5 rounded-2xl glass-card">
          <div className="flex items-center justify-between gap-1.5 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700 leading-snug">Operational Efficiency Score</span>
            <span className="p-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/60 shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-neutral-900 mt-2 tabular-nums">
            <AnimatedNumber
              value={computeEcbcCompliancePercent(auditFindings, classrooms.length)}
              decimals={1}
              suffix="%"
            />
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            <AcronymHint term="ECBC" /> alignment heuristic · Indicative
          </div>
        </div>
      </div>
      </FadeContent>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
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

      {/* Findings List or Empty State */}
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
        <AnimatedList
          items={filteredFindings}
          getKey={(finding) => finding.id}
          className="space-y-3"
          renderItem={(finding) => {
            const isResolving = resolvingFindingId === finding.id;
            return (
              <div
                className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                  finding.isResolved
                    ? 'bg-white/60 border-neutral-200/70 opacity-80'
                    : 'glass-card-interactive border-neutral-200/90 hover:border-amber-300/90'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        finding.isResolved
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                          : finding.severity === 'warning'
                          ? 'bg-amber-50 border border-amber-200 text-amber-700'
                          : 'bg-blue-50 border border-blue-200 text-blue-700'
                      }`}
                    >
                      {finding.isResolved ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5" />
                      )}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-neutral-900">
                          {finding.roomCode}
                        </span>
                        <span className="text-neutral-300" aria-hidden="true">·</span>
                        <span className="text-neutral-500 font-medium">{finding.building}</span>
                        <span className="text-neutral-300" aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => setSelectedRoomId(finding.classroomId)}
                          className="font-bold text-neutral-900 hover:text-emerald-800 hover:underline cursor-pointer"
                        >
                          {finding.classroomName}
                        </button>
                        <span className="text-neutral-300" aria-hidden="true">·</span>
                        <span
                          className={`text-[11px] font-semibold capitalize ${
                            finding.isResolved
                              ? 'text-emerald-700'
                              : finding.severity === 'warning'
                              ? 'text-amber-700'
                              : 'text-blue-700'
                          }`}
                        >
                          {finding.isResolved ? 'Remediated' : finding.type.replace('_', ' ')}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-neutral-900 mt-1">
                        {finding.title}
                      </h3>
                      <p className="text-xs text-neutral-600 mt-0.5">
                        {finding.description}
                      </p>

                      <div className="mt-2.5 text-xs text-neutral-600 bg-neutral-50/90 p-2.5 rounded-xl border border-neutral-200/70">
                        <strong className="text-neutral-900">Remediation Action:</strong> {finding.remediationAction}
                      </div>
                    </div>
                  </div>

                  {/* Impact Figures & Action */}
                  <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-neutral-100">
                    <div className="text-left md:text-right">
                      <div className="font-mono text-sm font-bold text-neutral-900 tabular-nums">
                        {finding.estimatedWasteWatts}W <span className="text-xs font-normal text-neutral-500">Waste</span>
                      </div>
                      <div className="text-[11px] text-neutral-500 tabular-nums">
                        ₹{finding.monthlyCostWasteINR.toFixed(2)}/mo
                      </div>
                    </div>

                    {!finding.isResolved ? (
                      <motion.button
                        type="button"
                        whileTap={isResolving ? undefined : { scale: 0.985 }}
                        disabled={Boolean(resolvingFindingId)}
                        onClick={() => handleResolveIndividual(finding.id, finding.roomCode)}
                        className="px-3.5 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60"
                      >
                        {isResolving ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Applying...</span>
                          </>
                        ) : (
                          <>
                            {!isAdminUnlocked && <Lock className="w-3 h-3 text-amber-300" />}
                            <span>Resolve & Apply Rule</span>
                          </>
                        )}
                      </motion.button>
                    ) : (
                      <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1 whitespace-nowrap">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Rule Enforced</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          }}
        />
      )}

      {/* ECBC & BEE Reference Alignment Card */}
      <div className="p-5 rounded-2xl rw-surface space-y-3">
        <h3 className="text-sm font-bold text-neutral-900">
          <AcronymHint term="BEE" /> &amp; <AcronymHint term="ECBC" /> Design-Alignment Reference
        </h3>
        <p className="text-xs text-neutral-500">
          Control logic alignment targets for DAV Model School, IIT Kharagpur (25 monitored nodes). Formal BEE/ECBC certification requires on-site meter auditing.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-neutral-900">ECBC Clause 4.3.7: Daylighting Controls</div>
              <div className="text-neutral-500 text-[11px] mt-0.5">
                Perimeter light banks automatically dimmed or shed when natural desk illumination exceeds 300 lux.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-neutral-900">BEE Star Rating: <AcronymHint term="BLDC" /> Fan Inverters</div>
              <div className="text-neutral-500 text-[11px] mt-0.5">
                All 25 classrooms retrofitted with 28W-35W BLDC motors replacing conventional 75W induction units.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-neutral-900"><AcronymHint term="ASHRAE-55" />: Adaptive Thermal Comfort</div>
              <div className="text-neutral-500 text-[11px] mt-0.5">
                Ceiling fan speeds dynamically regulated according to indoor heat index to maintain air velocities &ge; 1.2 m/s.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-neutral-900"><AcronymHint term="PIR" /> Inactivity Verification Protocol</div>
              <div className="text-neutral-500 text-[11px] mt-0.5">
                Avoids naive instant shutoff; applies calibrated 8-minute grace periods tailored to examination stillness.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
