/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Type } from '@google/genai';
import { INITIAL_CLASSROOMS, INITIAL_SCHOOL_SETTINGS } from '../src/data/initialClassrooms.ts';
import {
  ROOM_APPLIANCE_SPECS,
  SCHOOL_DAYS_PER_MONTH,
  SCHOOL_DAYS_PER_YEAR,
  buildExpandedAppliancesFromSpec,
} from '../src/data/roomApplianceSpecs.ts';
import {
  formatRoomNameForSpeech,
  normalizeClassroomQuery,
} from '../src/utils/voicePronunciation.ts';
import {
  finalizeTranscriptText,
  mergeTranscriptChunk,
} from '../src/utils/voiceTranscript.ts';
import {
  CANONICAL_INSTITUTION_NAME,
  canonicalizeWrittenText,
  formatTextForSpeech,
  hasForbiddenResponsePlaceholder,
  normalizeRawUtterance,
  validateAndSanitizeAssistantResponse,
} from '../src/utils/voiceTerminology.ts';
import {
  ALL_ROOMWISE_SECTIONS,
  createInitialVoiceSessionMemory,
  resolveClassroomRobust,
  type VoiceCapabilityExecutionContext,
} from '../server/voiceCapabilityRegistry.ts';
import {
  computeBase64Pcm16Rms,
  createRoomwiseVoiceCommandExecutor,
  resolveApplianceUnit,
  type VoiceAdminIdentity,
  type VoiceLiveBridgeDeps,
} from '../server/voiceLiveBridge.ts';
import {
  NLU_MODEL,
  type GeminiGenerateContentCallParams,
} from '../server/voiceSemanticNlu.ts';
import { interventionLedgerService } from '../server/interventionLedgerService.ts';
import { energyHistoryService } from '../server/energyHistoryService.ts';
import { getIstDateString, shiftIstDate } from '../src/utils/historyDates.ts';
import type { VoiceServerMessage } from '../src/types/voice.ts';

// Ensure backing SQLite/in-memory stores are initialized for integration tests
energyHistoryService.initialize();
interventionLedgerService.initialize({ seedDemonstrationData: true });

function buildTestDeps(): VoiceLiveBridgeDeps {
  const roomMap = new Map<
    string,
    {
      roomId: string;
      roomCode: string;
      isVacantDefault: boolean;
      commandSeq: number;
      appliances: ReturnType<typeof buildExpandedAppliancesFromSpec>;
      updatedAt: number;
    }
  >();

  for (const room of INITIAL_CLASSROOMS) {
    const spec = ROOM_APPLIANCE_SPECS.find((s) => s.roomId === room.id);
    if (!spec) continue;
    const appliances = buildExpandedAppliancesFromSpec(spec);
    roomMap.set(room.id, {
      roomId: room.id,
      roomCode: room.roomCode,
      isVacantDefault: room.occupancyStatus === 'Unoccupied',
      commandSeq: 1,
      appliances,
      updatedAt: Date.now(),
    });
  }

  return {
    resolveAdminFromWs: () => null,
    getServerRoomsMap: () => roomMap,
    executeApplianceCommand: (input) => {
      const rec = roomMap.get(input.roomId);
      if (!rec) return { ok: false, error: 'Room not found.' };
      let verifiedUnit: {
        id: string;
        unitCode?: string;
        name: string;
        outputPercent: number;
        operatingMode: string;
        currentPowerWatts: number;
      } | undefined;
      const updated = rec.appliances.map((a) => {
        if (input.action === 'set_unit' || input.action === 'restore_unit_auto') {
          if (a.id !== input.applianceId) return a;
          const pct = input.action === 'restore_unit_auto' ? 50 : input.outputPercent ?? 0;
          const mode = input.action === 'restore_unit_auto' ? 'AUTO' : 'MANUAL';
          const watts = Math.round((a.powerRatingWatts * pct) / 100);
          verifiedUnit = {
            id: a.id,
            unitCode: a.unitCode,
            name: a.name,
            outputPercent: pct,
            operatingMode: mode,
            currentPowerWatts: watts,
          };
          return {
            ...a,
            outputPercent: pct,
            operatingMode: mode as 'AUTO' | 'MANUAL',
            currentPowerWatts: watts,
            status: pct === 0 ? 'OFF' : `${pct}%`,
          };
        }
        if (input.type && input.type !== 'all' && a.type !== input.type) return a;
        const pct = input.action === 'restore_room_auto' ? 60 : input.outputPercent ?? 0;
        const mode = input.action === 'restore_room_auto' ? 'AUTO' : 'MANUAL';
        const watts = Math.round((a.powerRatingWatts * pct) / 100);
        return {
          ...a,
          outputPercent: pct,
          operatingMode: mode as 'AUTO' | 'MANUAL',
          currentPowerWatts: watts,
          status: pct === 0 ? 'OFF' : `${pct}%`,
        };
      });
      if ((input.action === 'set_unit' || input.action === 'restore_unit_auto') && !verifiedUnit) {
        return { ok: false, error: `Unit '${input.applianceId}' not found.` };
      }
      const totalPowerWatts = updated.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      roomMap.set(input.roomId, {
        ...rec,
        commandSeq: rec.commandSeq + 1,
        appliances: updated,
        updatedAt: Date.now(),
      });
      return {
        ok: true,
        verified: true,
        roomId: rec.roomId,
        roomCode: rec.roomCode,
        appliances: updated,
        totalPowerWatts,
        summary: `Updated ${rec.roomCode} (${totalPowerWatts}W)`,
        verifiedUnit,
      };
    },
    executeBatchApplianceControl: (input) => {
      const optimizedRooms = [];
      let curtailedWatts = 0;
      for (const rec of roomMap.values()) {
        const before = rec.appliances.reduce((acc, a) => acc + a.currentPowerWatts, 0);
        const pct = input.mode === 'restore_auto' ? 50 : input.outputPercent ?? 0;
        const updated = rec.appliances.map((a) => {
          if (input.targetType !== 'all' && a.type !== input.targetType) return a;
          const watts = Math.round((a.powerRatingWatts * pct) / 100);
          return { ...a, outputPercent: pct, currentPowerWatts: watts, status: pct === 0 ? 'OFF' : `${pct}%` };
        });
        const after = updated.reduce((acc, a) => acc + a.currentPowerWatts, 0);
        curtailedWatts += Math.max(0, before - after);
        optimizedRooms.push({
          roomId: rec.roomId,
          roomCode: rec.roomCode,
          appliances: updated,
          totalPowerWatts: after,
        });
      }
      return {
        ok: true,
        affectedRoomsCount: optimizedRooms.length,
        affectedRoomCodes: optimizedRooms.map((r) => r.roomCode),
        curtailedWatts,
        deltaWatts: -curtailedWatts,
        optimizedRooms,
        summary: `Updated ${optimizedRooms.length} rooms, saved ${curtailedWatts}W`,
      };
    },
    executeCampusOptimization: () => ({
      ok: true,
      affectedRoomsCount: 4,
      curtailedWatts: 620,
      optimizedRooms: [],
      resolvedFindingIds: ['audit-1'],
      summary: 'Optimized 4 rooms, curtailed 620W.',
    }),
    getSecurityAuditAndStaff: (isAdmin) => ({
      staffDirectory: [
        {
          id: 'staff-1',
          name: 'Principal Office',
          role: 'Admin',
          assignedBuilding: 'All Blocks',
          hasPasskey: true,
          passkeyCount: 1,
        },
      ],
      auditTrailRestricted: !isAdmin,
      auditTrail: isAdmin
        ? [
            {
              id: 'evt-1',
              type: 'LOGIN_OK',
              summary: 'Admin signed in',
              timestamp: Date.now(),
            },
          ]
        : [],
    }),
  };
}

const TEST_ADMIN: VoiceAdminIdentity = {
  sessionId: 'sess-admin-1',
  adminId: 'admin-1',
  adminName: 'Campus Admin',
  role: 'Energy Administrator',
  deviceName: 'Test Terminal',
};

function makeExecCtx(adminIdentity: VoiceAdminIdentity | null = null): {
  emitted: VoiceServerMessage[];
  ctx: VoiceCapabilityExecutionContext;
} {
  const emitted: VoiceServerMessage[] = [];
  const memory = createInitialVoiceSessionMemory('dashboard', null);
  return {
    emitted,
    ctx: {
      snapshot: {
        activeTab: 'dashboard',
        activeSubTab: null,
        selectedRoomId: null,
        isAdmin: Boolean(adminIdentity),
        adminName: adminIdentity?.adminName,
        adminRole: adminIdentity?.role,
        settings: INITIAL_SCHOOL_SETTINGS,
        classrooms: INITIAL_CLASSROOMS,
        resolvedFindingIds: [],
        timestamp: Date.now(),
      },
      rooms: INITIAL_CLASSROOMS,
      settings: INITIAL_SCHOOL_SETTINGS,
      adminIdentity,
      memory,
      emitClientMessage: (msg: VoiceServerMessage) => emitted.push(msg),
      delegateLegacyTool: async () => ({ ok: true }),
    },
  };
}

// ---------------------------------------------------------------------------
// 1–4. Core Audio, Pronunciation, Classroom Resolver & Capability Registry
// ---------------------------------------------------------------------------

test('1. PCM16 RMS detector cleanly separates silence frames from vocal speech', () => {
  const silentPcm = Buffer.alloc(4096);
  const loudPcm = Buffer.alloc(4096);
  for (let i = 0; i < 2048; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * i) / 32) * 16000);
    loudPcm.writeInt16LE(sample, i * 2);
  }
  const silentRms = computeBase64Pcm16Rms(silentPcm.toString('base64'));
  const loudRms = computeBase64Pcm16Rms(loudPcm.toString('base64'));
  assert.ok(silentRms < 0.001, `Expected near-zero silence RMS, got ${silentRms}`);
  assert.ok(loudRms > 0.2, `Expected loud speech RMS > 0.2, got ${loudRms}`);
});

test('2. Roman numeral pronunciation converts Class X-B -> Class 10-B for speech while preserving visual labels & acronyms', () => {
  assert.equal(formatRoomNameForSpeech('Class X-B'), 'Class 10-B');
  assert.equal(formatRoomNameForSpeech('Class IX-A'), 'Class 9-A');
  assert.equal(formatRoomNameForSpeech('Class XII-A'), 'Class 12-A');
  assert.equal(formatRoomNameForSpeech('Class VI-A'), 'Class 6-A');
  assert.equal(
    formatRoomNameForSpeech('Class X-B is operating normally with 540 W draw.'),
    'Class 10-B is operating normally with 540 W draw.'
  );
  assert.equal(formatRoomNameForSpeech('ECBC and BEE X-ray check'), 'ECBC and BEE X-ray check');
  assert.equal(normalizeClassroomQuery('Class X-B'), 'class 10 b');
  assert.equal(normalizeClassroomQuery('room ten bee'), 'room 10 b');
  assert.equal(normalizeClassroomQuery('class ex b'), 'class 10 b');
});

test('3. Classroom resolver matches Roman, spoken, compact, and STT forms of Class X-B without matching greetings', () => {
  const variants = ['Class X-B', 'Class 10-B', 'room ten b', '10B', 'ex b', 'X-B', 'G3-G02', 'xb'];
  for (const q of variants) {
    const res = resolveClassroomRobust(INITIAL_CLASSROOMS, q);
    assert.ok(res.match, `Expected "${q}" to match Class X-B`);
    assert.equal(res.match?.name, 'Class X-B');
    assert.equal(res.match?.roomCode, 'G3-G02');
  }
  for (const greeting of ['Hi', 'hi.', 'hello', 'thanks', 'ok', 'why']) {
    const res = resolveClassroomRobust(INITIAL_CLASSROOMS, greeting);
    assert.equal(res.match, undefined, `"${greeting}" must never match a classroom`);
  }
});

test('4. Central Capability Registry covers all 11 ROOMWISE sections, emits ZERO empty Type.OBJECT schemas, and preserves untruncated descriptions', () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const covered = new Set(executor.registry.getCoveredSections());

  for (const sec of ALL_ROOMWISE_SECTIONS) {
    assert.ok(covered.has(sec.id), `Missing voice capability coverage for section: ${sec.id}`);
  }

  const declarations = executor.registry.getFunctionDeclarations();
  assert.ok(declarations.length >= 25, `Expected comprehensive toolset, got ${declarations.length}`);

  for (const decl of declarations) {
    const params = decl.parameters as
      | { type?: unknown; properties?: Record<string, unknown> }
      | undefined;
    if (params && params.type === Type.OBJECT) {
      assert.ok(
        params.properties && Object.keys(params.properties).length > 0,
        `Tool "${decl.name}" must NOT expose an empty Type.OBJECT parameters schema (Gemini rejects empty objects with 400)`
      );
    }
  }

  const navDecl = declarations.find((d) => d.name === 'navigate_roomwise');
  assert.ok(navDecl?.description && navDecl.description.length > 200, 'Tool descriptions must NOT be truncated to 180 chars');
});

// ---------------------------------------------------------------------------
// 5–8. Direct Tool RBAC, Confirmation Gates, Domain Services & Data Integrity
// ---------------------------------------------------------------------------

test('5. Server-side RBAC & confirmation policies are strictly enforced on capability execution', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());

  // Student Mode blocked from appliance control & settings modification
  const studentCtx = makeExecCtx(null);
  const deniedCtrl = await executor.registry.execute(
    'control_classroom_appliance',
    { roomQuery: 'Class X-B', targetType: 'lights_group', mode: 'set', outputPercent: 0 },
    studentCtx.ctx
  );
  assert.equal(deniedCtrl.authorized, false);

  const deniedTariff = await executor.registry.execute(
    'update_campus_settings',
    { tariffPerKWhINR: 9.5 },
    studentCtx.ctx
  );
  assert.equal(deniedTariff.authorized, false);

  // Admin Mode requires confirmation for campus-wide batch control, then executes on confirm_pending_action
  const adminCtx = makeExecCtx(TEST_ADMIN);
  const askConfirm = await executor.registry.execute(
    'control_building_or_campus_appliances',
    { scope: 'campus', targetType: 'lights', mode: 'set', outputPercent: 0 },
    adminCtx.ctx
  );
  assert.equal(askConfirm.confirmationRequired, true);
  assert.ok(adminCtx.ctx.memory.pendingConfirmation);

  const confirmed = await executor.registry.execute('confirm_pending_action', {}, adminCtx.ctx);
  assert.equal(confirmed.ok, true);
  assert.equal(adminCtx.ctx.memory.pendingConfirmation, null);
});

test('6. Core analytical, investigation, and progressive-disclosure knowledge tools return accurate, non-placeholder data', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const { ctx } = makeExecCtx(null);

  let histRound = 0;
  let capturedHistResult: Record<string, unknown> | undefined;
  const histCmd = await executor.executeCommand({
    sessionId: 'test6-hist',
    text: 'How much energy did Class X-B consume yesterday?',
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async (params) => {
        histRound += 1;
        if (histRound === 1) {
          return {
            functionCalls: [
              {
                name: 'get_classroom_energy_history',
                args: { roomQuery: 'Class X-B', period: 'yesterday' },
              },
            ],
          };
        }
        const fnResp = (params.contents[params.contents.length - 1]?.parts?.[0] as {
          functionResponse?: { response?: Record<string, unknown> };
        })?.functionResponse?.response;
        capturedHistResult = fnResp;
        return { text: 'Class X-B historical consumption retrieved.' };
      },
    },
  });
  assert.equal(histCmd.ok, true);
  assert.equal(capturedHistResult?.ok, true);
  const histDetail = (capturedHistResult?.detail || {}) as { totals?: { actualKWh?: number } };
  const histActual =
    typeof capturedHistResult?.actualKWh === 'number'
      ? capturedHistResult.actualKWh
      : histDetail.totals?.actualKWh;
  assert.equal(typeof histActual, 'number');

  let invRound = 0;
  let capturedInv: Record<string, unknown> | undefined;
  const invCmd = await executor.executeCommand({
    sessionId: 'test6-inv',
    text: 'Why did campus electricity usage spike yesterday?',
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async (params) => {
        invRound += 1;
        if (invRound === 1) {
          return {
            functionCalls: [
              {
                name: 'investigate_energy_reason',
                args: { period: 'yesterday' },
              },
            ],
          };
        }
        capturedInv = (params.contents[params.contents.length - 1]?.parts?.[0] as {
          functionResponse?: { response?: Record<string, unknown> };
        })?.functionResponse?.response;
        return { text: 'Investigation complete.' };
      },
    },
  });
  assert.equal(invCmd.ok, true);
  assert.equal(capturedInv?.ok, true);
  assert.ok(
    capturedInv?.targetPeriod &&
      typeof (capturedInv.targetPeriod as Record<string, unknown>).actualKWh === 'number'
  );
  assert.ok(capturedInv?.dayContext, 'Investigation must return dayContext');

  const rcemConcept = await executor.registry.execute(
    'get_roomwise_mathematical_models',
    { topic: 'rcem', depth: 'conceptual' },
    ctx
  );
  assert.equal(rcemConcept.ok, true);
  const conceptReply = String(rcemConcept.recommendedReply || '');
  assert.ok(/counterfactual|baseline/i.test(conceptReply));
  assert.ok(/pending/i.test(conceptReply), 'RCEM must state empirical meter readings are pending');
  assert.ok(!/Σ_\{i=1\.\.N\}|∫_\{t_0\}/.test(conceptReply), 'Conceptual depth must not dump raw equations');

  const rcemMath = await executor.registry.execute(
    'get_roomwise_mathematical_models',
    { topic: 'rcem', depth: 'mathematical' },
    ctx
  );
  const mathReply = String(rcemMath.recommendedReply || '');
  assert.ok(/Σ/.test(mathReply) && /∫/.test(mathReply), 'Mathematical depth must provide discrete & continuous equations');

  const arch = await executor.registry.execute('get_planned_telemetry_architecture', {}, ctx);
  assert.equal(arch.ok, true);
  assert.equal(arch.isLiveHardwareConnected, false);

  assert.equal(SCHOOL_DAYS_PER_MONTH, 22);
  assert.equal(SCHOOL_DAYS_PER_YEAR, 225);
});

test('7. Streaming transcript merger & terminology canonicalizer preserve spaces and proper nouns', () => {
  const chunks = [
    "I'm sorry, but",
    ' modifying',
    ' the tariff price',
    ' requires',
    ' Administrator privileges.',
    ' Please sign in',
    ' as an administrator to make',
    ' these changes.',
  ];
  let acc = '';
  for (const c of chunks) {
    acc = mergeTranscriptChunk(acc, c);
  }
  const merged = finalizeTranscriptText(acc);
  assert.ok(!/modifyingthe|pricerequires|requiresAdministrator|sign inas|makethese/.test(merged));

  assert.equal(normalizeRawUtterance('Tell me about Davos Model School'), 'Tell me about D A V Model School');
  const written = canonicalizeWrittenText(
    'Davos Model School 3D Digital Twin in G plus 3 Block uses 540 watts and 10,080 kilowatt-hours.'
  );
  assert.ok(written.includes(CANONICAL_INSTITUTION_NAME));
  assert.ok(written.includes('3D') && !/three-D/i.test(written));
  assert.ok(written.includes('G+3'));
  assert.ok(written.includes('540 W') && written.includes('10,080 kWh'));

  const spoken = formatTextForSpeech('D A V Model School Class X-B uses 540 W in 3D view.');
  assert.ok(spoken.includes('D-A-V Model School'));
  assert.ok(spoken.includes('Class 10-B'));
  assert.ok(spoken.includes('540 watts'));

  assert.equal(hasForbiddenResponsePlaceholder('X-B used calculated kWh yesterday.'), true);
  const sanitized = validateAndSanitizeAssistantResponse('Paragraph 1.\n\nParagraph 2.');
  assert.equal(sanitized.hadPlaceholder, false);
  assert.equal(sanitized.text, 'Paragraph 1.\n\nParagraph 2.');
});

// ---------------------------------------------------------------------------
// 8–12. Gemini-Centred Orchestration Architecture & Mandatory Regression Guarantees
// ---------------------------------------------------------------------------

test('8. EVERY user message (including "Hi.", "go back", and Romanised Bengali "xb er telemetry ta khul") reaches Gemini UNMODIFIED with zero local interception', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const receivedInputs: string[] = [];

  const inputs = [
    'Hi.',
    'Thanks!',
    'go back',
    'xb er telemetry ta khul',
    'Kal campus e eto electricity use holo keno?',
    'Explain RCEM.',
  ];

  for (const input of inputs) {
    const res = await executor.executeCommand({
      sessionId: `no-intercept-${input}`,
      text: input,
      adminIdentity: null,
      geminiOptions: {
        generateContentOverride: async (params: GeminiGenerateContentCallParams) => {
          const lastMsg = params.contents[params.contents.length - 1];
          const textPart = Array.isArray(lastMsg?.parts) ? lastMsg.parts[0]?.text || '' : '';
          receivedInputs.push(textPart);
          return {
            text: `Gemini processed: ${textPart}`,
          };
        },
      },
    });

    assert.equal(res.ok, true);
    assert.equal(res.llmInvoked, true, `Gemini MUST be invoked for "${input}"`);
    assert.equal(res.modelUsed, NLU_MODEL);
  }

  assert.deepEqual(
    receivedInputs,
    inputs,
    'Every original user message must reach Gemini verbatim without local interception or rewriting'
  );
});

test('9. Romanised Bengali navigation ("xb er telemetry ta khul") allows Gemini to call navigate_roomwise with ZERO English regex blocker', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  let round = 0;

  const res = await executor.executeCommand({
    sessionId: 'bengali-nav-test',
    text: 'xb er telemetry ta khul',
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async (params: GeminiGenerateContentCallParams) => {
        round += 1;
        if (round === 1) {
          // Verify full declarations were supplied to Gemini
          assert.ok(params.functionDeclarations.some((d) => d.name === 'navigate_roomwise'));
          return {
            functionCalls: [
              {
                name: 'navigate_roomwise',
                args: { target: 'classroom', roomQuery: 'Class X-B' },
              },
            ],
          };
        }
        // Round 2: Verify tool execution result was returned to Gemini!
        const lastUserParts = params.contents[params.contents.length - 1]?.parts || [];
        const fnResp = lastUserParts[0] as {
          functionResponse?: { name?: string; response?: Record<string, unknown> };
        };
        assert.equal(fnResp?.functionResponse?.name, 'navigate_roomwise');
        assert.equal(fnResp?.functionResponse?.response?.ok, true);
        assert.equal(fnResp?.functionResponse?.response?.roomCode, 'G3-G02');
        return {
          text: 'Class X-B (G3-G02) er telemetry ta khule diyechhi.',
        };
      },
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.llmInvoked, true);
  assert.deepEqual(res.toolCallsRequested, ['navigate_roomwise']);
  assert.deepEqual(res.toolCallsExecuted, ['navigate_roomwise']);
  const navEvent = res.emittedMessages.find((m) => m.type === 'client_navigation');
  assert.ok(navEvent && navEvent.type === 'client_navigation');
  assert.equal(navEvent.action.target, 'classroom');
  assert.equal(navEvent.action.roomCode, 'G3-G02');
  assert.ok(/Class X-B/i.test(res.visualReply));
});

test('10. Full multi-turn conversation history is preserved and passed to Gemini across follow-up turns', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const sessionId = 'multi-turn-history-test';
  const turnSnapshots: Array<{ count: number; texts: string[] }> = [];

  const stub = async (params: GeminiGenerateContentCallParams) => {
    const texts = params.contents.map((c) => {
      const p0 = Array.isArray(c.parts) ? c.parts[0] : undefined;
      return typeof p0?.text === 'string' ? p0.text : '[tool]';
    });
    turnSnapshots.push({ count: params.contents.length, texts });
    const latest = texts[texts.length - 1];
    return { text: `Reply to: ${latest}` };
  };

  await executor.executeCommand({
    sessionId,
    text: 'How much energy did X-B consume yesterday?',
    adminIdentity: null,
    geminiOptions: { generateContentOverride: stub },
  });
  await executor.executeCommand({
    sessionId,
    text: 'What about the previous day?',
    adminIdentity: null,
    geminiOptions: { generateContentOverride: stub },
  });
  await executor.executeCommand({
    sessionId,
    text: 'Open its telemetry.',
    adminIdentity: null,
    geminiOptions: { generateContentOverride: stub },
  });

  assert.equal(turnSnapshots[0].count, 1);
  assert.equal(turnSnapshots[1].count, 3);
  assert.equal(turnSnapshots[2].count, 5);
  assert.equal(turnSnapshots[2].texts[0], 'How much energy did X-B consume yesterday?');
  assert.equal(turnSnapshots[2].texts[2], 'What about the previous day?');
  assert.equal(turnSnapshots[2].texts[4], 'Open its telemetry.');
});

test('11. Test J — Gemini Unavailable: simulated API failure returns honest error with ZERO fabricated response and ZERO silent rule-based fallback', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());

  const apiFailure = await executor.executeCommand({
    sessionId: 'test-j-api-error',
    text: 'xb er telemetry ta khul',
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async () => {
        throw new Error('503 Service Unavailable: upstream Gemini outage');
      },
    },
  });

  assert.equal(apiFailure.ok, false, 'Simulated Gemini API failure MUST return ok=false');
  assert.equal(apiFailure.llmInvoked, true);
  assert.equal(apiFailure.errorCode, 'GEMINI_UNAVAILABLE');
  assert.deepEqual(apiFailure.toolCallsExecuted, [], 'No silent local tool execution on Gemini failure');
  assert.deepEqual(apiFailure.emittedMessages, [], 'No unsolicited UI events on Gemini failure');
  assert.ok(
    /could not reach|unavailable|try again/i.test(apiFailure.visualReply),
    `Expected honest unavailability notice, got: ${apiFailure.visualReply}`
  );
  assert.ok(
    !/kWh|watts|opened class x-b/i.test(apiFailure.visualReply),
    'Must NOT fabricate telemetry or pretend navigation succeeded'
  );

  // Also verify missing GEMINI_API_KEY fails honestly without falling back to a local chatbot
  const missingKey = await executor.executeCommand({
    sessionId: 'test-j-missing-key',
    text: 'Hi.',
    adminIdentity: null,
    geminiOptions: {
      apiKeyOverride: '',
    },
  });

  assert.equal(missingKey.ok, false);
  assert.equal(missingKey.llmInvoked, false);
  assert.equal(missingKey.modelUsed, null);
  assert.equal(missingKey.errorCode, 'MISSING_API_KEY');
  assert.ok(/not configured|GEMINI_API_KEY/i.test(missingKey.visualReply));
});

test('12. SQLite fast aggregate helpers match getOverview numerically and investigatePeriod preserves full attribution', () => {
  const endDate = shiftIstDate(getIstDateString(), -1);
  const startDate = shiftIstDate(endDate, -13);

  const fullOverview = energyHistoryService.getOverview({
    preset: 'custom',
    startDate,
    endDate,
  });
  const fastDemand = energyHistoryService.getDemandSummaryRange(startDate, endDate);

  assert.equal(fastDemand.daysCount, fullOverview.range.daysCount);
  assert.equal(fastDemand.totalActualKWh, fullOverview.kpis.totalActualKWh);
  assert.equal(fastDemand.averageDailyKWh, fullOverview.kpis.averageDailyKWh);

  const avg7Full = energyHistoryService.getOverview({ preset: 'last_7_days' }).kpis.averageDailyKWh;
  const avg7Quick = energyHistoryService.getAverageDailyKWhQuick('last_7_days');
  assert.ok(Math.abs(avg7Quick - avg7Full) <= 0.05, `7d avg mismatch: ${avg7Quick} vs ${avg7Full}`);

  const avg30Full = energyHistoryService.getOverview({ preset: 'last_30_days' }).kpis.averageDailyKWh;
  const avg30Quick = energyHistoryService.getAverageDailyKWhQuick('last_30_days');
  assert.ok(Math.abs(avg30Quick - avg30Full) <= 0.05, `30d avg mismatch: ${avg30Quick} vs ${avg30Full}`);

  const investigation = energyHistoryService.investigatePeriod({ preset: 'yesterday' });
  assert.equal(investigation.ok, true);
  assert.ok(investigation.targetPeriod.actualKWh >= 0);
  assert.ok(Array.isArray(investigation.topContributingBlocks));
  assert.ok(Array.isArray(investigation.topContributingRooms));
  assert.ok(investigation.narrativeSummary.length > 20);
});

test('13. VoiceCapabilityRegistry caches declarations/catalog and accurately classifies parallel-safe vs serialized tools', () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const decls1 = executor.registry.getFunctionDeclarations();
  const decls2 = executor.registry.getFunctionDeclarations();
  assert.strictEqual(decls1, decls2, 'Cached function declarations should return same array reference');

  const cat1 = executor.registry.buildCapabilityCatalogSummary();
  const cat2 = executor.registry.buildCapabilityCatalogSummary();
  assert.strictEqual(cat1, cat2, 'Cached capability catalog summary should return same string');

  assert.equal(executor.registry.isParallelSafe('get_campus_overview'), true);
  assert.equal(executor.registry.isParallelSafe('navigate_roomwise'), true);
  assert.equal(executor.registry.isParallelSafe('investigate_energy_reason'), true);
  assert.equal(executor.registry.isParallelSafe('update_campus_settings'), false);
  assert.equal(executor.registry.isParallelSafe('control_classroom_appliance'), false);
  assert.equal(executor.registry.isParallelSafe('confirm_pending_action'), false);
});

test('14. Parallel safe tool batch execution emits streaming callbacks (onToolStatus, onClientMessage, onTextDelta) and stage timings', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const toolStatuses: Array<{ toolName: string; status: string }> = [];
  const clientMessages: string[] = [];
  const streamedDeltas: string[] = [];
  let round = 0;

  const res = await executor.executeCommand({
    sessionId: 'parallel-stream-test',
    text: 'Explain X-B energy yesterday and open its telemetry.',
    adminIdentity: null,
    geminiOptions: {
      onToolStatus: (st) => toolStatuses.push({ toolName: st.toolName, status: st.status }),
      onClientMessage: (msg) => clientMessages.push(msg.type),
      onTextDelta: (delta) => streamedDeltas.push(delta),
      generateContentOverride: async () => {
        round += 1;
        if (round === 1) {
          return {
            functionCalls: [
              { name: 'get_classroom_energy_history', args: { roomQuery: 'Class X-B', period: 'yesterday' } },
              { name: 'navigate_roomwise', args: { target: 'classroom', roomQuery: 'Class X-B' } },
            ],
          };
        }
        return {
          text: 'Opened Class X-B (G3-G02) telemetry and summarized its recorded energy.',
        };
      },
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.toolCallsExecuted?.length, 2);
  assert.ok(res.toolCallsExecuted?.includes('get_classroom_energy_history'));
  assert.ok(res.toolCallsExecuted?.includes('navigate_roomwise'));
  assert.ok(toolStatuses.some((s) => s.toolName === 'navigate_roomwise' && s.status === 'completed'));
  assert.ok(clientMessages.includes('client_navigation'), 'Navigation directive must stream immediately via onClientMessage');
  assert.ok(streamedDeltas.length >= 1, 'Text delta must be emitted via onTextDelta');
  assert.ok(res.timings && typeof res.timings.totalMs === 'number' && res.timings.prepMs >= 0);
});

test('15. Per-session classroom snapshot cache allows follow-up commands to omit redundant classrooms payload', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const sessionId = 'compact-snapshot-session';
  const customRooms = INITIAL_CLASSROOMS.map((r) => ({ ...r }));

  // Turn 1 sends classrooms snapshot
  const r1 = await executor.executeCommand({
    sessionId,
    text: 'Check Class X-B',
    classrooms: customRooms,
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async () => ({ text: 'Class X-B checked.' }),
    },
  });
  assert.equal(r1.ok, true);

  // Turn 2 omits classrooms (compact payload) — server uses cached session snapshot seamlessly
  let round = 0;
  const r2 = await executor.executeCommand({
    sessionId,
    text: 'What is X-B live status?',
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async () => {
        round += 1;
        if (round === 1) {
          return {
            functionCalls: [{ name: 'get_classroom_status', args: { roomQuery: 'Class X-B' } }],
          };
        }
        return { text: 'Class X-B (G3-G02) status retrieved from cached session snapshot.' };
      },
    },
  });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.toolCallsExecuted, ['get_classroom_status']);
});

test('16. resolveApplianceUnit resolves luminaire, light, fan sector, and code synonyms cleanly and rejects nonexistent indices', () => {
  const xbSpec = ROOM_APPLIANCE_SPECS.find((s) => s.roomId === 'g3-g02');
  assert.ok(xbSpec);
  const appliances = buildExpandedAppliancesFromSpec(xbSpec);

  assert.equal(resolveApplianceUnit(appliances, 'Luminaire 2')?.unitCode, 'L2');
  assert.equal(resolveApplianceUnit(appliances, 'L2')?.unitCode, 'L2');
  assert.equal(resolveApplianceUnit(appliances, 'Light 2')?.unitCode, 'L2');
  assert.equal(resolveApplianceUnit(appliances, 'Fixture 4')?.unitCode, 'L4');
  assert.equal(resolveApplianceUnit(appliances, 'Fan Sector 1')?.unitCode, 'S1');
  assert.equal(resolveApplianceUnit(appliances, 'S1')?.unitCode, 'S1');
  assert.equal(resolveApplianceUnit(appliances, 'F2')?.unitCode, 'S2');
  assert.equal(resolveApplianceUnit(appliances, 'Luminaire 9'), null);
  assert.equal(resolveApplianceUnit(appliances, 'Fan Sector 9'), null);
});

test('17. Single-unit classroom control mutates only target unit, verifies state, and rejects invalid units/percentages without side effects', async () => {
  const deps = buildTestDeps();
  const executor = createRoomwiseVoiceCommandExecutor(deps);
  const admin: VoiceAdminIdentity = {
    sessionId: 'admin-sess-unit-test',
    adminId: 'staff-1',
    adminName: 'Avijit Kumar Dutta',
    role: 'Geography Faculty · Energy Auditor',
    deviceName: 'Test Workstation',
  };

  // 1. Single luminaire mutation ("Change X-B Luminaire 2 to 67%.") -> ONLY L2 changes
  let round1 = 0;
  const rLum = await executor.executeCommand({
    sessionId: 'unit-ctrl-test',
    text: 'Change X-B Luminaire 2 to 67%.',
    adminIdentity: admin,
    geminiOptions: {
      generateContentOverride: async () => {
        round1 += 1;
        if (round1 === 1) {
          return {
            functionCalls: [
              {
                name: 'control_classroom_appliance',
                args: {
                  roomQuery: 'X-B',
                  targetType: 'unit',
                  unitQuery: 'Luminaire 2',
                  mode: 'set',
                  outputPercent: 67,
                },
              },
            ],
          };
        }
        return { text: 'Set Luminaire 2 (L2) in Class X-B to 67%.' };
      },
    },
  });
  assert.equal(rLum.ok, true);
  const xbAfterLum = deps.getServerRoomsMap().get('g3-g02')!;
  const l1 = xbAfterLum.appliances.find((a) => a.unitCode === 'L1')!;
  const l2 = xbAfterLum.appliances.find((a) => a.unitCode === 'L2')!;
  const l3 = xbAfterLum.appliances.find((a) => a.unitCode === 'L3')!;
  assert.equal(l2.outputPercent, 67);
  assert.equal(l2.operatingMode, 'MANUAL');
  assert.notEqual(l1.outputPercent, 67, 'Other luminaires must remain untouched');
  assert.notEqual(l3.outputPercent, 67, 'Other luminaires must remain untouched');

  // 2. Single fan sector mutation -> ONLY S1 changes, lights untouched
  let round2 = 0;
  const rFan = await executor.executeCommand({
    sessionId: 'unit-ctrl-test',
    text: 'Set Class X-A Fan Sector 1 to 50%.',
    adminIdentity: admin,
    geminiOptions: {
      generateContentOverride: async () => {
        round2 += 1;
        if (round2 === 1) {
          return {
            functionCalls: [
              {
                name: 'control_classroom_appliance',
                args: {
                  roomQuery: 'Class X-A',
                  targetType: 'unit',
                  unitQuery: 'Fan Sector 1',
                  mode: 'set',
                  outputPercent: 50,
                },
              },
            ],
          };
        }
        return { text: 'Set Fan Sector 1 (S1) in Class X-A to 50%.' };
      },
    },
  });
  assert.equal(rFan.ok, true);
  const xaAfterFan = deps.getServerRoomsMap().get('g3-g01')!;
  assert.equal(xaAfterFan.appliances.find((a) => a.unitCode === 'S1')?.outputPercent, 50);
  assert.notEqual(xaAfterFan.appliances.find((a) => a.unitCode === 'S2')?.outputPercent, 50);

  // 3. Validation failure: nonexistent Luminaire 9 -> rejected cleanly, zero mutation
  let round3 = 0;
  const capturedToolErrs: Array<Record<string, unknown>> = [];
  const seqBeforeInvalid = deps.getServerRoomsMap().get('g3-g02')!.commandSeq;
  await executor.executeCommand({
    sessionId: 'unit-ctrl-test',
    text: 'Change X-B Luminaire 9 to 67%.',
    adminIdentity: admin,
    geminiOptions: {
      generateContentOverride: async ({ contents }) => {
        round3 += 1;
        if (round3 === 1) {
          return {
            functionCalls: [
              {
                name: 'control_classroom_appliance',
                args: {
                  roomQuery: 'X-B',
                  targetType: 'unit',
                  unitQuery: 'Luminaire 9',
                  mode: 'set',
                  outputPercent: 67,
                },
              },
            ],
          };
        }
        const fnResp = contents[contents.length - 1]?.parts?.[0]?.functionResponse?.response as
          | Record<string, unknown>
          | undefined;
        if (fnResp) capturedToolErrs.push(fnResp);
        return { text: 'Luminaire 9 does not exist in Class X-B.' };
      },
    },
  });
  assert.equal(capturedToolErrs[0]?.ok, false);
  assert.equal(deps.getServerRoomsMap().get('g3-g02')!.commandSeq, seqBeforeInvalid);

  // 4. Validation failure: out-of-range 150% -> rejected cleanly, zero mutation
  let round4 = 0;
  const capturedRangeErrs: Array<Record<string, unknown>> = [];
  await executor.executeCommand({
    sessionId: 'unit-ctrl-test',
    text: 'Change X-B Luminaire 2 to 150%.',
    adminIdentity: admin,
    geminiOptions: {
      generateContentOverride: async ({ contents }) => {
        round4 += 1;
        if (round4 === 1) {
          return {
            functionCalls: [
              {
                name: 'control_classroom_appliance',
                args: {
                  roomQuery: 'X-B',
                  targetType: 'unit',
                  unitQuery: 'Luminaire 2',
                  mode: 'set',
                  outputPercent: 150,
                },
              },
            ],
          };
        }
        const fnResp = contents[contents.length - 1]?.parts?.[0]?.functionResponse?.response as
          | Record<string, unknown>
          | undefined;
        if (fnResp) capturedRangeErrs.push(fnResp);
        return { text: 'Intensity must be between 0% and 100%.' };
      },
    },
  });
  assert.equal(capturedRangeErrs[0]?.ok, false);
  assert.equal(deps.getServerRoomsMap().get('g3-g02')!.commandSeq, seqBeforeInvalid);
});

// ---------------------------------------------------------------------------
// 18–20. Multilingual Native Scripts, Equivalent Partial-Day Comparison & Hybrid Escalation
// ---------------------------------------------------------------------------

test('18. Multilingual native-script transcript merging & canonicalizer handle Bengali, Hindi, Malayalam, Tamil, and Urdu without corrupting technical tokens', () => {
  const cases: Array<{ chunks: string[]; mustInclude: string[]; mustNotInclude?: RegExp }> = [
    {
      chunks: ['আজকে ', 'Class X-B এর ', 'মোট বিদ্যুৎ ব্যবহার ', '42.5 kWh।', 'এটি স্বাভাবিক।'],
      mustInclude: ['Class X-B', '42.5 kWh। একটি স্বাভাবিক।'.replace('একটি', 'এটি'), 'মোট'],
    },
    {
      chunks: ['कल ', 'D A V Model School ', 'में ', '540 W लोड था।', 'यह सामान्य है।'],
      mustInclude: ['D A V Model School', '540 W', 'लोड था। यह'],
    },
    {
      chunks: ['ഇന്ന് ', 'G+3 ব্লക്കിൽ'.replace('ব্লക്കിൽ', 'ബ്ലോക്കിൽ '), '3D മോഡൽ ', 'തുറന്നിട്ടുണ്ട്।', 'താപനില normal ആണ്.'],
      mustInclude: ['G+3', '3D', 'ബ്ലോക്കിൽ'],
    },
    {
      chunks: ['இன்று ', 'Class X-B ', 'மின்சாரம் ', '12.4 kWh.', 'சரி.'],
      mustInclude: ['Class X-B', '12.4 kWh. சரி.'],
    },
    {
      chunks: ['کل ', 'G3-G02 میں ', 'بجلی کی کھپت ', '10.2 kWh تھی؟', 'جی ہاں۔'],
      mustInclude: ['G3-G02', '10.2 kWh تھی؟ جی ہاں۔'],
    },
  ];

  for (const c of cases) {
    let acc = '';
    for (const chunk of c.chunks) {
      acc = mergeTranscriptChunk(acc, chunk);
    }
    const final = finalizeTranscriptText(acc);
    for (const token of c.mustInclude) {
      assert.ok(final.includes(token), `Expected "${token}" inside "${final}"`);
    }
    if (c.mustNotInclude) {
      assert.ok(!c.mustNotInclude.test(final), `Unexpected match in "${final}"`);
    }
  }
});

test('19. compareEnergyPeriods and compare_energy_periods resolve contextual prior period/room and compare yesterday vs today using equivalent elapsed IST window', async () => {
  // Direct service test: yesterday vs today at campus scale and single-room scale
  const campusCmp = energyHistoryService.compareEnergyPeriods({
    periodAQuery: 'yesterday',
    periodBQuery: 'today',
    settings: INITIAL_SCHOOL_SETTINGS,
  });
  assert.equal(campusCmp.ok, true);
  assert.equal(campusCmp.hasPartialDay, true);
  assert.equal(campusCmp.comparisonBasis, 'equivalent_elapsed_window');
  assert.ok(campusCmp.partialDayDisclosure && /partial day/i.test(campusCmp.partialDayDisclosure));
  assert.ok(campusCmp.equivalentWindowComparison, 'Must provide equivalentWindowComparison when today is partial');
  assert.ok(campusCmp.equivalentWindowComparison.hoursComparedCount >= 1);
  assert.ok(campusCmp.equivalentWindowComparison.periodAKWh >= 0);
  assert.ok(campusCmp.equivalentWindowComparison.periodBKWh >= 0);

  // Room-scoped comparison ("yesterday" -> "compare it with today") via executor
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  let roundA = 0;
  await executor.executeCommand({
    sessionId: 'ctx-compare-session',
    text: 'How much energy did Class X-B consume yesterday?',
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async () => {
        roundA += 1;
        if (roundA === 1) {
          return {
            functionCalls: [
              {
                name: 'get_classroom_energy_history',
                args: { roomQuery: 'Class X-B', period: 'yesterday' },
              },
            ],
          };
        }
        return { text: 'Class X-B recorded yesterday energy usage.' };
      },
    },
  });

  let roundB = 0;
  let capturedCompareResult: Record<string, unknown> | undefined;
  const cmpCmd = await executor.executeCommand({
    sessionId: 'ctx-compare-session',
    text: 'Compare it with today.',
    adminIdentity: null,
    geminiOptions: {
      generateContentOverride: async (params) => {
        roundB += 1;
        if (roundB === 1) {
          return {
            functionCalls: [
              {
                name: 'compare_energy_periods',
                args: { periodA: 'it', periodB: 'today' },
              },
            ],
          };
        }
        capturedCompareResult = (params.contents[params.contents.length - 1]?.parts?.[0] as {
          functionResponse?: { response?: Record<string, unknown> };
        })?.functionResponse?.response;
        return { text: 'Compared yesterday against today over equivalent IST hours for Class X-B.' };
      },
    },
  });

  assert.equal(cmpCmd.ok, true);
  assert.equal(capturedCompareResult?.ok, true);
  assert.equal(capturedCompareResult?.roomCode, 'G3-G02', 'Must inherit Class X-B context scope');
  assert.equal(capturedCompareResult?.hasPartialDay, true);
  assert.equal(capturedCompareResult?.comparisonBasis, 'equivalent_elapsed_window');
  const periodARes = capturedCompareResult?.periodA as { range?: { startDate?: string } } | undefined;
  assert.equal(periodARes?.range?.startDate, shiftIstDate(getIstDateString(), -1));

  // Missing future date range returns dataAvailable=false honestly instead of inventing numbers
  const missingCmp = energyHistoryService.compareEnergyPeriods({
    periodAQuery: '2099-01-01',
    periodBQuery: 'today',
    settings: INITIAL_SCHOOL_SETTINGS,
  });
  assert.equal(missingCmp.ok, false);
  assert.equal(missingCmp.dataAvailable, false);
  assert.equal(missingCmp.comparisonBasis, 'insufficient_data');
});

test('20. Hybrid consult_deep_reasoning isolates Hydrogen to read-only analytical tools, preserves conversation context, and honors abortSignal on interruption', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const readOnlyNames = new Set(
    executor.registry.getReadOnlyAnalyticalDeclarations().map((d) => d.name)
  );

  // Strict safety isolation: no mutations, navigation, confirmation, or recursion
  for (const forbidden of [
    'control_classroom_appliance',
    'control_building_or_campus_appliances',
    'optimize_campus_energy',
    'update_campus_settings',
    'navigate_roomwise',
    'execute_app_action',
    'confirm_pending_action',
    'cancel_pending_action',
    'consult_deep_reasoning',
  ]) {
    assert.ok(!readOnlyNames.has(forbidden), `Read-only Hydrogen toolset must exclude ${forbidden}`);
  }
  assert.ok(readOnlyNames.has('get_solar_assessment'));
  assert.ok(readOnlyNames.has('investigate_energy_reason'));
  assert.ok(readOnlyNames.has('compare_energy_periods'));

  const execCtx = makeExecCtx(null);
  execCtx.ctx.memory.recentTurns.push(
    { role: 'user', text: 'Class X-B er energy check koro', timestamp: Date.now() - 5000 },
    { role: 'assistant', text: 'Class X-B বর্তমানে স্বাভাবিক অবস্থায় আছে।', timestamp: Date.now() - 3000 }
  );

  let deepRound = 0;
  let capturedPromptContents = '';
  execCtx.ctx.deepReasoningOverride = async (params: GeminiGenerateContentCallParams) => {
    deepRound += 1;
    assert.equal(params.model, 'gemini-4-hydrogen');
    capturedPromptContents = params.contents
      .map((c) => (Array.isArray(c.parts) && typeof c.parts[0]?.text === 'string' ? c.parts[0].text : ''))
      .join('\n');
    if (deepRound === 1) {
      return {
        functionCalls: [
          { name: 'get_solar_assessment', args: { scenario: 'moderate' } },
        ],
      };
    }
    return {
      text: 'G+3 Block ও Class X-B-এর জন্য PVGIS প্যানেল অনুমান এবং বর্তমান ট্যারিফ বিশ্লেষণ সম্পন্ন হয়েছে।',
    };
  };

  const deepResult = await executor.registry.execute(
    'consult_deep_reasoning',
    {
      question: 'Compare rooftop solar offset against our G+3 block consumption trend',
      focusScope: 'G+3 Block',
    },
    execCtx.ctx
  );

  assert.equal(deepResult.ok, true);
  assert.ok(
    capturedPromptContents.includes('Class X-B er energy check koro'),
    'Deep reasoning must receive prior session history'
  );
  assert.deepEqual(deepResult.toolsConsulted, ['get_solar_assessment']);
  assert.ok(String(deepResult.synthesizedAnalysis).includes('PVGIS'));
  assert.equal('modelUsed' in deepResult, false, 'Internal model name must not leak to conversation layer');

  // Abort propagation on barge-in / interrupt
  const abortCtrl = new AbortController();
  abortCtrl.abort();
  execCtx.ctx.abortSignal = abortCtrl.signal;
  const abortedResult = await executor.registry.execute(
    'consult_deep_reasoning',
    { question: 'Run another long synthesis' },
    execCtx.ctx
  );
  assert.equal(abortedResult.ok, false);
  assert.equal(abortedResult.aborted, true);
});



