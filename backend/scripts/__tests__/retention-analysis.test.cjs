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
    install_datetime: '2026-09-20T10:00:00Z', event_json: JSON.stringify(properties), ...extra };
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
