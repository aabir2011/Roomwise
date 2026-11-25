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
} from '../data/initialClassrooms';
import {
  buildExpandedAppliancesFromSpec,
  computeAppliancesRatedPowerWatts,
  getRoomApplianceSpec,
} from '../data/roomApplianceSpecs';
import {
  expandClassroomAppliances,
  applyApplianceState,
  clampPercent,
  computeAdaptiveTargetLightPercent,
  computeAdaptiveTargetFanPercent,
  summarizeApplianceGroup,
} from '../utils/applianceUtils';
import {
  computeArtificialDeskLux,
  computeCampusCanonicalSummary,
  computeClassroomCanonicalMetrics,
  computeDailyKWhFromWatts,
  computeHeatIndexCelsius,
  computeIndoorNaturalDaylightLux,
} from '../utils/canonicalEnergy';
import { evaluateLiveAuditFindings } from '../utils/auditEngine';
import { ensureDemoResetOnPageLoad } from '../utils/demoReset';
import { getPathForTab, parseRouteFromUrl, VALID_WORKSPACE_TABS } from '../utils/routing';
import { useAuth, authFetch } from './AuthContext';

export interface ApplianceCommandResult {
  ok: boolean;
  error?: string;
}

export interface SettingsUpdateResult {
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
  updateSettings: (newSettings: Partial<SchoolSettings>) => Promise<SettingsUpdateResult>;
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

const VALID_TABS = VALID_WORKSPACE_TABS;

interface OutdoorWeatherSnapshot {
  temperatureC: number | null;
  relativeHumidityPercent: number | null;
  ghiWm2: number | null;
  cloudCoverPercent: number | null;
}

function getFloorDaylightMultiplier(floor: Classroom['floor']): number {
  if (floor === '3rd Floor') return 1.1;
  if (floor === '2nd Floor') return 1.05;
  if (floor === '1st Floor') return 1.0;
  return 0.94;
}

function applyOutdoorCouplingToRoom(
  room: Classroom,
  outdoor: OutdoorWeatherSnapshot | null,
  jitterMode: boolean
): Classroom {
  const isVacant = room.occupancyStatus === 'Unoccupied' || room.currentOccupants === 0;
  const alpha = room.calibration.learnedParameters.daylightPenetrationAlpha;

  let newNaturalLux = room.environment.naturalDaylightLux;
  if (outdoor && outdoor.ghiWm2 !== null) {
    newNaturalLux = computeIndoorNaturalDaylightLux({
      ghiWm2: outdoor.ghiWm2,
      cloudCoverPercent: outdoor.cloudCoverPercent,
      daylightPenetrationAlpha: alpha,
      floorMultiplier: getFloorDaylightMultiplier(room.floor),
    });
  } else if (jitterMode) {
    const luxDrift = Math.round((Math.random() - 0.48) * 4);
    newNaturalLux = Math.max(0, Math.min(480, room.environment.naturalDaylightLux + luxDrift));
  }

  const acActive = room.appliances.some((a) => a.type === 'ac' && a.currentPowerWatts > 100);
  let newTemp = room.environment.temperature;
  let newHumidity = room.environment.humidity;

  if (outdoor && outdoor.temperatureC !== null) {
    const occupancyGain = isVacant ? 0.3 : room.type === 'Computer Lab' ? 1.8 : 1.1;
    const coolingOffset = acActive ? 4.2 : 0;
    const targetTemp = Math.max(22.0, Math.min(35.5, outdoor.temperatureC + occupancyGain - coolingOffset));
    const jitter = jitterMode ? (Math.random() - 0.5) * 0.1 : 0;
    newTemp = Number((targetTemp + jitter).toFixed(1));
  } else if (jitterMode) {
    const tempDrift = Number(((Math.random() - 0.5) * 0.1).toFixed(1));
    newTemp = Number(Math.max(22, Math.min(35, room.environment.temperature + tempDrift)).toFixed(1));
  }

  if (outdoor && outdoor.relativeHumidityPercent !== null) {
    const occHumidityOffset = isVacant ? 1 : 4;
    const acDehumidify = acActive ? -8 : 0;
    const targetHum = Math.max(
      32,
      Math.min(96, Math.round(outdoor.relativeHumidityPercent + occHumidityOffset + acDehumidify))
    );
    newHumidity = targetHum;
  }

  const newHeatIndex = computeHeatIndexCelsius(newTemp, newHumidity);

  const nextEnvRoom: Classroom = {
    ...room,
    environment: {
      ...room.environment,
      naturalDaylightLux: newNaturalLux,
      temperature: newTemp,
      humidity: newHumidity,
      heatIndex: newHeatIndex,
    },
  };

  const targetLightPct = computeAdaptiveTargetLightPercent(nextEnvRoom);
  const targetFanPct = computeAdaptiveTargetFanPercent(nextEnvRoom);

  const updatedAppliances = room.appliances.map((app) => {
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
  const artificialLux = computeArtificialDeskLux(lightSummary.avgPercent);
  const naturalContribution = Math.round(newNaturalLux * alpha);
  const currentPowerWatts = updatedAppliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);

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
}

function createInitialExpandedClassrooms(): Classroom[] {
  return INITIAL_CLASSROOMS.map((room) => {
    const spec = getRoomApplianceSpec(room.id);
    if (!spec) {
      const expanded = expandClassroomAppliances(room);
      return {
        ...expanded,
        dailyActualKWh: computeDailyKWhFromWatts(expanded.currentPowerWatts, expanded.type),
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
  const outdoorEnvRef = useRef<OutdoorWeatherSnapshot | null>(null);
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

  const [activeTab, setActiveTabState] = useState<string>(() => {
    const initialRoute = parseRouteFromUrl();
    return initialRoute.type === 'dashboard' ? initialRoute.tab : 'dashboard';
  });
  const [voiceNavDirective, setVoiceNavDirectiveState] = useState<VoiceNavDirective | null>(null);
  const tabHistoryRef = useRef<string[]>([activeTab]);
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

  const syncBrowserPathForTab = useCallback((tab: string) => {
    if (typeof window === 'undefined') return;
    const currentRoute = parseRouteFromUrl();
    // Only synchronize history when currently on a workspace section URL (or transitioning into one)
    if (currentRoute.type === 'dashboard' || currentRoute.type === 'not-found') {
      const targetPath = getPathForTab(tab);
      if (window.location.pathname !== targetPath || window.location.search) {
        window.history.pushState({ tab }, '', targetPath);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const parsed = parseRouteFromUrl();
      if (parsed.type === 'dashboard') {
        setActiveTabState(parsed.tab);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setActiveTab = useCallback(
    (tab: string) => {
      if (VALID_TABS.has(tab)) {
        const stack = tabHistoryRef.current;
        if (stack[stack.length - 1] !== tab) {
          stack.push(tab);
          if (stack.length > 20) stack.shift();
        }
        setActiveTabState(tab);
        syncBrowserPathForTab(tab);
      }
    },
    [syncBrowserPathForTab]
  );

  const goBackTab = useCallback((): string => {
    const stack = tabHistoryRef.current;
    if (stack.length > 1) {
      stack.pop();
    }
    const prev = stack[stack.length - 1] || 'dashboard';
    setActiveTabState(prev);
    syncBrowserPathForTab(prev);
    return prev;
  }, [syncBrowserPathForTab]);

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

      const syncOutdoorEnv = async () => {
        try {
          const res = await authFetch('/api/environment/overview');
          if (!res.ok) return;
          const envData = await res.json().catch(() => null);
          if (cancelled || !envData?.ok || !envData.current) return;
          const nextOutdoor: OutdoorWeatherSnapshot = {
            temperatureC:
              typeof envData.current.temperatureC === 'number' ? envData.current.temperatureC : null,
            relativeHumidityPercent:
              typeof envData.current.relativeHumidityPercent === 'number'
                ? envData.current.relativeHumidityPercent
                : null,
            ghiWm2:
              typeof envData.current.shortwaveRadiationWm2 === 'number'
                ? envData.current.shortwaveRadiationWm2
                : null,
            cloudCoverPercent:
              typeof envData.current.cloudCoverPercent === 'number'
                ? envData.current.cloudCoverPercent
                : null,
          };
          outdoorEnvRef.current = nextOutdoor;
          setClassrooms((prev) => prev.map((room) => applyOutdoorCouplingToRoom(room, nextOutdoor, false)));
        } catch {
          // ignore transient offline environmental sync failure
        }
      };

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
        syncOutdoorEnv(),
      ]);
    };

    void hydrateAfterReset();

    const envTimer = window.setInterval(async () => {
      try {
        const res = await authFetch('/api/environment/overview');
        if (!res.ok) return;
        const envData = await res.json().catch(() => null);
        if (cancelled || !envData?.ok || !envData.current) return;
        outdoorEnvRef.current = {
          temperatureC:
            typeof envData.current.temperatureC === 'number' ? envData.current.temperatureC : null,
          relativeHumidityPercent:
            typeof envData.current.relativeHumidityPercent === 'number'
              ? envData.current.relativeHumidityPercent
              : null,
          ghiWm2:
            typeof envData.current.shortwaveRadiationWm2 === 'number'
              ? envData.current.shortwaveRadiationWm2
              : null,
          cloudCoverPercent:
            typeof envData.current.cloudCoverPercent === 'number'
              ? envData.current.cloudCoverPercent
              : null,
        };
      } catch {
        // retain last known outdoor snapshot
      }
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(envTimer);
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
    return computeCampusCanonicalSummary(classrooms, settings);
  }, [classrooms, settings]);

  // Real-time environmental drift simulation (coupled to Open-Meteo outdoor GHI & thermal conditions)
  useEffect(() => {
    if (!isSimulating) return;

    const interval = setInterval(() => {
      setClassrooms((prevRooms) =>
        prevRooms.map((room) => applyOutdoorCouplingToRoom(room, outdoorEnvRef.current, true))
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

  const updateSettings = useCallback(
    async (newSettings: Partial<SchoolSettings>): Promise<SettingsUpdateResult> => {
      try {
        const res = await authFetch('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify(newSettings),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) {
          return {
            ok: false,
            error:
              body?.error ||
              (res.status === 401 || res.status === 403
                ? 'Administrator authentication required to save system parameters.'
                : `Server rejected settings update (HTTP ${res.status}).`),
          };
        }
        if (body.settings) {
          setSettings(body.settings as SchoolSettings);
        } else {
          setSettings((prev) => ({
            ...prev,
            ...newSettings,
            schoolHours: newSettings.schoolHours
              ? { ...prev.schoolHours, ...newSettings.schoolHours }
              : prev.schoolHours,
          }));
        }
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: 'Network error while saving system parameters. Changes were not persisted.',
        };
      }
    },
    []
  );

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
      'Available Rated Headroom (W)',
      'Rated Utilisation (%)',
      'Daily Modelled Energy (kWh)',
      'Daily Rated Ceiling (kWh)',
      'Daily Est. Cost (INR)',
      'Daily Est. CO2 (kg)',
      'Daylight Alpha',
      'Thermal Beta',
    ];

    const rows = roomsSnapshot.map((r) => {
      const m = computeClassroomCanonicalMetrics(r, activeSettings);
      return [
        r.roomCode,
        `"${r.name}"`,
        `"${r.building}"`,
        `"${r.floor}"`,
        r.type,
        r.occupancyStatus,
        m.currentPowerWatts,
        m.ratedPowerWatts,
        m.availableHeadroomWatts,
        m.ratedUtilizationPercent.toFixed(1),
        m.dailyActualKWh.toFixed(2),
        m.dailyRatedCeilingKWh.toFixed(2),
        m.dailyCostINR.toFixed(2),
        m.dailyEmissionsKgCO2.toFixed(2),
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
