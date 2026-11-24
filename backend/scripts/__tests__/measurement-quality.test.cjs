'use strict';
/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { analyzeMeasurementQuality: analyze, buildNeedsRawDataReport, readInputFiles, renderMarkdown, parseArguments } = require('../../../scripts/analyze-measurement-quality.cjs');

const options = { dateFrom: '2026-10-28', dateTo: '2026-11-03', timezone: 'UTC+03:00',
  asOf: '2026-11-04T12:00:00+03:00', source: 'synthetic' };
const at = '2026-11-01T09:00:00Z';
const epoch = '2026-10-01T00:00:00Z';
const cliPath = path.resolve(__dirname, '../../../scripts/analyze-measurement-quality.cjs');
let sequence = 0;
function event(player = 'sdk-player', properties = {}, extra = {}) {
  return { appmetrica_device_id: player, event_name: 'app_open', event_datetime: at, app_version_name: '0.1.29',
    event_json: { schema_version: 3, event_id: `quality-event-${++sequence}`, occurred_at: at,
      app_version: '0.1.29', environment: 'production', consent_state: 'enabled', ...properties }, ...extra };
}
function session(player = 'sdk-player', extra = {}) {
  return { record_type: 'session', appmetrica_device_id: player, app_version_name: '0.1.29', environment: 'production',
    session_id: `quality-session-${++sequence}`, session_start_datetime: at, ...extra };
}
function health(player, clock, counters, properties = {}, extra = {}) {
  return event(player, { occurred_at: clock, consent_epoch_at: epoch, ...counters, ...properties },
    { event_name: 'analytics_health_summary', event_datetime: clock, ...extra });
}
function versionRow(report, value) { return report.metrics.versions.bySdkAppVersion.find((row) => row.sdkAppVersion === value); }
function cliArgs(output, input = [], extra = []) {
  return [...input.flatMap((file) => ['--input', file]), '--date-from', options.dateFrom, '--date-to', options.dateTo,
    '--timezone', options.timezone, '--as-of', options.asOf, '--source', options.source, '--output', output, ...extra];
}
function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-quality-'));
  t.after(() => {
    // Recursive removal is limited to the exact fresh directory owned by this test.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^slova-quality-/);
    fs.rmSync(path.resolve(directory), { recursive: true, force: true });
  });
  return directory;
}

test('mixed schemas use custom-event denominators and show known/unknown consent without a population rate', () => {
  const legacy = event('p-legacy', {}, { event_json: { environment: 'production' } });
  const v2 = event('p-v2', {}, { event_json: { schema_version: 2, event_id: 'v2-event', app_version: '0.1.28',
    environment: 'production', consent_state: 'disabled', properties: { source: 'direct' } } });
  const report = analyze([event('p-v3'), v2, legacy, session('p-v3')], options);
  assert.deepEqual(report.metrics.schema.customEvents, { '2': 1, '3': 1, unknown: 1 });
  assert.deepEqual(report.metrics.schema.knownCustomSchemaCoverage, { numerator: 2, denominator: 3, rate: 2 / 3 });
  assert.equal(report.metrics.observed.sdkSessionUnits, 1, 'SDK session is not a fourth unknown-schema custom event');
  assert.deepEqual(report.metrics.consent.counts, { enabled: 1, disabled: 1, unknown: 1 });
  assert.deepEqual(report.metrics.consent.knownMetadataCoverage, { numerator: 2, denominator: 3, rate: 2 / 3 });
  assert.equal(report.metrics.consent.populationConsentRate.denominator, null);
  assert.equal(report.metrics.consent.populationConsentRate.rate, null);
  assert.equal(report.coverageGates.find((gate) => gate.name === 'population_consent_denominator').state, 'unobservable');
  assert.equal(report.source.productionMetricsVerified, false);
  assert.deepEqual(report.metrics.versions.customEventsByOriginVersionAndSchema.map(({ originAppVersion, schema, customEvents }) =>
    [originAppVersion, schema, customEvents]), [['0.1.28', '2', 1], ['0.1.29', '3', 1], ['unknown', 'unknown', 1]]);
});

test('sender-version coverage uses intersecting SDK devices and exposes multi-version membership overlap', () => {
  const report = analyze([
    session('p1', { app_version_name: '0.1.28' }), session('p1'), session('p2'),
    event('p1'), event('p3'),
    event('p1', {}, { app_version_name: '0.1.28', event_json: { schema_version: 2, event_id: 'old-version',
      app_version: '0.1.28', environment: 'production', consent_state: 'enabled', properties: {} } }),
  ], options);
  assert.deepEqual(versionRow(report, '0.1.29').v3SdkPlayerCoverage, { numerator: 1, denominator: 2, rate: 0.5 });
  assert.equal(versionRow(report, '0.1.29').v3CustomPlayersOutsideSessionBaseline, 1);
  assert.deepEqual(versionRow(report, '0.1.28').v3SdkPlayerCoverage, { numerator: 0, denominator: 1, rate: 0 });
  assert.equal(report.metrics.observed.sdkPlayers, 3);
  assert.equal(report.metrics.versions.sdkPlayersObservedInMultipleSenderVersions, 1);
  assert.equal(report.metrics.versions.bySdkAppVersion.reduce((n, row) => n + row.observedCustomSdkPlayers, 0), 3);
  assert.equal(report.metrics.observed.customSdkPlayers, 2, 'version row players cannot be added as unique people');
});

test('custom session events cannot manufacture an SDK-session denominator, and a session-only export lacks custom baseline', () => {
  const report = analyze([event(), event('p', {}, { event_name: 'session_start' }),
    event('p', {}, { event_name: 'game_session_start' })], options);
  assert.equal(report.metrics.observed.sdkSessionUnits, 0);
  assert.deepEqual(versionRow(report, '0.1.29').v3SdkPlayerCoverage,
    { numerator: null, denominator: null, rate: null, reason: 'missing_sdk_session_baseline_for_version' });
  const onlySessions = analyze([session()], options);
  assert.equal(onlySessions.metrics.schema.knownCustomSchemaCoverage.rate, null);
  assert.equal(versionRow(onlySessions, '0.1.29').v3SdkPlayerCoverage.reason, 'missing_observed_custom_event_baseline');
});

test('a baseline for one sender version cannot fill another version or missing SDK identity', () => {
  const report = analyze([event(), session('p', { app_version_name: '0.1.28' })], options);
  assert.equal(versionRow(report, '0.1.29').v3SdkPlayerCoverage.denominator, null);
  const missingId = analyze([event(), session(null)], options);
  assert.equal(versionRow(missingId, '0.1.29').v3SdkPlayerCoverage.reason, 'missing_identified_sdk_session_players_for_version');
  assert.equal(missingId.metrics.identity.sdkSessionIdentityCoverage.numerator, 0);
});

test('schema/consent unknown migration is explicit and does not infer consent from schema or source', () => {
  const report = analyze([
    event('p1', { schema_version: undefined, consent_state: undefined }),
    event('p2', { schema_version: 4, consent_state: 'unknown' }),
    event('p3', { schema_version: '3', consent_state: 'private@example.com' }),
    event('p4', { schema_version: 2, properties: undefined, consent_state: undefined }),
    event('p5', { consent_state: 'enabled' }, { consent_state: 'disabled' }),
  ], { ...options, source: 'production' });
  assert.deepEqual(report.metrics.schema.unknownReasons, { missing: 1, unsupported: 1, invalid: 2 });
  assert.deepEqual(report.metrics.consent.counts, { enabled: 0, disabled: 0, unknown: 5 });
  assert.equal(report.metrics.consent.knownMetadataCoverage.rate, 0);
  assert.equal(report.metrics.consent.conflictingMetadataEvents, 1);
  assert.equal(report.metrics.consent.invalidMetadataEvents, 1);
  assert.equal(report.metrics.consent.populationConsentRate.rate, null);
  assert.ok(!JSON.stringify(report).includes('private@example.com'));
});

test('missing consent metadata is an unknown observed attribute, not disabled or completely covered', () => {
  const report = analyze([event('p1', { consent_state: undefined }), event('p2', { consent_state: null })], options);
  assert.equal(report.metrics.consent.knownMetadataCoverage.denominator, 2);
  assert.equal(report.metrics.consent.counts.unknown, 2);
  assert.equal(report.metrics.consent.counts.disabled, 0);
  assert.equal(report.coverageGates.find((gate) => gate.name === 'observed_custom_consent_metadata').state, 'partial');
});

test('test/QA, nonproduction, unknown environment and invalid test provenance are excluded separately', () => {
  const report = analyze([
    event('unknown', { environment: undefined }), event('qa', { is_qa: true }), event('test', { is_test: '1' }),
    event('dev', { environment: 'development' }), event('bad-env', { environment: 'private@example.com' }),
    event('bad-test', { is_test: 'PRIVATE' }), session('unknown-session', { environment: undefined }),
    { record_type: 'install', environment: 'production', appmetrica_device_id: 'install', install_datetime: at },
    event('unsupported', {}, { record_type: 'PRIVATE_RECORD_TYPE' }),
  ], { ...options, source: 'production' });
  assert.equal(report.status, 'needs_raw_data'); assert.equal(report.metrics, null);
  assert.equal(report.quality.exclusions.unknownEnvironment, 3);
  assert.equal(report.quality.exclusions.testOrQa, 2);
  assert.equal(report.quality.exclusions.nonProductionEnvironment, 1);
  assert.equal(report.quality.exclusions.unknownTestStatus, 1);
  assert.equal(report.quality.exclusions.sdkInstallRecords, 1);
  assert.equal(report.quality.exclusions.unsupportedRecordType, 1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
});

test('SDK observation clock is required; business/replay and local handoff clocks cannot substitute', () => {
  const report = analyze([
    event('p1', { occurredAtMs: Date.parse(at) }, { event_datetime: undefined }),
    event('p2', { sdk_handoff_at: at }, { event_datetime: undefined }),
    event('p3', {}, { event_datetime: '2026-11-01 09:00:00' }),
    event('p4', { timeKnown: false, occurred_at: '2025-01-01T00:00:00Z' }),
  ], options);
  assert.equal(report.quality.exclusions.missingSdkObservationTime, 3);
  assert.equal(report.metrics.observed.customEvents, 1, 'observed export row clock remains known even when business occurrence is unknown');
});

test('inclusive product dates and explicit as-of enforce UTC+3 start/end boundaries', () => {
  const report = analyze([
    event('start', {}, { event_datetime: '2026-10-27T21:00:00Z' }),
    event('before', {}, { event_datetime: '2026-10-27T20:59:59.999Z' }),
    event('last', {}, { event_datetime: '2026-11-03T20:59:59.999Z' }),
    event('end', {}, { event_datetime: '2026-11-03T21:00:00Z' }),
    event('future', {}, { event_datetime: '2026-11-04T09:00:00.001Z' }),
  ], options);
  assert.equal(report.metrics.observed.customEvents, 2);
  assert.equal(report.quality.exclusions.beforeWindow, 1);
  assert.equal(report.quality.exclusions.atOrAfterWindowEnd, 1);
  assert.equal(report.quality.exclusions.afterAsOf, 1);
  assert.equal(report.window.toExclusive, '2026-11-04');
});

test('immutable origin version and SDK sender version are separate, invalid labels remain unknown', () => {
  const report = analyze([event('p', { app_version: '0.1.28' }),
    event('p2', { app_version: 'PRIVATE_WORD' }, { app_version_name: 'private@example.com' }), session('p')], options);
  assert.equal(report.metrics.versions.customEventsByOriginVersionAndSchema[0].originAppVersion, '0.1.28');
  assert.equal(versionRow(report, '0.1.29').observedCustomEvents, 1);
  assert.equal(versionRow(report, 'unknown').v3SdkPlayerCoverage.rate, null);
  assert.equal(report.metrics.versions.originVersionCoverageOnCustomEvents.rate, 0.5);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_WORD'));
});

test('repeated raw event IDs are one custom fact, while repeated sender-version observations remain memberships', () => {
  const original = event('p');
  const copy = { ...original, event_datetime: '2026-11-02T09:00:00Z', app_version_name: '0.1.30' };
  const report = analyze([original, copy, { ...original }, session('p'), session('p', { app_version_name: '0.1.30' })], options);
  assert.equal(report.metrics.observed.customEvents, 1);
  assert.equal(report.quality.repeatedCustomEventIdCopies, 2);
  assert.equal(report.quality.repeatedCustomEventIdGroups, 1);
  assert.equal(report.quality.eventIdsObservedAcrossSdkVersions, 1);
  assert.equal(report.quality.conflictingQualityMetadataEventIdGroups, 0);
  assert.equal(versionRow(report, '0.1.29').observedCustomEvents, 1);
  assert.equal(versionRow(report, '0.1.30').observedCustomEvents, 1);
  assert.equal(report.metrics.delivery.localDedupeCounter.knownEpoch.cumulativeMaximaTotal, null);
});

test('conflicting quality metadata under one event ID is excluded, not arbitrarily assigned a version or consent', () => {
  const original = event('p');
  const report = analyze([original, { ...original, appmetrica_device_id: 'different-player' },
    { ...original, event_json: { ...original.event_json, consent_state: 'disabled' } }, event('good')], options);
  assert.equal(report.metrics.observed.customEvents, 1);
  assert.equal(report.quality.repeatedCustomEventIdCopies, 2);
  assert.equal(report.quality.conflictingQualityMetadataEventIdGroups, 1);
  assert.equal(report.quality.conflictingCustomRowsExcluded, 3);
});

test('unkeyed legacy observations remain rows with unknown duplicate coverage, never fabricated IDs', () => {
  const row = event('p', { event_id: undefined });
  const report = analyze([row, row], options);
  assert.equal(report.metrics.observed.customEvents, 2);
  assert.equal(report.metrics.observed.customRowsWithoutEventId, 2);
  assert.equal(report.metrics.identity.customEventIdCoverage.rate, 0);
  assert.equal(report.quality.repeatedCustomEventIdCopies, 0);
});

test('SDK session IDs and start clocks deduplicate only SDK rows, and conflicts cannot create a device baseline', () => {
  const first = session('p');
  const keyedByStart = session('p2', { session_id: undefined });
  const noKey = session('p3', { session_id: undefined, session_start_datetime: undefined, event_datetime: at });
  const report = analyze([event('p'), first, { ...first }, keyedByStart, { ...keyedByStart }, noKey, { ...noKey }], options);
  assert.equal(report.metrics.observed.sdkSessionUnits, 4);
  assert.equal(report.quality.repeatedSdkSessionCopies, 2);
  assert.equal(report.metrics.observed.sessionRowsWithoutSessionIdentity, 2);
  const conflict = analyze([event('p'), first, { ...first, consent_state: 'disabled' }], options);
  assert.equal(conflict.quality.conflictingSdkSessionGroups, 1);
  assert.equal(versionRow(conflict, '0.1.29').v3SdkPlayerCoverage.denominator, null);
});

test('UInt64 SDK identities are distinct strings, unsafe numbers and app-local IDs cannot fill the denominator', () => {
  const report = analyze([event('18446744073709551615'), event('18446744073709551614'),
    event(18446744073709551615), event(null, { player_id: 'APP_LOCAL_PRIVATE' })], options);
  assert.equal(report.metrics.observed.customSdkPlayers, 2);
  assert.deepEqual(report.metrics.identity.customEventSdkIdentityCoverage, { numerator: 2, denominator: 4, rate: 0.5 });
  assert.ok(!JSON.stringify(report).includes('18446744073709551615'));
  assert.ok(!JSON.stringify(report).includes('APP_LOCAL_PRIVATE'));
});

test('cumulative health snapshots use maxima and distinguish local dedupe hits from raw repeated deliveries', () => {
  const first = health('p', '2026-11-01T09:00:00Z', { dropped_properties: 2, dedupe_hits: 3, handoff_failures: 1 });
  const report = analyze([first, { ...first },
    health('p', '2026-11-01T10:00:00Z', { dropped_properties: 5, dedupe_hits: 7, handoff_failures: 2 }),
    health('p', '2026-11-01T11:00:00Z', { dropped_properties: 5, dedupe_hits: 7, handoff_failures: 2 })], options);
  assert.equal(report.metrics.health.counters.dropped_properties.knownEpoch.cumulativeMaximaTotal, 5);
  assert.equal(report.metrics.health.counters.dropped_properties.observedSnapshots, 3);
  assert.equal(report.metrics.delivery.localDedupeCounter.knownEpoch.cumulativeMaximaTotal, 7);
  assert.equal(report.metrics.delivery.rawRepeatedEventIdCopies, 1);
  assert.equal(report.metrics.delivery.serverAcknowledgementRate.rate, null);
  assert.equal(report.metrics.health.counters.missing_required.knownEpoch.cumulativeMaximaTotal, null, 'missing legacy counter is unknown, not zero');
});

test('counter decreases are diagnostic only; distinct consent epochs and unknown epochs stay separate', () => {
  const report = analyze([
    health('p', '2026-11-01T09:00:00Z', { dedupe_hits: 2 }),
    health('p', '2026-11-01T10:00:00Z', { dedupe_hits: 5 }),
    health('p', '2026-11-01T11:00:00Z', { dedupe_hits: 1 }),
    health('p', '2026-11-01T12:00:00Z', { dedupe_hits: 3 }),
    health('p', '2026-11-02T09:00:00Z', { dedupe_hits: 10 }, { consent_epoch_at: '2026-11-02T08:00:00Z' }),
    health('p', '2026-11-03T09:00:00Z', { dedupe_hits: 4 }, { consent_epoch_at: null }),
    health('p', '2026-11-03T10:00:00Z', { dedupe_hits: 6 }, { consent_epoch_at: undefined }),
  ], options);
  assert.equal(report.metrics.health.counters.dedupe_hits.knownEpoch.cumulativeMaximaTotal, 15);
  assert.equal(report.metrics.health.counters.dedupe_hits.unknownEpoch.cumulativeMaximaTotal, 6);
  assert.equal(report.metrics.health.diagnostics.counterDecreasesOrReordering, 1);
  assert.equal(report.metrics.health.knownEpochSegments, 2);
  assert.equal(report.metrics.health.unknownEpochSegments, 1);
});

test('simultaneous conflicting health snapshots have order-independent maxima and no invented reset ordering', () => {
  const rows = [health('p', at, { dropped_properties: 2, dedupe_hits: 4 }), health('p', at, { dropped_properties: 5, dedupe_hits: 1 })];
  const first = analyze(rows, options).metrics.health; const second = analyze([...rows].reverse(), options).metrics.health;
  assert.deepEqual(first, second);
  assert.equal(first.counters.dropped_properties.knownEpoch.cumulativeMaximaTotal, 5);
  assert.equal(first.counters.dedupe_hits.knownEpoch.cumulativeMaximaTotal, 4);
  assert.equal(first.diagnostics.simultaneousConflictingSnapshotGroups, 1);
  assert.equal(first.diagnostics.counterDecreasesOrReordering, 0);
});

test('missing fields are not zero resets, and a window-start cumulative count is not a period delta', () => {
  const report = analyze([
    health('p', '2026-10-27T09:00:00Z', { dropped_properties: 100 }),
    health('p', '2026-11-01T09:00:00Z', { dropped_properties: 105 }),
    health('p', '2026-11-01T10:00:00Z', { dedupe_hits: 2 }),
    health('p', '2026-11-01T11:00:00Z', { dropped_properties: 107 }),
  ], options);
  assert.equal(report.metrics.health.counters.dropped_properties.knownEpoch.cumulativeMaximaTotal, 107);
  assert.equal(report.metrics.health.diagnostics.counterDecreasesOrReordering, 0);
  assert.match(report.metrics.health.semantics, /Not snapshot sums, window incident counts/);
});

test('an older snapshot delivered later cannot be counted as a new reset-state total', () => {
  const report = analyze([
    health('p', '2026-11-01T10:00:00Z', { dedupe_hits: 10 }),
    health('p', '2026-11-01T12:00:00Z', { dedupe_hits: 2 }, { occurred_at: '2026-11-01T08:00:00Z' }),
  ], options);
  assert.equal(report.metrics.health.counters.dedupe_hits.knownEpoch.cumulativeMaximaTotal, 10);
  assert.equal(report.metrics.health.knownEpochSegments, 1);
  assert.equal(report.metrics.health.diagnostics.counterDecreasesOrReordering, 1);
});

test('invalid/future epochs, missing SDK identity and invalid counters are explicit unknown coverage', () => {
  const report = analyze([
    health('p1', at, { dedupe_hits: 0, missing_required: -1, dropped_properties: 1.5 }, { consent_epoch_at: 'PRIVATE_EPOCH' }),
    health('p2', at, { dedupe_hits: 1 }, { consent_epoch_at: '2027-01-01T00:00:00Z' }),
    health(null, at, { dedupe_hits: 999 }),
  ], options);
  assert.equal(report.metrics.health.diagnostics.invalidCounterFields, 2);
  assert.equal(report.metrics.health.diagnostics.invalidEpochSnapshots, 2);
  assert.equal(report.metrics.health.diagnostics.unknownEpochSnapshots, 2);
  assert.equal(report.metrics.health.diagnostics.missingSdkIdentity, 1);
  assert.equal(report.metrics.health.counters.dedupe_hits.knownEpoch.cumulativeMaximaTotal, null);
  assert.equal(report.metrics.health.counters.dedupe_hits.unknownEpoch.cumulativeMaximaTotal, 1);
  assert.equal(report.metrics.health.counters.dedupe_hits.observedSnapshots, 3);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_EPOCH'));
});

test('health aggregate overflow is unknown rather than an imprecise integer', () => {
  const report = analyze([health('p1', at, { dedupe_hits: Number.MAX_SAFE_INTEGER }), health('p2', at, { dedupe_hits: 1 })], options);
  const result = report.metrics.health.counters.dedupe_hits.knownEpoch;
  assert.equal(result.cumulativeMaximaTotal, null);
  assert.equal(result.overflowed, true); assert.equal(result.deviceEpochSegments, 2);
});

test('all report/render outputs omit SDK/event/session/local IDs, raw words, email values and epoch values', () => {
  const rows = [event('SDK_PRIVATE_ID', { event_id: 'EVENT_PRIVATE_ID', player_id: 'LOCAL_PRIVATE_ID',
    word: 'PRIVATE_WORD_TEXT', email: 'private@example.com', rawInput: 'PRIVATE_RAW_INPUT' }),
    session('SDK_PRIVATE_ID', { session_id: 'SESSION_PRIVATE_ID' }),
    health('SDK_PRIVATE_ID', at, { dedupe_hits: 5, dropped_properties: 6 }, { consent_epoch_at: '2026-10-01T10:11:12Z' })];
  const before = JSON.stringify(rows); const report = analyze(rows, options);
  const result = JSON.stringify(report) + renderMarkdown(report);
  for (const value of ['SDK_PRIVATE_ID', 'EVENT_PRIVATE_ID', 'LOCAL_PRIVATE_ID', 'SESSION_PRIVATE_ID', 'PRIVATE_WORD_TEXT',
    'private@example.com', 'PRIVATE_RAW_INPUT', '2026-10-01T10:11:12Z']) assert.ok(!result.includes(value), value);
  assert.equal(JSON.stringify(rows), before, 'normalization and deduplication do not mutate input');
  assert.match(renderMarkdown(report), /SYNTHETIC DEVELOPMENT DATA; NOT LIVE/);
});

test('empty production data and explicit raw-unavailable report preserve null metrics and unverified production', () => {
  const empty = analyze([], { ...options, source: 'production' });
  const missing = buildNeedsRawDataReport({ ...options, source: 'production' });
  for (const report of [empty, missing]) {
    assert.equal(report.status, 'needs_raw_data'); assert.equal(report.metrics, null);
    assert.equal(report.source.productionMetricsVerified, false);
    assert.equal(report.coverageGates.find((gate) => gate.name === 'population_consent_denominator').coverage.rate, null);
  }
});

test('options require explicit source, valid dates/offset/as-of and a fully observed calendar window', () => {
  for (const change of [{ source: undefined }, { source: 'PRIVATE' }, { timezone: undefined }, { timezone: 'Europe/Moscow' },
    { timezone: '+14:01' }, { dateFrom: '2026-02-30' }, { dateTo: '2026-10-27' }, { asOf: undefined },
    { asOf: '2026-11-04T12:00:00' }, { asOf: '2026-11-04T24:00:00Z' }, { asOf: '2026-02-30T12:00:00Z' },
    { asOf: '2026-11-03T20:59:59Z' }]) assert.throws(() => analyze([], { ...options, ...change }));
  assert.throws(() => analyze(null, options), /array/);
});

test('CLI rejects duplicate/unknown flags and missing inputs without echoing arbitrary values', () => {
  const valid = cliArgs('out', [], ['--needs-raw-data']);
  assert.equal(parseArguments(valid).needsRawData, true);
  for (const extra of [['--source', 'production'], ['--as-of'], ['--PRIVATE_RAW_FLAG'], ['--input', 'private.json']]) {
    assert.throws(() => parseArguments([...valid, ...extra]));
  }
  assert.throws(() => parseArguments(cliArgs('out')), /input is required/);
});

test('JSON, JSONL and quoted multiline CSV reuse the parser and preserve UInt64 SDK identity', (t) => {
  const dir = tempDirectory(t); const rows = [event('18446744073709551615'), session('18446744073709551615')];
  const json = path.join(dir, 'data.json'); const jsonl = path.join(dir, 'data.jsonl'); const csv = path.join(dir, 'data.csv');
  fs.writeFileSync(json, JSON.stringify({ rows }));
  fs.writeFileSync(jsonl, rows.map((row) => JSON.stringify(row)).join('\n'));
  const header = ['record_type', 'appmetrica_device_id', 'event_name', 'event_datetime', 'app_version_name', 'environment', 'session_id', 'session_start_datetime', 'event_json'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  fs.writeFileSync(csv, [header.join(','), ...rows.map((row) => header.map((key) => quote(key === 'event_json'
    ? row.event_json ? JSON.stringify(row.event_json, null, 2) : '' : row[key])).join(','))].join('\r\n'));
  const parsed = readInputFiles([json, jsonl, csv]);
  assert.equal(parsed.length, 6);
  assert.equal(parsed[4].appmetrica_device_id, '18446744073709551615');
  const report = analyze(parsed, options);
  assert.equal(report.metrics.observed.customEvents, 1);
  assert.equal(report.metrics.observed.sdkSessionUnits, 1);
  assert.equal(report.quality.repeatedCustomEventIdCopies, 2);
  assert.equal(report.metrics.observed.sdkPlayers, 1);
});

test('malformed record/payload and file parse errors expose counts or generic errors, not payload excerpts', (t) => {
  const report = analyze([null, { event_name: 'bad name', environment: 'production' },
    { event_name: 'app_open', event_json: '{"PRIVATE_SECRET":' }, event('p', {}, { event_json: [] })], options);
  assert.equal(report.quality.exclusions.invalidRecord, 2);
  assert.equal(report.quality.exclusions.invalidPayload, 2);
  assert.equal(report.metrics, null);
  const dir = tempDirectory(t); const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, '{"PRIVATE_SECRET":');
  assert.throws(() => readInputFiles([file]), (error) => !error.message.includes('PRIVATE_SECRET'));
  fs.writeFileSync(file, JSON.stringify([{ event_name: 'app_open', event_json: '{"PRIVATE_SECRET":' }]));
  const result = spawnSync(process.execPath, [cliPath, ...cliArgs(path.join(dir, 'report'), [file])], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'malformed individual payload is a counted quality exclusion');
  assert.ok(!(result.stdout + result.stderr + fs.readFileSync(path.join(dir, 'report.json'), 'utf8')).includes('PRIVATE_SECRET'));
});

test('CLI output cannot overwrite an input directly or through a hard link', (t) => {
  const dir = tempDirectory(t); const input = path.join(dir, 'source.json'); const original = JSON.stringify([event()]);
  fs.writeFileSync(input, original);
  const direct = spawnSync(process.execPath, [cliPath, ...cliArgs(input.slice(0, -5), [input])], { encoding: 'utf8' });
  assert.equal(direct.status, 1); assert.match(direct.stderr, /must not overwrite/);
  assert.equal(fs.readFileSync(input, 'utf8'), original);
  const alias = path.join(dir, 'alias.json'); fs.linkSync(input, alias);
  const linked = spawnSync(process.execPath, [cliPath, ...cliArgs(alias.slice(0, -5), [input])], { encoding: 'utf8' });
  assert.equal(linked.status, 1); assert.match(linked.stderr, /must not overwrite/);
  assert.equal(fs.readFileSync(input, 'utf8'), original);
});

test('CLI reports deterministic synthetic aggregates across machine timezones and supports honest raw-unavailable output', (t) => {
  const dir = tempDirectory(t); const input = path.join(dir, 'events.json');
  fs.writeFileSync(input, JSON.stringify([event(), session()]));
  const reports = [];
  for (const zone of ['Pacific/Honolulu', 'Asia/Tokyo']) {
    const prefix = path.join(dir, zone.replace('/', '-'));
    const result = spawnSync(process.execPath, [cliPath, ...cliArgs(prefix, [input])], { encoding: 'utf8', env: { ...process.env, TZ: zone } });
    assert.equal(result.status, 0, result.stderr);
    reports.push(JSON.parse(fs.readFileSync(`${prefix}.json`, 'utf8')));
    assert.match(fs.readFileSync(`${prefix}.md`, 'utf8'), /SYNTHETIC DEVELOPMENT DATA; NOT LIVE/);
  }
  assert.deepEqual(reports[0], reports[1]);
  const prefix = path.join(dir, 'missing');
  const args = cliArgs(prefix, [], ['--needs-raw-data']); args[args.indexOf('synthetic')] = 'production';
  const missing = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  assert.equal(missing.status, 0, missing.stderr);
  const report = JSON.parse(fs.readFileSync(`${prefix}.json`, 'utf8'));
  assert.equal(report.metrics, null); assert.equal(report.source.productionMetricsVerified, false);
  assert.deepEqual(JSON.parse(missing.stdout), { status: 'needs_raw_data', source: 'production', outputFiles: 2 });
});
