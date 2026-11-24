'use strict';
/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { analyzeHelpFunnel: analyze, buildNeedsRawDataReport, renderMarkdown, readInputFiles, createCalendarObservationContext } = require('../../../scripts/analyze-help-funnel.cjs');
const { analyzeProductImprovements } = require('../../../scripts/analyze-product-improvements.cjs');
const { normalizeRecord } = require('../../../scripts/analyze-retention.cjs');

const trialEpoch = 'p7-regression-trial';
const trialPlan = 'f'.repeat(32);
const scopeBase = { experimentId: 'slova_wheel_help_clarity_20261104', eligibilityVersion: 'help_deficit_v1', primaryWindowMinutes: 10 };
const options = { baselineStart: '2026-10-21', currentStart: '2026-10-28', timezone: 'UTC+03:00', asOf: '2026-11-04T00:00:00+03:00', source: 'synthetic', bootstrapReps: 100,
  measurementScopes: [{ ...scopeBase, phase: 'baseline', eligibilityEpoch: 'p7-regression-baseline', allocationVersion: null, enrollmentFrom: '2026-10-01T00:00:00+03:00', enrollmentToExclusive: '2026-10-15T00:00:00+03:00' },
    { ...scopeBase, phase: 'trial', eligibilityEpoch: trialEpoch, allocationVersion: 1, trialPlanFingerprint: trialPlan, enrollmentFrom: '2026-10-21T00:00:00+03:00', enrollmentToExclusive: '2026-11-04T00:00:00+03:00' }] };
const T = Date.parse('2026-10-28T09:00:00Z');
let sequence = 0;
function event(player, name, when, properties = {}, extra = {}) {
  const time = new Date(typeof when === 'number' ? when : Date.parse(when)).toISOString();
  return { appmetrica_device_id: player, event_name: name, event_datetime: time,
    install_datetime: '2026-10-01T08:00:00Z', install_kind: 'first',
    event_json: { schema_version: 3, event_id: `synthetic-event-${++sequence}`, occurred_at: time,
      app_version: '0.1.29', environment: 'production', consent_state: 'enabled', time_trust: 'client_unverified',
      attemptId: `attempt-${player}`, levelKey: 'campaign:10', levelId: 10, mode: 'campaign', contentVersion: 'main-v1', content_fingerprint: 'fp_0123456789abcdef',
      origin_interaction_id: `origin-${player}`, interaction_id: `origin-${player}`, hint_type: 'letter', requested_hint: 'letter',
      displayed_cost: 100, balance: 20, already_owned: false, previously_completed: false, is_available: true, entry_source: 'game_help', ...properties }, ...extra };
}
function request(player, when = T, properties = {}, extra = {}) {
  return [event(player, 'hint_requested', when, properties, extra), event(player, 'hint_rejected', when + 1, { ...properties, reason: 'insufficient_coins' }, extra)];
}
function earned(player, when = T + 1000, properties = {}) {
  return event(player, 'ad_lifecycle', when, { format: 'rewarded', placement: 'hint', operation: 'show', stage: 'reward',
    request_id: `request-${player}`, opportunity_id: `opportunity-${player}`, operation_id: `tap-${player}`, rewardId: `reward-${player}`, ...properties });
}
function wallet(player, when = T + 2000, properties = {}) {
  return event(player, 'wallet_transaction', when, { rewardId: `reward-${player}`, transaction_id: `wallet-${player}`,
    currency: 'coins', delta: 80, balance_before: 20, balance_after: 100, source: 'rewarded', ...properties });
}
function help(player, when, properties = {}) { return event(player, 'help_used', when, { source: 'explicit', entry_source: 'no_coins', ...properties }); }
function assigned(player, when = T, properties = {}) {
  return event(player, 'experiment_assigned', when, { experiment_id: 'slova_wheel_help_clarity_20261104', eligibility_version: 'help_deficit_v1', measurement_phase: 'trial', eligibility_epoch: trialEpoch, trial_plan_fingerprint: trialPlan,
    assignment_id: `assignment-${player}`, variant: 'control', allocation_version: 1, unit_type: 'sdk_player', ...properties });
}
function eligible(player, when = T, properties = {}) { return request(player, when, { first_eligible_request: true, eligibility_version: 'help_deficit_v1', measurement_phase: 'trial', eligibility_epoch: trialEpoch, trial_plan_fingerprint: trialPlan, ...properties }); }
const current = (records, override = {}) => analyze(records, { ...options, ...override }).metrics.weeks[1];
function epochWindow(kind, legacy = false) {
  const calendar = kind === 'calendar';
  const start = calendar ? Date.parse('2026-10-21T21:00:00Z') : T + (kind === 'earned' ? 1000 : kind === 'help' ? 2000 : 0);
  const end = start + (calendar || kind === 'earned' ? 86400000 : 600000);
  const old = legacy ? null : start - 10000 - (calendar ? 86400000 : 0);
  const epoch = (value) => value === null ? undefined : new Date(value).toISOString();
  const install = calendar ? { install_datetime: '2026-10-21T09:00:00Z', install_kind: 'first' } : {};
  const fact = (name, time, value, fields = {}, extra = {}) => event('p', name, time, {
    origin_interaction_id: undefined, interaction_id: undefined, attemptId: undefined, levelKey: undefined, levelId: undefined,
    mode: undefined, contentVersion: undefined, content_fingerprint: undefined, requested_hint: undefined, hint_type: undefined,
    consent_epoch_at: epoch(value), ...fields }, { ...install, ...extra });
  const base = kind === 'primary' ? [...eligible('p', start, { consent_epoch_at: epoch(old) }), assigned('p', start, { consent_epoch_at: epoch(old) })]
    : kind === 'earned' ? [earned('p', start, { consent_epoch_at: epoch(old) })]
      : kind === 'help' ? [...request('p', T, { consent_epoch_at: epoch(old) }), wallet('p', start, { consent_epoch_at: epoch(old) })]
        : [fact('install', Date.parse(install.install_datetime), old, {}, { record_type: 'install' })];
  const success = (time, value) => kind === 'primary' ? event('p', 'puzzle_completed', time, { consent_epoch_at: epoch(value) })
    : kind === 'earned' ? wallet('p', time, { consent_epoch_at: epoch(value) })
      : kind === 'help' ? help('p', time, { consent_epoch_at: epoch(value) })
        : fact('word_submitted', time, value, { manual: true, source: 'explicit' });
  const metric = (records) => {
    const report = analyze(records, options);
    return calendar ? report.metrics.weeks[0].installReturn.D1.gameplay : kind === 'primary' ? report.metrics.weeks[1].primary.assignedEligibleItt
      : kind === 'earned' ? report.metrics.weeks[1].earnedGrant : report.metrics.weeks[1].returnHelp;
  };
  return { kind, start, end, old, base, fact, success, metric, epoch, anchorEpoch(records, value) {
    if (kind === 'primary') for (const row of records) row.event_json.consent_epoch_at = epoch(value);
    else if (!calendar) records.at(-1).event_json.consent_epoch_at = epoch(value);
  } };
}

test('needs raw data keeps all measured values null and experiment inactive', () => {
  const report = buildNeedsRawDataReport(options);
  assert.equal(report.metrics, null); assert.equal(report.status, 'needs_raw_data');
  assert.equal(report.source.productionMetricsVerified, false); assert.equal(report.experiment.enabled, false);
  assert.equal(report.definitions.passports.length, 9);
  assert.match(renderMarkdown(report), /SYNTHETIC DEVELOPMENT DATA; NOT LIVE/);
  assert.deepEqual(analyze([], options), report);
});

test('normalizer adds typed nullable fields without changing old canonical/version/time semantics', () => {
  const raw = event('p', 'help_used', T, { previously_completed: false, first_eligible_request: true, eligibility_version: 'help_deficit_v1', is_available: false, balance_after: 0, delta: -4, ready_at_entry: 'false', timeKnown: false });
  const normalized = normalizeRecord(raw);
  assert.equal(normalized.canonical, 'other'); assert.equal(normalized.timeMs, null);
  assert.equal(normalized.previouslyCompleted, false); assert.equal(normalized.isAvailable, false);
  assert.equal(normalized.firstEligibleRequest, true); assert.equal(normalized.readyAtEntry, null);
  assert.equal(normalized.balanceAfter, 0); assert.equal(normalized.delta, -4);
  const absent = normalizeRecord(event('p', 'hint_requested', T, { previously_completed: undefined, first_eligible_request: undefined }));
  assert.equal(absent.previouslyCompleted, null); assert.equal(absent.firstEligibleRequest, null);
});

test('immutable business replays after SDK update are duplicates, not manufactured hint/wallet/assignment conflicts', () => {
  const records = [...eligible('p'), assigned('p'), wallet('p'), help('p', T + 3000), event('p', 'puzzle_completed', T + 4000)];
  const replayed = records.flatMap((raw) => [raw, { ...structuredClone(raw), app_version_name: '0.1.30', event_datetime: new Date(T + 100000).toISOString() }]);
  const original = analyze(records, options); const replay = analyze(replayed, options);
  assert.deepEqual(replay.metrics, original.metrics);
  assert.equal(replay.quality.conflictingDeliveries, 0); assert.equal(replay.quality.deliveryDuplicates, records.length);
});

test('install enrichment is merged but contradictory explicit install metadata remains an identity gap', () => {
  const raw = wallet('p'); const enriched = structuredClone(raw); enriched.installation_id = 'known-install';
  const clean = analyze([...request('p'), raw, enriched], options);
  assert.equal(clean.quality.deliveryDuplicates, 1); assert.equal(clean.quality.conflictingDeliveries, 0);
  const contradicting = { ...structuredClone(enriched), installation_id: 'another-install' };
  const gap = analyze([...request('p'), enriched, contradicting], options);
  assert.equal(gap.quality.conflictingDeliveries, 0); assert.ok(gap.quality.conflictingInstallDeliveryMetadata > 0);
  assert.equal(gap.metrics.weeks[1].sufficiency.rate, null);
});

test('true amount or variant conflict with same event ID stays unknown across SDK updates', () => {
  const original = wallet('p'); const conflicting = structuredClone(original); conflicting.event_json.balance_after = 999; conflicting.app_version_name = '0.1.30';
  const row = analyze([...request('p'), earned('p'), original, conflicting], options);
  assert.equal(row.quality.conflictingDeliveries, 1); assert.equal(row.metrics.weeks[1].earnedGrant.rate, null);
});

test('P6 R1 shared calendar proof retains conflicting delivery clocks in both orders and accepts a separate legal return', () => {
  const installedAt = Date.parse('2026-10-21T09:00:00Z');
  const installed = { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'private-calendar-first',
    install_timestamp: installedAt / 1000, app_version_name: '0.1.29', environment: 'production', is_reinstallation: false };
  const metadata = { installation_id: installed.installation_id, install_datetime: new Date(installedAt).toISOString(), install_kind: undefined };
  for (const day of [1, 7]) {
    const target = installedAt + day * 86400000;
    const first = event('p', 'word_submitted', target, { manual: true }, metadata);
    const later = structuredClone(first); later.event_datetime = new Date(target + 86400000).toISOString(); later.event_json.occurred_at = later.event_datetime;
    const metric = (records) => analyze([installed, ...records], options).metrics.weeks[0].installReturn[`D${day}`].gameplay;
    const forward = metric([first, later]); const reverse = metric([later, first]);
    assert.deepEqual(forward, reverse);
    assert.equal(forward.denominator, 1); assert.equal(forward.unknownUnits, 1); assert.equal(forward.rate, null);
    assert.deepEqual(forward.bounds, { lower: 0, upper: 1, conditionalOnKnownDenominator: false });
    const positive = event('p', 'word_submitted', target + 1000, { manual: true }, metadata);
    assert.equal(metric([first, later, positive]).rate, 1); assert.equal(metric([later, first, positive]).rate, 1);
  }
});

test('P6 R1 shared calendar proof preserves possible install scopes and keeps private copies out of public output', () => {
  const installedAt = Date.parse('2026-10-21T09:00:00Z');
  const installed = { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'private-calendar-first',
    install_timestamp: installedAt / 1000, app_version_name: '0.1.29', environment: 'production', is_reinstallation: false };
  const first = event('p', 'word_submitted', installedAt + 86400000, { manual: true },
    { installation_id: installed.installation_id, install_datetime: new Date(installedAt).toISOString(), install_kind: undefined });
  const foreign = { ...structuredClone(first), installation_id: 'PRIVATE_ALTERNATE_SCOPE_902' };
  const results = [];
  for (const copies of [[first, foreign], [foreign, first]]) {
    const report = analyze([installed, ...copies], options); const metric = report.metrics.weeks[0].installReturn.D1.gameplay;
    assert.equal(metric.denominator, 1); assert.equal(metric.unknownUnits, 1); assert.equal(metric.rate, null);
    assert.deepEqual(metric.bounds, { lower: 0, upper: 1, conditionalOnKnownDenominator: false });
    const output = `${JSON.stringify(report)}\n${renderMarkdown(report)}`;
    assert.equal(output.includes('PRIVATE_ALTERNATE_SCOPE_902'), false); assert.equal(output.includes(first.event_json.event_id), false);
    const positive = event('p', 'word_submitted', installedAt + 86401000, { manual: true },
      { installation_id: installed.installation_id, install_datetime: new Date(installedAt).toISOString(), install_kind: undefined });
    assert.equal(analyze([installed, ...copies, positive], options).metrics.weeks[0].installReturn.D1.gameplay.rate, 1);
    results.push(metric);
  }
  assert.deepEqual(results[0], results[1]);
});

test('P6 R1 conflicting outcome clocks already remain unknown in primary10m, returnHelp10m and earnedGrant24h in both orders', () => {
  const move = (raw, time) => { const copy = structuredClone(raw); copy.event_datetime = new Date(time).toISOString(); copy.event_json.occurred_at = copy.event_datetime; return copy; };
  const completed = event('p', 'puzzle_completed', T + 4000);
  const used = help('p', T + 3000);
  const grant = wallet('p', T + 2000);
  const probes = [
    { base: [...eligible('p'), assigned('p')], first: completed, other: move(completed, T + 700000), metric: (value) => value.primary.assignedEligibleItt },
    { base: [...request('p'), earned('p'), grant], first: used, other: move(used, T + 700000), metric: (value) => value.returnHelp },
    { base: [earned('p')], first: grant, other: move(grant, T + 86402000), metric: (value) => value.earnedGrant },
  ];
  for (const probe of probes) {
    const forward = probe.metric(current([...probe.base, probe.first, probe.other]));
    const reverse = probe.metric(current([...probe.base, probe.other, probe.first]));
    assert.deepEqual(forward, reverse); assert.equal(forward.denominator, 1); assert.equal(forward.unknownUnits, 1); assert.equal(forward.rate, null);
    assert.deepEqual(forward.bounds, { lower: 0, upper: 1, conditionalOnKnownDenominator: false });
  }
});

test('P6 R2 common SDK boundary quarantines inconsistent names in both shared public APIs, genuine sessions remain open-only', () => {
  const installedAt = Date.parse('2026-10-21T09:00:00Z');
  const installed = { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'sdk-boundary-first', install_timestamp: installedAt / 1000,
    app_version_name: '0.1.29', environment: 'production', is_reinstallation: false };
  const session = { record_type: 'session', appmetrica_device_id: 'p', installation_id: installed.installation_id,
    session_start_timestamp: (installedAt + 86400000) / 1000, environment: 'production' };
  const observe = (records, gameplay) => createCalendarObservationContext(records, options).observe({ sdkId: 'p', installKey: installed.installation_id,
    anchorMs: installedAt, day: 1, gameplay });
  for (const fields of [{ event_name: 'word_submitted' }, { name: 'word_submitted' }, { event_name: 'session_start', name: 'word_submitted' },
    { event_name: 'PRIVATE_BAD_NAME@example.com' }]) {
    const records = [installed, { ...session, ...fields }];
    const report = analyze(records, options); const row = report.metrics.weeks[0].installReturn.D1.gameplay;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
    assert.deepEqual(observe(records, true), { state: 'unknown', success: null, reason: 'unknown_return_occurrence_or_context' });
    assert.equal(report.quality.invalidSdkRecords, 1); assert.equal(JSON.stringify(report).includes('PRIVATE_BAD_NAME'), false);
    const positive = event('p', 'word_submitted', installedAt + 86401000, { manual: true },
      { installation_id: installed.installation_id, install_datetime: new Date(installedAt).toISOString(), install_kind: undefined });
    assert.equal(analyze([...records, positive], options).metrics.weeks[0].installReturn.D1.gameplay.rate, 1);
  }
  const valid = analyze([installed, session], options).metrics.weeks[0].installReturn.D1;
  assert.equal(valid.open.rate, 1); assert.equal(valid.gameplay.rate, 0);
  assert.equal(observe([installed, session], false).success, true); assert.equal(observe([installed, session], true).success, false);
  const epoch = '2026-10-24T09:00:00Z';
  const later = event('p', 'app_open', '2026-10-24T12:00:00Z', { consent_epoch_at: epoch },
    { installation_id: installed.installation_id, install_datetime: new Date(installedAt).toISOString(), install_kind: undefined });
  const fakeContinuity = { ...session, event_name: 'app_open', session_start_timestamp: Date.parse('2026-10-23T09:00:00Z') / 1000,
    event_json: { schema_version: 3, app_version: '0.1.29', environment: 'production', consent_state: 'enabled', time_trust: 'client_unverified', occurred_at: '2026-10-23T09:00:00Z' } };
  const gap = analyze([installed, later, fakeContinuity], options).metrics.weeks[0].installReturn.D1.gameplay;
  assert.equal(gap.rate, null); assert.equal(gap.unknownUnits, 1); assert.equal(gap.reasons.observed_consent_epoch_gap, 1);
});

function r2Fixture(kind) {
  const originalInstall = '2026-10-01T08:00:00Z'; const nextInstall = new Date(T + 86400000).toISOString();
  const seeds = [{ record_type: 'install', appmetrica_device_id: 'p', installation_id: 'scope-a', install_datetime: originalInstall,
    app_version_name: '0.1.29', environment: 'production', is_reinstallation: false },
  { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'scope-b', install_datetime: nextInstall,
    app_version_name: '0.1.29', environment: 'production', is_reinstallation: true }];
  const inScope = (raw) => ({ ...raw, installation_id: 'scope-a', install_datetime: originalInstall });
  const grant = inScope(wallet('p')); const earnedFact = inScope(earned('p'));
  const base = kind === 'primary' ? [...eligible('p').map(inScope), inScope(assigned('p'))]
    : kind === 'help' ? [...request('p').map(inScope), earnedFact, grant] : [earnedFact];
  const inside = kind === 'primary' ? inScope(event('p', 'puzzle_completed', T + 4000)) : kind === 'help' ? inScope(help('p', T + 3000)) : grant;
  const select = (value) => kind === 'primary' ? value.primary.assignedEligibleItt : kind === 'help' ? value.returnHelp : value.earnedGrant;
  return { seeds, base, inside, select, nextInstall, inScope };
}
function r2Other(fixture, kind, variant) {
  const other = structuredClone(fixture.inside);
  if (variant.includes('clock')) {
    const time = T + (kind === 'earned' ? 172802000 : variant.includes('install') ? 86404000 : 700000);
    other.event_datetime = new Date(time).toISOString(); other.event_json.occurred_at = other.event_datetime;
  }
  if (variant.includes('install')) { other.installation_id = 'scope-b'; other.install_datetime = fixture.nextInstall; other.install_kind = 'reinstall'; }
  if (variant.includes('origin')) other.event_json.origin_interaction_id = 'PRIVATE_FOREIGN_ORIGIN_903';
  if (variant.includes('reward')) other.event_json.rewardId = 'PRIVATE_FOREIGN_REWARD_904';
  return other;
}

test('P6 R2 all absence windows retain clock/install/origin/reward alternatives in exhaustive forward/reverse cases', () => {
  const variants = ['clock', 'install', 'origin', 'reward', 'clock_install', 'clock_origin', 'clock_reward', 'clock_install_origin_reward'];
  for (const kind of ['primary', 'help', 'earned']) for (const variant of variants) {
    const fixture = r2Fixture(kind); const other = r2Other(fixture, kind, variant);
    const rows = [[fixture.inside, other], [other, fixture.inside]].map((copies) => fixture.select(current([...fixture.seeds, ...fixture.base, ...copies])));
    assert.deepEqual(rows[0], rows[1], `${kind}/${variant} order`);
    assert.equal(rows[0].denominator, 1, `${kind}/${variant} N`); assert.equal(rows[0].unknownUnits, 1, `${kind}/${variant} unknown`);
    assert.equal(rows[0].rate, null, `${kind}/${variant} rate`); assert.deepEqual(rows[0].bounds, { lower: 0, upper: 1, conditionalOnKnownDenominator: false });
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes('PRIVATE_FOREIGN_ORIGIN'), false); assert.equal(serialized.includes('PRIVATE_FOREIGN_REWARD'), false);
  }
});

test('P6 R2 lawful existential outcomes survive unrelated/conflicting alternatives while earned exactly-one integrity remains strict', () => {
  for (const kind of ['primary', 'help']) {
    const fixture = r2Fixture(kind); const other = r2Other(fixture, kind, 'clock_install_origin_reward');
    const positive = structuredClone(fixture.inside); positive.event_json.event_id = `lawful-independent-${kind}`;
    for (const copies of [[fixture.inside, other], [other, fixture.inside]]) {
      const result = fixture.select(current([...fixture.seeds, ...fixture.base, ...copies, positive]));
      assert.equal(result.denominator, 1); assert.equal(result.rate, 1, `${kind} lawful positive`);
    }
  }
  const fixture = r2Fixture('earned'); const other = r2Other(fixture, 'earned', 'clock_install_origin_reward');
  const second = fixture.inScope(wallet('p', T + 5000, { transaction_id: 'independent-distinct-credit' }));
  for (const copies of [[fixture.inside, other], [other, fixture.inside]]) {
    const unknown = fixture.select(current([...fixture.seeds, ...fixture.base, ...copies, second]));
    assert.equal(unknown.denominator, 1); assert.equal(unknown.rate, null); assert.equal(unknown.unknownUnits, 1);
  }
  const foreign = structuredClone(fixture.inside); foreign.event_json.event_id = 'unrelated'; foreign.event_json.transaction_id = 'unrelated-wallet'; foreign.event_json.rewardId = 'unrelated-reward'; foreign.event_json.origin_interaction_id = 'unrelated-origin';
  const foreignOther = r2Other({ ...fixture, inside: foreign }, 'earned', 'clock_install');
  const known = fixture.select(current([...fixture.seeds, ...fixture.base, fixture.inside, foreign, foreignOther]));
  assert.equal(known.rate, 1); assert.equal(known.denominator, 1);
});

test('P6 R3 two independently proven distinct credits remain known duplicate failure with an uncertain third', () => {
  const fixture = r2Fixture('earned');
  const one = fixture.inside;
  const two = fixture.inScope(wallet('p', T + 3000, { transaction_id: 'proven-second' }));
  const third = fixture.inScope(wallet('p', T + 4000, { transaction_id: 'possible-third' }));
  const other = r2Other({ ...fixture, inside: third }, 'earned', 'clock_install_origin_reward');
  const baseline = fixture.select(current([...fixture.seeds, ...fixture.base, one, two]));
  for (const extra of [[], [third, other], [other, third]]) {
    const row = fixture.select(current([...fixture.seeds, ...fixture.base, one, two, ...extra]));
    assert.equal(row.denominator, 1); assert.equal(row.rate, 0); assert.equal(row.unknownUnits, 0);
    assert.deepEqual(row.bounds, { lower: 0, upper: 0, conditionalOnKnownDenominator: false });
    assert.equal(row.reasons.duplicate_grant, 1); assert.equal(row.diagnostic.duplicateGrant, 1);
    assert.equal(row.numerator, baseline.numerator);
  }
  for (const copies of [[third, other], [other, third]]) {
    const control = fixture.select(current([...fixture.seeds, ...fixture.base, one, ...copies]));
    assert.equal(control.rate, null); assert.equal(control.denominator, 1); assert.equal(control.unknownUnits, 1); assert.equal(control.diagnostic.duplicateGrant, 0);
  }
});

test('P6 R3 a merely possible legacy install scope is not an independently proven matching credit', () => {
  const legacy = { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'legacy-a', install_day: '2026-10-01',
    app_version_name: '0.1.29', environment: 'production', is_reinstallation: false };
  const later = { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'real-b', install_datetime: '2026-10-20T08:00:00Z',
    app_version_name: '0.1.29', environment: 'production', is_reinstallation: true };
  const exact = (raw) => ({ ...raw, installation_id: legacy.installation_id, install_datetime: undefined, install_day: legacy.install_day, install_kind: undefined });
  const origin = exact(earned('p')); const one = exact(wallet('p'));
  // No install metadata: the actual SDK interval resolves this valid credit
  // to B, while A's unknown install clock only allows a conservative overlap.
  const possible = { ...wallet('p', T + 3000, { transaction_id: 'only-possible-scope' }), installation_id: undefined, install_datetime: undefined, install_kind: undefined };
  for (const credits of [[one, possible], [possible, one]]) {
    const row = current([legacy, later, origin, ...credits]).earnedGrant;
    assert.equal(row.denominator, 1); assert.equal(row.rate, null); assert.equal(row.unknownUnits, 1); assert.equal(row.diagnostic.duplicateGrant, 0);
    assert.deepEqual(row.bounds, { lower: 0, upper: 1, conditionalOnKnownDenominator: false });
  }
});

test('P6 R3 conflicted known credit, immature window and risky earned anchor cannot prove a mature duplicate failure', () => {
  const fixture = r2Fixture('earned'); const one = fixture.inside;
  const two = fixture.inScope(wallet('p', T + 3000, { transaction_id: 'second-credit' }));
  const corruptOne = r2Other(fixture, 'earned', 'clock_install_origin_reward');
  for (const copies of [[one, corruptOne], [corruptOne, one]]) {
    const row = fixture.select(current([...fixture.seeds, ...fixture.base, ...copies, two]));
    assert.equal(row.rate, null); assert.equal(row.unknownUnits, 1); assert.equal(row.diagnostic.duplicateGrant, 0);
  }
  const late = Date.parse('2026-11-03T20:00:00Z');
  const immature = current([earned('p', late), wallet('p', late + 1000), wallet('p', late + 2000, { transaction_id: 'early-second' })]).earnedGrant;
  assert.equal(immature.rate, null); assert.equal(immature.denominator, 0); assert.equal(immature.immatureUnits, 1);
  const risky = structuredClone(fixture.base[0]); risky.event_json.consent_state = 'disabled';
  const unknown = fixture.select(current([...fixture.seeds, risky, one, two]));
  assert.equal(unknown.rate, null); assert.equal(unknown.denominator, 1); assert.equal(unknown.unknownUnits, 1);
});

function withoutInstallScope(raw) {
  const copy = structuredClone(raw);
  for (const field of ['installation_id', 'install_datetime', 'install_timestamp', 'installed_at', 'install_day', 'install_kind', 'install_type', 'install_key', 'is_reinstallation']) delete copy[field];
  for (const field of ['installation_id', 'install_key', 'originating_installation_id']) delete copy.event_json[field];
  return copy;
}
test('P6 R4 absent earned and credit scopes stay mature unknown, never exact success/failure or safe integrity', () => {
  const origin = withoutInstallScope(earned('p')); const one = withoutInstallScope(wallet('p'));
  const two = withoutInstallScope(wallet('p', T + 3000, { transaction_id: 'unscoped-second' }));
  for (const credits of [[], [one], [one, two], [two, one]]) {
    const report = analyze([origin, ...credits], options); const row = report.metrics.weeks[1].earnedGrant;
    assert.equal(row.denominator, 1); assert.equal(row.rate, null); assert.equal(row.unknownUnits, 1);
    assert.deepEqual(row.bounds, { lower: 0, upper: 1, conditionalOnKnownDenominator: false });
    assert.equal(row.diagnostic.duplicateGrant, 0); assert.equal(report.quality.duplicateGrantEntitlements, 0);
    assert.equal(report.coverageGates.find((gate) => gate.name === 'reward_integrity').state, 'coverage_gap');
  }
});
function r4Scopes() {
  const legacy = { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'legacy-a', install_day: '2026-10-01',
    app_version_name: '0.1.29', environment: 'production', is_reinstallation: false };
  const later = { record_type: 'install', appmetrica_device_id: 'p', installation_id: 'real-b', install_datetime: '2026-10-20T08:00:00Z',
    app_version_name: '0.1.29', environment: 'production', is_reinstallation: true };
  const exact = (raw) => ({ ...raw, installation_id: legacy.installation_id, install_datetime: undefined, install_day: legacy.install_day, install_kind: undefined });
  const origin = exact(earned('p')); const one = exact(wallet('p'));
  const possible = { ...wallet('p', T + 3000, { transaction_id: 'possible-scope' }), installation_id: undefined, install_datetime: undefined, install_kind: undefined };
  const other = { ...possible, installation_id: later.installation_id, install_datetime: later.install_datetime, install_day: undefined };
  return { seeds: [legacy, later], exact, origin, one, possible, other };
}
test('P6 R4 scoped plus unresolved credit is unknown while known unrelated install scope preserves exactly one', () => {
  const f = r4Scopes();
  for (const credits of [[f.one, f.possible], [f.possible, f.one]]) {
    const report = analyze([...f.seeds, f.origin, ...credits], options); const row = report.metrics.weeks[1].earnedGrant;
    assert.equal(row.rate, null); assert.equal(row.unknownUnits, 1); assert.equal(row.diagnostic.duplicateGrant, 0);
    assert.equal(report.quality.duplicateGrantEntitlements, 0); assert.equal(report.quality.unresolvedRewardWalletFacts, 1);
    assert.equal(report.coverageGates.find((gate) => gate.name === 'reward_integrity').state, 'coverage_gap');
  }
  const proven = analyze([...f.seeds, f.origin, f.one, f.other], options);
  assert.equal(proven.metrics.weeks[1].earnedGrant.rate, 1);
  assert.equal(proven.coverageGates.find((gate) => gate.name === 'reward_integrity').state, 'observed_no_detected_conflict');
  const unknownOrigin = analyze([...f.seeds, withoutInstallScope(f.origin), f.one], options);
  assert.equal(unknownOrigin.metrics.weeks[1].earnedGrant.rate, null); assert.equal(unknownOrigin.metrics.weeks[1].earnedGrant.unknownUnits, 1);
});
test('P6 R4 two scoped proven credits keep duplicate failure despite an unresolved possible third', () => {
  const f = r4Scopes(); const two = f.exact(wallet('p', T + 4000, { transaction_id: 'scoped-proven-second' }));
  for (const credits of [[f.one, two, f.possible], [f.possible, two, f.one]]) {
    const report = analyze([...f.seeds, f.origin, ...credits], options); const row = report.metrics.weeks[1].earnedGrant;
    assert.equal(row.denominator, 1); assert.equal(row.rate, 0); assert.equal(row.unknownUnits, 0); assert.equal(row.diagnostic.duplicateGrant, 1);
    assert.deepEqual(row.bounds, { lower: 0, upper: 0, conditionalOnKnownDenominator: false });
    assert.equal(report.quality.duplicateGrantEntitlements, 1);
    assert.equal(report.coverageGates.find((gate) => gate.name === 'reward_integrity').state, 'failed');
  }
});

test('only real available dwell plus exact accepted modal/action bridge produces wheel conversion', () => {
  const records = request('p');
  records.push(event('p', 'feature_exposed', T + 1000, { modal_id: 'modal-p', feature: 'wheel_entry', element_id: 'wheel', is_available: true, visibility_rule: 'half_1s_v2', visibility_ms: 1000, visible_fraction: 0.5 }),
    event('p', 'no_coins_action', T + 2000, { modal_id: 'modal-p', interaction_id: 'tap-p', action: 'wheel', outcome: 'selected' }),
    event('p', 'ui_action', T + 2100, { modal_id: 'modal-p', element_id: 'no_coins', action: 'exit', outcome: 'unmount' }),
    event('p', 'wheel_opened', T + 3000, { modal_id: 'modal-p', interaction_id: 'tap-p', screen_visit_id: 'visit-p' }));
  const row = current(records).wheelEntry;
  assert.equal(row.denominator, 1); assert.equal(row.numerator, 1); assert.equal(row.rate, 1);
  assert.equal(row.uniquePlayerDiagnostic.denominator, 1);
  for (const change of [{ modal_id: 'wrong-modal' }, { interaction_id: 'wrong-tap' }]) {
    const copy = structuredClone(records); Object.assign(copy.at(-1).event_json, change);
    const result = current(copy).wheelEntry; assert.equal(result.numerator, 0);
    if (change.modal_id) assert.equal(result.openUnits, 1);
    else { assert.equal(result.unknownUnits, 1); assert.equal(result.rate, null); }
  }
});

test('explicit modal close blocks later wheel open and unavailable/short exposure never counts', () => {
  const records = [...request('p'), event('p', 'feature_exposed', T + 1000, { modal_id: 'm', feature: 'wheel_entry', element_id: 'wheel', visibility_rule: 'half_1s_v2', visibility_ms: 1000, visible_fraction: 0.5 }),
    event('p', 'no_coins_action', T + 2000, { modal_id: 'm', action: 'close' }), event('p', 'no_coins_action', T + 3000, { modal_id: 'm', action: 'wheel', outcome: 'selected', interaction_id: 'tap' }),
    event('p', 'wheel_opened', T + 4000, { modal_id: 'm', interaction_id: 'tap' })];
  assert.equal(current(records).wheelEntry.rate, 0);
  for (const change of [{ visibility_ms: 999 }, { visible_fraction: 0.49 }, { is_available: false }]) {
    const copy = structuredClone(records); Object.assign(copy[2].event_json, change);
    const result = current(copy).wheelEntry; assert.equal(result.denominator, 0); assert.equal(result.rate, null);
  }
});

test('eligible entry readiness is instantaneous and waits end at ready, not visit exit', () => {
  const records = [event('p', 'no_coins_shown', T, { modal_id: 'm', rewarded_eligible: true, ready_at_entry: false, rewarded_state: 'loading' }),
    event('p', 'ui_action', T + 5000, { modal_id: 'm', element_id: 'no_coins', action: 'ready', rewarded_state: 'ready', wait_ms: 5000 }),
    event('p', 'ui_action', T + 20000, { modal_id: 'm', element_id: 'no_coins', action: 'exit', wait_ms: 20000 }),
    event('p', 'wheel_opened', T + 21000, { screen: 'wheel', screen_visit_id: 'v', rewarded_eligible: true, ready_at_entry: true, rewarded_state: 'ready' }),
    event('q', 'wheel_opened', T, { screen: 'wheel', screen_visit_id: 'q', rewarded_eligible: false, ready_at_entry: false, rewarded_state: 'daily_limit' })];
  const row = current(records).readiness;
  assert.equal(row.noCoins.rate, 0); assert.equal(row.noCoins.waitToReadyMs.p50, 5000);
  assert.equal(row.wheel.rate, 1); assert.equal(row.wheel.denominator, 1); assert.equal(row.wheel.ineligibleUnits, 1);
});

test('readiness resumes create distinct visits; exit-before-ready and missing flags are separate', () => {
  const records = [event('p', 'no_coins_shown', T, { modal_id: 'm', rewarded_eligible: true, ready_at_entry: false, rewarded_state: 'loading' }),
    event('p', 'ui_action', T + 1000, { modal_id: 'm', element_id: 'no_coins', action: 'exit' }),
    event('p', 'ui_action', T + 2000, { modal_id: 'm', element_id: 'no_coins', action: 'resume', rewarded_eligible: true, ready_at_entry: true, rewarded_state: 'ready' }),
    event('q', 'no_coins_shown', T, { modal_id: 'q', rewarded_eligible: undefined, ready_at_entry: undefined })];
  const row = current(records).readiness.noCoins;
  assert.equal(row.denominator, 2); assert.equal(row.numerator, 1); assert.equal(row.unprovenDenominatorUnits, 1);
  assert.equal(row.rate, null); assert.equal(row.waitToReadyMs.exitedBeforeReady, 1);
});

test('show denominator excludes preloads, includes accepted preparation failure and preserves pending', () => {
  const ad = (p, stage, delta, props = {}) => event(p, 'ad_lifecycle', T + delta, { format: 'rewarded', opportunity_id: `ao-${p}`, request_id: `ar-${p}`, operation_id: `tap-${p}`, operation: 'show', stage, ...props });
  const records = [ad('preload', 'requested', 0, { operation: 'load', placement: 'preload' }), ad('preload', 'loaded', 10, { operation: 'load' }),
    ad('fail', 'show_intent', 0, { outcome: 'accepted' }), ad('fail', 'error', 10, { normalized_reason: 'offer_save_failed' }),
    ad('shown', 'show_intent', 0, { outcome: 'accepted' }), ad('shown', 'shown', 10),
    ad('pending', 'show_intent', 0, { outcome: 'accepted' })];
  const row = current(records).show;
  assert.equal(row.denominator, 3); assert.equal(row.numerator, 1); assert.equal(row.terminalFailures, 1);
  assert.equal(row.openUnits, 1); assert.equal(row.rate, null); assert.deepEqual(row.bounds, { lower: 1 / 3, upper: 2 / 3 });
  const complete = current(records.slice(0, -1)).show; assert.equal(complete.rate, 0.5);
});

test('earned callbacks and wallet deliveries deduplicate; every earned window waits 24h', () => {
  const earn = earned('p'); const grant = wallet('p');
  const records = [earn, structuredClone(earn), event('p', 'ad_lifecycle', T + 1000, { ...earn.event_json, event_id: 'recovery-copy', recovery: true }), grant,
    event('p', 'wallet_transaction', T + 2000, { ...grant.event_json, event_id: 'wallet-replay' }),
    earned('none'), earned('immature', Date.parse('2026-11-03T20:00:00Z')), wallet('immature', Date.parse('2026-11-03T20:01:00Z'))];
  const report = analyze(records, options); const row = report.metrics.weeks[1].earnedGrant;
  assert.equal(row.denominator, 2); assert.equal(row.numerator, 1); assert.equal(row.rate, 0.5);
  assert.equal(row.immatureUnits, 1); assert.equal(row.diagnostic.earlyConfirmedImmature, 1);
  assert.equal(row.diagnostic.duplicateEarnedDeliveries, 1); assert.equal(report.quality.deliveryDuplicates, 1);
  assert.equal(report.quality.duplicateWalletDeliveries, 1);
});

test('earned exactly-one grant requires real positive coin wallet fact and flags two distinct credits', () => {
  const records = [earned('duplicate'), wallet('duplicate'), wallet('duplicate', T + 3000, { transaction_id: 'second-wallet', balance_before: 100, balance_after: 180 }),
    earned('callback'), event('callback', 'ad_lifecycle', T + 2000, { stage: 'grant_persisted', format: 'rewarded', rewardId: 'reward-callback' }),
    earned('valid'), wallet('valid', T + 1000 + 86400000),
    earned('late'), wallet('late', T + 1000 + 86400001)];
  const report = analyze(records, options); const row = report.metrics.weeks[1].earnedGrant;
  assert.equal(row.denominator, 4); assert.equal(row.numerator, 1); assert.equal(row.rate, 0.25);
  assert.equal(row.diagnostic.duplicateGrant, 1); assert.equal(row.diagnostic.lateGrant, 1);
  assert.equal(report.coverageGates.find((gate) => gate.name === 'reward_integrity').state, 'failed');
});

test('unknown earned/wallet clock and invalid wallet balances are coverage gaps rather than zero', () => {
  for (const change of [{ timeKnown: false }, { time_trust: 'client_clock_anomaly' }, { balance_after: 999 }]) {
    const records = [earned('p'), wallet('p', T + 2000, change)]; const row = current(records).earnedGrant;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
  }
  const row = current([earned('p', T + 1000, { rewardId: undefined })]).earnedGrant;
  assert.equal(row.unprovenDenominatorUnits, 1); assert.equal(row.rate, null);
});

test('missing wallet transaction/reward IDs preserve unknown grant evidence rather than known absence', () => {
  for (const properties of [{ transaction_id: undefined }, { rewardId: undefined }]) {
    const week = current([...request('p'), earned('p'), wallet('p', T + 2000, properties)]);
    assert.equal(week.earnedGrant.denominator, 1); assert.equal(week.earnedGrant.unknownUnits, 1); assert.equal(week.earnedGrant.rate, null);
    assert.equal(week.sufficiency.rate, null); assert.equal(week.sufficiency.unknownUnits, 1);
  }
});

test('structurally valid gem or negative wallet transactions are not positive coin grants', () => {
  const records = [earned('gems'), wallet('gems', T + 2000, { currency: 'gems' }),
    earned('debit'), wallet('debit', T + 2000, { delta: -10, balance_before: 20, balance_after: 10 })];
  const row = current(records).earnedGrant;
  assert.equal(row.denominator, 2); assert.equal(row.numerator, 0); assert.equal(row.rate, 0);
});

test('ordinary subsequent private hint debit without reward ID cannot poison a valid earned grant', () => {
  const records = [...request('p'), earned('p'), wallet('p'), wallet('p', T + 3000, { transaction_id: 'private-hint-debit', rewardId: undefined, delta: -50, balance_before: 100, balance_after: 50, source: 'none', sink: 'hint_bulb' })];
  const row = current(records).earnedGrant;
  assert.equal(row.denominator, 1); assert.equal(row.numerator, 1); assert.equal(row.rate, 1);
});

test('wallet context contradicting frozen attempt does not establish first-grant sufficiency', () => {
  const week = current([...request('p'), wallet('p', T + 2000, { attemptId: 'another-attempt' })]);
  assert.equal(week.sufficiency.unknownUnits, 1); assert.equal(week.returnHelp.unknownUnits, 1);
});

test('actual first-grant balance sets sufficiency and later grants never rescue it', () => {
  const records = [...request('p'), earned('p'), wallet('p', T + 2000, { delta: 30, balance_after: 50 }),
    wallet('p', T + 9000, { rewardId: 'second-reward', transaction_id: 'second-wallet', delta: 60, balance_before: 50, balance_after: 110 }),
    ...request('rich'), wallet('rich', T + 2000, { delta: 10, balance_before: 120, balance_after: 130 })];
  const week = current(records);
  assert.equal(week.sufficiency.denominator, 2); assert.equal(week.sufficiency.numerator, 1);
  assert.equal(week.grantFlowDiagnostic.laterGrants, 1); assert.equal(week.grantFlowDiagnostic.crossedPriceAtFirstGrant, 0);
});

test('equal-time distinct first grants leave sufficiency order unknown', () => {
  const week = current([...request('p'), wallet('p'), wallet('p', T + 2000, { transaction_id: 'second', rewardId: 'second', balance_before: 100, balance_after: 180 })]);
  assert.equal(week.sufficiency.unknownUnits, 1); assert.equal(week.sufficiency.rate, null);
  assert.equal(week.grantFlowDiagnostic.sameTimestampFirstGrants, 1);
});

test('return/help denominator includes all mature granted flows and anchors first grant only', () => {
  const records = [...request('direct'), wallet('direct'), help('direct', T + 2000 + 600000),
    ...request('none'), wallet('none'), ...request('late'), wallet('late'),
    wallet('late', T + 9 * 60000, { rewardId: 'late-second', transaction_id: 'late-second', balance_before: 100, balance_after: 180 }), help('late', T + 11 * 60000),
    ...request('wrong'), wallet('wrong'), help('wrong', T + 5000, { hint_type: 'semantic', requested_hint: 'semantic' }),
    ...request('restart'), wallet('restart'), help('restart', T + 5000, { attemptId: 'restarted-same-level' })];
  const row = current(records).returnHelp;
  assert.equal(row.denominator, 5); assert.equal(row.numerator, 1); assert.equal(row.rate, 0.2);
});

test('wheel/home return intentions need actual selected help; recovery alone does not prove arrival', () => {
  const records = [...request('wheel'), wallet('wheel', T + 2000, { source: 'wheel' }),
    event('wheel', 'ui_action', T + 3000, { screen: 'wheel', action: 'return', outcome: 'accepted' }), help('wheel', T + 4000),
    ...request('intent'), wallet('intent', T + 2000, { source: 'wheel' }), event('intent', 'ui_action', T + 3000, { screen: 'wheel', action: 'return', outcome: 'accepted' }),
    ...request('recovery'), wallet('recovery'), help('recovery', T + 4000, { source: 'restore', recovery: true })];
  const row = current(records).returnHelp;
  assert.equal(row.denominator, 3); assert.equal(row.numerator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
  records.push(event('recovery', 'ui_action', T + 3000, { element_id: 'help_origin', action: 'arrive', outcome: 'returned' }));
  assert.equal(current(records).returnHelp.rate, 2 / 3);
});

test('unproven first eligibility and prior completion are never inferred from absent history', () => {
  const records = [...request('unknown'), event('unknown', 'puzzle_completed', T + 1000),
    ...eligible('prior', T, { previously_completed: undefined }), assigned('prior'), event('prior', 'puzzle_completed', T + 1000)];
  const row = current(records).primary;
  assert.equal(row.provenFirstEligibleBaseline.denominator, 0); assert.equal(row.provenFirstEligibleBaseline.rate, null);
  assert.equal(row.assignedEligibleItt.denominator, 1); assert.equal(row.assignedEligibleItt.unknownUnits, 1);
});

test('primary ITT includes no-exposure/no-ad players and requires exact original attempt within request window', () => {
  const records = [...eligible('success'), assigned('success'), event('success', 'puzzle_completed', T + 600000),
    ...eligible('none'), assigned('none'), ...eligible('restart'), assigned('restart'), event('restart', 'puzzle_completed', T + 5000, { attemptId: 'new-attempt' }),
    ...eligible('late'), assigned('late'), wallet('late', T + 9 * 60000), event('late', 'puzzle_completed', T + 600001)];
  const row = current(records).primary;
  assert.equal(row.provenFirstEligibleBaseline.denominator, 0); assert.equal(row.provenFirstEligibleBaseline.rate, null);
  assert.equal(row.assignedEligibleItt.denominator, 4); assert.equal(row.assignedEligibleItt.rate, 0.25);
  assert.equal(row.variants.control.denominator, 4); assert.equal(row.experimentStatus, 'draft_inactive');
});

test('unknown completion and conflicting assignments retain ITT denominator and uncertainty bounds', () => {
  const records = [...eligible('unknown'), assigned('unknown'), event('unknown', 'puzzle_completed', T + 1000, { timeKnown: false }),
    ...eligible('conflict'), assigned('conflict'), assigned('conflict', T + 3, { variant: 'treatment' })];
  const row = current(records).primary.assignedEligibleItt;
  assert.equal(row.denominator, 2); assert.equal(row.unknownUnits, 2); assert.equal(row.rate, null);
  assert.equal(row.bounds.lower, 0); assert.equal(row.bounds.upper, 1);
});

test('missing or contradictory completion attempt metadata is unknown instead of failure', () => {
  for (const properties of [{ attemptId: undefined }, { levelKey: 'campaign:11', levelId: 11 }, { contentVersion: 'different-content' }]) {
    const row = current([...eligible('p'), assigned('p'), event('p', 'puzzle_completed', T + 1000, properties)]).primary.assignedEligibleItt;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
  }
});

test('observed prior completion contradicts a false previously-completed claim without dropping assigned player', () => {
  const records = [event('p', 'puzzle_completed', T - 86400000, { attemptId: 'older-attempt' }), ...eligible('p'), assigned('p')];
  const row = current(records).primary;
  assert.equal(row.assignedEligibleItt.denominator, 1); assert.equal(row.assignedEligibleItt.unknownUnits, 1);
  assert.equal(row.provenFirstEligibleBaseline.rate, null);
});

test('explicitly non-first or previously completed assigned origins remain integrity unknown, not selected away', () => {
  for (const properties of [{ first_eligible_request: false }, { previously_completed: true }]) {
    const row = current([...eligible('p', T, properties), assigned('p')]).primary.assignedEligibleItt;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
  }
});

test('ambiguous repeated visit identity and missing callback operation links expose gaps', () => {
  const records = [event('p', 'wheel_opened', T, { screen_visit_id: 'v', ready_at_entry: true, rewarded_eligible: true, rewarded_state: 'ready' }),
    event('p', 'wheel_opened', T + 1, { screen_visit_id: 'v', ready_at_entry: false, rewarded_eligible: true, rewarded_state: 'loading' }),
    event('p', 'ad_lifecycle', T, { format: 'rewarded', stage: 'show_intent', outcome: 'accepted', operation: 'show', opportunity_id: 'ao', request_id: 'ar', operation_id: 'tap' }),
    event('p', 'ad_lifecycle', T + 1000, { format: 'rewarded', stage: 'shown', operation: 'show', opportunity_id: 'ao', request_id: 'ar' })];
  const week = current(records);
  assert.equal(week.readiness.wheel.unprovenDenominatorUnits, 1); assert.equal(week.readiness.wheel.rate, null);
  assert.equal(week.show.denominator, 1); assert.equal(week.show.unknownUnits, 1); assert.equal(week.show.rate, null);
});

test('generic startup install assignment cannot stand in for first-eligible SDK player assignment', () => {
  const records = [...eligible('p'), assigned('p', T - 1000, { unit_type: 'sdk_install', origin_interaction_id: undefined, interaction_id: undefined }), event('p', 'puzzle_completed', T + 1000)];
  const row = current(records).primary;
  assert.equal(row.provenFirstEligibleBaseline.rate, null); assert.equal(row.assignedEligibleItt.denominator, 0);
  assert.equal(row.assignedEligibleItt.rate, null); assert.equal(row.phaseCoverage.ambiguousScopeAssignmentUnits, 1); assert.equal(row.phaseCoverage.trialAssignmentLoss, 1);
});

test('target SDK-player assignment with lost original request retains an unknown ITT unit', () => {
  const row = current([assigned('p', T, { origin_interaction_id: undefined, attemptId: undefined })]).primary;
  assert.equal(row.assignedEligibleItt.denominator, 1); assert.equal(row.assignedEligibleItt.unknownUnits, 1);
  assert.equal(row.assignedEligibleItt.rate, null); assert.equal(row.unknownVariantAssignedUnits, 0); assert.equal(row.variants.control.unknownUnits, 1);
});

test('multiple first claims or allocation versions cannot select a favorable cohort or double count player', () => {
  const alternate = { origin_interaction_id: 'second-origin', interaction_id: 'second-origin', attemptId: 'second-attempt' };
  const records = [...eligible('p'), assigned('p'), ...eligible('p', T + 100, alternate), assigned('p', T + 102, { ...alternate, assignment_id: 'second-assignment' }),
    ...eligible('q'), assigned('q', T + 2, { allocation_version: 2 })];
  const row = current(records).primary;
  assert.equal(row.assignedEligibleItt.denominator, 1); assert.equal(row.assignedEligibleItt.unknownUnits, 1);
  assert.equal(row.phaseCoverage.ambiguousScopeAssignmentUnits, 1); assert.equal(row.phaseCoverage.possibleAssignedUnitUpper, 2);
  assert.equal(row.allocationScope.valid, false); assert.equal(row.assignedEligibleItt.rate, null);
});

test('calendar install D1/D7 use exact target day, fixed timezone and separate gameplay return', () => {
  const installed = { install_datetime: '2026-10-21T20:59:00Z', install_kind: 'first' };
  const records = [event('p', 'install', '2026-10-21T20:59:00Z', {}, { ...installed, record_type: 'install' }),
    event('p', 'session_start', '2026-10-21T21:00:00Z', {}, { ...installed, record_type: 'session' }),
    event('p', 'help_used', '2026-10-28T12:00:00Z', { source: 'explicit' }, installed)];
  const row = analyze(records, options).metrics.weeks[0].installReturn;
  assert.equal(row.D1.open.rate, 1); assert.equal(row.D1.gameplay.rate, 0);
  assert.equal(row.D7.open.rate, 0); assert.equal(row.D7.gameplay.rate, 1);
});

test('partial target day excludes early return from mature denominator and unknown/reinstall is not first install', () => {
  const installed = { install_datetime: '2026-10-28T09:00:00Z', install_kind: 'first' };
  const records = [event('p', 'install', T, {}, { ...installed, record_type: 'install' }), event('p', 'app_open', '2026-11-04T09:00:00Z', {}, installed),
    event('q', 'install', T, {}, { ...installed, record_type: 'install', install_kind: 'reinstall' }),
    event('r', 'install', T, {}, { ...installed, record_type: 'install', install_kind: undefined })];
  const row = current(records, { asOf: '2026-11-04T12:00:00Z' });
  assert.equal(row.installReturn.D7.open.denominator, 0); assert.equal(row.installReturn.D7.open.immatureUnits, 1);
  assert.equal(row.installClassification.first, 1); assert.equal(row.installClassification.reinstall, 1); assert.equal(row.installClassification.unknown, 1);
});

test('assignment calendar returns anchor first eligible request day independently of old install', () => {
  const old = Date.parse('2026-10-21T09:00:00Z');
  const records = [...eligible('p', old), assigned('p', old), event('p', 'app_open', '2026-10-22T09:00:00Z'), event('p', 'help_used', '2026-10-28T09:00:00Z', { source: 'explicit' })];
  const row = analyze(records, options).metrics.weeks[0];
  assert.equal(row.installReturn.D1.open.denominator, 0);
  assert.equal(row.experimentReturn.D1.open.rate, 1); assert.equal(row.experimentReturn.D7.gameplay.rate, 1);
});

test('auto entry/resume/completion alone is not gameplay return; voluntary manual input and legacy hint are', () => {
  const installed = { install_datetime: '2026-10-21T09:00:00Z', install_kind: 'first' };
  const records = [];
  for (const player of ['entry', 'manual', 'hint', 'auto', 'recovery']) records.push(event(player, 'install', '2026-10-21T09:00:00Z', {}, { ...installed, record_type: 'install' }));
  for (const name of ['puzzle_started', 'puzzle_resumed', 'puzzle_completed']) records.push(event('entry', name, '2026-10-22T09:00:00Z', {}, installed));
  records.push(event('manual', 'word_submitted', '2026-10-22T09:00:00Z', { manual: true }, installed),
    event('hint', 'hint_used', '2026-10-22T09:00:00Z', { source: 'explicit', manual: true }, installed),
    event('auto', 'word_submit_outcome', '2026-10-22T09:00:00Z', { manual: false, kind: 'grid' }, installed),
    event('auto', 'gameplay_action', '2026-10-22T09:00:00Z', { action: 'letters_connected' }, installed),
    event('recovery', 'help_used', '2026-10-22T09:00:00Z', { source: 'restore', recovery: true }, installed));
  const row = analyze(records, options).metrics.weeks[0].installReturn.D1;
  assert.equal(row.open.numerator, 0); assert.equal(row.open.rate, 0);
  assert.equal(row.gameplay.denominator, 5); assert.equal(row.gameplay.numerator, 2); assert.equal(row.gameplay.unknownUnits, 1);
  assert.equal(row.gameplay.rate, null); assert.equal(row.gameplay.observedKnownRate, 0.5);
});

test('word raw/fixed comparison reuses actual point 3 API and formula unchanged', () => {
  const records = [];
  for (const [time, invalid] of [[T - 7 * 86400000, 3], [T, 1]]) for (let i = 0; i < 4; i++) records.push(event('p', 'word_submit_outcome', time + i * 1000, { manual: true, kind: i < invalid ? 'invalid' : 'grid' }));
  const report = analyze(records, options); const original = analyzeProductImprovements(records, options);
  assert.deepEqual(report.metrics.invalidInputComparison, original.comparison);
  assert.deepEqual(report.metrics.weeks[0].invalidInput, original.weeks[0].manualInputs);
  assert.equal(report.metrics.invalidInputComparison.metrics.invalid.raw.change, -0.5);
});

test('unknown clock/consent/availability produces null rather than fabricated known zero', () => {
  for (const change of [{ time_trust: 'client_clock_anomaly' }, { consent_state: undefined }, { is_available: undefined }]) {
    const records = [...eligible('p', T, change), assigned('p')]; const row = current(records).primary.assignedEligibleItt;
    assert.equal(row.rate, null); assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1);
  }
  const knownZero = current([...eligible('p'), assigned('p')]).primary.assignedEligibleItt;
  assert.equal(knownZero.rate, 0);
});

test('public reports contain no private join IDs, raw words, email or fingerprints', () => {
  const records = [...eligible('private-sdk-player'), assigned('private-sdk-player'), earned('private-sdk-player'), wallet('private-sdk-player'), help('private-sdk-player', T + 5000, { word: 'PRIVATE_WORD_NEVER_PRINT', rawInput: 'PRIVATE_RAW_INPUT', email: 'private@example.test' })];
  const report = analyze(records, options); const serialized = JSON.stringify(report) + renderMarkdown(report);
  for (const secret of ['private-sdk-player', 'origin-private', 'attempt-private', 'request-private', 'reward-private', 'wallet-private', 'assignment-private', 'PRIVATE_WORD_NEVER_PRINT', 'PRIVATE_RAW_INPUT', 'private@example.test', 'fp_0123456789abcdef']) assert.equal(serialized.includes(secret), false, secret);
});

test('R1 canonical validation retains assigned units for invalid dates, unbounded keys, mismatched mode/level IDs', () => {
  for (const properties of [
    { mode: 'daily', levelKey: 'daily:2026-99-99' }, { mode: 'daily', levelKey: 'daily:2026-02-29' },
    { levelKey: 'campaign:' + '9'.repeat(10000) }, { levelKey: 'campaign:9007199254740992', levelId: undefined },
    { mode: 'daily', levelKey: 'campaign:10' }, { levelKey: 'campaign:10', levelId: 11 },
    { levelKey: 'campaign:10', levelId: '10' }, { mode: 'daily', levelKey: 'daily:2026-10-28', dateKey: '2026-10-29' },
  ]) {
    const row = current([...eligible('p', T, properties), assigned('p', T, properties), event('p', 'puzzle_completed', T + 1000, properties)]).primary.assignedEligibleItt;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.numerator, 0); assert.equal(row.rate, null);
    assert.equal(row.strata[0].level, 'unknown'); assert.ok(JSON.stringify(row).length < 5000);
  }
  const leap = { mode: 'daily', levelKey: 'daily:2024-02-29', dateKey: '2024-02-29' };
  assert.equal(current([...eligible('p', T, leap), assigned('p', T, leap), event('p', 'puzzle_completed', T + 1000, leap)]).primary.assignedEligibleItt.rate, 1);
});

test('R1 disjoint content proofs cannot match completion, grant or help without an explicit compact entry bridge', () => {
  const original = { contentVersion: undefined }; const disjoint = { content_fingerprint: undefined, contentVersion: 'version-b' };
  const records = [...eligible('p', T, original), assigned('p', T, original), event('p', 'puzzle_completed', T + 1000, disjoint)];
  const primary = current(records).primary;
  assert.equal(primary.provenFirstEligibleBaseline.denominator, 0); assert.equal(primary.assignedEligibleItt.denominator, 1); assert.equal(primary.assignedEligibleItt.rate, null);
  const grant = current([...request('p', T, original), wallet('p', T + 2000, disjoint)]);
  assert.equal(grant.sufficiency.unknownUnits, 1); assert.equal(grant.returnHelp.unknownUnits, 1);
  const use = current([...request('p', T, original), wallet('p', T + 2000, original), help('p', T + 3000, disjoint)]);
  assert.equal(use.sufficiency.rate, 1); assert.equal(use.returnHelp.unknownUnits, 1);
  const bridge = event('p', 'puzzle_started', T - 1000, { contentVersion: 'version-b', difficulty_tier: 4 });
  assert.equal(current([bridge, ...records]).primary.assignedEligibleItt.rate, 1);
  const insufficientBridge = event('p', 'puzzle_started', T - 1000, disjoint);
  assert.equal(current([insufficientBridge, ...records]).primary.assignedEligibleItt.rate, null);
});

test('R1 grants before request or linked earning remain unknown and cannot be rescued by a later grant', () => {
  for (const grants of [
    [wallet('p', T - 1)],
    [wallet('p', T - 1), wallet('p', T + 2000, { transaction_id: 'later-credit', rewardId: 'later-reward' })],
    [earned('p', T + 3000), wallet('p', T + 2000)],
    [earned('p', T - 1), wallet('p', T + 2000)],
  ]) {
    const row = current([...request('p'), ...grants, help('p', T + 4000)]);
    for (const metric of [row.sufficiency, row.returnHelp]) { assert.equal(metric.denominator, 1); assert.equal(metric.unknownUnits, 1); assert.equal(metric.rate, null); }
  }
  const sameClock = current([...request('p'), earned('p', T), wallet('p', T), help('p', T + 1000)]);
  assert.equal(sameClock.sufficiency.rate, 1); assert.equal(sameClock.returnHelp.rate, 1);
});

test('R1 mixed same-timestamp first grants are unknown for both metrics in every input permutation', () => {
  const direct = wallet('p'); const wheel = wallet('p', T + 2000, { source: 'wheel', transaction_id: 'wheel-credit', rewardId: 'wheel-reward', delta: 50, balance_before: 100, balance_after: 150 });
  const one = current([...request('p'), direct, wheel, help('p', T + 3000)]);
  const two = current([...request('p'), wheel, direct, help('p', T + 3000)]);
  for (const name of ['sufficiency', 'returnHelp']) {
    assert.equal(one[name].denominator, 1); assert.equal(one[name].unknownUnits, 1); assert.equal(one[name].rate, null);
    assert.deepEqual(one[name], two[name]);
  }
  assert.equal(current([...request('p'), direct, help('p', T + 3000)]).returnHelp.rate, 1);
});

test('R1 wallet semantic copies reconcile immutable attempt/content/source without choosing favorable delivery', () => {
  const good = wallet('p');
  for (const fields of [{ attemptId: 'different-attempt' }, { contentVersion: 'different-version' },
    { content_fingerprint: 'fp_1111111111111111' }, { source: 'wheel' }, { entry_source: 'home_help_resume' }]) {
    const bad = structuredClone(good); Object.assign(bad.event_json, fields, { event_id: `different-delivery-${++sequence}` });
    const reports = [[good, bad], [bad, good]].map((copies) => analyze([...request('p'), earned('p'), ...copies, help('p', T + 3000)], options));
    for (const report of reports) {
      assert.equal(report.quality.conflictingWalletFacts, 1);
      for (const metric of ['sufficiency', 'returnHelp', 'earnedGrant']) { const row = report.metrics.weeks[1][metric]; assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null); }
    }
    for (const name of ['sufficiency', 'returnHelp', 'earnedGrant']) assert.deepEqual(reports[0].metrics.weeks[1][name], reports[1].metrics.weeks[1][name]);
  }
});

test('R1 missing-to-known wallet context enrichment remains valid independent of delivery order and SDK sender', () => {
  const full = wallet('p'); const partial = structuredClone(full); partial.app_version_name = '0.1.30';
  Object.assign(partial.event_json, { event_id: 'partial-wallet-copy', attemptId: undefined, contentVersion: undefined, content_fingerprint: undefined, source: undefined });
  const reports = [[partial, full], [full, partial]].map((copies) => analyze([...request('p'), earned('p'), ...copies, help('p', T + 3000)], options));
  for (const report of reports) {
    assert.equal(report.quality.conflictingWalletFacts, 0);
    assert.equal(report.metrics.weeks[1].sufficiency.rate, 1); assert.equal(report.metrics.weeks[1].returnHelp.rate, 1); assert.equal(report.metrics.weeks[1].earnedGrant.rate, 1);
  }
  assert.deepEqual(reports[0].metrics, reports[1].metrics);
});

test('R1 false-first contradictory readiness eligibility cannot be excluded before reconciliation', () => {
  const no = event('p', 'wheel_opened', T, { screen_visit_id: 'same', rewarded_eligible: false, ready_at_entry: false, rewarded_state: 'daily_limit' });
  const yes = event('p', 'wheel_opened', T + 1, { screen_visit_id: 'same', rewarded_eligible: true, ready_at_entry: false, rewarded_state: 'loading' });
  const ready = event('q', 'wheel_opened', T, { screen_visit_id: 'known', rewarded_eligible: true, ready_at_entry: true, rewarded_state: 'ready' });
  const a = current([no, yes, ready]).readiness.wheel; const b = current([ready, yes, no]).readiness.wheel;
  assert.equal(a.denominator, 1); assert.equal(a.numerator, 1); assert.equal(a.unprovenDenominatorUnits, 1); assert.equal(a.ineligibleUnits, 0); assert.equal(a.rate, null);
  assert.deepEqual(a, b);
});

test('R1 shown at or after explicit terminal is unknown; valid shown before terminal remains success', () => {
  const ad = (stage, time) => event('p', 'ad_lifecycle', time, { format: 'rewarded', stage, operation: 'show', outcome: stage === 'show_intent' ? 'accepted' : 'failed', opportunity_id: 'ao', request_id: 'ar', operation_id: 'tap', placement: 'hint' });
  for (const stage of ['error', 'closed']) for (const shownAt of [T + 1000, T + 2000]) {
    const events = [ad('show_intent', T), ad(stage, T + 1000), ad('shown', shownAt)];
    const a = current(events).show; const b = current([...events].reverse()).show;
    assert.equal(a.denominator, 1); assert.equal(a.unknownUnits, 1); assert.equal(a.rate, null); assert.deepEqual(a, b);
  }
  assert.equal(current([ad('show_intent', T), ad('shown', T + 500), ad('closed', T + 1000)]).show.rate, 1);
});

test('R1 assignment is the first-tap logical transaction, never retrospective or an arbitrary latency window', () => {
  for (const time of [T - 1, T + 1, T + 2000, T + 600001]) {
    const row = current([...eligible('p'), assigned('p', time), event('p', 'puzzle_completed', T + 1000)]).primary.assignedEligibleItt;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
  }
  const positive = current([...eligible('p'), assigned('p'), event('p', 'puzzle_completed', T + 1000)]).primary.assignedEligibleItt;
  assert.equal(positive.rate, 1); assert.equal(positive.strata[0].channel, 'not_applicable');
});

test('R1 equality without order proof for exposure/outcome/treatment does not establish prospective assignment', () => {
  const exposure = { experiment_id: 'slova_wheel_help_clarity_20261104', assignment_id: 'assignment-p', variant: 'control', allocation_version: 1,
    eligibility_version: 'help_deficit_v1', measurement_phase: 'trial', eligibility_epoch: trialEpoch, trial_plan_fingerprint: trialPlan };
  for (const blocker of [event('p', 'experiment_exposed', T, exposure), event('p', 'puzzle_completed', T), event('p', 'no_coins_shown', T)]) {
    const row = current([...eligible('p'), assigned('p'), blocker, event('p', 'puzzle_completed', T + 1000)]).primary.assignedEligibleItt;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
  }
  assert.equal(current([...eligible('p'), assigned('p'), event('p', 'experiment_exposed', T + 1, exposure), event('p', 'puzzle_completed', T + 1000)]).primary.assignedEligibleItt.rate, 1);
  const late = Date.parse('2026-11-03T20:55:00Z');
  const immature = current([...eligible('p', late), assigned('p', late), event('p', 'puzzle_completed', late + 1000)]).primary.assignedEligibleItt;
  assert.equal(immature.immatureUnits, 1); assert.equal(immature.denominator, 0); assert.equal(immature.numerator, 0); assert.equal(immature.rate, null);
});

test('R1 metric-specific free option and placement strata retain one-flow counting', () => {
  const exposure = (element, channel, time) => event('p', 'feature_exposed', time, { modal_id: 'm', feature: 'wheel_entry', element_id: element, free_or_rewarded: channel, visibility_rule: 'half_1s_v2', visibility_ms: 1000, visible_fraction: 0.5 });
  const records = [...request('p'), exposure('free_wheel', 'free', T + 1000),
    event('p', 'no_coins_action', T + 2000, { modal_id: 'm', interaction_id: 'tap', action: 'free_wheel', outcome: 'selected', free_or_rewarded: 'free' }),
    event('p', 'wheel_opened', T + 3000, { modal_id: 'm', interaction_id: 'tap', screen_visit_id: 'v', free_or_rewarded: 'free' })];
  const single = current(records).wheelEntry;
  assert.equal(single.denominator, 1); assert.equal(single.strata[0].entryElement, 'free_wheel'); assert.equal(single.strata[0].channel, 'free');
  const mixed = current([...records, exposure('wheel', 'rewarded', T + 1500)]).wheelEntry;
  assert.equal(mixed.denominator, 1); assert.equal(mixed.strata[0].entryElement, 'mixed'); assert.equal(mixed.strata[0].channel, 'mixed');
  const ad = (stage, time) => event('q', 'ad_lifecycle', time, { format: 'rewarded', placement: 'wheel', stage, operation: 'show', outcome: 'accepted', opportunity_id: 'ao', request_id: 'ar', operation_id: 'tap', rewardId: 'reward-q' });
  const ads = current([ad('show_intent', T), ad('shown', T + 500), ad('reward', T + 1000), wallet('q')]);
  for (const row of [ads.show, ads.earnedGrant]) { assert.equal(row.rate, 1); assert.equal(row.strata[0].placement, 'wheel'); assert.equal(row.strata[0].channel, 'rewarded'); }
  const direct = current([...request('p'), wallet('p'), help('p', T + 3000)]);
  for (const row of [direct.sufficiency, direct.returnHelp]) { assert.equal(row.rate, 1); assert.equal(row.strata[0].channel, 'rewarded'); }
});

test('R1 difficulty joins only consistent compact exact-attempt entries and rejects wrong-attempt metadata', () => {
  const flow = [...request('p'), wallet('p'), help('p', T + 3000)];
  const entry = event('p', 'puzzle_started', T - 1000, { difficulty_tier: 4, difficulty_role: 'hard', mechanic: 'ordered' });
  const good = current([entry, ...flow]);
  assert.equal(good.sufficiency.rate, 1); assert.equal(good.sufficiency.strata[0].difficulty, 4); assert.equal(good.returnHelp.strata[0].difficulty, 4);
  assert.equal(current([event('p', 'puzzle_started', T - 1000, { attemptId: 'other-attempt', difficulty_tier: 5 }), ...flow]).sufficiency.strata[0].difficulty, null);
  const contradictory = event('p', 'puzzle_resumed', T - 500, { content_fingerprint: 'fp_1111111111111111', difficulty_tier: 5 });
  const a = current([entry, contradictory, ...flow]); const b = current([contradictory, entry, ...flow]);
  assert.equal(a.sufficiency.rate, null); assert.equal(a.sufficiency.strata[0].difficulty, null); assert.deepEqual(a.sufficiency, b.sufficiency);
});

test('R2 earned semantic copies reconcile every known consent/provenance/business contradiction in both orders', () => {
  const good = earned('p', T + 1000, { consent_epoch_at: '2026-10-01T00:00:00Z' });
  const variations = [
    { consent_state: 'disabled' }, { consent_state: 'invalid-consent' }, { environment: 'staging' },
    { schema_version: 2 }, { schema_version: 4 }, { time_trust: 'client_clock_anomaly' }, { timeKnown: false },
    { time_trust: 'invalid-clock-trust' }, { consent_epoch_at: '2026-10-02T00:00:00Z' }, { consent_epoch_at: 'invalid-epoch' },
    { consent_epoch_at: new Date(T + 999999).toISOString() }, { attemptId: 'different-attempt' },
    { contentVersion: 'other-version' }, { placement: 'wheel' }, { format: 'interstitial' }, { request_id: 'different-request' },
  ];
  for (const fields of variations) {
    const bad = structuredClone(good); Object.assign(bad.event_json, fields, { event_id: `semantic-earned-${++sequence}` });
    const rows = [[good, bad], [bad, good]].map((copies) => current([...copies, wallet('p')]).earnedGrant);
    for (const row of rows) { assert.equal(row.denominator, 1); assert.equal(row.numerator, 0); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null); assert.deepEqual(row.bounds, { lower: 0, upper: 1, conditionalOnKnownDenominator: false }); }
    assert.deepEqual(rows[0], rows[1]);
  }
});

test('R2 accepted-intent semantic copies cannot select favorable consent/context or filtered operation fields', () => {
  const ad = (stage, time) => event('p', 'ad_lifecycle', time, { format: 'rewarded', placement: 'hint', operation: 'show', stage,
    outcome: stage === 'show_intent' ? 'accepted' : undefined, opportunity_id: 'ao', request_id: 'ar', operation_id: 'tap', consent_epoch_at: '2026-10-01T00:00:00Z' });
  const good = ad('show_intent', T);
  for (const fields of [{ consent_state: 'disabled' }, { environment: 'qa' }, { schema_version: 4 }, { timeKnown: false },
    { time_trust: 'client_clock_anomaly' }, { consent_epoch_at: '2026-10-02T00:00:00Z' }, { consent_epoch_at: 'invalid' },
    { attemptId: 'another-attempt' }, { content_fingerprint: 'fp_1111111111111111' }, { entry_source: 'home_help_resume' },
    { operation: 'load' }, { outcome: 'rejected' }, { format: 'banner' }, { operation_id: 'other-operation' }]) {
    const bad = structuredClone(good); Object.assign(bad.event_json, fields, { event_id: `semantic-intent-${++sequence}` });
    const rows = [[good, bad], [bad, good]].map((copies) => current([...copies, ad('shown', T + 1000)]).show);
    for (const row of rows) { assert.equal(row.denominator, 1); assert.equal(row.acceptedIntents, 1); assert.equal(row.numerator, 0); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null); assert.deepEqual(row.bounds, { lower: 0, upper: 1 }); }
    assert.deepEqual(rows[0], rows[1]);
  }
});

test('R2 contradictory metadata inside one copy and excluded QA evidence cannot disappear from semantic proof', () => {
  const good = earned('p');
  for (const extra of [{ consent_state: 'disabled' }, { environment: 'staging' }, { is_qa: true }]) {
    const bad = { ...structuredClone(good), ...extra };
    bad.event_json.event_id = `metadata-conflict-${++sequence}`;
    const rows = [[good, bad], [bad, good]].map((copies) => current([...copies, wallet('p')]).earnedGrant);
    assert.equal(rows[0].unknownUnits, 1); assert.equal(rows[0].rate, null); assert.deepEqual(rows[0], rows[1]);
  }
  const qa = earned('p', T + 1000, { environment: 'qa' });
  const pure = current([event('unrelated', 'app_open', T), qa]).earnedGrant;
  assert.equal(pure.denominator, 0); assert.equal(pure.rate, null);
});

test('R2 coherent missing-to-known ad enrichment and live/recovery SDK sender replay remain positive', () => {
  const full = earned('p', T + 1000, { recovery: false, consent_epoch_at: '2026-10-01T00:00:00Z' });
  const partial = structuredClone(full); partial.app_version_name = '0.1.30';
  Object.assign(partial.event_json, { event_id: 'partial-earned', recovery: true, consent_state: undefined, consent_epoch_at: undefined,
    schema_version: undefined, app_version: undefined, attemptId: undefined, contentVersion: undefined, content_fingerprint: undefined });
  const earnedRows = [[full, partial], [partial, full]].map((copies) => current([...copies, wallet('p')]).earnedGrant);
  assert.equal(earnedRows[0].rate, 1); assert.equal(earnedRows[0].denominator, 1); assert.equal(earnedRows[0].diagnostic.duplicateEarnedDeliveries, 1); assert.deepEqual(earnedRows[0], earnedRows[1]);
  const intent = event('p', 'ad_lifecycle', T, { stage: 'show_intent', format: 'rewarded', placement: 'hint', operation: 'show', outcome: 'accepted', request_id: 'ar', opportunity_id: 'ao', operation_id: 'tap' });
  const intentCopy = structuredClone(intent); Object.assign(intentCopy.event_json, { event_id: 'partial-intent', consent_state: undefined, contentVersion: undefined, content_fingerprint: undefined }); intentCopy.app_version_name = '0.1.30';
  const shown = event('p', 'ad_lifecycle', T + 1000, { stage: 'shown', format: 'rewarded', placement: 'hint', operation: 'show', request_id: 'ar', opportunity_id: 'ao', operation_id: 'tap' });
  const showRows = [[intent, intentCopy], [intentCopy, intent]].map((copies) => current([...copies, shown]).show);
  assert.equal(showRows[0].rate, 1); assert.equal(showRows[0].denominator, 1); assert.deepEqual(showRows[0], showRows[1]);
});

test('R2 an ad delivery recovery marker with the same event ID is transport-only in either order', () => {
  const live = earned('p', T + 1000, { recovery: false }); const replay = structuredClone(live);
  replay.event_json.recovery = true; replay.app_version_name = '0.1.30';
  const reports = [[live, replay], [replay, live]].map((copies) => analyze([...copies, wallet('p')], options));
  for (const report of reports) { assert.equal(report.quality.deliveryDuplicates, 1); assert.equal(report.quality.conflictingDeliveries, 0); assert.equal(report.metrics.weeks[1].earnedGrant.rate, 1); }
  assert.deepEqual(reports[0].metrics, reports[1].metrics);
});

test('R2 shown callback copies also reconcile known conflicting and coherently missing provenance', () => {
  const ad = (stage, when) => event('p', 'ad_lifecycle', when, { stage, format: 'rewarded', placement: 'hint', operation: 'show',
    outcome: stage === 'show_intent' ? 'accepted' : undefined, opportunity_id: 'ao', request_id: 'ar', operation_id: 'tap' });
  const shown = ad('shown', T + 1000); const bad = structuredClone(shown); Object.assign(bad.event_json, { event_id: 'bad-shown', consent_state: 'disabled' });
  const rows = [[shown, bad], [bad, shown]].map((copies) => current([ad('show_intent', T), ...copies]).show);
  assert.equal(rows[0].unknownUnits, 1); assert.equal(rows[0].rate, null); assert.deepEqual(rows[0], rows[1]);
  const partial = structuredClone(shown); Object.assign(partial.event_json, { event_id: 'partial-shown', consent_state: undefined });
  assert.equal(current([ad('show_intent', T), partial, shown]).show.rate, 1);
});

test('R2 full wheel chain validates the frozen origin, exposure, tap and open rather than downstream agreement alone', () => {
  const chain = () => [...request('p'),
    event('p', 'feature_exposed', T + 1000, { modal_id: 'm', feature: 'wheel_entry', element_id: 'wheel', visibility_rule: 'half_1s_v2', visibility_ms: 1000, visible_fraction: 0.5 }),
    event('p', 'no_coins_action', T + 2000, { modal_id: 'm', interaction_id: 'tap', action: 'wheel', outcome: 'selected' }),
    event('p', 'ui_action', T + 2100, { modal_id: 'm', element_id: 'no_coins', action: 'exit', outcome: 'unmount' }),
    event('p', 'wheel_opened', T + 3000, { modal_id: 'm', interaction_id: 'tap', screen_visit_id: 'v' })];
  assert.equal(current(chain()).wheelEntry.rate, 1);
  for (const indices of [[2, 3, 5], [2], [3], [5]]) for (const fields of [{ attemptId: 'other-attempt' },
    { mode: 'daily', levelKey: 'daily:2026-10-28' }, { contentVersion: 'other-content' }, { content_fingerprint: 'fp_1111111111111111' }]) {
    const records = chain(); for (const index of indices) Object.assign(records[index].event_json, fields);
    const a = current(records).wheelEntry; const b = current([...records].reverse()).wheelEntry;
    assert.equal(a.denominator, 1); assert.equal(a.unknownUnits, 1); assert.equal(a.numerator, 0); assert.equal(a.rate, null); assert.deepEqual(a, b);
  }
  const foreignTap = chain(); foreignTap[3].appmetrica_device_id = 'foreign-sdk';
  assert.equal(current(foreignTap).wheelEntry.unknownUnits, 1); assert.equal(current(foreignTap).wheelEntry.rate, null);
});

test('R2 disjoint wheel tap content stays unknown while a consistent compact entry bridge remains valid', () => {
  const records = [...request('p', T, { contentVersion: undefined }),
    event('p', 'feature_exposed', T + 1000, { modal_id: 'm', feature: 'wheel_entry', element_id: 'wheel', visibility_rule: 'half_1s_v2', visibility_ms: 1000, visible_fraction: 0.5, contentVersion: undefined }),
    event('p', 'no_coins_action', T + 2000, { modal_id: 'm', interaction_id: 'tap', action: 'wheel', outcome: 'selected', content_fingerprint: undefined, contentVersion: 'bridged-version' }),
    event('p', 'wheel_opened', T + 3000, { modal_id: 'm', interaction_id: 'tap', contentVersion: undefined })];
  const uncertain = current(records).wheelEntry;
  assert.equal(uncertain.denominator, 1); assert.equal(uncertain.unknownUnits, 1); assert.equal(uncertain.rate, null);
  const entry = event('p', 'puzzle_started', T - 1000, { contentVersion: 'bridged-version', difficulty_tier: 4 });
  const valid = current([entry, ...records]).wheelEntry;
  assert.equal(valid.rate, 1); assert.equal(valid.strata[0].difficulty, 4);
});

test('leader R2 known post-opt-in help uses wall time independently of old-attempt active coverage', () => {
  const before = new Date(T - 10000).toISOString(); const after = new Date(T + 1000).toISOString();
  const base = [...request('p', T, { time_coverage: 'mixed_consent', consent_epoch_at: before }), wallet('p', T + 2000, { consent_epoch_at: after })];
  for (const coverage of ['full_attempt', 'since_restore', 'mixed_consent']) {
    const row = current([...base, help('p', T + 3000, { time_coverage: coverage, consent_epoch_at: after, recovery: false })]).returnHelp;
    assert.equal(row.denominator, 1); assert.equal(row.numerator, 1); assert.equal(row.rate, 1);
  }
  const use = help('p', T + 3000, { time_coverage: 'full_attempt', activeTimeMs: 1000, consent_epoch_at: after, recovery: false });
  const replay = structuredClone(use); Object.assign(replay.event_json, { time_coverage: 'mixed_consent', activeTimeMs: 500 });
  const reports = [[use, replay], [replay, use]].map((copies) => analyze([...base, ...copies], options));
  for (const report of reports) { assert.equal(report.quality.deliveryDuplicates, 1); assert.equal(report.metrics.weeks[1].returnHelp.rate, 1); }
  assert.deepEqual(reports[0].metrics.weeks[1].returnHelp, reports[1].metrics.weeks[1].returnHelp);
});

test('leader R2 active-coverage separation keeps per-event unknown, disabled, pre-epoch and recovery help unsupported', () => {
  const before = new Date(T - 10000).toISOString(); const after = new Date(T + 1000).toISOString();
  for (const fields of [{ timeKnown: false }, { consent_state: 'disabled' }, { consent_epoch_at: new Date(T + 4000).toISOString() }, { source: 'restore', recovery: true }]) {
    const row = current([...request('p', T, { consent_epoch_at: before }), wallet('p', T + 2000, { consent_epoch_at: after }),
      help('p', T + 3000, { time_coverage: 'mixed_consent', consent_epoch_at: after, recovery: false, ...fields })]).returnHelp;
    assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
  }
});

test('leader R2 legal origin and completion across consent epochs remain a wall-clock primary success', () => {
  const oldEpoch = new Date(T - 10000).toISOString(); const newEpoch = new Date(T + 500).toISOString();
  const base = [event('p', 'puzzle_started', T - 1000, { time_coverage: 'mixed_consent', consent_epoch_at: oldEpoch }),
    ...eligible('p', T, { time_coverage: 'mixed_consent', consent_epoch_at: oldEpoch }), assigned('p', T, { consent_epoch_at: oldEpoch }),
    event('p', 'word_submit_outcome', T + 600, { manual: true, kind: 'grid', consent_epoch_at: newEpoch }),
    event('p', 'app_open', T + 250, { consent_state: 'disabled' })];
  const completed = event('p', 'puzzle_completed', T + 1000, { activeTimeMs: 1000, time_coverage: 'mixed_consent', consent_epoch_at: newEpoch });
  const row = current([...base, completed]).primary.assignedEligibleItt;
  assert.equal(row.denominator, 1); assert.equal(row.numerator, 1); assert.equal(row.rate, 1);
  const active = analyzeProductImprovements([...base, completed], options).weeks[1].completedActiveTimeMs;
  assert.equal(active.fullCoverage.observations, 0); assert.equal(active.partialCoverage, 1);
  assert.equal(current(base).primary.assignedEligibleItt.rate, null, 'consent gap without a proven completion remains unknown');
  for (const fields of [{ timeKnown: false }, { consent_state: 'disabled' }, { consent_epoch_at: new Date(T + 2000).toISOString() }]) {
    const invalid = structuredClone(completed); Object.assign(invalid.event_json, fields);
    const unknown = current([...base, invalid]).primary.assignedEligibleItt;
    assert.equal(unknown.denominator, 1); assert.equal(unknown.unknownUnits, 1); assert.equal(unknown.rate, null);
  }
});

test('leader R2 calendar voluntary actions after opt-in do not require full-attempt active coverage', () => {
  const installed = { install_datetime: '2026-10-21T09:00:00Z', install_kind: 'first' }; const action = Date.parse('2026-10-22T09:00:00Z');
  const epoch = new Date(action - 1000).toISOString();
  const install = event('p', 'install', '2026-10-21T09:00:00Z', {}, { ...installed, record_type: 'install' });
  for (const name of ['word_submitted', 'help_used']) {
    const positive = event('p', name, action, { manual: true, source: 'explicit', recovery: false, time_coverage: 'mixed_consent', consent_epoch_at: epoch }, installed);
    assert.equal(analyze([install, positive], options).metrics.weeks[0].installReturn.D1.gameplay.rate, 1);
    for (const fields of [{ timeKnown: false }, { consent_state: 'disabled' }, { consent_epoch_at: new Date(action + 1000).toISOString() }, { source: 'restore', recovery: true }]) {
      const invalid = structuredClone(positive); Object.assign(invalid.event_json, fields);
      const row = analyze([install, invalid], options).metrics.weeks[0].installReturn.D1.gameplay;
      assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.rate, null);
    }
  }
});

test('R3 absent outcomes across a legally witnessed re-opt-in stay unknown for all four windows, including legacy null', () => {
  for (const kind of ['primary', 'earned', 'help', 'calendar']) for (const legacy of [false, true]) {
    const frame = epochWindow(kind, legacy); const E = frame.start + 500;
    const zero = frame.metric(frame.base); assert.equal(zero.denominator, 1); assert.equal(zero.rate, 0);
    const witness = frame.fact('app_open', frame.start + 1000, E);
    const rows = [frame.base.concat(witness), frame.base.concat(witness).reverse()].map(frame.metric);
    for (const row of rows) { assert.equal(row.denominator, 1); assert.equal(row.unknownUnits, 1); assert.equal(row.numerator, 0); assert.equal(row.rate, null); assert.equal(row.reasons.observed_consent_epoch_gap, 1); }
    if (kind === 'earned') { assert.equal(zero.diagnostic.matureWithoutGrant, 1); assert.equal(rows[0].diagnostic.matureWithoutGrant, 0); }
    assert.deepEqual(rows[0], rows[1]);
    if (kind === 'calendar') assert.equal(analyze([...frame.base, witness], options).metrics.weeks[0].installReturn.D1.open.rate, 1);
  }
});

test('R3 legal authoritative success before or after the same re-opt-in remains positive in all four windows', () => {
  for (const kind of ['primary', 'earned', 'help', 'calendar']) {
    const frame = epochWindow(kind); const E = frame.start + 2000;
    const witness = frame.fact('app_open', frame.start + 3000, E);
    for (const [time, epoch] of [[frame.start + 1000, frame.old], [frame.start + 4000, E]]) {
      const records = [...frame.base, witness, frame.success(time, epoch)];
      const a = frame.metric(records); const b = frame.metric([...records].reverse());
      assert.equal(a.denominator, 1); assert.equal(a.numerator, 1); assert.equal(a.rate, 1); assert.deepEqual(a, b);
    }
  }
});

test('R3 epoch boundaries distinguish fresh current anchors, old same-millisecond ambiguity and deadline gaps', () => {
  for (const kind of ['primary', 'earned', 'help', 'calendar']) {
    const frame = epochWindow(kind);
    const atEnd = frame.metric([...frame.base, frame.fact('app_open', frame.end + 1, frame.end)]);
    assert.equal(atEnd.denominator, 1); assert.equal(atEnd.unknownUnits, 1); assert.equal(atEnd.rate, null);
    const fresh = structuredClone(frame.base); frame.anchorEpoch(fresh, frame.start);
    assert.equal(frame.metric([...fresh, frame.fact('app_open', frame.start + 1000, frame.start)]).rate, 0);
    const oldAtStart = kind === 'calendar' ? [frame.fact('screen_viewed', frame.start, frame.old)] : [];
    const old = frame.metric([...frame.base, ...oldAtStart, frame.fact('app_open', frame.start + 1000, frame.start)]);
    assert.equal(old.unknownUnits, 1); assert.equal(old.rate, null);
    if (kind !== 'calendar') assert.equal(frame.metric([...fresh, frame.fact('screen_viewed', frame.start, frame.old), frame.fact('app_open', frame.start + 1000, frame.start)]).rate, 0);
  }
});

test('R3 prior-epoch continuity bounds possible gaps instead of poisoning windows outside them', () => {
  for (const kind of ['primary', 'earned', 'help', 'calendar']) {
    const frame = epochWindow(kind); const E = frame.end + 2000;
    const witness = frame.fact('app_open', E + 1000, E);
    assert.equal(frame.metric([...frame.base, witness]).rate, null, 'without a later old-phase bound the gap may start inside the window');
    const L = frame.end + (kind === 'calendar' ? 0 : 1);
    const bounded = frame.metric([...frame.base, frame.fact('screen_viewed', L, frame.old), witness]);
    assert.equal(bounded.denominator, 1); assert.equal(bounded.rate, 0);
    const exact = frame.metric([...frame.base, frame.fact('screen_viewed', frame.end, frame.old), witness]);
    assert.equal(exact.rate, kind === 'calendar' ? 0 : null, 'calendar end is excluded, while inclusive deadlines retain equal-ms ambiguity');
    const earlier = structuredClone(frame.base); frame.anchorEpoch(earlier, frame.start - 1);
    assert.equal(frame.metric([...earlier, frame.fact('app_open', frame.start + 1000, frame.start - 1)]).rate, 0);
  }
});

test('R3 future, invalid-clock and foreign SDK/install witnesses cannot create a gap in the target scope', () => {
  for (const kind of ['primary', 'earned', 'help', 'calendar']) {
    const frame = epochWindow(kind); const E = frame.start + 500;
    const future = frame.fact('app_open', Date.parse(options.asOf) + 1, E);
    const noTime = frame.fact('app_open', frame.start + 1000, E, { timeKnown: false });
    const anomaly = frame.fact('app_open', frame.start + 1000, E, { time_trust: 'client_clock_anomaly' });
    const preEpoch = frame.fact('app_open', frame.start + 1000, frame.start + 2000);
    const foreign = frame.fact('app_open', frame.start + 1000, E, {}, { appmetrica_device_id: 'foreign-sdk', install_datetime: '2026-10-01T08:00:00Z' });
    const installation = frame.fact('app_open', Date.parse('2026-10-30T09:00:00Z'), E, {}, { installation_id: 'another-install', install_datetime: '2026-10-30T08:00:00Z', install_kind: 'reinstall' });
    for (const witness of [future, noTime, anomaly, preEpoch, foreign, installation]) assert.equal(frame.metric([...frame.base, witness]).rate, 0);
  }
});

test('R3 untrusted QA/clock/semantic copies cannot whitewash a gap by supplying false old-phase continuity', () => {
  for (const kind of ['primary', 'earned', 'help', 'calendar']) {
    const frame = epochWindow(kind); const E = frame.end + 2000; const L = frame.end + 1000;
    const witness = frame.fact('app_open', E + 1000, E);
    for (const fields of [{ environment: 'qa' }, { timeKnown: false }, { time_trust: 'client_clock_anomaly' }, { schema_version: 4 }, { levelId: 'invalid-level' }]) {
      const untrusted = frame.fact('screen_viewed', L, frame.old, fields);
      assert.equal(frame.metric([...frame.base, untrusted, witness]).rate, null);
    }
    const loaded = frame.fact('ad_lifecycle', L, frame.old, { format: 'rewarded', stage: 'loaded', operation: 'load', request_id: 'old-proof-req', opportunity_id: 'old-proof-opp', callback_id: 'old-proof-loaded' });
    assert.equal(frame.metric([...frame.base, loaded, witness]).rate, 0);
    for (const fields of [{ consent_state: 'disabled' }, { environment: 'staging' }, { timeKnown: false }]) {
      const bad = structuredClone(loaded); Object.assign(bad.event_json, fields, { event_id: `bad-continuity-${++sequence}` });
      const records = [...frame.base, loaded, bad, witness]; const a = frame.metric(records); const b = frame.metric([...records].reverse());
      assert.equal(a.rate, null); assert.equal(a.unknownUnits, 1); assert.deepEqual(a, b);
    }
  }
});

test('R3 experiment calendar guards share absence coverage without using the old install anchor', () => {
  const first = Date.parse('2026-10-21T09:00:00Z'); const epochOld = new Date(first - 10000).toISOString();
  const day = Date.parse('2026-10-22T09:00:00Z'); const epochNew = new Date(day - 1000).toISOString();
  const base = [...eligible('p', first, { consent_epoch_at: epochOld }), assigned('p', first, { consent_epoch_at: epochOld }),
    event('p', 'app_open', first + 660000, { origin_interaction_id: undefined, consent_epoch_at: epochOld }),
    event('p', 'app_open', day, { origin_interaction_id: undefined, consent_epoch_at: epochNew })];
  const report = analyze(base, options).metrics.weeks[0];
  assert.equal(report.primary.assignedEligibleItt.rate, 0); assert.equal(report.experimentReturn.D1.open.rate, 1);
  assert.equal(report.experimentReturn.D1.gameplay.denominator, 1); assert.equal(report.experimentReturn.D1.gameplay.unknownUnits, 1); assert.equal(report.experimentReturn.D1.gameplay.rate, null);
  assert.equal(report.installReturn.D1.gameplay.denominator, 0);
  assert.equal(analyze([...base, event('p', 'word_submitted', day + 1000, { manual: true, consent_epoch_at: epochNew })], options).metrics.weeks[0].experimentReturn.D1.gameplay.rate, 1);
});

test('R3 gaps and early success never admit immature primary, earned, help or calendar windows', () => {
  const late = Date.parse('2026-11-03T20:59:00Z'); const old = new Date(late - 10000).toISOString(); const next = new Date(late + 500).toISOString();
  const witness = event('p', 'app_open', late + 1000, { origin_interaction_id: undefined, consent_epoch_at: next });
  const primary = current([...eligible('p', late, { consent_epoch_at: old }), assigned('p', late, { consent_epoch_at: old }), witness, event('p', 'puzzle_completed', late + 2000, { consent_epoch_at: next })]).primary.assignedEligibleItt;
  const earnedRow = current([earned('p', late, { consent_epoch_at: old }), witness, wallet('p', late + 2000, { consent_epoch_at: next })]).earnedGrant;
  const helpRow = current([...request('p', late, { consent_epoch_at: old }), wallet('p', late + 2000, { consent_epoch_at: next }), witness, help('p', late + 3000, { consent_epoch_at: next })]).returnHelp;
  for (const row of [primary, earnedRow, helpRow]) { assert.equal(row.immatureUnits, 1); assert.equal(row.denominator, 0); assert.equal(row.numerator, 0); assert.equal(row.rate, null); }
  const installed = { install_datetime: '2026-11-03T09:00:00Z', install_kind: 'first' }; const start = Date.parse('2026-11-03T21:00:00Z');
  const records = [event('p', 'install', '2026-11-03T09:00:00Z', {}, { ...installed, record_type: 'install' }),
    event('p', 'app_open', start + 1000, { consent_epoch_at: new Date(start + 500).toISOString() }, installed),
    event('p', 'word_submitted', start + 2000, { manual: true, consent_epoch_at: new Date(start + 500).toISOString() }, installed)];
  const day = current(records, { asOf: '2026-11-04T12:00:00Z' }).installReturn.D1;
  for (const row of [day.open, day.gameplay]) { assert.equal(row.immatureUnits, 1); assert.equal(row.denominator, 0); assert.equal(row.rate, null); }
});

test('CLI reuses JSONL/CSV parser, validates fixed weeks, never overwrites inputs or leaks malformed JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-help-funnel-'));
  try {
    const input = path.join(dir, 'events.jsonl'); const out = path.join(dir, 'report');
    fs.writeFileSync(input, request('p').map((row) => JSON.stringify(row)).join('\n'));
    assert.equal(readInputFiles([input]).length, 2);
    const cli = path.resolve(__dirname, '../../../scripts/analyze-help-funnel.cjs');
    const args = ['--baseline-start', options.baselineStart, '--current-start', options.currentStart, '--timezone', options.timezone, '--as-of', options.asOf, '--source', 'synthetic', '--bootstrap-reps', '100'];
    const run = (...extra) => spawnSync(process.execPath, [cli, ...args, ...extra], { encoding: 'utf8' });
    assert.equal(run('--input', input, '--output', out).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(`${out}.json`, 'utf8')).experiment.enabled, false);
    const collision = path.join(dir, 'collision.json'); fs.writeFileSync(collision, '[]');
    assert.notEqual(run('--input', collision, '--output', collision.slice(0, -5)).status, 0);
    const linkedPrefix = path.join(dir, 'linked-output'); const before = fs.readFileSync(input);
    fs.linkSync(input, `${linkedPrefix}.json`);
    const linkedFailure = run('--input', input, '--output', linkedPrefix);
    assert.notEqual(linkedFailure.status, 0); assert.match(linkedFailure.stderr, /must not overwrite an input/);
    assert.deepEqual(fs.readFileSync(input), before, 'hard-link output alias leaves raw input bytes intact');
    const pairPrefix = path.join(dir, 'paired-output'); fs.writeFileSync(`${pairPrefix}.json`, 'ORIGINAL_REPORT_PAIR'); fs.linkSync(`${pairPrefix}.json`, `${pairPrefix}.md`);
    assert.notEqual(run('--needs-raw-data', '--output', pairPrefix).status, 0);
    assert.equal(fs.readFileSync(`${pairPrefix}.json`, 'utf8'), 'ORIGINAL_REPORT_PAIR');
    const bad = path.join(dir, 'bad.jsonl'); fs.writeFileSync(bad, '{"PRIVATE_EMAIL":"private@example.test" BAD');
    const failure = run('--input', bad, '--output', out); assert.notEqual(failure.status, 0); assert.equal(failure.stderr.includes('private@example.test'), false);
    const csv = path.join(dir, 'events.csv'); fs.writeFileSync(csv, 'event_name,appmetrica_device_id,event_datetime,event_json\napp_open,18446744073709551615,2026-10-28T09:00:00Z,"{}"\n');
    assert.equal(readInputFiles([csv])[0].appmetrica_device_id, '18446744073709551615');
    assert.throws(() => analyze([], { ...options, timezone: 'Europe/Moscow' }), /fixed offset/);
    assert.throws(() => analyze([], { ...options, currentStart: '2026-10-22' }), /non-overlapping/);
  } finally {
    for (const file of fs.readdirSync(dir)) { const target = path.resolve(dir, file); assert.equal(path.dirname(target), path.resolve(dir)); fs.unlinkSync(target); }
    fs.rmdirSync(dir);
  }
});
