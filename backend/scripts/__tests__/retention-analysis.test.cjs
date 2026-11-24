'use strict';
/* global __dirname */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { analyzeRecords, normalizeRecord } = require('../../../scripts/analyze-retention.cjs');

const asOf = '2026-10-03T12:00:00+03:00';
function event(name, at, properties = {}, extra = {}) {
  return { appmetrica_device_id: 'sdk-1', event_name: name, event_timestamp: at,
    install_datetime: '2026-09-20T10:00:00Z', install_kind: 'first', event_json: JSON.stringify(properties), ...extra };
}
function v2(name, at, properties, extra = {}) {
  return event(name, at, {}, { event_json: JSON.stringify({ schema_version: 2,
    player_id: 'new-app-local-identity', event_id: `event:${name}:${at}`, occurred_at: at,
    app_version: '0.1.9', onboarding_version: 'intro-v1', content_version: 'intro-v1', properties }), ...extra });
}

test('mixed completion names use SDK identity and do not count delivery/semantic duplicates as extra wins', () => {
  const rows = [event('level_start', '2026-09-20T10:00:00Z', { id: 1, daily: false }),
    event('level_complete', '2026-09-20T10:00:30Z', { id: 1, daily: false }),
    v2('puzzle_completed', '2026-09-20T10:00:31Z', { levelKey: 'campaign:1', mode: 'campaign', attemptId: 'a1' }),
    v2('puzzle_completed', '2026-09-20T10:00:31Z', { levelKey: 'campaign:1', mode: 'campaign', attemptId: 'a1' }),
    v2('level_reward_claimed', '2026-09-20T10:00:32Z', { levelId: 1, mode: 'campaign', attemptId: 'a1' })];
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.uniqueUsers, 1);
  assert.equal(result.completionEvidence.completedUsers, 1);
  assert.equal(result.quality.deliveryDuplicates, 1);
  assert.deepEqual(result.uniquePlayerPuzzleConversion, { numerator: 1, denominator: 1, rate: 1 });
  assert.equal(result.measuredAttempts.completion.denominator, 0);
  assert.equal(result.measuredAttempts.startsWithoutAttemptIdentity, 1);
});

test('only fresh measured attempt starts enter mature attempt conversion; resumes never do', () => {
  const rows = [v2('puzzle_started', '2026-09-25T10:00:00Z', { levelKey: 'campaign:1', mode: 'campaign', attemptId: 'a1' }),
    v2('puzzle_resumed', '2026-09-26T10:00:00Z', { levelKey: 'campaign:1', mode: 'campaign', attemptId: 'a1' }),
    v2('puzzle_completed', '2026-09-26T10:00:10Z', { levelKey: 'campaign:1', mode: 'campaign', attemptId: 'a1' }),
    v2('puzzle_started', '2026-10-03T08:00:00Z', { levelKey: 'campaign:2', mode: 'campaign', attemptId: 'a2' })];
  const result = analyzeRecords(rows, { asOf });
  assert.deepEqual(result.measuredAttempts.completion, { numerator: 1, denominator: 1, rate: 1 });
  assert.equal(result.measuredAttempts.incompleteWithinWindow, 0);
});

test('completed daily activity uses actionDay, not puzzle date or delayed telemetry delivery', () => {
  const row = v2('daily_completed', '2026-10-03T08:00:00Z', {
    dateKey: '2026-09-25', actionDay: '2026-10-01', mode: 'daily' });
  assert.equal(normalizeRecord(row).day, '2026-10-01');
  assert.equal(normalizeRecord(row).timeMs, null);
  const archive = v2('daily_completed', '2026-10-03T08:00:00Z', {
    dateKey: '2026-09-25', actionDay: '2026-10-03', mode: 'daily' });
  assert.equal(normalizeRecord(archive).day, '2026-10-03');
});

test('a late calendar-only completion is unknown for an exact conversion window, not a failed attempt', () => {
  const rows = [v2('daily_started', '2026-09-25T10:00:00Z', { dateKey: '2026-09-25', mode: 'daily' }),
    v2('daily_completed', '2026-10-03T08:00:00Z', { dateKey: '2026-09-25', actionDay: '2026-09-26', mode: 'daily' })];
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.quality.unknownPuzzleCompletionTimes, 1);
  assert.equal(result.uniquePlayerPuzzleConversion.rate, null);
});

test('D7 includes only completely observed installation cohorts; a late upgrade is not a new install', () => {
  const rows = [event('install', '2026-09-20T10:00:00Z'),
    v2('gameplay_action', '2026-09-27T10:00:00Z', { action: 'word_submitted' }),
    event('install', '2026-10-01T10:00:00Z', {}, { appmetrica_device_id: 'sdk-new', install_datetime: '2026-10-01T10:00:00Z' }),
    event('session_start', '2026-10-02T10:00:00Z', {}, { appmetrica_device_id: 'sdk-new', install_datetime: '2026-10-01T10:00:00Z' }),
    v2('first_open', '2026-10-02T08:00:00Z', {}, { install_datetime: undefined, appmetrica_device_id: 'sdk-unknown' })];
  const result = analyzeRecords(rows, { asOf });
  assert.deepEqual(result.retention.find((row) => row.day === 7).play, { numerator: 1, denominator: 1, rate: 1 });
  assert.equal(result.retention.find((row) => row.day === 1).open.denominator, 2);
  assert.equal(result.quality.usersWithUnknownInstall, 1);
});

test('unknown identities and timezone-less timestamps are explicit; as-of must be fixed', () => {
  const result = analyzeRecords([
    v2('puzzle_completed', '2026-09-20T10:00:00Z', {}, { appmetrica_device_id: undefined }),
    event('gameplay_action', '2026-09-20 10:00:00', {}, { install_datetime: undefined }),
  ], { asOf });
  assert.equal(result.quality.missingSdkIdentity, 1);
  assert.equal(result.quality.missingTimestamp, 1);
  assert.equal(result.retention[0].open.rate, null);
  assert.throws(() => analyzeRecords([], {}), /as-of/);
});

test('the offline CLI reads JSONL and emits an aggregate report without raw player identities', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-retention-'));
  const input = path.join(tempDir, 'events.jsonl');
  t.after(() => { fs.unlinkSync(input); fs.rmdirSync(tempDir); });
  fs.writeFileSync(input, `${JSON.stringify(event('level_start', '2026-09-20T10:00:00Z', { id: 1, daily: false }))}\n`);
  const output = execFileSync(process.execPath, [path.resolve(__dirname, '../../../scripts/analyze-retention.cjs'),
    '--input', input, '--as-of', asOf], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).completionEvidence.startedUsers, 1);
  assert.equal(output.includes('sdk-1'), false);
});

function v3(name, at, properties = {}, extra = {}) {
  return event(name, at, {}, { event_json: JSON.stringify({ schema_version: 3,
    event_id: `v3:${name}:${at}`, occurred_at: at, app_version: '0.1.29', environment: 'production',
    onboarding_version: 'intro-v2', content_version: 'content-v3', ...properties }),
  installation_id: 'installation-one', ...extra });
}

test('flat v3 normalizes real action time and exact A24 without using a local player as an installation', () => {
  const start = '2026-09-20T10:00:00Z';
  const rows = [v3('puzzle_started', start, { mode: 'campaign', levelKey: 'campaign:2', attemptId: 'a1' }),
    v3('independent_level_completed', '2026-09-21T09:59:59Z', { mode: 'campaign', levelId: 2, assisted: false,
      player_id: 'rotated-local-player' }),
    v3('word_submit_outcome', '2026-09-27T12:00:00Z', { mode: 'campaign', manual: true })];
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.versions[0].appVersion, '0.1.29');
  assert.equal(result.versions[0].contentVersion, 'content-v3');
  assert.deepEqual(result.activation24h, { numerator: 1, denominator: 1, rate: 1 });
  assert.equal(result.retention.find((r) => r.day === 7).play.rate, 1);
  const late = rows.map((r) => structuredClone(r));
  late[1].event_json = JSON.stringify({ ...JSON.parse(late[1].event_json), occurred_at: '2026-09-21T10:00:00Z' });
  assert.equal(analyzeRecords(late, { asOf }).activation24h.numerator, 0);
});

test('unknown first-install classification is visible and excluded, not inferred from a first custom event', () => {
  const rows = [v3('first_open', '2026-09-20T10:00:00Z', {}, { install_kind: undefined }),
    v3('independent_level_completed', '2026-09-20T10:01:00Z', { levelId: 2 }, { install_kind: undefined })];
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.installCohort.users, 0);
  assert.equal(result.installCohort.unknownClassificationEpisodes, 1);
  assert.equal(result.quality.unknownInstallClassification, 1);
  assert.equal(result.activation24h.rate, null);
});

test('reinstall episodes cannot contribute play to the original first-install retention or puzzle conversion', () => {
  const rows = [v3('puzzle_started', '2026-09-20T10:00:00Z', { mode: 'campaign', levelKey: 'campaign:2', attemptId: 'a1' }),
    v3('install', '2026-09-21T10:00:00Z', {}, { installation_id: 'installation-two',
      install_datetime: '2026-09-21T10:00:00Z', install_kind: 'reinstall' }),
    v3('puzzle_completed', '2026-09-21T10:01:00Z', { mode: 'campaign', levelKey: 'campaign:2', attemptId: 'a1' },
      { installation_id: 'installation-two', install_datetime: '2026-09-21T10:00:00Z', install_kind: 'reinstall' }),
    v3('gameplay_action', '2026-09-27T11:00:00Z', { action: 'word_submitted' },
      { installation_id: 'installation-two', install_datetime: '2026-09-21T10:00:00Z', install_kind: 'reinstall' })];
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.installCohort.users, 1);
  assert.equal(result.installCohort.reinstallEpisodes, 1);
  assert.equal(result.quality.devicesWithMultipleInstallEpisodes, 1);
  assert.equal(result.retention.find((r) => r.day === 7).play.rate, null);
  assert.equal(result.measuredAttempts.completion.numerator, 0);
  assert.equal(result.uniquePlayerPuzzleConversion.numerator, 0);
});

test('test traffic and automatic gestures do not become play; exact attempt window rejects late completions', () => {
  const rows = [v3('puzzle_started', '2026-09-20T10:00:00Z', { mode: 'campaign', levelKey: 'campaign:2', attemptId: 'a1' }),
    v3('puzzle_completed', '2026-09-23T10:00:01Z', { mode: 'campaign', levelKey: 'campaign:2', attemptId: 'a1' }),
    v3('gameplay_action', '2026-09-21T11:00:00Z', { action: 'letters_connected' }),
    v3('hint_used', '2026-09-21T11:00:01Z', { manual: false }),
    v3('word_submit_outcome', '2026-09-21T11:00:02Z', { environment: 'test' })];
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.measuredAttempts.completion.numerator, 0);
  assert.equal(result.uniquePlayerPuzzleConversion.numerator, 0);
  assert.equal(result.retention[0].play.numerator, 0);
  assert.equal(result.quality.excludedTestRecords, 1);
});

test('unsafe numeric SDK identifiers are excluded; 64-bit string identifiers retain precision', () => {
  const unsafe = v3('app_ready', '2026-09-20T10:00:00Z', {}, { appmetrica_device_id: 18446744073709551615 });
  const safe = v3('app_ready', '2026-09-20T10:00:00Z', {}, { appmetrica_device_id: '18446744073709551615' });
  const result = analyzeRecords([unsafe, safe], { asOf });
  assert.equal(result.uniqueUsers, 1);
  assert.equal(result.quality.missingSdkIdentity, 1);
});

test('legacy recovered milestones with timeKnown=false cannot invent exact solve time from v3 handoff', () => {
  const row = v3('daily_completed', '2026-09-25T10:00:00Z', { mode: 'daily', dateKey: '2026-09-24',
    actionDay: '2026-09-25', timeKnown: false, recovery: true, observedAtMs: Date.parse('2026-09-25T10:00:00Z') });
  const normalized = normalizeRecord(row);
  assert.equal(normalized.day, '2026-09-25');
  assert.equal(normalized.timeMs, null);
});

test('ambiguous episode metadata and reused installation IDs fail closed for primary cohorts', () => {
  const rows = [v3('install', '2026-09-20T10:00:00Z'),
    v3('install', '2026-09-21T10:00:00Z', {}, { install_datetime: '2026-09-21T10:00:00Z', install_kind: 'reinstall' }),
    v3('independent_level_completed', '2026-09-21T10:01:00Z', { levelId: 2 })];
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.installCohort.users, 0);
  assert.ok(result.quality.conflictingInstallEpisodes > 0);
  assert.ok(result.quality.eventsWithAmbiguousInstall > 0);
  assert.equal(result.activation24h.rate, null);
});

test('real-shaped flat v3 Logs payload install_key/device_key preserve separate reused-attempt episodes', () => {
  const logs = (name, at, installKey, properties = {}, extra = {}) => ({ event_name: name,
    event_timestamp: at, event_json: JSON.stringify({ schema_version: 3, occurred_at: at,
      event_id: `logs:${name}:${installKey}`, app_version: '0.1.29', content_version: 'same-content',
      device_key: '18446744073709551615', install_key: installKey, ...properties }), ...extra });
  const rows = [
    { record_type: 'install', appmetrica_device_id: '18446744073709551615', installation_id: 'first-sdk-install',
      install_datetime: '2026-09-20T10:00:00Z', install_kind: 'first' },
    { record_type: 'install', appmetrica_device_id: '18446744073709551615', installation_id: 'second-sdk-install',
      install_datetime: '2026-09-21T10:00:00Z', install_kind: 'reinstall' },
    logs('puzzle_started', '2026-09-20T11:00:00Z', 'first-sdk-install', {
      levelKey: 'campaign:2', mode: 'campaign', attemptId: 'reused-local-attempt' }),
    logs('puzzle_completed', '2026-09-21T11:00:00Z', 'second-sdk-install', {
      levelKey: 'campaign:2', mode: 'campaign', attemptId: 'reused-local-attempt' }),
    // An explicit old installation must not silently join the new time interval.
    logs('puzzle_completed', '2026-09-21T11:05:00Z', 'first-sdk-install', {
      levelKey: 'campaign:3', mode: 'campaign', attemptId: 'old-install-attempt' },
    { appmetrica_device_id: '18446744073709551615' }),
  ];
  const normalized = normalizeRecord(rows[2]);
  assert.equal(normalized.installIdentity, 'first-sdk-install');
  assert.equal(normalized.sdkId, '18446744073709551615');
  const result = analyzeRecords(rows, { asOf });
  assert.equal(result.uniqueUsers, 1);
  assert.equal(result.installCohort.users, 1);
  assert.equal(result.installCohort.reinstallEpisodes, 1);
  assert.equal(result.quality.eventsWithAmbiguousInstall, 1);
  assert.equal(result.measuredAttempts.completion.numerator, 0);
});
