'use strict';
/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const api = require('../../../scripts/analyze-help-experiment.cjs');
const { createHelpExperimentAnalysisContext } = require('../../../scripts/analyze-help-funnel.cjs');
const { normalizeRecord } = require('../../../scripts/analyze-retention.cjs');
const fixtures = require('../../../scripts/fixtures/help-experiment-readiness.v1.json');
const defaults = require('../../../src/core/config/helpExperiment.defaults.json');
const { helpExperimentPlanFingerprint } = require('../../../src/core/analyticsKeyToken.cjs');
const clone = (value) => JSON.parse(JSON.stringify(value));
const readyCase = fixtures.cases.find((item) => item.id === 'trial_ready_before_first_assignment');
const baselineCase = fixtures.cases.find((item) => item.id === 'baseline_ready_without_trial_sample_or_window');
const config = readyCase.config; const evidence = readyCase.evidence;
const trialPlan = helpExperimentPlanFingerprint(config);
const T = Date.parse('2026-10-21T09:00:00Z');
const player = (n) => (18446744073709000000n + BigInt(n)).toString();
let sequence = 0;
function event(sdk, name, when, properties = {}, extra = {}) {
  const time = new Date(when).toISOString();
  return { appmetrica_device_id: sdk, event_name: name, event_datetime: time,
    install_datetime: '2026-09-01T09:00:00Z', install_kind: 'first',
    event_json: { schema_version: 3, event_id: `p7-synthetic-event-${++sequence}`, occurred_at: time, app_version: '0.1.29', environment: 'production', consent_state: 'enabled', time_trust: 'client_unverified',
      attemptId: `attempt-${sdk}`, levelKey: 'campaign:10', levelId: 10, mode: 'campaign', contentVersion: 'main-v1', content_fingerprint: 'fp_0123456789abcdef',
      origin_interaction_id: `origin-${sdk}`, interaction_id: `origin-${sdk}`, requested_hint: 'letter', hint_type: 'letter', displayed_cost: 100, balance: 20,
      already_owned: false, previously_completed: false, is_available: true, entry_source: 'game_help', ...properties }, ...extra };
}
function claim(sdk, when = T, phase = 'trial', properties = {}) {
  const tags = { first_eligible_request: true, eligibility_version: 'help_deficit_v1', measurement_phase: phase,
    eligibility_epoch: phase === 'trial' ? config.trial.eligibilityEpoch : config.baseline.eligibilityEpoch,
    ...(phase === 'trial' ? { trial_plan_fingerprint: trialPlan } : {}), ...properties };
  return [event(sdk, 'hint_requested', when, tags), event(sdk, 'hint_rejected', when + 1, { ...tags, reason: 'insufficient_coins' })];
}
function assign(sdk, when = T, variant = 'control', properties = {}) {
  return event(sdk, 'experiment_assigned', when, { experiment_id: config.experimentId, eligibility_version: config.eligibilityVersion,
    measurement_phase: 'trial', eligibility_epoch: config.trial.eligibilityEpoch, unit_type: 'sdk_player', allocation_version: 1,
    assignment_id: `assignment-${sdk}`, variant, trial_plan_fingerprint: trialPlan, ...properties });
}
function expose(sdk, when = T + 100, properties = {}) {
  return event(sdk, 'experiment_exposed', when, { experiment_id: config.experimentId, eligibility_version: config.eligibilityVersion,
    measurement_phase: 'trial', eligibility_epoch: config.trial.eligibilityEpoch, allocation_version: 1,
    assignment_id: `assignment-${sdk}`, variant: 'control', trial_plan_fingerprint: trialPlan, exposure_point: 'no_coins', ...properties });
}
function wallet(sdk, when, properties = {}) { return event(sdk, 'wallet_transaction', when, { rewardId: `reward-${sdk}`, transaction_id: `wallet-${sdk}`, currency: 'coins', delta: 80, balance_before: 20, balance_after: 100, source: 'rewarded', ...properties }); }
const options = (extra = {}) => ({ phase: 'trial', asOf: '2026-11-05T12:00:00+03:00', source: 'synthetic', config: clone(config), evidence: clone(evidence), ...extra });
function spec(phase = 'trial', extra = {}) {
  const p = config[phase]; return { experimentId: config.experimentId, eligibilityVersion: config.eligibilityVersion, phase, eligibilityEpoch: p.eligibilityEpoch,
    allocationVersion: phase === 'trial' ? p.allocationVersion : null, enrollmentFrom: p.enrollmentFrom, enrollmentToExclusive: p.enrollmentToExclusive,
    primaryWindowMinutes: 10, trialPlanFingerprint: phase === 'trial' ? trialPlan : null, deliveryLagMs: config.trial.deliveryLagMs, ...extra };
}
function scope(records, phase = 'trial', extra = {}) { return createHelpExperimentAnalysisContext(records, { asOf: options().asOf, timezone: config.timezone, source: 'synthetic' }).analyzeScope(spec(phase, extra)); }
function finalFixture(plan = config) {
  const rows = [];
  const tags = { trial_plan_fingerprint: helpExperimentPlanFingerprint(plan) };
  for (let i = 0; i < 100; i++) {
    const sdk = player(i + 1); const at = T + i * 2000; const treatment = i >= 50;
    rows.push(...claim(sdk, at, 'trial', tags), assign(sdk, at, treatment ? 'treatment' : 'control', tags));
    if (treatment ? i < 95 : i < 10) rows.push(event(sdk, 'puzzle_completed', at + 60000));
  }
  return rows;
}

test('shared full golden readiness fixtures preserve baseline/trial ready paths and bounded reasons', () => {
  for (const item of fixtures.cases) {
    const actual = api.validateHelpExperimentReadiness(item.config, item.evidence);
    assert.equal(actual.baselineReady, item.expected.baselineReady, item.id); assert.equal(actual.trialReady, item.expected.trialReady, item.id);
    assert.equal(helpExperimentPlanFingerprint(item.config), item.expected.trialPlanFingerprint, item.id + ':plan-token');
    for (const code of item.expected.reasonsInclude) assert.ok(actual.reasons.includes(code), item.id + ':' + code);
    for (const code of item.expected.reasonsExclude) assert.ok(!actual.reasons.includes(code), item.id + ':' + code);
    assert.deepEqual(actual.reasons, [...new Set(actual.reasons)].sort());
  }
  assert.equal(api.validateHelpExperimentReadiness(null, null).trialReady, false);
});
test('typed phase and eligibility epoch normalization is nullable and never guesses baseline', () => {
  const missing = normalizeRecord(event(player(1), 'hint_requested', T)); assert.equal(missing.measurementPhase, null); assert.equal(missing.eligibilityEpoch, null);
  const invalid = normalizeRecord(event(player(1), 'hint_requested', T, { measurement_phase: 'production', eligibility_epoch: 'private@example.test' }));
  assert.equal(invalid.measurementPhase, null); assert.equal(invalid.eligibilityEpoch, null); assert.equal(invalid.invalidMeasurementScope, true);
});
test('plan fingerprint normalization is strict, nullable and shared with the pure canonical helper', () => {
  const missing = normalizeRecord(event(player(1), 'hint_requested', T));
  assert.equal(missing.trialPlanFingerprint, null); assert.equal(missing.trialPlanFingerprintSupplied, false); assert.equal(missing.invalidTrialPlanFingerprint, false);
  const valid = normalizeRecord(claim(player(1))[0]); assert.equal(valid.trialPlanFingerprint, trialPlan); assert.equal(valid.invalidTrialPlanFingerprint, false);
  for (const token of [trialPlan.toUpperCase(), 'f'.repeat(31), 123, 'private@example.test']) {
    const invalid = normalizeRecord(event(player(1), 'hint_requested', T, { trial_plan_fingerprint: token }));
    assert.equal(invalid.trialPlanFingerprint, null); assert.equal(invalid.invalidTrialPlanFingerprint, true);
  }
  const reordered = Object.fromEntries(Object.entries(config).reverse());
  assert.equal(helpExperimentPlanFingerprint(reordered), trialPlan);
  const changed = clone(config); changed.trial.nPerArm++;
  assert.notEqual(helpExperimentPlanFingerprint(changed), trialPlan);
});
test('missing/malformed/mismatched plan facts retain every actual assignment and block SRM/effect', () => {
  for (const name of ['hint_requested', 'hint_rejected', 'experiment_assigned', 'experiment_exposed']) for (const token of [undefined, 'f'.repeat(32), 'F'.repeat(32)]) {
    const records = finalFixture(); records.push(expose(player(1)));
    const target = records.find((row) => row.appmetrica_device_id === player(1) && row.event_name === name); target.event_json.trial_plan_fingerprint = token;
    const variants = [records, [...records].reverse()].map((rows) => api.analyzeHelpExperiment(rows, options()));
    for (const report of variants) {
      assert.equal(report.metrics.assignments.total, 100, name); assert.equal(report.metrics.primary.total.denominator, 100, name);
      assert.equal(report.metrics.primary.total.unknownUnits, 1, name); assert.equal(report.metrics.quality.trialPlanMismatchUnits, 1, name);
      assert.ok(report.dataHealth.reasons.includes('missing_mixed_or_mismatched_trial_plan')); assert.equal(report.dataHealth.srm[0].pValue, null);
      assert.equal(report.effect.interval, null); assert.notEqual(report.decision.kind, 'supports_treatment');
    }
    assert.deepEqual(variants[0].metrics, variants[1].metrics, name + ':permutation');
  }
});
test('semantic and delivery copies cannot hide another plan behind a matching original or assignment', () => {
  for (const name of ['hint_requested', 'hint_rejected', 'experiment_assigned', 'experiment_exposed']) for (const sameId of [false, true]) for (const token of [undefined, 'e'.repeat(32)]) {
    const sdk = player(1); const records = [...claim(sdk), assign(sdk), expose(sdk), event(sdk, 'puzzle_completed', T + 1000)];
    const original = records.find((row) => row.event_name === name); const conflicting = clone(original);
    conflicting.event_json.trial_plan_fingerprint = token; if (!sameId) conflicting.event_json.event_id += '-second-delivery';
    const results = [[...records, conflicting], [conflicting, ...records]].map((rows) => scope(rows));
    for (const result of results) {
      assert.equal(result.assignments.total, 1, name); assert.equal(result.primary.total.denominator, 1, name);
      assert.equal(result.primary.total.rate, null, name); assert.equal(result.primary.total.unknownUnits, 1, name); assert.equal(result.quality.trialPlanMismatchUnits, 1, name);
    }
    assert.deepEqual(results[0], results[1], name + ':semantic-permutation');
  }
  const sdk = player(1); assert.equal(scope([...claim(sdk), assign(sdk), expose(sdk), event(sdk, 'puzzle_completed', T + 1000)]).primary.total.rate, 1);
});
test('mixed fresh SDK plans and a changed same-epoch sample plan are visible without matching-only selection', () => {
  const records = finalFixture();
  for (const row of records) if (row.appmetrica_device_id === player(2) && ['hint_requested', 'hint_rejected', 'experiment_assigned'].includes(row.event_name)) row.event_json.trial_plan_fingerprint = 'a'.repeat(32);
  const mixed = api.analyzeHelpExperiment(records, options());
  assert.equal(mixed.metrics.assignments.total, 100); assert.equal(mixed.metrics.assignments.control, 50); assert.equal(mixed.metrics.assignments.treatment, 50);
  assert.equal(mixed.metrics.quality.trialPlanMismatchUnits, 1); assert.equal(mixed.effect.interval, null);
  const changed = clone(config); changed.trial.nPerArm++;
  const changedPlan = api.analyzeHelpExperiment(finalFixture(), options({ config: changed }));
  assert.equal(changedPlan.metrics.assignments.total, 100); assert.equal(changedPlan.metrics.quality.trialPlanMismatchUnits, 100);
  assert.equal(changedPlan.metrics.primary.total.rate, null); assert.equal(changedPlan.effect.interval, null);
  assert.notEqual(changedPlan.audit.configSha256, mixed.audit.configSha256);
});
test('lawful baseline and trial first claims from one SDK occupy independent declared scopes', () => {
  const sdk = player(1); const b = Date.parse('2026-10-05T09:00:00Z');
  const baseIdentity = { origin_interaction_id: 'baseline-origin', interaction_id: 'baseline-origin', attemptId: 'baseline-attempt' };
  const records = [...claim(sdk, b, 'baseline', baseIdentity), event(sdk, 'puzzle_completed', b + 1000, baseIdentity),
    ...claim(sdk, T, 'trial', { levelKey: 'campaign:11', levelId: 11 }), assign(sdk, T, 'control', { levelKey: 'campaign:11', levelId: 11 }),
    event(sdk, 'puzzle_completed', T + 1000, { levelKey: 'campaign:11', levelId: 11 })];
  const baseline = scope(records, 'baseline'); const trial = scope(records);
  assert.equal(baseline.firstClaims.valid, 1); assert.equal(baseline.assignments.total, 0); assert.equal(baseline.primary.total.rate, 1); assert.equal(baseline.primary.total.assignedUnits, 0);
  assert.equal(trial.firstClaims.valid, 1); assert.equal(trial.assignments.total, 1); assert.equal(trial.primary.total.rate, 1);
});
test('trial claim without assignment is loss, never baseline or an imagined arm', () => {
  const records = claim(player(1)); const measured = scope(records);
  assert.equal(measured.assignments.total, 0); assert.equal(measured.primary.total.denominator, 0); assert.equal(measured.linkage.claimWithoutAssignment, 1);
  const report = api.analyzeHelpExperiment(records, options()); assert.equal(report.dataHealth.state, 'fail'); assert.equal(report.decision.kind, 'stop_measurement');
});
test('pair delivery lag is pending instead of loss and never changes the original business window', () => {
  const records = claim(player(1));
  const report = api.analyzeHelpExperiment(records, options({ asOf: new Date(T + 1000).toISOString() }));
  assert.equal(report.metrics.linkage.pendingClaimWithoutAssignment, 1); assert.equal(report.metrics.linkage.claimWithoutAssignment, 0);
  assert.equal(report.dataHealth.state, 'pending'); assert.equal(report.decision.kind, 'collect_to_frozen_plan');
  assert.equal(report.metrics.scope.primaryWindowMinutes, 10);
});
test('ordinary paid requests without enrollment facts are not invented first claims or assigned users', () => {
  const records = finalFixture(); const sdk = player(200);
  records.push(event(sdk, 'hint_requested', T), event(sdk, 'hint_rejected', T + 1, { reason: 'insufficient_coins' }));
  const report = api.analyzeHelpExperiment(records, options());
  assert.equal(report.metrics.assignments.total, 100); assert.equal(report.metrics.firstClaims.valid, 100);
  assert.equal(report.metrics.quality.unmeasuredOriginalRequests, 1); assert.equal(report.decision.kind, 'supports_treatment');
});
test('explicit baseline scope with a missing first flag blocks a complete-case planning baseline', () => {
  const at = Date.parse('2026-10-05T09:00:00Z'); const records = [...claim(player(1), at, 'baseline'), event(player(1), 'puzzle_completed', at + 1000)];
  records.push(...claim(player(2), at, 'baseline', { first_eligible_request: undefined }));
  const result = api.analyzeHelpExperiment(records, options({ phase: 'baseline' }));
  assert.equal(result.metrics.firstClaims.valid, 1); assert.equal(result.metrics.quality.missingFirstClaimFlagUnits, 1);
  assert.equal(result.baselineEstimate.rate, null); assert.equal(result.baselineEstimate.wilson95, null); assert.equal(result.dataHealth.state, 'unknown');
});
test('legacy and conflicting scope alternatives are retained without first-copy cohort choice', () => {
  const sdk = player(1); const original = assign(sdk); const other = clone(original); other.event_json.measurement_phase = 'baseline';
  const reports = [[original, other], [other, original]].map((copies) => scope([...claim(sdk), ...copies]));
  for (const result of reports) { assert.equal(result.assignments.ambiguousScopeAssignmentUnits, 1); assert.equal(result.assignments.total, 0); assert.equal(result.primary.total.rate, null); }
  assert.deepEqual(reports[0], reports[1]);
  const legacy = assign(sdk, T, 'control', { measurement_phase: undefined, eligibility_epoch: undefined });
  assert.equal(scope([legacy]).assignments.ambiguousScopeAssignmentUnits, 1);
});
test('conflicting first origins or assignments never multiply a SDK unit or choose a favorable arm', () => {
  const sdk = player(1); const other = { origin_interaction_id: 'second-origin', interaction_id: 'second-origin', attemptId: 'second-attempt' };
  const records = [...claim(sdk), assign(sdk), ...claim(sdk, T + 100, 'trial', other), assign(sdk, T + 100, 'treatment', { ...other, assignment_id: 'second-assignment' })];
  const result = scope(records); assert.equal(result.assignments.total, 1); assert.equal(result.assignments.unknownVariant, 1);
  assert.equal(result.primary.total.denominator, 1); assert.equal(result.primary.total.unknownUnits, 1); assert.equal(result.primary.total.rate, null);
});
test('first-claim exclusivity covers the full declared epoch rather than separate comparison weeks', () => {
  const sdk = player(1); const later = T + 7 * 86400000;
  const second = { origin_interaction_id: 'later-origin', interaction_id: 'later-origin', attemptId: 'later-attempt' };
  const records = [...claim(sdk), assign(sdk), ...claim(sdk, later, 'trial', second), assign(sdk, later, 'control', second)];
  const result = scope(records, 'trial', { enrollmentToExclusive: '2026-11-04T00:00:00+03:00' });
  assert.equal(result.firstClaims.conflicting, 1); assert.equal(result.assignments.total, 1); assert.equal(result.primary.total.unknownUnits, 1); assert.equal(result.primary.total.rate, null);
});
test('all real assignments including no exposure and orphan origin remain visible in ITT', () => {
  const records = [...claim(player(1)), assign(player(1)), event(player(1), 'puzzle_completed', T + 1000), assign(player(2), T, 'treatment')];
  const result = scope(records); assert.equal(result.assignments.total, 2); assert.equal(result.primary.total.denominator, 2);
  assert.equal(result.primary.total.numerator, 1); assert.equal(result.primary.total.unknownUnits, 1); assert.equal(result.linkage.assignmentWithoutExposure, 2);
  assert.equal(result.primary.total.rate, null); assert.equal(result.primary.treatment.unknownMaturityUnits, 1);
});
test('R1 assignments and exposures must prove the frozen original query context, retaining the original arm', () => {
  const mutations = [
    { attemptId: 'foreign-attempt' }, { attemptId: undefined },
    { levelKey: 'campaign:99', levelId: 99 }, { levelKey: 'daily:2026-10-21', mode: 'daily', dateKey: '2026-10-21' },
    { mode: 'daily' }, { levelId: 99 }, { dateKey: '2026-10-21' },
    { contentVersion: 'foreign-version' }, { content_fingerprint: 'fp_fedcba9876543210' },
    { contentVersion: undefined, content_fingerprint: undefined },
    { hint_type: 'semantic' }, { hint_type: 'unknown_hint' }, { hint_type: 'letter', requested_hint: 'semantic' },
    { displayed_cost: 99 }, { balance: 99 }, { displayed_cost: -1 }, { displayed_cost: '100' }, { balance: null },
    { origin_interaction_id: 'foreign-origin' }
  ];
  for (const name of ['experiment_assigned', 'experiment_exposed']) for (const patch of mutations) {
    const sdk = player(1); const records = [...claim(sdk), assign(sdk), expose(sdk), event(sdk, 'puzzle_completed', T + 1000)];
    Object.assign(records.find((row) => row.event_name === name).event_json, patch);
    for (const rows of [records, [...records].reverse()]) {
      const result = scope(rows);
      assert.equal(result.assignments.total, 1, name + JSON.stringify(patch)); assert.equal(result.assignments.control, 1);
      assert.equal(result.primary.total.denominator, 1); assert.equal(result.primary.total.unknownUnits, 1);
      assert.equal(result.primary.total.numerator, 0); assert.equal(result.primary.total.rate, null);
      assert.equal(result.primary.total.bounds.lower, 0); assert.equal(result.primary.total.bounds.upper, 1);
    }
  }
  // Actual runtime assignment/exposure carry canonical origin, not a duplicated
  // hint quote or original interaction child ID. Their absence is not invented.
  const sdk = player(1); const minimal = [...claim(sdk), assign(sdk), expose(sdk), event(sdk, 'puzzle_completed', T + 1000)];
  for (const row of minimal.filter((row) => ['experiment_assigned', 'experiment_exposed'].includes(row.event_name)))
    for (const key of ['hint_type', 'requested_hint', 'displayed_cost', 'balance', 'interaction_id', 'entry_source', 'previously_completed', 'already_owned', 'is_available']) delete row.event_json[key];
  assert.equal(scope(minimal).primary.total.rate, 1);
});
test('R1 missing/disjoint assignment content requires a trustworthy exact-attempt bridge, never a favorable copy', () => {
  const sdk = player(1);
  const original = claim(sdk, T, 'trial', { contentVersion: undefined });
  const assigned = assign(sdk, T, 'control', { content_fingerprint: undefined });
  const completion = event(sdk, 'puzzle_completed', T + 1000);
  assert.equal(scope([...original, assigned, completion]).primary.total.unknownUnits, 1);
  const bridge = event(sdk, 'puzzle_started', T - 1000);
  assert.equal(scope([bridge, ...original, assigned, completion]).primary.total.rate, 1);
  for (const name of ['experiment_assigned', 'experiment_exposed']) for (const sameEventId of [false, true]) {
    const rows = [...claim(sdk), assign(sdk), expose(sdk), completion];
    const bad = clone(rows.find((row) => row.event_name === name)); bad.event_json.attemptId = 'foreign-attempt';
    if (!sameEventId) bad.event_json.event_id += '-semantic-copy';
    const results = [[...rows, bad], [bad, ...rows]].map((input) => scope(input));
    for (const result of results) { assert.equal(result.assignments.total, 1); assert.equal(result.primary.total.unknownUnits, 1); assert.equal(result.primary.total.numerator, 0); }
    assert.deepEqual(results[0], results[1]);
  }
});
test('R1 contradictory assignment context cannot produce a complete synthetic treatment winner', () => {
  const rows = finalFixture(); for (const row of rows) if (row.event_name === 'experiment_assigned') row.event_json.attemptId = 'foreign-original';
  const report = api.analyzeHelpExperiment(rows, options());
  assert.equal(report.metrics.assignments.total, 100); assert.equal(report.metrics.assignments.control, 50); assert.equal(report.metrics.assignments.treatment, 50);
  assert.equal(report.metrics.primary.total.denominator, 100); assert.equal(report.metrics.primary.total.unknownUnits, 100);
  assert.equal(report.metrics.primary.total.numerator, 0); assert.equal(report.effect.interval, null); assert.notEqual(report.dataHealth.state, 'pass');
  assert.notEqual(report.decision.kind, 'supports_treatment');
  const permissive = clone(config); permissive.dataQuality.maxUnknownPrimaryFraction = 1;
  const allowedMissing = finalFixture(permissive); for (const row of allowedMissing) if (row.event_name === 'experiment_assigned') row.event_json.attemptId = 'foreign-original';
  const uncertain = api.analyzeHelpExperiment(allowedMissing, options({ config: permissive }));
  assert.equal(uncertain.metrics.primary.total.denominator, 100); assert.equal(uncertain.metrics.primary.total.unknownUnits, 100);
  assert.equal(uncertain.metrics.quality.unprovenOriginalQueryUnits, 100); assert.equal(uncertain.dataHealth.state, 'unknown');
  assert.ok(uncertain.dataHealth.reasons.includes('unproven_assignment_original_query')); assert.equal(uncertain.effect.interval, null);
});
test('outcomes after enrollment end and consent evidence without phase remain usable', () => {
  const sdk = player(1); const at = Date.parse(config.trial.enrollmentToExclusive) - 1;
  const records = [...claim(sdk, at), assign(sdk, at), event(sdk, 'puzzle_completed', at + 600000)];
  assert.equal(scope(records).primary.total.rate, 1);
  const gap = event(sdk, 'app_open', T + 3000, { origin_interaction_id: undefined, consent_epoch_at: new Date(T + 2000).toISOString() });
  const absent = scope([...claim(sdk), assign(sdk), gap]); assert.equal(absent.primary.total.unknownUnits, 1); assert.equal(absent.primary.total.rate, null);
});
test('unsupported primary window is closed instead of relabeling unchanged help10m or earned24h', () => {
  const c = clone(config); c.trial.primaryWindowMinutes = 15;
  const result = api.analyzeHelpExperiment([...claim(player(1)), assign(player(1))], options({ config: c }));
  assert.equal(result.status, 'definition_blocked'); assert.equal(result.metrics, null); assert.equal(result.readiness.trialReady, false);
  assert.throws(() => scope([], 'trial', { primaryWindowMinutes: 15 }), /unsupported/);
});
test('baseline collection can be ready without trial sample/window and historical analysis ignores current collection enable', () => {
  const b = Date.parse('2026-10-05T09:00:00Z'); const records = [...claim(player(1), b, 'baseline'), event(player(1), 'puzzle_completed', b + 1000)];
  const collecting = api.analyzeHelpExperiment(records, options({ phase: 'baseline', config: clone(baselineCase.config), evidence: clone(baselineCase.evidence) }));
  assert.equal(collecting.readiness.baselineReady, true); assert.equal(collecting.baselineEstimate.windowMinutes, null); assert.equal(collecting.metrics.firstClaims.valid, 1); assert.equal(collecting.baselineEstimate.rate, null);
  const historical = api.analyzeHelpExperiment(records, options({ phase: 'baseline' }));
  assert.equal(historical.readiness.baselineReady, false); assert.equal(historical.baselineEstimate.rate, 1); assert.equal(historical.decision.kind, 'baseline_observation');
});
test('exact SRM, Wilson/Newcombe and sample design match stable reference boundaries', () => {
  assert.equal(api.exactSrm(0, 0).pValue, null); assert.ok(Math.abs(api.exactSrm(10, 10).pValue - 1) < 1e-12);
  assert.ok(Math.abs(api.exactSrm(0, 20).pValue - 0.0000019073486328125) < 1e-16); assert.deepEqual(api.exactSrm(0, 20), api.exactSrm(20, 0));
  const a = api.difference95(45, 50, 10, 50); const b = api.difference95(10, 50, 45, 50);
  assert.ok(a.lower > 0.5 && a.upper < 1); assert.ok(Math.abs(a.lower + b.upper) < 1e-12); assert.equal(api.difference95(0, 0, 0, 10), null);
  assert.equal(api.sampleSize(.5, 0), null); assert.equal(api.sampleSize(.9, 20), null); assert.ok(api.sampleSize(.5, 40) <= 50);
  for (const args of [[-1, 10], [1.5, 2], [1, NaN]]) assert.throws(() => api.exactSrm(...args));
});
test('ready prelaunch is distinct from n0 observed trial health and final decision', () => {
  const report = api.analyzeHelpExperiment([event(player(1), 'app_open', T)], options({ asOf: '2026-10-21T12:00:00+03:00' }));
  assert.equal(report.readiness.trialReady, true); assert.equal(report.dataHealth.state, 'not_started'); assert.equal(report.dataHealth.srm[0].pValue, null);
  assert.equal(report.decision.kind, 'collect_to_frozen_plan'); assert.equal(report.activationPerformed, false);
});
test('strong early primary result does not win before the frozen phase and return/lag horizon', () => {
  const report = api.analyzeHelpExperiment(finalFixture(), options({ asOf: '2026-10-22T12:00:00+03:00' }));
  assert.ok(report.effect.interval.lower > .05); assert.equal(report.finalPlan.fullFollowupMature, false); assert.equal(report.decision.kind, 'collect_to_frozen_plan');
});
test('complete mature synthetic trial exercises the final useful-effect path without production activation', () => {
  const report = api.analyzeHelpExperiment(finalFixture(), options());
  assert.equal(report.readiness.trialReady, true); assert.equal(report.dataHealth.state, 'pass'); assert.equal(report.dataHealth.srm[0].state, 'pass');
  assert.equal(report.metrics.primary.control.denominator, 50); assert.equal(report.metrics.primary.treatment.denominator, 50);
  assert.equal(report.finalPlan.fullFollowupMature, true); assert.ok(report.guards.every((g) => g.state === 'pass'));
  assert.equal(report.decision.kind, 'supports_treatment'); assert.equal(report.source.synthetic, true); assert.equal(report.source.productionMetricsVerified, false); assert.equal(report.activationPerformed, false);
  assert.equal(report.dataHealth.losses.populationDeliveryDenominator, null); assert.equal(report.dataHealth.losses.populationDeliveryRate, null);
});
test('assignment SRM failure is measurement stop, not treatment harm or a causal loss', () => {
  const rows = finalFixture(); for (const row of rows) if (row.event_name === 'experiment_assigned') row.event_json.variant = 'control';
  const report = api.analyzeHelpExperiment(rows, options()); assert.equal(report.dataHealth.state, 'fail'); assert.equal(report.dataHealth.srm[0].state, 'failed'); assert.equal(report.effect.interval, null); assert.equal(report.decision.kind, 'stop_measurement');
});
test('unknown required distribution guard remains unavailable instead of being dropped', () => {
  const c = clone(config); const guard = clone(c.guardPolicies[0]); Object.assign(guard, { id: 'active_time', method: 'external_reviewed_distribution_v1', direction: 'higher_worse',
    unit: 'completed_full_coverage_attempt', source: 'raw_client', numeratorRef: 'active-time-summary', denominatorRef: 'full-coverage-completions', harmMargin: { value: 10, unit: 'ms' } }); c.guardPolicies.push(guard);
  const report = api.analyzeHelpExperiment(finalFixture(c), options({ config: c })); assert.equal(report.readiness.trialReady, true); assert.equal(report.guards.find((g) => g.id === 'active_time').state, 'unknown'); assert.equal(report.decision.kind, 'inconclusive');
});
test('malformed guard JSON is rejected without throwing and declared source/unit/window cannot be substituted', () => {
  const malformed = clone(config); malformed.guardPolicies = [null];
  assert.equal(api.validateHelpExperimentReadiness(malformed, evidence).trialReady, false);
  for (const change of [
    { id: 'experiment_return_d1', window: { origin: 'exact_calendar_day', calendarDay: 7, milliseconds: null } },
    { id: 'experiment_return_d1', source: 'reconciled_server' },
    { id: 'experiment_return_d1', unit: 'origin_flow' },
    { id: 'experiment_return_d7', observabilityEvidenceRef: 'unrelated-valid-ref' },
    { id: 'reward_integrity', window: { origin: 'first_grant', milliseconds: 600000, calendarDay: null } },
    { id: 'checkout', source: 'raw_client' },
    { id: 'checkout', harmMargin: { value: 1, unit: 'count' } },
    { id: 'reward_integrity', observabilityEvidenceRef: 'unrelated-valid-ref' }
  ]) {
    const c = clone(config); Object.assign(c.guardPolicies.find((g) => g.id === change.id), change);
    const report = api.analyzeHelpExperiment(finalFixture(c), options({ config: c }));
    assert.equal(report.guards.find((g) => g.id === change.id).state, 'unknown', JSON.stringify(change));
    assert.equal(report.decision.kind, 'inconclusive');
  }
});
test('primary-window incident guards keep inclusive deadlines separate from full-followup safety', () => {
  const sdk = player(1); const base = finalFixture();
  for (const delay of [600000, 600001]) {
    const failure = event(sdk, 'subscription_error', T + delay, { mode: 'live', stage: 'checkout', reason: 'payment_create_failed' });
    const report = api.analyzeHelpExperiment([...base, failure], options());
    assert.equal(report.safety.authoritativeBrokenCheckouts, 1); assert.equal(report.decision.kind, 'stop_safety');
    assert.equal(report.metrics.financialIntegrity.primaryWindow.confirmedBrokenCheckouts, delay === 600000 ? 1 : 0);
    assert.equal(report.guards.find((g) => g.id === 'checkout').state, delay === 600000 ? 'fail' : 'pass');
  }
  const early = api.analyzeHelpExperiment(base, options({ asOf: new Date(T + 599999).toISOString() }));
  assert.ok(early.guards.filter((g) => ['checkout', 'reward_integrity'].includes(g.id)).every((g) => g.state === 'unknown'));
});
test('proven distinct reward credits or exact technical checkout failure stop safety; ordinary cancel/validation do not', () => {
  const base = finalFixture(); const sdk = player(1);
  const duplicated = api.analyzeHelpExperiment([...base, wallet(sdk, T + 2000), wallet(sdk, T + 3000, { transaction_id: 'second-credit', balance_before: 100, balance_after: 180 })], options());
  assert.equal(duplicated.safety.authoritativeDuplicateEntitlements, 1); assert.equal(duplicated.decision.kind, 'stop_safety');
  const fail = event(sdk, 'subscription_error', T + 3000, { mode: 'live', stage: 'checkout', reason: 'payment_create_failed' });
  const checkout = api.analyzeHelpExperiment([...base, fail], options()); assert.equal(checkout.safety.authoritativeBrokenCheckouts, 1); assert.equal(checkout.decision.kind, 'stop_safety');
  for (const properties of [{ mode: 'live', stage: 'checkout', reason: 'empty_email' }, { mode: 'live', stage: 'checkout', reason: 'billing_checkout_canceled' }, { mode: 'sandbox', stage: 'checkout', reason: 'payment_create_failed' }, { operation: 'help_trial_safety', stage: 'incident', result: 'failed', normalized_code: 'duplicate_reward_credit' }]) {
    const report = api.analyzeHelpExperiment([...base, event(sdk, properties.operation ? 'technical_operation' : 'subscription_error', T + 3000, properties)], options());
    assert.equal(report.safety.confirmedIncident, false); assert.notEqual(report.decision.kind, 'stop_safety');
  }
});
test('contradictory checkout stage copies are possible proof, never an authoritative stop', () => {
  const base = finalFixture(); const sdk = player(1); const fail = event(sdk, 'subscription_error', T + 3000, { mode: 'live', stage: 'checkout', reason: 'payment_create_failed' });
  const alternate = clone(fail); alternate.event_json.stage = 'restore';
  for (const copies of [[fail, alternate], [alternate, fail]]) {
    const report = api.analyzeHelpExperiment([...base, ...copies], options()); assert.equal(report.safety.confirmedIncident, false); assert.equal(report.metrics.financialIntegrity.possibleBrokenCheckouts, 1); assert.equal(report.decision.kind, 'inconclusive');
  }
});
test('R1 excluded/quarantined checkout copies cannot lend a legal incident their followup clock or scope', () => {
  const sdk = player(1); const base = [...claim(sdk), assign(sdk), event(sdk, 'puzzle_completed', T + 1000)];
  const historical = event(sdk, 'subscription_error', T - 1000, { mode: 'live', stage: 'checkout', reason: 'payment_create_failed' });
  for (const mutate of [
    (row) => { row.is_qa = true; },
    (row) => { row.event_json.environment = 'qa'; },
    (row) => { row.event_json.is_test = true; },
    (row) => { row.record_type = 'install'; },
    (row) => { row.event_json.consent_state = 'disabled'; },
    (row) => { row.event_json.time_trust = 'occurrence_unknown'; },
    (row) => { row.install_datetime = '2026-10-20T09:00:00Z'; row.install_kind = 'reinstall'; },
    (row) => { row.appmetrica_device_id = player(2); }
  ]) {
    const bad = clone(historical); bad.event_json.occurred_at = bad.event_datetime = new Date(T + 2000).toISOString(); mutate(bad);
    const results = [[historical, bad], [bad, historical]].map((copies) => scope([...base, ...copies]));
    for (const result of results) { assert.equal(result.financialIntegrity.confirmedBrokenCheckouts, 0); assert.equal(result.financialIntegrity.primaryWindow.confirmedBrokenCheckouts, 0); }
    assert.deepEqual(results[0], results[1]);
  }
});
test('R1 legal checkout timing alone proves an incident; excluded/future copies cannot poison it or provide missing identity', () => {
  const sdk = player(1); const base = [...claim(sdk), assign(sdk), event(sdk, 'puzzle_completed', T + 1000)];
  const legal = event(sdk, 'subscription_error', T + 2000, { mode: 'live', stage: 'checkout', reason: 'payment_create_failed' });
  for (const mutate of [
    (row) => { row.is_qa = true; row.event_json.stage = 'restore'; },
    (row) => { row.event_json.occurred_at = row.event_datetime = '2026-11-06T00:00:00Z'; row.event_json.stage = 'restore'; }
  ]) {
    const excluded = clone(legal); mutate(excluded);
    for (const copies of [[legal, excluded], [excluded, legal]]) assert.equal(scope([...base, ...copies]).financialIntegrity.confirmedBrokenCheckouts, 1);
  }
  const missingId = clone(legal); delete missingId.event_json.event_id;
  const uncertain = scope([...base, missingId]); assert.equal(uncertain.financialIntegrity.confirmedBrokenCheckouts, 0); assert.equal(uncertain.financialIntegrity.possibleBrokenCheckouts, 1);
});
test('public report is aggregate-only, preserves full plan audit changes, and refuses synthetic evidence as production', () => {
  const rows = finalFixture(); rows[0].event_json.word = 'PRIVATE_WORD'; rows[0].event_json.email = 'private@example.test';
  const report = api.analyzeHelpExperiment(rows, options()); const serialized = JSON.stringify(report) + api.renderMarkdown(report);
  for (const secret of [player(1), 'origin-' + player(1), 'attempt-' + player(1), 'assignment-' + player(1), 'PRIVATE_WORD', 'private@example.test', 'fp_0123456789abcdef']) assert.equal(serialized.includes(secret), false);
  const changed = clone(config); changed.trial.minimumUsefulEffectPp = 6; const audit = api.analyzeHelpExperiment(rows, options({ config: changed })).audit;
  assert.notEqual(audit.configSha256, report.audit.configSha256); assert.equal(audit.metricDefinitionHash, report.audit.metricDefinitionHash);
  assert.notEqual(api.analyzeHelpExperiment(rows, options({ source: 'production' })).decision.kind, 'supports_treatment');
});
test('needs raw data is explicit and CLI protects all raw/config/evidence inputs including hardlinks', () => {
  assert.equal(defaults.baseline.enabled, false); assert.equal(defaults.trial.enabled, false); assert.equal(defaults.trial.allocationVersion, null);
  assert.equal(defaults.identityPolicy, null); assert.equal(defaults.trial.primaryWindowMinutes, null);
  const missing = api.buildNeedsRawDataReport({ phase: 'trial', source: 'observation', asOf: options().asOf });
  assert.equal(missing.metrics, null); assert.equal(missing.status, 'needs_raw_data'); assert.equal(missing.readiness.trialReady, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-help-experiment-'));
  try {
    const input = path.join(dir, 'events.jsonl'); const c = path.join(dir, 'config.json'); const e = path.join(dir, 'evidence.json');
    fs.writeFileSync(input, claim(player(1)).map((row) => JSON.stringify(row)).join('\n')); fs.writeFileSync(c, JSON.stringify(config)); fs.writeFileSync(e, JSON.stringify(evidence));
    const cli = path.resolve(__dirname, '../../../scripts/analyze-help-experiment.cjs');
    const run = (...args) => spawnSync(process.execPath, [cli, '--phase', 'trial', '--as-of', options().asOf, '--source', 'synthetic', '--config', c, '--evidence', e, ...args], { encoding: 'utf8' });
    assert.equal(run('--input', input, '--output', path.join(dir, 'report')).status, 0);
    const linked = path.join(dir, 'linked'); fs.linkSync(c, linked + '.json'); const before = fs.readFileSync(c);
    assert.notEqual(run('--input', input, '--output', linked).status, 0); assert.deepEqual(fs.readFileSync(c), before);
    assert.notEqual(run('--input', input, '--epoch', 'wrong-epoch', '--output', path.join(dir, 'report')).status, 0);
    const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{"PRIVATE_EMAIL":"private@example.test" BAD');
    const failed = spawnSync(process.execPath, [cli, '--phase', 'trial', '--as-of', options().asOf, '--source', 'synthetic', '--config', bad, '--needs-raw-data', '--output', path.join(dir, 'report')], { encoding: 'utf8' });
    assert.notEqual(failed.status, 0); assert.equal(failed.stderr.includes('private@example.test'), false);
  } finally { for (const file of fs.readdirSync(dir)) { const target = path.resolve(dir, file); assert.equal(path.dirname(target), path.resolve(dir)); fs.unlinkSync(target); } fs.rmdirSync(dir); }
});
