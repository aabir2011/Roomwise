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
  formatIstFullLabel,
  getIstDateString,
  getIstHourAndMinute,
  shiftIstDate,
} from '../src/utils/historyDates.ts';
import {
  buildSpokenRoomIdentity,
  formatRoomNameForSpeech,
  normalizeClassroomQuery,
} from '../src/utils/voicePronunciation.ts';
import {
  CANONICAL_INSTITUTION_NAME,
  normalizeRawUtterance,
} from '../src/utils/voiceTerminology.ts';
import { environmentalService } from './environmentalService.ts';
import { solarService } from './solarService.ts';
import { interventionLedgerService } from './interventionLedgerService.ts';
import { energyHistoryService, resolveNaturalDateQuery } from './energyHistoryService.ts';
import { spaceIntelligenceService } from './spaceIntelligenceService.ts';
import {
  ROOMWISE_MATHEMATICAL_MODELS,
  formatProgressiveKnowledgeReply,
  getCampusArchitectureAndFootprintsSummary,
  type ExplanationDepth,
  type RoomwiseModelTopic,
} from './voiceKnowledgeBase.ts';
import {
  interpretAndExecuteSemanticVoiceCommand,
  runHydrogenDeepReasoning,
  type GeminiOrchestrationOptions,
} from './voiceSemanticNlu.ts';
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
  lastMentionedBuilding: string | null;
  lastMentionedInterventionId: string | null;
  lastAnalyticalSubject: string | null;
  lastTopic: string | null;
  lastMetric: string | null;
  lastPeriod: string;
  previousPeriod: string | null;
  lastResolvedStartDate: string | null;
  lastResolvedEndDate: string | null;
  lastRetrievedActualKWh: number | null;
  lastRetrievedComparableKWh: number | null;
  lastToolName: string | null;
  lastIntentType: string | null;
  lastAssistantReply: string | null;
  recentTurns: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>;
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
    lastMentionedBuilding: null,
    lastMentionedInterventionId: null,
    lastAnalyticalSubject: null,
    lastTopic: null,
    lastMetric: null,
    lastPeriod: 'last_7_days',
    previousPeriod: null,
    lastResolvedStartDate: null,
    lastResolvedEndDate: null,
    lastRetrievedActualKWh: null,
    lastRetrievedComparableKWh: null,
    lastToolName: null,
    lastIntentType: null,
    lastAssistantReply: null,
    recentTurns: [],
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
  abortSignal?: AbortSignal;
  deepReasoningOverride?: GeminiOrchestrationOptions['generateContentOverride'];
}

export interface VoiceCapabilityDefinition {
  id: string;
  section: VoiceCapabilitySectionId;
  sectionLabel: string;
  description: string;
  supportedIntents: string[];
  requiredContext?: string[];
  permissionLevel: VoicePermissionLevel;
  requiresConfirmation?: boolean | ((args: Record<string, unknown>) => boolean);
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

  const qNorm = normalizeClassroomQuery(normalizeRawUtterance(trimmed));
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

  // 2. Exact room code embedded inside natural language (e.g. "how is g3 g02 doing?")
  for (const room of rooms) {
    const codeNorm = normalizeClassroomQuery(room.roomCode);
    const codeCompact = codeNorm.replace(/\s+/g, '');
    if (
      codeNorm.length >= 4 &&
      (qNorm.includes(codeNorm) || qCompact.includes(codeCompact))
    ) {
      return { match: room };
    }
  }

  // 2b. Exact class grade + section token match (e.g. "10 b" inside "catch me up on X-B's energy consumption")
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

  // 2c. Named special room embedded in a full sentence (e.g. "tell me about the ICT Lab" / "Physics Lab")
  const embeddedNamedMatches = rooms.filter((r) => {
    const nameNorm = normalizeClassroomQuery(r.name);
    return nameNorm.length >= 5 && !/^class\s+\d/.test(nameNorm) && qNorm.includes(nameNorm);
  });
  if (embeddedNamedMatches.length === 1) return { match: embeddedNamedMatches[0] };
  if (embeddedNamedMatches.length > 1) {
    // Prefer longest most-specific room name (e.g., "senior computer lab" over "computer lab")
    const sorted = [...embeddedNamedMatches].sort((a, b) => b.name.length - a.name.length);
    if (sorted[0].name.length > sorted[1].name.length) return { match: sorted[0] };
    return { ambiguous: sorted.slice(0, 5) };
  }

  // 2d. Grade without section (e.g. "Class X" / "Class 10") -> return ambiguous matches so assistant clarifies cleanly!
  const gradeOnlyMatch = qNorm.match(/\b(?:class|room|grade|standard)\s+(1[0-2]|[1-9])\b(?!\s+[a-f]\b)/);
  if (gradeOnlyMatch) {
    const gradeNum = gradeOnlyMatch[1];
    const gradeMatches = rooms.filter((r) =>
      new RegExp(`\\bclass\\s+${gradeNum}\\s+[a-f]\\b`).test(normalizeClassroomQuery(r.name))
    );
    if (gradeMatches.length === 1) return { match: gradeMatches[0] };
    if (gradeMatches.length > 1) return { ambiguous: gradeMatches };
  }

  // 3. Token/substring fuzzy match (word-boundary guarded so short greetings like "hi", "ok", "thanks" NEVER match substrings like "suns-hi-ne"!)
  const CONVERSATIONAL_NON_ROOMS = new Set([
    'hi',
    'hey',
    'hello',
    'ok',
    'okay',
    'yes',
    'no',
    'why',
    'thanks',
    'thank you',
    'bye',
    'goodbye',
    'help',
    'cool',
    'great',
    'nice',
    'sure',
    'good morning',
    'good afternoon',
    'good evening',
  ]);
  if (CONVERSATIONAL_NON_ROOMS.has(qNorm) || qNorm.length < 3) {
    return {};
  }

  const escapedQ = qNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordBoundaryRe = new RegExp(`(?:^|\\s)${escapedQ}(?:$|\\s)`);
  const partialMatches = rooms.filter((r) => {
    const hay = `${normalizeClassroomQuery(r.roomCode)} ${normalizeClassroomQuery(r.name)} ${normalizeClassroomQuery(r.building)}`;
    return wordBoundaryRe.test(hay);
  });

  if (partialMatches.length === 1) return { match: partialMatches[0] };
  if (partialMatches.length > 1) {
    // Prefer exact name containment over building containment
    const nameOnly = partialMatches.filter((r) =>
      wordBoundaryRe.test(normalizeClassroomQuery(r.name))
    );
    if (nameOnly.length === 1) return { match: nameOnly[0] };
    return { ambiguous: partialMatches.slice(0, 5) };
  }

  // 4. Multi-token score matching (only when every meaningful token matches a distinct room token)
  const qTokens = qNorm
    .split(' ')
    .filter(
      (t) =>
        t.length >= 2 &&
        ![
          'room',
          'classroom',
          'the',
          'in',
          'of',
          'for',
          'open',
          'show',
          'what',
          'how',
          'is',
          'are',
          'was',
          'were',
          'did',
          'does',
          'about',
          'tell',
          'me',
        ].includes(t)
    );
  if (qTokens.length >= 2 && qTokens.length <= 4) {
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
  private cachedDeclarations: FunctionDeclaration[] | null = null;
  private cachedReadOnlyDeclarations: FunctionDeclaration[] | null = null;
  private cachedCatalogSummary: string | null = null;

  public register(definition: VoiceCapabilityDefinition): void {
    this.capabilities.set(definition.id, definition);
    this.cachedDeclarations = null;
    this.cachedReadOnlyDeclarations = null;
    this.cachedCatalogSummary = null;
  }

  public unregister(id: string): boolean {
    const removed = this.capabilities.delete(id);
    if (removed) {
      this.cachedDeclarations = null;
      this.cachedReadOnlyDeclarations = null;
      this.cachedCatalogSummary = null;
    }
    return removed;
  }

  /**
   * Returns true when a capability is read-only / UI-directive public and has no
   * confirmation or side-effecting serialization requirements, allowing safe
   * Promise.all parallel execution when Gemini requests multiple tools in one turn.
   */
  public isParallelSafe(id: string): boolean {
    const def = this.capabilities.get(id);
    if (!def || !def.available) return false;
    if (def.permissionLevel !== 'public') return false;
    if (def.requiresConfirmation) return false;
    if (
      id === 'confirm_pending_action' ||
      id === 'cancel_pending_action' ||
      id === 'consult_deep_reasoning'
    ) {
      return false;
    }
    return true;
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

  private normalizeDeclarationSchema(decl: FunctionDeclaration): FunctionDeclaration {
    // Gemini rejects empty Type.OBJECT parameters (`properties: {}`) with a 400 error.
    // Omit `parameters` cleanly for zero-argument tools.
    const params = decl.parameters as
      | { type?: unknown; properties?: Record<string, unknown> }
      | undefined;
    if (
      params &&
      params.type === Type.OBJECT &&
      (!params.properties || Object.keys(params.properties).length === 0)
    ) {
      const { parameters: _omitted, ...withoutEmptyParams } = decl;
      return withoutEmptyParams;
    }
    return decl;
  }

  public getFunctionDeclarations(): FunctionDeclaration[] {
    if (this.cachedDeclarations) {
      return this.cachedDeclarations;
    }
    const declarations: FunctionDeclaration[] = [];
    for (const def of this.capabilities.values()) {
      if (!def.available) continue;
      declarations.push(this.normalizeDeclarationSchema(def.declaration));
    }
    this.cachedDeclarations = declarations;
    return declarations;
  }

  /**
   * Returns strictly read-only, non-mutating analytical declarations suitable for
   * deep analytical synthesis without side effects, navigation triggers, or recursion.
   */
  public getReadOnlyAnalyticalDeclarations(): FunctionDeclaration[] {
    if (this.cachedReadOnlyDeclarations) {
      return this.cachedReadOnlyDeclarations;
    }
    const EXCLUDED_READ_ONLY_IDS = new Set([
      'navigate_roomwise',
      'execute_app_action',
      'confirm_pending_action',
      'cancel_pending_action',
      'consult_deep_reasoning',
    ]);
    const declarations: FunctionDeclaration[] = [];
    for (const def of this.capabilities.values()) {
      if (!def.available) continue;
      if (def.permissionLevel !== 'public') continue;
      if (def.requiresConfirmation) continue;
      if (EXCLUDED_READ_ONLY_IDS.has(def.id)) continue;
      declarations.push(this.normalizeDeclarationSchema(def.declaration));
    }
    this.cachedReadOnlyDeclarations = declarations;
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
    if (this.cachedCatalogSummary !== null) {
      return this.cachedCatalogSummary;
    }
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
    this.cachedCatalogSummary = lines.join('\n');
    return this.cachedCatalogSummary;
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
    const requiresConfirm =
      typeof def.requiresConfirmation === 'function'
        ? def.requiresConfirmation(rawArgs)
        : Boolean(def.requiresConfirmation);
    const needsConfirm = requiresConfirm && rawArgs.confirmed !== true;
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

    try {
      const result = await def.handler(rawArgs, ctx);
      ctx.memory.lastToolName = id;
      // Track mentioned room & building in session memory when present
      if (typeof result.roomCode === 'string') {
        const matched = ctx.rooms.find(
          (r) => r.roomCode.toLowerCase() === String(result.roomCode).toLowerCase()
        );
        if (matched) {
          ctx.memory.lastMentionedRoomId = matched.id;
          ctx.memory.lastMentionedRoomCode = matched.roomCode;
          ctx.memory.lastMentionedBuilding = matched.building;
        }
      }
      if (typeof result.roomId === 'string') {
        const matched = ctx.rooms.find((r) => r.id === result.roomId);
        if (matched) {
          ctx.memory.lastMentionedRoomId = matched.id;
          ctx.memory.lastMentionedRoomCode = matched.roomCode;
          ctx.memory.lastMentionedBuilding = matched.building;
        }
      }
      if (typeof result.building === 'string' && result.building.trim()) {
        ctx.memory.lastMentionedBuilding = result.building.trim();
      }
      return enrichResultWithSpokenNames(result) as Record<string, unknown>;
    } catch (err) {
      ctx.memory.lastToolName = id;
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
    requiresConfirmation?: boolean | ((args: Record<string, unknown>) => boolean);
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

  registry.register({
    id: 'get_classroom_comprehensive_brief',
    section: 'classrooms',
    sectionLabel: 'Classrooms & Digital Twin',
    description:
      'Retrieve a complete analytical briefing for a single classroom in one call: live power draw, rated utilization, PIR motion activity, live environmental telemetry (temperature, humidity, CO2, daylight lux, learned alpha/beta), historical energy consumption vs comparable baseline, anomalies, and recent interventions. Does NOT navigate.',
    supportedIntents: [
      'catch me up on classroom energy consumption',
      'how is class performing',
      'classroom energy update',
      'explain classroom usage',
    ],
    permissionLevel: 'public',
    dataSources: ['live_room_snapshot', 'energy_history_service', 'intervention_ledger_service'],
    available: true,
    declaration: {
      name: 'get_classroom_comprehensive_brief',
      description:
        'Fetch an analytical multi-source briefing for a classroom (live power draw, sensors, historical kWh vs comparable baseline, recent interventions, and anomalies) WITHOUT navigating. Use this when the user asks to be caught up on or explained a classroom’s energy consumption or performance.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          roomQuery: {
            type: Type.STRING,
            description: 'Classroom name or code (e.g. "Class X-B", "G3-G02", "ICT Lab"), or omit to use context room.',
          },
          period: {
            type: Type.STRING,
            description: 'Optional historical comparison window: "today", "yesterday", "last_7_days", "last_30_days", "this_month", "previous_month". Defaults to "last_7_days".',
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const rq = typeof args.roomQuery === 'string' ? args.roomQuery : '';
      const resolved = resolveClassroomRobust(ctx.rooms, rq, ctx.memory);
      if (!resolved.match) {
        return {
          ok: false,
          ambiguous: Boolean(resolved.ambiguous),
          matches: resolved.ambiguous?.map((r) => ({
            roomCode: r.roomCode,
            name: r.name,
            spokenName: buildSpokenRoomIdentity(r),
          })),
          error: resolved.ambiguous
            ? `Multiple classrooms matched "${rq}". Ask the user to clarify which room.`
            : `No classroom found for "${rq}".`,
        };
      }

      const room = resolved.match;
      const period =
        typeof args.period === 'string' && args.period.trim()
          ? args.period.trim()
          : 'last_7_days';
      const range = resolveNaturalDateQuery(period);
      const historyDetail = energyHistoryService.getRoomHistory({
        roomId: room.id,
        startDate: range.startDate,
        endDate: range.endDate,
        settings: ctx.settings,
      });
      const ledger = interventionLedgerService.listInterventions({
        roomId: room.id,
        startDate: range.startDate,
        endDate: range.endDate,
      });

      const ratedPowerWatts =
        room.ratedPowerWatts ?? computeAppliancesRatedPowerWatts(room.appliances);
      const availableHeadroomWatts = Math.max(0, ratedPowerWatts - room.currentPowerWatts);
      const ratedUtilizationPercent =
        ratedPowerWatts > 0 ? Number(((room.currentPowerWatts / ratedPowerWatts) * 100).toFixed(1)) : 0;
      const totals = historyDetail?.totals;
      const actualKWh =
        typeof totals?.actualKWh === 'number' && Number.isFinite(totals.actualKWh)
          ? Number(totals.actualKWh.toFixed(2))
          : null;
      const ratedMaxKWh =
        typeof totals?.ratedMaxKWh === 'number' && Number.isFinite(totals.ratedMaxKWh)
          ? Number(totals.ratedMaxKWh.toFixed(2))
          : null;

      return {
        ok: true,
        roomId: room.id,
        roomCode: room.roomCode,
        roomName: room.name,
        spokenRoomName: buildSpokenRoomIdentity(room),
        building: room.building,
        floor: room.floor,
        roomType: room.type,
        liveStatus: {
          currentPowerWatts: room.currentPowerWatts,
          ratedPowerWatts,
          availableHeadroomWatts,
          ratedUtilizationPercent,
          roomActivity: getRoomActivityState(room),
          appliancesActiveCount: room.appliances.filter((a) => a.currentPowerWatts > 0).length,
          totalAppliancesCount: room.appliances.length,
        },
        environment: {
          temperature: room.environment.temperature,
          humidity: room.environment.humidity,
          co2Ppm: room.environment.co2Ppm,
          naturalDaylightLux: room.environment.naturalDaylightLux,
          ambientLux: room.environment.ambientLux,
          daylightAlpha: room.calibration.learnedParameters.daylightPenetrationAlpha,
          thermalBeta: room.calibration.learnedParameters.thermalDissipationBeta,
        },
        historicalEnergy: {
          periodLabel: period,
          startDate: range.startDate,
          endDate: range.endDate,
          actualKWh,
          ratedMaxKWh,
          ratedUtilizationPercent: totals?.ratedUtilizationPercent ?? null,
        },
        recentInterventions: {
          count: ledger.summary.totalInterventions,
          meterVerifiedAvoidedKWh: ledger.summary.meterVerifiedAvoidedKwh,
          estimatedAvoidedKWh: ledger.summary.estimatedAvoidedKwh,
        },
        anomalies: (historyDetail as unknown as { anomalies?: unknown[] }).anomalies?.slice(0, 3) ?? [],
        dataProvenance:
          'Live power, sensors, and historical kWh come from ROOMWISE’s 25 calibrated simulated IoT nodes in SQLite (Asia/Kolkata). PIR detects movement only — never student headcount.',
      };
    },
  });

  // --- 2B. DIGITAL TWIN & CAMPUS FOOTPRINTS ---
  registry.register({
    id: 'get_campus_architecture_and_footprints',
    section: 'digital-twin',
    sectionLabel: 'Digital Twin',
    description:
      'Explain the Digital Twin architecture and authoritative Google Maps building footprint areas (2,366.80 m² across 5 academic blocks) for D A V Model School, IIT Kharagpur, including outdoor sports ground exclusions. Does NOT navigate.',
    supportedIntents: [
      'explain digital twin',
      'building footprints',
      'campus roof areas',
      'about D A V Model School campus',
    ],
    permissionLevel: 'public',
    dataSources: ['campus_building_measurements', 'live_room_snapshot'],
    available: true,
    declaration: {
      name: 'get_campus_architecture_and_footprints',
      description:
        'Retrieve authoritative campus building footprint measurements (2,366.80 m² across 5 academic blocks, excluding Football Ground 5,300.83 m² and Basketball Court 737.14 m²) and explain Digital Twin / CAMPUS LIVE architecture WITHOUT navigating.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          building: {
            type: Type.STRING,
            description: 'Optional specific building name (G+3 Block, New Building, Old Building, Pre-Primary Block, Multipurpose Hall).',
          },
        },
      },
    },
    handler: async (args) => {
      const summary = getCampusArchitectureAndFootprintsSummary();
      const bq = typeof args.building === 'string' ? args.building.toLowerCase().trim() : '';
      const focusedBuilding = bq
        ? summary.academicBuildings.find(
            (b) =>
              b.name.toLowerCase().includes(bq) ||
              b.shortCode.toLowerCase().includes(bq) ||
              (bq.includes('old') && b.id === 'ob-nb-complex') ||
              (bq.includes('new') && b.id === 'ob-nb-complex')
          ) || null
        : null;
      return {
        ok: true,
        ...summary,
        focusedBuilding,
      };
    },
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

  registry.register({
    id: 'get_roomwise_mathematical_models',
    section: 'history',
    sectionLabel: 'Energy History & Mathematical Models',
    description:
      'Retrieve authoritative explanations, exact equations, variables, units, sign conventions, and empirical status for ROOMWISE mathematical models: RCEM (ROOMWISE Counterfactual Energy Model), Bayesian α/β calibration, 70-classroom reference scenario (540 W, 10,080 kWh/yr, ₹70,560/yr, 1.29 yr payback), Intervention Ledger overlap subtraction, adaptive control, PVGIS solar sizing, and Space Intelligence scoring.',
    supportedIntents: [
      'explain RCEM',
      'RCEM formula',
      'how does Bayesian calibration work',
      '70 classroom reference scenario',
      'ROOMWISE mathematical models',
    ],
    permissionLevel: 'public',
    dataSources: ['roomwise_mathematical_models'],
    available: true,
    declaration: {
      name: 'get_roomwise_mathematical_models',
      description:
        'Explain any ROOMWISE concept or mathematical model with progressive disclosure (conceptual by default; mechanism, mathematical formulas, or validation status when asked): RCEM, PVGIS, CAMPUS LIVE, Digital Twin, PIR sensors, kW vs kWh, Bayesian α/β calibration, 70-classroom scenario, Intervention Ledger counterfactual math, or ROOMWISE overview. Does NOT navigate.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          topic: {
            type: Type.STRING,
            description:
              'One of: "rcem", "pvgis_solar_sizing", "campus_live", "digital_twin", "pir_sensor", "kw_vs_kwh", "roomwise_overview", "bayesian_calibration", "school_wide_70_classroom_scenario", "intervention_counterfactual", "adaptive_control", "space_intelligence_scoring", or "all".',
          },
          depth: {
            type: Type.STRING,
            description:
              'Requested explanation depth: "conceptual" (default plain-English overview without raw equations), "mechanism" (how it operates), "mathematical" (exact equations, variables, units), or "validation" (empirical proof status and limits).',
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const rawTopic = typeof args.topic === 'string' ? args.topic.trim().toLowerCase() : 'all';
      const rawDepth = typeof args.depth === 'string' ? args.depth.trim().toLowerCase() : 'conceptual';
      const depth: ExplanationDepth =
        rawDepth === 'mechanism' || rawDepth === 'mathematical' || rawDepth === 'validation'
          ? rawDepth
          : 'conceptual';
      const topic = (
        rawTopic in ROOMWISE_MATHEMATICAL_MODELS ? rawTopic : 'all'
      ) as RoomwiseModelTopic;

      if (topic !== 'all') {
        const spec = ROOMWISE_MATHEMATICAL_MODELS[topic];
        ctx.memory.lastTopic = topic;
        return {
          ok: true,
          topic,
          depth,
          recommendedReply: formatProgressiveKnowledgeReply(spec, depth),
          model: spec,
        };
      }

      return {
        ok: true,
        topic: 'all',
        depth,
        models: Object.values(ROOMWISE_MATHEMATICAL_MODELS),
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
        'Navigate the ROOMWISE UI to any of its 11 sections, open a specific classroom telemetry & control modal (use target="classroom" with roomQuery whenever the user asks in ANY language — e.g. English "Open X-B telemetry", Bengali "X-B এর telemetry খোলো", Romanised Bengali "xb er telemetry ta khul", or follow-up "Open its telemetry" — to open or view a classroom), switch sub-tabs (e.g. Energy Intervention Ledger inside Energy History, or Solar Potential / Mapping / Environmental inside Environmental & Solar Intelligence), apply filters, or go back.',
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
            description: 'Classroom name or code when target="classroom" (e.g. "Class X-B", "G3-G02", "Class IX-A", "ICT Lab").',
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
    requiresConfirmation: (args) => {
      const action = typeof args.action === 'string' ? args.action.trim() : '';
      return (
        action === 'export_analytics_csv' ||
        action === 'print_audit_report' ||
        action === 'logout_admin'
      );
    },
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
    id: 'consult_deep_reasoning',
    section: 'analytics',
    sectionLabel: 'Energy Analytics',
    description:
      'Escalate genuinely complex multi-step analytical synthesis, cross-source trade-offs (e.g., combining solar generation, space allocation, tariff economics, and multi-period energy data), counterfactual what-if scenarios, or deep multi-factor anomaly correlation while preserving full conversation context.',
    supportedIntents: [
      'multi-factor cross-source analysis',
      'counterfactual what-if scenario',
      'complex trade-off synthesis',
      'deep root-cause correlation',
    ],
    permissionLevel: 'public',
    dataSources: ['energy_history_service', 'solar_service', 'space_intelligence_service', 'intervention_ledger_service'],
    available: true,
    declaration: {
      name: 'consult_deep_reasoning',
      description:
        'Delegate genuinely complex multi-step computational analysis, cross-source synthesis (combining solar + space allocation + history + tariff trade-offs), counterfactual what-if projections, or multi-factor root-cause investigation. Do NOT call for greetings, simple direct lookups, single-room queries, navigation, or direct device controls.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          question: {
            type: Type.STRING,
            description: 'The complete analytical question and conversational intent to solve.',
          },
          focusScope: {
            type: Type.STRING,
            description: 'Optional campus, building, classroom, or date scope relevant to the analysis.',
          },
          preferredLanguageNote: {
            type: Type.STRING,
            description: 'Target language and native script that the final synthesis should use to match the user.',
          },
        },
        required: ['question'],
      },
    },
    handler: async (args, ctx) => {
      const question = typeof args.question === 'string' ? args.question.trim() : '';
      if (!question) {
        return { ok: false, error: 'An analytical question is required for deep synthesis.' };
      }
      ctx.emitClientMessage({
        type: 'tool_status',
        toolName: 'consult_deep_reasoning',
        status: 'running',
        message: 'Running deep analytical synthesis',
      });
      const result = await runHydrogenDeepReasoning({
        question,
        focusScope: typeof args.focusScope === 'string' ? args.focusScope.trim() : undefined,
        preferredLanguageNote:
          typeof args.preferredLanguageNote === 'string'
            ? args.preferredLanguageNote.trim()
            : undefined,
        context: ctx,
        registry,
        abortSignal: ctx.abortSignal,
        generateContentOverride: ctx.deepReasoningOverride,
      });

      if (result.aborted) {
        return {
          ok: false,
          aborted: true,
          error: result.error || 'Analysis cancelled.',
        };
      }

      ctx.emitClientMessage({
        type: 'tool_status',
        toolName: 'consult_deep_reasoning',
        status: result.ok ? 'completed' : 'error',
        message: result.ok ? 'Deep analysis complete' : result.error || 'Deep analysis unavailable',
      });

      if (!result.ok || !result.synthesizedAnalysis) {
        return {
          ok: false,
          toolsConsulted: result.toolsConsulted,
          error: result.error || 'Unable to complete multi-step synthesis right now.',
        };
      }

      return {
        ok: true,
        synthesizedAnalysis: result.synthesizedAnalysis,
        toolsConsulted: result.toolsConsulted,
        presentationRule:
          'Deliver these verified findings seamlessly in the user’s language and native script without mentioning internal tools or routing.',
      };
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
    availableHeadroomWatts: number;
    availableHeadroomKW: number;
    ratedUtilizationPercent: number;
    headroomPercent: number;
    occupiedCount: number;
  };
}): string {
  const { snapshot, adminIdentity, registry, memory, summary } = params;
  const authBanner = adminIdentity
    ? `AUTHORIZATION: AUTHENTICATED ADMINISTRATOR (${adminIdentity.adminName}, ${adminIdentity.role}). All administrator controls and settings updates are permitted.`
    : `AUTHORIZATION: STUDENT / READ-ONLY MODE at session start. Read-only queries, analytics, solar/weather inspection, and navigation are permitted; appliance controls, campus optimization, calibration, and settings updates require Administrator sign-in.`;

  const now = new Date();
  const todayIst = getIstDateString(now);
  const { hour: istHour, minute: istMinute } = getIstHourAndMinute(now);
  const currentTimeIst = `${String(istHour).padStart(2, '0')}:${String(istMinute).padStart(2, '0')} IST`;
  const yesterdayIst = shiftIstDate(todayIst, -1);

  const currentRoom = snapshot.selectedRoomId
    ? snapshot.classrooms.find((r) => r.id === snapshot.selectedRoomId)
    : null;
  const lastRoom = memory.lastMentionedRoomId
    ? snapshot.classrooms.find((r) => r.id === memory.lastMentionedRoomId)
    : null;

  return `You are ROOMWISE Voice — the intelligent, context-aware natural-language assistant for ${CANONICAL_INSTITUTION_NAME}, IIT Kharagpur (25 monitored classrooms across 5 academic blocks: G+3 Block, New Building, Old Building, Pre-Primary Block, Multipurpose Hall).

${authBanner}

PROPER NOUNS, INSTITUTION NAME & TECHNICAL NOTATION (CRITICAL):
- The institution's EXACT canonical name is "${CANONICAL_INSTITUTION_NAME}" (at IIT Kharagpur).
  * If speech recognition sounds like "Davos Model School", "Dave Model School", or "Davy Model School", recognise it as "${CANONICAL_INSTITUTION_NAME}".
  * When SPEAKING aloud, pronounce it clearly letter by letter as "D-A-V Model School" (NEVER say "Davos" or "Dave"!).
  * In ALL written transcripts and text outputs, write "${CANONICAL_INSTITUTION_NAME}".
- Preserve standard technical notation in written text: write "3D" (never "three-D"), "G+3" (never "G plus three"), "Class X-B", "RCEM", "PVGIS", "CAMPUS LIVE", "Digital Twin", "BEE", "ECBC", "PIR", "LDR", "DHT11", "540 W", "10,080 kWh", "₹70,560", "1.29 years". Never confuse W with Wh or kW with kWh.
- When SPEAKING classroom Roman numerals aloud, ALWAYS pronounce them as natural numbers:
  * "Class X-B" -> speak as "Class ten B" (NEVER "Exbee" or "Ex B")
  * "Class IX-A" -> "Class nine A", "Class XI-A" -> "Class eleven A", "Class XII-A" -> "Class twelve A", "Class VI-A" -> "Class six A".
- Always prefer the "spokenName" / "spokenRoomName" fields returned by tools when speaking.

UNIVERSAL MULTILINGUAL CONVERSATION & MANDATORY NATIVE-SCRIPT TRANSCRIPTS (CRITICAL):
- Support natural conversation seamlessly across ALL Indian languages and regional vernaculars (Bengali, Hindi, Malayalam, Tamil, Telugu, Kannada, Marathi, Gujarati, Odia, Assamese, Punjabi, Urdu, Sanskrit, Maithili, Konkani, Manipuri, Nepali, etc.), English, and any other language — including code-switching, mixed-language phrasing, colloquial expressions, regional accents, and Romanised input — with ZERO language allowlists or restrictions.
- Automatically recognize whichever language the user speaks or types and respond in that SAME language unless the user explicitly asks to switch (when the user speaks or writes in English, respond in English — never switch to Bengali or Hindi solely because the campus is in IIT Kharagpur). Handle mid-conversation language switches naturally when the user switches, while preserving full conversational context (referenced classroom, building, dates, comparisons).
- **MANDATORY NATIVE SCRIPT FOR WRITTEN OUTPUT / TRANSCRIPTS**: Whenever you reply in a non-English or Romanised-vernacular language, your spoken output and written transcript MUST be rendered cleanly in that language's proper native script:
  * Bengali / Banglish -> বাংলা script
  * Hindi / Hinglish / Marathi / Sanskrit / Nepali / Maithili -> देवनागरी script
  * Malayalam / Manglish -> മലയാളം script
  * Tamil / Tanglish -> தமிழ் script
  * Telugu / Tenglish -> తెలుగు script
  * Kannada -> ಕನ್ನಡ script
  * Gujarati -> ગુજરાતી script
  * Odia -> ଓଡ଼ିଆ script
  * Assamese -> অসমীয়া script
  * Punjabi -> ਪੰਜਾਬੀ script
  * Urdu -> اردو script
  * NEVER respond in Romanised vernacular by default. Keep standard English technical identifiers ("Class X-B", "G3-G02", "G+3", "3D", "RCEM", "PVGIS", "CAMPUS LIVE", "kW", "kWh", "W", "₹", "${CANONICAL_INSTITUTION_NAME}") intact inline.
- Maintain Charon's calm, natural, conversational voice quality and consistent intonation matching the language being spoken without unnatural accent shifting.

ORDINARY CONVERSATION & GREETING DISCIPLINE (CRITICAL):
- Handle greetings ("Hi", "Hello", "Hey", "Namaste", "Nomoshkar", "How are you?", "Thanks", etc.) and casual conversation warmly and concisely in the user's language.
- NEVER invoke telemetry tools, NEVER dump unsolicited power numbers, NEVER append a robotic list of capabilities, and NEVER say a greeting is an unsupported command!

PROGRESSIVE DISCLOSURE FOR TECHNICAL EXPLANATIONS (CRITICAL):
- Match your depth to what the user actually asked:
  * Conceptual question ("Explain RCEM", "What is PVGIS?", "How does CAMPUS LIVE work?", "What does the Digital Twin represent?", "How does the PIR sensor work?", "What is the difference between kW and kWh?"): give a clear, accessible plain-language explanation first—NO raw mathematical equations! Mention key conceptual rules (e.g., RCEM compares baseline vs ROOMWISE without clamping negatives and empirical meter readings are pending; PIR detects movement only and never counts students).
  * Mathematical / formula question ("Show me the mathematical formulation of RCEM", "Derive RCEM"): call get_roomwise_mathematical_models(topic="rcem", depth="mathematical") and provide the exact discrete & continuous equations, variable definitions, units, unclamped sign convention, and honest empirical-pending status.
  * Proof / validation question ("Has RCEM proven ROOMWISE's savings?"): answer directly and honestly that empirical physical meter readings are still pending, so RCEM has not yet empirically demonstrated real-world savings.

CONTEXTUAL PERIOD COMPARISONS & PARTIAL-DAY INTEGRITY (CRITICAL):
- Always resolve contextual references across turns ("compare it with today", "what about yesterday?", "that room", "open its telemetry", "why?"):
  * When the user previously asked about a date/period (e.g. "yesterday") and follows up with "compare it with today" (in any language, campus, building, or classroom scope), call \`compare_energy_periods\` passing the prior queried period (e.g. "yesterday" or \`${memory.lastResolvedStartDate || memory.lastPeriod}\`) as \`periodA\` and \`today\` as \`periodB\`, including \`roomQuery\` or \`building\` if a specific room or building was in context.
  * Whenever \`compare_energy_periods\` returns \`hasPartialDay: true\` and \`equivalentWindowComparison\`, base the apples-to-apples comparison on the **equivalent elapsed IST window** (\`equivalentWindowComparison.windowLabelIst\`, i.e., \`00:00–${currentTimeIst}\`) rather than comparing partial today raw totals directly against full 24-hour yesterday totals, and clearly state both that today is an in-progress partial day up to \`${currentTimeIst}\` and what completed full-day total was recorded.
  * If \`dataAvailable: false\` for either period, state honestly what is missing; NEVER invent figures.

HYBRID INTELLIGENCE — FAST DIRECT LIVE vs DEEP ANALYTICAL ESCALATION:
- Handle greetings, direct follow-ups, quick telemetry/history lookups, period comparisons, UI navigation, and verified backend controls directly right here in the live conversation.
- Escalate via \`consult_deep_reasoning\` ONLY when the user asks a genuinely complex multi-step computational question, cross-source trade-off synthesis (e.g., combining solar generation + space allocation + tariff/historical trends), counterfactual what-if analysis, or intricate multi-factor diagnostics beyond direct single-tool answers.
- Present deep-analysis findings seamlessly in the user's language & native script—NEVER expose internal routing, sub-models, or escalation mechanics to the user.

ANALYTICAL REASONING FOR "WHY" & "WAS THAT UNUSUALLY HIGH?" QUESTIONS:
- Never answer a "why" or "what caused" question with a bare consumption summary!
- Call investigate_energy_reason (with the exact date/period and room or building in context) and reason step-by-step:
  1. State the exact date (IST) and recorded modelled kWh.
  2. Compare against the comparable operating-day historical average—explicitly state whether it WAS or WAS NOT unusually high (and note weekends/Sundays vs school days).
  3. Identify top contributing blocks, classrooms, lighting/fan/aux split, peak hours, post-hours draw, or logged anomalies.
  4. Separate likely observed drivers from unproven root causes, and state evidence limitations honestly.

ZERO-PLACEHOLDER & FAILURE INTEGRITY:
- NEVER output placeholders such as "calculated kWh", "undefined", "NaN", "[value]", raw JSON, or LaTeX escapes. If data is missing or a date is invalid, say so clearly and honestly.

INFORMATION REQUESTS vs NAVIGATION REQUESTS (MANDATORY DISTINCTION — ALL LANGUAGES):
- Understand the user's real intent in ANY language:
  * Navigation requests (asking to OPEN, SWITCH TO, GO TO, or LAUNCH a view or classroom modal) -> ALWAYS call navigate_roomwise (for a room's telemetry modal, use target="classroom" and roomQuery="Class X-B").
  * Information / explanation / analytical requests -> call the relevant data/knowledge/investigation tool and answer naturally WITHOUT calling navigate_roomwise!
  * Compound requests -> retrieve & explain first, and also call navigate_roomwise.

DYNAMIC AUTHORIZATION RULE (CRITICAL):
- The user may sign in or sign out as an Administrator at any moment.
- Whenever the user asks to modify settings (tariff, lux targets, etc.), control appliances, optimize the campus, or recalibrate rooms, ALWAYS invoke the matching tool directly so live server RBAC runs:
  * If signed in as Administrator, the tool runs (or asks for explicit confirmation if consequential).
  * If the tool returns PERMISSION_DENIED, concisely explain that Administrator sign-in is required and offer to open Admin Login (navigate_roomwise target="admin-login").

CURRENT WORKSPACE CONTEXT:
- Current Date & Time (IST): ${formatIstFullLabel(todayIst)} (${todayIst}) at ${currentTimeIst} | Yesterday (IST): ${yesterdayIst}
- Active Section: ${memory.activeTab || snapshot.activeTab}${memory.activeSubTab ? ` (Sub-tab: ${memory.activeSubTab})` : ''}
- Selected Room: ${currentRoom ? `${buildSpokenRoomIdentity(currentRoom)} [visual: ${currentRoom.name}, code ${currentRoom.roomCode}]` : 'None'}
- Last Discussed Room: ${lastRoom ? `${buildSpokenRoomIdentity(lastRoom)} [visual: ${lastRoom.name}, code ${lastRoom.roomCode}, ${lastRoom.building}]` : 'None'}
- Last Discussed Building: ${memory.lastMentionedBuilding || 'None'} | Last Historical Window: ${memory.lastResolvedStartDate ? `${memory.lastResolvedStartDate} to ${memory.lastResolvedEndDate || memory.lastResolvedStartDate}` : 'None'} (tag: ${memory.lastPeriod})
- Monitored 25-Room Roster: ${snapshot.classrooms.map((r) => `${r.name} [${r.roomCode}, ${r.building}]`).join('; ')}
- Live Campus Load: ${summary.totalCurrentPowerKW} kW (${summary.totalCurrentPowerWatts} W, ${summary.ratedUtilizationPercent}% of ${summary.totalRatedPowerKW} kW installed rated max)
- Active Motion Nodes: ${summary.occupiedCount} of ${snapshot.classrooms.length} rooms
- School Calendar Basis: ${SCHOOL_DAYS_PER_MONTH} school days/month, ${SCHOOL_DAYS_PER_YEAR} school days/year (Indian day school)
- Selective AC Inventory: Only ICT Lab, Senior Computer Lab, Physics Lab, Staff Room, and Multipurpose Hall have AC; standard classrooms use LED lights and BLDC ceiling fans only.
- Verified Academic Building Footprints: 2,366.80 m² total across 5 academic buildings (G+3: 601.55 m², MPH: 168.51 m², PP: 387.53 m², OB+NB connected complex: 1,209.21 m² combined). Outdoor sports grounds (Football Ground 5,300.83 m², Basketball Court 737.14 m²) are strictly excluded from building and rooftop solar totals.

MATHEMATICAL MODELS & STRICT ENGINEERING HONESTY:
1. NEVER invent numbers, causes, or comparisons. Always call registered capability tools before stating telemetry, solar generation, weather, ledger totals, audit findings, or model formulas.
2. RCEM (ROOMWISE Counterfactual Energy Model): Discrete E_RCEM = (1/1000) Σ (P_{B,i} - P_{RW,i}) Δt_i and continuous E_RCEM = (1/1000) ∫ [P_B(t) - P_RW(t)] dt (power in W, time in h, result in kWh; unclamped sign convention; empirical meter inputs currently pending). Always call get_roomwise_mathematical_models for exact model explanations.
3. PIR sensors detect physical movement ONLY — never claim PIR counts exact student headcount. Attendance data comes from the register in Space Intelligence.
4. Energy Intervention Ledger strictly separates Meter-Verified avoided kWh from Simulated/Estimated avoided kWh — never present simulated estimates as meter-verified savings.
5. Rooftop solar numbers come from PVGIS 5.3 over the 2,366.80 m² horizontal academic footprints — always frame PVGIS outputs as planning estimates, not certified engineering designs.
6. Sensor Telemetry Ingestion Architecture (ESP32/MQTT/TLS) is documented future architecture — NEVER claim live physical sensors are currently connected.
7. ROOMWISE aligns with ECBC/BEE guidance — NEVER claim official BEE certification.
8. If a tool returns confirmationRequired=true, briefly summarize the planned action and ask the user to confirm before calling confirm_pending_action.

REGISTERED ROOMWISE CAPABILITIES (ALL SECTIONS):
${registry.buildCapabilityCatalogSummary()}

Use navigate_roomwise ONLY when navigation is explicitly requested across any of the 11 sections or "go back".`;
}

export interface VoiceTurnTimings {
  prepMs: number;
  firstTokenMs: number | null;
  llmMs: number;
  toolExecMs: number;
  totalMs: number;
  warmLiveReused?: boolean;
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
  /** True when the Gemini reasoning model was invoked for this turn. */
  llmInvoked?: boolean;
  /** Exact Gemini model identifier used for this turn (or null if unavailable). */
  modelUsed?: string | null;
  /** Ordered list of tool names requested by Gemini during this turn. */
  toolCallsRequested?: string[];
  /** Ordered list of tool names executed during this turn. */
  toolCallsExecuted?: string[];
  /** Machine-readable error code when ok=false (e.g., MISSING_API_KEY, GEMINI_UNAVAILABLE). */
  errorCode?: string;
  /** Stage-level execution timing breakdown (ms). */
  timings?: VoiceTurnTimings;
}

/**
 * Gemini-centred multi-turn command & conversation interpreter over the central VoiceCapabilityRegistry.
 * Routes every user message directly to Gemini with full conversation history and function calling,
 * with honest failure handling when Gemini is unavailable (zero local chatbot interception or fallback).
 */
export async function interpretAndExecuteVoiceCommand(
  utterance: string,
  registry: VoiceCapabilityRegistry,
  ctx: VoiceCapabilityExecutionContext,
  options?: GeminiOrchestrationOptions
): Promise<InterpretedVoiceCommandResult> {
  return interpretAndExecuteSemanticVoiceCommand(utterance, registry, ctx, options);
}
