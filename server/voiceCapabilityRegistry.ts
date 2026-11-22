/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type, type FunctionDeclaration } from '@google/genai';
import type { Classroom, SchoolSettings } from '../src/types/energy.ts';
import type {
  VoiceClientNavigationAction,
  VoiceEnvironmentalSolarSubTab,
  VoiceHistoryFilterDirective,
  VoiceHistorySubTab,
  VoiceNavigationTarget,
  VoicePendingConfirmation,
  VoiceServerMessage,
  VoiceSnapshotPayload,
} from '../src/types/voice.ts';
import {
  SCHOOL_DAYS_PER_MONTH,
  SCHOOL_DAYS_PER_YEAR,
  computeAppliancesRatedPowerWatts,
  getRoomOperatingProfile,
} from '../src/data/roomApplianceSpecs.ts';
import { formatCapacityKW, getRoomActivityState } from '../src/utils/applianceUtils.ts';
import {
  buildSpokenRoomIdentity,
  formatRoomNameForSpeech,
  normalizeClassroomQuery,
} from '../src/utils/voicePronunciation.ts';
import { environmentalService } from './environmentalService.ts';
import { solarService } from './solarService.ts';
import { interventionLedgerService } from './interventionLedgerService.ts';
import { energyHistoryService, resolveNaturalDateQuery } from './energyHistoryService.ts';
import { spaceIntelligenceService } from './spaceIntelligenceService.ts';
import type { VoiceAdminIdentity } from './voiceLiveBridge.ts';

export type VoiceCapabilitySectionId =
  | 'overview'
  | 'digital-twin'
  | 'campus-live'
  | 'classrooms'
  | 'environmental-solar'
  | 'analytics'
  | 'history'
  | 'space-intelligence'
  | 'audit'
  | 'reports'
  | 'settings'
  | 'navigation';

export type VoicePermissionLevel = 'public' | 'admin';

export interface VoiceSessionMemory {
  activeTab: string;
  activeSubTab: string | null;
  selectedRoomId: string | null;
  lastMentionedRoomId: string | null;
  lastMentionedRoomCode: string | null;
  lastMentionedInterventionId: string | null;
  lastPeriod: string;
  lastToolName: string | null;
  navigationHistory: string[];
  pendingConfirmation: {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    summary: string;
    createdAt: number;
    expiresAt: number;
  } | null;
}

export function createInitialVoiceSessionMemory(
  initialTab = 'dashboard',
  selectedRoomId: string | null = null
): VoiceSessionMemory {
  return {
    activeTab: initialTab,
    activeSubTab: null,
    selectedRoomId,
    lastMentionedRoomId: selectedRoomId,
    lastMentionedRoomCode: null,
    lastMentionedInterventionId: null,
    lastPeriod: 'last_7_days',
    lastToolName: null,
    navigationHistory: [initialTab],
    pendingConfirmation: null,
  };
}

export interface VoiceCapabilityExecutionContext {
  snapshot: VoiceSnapshotPayload;
  rooms: Classroom[];
  settings: SchoolSettings;
  adminIdentity: VoiceAdminIdentity | null;
  memory: VoiceSessionMemory;
  emitClientMessage: (msg: VoiceServerMessage) => void;
  delegateLegacyTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
}

export interface VoiceCapabilityDefinition {
  id: string;
  section: VoiceCapabilitySectionId;
  sectionLabel: string;
  description: string;
  supportedIntents: string[];
  requiredContext?: string[];
  permissionLevel: VoicePermissionLevel;
  requiresConfirmation?: boolean;
  dataSources: string[];
  available: boolean;
  declaration: FunctionDeclaration;
  handler: (
    args: Record<string, unknown>,
    ctx: VoiceCapabilityExecutionContext
  ) => Promise<Record<string, unknown>>;
}

export interface VoiceCapabilityPublicMetadata {
  id: string;
  section: VoiceCapabilitySectionId;
  sectionLabel: string;
  description: string;
  supportedIntents: string[];
  permissionLevel: VoicePermissionLevel;
  requiresConfirmation: boolean;
  dataSources: string[];
  available: boolean;
}

export const ALL_ROOMWISE_SECTIONS: Array<{
  id: VoiceCapabilitySectionId;
  navTarget: VoiceNavigationTarget;
  label: string;
  aliases: string[];
}> = [
  {
    id: 'overview',
    navTarget: 'dashboard',
    label: 'Overview',
    aliases: ['overview', 'dashboard', 'home', 'main screen', 'summary'],
  },
  {
    id: 'digital-twin',
    navTarget: 'digital-twin',
    label: 'Digital Twin',
    aliases: ['digital twin', 'floor map', 'building twin', 'interactive map'],
  },
  {
    id: 'campus-live',
    navTarget: 'campus-live',
    label: 'Campus Live',
    aliases: ['campus live', '3d campus', 'live campus', '3d replica', 'campus 3d'],
  },
  {
    id: 'classrooms',
    navTarget: 'classrooms',
    label: 'Classrooms',
    aliases: ['classrooms', 'rooms', 'all classrooms', '25 classrooms', 'classroom list'],
  },
  {
    id: 'environmental-solar',
    navTarget: 'environmental-solar',
    label: 'Environmental & Solar Intelligence',
    aliases: [
      'environmental and solar',
      'environmental & solar',
      'environmental intelligence',
      'solar intelligence',
      'solar assessment',
      'rooftop solar',
      'pvgis',
      'weather',
      'air quality',
      'solar potential',
    ],
  },
  {
    id: 'analytics',
    navTarget: 'analytics',
    label: 'Energy Analytics',
    aliases: ['analytics', 'energy analytics', 'building comparison', 'trends', 'savings analytics'],
  },
  {
    id: 'history',
    navTarget: 'history',
    label: 'Energy History & Intervention Ledger',
    aliases: [
      'energy history',
      'history',
      'historical consumption',
      'intervention ledger',
      'energy intervention ledger',
      'interventions',
      'savings ledger',
    ],
  },
  {
    id: 'space-intelligence',
    navTarget: 'space-intelligence',
    label: 'Space Intelligence',
    aliases: ['space intelligence', 'space allocation', 'room allocation', 'attendance allocation'],
  },
  {
    id: 'audit',
    navTarget: 'audit',
    label: 'Energy Audit',
    aliases: ['energy audit', 'audit', 'audit findings', 'waste alerts', 'anomalies'],
  },
  {
    id: 'reports',
    navTarget: 'reports',
    label: 'Reports & BEE',
    aliases: ['reports', 'reports and bee', 'bee report', 'ecbc report', 'export report'],
  },
  {
    id: 'settings',
    navTarget: 'settings',
    label: 'Settings',
    aliases: ['settings', 'configuration', 'campus settings', 'tariff settings', 'preferences'],
  },
];

/**
 * Resolves a spoken or typed classroom query robustly across:
 * - Roman numerals ("Class X-B", "X-B", "Class IX-A", "Class XII-A")
 * - Spoken cardinals ("Class 10-B", "room ten b", "ten bee", "10b", "nine a")
 * - Room codes ("G3-301", "g 3 301", "NB-201")
 * - Pronouns/context ("that room", "this room", "it", "currently open room")
 */
export function resolveClassroomRobust(
  rooms: Classroom[],
  rawQuery: string | undefined,
  memory?: VoiceSessionMemory
): { match?: Classroom; ambiguous?: Classroom[]; resolvedFromContext?: boolean } {
  const trimmed = (rawQuery || '').trim();
  const lowered = trimmed.toLowerCase();

  // Context pronouns ("that room", "this room", "current room", "it", empty query)
  const isContextRef =
    !trimmed ||
    /^(this|that|current|open|selected|same)\s*(room|classroom|lab|hall)?$/.test(lowered) ||
    lowered === 'it' ||
    lowered === 'here';

  if (isContextRef && memory) {
    const contextId = memory.lastMentionedRoomId || memory.selectedRoomId;
    if (contextId) {
      const ctxRoom = rooms.find((r) => r.id === contextId);
      if (ctxRoom) return { match: ctxRoom, resolvedFromContext: true };
    }
    return {};
  }

  const qNorm = normalizeClassroomQuery(trimmed);
  const qCompact = qNorm.replace(/\s+/g, '');

  // 1. Exact ID / roomCode / normalized name match
  for (const room of rooms) {
    const idNorm = normalizeClassroomQuery(room.id);
    const codeNorm = normalizeClassroomQuery(room.roomCode);
    const nameNorm = normalizeClassroomQuery(room.name);
    const nameNoClass = nameNorm.replace(/^class\s+/, '');

    if (
      qNorm === idNorm ||
      qNorm === codeNorm ||
      qCompact === codeNorm.replace(/\s+/g, '') ||
      qNorm === nameNorm ||
      qCompact === nameNorm.replace(/\s+/g, '') ||
      qNorm === nameNoClass ||
      qCompact === nameNoClass.replace(/\s+/g, '')
    ) {
      return { match: room };
    }
  }

  // 2. Exact class grade + section token match (e.g. "10 b" inside "open class 10 b please")
  const gradeSecMatch = qNorm.match(/\b(1[0-2]|[1-9])\s+([a-f])\b/);
  if (gradeSecMatch) {
    const targetToken = `${gradeSecMatch[1]} ${gradeSecMatch[2]}`;
    const exactClassMatches = rooms.filter((r) => {
      const n = normalizeClassroomQuery(r.name);
      return n.includes(targetToken);
    });
    if (exactClassMatches.length === 1) return { match: exactClassMatches[0] };
    if (exactClassMatches.length > 1) return { ambiguous: exactClassMatches };
  }

  // 3. Token/substring fuzzy match
  const partialMatches = rooms.filter((r) => {
    const hay = `${normalizeClassroomQuery(r.roomCode)} ${normalizeClassroomQuery(r.name)} ${normalizeClassroomQuery(r.building)}`;
    return hay.includes(qNorm) || hay.replace(/\s+/g, '').includes(qCompact);
  });

  if (partialMatches.length === 1) return { match: partialMatches[0] };
  if (partialMatches.length > 1) {
    // Prefer exact name containment over building containment
    const nameOnly = partialMatches.filter((r) =>
      normalizeClassroomQuery(r.name).includes(qNorm)
    );
    if (nameOnly.length === 1) return { match: nameOnly[0] };
    return { ambiguous: partialMatches.slice(0, 5) };
  }

  // 4. Multi-token score matching
  const qTokens = qNorm
    .split(' ')
    .filter((t) => t.length > 0 && !['room', 'classroom', 'the', 'in', 'of', 'for', 'open', 'show'].includes(t));
  if (qTokens.length > 0) {
    const scored = rooms
      .map((r) => {
        const hayTokens = new Set(
          `${normalizeClassroomQuery(r.roomCode)} ${normalizeClassroomQuery(r.name)} ${normalizeClassroomQuery(r.building)}`
            .split(' ')
            .filter(Boolean)
        );
        const hits = qTokens.filter((t) => hayTokens.has(t)).length;
        return { room: r, hits };
      })
      .filter((x) => x.hits === qTokens.length);
    if (scored.length === 1) return { match: scored[0].room };
    if (scored.length > 1) return { ambiguous: scored.slice(0, 5).map((s) => s.room) };
  }

  return {};
}

/**
 * Recursively enriches any classroom object payloads with `spokenName`
 * so TTS pronounces "Class 10-B" while visual UI keeps "Class X-B".
 */
function enrichResultWithSpokenNames(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(enrichResultWithSpokenNames);

  const rec = obj as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    next[k] = enrichResultWithSpokenNames(v);
  }
  if (typeof rec.name === 'string' && typeof rec.roomCode === 'string' && !next.spokenName) {
    next.spokenName = buildSpokenRoomIdentity({ name: rec.name, roomCode: rec.roomCode });
  }
  if (typeof rec.roomName === 'string' && !next.spokenRoomName) {
    next.spokenRoomName = formatRoomNameForSpeech(rec.roomName);
  }
  if (typeof rec.classroomName === 'string' && !next.spokenClassroomName) {
    next.spokenClassroomName = formatRoomNameForSpeech(rec.classroomName);
  }
  return next;
}

export class VoiceCapabilityRegistry {
  private capabilities = new Map<string, VoiceCapabilityDefinition>();

  public register(definition: VoiceCapabilityDefinition): void {
    this.capabilities.set(definition.id, definition);
  }

  public unregister(id: string): boolean {
    return this.capabilities.delete(id);
  }

  public get(id: string): VoiceCapabilityDefinition | undefined {
    return this.capabilities.get(id);
  }

  public list(filter?: {
    section?: VoiceCapabilitySectionId;
    permissionLevel?: VoicePermissionLevel;
    availableOnly?: boolean;
  }): VoiceCapabilityPublicMetadata[] {
    const items: VoiceCapabilityPublicMetadata[] = [];
    for (const def of this.capabilities.values()) {
      if (filter?.section && def.section !== filter.section) continue;
      if (filter?.permissionLevel && def.permissionLevel !== filter.permissionLevel) continue;
      if (filter?.availableOnly && !def.available) continue;
      items.push({
        id: def.id,
        section: def.section,
        sectionLabel: def.sectionLabel,
        description: def.description,
        supportedIntents: def.supportedIntents,
        permissionLevel: def.permissionLevel,
        requiresConfirmation: Boolean(def.requiresConfirmation),
        dataSources: def.dataSources,
        available: def.available,
      });
    }
    return items;
  }

  public getFunctionDeclarations(): FunctionDeclaration[] {
    const declarations: FunctionDeclaration[] = [];
    for (const def of this.capabilities.values()) {
      if (def.available) {
        declarations.push(def.declaration);
      }
    }
    return declarations;
  }

  public getCoveredSections(): VoiceCapabilitySectionId[] {
    const sections = new Set<VoiceCapabilitySectionId>();
    for (const def of this.capabilities.values()) {
      if (def.available) sections.add(def.section);
    }
    return Array.from(sections);
  }

  public buildCapabilityCatalogSummary(): string {
    const bySection = new Map<string, VoiceCapabilityDefinition[]>();
    for (const def of this.capabilities.values()) {
      if (!def.available) continue;
      const list = bySection.get(def.sectionLabel) || [];
      list.push(def);
      bySection.set(def.sectionLabel, list);
    }

    const lines: string[] = [];
    for (const [sectionLabel, defs] of bySection.entries()) {
      const toolList = defs
        .map(
          (d) =>
            `${d.id}${d.permissionLevel === 'admin' ? ' [ADMIN]' : ''}${
              d.requiresConfirmation ? ' [CONFIRM]' : ''
            }`
        )
        .join(', ');
      lines.push(`- ${sectionLabel}: ${toolList}`);
    }
    return lines.join('\n');
  }

  public async execute(
    id: string,
    rawArgs: Record<string, unknown>,
    ctx: VoiceCapabilityExecutionContext
  ): Promise<Record<string, unknown>> {
    const def = this.capabilities.get(id);
    if (!def) {
      return {
        ok: false,
        error: `Capability "${id}" is not registered in ROOMWISE.`,
      };
    }

    if (!def.available) {
      return {
        ok: false,
        available: false,
        error: `Capability "${id}" is currently unavailable in this ROOMWISE environment.`,
      };
    }

    // 1. Server-side permission enforcement
    if (def.permissionLevel === 'admin' && !ctx.adminIdentity) {
      ctx.emitClientMessage({
        type: 'tool_status',
        toolName: id,
        status: 'denied',
        message: `Blocked: Administrator authentication required for ${id}`,
      });
      return {
        ok: false,
        authorized: false,
        error: `PERMISSION_DENIED: "${def.sectionLabel}" action "${id}" requires a signed-in ROOMWISE administrator. Ask the user to sign in via Admin Login.`,
        actionRequired: 'admin_login',
      };
    }

    // 2. Explicit confirmation gate for consequential actions
    const needsConfirm = Boolean(def.requiresConfirmation) && rawArgs.confirmed !== true;
    if (needsConfirm) {
      const summary = buildConfirmationSummary(id, rawArgs);
      const pending: VoicePendingConfirmation = {
        id: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        toolName: id,
        summary,
        expiresAt: Date.now() + 90_000,
      };
      ctx.memory.pendingConfirmation = {
        ...pending,
        args: { ...rawArgs, confirmed: true },
        createdAt: Date.now(),
      };
      ctx.emitClientMessage({
        type: 'confirmation_required',
        confirmation: pending,
      });
      return {
        ok: false,
        confirmationRequired: true,
        confirmationId: pending.id,
        summary,
        message: `Confirmation required before executing: ${summary}. Ask the user to confirm ("yes, confirm" or "cancel").`,
      };
    }

    ctx.memory.lastToolName = id;

    try {
      const result = await def.handler(rawArgs, ctx);
      // Track mentioned room in session memory when present
      if (typeof result.roomCode === 'string') {
        const matched = ctx.rooms.find(
          (r) => r.roomCode.toLowerCase() === String(result.roomCode).toLowerCase()
        );
        if (matched) {
          ctx.memory.lastMentionedRoomId = matched.id;
          ctx.memory.lastMentionedRoomCode = matched.roomCode;
        }
      }
      if (typeof result.roomId === 'string') {
        const matched = ctx.rooms.find((r) => r.id === result.roomId);
        if (matched) {
          ctx.memory.lastMentionedRoomId = matched.id;
          ctx.memory.lastMentionedRoomCode = matched.roomCode;
        }
      }
      return enrichResultWithSpokenNames(result) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Capability execution failed.';
      ctx.emitClientMessage({
        type: 'tool_status',
        toolName: id,
        status: 'error',
        message: msg,
      });
      return { ok: false, error: msg };
    }
  }
}

function buildConfirmationSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'control_building_or_campus_appliances': {
      const scope = String(args.scope || 'campus');
      const target = String(args.targetType || 'appliances');
      const mode =
        args.mode === 'restore_auto'
          ? 'restore to Adaptive AUTO'
          : `set to ${args.outputPercent === 0 ? 'OFF' : `${args.outputPercent ?? 0}%`}`;
      const building = args.building ? ` (${args.building})` : '';
      return `Batch control ${scope}${building}: ${target} -> ${mode}`;
    }
    case 'optimize_campus_energy':
      return `Run campus energy optimization (scope: ${String(args.scope || 'all')})`;
    case 'update_campus_settings':
      return 'Update campus energy policy / tariff / target settings';
    case 'execute_app_action':
      return `Execute workspace action: ${String(args.action || 'action')}`;
    default:
      return `Execute ${toolName}`;
  }
}

/**
 * Registers the complete ROOMWISE platform capability suite into a registry instance.
 * Future features can call `registry.register(...)` dynamically with zero changes to core voice code.
 */
export function createRoomwiseCapabilityRegistry(
  legacyDeclarations: FunctionDeclaration[]
): VoiceCapabilityRegistry {
  const registry = new VoiceCapabilityRegistry();
  const declByName = new Map<string, FunctionDeclaration>(
    legacyDeclarations.map((d) => [d.name || '', d])
  );

  const registerLegacy = (config: {
    id: string;
    section: VoiceCapabilitySectionId;
    sectionLabel: string;
    supportedIntents: string[];
    permissionLevel: VoicePermissionLevel;
    requiresConfirmation?: boolean;
    dataSources: string[];
  }) => {
    const declaration = declByName.get(config.id);
    if (!declaration) return;
    registry.register({
      id: config.id,
      section: config.section,
      sectionLabel: config.sectionLabel,
      description: declaration.description || config.id,
      supportedIntents: config.supportedIntents,
      permissionLevel: config.permissionLevel,
      requiresConfirmation: config.requiresConfirmation,
      dataSources: config.dataSources,
      available: true,
      declaration,
      handler: async (args, ctx) => {
        // Pre-resolve roomQuery using our robust Roman/spoken/context resolver before delegating
        const nextArgs = { ...args };
        if (typeof nextArgs.roomQuery === 'string' || config.id === 'get_classroom_status' || config.id === 'get_classroom_telemetry' || config.id === 'get_appliance_configuration') {
          const rq = typeof nextArgs.roomQuery === 'string' ? nextArgs.roomQuery : '';
          const resolved = resolveClassroomRobust(ctx.rooms, rq, ctx.memory);
          if (resolved.match) {
            nextArgs.roomQuery = resolved.match.roomCode;
          }
        }
        return ctx.delegateLegacyTool(config.id, nextArgs);
      },
    });
  };

  // --- 1. OVERVIEW ---
  registerLegacy({
    id: 'get_campus_overview',
    section: 'overview',
    sectionLabel: 'Overview',
    supportedIntents: ['campus overview', 'summary', 'active rooms', 'total load'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot', 'campus_summary_engine'],
  });
  registerLegacy({
    id: 'get_current_energy_summary',
    section: 'overview',
    sectionLabel: 'Overview',
    supportedIntents: ['current wattage', 'real-time energy', 'today kWh', 'CO2 avoided'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot', 'campus_summary_engine'],
  });

  // --- 2. CLASSROOMS & DIGITAL TWIN ---
  registerLegacy({
    id: 'list_classrooms',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['list rooms', 'which rooms are in G+3', 'filter classrooms'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'get_classroom_status',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['classroom status', 'room power', 'lights and fans in room'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'get_classroom_telemetry',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['temperature', 'humidity', 'CO2', 'daylight lux', 'PIR motion'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'get_occupancy_status',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['occupancy', 'vacant rooms', 'PIR motion activity'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'get_lighting_status',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['lighting load', 'LED dimming status'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'get_fan_status',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['fan status', 'BLDC fan speed'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'get_appliance_configuration',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['appliances in room', 'unit codes', 'AC presence'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot', 'room_appliance_specs'],
  });
  registerLegacy({
    id: 'control_classroom_appliance',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['turn off lights', 'dim lights', 'set fan speed', 'restore auto'],
    permissionLevel: 'admin',
    requiresConfirmation: false,
    dataSources: ['server_appliance_controller'],
  });
  registerLegacy({
    id: 'control_building_or_campus_appliances',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['turn off all lights in building', 'campus-wide control', 'vacant shutoff'],
    permissionLevel: 'admin',
    requiresConfirmation: true,
    dataSources: ['server_appliance_controller'],
  });
  registerLegacy({
    id: 'recalibrate_classroom',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['recalibrate sensors', 'Bayesian calibration'],
    permissionLevel: 'admin',
    dataSources: ['calibration_engine'],
  });
  registerLegacy({
    id: 'update_classroom_parameters',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    supportedIntents: ['change target lux', 'change max fan speed', 'eco mode'],
    permissionLevel: 'admin',
    dataSources: ['calibration_engine'],
  });

  // --- 3. CAMPUS LIVE (3D REPLICA) ---
  registry.register({
    id: 'get_campus_live_info',
    section: 'campus-live',
    sectionLabel: 'Campus Live',
    description:
      'Describe the interactive 3D Campus Live replica of DAV Model School IIT Kharagpur, its reconstructed buildings, live energy heatmaps, weather-responsive sky/lighting, and historical playback modes.',
    supportedIntents: [
      'campus live overview',
      '3d campus buildings',
      'campus live weather sync',
      'which blocks are in campus live',
    ],
    permissionLevel: 'public',
    dataSources: ['campus_reconstruction', 'environmental_service', 'live_room_snapshot'],
    available: true,
    declaration: {
      name: 'get_campus_live_info',
      description:
        'Get summary of the 3D Campus Live digital replica of DAV Model School IIT Kharagpur: buildings (G+3 Block, New Building, Old Building with connecting path, Pre-Primary Block, Multipurpose Hall), Gates 1 & 2, Football Ground, Basketball Court, weather sync, and active energy load by block.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          buildingFocus: {
            type: Type.STRING,
            description: 'Optional block name (G+3 Block, New Building, Old Building, Pre-Primary Block, Multipurpose Hall).',
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const sky = environmentalService.getCachedSkyAndRadiationSnapshot();
      const blocks = [
        'G+3 Block',
        'New Building',
        'Old Building',
        'Pre-Primary Block',
        'Multipurpose Hall',
      ];
      const byBlock = blocks.map((b) => {
        const bRooms = ctx.rooms.filter((r) => r.building === b);
        const currentWatts = bRooms.reduce((acc, r) => acc + r.currentPowerWatts, 0);
        const ratedWatts = bRooms.reduce(
          (acc, r) => acc + (r.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(r.appliances)),
          0
        );
        return {
          building: b,
          roomCount: bRooms.length,
          currentPowerWatts: currentWatts,
          ratedPowerWatts: ratedWatts,
        };
      });

      const focus = typeof args.buildingFocus === 'string' ? args.buildingFocus.trim() : '';
      return {
        ok: true,
        campus: 'DAV Model School, IIT Kharagpur — 1:1 3D Campus Live Replica',
        architecturalLayout: {
          buildings: byBlock,
          landmarks: [
            'Gate 1 (north entrance near G+3 Block)',
            'Gate 2 (west entrance near Football Ground)',
            'Covered/paved connecting path linking New Building (NB) and Old Building (OB)',
            'Dedicated separation gap between Multipurpose Hall (2-floor height) and Pre-Primary Block',
            'Football Ground & Basketball Court (BB)',
          ],
        },
        weatherSync: {
          available: sky.available,
          cloudCoverPercent: sky.currentCloudCoverPercent,
          currentGhiWm2: sky.currentGhiWm2,
          todayPeakGhiWm2: sky.todayPeakGhiWm2,
          fetchedAtIst: sky.fetchedAtIst,
          source: 'Open-Meteo live sync',
        },
        focusedBlock: focus
          ? byBlock.find((b) => b.building.toLowerCase().includes(focus.toLowerCase())) || null
          : null,
        availableTimeModes: ['live', 'today', 'yesterday', 'last_7_days'],
      };
    },
  });

  // --- 4. ENVIRONMENTAL & SOLAR INTELLIGENCE ---
  registry.register({
    id: 'get_environmental_intelligence',
    section: 'environmental-solar',
    sectionLabel: 'Environmental & Solar Intelligence',
    description:
      'Fetch live outdoor weather, ambient temperature, humidity, heat index, AQI (PM2.5/PM10), solar irradiance, daylight availability, cooling anticipation, and short-term forecast for DAV Model School IIT Kharagpur from Open-Meteo.',
    supportedIntents: [
      'outdoor weather',
      'air quality',
      'AQI',
      'solar irradiance',
      'daylight forecast',
      'cooling anticipation',
    ],
    permissionLevel: 'public',
    dataSources: ['open_meteo_forecast', 'open_meteo_air_quality', 'environmental_service'],
    available: true,
    declaration: {
      name: 'get_environmental_intelligence',
      description:
        'Retrieve live campus outdoor environmental intelligence from Open-Meteo: temperature, apparent temperature, humidity, cloud cover, solar radiation, air quality (AQI, PM2.5, PM10), daylight opportunity, cooling anticipation, and weather forecast.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          focus: {
            type: Type.STRING,
            description: 'Optional focus: "current", "air_quality", "solar_radiation", "forecast", or "all".',
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const overview = await environmentalService.getOverview({
        settings: ctx.settings,
        classrooms: ctx.rooms,
        forceRefresh: false,
      });
      const focus = typeof args.focus === 'string' ? args.focus : 'all';
      return {
        ok: true,
        focus,
        campus: overview.campus,
        currentWeather: overview.current,
        airQuality: overview.airQuality
          ? {
              modelLabel: overview.airQuality.modelLabel,
              pm25UgM3: overview.airQuality.current?.pm25UgM3 ?? null,
              pm10UgM3: overview.airQuality.current?.pm10UgM3 ?? null,
              no2UgM3: overview.airQuality.current?.no2UgM3 ?? null,
              o3UgM3: overview.airQuality.current?.o3UgM3 ?? null,
              uvIndex: overview.airQuality.current?.uvIndex ?? null,
            }
          : null,
        derivedInsights: {
          coolingAnticipation: overview.insights?.coolingAnticipation ?? null,
          daylightIntelligence: overview.insights?.daylightIntelligence ?? null,
          energyOutlook: overview.insights?.energyOutlook ?? null,
        },
        freshness: {
          forecast: overview.freshness?.forecast?.status || 'unknown',
          airQuality: overview.freshness?.airQuality?.status || 'unknown',
        },
        dataClassification: 'Live Open-Meteo Weather & Air Quality API + Simulated Classroom Correlation',
      };
    },
  });

  registry.register({
    id: 'get_solar_assessment',
    section: 'environmental-solar',
    sectionLabel: 'Environmental & Solar Intelligence',
    description:
      'Retrieve rooftop solar potential assessment powered by European Commission PVGIS 5.3 and reconstructed campus roof footprints (G+3, NB, OB, PP, MPH), including Conservative/Moderate/High-Theoretical planning scenarios, monthly/annual kWh generation, campus demand offset, and grid/WBERC feasibility notes.',
    supportedIntents: [
      'solar potential',
      'PVGIS estimate',
      'rooftop solar generation',
      'solar scenarios',
      'can solar cover school demand',
      'solar per building',
    ],
    permissionLevel: 'public',
    dataSources: ['pvgis_5_3', 'solar_service', 'campus_roof_footprints'],
    available: true,
    declaration: {
      name: 'get_solar_assessment',
      description:
        'Get rooftop solar assessment for DAV Model School IIT Kharagpur: PVGIS annual & monthly generation (kWh), installed capacity (kWp) across Conservative / Moderate / High-Theoretical scenarios, per-building roof potential (G+3, NB, OB, PP, MPH), campus electricity demand comparison, and grid interconnection caveats.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          buildingQuery: {
            type: Type.STRING,
            description: 'Optional specific building (e.g. "G+3", "New Building", "Old Building", "Pre-Primary", "Multipurpose Hall").',
          },
          scenario: {
            type: Type.STRING,
            description: 'Optional planning scenario: "conservative", "moderate", or "high_theoretical".',
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const workspace = await solarService.getWorkspace(ctx.settings, {
        allowLiveDiscovery: false,
      });
      const bq = typeof args.buildingQuery === 'string' ? args.buildingQuery.toLowerCase().trim() : '';
      const buildingsSummary = workspace.buildings.map((b) => ({
        id: b.id,
        name: b.displayName,
        roofAreaM2: b.geometry?.grossFootprintAreaM2 ?? 0,
        usableRoofAreaM2: b.capacity?.usableRoofAreaM2 ?? 0,
        estimatedCapacityKwp: b.capacity?.effectiveCapacityKwp ?? 0,
        annualGenerationKWh: b.solarEstimate?.annualGenerationKwh ?? null,
        specificYieldKWhPerKwp: b.solarEstimate?.specificYieldKwhPerKwp ?? null,
        selected: b.selectionStatus === 'confirmed' || b.selectionStatus === 'provisional',
      }));
      const matchedBuilding = bq
        ? buildingsSummary.find((b) => b.name.toLowerCase().includes(bq)) || null
        : null;

      return {
        ok: true,
        campus: workspace.campus,
        activeScenario: workspace.campusSummary?.activeScenarioId || 'moderate',
        planningScenarios: workspace.campusSummary?.scenarioComparisons || [],
        campusSolarSummary: {
          selectedBuildingsCount: workspace.campusSummary?.selectedBuildingsCount ?? buildingsSummary.length,
          totalRoofAreaM2: workspace.campusSummary?.combinedGrossFootprintAreaM2 ?? 0,
          totalUsableAreaM2: workspace.campusSummary?.combinedUsableRoofAreaM2 ?? 0,
          combinedCapacityKwp: workspace.campusSummary?.combinedCapacityKwp ?? 0,
          annualGenerationKWh: workspace.campusSummary?.combinedAnnualGenerationKwh ?? null,
          monthlyGenerationKWh: workspace.campusSummary?.combinedMonthlyGeneration || [],
        },
        demandComparison: workspace.demandComparison,
        gridFeasibilityChecklist: workspace.campusSummary?.gridFeasibilityChecklist || [],
        buildings: matchedBuilding ? [matchedBuilding] : buildingsSummary,
        limitations: workspace.limitations,
        dataClassification:
          'PVGIS 5.3 Multi-Year Climatological Solar Model over Reconstructed Aerial Roof Footprints (Planning Estimate, Not Certified Engineering Design)',
      };
    },
  });

  // --- 5. ENERGY ANALYTICS ---
  registerLegacy({
    id: 'compare_buildings',
    section: 'analytics',
    sectionLabel: 'Energy Analytics',
    supportedIntents: ['compare buildings', 'highest consuming building', 'block breakdown'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'rank_and_filter_classrooms',
    section: 'analytics',
    sectionLabel: 'Energy Analytics',
    supportedIntents: ['top energy consumers', 'hottest room', 'highest CO2', 'manual overrides'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'explain_energy_trend',
    section: 'analytics',
    sectionLabel: 'Energy Analytics',
    supportedIntents: ['why is savings high/low', 'daylight harvesting trend'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot'],
  });
  registerLegacy({
    id: 'simulate_policy_what_if',
    section: 'analytics',
    sectionLabel: 'Energy Analytics',
    supportedIntents: ['what if we reduce target lux', 'tariff simulation', 'policy what-if'],
    permissionLevel: 'public',
    dataSources: ['policy_simulator'],
  });
  registerLegacy({
    id: 'get_energy_savings_estimate',
    section: 'analytics',
    sectionLabel: 'Energy Analytics',
    supportedIntents: ['estimated savings', 'monthly INR savings', 'annual CO2 savings'],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot', 'school_calendar_profile'],
  });

  // --- 6. ENERGY HISTORY & INTERVENTION LEDGER ---
  registerLegacy({
    id: 'get_energy_consumption_history',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    supportedIntents: ['energy consumed yesterday', 'last 7 days kWh', 'this month energy'],
    permissionLevel: 'public',
    dataSources: ['energy_history_service'],
  });
  registerLegacy({
    id: 'compare_energy_periods',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    supportedIntents: ['compare this week vs last week', 'compare months'],
    permissionLevel: 'public',
    dataSources: ['energy_history_service'],
  });
  registerLegacy({
    id: 'get_classroom_energy_history',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    supportedIntents: ['classroom energy history', 'room kWh this week'],
    permissionLevel: 'public',
    dataSources: ['energy_history_service'],
  });
  registerLegacy({
    id: 'get_time_of_day_profile',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    supportedIntents: ['peak hour', 'hourly energy profile', 'time of day load'],
    permissionLevel: 'public',
    dataSources: ['energy_history_service'],
  });
  registerLegacy({
    id: 'get_historical_anomalies',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    supportedIntents: ['historical anomalies', 'after-hours spikes'],
    permissionLevel: 'public',
    dataSources: ['energy_history_service'],
  });
  registerLegacy({
    id: 'investigate_energy_reason',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    supportedIntents: ['why was consumption higher', 'investigate energy spike'],
    permissionLevel: 'public',
    dataSources: ['energy_history_service'],
  });

  registry.register({
    id: 'get_intervention_ledger',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    description:
      'Query the Energy Intervention Ledger inside Energy History. Returns logged energy-saving interventions with strict separation between Meter-Verified avoided kWh and Simulated/Estimated avoided kWh, plus overlap protection metadata.',
    supportedIntents: [
      'intervention ledger',
      'energy savings log',
      'how much energy did interventions save',
      'meter verified savings',
      'simulated savings interventions',
      'interventions this week',
    ],
    permissionLevel: 'public',
    dataSources: ['intervention_ledger_service'],
    available: true,
    declaration: {
      name: 'get_intervention_ledger',
      description:
        'Query the Energy Intervention Ledger (inside Energy History) with optional filters for period, building, classroom, trigger source, circuit type, or verification status ("meter_verified" vs "estimated"). Strictly separates meter-verified savings from simulated/estimated avoided kWh.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          period: {
            type: Type.STRING,
            description: 'Optional date period: "today", "yesterday", "last_7_days", "last_30_days", "this_month", "previous_month", or "all".',
          },
          building: {
            type: Type.STRING,
            description: 'Optional building filter (e.g. "G+3 Block", "New Building", "Old Building").',
          },
          roomQuery: {
            type: Type.STRING,
            description: 'Optional classroom filter (e.g. "Class X-B", "G3-301", "ICT Lab").',
          },
          verificationStatus: {
            type: Type.STRING,
            description: 'Optional filter: "all", "meter_verified", or "estimated".',
          },
          triggerSource: {
            type: Type.STRING,
            description: 'Optional trigger filter: "pir_vacancy_shutoff", "daylight_dimming", "manual_admin_action", "audit_remediation", "scheduled_cutoff".',
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const period = typeof args.period === 'string' && args.period.trim() ? args.period.trim() : 'all';
      const query: Record<string, string | undefined> = {};

      if (period !== 'all') {
        const range = resolveNaturalDateQuery(period);
        query.startDate = range.startDate;
        query.endDate = range.endDate;
        ctx.memory.lastPeriod = period;
      }
      if (typeof args.building === 'string' && args.building.trim()) {
        query.building = args.building.trim();
      }
      if (typeof args.roomQuery === 'string' && args.roomQuery.trim()) {
        const resolved = resolveClassroomRobust(ctx.rooms, args.roomQuery, ctx.memory);
        if (resolved.match) {
          query.roomId = resolved.match.id;
        }
      }
      if (args.verificationStatus === 'meter_verified' || args.verificationStatus === 'estimated') {
        query.verificationStatus = args.verificationStatus;
      }
      if (typeof args.triggerSource === 'string' && args.triggerSource.trim()) {
        query.triggerCategory = args.triggerSource.trim();
      }

      const ledger = interventionLedgerService.listInterventions(query);
      if (ledger.records.length > 0) {
        ctx.memory.lastMentionedInterventionId = ledger.records[0].id;
      }

      return {
        ok: true,
        period,
        totalMatchingInterventions: ledger.summary.totalInterventions,
        summary: {
          meterVerifiedAvoidedKWh: ledger.summary.meterVerifiedAvoidedKwh,
          simulatedEstimatedAvoidedKWh: ledger.summary.estimatedAvoidedKwh,
          meterBackedAvoidedKWh: ledger.summary.meterBackedAvoidedKwh,
          countedInterventions: ledger.summary.countedInterventions,
          overlapAdjustedCount: ledger.summary.overlapAdjustedCount,
          simulatedEventCount: ledger.summary.simulatedEventCount,
          hardwareEventCount: ledger.summary.hardwareEventCount,
        },
        strictDisclosure: ledger.provenanceDisclosure,
        recentInterventions: ledger.records.slice(0, 8).map((item) => ({
          id: item.id,
          roomCode: item.roomCode,
          roomName: item.roomName,
          spokenRoomName: formatRoomNameForSpeech(item.roomName),
          building: item.building,
          actionPerformed: item.actionPerformed,
          triggerCategory: item.triggerCategory,
          circuitType: item.circuitType,
          effectiveAvoidedKWh: item.energyCalculation.attributedEnergyAvoidedKwh ?? 0,
          verificationStatus: item.verificationStatus,
          overlapAdjusted: item.overlap.status !== 'counted_full',
          occurredAtIst: item.startAtIst,
        })),
      };
    },
  });

  registry.register({
    id: 'get_intervention_detail',
    section: 'history',
    sectionLabel: 'Energy History & Intervention Ledger',
    description:
      'Inspect a specific Energy Intervention Ledger record: counterfactual baseline watts, post-action watts, overlap adjustment interval, calculation formula, assumptions, and audit trail.',
    supportedIntents: [
      'explain intervention calculation',
      'intervention assumptions',
      'how was this saving calculated',
      'inspect intervention detail',
    ],
    permissionLevel: 'public',
    dataSources: ['intervention_ledger_service'],
    available: true,
    declaration: {
      name: 'get_intervention_detail',
      description:
        'Inspect detailed engineering methodology, counterfactual baseline, overlap prevention interval, assumptions, and audit trail for a specific intervention ID (or the most recently discussed intervention).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          interventionId: {
            type: Type.STRING,
            description: 'Optional intervention ID. If omitted, inspects the most recent intervention in context.',
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const id =
        (typeof args.interventionId === 'string' && args.interventionId.trim()) ||
        ctx.memory.lastMentionedInterventionId ||
        interventionLedgerService.listInterventions({}).records[0]?.id;

      if (!id) {
        return { ok: false, error: 'No interventions found in the Energy Intervention Ledger.' };
      }

      const detail = interventionLedgerService.getInterventionDetail(id);
      if (!detail) {
        return { ok: false, error: `Intervention "${id}" was not found in the ledger.` };
      }
      ctx.memory.lastMentionedInterventionId = detail.record.id;
      return {
        ok: true,
        intervention: {
          ...detail.record,
          spokenRoomName: formatRoomNameForSpeech(detail.record.roomName),
        },
        relatedGroupEventsCount: detail.relatedGroupEvents.length,
        correctionsCount: detail.corrections.length,
      };
    },
  });

  // --- 7. SPACE INTELLIGENCE ---
  registerLegacy({
    id: 'get_space_intelligence_summary',
    section: 'space-intelligence',
    sectionLabel: 'Space Intelligence',
    supportedIntents: ['space intelligence summary', 'attendance utilization', 'underutilized rooms'],
    permissionLevel: 'public',
    dataSources: ['space_intelligence_service'],
  });
  registerLegacy({
    id: 'get_space_allocation_recommendations',
    section: 'space-intelligence',
    sectionLabel: 'Space Intelligence',
    supportedIntents: ['room reallocation recommendations', 'space proposals', 'right-size classrooms'],
    permissionLevel: 'public',
    dataSources: ['space_intelligence_service'],
  });
  registerLegacy({
    id: 'get_space_allocation_history',
    section: 'space-intelligence',
    sectionLabel: 'Space Intelligence',
    supportedIntents: ['space allocation history', 'approved relocations'],
    permissionLevel: 'public',
    dataSources: ['space_intelligence_service'],
  });

  // --- 8. ENERGY AUDIT ---
  registerLegacy({
    id: 'generate_energy_audit_summary',
    section: 'audit',
    sectionLabel: 'Energy Audit',
    supportedIntents: ['energy audit summary', 'ECBC compliance', 'open waste findings'],
    permissionLevel: 'public',
    dataSources: ['live_audit_engine'],
  });
  registerLegacy({
    id: 'identify_unusual_consumption',
    section: 'audit',
    sectionLabel: 'Energy Audit',
    supportedIntents: ['unusual consumption', 'manual overrides', 'high utilization rooms'],
    permissionLevel: 'public',
    dataSources: ['live_audit_engine'],
  });
  registerLegacy({
    id: 'identify_vacant_classroom_consumption',
    section: 'audit',
    sectionLabel: 'Energy Audit',
    supportedIntents: ['vacant rooms drawing power', 'empty room waste'],
    permissionLevel: 'public',
    dataSources: ['live_audit_engine'],
  });
  registerLegacy({
    id: 'optimize_campus_energy',
    section: 'audit',
    sectionLabel: 'Energy Audit',
    supportedIntents: ['optimize campus energy', 'remediate all audit findings'],
    permissionLevel: 'admin',
    requiresConfirmation: true,
    dataSources: ['server_appliance_controller', 'live_audit_engine'],
  });
  registerLegacy({
    id: 'resolve_audit_finding',
    section: 'audit',
    sectionLabel: 'Energy Audit',
    supportedIntents: ['resolve audit finding', 'fix room waste alert'],
    permissionLevel: 'admin',
    dataSources: ['server_appliance_controller', 'live_audit_engine'],
  });

  // --- 9. REPORTS & BEE ---
  registry.register({
    id: 'get_reports_and_bee_info',
    section: 'reports',
    sectionLabel: 'Reports & BEE',
    description:
      'Summarize available ROOMWISE exportable reports (25-room Energy Audit CSV, printable BEE/ECBC-aligned Energy Audit Report) and honestly state certification boundaries.',
    supportedIntents: ['reports summary', 'BEE certification status', 'what reports can I export'],
    permissionLevel: 'public',
    dataSources: ['live_audit_engine', 'campus_summary_engine'],
    available: true,
    declaration: {
      name: 'get_reports_and_bee_info',
      description:
        'Summarize available reports in the Reports & BEE section (CSV audit export, printable ECBC/BEE guidance report) and clarify that ROOMWISE provides engineering audit guidance rather than official BEE certification.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async (_args, ctx) => {
      return {
        ok: true,
        institution: ctx.settings.institutionName,
        availableExports: [
          '25-room Energy Audit CSV export (appliance loads, daylight/occupancy metrics, estimated daily kWh)',
          'Printable BEE / ECBC-Aligned Energy Audit Summary Report',
        ],
        schoolCalendarBasis: {
          schoolDaysPerMonth: SCHOOL_DAYS_PER_MONTH,
          schoolDaysPerYear: SCHOOL_DAYS_PER_YEAR,
          tariffPerKWhINR: ctx.settings.tariffPerKWhINR,
          gridCarbonFactorKgCO2PerKWh: ctx.settings.gridCarbonFactorKgCO2PerKWh,
        },
        certificationDisclosure:
          'ROOMWISE aligns its operational audit checks with ECBC / BEE school-building energy guidelines, but it is NOT an officially BEE-certified audit tool and does not issue official government compliance certificates.',
      };
    },
  });

  // --- 10. SETTINGS, SECURITY & PLANNED TELEMETRY ARCHITECTURE ---
  registry.register({
    id: 'get_campus_settings',
    section: 'settings',
    sectionLabel: 'Settings',
    description:
      'Read safe, non-secret ROOMWISE campus configuration: tariff (INR/kWh), grid CO2 factor, classroom & lab target lux, PIR inactivity grace period, school hours, learning mode, and coordinates.',
    supportedIntents: ['current tariff', 'target lux setting', 'PIR grace period', 'school hours', 'campus settings'],
    permissionLevel: 'public',
    dataSources: ['school_settings'],
    available: true,
    declaration: {
      name: 'get_campus_settings',
      description:
        'Read safe non-secret ROOMWISE campus settings (tariff per kWh, grid carbon factor, classroom/lab lux targets, PIR grace minutes, learning mode, school operating hours, campus coordinates).',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async (_args, ctx) => ({
      ok: true,
      institutionName: ctx.settings.institutionName,
      campusLocation: ctx.settings.campusLocation,
      tariffPerKWhINR: ctx.settings.tariffPerKWhINR,
      gridCarbonFactorKgCO2PerKWh: ctx.settings.gridCarbonFactorKgCO2PerKWh,
      standardClassroomTargetLux: ctx.settings.standardClassroomTargetLux,
      labTargetLux: ctx.settings.labTargetLux,
      defaultInactivityGraceMinutes: ctx.settings.defaultInactivityGraceMinutes,
      learningMode: ctx.settings.learningMode,
      lowPowerMode: ctx.settings.lowPowerMode,
      schoolHours: ctx.settings.schoolHours,
      campusCoordinates: ctx.settings.campusCoordinates || null,
      schoolCalendarAssumptions: {
        schoolDaysPerMonth: SCHOOL_DAYS_PER_MONTH,
        schoolDaysPerYear: SCHOOL_DAYS_PER_YEAR,
      },
    }),
  });

  registerLegacy({
    id: 'update_campus_settings',
    section: 'settings',
    sectionLabel: 'Settings',
    supportedIntents: ['change electricity tariff', 'update target lux', 'change learning mode'],
    permissionLevel: 'admin',
    requiresConfirmation: true,
    dataSources: ['school_settings'],
  });
  registerLegacy({
    id: 'get_security_audit_and_staff',
    section: 'settings',
    sectionLabel: 'Settings',
    supportedIntents: ['staff directory', 'passkey status', 'security audit log'],
    permissionLevel: 'public',
    dataSources: ['auth_audit_store'],
  });

  registry.register({
    id: 'get_planned_telemetry_architecture',
    section: 'settings',
    sectionLabel: 'Settings',
    description:
      'Honestly explain the documented planned Sensor Telemetry Ingestion Architecture (ESP32/PIR/Lux/SCT-013 nodes, MQTT/TLS edge gateway, planned /api/v1/telemetry/ingest contract), making clear it is architecture documentation only and NOT currently receiving live hardware sensor telemetry.',
    supportedIntents: [
      'sensor telemetry architecture',
      'are real sensors connected',
      'ESP32 ingestion pipeline',
      'hardware integration roadmap',
    ],
    permissionLevel: 'public',
    dataSources: ['architecture_documentation'],
    available: true,
    declaration: {
      name: 'get_planned_telemetry_architecture',
      description:
        'Explain the planned (not yet live) ROOMWISE Sensor Telemetry Ingestion Architecture: physical room sensor nodes (PIR, BH1750 lux, DHT/SHT, current clamp), campus MQTT/TLS edge gateway, planned API ingestion contract, and verification upgrade path.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => ({
      ok: true,
      implementationStatus: 'PLANNED_DOCUMENTATION_ONLY',
      isLiveHardwareConnected: false,
      documentPath: 'docs/architecture/ROOMWISE_SENSOR_TELEMETRY_ARCHITECTURE.md',
      summary:
        'ROOMWISE currently operates on a calibrated simulated campus telemetry model. A formal Sensor Telemetry Ingestion Architecture has been documented for future physical deployment using room-level ESP32 nodes (PIR motion, lux, temperature/humidity, CT current clamps), a campus MQTT/TLS edge gateway, and a planned /api/v1/telemetry/ingest API with idempotent buffering and strict meter verification — however, live hardware telemetry ingestion is not yet active.',
    }),
  });

  // --- 11. NAVIGATION, UI ACTIONS, CAPABILITY DISCOVERY & CONFIRMATION ---
  registry.register({
    id: 'navigate_roomwise',
    section: 'navigation',
    sectionLabel: 'Navigation & Workspace',
    description:
      'Navigate the ROOMWISE interface to ANY of the 11 sections, open a specific classroom modal (including Roman numeral rooms like Class X-B), open sub-tabs (such as Energy Intervention Ledger inside Energy History or Solar Potential / PVGIS / Map inside Environmental & Solar Intelligence), apply history/ledger filters, or go back to the previous section.',
    supportedIntents: [
      'open overview',
      'open digital twin',
      'open campus live',
      'open classrooms',
      'open environmental and solar',
      'open solar potential',
      'open analytics',
      'open energy history',
      'open intervention ledger',
      'open space intelligence',
      'open energy audit',
      'open reports',
      'open settings',
      'open class X-B',
      'go back',
    ],
    permissionLevel: 'public',
    dataSources: ['ui_router'],
    available: true,
    declaration: {
      name: 'navigate_roomwise',
      description:
        'Navigate ROOMWISE to any of its 11 sections, open a classroom modal, switch sub-tabs (e.g. Energy Intervention Ledger inside Energy History, or Solar Potential / Mapping / Environmental inside Environmental & Solar Intelligence), apply filters, or go back.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          target: {
            type: Type.STRING,
            description:
              'One of: "dashboard", "digital-twin", "campus-live", "classrooms", "environmental-solar", "environmental", "solar", "analytics", "history", "space-intelligence", "audit", "reports", "settings", "admin-login", "classroom", "go-back".',
          },
          roomQuery: {
            type: Type.STRING,
            description: 'Classroom name or code when target="classroom" (e.g. "Class X-B", "Class 10-B", "G3-301", "ICT Lab").',
          },
          subTab: {
            type: Type.STRING,
            description:
              'Optional sub-tab: for history use "consumption" or "interventions"; for environmental-solar use "environmental", "mapping", "solar-potential", "comparison", or "assumptions".',
          },
          preset: {
            type: Type.STRING,
            description:
              'Optional history/ledger period filter: "today", "yesterday", "last_7_days", "last_30_days", "this_month", "previous_month".',
          },
          verificationStatus: {
            type: Type.STRING,
            description: 'Optional intervention ledger verification filter: "all", "meter_verified", or "estimated".',
          },
          building: {
            type: Type.STRING,
            description: 'Optional building filter for history or intervention ledger.',
          },
          solarScenario: {
            type: Type.STRING,
            description: 'Optional solar planning scenario: "conservative", "moderate", or "high_theoretical".',
          },
          openQrPlacard: {
            type: Type.BOOLEAN,
            description: 'If true with target="classroom", opens the room QR placard modal.',
          },
        },
        required: ['target'],
      },
    },
    handler: async (args, ctx) => {
      const rawTarget = typeof args.target === 'string' ? args.target.trim().toLowerCase() : 'dashboard';

      const allowedTargets = new Set<VoiceNavigationTarget>([
        'dashboard',
        'digital-twin',
        'campus-live',
        'classrooms',
        'environmental-solar',
        'environmental',
        'solar',
        'analytics',
        'history',
        'space-intelligence',
        'audit',
        'reports',
        'settings',
        'admin-login',
        'classroom',
        'go-back',
      ]);

      if (!allowedTargets.has(rawTarget as VoiceNavigationTarget)) {
        return {
          ok: false,
          error: `Navigation target "${rawTarget}" is not supported.`,
        };
      }

      if (rawTarget === 'go-back') {
        const hist = ctx.memory.navigationHistory;
        if (hist.length > 1) {
          hist.pop();
        }
        const prevTab = hist[hist.length - 1] || 'dashboard';
        ctx.memory.activeTab = prevTab;
        const action: VoiceClientNavigationAction = { target: 'go-back' };
        ctx.emitClientMessage({ type: 'client_navigation', action });
        ctx.emitClientMessage({
          type: 'tool_status',
          toolName: 'navigate_roomwise',
          status: 'completed',
          message: `Returned to ${prevTab}`,
        });
        return { ok: true, navigatedTo: prevTab, action: 'go-back' };
      }

      const action: VoiceClientNavigationAction = {
        target: rawTarget as VoiceNavigationTarget,
      };

      if (rawTarget === 'classroom') {
        const rq = typeof args.roomQuery === 'string' ? args.roomQuery : '';
        const res = resolveClassroomRobust(ctx.rooms, rq, ctx.memory);
        if (!res.match) {
          return {
            ok: false,
            ambiguous: Boolean(res.ambiguous),
            matches: res.ambiguous?.map((r) => ({
              roomCode: r.roomCode,
              name: r.name,
              spokenName: buildSpokenRoomIdentity(r),
            })),
            message: `Clarify which classroom to open for "${rq}".`,
          };
        }
        action.roomId = res.match.id;
        action.roomCode = res.match.roomCode;
        action.openQrPlacard = Boolean(args.openQrPlacard);
        ctx.memory.lastMentionedRoomId = res.match.id;
        ctx.memory.lastMentionedRoomCode = res.match.roomCode;
        ctx.memory.selectedRoomId = res.match.id;
      } else {
        const normalizedTab =
          rawTarget === 'environmental' || rawTarget === 'solar'
            ? 'environmental-solar'
            : rawTarget;
        if (normalizedTab !== 'admin-login') {
          if (ctx.memory.navigationHistory[ctx.memory.navigationHistory.length - 1] !== normalizedTab) {
            ctx.memory.navigationHistory.push(normalizedTab);
            if (ctx.memory.navigationHistory.length > 15) ctx.memory.navigationHistory.shift();
          }
          ctx.memory.activeTab = normalizedTab;
        }
      }

      if (typeof args.subTab === 'string' && args.subTab.trim()) {
        action.subTab = args.subTab.trim() as VoiceHistorySubTab | VoiceEnvironmentalSolarSubTab;
        ctx.memory.activeSubTab = action.subTab;
      } else if (rawTarget === 'solar') {
        action.subTab = 'solar-potential';
        ctx.memory.activeSubTab = 'solar-potential';
      } else if (rawTarget === 'environmental') {
        action.subTab = 'environmental';
        ctx.memory.activeSubTab = 'environmental';
      }

      const filters: VoiceHistoryFilterDirective = {};
      if (typeof args.preset === 'string' && args.preset.trim()) {
        filters.preset = args.preset.trim() as VoiceHistoryFilterDirective['preset'];
        ctx.memory.lastPeriod = args.preset.trim();
      }
      if (
        args.verificationStatus === 'all' ||
        args.verificationStatus === 'meter_verified' ||
        args.verificationStatus === 'estimated'
      ) {
        filters.verificationStatus = args.verificationStatus;
      }
      if (typeof args.building === 'string' && args.building.trim()) {
        filters.building = args.building.trim();
      }
      if (Object.keys(filters).length > 0) {
        action.historyFilters = filters;
      }

      if (
        args.solarScenario === 'conservative' ||
        args.solarScenario === 'moderate' ||
        args.solarScenario === 'high_theoretical'
      ) {
        action.solarScenario = args.solarScenario;
      }

      ctx.emitClientMessage({ type: 'client_navigation', action });
      ctx.emitClientMessage({
        type: 'tool_status',
        toolName: 'navigate_roomwise',
        status: 'completed',
        message:
          action.target === 'classroom'
            ? `Opened ${action.roomCode}`
            : action.subTab
            ? `Opened ${action.target} (${action.subTab})`
            : `Navigated to ${action.target}`,
      });

      const matchedRoom = action.roomId
        ? ctx.rooms.find((r) => r.id === action.roomId)
        : undefined;

      return {
        ok: true,
        navigatedTo: action.target,
        subTab: action.subTab || null,
        historyFilters: action.historyFilters || null,
        roomCode: action.roomCode || null,
        roomName: matchedRoom?.name || null,
        spokenRoomName: matchedRoom ? buildSpokenRoomIdentity(matchedRoom) : null,
      };
    },
  });

  registerLegacy({
    id: 'execute_app_action',
    section: 'navigation',
    sectionLabel: 'Navigation & Workspace',
    supportedIntents: ['export CSV', 'print audit report', 'pause simulation', 'close modals', 'logout admin'],
    permissionLevel: 'public',
    requiresConfirmation: true,
    dataSources: ['ui_controller'],
  });

  registry.register({
    id: 'list_assistant_capabilities',
    section: 'overview',
    sectionLabel: 'Overview',
    description:
      'List all current ROOMWISE sections and voice assistant capabilities dynamically from the central Capability Registry.',
    supportedIntents: ['what can you do', 'help', 'list features', 'supported sections'],
    permissionLevel: 'public',
    dataSources: ['voice_capability_registry'],
    available: true,
    declaration: {
      name: 'list_assistant_capabilities',
      description:
        'Return an up-to-date summary of all 11 ROOMWISE sections and actions the voice assistant currently supports.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async (_args, ctx) => ({
      ok: true,
      role: ctx.adminIdentity ? `Admin (${ctx.adminIdentity.adminName})` : 'Student / Read-Only Mode',
      sectionsCount: ALL_ROOMWISE_SECTIONS.length,
      sections: ALL_ROOMWISE_SECTIONS.map((s) => s.label),
      totalCapabilities: registry.list({ availableOnly: true }).length,
      adminControlNote: ctx.adminIdentity
        ? 'Administrator controls are unlocked.'
        : 'Appliance controls, optimizations, and settings changes require Administrator login.',
    }),
  });

  registry.register({
    id: 'confirm_pending_action',
    section: 'navigation',
    sectionLabel: 'Navigation & Workspace',
    description: 'Confirm and execute the pending consequential action awaiting user approval.',
    supportedIntents: ['yes', 'confirm', 'go ahead', 'proceed'],
    permissionLevel: 'public',
    dataSources: ['session_memory'],
    available: true,
    declaration: {
      name: 'confirm_pending_action',
      description: 'Execute the currently pending action after the user explicitly confirms it.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async (_args, ctx) => {
      const pending = ctx.memory.pendingConfirmation;
      if (!pending || Date.now() > pending.expiresAt) {
        ctx.memory.pendingConfirmation = null;
        ctx.emitClientMessage({ type: 'confirmation_required', confirmation: null });
        return { ok: false, error: 'There is no active pending action waiting for confirmation.' };
      }
      ctx.memory.pendingConfirmation = null;
      ctx.emitClientMessage({ type: 'confirmation_required', confirmation: null });
      return registry.execute(pending.toolName, { ...pending.args, confirmed: true }, ctx);
    },
  });

  registry.register({
    id: 'cancel_pending_action',
    section: 'navigation',
    sectionLabel: 'Navigation & Workspace',
    description: 'Cancel the pending consequential action awaiting user approval.',
    supportedIntents: ['no', 'cancel', 'never mind', 'abort'],
    permissionLevel: 'public',
    dataSources: ['session_memory'],
    available: true,
    declaration: {
      name: 'cancel_pending_action',
      description: 'Cancel the currently pending action without executing it.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async (_args, ctx) => {
      const had = ctx.memory.pendingConfirmation;
      ctx.memory.pendingConfirmation = null;
      ctx.emitClientMessage({ type: 'confirmation_required', confirmation: null });
      return {
        ok: true,
        cancelled: Boolean(had),
        message: had
          ? `Cancelled pending action: ${had.summary}.`
          : 'No pending action was active.',
      };
    },
  });

  return registry;
}

/**
 * Builds the modernised, platform-accurate system instruction for Gemini Live
 * directly from the central Capability Registry and audited ROOMWISE assumptions.
 */
export function buildModernVoiceSystemInstruction(params: {
  snapshot: VoiceSnapshotPayload;
  adminIdentity: VoiceAdminIdentity | null;
  registry: VoiceCapabilityRegistry;
  memory: VoiceSessionMemory;
  summary: {
    totalCurrentPowerWatts: number;
    totalCurrentPowerKW: number;
    totalRatedPowerWatts: number;
    totalRatedPowerKW: number;
    ratedUtilizationPercent: number;
    totalBaselinePowerWatts: number;
    totalBaselinePowerKW: number;
    savingsPercent: number;
    occupiedCount: number;
  };
}): string {
  const { snapshot, adminIdentity, registry, memory, summary } = params;
  const authBanner = adminIdentity
    ? `AUTHORIZATION: AUTHENTICATED ADMINISTRATOR (${adminIdentity.adminName}, ${adminIdentity.role}). Admin tools are permitted when appropriate.`
    : `AUTHORIZATION: STUDENT / READ-ONLY MODE. Never execute appliance overrides, campus optimization, calibration, or settings updates; politely explain that Administrator sign-in is required.`;

  const currentRoom = snapshot.selectedRoomId
    ? snapshot.classrooms.find((r) => r.id === snapshot.selectedRoomId)
    : null;

  return `You are ROOMWISE Voice — the intelligent, context-aware voice interface for DAV Model School, IIT Kharagpur (25 classrooms across 5 blocks: G+3 Block, New Building, Old Building, Pre-Primary Block, Multipurpose Hall).

${authBanner}

CRITICAL PRONUNCIATION & SPEECH OUTPUT RULE (MANDATORY):
- Classroom codes visually retain Indian school Roman numerals (e.g. "Class X-B", "Class IX-A", "Class XII-A", "Class VI-A").
- When SPEAKING aloud, you MUST ALWAYS pronounce Roman numeral class grades as natural numbers:
  * "Class X-B" -> speak as "Class ten B" (NEVER say "Exbee", "Ex B", or "X-B"!)
  * "Class X-A" -> speak as "Class ten A"
  * "Class IX-A" -> speak as "Class nine A" (NEVER say "Eye-Ex"!)
  * "Class XI-A" -> speak as "Class eleven A"
  * "Class XII-A" -> speak as "Class twelve A"
  * "Class VI-A" / "VII-A" / "VIII-A" -> speak as "Class six A", "Class seven A", "Class eight A"
- Always prefer the "spokenName" / "spokenRoomName" fields returned by tools when speaking.
- Respond in concise, natural, clear English (typically 1–3 sentences unless the user asks for a breakdown). Do not read raw JSON, markdown symbols, or long tables aloud.

CURRENT WORKSPACE CONTEXT:
- Active Section: ${memory.activeTab || snapshot.activeTab}${memory.activeSubTab ? ` (Sub-tab: ${memory.activeSubTab})` : ''}
- Selected Room: ${currentRoom ? `${buildSpokenRoomIdentity(currentRoom)} [visual: ${currentRoom.name}, code ${currentRoom.roomCode}]` : 'None'}
- Live Campus Load: ${summary.totalCurrentPowerKW} kW (${summary.totalCurrentPowerWatts} W, ${summary.ratedUtilizationPercent}% of ${summary.totalRatedPowerKW} kW installed rated max)
- Active Motion Nodes: ${summary.occupiedCount} of ${snapshot.classrooms.length} rooms
- School Calendar Basis: ${SCHOOL_DAYS_PER_MONTH} school days/month, ${SCHOOL_DAYS_PER_YEAR} school days/year (Indian day school — NOT a 24x7 boarding school)
- Selective AC Inventory: Only ICT Lab, Senior Computer Lab, Physics Lab, Staff Room, and Multipurpose Hall have AC; standard classrooms use LED lights and BLDC ceiling fans only.

STRICT ENGINEERING HONESTY RULES:
1. NEVER invent numbers. Always call the appropriate registered capability tool before stating telemetry, solar generation, weather, ledger totals, or audit findings.
2. PIR sensors detect motion presence ONLY — never claim PIR counts exact student headcount. Attendance data comes from manual/CSV records in Space Intelligence.
3. Energy Intervention Ledger strictly separates Meter-Verified avoided kWh from Simulated/Estimated avoided kWh — never present simulated estimates as meter-verified savings.
4. Rooftop solar numbers come from PVGIS 5.3 over reconstructed aerial footprints — always frame them as planning estimates, not certified engineering drawings.
5. Sensor Telemetry Ingestion Architecture is documented future architecture — NEVER claim live physical ESP32/MQTT sensors are currently connected.
6. ROOMWISE aligns with ECBC/BEE guidance — NEVER claim official BEE certification.
7. If a tool returns confirmationRequired=true, briefly summarize the planned action and ask the user to confirm before calling confirm_pending_action.

REGISTERED ROOMWISE CAPABILITIES (ALL 11 SECTIONS):
${registry.buildCapabilityCatalogSummary()}

Use navigate_roomwise for any navigation request across all 11 sections (Overview, Digital Twin, Campus Live, Classrooms, Environmental & Solar Intelligence, Energy Analytics, Energy History + Energy Intervention Ledger, Space Intelligence, Energy Audit, Reports & BEE, Settings) or "go back".`;
}

export interface InterpretedVoiceCommandResult {
  ok: boolean;
  intent: string;
  toolName: string | null;
  spokenReply: string;
  visualReply: string;
  data: Record<string, unknown> | null;
  emittedMessages: VoiceServerMessage[];
  confirmationRequired?: boolean;
  permissionDenied?: boolean;
}

/**
 * Deterministic multi-turn command router & executor over the central VoiceCapabilityRegistry.
 * Used for:
 *  - Reliable fallback text/voice command execution via POST /api/voice/command
 *  - Automated end-to-end verification across all 11 sections, context follow-ups,
 *    Roman numeral pronunciation, permissions, and confirmation policies.
 */
export async function interpretAndExecuteVoiceCommand(
  utterance: string,
  registry: VoiceCapabilityRegistry,
  ctx: VoiceCapabilityExecutionContext
): Promise<InterpretedVoiceCommandResult> {
  const emitted: VoiceServerMessage[] = [];
  const wrappedCtx: VoiceCapabilityExecutionContext = {
    ...ctx,
    emitClientMessage: (msg) => {
      emitted.push(msg);
      ctx.emitClientMessage(msg);
    },
  };

  const raw = utterance.trim();
  if (!raw) {
    return {
      ok: false,
      intent: 'empty',
      toolName: null,
      spokenReply: 'I did not catch a command. Please tell me what you would like to open or check in ROOMWISE.',
      visualReply: 'No command received.',
      data: null,
      emittedMessages: emitted,
    };
  }

  const lower = raw.toLowerCase();

  // 0. Pending confirmation resolution ("yes", "confirm", "cancel", "no")
  if (wrappedCtx.memory.pendingConfirmation) {
    if (/^(yes|yeah|yep|confirm|go ahead|proceed|do it|ok|okay|approve)\b/.test(lower)) {
      const data = await registry.execute('confirm_pending_action', {}, wrappedCtx);
      const ok = data.ok !== false;
      const reply = ok
        ? `Confirmed and completed: ${String(data.summary || 'Action executed successfully.')}`
        : String(data.error || 'Could not complete the confirmed action.');
      return {
        ok,
        intent: 'confirm_pending_action',
        toolName: 'confirm_pending_action',
        spokenReply: formatRoomNameForSpeech(reply),
        visualReply: reply,
        data,
        emittedMessages: emitted,
      };
    }
    if (/^(no|nope|cancel|stop|abort|never\s*mind)\b/.test(lower)) {
      const data = await registry.execute('cancel_pending_action', {}, wrappedCtx);
      const reply = String(data.message || 'Cancelled.');
      return {
        ok: true,
        intent: 'cancel_pending_action',
        toolName: 'cancel_pending_action',
        spokenReply: reply,
        visualReply: reply,
        data,
        emittedMessages: emitted,
      };
    }
  }

  // Helper to run tool and produce structured response
  const run = async (
    toolName: string,
    args: Record<string, unknown>,
    formatReply: (res: Record<string, unknown>) => string
  ): Promise<InterpretedVoiceCommandResult> => {
    const data = await registry.execute(toolName, args, wrappedCtx);
    const confirmationRequired = Boolean(data.confirmationRequired);
    const permissionDenied = data.authorized === false;
    let visual: string;
    if (permissionDenied) {
      visual = String(data.error || 'Administrator sign-in is required for this action.');
    } else if (confirmationRequired) {
      visual = String(
        data.message || `Please confirm: ${String(data.summary || toolName)}`
      );
    } else if (data.ok === false && data.error) {
      visual = String(data.error);
    } else {
      visual = formatReply(data);
    }
    return {
      ok: data.ok !== false,
      intent: toolName,
      toolName,
      spokenReply: formatRoomNameForSpeech(visual),
      visualReply: visual,
      data,
      emittedMessages: emitted,
      confirmationRequired,
      permissionDenied,
    };
  };

  // 1. Go back
  if (/\b(go back|previous page|previous section|back to previous)\b/.test(lower)) {
    return run('navigate_roomwise', { target: 'go-back' }, (d) =>
      `Returned to ${String(d.navigatedTo || 'previous view')}.`
    );
  }

  // 2. Capabilities / Help
  if (/\b(what can you do|list capabilities|help me|what sections)\b/.test(lower)) {
    return run('list_assistant_capabilities', {}, (d) =>
      `ROOMWISE Voice covers all ${String(d.sectionsCount || 11)} sections including Overview, Digital Twin, Campus Live, Classrooms, Environmental & Solar Intelligence, Energy Analytics, Energy History and Intervention Ledger, Space Intelligence, Energy Audit, Reports & BEE, and Settings.`
    );
  }

  // 3. Planned Sensor Telemetry Architecture (honesty check)
  if (
    /\b(sensor telemetry|telemetry architecture|telemetry ingestion|real sensors|esp32|mqtt|hardware connected)\b/.test(
      lower
    )
  ) {
    return run('get_planned_telemetry_architecture', {}, (d) => String(d.summary));
  }

  // 4. Energy Intervention Ledger — query, filter, or navigate
  if (/\b(intervention|ledger)\b/.test(lower)) {
    const verificationStatus = /\b(meter[\s-]*verified|verified only)\b/.test(lower)
      ? 'meter_verified'
      : /\b(simulated|estimated)\b/.test(lower)
      ? 'estimated'
      : 'all';
    const period = /\b(today)\b/.test(lower)
      ? 'today'
      : /\b(yesterday)\b/.test(lower)
      ? 'yesterday'
      : /\b(this week|last 7 days|past week)\b/.test(lower)
      ? 'last_7_days'
      : /\b(this month)\b/.test(lower)
      ? 'this_month'
      : /\b(last 30 days)\b/.test(lower)
      ? 'last_30_days'
      : 'all';

    if (/\b(detail|explain|formula|assumption|how was|calculation|overlap)\b/.test(lower)) {
      return run('get_intervention_detail', {}, (d) => {
        const iv = d.intervention as Record<string, unknown> | undefined;
        if (!iv) return 'No intervention details available.';
        return `Intervention in ${String(iv.roomName)} avoided an estimated ${String(
          iv.effectiveAvoidedKWh
        )} kWh (${String(iv.verificationStatus)}). Overlap adjusted: ${
          iv.overlapAdjusted ? 'yes' : 'no'
        }.`;
      });
    }

    if (/\b(open|go to|navigate|switch to|filter|show only)\b/.test(lower)) {
      await registry.execute(
        'navigate_roomwise',
        {
          target: 'history',
          subTab: 'interventions',
          preset: period !== 'all' ? period : undefined,
          verificationStatus,
        },
        wrappedCtx
      );
    }

    return run(
      'get_intervention_ledger',
      { period, verificationStatus },
      (d) => {
        const sum = (d.summary || {}) as Record<string, unknown>;
        return `Energy Intervention Ledger (${String(d.totalMatchingInterventions || 0)} entries): Meter-verified avoided energy is ${String(
          sum.meterVerifiedAvoidedKWh ?? 0
        )} kWh, and simulated estimated avoided energy is ${String(
          sum.simulatedEstimatedAvoidedKWh ?? 0
        )} kWh.`;
      }
    );
  }

  // Contextual follow-up filter while inside Energy History / Interventions
  if (
    wrappedCtx.memory.activeTab === 'history' &&
    /\b(only from this week|this week only|meter[\s-]*verified only|only verified|only estimated|only simulated)\b/.test(
      lower
    )
  ) {
    const verificationStatus = /\b(verified)\b/.test(lower)
      ? 'meter_verified'
      : /\b(estimated|simulated)\b/.test(lower)
      ? 'estimated'
      : 'all';
    const period = /\b(this week|7 days)\b/.test(lower) ? 'last_7_days' : 'all';
    await registry.execute(
      'navigate_roomwise',
      {
        target: 'history',
        subTab: wrappedCtx.memory.activeSubTab || 'interventions',
        preset: period !== 'all' ? period : undefined,
        verificationStatus,
      },
      wrappedCtx
    );
    return run('get_intervention_ledger', { period, verificationStatus }, (d) => {
      const sum = (d.summary || {}) as Record<string, unknown>;
      return `Filtered Energy Intervention Ledger: ${String(
        d.totalMatchingInterventions || 0
      )} entries found (${String(sum.meterVerifiedAvoidedKWh ?? 0)} kWh meter-verified, ${String(
        sum.simulatedEstimatedAvoidedKWh ?? 0
      )} kWh simulated estimated).`;
    });
  }

  // 5. Environmental & Solar Intelligence
  if (
    /\b(solar|pvgis|rooftop|photovoltaic|panel|generation estimate|solar potential|solar scenario)\b/.test(
      lower
    )
  ) {
    if (/\b(open|go to|navigate|switch to|show me)\b/.test(lower) && !/\b(estimate|how much|what is|generation|yield|capacity|summary|assessment)\b/.test(lower)) {
      const subTab: VoiceEnvironmentalSolarSubTab = /\b(map|footprint)\b/.test(lower)
        ? 'mapping'
        : /\b(compar|demand)\b/.test(lower)
        ? 'comparison'
        : /\b(assumption|method)\b/.test(lower)
        ? 'assumptions'
        : 'solar-potential';
      return run(
        'navigate_roomwise',
        { target: 'environmental-solar', subTab },
        () => `Opened Environmental & Solar Intelligence (${subTab}).`
      );
    }
    const scenario = /\b(conservative)\b/.test(lower)
      ? 'conservative'
      : /\b(high)\b/.test(lower)
      ? 'high_theoretical'
      : 'moderate';
    return run('get_solar_assessment', { scenario }, (d) => {
      const sum = (d.campusSolarSummary || {}) as Record<string, unknown>;
      return `PVGIS planning estimate for DAV Model School rooftops: ${String(
        sum.combinedCapacityKwp ?? 0
      )} kWp across ${String(sum.selectedBuildingsCount ?? 5)} buildings, generating approximately ${String(
        sum.annualGenerationKWh ?? 'unavailable'
      )} kWh per year (planning estimate).`;
    });
  }

  if (/\b(weather|aqi|air quality|outdoor temp|irradiance|environmental)\b/.test(lower)) {
    if (/\b(open|go to|navigate|switch to)\b/.test(lower) && !/\b(what|how|current|aqi|temp|weather)\b/.test(lower)) {
      return run(
        'navigate_roomwise',
        { target: 'environmental-solar', subTab: 'environmental' },
        () => 'Opened Environmental & Solar Intelligence.'
      );
    }
    return run('get_environmental_intelligence', { focus: 'all' }, (d) => {
      const cur = (d.currentWeather || {}) as Record<string, unknown>;
      const aqi = (d.airQuality || {}) as Record<string, unknown>;
      return `Outdoor conditions at IIT Kharagpur: ${String(
        cur.temperatureC ?? 'N/A'
      )}°C, humidity ${String(cur.relativeHumidityPercent ?? 'N/A')}%, PM2.5 ${String(
        aqi.pm25UgM3 ?? 'N/A'
      )} µg/m³.`;
    });
  }

  // 6. Campus Live (3D)
  if (/\b(campus live|3d campus|live campus|3d replica)\b/.test(lower)) {
    if (/\b(open|go to|navigate|switch to|show)\b/.test(lower) && !/\b(what|describe|blocks|layout|weather)\b/.test(lower)) {
      return run('navigate_roomwise', { target: 'campus-live' }, () => 'Opened 3D Campus Live.');
    }
    return run('get_campus_live_info', {}, (d) => {
      const sky = (d.weatherSync || {}) as Record<string, unknown>;
      return `Campus Live renders the 3D replica of DAV Model School with G+3 Block, New Building, Old Building (with connecting path), Pre-Primary Block, and Multipurpose Hall, synced to ${String(
        sky.condition || 'live weather'
      )}.`;
    });
  }

  // 7. Space Intelligence
  if (/\b(space intelligence|space allocation|room allocation|reallocation|attendance)\b/.test(lower)) {
    if (/\b(open|go to|navigate|switch to)\b/.test(lower) && !/\b(summary|recommend|proposal|history|status|how)\b/.test(lower)) {
      return run(
        'navigate_roomwise',
        { target: 'space-intelligence' },
        () => 'Opened Space Intelligence.'
      );
    }
    if (/\b(recommend|proposal|suggestion)\b/.test(lower)) {
      return run('get_space_allocation_recommendations', {}, (d) =>
        `Space Intelligence has ${String(
          (Array.isArray(d.proposals) ? d.proposals.length : d.count) ?? 0
        )} room allocation recommendations available.`
      );
    }
    if (/\b(history|past|approved)\b/.test(lower)) {
      return run('get_space_allocation_history', {}, () => 'Retrieved Space Intelligence allocation history.');
    }
    return run('get_space_intelligence_summary', {}, (d) =>
      `Space Intelligence summary retrieved across ${String(
        d.totalRooms ?? ctx.rooms.length
      )} campus classrooms.`
    );
  }

  // 8. Admin Appliance Control / Batch Control / Campus Optimization / Settings Update
  if (/\b(optimize campus|remediate all|fix all audit)\b/.test(lower)) {
    return run('optimize_campus_energy', { scope: 'all' }, (d) =>
      String(d.summary || 'Campus energy optimization completed.')
    );
  }

  if (/\b(turn off|switch off|dim|set)\b/.test(lower) && /\b(all lights|all fans|building|campus|vacant)\b/.test(lower)) {
    const scope = /\bvacant\b/.test(lower)
      ? 'vacant_only'
      : /\b(g\+3|new building|old building|pre-primary|multipurpose)\b/.test(lower)
      ? 'building'
      : 'campus';
    const targetType = /\bfan/.test(lower) ? 'fan' : /\ball appliances\b/.test(lower) ? 'all' : 'lights';
    const pctMatch = lower.match(/(\d+)\s*%/);
    const outputPercent = /\boff\b/.test(lower) ? 0 : pctMatch ? Number(pctMatch[1]) : 50;
    return run(
      'control_building_or_campus_appliances',
      { scope, targetType, mode: 'set', outputPercent },
      (d) => String(d.summary || 'Batch appliance command executed.')
    );
  }

  if (/\b(turn off|switch off|turn on|dim|set|restore auto)\b/.test(lower) && /\b(lights?|fans?|ac|air\s*condition(?:er|ing)?|projectors?|auto)\b/.test(lower)) {
    const roomRes = resolveClassroomRobust(ctx.rooms, raw, wrappedCtx.memory);
    const targetType = /\brestore auto\b|\bauto mode\b/.test(lower)
      ? 'room_auto'
      : /\bfan/.test(lower)
      ? 'fans_group'
      : /\bac\b/.test(lower)
      ? 'ac_group'
      : 'lights_group';
    const mode = /\brestore auto\b|\bauto mode\b/.test(lower) ? 'restore_auto' : 'set';
    const pctMatch = lower.match(/(\d+)\s*%/);
    const outputPercent = /\boff\b/.test(lower) ? 0 : /\bon\b/.test(lower) ? 100 : pctMatch ? Number(pctMatch[1]) : 50;
    return run(
      'control_classroom_appliance',
      {
        roomQuery: roomRes.match?.roomCode || raw,
        targetType,
        mode,
        outputPercent,
      },
      (d) => String(d.summary || 'Classroom appliance updated.')
    );
  }

  // 9. Export CSV / Print Audit Report (confirmation-gated)
  if (/\b(export csv|download csv|export analytics)\b/.test(lower)) {
    return run('execute_app_action', { action: 'export_analytics_csv' }, (d) =>
      String(d.summary || 'Exported CSV.')
    );
  }
  if (/\b(print audit|print report)\b/.test(lower)) {
    return run('execute_app_action', { action: 'print_audit_report' }, (d) =>
      String(d.summary || 'Opened print audit report.')
    );
  }

  // 10. Reports & BEE / Settings / Energy Audit / Energy History / Analytics / Digital Twin / Overview
  if (/\b(report|bee|ecbc)\b/.test(lower)) {
    if (/\b(open|go to|navigate|switch to)\b/.test(lower)) {
      return run('navigate_roomwise', { target: 'reports' }, () => 'Opened Reports & BEE.');
    }
    return run('get_reports_and_bee_info', {}, (d) => String(d.certificationDisclosure));
  }

  if (/\b(setting|tariff|carbon factor|school hours|pir grace)\b/.test(lower)) {
    if (/\b(change|update|set)\b/.test(lower) && /\btariff\b/.test(lower)) {
      const m = lower.match(/(\d+(?:\.\d+)?)/);
      return run(
        'update_campus_settings',
        { tariffPerKWhINR: m ? Number(m[1]) : 8.5 },
        (d) => String(d.summary || 'Updated settings.')
      );
    }
    if (/\b(open|go to|navigate|switch to)\b/.test(lower)) {
      return run('navigate_roomwise', { target: 'settings' }, () => 'Opened Settings.');
    }
    return run('get_campus_settings', {}, (d) =>
      `Campus tariff is ₹${String(d.tariffPerKWhINR)}/kWh, classroom target is ${String(
        d.standardClassroomTargetLux
      )} lux, and learning mode is ${String(d.learningMode)}.`
    );
  }

  if (/\b(energy audit|audit finding|audit summary|waste alert|vacant room)\b/.test(lower)) {
    if (/\b(open|go to|navigate|switch to)\b/.test(lower) && !/\b(summary|check|what|list|how many)\b/.test(lower)) {
      return run('navigate_roomwise', { target: 'audit' }, () => 'Opened Energy Audit.');
    }
    if (/\bvacant\b/.test(lower)) {
      return run('identify_vacant_classroom_consumption', {}, (d) =>
        `${String(d.noMotionRoomsDrawingPowerCount ?? 0)} rooms with no recent PIR motion are currently drawing power.`
      );
    }
    return run('generate_energy_audit_summary', {}, (d) =>
      `Energy Audit reports ${String(d.openFindingsCount ?? 0)} open findings totaling ${String(
        d.openWasteWatts ?? 0
      )} watts of potential waste.`
    );
  }

  if (/\b(energy history|historical|yesterday|last 7 days|this month|time of day|peak hour)\b/.test(lower)) {
    if (/\b(open|go to|navigate|switch to)\b/.test(lower) && !/\b(how much|what|compare|peak|why)\b/.test(lower)) {
      return run('navigate_roomwise', { target: 'history', subTab: 'consumption' }, () =>
        'Opened Energy History.'
      );
    }
    const period = /\byesterday\b/.test(lower)
      ? 'yesterday'
      : /\bthis month\b/.test(lower)
      ? 'this_month'
      : 'last_7_days';
    return run('get_energy_consumption_history', { period }, (d) =>
      `Historical consumption for ${period}: ${String(
        (d.totals as Record<string, unknown> | undefined)?.actualKWh ?? d.totalActualKWh ?? 'calculated'
      )} kWh.`
    );
  }

  if (/\b(analytics|compare buildings|building comparison|savings estimate|highest consumer|top consumer)\b/.test(lower)) {
    if (/\b(open|go to|navigate|switch to)\b/.test(lower) && !/\b(compare|top|highest|savings)\b/.test(lower)) {
      return run('navigate_roomwise', { target: 'analytics' }, () => 'Opened Energy Analytics.');
    }
    if (/\b(compare building|building comparison)\b/.test(lower)) {
      return run('compare_buildings', {}, () => 'Compared building energy consumption across all 5 campus blocks.');
    }
    if (/\b(top|highest)\b/.test(lower)) {
      return run('rank_and_filter_classrooms', { sortBy: 'power_desc', limit: 3 }, () =>
        'Ranked the highest power-consuming classrooms across the campus.'
      );
    }
    return run('get_energy_savings_estimate', {}, (d) =>
      `Estimated campus energy savings: ${String(d.savingsPercent ?? 0)}% relative to pre-retrofit reference.`
    );
  }

  if (/\b(digital twin|floor map)\b/.test(lower)) {
    return run('navigate_roomwise', { target: 'digital-twin' }, () => 'Opened Digital Twin.');
  }

  if (/\b(overview|dashboard|home)\b/.test(lower) && /\b(open|go to|navigate|switch to|show)\b/.test(lower)) {
    return run('navigate_roomwise', { target: 'dashboard' }, () => 'Opened Overview dashboard.');
  }

  if (/\b(all classrooms|classrooms list|open classrooms|go to classrooms)\b/.test(lower)) {
    return run('navigate_roomwise', { target: 'classrooms' }, () => 'Opened Classrooms.');
  }

  // 11. Classroom-specific navigation or telemetry/status (supports Roman numerals + spoken + pronouns!)
  const hasPronounRoom = /\b(its|that room|this room|current room)\b/.test(lower);
  const resolvedRoom = resolveClassroomRobust(ctx.rooms, hasPronounRoom ? 'that room' : raw, wrappedCtx.memory);
  if (resolvedRoom.match) {
    const room = resolvedRoom.match;
    if (/\b(open|go to|show|navigate|inspect)\b/.test(lower) && !/\b(temp|temperature|humidity|co2|lux|power|watt|status|history)\b/.test(lower)) {
      return run(
        'navigate_roomwise',
        { target: 'classroom', roomQuery: room.roomCode },
        () => `Opened ${room.name} (${room.roomCode}).`
      );
    }
    if (/\b(history|past|week|month|yesterday)\b/.test(lower)) {
      return run(
        'get_classroom_energy_history',
        { roomQuery: room.roomCode, period: 'last_7_days' },
        () => `Retrieved 7-day energy history for ${room.name} (${room.roomCode}).`
      );
    }
    if (/\b(temp|temperature|humidity|co2|lux|daylight|sensor|telemetry)\b/.test(lower)) {
      return run('get_classroom_telemetry', { roomQuery: room.roomCode }, (d) => {
        const env = (d.environment || {}) as Record<string, unknown>;
        return `${room.name} (${room.roomCode}) telemetry: ${String(
          env.temperature ?? room.environment.temperature
        )}°C, ${String(env.humidity ?? room.environment.humidity)}% humidity, ${String(
          env.co2Ppm ?? room.environment.co2Ppm
        )} ppm CO2, daylight ${String(
          env.naturalDaylightLux ?? room.environment.naturalDaylightLux
        )} lux.`;
      });
    }
    return run('get_classroom_status', { roomQuery: room.roomCode }, (d) => {
      const activity = getRoomActivityState(room);
      return `${room.name} (${room.roomCode}) is drawing ${String(
        d.currentPowerWatts ?? room.currentPowerWatts
      )} watts (${activity}).`;
    });
  }

  // 12. General campus overview fallback
  if (/\b(campus|load|power|energy|summary|status|how much)\b/.test(lower)) {
    return run('get_campus_overview', {}, (d) =>
      `Campus load is ${String(d.totalCurrentPowerKW ?? formatCapacityKW(0))} kW across ${String(
        d.totalClassrooms ?? ctx.rooms.length
      )} classrooms, with ${String(d.occupiedClassrooms ?? 0)} active motion nodes.`
    );
  }

  return {
    ok: false,
    intent: 'unmatched',
    toolName: null,
    spokenReply:
      'I can navigate any ROOMWISE section, check classroom telemetry, review Environmental and Solar Intelligence, inspect the Energy Intervention Ledger, or run energy audits. What would you like to check?',
    visualReply:
      'Unrecognized command. Try asking about a classroom (e.g. Class X-B), Environmental & Solar Intelligence, Space Intelligence, Campus Live, or the Energy Intervention Ledger.',
    data: null,
    emittedMessages: emitted,
  };
}
