'use strict';

// Offline draft point 3 only. No network, catalog guessing, credentials, or
// player-level output. SDK identity/time/install semantics come from retention.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeRecord, linkInstallEpisodes } = require('./analyze-retention.cjs');

const DAY = 86400000;
const OUTCOMES = ['invalid', 'grid', 'bonus', 'duplicate', 'blocked', 'constraint'];
const ACCEPTED = new Set(['grid', 'bonus']);
const METADATA = ['puzzleKey', 'analysisMode', 'contentVersion', 'contentFingerprint',
  'levelId', 'difficultyTier', 'difficultyRole', 'mechanic', 'letterCount', 'targetCount'];
const IDENTITY = ['puzzleKey', 'analysisMode', 'contentVersion', 'contentFingerprint'];
const LIMITATIONS = [
  'Observational comparison. Residual changes can reflect player experience/composition, delivery, consent, and policy changes; they do not prove dictionary quality or difficulty caused a change.',
  'Manual input denominator contains only completed word_submit_outcome events with explicit manual classification, known SDK identity, known occurrence time, and a supported outcome. Legacy action/submit/found events are not substitutes.',
  'Exact strata include levelKey, available contentVersion/fingerprint identity, mode, intro/main classification, app version, and installation-based new/returning/unknown classification. A missing stratum rate is null, never zero.',
  'Baseline weights are completed manual input shares, frozen before comparison. Common-coverage weights are renormalized identically in both weeks; conditional estimates do not describe the full population.',
  'High difficulty means difficulty_tier >= 4 among known tiers. Attempt metadata joins only exact SDK player + install episode + attempt. No join to raw catalog fingerprints is attempted.',
  'Completion requires a fresh puzzle_started and puzzle_completed with the same attempt identity. A resumed attempt is not a new start; a restart cannot complete the original attempt. Missing telemetry is not proof of permanent abandonment.',
  'activeTimeMs quantiles use completed attempts with explicit full_attempt coverage only. SDK occurrence/session time is separate and is never substituted for active playing time.',
  'Input gap counts include the accepting input. Unknown ordering/manual outcomes, pause/exit boundaries, product-week edges, and trailing observations censor sequences. Censored sequences are not completed waits.',
  'Help-to-progress is a diagnostic first-help-per-observed-attempt measure within 10 wall-clock minutes, based on target_word_accepted/puzzle_completed. It is not the primary origin-flow UX experiment from draft point 5.',
  'Quantiles are descriptive. Rate-change uncertainty resamples entire SDK players jointly across weeks, conditional on the observed baseline weights; no input-independent binomial intervals are used.',
  'The declared as-of must be the complete export cutoff. Raw events alone cannot prove delivery completeness or recover unobserved consent periods. Empty or unknown coverage is not a measured zero.',
];

function fraction(numerator, denominator) { return { numerator, denominator, rate: denominator ? numerator / denominator : null }; }
function countBy(values, key) {
  const result = {};
  for (const value of values) { const label = key(value); result[label] = (result[label] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function quantile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}
function quantiles(values) { return { observations: values.length, p50: quantile(values, 0.5), p90: quantile(values, 0.9) }; }
function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
function known(value) { return value !== undefined && value !== null && value !== 'unknown'; }
function offsetMinutes(timezone) {
  if (timezone === 'UTC' || timezone === 'Z') return 0;
  const match = /^(?:UTC)?([+-])(\d{2}):(\d{2})$/.exec(timezone ?? '');
  if (!match) throw new Error('--timezone must be an explicit fixed offset, for example UTC+03:00 (IANA/DST zones are unsupported).');
  const hours = Number(match[2]); const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) throw new Error('Invalid timezone offset.');
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}
function validateOptions(options = {}) {
  for (const name of ['baselineStart', 'currentStart']) if (!validDay(options[name])) throw new Error(`${name} must be YYYY-MM-DD.`);
  if (typeof options.asOf !== 'string' || !/(Z|[+-]\d\d:\d\d)$/i.test(options.asOf)
      || !Number.isFinite(Date.parse(options.asOf))) throw new Error('--as-of requires an explicit UTC/offset timestamp.');
  const offset = offsetMinutes(options.timezone);
  const periods = ['baseline', 'current'].map((name) => {
    const from = options[`${name}Start`];
    const startMs = Date.parse(`${from}T00:00:00Z`) - offset * 60000;
    const endMs = startMs + 7 * DAY;
    return { name, from, toExclusive: new Date(endMs + offset * 60000).toISOString().slice(0, 10), startMs, endMs };
  });
  if (periods[0].endMs > periods[1].startMs) throw new Error('Baseline and current full weeks must be ordered and non-overlapping.');
  const asOfMs = Date.parse(options.asOf);
  if (asOfMs < periods[1].endMs) throw new Error('--as-of must cover the complete current seven-day week.');
  if (!['observation', 'synthetic', 'production'].includes(options.source ?? 'observation')) throw new Error('Unsupported --source; use observation, synthetic, or production.');
  const bootstrapReps = options.bootstrapReps ?? 500;
  if (!Number.isSafeInteger(bootstrapReps) || bootstrapReps < 100 || bootstrapReps > 5000) throw new Error('bootstrapReps must be an integer from 100 to 5000.');
  return { ...options, source: options.source ?? 'observation', offset, periods, asOfMs, bootstrapReps };
}
function publicPeriods(options) {
  return { timezone: options.timezone, asOf: new Date(options.asOfMs).toISOString(),
    baseline: { from: options.periods[0].from, toExclusive: options.periods[0].toExclusive, days: 7 },
    current: { from: options.periods[1].from, toExclusive: options.periods[1].toExclusive, days: 7 } };
}
function baseReport(options) {
  return { game_id: 'slova', run_id: 'slova-product-improvements-2026-11-04',
  product_version: options.source === 'synthetic' ? 'Synthetic development fixtures; not a published app version'
    : 'Input event-time app versions only; this offline tool does not verify production rollout',
  geography: 'Not inferred; use the explicit raw-export scope', store: 'RuStore',
  date: new Date(options.asOfMs + options.offset * 60000).toISOString().slice(0, 10),
  evidence: [{ id: options.source === 'synthetic' ? 'P3-SYNTHETIC-DEVELOPMENT' : 'P3-LOCAL-RAW-INPUT',
    source: options.source === 'synthetic' ? 'Synthetic development fixtures (not live player data)' : 'Local raw export explicitly supplied to offline CLI',
    type: 'observation', limitation: 'Provenance and export completeness are not independently verified by the offline tool.' }],
  decisions: ['Keep missing rates null and isolate common support.', 'Freeze baseline input-mix weights and resample SDK players across both weeks.'],
  next_action: 'Inspect coverage gates and source completeness before interpreting observations.',
  reportVersion: 1, scope: 'draft_point3_observation', source: { kind: options.source,
    synthetic: options.source === 'synthetic', productionMetricsVerified: false }, periods: publicPeriods(options),
  interpretation: 'Descriptive/observational; no causal dictionary-worsened claim.', limitations: LIMITATIONS };
}
function buildNeedsRawDataReport(options) {
  const validated = validateOptions(options);
  return { ...baseReport(validated), status: 'needs_raw_data', metrics: null,
    product_version: 'Production lookup observed predominantly 0.1.28; local 0.1.29/schema 3 delivery is unconfirmed',
    evidence: [{ id: 'P3-SLOVA-RAW-EXPORT-UNAVAILABLE', source: '../production-rollout.json', date: '2026-11-04', type: 'observation',
      limitation: 'App 6321823 live lookup/Logs export did not provide raw player events. Existing event/user aggregates cannot reconstruct weekly exact-attempt or fixed-mix estimates.' }],
    decisions: ['Do not infer baseline/current values from aggregate event totals or another game.', 'Keep the point 3 measurement gate closed until a usable Slova raw export is available.'],
    next_action: 'Obtain Slova raw Logs events plus SDK install/session metadata, then rerun the same fixed-offset full-week CLI.',
    coverageGates: [{ name: 'raw_player_events', state: 'missing', detail: 'No usable Slova raw player events supplied. Aggregate event/user totals cannot reconstruct attempt joins or fixed-level-mix rates.' }],
    requiredInput: ['Slova AppMetrica Logs event JSON/JSONL/CSV for both full weeks and through the declared as-of cutoff',
      'SDK install/session metadata and explicit installation classification when available',
      'Occurrence times, SDK device identity, attemptId, levelKey, content identity, manual/outcome and app version',
      'puzzle_started/resumed metadata; completed full_attempt activeTimeMs; target/help events for diagnostic coverage'],
  };
}

function attemptKey(event) { return event.attemptId ? JSON.stringify([event.sdkId, event.installKey ?? event.installIdentity ?? null, event.attemptId]) : null; }
function safeLevelKey(value) {
  return typeof value === 'string' && /^(?:campaign|practice|training|challenge|weekly|event):\d{1,12}$/.test(value)
    || typeof value === 'string' && /^daily:\d{4}-\d{2}-\d{2}$/.test(value) && validDay(value.slice(6)) ? value : null;
}
function joinedIdentity(event, attempt) {
  const meta = attempt?.metadataConflict || attempt?.identityConflict ? {} : attempt?.metadata ?? {};
  const conflicting = IDENTITY.some((field) => known(event[field]) && known(meta[field]) && event[field] !== meta[field]);
  const dimensions = {};
  for (const field of IDENTITY) dimensions[field] = known(event[field]) ? event[field] : conflicting ? null : meta[field] ?? null;
  const explicitLevel = event.levelKeyExplicit || attempt?.explicitLevelKey
    && (!known(event.puzzleKey) || event.puzzleKey === meta.puzzleKey);
  const key = safeLevelKey(dimensions.puzzleKey);
  let group = dimensions.analysisMode === 'campaign' ? !known(dimensions.contentVersion) ? 'campaign_unknown'
    : dimensions.contentVersion.startsWith('intro-') ? 'intro' : 'main_campaign' : dimensions.analysisMode ?? 'unknown';
  if (group === 'unknown') group = 'unknown';
  return { ...dimensions, levelKey: key, explicitLevel: Boolean(explicitLevel), gameGroup: group,
    levelId: Number.isFinite(event.levelId) ? event.levelId : meta.levelId ?? (key?.startsWith('campaign:') ? Number(key.slice(9)) : null),
    metadata: conflicting ? {} : meta, metadataConflict: Boolean(conflicting || attempt?.metadataConflict || attempt?.identityConflict),
    exact: Boolean(key && explicitLevel && known(dimensions.analysisMode) && dimensions.analysisMode !== 'other' && known(event.analysisAppVersion)
      && (known(dimensions.contentVersion) || known(dimensions.contentFingerprint))
      && !conflicting && !attempt?.metadataConflict && !attempt?.identityConflict) };
}
function indexAttempts(events, quality) {
  const attempts = new Map();
  for (const event of events) {
    const key = attemptKey(event);
    if (!key) continue;
    if (!attempts.has(key)) attempts.set(key, { sdkId: event.sdkId, key, events: [], sources: [] });
    const attempt = attempts.get(key);
    attempt.events.push(event);
    if (['puzzle_started', 'puzzle_resumed'].includes(event.name)) attempt.sources.push(event);
  }
  for (const attempt of attempts.values()) {
    attempt.events.sort((a, b) => (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity) || a.inputIndex - b.inputIndex);
    attempt.metadata = {};
    attempt.metadataConflict = false;
    for (const field of METADATA) {
      const values = [...new Set(attempt.sources.map((source) => source[field]).filter(known))];
      attempt.metadata[field] = values.length === 1 ? values[0] : null;
      if (IDENTITY.includes(field) && values.length > 1) attempt.metadataConflict = true;
    }
    attempt.explicitLevelKey = attempt.sources.some((source) => source.levelKeyExplicit);
    if (attempt.metadataConflict) quality.attemptMetadataConflicts++;
    // Partial records can only be joined when every mutually supplied identity
    // field agrees, including attempts lacking any start/resume event.
    attempt.identityConflict = IDENTITY.some((field) => new Set(attempt.events.map((event) => event[field]).filter(known)).size > 1);
    if (attempt.identityConflict) quality.attemptIdentityConflicts++;
    attempt.start = attempt.events.find((event) => event.name === 'puzzle_started' && event.timeMs !== null) ?? null;
    attempt.completion = attempt.events.find((event) => event.name === 'puzzle_completed' && event.timeMs !== null) ?? null;
    attempt.unknownCompletionTime = attempt.events.some((event) => event.name === 'puzzle_completed' && event.timeMs === null);
    attempt.completionIdentityConflict = attempt.identityConflict
      && attempt.events.some((event) => ['puzzle_completed', 'target_word_accepted', 'help_used'].includes(event.name));
    if (attempt.completionIdentityConflict) quality.attemptOutcomeIdentityConflicts++;
  }
  return attempts;
}
function playerStratum(event, period, episodes, options) {
  const episode = episodes.get(JSON.stringify([event.sdkId, event.installKey]));
  if (!episode || episode.conflict || episode.kind === 'unknown') return 'unknown';
  if (episode.kind === 'reinstall' || episode.kind === 'reactivation') return 'returning';
  if (episode.installMs !== null) return episode.installMs < period.startMs ? 'returning'
    : episode.installMs < period.endMs ? 'new' : 'unknown';
  // install_day's existing retention contract is UTC+3, not machine local.
  if (options.offset === 180 && episode.installDay) return episode.installDay < period.from ? 'returning'
    : episode.installDay < period.toExclusive ? 'new' : 'unknown';
  return 'unknown';
}
function stratumIdentity(dimensions, event, playerClass) {
  if (!dimensions.exact) return null;
  return JSON.stringify([dimensions.levelKey, dimensions.contentVersion ?? 'unknown', dimensions.contentFingerprint ?? 'unknown',
    dimensions.analysisMode, dimensions.gameGroup, event.analysisAppVersion, playerClass, event.policyRevision]);
}
function publicStratum(key) {
  const [levelKey, contentVersion, fingerprint, mode, gameGroup, appVersion, playerClass, policyRevision] = JSON.parse(key);
  return { levelKey, contentVersion, contentReference: `content_${createHash('sha256').update(JSON.stringify([contentVersion, fingerprint])).digest('hex').slice(0, 20)}`,
    fingerprintKnown: known(fingerprint), mode, gameGroup, appVersion, playerClass, policyRevision };
}
function rateCounts(inputs) {
  const outcomes = Object.fromEntries(OUTCOMES.map((name) => [name, 0]));
  for (const input of inputs) outcomes[input.wordOutcome]++;
  return { completedManualInputs: inputs.length, outcomes,
    invalid: fraction(outcomes.invalid, inputs.length), accepted: fraction(outcomes.grid + outcomes.bonus, inputs.length),
    nonAccepted: fraction(outcomes.invalid + outcomes.duplicate + outcomes.blocked + outcomes.constraint, inputs.length) };
}
function perUnitShares(inputs, keyOf) {
  const groups = new Map();
  for (const input of inputs) {
    const key = keyOf(input); if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(input);
  }
  const rates = [...groups.values()].map(rateCounts);
  return { units: rates.length, coveredInputs: rates.reduce((sum, row) => sum + row.completedManualInputs, 0),
    medianInvalidShare: quantile(rates.map((row) => row.invalid.rate), 0.5),
    medianNonAcceptedShare: quantile(rates.map((row) => row.nonAccepted.rate), 0.5) };
}
function levelBand(level) {
  if (!Number.isFinite(level)) return 'unknown';
  if (level <= 5) return '001-005'; if (level <= 10) return '006-010';
  if (level <= 25) return '011-025'; if (level <= 50) return '026-050';
  if (level <= 100) return '051-100'; if (level <= 250) return '101-250';
  if (level <= 500) return '251-500'; return '501-plus';
}
function attemptDistribution(attemptRows) {
  const groups = new Map();
  for (const row of attemptRows) {
    const key = JSON.stringify([row.dimensions.gameGroup, row.dimensions.analysisMode]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => {
    const [gameGroup, mode] = JSON.parse(key);
    const levels = rows.map((row) => row.dimensions.levelId).filter((level) => Number.isFinite(level));
    const knownDifficulty = rows.map((row) => row.dimensions.metadata.difficultyTier).filter(known);
    return { gameGroup, mode, attempts: rows.length,
      knownLevel: fraction(levels.length, rows.length), medianLevel: quantile(levels, 0.5), p75Level: quantile(levels, 0.75),
      progressBands: countBy(rows, (row) => levelBand(row.dimensions.levelId)),
      levels: countBy(rows, (row) => row.dimensions.levelKey ?? 'unknown'),
      difficulty: { knownCoverage: fraction(knownDifficulty.length, rows.length), highAmongKnown: fraction(knownDifficulty.filter((tier) => tier >= 4).length, knownDifficulty.length),
        tierCounts: countBy(rows, (row) => String(row.dimensions.metadata.difficultyTier ?? 'unknown')) },
      mechanics: countBy(rows, (row) => row.dimensions.metadata.mechanic ?? 'unknown'),
      difficultyRoles: countBy(rows, (row) => row.dimensions.metadata.difficultyRole ?? 'unknown'),
      letterCounts: countBy(rows, (row) => String(row.dimensions.metadata.letterCount ?? 'unknown')),
      targetCounts: countBy(rows, (row) => String(row.dimensions.metadata.targetCount ?? 'unknown')),
    };
  });
}

function inputGaps(period, attempts) {
  const completed = []; const rightTails = []; const leftRuns = []; const reasons = {};
  let orderingUnknownAttempts = 0;
  for (const attempt of attempts.values()) {
    const events = attempt.events.filter((event) => event.timeMs !== null && event.timeMs >= period.startMs && event.timeMs < period.endMs);
    const words = events.filter((event) => event.name === 'word_submit_outcome');
    if (!words.length) continue;
    if (attempt.events.some((event) => event.name === 'word_submit_outcome' && event.timeMs === null)
        || new Set(words.map((word) => word.timeMs)).size < words.length) { orderingUnknownAttempts++; continue; }
    let count = 0; let anchored = false;
    const censor = (reason) => {
      if (count) {
        (anchored ? rightTails : leftRuns).push(count);
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      count = 0; anchored = false;
    };
    for (const event of events) {
      if (event.name === 'puzzle_started') { censor('new_start_boundary'); anchored = true; }
      else if (['puzzle_paused', 'puzzle_exited'].includes(event.name)) censor(event.name);
      else if (event.name === 'word_submit_outcome') {
        if (event.manualState === 'auto') continue;
        if (event.manualState !== 'manual' || !event.wordOutcome) { censor('unknown_input'); continue; }
        count++;
        if (ACCEPTED.has(event.wordOutcome)) {
          (anchored ? completed : leftRuns).push(count);
          count = 0; anchored = true;
        }
      }
    }
    censor('week_or_export_end');
  }
  return { unit: 'completed_manual_inputs_including_next_accepted_input', completed: quantiles(completed),
    rightCensored: { sequences: rightTails.length, observedInputs: rightTails.reduce((sum, n) => sum + n, 0), counts: countBy(rightTails, String) },
    leftCensored: { sequences: leftRuns.length, observedInputs: leftRuns.reduce((sum, n) => sum + n, 0) },
    censorReasons: reasons, orderingUnknownAttempts };
}

function attemptOutcomes(period, attempts, episodes, options) {
  const completion = { matured: 0, completedWithin24h: 0, immature: 0, censoredByInstallBoundary: 0,
    unknownCompletionTime: 0, unknownStartTime: 0, resumedWithoutObservedStart: 0, conflictingIdentity: 0, missingPuzzleIdentity: 0 };
  const active = { completed: 0, fullCoverage: [], partialCoverage: 0, unknownCoverage: 0, missingActiveTime: 0,
    identityConflictExcluded: 0, missingPuzzleIdentity: 0, unknownOccurrenceTime: 0 };
  const help = { eligibleAttempts: 0, progressed: 0, targetAccepted: 0, completed: 0, immature: 0,
    censoredByInstallBoundary: 0, unknownCompletionTime: 0, previouslyCompletedExcluded: 0, conflictingIdentity: 0, missingPuzzleIdentity: 0 };
  for (const attempt of attempts.values()) {
    const inWeek = attempt.events.filter((event) => event.timeMs !== null && event.timeMs >= period.startMs && event.timeMs < period.endMs);
    const dispatchedInWeek = attempt.events.filter((event) => event.emittedAtMs !== null && event.emittedAtMs >= period.startMs && event.emittedAtMs < period.endMs);
    if (!inWeek.length && !dispatchedInWeek.length) continue;
    const sample = inWeek[0] ?? dispatchedInWeek[0];
    const episode = episodes.get(JSON.stringify([sample.sdkId, sample.installKey]));
    const endMs = Math.min(options.asOfMs, episode?.endMs ?? Infinity);
    if (!attempt.start) {
      if (attempt.events.some((event) => event.name === 'puzzle_started' && event.timeMs === null
        && event.emittedAtMs !== null && event.emittedAtMs >= period.startMs && event.emittedAtMs < period.endMs)) completion.unknownStartTime++;
      else if (inWeek.some((event) => event.name === 'puzzle_resumed')) completion.resumedWithoutObservedStart++;
    } else if (attempt.start.timeMs >= period.startMs && attempt.start.timeMs < period.endMs) {
      const deadline = attempt.start.timeMs + DAY;
      if (attempt.metadataConflict || attempt.identityConflict) completion.conflictingIdentity++;
      else if (!joinedIdentity(attempt.start, attempt).exact) completion.missingPuzzleIdentity++;
      else if (deadline > options.asOfMs) completion.immature++;
      else if (deadline > endMs) completion.censoredByInstallBoundary++;
      else {
        const finish = attempt.completion;
        if (attempt.unknownCompletionTime && !finish) completion.unknownCompletionTime++;
        else {
          completion.matured++;
          if (finish && finish.timeMs >= attempt.start.timeMs && finish.timeMs <= deadline) completion.completedWithin24h++;
        }
      }
    }
    const finish = attempt.completion;
    active.unknownOccurrenceTime += attempt.events.filter((event) => event.name === 'puzzle_completed' && event.timeMs === null
      && event.emittedAtMs !== null && event.emittedAtMs >= period.startMs && event.emittedAtMs < period.endMs).length;
    if (finish && finish.timeMs >= period.startMs && finish.timeMs < period.endMs) {
      if (attempt.metadataConflict || attempt.completionIdentityConflict) active.identityConflictExcluded++;
      else if (!joinedIdentity(finish, attempt).exact) active.missingPuzzleIdentity++;
      else {
        active.completed++;
        if (finish.timeCoverage === 'full_attempt' && finish.activeTimeMs !== null) active.fullCoverage.push(finish.activeTimeMs);
        else if (finish.timeCoverage === 'since_restore' || finish.timeCoverage === 'mixed_consent') active.partialCoverage++;
        else active.unknownCoverage++;
        if (finish.activeTimeMs === null) active.missingActiveTime++;
      }
    }
    const firstHelp = inWeek.find((event) => event.name === 'help_used');
    if (!firstHelp) continue;
    if (attempt.metadataConflict || attempt.completionIdentityConflict) { help.conflictingIdentity++; continue; }
    if (!joinedIdentity(firstHelp, attempt).exact) { help.missingPuzzleIdentity++; continue; }
    const deadline = firstHelp.timeMs + 10 * 60000;
    if (finish && finish.timeMs < firstHelp.timeMs) { help.previouslyCompletedExcluded++; continue; }
    if (deadline > options.asOfMs) { help.immature++; continue; }
    if (deadline > endMs) { help.censoredByInstallBoundary++; continue; }
    if (attempt.unknownCompletionTime && !finish) { help.unknownCompletionTime++; continue; }
    help.eligibleAttempts++;
    const target = attempt.events.some((event) => event.name === 'target_word_accepted' && event.timeMs !== null
      && event.timeMs > firstHelp.timeMs && event.timeMs <= deadline);
    const completed = Boolean(finish && finish.timeMs >= firstHelp.timeMs && finish.timeMs <= deadline);
    if (target) help.targetAccepted++;
    if (completed) help.completed++;
    if (target || completed) help.progressed++;
  }
  return { completion24h: { ...completion, rate: fraction(completion.completedWithin24h, completion.matured),
    unit: 'fresh_exact_player_install_attempt_started_in_week', windowHours: 24 },
  completedActiveTimeMs: { ...active, fullCoverage: quantiles(active.fullCoverage), unit: 'activeTimeMs_on_completed_full_attempt_coverage_only' },
  helpToProgress10m: { ...help, rate: fraction(help.progressed, help.eligibleAttempts),
    unit: 'first_help_used_per_exact_attempt_observed_in_week', diagnostic: true } };
}

function weekSummary(period, events, attempts, episodes, options) {
  const observed = events.filter((event) => event.timeMs !== null && event.timeMs >= period.startMs && event.timeMs < period.endMs);
  const words = observed.filter((event) => event.name === 'word_submit_outcome');
  const inputs = words.filter((event) => event.manualState === 'manual' && event.wordOutcome).map((event) => {
    const key = attemptKey(event); const dimensions = joinedIdentity(event, attempts.get(key));
    const playerClass = playerStratum(event, period, episodes, options);
    return { ...event, attemptKey: key, dimensions, playerClass, stratum: stratumIdentity(dimensions, event, playerClass) };
  });
  const attemptRows = [];
  for (const attempt of attempts.values()) {
    const representative = attempt.events.find((event) => event.timeMs !== null && event.timeMs >= period.startMs && event.timeMs < period.endMs);
    if (representative) attemptRows.push({ attempt, dimensions: joinedIdentity(representative, attempt) });
  }
  const rowsByStratum = new Map();
  for (const input of inputs) {
    if (!input.stratum) continue;
    if (!rowsByStratum.has(input.stratum)) rowsByStratum.set(input.stratum, []);
    rowsByStratum.get(input.stratum).push(input);
  }
  const reasons = {};
  for (const outcome of ['invalid', 'blocked', 'constraint']) {
    const subset = inputs.filter((input) => input.wordOutcome === outcome);
    reasons[outcome] = { inputs: subset.length, counts: countBy(subset, (input) => input.wordReason ?? 'missing'),
      knownCoverage: fraction(subset.filter((input) => known(input.wordReason)).length, subset.length) };
  }
  return { period, inputs, rowsByStratum, summary: {
    week: period.name, from: period.from, toExclusive: period.toExclusive,
    observedEvents: observed.length, observedPlayers: new Set(observed.map((event) => event.sdkId)).size,
    manualInputs: { ...rateCounts(inputs), invalidByReason: reasons.invalid, reasonsByOutcome: reasons,
      coverage: { outcomeEvents: words.length, explicitManual: words.filter((event) => event.manualState === 'manual').length,
        autoExcluded: words.filter((event) => event.manualState === 'auto').length,
        unknownOrConflictingManual: words.filter((event) => ['unknown', 'conflict'].includes(event.manualState)).length,
        unsupportedOutcome: words.filter((event) => !event.wordOutcome).length,
        exactStrata: fraction(inputs.filter((input) => input.stratum).length, inputs.length),
        attemptIdentity: fraction(inputs.filter((input) => input.attemptKey).length, inputs.length),
        conflictingAttemptIdentity: inputs.filter((input) => input.dimensions.metadataConflict).length,
        unsupportedMode: inputs.filter((input) => input.dimensions.analysisMode === 'other').length,
        unknownMode: inputs.filter((input) => !known(input.dimensions.analysisMode)).length,
        playerClassification: countBy(inputs, (input) => input.playerClass),
        appVersions: countBy(inputs, (input) => input.analysisAppVersion),
        sdkReportedAppVersions: countBy(inputs, (input) => input.sdkAppVersion),
        appVersionProvenance: countBy(inputs, (input) => input.versionProvenance),
        originSdkVersionMismatches: fraction(inputs.filter((input) => input.appVersionMismatch).length,
          inputs.filter((input) => known(input.originAppVersion) && known(input.sdkAppVersion)).length),
        missingDeliveryIdentity: inputs.filter((input) => !input.eventId).length },
      perPlayer: perUnitShares(inputs, (input) => input.sdkId), perAttempt: perUnitShares(inputs, (input) => input.attemptKey) },
    attempts: { unit: 'unique_exact_player_install_attempt_observed_in_week', observed: attemptRows.length,
      startedInWeek: attemptRows.filter((row) => row.attempt.start && row.attempt.start.timeMs >= period.startMs && row.attempt.start.timeMs < period.endMs).length,
      resumedOnlyWithoutObservedStart: attemptRows.filter((row) => !row.attempt.start && row.attempt.sources.some((event) => event.name === 'puzzle_resumed')).length,
      metadataMissing: attemptRows.filter((row) => !row.attempt.sources.length).length,
      byModeAndProgress: attemptDistribution(attemptRows) },
    inputsUntilNextAccepted: inputGaps(period, attempts),
    ...attemptOutcomes(period, attempts, episodes, options),
    helpCoverage: { missingAttemptIdentity: observed.filter((event) => event.name === 'help_used' && !event.attemptId).length,
      linkedHelpEvents: observed.filter((event) => event.name === 'help_used' && event.attemptId).length },
  } };
}

function comparisonSummary(weeks, options) {
  const [baseline, current] = weeks;
  const keys = [...new Set(weeks.flatMap((week) => [...week.rowsByStratum.keys()]))].sort();
  const eligibleTotals = weeks.map((week) => [...week.rowsByStratum.values()].reduce((sum, rows) => sum + rows.length, 0));
  const common = keys.filter((key) => baseline.rowsByStratum.has(key) && current.rowsByStratum.has(key));
  const commonTotals = weeks.map((week) => common.reduce((sum, key) => sum + week.rowsByStratum.get(key).length, 0));
  const weights = new Map(common.map((key) => [key, baseline.rowsByStratum.get(key).length / commonTotals[0]]));
  const rate = (inputs, outcome) => inputs.length ? inputs.filter((input) => outcome === 'accepted' ? ACCEPTED.has(input.wordOutcome) : input.wordOutcome === outcome).length / inputs.length : null;
  const weighted = (week, outcome) => common.length ? common.reduce((sum, key) => sum + weights.get(key) * rate(week.rowsByStratum.get(key), outcome), 0) : null;
  const commonRate = (week, outcome) => rate(common.flatMap((key) => week.rowsByStratum.get(key)), outcome);
  const metrics = {};
  for (const outcome of ['invalid', 'accepted']) {
    const raw = weeks.map((week) => rate(week.inputs, outcome));
    const fixed = weeks.map((week) => weighted(week, outcome));
    const observedCommon = weeks.map((week) => commonRate(week, outcome));
    const change = (values) => values.every((value) => value !== null) ? values[1] - values[0] : null;
    const rawChange = change(raw); const withinChange = change(fixed); const commonChange = change(observedCommon);
    metrics[outcome] = { raw: { baseline: raw[0], current: raw[1], change: rawChange },
      commonConditionalFixedMix: { baseline: fixed[0], current: fixed[1], change: withinChange },
      decomposition: { rawChange, commonRawChange: commonChange, commonWithinChange: withinChange,
        commonMixChange: commonChange !== null ? commonChange - withinChange : null,
        outsideCommonResidual: rawChange !== null && commonChange !== null ? rawChange - commonChange : null,
        outsideCommonAttribution: 'unknown; residual is an arithmetic difference between full raw and conditional common changes, not an identified population or causal effect' } };
  }
  const baseLevels = new Set([...baseline.rowsByStratum.keys()].map((key) => publicStratum(key).levelKey));
  const newLevels = [...new Set([...current.rowsByStratum.keys()].map((key) => publicStratum(key).levelKey))].filter((level) => !baseLevels.has(level)).sort();
  const report = { estimand: 'completed_manual_input_rate',
    strataDefinition: ['exact_levelKey', 'available_contentVersion_and_content_fingerprint', 'mode', 'intro_main_other_group', 'origin_event_app_version_or_sdk_fallback', 'week_install_based_player_class', 'policy_revision_or_unknown'],
    weights: { frozenFrom: baseline.period.from, unit: 'completed_manual_inputs_in_exact_baseline_strata',
      baselineInputs: eligibleTotals[0], currentInputs: eligibleTotals[1], commonStrata: common.length,
      commonCoverage: { baseline: fraction(commonTotals[0], eligibleTotals[0]), current: fraction(commonTotals[1], eligibleTotals[1]) },
      baselineExcludedWeight: eligibleTotals[0] ? 1 - commonTotals[0] / eligibleTotals[0] : null,
      currentUnmatchedInputs: eligibleTotals[1] - commonTotals[1],
      newUnmatchedStrata: keys.filter((key) => !baseline.rowsByStratum.has(key)).length,
      baselineStrataWithoutCurrent: keys.filter((key) => !current.rowsByStratum.has(key)).length,
      newUnmatchedLevels: newLevels,
      commonWeights: 'Observed baseline weights renormalized to common strata; identical weights in both weeks. Missing observations are not zero rates.',
      excludesFromWeightDenominator: 'Manual outcomes without exact level/content/mode identity; raw rates and exact-strata coverage remain separate.' },
    metrics,
    strata: keys.map((key) => ({ ...publicStratum(key), common: common.includes(key),
      baselineWeight: baseline.rowsByStratum.has(key) ? baseline.rowsByStratum.get(key).length / eligibleTotals[0] : null,
      commonConditionalWeight: weights.get(key) ?? null,
      baseline: baseline.rowsByStratum.has(key) ? rateCounts(baseline.rowsByStratum.get(key)) : null,
      current: current.rowsByStratum.has(key) ? rateCounts(current.rowsByStratum.get(key)) : null })),
  };
  report.uncertainty = clusterUncertainty(weeks, common, weights, options);
  return report;
}

/** Paired player bootstrap: one multiplier follows the SDK player across both
 * weeks, every attempt, and every input. Baseline weights stay fixed. */
function clusterUncertainty(weeks, common, weights, options) {
  const minimumClusters = 20;
  const playerSets = weeks.map((week) => new Set(week.inputs.map((input) => input.sdkId)));
  const players = [...new Set(weeks.flatMap((week) => [...new Set(week.inputs.map((input) => input.sdkId))]))].sort();
  const index = new Map(players.map((player, i) => [player, i]));
  const aggregates = players.map(() => [new Map(), new Map()]);
  for (let week = 0; week < 2; week++) {
    for (const input of weeks[week].inputs) {
      const map = aggregates[index.get(input.sdkId)][week];
      const key = input.stratum;
      if (!map.has(key)) map.set(key, { n: 0, invalid: 0, accepted: 0 });
      const row = map.get(key); row.n++;
      if (input.wordOutcome === 'invalid') row.invalid++;
      if (ACCEPTED.has(input.wordOutcome)) row.accepted++;
    }
  }
  const labels = ['invalid', 'accepted'].flatMap((outcome) => ['rawBaseline', 'rawCurrent', 'rawChange', 'fixedBaseline', 'fixedCurrent', 'fixedChange', 'commonMixChange'].map((kind) => `${outcome}:${kind}`));
  const samples = new Map(labels.map((label) => [label, []]));
  const commonSets = weeks.map((week) => new Set(common.flatMap((key) => week.rowsByStratum.get(key).map((input) => input.sdkId))));
  const rawEnough = playerSets.every((set) => set.size >= minimumClusters);
  const fixedEnough = common.length > 0 && commonSets.every((set) => set.size >= minimumClusters);
  let seed = 0x51a0a202;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  if (rawEnough) for (let iteration = 0; iteration < options.bootstrapReps; iteration++) {
    const multiplicities = new Uint32Array(players.length);
    for (let draw = 0; draw < players.length; draw++) multiplicities[Math.floor(random() * players.length)]++;
    const totals = [new Map(), new Map()];
    for (let i = 0; i < players.length; i++) {
      if (!multiplicities[i]) continue;
      for (let week = 0; week < 2; week++) for (const [key, row] of aggregates[i][week]) {
        if (!totals[week].has(key)) totals[week].set(key, { n: 0, invalid: 0, accepted: 0 });
        const sum = totals[week].get(key);
        for (const field of ['n', 'invalid', 'accepted']) sum[field] += row[field] * multiplicities[i];
      }
    }
    for (const outcome of ['invalid', 'accepted']) {
      const raw = totals.map((map) => { const rows = [...map.values()]; const n = rows.reduce((sum, row) => sum + row.n, 0); return n ? rows.reduce((sum, row) => sum + row[outcome], 0) / n : null; });
      const fixed = totals.map((map) => fixedEnough && common.every((key) => map.has(key))
        ? common.reduce((sum, key) => sum + weights.get(key) * map.get(key)[outcome] / map.get(key).n, 0) : null);
      const commonRaw = totals.map((map) => { const rows = common.map((key) => map.get(key)).filter(Boolean); const n = rows.reduce((sum, row) => sum + row.n, 0); return n ? rows.reduce((sum, row) => sum + row[outcome], 0) / n : null; });
      const values = { rawBaseline: raw[0], rawCurrent: raw[1], rawChange: raw.every(known) ? raw[1] - raw[0] : null,
        fixedBaseline: fixed[0], fixedCurrent: fixed[1], fixedChange: fixed.every(known) ? fixed[1] - fixed[0] : null,
        commonMixChange: fixed.every(known) && commonRaw.every(known) ? commonRaw[1] - commonRaw[0] - fixed[1] + fixed[0] : null };
      for (const [kind, value] of Object.entries(values)) if (value !== null) samples.get(`${outcome}:${kind}`).push(value);
    }
  }
  const intervals = {};
  for (const outcome of ['invalid', 'accepted']) {
    intervals[outcome] = {};
    for (const kind of ['rawBaseline', 'rawCurrent', 'rawChange', 'fixedBaseline', 'fixedCurrent', 'fixedChange', 'commonMixChange']) {
      const values = samples.get(`${outcome}:${kind}`);
      intervals[outcome][kind] = { ci95: values.length >= options.bootstrapReps * 0.8 ? [quantile(values, 0.025), quantile(values, 0.975)] : null,
        validReplicates: values.length, reason: !rawEnough ? 'fewer_than_20_player_clusters_in_a_week'
          : kind.startsWith('fixed') || kind === 'commonMixChange' ? !fixedEnough ? 'fewer_than_20_common_player_clusters_in_a_week'
            : values.length < options.bootstrapReps * 0.8 ? 'insufficient_bootstrap_common_support' : null : null };
    }
  }
  return { method: 'deterministic_paired_sdk_player_cluster_percentile_bootstrap', minimumClusters,
    confidenceLevel: 0.95, requestedReplicates: options.bootstrapReps, seed: '0x51a0a202',
    clusters: { baseline: playerSets[0].size, current: playerSets[1].size, union: players.length,
      observedInBothWeeks: [...playerSets[0]].filter((player) => playerSets[1].has(player)).length,
      commonBaseline: commonSets[0].size, commonCurrent: commonSets[1].size },
    baselineWeights: 'conditioned_on_observed_frozen_baseline_weights_not_reestimated_in_bootstrap',
    intervals };
}

function analyzeProductImprovements(records, options) {
  const validated = validateOptions(options);
  if (!Array.isArray(records)) throw new Error('Input must be an array of raw event objects.');
  if (!records.length) return buildNeedsRawDataReport(validated);
  const quality = { records: records.length, invalidRecords: 0, excludedTestRecords: 0, unknownEnvironmentRecords: 0,
    missingSdkIdentity: 0, missingSdkIdentityWordOutcomes: 0, missingOccurrenceTime: 0, missingOccurrenceTimeWordOutcomes: 0,
    unknownTimeHelpEvents: 0, deliveryDuplicates: 0, semanticSubmissionDuplicates: 0, conflictingSubmissionDeliveries: 0,
    futureEventsExcluded: 0, originSdkAppVersionMismatches: 0, invalidOriginAppVersions: 0,
    attemptMetadataConflicts: 0, attemptIdentityConflicts: 0, attemptOutcomeIdentityConflicts: 0, conflictingInstallEpisodes: 0, unknownInstallClassification: 0,
    eventsWithAmbiguousInstall: 0, eventsWithoutInstallEpisode: 0, ambiguousInstallEventsExcluded: 0 };
  const events = []; const seen = new Set();
  for (let inputIndex = 0; inputIndex < records.length; inputIndex++) {
    let event;
    try { event = normalizeRecord(records[inputIndex]); } catch { quality.invalidRecords++; continue; }
    if (event.isTest || ['test', 'development', 'debug', 'preview', 'qa'].includes(event.environment)) { quality.excludedTestRecords++; continue; }
    if (event.environment === null || event.environment === 'unknown') quality.unknownEnvironmentRecords++;
    if (event.appVersionMismatch) quality.originSdkAppVersionMismatches++;
    if (event.versionProvenance === 'invalid_origin') quality.invalidOriginAppVersions++;
    if (!event.sdkId) { quality.missingSdkIdentity++; if (event.name === 'word_submit_outcome') quality.missingSdkIdentityWordOutcomes++; continue; }
    if (event.emittedAtMs !== null && event.emittedAtMs > validated.asOfMs) { quality.futureEventsExcluded++; continue; }
    if (event.eventId) {
      const deliveryKey = JSON.stringify([event.sdkId, event.eventId]);
      if (seen.has(deliveryKey)) { quality.deliveryDuplicates++; continue; }
      seen.add(deliveryKey);
    }
    if (event.timeMs === null) {
      quality.missingOccurrenceTime++;
      if (event.name === 'word_submit_outcome') quality.missingOccurrenceTimeWordOutcomes++;
      if (event.name === 'help_used') quality.unknownTimeHelpEvents++;
    }
    events.push({ ...event, inputIndex });
  }
  const installEpisodes = linkInstallEpisodes(events, quality);
  const episodes = new Map(installEpisodes.map((episode) => [JSON.stringify([episode.sdkId, episode.key]), episode]));
  const trustworthy = events.filter((event) => { if (event.installAmbiguous) { quality.ambiguousInstallEventsExcluded++; return false; } return true; });
  const submissions = new Map(); const conflicted = new Set(); const deduplicated = [];
  for (const event of trustworthy) {
    const key = event.name === 'word_submit_outcome' && event.submissionId && event.attemptId
      ? JSON.stringify([attemptKey(event), event.submissionId]) : null;
    if (key && submissions.has(key)) {
      const previous = submissions.get(key);
      if (previous.wordOutcome !== event.wordOutcome || previous.manualState !== event.manualState) { conflicted.add(key); quality.conflictingSubmissionDeliveries++; }
      else quality.semanticSubmissionDuplicates++;
      continue;
    }
    if (key) submissions.set(key, event);
    deduplicated.push({ ...event, submissionKey: key });
  }
  // Conflicting copies cannot choose an arbitrary outcome. They become an
  // unknown-input boundary for sequence coverage, outside the rate denominator.
  for (const event of deduplicated) if (conflicted.has(event.submissionKey)) event.wordOutcome = null;
  const attempts = indexAttempts(deduplicated, quality);
  const weeks = validated.periods.map((period) => weekSummary(period, deduplicated, attempts, episodes, validated));
  const comparison = comparisonSummary(weeks, validated);
  const manualCount = weeks.reduce((sum, week) => sum + week.inputs.length, 0);
  const exactCount = weeks.reduce((sum, week) => sum + week.summary.manualInputs.coverage.exactStrata.numerator, 0);
  const difficultyCount = weeks.reduce((sum, week) => sum + week.summary.attempts.byModeAndProgress.reduce((n, row) => n + row.difficulty.knownCoverage.numerator, 0), 0);
  const attemptCount = weeks.reduce((sum, week) => sum + week.summary.attempts.observed, 0);
  const gate = (name, numerator, denominator) => ({ name, state: !denominator || !numerator ? 'missing' : numerator === denominator ? 'available' : 'partial', coverage: fraction(numerator, denominator) });
  const coverageGates = [gate('completed_manual_outcomes', manualCount, weeks.reduce((sum, week) => sum + week.summary.manualInputs.coverage.outcomeEvents - week.summary.manualInputs.coverage.autoExcluded, 0)),
    gate('exact_level_content_mode_strata', exactCount, manualCount), gate('difficulty_metadata_on_active_attempts', difficultyCount, attemptCount),
    gate('baseline_common_support', comparison.weights.commonCoverage.baseline.numerator, comparison.weights.commonCoverage.baseline.denominator),
    gate('current_common_support', comparison.weights.commonCoverage.current.numerator, comparison.weights.commonCoverage.current.denominator),
    gate('installation_player_classification', weeks.flatMap((week) => week.inputs).filter((input) => input.playerClass !== 'unknown').length, manualCount)];
  return { ...baseReport(validated), status: !manualCount ? 'needs_raw_data' : coverageGates.some((item) => item.state !== 'available') ? 'observed_with_coverage_gaps' : 'observed',
    quality, coverageGates, weeks: weeks.map((week) => week.summary), comparison,
    requiredFollowup: !manualCount ? 'No eligible completed manual outcomes in the two weeks. Obtain usable raw Slova logs; aggregate totals or another game cannot substitute.' : null };
}

function parseCsv(source) {
  const rows = []; let row = []; let cell = ''; let quoted = false; let closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (row.some((value) => value.length)) rows.push(row); row = []; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell.length || closed) throw new Error('Invalid CSV quoting.');
      quoted = true;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else { if (closed) throw new Error('Unexpected characters after a CSV quote.'); cell += char; }
  }
  if (quoted) throw new Error('Unterminated CSV quoted field.');
  if (cell.length || row.length || closed) pushRow();
  if (!rows.length) return [];
  const header = rows.shift();
  if (header.some((value) => !/^[a-z][a-z0-9_]*$/.test(value)) || new Set(header).size !== header.length) throw new Error('CSV requires unique snake_case column headers.');
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`CSV column count mismatch at record ${index + 2}.`);
    const record = Object.fromEntries(header.map((name, i) => [name, values[i] === '' ? undefined : values[i]]));
    if (['true', 'false'].includes(record.is_reinstallation)) record.is_reinstallation = record.is_reinstallation === 'true';
    return record;
  });
}
function jsonRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['data', 'events', 'rows']) if (Array.isArray(value[key])) return value[key];
    if (value.event_name || value.name || value.record_type) return [value];
  }
  throw new Error('JSON must contain an event array, {data/events/rows:[...]}, or a single event object.');
}
function readInputFiles(inputs) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error('--input is required unless --needs-raw-data is explicit.');
  const records = [];
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index]; const extension = path.extname(input).toLowerCase();
    if (!['.json', '.jsonl', '.ndjson', '.csv'].includes(extension)) throw new Error(`Unsupported input format in file ${index + 1}.`);
    let contents;
    try { if (!fs.statSync(input).isFile()) throw new Error(); contents = fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''); }
    catch { throw new Error(`Cannot read input file ${index + 1}.`); }
    try {
      if (extension === '.csv') records.push(...parseCsv(contents));
      else if (extension === '.json') records.push(...jsonRows(JSON.parse(contents)));
      else for (const [lineIndex, line] of contents.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        let value;
        try { value = JSON.parse(line); } catch { throw new Error(`Invalid JSONL at line ${lineIndex + 1}.`); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`JSONL object required at line ${lineIndex + 1}.`);
        records.push(value);
      }
    } catch (error) {
      // JSON parser errors may contain payload excerpts. Never forward them.
      throw new Error(`Invalid input file ${index + 1}: ${error instanceof SyntaxError ? 'invalid JSON (payload omitted).' : error.message}`);
    }
  }
  return records;
}

function renderMarkdown(report) {
  const percent = (value) => value === null || value === undefined ? 'unavailable' : `${(value * 100).toFixed(2)}%`;
  const points = (value) => value === null || value === undefined ? 'unavailable' : `${(value * 100).toFixed(2)} pp`;
  const lines = ['# Slova draft point 3 analysis', '', `Status: **${report.status}**. Source: **${report.source.kind}**${report.source.synthetic ? ' — SYNTHETIC DEVELOPMENT DATA; NOT LIVE' : ''}.`,
    '', `Baseline ${report.periods.baseline.from}–${report.periods.baseline.toExclusive} (end exclusive); current ${report.periods.current.from}–${report.periods.current.toExclusive}.`,
    `Fixed timezone ${report.periods.timezone}; explicit cutoff ${report.periods.asOf}. This timezone is an analysis choice, not a verified AppMetrica UI setting.`, '', report.interpretation, ''];
  if (!report.weeks) {
    lines.push('No measured values are available. Raw player events are required; aggregate event/user totals cannot reconstruct this comparison.', '', ...report.requiredInput.map((item) => `- ${item}`));
  } else {
    lines.push('| Week | Manual inputs | Invalid | Accepted grid+bonus | Player clusters | Median invalid/player | Median invalid/attempt |', '|---|---:|---:|---:|---:|---:|---:|');
    for (const week of report.weeks) lines.push(`| ${week.week} | ${week.manualInputs.completedManualInputs} | ${percent(week.manualInputs.invalid.rate)} | ${percent(week.manualInputs.accepted.rate)} | ${week.manualInputs.perPlayer.units} | ${percent(week.manualInputs.perPlayer.medianInvalidShare)} | ${percent(week.manualInputs.perAttempt.medianInvalidShare)} |`);
    lines.push('', '| Rate | Raw change | Fixed baseline mix change, common coverage only | Common mix component |', '|---|---:|---:|---:|');
    for (const [metric, row] of Object.entries(report.comparison.metrics)) lines.push(`| ${metric} | ${points(row.raw.change)} | ${points(row.commonConditionalFixedMix.change)} | ${points(row.decomposition.commonMixChange)} |`);
    const weights = report.comparison.weights;
    lines.push('', `Common support: baseline ${percent(weights.commonCoverage.baseline.rate)}, current ${percent(weights.commonCoverage.current.rate)} of exact eligible manual inputs. Excluded baseline weight ${percent(weights.baselineExcludedWeight)}. New unmatched strata ${weights.newUnmatchedStrata}; new unmatched levels ${weights.newUnmatchedLevels.length}.`,
      'Common weights are renormalized identically for both weeks. These conditional rates are not full-population percentages. The contribution outside this coverage is unknown.',
      '', `Uncertainty: deterministic paired SDK-player cluster bootstrap, ${report.comparison.uncertainty.requestedReplicates} replicates, minimum ${report.comparison.uncertainty.minimumClusters} players per week. Baseline weights are fixed. Small samples/insufficient replicate support have null intervals.`,
      '', '| Change CI95 | Raw | Fixed common mix |', '|---|---|---|');
    const ci = (value) => value ? value.map(points).join(' to ') : 'unavailable';
    for (const [metric, row] of Object.entries(report.comparison.uncertainty.intervals)) lines.push(`| ${metric} | ${ci(row.rawChange.ci95)} | ${ci(row.fixedChange.ci95)} |`);
    lines.push('', '| Week/mode | Active attempts | Level median / P75 | Known difficulty coverage | High difficulty among known |', '|---|---:|---:|---:|---:|');
    for (const week of report.weeks) for (const row of week.attempts.byModeAndProgress) lines.push(`| ${week.week}/${row.gameGroup} | ${row.attempts} | ${row.medianLevel ?? 'unavailable'} / ${row.p75Level ?? 'unavailable'} | ${percent(row.difficulty.knownCoverage.rate)} | ${percent(row.difficulty.highAmongKnown.rate)} |`);
    lines.push('', '| Week | Completed next-accepted inputs P50/P90 | Right censored sequences | Active time P50/P90 (ms), full coverage only | Mature exact attempt completion 24h | Help→progress 10m diagnostic |', '|---|---:|---:|---:|---:|---:|');
    for (const week of report.weeks) lines.push(`| ${week.week} | ${week.inputsUntilNextAccepted.completed.p50 ?? 'unavailable'} / ${week.inputsUntilNextAccepted.completed.p90 ?? 'unavailable'} | ${week.inputsUntilNextAccepted.rightCensored.sequences} | ${week.completedActiveTimeMs.fullCoverage.p50 ?? 'unavailable'} / ${week.completedActiveTimeMs.fullCoverage.p90 ?? 'unavailable'} | ${percent(week.completion24h.rate.rate)} (${week.completion24h.rate.numerator}/${week.completion24h.rate.denominator}) | ${percent(week.helpToProgress10m.rate.rate)} |`);
    lines.push('', 'Exact strata, bounded reasons, progress bands, coverage counts, censoring and partial/unknown active-time counts are in the companion JSON. No words, raw fingerprints, emails, or player identifiers are exported.');
  }
  lines.push('', 'Coverage gates:', '', ...report.coverageGates.map((gate) => `- ${gate.name}: ${gate.state}${gate.coverage ? ` (${percent(gate.coverage.rate)})` : ''}.`),
    '', 'Limitations:', '', ...report.limitations.map((item) => `- ${item}`), '');
  return lines.join('\n');
}

function parseArguments(argv) {
  const options = { input: [] }; const seen = new Set();
  const names = { '--baseline-start': 'baselineStart', '--current-start': 'currentStart', '--timezone': 'timezone', '--as-of': 'asOf', '--output': 'output', '--source': 'source', '--bootstrap-reps': 'bootstrapReps' };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--needs-raw-data') { if (seen.has(argument)) throw new Error('Duplicate --needs-raw-data.'); options.needsRawData = true; seen.add(argument); continue; }
    if (argument === '--input') { const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error('--input requires a path.'); options.input.push(value); continue; }
    if (!names[argument]) throw new Error('Unknown CLI argument. See docs/runbooks/product-improvements-analysis.md.');
    if (seen.has(argument)) throw new Error(`Duplicate ${argument}.`);
    seen.add(argument);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    options[names[argument]] = argument === '--bootstrap-reps' ? Number(value) : value;
  }
  if (!options.output) throw new Error('--output report prefix is required.');
  if (options.needsRawData && options.input.length) throw new Error('--needs-raw-data cannot be combined with --input.');
  if (!options.needsRawData && !options.input.length) throw new Error('--input is required unless --needs-raw-data is explicit.');
  validateOptions(options);
  return options;
}
function main(argv) {
  const options = parseArguments(argv);
  const outputPrefix = path.resolve(options.output);
  const outputs = [`${outputPrefix}.json`, `${outputPrefix}.md`];
  const inputPaths = options.input.map((input) => {
    try { return fs.realpathSync(input); } catch { throw new Error('Cannot read an input file.'); }
  });
  for (const output of outputs) {
    let canonical = path.resolve(output);
    if (fs.existsSync(output)) canonical = fs.realpathSync(output);
    if (inputPaths.some((input) => input.toLowerCase() === canonical.toLowerCase())) throw new Error('Output must not overwrite an input file.');
  }
  const report = options.needsRawData ? buildNeedsRawDataReport(options) : analyzeProductImprovements(readInputFiles(options.input), options);
  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(outputs[0], `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputs[1], renderMarkdown(report));
  process.stdout.write(`${JSON.stringify({ status: report.status, source: report.source.kind, outputFiles: outputs.map((output) => path.basename(output)) })}\n`);
}

module.exports = { analyzeProductImprovements, buildNeedsRawDataReport, readInputFiles, renderMarkdown, parseArguments };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
