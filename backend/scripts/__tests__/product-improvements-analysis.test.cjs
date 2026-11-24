'use strict';
/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { analyzeProductImprovements: analyze, buildNeedsRawDataReport, readInputFiles, renderMarkdown } = require('../../../scripts/analyze-product-improvements.cjs');
const { normalizeRecord } = require('../../../scripts/analyze-retention.cjs');

const options = { baselineStart: '2026-10-21', currentStart: '2026-10-28', timezone: 'UTC+03:00',
  asOf: '2026-11-04T00:00:00+03:00', source: 'synthetic', bootstrapReps: 100 };
let sequence = 0;
const identity = { levelKey: 'campaign:10', levelId: 10, mode: 'campaign', contentVersion: 'main-v1', content_fingerprint: 'fp_0123456789abcdef' };
function event(player, name, at, properties = {}, extra = {}) {
  return { appmetrica_device_id: player, event_name: name, event_datetime: at,
    install_datetime: '2026-10-01T08:00:00Z', install_kind: 'first',
    event_json: { schema_version: 3, event_id: `fixture-${++sequence}`, occurred_at: at, app_version: '0.1.29', environment: 'production',
      ...identity, attemptId: 'a', ...properties }, ...extra };
}
function start(player, at, properties = {}, extra = {}) {
  return event(player, 'puzzle_started', at, { difficulty_tier: 2, difficulty_role: 'baseline', mechanic: 'classic', letter_count: 5, target_count: 3, ...properties }, extra);
}
function word(player, at, kind, properties = {}, extra = {}) { return event(player, 'word_submit_outcome', at, { manual: true, kind, ...properties }, extra); }
function weekFixture(easyInvalid, hardInvalid, easyN, hardN, day, players = 20) {
  const rows = [];
  for (let player = 0; player < players; player++) {
    for (const [level, n, invalid] of [[10, easyN, easyInvalid], [100, hardN, hardInvalid]]) {
      const props = { attemptId: `${day}-${level}`, levelKey: `campaign:${level}`, levelId: level, difficulty_tier: level === 100 ? 5 : 2 };
      const at = Date.parse(`${day}T09:00:00Z`);
      rows.push(start(`fixture-player-${player}`, new Date(at).toISOString(), props));
      for (let input = 0; input < n; input++) rows.push(word(`fixture-player-${player}`, new Date(at + (input + 1) * 1000).toISOString(), input < n * invalid ? 'invalid' : 'grid', { ...props, reason: input < n * invalid ? 'not_in_dictionary' : undefined }));
    }
  }
  return rows;
}
const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('Simpson mix shift raises raw invalid rate while the frozen within-level comparison stays unchanged', () => {
  const rows = [...weekFixture(0.2, 0.8, 90, 10, '2026-10-21'), ...weekFixture(0.2, 0.8, 10, 90, '2026-10-28')];
  const report = analyze(rows, options);
  approximately(report.comparison.metrics.invalid.raw.baseline, 0.26);
  approximately(report.comparison.metrics.invalid.raw.current, 0.74);
  approximately(report.comparison.metrics.invalid.commonConditionalFixedMix.change, 0);
  approximately(report.comparison.metrics.invalid.decomposition.commonMixChange, 0.48);
  assert.equal(report.comparison.weights.baselineExcludedWeight, 0);
  assert.deepEqual(report.comparison.uncertainty.intervals.invalid.fixedChange.ci95, [0, 0]);
  const repeated = analyze(rows, options);
  assert.deepEqual(repeated, report, 'same data and arguments produce deterministic aggregate output');
});

test('a real within-level change survives standardization and is distinct from a level mix shift', () => {
  const report = analyze([...weekFixture(0.2, 0.8, 20, 20, '2026-10-21'), ...weekFixture(0.4, 0.9, 20, 20, '2026-10-28')], options);
  approximately(report.comparison.metrics.invalid.commonConditionalFixedMix.change, 0.15);
  approximately(report.comparison.metrics.invalid.decomposition.commonMixChange, 0);
  approximately(report.comparison.metrics.accepted.commonConditionalFixedMix.change, -0.15);
  assert.equal(report.comparison.uncertainty.clusters.observedInBothWeeks, 20);
});

test('paired player resampling preserves an unchanged heterogeneous player panel', () => {
  const rows = [];
  for (const day of ['2026-10-21', '2026-10-28']) for (let player = 0; player < 20; player++) {
    rows.push(start(`panel-${player}`, `${day}T09:00:00Z`, { attemptId: day }));
    for (let input = 0; input < 10; input++) rows.push(word(`panel-${player}`, `${day}T09:00:${String(input + 1).padStart(2, '0')}Z`, input < (player < 10 ? 2 : 8) ? 'invalid' : 'bonus', { attemptId: day }));
  }
  const report = analyze(rows, options);
  assert.deepEqual(report.comparison.uncertainty.intervals.invalid.rawChange.ci95, [0, 0]);
  assert.equal(report.comparison.uncertainty.clusters.union, 20);
});

test('absent and new levels expose common coverage and null absent observations instead of zero rates', () => {
  const rows = [];
  for (const [day, levels] of [['2026-10-21', [10, 20]], ['2026-10-28', [10, 30]]]) for (const level of levels) {
    const props = { levelKey: `campaign:${level}`, levelId: level, attemptId: `${day}-${level}` };
    rows.push(start('p', `${day}T09:00:00Z`, props), word('p', `${day}T09:01:00Z`, 'invalid', props));
  }
  const report = analyze(rows, options);
  assert.equal(report.comparison.weights.baselineExcludedWeight, 0.5);
  assert.equal(report.comparison.weights.commonCoverage.current.rate, 0.5);
  assert.deepEqual(report.comparison.weights.newUnmatchedLevels, ['campaign:30']);
  assert.equal(report.comparison.strata.find((row) => row.levelKey === 'campaign:20').current, null);
  assert.equal(report.comparison.strata.find((row) => row.levelKey === 'campaign:30').baselineWeight, null);
  assert.equal(report.comparison.metrics.invalid.commonConditionalFixedMix.baseline, 1);
});

test('app version, content fingerprint, intro/main, mode, and player class cannot silently pool', () => {
  const baseline = word('p', '2026-10-21T09:01:00Z', 'invalid');
  for (const change of [{ app_version: '0.1.30' }, { content_fingerprint: 'fp_1111111111111111' }, { contentVersion: 'intro-v2' }, { mode: 'practice', levelKey: 'practice:10' }]) {
    const report = analyze([baseline, word('p', '2026-10-28T09:01:00Z', 'grid', change)], options);
    assert.equal(report.comparison.weights.commonStrata, 0);
    assert.equal(report.comparison.metrics.invalid.commonConditionalFixedMix.change, null);
  }
  const installed = { install_datetime: '2026-10-21T08:00:00Z' };
  const report = analyze([word('p', '2026-10-21T09:01:00Z', 'invalid', {}, installed), word('p', '2026-10-28T09:01:00Z', 'grid', {}, installed)], options);
  assert.equal(report.weeks[0].manualInputs.coverage.playerClassification.new, 1);
  assert.equal(report.weeks[1].manualInputs.coverage.playerClassification.returning, 1);
  assert.equal(report.comparison.weights.commonStrata, 0);
});

test('different unsupported modes remain visible as other but cannot create comparable exact strata', () => {
  for (const daily of [undefined, false, true]) {
    const report = analyze([
      word('p', '2026-10-21T09:01:00Z', 'invalid', { levelKey: 'event:10', mode: 'timed_race', daily }),
      word('p', '2026-10-28T09:01:00Z', 'grid', { levelKey: 'event:10', mode: 'relaxed_race', daily }),
    ], options);
    assert.equal(report.comparison.weights.commonStrata, 0);
    assert.equal(report.comparison.metrics.invalid.commonConditionalFixedMix.change, null);
    for (const week of report.weeks) {
      assert.equal(week.manualInputs.coverage.unsupportedMode, 1);
      assert.equal(week.manualInputs.coverage.exactStrata.numerator, 0);
      assert.equal(week.attempts.byModeAndProgress[0].gameGroup, 'other');
    }
  }
});

test('immutable queued origin app version controls P3 strata while SDK delivery version stays explicit', () => {
  const baseline = word('p', '2026-10-21T09:01:00Z', 'invalid', { app_version: '0.1.29' }, { app_version_name: '0.1.30' });
  const current = word('p', '2026-10-28T09:01:00Z', 'grid', { app_version: '0.1.30' }, { app_version_name: '0.1.30' });
  assert.equal(normalizeRecord(baseline).appVersion, '0.1.30', 'legacy retention SDK preference is unchanged');
  assert.equal(normalizeRecord(baseline).analysisAppVersion, '0.1.29');
  const report = analyze([baseline, current], options);
  assert.equal(report.comparison.weights.commonStrata, 0);
  assert.equal(report.comparison.metrics.invalid.commonConditionalFixedMix.change, null);
  assert.equal(report.quality.originSdkAppVersionMismatches, 1);
  assert.equal(report.weeks[0].manualInputs.coverage.appVersions['0.1.29'], 1);
  assert.equal(report.weeks[0].manualInputs.coverage.sdkReportedAppVersions['0.1.30'], 1);
  assert.equal(report.weeks[0].manualInputs.coverage.originSdkVersionMismatches.rate, 1);
});

test('SDK app version is a declared fallback only without origin; invalid origin cannot inherit SDK exact eligibility', () => {
  const fallback = word('p', '2026-10-21T09:01:00Z', 'invalid', { app_version: undefined }, { app_version_name: '0.1.28' });
  const invalid = word('p', '2026-10-28T09:01:00Z', 'grid', { app_version: 'PRIVATE_EMAIL@example.com' }, { app_version_name: '0.1.28' });
  const normalized = normalizeRecord(fallback);
  assert.equal(normalized.analysisAppVersion, '0.1.28');
  assert.equal(normalized.versionProvenance, 'sdk_fallback');
  const report = analyze([fallback, invalid], options);
  assert.equal(report.weeks[0].manualInputs.coverage.exactStrata.numerator, 1);
  assert.equal(report.weeks[1].manualInputs.coverage.exactStrata.numerator, 0);
  assert.equal(report.weeks[1].manualInputs.coverage.appVersionProvenance.invalid_origin, 1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_EMAIL'));
});

test('an explicit unsupported mode cannot borrow campaign from daily:false or an entry alias', () => {
  const raw = word('p', '2026-10-21T09:01:00Z', 'invalid', { mode: 'timed_race', daily: false });
  assert.equal(normalizeRecord(raw).mode, 'campaign', 'legacy retention behavior is preserved');
  assert.equal(normalizeRecord(raw).analysisMode, 'other', 'P3 respects the explicit unsupported mode');
  const report = analyze([start('p', '2026-10-21T09:00:00Z', { mode: 'normal' }), raw], options);
  assert.equal(report.weeks[0].manualInputs.coverage.exactStrata.numerator, 0);
  assert.equal(report.weeks[0].manualInputs.coverage.unsupportedMode, 1);
  assert.equal(report.quality.attemptIdentityConflicts, 1);
  const inherited = analyze([start('p', '2026-10-21T09:00:00Z', { mode: 'timed_race', daily: false }),
    word('p', '2026-10-21T09:01:00Z', 'invalid', { mode: undefined, daily: undefined })], options);
  assert.equal(inherited.weeks[0].manualInputs.coverage.exactStrata.numerator, 0);
  assert.equal(inherited.weeks[0].manualInputs.coverage.unsupportedMode, 1);
});

test('unknown installation and absent metadata remain unknown; carried active attempts enter both distributions', () => {
  const extra = { install_datetime: undefined, install_kind: undefined };
  const props = { difficulty_tier: undefined, difficulty_role: undefined, mechanic: undefined, letter_count: undefined, target_count: undefined };
  const report = analyze([start('p', '2026-10-21T09:00:00Z', props, extra), word('p', '2026-10-21T09:01:00Z', 'grid', {}, extra),
    event('p', 'puzzle_checkpoint', '2026-10-28T09:00:00Z', {}, extra), word('p', '2026-10-28T09:01:00Z', 'invalid', {}, extra)], options);
  assert.equal(report.weeks[0].manualInputs.coverage.playerClassification.unknown, 1);
  assert.equal(report.weeks[1].attempts.observed, 1);
  assert.equal(report.weeks[1].attempts.startedInWeek, 0);
  assert.equal(report.weeks[1].attempts.byModeAndProgress[0].difficulty.knownCoverage.rate, 0);
  assert.equal(report.weeks[1].attempts.byModeAndProgress[0].difficulty.highAmongKnown.rate, null);
});

test('one player repeated a thousand times is one uncertainty cluster, not a thousand independent people', () => {
  const report = analyze([...weekFixture(0.2, 0.8, 500, 500, '2026-10-21', 1), ...weekFixture(0.4, 0.9, 500, 500, '2026-10-28', 1)], options);
  assert.equal(report.comparison.uncertainty.clusters.baseline, 1);
  assert.equal(report.comparison.uncertainty.intervals.invalid.rawChange.ci95, null);
  assert.equal(report.comparison.uncertainty.intervals.invalid.fixedChange.ci95, null);
  assert.match(report.comparison.uncertainty.intervals.invalid.rawChange.reason, /20_player_clusters/);
});

test('only completed explicit manual outcomes enter rates; bounded reasons and aggregate privacy survive hostile extras', () => {
  const sentinel = 'PRIVATE_WORD_EMAIL_PLAYER';
  const rows = [word(sentinel, '2026-10-21T09:01:00Z', 'invalid', { reason: 'not_in_dictionary', word: sentinel, rawInput: sentinel, email: `${sentinel}@example.com` }),
    word(sentinel, '2026-10-21T09:02:00Z', 'invalid', { reason: sentinel }),
    word(sentinel, '2026-10-21T09:03:00Z', 'constraint', { reason: 'wrong_order' }),
    word(sentinel, '2026-10-21T09:04:00Z', 'grid'),
    word(sentinel, '2026-10-21T09:05:00Z', 'invalid', { manual: false }),
    word(sentinel, '2026-10-21T09:06:00Z', 'invalid', { manual: undefined }),
    word(sentinel, '2026-10-21T09:07:00Z', 'invalid', { manual: true, autoOrManual: 'auto' }),
    event(sentinel, 'word_found', '2026-10-21T09:08:00Z', { manual: true, kind: 'grid' }),
    word(undefined, '2026-10-21T09:09:00Z', 'invalid'),
    word(sentinel, '2026-10-21T09:10:00Z', 'grid', { manual: true, kind: 'target', result: undefined })];
  const report = analyze(rows, options);
  assert.equal(report.weeks[0].manualInputs.completedManualInputs, 4);
  assert.equal(report.weeks[0].manualInputs.invalid.rate, 0.5);
  assert.equal(report.weeks[0].manualInputs.nonAccepted.rate, 0.75);
  assert.equal(report.weeks[0].manualInputs.invalidByReason.counts.unknown, 1);
  assert.equal(report.weeks[0].manualInputs.reasonsByOutcome.constraint.counts.wrong_order, 1);
  assert.equal(report.weeks[0].manualInputs.coverage.unknownOrConflictingManual, 2);
  assert.equal(report.quality.missingSdkIdentityWordOutcomes, 1);
  const serialized = JSON.stringify(report) + renderMarkdown(report);
  assert.ok(!serialized.includes(sentinel));
  assert.ok(!serialized.includes(identity.content_fingerprint));
});

test('median player/attempt shares give each unit one vote rather than reweighting by input volume', () => {
  const rows = [word('many-errors', '2026-10-21T09:01:00Z', 'invalid', { attemptId: 'large' }),
    ...Array.from({ length: 99 }, (_, i) => word('many-errors', new Date(Date.parse('2026-10-21T09:02:00Z') + i * 1000).toISOString(), 'invalid', { attemptId: 'large' })),
    word('one-success', '2026-10-21T09:01:00Z', 'grid', { attemptId: 'small' }),
    word('two-success', '2026-10-21T09:01:00Z', 'bonus', { attemptId: 'other' })];
  const report = analyze(rows, options);
  assert.ok(report.weeks[0].manualInputs.invalid.rate > 0.98);
  assert.equal(report.weeks[0].manualInputs.perPlayer.medianInvalidShare, 0);
  assert.equal(report.weeks[0].manualInputs.perAttempt.medianNonAcceptedShare, 0);
});

test('inputs until next accepted include the accepted input; tails, resumed prefixes and pause gaps are censored', () => {
  const rows = [start('p', '2026-10-21T09:00:00Z'), word('p', '2026-10-21T09:01:00Z', 'invalid'), word('p', '2026-10-21T09:02:00Z', 'grid'), word('p', '2026-10-21T09:03:00Z', 'invalid'),
    event('p', 'puzzle_resumed', '2026-10-21T10:00:00Z', { attemptId: 'left' }), word('p', '2026-10-21T10:01:00Z', 'invalid', { attemptId: 'left' }), word('p', '2026-10-21T10:02:00Z', 'bonus', { attemptId: 'left' }),
    start('p', '2026-10-21T11:00:00Z', { attemptId: 'pause' }), word('p', '2026-10-21T11:01:00Z', 'invalid', { attemptId: 'pause' }), event('p', 'puzzle_paused', '2026-10-21T11:02:00Z', { attemptId: 'pause' }), word('p', '2026-10-21T11:03:00Z', 'grid', { attemptId: 'pause' })];
  const gaps = analyze(rows, options).weeks[0].inputsUntilNextAccepted;
  assert.deepEqual(gaps.completed, { observations: 1, p50: 2, p90: 2 });
  assert.equal(gaps.rightCensored.sequences, 2);
  assert.equal(gaps.rightCensored.observedInputs, 2);
  assert.equal(gaps.leftCensored.sequences, 2);
});

test('SDK occurrence knowledge and active-time coverage remain independent; only completed full active time enters quantiles', () => {
  const rows = [event('p', 'puzzle_completed', '2026-10-21T10:00:00Z', { attemptId: 'full', activeTimeMs: 1000, time_coverage: 'full_attempt' }),
    event('p', 'puzzle_completed', '2026-10-21T11:00:00Z', { attemptId: 'partial', activeTimeMs: 200000, time_coverage: 'since_restore' }),
    event('p', 'puzzle_completed', '2026-10-21T12:00:00Z', { attemptId: 'unknown', activeTimeMs: 300000 }),
    event('p', 'puzzle_completed', '2026-10-21T13:00:00Z', { attemptId: 'mixed', time_coverage: 'mixed_consent' }),
    event('p', 'puzzle_completed', '2026-10-21T14:00:00Z', { attemptId: 'unknown-occurrence', activeTimeMs: 500000, time_coverage: 'full_attempt', timeKnown: false })];
  const report = analyze(rows, options);
  assert.deepEqual(report.weeks[0].completedActiveTimeMs.fullCoverage, { observations: 1, p50: 1000, p90: 1000 });
  assert.equal(report.weeks[0].completedActiveTimeMs.partialCoverage, 2);
  assert.equal(report.weeks[0].completedActiveTimeMs.unknownCoverage, 1);
  assert.equal(report.quality.missingOccurrenceTime, 1);
});

test('24h completion follows exact attempt, excludes immature starts, and does not turn resumes or restarts into original wins', () => {
  const rows = [start('p', '2026-10-21T09:00:00Z', { attemptId: 'win' }), event('p', 'puzzle_resumed', '2026-10-21T09:30:00Z', { attemptId: 'win' }), event('p', 'puzzle_completed', '2026-10-21T10:00:00Z', { attemptId: 'win' }),
    start('p', '2026-10-21T11:00:00Z', { attemptId: 'abandoned' }), start('p', '2026-10-21T12:00:00Z', { attemptId: 'restart' }), event('p', 'puzzle_completed', '2026-10-21T13:00:00Z', { attemptId: 'restart' }),
    event('p', 'puzzle_resumed', '2026-10-22T10:00:00Z', { attemptId: 'unknown-start' }),
    start('p', '2026-11-03T20:30:00Z', { attemptId: 'immature' })];
  const report = analyze(rows, options);
  assert.equal(report.weeks[0].completion24h.rate.denominator, 3);
  assert.equal(report.weeks[0].completion24h.rate.numerator, 2);
  assert.equal(report.weeks[0].completion24h.resumedWithoutObservedStart, 1);
  assert.equal(report.weeks[1].completion24h.immature, 1);
});

test('help progress joins only original attempt and counts first help per attempt in a mature window', () => {
  const rows = [start('p', '2026-10-21T09:00:00Z', { attemptId: 'original' }), event('p', 'help_used', '2026-10-21T09:01:00Z', { attemptId: 'original' }),
    event('p', 'help_used', '2026-10-21T09:02:00Z', { attemptId: 'original' }), event('p', 'target_word_accepted', '2026-10-21T09:03:00Z', { attemptId: 'restart' }),
    start('p', '2026-10-21T10:00:00Z', { attemptId: 'helped' }), event('p', 'help_used', '2026-10-21T10:01:00Z', { attemptId: 'helped' }), event('p', 'target_word_accepted', '2026-10-21T10:03:00Z', { attemptId: 'helped' }),
    event('p', 'help_used', '2026-11-03T20:55:00Z', { attemptId: 'late-help' })];
  const report = analyze(rows, options);
  assert.equal(report.weeks[0].helpToProgress10m.eligibleAttempts, 2);
  assert.equal(report.weeks[0].helpToProgress10m.progressed, 1);
  assert.equal(report.weeks[1].helpToProgress10m.immature, 1);
});

test('reinstall boundary censors the original 24h window; reused attempt IDs across installations cannot join', () => {
  const first = { installation_id: 'first-install', install_datetime: '2026-10-01T08:00:00Z', install_kind: 'first' };
  const second = { installation_id: 'second-install', install_datetime: '2026-10-21T12:00:00Z', install_kind: 'reinstall' };
  const rows = [start('p', '2026-10-21T09:00:00Z', { attemptId: 'reused' }, first),
    event('p', 'puzzle_completed', '2026-10-21T13:00:00Z', { attemptId: 'reused' }, second)];
  const report = analyze(rows, options);
  assert.equal(report.weeks[0].completion24h.censoredByInstallBoundary, 1);
  assert.equal(report.weeks[0].completion24h.rate.denominator, 0);
  assert.equal(report.weeks[0].completion24h.rate.rate, null);
  assert.equal(report.weeks[0].attempts.observed, 2);
});

test('same attempt with a different puzzle cannot provide completion/help/active-time evidence for the original', () => {
  const rows = [start('p', '2026-10-21T09:00:00Z'), event('p', 'help_used', '2026-10-21T09:01:00Z'),
    event('p', 'puzzle_completed', '2026-10-21T09:02:00Z', { levelKey: 'campaign:11', levelId: 11, activeTimeMs: 12, time_coverage: 'full_attempt' })];
  const report = analyze(rows, options);
  assert.equal(report.quality.attemptOutcomeIdentityConflicts, 1);
  assert.equal(report.weeks[0].completion24h.conflictingIdentity, 1);
  assert.equal(report.weeks[0].completedActiveTimeMs.fullCoverage.observations, 0);
  assert.equal(report.weeks[0].completedActiveTimeMs.identityConflictExcluded, 1);
  assert.equal(report.weeks[0].helpToProgress10m.eligibleAttempts, 0);
  assert.equal(report.weeks[0].helpToProgress10m.conflictingIdentity, 1);
});

test('a word contradicting entry level cannot inherit the entry content to fabricate an exact stratum', () => {
  const rows = [start('p', '2026-10-21T09:00:00Z'),
    word('p', '2026-10-21T09:01:00Z', 'invalid', { levelKey: 'campaign:11', levelId: 11, contentVersion: undefined, content_fingerprint: undefined })];
  const report = analyze(rows, options);
  assert.equal(report.weeks[0].manualInputs.completedManualInputs, 1);
  assert.equal(report.weeks[0].manualInputs.coverage.exactStrata.numerator, 0);
  assert.equal(report.weeks[0].manualInputs.coverage.conflictingAttemptIdentity, 1);
  assert.equal(report.comparison.strata.length, 0);
  assert.equal(report.quality.attemptIdentityConflicts, 1);
});

test('without entry events, conflicting help/target identities are excluded rather than counted as progress or failure', () => {
  const rows = [event('p', 'help_used', '2026-10-21T09:01:00Z'),
    event('p', 'target_word_accepted', '2026-10-21T09:02:00Z', { levelKey: 'campaign:11', levelId: 11 })];
  const report = analyze(rows, options);
  assert.equal(report.quality.attemptIdentityConflicts, 1);
  assert.equal(report.weeks[0].helpToProgress10m.conflictingIdentity, 1);
  assert.equal(report.weeks[0].helpToProgress10m.eligibleAttempts, 0);
  assert.equal(report.weeks[0].helpToProgress10m.rate.rate, null);
  const missing = { levelKey: undefined, levelId: undefined, mode: undefined, contentVersion: undefined, content_fingerprint: undefined };
  const incomplete = analyze([event('p', 'help_used', '2026-10-21T09:01:00Z', missing), event('p', 'target_word_accepted', '2026-10-21T09:02:00Z', missing)], options);
  assert.equal(incomplete.weeks[0].helpToProgress10m.missingPuzzleIdentity, 1);
  assert.equal(incomplete.weeks[0].helpToProgress10m.rate.rate, null);
});

test('policy changes and unknown exact occurrence remain explicit rather than becoming a zero or comparable input', () => {
  const rows = [word('p', '2026-10-21T09:00:00Z', 'invalid', { policyRevision: 1 }),
    word('p', '2026-10-28T09:00:00Z', 'grid', { policyRevision: 2 }),
    word('p', '2026-10-28T09:01:00Z', 'invalid', { timeKnown: false }),
    start('p', '2026-10-28T10:00:00Z', { attemptId: 'unknown-start', timeKnown: false }),
    event('p', 'puzzle_completed', '2026-10-28T10:02:00Z', { attemptId: 'unknown-completion', timeKnown: false })];
  const report = analyze(rows, options);
  assert.equal(report.comparison.weights.commonStrata, 0);
  assert.equal(report.weeks[1].manualInputs.completedManualInputs, 1);
  assert.equal(report.quality.missingOccurrenceTimeWordOutcomes, 1);
  assert.equal(report.weeks[1].completion24h.unknownStartTime, 1);
  assert.equal(report.weeks[1].completedActiveTimeMs.unknownOccurrenceTime, 1);
});

test('QA and future events do not contaminate rates; conflict copies do not arbitrarily select an outcome', () => {
  const original = word('p', '2026-10-21T09:00:00Z', 'invalid', { submission_id: 'conflict' });
  const conflict = word('p', '2026-10-21T09:00:01Z', 'grid', { submission_id: 'conflict' });
  const report = analyze([original, conflict, word('p', '2026-10-21T09:01:00Z', 'grid'),
    word('p', '2026-10-21T09:02:00Z', 'invalid', { environment: 'qa' }),
    word('p', '2026-10-21T09:03:00Z', 'invalid', { is_test: true }),
    word('p', '2026-11-05T09:04:00Z', 'invalid')], options);
  assert.equal(report.quality.excludedTestRecords, 2);
  assert.equal(report.quality.futureEventsExcluded, 1);
  assert.equal(report.quality.conflictingSubmissionDeliveries, 1);
  assert.equal(report.weeks[0].manualInputs.completedManualInputs, 1);
  assert.equal(report.weeks[0].manualInputs.invalid.rate, 0);
});

test('delivery and stable submission duplicate outcomes are deduplicated without removing genuine repeated inputs', () => {
  const original = word('p', '2026-10-21T09:01:00Z', 'invalid', { submission_id: 'submission-one' });
  const semanticDuplicate = { ...original, event_json: { ...original.event_json, event_id: 'other-delivery' } };
  const report = analyze([original, structuredClone(original), semanticDuplicate, word('p', '2026-10-21T09:02:00Z', 'invalid', { submission_id: 'submission-two' })], options);
  assert.equal(report.quality.deliveryDuplicates, 1);
  assert.equal(report.quality.semanticSubmissionDuplicates, 1);
  assert.equal(report.weeks[0].manualInputs.completedManualInputs, 2);
});

test('metadata is joined from exact player/attempt; another player using same local attempt cannot inherit it', () => {
  const stripped = { ...identity, levelKey: undefined, levelId: undefined, contentVersion: undefined, content_fingerprint: undefined, mode: undefined };
  const report = analyze([start('one', '2026-10-21T09:00:00Z', { difficulty_tier: 5 }), word('one', '2026-10-21T09:01:00Z', 'invalid', stripped),
    word('two', '2026-10-21T09:01:00Z', 'invalid', stripped)], options);
  assert.equal(report.weeks[0].manualInputs.coverage.exactStrata.numerator, 1);
  const distribution = report.weeks[0].attempts.byModeAndProgress;
  assert.equal(distribution.find((row) => row.gameGroup === 'main_campaign').difficulty.highAmongKnown.rate, 1);
  assert.equal(distribution.find((row) => row.gameGroup === 'unknown').difficulty.highAmongKnown.rate, null);
});

test('schema 2 and 3 normalization preserves uint64 SDK identity and only selected bounded fields', () => {
  const properties = { ...identity, manual: true, kind: 'constraint', reason: 'wrong_order', difficulty_tier: 4,
    difficulty_role: 'hard', mechanic: 'ordered', letter_count: 6, target_count: 5, activeTimeMs: 12, time_coverage: 'full_attempt', word: 'PRIVATE' };
  const row = event('18446744073709551615', 'word_submit_outcome', '2026-10-21T09:00:00Z');
  const v2 = { ...row, event_json: { schema_version: 2, app_version: '0.1.29', properties } };
  const v3 = { ...row, event_json: { schema_version: 3, app_version: '0.1.29', ...properties } };
  for (const raw of [v2, v3]) {
    const normalized = normalizeRecord(raw);
    assert.equal(normalized.sdkId, '18446744073709551615');
    assert.equal(normalized.wordReason, 'wrong_order');
    assert.equal(normalized.timeCoverage, 'full_attempt');
    assert.equal(normalized.difficultyTier, 4);
    assert.ok(!JSON.stringify(normalized).includes('PRIVATE'));
  }
  assert.equal(normalizeRecord({ ...v3, event_json: { ...v3.event_json, difficulty_tier: 6, reason: 'PRIVATE', mechanic: 'PRIVATE' } }).difficultyTier, null);
});

test('JSON/JSONL/quoted CSV load actual Logs columns without rounding UInt64; malformed errors omit payload', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-p3-input-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const row = event('18446744073709551615', 'word_submit_outcome', '2026-10-21T09:00:00Z', { kind: 'grid', manual: true });
  row.event_json = JSON.stringify(row.event_json);
  fs.writeFileSync(path.join(dir, 'logs.json'), JSON.stringify({ data: [row] }));
  fs.writeFileSync(path.join(dir, 'logs.jsonl'), `${JSON.stringify(row)}\n`);
  const headers = ['appmetrica_device_id', 'event_name', 'event_datetime', 'event_json'];
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  fs.writeFileSync(path.join(dir, 'logs.csv'), `${headers.join(',')}\r\n${headers.map((key) => quote(row[key])).join(',')}\r\n`);
  const loaded = readInputFiles(['logs.json', 'logs.jsonl', 'logs.csv'].map((file) => path.join(dir, file)));
  assert.equal(loaded.length, 3);
  for (const raw of loaded) assert.equal(normalizeRecord(raw).sdkId, '18446744073709551615');
  fs.writeFileSync(path.join(dir, 'broken.json'), '{"PRIVATE_EMAIL@example.com":');
  assert.throws(() => readInputFiles([path.join(dir, 'broken.json')]), (error) => !error.message.includes('PRIVATE_EMAIL'));
  assert.throws(() => readInputFiles([path.join(dir, 'missing.jsonl')]), /Cannot read input/);
  assert.throws(() => readInputFiles([path.join(dir, 'bad.txt')]), /Unsupported input/);
});

test('missing raw data has explicit unmeasured report, and invalid/overlapping/partial-week arguments fail', () => {
  const blocked = buildNeedsRawDataReport(options);
  assert.equal(blocked.status, 'needs_raw_data');
  assert.equal(blocked.metrics, null);
  assert.match(renderMarkdown(blocked), /No measured values/);
  assert.throws(() => analyze([], { ...options, timezone: 'Europe/Moscow' }), /fixed offset/);
  assert.throws(() => analyze([], { ...options, baselineStart: '2026-02-30' }), /YYYY-MM-DD/);
  assert.throws(() => analyze([], { ...options, currentStart: '2026-10-22' }), /non-overlapping/);
  assert.throws(() => analyze([], { ...options, asOf: '2026-11-03T00:00:00Z' }), /complete current/);
  assert.throws(() => analyze([], { ...options, asOf: '2026-11-04 00:00:00' }), /explicit UTC/);
});

test('CLI rejects missing/unknown arguments, emits labeled aggregates, and protects input from output overwrite', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-p3-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.resolve(__dirname, '../../../scripts/analyze-product-improvements.cjs');
  const args = ['--baseline-start', options.baselineStart, '--current-start', options.currentStart, '--timezone', options.timezone, '--as-of', options.asOf, '--source', 'synthetic'];
  assert.equal(spawnSync(process.execPath, [script, ...args, '--output', path.join(dir, 'out')], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [script, ...args, '--unexpected'], { encoding: 'utf8' }).status, 1);
  const input = path.join(dir, 'source.json');
  const contents = JSON.stringify([word('PRIVATE_PLAYER', '2026-10-21T09:00:00Z', 'grid')]);
  fs.writeFileSync(input, contents);
  const collision = spawnSync(process.execPath, [script, ...args, '--input', input, '--output', path.join(dir, 'source')], { encoding: 'utf8' });
  assert.equal(collision.status, 1);
  assert.equal(fs.readFileSync(input, 'utf8'), contents);
  const valid = spawnSync(process.execPath, [script, ...args, '--input', input, '--output', path.join(dir, 'out')], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')).source.synthetic, true);
  assert.ok(!fs.readFileSync(path.join(dir, 'out.md'), 'utf8').includes('PRIVATE_PLAYER'));
});
