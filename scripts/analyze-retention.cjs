'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 3 * 60 * 60 * 1000;
const COMPLETE_NAMES = new Set(['level_complete', 'puzzle_completed', 'level_reward_claimed', 'daily_completed']);
const START_NAMES = new Set(['level_start', 'puzzle_started', 'daily_started']);
const PLAY_NAMES = new Set(['gameplay_action', 'word_submitted', 'word_submit_outcome', 'word_found', 'wrong_word', 'hint_used']);
const OPEN_NAMES = new Set(['session_start', 'game_session_start', 'app_open', 'home_viewed', 'app_ready']);
const WORD_OUTCOMES = new Set(['invalid', 'grid', 'bonus', 'duplicate', 'blocked', 'constraint']);
const WORD_REASONS = new Set(['empty', 'too_short', 'too_long', 'malformed', 'not_constructible',
  'not_in_dictionary', 'wrong_order', 'profanity', 'slur_or_insult', 'proper_name',
  'abbreviation', 'non_lemma', 'low_quality', 'manual_deny']);
const ANALYSIS_MODES = new Set(['campaign', 'daily', 'practice', 'training', 'challenge', 'weekly', 'event']);
function nonnegative(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function boundedEnum(value, allowed) { return allowed.includes(value) ? value : null; }
function nullableBoolean(value) { return typeof value === 'boolean' ? value : null; }
function integer(value, signed = false) { return Number.isSafeInteger(value) && (signed || value >= 0) ? value : null; }

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
function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,256}$/.test(value) ? value
    : Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}
function installClassification(record) {
  const kind = record.install_kind ?? record.install_type;
  if (['first', 'first_install'].includes(kind) || record.is_reinstallation === false) return 'first';
  if (['reinstall', 'reinstallation'].includes(kind) || record.is_reinstallation === true) return 'reinstall';
  if (kind === 'reactivation') return 'reactivation';
  return 'unknown';
}

function normalizeRecord(record) {
  let payload = record.event_json ?? record.params ?? {};
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  const v2 = payload.schema_version === 2 && payload.properties && typeof payload.properties === 'object';
  const envelope = v2 || payload.schema_version === 3;
  const properties = v2 ? payload.properties : payload;
  const originAppVersion = safeLabel(envelope ? payload.app_version : null);
  const sdkAppVersion = safeLabel(record.app_version_name);
  const originVersionSupplied = envelope && payload.app_version !== undefined;
  const name = record.event_name ?? record.name
    ?? (record.record_type === 'install' ? 'install' : record.record_type === 'session' ? 'session_start' : 'unknown');
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw new Error('Invalid event name.');
  const identity = record.device_key ?? record.appmetrica_device_id ?? record.sdk_id ?? properties.device_key;
  const sdkId = (typeof identity === 'string' || Number.isSafeInteger(identity)) && String(identity).length
    ? String(identity) : null;
  const emittedAtMs = timestamp(properties.occurredAtMs) ?? timestamp(envelope ? payload.occurred_at : null)
    ?? timestamp(record.event_timestamp) ?? timestamp(record.event_datetime) ?? timestamp(record.occurred_at)
    ?? timestamp(record.session_start_timestamp) ?? timestamp(record.session_start_datetime)
    ?? (name === 'install' ? timestamp(record.install_timestamp) ?? timestamp(record.install_datetime) : null);
  const installMs = timestamp(record.install_timestamp) ?? timestamp(record.install_datetime)
    ?? timestamp(record.installed_at) ?? (name === 'install' ? emittedAtMs : null);
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
  let canonical = COMPLETE_NAMES.has(name) ? 'complete' : START_NAMES.has(name) ? 'start'
    : PLAY_NAMES.has(name) ? 'play' : OPEN_NAMES.has(name) ? 'open' : name === 'install' ? 'install' : 'other';
  if (canonical === 'play' && (properties.manual === false || properties.autoOrManual === 'auto'
      || name === 'gameplay_action' && properties.action === 'letters_connected')) canonical = 'other';
  const actionDay = canonical === 'complete' && validDay(properties.actionDay) ? properties.actionDay : null;
  // A replayed milestone has only a recorded calendar day. Its dispatch time
  // must not become the solve time in an exact 72-hour conversion window.
  const lateCalendarCompletion = actionDay && emittedAtMs !== null && actionDay !== productDay(emittedAtMs)
    && timestamp(properties.occurredAtMs) === null;
  const timeMs = properties.timeKnown === false || properties.time_known === false
    || payload.time_trust === 'occurrence_unknown' || lateCalendarCompletion ? null : emittedAtMs;
  const consentValues = [...new Set([record.consent_state, payload.consent_state, properties.consent_state].filter((value) => value !== undefined))];
  const environmentValues = [...new Set([record.environment, payload.environment, properties.environment].filter((value) => value !== undefined && value !== null && value !== 'unknown'))];
  const epochValue = payload.consent_epoch_at ?? record.consent_epoch_at;
  const epochMs = timestamp(epochValue);
  return {
    sdkId, name, canonical, timeMs, emittedAtMs, installDay, installMs, mode, puzzleKey, keyPrecision,
    installIdentity: identifier(record.install_key ?? record.installation_id ?? properties.install_key ?? properties.installation_id
      ?? properties.originating_installation_id), installKind: installClassification(record),
    day: actionDay ?? (emittedAtMs !== null ? productDay(emittedAtMs) : null),
    eventId: typeof payload.event_id === 'string' ? payload.event_id : null,
    attemptId: typeof properties.attemptId === 'string' ? properties.attemptId : null,
    appVersion: safeLabel(record.app_version_name ?? (envelope ? payload.app_version : null)),
    onboardingVersion: safeLabel(envelope ? payload.onboarding_version : null),
    contentVersion: safeLabel(properties.contentVersion ?? (envelope ? payload.content_version : null)),
    contentFingerprint: safeLabel(properties.content_fingerprint ?? properties.contentFingerprint),
    assisted: typeof properties.assisted === 'boolean' ? properties.assisted : null,
    levelId: typeof levelId === 'number' ? levelId : null,
    environment: properties.environment ?? payload.environment ?? null,
    isTest: properties.is_test === true || properties.isTest === true,
    // Selected, bounded domain fields for offline analyses. Never retain word,
    // rawInput, email, or the app-local player_id. Existing retention fields and
    // legacy canonicalization above deliberately keep their original semantics.
    schemaVersion: [2, 3].includes(payload.schema_version) ? payload.schema_version : null,
    originAppVersion, sdkAppVersion,
    analysisAppVersion: originAppVersion !== 'unknown' ? originAppVersion : originVersionSupplied ? 'unknown' : sdkAppVersion,
    versionProvenance: originAppVersion !== 'unknown' ? 'origin_envelope' : originVersionSupplied ? 'invalid_origin'
      : sdkAppVersion !== 'unknown' ? 'sdk_fallback' : 'unknown',
    appVersionMismatch: originAppVersion !== 'unknown' && sdkAppVersion !== 'unknown' && originAppVersion !== sdkAppVersion,
    levelKeyExplicit: typeof properties.levelKey === 'string',
    analysisMode: properties.mode === 'normal' ? 'campaign'
      : ANALYSIS_MODES.has(properties.mode) ? properties.mode
        : properties.mode !== undefined && properties.mode !== null ? 'other' : mode,
    manualState: properties.manual === true && properties.autoOrManual === 'auto'
      || properties.manual === false && properties.autoOrManual === 'manual' ? 'conflict'
        : properties.manual === true || properties.autoOrManual === 'manual' ? 'manual'
          : properties.manual === false || properties.autoOrManual === 'auto' ? 'auto' : 'unknown',
    wordOutcome: WORD_OUTCOMES.has(properties.kind) ? properties.kind
      : WORD_OUTCOMES.has(properties.result) ? properties.result : null,
    wordReason: WORD_REASONS.has(properties.reason) ? properties.reason : properties.reason === undefined ? null : 'unknown',
    submissionId: identifier(properties.submission_id),
    timeCoverage: boundedEnum(properties.time_coverage, ['full_attempt', 'since_restore', 'mixed_consent']),
    activeTimeMs: nonnegative(properties.activeTimeMs),
    difficultyTier: boundedEnum(properties.difficulty_tier, [1, 2, 3, 4, 5]),
    difficultyRole: boundedEnum(properties.difficulty_role, ['easy', 'baseline', 'hard', 'breather', 'climax']),
    mechanic: boundedEnum(properties.mechanic, ['classic', 'bonus_chest', 'ordered', 'mastery']),
    letterCount: Number.isSafeInteger(properties.letter_count) ? nonnegative(properties.letter_count) : null,
    targetCount: Number.isSafeInteger(properties.target_count) ? nonnegative(properties.target_count) : null,
    policyRevision: Number.isSafeInteger(properties.policyRevision) ? nonnegative(properties.policyRevision) : null,
    // Context is normalized here for reuse; point 3 does not implement the
    // reward/wallet/advertising/experiment funnels from draft points 4-7.
    interactionId: identifier(properties.interaction_id),
    originInteractionId: identifier(properties.origin_interaction_id),
    entrySource: safeLabel(properties.entry_source ?? properties.entrySource),
    hintType: boundedEnum(properties.hint_type ?? properties.requested_hint ?? properties.type, ['letter', 'clue', 'bulb', 'hammer', 'revealWord', 'semantic']),
    // Additive point 5 fields only. The legacy canonical/time/version fields
    // above retain their existing retention and point 3 semantics.
    modalId: identifier(properties.modal_id), screenVisitId: identifier(properties.screen_visit_id),
    screen: safeLabel(properties.screen), elementId: safeLabel(properties.element_id),
    feature: safeLabel(properties.feature), action: safeLabel(properties.action), outcome: safeLabel(properties.outcome),
    result: safeLabel(properties.result), reason: safeLabel(properties.reason),
    source: safeLabel(properties.source), sink: safeLabel(properties.sink),
    availableActions: typeof properties.available_actions === 'string'
      ? properties.available_actions.split(',').filter((value) => ['wheel', 'free_wheel', 'rewarded', 'shop', 'apply_hint', 'recover_reward', 'close'].includes(value)) : null,
    isAvailable: nullableBoolean(properties.is_available), readyAtEntry: nullableBoolean(properties.ready_at_entry),
    rewardedEligible: nullableBoolean(properties.rewarded_eligible), freeAvailable: nullableBoolean(properties.free_available),
    pendingSpin: nullableBoolean(properties.pending_spin), leftBeforeReady: nullableBoolean(properties.left_before_ready),
    alreadyOwned: nullableBoolean(properties.already_owned), previouslyCompleted: nullableBoolean(properties.previously_completed),
    firstEligibleRequest: nullableBoolean(properties.first_eligible_request), eligibilityVersion: identifier(properties.eligibility_version),
    // P7 enrollment phase is explicit; absence is never inferred as baseline.
    measurementPhase: boundedEnum(properties.measurement_phase, ['baseline', 'trial']),
    eligibilityEpoch: identifier(properties.eligibility_epoch),
    measurementPhaseSupplied: properties.measurement_phase !== undefined && properties.measurement_phase !== null,
    eligibilityEpochSupplied: properties.eligibility_epoch !== undefined && properties.eligibility_epoch !== null,
    invalidMeasurementScope: properties.measurement_phase !== undefined && properties.measurement_phase !== null && !['baseline', 'trial'].includes(properties.measurement_phase)
      || properties.eligibility_epoch !== undefined && properties.eligibility_epoch !== null && identifier(properties.eligibility_epoch) === null,
    trialPlanFingerprint: typeof properties.trial_plan_fingerprint === 'string' && /^[a-f0-9]{32}$/.test(properties.trial_plan_fingerprint) ? properties.trial_plan_fingerprint : null,
    trialPlanFingerprintSupplied: properties.trial_plan_fingerprint !== undefined && properties.trial_plan_fingerprint !== null,
    invalidTrialPlanFingerprint: properties.trial_plan_fingerprint !== undefined && properties.trial_plan_fingerprint !== null
      && !(typeof properties.trial_plan_fingerprint === 'string' && /^[a-f0-9]{32}$/.test(properties.trial_plan_fingerprint)),
    displayedCost: integer(properties.displayed_cost), balance: integer(properties.balance),
    balanceBefore: integer(properties.balance_before), balanceAfter: integer(properties.balance_after),
    delta: integer(properties.delta, true), amount: integer(properties.amount), chargedAmount: integer(properties.charged_amount),
    waitMs: integer(properties.wait_ms), latencyMs: integer(properties.latency_ms), rewardedRemaining: integer(properties.rewarded_remaining),
    resultRevision: integer(properties.result_revision), visibilityMs: nonnegative(properties.visibility_ms),
    visibleFraction: typeof properties.visible_fraction === 'number' && properties.visible_fraction >= 0 && properties.visible_fraction <= 1 ? properties.visible_fraction : null,
    visibilityRule: boundedEnum(properties.visibility_rule, ['half_1s_v2']),
    spinId: identifier(properties.spin_id), rewardId: identifier(properties.rewardId), transactionId: identifier(properties.transaction_id),
    opportunityId: identifier(properties.opportunity_id), requestId: identifier(properties.request_id),
    callbackId: identifier(properties.callback_id), operationId: identifier(properties.operation_id),
    format: boundedEnum(properties.format, ['rewarded', 'interstitial', 'banner']),
    placement: boundedEnum(properties.placement, ['wheel', 'hint', 'preload', 'level_complete', 'game_banner']),
    stage: boundedEnum(properties.stage, ['show_intent', 'eligible', 'skipped', 'requested', 'loaded', 'shown', 'impression', 'click', 'closed', 'reward', 'error', 'earned_pending', 'grant_persisted']),
    operation: boundedEnum(properties.operation, ['load', 'show']), freeOrRewarded: boundedEnum(properties.free_or_rewarded, ['free', 'rewarded']),
    grantState: boundedEnum(properties.grant_state, ['pending', 'granted', 'failed']),
    currency: boundedEnum(properties.currency, ['coins', 'gems']),
    rewardedState: safeLabel(properties.rewarded_state), blockedReason: safeLabel(properties.blocked_reason),
    normalizedReason: safeLabel(properties.normalized_reason),
    experimentId: identifier(properties.experiment_id), assignmentId: identifier(properties.assignment_id),
    variant: boundedEnum(properties.variant, ['control', 'treatment', 'clarity']), allocationVersion: integer(properties.allocation_version),
    unitType: boundedEnum(properties.unit_type, ['sdk_player', 'sdk_install']),
    exposurePoint: safeLabel(properties.exposure_point), exposureWindow: boundedEnum(properties.exposure_window, ['active', 'inactive']),
    consentState: consentValues.length === 1 && ['enabled', 'disabled'].includes(consentValues[0]) ? consentValues[0] : 'unknown',
    consentEpochMs: epochMs,
    invalidConsentMetadata: consentValues.some((value) => value !== null && !['enabled', 'disabled', 'unknown'].includes(value)),
    conflictingConsentMetadata: consentValues.includes('enabled') && consentValues.includes('disabled'),
    conflictingEnvironmentMetadata: environmentValues.length > 1,
    invalidConsentEpoch: epochValue !== undefined && epochValue !== null && (epochMs === null || emittedAtMs !== null && epochMs > emittedAtMs),
    schemaVersionSupplied: payload.schema_version !== undefined && payload.schema_version !== null,
    invalidTimeTrust: payload.time_trust !== undefined && payload.time_trust !== null && !['client_unverified', 'client_clock_anomaly', 'occurrence_unknown'].includes(payload.time_trust),
    originOccurrenceMs: timestamp(properties.occurredAtMs) ?? timestamp(envelope ? payload.occurred_at : null),
    recovery: nullableBoolean(properties.recovery),
    // P5 checks supplied canonical metadata without coercing malformed input.
    levelIdSupplied: properties.levelId !== undefined && properties.levelId !== null,
    dateKeySupplied: properties.dateKey !== undefined && properties.dateKey !== null,
    analysisDateKey: validDay(properties.dateKey) ? properties.dateKey : null,
    timeTrust: boundedEnum(payload.time_trust, ['client_unverified', 'client_clock_anomaly', 'occurrence_unknown']),
    recordedActionDay: validDay(properties.actionDay) ? properties.actionDay : null,
  };
}

/** A device may have multiple install episodes. Never infer first install from
 * the first custom event or merely from the first row in a truncated export. */
function linkInstallEpisodes(events, quality) {
  const devices = new Map();
  for (const event of events) {
    if (!devices.has(event.sdkId)) devices.set(event.sdkId, []);
    const episodes = devices.get(event.sdkId);
    const explicit = event.installIdentity;
    if (!explicit && !event.installDay) continue;
    let episode = explicit ? episodes.find((e) => e.explicit === explicit) : null;
    if (!episode && event.installMs !== null) {
      const sameTime = episodes.filter((e) => e.installMs === event.installMs && (!explicit || !e.explicit));
      if (sameTime.length === 1) episode = sameTime[0];
    }
    if (!episode && !explicit && event.installMs === null && event.installDay) {
      const sameDay = episodes.filter((e) => e.installDay === event.installDay);
      if (sameDay.length === 1) episode = sameDay[0];
    }
    if (!episode) {
      episode = { key: explicit ?? `install:${event.installMs ?? event.installDay}`, explicit,
        sdkId: event.sdkId, installMs: event.installMs, installDay: event.installDay,
        kinds: new Set(), events: [], conflict: false };
      episodes.push(episode);
    }
    if (explicit && !episode.explicit) { episode.explicit = explicit; episode.key = explicit; }
    if (episode.installMs !== null && event.installMs !== null && episode.installMs !== event.installMs
        || episode.installDay && event.installDay && episode.installDay !== event.installDay) episode.conflict = true;
    episode.installMs ??= event.installMs;
    episode.installDay ??= event.installDay;
    if (event.installKind !== 'unknown') episode.kinds.add(event.installKind);
  }
  const all = [];
  for (const episodes of devices.values()) {
    episodes.sort((a, b) => (a.installMs ?? Infinity) - (b.installMs ?? Infinity));
    const firsts = episodes.filter((e) => e.kinds.has('first'));
    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      if (episode.kinds.size > 1 || firsts.length > 1 && episode.kinds.has('first')) episode.conflict = true;
      episode.kind = episode.conflict ? 'unknown' : [...episode.kinds][0] ?? 'unknown';
      episode.endMs = episodes.slice(i + 1).find((e) => e.installMs !== null)?.installMs ?? Infinity;
      if (episode.conflict) quality.conflictingInstallEpisodes++;
      if (episode.kind === 'unknown') quality.unknownInstallClassification++;
      all.push(episode);
    }
  }
  for (const event of events) {
    const episodes = devices.get(event.sdkId);
    let matches = event.installIdentity ? episodes.filter((e) => e.explicit === event.installIdentity) : [];
    if (!event.installIdentity && event.installMs !== null) matches = episodes.filter((e) => e.installMs === event.installMs);
    if (!matches.length && !event.installIdentity && event.timeMs !== null) {
      matches = episodes.filter((e) => e.installMs !== null && event.timeMs >= e.installMs && event.timeMs < e.endMs);
    }
    if (!matches.length && !event.installIdentity && event.installDay && episodes.length === 1) {
      matches = episodes.filter((e) => e.installDay === event.installDay);
    }
    const linked = matches.length === 1 && !matches[0].conflict ? matches[0] : null;
    if (linked && event.timeMs !== null && linked.installMs !== null
        && (event.timeMs < linked.installMs || event.timeMs >= linked.endMs)) {
      event.installAmbiguous = true; quality.eventsWithAmbiguousInstall++;
    } else if (linked) {
      event.installKey = linked.key; linked.events.push(event);
    } else if (episodes.length) {
      event.installAmbiguous = true; quality.eventsWithAmbiguousInstall++;
    } else quality.eventsWithoutInstallEpisode++;
  }
  return all;
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
    deliveryDuplicates: 0, futureEventsExcluded: 0, ambiguousLegacyLevelIds: 0,
    excludedTestRecords: 0, unknownEnvironmentRecords: 0, conflictingInstallEpisodes: 0,
    unknownInstallClassification: 0, eventsWithAmbiguousInstall: 0, eventsWithoutInstallEpisode: 0 };
  for (const raw of records) {
    let event;
    try { event = normalizeRecord(raw); } catch { quality.invalidRecords++; continue; }
    if (event.isTest || ['test', 'development', 'debug', 'preview'].includes(event.environment)) {
      quality.excludedTestRecords++; continue;
    }
    if (event.environment === null || event.environment === 'unknown') quality.unknownEnvironmentRecords++;
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
  const installEpisodes = linkInstallEpisodes(events, quality);
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
    if (event.installKey) user.installs.add(event.installKey);
    user.events.push(event);
    const versionKey = JSON.stringify([event.appVersion, event.onboardingVersion, event.contentVersion]);
    if (!versions.has(versionKey)) versions.set(versionKey, { appVersion: event.appVersion,
      onboardingVersion: event.onboardingVersion, contentVersion: event.contentVersion,
      users: new Set(), started: new Set(), completed: new Set() });
    const version = versions.get(versionKey);
    version.users.add(event.sdkId);
    if (event.canonical === 'start') version.started.add(event.sdkId);
    if (event.canonical === 'complete') version.completed.add(event.sdkId);
    const scope = [event.sdkId, event.installKey ?? 'unlinked'];
    const content = event.contentFingerprint !== 'unknown' ? event.contentFingerprint : event.contentVersion;
    const puzzleId = event.puzzleKey && !event.installAmbiguous ? JSON.stringify([...scope, event.puzzleKey, content]) : null;
    if (event.canonical === 'start' && puzzleId) {
      const existing = starts.get(puzzleId);
      if (!existing || event.timeMs !== null && (existing.timeMs === null || event.timeMs < existing.timeMs)) starts.set(puzzleId, event);
    }
    if (event.canonical === 'start' && event.name === 'puzzle_started' && event.attemptId && event.timeMs !== null && !event.installAmbiguous) {
      const key = JSON.stringify([...scope, event.attemptId]);
      if (!attempts.has(key) || event.timeMs < attempts.get(key).timeMs) attempts.set(key, event);
    }
    if (event.canonical === 'complete' && puzzleId) {
      const existing = completions.get(puzzleId);
      if (!existing || event.timeMs !== null && (existing.timeMs === null || event.timeMs < existing.timeMs)) completions.set(puzzleId, event);
    }
    if (event.canonical === 'complete' && event.attemptId && event.timeMs !== null && !event.installAmbiguous) {
      const key = JSON.stringify([...scope, event.attemptId]);
      if (!attemptCompletions.has(key) || event.timeMs < attemptCompletions.get(key).timeMs) attemptCompletions.set(key, event);
    }
    if (event.canonical === 'complete' && event.attemptId && event.timeMs === null) {
      unknownAttemptCompletionTimes.add(JSON.stringify([...scope, event.attemptId]));
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
  const inCohort = (episode) => episode.installDay && !episode.conflict
    && (!options.cohortFrom || episode.installDay >= options.cohortFrom)
    && (!options.cohortTo || episode.installDay <= options.cohortTo);
  const cohortUsers = installEpisodes.filter((episode) => episode.kind === 'first' && inCohort(episode));
  const retention = [1, 3, 7, 30].map((n) => {
    const mature = cohortUsers.filter((user) => dayNumber(user.installDay) + n < dayNumber(asOfDay)
      && user.endMs >= (dayNumber(user.installDay) + n + 1) * DAY_MS - OFFSET_MS);
    const returned = (user, playing) => {
      return user.events.some((event) => event.day && dayNumber(event.day) - dayNumber(user.installDay) === n
        && (event.canonical === 'play' || !playing && event.canonical === 'open'));
    };
    return { day: n, open: fraction(mature.filter((u) => returned(u, false)).length, mature.length),
      play: fraction(mature.filter((u) => returned(u, true)).length, mature.length) };
  });
  const activated = (episode) => episode.events.some((event) => event.name === 'independent_level_completed'
    && event.assisted !== true && (event.levelId === null || event.levelId >= 2 && event.levelId <= 5)
    && event.timeMs !== null && event.timeMs >= episode.installMs && event.timeMs < episode.installMs + DAY_MS);
  const matureActivation = cohortUsers.filter((episode) => episode.installMs !== null
    && episode.installMs + DAY_MS <= asOfMs && episode.endMs >= episode.installMs + DAY_MS);
  return {
    asOf: new Date(asOfMs).toISOString(), productTimezone: 'UTC+03:00', attemptWindowHours: attemptWindowMs / 3600000,
    installCohort: { from: options.cohortFrom ?? null, to: options.cohortTo ?? null, users: cohortUsers.length,
      unit: 'first_confirmed_install_episode', reinstallEpisodes: installEpisodes.filter((e) => e.kind === 'reinstall' && inCohort(e)).length,
      reactivationEpisodes: installEpisodes.filter((e) => e.kind === 'reactivation' && inCohort(e)).length,
      unknownClassificationEpisodes: installEpisodes.filter((e) => e.kind === 'unknown' && inCohort(e)).length },
    activation24h: fraction(matureActivation.filter(activated).length, matureActivation.length),
    quality: { ...quality, unknownPuzzleCompletionTimes, usersWithUnknownInstall: [...users.values()].filter((u) => !u.installs.size).length,
      usersWithConflictingInstalls: new Set(installEpisodes.filter((e) => e.conflict).map((e) => e.sdkId)).size,
      devicesWithMultipleInstallEpisodes: [...users.values()].filter((u) => u.installs.size > 1).length },
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
      'Primary A24/Dn cohorts require explicit first-install classification. Unknown and reinstalled episodes are not first installs.',
      'D1/D3/D7/D30 require a completely observed product day; the current partial day is excluded.',
      'A later reinstall censors the earlier episode; events after it cannot be credited to the original install.',
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

module.exports = { normalizeRecord, analyzeRecords, linkInstallEpisodes };
if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
