'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 3 * 60 * 60 * 1000;
const COMPLETE_NAMES = new Set(['level_complete', 'puzzle_completed', 'level_reward_claimed', 'daily_completed']);
const START_NAMES = new Set(['level_start', 'puzzle_started', 'daily_started']);
const PLAY_NAMES = new Set(['gameplay_action', 'word_submitted', 'word_submit_outcome', 'word_found', 'wrong_word', 'hint_used']);
const OPEN_NAMES = new Set(['session_start', 'game_session_start', 'app_open', 'home_viewed']);

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e11 ? value * 1000 : value;
    return ms >= 0 && ms <= 8640000000000000 ? ms : null;
  }
  if (typeof value !== 'string') return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return timestamp(Number(value));
  // A bare SDK datetime has no provable timezone. Require UTC/offset rather
  // than allowing Date.parse to use the machine's locale.
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function productDay(ms) { return new Date(ms + OFFSET_MS).toISOString().slice(0, 10); }
function dayNumber(day) { return Date.parse(`${day}T00:00:00Z`) / DAY_MS; }
function safeLabel(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,95}$/i.test(value) ? value : 'unknown'; }

function normalizeRecord(record) {
  let payload = record.event_json ?? record.params ?? {};
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  const envelope = payload.schema_version === 2 && payload.properties && typeof payload.properties === 'object';
  const properties = envelope ? payload.properties : payload;
  const name = record.event_name ?? record.name
    ?? (record.record_type === 'install' ? 'install' : record.record_type === 'session' ? 'session_start' : 'unknown');
  const identity = record.appmetrica_device_id ?? record.sdk_id;
  const sdkId = (typeof identity === 'string' || Number.isSafeInteger(identity)) && String(identity).length
    ? String(identity) : null;
  const emittedAtMs = timestamp(properties.occurredAtMs) ?? timestamp(envelope ? payload.occurred_at : null)
    ?? timestamp(record.event_timestamp) ?? timestamp(record.event_datetime) ?? timestamp(record.occurred_at);
  const installMs = timestamp(record.install_timestamp) ?? timestamp(record.install_datetime)
    ?? timestamp(record.installed_at);
  const installDay = installMs !== null ? productDay(installMs)
    : validDay(record.install_day) ? record.install_day : null;
  const mode = properties.mode === 'daily' || properties.daily === true || name.startsWith('daily_')
    ? 'daily' : properties.mode === 'campaign' || properties.mode === 'normal' || properties.daily === false
      ? 'campaign' : 'unknown';
  const levelId = properties.levelId ?? properties.id;
  let puzzleKey = typeof properties.levelKey === 'string' ? properties.levelKey : null;
  let keyPrecision = 'canonical';
  if (!puzzleKey && mode === 'daily' && validDay(properties.dateKey)) puzzleKey = `daily:${properties.dateKey}`;
  if (!puzzleKey && mode === 'campaign' && (typeof levelId === 'number' || typeof levelId === 'string')) {
    puzzleKey = properties.levelId !== undefined || properties.world === undefined
      ? `campaign:${levelId}` : `campaign:${properties.world}:${levelId}`;
    keyPrecision = properties.levelId !== undefined ? 'global-level-id' : 'legacy-level-id';
  }
  const canonical = COMPLETE_NAMES.has(name) ? 'complete' : START_NAMES.has(name) ? 'start'
    : PLAY_NAMES.has(name) ? 'play' : OPEN_NAMES.has(name) ? 'open' : name === 'install' ? 'install' : 'other';
  const actionDay = canonical === 'complete' && validDay(properties.actionDay) ? properties.actionDay : null;
  // A replayed milestone has only a recorded calendar day. Its dispatch time
  // must not become the solve time in an exact 72-hour conversion window.
  const lateCalendarCompletion = actionDay && emittedAtMs !== null && actionDay !== productDay(emittedAtMs)
    && timestamp(properties.occurredAtMs) === null;
  const timeMs = lateCalendarCompletion ? null : emittedAtMs;
  return {
    sdkId, name, canonical, timeMs, emittedAtMs, installDay, mode, puzzleKey, keyPrecision,
    day: actionDay ?? (emittedAtMs !== null ? productDay(emittedAtMs) : null),
    eventId: typeof payload.event_id === 'string' ? payload.event_id : null,
    attemptId: typeof properties.attemptId === 'string' ? properties.attemptId : null,
    appVersion: safeLabel(record.app_version_name ?? (envelope ? payload.app_version : null)),
    onboardingVersion: safeLabel(envelope ? payload.onboarding_version : null),
    contentVersion: safeLabel(properties.contentVersion ?? (envelope ? payload.content_version : null)),
  };
}

function fraction(numerator, denominator) {
  return { numerator, denominator, rate: denominator ? numerator / denominator : null };
}

function analyzeRecords(records, options) {
  const asOfMs = timestamp(options?.asOf);
  if (asOfMs === null) throw new Error('Provide --as-of with an explicit UTC/offset timestamp.');
  for (const key of ['cohortFrom', 'cohortTo']) {
    if (options[key] !== undefined && !validDay(options[key])) throw new Error(`${key} must be YYYY-MM-DD.`);
  }
  if (options.cohortFrom && options.cohortTo && options.cohortFrom > options.cohortTo) throw new Error('Cohort range is reversed.');
  const asOfDay = productDay(asOfMs);
  const attemptWindowMs = (options.attemptWindowHours ?? 72) * 60 * 60 * 1000;
  if (!Number.isFinite(attemptWindowMs) || attemptWindowMs <= 0) throw new Error('Attempt window must be positive.');
  const events = [];
  const seen = new Set();
  const quality = { records: records.length, invalidRecords: 0, missingSdkIdentity: 0,
    missingTimestamp: 0, missingPuzzleIdentity: 0, unknownPuzzleMode: 0,
    deliveryDuplicates: 0, futureEventsExcluded: 0, ambiguousLegacyLevelIds: 0 };
  for (const raw of records) {
    let event;
    try { event = normalizeRecord(raw); } catch { quality.invalidRecords++; continue; }
    if (!event.sdkId) { quality.missingSdkIdentity++; continue; }
    if (event.timeMs === null) quality.missingTimestamp++;
    if (event.emittedAtMs !== null && event.emittedAtMs > asOfMs || event.day && event.day > asOfDay) {
      quality.futureEventsExcluded++; continue;
    }
    if (event.eventId) {
      const key = `${event.sdkId}:${event.eventId}`;
      if (seen.has(key)) { quality.deliveryDuplicates++; continue; }
      seen.add(key);
    }
    if (event.keyPrecision === 'legacy-level-id') quality.ambiguousLegacyLevelIds++;
    if (event.canonical === 'start' || event.canonical === 'complete') {
      if (!event.puzzleKey) quality.missingPuzzleIdentity++;
      if (event.mode === 'unknown') quality.unknownPuzzleMode++;
    }
    events.push(event);
  }
  const users = new Map();
  const eventCounts = {};
  const versions = new Map();
  const starts = new Map();
  const attempts = new Map();
  const attemptCompletions = new Map();
  const unknownAttemptCompletionTimes = new Set();
  const completions = new Map();
  for (const event of events) {
    eventCounts[event.name] = (eventCounts[event.name] ?? 0) + 1;
    if (!users.has(event.sdkId)) users.set(event.sdkId, { installs: new Set(), events: [] });
    const user = users.get(event.sdkId);
    if (event.installDay) user.installs.add(event.installDay);
    user.events.push(event);
    const versionKey = JSON.stringify([event.appVersion, event.onboardingVersion, event.contentVersion]);
    if (!versions.has(versionKey)) versions.set(versionKey, { appVersion: event.appVersion,
      onboardingVersion: event.onboardingVersion, contentVersion: event.contentVersion,
      users: new Set(), started: new Set(), completed: new Set() });
    const version = versions.get(versionKey);
    version.users.add(event.sdkId);
    if (event.canonical === 'start') version.started.add(event.sdkId);
    if (event.canonical === 'complete') version.completed.add(event.sdkId);
    const puzzleId = event.puzzleKey ? JSON.stringify([event.sdkId, event.puzzleKey]) : null;
    if (event.canonical === 'start' && puzzleId) {
      const existing = starts.get(puzzleId);
      if (!existing || event.timeMs !== null && (existing.timeMs === null || event.timeMs < existing.timeMs)) starts.set(puzzleId, event);
    }
    if (event.canonical === 'start' && event.name === 'puzzle_started' && event.attemptId && event.timeMs !== null) {
      const key = JSON.stringify([event.sdkId, event.attemptId]);
      if (!attempts.has(key) || event.timeMs < attempts.get(key).timeMs) attempts.set(key, event);
    }
    if (event.canonical === 'complete' && puzzleId) {
      const existing = completions.get(puzzleId);
      if (!existing || event.timeMs !== null && (existing.timeMs === null || event.timeMs < existing.timeMs)) completions.set(puzzleId, event);
    }
    if (event.canonical === 'complete' && event.attemptId && event.timeMs !== null) {
      const key = JSON.stringify([event.sdkId, event.attemptId]);
      if (!attemptCompletions.has(key) || event.timeMs < attemptCompletions.get(key).timeMs) attemptCompletions.set(key, event);
    }
    if (event.canonical === 'complete' && event.attemptId && event.timeMs === null) {
      unknownAttemptCompletionTimes.add(JSON.stringify([event.sdkId, event.attemptId]));
    }
  }
  const startedUsers = new Set(events.filter((e) => e.canonical === 'start').map((e) => e.sdkId));
  const completedUsers = new Set(events.filter((e) => e.canonical === 'complete').map((e) => e.sdkId));
  const orderedWinUsers = new Set();
  let maturedPuzzles = 0;
  let solvedPuzzles = 0;
  let unknownPuzzleCompletionTimes = 0;
  for (const [key, start] of starts) {
    const finish = completions.get(key);
    if (start.timeMs === null || start.timeMs + attemptWindowMs > asOfMs) continue;
    if (finish && finish.timeMs === null) { unknownPuzzleCompletionTimes++; continue; }
    maturedPuzzles++;
    if (finish?.timeMs !== null && finish?.timeMs >= start.timeMs
      && finish.timeMs <= start.timeMs + attemptWindowMs) { solvedPuzzles++; orderedWinUsers.add(start.sdkId); }
  }
  let maturedAttempts = 0;
  let solvedAttempts = 0;
  let excludedAttemptCompletionTimes = 0;
  for (const [key, start] of attempts) {
    if (start.timeMs + attemptWindowMs > asOfMs) continue;
    if (unknownAttemptCompletionTimes.has(key) && !attemptCompletions.has(key)) { excludedAttemptCompletionTimes++; continue; }
    maturedAttempts++;
    const finish = attemptCompletions.get(key);
    if (finish && finish.timeMs >= start.timeMs && finish.timeMs <= start.timeMs + attemptWindowMs) solvedAttempts++;
  }
  const cohortUsers = [...users.values()].filter((user) => user.installs.size === 1
    && (!options.cohortFrom || [...user.installs][0] >= options.cohortFrom)
    && (!options.cohortTo || [...user.installs][0] <= options.cohortTo));
  const retention = [1, 3, 7].map((n) => {
    const mature = cohortUsers.filter((user) => dayNumber([...user.installs][0]) + n < dayNumber(asOfDay));
    const returned = (user, playing) => {
      const installDay = [...user.installs][0];
      return user.events.some((event) => event.day && dayNumber(event.day) - dayNumber(installDay) === n
        && (event.canonical === 'play' || !playing && event.canonical === 'open'));
    };
    return { day: n, open: fraction(mature.filter((u) => returned(u, false)).length, mature.length),
      play: fraction(mature.filter((u) => returned(u, true)).length, mature.length) };
  });
  return {
    asOf: new Date(asOfMs).toISOString(), productTimezone: 'UTC+03:00', attemptWindowHours: attemptWindowMs / 3600000,
    installCohort: { from: options.cohortFrom ?? null, to: options.cohortTo ?? null, users: cohortUsers.length },
    quality: { ...quality, unknownPuzzleCompletionTimes, usersWithUnknownInstall: [...users.values()].filter((u) => !u.installs.size).length,
      usersWithConflictingInstalls: [...users.values()].filter((u) => u.installs.size > 1).length },
    eventCounts, uniqueUsers: users.size,
    completionEvidence: { startedUsers: startedUsers.size, completedUsers: completedUsers.size,
      usersInBoth: [...startedUsers].filter((id) => completedUsers.has(id)).length,
      usersWithOrderedPuzzleWinWithinWindow: orderedWinUsers.size },
    uniquePlayerPuzzleConversion: fraction(solvedPuzzles, maturedPuzzles),
    measuredAttempts: { completion: fraction(solvedAttempts, maturedAttempts), incompleteWithinWindow: maturedAttempts - solvedAttempts,
      unknownCompletionTimes: excludedAttemptCompletionTimes,
      startsWithoutAttemptIdentity: events.filter((e) => e.canonical === 'start' && !e.attemptId).length },
    retention,
    versions: [...versions.values()].map((v) => ({ appVersion: v.appVersion, onboardingVersion: v.onboardingVersion,
      contentVersion: v.contentVersion, users: v.users.size, startedUsers: v.started.size, completedUsers: v.completed.size })),
    limitations: [
      'Install cohorts require SDK installation metadata; first observed custom event is not an install.',
      'D1/D3/D7 require a completely observed product day; the current partial day is excluded.',
      'Legacy starts include resumes. Incomplete within a window is not permanent abandonment.',
      'Legacy level ids without world/global identity can collapse different puzzles; inspect quality counts.',
      'Old completion evidence may occur at reward/Next; historical time to victory cannot be recovered reliably.',
      'Version rows describe event-time versions; the same SDK player may appear in several rows.',
      'Without sessions/installs and legacy gameplay events, open/play retention is an observed lower bound.',
    ],
  };
}

async function main(argv) {
  const options = {};
  const known = { '--input': 'input', '--as-of': 'asOf', '--cohort-from': 'cohortFrom', '--cohort-to': 'cohortTo', '--attempt-window-hours': 'attemptWindowHours' };
  for (let i = 0; i < argv.length; i += 2) {
    if (!known[argv[i]] || !argv[i + 1]) throw new Error('Usage: node scripts/analyze-retention.cjs --input events.jsonl --as-of 2026-10-03T12:00:00+03:00 [--cohort-from YYYY-MM-DD --cohort-to YYYY-MM-DD]');
    options[known[argv[i]]] = argv[i + 1];
  }
  if (!options.input) throw new Error('--input is required.');
  if (options.attemptWindowHours) options.attemptWindowHours = Number(options.attemptWindowHours);
  const rows = [];
  let lineNumber = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(options.input), crlfDelay: Infinity });
  for await (const line of lines) {
    lineNumber++;
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { throw new Error(`Invalid JSON at input line ${lineNumber}.`); }
  }
  process.stdout.write(`${JSON.stringify(analyzeRecords(rows, options), null, 2)}\n`);
}

module.exports = { normalizeRecord, analyzeRecords };
if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
