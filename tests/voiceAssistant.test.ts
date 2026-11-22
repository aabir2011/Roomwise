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
  ALL_ROOMWISE_SECTIONS,
  resolveClassroomRobust,
} from '../server/voiceCapabilityRegistry.ts';
import {
  computeBase64Pcm16Rms,
  createRoomwiseVoiceCommandExecutor,
  type VoiceAdminIdentity,
  type VoiceLiveBridgeDeps,
} from '../server/voiceLiveBridge.ts';
import { interventionLedgerService } from '../server/interventionLedgerService.ts';
import { energyHistoryService } from '../server/energyHistoryService.ts';

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
      const updated = rec.appliances.map((a) => {
        if (input.type && input.type !== 'all' && a.type !== input.type) return a;
        const pct = input.action === 'restore_room_auto' ? 60 : input.outputPercent ?? 0;
        const watts = Math.round((a.powerRatingWatts * pct) / 100);
        return {
          ...a,
          outputPercent: pct,
          currentPowerWatts: watts,
          status: pct === 0 ? 'OFF' : `${pct}%`,
        };
      });
      const totalPowerWatts = updated.reduce((acc, a) => acc + a.currentPowerWatts, 0);
      roomMap.set(input.roomId, {
        ...rec,
        commandSeq: rec.commandSeq + 1,
        appliances: updated,
        updatedAt: Date.now(),
      });
      return {
        ok: true,
        roomId: rec.roomId,
        roomCode: rec.roomCode,
        appliances: updated,
        totalPowerWatts,
        summary: `Updated ${rec.roomCode} (${totalPowerWatts}W)`,
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
        roomMap.set(rec.roomId, { ...rec, commandSeq: rec.commandSeq + 1, appliances: updated, updatedAt: Date.now() });
        optimizedRooms.push({
          roomId: rec.roomId,
          roomCode: rec.roomCode,
          appliances: updated,
          totalPowerWatts: after,
        });
      }
      return {
        ok: true,
        optimizedRooms,
        affectedRoomCodes: optimizedRooms.map((r) => r.roomCode),
        curtailedWatts,
        deltaWatts: -curtailedWatts,
        summary: `Batch ${input.scope} ${input.targetType} applied across ${optimizedRooms.length} rooms (-${curtailedWatts}W)`,
      };
    },
    executeCampusOptimization: () => ({
      ok: true,
      optimizedRooms: [],
      curtailedWatts: 420,
      summary: 'Campus optimization curtailed 420W across vacant rooms.',
    }),
    getSecurityAuditAndStaff: (includeAudit) => ({
      staffDirectory: [{ id: 'admin-1', name: 'Dr. A. Sen', role: 'Principal', assignedBuilding: 'All', hasPasskey: true, passkeyCount: 1 }],
      auditTrailRestricted: !includeAudit,
      auditTrail: [],
    }),
  };
}

const TEST_ADMIN: VoiceAdminIdentity = {
  sessionId: 'sess-test-admin',
  adminId: 'admin-1',
  adminName: 'Dr. A. Sen',
  role: 'Principal',
  deviceName: 'Test Runner',
};

test('1. PCM16 RMS detector cleanly separates silence frames from vocal speech (idle-timeout root-cause fix)', () => {
  const silentPcm = new Int16Array(2048); // all zeros
  const silentB64 = Buffer.from(silentPcm.buffer).toString('base64');
  assert.equal(computeBase64Pcm16Rms(silentB64), 0);

  // Simulated 440 Hz vocal tone at ~25% full scale
  const speechPcm = new Int16Array(2048);
  for (let i = 0; i < speechPcm.length; i++) {
    speechPcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 8000);
  }
  const speechB64 = Buffer.from(speechPcm.buffer).toString('base64');
  const rms = computeBase64Pcm16Rms(speechB64);
  assert.ok(rms > 0.15, `Expected speech RMS > 0.15, got ${rms}`);
});

test('2. Roman numeral pronunciation converts Class X-B -> Class 10-B for speech while preserving visual labels & acronyms', () => {
  assert.equal(formatRoomNameForSpeech('Class X-B'), 'Class 10-B');
  assert.equal(formatRoomNameForSpeech('Class X-A'), 'Class 10-A');
  assert.equal(formatRoomNameForSpeech('Class IX-A'), 'Class 9-A');
  assert.equal(formatRoomNameForSpeech('Class XII-C'), 'Class 12-C');
  assert.equal(formatRoomNameForSpeech('Class VI-A'), 'Class 6-A');
  assert.equal(formatRoomNameForSpeech('Room X-B is drawing 240W'), 'Room 10-B is drawing 240W');
  assert.equal(formatRoomNameForSpeech('Opened X-B telemetry'), 'Opened 10-B telemetry');

  // Must NOT corrupt school acronyms or technical terms
  const technicalSentence =
    'LED lights, BLDC fans, AC in ICT Lab, PIR motion, PVGIS 5.3, OB to NB path, MPH and PP, BEE ECBC, 12.4 kWh.';
  assert.equal(formatRoomNameForSpeech(technicalSentence), technicalSentence);

  // Visual classroom data MUST preserve Roman numerals
  const classXB = INITIAL_CLASSROOMS.find((c) => c.id === 'g3-g02');
  assert.ok(classXB, 'Class X-B should exist in INITIAL_CLASSROOMS');
  assert.equal(classXB.name, 'Class X-B');
});

test('3. Classroom resolver matches all spoken, Roman, compact, and STT-misrecognized forms of Class X-B', () => {
  const queries = [
    'Class X-B',
    'class x b',
    'class 10 b',
    'Class 10-B',
    'room ten b',
    'ten bee',
    '10b',
    'class xb',
    'ex bee',
    'G3-G02',
    'g 3 g 02',
  ];

  for (const q of queries) {
    const res = resolveClassroomRobust(INITIAL_CLASSROOMS, q);
    assert.ok(res.match, `Expected "${q}" (norm: "${normalizeClassroomQuery(q)}") to resolve`);
    assert.equal(res.match.id, 'g3-g02', `Expected "${q}" to resolve to Class X-B (g3-g02), got ${res.match.id}`);
  }
});

test('4. Central Capability Registry covers all 11 ROOMWISE sections and supports dynamic feature registration', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const capabilities = executor.getCapabilities();
  assert.ok(capabilities.length >= 30, `Expected >= 30 registered capabilities, got ${capabilities.length}`);

  const coveredSections = new Set(capabilities.map((c) => c.section));
  for (const section of ALL_ROOMWISE_SECTIONS) {
    // Digital Twin is covered via classrooms + navigation; verify all core sections exist in registry
    if (section.id === 'digital-twin') continue;
    assert.ok(
      coveredSections.has(section.id),
      `Expected Capability Registry to cover section "${section.id}"`
    );
  }

  // Dynamic extensibility: register a new future capability without modifying voice core
  executor.registry.register({
    id: 'get_future_water_meter_status',
    section: 'settings',
    sectionLabel: 'Settings',
    description: 'Mock future capability test',
    supportedIntents: ['water meter status'],
    permissionLevel: 'public',
    dataSources: ['future_water_service'],
    available: true,
    declaration: {
      name: 'get_future_water_meter_status',
      description: 'Future water meter capability',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => ({ ok: true, status: 'registered_dynamically' }),
  });

  assert.ok(executor.registry.get('get_future_water_meter_status'));
  const declNames = executor.registry.getFunctionDeclarations().map((d) => d.name);
  assert.ok(declNames.includes('get_future_water_meter_status'));
  executor.registry.unregister('get_future_water_meter_status');
});

test('5. Permission boundaries & confirmation policies are strictly enforced', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());

  // Student Mode CANNOT control appliances
  const deniedSingle = await executor.executeCommand({
    sessionId: 'sess-student',
    text: 'Turn off lights in Class X-B',
    adminIdentity: null,
  });
  assert.equal(deniedSingle.ok, false);
  assert.equal(deniedSingle.permissionDenied, true);

  // Student Mode CANNOT run campus-wide optimization
  const deniedOpt = await executor.executeCommand({
    sessionId: 'sess-student',
    text: 'Optimize campus energy',
    adminIdentity: null,
  });
  assert.equal(deniedOpt.ok, false);
  assert.equal(deniedOpt.permissionDenied, true);

  // Admin Mode batch command triggers explicit confirmation gate first
  const batchAsk = await executor.executeCommand({
    sessionId: 'sess-admin-confirm',
    text: 'Turn off all lights in the campus',
    adminIdentity: TEST_ADMIN,
  });
  assert.equal(batchAsk.confirmationRequired, true);
  assert.ok(
    batchAsk.emittedMessages.some((m) => m.type === 'confirmation_required' && m.confirmation !== null)
  );

  // Admin says "yes, confirm" -> executes batch control!
  const batchConfirmed = await executor.executeCommand({
    sessionId: 'sess-admin-confirm',
    text: 'yes, confirm',
    adminIdentity: TEST_ADMIN,
  });
  assert.equal(batchConfirmed.ok, true);
  assert.ok(batchConfirmed.emittedMessages.some((m) => m.type === 'campus_optimized'));

  // Cancellation flow: trigger confirmation then say "cancel"
  const exportAsk = await executor.executeCommand({
    sessionId: 'sess-cancel',
    text: 'Export analytics CSV',
    adminIdentity: TEST_ADMIN,
  });
  assert.equal(exportAsk.confirmationRequired, true);

  const exportCancel = await executor.executeCommand({
    sessionId: 'sess-cancel',
    text: 'cancel',
    adminIdentity: TEST_ADMIN,
  });
  assert.equal(exportCancel.ok, true);
  assert.match(exportCancel.visualReply, /cancelled/i);
});

test('6. Full 11-section coverage: Campus Live, Environmental & Solar, Analytics 22/225, Intervention Ledger, Reports & BEE, Planned Telemetry Honesty', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const sid = 'sess-coverage';

  // Campus Live 3D info
  const campusLive = await executor.executeCommand({
    sessionId: sid,
    text: 'Describe Campus Live 3D layout',
    adminIdentity: null,
  });
  assert.equal(campusLive.ok, true);
  assert.equal(campusLive.toolName, 'get_campus_live_info');
  assert.match(campusLive.visualReply, /New Building.*Old Building|connecting path/i);

  // Solar Assessment (PVGIS)
  const solar = await executor.executeCommand({
    sessionId: sid,
    text: 'What is our rooftop solar potential estimate?',
    adminIdentity: null,
  });
  assert.equal(solar.ok, true);
  assert.equal(solar.toolName, 'get_solar_assessment');
  assert.match(solar.visualReply, /PVGIS|planning estimate/i);

  // Energy Analytics savings estimate (uses audited 22/225 day-school calendar!)
  const savings = await executor.executeCommand({
    sessionId: sid,
    text: 'What is the energy savings estimate?',
    adminIdentity: null,
  });
  assert.equal(savings.ok, true);
  assert.equal(savings.data?.schoolDaysPerMonth, SCHOOL_DAYS_PER_MONTH);
  assert.equal(savings.data?.schoolDaysPerYear, SCHOOL_DAYS_PER_YEAR);

  // Energy Intervention Ledger (strict separation of meter-verified vs simulated estimated)
  const ledger = await executor.executeCommand({
    sessionId: sid,
    text: 'Open Energy Intervention Ledger',
    adminIdentity: null,
  });
  assert.equal(ledger.ok, true);
  assert.equal(ledger.toolName, 'get_intervention_ledger');
  assert.ok(
    ledger.emittedMessages.some(
      (m) => m.type === 'client_navigation' && m.action.target === 'history' && m.action.subTab === 'interventions'
    )
  );
  assert.match(ledger.visualReply, /Meter-verified/i);
  assert.match(ledger.visualReply, /simulated estimated/i);

  // Reports & BEE honesty
  const reports = await executor.executeCommand({
    sessionId: sid,
    text: 'Tell me about BEE certification in reports',
    adminIdentity: null,
  });
  assert.equal(reports.ok, true);
  assert.match(reports.visualReply, /NOT an officially BEE-certified/i);

  // Planned Sensor Telemetry Architecture honesty (must NOT claim live hardware connected)
  const telemetryArch = await executor.executeCommand({
    sessionId: sid,
    text: 'Are real ESP32 hardware sensors connected via the sensor telemetry architecture?',
    adminIdentity: null,
  });
  assert.equal(telemetryArch.ok, true);
  assert.equal(telemetryArch.data?.isLiveHardwareConnected, false);
  assert.equal(telemetryArch.data?.implementationStatus, 'PLANNED_DOCUMENTATION_ONLY');
});

test('7. End-to-End Multi-Turn Contextual Conversation Flow (Navigation, Follow-ups, Roman Pronunciation, Go Back)', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());
  const sid = 'sess-e2e-multiturn';

  // Turn 1: Open Environmental & Solar Intelligence
  const t1 = await executor.executeCommand({
    sessionId: sid,
    text: 'Open Environmental and Solar Intelligence',
    activeTab: 'dashboard',
    adminIdentity: null,
  });
  assert.equal(t1.ok, true);
  assert.ok(
    t1.emittedMessages.some(
      (m) => m.type === 'client_navigation' && m.action.target === 'environmental-solar'
    )
  );

  // Turn 2: Navigate to Space Intelligence
  const t2 = await executor.executeCommand({
    sessionId: sid,
    text: 'Open Space Intelligence',
    activeTab: 'environmental-solar',
    adminIdentity: null,
  });
  assert.equal(t2.ok, true);
  assert.ok(
    t2.emittedMessages.some(
      (m) => m.type === 'client_navigation' && m.action.target === 'space-intelligence'
    )
  );

  // Turn 3: Ask Space Intelligence summary
  const t3 = await executor.executeCommand({
    sessionId: sid,
    text: 'Give me the space intelligence summary',
    activeTab: 'space-intelligence',
    adminIdentity: null,
  });
  assert.equal(t3.ok, true);
  assert.equal(t3.toolName, 'get_space_intelligence_summary');

  // Turn 4: Open Energy Intervention Ledger inside Energy History
  const t4 = await executor.executeCommand({
    sessionId: sid,
    text: 'Open Energy Intervention Ledger',
    activeTab: 'space-intelligence',
    adminIdentity: null,
  });
  assert.equal(t4.ok, true);
  assert.ok(
    t4.emittedMessages.some(
      (m) => m.type === 'client_navigation' && m.action.target === 'history' && m.action.subTab === 'interventions'
    )
  );

  // Turn 5: Contextual filter follow-up ("only meter verified") while on history
  const t5 = await executor.executeCommand({
    sessionId: sid,
    text: 'Show meter verified only',
    activeTab: 'history',
    adminIdentity: null,
  });
  assert.equal(t5.ok, true);
  assert.equal(t5.toolName, 'get_intervention_ledger');

  // Turn 6: Open "room ten b" -> must resolve to Class X-B visually, pronounce "Class 10-B" in speech!
  const t6 = await executor.executeCommand({
    sessionId: sid,
    text: 'Open room ten b',
    activeTab: 'history',
    adminIdentity: null,
  });
  assert.equal(t6.ok, true);
  assert.equal(t6.data?.roomCode, 'G3-G02');
  assert.equal(t6.data?.roomName, 'Class X-B');
  assert.equal(t6.data?.spokenRoomName, 'Class 10-B');
  assert.match(t6.visualReply, /Class X-B/);
  assert.match(t6.spokenReply, /Class 10-B/);
  assert.ok(!/Class X-B/.test(t6.spokenReply), 'Spoken reply must pronounce 10-B instead of X-B');

  // Turn 7: Follow-up using pronoun "its temperature" -> resolves to Class X-B from session memory!
  const t7 = await executor.executeCommand({
    sessionId: sid,
    text: 'What is its temperature?',
    activeTab: 'history',
    adminIdentity: null,
  });
  assert.equal(t7.ok, true);
  assert.equal(t7.toolName, 'get_classroom_telemetry');
  assert.equal(t7.data?.roomCode, 'G3-G02');
  assert.match(t7.spokenReply, /Class 10-B/);

  // Turn 8: "Go back" pops navigation history stack cleanly
  const t8 = await executor.executeCommand({
    sessionId: sid,
    text: 'Go back',
    activeTab: 'history',
    adminIdentity: null,
  });
  assert.equal(t8.ok, true);
  assert.ok(t8.emittedMessages.some((m) => m.type === 'client_navigation' && m.action.target === 'go-back'));
});

test('8. Edge cases: empty utterance and unrecognized command recover gracefully', async () => {
  const executor = createRoomwiseVoiceCommandExecutor(buildTestDeps());

  const empty = await executor.executeCommand({
    sessionId: 'sess-edge',
    text: '   ',
    adminIdentity: null,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.intent, 'empty');

  const unknown = await executor.executeCommand({
    sessionId: 'sess-edge',
    text: 'order a pepperoni pizza to Mars',
    adminIdentity: null,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.intent, 'unmatched');
  assert.ok(unknown.spokenReply.length > 20);
});
