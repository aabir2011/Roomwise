/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import {
  Appliance,
  Classroom,
  SchoolSettings,
  StaffProfile,
  AuditFinding,
  CampusEnergySummary,
} from '../types/energy';
import type { VoiceNavDirective } from '../types/voice';
import {
  INITIAL_CLASSROOMS,
  INITIAL_SCHOOL_SETTINGS,
  STAFF_PROFILES,
  computeHeatIndex,
} from '../data/initialClassrooms';
import {
  buildExpandedAppliancesFromSpec,
  computeAppliancesRatedPowerWatts,
  getRoomApplianceSpec,
  getRoomOperatingProfile,
} from '../data/roomApplianceSpecs';
import {
  expandClassroomAppliances,
  applyApplianceState,
  clampPercent,
  computeAdaptiveTargetLightPercent,
  computeAdaptiveTargetFanPercent,
  summarizeApplianceGroup,
} from '../utils/applianceUtils';
import { evaluateLiveAuditFindings } from '../utils/auditEngine';
import { ensureDemoResetOnPageLoad } from '../utils/demoReset';
import { useAuth, authFetch } from './AuthContext';

export interface ApplianceCommandResult {
  ok: boolean;
  error?: string;
}

interface EnergyContextType {
  classrooms: Classroom[];
  settings: SchoolSettings;
  staffList: StaffProfile[];
  currentStaff: StaffProfile;
  auditFindings: AuditFinding[];
  activeTab: string;
  selectedRoom: Classroom | null;
  qrModalRoom: Classroom | null;
  isSimulating: boolean;
  isMobileMenuOpen: boolean;
  campusSummary: CampusEnergySummary;
  pendingRooms: Record<string, boolean>;
  pendingAppliances: Record<string, boolean>;
  applianceControlError: string | null;
  clearApplianceControlError: () => void;
  setActiveTab: (tab: string) => void;
  goBackTab: () => string;
  voiceNavDirective: VoiceNavDirective | null;
  setVoiceNavDirective: (directive: VoiceNavDirective | null) => void;
  clearVoiceNavDirective: (id?: string) => void;
  setSelectedRoomId: (id: string | null) => void;
  setQrModalRoom: (room: Classroom | null) => void;
  setCurrentStaffId: (id: string) => void;
  setIsMobileMenuOpen: (open: boolean) => void;
  updateSettings: (newSettings: Partial<SchoolSettings>) => void;
  toggleSimulation: () => void;
  setSimulationRunning: (running: boolean) => void;
  exportAnalyticsCsv: () => { count: number; fileName: string };
  triggerRoomRecalibration: (roomId: string) => void;
  setApplianceOutput: (
    roomId: string,
    applianceId: string,
    outputPercent: number
  ) => Promise<ApplianceCommandResult>;
  setGroupOutput: (
    roomId: string,
    type: 'lights' | 'fan',
    outputPercent: number
  ) => Promise<ApplianceCommandResult>;
  restoreApplianceAuto: (
    roomId: string,
    applianceId: string
  ) => Promise<ApplianceCommandResult>;
  resetRoomToAdaptive: (roomId: string) => Promise<ApplianceCommandResult>;
  toggleApplianceOverride: (
    roomId: string,
    applianceId: string,
    newState: string,
    watts: number,
    fanSpeed?: number
  ) => void;
  resolveAuditFinding: (
    findingId: string
  ) => Promise<{ ok: boolean; curtailedWatts: number; error?: string }>;
  remediateAllFindings: () => Promise<{
    ok: boolean;
    count: number;
    curtailedWatts: number;
    error?: string;
  }>;
  updateRoomManualParams: (
    roomId: string,
    params: Partial<{
      targetLux: number;
      maxFanSpeed: number;
      autoEcoMode: boolean;
      overtimeAllowed: boolean;
    }>
  ) => void;
  updateRoomCapacity: (roomId: string, maxOccupancy: number) => void;
  applyServerRoomAppliances: (
    roomId: string,
    appliances: Appliance[],
    totalPowerWatts?: number,
    decisionNote?: string
  ) => void;
  applyCampusOptimizationSync: (
    optimizedRooms: Array<{
      roomId: string;
      roomCode: string;
      appliances: Appliance[];
      totalPowerWatts: number;
    }>,
    resolvedFindingIds?: string[],
    decisionNote?: string
  ) => void;
}

const EnergyContext = createContext<EnergyContextType | undefined>(undefined);

const VALID_TABS = new Set([
  'dashboard',
  'digital-twin',
  'campus-live',
  'classrooms',
  'environmental-solar',
  'environmental',
  'solar',
  'space-intelligence',
  'analytics',
  'history',
  'audit',
  'reports',
  'settings',
]);

function computeDailyKWhFromWatts(watts: number, roomType?: Classroom['type']): number {
  const { activeHoursPerSchoolDay } = getRoomOperatingProfile(roomType);
  return Number(((watts * activeHoursPerSchoolDay) / 1000).toFixed(2));
}

function computeDailyBaselineKWhFromWatts(watts: number, roomType?: Classroom['type']): number {
  const { activeHoursPerSchoolDay, baselineDutyFactor } = getRoomOperatingProfile(roomType);
  return Number(((watts * activeHoursPerSchoolDay * baselineDutyFactor) / 1000).toFixed(2));
}

function createInitialExpandedClassrooms(): Classroom[] {
  return INITIAL_CLASSROOMS.map((room) => {
    const spec = getRoomApplianceSpec(room.id);
    if (!spec) {
      const expanded = expandClassroomAppliances(room);
      return {
        ...expanded,
        dailyActualKWh: computeDailyKWhFromWatts(expanded.currentPowerWatts, expanded.type),
        dailyBaselineKWh: computeDailyBaselineKWhFromWatts(expanded.baselinePowerWatts, expanded.type),
      };
    }
    const appliances = buildExpandedAppliancesFromSpec(spec);
    const currentPowerWatts = appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
    const ratedPowerWatts = computeAppliancesRatedPowerWatts(appliances);
    return {
      ...room,
      appliances,
      currentPowerWatts,
      ratedPowerWatts,
      dailyActualKWh: computeDailyKWhFromWatts(currentPowerWatts, room.type),
      dailyBaselineKWh: computeDailyBaselineKWhFromWatts(room.baselinePowerWatts, room.type),
    };
  });
}

function buildDecisionForAppliances(
  room: Classroom,
  appliances: Appliance[],
  customNote?: string
): Classroom['decision'] {
  const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
  const lightSummary = summarizeApplianceGroup(appliances, 'lights');
  const fanSummary = summarizeApplianceGroup(appliances, 'fan');
  const hasAnyManual = appliances.some((a) => a.operatingMode === 'MANUAL' || a.isManualOverride);

  const nowTime = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const lightingAction =
    lightSummary.activeCount === 0
      ? 'All lighting units OFF (0W)'
      : `${lightSummary.activeCount}/${lightSummary.totalCount} lights active (${lightSummary.avgPercent}% avg, ${lightSummary.totalWatts}W)`;

  const fanAction =
    fanSummary.activeCount === 0
      ? 'All fan sectors OFF (0W)'
      : `${fanSummary.activeCount}/${fanSummary.totalCount} fan sectors active (${fanSummary.avgPercent}% avg, ${fanSummary.totalWatts}W)`;

  if (customNote) {
    return {
      ...room.decision,
      timestamp: nowTime,
      lightingAction,
      fanAction,
      ruleExplanation: customNote,
    };
  }

  if (!hasAnyManual && isVacant) {
    return {
      ...room.decision,
      timestamp: nowTime,
      lightingAction: 'All lighting units powered OFF (0W)',
      lightingReason: 'No recent PIR motion detected beyond grace window. Auto-shed active.',
      fanAction: 'All BLDC fan sectors stopped (0W)',
      fanReason: 'No recent PIR motion detected. Thermal circulation suspended.',
      ruleExplanation:
        'No recent PIR motion detected beyond grace window. Autonomous eco-shedding active: all lighting units and fan sectors turned OFF (0W).',
    };
  }

  if (!hasAnyManual) {
    return {
      ...room.decision,
      timestamp: nowTime,
      lightingAction,
      lightingReason: 'Target desk lux continuously met with harvested daylight.',
      fanAction,
      fanReason: 'BLDC sector speeds optimized for real-time indoor thermal heat index.',
      ruleExplanation:
        'Adaptive closed-loop control active across all lighting units and fan sectors.',
    };
  }

  const manualUnits = appliances
    .filter((a) => a.operatingMode === 'MANUAL' || a.isManualOverride)
    .map((a) => `${a.unitCode || a.name}:${a.outputPercent === 0 ? 'OFF' : `${a.outputPercent}%`}`)
    .slice(0, 6);

  return {
    ...room.decision,
    timestamp: nowTime,
    lightingAction,
    fanAction,
    ruleExplanation: `Manual override active on ${manualUnits.join(', ')}${
      appliances.filter((a) => a.operatingMode === 'MANUAL').length > 6 ? '…' : ''
    }. Remaining AUTO units continue dynamic control.`,
  };
}

export const EnergyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { authenticatedAdmin } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>(createInitialExpandedClassrooms);
  const classroomsRef = useRef<Classroom[]>(classrooms);
  classroomsRef.current = classrooms;

  const [settings, setSettings] = useState<SchoolSettings>(INITIAL_SCHOOL_SETTINGS);
  const settingsRef = useRef<SchoolSettings>(settings);
  settingsRef.current = settings;
  const [staffList] = useState<StaffProfile[]>(STAFF_PROFILES);
  const [currentStaffId, setCurrentStaffId] = useState<string>(STAFF_PROFILES[0].id);
  const [resolvedAuditSnapshots, setResolvedAuditSnapshots] = useState<Record<string, AuditFinding>>({});
  const auditFindings = useMemo(() => {
    const resolvedIds: Record<string, boolean> = {};
    for (const id of Object.keys(resolvedAuditSnapshots)) {
      resolvedIds[id] = true;
    }
    return evaluateLiveAuditFindings(classrooms, settings, resolvedIds, resolvedAuditSnapshots);
  }, [classrooms, settings, resolvedAuditSnapshots]);
  const auditFindingsRef = useRef<AuditFinding[]>(auditFindings);
  auditFindingsRef.current = auditFindings;

  // Automatically drop resolved marker if a room develops a fresh unresolved violation
  useEffect(() => {
    setResolvedAuditSnapshots((prev) => {
      let mutated = false;
      let next: Record<string, AuditFinding> | null = null;
      for (const finding of auditFindings) {
        if (!finding.isResolved && prev[finding.id]) {
          if (!next) next = { ...prev };
          delete next[finding.id];
          mutated = true;
        }
      }
      return mutated && next ? next : prev;
    });
  }, [auditFindings]);

  const [activeTab, setActiveTabState] = useState<string>('dashboard');
  const [voiceNavDirective, setVoiceNavDirectiveState] = useState<VoiceNavDirective | null>(null);
  const tabHistoryRef = useRef<string[]>(['dashboard']);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [qrModalRoom, setQrModalRoom] = useState<Classroom | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  const [pendingRooms, setPendingRooms] = useState<Record<string, boolean>>({});
  const [pendingAppliances, setPendingAppliances] = useState<Record<string, boolean>>({});
  const [applianceControlError, setApplianceControlError] = useState<string | null>(null);

  const clientIdRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `rw-${crypto.randomUUID()}`
      : `rw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const clientSeqByRoomRef = useRef<Record<string, number>>({});
  const roomQueueRef = useRef<Record<string, Promise<unknown>>>({});

  const clearApplianceControlError = useCallback(() => {
    setApplianceControlError(null);
  }, []);

  const setActiveTab = useCallback((tab: string) => {
    if (VALID_TABS.has(tab)) {
      const stack = tabHistoryRef.current;
      if (stack[stack.length - 1] !== tab) {
        stack.push(tab);
        if (stack.length > 20) stack.shift();
      }
      setActiveTabState(tab);
    }
  }, []);

  const goBackTab = useCallback((): string => {
    const stack = tabHistoryRef.current;
    if (stack.length > 1) {
      stack.pop();
    }
    const prev = stack[stack.length - 1] || 'dashboard';
    setActiveTabState(prev);
    return prev;
  }, []);

  const setVoiceNavDirective = useCallback((directive: VoiceNavDirective | null) => {
    setVoiceNavDirectiveState(directive);
  }, []);

  const clearVoiceNavDirective = useCallback((id?: string) => {
    setVoiceNavDirectiveState((prev) => {
      if (!prev) return null;
      if (id && prev.id !== id) return prev;
      return null;
    });
  }, []);

  useEffect(() => {
    if (authenticatedAdmin?.id) {
      setCurrentStaffId(authenticatedAdmin.id);
    } else {
      setCurrentStaffId(STAFF_PROFILES[0].id);
    }
  }, [authenticatedAdmin?.id]);

  // Hydrate persisted simulated-node appliance states from backend on mount
  const syncAppliancesFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/classrooms/appliances/state');
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.ok || !data.rooms) return;

      setClassrooms((prev) =>
        prev.map((room) => {
          const serverRoom = data.rooms[room.id];
          if (!serverRoom || !Array.isArray(serverRoom.appliances)) return room;

          const normalizedApps: Appliance[] = serverRoom.appliances.map((app: Appliance) => ({
            ...app,
            outputPercent: clampPercent(app.outputPercent ?? 0),
            operatingMode: app.operatingMode === 'MANUAL' || app.isManualOverride ? 'MANUAL' : 'AUTO',
            isManualOverride: Boolean(app.operatingMode === 'MANUAL' || app.isManualOverride),
          }));

          const totalPowerWatts = normalizedApps.reduce((acc, a) => acc + a.currentPowerWatts, 0);
          const ratedPowerWatts = computeAppliancesRatedPowerWatts(normalizedApps);
          return {
            ...room,
            appliances: normalizedApps,
            currentPowerWatts: totalPowerWatts,
            ratedPowerWatts,
            dailyActualKWh: computeDailyKWhFromWatts(totalPowerWatts, room.type),
            decision: buildDecisionForAppliances(room, normalizedApps),
          };
        })
      );
    } catch {
      // keep expanded defaults if backend state fetch fails
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateAfterReset = async () => {
      await ensureDemoResetOnPageLoad();
      if (cancelled) return;

      await Promise.all([
        syncAppliancesFromServer(),
        authFetch('/api/settings')
          .then((res) => (res.ok ? res.json() : null))
          .then((data: { ok?: boolean; settings?: SchoolSettings } | null) => {
            if (!cancelled && data?.ok && data.settings) {
              setSettings(data.settings);
            }
          })
          .catch(() => {}),
        fetch('/api/space/bootstrap')
          .then((res) => (res.ok ? res.json() : null))
          .then((data: { ok?: boolean; rooms?: Array<{ roomId: string; maxOccupancy: number }> } | null) => {
            if (cancelled || !data?.ok || !Array.isArray(data.rooms)) return;
            const capByRoom = new Map(data.rooms.map((r) => [r.roomId, r.maxOccupancy]));
            setClassrooms((prev) =>
              prev.map((room) => {
                const cap = capByRoom.get(room.id);
                return typeof cap === 'number' && cap > 0 && cap !== room.capacity
                  ? { ...room, capacity: cap }
                  : room;
              })
            );
          })
          .catch(() => {}),
      ]);
    };

    void hydrateAfterReset();

    return () => {
      cancelled = true;
    };
  }, [syncAppliancesFromServer]);

  const applyServerRoomAppliances = useCallback(
    (
      roomId: string,
      appliances: Appliance[],
      totalPowerWatts?: number,
      decisionNote?: string
    ) => {
      const normalizedApps: Appliance[] = appliances.map((app) => ({
        ...app,
        outputPercent: clampPercent(app.outputPercent ?? 0),
        operatingMode: app.operatingMode === 'MANUAL' || app.isManualOverride ? 'MANUAL' : 'AUTO',
        isManualOverride: Boolean(app.operatingMode === 'MANUAL' || app.isManualOverride),
      }));
      const computedWatts =
        typeof totalPowerWatts === 'number'
          ? totalPowerWatts
          : normalizedApps.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      const ratedPowerWatts = computeAppliancesRatedPowerWatts(normalizedApps);

      setClassrooms((prev) =>
        prev.map((room) =>
          room.id === roomId
            ? {
                ...room,
                appliances: normalizedApps,
                currentPowerWatts: computedWatts,
                ratedPowerWatts,
                dailyActualKWh: computeDailyKWhFromWatts(computedWatts, room.type),
                decision: buildDecisionForAppliances(room, normalizedApps, decisionNote),
              }
            : room
        )
      );
    },
    []
  );

  const applyCampusOptimizationSync = useCallback(
    (
      optimizedRooms: Array<{
        roomId: string;
        roomCode: string;
        appliances: Appliance[];
        totalPowerWatts: number;
      }>,
      resolvedFindingIds?: string[],
      decisionNote?: string
    ) => {
      const byRoomId = new Map(optimizedRooms.map((r) => [r.roomId, r]));
      if (byRoomId.size > 0) {
        setClassrooms((prev) =>
          prev.map((room) => {
            const opt = byRoomId.get(room.id);
            if (!opt) return room;
            const normalizedApps: Appliance[] = opt.appliances.map((app) => ({
              ...app,
              outputPercent: clampPercent(app.outputPercent ?? 0),
              operatingMode:
                app.operatingMode === 'MANUAL' || app.isManualOverride ? 'MANUAL' : 'AUTO',
              isManualOverride: Boolean(app.operatingMode === 'MANUAL' || app.isManualOverride),
            }));
            const computedWatts =
              typeof opt.totalPowerWatts === 'number'
                ? opt.totalPowerWatts
                : normalizedApps.reduce((acc, a) => acc + a.currentPowerWatts, 0);
            const ratedPowerWatts = computeAppliancesRatedPowerWatts(normalizedApps);
            return {
              ...room,
              appliances: normalizedApps,
              currentPowerWatts: computedWatts,
              ratedPowerWatts,
              dailyActualKWh: computeDailyKWhFromWatts(computedWatts, room.type),
              decision: buildDecisionForAppliances(room, normalizedApps, decisionNote),
            };
          })
        );
      }

      const idSet = new Set(resolvedFindingIds || []);
      const touchedRoomIds = new Set(optimizedRooms.map((r) => r.roomId));
      setResolvedAuditSnapshots((prev) => {
        const next = { ...prev };
        for (const f of auditFindingsRef.current) {
          if (idSet.has(f.id) || (touchedRoomIds.has(f.classroomId) && !f.isResolved)) {
            next[f.id] = { ...f, isResolved: true };
          }
        }
        return next;
      });
    },
    []
  );

  const currentStaff = useMemo(() => {
    return staffList.find((s) => s.id === currentStaffId) || staffList[0];
  }, [staffList, currentStaffId]);

  const selectedRoom = useMemo(() => {
    if (!selectedRoomId) return null;
    return classrooms.find((c) => c.id === selectedRoomId) || null;
  }, [classrooms, selectedRoomId]);

  const campusSummary = useMemo<CampusEnergySummary>(() => {
    let totalCurrentPowerWatts = 0;
    let totalRatedPowerWatts = 0;
    let totalBaselinePowerWatts = 0;
    let dailyActualKWh = 0;
    let dailyBaselineKWh = 0;
    let activeOccupancyCount = 0;
    let totalRoomsOccupied = 0;
    let totalRoomsCalibrated = 0;

    classrooms.forEach((room) => {
      totalCurrentPowerWatts += room.currentPowerWatts;
      totalRatedPowerWatts +=
        room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
      totalBaselinePowerWatts += room.baselinePowerWatts;
      dailyActualKWh += room.dailyActualKWh;
      dailyBaselineKWh += room.dailyBaselineKWh;
      activeOccupancyCount += room.currentOccupants;
      if (room.occupancyStatus === 'Occupied') totalRoomsOccupied++;
      if (room.calibration.isCalibrated) totalRoomsCalibrated++;
    });

    const curtailedFromRatedWatts = Math.max(0, totalRatedPowerWatts - totalCurrentPowerWatts);
    const ratedUtilizationPercent =
      totalRatedPowerWatts > 0
        ? Number(((totalCurrentPowerWatts / totalRatedPowerWatts) * 100).toFixed(1))
        : 0;
    const powerSavedWatts = Math.max(0, totalBaselinePowerWatts - totalCurrentPowerWatts);
    const dailySavedKWh = Math.max(0, dailyBaselineKWh - dailyActualKWh);
    const dailyCostSavedINR = Number((dailySavedKWh * settings.tariffPerKWhINR).toFixed(2));
    const dailyEmissionsAvoidedKgCO2 = Number(
      (dailySavedKWh * settings.gridCarbonFactorKgCO2PerKWh).toFixed(2)
    );

    return {
      totalCurrentPowerWatts,
      totalRatedPowerWatts,
      curtailedFromRatedWatts,
      ratedUtilizationPercent,
      totalBaselinePowerWatts,
      powerSavedWatts,
      dailyActualKWh: Number(dailyActualKWh.toFixed(2)),
      dailyBaselineKWh: Number(dailyBaselineKWh.toFixed(2)),
      dailySavedKWh: Number(dailySavedKWh.toFixed(2)),
      dailyCostSavedINR,
      dailyEmissionsAvoidedKgCO2,
      activeOccupancyCount,
      totalRoomsOccupied,
      totalRoomsCalibrated,
    };
  }, [classrooms, settings]);

  // Real-time environmental drift simulation (respects per-unit MANUAL vs AUTO independently)
  useEffect(() => {
    if (!isSimulating) return;

    const interval = setInterval(() => {
      setClassrooms((prevRooms) =>
        prevRooms.map((room) => {
          const luxDrift = Math.round((Math.random() - 0.48) * 4);
          const newNaturalLux = Math.max(
            40,
            Math.min(480, room.environment.naturalDaylightLux + luxDrift)
          );
          const tempDrift = Number(((Math.random() - 0.5) * 0.1).toFixed(1));
          const newTemp = Number(
            Math.max(22, Math.min(35, room.environment.temperature + tempDrift)).toFixed(1)
          );
          const newHeatIndex = computeHeatIndex(newTemp, room.environment.humidity);

          const nextEnvRoom: Classroom = {
            ...room,
            environment: {
              ...room.environment,
              naturalDaylightLux: newNaturalLux,
              temperature: newTemp,
              heatIndex: newHeatIndex,
            },
          };

          const isVacant =
            nextEnvRoom.occupancyStatus === 'Unoccupied' || nextEnvRoom.currentOccupants === 0;
          const alpha = nextEnvRoom.calibration.learnedParameters.daylightPenetrationAlpha;
          const naturalContribution = Math.round(newNaturalLux * alpha);
          const targetLightPct = computeAdaptiveTargetLightPercent(nextEnvRoom);
          const targetFanPct = computeAdaptiveTargetFanPercent(nextEnvRoom);

          const updatedAppliances = room.appliances.map((app) => {
            // Never overwrite an explicit MANUAL override during periodic automation ticks
            if (app.operatingMode === 'MANUAL' || app.isManualOverride) {
              return app;
            }
            if (app.type === 'lights') {
              return applyApplianceState(app, targetLightPct, 'AUTO', {
                isVacant,
                timestamp: app.lastUpdatedAt,
                sourceNote: 'Simulated Node',
              });
            }
            if (app.type === 'fan') {
              return applyApplianceState(app, targetFanPct, 'AUTO', {
                isVacant,
                timestamp: app.lastUpdatedAt,
                sourceNote: 'Simulated Node',
              });
            }
            if (isVacant && (app.outputPercent ?? 0) > 0) {
              return applyApplianceState(app, 0, 'AUTO', {
                isVacant: true,
                timestamp: app.lastUpdatedAt,
                sourceNote: 'Simulated Node',
              });
            }
            return app;
          });

          const lightSummary = summarizeApplianceGroup(updatedAppliances, 'lights');
          const artificialLux = Math.round((lightSummary.avgPercent / 100) * 240);
          const currentPowerWatts = updatedAppliances.reduce(
            (acc, a) => acc + a.currentPowerWatts,
            0
          );

          return {
            ...nextEnvRoom,
            environment: {
              ...nextEnvRoom.environment,
              ambientLux: naturalContribution + artificialLux,
            },
            appliances: updatedAppliances,
            currentPowerWatts,
            ratedPowerWatts: computeAppliancesRatedPowerWatts(updatedAppliances),
            dailyActualKWh: computeDailyKWhFromWatts(currentPowerWatts, nextEnvRoom.type),
          };
        })
      );
    }, settings.lowPowerMode ? 16000 : 9000);

    return () => clearInterval(interval);
  }, [isSimulating, settings.lowPowerMode]);

  const sendRoomCommand = useCallback(
    async (
      roomId: string,
      payload: Record<string, unknown>,
      pendingApplianceId?: string,
      customDecisionNote?: string
    ): Promise<ApplianceCommandResult> => {
      const previousChain = roomQueueRef.current[roomId] || Promise.resolve();

      const execute = async (): Promise<ApplianceCommandResult> => {
        const nextSeq = (clientSeqByRoomRef.current[roomId] || 0) + 1;
        clientSeqByRoomRef.current[roomId] = nextSeq;

        setApplianceControlError(null);
        setPendingRooms((prev) => ({ ...prev, [roomId]: true }));
        if (pendingApplianceId) {
          setPendingAppliances((prev) => ({ ...prev, [pendingApplianceId]: true }));
        }

        try {
          const res = await authFetch(
            `/api/classrooms/${encodeURIComponent(roomId)}/appliances/command`,
            {
              method: 'POST',
              body: JSON.stringify({
                ...payload,
                clientId: clientIdRef.current,
                clientSeq: nextSeq,
              }),
            }
          );

          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            const msg =
              data?.error ||
              (res.status === 401 || res.status === 403
                ? 'Administrator authentication is required to modify appliances.'
                : 'Unable to apply appliance command.');
            setApplianceControlError(msg);
            if (data?.stale && Array.isArray(data.appliances)) {
              setClassrooms((prev) =>
                prev.map((r) => {
                  if (r.id !== roomId) return r;
                  const totalPowerWatts = data.appliances.reduce(
                    (acc: number, a: Appliance) => acc + a.currentPowerWatts,
                    0
                  );
                  return {
                    ...r,
                    appliances: data.appliances,
                    currentPowerWatts: totalPowerWatts,
                    ratedPowerWatts: computeAppliancesRatedPowerWatts(data.appliances),
                    dailyActualKWh: computeDailyKWhFromWatts(totalPowerWatts, r.type),
                    decision: buildDecisionForAppliances(r, data.appliances),
                  };
                })
              );
            }
            return { ok: false, error: msg };
          }

          if (Array.isArray(data.appliances)) {
            setClassrooms((prev) =>
              prev.map((room) => {
                if (room.id !== roomId) return room;
                const confirmedApps: Appliance[] = data.appliances;
                const confirmedWatts =
                  typeof data.totalPowerWatts === 'number'
                    ? data.totalPowerWatts
                    : confirmedApps.reduce((acc, a) => acc + a.currentPowerWatts, 0);

                return {
                  ...room,
                  appliances: confirmedApps,
                  currentPowerWatts: confirmedWatts,
                  ratedPowerWatts: computeAppliancesRatedPowerWatts(confirmedApps),
                  dailyActualKWh: computeDailyKWhFromWatts(confirmedWatts, room.type),
                  decision: buildDecisionForAppliances(
                    room,
                    confirmedApps,
                    customDecisionNote
                  ),
                };
              })
            );
          }

          return { ok: true };
        } catch {
          const msg = 'Network error communicating with ROOMWISE controller node.';
          setApplianceControlError(msg);
          return { ok: false, error: msg };
        } finally {
          setPendingRooms((prev) => {
            const copy = { ...prev };
            delete copy[roomId];
            return copy;
          });
          if (pendingApplianceId) {
            setPendingAppliances((prev) => {
              const copy = { ...prev };
              delete copy[pendingApplianceId];
              return copy;
            });
          }
        }
      };

      const nextPromise = previousChain.then(execute, execute);
      roomQueueRef.current[roomId] = nextPromise;
      return nextPromise;
    },
    []
  );

  const setApplianceOutput = useCallback(
    async (roomId: string, applianceId: string, outputPercent: number) => {
      const room = classroomsRef.current.find((r) => r.id === roomId);
      const isVacant = room
        ? room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0
        : false;
      const pct = clampPercent(outputPercent);
      return sendRoomCommand(
        roomId,
        {
          action: 'set_unit',
          applianceId,
          outputPercent: pct,
          isVacant,
        },
        applianceId
      );
    },
    [sendRoomCommand]
  );

  const setGroupOutput = useCallback(
    async (roomId: string, type: 'lights' | 'fan', outputPercent: number) => {
      const room = classroomsRef.current.find((r) => r.id === roomId);
      const isVacant = room
        ? room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0
        : false;
      const pct = clampPercent(outputPercent);
      return sendRoomCommand(
        roomId,
        {
          action: 'set_group',
          type,
          outputPercent: pct,
          isVacant,
        },
        `${roomId}:group:${type}`
      );
    },
    [sendRoomCommand]
  );

  const restoreApplianceAuto = useCallback(
    async (roomId: string, applianceId: string) => {
      const room = classroomsRef.current.find((r) => r.id === roomId);
      const isVacant = room
        ? room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0
        : false;
      const targetApp = room?.appliances.find((a) => a.id === applianceId);

      let targetPercent = 0;
      if (room && !isVacant && targetApp) {
        if (targetApp.type === 'lights') {
          targetPercent = computeAdaptiveTargetLightPercent(room);
        } else if (targetApp.type === 'fan') {
          targetPercent = computeAdaptiveTargetFanPercent(room);
        } else {
          targetPercent = targetApp.lastActivePercent ?? targetApp.outputPercent ?? 50;
        }
      }

      return sendRoomCommand(
        roomId,
        {
          action: 'restore_unit_auto',
          applianceId,
          targetPercent,
          isVacant,
        },
        applianceId
      );
    },
    [sendRoomCommand]
  );

  const resetRoomToAdaptive = useCallback(
    async (roomId: string) => {
      const room = classroomsRef.current.find((r) => r.id === roomId);
      const isVacant = room
        ? room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0
        : false;

      const targetLightPercent = room && !isVacant ? computeAdaptiveTargetLightPercent(room) : 0;
      const targetFanPercent = room && !isVacant ? computeAdaptiveTargetFanPercent(room) : 0;

      const note = isVacant
        ? 'No recent PIR motion detected beyond grace window. Autonomous eco-shedding restored: all lighting units and fan sectors turned OFF (0W).'
        : 'Adaptive closed-loop control restored across all lights and fan sectors.';

      return sendRoomCommand(
        roomId,
        {
          action: 'restore_room_auto',
          targetLightPercent,
          targetFanPercent,
          isVacant,
        },
        `${roomId}:restore-all`,
        note
      );
    },
    [sendRoomCommand]
  );

  // Compatibility helper mapped cleanly to backend command
  const toggleApplianceOverride = useCallback(
    (
      roomId: string,
      applianceId: string,
      _newState: string,
      watts: number,
      fanSpeed?: number
    ) => {
      const room = classroomsRef.current.find((r) => r.id === roomId);
      const app = room?.appliances.find((a) => a.id === applianceId);
      if (!app) return;
      const pct =
        typeof fanSpeed === 'number'
          ? clampPercent(fanSpeed * 20)
          : clampPercent((watts / Math.max(1, app.powerRatingWatts)) * 100);
      void setApplianceOutput(roomId, applianceId, pct);
    },
    [setApplianceOutput]
  );

  const updateSettings = useCallback((newSettings: Partial<SchoolSettings>) => {
    setSettings((prev) => {
      const merged: SchoolSettings = {
        ...prev,
        ...newSettings,
        schoolHours: newSettings.schoolHours
          ? { ...prev.schoolHours, ...newSettings.schoolHours }
          : prev.schoolHours,
      };
      return merged;
    });
    void authFetch('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(newSettings),
    }).catch(() => {});
  }, []);

  const toggleSimulation = useCallback(() => {
    setIsSimulating((prev) => !prev);
  }, []);

  const setSimulationRunning = useCallback((running: boolean) => {
    setIsSimulating(running);
  }, []);

  const exportAnalyticsCsv = useCallback(() => {
    const roomsSnapshot = classroomsRef.current;
    const activeSettings = settingsRef.current;
    const headers = [
      'Room Code',
      'Classroom Name',
      'Building',
      'Floor',
      'Type',
      'Occupancy Status',
      'Current Power (W)',
      'Installed Rated Max (W)',
      'Curtailed vs Rated Max (W)',
      'Estimated Pre-Retrofit Reference Capacity (W)',
      'Est. Diff vs Pre-Retrofit Ref (W)',
      'Daily Actual (kWh)',
      'Daily Pre-Retrofit Ref Est (kWh)',
      'Daily Est. Diff vs Ref (kWh)',
      'Daily Est. Cost Diff vs Ref (INR)',
      'Daylight Alpha',
      'Thermal Beta',
    ];

    const rows = roomsSnapshot.map((r) => {
      const ratedWatts = r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances);
      const savedKWh = Math.max(0, r.dailyBaselineKWh - r.dailyActualKWh);
      const costSaved = (savedKWh * activeSettings.tariffPerKWhINR).toFixed(2);
      return [
        r.roomCode,
        `"${r.name}"`,
        `"${r.building}"`,
        `"${r.floor}"`,
        r.type,
        r.occupancyStatus,
        r.currentPowerWatts,
        ratedWatts,
        Math.max(0, ratedWatts - r.currentPowerWatts),
        r.baselinePowerWatts,
        Math.max(0, r.baselinePowerWatts - r.currentPowerWatts),
        r.dailyActualKWh,
        r.dailyBaselineKWh,
        savedKWh.toFixed(2),
        costSaved,
        r.calibration.learnedParameters.daylightPenetrationAlpha,
        r.calibration.learnedParameters.thermalDissipationBeta,
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const fileName = `Roomwise_DAV_IIT_KGP_Energy_Audit_${new Date().toISOString().split('T')[0]}.csv`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return { count: roomsSnapshot.length, fileName };
  }, []);

  const triggerRoomRecalibration = useCallback((roomId: string) => {
    setClassrooms((prev) =>
      prev.map((room) => {
        if (room.id !== roomId) return room;

        const currentAlpha = room.calibration.learnedParameters.daylightPenetrationAlpha;
        const newAlpha = Number(
          Math.min(0.85, Math.max(0.45, currentAlpha + (Math.random() - 0.5) * 0.05)).toFixed(2)
        );
        const newBeta = Number(
          (room.calibration.learnedParameters.thermalDissipationBeta + 0.04).toFixed(2)
        );

        const historyItem = {
          timestamp: new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          parameter: 'daylightPenetrationAlpha & thermalDissipationBeta',
          previousValue: `α: ${currentAlpha}, β: ${room.calibration.learnedParameters.thermalDissipationBeta}`,
          calibratedValue: `α: ${newAlpha}, β: ${newBeta}`,
          rationale:
            'Recalibrated via multi-sensor Bayesian inference across building solar trajectory.',
        };

        return {
          ...room,
          calibration: {
            ...room.calibration,
            dataSufficiencyPercent: 100,
            observationDaysCount: room.calibration.observationDaysCount + 1,
            lastCalibratedDate: 'Today (Live)',
            learnedParameters: {
              ...room.calibration.learnedParameters,
              daylightPenetrationAlpha: newAlpha,
              thermalDissipationBeta: newBeta,
            },
            calibrationHistory: [historyItem, ...room.calibration.calibrationHistory],
          },
          decision: {
            ...room.decision,
            timestamp: historyItem.timestamp,
            ruleExplanation: `Recalibrated with validated alpha ${newAlpha}. Closed-loop adjustments applied.`,
          },
        };
      })
    );
  }, []);

  const updateRoomManualParams = useCallback(
    (
      roomId: string,
      params: Partial<{
        targetLux: number;
        maxFanSpeed: number;
        autoEcoMode: boolean;
        overtimeAllowed: boolean;
      }>
    ) => {
      setClassrooms((prev) =>
        prev.map((room) => {
          if (room.id !== roomId) return room;
          return {
            ...room,
            calibration: {
              ...room.calibration,
              manualParameters: {
                ...room.calibration.manualParameters,
                ...params,
              },
            },
          };
        })
      );
    },
    []
  );

  const updateRoomCapacity = useCallback((roomId: string, maxOccupancy: number) => {
    if (!Number.isFinite(maxOccupancy) || maxOccupancy < 10) return;
    const clean = Math.round(maxOccupancy);
    setClassrooms((prev) =>
      prev.map((room) => (room.id === roomId ? { ...room, capacity: clean } : room))
    );
  }, []);

  const resolveAuditFinding = useCallback(
    async (
      findingId: string
    ): Promise<{ ok: boolean; curtailedWatts: number; error?: string }> => {
      const finding = auditFindingsRef.current.find((f) => f.id === findingId);
      if (!finding) {
        return { ok: false, curtailedWatts: 0, error: 'Audit finding not found.' };
      }
      const room = classroomsRef.current.find((r) => r.id === finding.classroomId);
      const isVacant = room
        ? room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0
        : false;
      const roomTargets = room
        ? {
            [room.id]: {
              isVacant,
              targetLightPercent: isVacant ? 0 : computeAdaptiveTargetLightPercent(room),
              targetFanPercent: isVacant ? 0 : computeAdaptiveTargetFanPercent(room),
            },
          }
        : undefined;

      try {
        const res = await authFetch('/api/campus/optimize', {
          method: 'POST',
          body: JSON.stringify({
            scope: 'room',
            roomId: finding.classroomId,
            roomTargets,
            sourceLabel: `Audit Rule (${finding.roomCode})`,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            curtailedWatts: 0,
            error: data?.error || 'Administrator permission required to apply audit remediation.',
          };
        }
        applyCampusOptimizationSync(
          data.optimizedRooms || [],
          [findingId],
          `Remediated audit issue: ${finding.title}`
        );
        return {
          ok: true,
          curtailedWatts: Number(data.curtailedWatts || finding.estimatedWasteWatts || 0),
        };
      } catch {
        return {
          ok: false,
          curtailedWatts: 0,
          error: 'Network error enforcing remediation rule on ROOMWISE server.',
        };
      }
    },
    [applyCampusOptimizationSync]
  );

  const remediateAllFindings = useCallback(async (): Promise<{
    ok: boolean;
    count: number;
    curtailedWatts: number;
    error?: string;
  }> => {
    const unresolved = auditFindingsRef.current.filter((f) => !f.isResolved);
    const roomTargets: Record<
      string,
      { isVacant: boolean; targetLightPercent: number; targetFanPercent: number }
    > = {};

    for (const room of classroomsRef.current) {
      const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
      roomTargets[room.id] = {
        isVacant,
        targetLightPercent: isVacant ? 0 : computeAdaptiveTargetLightPercent(room),
        targetFanPercent: isVacant ? 0 : computeAdaptiveTargetFanPercent(room),
      };
    }

    try {
      const res = await authFetch('/api/campus/optimize', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'all',
          roomTargets,
          sourceLabel: 'One-Click Campus Optimization',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          count: 0,
          curtailedWatts: 0,
          error: data?.error || 'Administrator sign-in required for campus optimization.',
        };
      }

      const resolvedIds = unresolved.map((f) => f.id);
      const curtailed = Number(data.curtailedWatts || 0);
      applyCampusOptimizationSync(
        data.optimizedRooms || [],
        resolvedIds,
        'One-Click Campus Optimization applied: adaptive daylight & thermal AUTO curves restored.'
      );
      return {
        ok: true,
        count: unresolved.length,
        curtailedWatts: curtailed > 0 ? curtailed : unresolved.reduce((a, f) => a + f.estimatedWasteWatts, 0),
      };
    } catch {
      return {
        ok: false,
        count: 0,
        curtailedWatts: 0,
        error: 'Network error communicating with ROOMWISE optimization controller.',
      };
    }
  }, [applyCampusOptimizationSync]);

  return (
    <EnergyContext.Provider
      value={{
        classrooms,
        settings,
        staffList,
        currentStaff,
        auditFindings,
        activeTab,
        selectedRoom,
        qrModalRoom,
        isSimulating,
        isMobileMenuOpen,
        campusSummary,
        pendingRooms,
        pendingAppliances,
        applianceControlError,
        clearApplianceControlError,
        setActiveTab,
        goBackTab,
        voiceNavDirective,
        setVoiceNavDirective,
        clearVoiceNavDirective,
        setSelectedRoomId,
        setQrModalRoom,
        setCurrentStaffId,
        setIsMobileMenuOpen,
        updateSettings,
        toggleSimulation,
        setSimulationRunning,
        exportAnalyticsCsv,
        triggerRoomRecalibration,
        setApplianceOutput,
        setGroupOutput,
        restoreApplianceAuto,
        resetRoomToAdaptive,
        toggleApplianceOverride,
        resolveAuditFinding,
        remediateAllFindings,
        updateRoomManualParams,
        updateRoomCapacity,
        applyServerRoomAppliances,
        applyCampusOptimizationSync,
      }}
    >
      {children}
    </EnergyContext.Provider>
  );
};

export const useEnergy = () => {
  const context = useContext(EnergyContext);
  if (!context) {
    throw new Error('useEnergy must be used within an EnergyProvider');
  }
  return context;
};
