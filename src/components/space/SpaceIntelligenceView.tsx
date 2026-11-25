/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  History,
  KeyRound,
  Loader2,
  Play,
  ShieldAlert,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useEnergy } from '../../context/EnergyContext';
import { authFetch, useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ensureDemoResetOnPageLoad } from '../../utils/demoReset';
import type {
  AllocationHistoryEntry,
  AllocationProposal,
  AllocationRunResult,
  AnalysisHorizonMode,
  ColumnMappingSelection,
  SectionAllocationPolicy,
  SpaceBootstrapPayload,
  SpaceRoomRecord,
  SpaceSectionRecord,
  SpreadsheetParseResult,
} from '../../types/space';
import { AnimatedNumber } from '../common/MotionPrimitives';
import { PageHeader, SegmentedControl } from '../common/DesignSystem';
import { MathText } from '../common/MathText';
import { AnimatedList, AnimatedTableRow, FadeContent, Stepper } from '../reactbits';
import { ROOMWISE_EASE } from '../../utils/motion';

type InnerTab = 'recommendations' | 'sections' | 'rooms-timetable' | 'history';

const ANALYSIS_STAGES = [
  'Reading attendance register',
  'Matching campus sections',
  'Checking max occupancy limits',
  'Verifying timetable availability',
  'Checking policy & suitability',
  'Computing kilowatt-hour energy impact',
  'Resolving room conflicts',
];

const POLICY_LABELS: Record<SectionAllocationPolicy, string> = {
  approved_flexible_block: 'Flexible Block',
  fixed_home_room: 'Fixed Home Room',
  restricted: 'Restricted',
};

const REJECTION_CATEGORY_LABELS: Record<string, string> = {
  capacity_shortfall: 'Capacity Limit',
  timetable_conflict: 'Timetable Conflict',
  room_restriction: 'Room Policy',
  policy_restriction: 'Section Policy',
  already_allocated: 'Already Claimed',
  insufficient_energy_savings: 'Negligible Savings',
};

function classifyMoveType(prop: AllocationProposal): {
  label: 'Section Consolidation' | 'Room Reallocation';
  detail: string;
} {
  const isSameBuilding = prop.existingRoomBuilding === prop.proposedRoomBuilding;
  const isHallRightSizing =
    prop.existingRoomMaxOccupancy >= 60 &&
    prop.proposedRoomMaxOccupancy < prop.existingRoomMaxOccupancy;

  if (isSameBuilding || isHallRightSizing) {
    return {
      label: 'Section Consolidation',
      detail: isSameBuilding ? 'Same-building consolidation' : 'Right-sized room consolidation',
    };
  }
  return {
    label: 'Room Reallocation',
    detail: 'Individual section allocation',
  };
}

export const SpaceIntelligenceView: React.FC = () => {
  const { updateRoomCapacity, setSelectedRoomId } = useEnergy();
  const { isAdminUnlocked, openAuthModal } = useAuth();
  const toast = useToast();

  const [bootstrap, setBootstrap] = useState<SpaceBootstrapPayload | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [analysisMode, setAnalysisMode] = useState<AnalysisHorizonMode>('actual');
  const [activeRun, setActiveRun] = useState<AllocationRunResult | null>(null);
  const [historyEntries, setHistoryEntries] = useState<AllocationHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [innerTab, setInnerTab] = useState<InnerTab>('recommendations');

  // Staged execution progress
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStageIndex, setAnalysisStageIndex] = useState<number>(-1);

  // Progressive disclosure states
  const [expandedProposalIds, setExpandedProposalIds] = useState<Record<string, boolean>>({});
  const [expandedUnchangedIds, setExpandedUnchangedIds] = useState<Record<string, boolean>>({});
  const [showUnchanged, setShowUnchanged] = useState<boolean>(false);
  const [reviewingProposalId, setReviewingProposalId] = useState<string | null>(null);

  // Attendance CSV / XLSX upload & mapping workflow
  const [importFileState, setImportFileState] = useState<{
    fileName: string;
    fileBase64?: string;
    csvText?: string;
  } | null>(null);
  const [parseResult, setParseResult] = useState<SpreadsheetParseResult | null>(null);
  const [showColumnMapping, setShowColumnMapping] = useState<boolean>(false);
  const [columnMapping, setColumnMapping] = useState<ColumnMappingSelection>({
    attendanceDate: '',
    className: '',
    section: '',
    presentCount: '',
  });
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [isParsingFile, setIsParsingFile] = useState<boolean>(false);
  const [isCommittingImport, setIsCommittingImport] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline editing state for Sections and Room limits
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionStrengthDraft, setSectionStrengthDraft] = useState<number>(40);
  const [sectionPolicyDraft, setSectionPolicyDraft] =
    useState<SectionAllocationPolicy>('approved_flexible_block');
  const [savingSectionId, setSavingSectionId] = useState<string | null>(null);

  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [roomCapDraft, setRoomCapDraft] = useState<number>(40);
  const [savingRoomId, setSavingRoomId] = useState<string | null>(null);
  const [timetableDayFilter, setTimetableDayFilter] = useState<number>(1);

  const fetchBootstrap = useCallback(async (dateOverride?: string) => {
    setLoadError(null);
    try {
      await ensureDemoResetOnPageLoad();
      const qs = dateOverride ? `?attendanceDate=${encodeURIComponent(dateOverride)}` : '';
      const res = await authFetch(`/api/space/bootstrap${qs}`);
      if (!res.ok) {
        throw new Error('Unable to load Space Intelligence state.');
      }
      const data = (await res.json()) as SpaceBootstrapPayload;
      setBootstrap(data);
      const effectiveDate = dateOverride || data.latestAttendanceDate;
      setSelectedDate(effectiveDate);
      if (data.latestRun) {
        setActiveRun(data.latestRun);
        setAnalysisMode(data.latestRun.analysisMode);
        setTimetableDayFilter(data.latestRun.targetDayOfWeek || 1);
      }
      setHistoryEntries(data.history || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Network error loading Space Intelligence.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBootstrap();
  }, [fetchBootstrap]);

  const handleDateChange = (nextDate: string) => {
    setSelectedDate(nextDate);
    void fetchBootstrap(nextDate);
  };

  const handleTryAllocation = async (dateOverride?: string, modeOverride?: AnalysisHorizonMode) => {
    if (isAnalyzing) return;
    const targetDate = dateOverride || selectedDate || bootstrap?.latestAttendanceDate;
    const targetMode = modeOverride || analysisMode;

    setIsAnalyzing(true);
    setAnalysisStageIndex(0);

    const stageInterval = window.setInterval(() => {
      setAnalysisStageIndex((prev) =>
        prev < ANALYSIS_STAGES.length - 2 ? prev + 1 : prev
      );
    }, 105);

    try {
      const res = await authFetch('/api/space/analyze', {
        method: 'POST',
        body: JSON.stringify({
          attendanceDate: targetDate,
          mode: targetMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Constraint solver failed to analyze allocations.');
      }

      window.clearInterval(stageInterval);
      setAnalysisStageIndex(ANALYSIS_STAGES.length - 1);
      await new Promise((r) => window.setTimeout(r, 110));

      const runResult = data as AllocationRunResult;
      setActiveRun(runResult);
      setExpandedProposalIds({});
      setInnerTab('recommendations');
      setTimetableDayFilter(runResult.targetDayOfWeek || 1);

      toast.success(
        runResult.summary.recommendedMovesCount > 0
          ? `${runResult.summary.recommendedMovesCount} classroom move(s) identified`
          : 'Allocation analysis complete',
        runResult.summary.recommendedMovesCount > 0
          ? `Estimated savings: +${runResult.summary.totalProjectedSavingsKWh} kWh (₹${runResult.summary.totalProjectedSavingsINR})`
          : 'All evaluated sections remain in current classrooms.'
      );
      void fetchBootstrap(targetDate);
    } catch (err) {
      window.clearInterval(stageInterval);
      toast.error(
        'Allocation analysis failed',
        err instanceof Error ? err.message : 'Unable to evaluate classroom schedule.'
      );
    } finally {
      window.clearInterval(stageInterval);
      setIsAnalyzing(false);
      setAnalysisStageIndex(-1);
    }
  };

  const runServerParse = async (payload: {
    fileName: string;
    fileBase64?: string;
    csvText?: string;
    sheetName?: string;
    columnMapping?: Partial<ColumnMappingSelection>;
  }) => {
    setIsParsingFile(true);
    try {
      const res = await authFetch('/api/space/attendance/parse', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Could not inspect attendance spreadsheet.');
      }
      const parsed = data as SpreadsheetParseResult;
      setParseResult(parsed);
      setSelectedSheet(parsed.activeSheet);
      setColumnMapping(parsed.activeMapping);
      setShowColumnMapping(Boolean(parsed.needsMappingConfirmation));
    } catch (err) {
      toast.error(
        'Spreadsheet parse error',
        err instanceof Error ? err.message : 'Verify CSV or XLSX format.'
      );
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith('.csv') || file.type.includes('csv') || file.type === 'text/plain';

    try {
      if (isCsv) {
        const csvText = await file.text();
        const nextFileState = { fileName: file.name, csvText };
        setImportFileState(nextFileState);
        await runServerParse(nextFileState);
      } else {
        const fileBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Failed reading spreadsheet file.'));
          reader.readAsDataURL(file);
        });
        const nextFileState = { fileName: file.name, fileBase64 };
        setImportFileState(nextFileState);
        await runServerParse(nextFileState);
      }
    } catch (err) {
      toast.error(
        'File read failed',
        err instanceof Error ? err.message : 'Unable to read uploaded file.'
      );
    }
  };

  const clearUploadState = () => {
    setParseResult(null);
    setImportFileState(null);
    setShowColumnMapping(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRevalidateMapping = () => {
    if (!importFileState) return;
    void runServerParse({
      ...importFileState,
      sheetName: selectedSheet || undefined,
      columnMapping,
    });
  };

  const handleSheetChange = (sheet: string) => {
    setSelectedSheet(sheet);
    if (!importFileState) return;
    void runServerParse({
      ...importFileState,
      sheetName: sheet,
    });
  };

  const commitValidatedAttendance = async () => {
    if (!parseResult) return;
    const validRows = parseResult.rows
      .filter((r) => r.isValid && r.normalizedDate && r.matchedSectionId && r.presentCount !== null)
      .map((r) => ({
        attendanceDate: r.normalizedDate!,
        sectionId: r.matchedSectionId!,
        presentCount: r.presentCount!,
      }));

    if (validRows.length === 0) {
      toast.error('No valid rows to import', 'Resolve highlighted row errors before committing.');
      return;
    }

    const executeCommit = async () => {
      setIsCommittingImport(true);
      try {
        const res = await authFetch('/api/space/attendance/commit', {
          method: 'POST',
          body: JSON.stringify({
            rows: validRows,
            fileName: parseResult.fileName,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Administrator authorization required to import attendance.');
        }

        const committedDate = data.datesAffected?.[data.datesAffected.length - 1] || selectedDate;
        toast.success(
          `Imported ${data.committedCount} attendance record(s)`,
          `Dates synced: ${(data.datesAffected || []).join(', ')}`
        );
        clearUploadState();
        setSelectedDate(committedDate);
        await fetchBootstrap(committedDate);
        await handleTryAllocation(committedDate, analysisMode);
      } catch (err) {
        toast.error(
          'Attendance commit failed',
          err instanceof Error ? err.message : 'Unable to persist imported register.'
        );
      } finally {
        setIsCommittingImport(false);
      }
    };

    if (!isAdminUnlocked) {
      openAuthModal(() => void executeCommit());
      return;
    }
    await executeCommit();
  };

  const handleReviewProposal = (proposal: AllocationProposal, decision: 'approved' | 'rejected') => {
    const executeReview = async () => {
      setReviewingProposalId(proposal.proposalId);
      try {
        const endpoint =
          decision === 'approved'
            ? `/api/space/proposals/${encodeURIComponent(proposal.proposalId)}/approve`
            : `/api/space/proposals/${encodeURIComponent(proposal.proposalId)}/reject`;
        const res = await authFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `Failed to mark proposal as ${decision}.`);
        }

        const updatedProp = data.proposal as AllocationProposal;
        const histEntry = data.historyEntry as AllocationHistoryEntry;

        setActiveRun((prev) =>
          prev
            ? {
                ...prev,
                proposals: prev.proposals.map((p) =>
                  p.proposalId === updatedProp.proposalId ? updatedProp : p
                ),
              }
            : prev
        );
        setHistoryEntries((prev) => [
          histEntry,
          ...prev.filter((h) => h.historyId !== histEntry.historyId),
        ]);

        toast.success(
          decision === 'approved'
            ? `Approved: ${proposal.sectionCode} → ${proposal.proposedRoomCode}`
            : `Rejected: ${proposal.sectionCode} → ${proposal.proposedRoomCode}`,
          decision === 'approved'
            ? `${proposal.windowLabel} (+${proposal.netEnergySavingsKWh} kWh)`
            : 'Section keeps existing classroom.'
        );
      } catch (err) {
        toast.error(
          decision === 'approved' ? 'Approval blocked' : 'Rejection failed',
          err instanceof Error ? err.message : 'Check administrator authorization or room conflicts.'
        );
      } finally {
        setReviewingProposalId(null);
      }
    };

    if (!isAdminUnlocked) {
      openAuthModal(() => void executeReview());
      return;
    }
    void executeReview();
  };

  const handleSaveSection = (sec: SpaceSectionRecord) => {
    const executeSave = async () => {
      setSavingSectionId(sec.sectionId);
      try {
        const res = await authFetch(`/api/space/sections/${encodeURIComponent(sec.sectionId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            enrolledStrength: sectionStrengthDraft,
            policy: sectionPolicyDraft,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Could not update section configuration.');
        }
        setEditingSectionId(null);
        toast.success(
          `${sec.sectionCode} updated`,
          `Enrolled: ${data.section.enrolledStrength} · ${POLICY_LABELS[data.section.policy as SectionAllocationPolicy]}`
        );
        await fetchBootstrap(selectedDate);
      } catch (err) {
        toast.error(
          'Section update failed',
          err instanceof Error ? err.message : 'Unable to save section limits.'
        );
      } finally {
        setSavingSectionId(null);
      }
    };

    if (!isAdminUnlocked) {
      openAuthModal(() => void executeSave());
      return;
    }
    void executeSave();
  };

  const handleSaveRoomCapacity = (room: SpaceRoomRecord) => {
    const executeSave = async () => {
      setSavingRoomId(room.roomId);
      try {
        const res = await authFetch(`/api/space/rooms/${encodeURIComponent(room.roomId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ maxOccupancy: roomCapDraft }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Could not update classroom max occupancy.');
        }
        updateRoomCapacity(room.roomId, data.room.maxOccupancy);
        setEditingRoomId(null);
        toast.success(
          `${room.roomCode} limit updated`,
          `Max occupancy set to ${data.room.maxOccupancy} seats.`
        );
        await fetchBootstrap(selectedDate);
      } catch (err) {
        toast.error(
          'Room update failed',
          err instanceof Error ? err.message : 'Unable to update room capacity.'
        );
      } finally {
        setSavingRoomId(null);
      }
    };

    if (!isAdminUnlocked) {
      openAuthModal(() => void executeSave());
      return;
    }
    void executeSave();
  };

  const roomsById = useMemo(() => {
    const m = new Map<string, SpaceRoomRecord>();
    bootstrap?.rooms.forEach((r) => m.set(r.roomId, r));
    return m;
  }, [bootstrap?.rooms]);

  const sectionsById = useMemo(() => {
    const m = new Map<string, SpaceSectionRecord>();
    bootstrap?.sections.forEach((s) => m.set(s.sectionId, s));
    return m;
  }, [bootstrap?.sections]);

  const selectedDateMeta = useMemo(
    () => bootstrap?.availableAttendanceDates.find((d) => d.attendanceDate === selectedDate) || null,
    [bootstrap?.availableAttendanceDates, selectedDate]
  );

  if (isLoading && !bootstrap) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex items-center justify-center py-24 text-xs text-neutral-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
        <span>Loading Space Intelligence...</span>
      </div>
    );
  }

  if (loadError && !bootstrap) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="p-6 rounded-2xl bg-white border border-rose-200 text-xs text-rose-900 space-y-3">
          <div className="font-bold text-sm">Unable to load Space Intelligence</div>
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => void fetchBootstrap()}
            className="px-4 py-2 rounded-xl bg-neutral-900 text-white font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const proposals = activeRun?.proposals || [];
  const unchanged = activeRun?.unchangedSections || [];
  const summary = activeRun?.summary || {
    evaluatedSectionsCount: bootstrap?.sections.length || 17,
    recommendedMovesCount: 0,
    unchangedSectionsCount: bootstrap?.sections.length || 17,
    unknownAttendanceCount: 0,
    totalProjectedSavingsKWh: 0,
    totalProjectedSavingsINR: 0,
    totalProjectedCo2AvoidedKg: 0,
  };

  const allocationWorkflowSteps = [
    {
      id: 'attendance',
      label: 'Attendance Register',
      description: 'Select date or import CSV / Excel attendance register',
    },
    {
      id: 'solve',
      label: 'Try Allocation',
      description: 'Run capacity, timetable, policy, and kWh energy solver',
    },
    {
      id: 'review',
      label: 'Review & Decide',
      description: 'Inspect proposed room moves and approve or reject',
    },
  ] as const;

  const allocationWorkflowStep = isAnalyzing
    ? 1
    : parseResult
    ? 0
    : activeRun
    ? 2
    : 0;

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Editorial Header */}
      <PageHeader
        kicker="Attendance-Aware Constraint Solver · Register Separate From PIR"
        title="Space Intelligence"
        subtitle={
          <>
            Evaluates section attendance against classroom capacity, timetable windows, policy
            constraints, and <MathText tex="\mathrm{kW}\cdot\mathrm{h}" ariaLabel="kilowatt-hour" />{' '}
            energy impact.
          </>
        }
        action={
          <>
            <a
              href="/api/space/template.csv"
              download="ROOMWISE_Attendance_Template.csv"
              className="px-3.5 py-2 min-h-[40px] rounded-xl rw-surface hover:bg-[#f3f5f4] text-[#111815] text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#64726b]" />
              <span>Template CSV</span>
            </a>

            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => void handleTryAllocation()}
              className="px-4 py-2 min-h-[40px] rounded-xl bg-[#0b2e22] hover:bg-[#114231] text-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current text-emerald-300" />
              )}
              <span>{isAnalyzing ? 'Analyzing...' : 'TRY ALLOCATION'}</span>
            </button>
          </>
        }
      />

      {/* Unified Attendance Control & Upload Bar */}
      <FadeContent duration={0.2}>
      <div className="rw-surface rounded-2xl divide-y divide-neutral-200/75 overflow-hidden">
        {/* Allocation Workflow Stepper */}
        <div className="px-4 py-2.5 bg-[#fafbfb] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex-1 min-w-0 max-w-xl">
            <Stepper
              steps={allocationWorkflowSteps}
              currentStep={allocationWorkflowStep}
              allowStepBack
              ariaLabel="Try Allocation workflow progress"
              onStepClick={(stepIdx) => {
                if (stepIdx === 0) {
                  document.getElementById('space-date-select')?.focus();
                } else if (stepIdx === 1) {
                  void handleTryAllocation();
                } else if (stepIdx === 2) {
                  setInnerTab('recommendations');
                }
              }}
            />
          </div>
          {activeRun && (
            <div className="text-[11px] font-mono text-[#4a5851] tabular-nums shrink-0">
              {summary.recommendedMovesCount} move{summary.recommendedMovesCount === 1 ? '' : 's'} evaluated
            </div>
          )}
        </div>
        {/* Date & Horizon Row */}
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 min-w-0 max-w-full">
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <CalendarDays className="w-4 h-4 text-emerald-700 shrink-0" />
              <label htmlFor="space-date-select" className="font-semibold text-[#111815] whitespace-nowrap">
                Date
              </label>
              <select
                id="space-date-select"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg glass-input font-mono text-xs font-semibold text-[#111815] focus:outline-none min-w-0 max-w-full truncate"
              >
                {(bootstrap?.availableAttendanceDates || []).map((d) => (
                  <option key={d.attendanceDate} value={d.attendanceDate}>
                    {d.attendanceDate} · {d.recordedSectionsCount}/{d.totalSectionsCount} ({d.sourceSummary})
                  </option>
                ))}
              </select>
            </div>

            <SegmentedControl<AnalysisHorizonMode>
              layoutId="space-horizon-mode"
              size="sm"
              tone="light"
              value={analysisMode}
              onChange={setAnalysisMode}
              options={[
                { id: 'actual', label: 'Actual Register' },
                { id: 'projected', label: 'Next Block (+2 seats)' },
              ]}
            />
          </div>

          {activeRun && (
            <div className="text-[11px] text-[#64726b] font-mono tabular-nums">
              {activeRun.attendanceDate} · {activeRun.analysisMode === 'projected' ? 'Projected (+2)' : 'Actual'}
            </div>
          )}
        </div>

        {/* Upload Dropzone Row */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingFile(false);
            void handleFileSelected(e.dataTransfer.files?.[0]);
          }}
          className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
            isDraggingFile ? 'bg-emerald-50/70' : 'bg-neutral-50/40'
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs min-w-0">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
            <div className="truncate">
              <span className="font-semibold text-neutral-900">
                {parseResult ? parseResult.fileName : 'Attendance Import'}
              </span>
              <span className="text-neutral-500 ml-2">
                {isParsingFile
                  ? 'Reading workbook...'
                  : parseResult
                  ? `${parseResult.validRowsCount} valid${parseResult.invalidRowsCount > 0 ? ` · ${parseResult.invalidRowsCount} flagged` : ''}`
                  : 'Drop CSV or Excel (.xlsx / .xls) register, or select a file'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => void handleFileSelected(e.target.files?.[0])}
              className="hidden"
            />
            {parseResult && (
              <button
                type="button"
                onClick={clearUploadState}
                className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-[11px] font-semibold text-neutral-600 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <X className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsingFile}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-800 flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {isParsingFile ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-emerald-700" />
              )}
              <span>{parseResult ? 'Replace File' : 'Upload CSV / XLSX'}</span>
            </button>
          </div>
        </div>

        {/* Parsed Attendance Review (Expanded only when a file is loaded) */}
        <AnimatePresence>
          {parseResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: ROOMWISE_EASE }}
              className="p-4 space-y-3 bg-white overflow-hidden"
            >
              {/* Controls & Column Mapping Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-3 tabular-nums">
                  <span className="font-semibold text-emerald-800">
                    {parseResult.validRowsCount} ready
                  </span>
                  {parseResult.invalidRowsCount > 0 && (
                    <span className="font-semibold text-rose-700">
                      {parseResult.invalidRowsCount} errors
                    </span>
                  )}
                  {parseResult.duplicateCount > 0 && (
                    <span className="text-amber-700 font-medium">
                      {parseResult.duplicateCount} duplicates
                    </span>
                  )}
                  {parseResult.exceedsStrengthCount > 0 && (
                    <span className="text-rose-700 font-medium">
                      {parseResult.exceedsStrengthCount} exceed strength
                    </span>
                  )}
                  {parseResult.skippedBlankRows > 0 && (
                    <span className="text-neutral-400">
                      {parseResult.skippedBlankRows} blank ignored
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {parseResult.sheetNames.length > 1 && (
                    <select
                      value={selectedSheet}
                      onChange={(e) => handleSheetChange(e.target.value)}
                      className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-neutral-50 text-xs font-medium"
                    >
                      {parseResult.sheetNames.map((s) => (
                        <option key={s} value={s}>
                          Sheet: {s}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowColumnMapping((v) => !v)}
                    className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-[11px] font-semibold text-neutral-700 cursor-pointer whitespace-nowrap"
                  >
                    {showColumnMapping ? 'Hide Column Mapping' : 'Column Mapping'}
                  </button>
                </div>
              </div>

              {(parseResult.needsMappingConfirmation || showColumnMapping) && (
                <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-2.5">
                  {parseResult.needsMappingConfirmation && (
                    <div className="flex items-center gap-2 text-[11px] text-amber-800 font-medium">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span>Confirm header mapping and click Re-Validate.</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {(
                      [
                        { field: 'attendanceDate', label: 'Attendance Date' },
                        { field: 'className', label: 'Class / Grade' },
                        { field: 'section', label: 'Section' },
                        { field: 'presentCount', label: 'Present Count' },
                      ] as const
                    ).map((item) => (
                      <div key={item.field}>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                          {item.label}
                        </label>
                        <select
                          value={columnMapping[item.field]}
                          onChange={(e) =>
                            setColumnMapping((prev) => ({
                              ...prev,
                              [item.field]: e.target.value,
                            }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-medium"
                        >
                          <option value="">-- Select --</option>
                          {parseResult.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleRevalidateMapping}
                      className="px-3 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 text-[11px] font-semibold text-neutral-800 cursor-pointer whitespace-nowrap"
                    >
                      Re-Validate
                    </button>
                  </div>
                </div>
              )}

              {parseResult.missingSectionsByDate.some((m) => m.missingSectionCodes.length > 0) && (
                <div className="text-[11px] text-neutral-600 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-200/70">
                  <span className="font-semibold text-neutral-800">Missing sections stay unknown (never 0): </span>
                  {parseResult.missingSectionsByDate
                    .filter((m) => m.missingSectionCodes.length > 0)
                    .map((m) => `${m.attendanceDate} (${m.missingSectionCodes.join(', ')})`)
                    .join(' · ')}
                </div>
              )}

              <div className="rounded-xl border border-neutral-200/90 overflow-hidden">
                <div className="max-h-56 overflow-y-auto overflow-x-auto">
                  <table className="w-full min-w-[540px] text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      <tr>
                        <th className="py-2 px-3 whitespace-nowrap">Row</th>
                        <th className="py-2 px-3 whitespace-nowrap">Date</th>
                        <th className="py-2 px-3 whitespace-nowrap">Input</th>
                        <th className="py-2 px-3 whitespace-nowrap">Section</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Present / Enrolled</th>
                        <th className="py-2 px-3 whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {parseResult.rows.slice(0, 60).map((row) => (
                        <tr
                          key={row.rowNumber}
                          className={row.isValid ? 'hover:bg-neutral-50/70' : 'bg-rose-50/60'}
                        >
                          <td className="py-2 px-3 font-mono text-neutral-500 tabular-nums">
                            #{row.rowNumber}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums">
                            {row.normalizedDate || row.rawDate || '—'}
                          </td>
                          <td className="py-2 px-3 text-neutral-700">
                            {row.rawClass}
                            {row.rawSection ? `-${row.rawSection}` : ''}
                          </td>
                          <td className="py-2 px-3 font-semibold text-neutral-900">
                            {row.matchedSectionCode || (
                              <span className="text-rose-700 font-normal">Unmatched</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {row.presentCount !== null ? row.presentCount : '—'}
                            {row.enrolledStrength !== null ? ` / ${row.enrolledStrength}` : ''}
                          </td>
                          <td className="py-2 px-3">
                            {row.isValid ? (
                              <span className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" />
                                <span>Valid</span>
                              </span>
                            ) : (
                              <span className="text-rose-700 text-[11px] font-medium">
                                {row.errors.join(' · ')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-[11px] text-neutral-500">
                  {!isAdminUnlocked && (
                    <span className="text-amber-800 font-medium">
                      Admin sign-in required to save register records.
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={parseResult.validRowsCount === 0 || isCommittingImport}
                  onClick={() => void commitValidatedAttendance()}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {isCommittingImport ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>
                    Commit {parseResult.validRowsCount} Row{parseResult.validRowsCount === 1 ? '' : 's'} &amp; Analyze
                  </span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </FadeContent>

      {/* Compact Analysis Progress Stepper */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-3.5 rounded-2xl rw-forest-hero text-white text-xs space-y-2.5 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300 shrink-0" />
                <span>
                  {ANALYSIS_STAGES[Math.max(0, analysisStageIndex)] || 'Evaluating campus schedule'}
                </span>
              </div>
              <span className="font-mono text-[11px] text-emerald-200/75 tabular-nums shrink-0">
                {Math.max(1, analysisStageIndex + 1)} / {ANALYSIS_STAGES.length}
              </span>
            </div>
            <Stepper
              steps={ANALYSIS_STAGES.map((label, idx) => ({ id: `stage-${idx}`, label }))}
              currentStep={Math.max(0, analysisStageIndex)}
              tone="dark"
              compact
              allowStepBack={false}
              ariaLabel="Allocation solver stages"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Concise 4-Metric Summary Strip */}
      <div className="rw-surface rounded-2xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-neutral-200/75 overflow-hidden">
        <div className="p-4 sm:px-5">
          <div className="text-[11px] font-medium text-[#64726b]">Recommended Moves</div>
          <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-2xl font-semibold text-[#111815] font-mono">
              <AnimatedNumber value={summary.recommendedMovesCount} />
            </span>
            <span className="text-xs text-[#64726b]">/ {summary.evaluatedSectionsCount} sections</span>
          </div>
          <div className="mt-0.5 text-[11px] text-[#64726b] tabular-nums">
            {summary.unchangedSectionsCount} unchanged
            {summary.unknownAttendanceCount > 0 ? ` · ${summary.unknownAttendanceCount} unknown` : ''}
          </div>
        </div>

        <div className="p-4 sm:px-5 bg-emerald-50/35 rw-card-alive">
          <div className="text-[11px] font-medium text-emerald-800">Estimated Savings</div>
          <div className="mt-1 flex items-baseline gap-1 tabular-nums">
            <span className="text-2xl font-semibold text-emerald-900 font-mono">
              <AnimatedNumber value={summary.totalProjectedSavingsKWh} decimals={2} prefix="+" />
            </span>
            <span className="text-xs font-semibold text-emerald-700">kWh</span>
          </div>
          <div className="mt-0.5 text-[11px] text-emerald-800/80">
            {analysisMode === 'projected' ? 'Next block (+2 seat margin)' : 'Evaluated windows'}
          </div>
        </div>

        <div className="p-4 sm:px-5">
          <div className="text-[11px] font-medium text-[#64726b]">Cost &amp; CO₂ Impact</div>
          <div className="mt-1 flex items-baseline gap-0.5 tabular-nums">
            <span className="text-xs font-semibold text-[#64726b]">₹</span>
            <span className="text-2xl font-semibold text-[#111815] font-mono">
              <AnimatedNumber value={summary.totalProjectedSavingsINR} decimals={2} />
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-[#64726b] tabular-nums">
            {summary.totalProjectedCo2AvoidedKg} kg CO₂ avoided
          </div>
        </div>

        <div className="p-4 sm:px-5">
          <div className="text-[11px] font-medium text-[#64726b]">Register Coverage</div>
          <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-2xl font-semibold text-[#111815] font-mono">
              <AnimatedNumber value={selectedDateMeta?.recordedSectionsCount || 0} />
            </span>
            <span className="text-xs text-[#64726b]">/ {bootstrap?.sections.length || 17} sections</span>
          </div>
          <div className="mt-0.5 text-[11px] text-[#64726b] truncate">
            {selectedDateMeta?.sourceSummary || 'Preloaded'}
          </div>
        </div>
      </div>

      {/* Sub-view Tab Strip */}
      <div>
        <SegmentedControl<InnerTab>
          layoutId="space-subtab-control"
          tone="light"
          value={innerTab}
          onChange={setInnerTab}
          options={[
            { id: 'recommendations', label: 'Recommendations', suffix: proposals.length },
            { id: 'sections', label: 'Sections', suffix: bootstrap?.sections.length || 17 },
            { id: 'rooms-timetable', label: 'Rooms & Timetable' },
            { id: 'history', label: 'Decision Log', suffix: historyEntries.length },
          ]}
        />
      </div>

      {/* TAB 1: RECOMMENDATIONS */}
      {innerTab === 'recommendations' && (
        <div className="space-y-4">
          {proposals.length === 0 ? (
            <div className="p-10 rounded-2xl bg-white border border-neutral-200/90 text-center space-y-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-700 mx-auto" />
              <div className="text-sm font-semibold text-neutral-900">
                No Classroom Reallocations Recommended
              </div>
              <p className="text-xs text-neutral-500 max-w-md mx-auto">
                No candidate room satisfies capacity, full-window availability, policy, and energy savings for {selectedDate}.
              </p>
            </div>
          ) : (
            <AnimatedList
              items={proposals}
              getKey={(prop) => prop.proposalId}
              className="space-y-3"
              renderItem={(prop) => {
                const isExpanded = Boolean(expandedProposalIds[prop.proposalId]);
                const isReviewing = reviewingProposalId === prop.proposalId;
                const moveType = classifyMoveType(prop);

                return (
                  <div
                    className={`rounded-2xl transition-colors ${
                      prop.status === 'approved'
                        ? 'rw-surface-sage border-emerald-300/90'
                        : prop.status === 'rejected'
                        ? 'rw-surface-muted opacity-80'
                        : 'rw-surface'
                    }`}
                  >
                    <div className="p-4 sm:p-5 space-y-4">
                      {/* Card Top Metadata */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-neutral-900">
                            {prop.sectionCode}
                          </span>
                          <span className="text-neutral-700 font-medium">
                            {prop.sectionDisplayName}
                          </span>
                          <span className="text-neutral-300" aria-hidden="true">·</span>
                          <span
                            className={`font-semibold ${
                              moveType.label === 'Section Consolidation'
                                ? 'text-teal-800'
                                : 'text-emerald-800'
                            }`}
                          >
                            {moveType.label}
                          </span>
                          <span className="text-neutral-300" aria-hidden="true">·</span>
                          <span className="font-mono text-neutral-600 tabular-nums">
                            {prop.windowLabel}
                          </span>
                        </div>

                        {prop.status !== 'pending' && (
                          <span
                            className={`font-semibold uppercase text-[10px] tracking-wider ${
                              prop.status === 'approved' ? 'text-emerald-700' : 'text-neutral-500'
                            }`}
                          >
                            {prop.status}
                            {prop.reviewedBy ? ` · ${prop.reviewedBy}` : ''}
                          </span>
                        )}
                      </div>

                      {/* Primary Comparison Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                        {/* Original vs Proposed Classroom */}
                        <div className="md:col-span-6 space-y-1">
                          <div className="flex items-center gap-2.5 flex-wrap text-xs">
                            <div>
                              <span className="font-mono font-bold text-neutral-800">
                                {prop.existingRoomCode}
                              </span>
                              <span className="text-neutral-500 ml-1.5">
                                {prop.existingRoomName} ({prop.existingRoomMaxOccupancy} seats)
                              </span>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <div>
                              <span className="font-mono font-bold text-emerald-900">
                                {prop.proposedRoomCode}
                              </span>
                              <span className="text-neutral-800 font-medium ml-1.5">
                                {prop.proposedRoomName} ({prop.proposedRoomMaxOccupancy} seats)
                              </span>
                            </div>
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {prop.subjectSummary} · {moveType.detail}
                          </div>
                        </div>

                        {/* Attendance & Room Capacity Fit */}
                        <div className="md:col-span-3 space-y-0.5 text-xs tabular-nums">
                          <div className="font-semibold text-neutral-900 font-mono">
                            {prop.presentCount}/{prop.enrolledStrength} present
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {prop.safetyMarginApplied > 0
                              ? `${prop.effectiveRequiredSeats} seats req. (+${prop.safetyMarginApplied})`
                              : `${prop.utilizationProposedPercent}% room utilisation`}
                          </div>
                        </div>

                        {/* Energy Impact */}
                        <div className="md:col-span-3 md:text-right space-y-0.5 tabular-nums">
                          <div className="text-base font-bold font-mono text-emerald-800">
                            +{prop.netEnergySavingsKWh} kWh
                          </div>
                          <div className="text-[11px] text-neutral-500 font-mono">
                            ₹{prop.costSavingsINR} · {prop.co2AvoidedKg} kg CO₂
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProposalIds((prev) => ({
                              ...prev,
                              [prop.proposalId]: !isExpanded,
                            }))
                          }
                          className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>
                            {isExpanded
                              ? 'Hide details'
                              : `Details & rejected options (${prop.rejectedAlternatives.length})`}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {prop.status === 'pending' && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={isReviewing}
                              onClick={() => handleReviewProposal(prop, 'rejected')}
                              className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-xs font-semibold text-neutral-700 inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            >
                              <XCircle className="w-3.5 h-3.5 text-neutral-400" />
                              <span>Reject</span>
                            </button>
                            <button
                              type="button"
                              disabled={isReviewing}
                              onClick={() => handleReviewProposal(prop, 'approved')}
                              className="px-3.5 py-1.5 rounded-lg bg-[#0b2e22] hover:bg-[#114231] text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            >
                              {isReviewing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : !isAdminUnlocked ? (
                                <KeyRound className="w-3.5 h-3.5" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>{isAdminUnlocked ? 'Approve' : 'Approve (Admin)'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progressive Disclosure: Constraint Trace & Rejected Alternatives */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="border-t border-neutral-200/80 bg-neutral-50/60 px-4 sm:px-5 py-4 space-y-4 overflow-hidden"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-700 tabular-nums">
                            <div className="inline-flex flex-wrap items-center gap-1.5 overflow-x-auto">
                              <MathText
                                tex={`\\Delta E = ${prop.existingEnergyKWh}\\,\\mathrm{kWh} - ${prop.proposedEnergyKWh}\\,\\mathrm{kWh} = ${prop.netEnergySavingsKWh}\\,\\mathrm{kWh}\\;\\;(\\Delta t = ${prop.durationHours}\\,\\mathrm{h})`}
                                ariaLabel={`Delta E equals ${prop.existingEnergyKWh} kWh minus ${prop.proposedEnergyKWh} kWh equals ${prop.netEnergySavingsKWh} kWh over ${prop.durationHours} hours`}
                              />
                              <span className="font-mono text-neutral-500">
                                ({prop.existingRoomCode} → {prop.proposedRoomCode})
                              </span>
                            </div>
                            <span className="font-mono text-neutral-600">
                              Attendance source: {prop.attendanceSource} · {prop.attendanceDate}
                            </span>
                          </div>

                          <ul className="space-y-1.5 text-xs text-neutral-700 list-disc pl-4">
                            {prop.explanationTrace.map((line, i) => (
                              <li key={i} className="leading-relaxed">
                                {line}
                              </li>
                            ))}
                          </ul>

                          {prop.rejectedAlternatives.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                                Evaluated Alternatives Rejected
                              </div>
                              <div className="rounded-xl border border-neutral-200/80 overflow-x-auto bg-white">
                                <table className="w-full min-w-[500px] text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                                      <th className="py-2 px-3 whitespace-nowrap">Room</th>
                                      <th className="py-2 px-3 text-right whitespace-nowrap">Seats</th>
                                      <th className="py-2 px-3 whitespace-nowrap">Constraint</th>
                                      <th className="py-2 px-3 whitespace-nowrap">Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-neutral-100">
                                    {prop.rejectedAlternatives.map((rej) => (
                                      <tr key={`${rej.roomId}-${rej.reasonCategory}`}>
                                        <td className="py-2 px-3 font-mono font-semibold text-neutral-800 whitespace-nowrap">
                                          {rej.roomCode}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono tabular-nums text-neutral-600">
                                          {rej.maxOccupancy}
                                        </td>
                                        <td className="py-2 px-3 font-medium text-neutral-700 whitespace-nowrap">
                                          {REJECTION_CATEGORY_LABELS[rej.reasonCategory] ||
                                            rej.reasonCategory}
                                        </td>
                                        <td className="py-2 px-3 text-neutral-600">
                                          {rej.reasonDetail}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }}
            />
          )}

          {/* Progressive Disclosure for Unchanged Sections */}
          {unchanged.length > 0 && (
            <div className="bg-white border border-neutral-200/90 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowUnchanged((v) => !v)}
                className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-neutral-50/70 transition-colors cursor-pointer"
              >
                <div className="text-xs">
                  <span className="font-semibold text-neutral-900">
                    Unchanged Sections ({unchanged.length})
                  </span>
                  <span className="text-neutral-500 ml-2">
                    Remaining in scheduled classrooms
                  </span>
                </div>
                <span className="text-xs font-semibold text-neutral-600 inline-flex items-center gap-1 shrink-0">
                  <span>{showUnchanged ? 'Hide' : 'Show'}</span>
                  {showUnchanged ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </span>
              </button>

              {showUnchanged && (
                <div className="border-t border-neutral-200/80 divide-y divide-neutral-100">
                  {unchanged.map((item) => {
                    const isOpen = Boolean(expandedUnchangedIds[item.sectionId]);
                    return (
                      <div key={item.sectionId} className="px-4 sm:px-5 py-3 text-xs space-y-2">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-neutral-900">
                                {item.sectionCode}
                              </span>
                              <span className="text-neutral-500 font-mono">
                                ({item.homeRoomCode})
                              </span>
                              <span className="text-neutral-300" aria-hidden="true">·</span>
                              <span className="text-neutral-700 font-mono tabular-nums">
                                {item.presentCount !== null
                                  ? `${item.presentCount}/${item.enrolledStrength}`
                                  : `Enrolled ${item.enrolledStrength} (Unknown)`}
                              </span>
                            </div>
                            <div className="text-[11px] text-neutral-500">
                              {item.primaryReason}
                            </div>
                          </div>

                          {item.rejectedAlternatives.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedUnchangedIds((prev) => ({
                                  ...prev,
                                  [item.sectionId]: !isOpen,
                                }))
                              }
                              className="self-start md:self-auto px-2.5 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-[11px] font-semibold text-neutral-700 shrink-0 cursor-pointer"
                            >
                              {isOpen ? 'Hide checks' : `${item.rejectedAlternatives.length} checked`}
                            </button>
                          )}
                        </div>

                        {isOpen && item.rejectedAlternatives.length > 0 && (
                          <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200/80 space-y-1 text-[11px] text-neutral-600">
                            {item.rejectedAlternatives.map((rej) => (
                              <div key={`${rej.roomId}-${rej.reasonCategory}`}>
                                <strong className="font-mono text-neutral-800">{rej.roomCode}</strong>{' '}
                                ({rej.maxOccupancy} seats): {rej.reasonDetail}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SECTIONS & REGISTER ATTENDANCE */}
      {innerTab === 'sections' && bootstrap && (
        <div className="rw-surface rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-neutral-900">
              Section Strength, Attendance ({selectedDate}) &amp; Allocation Policy
            </div>
            {!isAdminUnlocked && (
              <button
                type="button"
                onClick={() => openAuthModal()}
                className="px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <KeyRound className="w-3 h-3" />
                <span>Admin Edit</span>
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[740px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Section</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Home Room</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Enrolled</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Present</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Source</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Policy</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {bootstrap.latestSectionAttendance.map((entry) => {
                  const sec = entry.section;
                  const isEditing = editingSectionId === sec.sectionId;
                  const isSaving = savingSectionId === sec.sectionId;

                  return (
                    <tr key={sec.sectionId} className="hover:bg-neutral-50/70 transition-colors">
                      <td className="py-2.5 px-4">
                        <span className="font-semibold text-neutral-900">{sec.displayName}</span>
                        <span className="ml-2 text-[11px] text-neutral-400 font-mono">
                          {sec.sectionCode}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-neutral-800">
                        {sec.homeRoomCode}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            min={10}
                            max={120}
                            value={sectionStrengthDraft}
                            onChange={(e) => setSectionStrengthDraft(Number(e.target.value))}
                            className="w-20 px-2 py-1 rounded-lg border border-neutral-300 text-right font-mono text-xs"
                          />
                        ) : (
                          <span>{sec.enrolledStrength}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {entry.presentCount !== null ? (
                          <span className="font-semibold text-neutral-900">
                            {entry.presentCount}/{sec.enrolledStrength} ({entry.attendancePercent}%)
                          </span>
                        ) : (
                          <span className="text-neutral-400">Unknown</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-neutral-500">
                        {entry.source || '—'}
                      </td>
                      <td className="py-2.5 px-4">
                        {isEditing ? (
                          <select
                            value={sectionPolicyDraft}
                            onChange={(e) =>
                              setSectionPolicyDraft(e.target.value as SectionAllocationPolicy)
                            }
                            className="px-2 py-1 rounded-lg border border-neutral-300 text-xs"
                          >
                            <option value="approved_flexible_block">Flexible Block</option>
                            <option value="fixed_home_room">Fixed Home Room</option>
                            <option value="restricted">Restricted</option>
                          </select>
                        ) : (
                          <span
                            className={`font-medium ${
                              sec.policy === 'approved_flexible_block'
                                ? 'text-emerald-800'
                                : 'text-neutral-600'
                            }`}
                          >
                            {POLICY_LABELS[sec.policy]}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingSectionId(null)}
                              className="px-2 py-1 rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-100 cursor-pointer whitespace-nowrap"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSaveSection(sec)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white font-semibold hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
                            >
                              {isSaving ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSectionId(sec.sectionId);
                              setSectionStrengthDraft(sec.enrolledStrength);
                              setSectionPolicyDraft(sec.policy);
                            }}
                            className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 font-semibold text-neutral-700 cursor-pointer whitespace-nowrap"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ROOMS & TIMETABLE */}
      {innerTab === 'rooms-timetable' && bootstrap && (
        <div className="space-y-5">
          <div className="rw-surface rounded-2xl overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-neutral-900">
                Classroom Inventory &amp; Max Occupancy ({bootstrap.rooms.length} Rooms)
              </div>
              <span className="text-[11px] text-neutral-500">
                Click any room code for live controls
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse min-w-[740px]">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    <th className="py-2.5 px-4 whitespace-nowrap">Code</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Classroom</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Pool</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Power</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Max Occupancy</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {bootstrap.rooms.map((room) => {
                    const isEditing = editingRoomId === room.roomId;
                    const isSaving = savingRoomId === room.roomId;
                    return (
                      <tr key={room.roomId} className="hover:bg-neutral-50/70 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-bold text-neutral-900">
                          <button
                            type="button"
                            onClick={() => setSelectedRoomId(room.roomId)}
                            className="hover:text-emerald-700 underline decoration-dotted underline-offset-2 cursor-pointer"
                          >
                            {room.roomCode}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 font-medium text-neutral-900">
                          {room.roomName}
                        </td>
                        <td className="py-2.5 px-4 text-neutral-500">
                          {room.building} · {room.floor}
                        </td>
                        <td className="py-2.5 px-4 text-[11px]">
                          {room.isRestricted ? (
                            <span className="text-rose-700 font-medium">Restricted</span>
                          ) : room.isSpecialisedLab ? (
                            <span className="text-amber-800 font-medium">Specialised Lab</span>
                          ) : room.isGeneralPoolEligible ? (
                            <span className="text-emerald-800 font-medium">General Pool</span>
                          ) : (
                            <span className="text-neutral-600">{room.roomType}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-neutral-700">
                          {room.estimatedOperatingWatts} W
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums">
                          {isEditing ? (
                            <input
                              type="number"
                              min={10}
                              max={400}
                              value={roomCapDraft}
                              onChange={(e) => setRoomCapDraft(Number(e.target.value))}
                              className="w-20 px-2 py-1 rounded-lg border border-neutral-300 text-right font-mono text-xs"
                            />
                          ) : (
                            <span>{room.maxOccupancy}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingRoomId(null)}
                                className="px-2 py-1 rounded-lg border border-neutral-200 text-neutral-600 cursor-pointer whitespace-nowrap"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleSaveRoomCapacity(room)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-700 text-white font-semibold cursor-pointer whitespace-nowrap"
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRoomId(room.roomId);
                                setRoomCapDraft(room.maxOccupancy);
                              }}
                              className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 font-semibold text-neutral-700 cursor-pointer whitespace-nowrap"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rw-surface rounded-2xl overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-neutral-200/80 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-neutral-900">
                Timetable Rotations ({timetableDayFilter === 6 ? 'Saturday' : `Weekday · Day ${timetableDayFilter}`})
              </div>
              <span className="text-[11px] font-mono text-neutral-500 tabular-nums whitespace-nowrap">
                {bootstrap.timetableSlots.length} periods
              </span>
            </div>

            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse min-w-[700px]">
                <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="py-2 px-4 whitespace-nowrap">Period</th>
                    <th className="py-2 px-4 whitespace-nowrap">Time (IST)</th>
                    <th className="py-2 px-4 whitespace-nowrap">Section</th>
                    <th className="py-2 px-4 whitespace-nowrap">Room</th>
                    <th className="py-2 px-4 whitespace-nowrap">Subject</th>
                    <th className="py-2 px-4 whitespace-nowrap">Mobility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {bootstrap.timetableSlots
                    .filter((s) => s.periodCode >= 'P5' || s.requiresLabFacility)
                    .slice(0, 60)
                    .map((slot) => {
                      const sec = sectionsById.get(slot.sectionId);
                      const rm = roomsById.get(slot.roomId);
                      return (
                        <tr key={slot.slotId} className="hover:bg-neutral-50/70">
                          <td className="py-2 px-4 font-mono font-semibold text-neutral-900">
                            {slot.periodCode}
                          </td>
                          <td className="py-2 px-4 font-mono text-neutral-600 tabular-nums">
                            {slot.startTime}–{slot.endTime}
                          </td>
                          <td className="py-2 px-4 font-medium text-neutral-900">
                            {sec?.sectionCode || slot.sectionId}
                          </td>
                          <td className="py-2 px-4 font-mono text-neutral-700">
                            {rm?.roomCode || slot.roomId}
                          </td>
                          <td className="py-2 px-4 text-neutral-600">{slot.subject}</td>
                          <td className="py-2 px-4">
                            {slot.requiresLabFacility ? (
                              <span className="text-amber-800 font-medium">Lab Pinned</span>
                            ) : slot.isMovableBlock ? (
                              <span className="text-emerald-800 font-medium">
                                Movable ({slot.blockWindowLabel})
                              </span>
                            ) : (
                              <span className="text-neutral-500">Fixed Policy</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DECISION LOG */}
      {innerTab === 'history' && (
        <div className="rw-surface rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-neutral-200/80">
            <div className="text-xs font-semibold text-neutral-900">
              Allocation Decision Log
            </div>
          </div>

          {historyEntries.length === 0 ? (
            <div className="p-10 text-center text-xs text-neutral-500 space-y-1.5">
              <History className="w-5 h-5 text-neutral-400 mx-auto" />
              <div className="font-semibold text-neutral-800">No decisions logged yet</div>
              <p>Approve or reject a recommendation to record it here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    <th className="py-2.5 px-4 whitespace-nowrap">Date</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Section</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Assignment</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Window</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Impact</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Decision</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Reviewed By</th>
                  </tr>
                </thead>
                <AnimatedList
                  as="tbody"
                  items={historyEntries}
                  getKey={(h) => h.historyId}
                  className="divide-y divide-neutral-100"
                  renderItem={(h) => (
                    <AnimatedTableRow className="hover:bg-neutral-50/70">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-neutral-600">
                        {h.attendanceDate}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-neutral-900">
                        {h.sectionDisplayName}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-neutral-800">
                        {h.existingRoomCode} → {h.proposedRoomCode}
                      </td>
                      <td className="py-2.5 px-4 text-neutral-600">{h.windowLabel}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-800 tabular-nums">
                        +{h.netEnergySavingsKWh} kWh (₹{h.costSavingsINR})
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`font-semibold uppercase text-[10px] tracking-wider ${
                            h.decision === 'approved' ? 'text-emerald-700' : 'text-neutral-500'
                          }`}
                        >
                          {h.decision}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-neutral-600">
                        <div>{h.actorName}</div>
                        <div className="text-[11px] text-neutral-600 tabular-nums">
                          {new Date(h.decidedAt).toLocaleString('en-IN')}
                        </div>
                      </td>
                    </AnimatedTableRow>
                  )}
                />
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
