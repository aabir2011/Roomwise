/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Modality,
  ThinkingLevel,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type GoogleGenAI,
  type LiveServerMessage,
  type Part,
  type Session,
} from '@google/genai';
import type { VoiceServerMessage } from '../src/types/voice.ts';
import {
  formatIstFullLabel,
  getIstDateString,
  getIstHourAndMinute,
  shiftIstDate,
} from '../src/utils/historyDates.ts';
import {
  CANONICAL_INSTITUTION_NAME,
  canonicalizeWrittenText,
  formatTextForSpeech,
  validateAndSanitizeAssistantResponse,
} from '../src/utils/voiceTerminology.ts';
import {
  finalizeTranscriptText,
  mergeTranscriptChunk,
} from '../src/utils/voiceTranscript.ts';
import { getSharedGeminiClient } from './geminiClient.ts';
import type {
  InterpretedVoiceCommandResult,
  VoiceCapabilityExecutionContext,
  VoiceCapabilityRegistry,
  VoiceSessionMemory,
  VoiceTurnTimings,
} from './voiceCapabilityRegistry.ts';

export const NLU_MODEL = 'gemini-4-hydrogen';

export const GEMINI_GENERATE_CASCADE: ReadonlyArray<{
  model: string;
  thinkingLevel: ThinkingLevel;
}> = [
  { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW },
  { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MEDIUM },
];

export const GEMINI_LIVE_CASCADE: ReadonlyArray<string> = [
  'gemini-3.8-live',
  'gemini-3.8-live-extended-thinking',
];

const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
const HIGH_DEMAND_COOLDOWN_MS = 20 * 1000;
const modelCooldownUntil = new Map<string, number>();

function isTransientRetryableGeminiError(errMsg: string): boolean {
  return /\b(500|502|503|504|UNAVAILABLE|high demand|overloaded|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up)\b/i.test(
    errMsg
  );
}

function formatConciseGeminiError(errMsg: string): string {
  const codeMatch = errMsg.match(/"code"\s*:\s*(\d{3})|\b(500|502|503|504|429|404|403|400)\b/);
  const code = codeMatch?.[1] || codeMatch?.[2];
  if (/high demand|UNAVAILABLE/i.test(errMsg)) {
    return code ? `HTTP ${code} high demand` : 'temporary high demand';
  }
  if (/RESOURCE_EXHAUSTED|quota/i.test(errMsg)) {
    return code ? `HTTP ${code} quota exhausted` : 'quota exhausted';
  }
  return errMsg.replace(/\s+/g, ' ').slice(0, 120);
}

function sleepWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (abortSignal?.aborted) {
    return Promise.reject(new Error('DEEP_REASONING_ABORTED'));
  }
  return new Promise((resolve, reject) => {
    let onAbort: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (onAbort && abortSignal) abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (abortSignal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(new Error('DEEP_REASONING_ABORTED'));
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

const NLU_TIMEOUT_MS = 35_000;
const FIRST_CHUNK_TIMEOUT_MS = 7_000;
const ROUND_TIMEOUT_MS = 18_000;
const MAX_LLM_TOOL_ROUNDS = 6;
const MAX_STORED_TURNS = 24;
const MAX_HISTORY_MESSAGES_FOR_GEMINI = 16;
const MAX_STORED_TURN_CHARS = 1500;

export interface GeminiGenerateContentCallParams {
  model: string;
  contents: Content[];
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
}

export interface GeminiOrchestrationOptions {
  /** Optional API key override (used by tests; production uses process.env.GEMINI_API_KEY). */
  apiKeyOverride?: string | null;
  /** Optional dependency-injection hook for deterministic unit testing of Gemini orchestration and failure handling. */
  generateContentOverride?: (
    params: GeminiGenerateContentCallParams
  ) => Promise<Partial<Pick<GenerateContentResponse, 'functionCalls' | 'candidates' | 'text'>>>;
  /** Optional stable session ID enabling warm Gemini Live session reuse across multi-turn follow-ups. */
  sessionId?: string;
  /** Optional streaming callback invoked as soon as text chunks arrive from Gemini. */
  onTextDelta?: (delta: string) => void;
  /** Optional callback invoked as tools start/complete during orchestration. */
  onToolStatus?: (status: {
    toolName: string;
    status: 'running' | 'completed' | 'error' | 'denied';
    message?: string;
  }) => void;
  /** Optional callback invoked immediately when a tool emits a client directive (e.g. client_navigation). */
  onClientMessage?: (msg: VoiceServerMessage) => void;
}

interface HarvestedMemoryMeta {
  roomId: string | null;
  roomCode: string | null;
  building: string | null;
  startDate: string | null;
  endDate: string | null;
  actualKWh: number | null;
  comparableKWh: number | null;
}

function recordConversationTurn(
  memory: VoiceSessionMemory,
  userText: string,
  assistantText: string,
  meta: {
    intentType?: string;
    toolName?: string | null;
    roomId?: string | null;
    roomCode?: string | null;
    building?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    actualKWh?: number | null;
    comparableKWh?: number | null;
  }
): void {
  memory.lastAssistantReply = assistantText;
  if (meta.intentType) memory.lastIntentType = meta.intentType;
  if (meta.toolName !== undefined) memory.lastToolName = meta.toolName;
  if (meta.roomId) memory.lastMentionedRoomId = meta.roomId;
  if (meta.roomCode) memory.lastMentionedRoomCode = meta.roomCode;
  if (meta.building) memory.lastMentionedBuilding = meta.building;
  if (meta.startDate) memory.lastResolvedStartDate = meta.startDate;
  if (meta.endDate) memory.lastResolvedEndDate = meta.endDate;
  if (typeof meta.actualKWh === 'number' && Number.isFinite(meta.actualKWh)) {
    memory.lastRetrievedActualKWh = meta.actualKWh;
  }
  if (typeof meta.comparableKWh === 'number' && Number.isFinite(meta.comparableKWh)) {
    memory.lastRetrievedComparableKWh = meta.comparableKWh;
  }

  memory.recentTurns.push({
    role: 'user',
    text: userText.slice(0, MAX_STORED_TURN_CHARS),
    timestamp: Date.now(),
  });
  memory.recentTurns.push({
    role: 'assistant',
    text: assistantText.slice(0, MAX_STORED_TURN_CHARS),
    timestamp: Date.now(),
  });
  if (memory.recentTurns.length > MAX_STORED_TURNS) {
    memory.recentTurns = memory.recentTurns.slice(-MAX_STORED_TURNS);
  }
}

/**
 * Static, invariant system instruction prefix (kept byte-identical across turns
 * to maximize Gemini server-side implicit prompt-prefix caching and avoid per-turn allocations).
 */
const STATIC_SYSTEM_INSTRUCTION_PREFIX = `You are ROOMWISE — the intelligent, natural-language campus energy assistant for ${CANONICAL_INSTITUTION_NAME}, IIT Kharagpur (25 monitored classrooms across 5 academic blocks: G+3 Block, New Building, Old Building, Pre-Primary Block, and Multipurpose Hall).

You are the central conversational reasoning engine of ROOMWISE. Understand the user's real meaning, conversational intent, language, and multi-turn context directly, and use ROOMWISE's registered tools whenever live data, historical records, investigations, mathematical model documentation, navigation, or controls are needed.

CORE INTELLIGENCE & CONVERSATION PRINCIPLES:
1. NATURAL CONVERSATION WITHOUT UNNECESSARY TOOL CALLS:
   - Handle greetings ("Hi", "Hello", "Hey", "Namaste", "Nomoshkar"), wellbeing ("How are you?"), gratitude ("Thanks"), acknowledgements ("Got it", "Okay", "Great"), general conversation, and topic shifts warmly, concisely, and naturally WITHOUT calling telemetry or data tools and WITHOUT dumping unsolicited energy stats or capability lists.
   - Never treat ordinary conversation as an unsupported application command.

2. UNIVERSAL MULTILINGUAL UNDERSTANDING & NATIVE-SCRIPT RENDERING (CRITICAL):
   - Understand natural conversation seamlessly across ALL Indian languages and vernaculars (including Bengali, Hindi, Malayalam, Tamil, Telugu, Kannada, Marathi, Gujarati, Odia, Assamese, Punjabi, Urdu, Sanskrit, Maithili, Konkani, Manipuri, Nepali, and regional dialects), English, and any other language — including code-switching, mixed-language sentences, colloquial phrasing, accents, and Romanised input — with ZERO language restrictions.
   - Automatically detect and respond in the exact language the user used unless they explicitly ask you to speak/write in another language (e.g., if the user speaks/writes in English, ALWAYS respond in English — never switch into Bengali or Hindi solely because the campus is in IIT Kharagpur). Switch languages fluidly mid-conversation only when the user switches or asks, while preserving full conversational context (active room, building, dates, comparisons).
   - **MANDATORY NATIVE SCRIPT FOR WRITTEN OUTPUT**: Always write EVERY non-English response in that language's authentic native script:
     * Bengali / Banglish -> বাংলা script
     * Hindi / Hinglish / Marathi / Sanskrit / Nepali / Maithili -> देवनागरी script
     * Malayalam / Manglish -> മലയാളം script
     * Tamil / Tanglish -> தமிழ் script
     * Telugu / Tenglish -> తెలుగు script
     * Kannada -> ಕನ್ನಡ script
     * Gujarati -> ગુજરાતી script
     * Odia -> ଓଡ଼ିଆ script
     * Assamese -> অসমীয়া script
     * Punjabi -> ਪੰਜਾਬੀ (Gurmukhi) script
     * Urdu -> اردو script
     * NEVER output Romanised vernacular by default (even if the user typed or spoke Romanised Banglish/Hinglish/Manglish/Tanglish).
   - Preserve standard English technical terms, institutional identifiers, numbers, and units accurately inline: "${CANONICAL_INSTITUTION_NAME}", "3D", "G+3", "Class X-B", "G3-G02", "RCEM", "PVGIS", "CAMPUS LIVE", "Digital Twin", "PIR", "ECBC", "BEE", "kW", "kWh", "W", "kWp", "m²", "₹".

3. NAVIGATION vs INFORMATION — CLEARLY DISTINGUISHED IN EVERY LANGUAGE:
   - When the user asks to OPEN, SWITCH TO, GO TO, or LAUNCH a view or classroom in ANY language (including regional verbs meaning "open" or "show on screen"), call \`navigate_roomwise\`!
     * To open a classroom's telemetry/control modal, ALWAYS call \`navigate_roomwise(target="classroom", roomQuery="<exact room name or code>")\` (e.g. \`roomQuery="Class X-B"\`).
     * Confirm concisely that you opened it; do not recite a wall of telemetry unless the user also asked for a summary.
   - When the user asks a QUESTION, requests DATA, asks for an EXPLANATION, or asks WHY in ANY language, call the relevant data/knowledge/investigation tool and answer WITHOUT calling \`navigate_roomwise\`!
   - When the user asks a COMPOUND request (explanation + navigation), call both the data tool and \`navigate_roomwise\`.

4. MULTI-TURN CONTEXTUAL CONTINUITY & EQUIVALENT-PERIOD COMPARISONS:
   - Use conversation history and CURRENT WORKSPACE STATE to resolve pronouns and relative follow-ups automatically across any language switch:
     * "How much energy did yesterday consume?" -> "Compare it with today" -> call \`compare_energy_periods\` using the previously queried period/date as \`periodA\` (e.g. \`yesterday\` or exact resolved date) and \`today\` as \`periodB\`, keeping the active classroom (\`roomQuery\`) or \`building\` in scope if one was under discussion.
     * "How much energy did X-B consume yesterday?" -> "What about the previous day?" -> shift the resolved date back by 1 day (exact YYYY-MM-DD in IST) for Class X-B.
     * Followed by "Open its telemetry." -> call \`navigate_roomwise(target="classroom", roomQuery="Class X-B")\`.
     * Followed by "Was that unusually high?" or "Why?" -> call \`investigate_energy_reason\` for that exact room/scope and exact date.
   - **PARTIAL-DAY COMPARISON INTEGRITY (CRITICAL)**:
     * Today (IST) is an in-progress partial day up to the current IST time. Whenever \`compare_energy_periods\` returns \`hasPartialDay: true\` and \`equivalentWindowComparison\`, compare today against the equivalent elapsed IST time window (e.g., \`00:00–HH:MM IST\`) rather than comparing an incomplete partial day against a full 24-hour day, and explicitly disclose that today is still in progress alongside completed full-day totals when helpful.
     * If data for either period is unavailable (\`dataAvailable: false\` or missing), state that clearly and honestly; NEVER invent figures.
   - Ask a brief clarifying question ONLY when genuinely ambiguous (e.g. "Class X" matching both Class X-A and Class X-B).

5. PROGRESSIVE DISCLOSURE FOR TECHNICAL EXPLANATIONS:
   - Default to clear, accessible, plain-language explanations FIRST when asked conceptually ("Explain RCEM.", "What is PVGIS?", "How does CAMPUS LIVE work?", "What does the Digital Twin represent?", "How does the PIR sensor work?", "What is the difference between kW and kWh?").
   - For "Explain RCEM.", call \`get_roomwise_mathematical_models(topic="rcem", depth="conceptual")\` and explain clearly in plain language WITHOUT dumping raw mathematical equations, summation symbols, or integrals unless the user explicitly asks for the math/equations/formulas! Mention that RCEM compares a baseline against ROOMWISE without clamping negatives, and note honestly that empirical physical meter readings are still pending.
   - If the user explicitly asks for equations, formulas, or mathematical formulation ("Show me the RCEM equations"), call \`get_roomwise_mathematical_models(topic="rcem", depth="mathematical")\` and present the exact discrete and continuous equations, variable definitions, units, unclamped sign convention, and empirical-pending status clearly.
   - If asked whether RCEM has proven real-world savings, answer honestly: NO — empirical physical meter validation is still pending.

6. GENUINE ANALYTICAL INVESTIGATION & DEEP REASONING:
   - NEVER answer a causal question ("Why did the campus use so much electricity yesterday?", "Was that unusually high?") with a bare consumption total!
   - Call \`investigate_energy_reason\` with the exact resolved date/period and scope (campus, building, or classroom) and synthesize a grounded investigation (exact IST date & kWh, comparable prior average, elevated/normal/Sunday context, top blocks/rooms, load breakdown, peak/post-hours draw, anomalies, and honest evidence boundaries).
   - For extraordinarily complex multi-step syntheses (combining solar, occupancy/space allocation, tariffs, multi-building counterfactual trade-offs, or deep multi-factor diagnostics), \`consult_deep_reasoning\` is available. Handle greetings, direct single lookups, controls, and navigation directly without escalating. Never expose internal model names or routing to the user.

7. AUTHORIZATION, SAFETY & CONFIRMATIONS:
   - Whenever the user asks to control appliances, optimize the campus, recalibrate sensors, or modify campus settings (tariff, lux targets, etc.), ALWAYS invoke the matching tool directly so live server RBAC and confirmation policies run.
   - If the tool returns \`authorized: false\` / \`PERMISSION_DENIED\`, explain clearly that Administrator sign-in is required and offer to open Admin Login.
   - If the tool returns \`confirmationRequired: true\`, summarize the planned action concisely and ask for explicit confirmation before calling \`confirm_pending_action\`.

8. STRICT DATA INTEGRITY & ZERO PLACEHOLDERS:
   - NEVER invent numbers, dates, or tool results. Always retrieve real values from tools before stating figures.
   - NEVER output placeholder strings like "calculated kWh", "undefined", "NaN", "[value]", raw JSON, or raw LaTeX escapes (like \`\\frac\`, \`\\sum\`).
   - Always maintain ROOMWISE's engineering honesty:
     * Live power, indoor sensors, and historical SQLite records are simulated 25-node telemetry (not physical sub-meters).
     * PVGIS rooftop solar figures (across 2,366.80 m² verified academic footprints; excluding Football Ground 5,300.83 m² and Basketball Court 737.14 m²) are planning estimates, not certified engineering designs.
     * PIR sensors detect motion only and never count students (attendance comes from registers in Space Intelligence).
     * Energy Intervention Ledger strictly separates Meter-Verified vs Simulated/Estimated avoided kWh.
     * ESP32/MQTT/TLS hardware ingestion is documented future architecture, not currently connected live hardware.
     * ROOMWISE aligns with ECBC/BEE guidance and never claims official BEE certification.

CURRENT WORKSPACE STATE:
`;

let cachedRoomRosterKey = '';
let cachedRoomRosterText = '';

function getCachedRoomRoster(rooms: VoiceCapabilityExecutionContext['rooms']): string {
  const key = `${rooms.length}:${rooms[0]?.id || ''}:${rooms[rooms.length - 1]?.id || ''}`;
  if (key === cachedRoomRosterKey && cachedRoomRosterText) {
    return cachedRoomRosterText;
  }
  cachedRoomRosterKey = key;
  cachedRoomRosterText = rooms
    .map((r) => `${r.name} [${r.roomCode}, ${r.building}, ${r.floor}]`)
    .join('; ');
  return cachedRoomRosterText;
}

function buildCompactWorkspaceDelta(ctx: VoiceCapabilityExecutionContext): string {
  const activeRoom = ctx.memory.selectedRoomId
    ? ctx.rooms.find((r) => r.id === ctx.memory.selectedRoomId)
    : null;
  const parts = [
    `Active UI: ${ctx.memory.activeTab}${ctx.memory.activeSubTab ? `/${ctx.memory.activeSubTab}` : ''}`,
    `Open Room: ${activeRoom ? `${activeRoom.name} (${activeRoom.roomCode})` : 'None'}`,
    `Role: ${ctx.adminIdentity ? `Admin (${ctx.adminIdentity.adminName})` : 'Student/Read-Only'}`,
  ];
  if (ctx.memory.pendingConfirmation) {
    parts.push(
      `Pending Confirmation: "${ctx.memory.pendingConfirmation.summary}" (${ctx.memory.pendingConfirmation.toolName})`
    );
  }
  return parts.join(' | ');
}

function buildSystemInstruction(ctx: VoiceCapabilityExecutionContext): string {
  const now = new Date();
  const todayIst = getIstDateString(now);
  const { hour: istHour, minute: istMinute } = getIstHourAndMinute(now);
  const currentTimeIst = `${String(istHour).padStart(2, '0')}:${String(istMinute).padStart(2, '0')} IST`;
  const yesterdayIst = shiftIstDate(todayIst, -1);
  const twoDaysAgoIst = shiftIstDate(todayIst, -2);

  const activeRoom = ctx.memory.selectedRoomId
    ? ctx.rooms.find((r) => r.id === ctx.memory.selectedRoomId)
    : null;
  const lastRoom = ctx.memory.lastMentionedRoomId
    ? ctx.rooms.find((r) => r.id === ctx.memory.lastMentionedRoomId)
    : null;

  const roomRoster = getCachedRoomRoster(ctx.rooms);

  const pendingNote = ctx.memory.pendingConfirmation
    ? `ACTIVE PENDING CONFIRMATION: "${ctx.memory.pendingConfirmation.summary}" (tool: ${ctx.memory.pendingConfirmation.toolName}). If the user confirms in any language, call confirm_pending_action; if they cancel or decline, call cancel_pending_action.`
    : 'No pending confirmation.';

  const workspaceState = [
    `Institution: ${CANONICAL_INSTITUTION_NAME}, IIT Kharagpur`,
    `Current Date & Time (IST): ${formatIstFullLabel(todayIst)} (${todayIst}) at ${currentTimeIst} [today is an in-progress partial day; compare completed vs partial days over equivalent elapsed IST hours]`,
    `Yesterday (IST): ${formatIstFullLabel(yesterdayIst)} (${yesterdayIst})`,
    `Two Days Ago (IST): ${formatIstFullLabel(twoDaysAgoIst)} (${twoDaysAgoIst})`,
    `Authorization Role: ${ctx.adminIdentity ? `Authenticated Administrator (${ctx.adminIdentity.adminName}, ${ctx.adminIdentity.role})` : 'Student / Read-Only Mode'}`,
    `Active UI Section: ${ctx.memory.activeTab}${ctx.memory.activeSubTab ? ` (Sub-tab: ${ctx.memory.activeSubTab})` : ''}`,
    `Currently Open Room Modal: ${activeRoom ? `${activeRoom.name} (${activeRoom.roomCode}, ${activeRoom.building})` : 'None'}`,
    `Last Discussed Room: ${lastRoom ? `${lastRoom.name} (${lastRoom.roomCode}, ${lastRoom.building})` : 'None'}`,
    `Last Discussed Building: ${ctx.memory.lastMentionedBuilding || 'None'}`,
    `Last Resolved Historical Window: ${ctx.memory.lastResolvedStartDate ? `${ctx.memory.lastResolvedStartDate} to ${ctx.memory.lastResolvedEndDate || ctx.memory.lastResolvedStartDate}` : 'None'} (period tag: ${ctx.memory.lastPeriod})`,
    `Last Retrieved Energy Figure: ${ctx.memory.lastRetrievedActualKWh !== null ? `${ctx.memory.lastRetrievedActualKWh} kWh` : 'None'}`,
    pendingNote,
    `All 25 Monitored Classrooms: ${roomRoster}`,
  ].join('\n');

  return `${STATIC_SYSTEM_INSTRUCTION_PREFIX}${workspaceState}`;
}

function harvestToolMemoryMetadata(
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: Record<string, unknown>,
  ctx: VoiceCapabilityExecutionContext,
  acc: HarvestedMemoryMeta
): void {
  if (typeof toolResult.roomId === 'string' && toolResult.roomId) {
    acc.roomId = toolResult.roomId;
  }
  if (typeof toolResult.roomCode === 'string' && toolResult.roomCode) {
    acc.roomCode = toolResult.roomCode;
    if (!acc.roomId) {
      const matched = ctx.rooms.find(
        (r) => r.roomCode.toLowerCase() === String(toolResult.roomCode).toLowerCase()
      );
      if (matched) acc.roomId = matched.id;
    }
  }
  if (typeof toolResult.building === 'string' && toolResult.building) {
    acc.building = toolResult.building;
  } else if (typeof toolArgs.building === 'string' && toolArgs.building) {
    acc.building = toolArgs.building;
  }

  const detail = toolResult.detail as Record<string, unknown> | undefined;
  const rangeObj = (toolResult.range ||
    toolResult.targetPeriod ||
    detail?.range ||
    toolResult.historicalEnergy) as Record<string, unknown> | undefined;
  if (typeof rangeObj?.startDate === 'string' && rangeObj.startDate) {
    acc.startDate = rangeObj.startDate;
  }
  if (typeof rangeObj?.endDate === 'string' && rangeObj.endDate) {
    acc.endDate = rangeObj.endDate;
  }

  const totals = (toolResult.totals || detail?.totals) as Record<string, unknown> | undefined;
  if (typeof toolResult.actualKWh === 'number' && Number.isFinite(toolResult.actualKWh)) {
    acc.actualKWh = toolResult.actualKWh;
  } else if (typeof rangeObj?.actualKWh === 'number' && Number.isFinite(rangeObj.actualKWh)) {
    acc.actualKWh = rangeObj.actualKWh;
  } else if (typeof totals?.actualKWh === 'number' && Number.isFinite(totals.actualKWh)) {
    acc.actualKWh = totals.actualKWh;
  } else if (
    typeof totals?.totalActualKWh === 'number' &&
    Number.isFinite(totals.totalActualKWh)
  ) {
    acc.actualKWh = totals.totalActualKWh;
  }

  if (typeof toolResult.comparableKWh === 'number' && Number.isFinite(toolResult.comparableKWh)) {
    acc.comparableKWh = toolResult.comparableKWh;
  } else if (
    typeof rangeObj?.comparableHistoricalAvgKWh === 'number' &&
    Number.isFinite(rangeObj.comparableHistoricalAvgKWh)
  ) {
    acc.comparableKWh = rangeObj.comparableHistoricalAvgKWh;
  } else if (typeof totals?.ratedMaxKWh === 'number' && Number.isFinite(totals.ratedMaxKWh)) {
    acc.comparableKWh = totals.ratedMaxKWh;
  }

  if (typeof toolArgs.period === 'string' && toolArgs.period.trim()) {
    const p = toolArgs.period.trim();
    if (p !== ctx.memory.lastPeriod) {
      ctx.memory.previousPeriod = ctx.memory.lastPeriod;
      ctx.memory.lastPeriod = p;
    }
  } else if (typeof toolArgs.naturalQuery === 'string' && toolArgs.naturalQuery.trim()) {
    const p = toolArgs.naturalQuery.trim();
    if (p !== ctx.memory.lastPeriod) {
      ctx.memory.previousPeriod = ctx.memory.lastPeriod;
      ctx.memory.lastPeriod = p;
    }
  }

  if (acc.roomId) ctx.memory.lastMentionedRoomId = acc.roomId;
  if (acc.roomCode) ctx.memory.lastMentionedRoomCode = acc.roomCode;
  if (acc.building) ctx.memory.lastMentionedBuilding = acc.building;
  if (acc.startDate) ctx.memory.lastResolvedStartDate = acc.startDate;
  if (acc.endDate) ctx.memory.lastResolvedEndDate = acc.endDate;
  if (toolName) ctx.memory.lastToolName = toolName;
}

function buildFinalResponse(params: {
  ok: boolean;
  intent: string;
  toolName: string | null;
  visualReply: string;
  data: Record<string, unknown> | null;
  emittedMessages: VoiceServerMessage[];
  confirmationRequired?: boolean;
  permissionDenied?: boolean;
  llmInvoked: boolean;
  modelUsed: string | null;
  toolCallsRequested: string[];
  toolCallsExecuted: string[];
  errorCode?: string;
  timings?: VoiceTurnTimings;
  memory?: VoiceSessionMemory;
  userText?: string;
  meta?: {
    intentType?: string;
    toolName?: string | null;
    roomId?: string | null;
    roomCode?: string | null;
    building?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    actualKWh?: number | null;
    comparableKWh?: number | null;
  };
}): InterpretedVoiceCommandResult {
  const validated = validateAndSanitizeAssistantResponse(
    params.visualReply,
    'I could not generate a complete response from Gemini for that request. Please try again.'
  );
  const canonicalVisual = canonicalizeWrittenText(validated.text);
  const spoken = formatTextForSpeech(canonicalVisual);

  if (params.memory && params.userText && params.ok) {
    recordConversationTurn(params.memory, params.userText, canonicalVisual, params.meta || {});
  }

  return {
    ok: validated.hadPlaceholder ? false : params.ok,
    intent: params.intent,
    toolName: params.toolName,
    visualReply: canonicalVisual,
    spokenReply: spoken,
    data: params.data,
    emittedMessages: params.emittedMessages,
    confirmationRequired: params.confirmationRequired,
    permissionDenied: params.permissionDenied,
    llmInvoked: params.llmInvoked,
    modelUsed: params.modelUsed,
    toolCallsRequested: params.toolCallsRequested,
    toolCallsExecuted: params.toolCallsExecuted,
    errorCode: validated.hadPlaceholder ? 'INVALID_MODEL_OUTPUT' : params.errorCode,
    timings: params.timings,
  };
}

/**
 * Executes a batch of Gemini function calls, parallelizing independent public read-only /
 * UI-directive tools safely via Promise.all while keeping admin/confirmation/mutating calls sequential.
 */
async function executeToolBatch(params: {
  functionCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
  registry: VoiceCapabilityRegistry;
  wrappedCtx: VoiceCapabilityExecutionContext;
  toolCallsRequested: string[];
  toolCallsExecuted: string[];
  harvestedMeta: HarvestedMemoryMeta;
  onToolStatus?: GeminiOrchestrationOptions['onToolStatus'];
}): Promise<{
  results: Array<{ id?: string; name: string; response: Record<string, unknown> }>;
  lastToolName: string | null;
  lastToolData: Record<string, unknown> | null;
  sawPermissionDenied: boolean;
  sawConfirmationRequired: boolean;
  elapsedMs: number;
}> {
  const batchStart = Date.now();
  const validCalls = params.functionCalls.filter((fc) => Boolean(fc.name));
  const canParallelize =
    validCalls.length > 1 && validCalls.every((fc) => params.registry.isParallelSafe(fc.name!));

  const runSingle = async (fc: { id?: string; name?: string; args?: Record<string, unknown> }) => {
    const fcName = fc.name || '';
    const fcArgs = (fc.args || {}) as Record<string, unknown>;
    params.toolCallsRequested.push(fcName);
    params.onToolStatus?.({ toolName: fcName, status: 'running' });

    let toolResult: Record<string, unknown>;
    try {
      toolResult = await params.registry.execute(fcName, fcArgs, params.wrappedCtx);
    } catch (toolErr) {
      toolResult = {
        ok: false,
        error: toolErr instanceof Error ? toolErr.message : 'Tool execution error.',
      };
    }

    params.toolCallsExecuted.push(fcName);
    params.onToolStatus?.({
      toolName: fcName,
      status:
        toolResult.authorized === false
          ? 'denied'
          : toolResult.ok === false && !toolResult.confirmationRequired
          ? 'error'
          : 'completed',
    });

    harvestToolMemoryMetadata(fcName, fcArgs, toolResult, params.wrappedCtx, params.harvestedMeta);
    return { id: fc.id, name: fcName, response: toolResult };
  };

  const results = canParallelize
    ? await Promise.all(validCalls.map((fc) => runSingle(fc)))
    : await (async () => {
        const sequential: Array<{ id?: string; name: string; response: Record<string, unknown> }> =
          [];
        for (const fc of validCalls) {
          sequential.push(await runSingle(fc));
        }
        return sequential;
      })();

  let lastToolName: string | null = null;
  let lastToolData: Record<string, unknown> | null = null;
  let sawPermissionDenied = false;
  let sawConfirmationRequired = false;

  for (const r of results) {
    lastToolName = r.name;
    lastToolData = r.response;
    if (r.response.authorized === false) sawPermissionDenied = true;
    if (r.response.confirmationRequired === true) sawConfirmationRequired = true;
  }

  return {
    results,
    lastToolName,
    lastToolData,
    sawPermissionDenied,
    sawConfirmationRequired,
    elapsedMs: Date.now() - batchStart,
  };
}

// ============================================================================
// Warm Per-Session Gemini Live Pool (eliminates 500-1100ms handshake on follow-ups)
// ============================================================================

const LIVE_POOL_IDLE_TTL_MS = 25_000;
const LIVE_POOL_MAX_ENTRIES = 1;
const TERMINAL_PUNCTUATION_REGEX = /[.!?।॥۔؟]["'”’)\]]*$/;

interface PooledLiveSession {
  key: string;
  model: string;
  session: Session;
  createdAt: number;
  lastUsedAt: number;
  lastWorkspaceDelta: string;
  closed: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  activeHandlers: {
    onmessage: (msg: LiveServerMessage) => void;
    onerror: (err: unknown) => void;
    onclose: (ev: unknown) => void;
  } | null;
}

const sessionLivePool = new Map<string, PooledLiveSession>();

function disposePooledLiveSession(entry: PooledLiveSession): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  entry.activeHandlers = null;
  if (sessionLivePool.get(entry.key) === entry) {
    sessionLivePool.delete(entry.key);
  }
  if (!entry.closed) {
    entry.closed = true;
    try {
      entry.session.close();
    } catch {
      // ignore close errors
    }
  }
}

function checkoutWarmLiveSession(key: string): PooledLiveSession | null {
  const entry = sessionLivePool.get(key);
  if (!entry) return null;
  sessionLivePool.delete(key);
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  if (entry.closed || Date.now() - entry.lastUsedAt > LIVE_POOL_IDLE_TTL_MS) {
    disposePooledLiveSession(entry);
    return null;
  }
  return entry;
}

function checkinWarmLiveSession(entry: PooledLiveSession): void {
  if (entry.closed) {
    disposePooledLiveSession(entry);
    return;
  }
  entry.activeHandlers = null;
  entry.lastUsedAt = Date.now();

  // Evict oldest idle session if pool exceeds max capacity
  if (sessionLivePool.size >= LIVE_POOL_MAX_ENTRIES && !sessionLivePool.has(entry.key)) {
    let oldest: PooledLiveSession | null = null;
    for (const candidate of sessionLivePool.values()) {
      if (!oldest || candidate.lastUsedAt < oldest.lastUsedAt) {
        oldest = candidate;
      }
    }
    if (oldest) disposePooledLiveSession(oldest);
  }

  const prev = sessionLivePool.get(entry.key);
  if (prev && prev !== entry) {
    disposePooledLiveSession(prev);
  }

  entry.idleTimer = setTimeout(() => {
    disposePooledLiveSession(entry);
  }, LIVE_POOL_IDLE_TTL_MS);
  if (typeof entry.idleTimer.unref === 'function') {
    entry.idleTimer.unref();
  }
  sessionLivePool.set(entry.key, entry);
}

function drainIdleLivePool(): void {
  for (const entry of Array.from(sessionLivePool.values())) {
    disposePooledLiveSession(entry);
  }
}

/**
 * Executes a single conversational turn (including multi-step tool calling) over
 * the official Gemini Live API (`gemini-3.8-live` / `gemini-3.8-live-extended-thinking`).
 * Supports real-time outputTranscription streaming, adaptive post-turnComplete settlement,
 * safe parallel tool execution, and warm per-session socket reuse across multi-turn chats.
 */
async function executeTurnViaGeminiLive(params: {
  ai: GoogleGenAI;
  model: string;
  contents: Content[];
  rawUserMessage: string;
  systemInstruction: string;
  workspaceDelta: string;
  poolKey: string | null;
  declarations: FunctionDeclaration[];
  registry: VoiceCapabilityRegistry;
  wrappedCtx: VoiceCapabilityExecutionContext;
  timeoutMs: number;
  turnStartedAt: number;
  toolCallsRequested: string[];
  toolCallsExecuted: string[];
  harvestedMeta: HarvestedMemoryMeta;
  onTextDelta?: GeminiOrchestrationOptions['onTextDelta'];
  onToolStatus?: GeminiOrchestrationOptions['onToolStatus'];
}): Promise<{
  text: string;
  lastToolName: string | null;
  lastToolData: Record<string, unknown> | null;
  sawPermissionDenied: boolean;
  sawConfirmationRequired: boolean;
  firstTokenMs: number | null;
  toolExecMs: number;
  warmLiveReused: boolean;
}> {
  const {
    ai,
    model,
    contents,
    rawUserMessage,
    systemInstruction,
    workspaceDelta,
    poolKey,
    declarations,
    registry,
    wrappedCtx,
    timeoutMs,
    turnStartedAt,
    toolCallsRequested,
    toolCallsExecuted,
    harvestedMeta,
    onTextDelta,
    onToolStatus,
  } = params;

  const runAttempt = (warmEntry: PooledLiveSession | null) =>
    new Promise<{
      text: string;
      lastToolName: string | null;
      lastToolData: Record<string, unknown> | null;
      sawPermissionDenied: boolean;
      sawConfirmationRequired: boolean;
      firstTokenMs: number | null;
      toolExecMs: number;
      warmLiveReused: boolean;
    }>((resolve, reject) => {
      let settled = false;
      let entry: PooledLiveSession | null = warmEntry;
      let transcriptBuffer = '';
      let textPartBuffer = '';
      let streamedLength = 0;
      let firstTokenMs: number | null = null;
      let lastTranscriptChunkAt = 0;
      let outputTranscriptionFinished = false;
      let activeToolCalls = 0;
      let toolRounds = 0;
      let totalToolExecMs = 0;
      let lastToolName: string | null = null;
      let lastToolData: Record<string, unknown> | null = null;
      let sawPermissionDenied = false;
      let sawConfirmationRequired = false;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let turnCompletedAfterTools = false;

      const emitNewDelta = () => {
        const current = transcriptBuffer || textPartBuffer;
        if (current.length > streamedLength) {
          const delta = current.slice(streamedLength);
          streamedLength = current.length;
          if (firstTokenMs === null && delta.trim().length > 0) {
            firstTokenMs = Date.now() - turnStartedAt;
          }
          onTextDelta?.(delta);
        }
      };

      const releaseTimers = () => {
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
      };

      const finishSuccess = () => {
        if (settled) return;
        const combined = finalizeTranscriptText(transcriptBuffer || textPartBuffer).trim();
        if (!combined) {
          settled = true;
          releaseTimers();
          if (entry) disposePooledLiveSession(entry);
          reject(new Error('GEMINI_LIVE_EMPTY_RESPONSE'));
          return;
        }
        settled = true;
        releaseTimers();

        if (
          entry &&
          poolKey &&
          !entry.closed &&
          turnCompletedAfterTools &&
          activeToolCalls === 0 &&
          !sawPermissionDenied &&
          !sawConfirmationRequired
        ) {
          entry.lastWorkspaceDelta = workspaceDelta;
          checkinWarmLiveSession(entry);
        } else if (entry) {
          disposePooledLiveSession(entry);
        }

        resolve({
          text: combined,
          lastToolName,
          lastToolData,
          sawPermissionDenied,
          sawConfirmationRequired,
          firstTokenMs,
          toolExecMs: totalToolExecMs,
          warmLiveReused: Boolean(warmEntry),
        });
      };

      const finishError = (err: Error) => {
        if (settled) return;
        settled = true;
        releaseTimers();
        if (entry) disposePooledLiveSession(entry);
        reject(err);
      };

      const scheduleFinishCheck = (delayMs: number) => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          if (!settled && activeToolCalls === 0) {
            const hasText = Boolean((transcriptBuffer || textPartBuffer).trim());
            if (hasText) {
              finishSuccess();
            } else if (turnCompletedAfterTools) {
              finishError(new Error('GEMINI_LIVE_EMPTY_RESPONSE'));
            }
          }
        }, delayMs);
      };

      const timeoutTimer = setTimeout(() => {
        const partial = finalizeTranscriptText(transcriptBuffer || textPartBuffer).trim();
        if (partial && activeToolCalls === 0) {
          finishSuccess();
        } else {
          finishError(new Error('GEMINI_TIMEOUT'));
        }
      }, Math.max(4000, timeoutMs));

      const turnHandlers = {
        onmessage: async (message: LiveServerMessage) => {
          if (settled) return;

          const outputTr = message.serverContent?.outputTranscription as
            | { text?: string; finished?: boolean }
            | undefined;
          if (typeof outputTr?.text === 'string' && outputTr.text.length > 0) {
            transcriptBuffer = mergeTranscriptChunk(transcriptBuffer, outputTr.text);
            lastTranscriptChunkAt = Date.now();
            if (outputTr.finished) outputTranscriptionFinished = true;
            emitNewDelta();

            if (turnCompletedAfterTools && activeToolCalls === 0) {
              const trimmed = transcriptBuffer.trim();
              if (outputTr.finished) {
                scheduleFinishCheck(80);
              } else if (TERMINAL_PUNCTUATION_REGEX.test(trimmed)) {
                scheduleFinishCheck(320);
              } else {
                scheduleFinishCheck(850);
              }
            }
          } else if (outputTr?.finished) {
            outputTranscriptionFinished = true;
            if (turnCompletedAfterTools && activeToolCalls === 0) {
              scheduleFinishCheck(80);
            }
          }

          const parts = message.serverContent?.modelTurn?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part.text === 'string' && part.text.trim()) {
                const maybeThought = (part as { thought?: boolean }).thought;
                if (!maybeThought) {
                  textPartBuffer = mergeTranscriptChunk(textPartBuffer, part.text);
                  lastTranscriptChunkAt = Date.now();
                  emitNewDelta();
                }
              }
            }
          }

          if (
            message.toolCall?.functionCalls &&
            message.toolCall.functionCalls.length > 0 &&
            entry &&
            !entry.closed
          ) {
            toolRounds += 1;
            if (toolRounds > MAX_LLM_TOOL_ROUNDS) {
              finishError(new Error('GEMINI_MAX_TOOL_ROUNDS_EXCEEDED'));
              return;
            }
            if (settleTimer) {
              clearTimeout(settleTimer);
              settleTimer = null;
            }
            turnCompletedAfterTools = false;
            outputTranscriptionFinished = false;
            activeToolCalls += 1;

            try {
              const batch = await executeToolBatch({
                functionCalls: message.toolCall.functionCalls.map((fc) => ({
                  id: fc.id,
                  name: fc.name,
                  args: (fc.args || {}) as Record<string, unknown>,
                })),
                registry,
                wrappedCtx,
                toolCallsRequested,
                toolCallsExecuted,
                harvestedMeta,
                onToolStatus,
              });

              totalToolExecMs += batch.elapsedMs;
              if (batch.lastToolName) lastToolName = batch.lastToolName;
              if (batch.lastToolData) lastToolData = batch.lastToolData;
              if (batch.sawPermissionDenied) sawPermissionDenied = true;
              if (batch.sawConfirmationRequired) sawConfirmationRequired = true;

              if (batch.results.length > 0 && entry && !entry.closed && !settled) {
                entry.session.sendToolResponse({
                  functionResponses: batch.results,
                });
              }
            } catch (err) {
              finishError(err instanceof Error ? err : new Error(String(err)));
            } finally {
              activeToolCalls = Math.max(0, activeToolCalls - 1);
            }
            return;
          }

          if (message.serverContent?.turnComplete) {
            if (activeToolCalls === 0) {
              turnCompletedAfterTools = true;
              const trimmed = (transcriptBuffer || textPartBuffer).trim();
              const quietMs = lastTranscriptChunkAt > 0 ? Date.now() - lastTranscriptChunkAt : 0;
              const endsCleanly = TERMINAL_PUNCTUATION_REGEX.test(trimmed);

              if (outputTranscriptionFinished && trimmed) {
                scheduleFinishCheck(60);
              } else if (trimmed && endsCleanly && quietMs >= 350) {
                // Transcript chunks already finished streaming >350ms ago and ended cleanly on punctuation.
                scheduleFinishCheck(120);
              } else if (trimmed && endsCleanly) {
                scheduleFinishCheck(380);
              } else if (trimmed) {
                scheduleFinishCheck(900);
              } else {
                scheduleFinishCheck(2200);
              }
            }
          }
        },
        onerror: (errEvent: unknown) => {
          const msg =
            (errEvent as { message?: string })?.message ||
            (errEvent instanceof Error ? errEvent.message : 'Gemini Live API error');
          finishError(new Error(msg));
        },
        onclose: (closeEvent: unknown) => {
          if (settled) return;
          const hasText = Boolean((transcriptBuffer || textPartBuffer).trim());
          if (hasText && activeToolCalls === 0) {
            finishSuccess();
            return;
          }
          const ce = closeEvent as { code?: number; reason?: string } | undefined;
          finishError(
            new Error(ce?.reason || `Gemini Live session closed (code ${ce?.code ?? 'unknown'})`)
          );
        },
      };

      // Path A: Reuse warm Live session (0ms handshake!)
      if (warmEntry) {
        warmEntry.activeHandlers = turnHandlers;
        try {
          const needsDelta = warmEntry.lastWorkspaceDelta !== workspaceDelta;
          const turnText = needsDelta
            ? `[Updated Workspace State: ${workspaceDelta}]\n${rawUserMessage}`
            : rawUserMessage;
          warmEntry.session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: turnText }] }],
            turnComplete: true,
          });
        } catch (sendErr) {
          finishError(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
        }
        return;
      }

      // Path B: Open fresh Live session with delegating callbacks for future pooling
      const freshEntry: PooledLiveSession = {
        key: poolKey || `ephemeral_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        model,
        session: null as unknown as Session,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        lastWorkspaceDelta: workspaceDelta,
        closed: false,
        idleTimer: null,
        activeHandlers: turnHandlers,
      };
      entry = freshEntry;

      ai.live
        .connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Charon' },
              },
            },
            outputAudioTranscription: {},
            systemInstruction,
            tools: [{ functionDeclarations: declarations }],
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              freshEntry.activeHandlers?.onmessage(message);
            },
            onerror: (errEvent) => {
              freshEntry.closed = true;
              if (sessionLivePool.get(freshEntry.key) === freshEntry) {
                sessionLivePool.delete(freshEntry.key);
              }
              freshEntry.activeHandlers?.onerror(errEvent);
            },
            onclose: (closeEvent: unknown) => {
              freshEntry.closed = true;
              if (freshEntry.idleTimer) {
                clearTimeout(freshEntry.idleTimer);
                freshEntry.idleTimer = null;
              }
              if (sessionLivePool.get(freshEntry.key) === freshEntry) {
                sessionLivePool.delete(freshEntry.key);
              }
              freshEntry.activeHandlers?.onclose(closeEvent);
            },
          },
        })
        .then((session) => {
          freshEntry.session = session;
          if (settled) {
            disposePooledLiveSession(freshEntry);
            return;
          }
          // Send complete conversation history + original user message untouched
          session.sendClientContent({
            turns: contents,
            turnComplete: true,
          });
        })
        .catch((err) => {
          freshEntry.closed = true;
          finishError(err instanceof Error ? err : new Error(String(err)));
        });
    });

  // Try warm pooled Live session first if available; transparently reconnect fresh if stale before any tool ran.
  if (poolKey) {
    const warm = checkoutWarmLiveSession(poolKey);
    if (warm) {
      const preToolCount = toolCallsExecuted.length;
      try {
        return await runAttempt(warm);
      } catch (err) {
        disposePooledLiveSession(warm);
        if (toolCallsExecuted.length > preToolCount) {
          throw err;
        }
        // Stale idle socket — transparently open a fresh Live session cleanly
      }
    }
  }

  // Close any idle pooled sockets from other sessions before opening a fresh Live WebSocket
  // so concurrent Live sessions never accumulate against Gemini's concurrency quota.
  drainIdleLivePool();

  return runAttempt(null);
}

/**
 * Gemini-Centred Conversational Intelligence & Tool Orchestration Engine.
 *
 * Architecture:
 *   ORIGINAL USER INPUT -> GEMINI MODEL (with full history + all ROOMWISE tool declarations)
 *     -> Gemini understands intent/language/context directly
 *     -> Either replies directly (conversation) OR requests ROOMWISE function calls
 *     -> Server executes requested tools (parallelized when public/read-only, preserving RBAC & confirmations)
 *     -> Tool results returned to Gemini -> Gemini interprets & streams the final natural response.
 *
 * Model cascade (100% genuine Gemini models, never local rule-based fallback):
 *   1. gemini-4-hydrogen (generateContentStream, ThinkingLevel.LOW)
 *   2. gemini-3.1-flash-lite (generateContentStream, ThinkingLevel.MEDIUM)
 *   3. gemini-3.8-live / gemini-3.8-live-extended-thinking (Live API with streaming & warm session reuse)
 *
 * If all Gemini models are unavailable or GEMINI_API_KEY is missing, returns an honest failure
 * with ZERO fabricated responses and ZERO silent substitution with a rule-based chatbot.
 */
export async function interpretAndExecuteSemanticVoiceCommand(
  utterance: string,
  registry: VoiceCapabilityRegistry,
  ctx: VoiceCapabilityExecutionContext,
  options?: GeminiOrchestrationOptions
): Promise<InterpretedVoiceCommandResult> {
  const turnStartedAt = Date.now();
  const emitted: VoiceServerMessage[] = [];
  const wrappedCtx: VoiceCapabilityExecutionContext = {
    ...ctx,
    emitClientMessage: (msg) => {
      emitted.push(msg);
      ctx.emitClientMessage(msg);
      options?.onClientMessage?.(msg);
    },
  };

  // Preserve the user's exact original utterance (only trim outer whitespace)
  const rawUserMessage = utterance.trim();
  if (!rawUserMessage) {
    return buildFinalResponse({
      ok: false,
      intent: 'empty',
      toolName: null,
      visualReply:
        'No message received. Ask me anything about ROOMWISE, a classroom, a building, or campus energy.',
      data: null,
      emittedMessages: emitted,
      llmInvoked: false,
      modelUsed: null,
      toolCallsRequested: [],
      toolCallsExecuted: [],
      errorCode: 'EMPTY_INPUT',
      timings: {
        prepMs: Date.now() - turnStartedAt,
        firstTokenMs: null,
        llmMs: 0,
        toolExecMs: 0,
        totalMs: Date.now() - turnStartedAt,
      },
    });
  }

  const effectiveApiKey =
    options && 'apiKeyOverride' in options
      ? (options.apiKeyOverride || '').trim()
      : (process.env.GEMINI_API_KEY || '').trim();

  if (!options?.generateContentOverride && !effectiveApiKey) {
    return buildFinalResponse({
      ok: false,
      intent: 'llm_unavailable',
      toolName: null,
      visualReply:
        'ROOMWISE’s Gemini AI service is not configured on this server (GEMINI_API_KEY is missing), so I cannot process your request right now.',
      data: { available: false, reason: 'MISSING_API_KEY' },
      emittedMessages: [],
      llmInvoked: false,
      modelUsed: null,
      toolCallsRequested: [],
      toolCallsExecuted: [],
      errorCode: 'MISSING_API_KEY',
      timings: {
        prepMs: Date.now() - turnStartedAt,
        firstTokenMs: null,
        llmMs: 0,
        toolExecMs: 0,
        totalMs: Date.now() - turnStartedAt,
      },
    });
  }

  const ai = options?.generateContentOverride ? null : getSharedGeminiClient(effectiveApiKey);

  const systemInstruction = buildSystemInstruction(wrappedCtx);
  const workspaceDelta = buildCompactWorkspaceDelta(wrappedCtx);
  const declarations = registry.getFunctionDeclarations();

  // Build strict alternating conversation history from session memory + original raw user message
  const contents: Content[] = [];
  const recentHistory = wrappedCtx.memory.recentTurns.slice(-MAX_HISTORY_MESSAGES_FOR_GEMINI);
  for (const turn of recentHistory) {
    const role = turn.role === 'assistant' ? 'model' : 'user';
    if (contents.length === 0 && role === 'model') continue;
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) {
      const prevText =
        Array.isArray(prev.parts) && typeof prev.parts[0]?.text === 'string'
          ? prev.parts[0].text
          : '';
      prev.parts = [{ text: `${prevText}\n${turn.text}`.trim() }];
    } else {
      contents.push({
        role,
        parts: [{ text: turn.text }],
      });
    }
  }
  const lastContent = contents[contents.length - 1];
  if (lastContent && lastContent.role === 'user') {
    const prevText =
      Array.isArray(lastContent.parts) && typeof lastContent.parts[0]?.text === 'string'
        ? lastContent.parts[0].text
        : '';
    lastContent.parts = [{ text: `${prevText}\n${rawUserMessage}`.trim() }];
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: rawUserMessage }],
    });
  }

  const initialContentsSnapshot: Content[] = contents.map((c) => ({
    role: c.role,
    parts: Array.isArray(c.parts) ? [...c.parts] : [],
  }));
  const prepMs = Date.now() - turnStartedAt;

  const toolCallsRequested: string[] = [];
  const toolCallsExecuted: string[] = [];
  let lastToolName: string | null = null;
  let lastToolData: Record<string, unknown> | null = null;
  let sawPermissionDenied = false;
  let sawConfirmationRequired = false;
  let totalToolExecMs = 0;
  let firstTokenMs: number | null = null;
  const harvestedMeta: HarvestedMemoryMeta = {
    roomId: null,
    roomCode: null,
    building: null,
    startDate: null,
    endDate: null,
    actualKWh: null,
    comparableKWh: null,
  };

  const deadline = Date.now() + NLU_TIMEOUT_MS;
  let llmInvoked = false;
  let activeModelUsed: string = NLU_MODEL;

  const markCooldown = (model: string, errMsg: string) => {
    if (/\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(errMsg)) {
      modelCooldownUntil.set(model, Date.now() + QUOTA_COOLDOWN_MS);
    } else if (
      /\b(500|503|504|UNAVAILABLE|DEADLINE_EXCEEDED|GEMINI_TIMEOUT|high demand|fetch failed)\b/i.test(
        errMsg
      )
    ) {
      modelCooldownUntil.set(model, Date.now() + HIGH_DEMAND_COOLDOWN_MS);
    }
  };

  const raceWithTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return Promise.race([
      promise.finally(() => {
        if (timer) clearTimeout(timer);
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('GEMINI_TIMEOUT')), Math.max(250, ms));
      }),
    ]);
  };

  const invokeGenerateContentRound = async (candidate: {
    model: string;
    thinkingLevel: ThinkingLevel;
  }): Promise<{
    functionCalls?: GenerateContentResponse['functionCalls'];
    modelParts?: Part[];
    text: string;
  }> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 500) {
      throw new Error('GEMINI_TIMEOUT');
    }

    llmInvoked = true;
    activeModelUsed = candidate.model;

    if (options?.generateContentOverride) {
      const response = await raceWithTimeout(
        options.generateContentOverride({
          model: candidate.model,
          contents,
          systemInstruction,
          functionDeclarations: declarations,
        }),
        Math.min(remainingMs, ROUND_TIMEOUT_MS)
      );
      const text = (response.text || '').trim();
      if (text && (!response.functionCalls || response.functionCalls.length === 0)) {
        if (firstTokenMs === null) firstTokenMs = Date.now() - turnStartedAt;
        options.onTextDelta?.(text);
      }
      return {
        functionCalls: response.functionCalls,
        modelParts: response.candidates?.[0]?.content?.parts,
        text,
      };
    }

    // Stream directly from Gemini for minimal TTFT & fast first-chunk stall detection
    const roundDeadline = Math.min(deadline, Date.now() + ROUND_TIMEOUT_MS);
    const stream = await raceWithTimeout(
      ai!.models.generateContentStream({
        model: candidate.model,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: candidate.thinkingLevel },
          tools: [{ functionDeclarations: declarations }],
        },
      }),
      Math.min(remainingMs, FIRST_CHUNK_TIMEOUT_MS)
    );

    const iterator = stream[Symbol.asyncIterator]();
    let collectedText = '';
    const collectedFunctionCalls: NonNullable<GenerateContentResponse['functionCalls']> = [];
    const collectedParts: Part[] = [];
    let receivedFirstChunk = false;

    while (true) {
      const chunkTimeoutMs = receivedFirstChunk
        ? Math.max(500, roundDeadline - Date.now())
        : Math.min(Math.max(500, roundDeadline - Date.now()), FIRST_CHUNK_TIMEOUT_MS);

      const next = await raceWithTimeout(iterator.next(), chunkTimeoutMs);
      if (next.done) break;
      receivedFirstChunk = true;

      const chunk = next.value;
      const chunkParts = chunk.candidates?.[0]?.content?.parts;
      if (Array.isArray(chunkParts) && chunkParts.length > 0) {
        collectedParts.push(...chunkParts);
      }
      if (Array.isArray(chunk.functionCalls) && chunk.functionCalls.length > 0) {
        collectedFunctionCalls.push(...chunk.functionCalls);
      }
      const chunkText = typeof chunk.text === 'string' ? chunk.text : '';
      if (chunkText) {
        collectedText += chunkText;
        if (collectedFunctionCalls.length === 0) {
          if (firstTokenMs === null && chunkText.trim().length > 0) {
            firstTokenMs = Date.now() - turnStartedAt;
          }
          options?.onTextDelta?.(chunkText);
        }
      }
    }

    return {
      functionCalls: collectedFunctionCalls.length > 0 ? collectedFunctionCalls : undefined,
      modelParts: collectedParts.length > 0 ? collectedParts : undefined,
      text: collectedText.trim(),
    };
  };

  // --- Stage 1: Try generateContentStream Gemini models (or test stub) ---
  let generateContentError: unknown = null;
  const now = Date.now();
  const readyGenerateModels = options?.generateContentOverride
    ? [GEMINI_GENERATE_CASCADE[0]]
    : GEMINI_GENERATE_CASCADE.filter((c) => (modelCooldownUntil.get(c.model) || 0) <= now);

  if (readyGenerateModels.length > 0) {
    for (const candidate of readyGenerateModels) {
      const roundStartToolCount = toolCallsExecuted.length;
      const llmStart = Date.now();
      try {
        for (let round = 0; round < MAX_LLM_TOOL_ROUNDS; round++) {
          let response: Awaited<ReturnType<typeof invokeGenerateContentRound>>;
          try {
            response = await invokeGenerateContentRound(candidate);
          } catch (roundErr) {
            const roundMsg = roundErr instanceof Error ? roundErr.message : String(roundErr);
            const canRetryTransient =
              !options?.generateContentOverride &&
              round === 0 &&
              toolCallsExecuted.length === roundStartToolCount &&
              isTransientRetryableGeminiError(roundMsg) &&
              deadline - Date.now() > 8_000;
            if (!canRetryTransient) {
              throw roundErr;
            }
            const backoffMs = 380 + Math.floor(Math.random() * 200);
            await sleepWithAbort(backoffMs);
            response = await invokeGenerateContentRound(candidate);
          }
          const functionCalls = response.functionCalls;

          if (Array.isArray(functionCalls) && functionCalls.length > 0) {
            if (response.modelParts && response.modelParts.length > 0) {
              contents.push({ role: 'model', parts: response.modelParts });
            } else {
              contents.push({
                role: 'model',
                parts: functionCalls.map((fc) => ({
                  functionCall: {
                    name: fc.name || '',
                    args: (fc.args || {}) as Record<string, unknown>,
                  },
                })),
              });
            }

            const batch = await executeToolBatch({
              functionCalls: functionCalls.map((fc) => ({
                name: fc.name,
                args: (fc.args || {}) as Record<string, unknown>,
              })),
              registry,
              wrappedCtx,
              toolCallsRequested,
              toolCallsExecuted,
              harvestedMeta,
              onToolStatus: options?.onToolStatus,
            });

            totalToolExecMs += batch.elapsedMs;
            if (batch.lastToolName) lastToolName = batch.lastToolName;
            if (batch.lastToolData) lastToolData = batch.lastToolData;
            if (batch.sawPermissionDenied) sawPermissionDenied = true;
            if (batch.sawConfirmationRequired) sawConfirmationRequired = true;

            contents.push({
              role: 'user',
              parts: batch.results.map((r) => ({
                functionResponse: {
                  name: r.name,
                  response: r.response,
                },
              })),
            });
            continue;
          }

          const finalText = response.text;
          if (finalText) {
            const totalMs = Date.now() - turnStartedAt;
            const llmMs = Math.max(0, Date.now() - llmStart - totalToolExecMs);
            const isOk =
              !sawPermissionDenied &&
              (!lastToolData || lastToolData.ok !== false || sawConfirmationRequired);
            return buildFinalResponse({
              ok: isOk,
              intent: lastToolName || 'conversation',
              toolName: lastToolName,
              visualReply: finalText,
              data: lastToolData,
              emittedMessages: emitted,
              confirmationRequired: sawConfirmationRequired,
              permissionDenied: sawPermissionDenied,
              llmInvoked,
              modelUsed: activeModelUsed,
              toolCallsRequested,
              toolCallsExecuted,
              timings: {
                prepMs,
                firstTokenMs,
                llmMs,
                toolExecMs: totalToolExecMs,
                totalMs,
                warmLiveReused: false,
              },
              memory: wrappedCtx.memory,
              userText: rawUserMessage,
              meta: {
                intentType: lastToolName || 'conversation',
                toolName: lastToolName,
                roomId: harvestedMeta.roomId,
                roomCode: harvestedMeta.roomCode,
                building: harvestedMeta.building,
                startDate: harvestedMeta.startDate,
                endDate: harvestedMeta.endDate,
                actualKWh: harvestedMeta.actualKWh,
                comparableKWh: harvestedMeta.comparableKWh,
              },
            });
          }

          throw new Error('GEMINI_EMPTY_RESPONSE');
        }

        throw new Error('GEMINI_MAX_TOOL_ROUNDS_EXCEEDED');
      } catch (err) {
        generateContentError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (options?.generateContentOverride) {
          break;
        }
        markCooldown(candidate.model, msg);
        console.info(
          `[voice-gemini] Model "${candidate.model}" unavailable (${formatConciseGeminiError(msg)}); failing over to next Gemini model.`
        );
        if (toolCallsExecuted.length > roundStartToolCount) {
          break;
        }
      }
    }
  }

  // --- Stage 2: Cascade to official Gemini Live API models when generateContent models are rate-limited / high-demand ---
  let lastError: unknown = generateContentError;
  const canSafelyCascadeToLive =
    toolCallsExecuted.length === 0 ||
    toolCallsExecuted.every((toolName) => registry.isParallelSafe(toolName));

  if (!options?.generateContentOverride && ai && canSafelyCascadeToLive) {
    const liveNow = Date.now();
    const readyLiveModels = GEMINI_LIVE_CASCADE.filter(
      (m) => (modelCooldownUntil.get(m) || 0) <= liveNow
    );
    const liveCandidates =
      readyLiveModels.length > 0 ? readyLiveModels : [...GEMINI_LIVE_CASCADE];

    const roleKey = wrappedCtx.adminIdentity ? wrappedCtx.adminIdentity.adminId : 'public';

    for (const liveModel of liveCandidates) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 3000) break;

      const beforeToolCount = toolCallsExecuted.length;
      const liveStart = Date.now();
      const poolKey = options?.sessionId ? `${options.sessionId}:${roleKey}:${liveModel}` : null;

      try {
        llmInvoked = true;
        activeModelUsed = liveModel;
        const liveOutcome = await executeTurnViaGeminiLive({
          ai,
          model: liveModel,
          contents: initialContentsSnapshot,
          rawUserMessage,
          systemInstruction,
          workspaceDelta,
          poolKey,
          declarations,
          registry,
          wrappedCtx,
          timeoutMs: remainingMs,
          turnStartedAt,
          toolCallsRequested,
          toolCallsExecuted,
          harvestedMeta,
          onTextDelta: options?.onTextDelta,
          onToolStatus: options?.onToolStatus,
        });

        lastToolName = liveOutcome.lastToolName ?? lastToolName;
        lastToolData = liveOutcome.lastToolData ?? lastToolData;
        sawPermissionDenied = sawPermissionDenied || liveOutcome.sawPermissionDenied;
        sawConfirmationRequired = sawConfirmationRequired || liveOutcome.sawConfirmationRequired;
        totalToolExecMs += liveOutcome.toolExecMs;
        if (liveOutcome.firstTokenMs !== null) {
          firstTokenMs = liveOutcome.firstTokenMs;
        }

        const totalMs = Date.now() - turnStartedAt;
        const llmMs = Math.max(0, Date.now() - liveStart - liveOutcome.toolExecMs);
        const isOk =
          !sawPermissionDenied &&
          (!lastToolData || lastToolData.ok !== false || sawConfirmationRequired);

        return buildFinalResponse({
          ok: isOk,
          intent: lastToolName || 'conversation',
          toolName: lastToolName,
          visualReply: liveOutcome.text,
          data: lastToolData,
          emittedMessages: emitted,
          confirmationRequired: sawConfirmationRequired,
          permissionDenied: sawPermissionDenied,
          llmInvoked,
          modelUsed: liveModel,
          toolCallsRequested,
          toolCallsExecuted,
          timings: {
            prepMs,
            firstTokenMs,
            llmMs,
            toolExecMs: totalToolExecMs,
            totalMs,
            warmLiveReused: liveOutcome.warmLiveReused,
          },
          memory: wrappedCtx.memory,
          userText: rawUserMessage,
          meta: {
            intentType: lastToolName || 'conversation',
            toolName: lastToolName,
            roomId: harvestedMeta.roomId,
            roomCode: harvestedMeta.roomCode,
            building: harvestedMeta.building,
            startDate: harvestedMeta.startDate,
            endDate: harvestedMeta.endDate,
            actualKWh: harvestedMeta.actualKWh,
            comparableKWh: harvestedMeta.comparableKWh,
          },
        });
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        markCooldown(liveModel, msg);
        console.info(
          `[voice-gemini] Live model "${liveModel}" unavailable (${formatConciseGeminiError(msg)}).`
        );
        if (toolCallsExecuted.length > beforeToolCount) {
          break;
        }
      }
    }
  }

  // --- Stage 3: Honest, transparent failure (ZERO fabricated responses, ZERO rule-based fallback!) ---
  const errMsg = lastError instanceof Error ? lastError.message : String(lastError || 'GEMINI_UNAVAILABLE');
  console.error('[voice-gemini] All Gemini models unavailable:', errMsg);

  const isTimeout = errMsg === 'GEMINI_TIMEOUT';
  const userMessage = isTimeout
    ? 'The Gemini AI service took too long to respond to your request. Please try again in a moment.'
    : 'I could not reach the Gemini AI service to process your request right now. Please try again in a moment.';

  return buildFinalResponse({
    ok: false,
    intent: 'llm_unavailable',
    toolName: lastToolName,
    visualReply: userMessage,
    data: {
      available: false,
      error: errMsg,
    },
    emittedMessages: emitted,
    llmInvoked,
    modelUsed: activeModelUsed,
    toolCallsRequested,
    toolCallsExecuted,
    errorCode: isTimeout ? 'GEMINI_TIMEOUT' : 'GEMINI_UNAVAILABLE',
    timings: {
      prepMs,
      firstTokenMs,
      llmMs: Math.max(0, Date.now() - turnStartedAt - prepMs - totalToolExecMs),
      toolExecMs: totalToolExecMs,
      totalMs: Date.now() - turnStartedAt,
    },
  });
}

const DEEP_REASONING_MODELS: ReadonlyArray<{ model: string; thinkingLevel: ThinkingLevel }> = [
  { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.MEDIUM },
  { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MEDIUM },
];

const DEEP_REASONING_TIMEOUT_MS = 40_000;
const DEEP_REASONING_MAX_ROUNDS = 4;

/**
 * Escalates complex multi-step analytical, synthesis, counterfactual trade-off, or
 * cross-source diagnostic questions from the primary Gemini Live conversation session
 * into gemini-4-hydrogen with strictly read-only analytical tools and full context continuity.
 */
export async function runHydrogenDeepReasoning(params: {
  question: string;
  focusScope?: string;
  preferredLanguageNote?: string;
  context: VoiceCapabilityExecutionContext;
  registry: VoiceCapabilityRegistry;
  abortSignal?: AbortSignal;
  generateContentOverride?: GeminiOrchestrationOptions['generateContentOverride'];
}): Promise<{
  ok: boolean;
  aborted?: boolean;
  synthesizedAnalysis?: string;
  toolsConsulted: string[];
  modelUsed: string | null;
  error?: string;
}> {
  const { question, focusScope, preferredLanguageNote, context, registry, abortSignal } = params;
  const toolsConsulted: string[] = [];

  if (abortSignal?.aborted) {
    return {
      ok: false,
      aborted: true,
      toolsConsulted,
      modelUsed: null,
      error: 'Deep reasoning request was cancelled due to user interruption.',
    };
  }

  const effectiveApiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!params.generateContentOverride && !effectiveApiKey) {
    return {
      ok: false,
      toolsConsulted,
      modelUsed: null,
      error: 'GEMINI_API_KEY is missing on the server.',
    };
  }

  const ai = params.generateContentOverride ? null : getSharedGeminiClient(effectiveApiKey);
  const readOnlyDeclarations = registry.getReadOnlyAnalyticalDeclarations();
  const baseSystemInstruction = buildSystemInstruction(context);
  const deepReasoningSystemInstruction = `${baseSystemInstruction}

DEEP ANALYTICAL SYNTHESIS DIRECTIVE:
- You are providing an internal grounded analytical synthesis back to the live conversational voice interface for ${CANONICAL_INSTITUTION_NAME}.
- Use the strictly read-only analytical tools provided to cross-verify all numerical facts, dates (IST), building/room telemetry, comparable historical references, interventions, solar estimates, and space allocations before answering.
- Resolve partial days honestly using equivalent elapsed IST time-of-day windows and explicitly disclose any data boundaries (simulated 25-node SQLite history, pending empirical RCEM meter readings, PVGIS planning estimates, PIR motion-only limits).
- Synthesize a clear, concise, voice-ready quantitative finding (2–5 sentences unless multi-part comparison requires slightly more, using plain natural prose with ZERO markdown **bold**, *italic*, headings #, or bullet asterisks) with exact units and dates, in the user's language and **mandatory native script** (no Romanised vernacular).
- NEVER mention internal model names, API routing, escalation mechanics, or JSON schemas.`;

  const contents: Content[] = [];
  const recentHistory = context.memory.recentTurns.slice(-12);
  for (const turn of recentHistory) {
    const role = turn.role === 'assistant' ? 'model' : 'user';
    if (contents.length === 0 && role === 'model') continue;
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) {
      const prevText =
        Array.isArray(prev.parts) && typeof prev.parts[0]?.text === 'string'
          ? prev.parts[0].text
          : '';
      prev.parts = [{ text: `${prevText}\n${turn.text}`.trim() }];
    } else {
      contents.push({ role, parts: [{ text: turn.text }] });
    }
  }

  const structuredPrompt = [
    focusScope ? `Requested Focus Scope: ${focusScope}` : null,
    preferredLanguageNote ? `Target Language / Script Guidance: ${preferredLanguageNote}` : null,
    `User Analytical Question: ${question.trim()}`,
  ]
    .filter(Boolean)
    .join('\n');

  const lastContent = contents[contents.length - 1];
  if (lastContent && lastContent.role === 'user') {
    const prevText =
      Array.isArray(lastContent.parts) && typeof lastContent.parts[0]?.text === 'string'
        ? lastContent.parts[0].text
        : '';
    lastContent.parts = [{ text: `${prevText}\n${structuredPrompt}`.trim() }];
  } else {
    contents.push({ role: 'user', parts: [{ text: structuredPrompt }] });
  }

  const raceAbortAndTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    if (abortSignal?.aborted) {
      return Promise.reject(new Error('DEEP_REASONING_ABORTED'));
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;
    return Promise.race([
      promise.finally(() => {
        if (timer) clearTimeout(timer);
        if (onAbort && abortSignal) abortSignal.removeEventListener('abort', onAbort);
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DEEP_REASONING_TIMEOUT')), Math.max(500, timeoutMs));
        if (abortSignal) {
          onAbort = () => reject(new Error('DEEP_REASONING_ABORTED'));
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  };

  const harvestedMeta: HarvestedMemoryMeta = {
    roomId: null,
    roomCode: null,
    building: null,
    startDate: null,
    endDate: null,
    actualKWh: null,
    comparableKWh: null,
  };

  const baseContents: Content[] = structuredClone(contents);
  const overallDeadline = Date.now() + DEEP_REASONING_TIMEOUT_MS;
  let lastError: unknown = null;
  const now = Date.now();
  const readyCandidates = params.generateContentOverride
    ? [DEEP_REASONING_MODELS[0]]
    : DEEP_REASONING_MODELS.filter((c) => (modelCooldownUntil.get(c.model) || 0) <= now);
  const candidates = readyCandidates.length > 0 ? readyCandidates : [...DEEP_REASONING_MODELS];

  for (const candidate of candidates) {
    if (abortSignal?.aborted) {
      return {
        ok: false,
        aborted: true,
        toolsConsulted,
        modelUsed: null,
        error: 'Analysis cancelled due to interruption.',
      };
    }

    const candidateContents: Content[] = structuredClone(baseContents);
    const candidateDeadline = Math.min(overallDeadline, Date.now() + 22_000);
    try {
      for (let round = 0; round < DEEP_REASONING_MAX_ROUNDS; round++) {
        const invokeDeepRound = async () => {
          const remainingMs = candidateDeadline - Date.now();
          if (remainingMs <= 500) throw new Error('DEEP_REASONING_TIMEOUT');

          return params.generateContentOverride
            ? await raceAbortAndTimeout(
                params.generateContentOverride({
                  model: candidate.model,
                  contents: candidateContents,
                  systemInstruction: deepReasoningSystemInstruction,
                  functionDeclarations: readOnlyDeclarations,
                }),
                remainingMs
              )
            : await raceAbortAndTimeout(
                ai!.models.generateContent({
                  model: candidate.model,
                  contents: candidateContents,
                  config: {
                    systemInstruction: deepReasoningSystemInstruction,
                    thinkingConfig: { thinkingLevel: candidate.thinkingLevel },
                    tools:
                      readOnlyDeclarations.length > 0
                        ? [{ functionDeclarations: readOnlyDeclarations }]
                        : undefined,
                  },
                }),
                remainingMs
              );
        };

        let response: Awaited<ReturnType<typeof invokeDeepRound>>;
        try {
          response = await invokeDeepRound();
        } catch (deepErr) {
          const deepMsg = deepErr instanceof Error ? deepErr.message : String(deepErr);
          const canRetryDeep =
            !params.generateContentOverride &&
            round === 0 &&
            toolsConsulted.length === 0 &&
            isTransientRetryableGeminiError(deepMsg) &&
            candidateDeadline - Date.now() > 6_000;
          if (!canRetryDeep) {
            throw deepErr;
          }
          const backoffMs = 380 + Math.floor(Math.random() * 200);
          await sleepWithAbort(backoffMs, abortSignal);
          response = await invokeDeepRound();
        }

        if (abortSignal?.aborted) {
          return {
            ok: false,
            aborted: true,
            toolsConsulted,
            modelUsed: candidate.model,
            error: 'Analysis cancelled due to interruption.',
          };
        }

        const functionCalls = response.functionCalls;
        if (Array.isArray(functionCalls) && functionCalls.length > 0) {
          const modelParts = response.candidates?.[0]?.content?.parts;
          if (modelParts && modelParts.length > 0) {
            candidateContents.push({ role: 'model', parts: modelParts });
          } else {
            candidateContents.push({
              role: 'model',
              parts: functionCalls.map((fc) => ({
                functionCall: {
                  name: fc.name || '',
                  args: (fc.args || {}) as Record<string, unknown>,
                },
              })),
            });
          }

          const batchResults = await Promise.all(
            functionCalls
              .filter((fc) => fc.name && fc.name !== 'consult_deep_reasoning')
              .map(async (fc) => {
                const fcName = fc.name!;
                const fcArgs = (fc.args || {}) as Record<string, unknown>;
                toolsConsulted.push(fcName);
                let toolResp: Record<string, unknown>;
                try {
                  toolResp = await registry.execute(fcName, fcArgs, context);
                } catch (err) {
                  toolResp = {
                    ok: false,
                    error: err instanceof Error ? err.message : 'Tool execution error.',
                  };
                }
                harvestToolMemoryMetadata(fcName, fcArgs, toolResp, context, harvestedMeta);
                return { name: fcName, response: toolResp };
              })
          );

          candidateContents.push({
            role: 'user',
            parts: batchResults.map((r) => ({
              functionResponse: {
                name: r.name,
                response: r.response,
              },
            })),
          });
          continue;
        }

        const text = (response.text || '').trim();
        if (text) {
          const sanitized = validateAndSanitizeAssistantResponse(text);
          return {
            ok: !sanitized.hadPlaceholder,
            synthesizedAnalysis: canonicalizeWrittenText(sanitized.text),
            toolsConsulted,
            modelUsed: candidate.model,
            ...(sanitized.hadPlaceholder ? { error: 'INVALID_MODEL_OUTPUT' } : {}),
          };
        }

        throw new Error('DEEP_REASONING_EMPTY_RESPONSE');
      }

      throw new Error('DEEP_REASONING_MAX_ROUNDS_EXCEEDED');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'DEEP_REASONING_ABORTED' || abortSignal?.aborted) {
        return {
          ok: false,
          aborted: true,
          toolsConsulted,
          modelUsed: candidate.model,
          error: 'Analysis cancelled due to interruption.',
        };
      }
      lastError = err;
      if (/\b(429|RESOURCE_EXHAUSTED|quota)\b/i.test(msg)) {
        modelCooldownUntil.set(candidate.model, Date.now() + QUOTA_COOLDOWN_MS);
      } else if (/\b(503|UNAVAILABLE|high demand|overloaded)\b/i.test(msg)) {
        modelCooldownUntil.set(candidate.model, Date.now() + HIGH_DEMAND_COOLDOWN_MS);
      }
      if (params.generateContentOverride || msg === 'DEEP_REASONING_TIMEOUT') {
        break;
      }
    }
  }

  return {
    ok: false,
    toolsConsulted,
    modelUsed: candidates[0]?.model ?? 'gemini-4-hydrogen',
    error:
      lastError instanceof Error && lastError.message === 'DEEP_REASONING_TIMEOUT'
        ? 'The detailed multi-source calculation took too long right now. Please try again in a moment.'
        : 'Detailed multi-source calculation is temporarily busy right now. Please try again shortly, or ask about a specific metric.',
  };
}

