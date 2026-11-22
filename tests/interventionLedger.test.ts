/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  InterventionLedgerService,
  circuitsConflict,
  computeNonOverlappingInterval,
  evaluateInterventionEnergyAndOverlap,
  resolveStrictVerificationStatus,
} from '../server/interventionLedgerService.ts';
import type { CreateInterventionInput } from '../src/types/interventionLedger.ts';

function createFreshService(): InterventionLedgerService {
  const db = new DatabaseSync(':memory:');
  const service = new InterventionLedgerService(db);
  service.initialize({ seedDemonstrationData: false });
  return service;
}

const BASE_TS = Date.parse('2026-11-20T04:30:00.000Z'); // 10:00 IST on 2026-11-20
const MIN = 60 * 1000;

function makeInput(overrides: Partial<CreateInterventionInput> = {}): CreateInterventionInput {
  return {
    roomId: 'nb-102',
    source: 'simulated',
    isDemonstrationData: true,
    triggerTsMs: BASE_TS,
    startTsMs: BASE_TS,
    endTsMs: BASE_TS + 60 * MIN,
    triggerCategory: 'pir_vacancy',
    triggerSummary: 'Vacancy hold shed in NB-102',
    evidenceSummary: 'PIR no-motion hold exceeded 8 minutes.',
    sensorSnapshot: {
      pirStatus: 'No Motion Detected',
      lastMotionMinutesAgo: 8,
      dataOrigin: 'simulated_node',
    },
    ruleLogic: 'PIR Vacancy Hold (>= 8 min)',
    affectedCircuitId: 'nb-102-lights',
    affectedCircuitName: 'LED Tube Array (320 W)',
    circuitType: 'lights',
    previousState: '100% (320 W)',
    newState: '0% OFF (0 W)',
    actionPerformed: 'Switched LED circuit OFF',
    actionStatus: 'completed',
    actor: 'ROOMWISE Adaptive Controller',
    counterfactualBaselineWatts: 320,
    postInterventionWatts: 0,
    baselineMethod: 'previous_state_power',
    baselineExplanation: 'Pre-action active power observed prior to shed.',
    assumptions: ['Room remained vacant for the recorded interval.'],
    loadRatingSource: 'ROOM_APPLIANCE_SPECS (nb-102 lights)',
    ...overrides,
  };
}

test('1. Energy calculations are dimensionally accurate (W × h = Wh, ÷ 1000 = kWh)', () => {
  // 240 W reduced to 60 W = 180 W delta over 90 min (1.5 h) = 270 Wh = 0.27 kWh
  const res = evaluateInterventionEnergyAndOverlap({
    actionStatus: 'completed',
    startTsMs: BASE_TS,
    endTsMs: BASE_TS + 90 * MIN,
    counterfactualBaselineWatts: 240,
    postInterventionWatts: 60,
    baselineMethod: 'previous_state_power',
    baselineExplanation: 'Measured pre-dimming state.',
    assumptions: [],
    loadRatingSource: 'ROOM_APPLIANCE_SPECS',
    existingCountedIntervals: [],
  });

  assert.equal(res.durationMinutes, 90);
  assert.equal(res.energyCalculation.calculable, true);
  assert.equal(res.energyCalculation.powerDifferenceWatts, 180);
  assert.equal(res.energyCalculation.rawDurationHours, 1.5);
  assert.equal(res.energyCalculation.attributedDurationHours, 1.5);
  assert.equal(res.energyCalculation.rawEnergyAvoidedWh, 270);
  assert.equal(res.energyCalculation.attributedEnergyAvoidedWh, 270);
  assert.equal(res.energyCalculation.attributedEnergyAvoidedKwh, 0.27);
  assert.equal(res.overlap.countedInTotals, true);
  assert.equal(res.overlap.status, 'counted_full');

  // Zero or negative power reduction must not fabricate savings
  const zeroDelta = evaluateInterventionEnergyAndOverlap({
    actionStatus: 'completed',
    startTsMs: BASE_TS,
    endTsMs: BASE_TS + 60 * MIN,
    counterfactualBaselineWatts: 100,
    postInterventionWatts: 120,
    baselineMethod: 'previous_state_power',
    baselineExplanation: 'Post load exceeded baseline.',
    assumptions: [],
    loadRatingSource: 'ROOM_APPLIANCE_SPECS',
    existingCountedIntervals: [],
  });
  assert.equal(zeroDelta.energyCalculation.calculable, false);
  assert.equal(zeroDelta.energyCalculation.attributedEnergyAvoidedWh, null);
  assert.equal(zeroDelta.overlap.countedInTotals, false);
});

test('2. Grouped independent circuits in the same room (lights + fans) both count cleanly without conflict', () => {
  const svc = createFreshService();
  const groupId = 'grp-nb102-vac-1';

  assert.equal(
    circuitsConflict(
      { affectedCircuitId: 'nb-102-lights', circuitType: 'lights' },
      { affectedCircuitId: 'nb-102-fans', circuitType: 'fan' }
    ),
    false
  );

  const lightsRes = svc.recordIntervention(
    makeInput({
      id: 'evt-lights-1',
      idempotencyKey: 'key-lights-1',
      eventGroupId: groupId,
      affectedCircuitId: 'nb-102-lights',
      circuitType: 'lights',
      counterfactualBaselineWatts: 320,
      postInterventionWatts: 0,
      startTsMs: BASE_TS,
      endTsMs: BASE_TS + 60 * MIN, // 320 Wh
    })
  );

  const fansRes = svc.recordIntervention(
    makeInput({
      id: 'evt-fans-1',
      idempotencyKey: 'key-fans-1',
      eventGroupId: groupId,
      affectedCircuitId: 'nb-102-fans',
      affectedCircuitName: 'Ceiling Fans (420 W)',
      circuitType: 'fan',
      counterfactualBaselineWatts: 420,
      postInterventionWatts: 0,
      startTsMs: BASE_TS,
      endTsMs: BASE_TS + 60 * MIN, // 420 Wh
    })
  );

  assert.equal(lightsRes.created, true);
  assert.equal(fansRes.created, true);
  assert.equal(lightsRes.record.overlap.status, 'counted_full');
  assert.equal(fansRes.record.overlap.status, 'counted_full');

  const list = svc.listInterventions({ startDate: '2026-11-20', endDate: '2026-11-20' });
  assert.equal(list.summary.totalInterventions, 2);
  assert.equal(list.summary.countedInterventions, 2);
  assert.equal(list.summary.estimatedAvoidedWh, 740);
  assert.equal(list.summary.estimatedAvoidedKwh, 0.74);

  const detail = svc.getInterventionDetail('evt-lights-1');
  assert.ok(detail);
  assert.equal(detail.relatedGroupEvents.length, 1);
  assert.equal(detail.relatedGroupEvents[0].id, 'evt-fans-1');
});

test('3. Overlapping intervals on same room + circuit prevent double counting (full exclusion & partial trimming)', () => {
  const svc = createFreshService();

  // Primary event: 10:00 - 11:00 IST on nb-102-lights (320 W × 1 h = 320 Wh)
  const primary = svc.recordIntervention(
    makeInput({
      id: 'evt-primary',
      idempotencyKey: 'idem-primary',
      startTsMs: BASE_TS,
      endTsMs: BASE_TS + 60 * MIN,
      counterfactualBaselineWatts: 320,
      postInterventionWatts: 0,
    })
  );
  assert.equal(primary.record.energyCalculation.attributedEnergyAvoidedWh, 320);

  // Full overlap: 10:15 - 10:45 IST on SAME circuit -> must be excluded (0 Wh attributed)
  const fullOverlap = svc.recordIntervention(
    makeInput({
      id: 'evt-full-overlap',
      idempotencyKey: 'idem-full-overlap',
      triggerCategory: 'ambient_light',
      triggerSummary: 'Daylight trigger fired while lights were already off for vacancy',
      startTsMs: BASE_TS + 15 * MIN,
      endTsMs: BASE_TS + 45 * MIN,
      counterfactualBaselineWatts: 320,
      postInterventionWatts: 0,
    })
  );
  assert.equal(fullOverlap.record.overlap.status, 'excluded_overlap_duplicate');
  assert.equal(fullOverlap.record.overlap.countedInTotals, false);
  assert.equal(fullOverlap.record.energyCalculation.attributedEnergyAvoidedWh, 0);
  assert.deepEqual(fullOverlap.record.overlap.overlappingEventIds, ['evt-primary']);

  // Verify correction audit entry was automatically written for full overlap
  const fullDetail = svc.getInterventionDetail('evt-full-overlap');
  assert.ok(fullDetail);
  assert.equal(fullDetail.corrections.length, 1);

  // Partial overlap: 10:30 - 11:30 IST on SAME circuit -> 30 min trimmed, only 30 min (0.5 h = 160 Wh) counted
  const partialOverlap = svc.recordIntervention(
    makeInput({
      id: 'evt-partial-overlap',
      idempotencyKey: 'idem-partial-overlap',
      triggerCategory: 'schedule',
      triggerSummary: 'Recess schedule hold overlapped end of vacancy hold',
      startTsMs: BASE_TS + 30 * MIN,
      endTsMs: BASE_TS + 90 * MIN,
      counterfactualBaselineWatts: 320,
      postInterventionWatts: 0,
    })
  );
  assert.equal(partialOverlap.record.overlap.status, 'counted_partial_overlap_trimmed');
  assert.equal(partialOverlap.record.overlap.countedInTotals, true);
  assert.equal(partialOverlap.record.overlap.trimmedOverlapMinutes, 30);
  assert.equal(partialOverlap.record.energyCalculation.attributedDurationHours, 0.5);
  assert.equal(partialOverlap.record.energyCalculation.attributedEnergyAvoidedWh, 160);

  // room_combined overlapping existing specific circuit in the same window -> must conflict & exclude!
  const combinedConflict = svc.recordIntervention(
    makeInput({
      id: 'evt-room-combined',
      idempotencyKey: 'idem-room-combined',
      affectedCircuitId: 'nb-102-combined',
      affectedCircuitName: 'NB-102 Combined Room Load',
      circuitType: 'room_combined',
      startTsMs: BASE_TS,
      endTsMs: BASE_TS + 60 * MIN,
      counterfactualBaselineWatts: 740,
      postInterventionWatts: 0,
    })
  );
  assert.equal(combinedConflict.record.overlap.status, 'excluded_overlap_duplicate');
  assert.equal(combinedConflict.record.overlap.countedInTotals, false);
  assert.equal(combinedConflict.record.energyCalculation.attributedEnergyAvoidedWh, 0);

  // Aggregate summary must equal ONLY 320 + 160 = 480 Wh (0.480 kWh), zero double counting
  const list = svc.listInterventions({ startDate: '2026-11-20', endDate: '2026-11-20' });
  assert.equal(list.summary.totalInterventions, 4);
  assert.equal(list.summary.countedInterventions, 2);
  assert.equal(list.summary.overlapAdjustedCount, 1);
  assert.equal(list.summary.excludedOverlapCount, 2);
  assert.equal(list.summary.estimatedAvoidedWh, 480);
  assert.equal(list.summary.estimatedAvoidedKwh, 0.48);
});

test('4. Duplicate submissions are idempotent and do not duplicate rows or inflate totals', () => {
  const svc = createFreshService();

  const first = svc.recordIntervention(
    makeInput({
      id: 'evt-idem-1',
      idempotencyKey: 'unique-submission-token-42',
    })
  );
  const second = svc.recordIntervention(
    makeInput({
      id: 'evt-idem-1-retry',
      idempotencyKey: 'unique-submission-token-42',
    })
  );
  const thirdById = svc.recordIntervention(
    makeInput({
      id: 'evt-idem-1',
      idempotencyKey: 'different-key-same-id',
    })
  );

  assert.equal(first.created, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.created, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.record.id, 'evt-idem-1');
  assert.equal(thirdById.created, false);
  assert.equal(thirdById.duplicate, true);

  const list = svc.listInterventions({ startDate: '2026-11-20', endDate: '2026-11-20' });
  assert.equal(list.records.length, 1);
  assert.equal(list.summary.estimatedAvoidedWh, 320);
});

test('5. Missing baseline, missing end timestamp, or cancelled/unresolved actions never fabricate savings', () => {
  const svc = createFreshService();

  // Active/open event with endTsMs = null
  const openEvt = svc.recordIntervention(
    makeInput({
      id: 'evt-open',
      idempotencyKey: 'idem-open',
      actionStatus: 'active',
      endTsMs: null,
    })
  );
  assert.equal(openEvt.record.energyCalculation.calculable, false);
  assert.equal(openEvt.record.energyCalculation.attributedEnergyAvoidedWh, null);
  assert.equal(openEvt.record.energyCalculation.attributedEnergyAvoidedKwh, null);
  assert.equal(openEvt.record.overlap.countedInTotals, false);

  // Missing counterfactual baseline
  const missingBaseline = svc.recordIntervention(
    makeInput({
      id: 'evt-no-baseline',
      idempotencyKey: 'idem-no-baseline',
      counterfactualBaselineWatts: null,
      baselineMethod: 'unavailable',
      affectedCircuitId: 'nb-102-fans',
      circuitType: 'fan',
    })
  );
  assert.equal(missingBaseline.record.energyCalculation.calculable, false);
  assert.equal(missingBaseline.record.energyCalculation.attributedEnergyAvoidedWh, null);
  assert.equal(missingBaseline.record.overlap.countedInTotals, false);

  // Cancelled event
  const cancelled = svc.recordIntervention(
    makeInput({
      id: 'evt-cancelled',
      idempotencyKey: 'idem-cancelled',
      actionStatus: 'cancelled',
      affectedCircuitId: 'nb-102-proj',
      circuitType: 'projector',
    })
  );
  assert.equal(cancelled.record.energyCalculation.calculable, false);
  assert.equal(cancelled.record.overlap.countedInTotals, false);

  const list = svc.listInterventions({ startDate: '2026-11-20', endDate: '2026-11-20' });
  assert.equal(list.summary.totalInterventions, 3);
  assert.equal(list.summary.countedInterventions, 0);
  assert.equal(list.summary.notCalculableCount, 3);
  assert.equal(list.summary.estimatedAvoidedWh, 0);
  assert.equal(list.summary.estimatedAvoidedKwh, 0);
});

test('6. Strict provenance & verification guard prevents simulated or unverified hardware events from claiming meter_verified', () => {
  // Simulated trying to claim meter_verified -> forced to estimated
  assert.equal(
    resolveStrictVerificationStatus('simulated', 'meter_verified', true).status,
    'estimated'
  );

  // Hardware telemetry without meter data -> forced to estimated
  assert.equal(
    resolveStrictVerificationStatus('hardware_telemetry', 'meter_verified', true).status,
    'estimated'
  );

  // Meter data WITHOUT documented baseline verification -> meter_backed
  assert.equal(
    resolveStrictVerificationStatus('meter_data', 'meter_verified', false).status,
    'meter_backed'
  );

  // Meter data WITH documented baseline verification -> meter_verified
  assert.equal(
    resolveStrictVerificationStatus('meter_data', 'meter_verified', true).status,
    'meter_verified'
  );

  // End-to-end persistence check: simulated record cannot enter meterVerifiedAvoidedKwh
  const svc = createFreshService();
  const simRes = svc.recordIntervention(
    makeInput({
      id: 'evt-sim-attempt',
      idempotencyKey: 'idem-sim-attempt',
      source: 'simulated',
      requestedVerificationStatus: 'meter_verified',
      hasDocumentedBaselineVerification: true,
    })
  );
  assert.equal(simRes.record.verificationStatus, 'estimated');

  // Meter-verified event in a different room IS separated into meterVerifiedAvoidedKwh
  const meterRes = svc.recordIntervention(
    makeInput({
      id: 'evt-meter-verified',
      idempotencyKey: 'idem-meter-verified',
      roomId: 'g3-301',
      affectedCircuitId: 'g3-301-ac',
      circuitType: 'ac',
      source: 'meter_data',
      isDemonstrationData: false,
      requestedVerificationStatus: 'meter_verified',
      hasDocumentedBaselineVerification: true,
      counterfactualBaselineWatts: 1500,
      postInterventionWatts: 500,
      startTsMs: BASE_TS,
      endTsMs: BASE_TS + 60 * MIN, // 1000 Wh = 1.000 kWh
    })
  );
  assert.equal(meterRes.record.verificationStatus, 'meter_verified');

  const list = svc.listInterventions({ startDate: '2026-11-20', endDate: '2026-11-20' });
  assert.equal(list.summary.estimatedAvoidedKwh, 0.32);
  assert.equal(list.summary.meterVerifiedAvoidedKwh, 1);
  assert.equal(list.summary.simulatedEventCount, 1);
  assert.equal(list.summary.meterDataEventCount, 1);
});

test('7. Pure interval subtraction handles multi-segment overlaps cleanly', () => {
  const out = computeNonOverlappingInterval(BASE_TS, BASE_TS + 120 * MIN, [
    { eventId: 'a', startMs: BASE_TS + 10 * MIN, endMs: BASE_TS + 40 * MIN }, // 30m
    { eventId: 'b', startMs: BASE_TS + 30 * MIN, endMs: BASE_TS + 60 * MIN }, // merges -> 10..60 (50m)
    { eventId: 'c', startMs: BASE_TS + 90 * MIN, endMs: BASE_TS + 150 * MIN }, // clipped to 90..120 (30m)
  ]);
  assert.equal(out.rawMs, 120 * MIN);
  assert.equal(out.overlapMs, 80 * MIN);
  assert.equal(out.uncoveredMs, 40 * MIN);
  assert.deepEqual(out.overlappingEventIds.sort(), ['a', 'b', 'c']);
});
