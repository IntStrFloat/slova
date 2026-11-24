'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeRecord, linkInstallEpisodes } = require('./analyze-retention.cjs');
const product = require('./analyze-product-improvements.cjs');
const passport = require('../docs/marketing/slova/analytics/product-metric-passports-2026-11-04.json');

const DAY = 86400000;
const HELP = passport.windows.helpMinutesProposed * 60000;
const GRANT = passport.windows.earnedGrantHours * 3600000;
const SOURCES = new Set(['game_help', 'no_coins', 'wheel', 'home', 'home_help_resume', 'wheel_return', 'help_return', 'direct', 'recovery', 'in_place_reward']);
const ENTRY_ELEMENTS = new Set(['wheel', 'free_wheel']);
const IDENTITY_FIELDS = ['attemptId', 'puzzleKey', 'analysisMode', 'contentVersion', 'contentFingerprint'];
const TEST_ENVS = new Set(['qa', 'test', 'testing', 'development', 'dev', 'debug', 'preview', 'staging']);
// These funnels use wall occurrence and per-event permission. Whole-attempt
// active-time counters/coverage are left to P3 and cannot invalidate new actions.
const BUSINESS_FIELDS = ['name', 'schemaVersion', 'originAppVersion', 'originOccurrenceMs', 'timeTrust', 'recordedActionDay',
  'attemptId', 'puzzleKey', 'keyPrecision', 'levelKeyExplicit', 'analysisMode', 'contentVersion', 'contentFingerprint', 'levelId',
  'environment', 'consentState', 'consentEpochMs', 'sdkMetadata', 'assisted', 'manualState', 'wordOutcome', 'wordReason', 'submissionId',
  'difficultyTier', 'difficultyRole', 'mechanic', 'letterCount', 'targetCount', 'policyRevision',
  'originInteractionId', 'interactionId', 'entrySource', 'hintType', 'modalId', 'screenVisitId', 'screen', 'elementId', 'feature',
  'action', 'outcome', 'result', 'reason', 'source', 'sink', 'availableActions', 'isAvailable', 'readyAtEntry', 'rewardedEligible',
  'freeAvailable', 'pendingSpin', 'leftBeforeReady', 'alreadyOwned', 'previouslyCompleted', 'firstEligibleRequest', 'eligibilityVersion',
  'displayedCost', 'balance', 'balanceBefore', 'balanceAfter', 'delta', 'amount', 'chargedAmount', 'waitMs', 'latencyMs',
  'rewardedRemaining', 'resultRevision', 'visibilityMs', 'visibleFraction', 'visibilityRule', 'spinId', 'rewardId', 'transactionId',
  'opportunityId', 'requestId', 'callbackId', 'operationId', 'format', 'placement', 'stage', 'operation', 'freeOrRewarded',
  'grantState', 'currency', 'rewardedState', 'blockedReason', 'normalizedReason', 'experimentId', 'assignmentId', 'variant',
  'allocationVersion', 'unitType', 'exposurePoint', 'exposureWindow', 'recovery', 'measurementPhase', 'eligibilityEpoch', 'invalidMeasurementScope',
  'trialPlanFingerprint', 'invalidTrialPlanFingerprint', 'invalidFrozenQueryMetadata', 'levelIdSupplied', 'dateKeySupplied', 'analysisDateKey',
  'invalidConsentMetadata', 'conflictingConsentMetadata', 'conflictingEnvironmentMetadata', 'invalidConsentEpoch', 'schemaVersionSupplied', 'invalidTimeTrust'];
const WALLET_FIELDS = ['currency', 'delta', 'balanceBefore', 'balanceAfter', 'rewardId', 'originInteractionId', 'interactionId',
  'modalId', 'attemptId', 'puzzleKey', 'analysisMode', 'levelId', 'contentVersion', 'contentFingerprint', 'analysisDateKey',
  'source', 'sink', 'hintType', 'displayedCost', 'balance', 'entrySource', 'previouslyCompleted', 'originOccurrenceMs',
  'timeTrust', 'consentState', 'consentEpochMs', 'environment', 'schemaVersion', 'originAppVersion'];
const AD_PROOF_FIELDS = ['name', 'stage', 'format', 'placement', 'operation', 'operationId', 'opportunityId', 'requestId', 'rewardId',
  'originInteractionId', 'interactionId', 'modalId', 'attemptId', 'puzzleKey', 'analysisMode', 'levelId', 'analysisDateKey',
  'contentVersion', 'contentFingerprint', 'entrySource', 'hintType', 'displayedCost', 'balance', 'alreadyOwned', 'previouslyCompleted',
  'source', 'outcome', 'result', 'schemaVersion', 'originAppVersion', 'originOccurrenceMs', 'timeTrust',
  'consentState', 'consentEpochMs', 'environment', 'installIdentity', 'installMs', 'installDay', 'installKind',
  'transactionId', 'freeOrRewarded', 'difficultyTier', 'difficultyRole', 'mechanic', 'letterCount', 'targetCount'];
const PROVENANCE_FLAGS = ['invalidConsentMetadata', 'conflictingConsentMetadata', 'conflictingEnvironmentMetadata', 'invalidConsentEpoch', 'invalidTimeTrust', 'invalidFrozenQueryMetadata'];
const CONSENT_PROOF_FIELDS = [...new Set([...AD_PROOF_FIELDS, 'action', 'elementId', 'screen', 'screenVisitId', 'submissionId',
  'wordOutcome', 'manualState', 'firstEligibleRequest', 'eligibilityVersion', 'chargedAmount', 'currency', 'delta',
  'balanceBefore', 'balanceAfter', 'recovery', 'measurementPhase', 'eligibilityEpoch'])];
const ENROLLMENT_PROOF_FIELDS = [...new Set([...CONSENT_PROOF_FIELDS, 'experimentId', 'assignmentId', 'variant', 'allocationVersion',
  'unitType', 'measurementPhase', 'eligibilityEpoch', 'eligibilityVersion', 'firstEligibleRequest', 'isAvailable', 'invalidMeasurementScope',
  'trialPlanFingerprint', 'invalidTrialPlanFingerprint', 'invalidFrozenQueryMetadata'])];
const known = (value) => value !== null && value !== undefined && value !== 'unknown';
const key = (...values) => JSON.stringify(values);
const scope = (event) => key(event.sdkId, event.installKey ?? event.installIdentity ?? null);
const flowKey = (event) => event.proofFlowKey !== undefined ? event.proofFlowKey : event.originInteractionId ? key(scope(event), event.originInteractionId) : null;
const at = (event) => event.timeTrust === 'client_clock_anomaly' ? null : event.timeMs;
const inside = (event, period) => at(event) !== null && at(event) >= period.startMs && at(event) < period.endMs;
// Handoff time may locate an unknown-time fact for coverage reporting only.
// It must never establish ordering, maturity, or success.
const belongs = (event, period) => inside(event, period) || at(event) === null && event.emittedAtMs !== null
  && event.emittedAtMs >= period.startMs && event.emittedAtMs < period.endMs;
const fraction = (n, d) => ({ numerator: n, denominator: d, rate: d ? n / d : null });
const canonicalHint = (event) => ['letter', 'bulb'].includes(event.hintType) ? 'letter' : ['semantic', 'clue'].includes(event.hintType) ? 'semantic' : 'unknown';
const version = (value) => /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value ?? '') ? value : 'unknown';
function validDay(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function safeLevel(event) {
  const value = event.puzzleKey;
  if (typeof value !== 'string' || value.length > 32) return 'unknown';
  if (event.levelIdSupplied && (!Number.isSafeInteger(event.levelId) || event.levelId <= 0)) return 'unknown';
  if (event.analysisMode === 'campaign' && /^campaign:[1-9][0-9]{0,15}$/.test(value)) {
    const id = Number(value.slice(9));
    return Number.isSafeInteger(id) && (!known(event.levelId) || event.levelId === id) && !event.dateKeySupplied ? value : 'unknown';
  }
  if (event.analysisMode === 'daily' && value.startsWith('daily:') && validDay(value.slice(6))) {
    return !event.dateKeySupplied || event.analysisDateKey === value.slice(6) ? value : 'unknown';
  }
  return 'unknown';
}
const fingerprintKnown = (value) => typeof value === 'string' && /^(?:fp_[a-f0-9]{16}|[a-f0-9]{64})$/i.test(value);
function contentProof(event) {
  const own = { contentVersion: known(event.contentVersion) ? event.contentVersion : null,
    contentFingerprint: fingerprintKnown(event.contentFingerprint) ? event.contentFingerprint : null };
  const metadata = event.attemptMetadata;
  if (known(event.contentFingerprint) && !own.contentFingerprint || metadata?.conflict) return { ...own, conflict: true };
  if (!metadata?.trusted || metadata.puzzleKey !== event.puzzleKey || metadata.analysisMode !== event.analysisMode) return own;
  const fields = ['contentVersion', 'contentFingerprint'];
  if (fields.some((field) => known(own[field]) && known(metadata[field]) && own[field] !== metadata[field])) return { ...own, conflict: true };
  const overlapping = fields.some((field) => known(own[field]) && own[field] === metadata[field]);
  // A compact attempt entry may supply omitted content. Disjoint supplied
  // proofs cannot create a bridge unless the entry explicitly joins them.
  return !fields.some((field) => known(own[field])) || overlapping
    ? { contentVersion: own.contentVersion ?? metadata.contentVersion, contentFingerprint: own.contentFingerprint ?? metadata.contentFingerprint } : own;
}

function validateOptions(options = {}) {
  // Keep the two-week/cutoff/source/bootstrap contract exactly aligned with P3.
  const reference = product.buildNeedsRawDataReport(options);
  const offset = options.timezone === 'UTC' || options.timezone === 'Z' ? 0 : (() => {
    const match = /^(?:UTC)?([+-])(\d{2}):(\d{2})$/.exec(options.timezone);
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  })();
  const periods = ['baseline', 'current'].map((name) => ({ name,
    startMs: Date.parse(`${reference.periods[name].from}T00:00:00Z`) - offset * 60000,
    endMs: Date.parse(`${reference.periods[name].toExclusive}T00:00:00Z`) - offset * 60000 }));
  return { ...options, source: options.source ?? 'observation', offset, asOfMs: Date.parse(options.asOf), periods, publicPeriods: reference.periods };
}
function validateSdkRecordKind(raw) {
  const kind = raw && ['install', 'session'].includes(raw.record_type) ? raw.record_type : null;
  if (!kind) return null;
  const expected = kind === 'install' ? 'install' : 'session_start';
  if (['event_name', 'name'].some((field) => raw[field] !== undefined && raw[field] !== null && raw[field] !== expected)) throw new Error('SDK record type/name conflict.');
  return kind;
}
function risk(event, requireTime = true) {
  if (event.semanticConflict) return 'conflicting_semantic_ad_copies';
  if (event.conflict) return 'conflicting_delivery';
  if (PROVENANCE_FLAGS.some((field) => event[field])) return 'invalid_or_conflicting_provenance_metadata';
  if (event.schemaVersionSupplied && event.schemaVersion === null) return 'unsupported_schema';
  if (event.excludedFromPopulation) return 'excluded_test_provenance';
  if (event.attemptMetadata?.conflict) return 'conflicting_attempt_entry_metadata';
  if (event.installAmbiguous) return 'ambiguous_install_episode';
  if (event.timeTrust === 'client_clock_anomaly') return 'client_clock_anomaly';
  if (event.environment !== 'production') return 'unknown_environment';
  if (event.consentState !== 'enabled' && event.name !== 'install' && !event.sdkMetadata) return 'unknown_or_disabled_consent';
  if (!event.sdkMetadata && ![2, 3].includes(event.schemaVersion)) return 'unsupported_schema';
  if (!event.sdkMetadata && version(event.analysisAppVersion) === 'unknown') return 'unknown_event_version';
  if (requireTime && (at(event) === null || !event.sdkMetadata && event.originOccurrenceMs === null)) return 'unknown_occurrence_time';
  return null;
}
function validAttempt(event) {
  const content = contentProof(event);
  return Boolean(event.attemptId && /^[A-Za-z0-9_.:-]{1,256}$/.test(event.attemptId)
    && safeLevel(event) !== 'unknown' && !content.conflict && (known(content.contentVersion) || known(content.contentFingerprint)));
}
function sameAttempt(origin, event) {
  if (!validAttempt(origin) || !validAttempt(event)) return null;
  if (scope(origin) !== scope(event)) return false;
  for (const field of ['attemptId', 'puzzleKey', 'analysisMode']) if (origin[field] !== event[field]) return false;
  const a = contentProof(origin); const b = contentProof(event); const fields = ['contentVersion', 'contentFingerprint'];
  if (fields.some((field) => known(a[field]) && known(b[field]) && a[field] !== b[field])) return false;
  return fields.some((field) => known(a[field]) && a[field] === b[field]) ? true : null;
}
function groupBy(values, keyOf) {
  const groups = new Map();
  for (const value of values) { const id = keyOf(value); if (id === null) continue; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(value); }
  return groups;
}
function reconcileProofCopies(values, fields) {
  const event = { ...values[0] }; let conflict = false;
  for (const field of fields) {
    const unique = [...new Set(values.map((copy) => copy[field]).filter(known))];
    if (unique.length > 1) { conflict = true; event[field] = null; }
    else if (unique.length === 1) event[field] = unique[0];
  }
  // An explicit unknown clock is not missing optional context. SDK sender
  // timestamps cannot repair it; consistent missing immutable fields can merge.
  if (new Set(values.map((copy) => at(copy) === null)).size > 1) conflict = true;
  if (values.some((copy) => copy.excludedFromPopulation) && values.some((copy) => !copy.excludedFromPopulation)) conflict = true;
  if (values.some((copy) => copy.versionProvenance === 'invalid_origin' || copy.levelIdSupplied && (!Number.isSafeInteger(copy.levelId) || copy.levelId <= 0)
    || copy.dateKeySupplied && !copy.analysisDateKey || known(copy.puzzleKey) && known(copy.analysisMode) && safeLevel(copy) === 'unknown')) conflict = true;
  for (const field of PROVENANCE_FLAGS) event[field] = values.some((copy) => copy[field]);
  if (values.some((copy) => copy.schemaVersionSupplied && copy.schemaVersion === null)) conflict = true;
  event.schemaVersionSupplied = values.some((copy) => copy.schemaVersionSupplied);
  event.levelIdSupplied = values.some((copy) => copy.levelIdSupplied); event.dateKeySupplied = values.some((copy) => copy.dateKeySupplied);
  event.conflict = values.some((copy) => copy.conflict); event.installAmbiguous = values.some((copy) => copy.installAmbiguous);
  event.excludedFromPopulation = values.every((copy) => copy.excludedFromPopulation);
  const installKeys = [...new Set(values.map((copy) => copy.installKey).filter(known))];
  event.installKey = installKeys.length === 1 ? installKeys[0] : null;
  if (installKeys.length > 1) conflict = true;
  const metadata = values.map((copy) => copy.attemptMetadata).filter(Boolean);
  event.attemptMetadata = metadata.find((copy) => copy.conflict) ?? metadata.find((copy) => copy.trusted);
  event.timeMs = known(event.originOccurrenceMs) && values.every((copy) => at(copy) !== null) ? event.originOccurrenceMs : null;
  const observedTimes = values.map((copy) => copy.emittedAtMs).filter(known);
  event.emittedAtMs = observedTimes.length ? Math.min(...observedTimes) : null;
  if (known(event.originAppVersion)) { event.analysisAppVersion = event.originAppVersion; event.versionProvenance = 'origin_envelope'; }
  else {
    const versions = [...new Set(values.map((copy) => copy.sdkAppVersion).filter(known))];
    event.analysisAppVersion = versions.length === 1 ? versions[0] : 'unknown'; event.versionProvenance = versions.length === 1 ? 'sdk_fallback' : 'unknown';
  }
  event.semanticConflict = conflict;
  return event;
}
function reconcileAdCopies(values) { return reconcileProofCopies(values, AD_PROOF_FIELDS); }

function lowerBound(values, target) {
  let lo = 0; let hi = values.length;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (values[mid] < target) lo = mid + 1; else hi = mid; }
  return lo;
}
function indexConsentObservability(context) {
  const ordinary = context.events.filter((event) => !['ad_lifecycle', 'wallet_transaction'].includes(event.name));
  let unkeyed = 0;
  const ordinaryGroups = groupBy(ordinary, (event) => {
    const action = ['hint_requested', 'hint_rejected', 'ui_action'].includes(event.name) ? event.interactionId
      : event.name === 'help_used' ? event.transactionId ?? event.interactionId
        : ['puzzle_started', 'puzzle_completed'].includes(event.name) ? event.attemptId
          : event.name === 'word_submit_outcome' && event.attemptId && event.submissionId ? key(event.attemptId, event.submissionId) : null;
    return key(scope(event), event.name, action ?? event.eventId ?? `unkeyed:${unkeyed++}`);
  });
  const facts = [...ordinaryGroups.values()].map((copies) => copies.length === 1 ? copies[0] : reconcileProofCopies(copies, CONSENT_PROOF_FIELDS));
  for (const wallet of context.wallets) if (wallet.recordValid) facts.push(wallet.event);
  const adGroups = groupBy([...context.events, ...context.excludedAdEvidence].filter((event) => event.name === 'ad_lifecycle'), (event) => {
    if (event.stage === 'reward' && event.rewardId) return key(event.sdkId, 'reward', event.rewardId);
    if (event.stage === 'show_intent' && event.requestId && event.opportunityId) return key(event.sdkId, 'show_intent', event.opportunityId, event.requestId);
    if (event.callbackId) return key(event.sdkId, event.stage, event.callbackId);
    return event.requestId && event.opportunityId ? key(event.sdkId, event.stage, event.opportunityId, event.requestId, event.operationId, event.originOccurrenceMs) : null;
  });
  for (const copies of adGroups.values()) if (copies.some((event) => !event.excludedFromPopulation)) facts.push(copies.length === 1 ? copies[0] : reconcileAdCopies(copies));
  const scopes = new Map();
  for (const event of facts) {
    if (at(event) === null || at(event) > context.options.asOfMs) continue;
    if (event.levelIdSupplied && (!Number.isSafeInteger(event.levelId) || event.levelId <= 0) || event.dateKeySupplied && !event.analysisDateKey) continue;
    if (event.attemptId && !validAttempt(event) || known(event.puzzleKey) && known(event.analysisMode) && safeLevel(event) === 'unknown') continue;
    const enabled = event.consentState === 'enabled' && !risk(event);
    const disabled = event.consentState === 'disabled' && !risk({ ...event, consentState: 'enabled' });
    if (!enabled && !disabled) continue;
    const id = scope(event); if (!scopes.has(id)) scopes.set(id, { facts: [], disabled: [] });
    if (enabled) scopes.get(id).facts.push({ time: at(event), epoch: event.consentEpochMs });
    else scopes.get(id).disabled.push(at(event));
  }
  let legalFacts = 0; let epochs = 0;
  for (const row of scopes.values()) {
    row.starts = [...new Set(row.facts.map((fact) => fact.epoch).filter(known))].sort((a, b) => a - b);
    if (row.starts.length) row.facts.sort((a, b) => a.time - b.time);
    row.disabled.sort((a, b) => a - b);
    row.gaps = []; let cursor = 0; let prior = null;
    for (const start of row.starts) {
      while (cursor < row.facts.length && row.facts[cursor].time < start) { prior = row.facts[cursor].time; cursor++; }
      let same = cursor; let oldAtBoundary = false;
      while (same < row.facts.length && row.facts[same].time === start) { if (row.facts[same].epoch !== start) oldAtBoundary = true; same++; }
      row.gaps.push({ start, prior, oldAtBoundary });
    }
    legalFacts += row.facts.length; epochs += row.starts.length;
    delete row.facts;
  }
  context.quality.legalConsentFacts = legalFacts; context.quality.observedConsentEpochs = epochs;
  return scopes;
}
function absenceConsentGap(context, origin, start, end, endExclusive = false) {
  const row = context.consentObservability.get(scope(origin)); if (!row) return null;
  const disabled = row.disabled[lowerBound(row.disabled, start)];
  if (disabled !== undefined && (endExclusive ? disabled < end : disabled <= end)) return 'observed_consent_state_gap';
  for (let i = lowerBound(row.starts, start); i < row.gaps.length; i++) {
    const gap = row.gaps[i];
    if (gap.prior !== null && (endExclusive ? gap.prior >= end : gap.prior > end)) break;
    if (gap.start > start) return 'observed_consent_epoch_gap';
    // A current-epoch anchor establishes that this window starts after opt-in.
    // An old-epoch fact at the same millisecond cannot establish that order.
    if (!(at(origin) === start && origin.consentEpochMs === start) && gap.oldAtBoundary) return 'observed_consent_epoch_gap';
  }
  return null;
}
function playerClass(event, period, episodes) {
  const episode = episodes.find((item) => item.sdkId === event.sdkId && item.key === event.installKey);
  if (!episode || episode.conflict || episode.kind === 'unknown') return 'unknown';
  if (episode.kind !== 'first') return 'returning';
  return episode.installMs === null ? 'unknown' : episode.installMs < period.startMs ? 'returning' : episode.installMs < period.endMs ? 'new' : 'unknown';
}
function dimensions(event, period, episodes, channel = 'unknown', entryElement = 'not_applicable', placement = 'not_applicable') {
  const proof = contentProof(event); const content = [proof.contentVersion, proof.contentFingerprint];
  const metadata = event.attemptMetadata;
  const difficulty = metadata?.difficultyConflict || known(event.difficultyTier) && known(metadata?.difficultyTier) && event.difficultyTier !== metadata.difficultyTier ? null
    : event.difficultyTier ?? (validAttempt(event) && metadata?.trusted ? metadata.difficultyTier : null);
  return { appVersion: version(event.analysisAppVersion), versionProvenance: event.versionProvenance,
    entrySource: SOURCES.has(event.entrySource) ? event.entrySource : event.entrySource === 'unknown' ? 'unknown' : 'other',
    hint: canonicalHint(event), channel, entryElement: ['wheel', 'free_wheel', 'mixed', 'unknown'].includes(entryElement) ? entryElement : 'not_applicable',
    placement: ['wheel', 'hint', 'preload', 'level_complete', 'game_banner', 'unknown'].includes(placement) ? placement : 'not_applicable',
    mode: ['campaign', 'daily'].includes(event.analysisMode) ? event.analysisMode : 'unknown',
    level: safeLevel(event), contentReference: content.some(known) ? `content_${createHash('sha256').update(key(...content)).digest('hex').slice(0, 20)}` : null,
    difficulty, playerClass: playerClass(event, period, episodes) };
}
function observation(event, state, success, reason = null, extra = {}) { return { event, state, success, reason, ...extra }; }
function summarize(rows, period, episodes, includeStrata = true) {
  const states = { mature: 0, immature: 0, open: 0, unknown: 0, unproven: 0, ineligible: 0 };
  const reasons = {};
  for (const row of rows) { states[row.state]++; if (row.reason) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1; }
  const denominator = states.mature + states.unknown;
  const numerator = rows.filter((row) => row.state === 'mature' && row.success === true).length;
  const uncertainty = states.unknown + states.unproven;
  const result = { numerator, denominator, rate: denominator && !uncertainty ? numerator / denominator : null,
    observedKnownRate: states.mature ? numerator / states.mature : null,
    bounds: denominator ? { lower: numerator / denominator, upper: (numerator + states.unknown) / denominator,
      conditionalOnKnownDenominator: states.unproven > 0 } : null,
    units: rows.length, matureUnits: denominator, knownOutcomeUnits: states.mature, unknownUnits: states.unknown,
    unprovenDenominatorUnits: states.unproven, immatureUnits: states.immature, openUnits: states.open, ineligibleUnits: states.ineligible,
    coverage: fraction(states.mature, denominator + states.unproven), reasons,
    status: !rows.length ? 'unavailable' : uncertainty ? 'coverage_gap' : denominator ? 'observed' : 'no_mature_units' };
  if (includeStrata) result.strata = [...groupBy(rows, (row) => key(dimensions(row.event, period, episodes, row.channel, row.entryElement, row.placement))).entries()]
    .sort(([a], [b]) => a.localeCompare(b)).map(([id, values]) => ({ ...JSON.parse(id)[0], ...summarize(values, period, episodes, false) }));
  return result;
}
function indexAttemptEntries(events) {
  const entries = groupBy(events.filter((event) => ['puzzle_started', 'puzzle_resumed'].includes(event.name) && event.attemptId), (event) => key(scope(event), event.attemptId));
  const metadata = new Map();
  for (const [id, values] of entries) {
    const unique = (field) => [...new Set(values.map((event) => event[field]).filter(known))];
    const levels = unique('puzzleKey'); const modes = unique('analysisMode');
    const versions = unique('contentVersion'); const fingerprints = unique('contentFingerprint'); const difficulties = unique('difficultyTier');
    const conflict = levels.length !== 1 || modes.length !== 1 || versions.length > 1 || fingerprints.length > 1
      || values.some((event) => safeLevel(event) === 'unknown' || known(event.contentFingerprint) && !fingerprintKnown(event.contentFingerprint));
    metadata.set(id, { trusted: !conflict && values.every((event) => !risk(event)), conflict, puzzleKey: levels[0], analysisMode: modes[0],
      contentVersion: versions[0] ?? null, contentFingerprint: fingerprints[0] ?? null,
      difficultyTier: difficulties.length === 1 ? difficulties[0] : null, difficultyConflict: difficulties.length > 1 });
  }
  for (const event of events) if (event.attemptId) event.attemptMetadata = metadata.get(key(scope(event), event.attemptId));
  return metadata;
}
function prepare(records, options) {
  const quality = { records: records.length, invalidRecords: 0, excludedTestRecords: 0, missingSdkIdentity: 0,
    deliveryDuplicates: 0, conflictingDeliveries: 0, conflictingInstallDeliveryMetadata: 0, futureEventsExcluded: 0, unknownTimeEvents: 0,
    unknownConsentEvents: 0, clockAnomalyEvents: 0, invalidSdkRecords: 0, conflictingInstallEpisodes: 0,
    unknownInstallClassification: 0, eventsWithAmbiguousInstall: 0, eventsWithoutInstallEpisode: 0,
    duplicateWalletDeliveries: 0, conflictingWalletFacts: 0, missingWalletIdentity: 0, duplicateGrantEntitlements: 0, unresolvedRewardWalletFacts: 0, missingFlowIdentity: 0, excludedAdEvidence: 0 };
  const events = []; const excludedAdEvidence = []; const deliveries = new Map(); const conflictCopies = [];
  for (const raw of records) {
    let event; let sdkKind = null; let invalidSdkMetadata = false;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { quality.invalidRecords++; continue; }
    try { sdkKind = validateSdkRecordKind(raw); }
    catch { invalidSdkMetadata = true; quality.invalidSdkRecords++; }
    try { event = normalizeRecord(raw); }
    catch {
      if (!invalidSdkMetadata) { quality.invalidRecords++; continue; }
      // Invalid names/payloads remain private negative evidence. They cannot
      // acquire SDK exemptions, population units or consent-continuity status.
      event = normalizeRecord({ ...raw, event_name: raw.record_type === 'install' ? 'install' : 'session_start', name: undefined, event_json: undefined, params: undefined });
    }
    const excluded = event.isTest || TEST_ENVS.has(event.environment) || (sdkKind || invalidSdkMetadata) && TEST_ENVS.has(raw.environment)
      || [raw.is_qa, raw.is_qa_device, raw.is_test].some((value) => [true, 'true', 1, '1'].includes(value));
    if (excluded) {
      quality.excludedTestRecords++;
      if (event.name === 'ad_lifecycle' && event.sdkId && (event.emittedAtMs === null || event.emittedAtMs <= options.asOfMs)) {
        event.excludedFromPopulation = true; excludedAdEvidence.push(event); quality.excludedAdEvidence++;
      }
      continue;
    }
    if (!event.sdkId) { quality.missingSdkIdentity++; continue; }
    if (event.emittedAtMs !== null && event.emittedAtMs > options.asOfMs) { quality.futureEventsExcluded++; continue; }
    if (event.environment === null && raw.environment === 'production') event.environment = 'production';
    event.sdkMetadata = !invalidSdkMetadata && sdkKind !== null;
    if (invalidSdkMetadata) { event.invalidSdkMetadata = true; conflictCopies.push([event]); continue; }
    if (['experiment_assigned', 'experiment_exposed'].includes(event.name)) event.invalidFrozenQueryMetadata = invalidFrozenQueryMetadata(raw);
    if (at(event) === null) quality.unknownTimeEvents++;
    if (!event.sdkMetadata && event.consentState !== 'enabled') quality.unknownConsentEvents++;
    if (event.timeTrust === 'client_clock_anomaly') quality.clockAnomalyEvents++;
    const id = event.eventId ? key(event.sdkId, event.eventId) : null;
    // Ad recovery labels replay delivery; gameplay recovery still affects
    // voluntary-play provenance and remains part of its business signature.
    const signature = id ? createHash('sha256').update(key(...BUSINESS_FIELDS.map((field) => field === 'recovery' && event.name === 'ad_lifecycle' ? null : event[field]), event.timeMs === null, event.versionProvenance === 'invalid_origin')).digest('hex') : null;
    if (id && deliveries.has(id)) {
      const prior = deliveries.get(id);
      prior.copies ??= [{ ...prior.event }];
      prior.signatures ??= new Set([prior.signature]);
      prior.copies.push({ ...event });
      if (prior.signatures.has(signature)) quality.deliveryDuplicates++;
      else { prior.signatures.add(signature); prior.event.conflict = true; quality.conflictingDeliveries++; }
      continue;
    }
    if (id) deliveries.set(id, { event, signature });
    events.push(event);
  }
  for (const delivery of deliveries.values()) {
    if (!delivery.copies) continue;
    const installFields = ['installIdentity', 'installMs', 'installDay', 'installKind'];
    const metadataConflict = installFields.some((field) => new Set(delivery.copies.map((copy) => copy[field]).filter(known)).size > 1);
    if (delivery.event.conflict || metadataConflict) {
      // A deterministic index seed is never a legal proof. All actual copies
      // remain below for relevant identity, chronology and absence checks.
      const ordered = delivery.copies.map((copy) => ({ copy, order: key(...BUSINESS_FIELDS.map((field) => copy[field]), ...installFields.map((field) => copy[field])) }))
        .sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
      Object.assign(delivery.event, ordered[0].copy); delivery.event.conflict = delivery.signatures.size > 1;
    }
    for (const field of installFields) {
      const values = [...new Set(delivery.copies.map((copy) => copy[field]).filter(known))];
      if (values.length > 1) {
        delivery.event.installDeliveryAmbiguous = true; quality.conflictingInstallDeliveryMetadata += values.length - 1;
        // A first-delivered scope is not an authoritative choice. Keep all
        // alternatives privately and leave the population join ambiguous.
        delivery.event[field] = field === 'installKind' ? 'unknown' : null;
      } else if (values.length === 1) delivery.event[field] = values[0];
    }
    if (delivery.event.conflict || delivery.event.installDeliveryAmbiguous) {
      delivery.event.deliveryProofs = delivery.copies; conflictCopies.push(delivery.copies);
    }
  }
  const episodes = linkInstallEpisodes(events, quality);
  for (const event of events) if (event.installDeliveryAmbiguous && !event.installAmbiguous) { event.installAmbiguous = true; quality.eventsWithAmbiguousInstall++; }
  events.sort((a, b) => (at(a) ?? Infinity) - (at(b) ?? Infinity));
  const attemptEntries = indexAttemptEntries(events);
  const anchors = groupBy(events.filter((event) => !event.deliveryProofs && event.originInteractionId), (event) => key(event.sdkId, event.originInteractionId));
  for (const event of events.filter((item) => item.deliveryProofs && item.name !== 'hint_requested')) {
    const origins = [...new Set(event.deliveryProofs.map((copy) => copy.originInteractionId).filter(known))];
    const linked = origins.flatMap((origin) => anchors.get(key(event.sdkId, origin)) ?? []);
    const requested = linked.filter((item) => item.name === 'hint_requested' && item.interactionId === item.originInteractionId);
    const keys = [...new Set((requested.length ? requested : linked).filter((anchor) => event.deliveryProofs.some((copy) => possibleSameScope(copy, anchor, { episodes }))).map(flowKey))];
    // Exact independent origin links may locate untrusted evidence for a
    // negative check. This does not change its install scope or legal status.
    event.proofFlowKey = keys.length === 1 ? keys[0] : keys.length > 1 ? null : origins.length ? key(key(event.sdkId, null), ...origins.sort()) : null;
  }
  const flows = [...groupBy(events, flowKey).entries()].map(([id, values]) => {
    const originals = values.filter((event) => event.name === 'hint_requested' && event.interactionId === event.originInteractionId);
    const signatures = new Set(originals.map((event) => key(at(event), ...IDENTITY_FIELDS.map((field) => event[field]), event.levelId,
      event.displayedCost, event.balance, canonicalHint(event), event.isAvailable, event.alreadyOwned, event.previouslyCompleted, event.firstEligibleRequest, event.eligibilityVersion,
      event.measurementPhase, event.eligibilityEpoch, event.invalidMeasurementScope, event.trialPlanFingerprint, event.invalidTrialPlanFingerprint)));
    const origin = originals[0] ?? null;
    return { id, events: values, origin, sample: origin ?? values[0], originConflict: signatures.size > 1 || originals.some((event) => event.conflict) };
  });
  for (const event of events) if (['hint_requested', 'feature_exposed', 'wheel_opened', 'help_used'].includes(event.name) && !event.originInteractionId) quality.missingFlowIdentity++;
  const walletEvents = events.filter((event) => event.name === 'wallet_transaction');
  const walletGroups = [...groupBy(walletEvents, (event) => event.transactionId ? key(event.sdkId, event.transactionId) : null).values(), ...walletEvents.filter((event) => !event.transactionId).map((event) => [event])];
  const wallets = walletGroups.map((values) => {
    const event = { ...values[0] }; let conflict = values.some((item) => item.conflict);
    for (const field of WALLET_FIELDS) {
      const knownValues = [...new Set(values.map((item) => item[field]).filter(known))];
      if (knownValues.length > 1) conflict = true;
      else if (knownValues.length === 1) event[field] = knownValues[0];
    }
    if (new Set(values.map(scope)).size > 1 || new Set(values.map(at)).size > 1 || values.some((item) => item.levelIdSupplied && (!Number.isSafeInteger(item.levelId) || item.levelId <= 0)
      || item.dateKeySupplied && !item.analysisDateKey || known(item.puzzleKey) && known(item.analysisMode) && safeLevel(item) === 'unknown')) conflict = true;
    event.levelIdSupplied = values.some((item) => item.levelIdSupplied); event.dateKeySupplied = values.some((item) => item.dateKeySupplied);
    event.attemptMetadata = attemptEntries.get(key(scope(event), event.attemptId));
    event.conflict = conflict || values.some((item) => risk(item));
    quality.duplicateWalletDeliveries += values.length - 1;
    if (conflict) quality.conflictingWalletFacts++;
    if (!event.transactionId) quality.missingWalletIdentity++;
    const recordValid = !event.conflict && Boolean(event.transactionId) && event.currency !== null && event.delta !== null && event.delta !== 0
      && event.balanceBefore !== null && event.balanceAfter !== null && event.balanceBefore + event.delta === event.balanceAfter;
    return { event, copies: values, proofs: values.flatMap((copy) => copy.deliveryProofs ?? [copy]), conflict, recordValid, valid: recordValid && event.currency === 'coins' && event.delta > 0 };
  });
  const rewardWallets = wallets.filter((wallet) => wallet.proofs.some((event) => (event.currency === null || event.currency === 'coins')
    && (event.delta === null || event.delta > 0) && (event.rewardId || ['wheel', 'rewarded'].includes(event.source))));
  const rewards = groupBy(rewardWallets.filter((wallet) => wallet.valid && wallet.event.rewardId && knownInstallScope(wallet.event, { episodes }) !== null),
    (wallet) => key(knownInstallScope(wallet.event, { episodes }), wallet.event.rewardId));
  quality.duplicateGrantEntitlements = [...rewards.values()].filter((values) => new Set(values.map((wallet) => wallet.event.transactionId)).size > 1).length;
  quality.unresolvedRewardWalletFacts = rewardWallets.filter((wallet) => knownInstallScope(wallet.event, { episodes }) === null).length;
  return { events, excludedAdEvidence, episodes, flows, wallets, rewardWallets, quality,
    deliveryConflicts: groupBy(conflictCopies, (copies) => copies[0].sdkId) };
}

function flowChannel(flow, rewardId = null) {
  const events = flow.events.filter((event) => !rewardId || event.rewardId === rewardId);
  const types = new Set(events.map((event) => event.freeOrRewarded).filter(known));
  if (events.some((event) => event.name === 'ad_lifecycle' && event.stage === 'reward' && event.format === 'rewarded')) types.add('rewarded');
  if (events.some((event) => event.name === 'wallet_transaction' && event.source === 'rewarded' && event.currency === 'coins' && event.delta > 0)) types.add('rewarded');
  return types.size > 1 ? 'mixed' : [...types][0] ?? 'unknown';
}
function firstGrant(flow, context) {
  const anchor = flow.origin ?? flow.sample;
  const proofRewards = new Set(flow.events.filter((event) => event.rewardId && (event.name === 'wheel_spin_result'
    || event.name === 'ad_lifecycle' && ['reward', 'grant_persisted'].includes(event.stage) || event.name === 'reward_granted')).map((event) => event.rewardId));
  const credit = (event) => (event.currency === null || event.currency === 'coins') && (event.delta === null || event.delta > 0)
    && (['wheel', 'rewarded'].includes(event.source) || proofRewards.has(event.rewardId));
  const origin = (event) => Boolean(event.originInteractionId && event.originInteractionId === anchor.originInteractionId);
  const candidates = context.wallets.filter((wallet) => wallet.proofs.some((event) => possibleSameScope(event, anchor, context))
    && wallet.proofs.some(origin) && wallet.proofs.some(credit));
  const uncertainGrant = possibleConflict(context, anchor, [(event) => event.name === 'wallet_transaction', origin, credit]);
  const grants = candidates.filter((wallet) => wallet.valid);
  if (!candidates.length) return { state: uncertainGrant ? 'unknown' : 'absent', event: null,
    reason: uncertainGrant ? 'conflicting_or_unproven_grant' : null, grants: 0, laterGrants: 0, channel: 'unknown' };
  const chronologicalConflict = candidates.some((wallet) => !flow.origin || at(flow.origin) === null || at(wallet.event) === null || at(wallet.event) < at(flow.origin)
    || flow.events.some((event) => event.name === 'ad_lifecycle' && event.stage === 'reward' && event.rewardId === wallet.event.rewardId
      && (risk(event) || sameAttempt(flow.origin, event) !== true || at(event) < at(flow.origin) || at(event) > at(wallet.event))));
  if (uncertainGrant || candidates.some((wallet) => !wallet.valid || !wallet.event.rewardId || risk(wallet.event)
    || flow.origin && sameAttempt(flow.origin, wallet.event) !== true) || chronologicalConflict) return { state: 'unknown', event: grants[0]?.event ?? candidates[0].event,
      reason: chronologicalConflict ? 'grant_origin_or_earned_chronology_conflict' : 'conflicting_or_unproven_grant', grants: grants.length, laterGrants: Math.max(0, grants.length - 1), channel: 'unknown' };
  grants.sort((a, b) => at(a.event) - at(b.event));
  const first = grants[0].event;
  const tied = grants.filter((wallet) => at(wallet.event) === at(first));
  return { state: tied.length > 1 ? 'tied' : 'known', event: first, grants: grants.length,
    laterGrants: Math.max(0, grants.length - 1), channel: tied.length > 1 ? 'mixed' : flowChannel(flow, first.rewardId) };
}

function wheelEntry(context, period) {
  const rows = []; const players = new Map();
  for (const event of context.events) if (event.name === 'feature_exposed' && event.feature === 'wheel_entry' && event.modalId && !event.originInteractionId && belongs(event, period)) rows.push(observation(event, 'unproven', null, 'missing_origin_flow_identity',
    { entryElement: event.elementId, channel: event.freeOrRewarded ?? (event.elementId === 'free_wheel' ? 'free' : 'unknown') }));
  for (const flow of context.flows) {
    const exposures = flow.events.filter((event) => event.name === 'feature_exposed' && event.feature === 'wheel_entry' && ENTRY_ELEMENTS.has(event.elementId) && belongs(event, period));
    const qualified = exposures.filter((event) => event.isAvailable === true && event.visibilityRule === passport.exposure.rule && event.visibilityMs >= passport.exposure.minimumVisibilityMs && event.visibleFraction >= passport.exposure.minimumVisibleFraction && event.modalId);
    if (!qualified.length) {
      if (exposures.some((event) => event.isAvailable === null || !event.modalId || event.visibilityMs === null || event.visibleFraction === null)) rows.push(observation(exposures[0], 'unproven', null, 'missing_exposure_contract'));
      continue;
    }
    const anchor = qualified[0]; let success = false; let terminal = false;
    let unknown = flow.originConflict || !flow.origin || Boolean(flow.origin && risk(flow.origin))
      || qualified.some((event) => risk(event) || !flow.origin || sameAttempt(flow.origin, event) !== true);
    const options = new Set(qualified.map((event) => event.elementId));
    const channels = new Set(qualified.map((event) => event.freeOrRewarded ?? (event.elementId === 'free_wheel' ? 'free' : 'unknown')));
    const diagnostic = { entryElement: options.size === 1 ? [...options][0] : 'mixed',
      channel: channels.has('unknown') ? 'unknown' : channels.size > 1 ? 'mixed' : [...channels][0] };
    for (const exposure of qualified) {
      const modal = flow.events.filter((event) => event.modalId === exposure.modalId);
      const closes = modal.filter((event) => event.name === 'no_coins_action' && event.action === 'close');
      const close = closes.filter((event) => at(event) !== null && at(event) >= at(exposure)).map(at).sort((a, b) => a - b)[0] ?? Infinity;
      if (close !== Infinity) terminal = true;
      if (closes.some((event) => risk(event))) unknown = true;
      const taps = modal.filter((event) => event.name === 'no_coins_action' && event.action === exposure.elementId && event.outcome === 'selected'
        && at(event) !== null && at(event) >= at(exposure) && at(event) < close);
      const modalOpens = modal.filter((event) => event.name === 'wheel_opened' && (at(event) === null || at(event) >= at(exposure) && at(event) < close));
      if (taps.some((event) => !event.interactionId || risk(event) || !flow.origin || sameAttempt(flow.origin, event) !== true || sameAttempt(exposure, event) !== true)
        || modalOpens.some((event) => at(event) === null || !event.interactionId || risk(event) || !flow.origin || sameAttempt(flow.origin, event) !== true
          || sameAttempt(exposure, event) !== true || !taps.some((tap) => tap.interactionId === event.interactionId && at(tap) <= at(event)))) unknown = true;
      for (const tap of taps) {
        const opened = modal.filter((event) => event.name === 'wheel_opened' && event.interactionId && event.interactionId === tap.interactionId
          && at(event) !== null && at(event) >= at(tap) && at(event) < close);
        if (opened.some((event) => sameAttempt(tap, event) !== true)) unknown = true;
        if (flow.origin && !risk(tap) && sameAttempt(flow.origin, tap) === true && sameAttempt(exposure, tap) === true
          && opened.some((event) => !risk(event) && sameAttempt(flow.origin, event) === true && sameAttempt(exposure, event) === true && sameAttempt(tap, event) === true)) { success = true; terminal = true; }
      }
      if (flow.events.some((event) => event.name === 'help_used' && at(event) !== null && at(event) >= at(exposure))) terminal = true;
    }
    const row = observation(flow.origin ?? anchor, unknown ? 'unknown' : terminal ? 'mature' : 'open', unknown ? null : success, unknown ? 'unknown_origin_entry_chain_or_modal_order' : terminal ? null : 'open_modal_window', diagnostic);
    rows.push(row);
    if (!players.has(anchor.sdkId)) players.set(anchor.sdkId, []); players.get(anchor.sdkId).push(row);
  }
  const playerRows = [...players.values()].map((values) => observation(values[0].event,
    values.some((row) => row.state === 'unknown') ? 'unknown' : values.some((row) => row.state === 'open') ? 'open' : 'mature', values.some((row) => row.success === true)));
  return { ...summarize(rows, period, context.episodes), uniquePlayerDiagnostic: summarize(playerRows, period, context.episodes) };
}

function readiness(context, period, surface) {
  const isModal = surface === 'noCoins';
  const relevant = context.events.filter((event) => isModal ? event.name === 'no_coins_shown'
    || event.name === 'ui_action' && event.elementId === 'no_coins' : event.name === 'wheel_opened' || event.name === 'ui_action' && event.screen === 'wheel');
  const entries = relevant.filter((event) => isModal ? event.name === 'no_coins_shown' || event.action === 'resume' : event.name === 'wheel_opened');
  const entryGroups = groupBy(entries, (event) => key(scope(event), isModal ? event.modalId : event.screenVisitId, isModal ? at(event) : null));
  const rows = []; const waits = []; let exitedBeforeReady = 0; let openWaits = 0; let unknownWaits = 0;
  const seen = new Set();
  for (const entry of entries.filter((event) => belongs(event, period))) {
    const visitId = isModal ? entry.modalId : entry.screenVisitId;
    const id = key(scope(entry), visitId, isModal ? at(entry) : null);
    if (seen.has(id)) continue; seen.add(id);
    const copies = entryGroups.get(id) ?? [];
    const ambiguous = new Set(copies.map((event) => key(at(event), event.readyAtEntry, event.rewardedEligible, event.rewardedState, event.name,
      ...IDENTITY_FIELDS.map((field) => event[field]), flowKey(event), event.entrySource))).size > 1;
    const copyRisk = copies.map((event) => risk(event)).find(Boolean);
    const identityWhy = copyRisk ?? (ambiguous ? 'ambiguous_entry_visit' : !visitId ? 'missing_visit_identity' : null);
    if (!identityWhy && copies.every((event) => event.rewardedEligible === false)) { rows.push(observation(entry, 'ineligible', false, 'rewarded_ineligible', { channel: 'rewarded' })); continue; }
    const why = identityWhy ?? (entry.rewardedEligible === null ? 'unknown_eligibility'
      : entry.readyAtEntry === null || (entry.readyAtEntry !== (entry.rewardedState === 'ready')) ? 'unknown_entry_readiness' : null);
    rows.push(observation(entry, why ? 'unproven' : 'mature', why ? null : entry.readyAtEntry, why, { channel: 'rewarded' }));
    if (why) { unknownWaits++; continue; }
    if (entry.readyAtEntry) { waits.push(0); continue; }
    const nextEntry = entries.find((event) => scope(event) === scope(entry) && (isModal ? event.modalId : event.screenVisitId) === visitId && at(event) > at(entry));
    const end = nextEntry ? at(nextEntry) : Infinity;
    const after = relevant.filter((event) => scope(event) === scope(entry) && (isModal ? event.modalId : event.screenVisitId) === visitId
      && at(event) !== null && at(event) >= at(entry) && at(event) < end && event.name === 'ui_action');
    const ready = after.find((event) => event.action === 'ready'); const exit = after.find((event) => event.action === 'exit');
    if (ready && (!exit || at(ready) <= at(exit))) {
      if (risk(ready)) unknownWaits++; else waits.push(ready.waitMs ?? at(ready) - at(entry));
    } else if (exit) { if (risk(exit)) unknownWaits++; else exitedBeforeReady++; }
    else openWaits++;
  }
  waits.sort((a, b) => a - b);
  const q = (p) => waits.length ? waits[Math.floor((waits.length - 1) * p)] : null;
  return { ...summarize(rows, period, context.episodes), waitToReadyMs: { completed: waits.length, p50: q(0.5), p90: q(0.9), exitedBeforeReady, openWaits, unknownWaits,
    rule: 'entry zero or actual ready callback; exit duration never substituted after readiness' } };
}

function showOperations(context, period) {
  const events = [...context.events, ...context.excludedAdEvidence].filter((event) => event.name === 'ad_lifecycle');
  const groups = groupBy(events, (event) => event.requestId && event.opportunityId ? key(event.sdkId, event.opportunityId, event.requestId) : null);
  const rows = []; let terminalFailures = 0; let orphanShown = 0; let conflictingSemanticIntents = 0;
  for (const values of groups.values()) {
    const intents = values.filter((event) => event.stage === 'show_intent');
    const accepted = intents.filter((event) => !event.excludedFromPopulation && event.format === 'rewarded' && event.operation === 'show' && event.outcome === 'accepted');
    if (!accepted.length) { orphanShown += values.filter((event) => !event.excludedFromPopulation && event.format === 'rewarded' && event.stage === 'shown' && belongs(event, period)).length; continue; }
    if (!accepted.some((event) => belongs(event, period))) continue;
    const origin = reconcileAdCopies(intents);
    if (origin.semanticConflict || PROVENANCE_FLAGS.some((field) => origin[field])) conflictingSemanticIntents++;
    const callbacks = values.filter((event) => ['shown', 'closed'].includes(event.stage) || event.stage === 'error' && (event.operation === 'show' || known(origin.operationId) && event.operationId === origin.operationId));
    const linkedRaw = callbacks.filter((event) => event.operation === 'show' && event.operationId && event.operationId === origin.operationId);
    const linked = [...groupBy(linkedRaw, (event) => key(event.stage, event.callbackId ?? event.originOccurrenceMs)).values()].map(reconcileAdCopies);
    const shown = linked.filter((event) => event.stage === 'shown');
    const terminal = linked.filter((event) => event.stage === 'closed' || event.stage === 'error');
    const orderUnknown = shown.some((event) => at(event) === null || at(event) < at(origin))
      || terminal.some((event) => at(event) === null || at(event) < at(origin));
    const firstTerminal = terminal.length ? Math.min(...terminal.map((event) => at(event) ?? -Infinity)) : Infinity;
    const terminalConflict = shown.some((event) => at(event) !== null && at(event) >= firstTerminal);
    const missingCallbackLink = callbacks.some((event) => event.operation !== 'show' || event.format !== 'rewarded' || !event.operationId || event.operationId !== origin.operationId);
    const why = risk(origin) ?? (!origin.operationId ? 'missing_operation_identity' : missingCallbackLink ? 'missing_callback_operation_link'
      : orderUnknown ? 'unknown_callback_order' : terminalConflict ? 'shown_at_or_after_terminal' : linked.some((event) => ['shown', 'closed', 'error'].includes(event.stage) && risk(event)) ? 'untrusted_show_callback' : null);
    const diagnostic = { channel: 'rewarded', placement: origin.placement ?? 'unknown' };
    if (why) rows.push(observation(origin, 'unknown', null, why, diagnostic));
    else if (shown.length) rows.push(observation(origin, 'mature', true, null, diagnostic));
    else if (terminal.length) { rows.push(observation(origin, 'mature', false, null, diagnostic)); terminalFailures++; }
    else rows.push(observation(origin, 'open', null, 'pending_show_operation', diagnostic));
  }
  for (const event of events) if (!event.excludedFromPopulation && event.format === 'rewarded' && event.stage === 'show_intent' && event.outcome === 'accepted' && belongs(event, period) && (!event.requestId || !event.opportunityId)) rows.push(observation(event, 'unproven', null, 'missing_request_identity', { channel: 'rewarded', placement: event.placement ?? 'unknown' }));
  const result = summarize(rows, period, context.episodes);
  // All accepted intents are the declared denominator. Pending outcomes remain
  // in that denominator as unknown, rather than disappearing into terminal-only rates.
  result.acceptedIntents = rows.length;
  result.allAccepted = { numerator: result.numerator, denominator: rows.length,
    rate: rows.length && !result.openUnits && !result.unknownUnits && !result.unprovenDenominatorUnits ? result.numerator / rows.length : null,
    bounds: rows.length ? { lower: result.numerator / rows.length,
      upper: (result.numerator + result.openUnits + result.unknownUnits + result.unprovenDenominatorUnits) / rows.length } : null };
  result.terminalFailures = terminalFailures; result.orphanShownCallbacks = orphanShown; result.conflictingSemanticIntents = conflictingSemanticIntents;
  return { ...result, denominator: rows.length, rate: result.allAccepted.rate, bounds: result.allAccepted.bounds };
}

function earnedGrants(context, period) {
  const earned = [...context.events, ...context.excludedAdEvidence].filter((event) => event.name === 'ad_lifecycle' && event.stage === 'reward');
  const groups = groupBy(earned, (event) => event.rewardId ? key(event.sdkId, event.rewardId) : null);
  const rows = []; const diagnostic = { duplicateEarnedDeliveries: 0, earlyConfirmedImmature: 0, matureWithoutGrant: 0, lateGrant: 0, duplicateGrant: 0, unconfirmedWalletFacts: 0, conflictingSemanticEntitlements: 0 };
  for (const values of groups.values()) {
    if (!values.some((event) => !event.excludedFromPopulation && event.format === 'rewarded' && belongs(event, period))) continue;
    const origin = reconcileAdCopies(values);
    diagnostic.duplicateEarnedDeliveries += values.length - 1;
    if (origin.semanticConflict || PROVENANCE_FLAGS.some((field) => origin[field])) diagnostic.conflictingSemanticEntitlements++;
    const reward = (event) => event.rewardId === origin.rewardId
      || !event.rewardId && origin.originInteractionId && event.originInteractionId === origin.originInteractionId
        && (event.currency === null || event.currency === 'coins') && (event.delta === null || event.delta > 0);
    const wallets = context.wallets.filter((wallet) => wallet.proofs.some((event) => possibleSameScope(event, origin, context)) && wallet.proofs.some(reward));
    const uncertainWallet = possibleConflict(context, origin, [(event) => event.name === 'wallet_transaction', reward]);
    const before = wallets.filter((wallet) => wallet.valid && at(wallet.event) !== null && at(origin) !== null && at(wallet.event) < at(origin));
    const within = wallets.filter((wallet) => at(wallet.event) !== null && at(origin) !== null && at(wallet.event) >= at(origin) && at(wallet.event) <= at(origin) + GRANT);
    const valid = within.filter((wallet) => wallet.valid && !risk(wallet.event));
    const late = wallets.filter((wallet) => wallet.valid && at(wallet.event) !== null && at(origin) !== null && at(wallet.event) > at(origin) + GRANT);
    diagnostic.lateGrant += late.length;
    const originScope = knownInstallScope(origin, context);
    const anchorWhy = risk(origin) ?? (!origin.requestId || !origin.opportunityId ? 'missing_earned_operation_identity'
      : originScope === null ? 'unknown_earned_install_scope' : null);
    // Additional uncertainty cannot restore exactly one after two independent
    // exact credits are proved. Possible scope matches are not such proofs.
    const exactCreditMatch = (wallet) => originScope !== null && knownInstallScope(wallet.event, context) === originScope && wallet.event.rewardId === origin.rewardId;
    const proven = valid.filter((wallet) => exactCreditMatch(wallet)
      && (!origin.originInteractionId || wallet.event.originInteractionId === origin.originInteractionId));
    const duplicate = !anchorWhy && new Set(proven.map((wallet) => wallet.event.transactionId)).size > 1;
    const unprovenCreditMatch = valid.some((wallet) => !exactCreditMatch(wallet));
    if (duplicate) diagnostic.duplicateGrant++;
    const mismatch = wallets.some((wallet) => origin.originInteractionId && wallet.event.originInteractionId !== origin.originInteractionId);
    const diagnosticDimensions = { channel: 'rewarded', placement: origin.placement ?? 'unknown' };
    const why = anchorWhy ?? (uncertainWallet || unprovenCreditMatch || wallets.some((wallet) => wallet.conflict || at(wallet.event) === null || !wallet.recordValid || !wallet.event.rewardId || risk(wallet.event)) ? 'unconfirmed_wallet_fact'
      : before.length ? 'grant_before_earned' : mismatch ? 'reward_origin_mismatch' : null);
    if (!risk(origin) && at(origin) + GRANT > context.options.asOfMs) {
      rows.push(observation(origin, 'immature', null, 'earned_window_immature', diagnosticDimensions));
      if (valid.length) diagnostic.earlyConfirmedImmature++;
    } else if (duplicate) rows.push(observation(origin, 'mature', false, 'duplicate_grant', diagnosticDimensions));
    else if (why) { rows.push(observation(origin, 'unknown', null, why, diagnosticDimensions)); diagnostic.unconfirmedWalletFacts++; }
    else {
      const gap = !valid.length ? absenceConsentGap(context, origin, at(origin), at(origin) + GRANT) : null;
      rows.push(observation(origin, gap ? 'unknown' : 'mature', gap ? null : valid.length === 1 && !duplicate, gap ?? (duplicate ? 'duplicate_grant' : null), diagnosticDimensions));
      if (!valid.length && !gap) diagnostic.matureWithoutGrant++;
    }
  }
  for (const event of earned) if (!event.excludedFromPopulation && event.format === 'rewarded' && !event.rewardId && belongs(event, period)) rows.push(observation(event, 'unproven', null, 'missing_reward_identity', { channel: 'rewarded', placement: event.placement ?? 'unknown' }));
  return { ...summarize(rows, period, context.episodes), diagnostic };
}

function originDeficit(flow) {
  const origin = flow.origin;
  return origin && !flow.originConflict && !risk(origin) && validAttempt(origin) && origin.isAvailable === true
    && origin.displayedCost !== null && origin.balance !== null && origin.displayedCost > origin.balance
    && origin.displayedCost > 0 && origin.alreadyOwned === false && canonicalHint(origin) !== 'unknown';
}
function deficitBand(origin) {
  if (!origin || origin.displayedCost === null || origin.balance === null || origin.displayedCost <= 0) return 'unknown';
  const ratio = (origin.displayedCost - origin.balance) / origin.displayedCost;
  return ratio > 0 && ratio <= 1 ? passport.deficitBands[passport.deficitFractionUpperBounds.findIndex((upper) => ratio <= upper)] : 'unknown';
}
function flowOutcomes(context, period) {
  const sufficiency = []; const returnHelp = [];
  const diagnostic = { noConfirmedGrantFlows: 0, laterGrants: 0, multipleGrantFlows: 0, unknownFirstGrantFlows: 0,
    sameTimestampFirstGrants: 0, crossedPriceAtFirstGrant: 0, directInPlaceUses: 0, navigationUses: 0, actualArrivalUses: 0 };
  for (const flow of context.flows) {
    const first = firstGrant(flow, context); const anchor = flow.origin ?? flow.sample;
    if (!belongs(first.state === 'unknown' ? anchor : first.event ?? anchor, period)) continue;
    if (first.state === 'absent') { diagnostic.noConfirmedGrantFlows++; continue; }
    diagnostic.laterGrants += first.laterGrants;
    if (first.grants > 1) diagnostic.multipleGrantFlows++;
    if (first.state === 'unknown') diagnostic.unknownFirstGrantFlows++;
    if (first.state === 'tied') diagnostic.sameTimestampFirstGrants++;
    const why = !originDeficit(flow) ? 'unknown_original_deficit_or_attempt' : first.state !== 'known' ? first.reason ?? 'ambiguous_first_grant' : null;
    sufficiency.push(observation(anchor, why ? 'unknown' : 'mature', why ? null : first.event.balanceAfter >= flow.origin.displayedCost, why,
      { channel: first.channel, deficitBand: deficitBand(flow.origin) }));
    if (!why && first.event.balanceBefore < flow.origin.displayedCost && first.event.balanceAfter >= flow.origin.displayedCost) diagnostic.crossedPriceAtFirstGrant++;
    const timingUnknown = first.state !== 'known' || !flow.origin || !validAttempt(flow.origin) || at(first.event) === null || flow.originConflict;
    if (timingUnknown) { returnHelp.push(observation(anchor, 'unknown', null, first.reason ?? 'ambiguous_first_grant_or_origin', { channel: first.channel })); continue; }
    const deadline = at(first.event) + HELP;
    if (deadline > context.options.asOfMs) { returnHelp.push(observation(anchor, 'immature', null, 'grant_window_immature', { channel: first.channel })); continue; }
    const possibleUses = flow.events.filter((event) => event.name === 'help_used');
    const uses = possibleUses.filter((event) => canonicalHint(event) === canonicalHint(flow.origin) && sameAttempt(flow.origin, event) === true);
    const unknownUse = possibleUses.some((event) => sameAttempt(flow.origin, event) === null || canonicalHint(event) === 'unknown') || uses.some((event) => risk(event) || at(event) === null)
      || possibleConflict(context, flow.origin, [(event) => event.name === 'help_used', (event) => event.originInteractionId === flow.origin.originInteractionId,
        (event) => sameAttempt(flow.origin, { ...event, installKey: flow.origin.installKey }) !== false,
        (event) => canonicalHint(event) === 'unknown' || canonicalHint(event) === canonicalHint(flow.origin)]);
    const eligibleUses = uses.filter((event) => !risk(event) && at(event) >= at(first.event) && at(event) <= deadline);
    let success = false; let provenanceUnknown = false;
    for (const use of eligibleUses) {
      const before = flow.events.filter((event) => !risk(event) && at(event) >= at(first.event) && at(event) <= at(use) && sameAttempt(flow.origin, event) === true && event.name === 'ui_action');
      const arrived = before.some((event) => event.elementId === 'help_origin' && event.action === 'arrive' && event.outcome === 'returned');
      const returned = before.some((event) => event.action === 'return' && event.outcome === 'accepted' && ['wheel', 'home'].includes(event.screen));
      const wheelReward = first.event.source === 'wheel' || flow.events.some((event) => event.rewardId === first.event.rewardId && (event.name === 'wheel_spin_result' || event.placement === 'wheel'));
      const direct = !wheelReward && first.event.source === 'rewarded' && use.source === 'explicit' && use.entrySource === 'no_coins';
      if (arrived || returned || direct) {
        success = true;
        if (arrived) diagnostic.actualArrivalUses++; else if (direct) diagnostic.directInPlaceUses++; else diagnostic.navigationUses++;
        break;
      }
      provenanceUnknown = true;
    }
    const whyReturn = risk(flow.origin) ?? (!success ? unknownUse ? 'unknown_help_occurrence_or_context' : provenanceUnknown ? 'unknown_arrival_provenance'
      : absenceConsentGap(context, first.event, at(first.event), deadline) : null);
    returnHelp.push(observation(anchor, whyReturn ? 'unknown' : 'mature', whyReturn ? null : success, whyReturn, { channel: first.channel }));
  }
  const suff = summarize(sufficiency, period, context.episodes);
  suff.deficitBands = [...groupBy(sufficiency, (row) => row.deficitBand).entries()].map(([band, rows]) => ({ band, ...summarize(rows, period, context.episodes, false) }));
  return { sufficiency: suff, returnHelp: summarize(returnHelp, period, context.episodes), diagnostic };
}

function completionOutcome(flow, context, deadline) {
  const origin = flow.origin;
  const candidates = context.events.filter((event) => event.name === 'puzzle_completed' && event.sdkId === origin.sdkId && (event.attemptId === origin.attemptId
    || flowKey(event) === flow.id || !event.attemptId && event.puzzleKey === origin.puzzleKey));
  if (risk(origin) || !validAttempt(origin) || flow.originConflict) return { success: null, reason: 'unknown_origin_attempt_or_clock' };
  const episode = context.episodes.find((item) => item.sdkId === origin.sdkId && item.key === origin.installKey);
  if (episode && episode.endMs < deadline) return { success: null, reason: 'install_boundary' };
  const completed = candidates.some((event) => sameAttempt(origin, event) === true && !risk(event) && at(event) >= at(origin) && at(event) <= deadline);
  if (completed) return { success: true, reason: null };
  if (candidates.some((event) => sameAttempt(origin, event) === null || sameAttempt(origin, event) === true && risk(event)
    || event.attemptId === origin.attemptId && sameAttempt(origin, event) === false)
    || possibleConflict(context, origin, [(event) => event.name === 'puzzle_completed', (event) => event.attemptId === origin.attemptId
      || event.originInteractionId === origin.originInteractionId || !event.attemptId && event.puzzleKey === origin.puzzleKey])) return { success: null, reason: 'unknown_completion_occurrence_or_context' };
  const gap = absenceConsentGap(context, origin, at(origin), deadline);
  if (gap) return { success: null, reason: gap };
  return { success: false, reason: null };
}
function prospectiveAssignmentReason(flow, assignments, exposures, context) {
  const origin = flow.origin; const start = at(origin);
  if (assignments.some((event) => at(event) !== start || event.originOccurrenceMs !== origin.originOccurrenceMs)) return 'assignment_not_at_first_request_transaction';
  if (exposures.some((event) => at(event) === null || at(event) <= start)) return 'exposure_not_proven_after_assignment';
  const treatmentNames = new Set(['no_coins_shown', 'feature_exposed', 'no_coins_action', 'wheel_opened', 'wheel_spin_started', 'ad_lifecycle', 'wallet_transaction', 'help_used']);
  if (flow.events.some((event) => treatmentNames.has(event.name) && (at(event) === null || at(event) <= start))) return 'treatment_not_proven_after_assignment';
  if (context.events.some((event) => event.name === 'puzzle_completed' && event.sdkId === origin.sdkId && event.attemptId === origin.attemptId
    && (at(event) === null || at(event) <= start))) return 'outcome_not_proven_after_assignment';
  return null;
}
function enrollmentTiming(options = {}) {
  if (typeof options.asOf !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(options.asOf) || !Number.isFinite(Date.parse(options.asOf))) throw new Error('Explicit asOf UTC/offset is required.');
  let offset = 0;
  if (!['UTC', 'Z'].includes(options.timezone)) {
    const match = /^(?:UTC)?([+-])(\d{2}):(\d{2})$/.exec(options.timezone ?? '');
    if (!match || Number(match[2]) > 14 || Number(match[3]) > 59 || Number(match[2]) === 14 && Number(match[3]) !== 0) throw new Error('Explicit valid fixed timezone is required.');
    offset = (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  }
  if (!['synthetic', 'observation', 'production'].includes(options.source ?? 'observation')) throw new Error('Invalid source.');
  return { ...options, source: options.source ?? 'observation', offset, asOfMs: Date.parse(options.asOf) };
}
function enrollmentSpec(spec, period = null) {
  const safe = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,191}$/i.test(value);
  const time = (value) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
  if (!spec || spec.experimentId !== passport.experiment.id || spec.eligibilityVersion !== passport.experiment.eligibilityVersion
    || !['baseline', 'trial'].includes(spec.phase) || !safe(spec.eligibilityEpoch)
    || !(time(spec.enrollmentFrom) < time(spec.enrollmentToExclusive))
    || spec.phase === 'trial' && (!Number.isSafeInteger(spec.allocationVersion) || spec.allocationVersion <= 0)
    || spec.phase === 'trial' && !(typeof spec.trialPlanFingerprint === 'string' && /^[a-f0-9]{32}$/.test(spec.trialPlanFingerprint))
    || spec.primaryWindowMinutes !== null && spec.primaryWindowMinutes !== 10
    || spec.phase === 'trial' && spec.primaryWindowMinutes === null) throw new Error('Invalid or unsupported declared enrollment scope/window.');
  return { ...spec, scopeStartMs: time(spec.enrollmentFrom), scopeEndMs: time(spec.enrollmentToExclusive),
    startMs: Math.max(time(spec.enrollmentFrom), period?.startMs ?? -Infinity), endMs: Math.min(time(spec.enrollmentToExclusive), period?.endMs ?? Infinity),
    primaryWindowMs: spec.primaryWindowMinutes === null ? null : spec.primaryWindowMinutes * 60000,
    deliveryLagMs: Number.isSafeInteger(spec.deliveryLagMs) && spec.deliveryLagMs >= 0 ? spec.deliveryLagMs : 0 };
}
const eventProofs = (event) => event.deliveryProofs ?? [event];
function enrollmentMembership(event, spec, name, fullRange = false) {
  if (!fullRange && spec.startMs >= spec.endMs) return 'outside';
  const states = eventProofs(event).map((copy) => {
    if (copy.name !== name || name !== 'hint_requested' && known(copy.experimentId) && copy.experimentId !== spec.experimentId) return 'outside';
    if (known(copy.measurementPhase) && copy.measurementPhase !== spec.phase || known(copy.eligibilityEpoch) && copy.eligibilityEpoch !== spec.eligibilityEpoch) return 'outside';
    if (at(copy) !== null && (at(copy) < (fullRange ? spec.scopeStartMs : spec.startMs) || at(copy) >= (fullRange ? spec.scopeEndMs : spec.endMs))) return 'outside';
    if (copy.invalidMeasurementScope || copy.measurementPhase !== spec.phase || copy.eligibilityEpoch !== spec.eligibilityEpoch
      || copy.eligibilityVersion !== spec.eligibilityVersion || at(copy) === null
      || name !== 'hint_requested' && copy.experimentId !== spec.experimentId
      || name === 'experiment_assigned' && (copy.unitType !== 'sdk_player' || spec.phase === 'trial' && copy.allocationVersion !== spec.allocationVersion)) return 'possible';
    return 'certain';
  });
  return states.every((state) => state === 'outside') ? 'outside' : states.every((state) => state === 'certain') ? 'certain' : 'possible';
}
function scopedEligibility(flow, context, spec, claimCount) {
  const origin = flow?.origin;
  if (!origin || !originDeficit(flow)) return 'unknown_eligible_request_context';
  if (Array.isArray(spec.acceptedOriginVersions) && (origin.versionProvenance !== 'origin_envelope' || !spec.acceptedOriginVersions.includes(origin.analysisAppVersion))) return 'unsupported_origin_producer_version';
  if (origin.previouslyCompleted !== false) return 'unknown_prior_completion';
  if (origin.firstEligibleRequest !== true || origin.eligibilityVersion !== spec.eligibilityVersion) return 'unproven_first_eligibility';
  if (origin.measurementPhase !== spec.phase || origin.eligibilityEpoch !== spec.eligibilityEpoch || origin.invalidMeasurementScope) return 'unproven_phase_or_epoch';
  if (spec.phase === 'trial' && (origin.invalidTrialPlanFingerprint || origin.trialPlanFingerprint !== spec.trialPlanFingerprint)) return 'missing_or_mismatched_trial_plan';
  if (claimCount !== 1) return 'conflicting_first_eligible_claims';
  if (context.events.some((event) => event.name === 'puzzle_completed' && event.sdkId === origin.sdkId && event.puzzleKey === origin.puzzleKey && at(event) !== null && at(event) < at(origin))) return 'prior_completion_conflicts_with_eligibility';
  const rejections = flow.events.filter((event) => event.name === 'hint_rejected' && event.interactionId === origin.interactionId);
  const rejected = rejections.length ? reconcileProofCopies(rejections, [...ENROLLMENT_PROOF_FIELDS, 'reason']) : null;
  if (!rejected || rejected.reason !== 'insufficient_coins' || risk(rejected) || sameAttempt(origin, rejected) !== true
    || at(rejected) < at(origin) || rejected.measurementPhase !== spec.phase || rejected.eligibilityEpoch !== spec.eligibilityEpoch
    || spec.phase === 'trial' && (rejected.invalidTrialPlanFingerprint || rejected.trialPlanFingerprint !== spec.trialPlanFingerprint)) return 'unproven_insufficient_request';
  return null;
}
function enrollmentCounts(rows, period, context) {
  const result = summarize(rows, period, context.episodes);
  return { ...result, assignedUnits: rows.length, matureN: result.denominator, successes: result.numerator,
    knownFailures: result.knownOutcomeUnits - result.numerator, unknownOutcomes: result.unknownUnits,
    unknownMaturityUnits: rows.filter((row) => row.unknownMaturity).length };
}
function frozenQueryReason(origin, event, context, requireOriginalInteraction = false) {
  if (event.invalidFrozenQueryMetadata || risk(event) || sameAttempt(origin, event) !== true || knownInstallScope(origin, context) === null
    || knownInstallScope(event, context) !== knownInstallScope(origin, context)) return 'unproven_assignment_original_attempt';
  if (event.originInteractionId !== origin.originInteractionId
    || requireOriginalInteraction && known(event.interactionId) && event.interactionId !== origin.interactionId) return 'conflicting_assignment_original_identity';
  // Runtime assignment/exposure emit canonical origin, not another quote.
  // If optional immutable hint/quote context is supplied, it must agree.
  if (known(event.hintType) && canonicalHint(event) !== canonicalHint(origin)
    || ['displayedCost', 'balance', 'entrySource', 'previouslyCompleted'].some((field) => known(event[field]) && event[field] !== origin[field])) return 'conflicting_assignment_original_query';
  return null;
}
function invalidFrozenQueryMetadata(raw) {
  let payload = raw.event_json ?? raw.params ?? {}; if (typeof payload === 'string') payload = JSON.parse(payload);
  const properties = payload?.schema_version === 2 && objectPayload(payload.properties) ? payload.properties : payload;
  if (!objectPayload(properties)) return true;
  const supplied = (field) => properties[field] !== undefined;
  if (['displayed_cost', 'balance'].some((field) => supplied(field) && (!Number.isSafeInteger(properties[field]) || properties[field] < 0))) return true;
  if (['origin_interaction_id', 'interaction_id', 'assignment_id'].some((field) => supplied(field)
    && (typeof properties[field] !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(properties[field])))) return true;
  const hints = ['hint_type', 'requested_hint'].filter(supplied).map((field) => canonicalHint({ hintType: properties[field] }));
  return hints.includes('unknown') || new Set(hints).size > 1;
}
function authoritativeCheckoutWithin(fact, assignment, context, deadline) {
  const event = fact.event; const install = event && knownInstallScope(event, context);
  return Boolean(fact.trusted && event && !risk(assignment) && install !== null && install === knownInstallScope(assignment, context)
    && at(assignment) !== null && at(event) !== null && at(event) >= at(assignment) && at(event) <= deadline);
}
function analyzeEnrollmentScope(context, inputSpec, period = null) {
  const spec = enrollmentSpec(inputSpec, period); const range = { startMs: spec.startMs, endMs: spec.endMs };
  const originalFlows = context.flows.filter((flow) => flow.origin || eventProofs(flow.sample).some((copy) => copy.name === 'hint_requested'));
  const measurementFlows = originalFlows.filter((flow) => eventProofs(flow.origin ?? flow.sample).some((copy) => copy.firstEligibleRequest === true
    || copy.eligibilityVersion === spec.eligibilityVersion || copy.measurementPhaseSupplied || copy.eligibilityEpochSupplied));
  const selected = measurementFlows.map((flow) => ({ flow, membership: enrollmentMembership(flow.origin ?? flow.sample, spec, 'hint_requested') })).filter((item) => item.membership !== 'outside');
  const fullClaimGroups = groupBy(originalFlows.filter((flow) => enrollmentMembership(flow.origin ?? flow.sample, spec, 'hint_requested', true) === 'certain'
    && eventProofs(flow.origin ?? flow.sample).some((copy) => copy.firstEligibleRequest === true)), (flow) => flow.sample.sdkId);
  const claims = groupBy(selected.filter((item) => item.membership === 'certain' && eventProofs(item.flow.origin ?? item.flow.sample).some((copy) => copy.firstEligibleRequest === true)), (item) => item.flow.sample.sdkId);
  const possibleClaimUnits = new Set(selected.filter((item) => item.membership === 'possible').map((item) => item.flow.sample.sdkId));
  const missingFirstFlags = new Set(selected.filter((item) => item.membership === 'certain' && item.flow.origin?.firstEligibleRequest === null
    && item.flow.origin.previouslyCompleted === false && originDeficit(item.flow) && !fullClaimGroups.has(item.flow.sample.sdkId)).map((item) => item.flow.sample.sdkId));
  const assignmentCandidates = context.events.filter((event) => eventProofs(event).some((copy) => copy.name === 'experiment_assigned'
    && (copy.experimentId === spec.experimentId || !copy.experimentId && copy.eligibilityVersion === spec.eligibilityVersion)))
    .map((event) => ({ event, membership: enrollmentMembership(event, spec, 'experiment_assigned') })).filter((item) => item.membership !== 'outside');
  const groups = groupBy(assignmentCandidates.filter((item) => item.membership === 'certain'), (item) => item.event.sdkId);
  const fullAssignmentCandidates = context.events.filter((event) => eventProofs(event).some((copy) => copy.name === 'experiment_assigned' && copy.experimentId === spec.experimentId))
    .map((event) => ({ event, membership: enrollmentMembership(event, spec, 'experiment_assigned', true) })).filter((item) => item.membership !== 'outside');
  const fullAssignmentGroups = groupBy(fullAssignmentCandidates.filter((item) => item.membership === 'certain'), (item) => item.event.sdkId);
  const possibleAssignmentUnits = new Set(assignmentCandidates.filter((item) => item.membership === 'possible').map((item) => item.event.sdkId));
  const exposuresBySdk = groupBy(context.events.filter((event) => eventProofs(event).some((copy) => copy.name === 'experiment_exposed' && copy.experimentId === spec.experimentId
    && (!known(copy.measurementPhase) || copy.measurementPhase === spec.phase) && (!known(copy.eligibilityEpoch) || copy.eligibilityEpoch === spec.eligibilityEpoch))), (event) => event.sdkId);
  // Inspect every semantic first-request/rejection copy, not the deterministic
  // origin index seed. A matching first row cannot hide another plan's facts.
  const trialPlanFacts = spec.phase === 'trial' ? [
    ...selected.filter((item) => item.flow.events.some((event) => eventProofs(event).some((copy) => copy.name === 'hint_requested'
      && copy.interactionId === copy.originInteractionId && copy.firstEligibleRequest === true))).flatMap((item) => item.flow.events.filter((event) => eventProofs(event).some((copy) =>
      ['hint_requested', 'hint_rejected'].includes(copy.name) && copy.interactionId === copy.originInteractionId))),
    ...assignmentCandidates.map((item) => item.event), ...[...groups.keys()].flatMap((sdkId) => exposuresBySdk.get(sdkId) ?? [])] : [];
  const trialPlanMismatchIds = new Set(trialPlanFacts.filter((event) => eventProofs(event).some((copy) => copy.invalidTrialPlanFingerprint
    || copy.trialPlanFingerprint !== spec.trialPlanFingerprint)).map((event) => event.sdkId));
  const rows = []; const baselineRows = []; const enrolled = []; const variantRows = { control: [], treatment: [] };
  const linkage = { claimWithoutAssignment: 0, assignmentWithoutClaim: 0, assignmentWithoutExposure: 0, invalidTiming: 0,
    pendingClaimWithoutAssignment: 0, pendingAssignmentWithoutClaim: 0, unknownSdkAssignmentRecords: context.quality.missingSdkIdentity,
    possibleScopeRecords: selected.filter((item) => item.membership === 'possible').length + assignmentCandidates.filter((item) => item.membership === 'possible').length };
  let validClaims = 0; const unknownClaimIds = new Set([...possibleClaimUnits, ...missingFirstFlags]); let conflictingClaims = 0; let unknownVariants = 0; let nonNativeSdkUnits = 0;
  const unprovenOriginalQueryIds = new Set();
  for (const [sdkId, values] of claims) {
    if (spec.phase === 'baseline' && (!/^[1-9][0-9]{0,19}$/.test(sdkId) || sdkId.length === 20 && sdkId > '18446744073709551615')) nonNativeSdkUnits++;
    const flow = values[0].flow; const count = fullClaimGroups.get(sdkId)?.length ?? 0; const why = scopedEligibility(flow, context, spec, count);
    if (count > 1) conflictingClaims++; if (why) unknownClaimIds.add(sdkId); else validClaims++;
    if (spec.phase === 'baseline') {
      const forbidden = groups.has(sdkId) ? 'assignment_in_baseline' : null;
      const deadline = spec.primaryWindowMs === null || at(flow.origin) === null ? null : at(flow.origin) + spec.primaryWindowMs;
      const outcome = why || forbidden || deadline === null ? { success: null, reason: why ?? forbidden ?? 'baseline_window_not_defined' } : completionOutcome(flow, context, deadline);
      const state = why || forbidden ? 'unproven' : deadline === null ? 'unknown' : deadline > context.options.asOfMs ? 'immature' : outcome.success === null ? 'unknown' : 'mature';
      baselineRows.push(observation(flow.origin ?? flow.sample, state, outcome.success, outcome.reason, { channel: 'not_applicable', unknownMaturity: deadline === null }));
    } else if (!groups.has(sdkId)) {
      if (at(flow.origin) !== null && at(flow.origin) + spec.deliveryLagMs <= context.options.asOfMs) linkage.claimWithoutAssignment++;
      else linkage.pendingClaimWithoutAssignment++;
    }
  }
  if (spec.phase === 'trial') for (const [sdkId, assignments] of groups) {
    const assignment = reconcileProofCopies((fullAssignmentGroups.get(sdkId) ?? assignments).map((item) => item.event), ENROLLMENT_PROOF_FIELDS);
    const candidateFlows = originalFlows.filter((flow) => flow.sample.sdkId === sdkId && flow.origin?.originInteractionId === assignment.originInteractionId);
    const flow = candidateFlows.length === 1 ? candidateFlows[0] : null;
    const claimCount = fullClaimGroups.get(sdkId)?.length ?? 0;
    const origin = flow?.origin ?? assignment;
    let why = !flow ? 'missing_assigned_origin_or_eligibility' : scopedEligibility(flow, context, spec, claimCount);
    const queryWhy = flow ? frozenQueryReason(flow.origin, assignment, context, true) : 'missing_assigned_origin_or_eligibility';
    if (queryWhy) unprovenOriginalQueryIds.add(sdkId);
    why ??= queryWhy;
    why ??= trialPlanMismatchIds.has(sdkId) ? 'missing_or_mismatched_trial_plan' : null;
    if (!claimCount) { if (at(assignment) !== null && at(assignment) + spec.deliveryLagMs <= context.options.asOfMs) linkage.assignmentWithoutClaim++; else linkage.pendingAssignmentWithoutClaim++; }
    const allExposures = exposuresBySdk.get(sdkId) ?? [];
    if (!allExposures.length) linkage.assignmentWithoutExposure++;
    const exposureQueryWhy = flow && allExposures.some((event) => frozenQueryReason(flow.origin, event, context));
    if (exposureQueryWhy) unprovenOriginalQueryIds.add(sdkId);
    const exposureWhy = exposureQueryWhy || allExposures.some((event) => risk(event) || event.measurementPhase !== 'trial' || event.eligibilityEpoch !== spec.eligibilityEpoch
      || event.eligibilityVersion !== spec.eligibilityVersion || event.assignmentId !== assignment.assignmentId || event.variant !== assignment.variant
      || event.invalidTrialPlanFingerprint || event.trialPlanFingerprint !== spec.trialPlanFingerprint
      || event.allocationVersion !== spec.allocationVersion) ? 'invalid_assignment_exposure_identity' : null;
    why ??= risk(assignment) ?? (Array.isArray(spec.acceptedOriginVersions) && (assignment.versionProvenance !== 'origin_envelope' || !spec.acceptedOriginVersions.includes(assignment.analysisAppVersion)) ? 'unsupported_assignment_producer_version'
      : assignment.invalidTrialPlanFingerprint || assignment.trialPlanFingerprint !== spec.trialPlanFingerprint ? 'missing_or_mismatched_trial_plan'
        : !assignment.assignmentId || assignment.unitType !== 'sdk_player' || assignment.allocationVersion !== spec.allocationVersion ? 'unknown_eligible_assignment'
      : !['control', 'treatment'].includes(assignment.variant) ? 'unknown_variant' : exposureWhy ?? (flow ? prospectiveAssignmentReason(flow, [assignment], allExposures, context) : null));
    if (why?.includes('timing') || why?.includes('assignment_not_at') || why?.includes('not_proven_after')) linkage.invalidTiming++;
    const deadline = spec.primaryWindowMs === null || at(origin) === null ? null : at(origin) + spec.primaryWindowMs;
    const outcome = why || !flow || deadline === null ? { success: null, reason: why ?? 'unknown_primary_window_or_origin' } : completionOutcome(flow, context, deadline);
    const state = deadline !== null && deadline > context.options.asOfMs ? 'immature' : outcome.success === null ? 'unknown' : 'mature';
    const row = observation(origin, state, outcome.success, outcome.reason, { channel: 'not_applicable', unknownMaturity: !flow || deadline === null });
    rows.push(row);
    if (variantRows[assignment.variant]) variantRows[assignment.variant].push(row); else unknownVariants++;
    if (!/^[1-9][0-9]{0,19}$/.test(sdkId) || sdkId.length === 20 && sdkId > '18446744073709551615') nonNativeSdkUnits++;
    enrolled.push({ flow: flow ?? { origin: assignment, originTimeUnknown: true }, assignment, assignmentWhy: why, row });
  }
  const resultRows = spec.phase === 'baseline' ? baselineRows : rows;
  const primaryCounts = { total: enrollmentCounts(resultRows, range, context),
    control: enrollmentCounts(variantRows.control, range, context), treatment: enrollmentCounts(variantRows.treatment, range, context) };
  if (spec.phase === 'baseline') for (const counts of Object.values(primaryCounts)) counts.assignedUnits = 0;
  const possibleMembership = spec.phase === 'baseline' ? possibleClaimUnits.size + missingFirstFlags.size : possibleAssignmentUnits.size;
  if (possibleMembership) {
    for (const counts of Object.values(primaryCounts)) { counts.rate = null; counts.status = 'coverage_gap'; if (counts.bounds) counts.bounds.conditionalOnKnownDenominator = true; }
  }
  const returns = {};
  for (const day of [1, 7]) {
    returns[`D${day}`] = {};
    for (const gameplay of [false, true]) {
      const name = gameplay ? 'gameplay' : 'open'; const converted = enrolled.map((item) => {
        const origin = item.flow.origin;
        const episode = context.episodes.find((value) => value.sdkId === origin.sdkId && value.key === origin.installKey);
        const value = calendarOutcome(item.flow.originTimeUnknown ? null : at(origin), context, day, gameplay, origin, episode, item.assignmentWhy);
        return { ...value, variant: item.assignment.variant, unknownMaturity: item.flow.originTimeUnknown };
      });
      returns[`D${day}`][name] = { total: enrollmentCounts(converted, range, context),
        control: enrollmentCounts(converted.filter((row) => row.variant === 'control'), range, context),
        treatment: enrollmentCounts(converted.filter((row) => row.variant === 'treatment'), range, context) };
    }
  }
  const looks = (inputSpec.assignmentLookAt ?? []).map((cutoff) => {
    const cutoffMs = Date.parse(cutoff); if (!Number.isFinite(cutoffMs)) throw new Error('Invalid assignment look cutoff.');
    const selectedUnits = enrolled.filter((item) => at(item.assignment) !== null && at(item.assignment) <= cutoffMs);
    const possibleAtLook = new Set(assignmentCandidates.filter((item) => item.membership === 'possible' && eventProofs(item.event).some((copy) => at(copy) === null || at(copy) <= cutoffMs)).map((item) => item.event.sdkId));
    return { cutoff: new Date(cutoffMs).toISOString(), control: selectedUnits.filter((item) => item.assignment.variant === 'control').length,
      treatment: selectedUnits.filter((item) => item.assignment.variant === 'treatment').length,
      unknownVariant: selectedUnits.filter((item) => !['control', 'treatment'].includes(item.assignment.variant)).length,
      ambiguousScopeUnits: possibleAtLook.size, unknownAssignmentTime: enrolled.filter((item) => at(item.assignment) === null).length,
      unknownPlanUnits: selectedUnits.filter((item) => trialPlanMismatchIds.has(item.assignment.sdkId)).length };
  });
  const guardTo = Number.isFinite(Date.parse(inputSpec.observationTo ?? '')) ? Math.min(context.options.asOfMs, Date.parse(inputSpec.observationTo)) : context.options.asOfMs;
  const relevantWallets = context.rewardWallets.filter((wallet) => enrolled.some((item) => wallet.proofs.some((event) => possibleSameScope(event, item.assignment, context)
    && (at(event) === null || at(item.assignment) === null || at(event) >= at(item.assignment) && at(event) <= guardTo))));
  const financial = relevantWallets.filter((wallet) => wallet.valid && !risk(wallet.event) && knownInstallScope(wallet.event, context) !== null);
  const duplicateGroups = [...groupBy(financial, (wallet) => key(knownInstallScope(wallet.event, context), wallet.event.rewardId)).values()]
    .filter((wallets) => new Set(wallets.map((wallet) => wallet.event.transactionId)).size > 1).length;
  const consentGuardUnknown = enrolled.filter((item) => at(item.assignment) === null || absenceConsentGap(context, item.assignment, at(item.assignment), guardTo)).length;
  const checkout = (context.checkoutProofs ?? []).filter((fact) => enrolled.some((item) => fact.proofs.some((event) => possibleSameScope(event, item.assignment, context)
    && (at(event) === null || at(item.assignment) === null || at(event) >= at(item.assignment) && at(event) <= guardTo))));
  const confirmedCheckouts = checkout.filter((fact) => enrolled.some((item) => authoritativeCheckoutWithin(fact, item.assignment, context, guardTo)));
  const inPrimaryGuard = (event, item) => possibleSameScope(event, item.assignment, context) && (at(event) === null || at(item.assignment) === null
    || at(event) >= at(item.assignment) && at(event) <= Math.min(guardTo, at(item.assignment) + spec.primaryWindowMs));
  const primaryWallets = relevantWallets.filter((wallet) => enrolled.some((item) => wallet.proofs.some((event) => inPrimaryGuard(event, item))));
  const primaryFinancial = primaryWallets.filter((wallet) => wallet.valid && !risk(wallet.event) && knownInstallScope(wallet.event, context) !== null);
  const primaryCheckout = checkout.filter((fact) => enrolled.some((item) => fact.proofs.some((event) => inPrimaryGuard(event, item))));
  const confirmedPrimaryCheckouts = primaryCheckout.filter((fact) => enrolled.some((item) => authoritativeCheckoutWithin(fact, item.assignment, context,
    Math.min(guardTo, at(item.assignment) + spec.primaryWindowMs))));
  const primaryFinancialIntegrity = { milliseconds: spec.primaryWindowMs,
    provenDuplicateEntitlements: [...groupBy(primaryFinancial, (wallet) => key(knownInstallScope(wallet.event, context), wallet.event.rewardId)).values()]
      .filter((wallets) => new Set(wallets.map((wallet) => wallet.event.transactionId)).size > 1).length,
    possibleRewardWalletFacts: primaryWallets.filter((wallet) => !wallet.recordValid || knownInstallScope(wallet.event, context) === null).length,
    confirmedBrokenCheckouts: confirmedPrimaryCheckouts.length, possibleBrokenCheckouts: primaryCheckout.length - confirmedPrimaryCheckouts.length,
    consentGuardUnknownUnits: enrolled.filter((item) => at(item.assignment) === null
      || absenceConsentGap(context, item.assignment, at(item.assignment), Math.min(guardTo, at(item.assignment) + spec.primaryWindowMs))).length };
  const publicResult = { scope: { phase: spec.phase, eligibilityEpoch: spec.eligibilityEpoch, allocationVersion: spec.phase === 'trial' ? spec.allocationVersion : null,
    trialPlanFingerprint: spec.phase === 'trial' ? spec.trialPlanFingerprint : null,
    enrollmentFrom: inputSpec.enrollmentFrom, enrollmentToExclusive: inputSpec.enrollmentToExclusive, primaryWindowMinutes: spec.primaryWindowMinutes },
  firstClaims: { valid: validClaims, observedCertainUnits: claims.size, matchedAssignmentUnits: [...claims.keys()].filter((id) => groups.has(id)).length,
    nonFirst: selected.filter((item) => item.membership === 'certain' && item.flow.origin?.firstEligibleRequest === false).length,
    unknown: unknownClaimIds.size, conflicting: conflictingClaims },
  assignments: { total: groups.size, control: enrolled.filter((item) => item.assignment.variant === 'control').length, treatment: enrolled.filter((item) => item.assignment.variant === 'treatment').length,
    unknownVariant: unknownVariants, orphans: linkage.assignmentWithoutClaim, conflictingAssignments: rows.filter((row) => row.reason === 'conflicting_semantic_ad_copies' || row.reason === 'conflicting_delivery').length,
    ambiguousScopeAssignmentUnits: possibleAssignmentUnits.size, possibleAssignedUnitUpper: groups.size + [...possibleAssignmentUnits].filter((id) => !groups.has(id)).length },
  primary: primaryCounts, experimentReturn: returns, linkage,
  assignmentLooks: looks, financialIntegrity: { provenDuplicateEntitlements: duplicateGroups,
    possibleRewardWalletFacts: relevantWallets.filter((wallet) => !wallet.recordValid || knownInstallScope(wallet.event, context) === null).length,
    confirmedBrokenCheckouts: confirmedCheckouts.length, possibleBrokenCheckouts: checkout.length - confirmedCheckouts.length,
    consentGuardUnknownUnits: consentGuardUnknown, primaryWindow: primaryFinancialIntegrity },
  quality: { nonNativeSdkUnits, unmeasuredOriginalRequests: originalFlows.length - measurementFlows.length, ambiguousClaimUnits: possibleClaimUnits.size, missingFirstClaimFlagUnits: missingFirstFlags.size,
    unprovenOriginalQueryUnits: unprovenOriginalQueryIds.size,
    trialPlanMismatchUnits: trialPlanMismatchIds.size,
    observedAllocationVersions: new Set(fullAssignmentCandidates.flatMap((item) => eventProofs(item.event).map((copy) => copy.allocationVersion)).filter((value) => Number.isSafeInteger(value) && value > 0)).size,
    source: context.quality } };
  return { publicResult, enrolled, baselineRows, trialRows: rows };
}
function primary(context, period) {
  const scopes = Array.isArray(context.options.measurementScopes) ? context.options.measurementScopes : [];
  const baselineScope = scopes.find((spec) => spec.phase === 'baseline'); const trialScope = scopes.find((spec) => spec.phase === 'trial');
  const empty = () => summarize([], period, context.episodes);
  const baseline = baselineScope ? analyzeEnrollmentScope(context, baselineScope, period) : null;
  const trial = trialScope ? analyzeEnrollmentScope(context, trialScope, period) : null;
  const missing = context.flows.filter((flow) => flow.origin && belongs(flow.origin, period) && flow.origin.firstEligibleRequest === true
    && (!flow.origin.measurementPhase || !flow.origin.eligibilityEpoch)).map((flow) => observation(flow.origin, 'unproven', null, 'unproven_phase_or_epoch', { channel: 'not_applicable' }));
  const unprovenAssignments = new Set(context.events.filter((event) => eventProofs(event).some((copy) => copy.name === 'experiment_assigned' && copy.experimentId === passport.experiment.id
    && belongs(copy, period) && (!copy.measurementPhase || !copy.eligibilityEpoch))).map((event) => event.sdkId));
  return { metric: { provenFirstEligibleBaseline: baseline ? summarize(baseline.baselineRows, period, context.episodes) : summarize(missing, period, context.episodes),
    assignedEligibleItt: trial ? summarize(trial.trialRows, period, context.episodes) : empty(),
    variants: { control: trial?.publicResult.primary.control ?? empty(), treatment: trial?.publicResult.primary.treatment ?? empty() },
    unknownVariantAssignedUnits: trial?.publicResult.assignments.unknownVariant ?? 0,
    allocationScope: { distinctPositiveVersions: trial?.publicResult.quality.observedAllocationVersions ?? 0,
      valid: Boolean(trial && trial.publicResult.quality.observedAllocationVersions === 1 && !trial.publicResult.assignments.ambiguousScopeAssignmentUnits
        && !trial.publicResult.assignments.conflictingAssignments), productionVersionFrozen: false },
    phaseCoverage: { missingPhaseOrEpochUnits: missing.length, unprovenAssignmentScopeUnits: unprovenAssignments.size, trialAssignmentLoss: trial?.publicResult.linkage.claimWithoutAssignment ?? 0,
      ambiguousScopeAssignmentUnits: trial?.publicResult.assignments.ambiguousScopeAssignmentUnits ?? 0,
      possibleAssignedUnitUpper: trial?.publicResult.assignments.possibleAssignedUnitUpper ?? 0 }, experimentStatus: passport.experiment.status }, enrolled: trial?.enrolled ?? [] };
}
/* P7 uses the scoped classifier above. No startup/install assignment inference. */
function midnight(ms, offset) { return Math.floor((ms + offset * 60000) / DAY) * DAY - offset * 60000; }
function voluntaryGameplay(event) {
  if (event.invalidSdkMetadata) return null;
  if (event.recovery === true || event.source === 'restore' || event.manualState === 'conflict') return null;
  if (event.name === 'help_used') return event.source === 'explicit' && event.manualState !== 'auto' ? true : event.manualState === 'auto' ? false : null;
  if (event.name === 'target_word_accepted') return event.manualState === 'manual' ? true : event.manualState === 'auto' ? false : null;
  // Preserve the existing retention canonical-play aliases and its exclusion
  // of manual=false/auto and letters_connected. Entry/completion is no action.
  return event.canonical === 'play';
}
function possibleInstallScope(event, episode) {
  if (!episode) return true;
  if (event.installIdentity && [episode.explicit, episode.key].includes(event.installIdentity)
    || event.installMs !== null && event.installMs === episode.installMs) return true;
  if (event.installIdentity || event.installMs !== null) return false;
  if (event.installDay) return event.installDay === episode.installDay;
  return at(event) === null || episode.installMs === null || at(event) >= episode.installMs && at(event) < episode.endMs;
}
function knownInstallScope(event, context) {
  if (!event.sdkId || !known(event.installKey) || event.installAmbiguous || event.installDeliveryAmbiguous) return null;
  const matches = context.episodes.filter((episode) => episode.sdkId === event.sdkId && episode.key === event.installKey);
  if (matches.length !== 1 || matches[0].conflict) return null;
  // An exact install ID can identify a legacy episode. A time-inferred scope
  // cannot exclude another episode whose unknown clock may overlap it.
  if (!known(event.installIdentity) && (matches[0].installMs === null || context.episodes.some((episode) => episode.sdkId === event.sdkId
    && episode.key !== event.installKey && episode.installMs === null))) return null;
  return key(event.sdkId, event.installKey);
}
function possibleSameScope(event, origin, context) {
  if (event.sdkId !== origin.sdkId) return false;
  const episode = context.episodes.find((item) => item.sdkId === origin.sdkId && item.key === origin.installKey);
  if (episode) return possibleInstallScope(event, episode);
  return scope(event) === scope(origin) || !event.installIdentity && event.installMs === null;
}
function possibleConflict(context, origin, selectors) {
  return (context.deliveryConflicts.get(origin.sdkId) ?? []).some((copies) => copies.some((event) => possibleSameScope(event, origin, context))
    && selectors.every((selector) => copies.some(selector)));
}
function calendarOutcome(anchor, context, day, gameplay, origin, episode, priorReason = null) {
  if (anchor === null) return observation(origin, 'unknown', null, 'unknown_calendar_origin');
  const start = midnight(anchor, context.options.offset) + day * DAY; const end = start + DAY;
  if (end > context.options.asOfMs) return observation(origin, 'immature', null, 'partial_target_calendar_day');
  if (priorReason) return observation(origin, 'unknown', null, priorReason);
  if (episode && episode.endMs < end) return observation(origin, 'unknown', null, 'install_boundary');
  const whitelist = gameplay ? passport.calendar.gameplayEvents : passport.calendar.openEvents;
  const candidates = context.events.filter((event) => event.sdkId === origin.sdkId && (!episode || event.installKey === episode.key) && whitelist.includes(event.name)
    && (!gameplay || voluntaryGameplay(event) !== false));
  const targetDay = new Date(start + context.options.offset * 60000).toISOString().slice(0, 10);
  const dayMatch = (event) => at(event) !== null ? at(event) >= start && at(event) < end
    : context.options.offset === 180 && event.recordedActionDay === targetDay && event.timeTrust !== 'client_clock_anomaly';
  if (candidates.some((event) => dayMatch(event) && !risk(event, false) && (!gameplay || voluntaryGameplay(event) === true))) return observation(origin, 'mature', true);
  // Conflicting delivery copies are possible clocks/scopes, never successful
  // returns or consent-continuity facts. No retained first copy may prove
  // absence. Independent legal positives above still establish a return.
  const conflictingReturn = (context.deliveryConflicts.get(origin.sdkId) ?? []).some((copies) => copies.some((event) => possibleInstallScope(event, episode))
    && copies.some((event) => (event.invalidSdkMetadata || whitelist.includes(event.name)) && (!gameplay || voluntaryGameplay(event) !== false)
      && (at(event) !== null ? dayMatch(event) : context.options.offset === 180 && event.recordedActionDay && event.timeTrust !== 'client_clock_anomaly'
        ? event.recordedActionDay === targetDay : true)));
  const unknown = conflictingReturn || candidates.some((event) => dayMatch(event) && (risk(event, false) || gameplay && voluntaryGameplay(event) === null)
    || at(event) === null && event.emittedAtMs !== null && event.emittedAtMs >= start && (!event.recordedActionDay || context.options.offset !== 180 || event.timeTrust === 'client_clock_anomaly'));
  const gap = unknown ? null : absenceConsentGap(context, origin, start, end, true);
  return observation(origin, unknown || gap ? 'unknown' : 'mature', unknown || gap ? null : false, unknown ? 'unknown_return_occurrence_or_context' : gap);
}
function calendarReturns(context, period, enrolled) {
  const installs = context.episodes.filter((episode) => {
    const install = episode.installMs !== null ? episode.installMs : context.options.offset === 180 && episode.installDay ? Date.parse(`${episode.installDay}T00:00:00+03:00`) : null;
    return install !== null && install >= period.startMs && install < period.endMs;
  });
  const result = { install: {}, experiment: {}, installClassification: { first: 0, reinstall: 0, reactivation: 0, unknown: 0 } };
  for (const episode of installs) result.installClassification[episode.kind]++;
  for (const day of passport.calendar.days) {
    result.install[`D${day}`] = {}; result.experiment[`D${day}`] = {};
    for (const gameplay of [false, true]) {
      const name = gameplay ? 'gameplay' : 'open'; const installRows = [];
      for (const episode of installs.filter((item) => item.kind === 'first' && !item.conflict)) {
        const origin = episode.events.find((event) => event.name === 'install') ?? { ...episode.events[0], analysisAppVersion: 'unknown', entrySource: 'unknown' };
        const anchor = episode.installMs ?? Date.parse(`${episode.installDay}T00:00:00+03:00`);
        installRows.push(calendarOutcome(anchor, context, day, gameplay, origin, episode));
      }
      result.install[`D${day}`][name] = summarize(installRows, period, context.episodes);
      const experimentRows = enrolled.map(({ flow, assignmentWhy }) => {
        const episode = context.episodes.find((item) => item.sdkId === flow.origin.sdkId && item.key === flow.origin.installKey);
        return calendarOutcome(flow.originTimeUnknown ? null : at(flow.origin), context, day, gameplay, flow.origin, episode, assignmentWhy);
      });
      result.experiment[`D${day}`][name] = summarize(experimentRows, period, context.episodes);
    }
  }
  result.experiment.origin = 'first_eligible_request_calendar_day; not install';
  result.experiment.status = passport.experiment.status;
  return result;
}

// Additive point 6 seam. All identity/event/consent indexes stay private;
// callers receive the existing calendar classification, never a raw origin.
function createCalendarObservationContext(records, options) {
  if (!Array.isArray(records)) throw new Error('Input must be an array of raw event objects.');
  const validated = validateOptions(options);
  const context = { ...prepare(records, validated), options: validated };
  context.consentObservability = indexConsentObservability(context);
  const episodes = groupBy(context.episodes, (episode) => key(episode.sdkId, episode.key));
  const events = groupBy(context.events, (event) => key(event.sdkId, event.installKey));
  const reasons = new Set(['unknown_install_identity', 'conflicting_first_install_metadata', 'unknown_install_environment']);
  return Object.freeze({ observe({ sdkId, installKey, anchorMs, day, gameplay = false, priorReason = null } = {}) {
    if (typeof sdkId !== 'string' || !sdkId || typeof installKey !== 'string' || !installKey
      || !Number.isSafeInteger(anchorMs) || anchorMs < 0 || anchorMs > 8640000000000000
      || !Number.isSafeInteger(day) || day < 1 || day > 30 || typeof gameplay !== 'boolean'
      || priorReason !== null && !reasons.has(priorReason)) throw new Error('Invalid calendar observation request.');
    const matches = episodes.get(key(sdkId, installKey)) ?? [];
    if (matches.length !== 1) return { state: 'unknown', success: null, reason: 'unknown_install_identity' };
    const episode = matches[0];
    const origin = episode.events.find((event) => event.name === 'install' && event.sdkMetadata
      && event.sdkId === sdkId && event.installKey === installKey);
    const actualAnchor = episode.installMs ?? (validated.offset === 180 && episode.installDay ? Date.parse(`${episode.installDay}T00:00:00+03:00`) : null);
    if (!origin || actualAnchor !== anchorMs) return { state: 'unknown', success: null, reason: 'unknown_install_identity' };
    const row = calendarOutcome(anchorMs, { ...context, events: events.get(key(sdkId, installKey)) ?? [] }, day, gameplay, origin, episode,
      priorReason ?? (episode.conflict ? 'conflicting_first_install_metadata' : null));
    return { state: row.state, success: row.success, reason: row.reason };
  } });
}

// P7 additive seam: arbitrary declared enrollment ranges reuse the exact P6
// private proofs. Only aggregate counts leave the closure; raw IDs never do.
function createHelpExperimentAnalysisContext(records, options) {
  if (!Array.isArray(records)) throw new Error('Input must be an array of raw event objects.');
  const validated = enrollmentTiming(options);
  const context = { ...prepare(records, validated), options: validated };
  context.consentObservability = indexConsentObservability(context);
  const technicalReasons = new Set(['invalid_confirmation_url', 'browser_unavailable', 'payment_create_failed', 'billing_gateway_invalid_response', 'billing_bad_configuration']);
  const rawCheckout = [];
  for (const raw of records) {
    if (!raw || !['subscription_error'].includes(raw.event_name ?? raw.name)) continue;
    try {
      let payload = raw.event_json ?? raw.params ?? {}; if (typeof payload === 'string') payload = JSON.parse(payload);
      const properties = payload?.schema_version === 2 && objectPayload(payload.properties) ? payload.properties : payload;
      const event = normalizeRecord(raw);
      const sdkKind = validateSdkRecordKind(raw);
      const excluded = event.isTest || TEST_ENVS.has(event.environment) || sdkKind && TEST_ENVS.has(raw.environment)
        || [raw.is_qa, raw.is_qa_device, raw.is_test].some((value) => [true, 'true', 1, '1'].includes(value));
      if (excluded || event.emittedAtMs !== null && event.emittedAtMs > validated.asOfMs) continue;
      rawCheckout.push({ event, stage: properties?.stage, mode: properties?.mode, reason: properties?.reason });
    } catch { /* Invalid raw rows are already counted by the common parser. */ }
  }
  const checkoutKeys = new Set(rawCheckout.filter((copy) => copy.event.eventId).map((copy) => key(copy.event.sdkId, copy.event.eventId)));
  const canonicalById = checkoutKeys.size ? groupBy(context.events.filter((event) => event.eventId && checkoutKeys.has(key(event.sdkId, event.eventId))),
    (event) => key(event.sdkId, event.eventId)) : new Map();
  let unkeyedCheckout = 0;
  context.checkoutProofs = [...groupBy(rawCheckout, (copy) => copy.event.sdkId ? key(copy.event.sdkId, copy.event.eventId ?? `unkeyed-checkout:${unkeyedCheckout++}`) : null).values()]
    .filter((copies) => copies.some((copy) => copy.stage === 'checkout' && copy.mode === 'live' && technicalReasons.has(copy.reason)))
    .map((copies) => {
      const canonical = copies[0].event.eventId ? canonicalById.get(key(copies[0].event.sdkId, copies[0].event.eventId))?.[0] : null;
      const shapes = new Set(copies.map((copy) => key(copy.stage, copy.mode, copy.reason)));
      // Finite stage/reason comes from legal included raw shapes, but occurrence,
      // scope and authority come only from the reconciled canonical event.
      // Private alternatives may locate an unknown; they cannot lend a clock.
      return { event: canonical, proofs: canonical ? eventProofs(canonical) : copies.map((copy) => copy.event), trusted: Boolean(canonical && !risk(canonical) && shapes.size === 1
        && copies.every((copy) => copy.stage === 'checkout' && copy.mode === 'live' && technicalReasons.has(copy.reason))
        && knownInstallScope(canonical, context) !== null) };
    });
  return Object.freeze({ analyzeScope(spec) {
    return JSON.parse(JSON.stringify(analyzeEnrollmentScope(context, spec).publicResult));
  }, quality() { return { ...context.quality }; } });
}
function objectPayload(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function baseReport(options) {
  return { reportVersion: 1, game_id: 'slova', scope: 'draft_point5_nine_metric_passports',
    source: { kind: options.source, synthetic: options.source === 'synthetic', productionMetricsVerified: false },
    periods: options.publicPeriods, experiment: { status: passport.experiment.status,
      protocolReference: passport.experiment.protocolReference, productionAllocationVersion: null, enabled: false },
    passportVersion: passport.version, definitions: passport,
    interpretation: 'Descriptive offline diagnostics. Conditional funnel groups are post-treatment; they do not independently establish player benefit or a causal UX effect.',
    limitations: ['The explicit as-of is caller-declared complete export cutoff, not independent delivery-completeness proof.',
      'Production rollout, provenance, observed consent coverage, SDK identity continuity and first-eligible assignment require separate verification. Refused/unobserved players are outside logs.',
      'Ten minutes is the proposed draft UX window, not a frozen production experiment parameter. This CLI never enrolls users, starts an experiment, changes campaigns, or changes economy.',
      'Same-level restarts, unknown occurrence clocks, missing first-eligible/prior-completion evidence and startup sdk_install assignment cannot prove the primary outcome.',
      'Coins are fungible. Post-grant sufficiency does not identify which coins paid for a hint. First-grant anchors never reset on later grants.',
      'SDK duration is not active solve time. Point 3 activeTimeMs coverage and word comparisons retain their existing definitions.'] };
}
function buildNeedsRawDataReport(options) {
  const validated = validateOptions(options);
  return { ...baseReport(validated), status: 'needs_raw_data', metrics: null, quality: null,
    coverageGates: [{ name: 'raw_player_events', state: 'missing', reason: 'No usable raw Slova player export supplied. Aggregate event/user totals cannot reconstruct joins or first eligibility.' }],
    requiredInput: ['Raw Slova events plus SDK install/session metadata for both full weeks and through the declared as-of, with relevant pre-period context.',
      'Event occurrence/provenance/consent metadata; stable SDK identity, exact attempt/content and origin/modal/action/ad/reward/wallet child IDs for private joins.',
      'Original available non-free insufficient requests, prior completion snapshot, and future durable first eligible claim/version plus exact player assignment for primary ITT.',
      'Actual rewarded callbacks, positive coin wallet transactions with original clocks, applied-help/return evidence, and completed manual outcomes.'],
    nextAction: 'Obtain a usable Slova raw export and verify production instrumentation/coverage; rerun the same fixed-week CLI. Do not substitute synthetic examples or another game.' };
}
function analyzeHelpFunnel(records, options) {
  const validated = validateOptions(options);
  if (!Array.isArray(records)) throw new Error('Input must be an array of raw event objects.');
  if (!records.length) return buildNeedsRawDataReport(options);
  const context = { ...prepare(records, validated), options: validated };
  context.consentObservability = indexConsentObservability(context);
  const words = product.analyzeProductImprovements(records, options);
  const weeks = validated.periods.map((period, index) => {
    const originFlows = flowOutcomes(context, period); const experiment = primary(context, period);
    const calendar = calendarReturns(context, period, experiment.enrolled);
    return { week: period.name, wheelEntry: wheelEntry(context, period),
      readiness: { noCoins: readiness(context, period, 'noCoins'), wheel: readiness(context, period, 'wheel') },
      show: showOperations(context, period), earnedGrant: earnedGrants(context, period),
      sufficiency: originFlows.sufficiency, returnHelp: originFlows.returnHelp, grantFlowDiagnostic: originFlows.diagnostic,
      primary: experiment.metric, invalidInput: words.weeks?.[index]?.manualInputs ?? null,
      installReturn: calendar.install, experimentReturn: calendar.experiment, installClassification: calendar.installClassification };
  });
  const metrics = { weeks, invalidInputComparison: words.comparison ?? null, invalidInputCoverageGates: words.coverageGates,
    invalidInputSource: 'analyzeProductImprovements(records, same options); no duplicate standardization formula' };
  const coverageGates = [
    { name: 'raw_player_events', state: context.events.length ? 'observed_not_certified_complete' : 'missing' },
    { name: 'production_delivery_and_rollout', state: 'unverified' },
    { name: 'observed_consent', state: context.quality.unknownConsentEvents ? 'partial' : context.events.length ? 'available' : 'missing', unknownEvents: context.quality.unknownConsentEvents },
    { name: 'origin_flow_context', state: context.quality.missingFlowIdentity ? 'partial' : context.flows.length ? 'available' : 'missing', missingEvents: context.quality.missingFlowIdentity },
    { name: 'reward_integrity', state: context.quality.duplicateGrantEntitlements ? 'failed'
      : context.quality.conflictingWalletFacts || context.quality.unresolvedRewardWalletFacts || weeks.some((week) => week.earnedGrant.unknownUnits || week.earnedGrant.unprovenDenominatorUnits)
        || context.rewardWallets.some((wallet) => !wallet.recordValid || !wallet.event.rewardId) ? 'coverage_gap'
        : context.rewardWallets.length ? 'observed_no_detected_conflict' : 'missing' },
    { name: 'first_eligible_and_assignment', state: weeks.some((week) => week.primary.assignedEligibleItt.denominator) ? 'observed_future_contract_not_activation' : 'missing' },
    { name: 'experiment_activation', state: 'inactive' },
  ];
  return { ...baseReport(validated), status: context.events.length ? 'observed_with_coverage_gaps' : 'needs_raw_data',
    metrics: context.events.length ? metrics : null, quality: context.quality, coverageGates,
    nextAction: 'Inspect every unknown, maturity and integrity gate before interpreting rates. Primary eligibility/assignment remains unavailable without explicit future point 7 proof.' };
}

function renderMarkdown(report) {
  const pct = (value) => value === null || value === undefined ? 'unavailable' : `${(value * 100).toFixed(2)}%`;
  const lines = ['# Slova point 5 metric passports', '', `Status: **${report.status}**. Source: **${report.source.kind}**${report.source.synthetic ? ' — SYNTHETIC DEVELOPMENT DATA; NOT LIVE' : ''}.`,
    '', `Baseline ${report.periods.baseline.from}–${report.periods.baseline.toExclusive}; current ${report.periods.current.from}–${report.periods.current.toExclusive} (ends exclusive).`,
    `Fixed timezone ${report.periods.timezone}; caller-declared cutoff ${report.periods.asOf}. Production measurement verified: false.`,
    `Experiment: **${report.experiment.status}**, enabled: false; proposed help window ${HELP / 60000} minutes.`, '', report.interpretation, ''];
  if (!report.metrics) lines.push('No measured values are available. Raw Slova events are required; aggregates and synthetic fixtures are not a player baseline.', '', ...(report.requiredInput ?? []).map((item) => `- ${item}`));
  else {
    lines.push('| Week / metric | Known successes / mature denominator | Rate | Unknown / unproven | Immature / open |', '|---|---:|---:|---:|---:|');
    for (const week of report.metrics.weeks) {
      const rows = { wheelEntry: week.wheelEntry, readinessNoCoins: week.readiness.noCoins, readinessWheel: week.readiness.wheel,
        showAllAccepted: { ...week.show, ...week.show.allAccepted }, earnedGrant24h: week.earnedGrant,
        sufficiencyAfterFirstGrant: week.sufficiency, returnHelpAfterFirstGrant10m: week.returnHelp,
        provenFirstEligibleBaseline10m: week.primary.provenFirstEligibleBaseline, assignedEligibleItt10m: week.primary.assignedEligibleItt };
      for (const [name, row] of Object.entries(rows)) lines.push(`| ${week.week}/${name} | ${row.numerator}/${row.denominator} | ${pct(row.rate)} | ${row.unknownUnits}/${row.unprovenDenominatorUnits} | ${row.immatureUnits}/${row.openUnits} |`);
      for (const day of ['D1', 'D7']) for (const kind of ['open', 'gameplay']) for (const origin of ['installReturn', 'experimentReturn']) {
        const row = week[origin][day][kind];
        lines.push(`| ${week.week}/${origin}/${day}/${kind} | ${row.numerator}/${row.denominator} | ${pct(row.rate)} | ${row.unknownUnits}/${row.unprovenDenominatorUnits} | ${row.immatureUnits}/${row.openUnits} |`);
      }
    }
    const comparison = report.metrics.invalidInputComparison;
    lines.push('', `Invalid inputs, reused point 3: raw change ${pct(comparison?.metrics?.invalid?.raw?.change)}; fixed common-mix change ${pct(comparison?.metrics?.invalid?.commonConditionalFixedMix?.change)} (rate differences, not causal effects).`,
      'Companion JSON contains all nine executable passports, private-ID-free strata, full counts/bounds, maturity, wait and integrity diagnostics, and reused point 3 weights/common-support uncertainty.');
  }
  lines.push('', 'Coverage gates:', '', ...report.coverageGates.map((gate) => `- ${gate.name}: ${gate.state}.`), '', 'Limitations:', '', ...report.limitations.map((item) => `- ${item}`), '', report.nextAction, '');
  return lines.join('\n');
}
function parseArguments(argv) {
  const options = { input: [] }; const seen = new Set();
  const names = { '--baseline-start': 'baselineStart', '--current-start': 'currentStart', '--timezone': 'timezone', '--as-of': 'asOf', '--source': 'source', '--output': 'output', '--bootstrap-reps': 'bootstrapReps' };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--input') { const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error('--input requires a path.'); options.input.push(value); continue; }
    if (seen.has(argument)) throw new Error('Duplicate CLI argument.'); seen.add(argument);
    if (argument === '--needs-raw-data') { options.needsRawData = true; continue; }
    if (!names[argument]) throw new Error('Unknown CLI argument. See docs/runbooks/help-funnel-analysis.md.');
    const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error('CLI argument requires a value.');
    options[names[argument]] = argument === '--bootstrap-reps' ? Number(value) : value;
  }
  if (!options.output) throw new Error('--output report prefix is required.');
  if (options.needsRawData && options.input.length) throw new Error('--needs-raw-data cannot be combined with --input.');
  if (!options.needsRawData && !options.input.length) throw new Error('--input is required unless --needs-raw-data is explicit.');
  validateOptions(options); return options;
}
function main(argv) {
  const options = parseArguments(argv); const prefix = path.resolve(options.output); const outputs = [`${prefix}.json`, `${prefix}.md`];
  const inputs = options.input.map((input) => { try { return { path: fs.realpathSync(input), stat: fs.statSync(input) }; } catch { throw new Error('Cannot read an input file.'); } });
  const destinations = outputs.map((output) => ({ path: fs.existsSync(output) ? fs.realpathSync(output) : path.resolve(output), stat: fs.existsSync(output) ? fs.statSync(output) : null }));
  const aliases = (a, b) => a.path.toLowerCase() === b.path.toLowerCase() || a.stat && b.stat && a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino;
  for (const destination of destinations) {
    if (inputs.some((input) => aliases(input, destination))) throw new Error('Output must not overwrite an input file.');
  }
  if (aliases(destinations[0], destinations[1])) throw new Error('Output report files must not alias each other.');
  const report = options.needsRawData ? buildNeedsRawDataReport(options) : analyzeHelpFunnel(product.readInputFiles(options.input), options);
  try {
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(outputs[0], `${JSON.stringify(report, null, 2)}\n`); fs.writeFileSync(outputs[1], renderMarkdown(report));
  } catch { throw new Error('Cannot write report outputs.'); }
  process.stdout.write(`${JSON.stringify({ status: report.status, source: report.source.kind, outputFiles: outputs.map((output) => path.basename(output)) })}\n`);
}
module.exports = { analyzeHelpFunnel, buildNeedsRawDataReport, readInputFiles: product.readInputFiles, renderMarkdown, parseArguments, createCalendarObservationContext, createHelpExperimentAnalysisContext, validateSdkRecordKind };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error instanceof SyntaxError ? 'Invalid JSON (payload omitted).' : error.message}\n`); process.exitCode = 1; } }
