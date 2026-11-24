'use strict';
/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const defaults = require('../src/core/config/helpExperiment.defaults.json');
const { createHelpExperimentAnalysisContext, readInputFiles } = require('./analyze-help-funnel.cjs');
const { wilson95 } = require('./analyze-weekly-retention.cjs');
const { helpExperimentPlanFingerprint } = require('../src/core/analyticsKeyToken.cjs');

const DAY = 86400000;
const ID = 'slova_wheel_help_clarity_20261104';
const VERSION = 'help_deficit_v1';
const COMMON_PROOFS = ['producerRollout', 'rawIngestion', 'originAndDedupeProof', 'identityHistoryContinuity', 'commonTechnicalSafety'];
const TRIAL_PROOFS = ['stopControl', 'rewardGuardObservability', 'adGuardObservability', 'checkoutObservability', 'returnGuardObservability', 'timeAndWalletGuardObservability'];
const GUARD_IDS = ['reward_integrity', 'ad_readiness', 'ad_failure', 'wall_deadline', 'active_time', 'exit_after_request', 'experiment_return_d1', 'experiment_return_d7', 'wallet_distribution', 'checkout'];
const GUARD_UNITS = ['assigned_sdk_player', 'origin_flow', 'accepted_show_operation', 'earned_entitlement', 'completed_full_coverage_attempt'];
const GUARD_SOURCES = ['raw_client', 'reconciled_server', 'domain_incident_proof'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,191}$/i.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const fraction = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const timestamp = (value) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
function fixedOffset(value) {
  if (['UTC', 'Z'].includes(value)) return 0;
  const m = /^(?:UTC)?([+-])(\d{2}):(\d{2})$/.exec(value ?? '');
  return m && Number(m[2]) <= 14 && Number(m[3]) <= 59 && (Number(m[2]) !== 14 || Number(m[3]) === 0)
    ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}
function evidenceRef(value, definition) {
  return object(value) && value.state === 'verified' && ['production', 'synthetic'].includes(value.sourceKind)
    && safeId(value.ref) && safeId(value.methodVersion) && hash(value.scopeHash) && hash(value.producerDefinitionHash)
    && value.producerDefinitionHash === definition && timestamp(value.observedFrom) !== null && timestamp(value.observedToExclusive) !== null
    && timestamp(value.asOf) !== null && timestamp(value.observedFrom) < timestamp(value.observedToExclusive) && timestamp(value.observedToExclusive) <= timestamp(value.asOf);
}
function sampleSize(p0, mdePp) {
  if (!fraction(p0) || typeof mdePp !== 'number' || !Number.isFinite(mdePp) || mdePp <= 0) return null;
  const p1 = p0 + mdePp / 100; if (p1 > 1) return null;
  const mean = (p0 + p1) / 2;
  const n = Math.ceil((1.959963984540054 * Math.sqrt(2 * mean * (1 - mean))
    + 0.8416212335729143 * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) ** 2 / (p1 - p0) ** 2);
  return positive(n) ? n : null;
}
function validGuardDescriptor(g) {
  return object(g) && GUARD_IDS.includes(g.id) && typeof g.required === 'boolean' && GUARD_UNITS.includes(g.unit) && GUARD_SOURCES.includes(g.source);
}
function validGuard(g) {
  return validGuardDescriptor(g) && safeId(g.definitionRef) && safeId(g.numeratorRef)
    && (safeId(g.denominatorRef) || g.method === 'authoritative_incident_v1') && safeId(g.maturityRef) && safeId(g.observabilityEvidenceRef)
    && ['authoritative_incident_v1', 'newcombe_wilson95_rate_diff_v1', 'external_reviewed_distribution_v1'].includes(g.method)
    && ['higher_better', 'higher_worse', 'zero_incidents'].includes(g.direction) && object(g.harmMargin)
    && typeof g.harmMargin.value === 'number' && Number.isFinite(g.harmMargin.value) && g.harmMargin.value >= 0
    && ['pp', 'ms', 'coins', 'count'].includes(g.harmMargin.unit) && positive(g.minimumMaturePerArm)
    && object(g.window) && (g.window.origin === 'exact_calendar_day' ? [1, 7].includes(g.window.calendarDay) && g.window.milliseconds === null
      : ['first_request', 'first_grant', 'earned'].includes(g.window.origin) && positive(g.window.milliseconds) && g.window.calendarDay === null);
}
function validateHelpExperimentReadiness(config, evidence) {
  if (!object(config)) return { baselineReady: false, trialReady: false, reasons: ['config_invalid'] };
  const c = config; const e = object(evidence) ? evidence : {}; const reasons = new Set();
  if (!object(evidence)) reasons.add('evidence_invalid');
  const contract = c.schemaVersion === 1 && c.experimentId === ID && c.protocolReference === 'EXP-SLOVA-20261104-WHEEL-HELP'
    && c.eligibilityVersion === VERSION && c.unitType === 'sdk_player' && c.expectedAllocation?.control === 1 && c.expectedAllocation?.treatment === 1;
  if (!contract) reasons.add('contract_unsupported');
  const definition = safeId(c.approvedProtocolRef) && hash(c.definitionHash) && timestamp(c.frozenAt) !== null && fixedOffset(c.timezone) !== null
    && Array.isArray(c.acceptedOriginVersions) && c.acceptedOriginVersions.length > 0 && c.acceptedOriginVersions.every((v) => typeof v === 'string' && /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(v)) && safeId(c.producerContractRef);
  if (!definition) reasons.add('shared_definition_incomplete');
  const identity = c.identityPolicy === 'known_pre_epoch_continuity_only_v1' && safeId(c.historyPolicyRef);
  if (!identity) reasons.add('identity_policy_unverified');
  const commonProofs = COMMON_PROOFS.every((id) => evidenceRef(e[id], c.definitionHash));
  const commonKinds = new Set(COMMON_PROOFS.map((id) => e[id]?.sourceKind).filter(Boolean));
  const common = contract && definition && identity && commonProofs && commonKinds.size === 1;
  const declaredRange = (p) => object(p) && safeId(p.eligibilityEpoch) && timestamp(p.enrollmentFrom) !== null && timestamp(p.enrollmentToExclusive) !== null && timestamp(p.enrollmentFrom) < timestamp(p.enrollmentToExclusive);
  const scope = (p) => declaredRange(p) && timestamp(c.frozenAt) !== null && timestamp(c.frozenAt) < timestamp(p.enrollmentFrom);
  const b = c.baseline; const t = c.trial;
  if (b?.enabled !== true) reasons.add('baseline_disabled'); if (!scope(b)) reasons.add('baseline_scope_invalid');
  if (!commonProofs || commonKinds.size !== 1) reasons.add('baseline_evidence_incomplete');
  const baselineReady = common && b?.enabled === true && scope(b);
  const trialReasons = new Set();
  if (t?.enabled !== true) trialReasons.add('trial_disabled');
  if (!scope(t) || !declaredRange(b) || b.eligibilityEpoch === t.eligibilityEpoch || timestamp(b.enrollmentToExclusive) > timestamp(t.enrollmentFrom)) trialReasons.add('trial_scope_invalid');
  const plan = positive(t?.allocationVersion) && t.primaryWindowMinutes === 10 && safeId(t.baselineReviewRef) && safeId(t.samplePlanRef)
    && positive(t.nPerArm) && positive(t.maximumDurationDays) && positive(t.relevantCycleDays) && nonnegative(t.deliveryLagMs)
    && t.maximumDurationDays >= t.relevantCycleDays && timestamp(t.enrollmentToExclusive) - timestamp(t.enrollmentFrom) <= t.maximumDurationDays * DAY
    && typeof t.minimumUsefulEffectPp === 'number' && Number.isFinite(t.minimumUsefulEffectPp) && t.minimumUsefulEffectPp > 0 && t.minimumUsefulEffectPp <= 100
    && typeof t.mdePp === 'number' && Number.isFinite(t.mdePp) && t.mdePp > 0 && t.mdePp <= 100
    && c.statistics?.alpha === 0.05 && c.statistics.power === 0.8 && c.statistics.alternative === 'two_sided'
    && c.statistics.primaryIntervalMethod === 'newcombe_wilson95_v1' && c.statistics.sampleMethod === 'normal_two_proportion_05_80_v1'
    && c.statistics.missingOutcomePolicy === 'require_complete_primary_v1';
  if (!plan) trialReasons.add('trial_plan_incomplete');
  if (!TRIAL_PROOFS.every((id) => evidenceRef(e[id], c.definitionHash)) || !evidenceRef(e.samplePlan, c.definitionHash)) trialReasons.add('trial_evidence_incomplete');
  const review = e.baselineReview; const p = review?.estimate;
  const baseline = object(p) && safeId(b?.definitionRef) && p.phase === 'baseline' && p.eligibilityEpoch === b?.eligibilityEpoch && p.eligibilityVersion === VERSION
    && p.definitionHash === c.definitionHash && p.timezone === c.timezone && p.from === b.enrollmentFrom && p.toExclusive === b.enrollmentToExclusive
    && timestamp(p.asOf) !== null && timestamp(p.asOf) < timestamp(t?.enrollmentFrom) && p.windowStatus === 'reviewed' && p.windowMinutes === t?.primaryWindowMinutes
    && [p.firstEligibleSdkUnits, p.matureN, p.successes, p.knownFailures, p.unknownOutcomes, p.immatureUnits].every(nonnegative)
    && p.matureN > 0 && p.unknownOutcomes === 0 && p.immatureUnits === 0 && p.successes + p.knownFailures === p.matureN
    && p.firstEligibleSdkUnits === p.matureN && p.rate === p.successes / p.matureN && p.rate > 0 && p.rate < 1
    && positive(p.arrival?.completeObservableWeeks) && p.arrival.observedUnits === p.firstEligibleSdkUnits && p.arrival.perWeek === p.arrival.observedUnits / p.arrival.completeObservableWeeks
    && safeId(p.provenanceRef) && ['production', 'synthetic'].includes(p.sourceKind) && evidenceRef(review.evidence, c.definitionHash)
    && review.reviewRef === t?.baselineReviewRef && safeId(review.populationComparabilityRef)
    && review.evidence.sourceKind === p.sourceKind && commonKinds.has(p.sourceKind)
    && timestamp(c.frozenAt) >= timestamp(p.asOf) && timestamp(c.frozenAt) >= timestamp(review.evidence.asOf);
  if (!baseline) trialReasons.add('trial_baseline_unverified');
  if (baseline && plan) { const n = sampleSize(p.rate, t.mdePp); if (n === null || t.nPerArm < n) trialReasons.add('trial_sample_plan_invalid'); }
  const s = c.srm;
  if (!object(s) || s.method !== 'exact_binomial_50_50_v1' || !fraction(s.familyAlpha) || s.familyAlpha <= 0 || s.familyAlpha >= 1
    || s.multiplicity !== 'bonferroni_fixed_looks_v1' || !positive(s.minimumAssignedPerLook) || !Array.isArray(s.lookAt) || !s.lookAt.length
    || !s.lookAt.every((look, i) => timestamp(look) !== null && timestamp(look) >= timestamp(t?.enrollmentFrom)
      && timestamp(look) <= timestamp(t?.enrollmentToExclusive) && (!i || timestamp(look) > timestamp(s.lookAt[i - 1])))) trialReasons.add('trial_srm_policy_incomplete');
  const q = c.dataQuality;
  if (!object(q) || !['maxObservedAssignmentLoss', 'maxUnknownPrimaryFraction', 'maxUnknownVariantFraction', 'maxOriginConflictFraction'].every((id) => fraction(q[id]))
    || typeof q.independentDeliveryDenominatorRequired !== 'boolean' || !safeId(q.definitionRef)) trialReasons.add('trial_data_policy_incomplete');
  if (q?.independentDeliveryDenominatorRequired && !evidenceRef(e.independentDeliveryReconciliation, c.definitionHash)) trialReasons.add('trial_evidence_incomplete');
  if (!Array.isArray(c.guardPolicies) || !c.guardPolicies.some((g) => g?.id === 'reward_integrity' && g.required)
    || !c.guardPolicies.some((g) => g?.id === 'checkout' && g.required) || new Set(c.guardPolicies.map((g) => g?.id)).size !== c.guardPolicies.length
    || !c.guardPolicies.every((g) => validGuardDescriptor(g) && (!g.required || validGuard(g)))) trialReasons.add('trial_guard_policy_incomplete');
  const allKinds = [...COMMON_PROOFS, ...TRIAL_PROOFS, 'samplePlan', 'independentDeliveryReconciliation'].map((id) => e[id]?.sourceKind).filter(Boolean);
  if (new Set(allKinds).size !== 1) trialReasons.add('trial_evidence_incomplete');
  for (const reason of trialReasons) reasons.add(reason);
  return { baselineReady: Boolean(baselineReady), trialReady: Boolean(common && trialReasons.size === 0), reasons: [...reasons].sort() };
}

function logAdd(a, b) { if (a === -Infinity) return b; if (b === -Infinity) return a; const m = Math.max(a, b); return m + Math.log1p(Math.exp(Math.min(a, b) - m)); }
function exactSrm(control, treatment) {
  if (!nonnegative(control) || !nonnegative(treatment) || !Number.isSafeInteger(control + treatment)) throw new Error('Invalid assignment counts.');
  const n = control + treatment; if (!n) return { pValue: null, logP: null, n: 0, method: 'exact_binomial_50_50_v1' };
  const mode = Math.floor(n / 2); const k = Math.min(control, treatment); let logWeight = 0; let logLeft = 0; let logTail = mode <= k ? 0 : -Infinity; let logBelowMode = -Infinity;
  for (let i = mode; i > 0; i--) {
    logWeight += Math.log(i) - Math.log(n - i + 1); logLeft = logAdd(logLeft, logWeight); logBelowMode = logAdd(logBelowMode, logWeight);
    if (i - 1 <= k) logTail = logAdd(logTail, logWeight);
  }
  const logTotal = n % 2 ? Math.log(2) + logLeft : logAdd(0, Math.log(2) + logBelowMode);
  const logP = Math.min(0, Math.log(2) + logTail - logTotal);
  return { pValue: Math.exp(logP), logP, n, method: 'exact_binomial_50_50_v1' };
}
function difference95(successT, nT, successC, nC) {
  const t = wilson95(successT, nT); const c = wilson95(successC, nC); if (!t || !c) return null;
  const pT = successT / nT; const pC = successC / nC; const difference = pT - pC;
  return { difference, differencePp: difference * 100, lower: Math.max(-1, difference - Math.hypot(pT - t.lower, c.upper - pC)),
    upper: Math.min(1, difference + Math.hypot(t.upper - pT, pC - c.lower)), method: 'newcombe_wilson95_v1', confidence: 0.95 };
}
function auditValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : '"unsupported_nonfinite"';
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? 'null' : auditValue(item)).join(',')}]`;
  if (!object(value)) return '"unsupported_value"';
  return `{${Object.keys(value).filter((id) => value[id] !== undefined).sort().map((id) => `${JSON.stringify(id)}:${auditValue(value[id])}`).join(',')}}`;
}
function fingerprint(value) { return require('node:crypto').createHash('sha256').update(auditValue(value)).digest('hex'); }
function inputFingerprint(records) {
  const digest = require('node:crypto').createHash('sha256');
  for (const record of records) digest.update(auditValue(record)).update('\n');
  return digest.digest('hex');
}
function reportBase(options) {
  const config = options.config ?? defaults;
  const kinds = new Set([...COMMON_PROOFS, ...TRIAL_PROOFS].map((id) => options.evidence?.[id]?.sourceKind).filter((kind) => ['synthetic', 'production'].includes(kind)));
  const evidenceWorld = kinds.size === 1 ? [...kinds][0] : kinds.size ? 'mixed' : 'unknown';
  return { reportVersion: 1, game_id: 'slova', scope: 'point7_phase_scoped_help_experiment',
    source: { kind: options.source ?? 'observation', synthetic: options.source === 'synthetic', productionMetricsVerified: false },
    activationPerformed: false, additionalAcquisitionSpend: 0,
    experiment: { implementationId: ID, protocolReference: 'EXP-SLOVA-20261104-WHEEL-HELP', status: 'draft_no_activation' },
    phase: options.phase, eligibilityEpoch: safeId(config[options.phase]?.eligibilityEpoch) ? config[options.phase].eligibilityEpoch : null,
    asOf: new Date(timestamp(options.asOf)).toISOString(), timezone: fixedOffset(config.timezone) === null ? null : config.timezone,
    readiness: validateHelpExperimentReadiness(config, options.evidence),
    evidenceWorld: { kind: evidenceWorld, matchesDeclaredSource: evidenceWorld === 'unknown' || evidenceWorld === 'production' && options.source !== 'synthetic' || evidenceWorld === 'synthetic' && options.source === 'synthetic', independentlyVerifiedByThisTool: false },
    audit: { configSha256: fingerprint(config), evidenceSha256: fingerprint(options.evidence ?? {}), metricDefinitionHash: hash(config.definitionHash) ? config.definitionHash : null,
      expectedTrialPlanFingerprint: options.phase === 'trial' ? helpExperimentPlanFingerprint(config) : null,
      definitionHashIsNotFullPlanFingerprint: true },
    limitations: ['Offline readiness is conditional on provided evidence, not an independent rollout/ingestion/fleet-stop certification. Source=production alone verifies nothing.',
      'Only explicit baseline/trial epoch scopes are measured. Baseline is observational and never a randomized trial control arm.',
      'One native SDK unit is not a guaranteed independent human. Unknown membership/outcomes remain counts/bounds, never Bernoulli failures.',
      'Observed pair-loss rates are conditional on exported records. Both sides missing outside the export are unobservable without independent reconciliation.',
      'This CLI does not fetch or configure slova_help_experiment_stop_v1, change runtime flags, deploy, spend or schedule anything.'],
    stopControl: { adapterKey: 'slova_help_experiment_stop_v1', actualConnectionVerifiedByThisTool: false,
      contract: 'typed scope/allocation/revision/disabledVariants with bounded live lease; unavailable, stale, old binary or scope mismatch denies trial enrollment; baseline does not require trial stop port' } };
}
function validateAnalysisOptions(options = {}) {
  if (!['baseline', 'trial'].includes(options.phase) || timestamp(options.asOf) === null || !['synthetic', 'observation', 'production'].includes(options.source ?? 'observation')) throw new Error('Explicit phase, asOf UTC/offset and valid source are required.');
  const config = options.config ?? defaults;
  if (!object(config)) throw new Error('Configuration must be a JSON object.');
  if (options.epochSelector !== undefined && (!safeId(options.epochSelector) || options.epochSelector !== config[options.phase]?.eligibilityEpoch)) throw new Error('Epoch selector must equal the declared configuration epoch.');
  return { ...options, config, source: options.source ?? 'observation' };
}
function buildNeedsRawDataReport(options) {
  const validated = validateAnalysisOptions(options);
  return { ...reportBase(validated), status: 'needs_raw_data', metrics: null, dataHealth: { state: 'missing', reasons: ['raw_player_events_missing'] },
    decision: { kind: 'needs_raw_data', activationPerformed: false },
    requiredInput: ['Raw first-request/insufficient/assignment/exposure SDK events with explicit phase/epoch and original clocks, plus exact attempt outcomes and outside-window consent/conflict evidence.',
      'Reviewed config/evidence for baseline or trial; production values/proofs remain null/unverified until actually supplied. Aggregate event/user totals do not reconstruct first claims or ITT.'] };
}
function phaseSpec(config, phase) {
  const p = config[phase]; const window = phase === 'baseline' ? p?.analysisWindowMinutes : p?.primaryWindowMinutes;
  if (!object(p) || !safeId(p.eligibilityEpoch) || timestamp(p.enrollmentFrom) === null || timestamp(p.enrollmentToExclusive) === null
    || timestamp(p.enrollmentFrom) >= timestamp(p.enrollmentToExclusive) || fixedOffset(config.timezone) === null
    || window !== null && window !== 10 || phase === 'trial' && (!positive(p.allocationVersion) || window !== 10)) return null;
  return { experimentId: ID, eligibilityVersion: VERSION, phase, eligibilityEpoch: p.eligibilityEpoch,
    allocationVersion: phase === 'trial' ? p.allocationVersion : null, enrollmentFrom: p.enrollmentFrom, enrollmentToExclusive: p.enrollmentToExclusive,
    primaryWindowMinutes: window, trialPlanFingerprint: phase === 'trial' ? helpExperimentPlanFingerprint(config) : null,
    acceptedOriginVersions: config.acceptedOriginVersions, deliveryLagMs: phase === 'trial' ? p.deliveryLagMs : 0 };
}
function finalFreeze(config) {
  const end = timestamp(config.trial?.enrollmentToExclusive); const offset = fixedOffset(config.timezone);
  if (end === null || offset === null || !nonnegative(config.trial?.deliveryLagMs) || config.trial.primaryWindowMinutes !== 10) return null;
  const lastDayStart = Math.floor((end - 1 + offset * 60000) / DAY) * DAY - offset * 60000;
  return Math.max(end + config.trial.primaryWindowMinutes * 60000, lastDayStart + 8 * DAY) + config.trial.deliveryLagMs;
}
function observedHealth(metrics, config, evidence, asOfMs) {
  const q = config.dataQuality ?? {}; const a = metrics.assignments; const p = metrics.primary.total; const links = metrics.linkage;
  const union = metrics.firstClaims.observedCertainUnits + a.total - metrics.firstClaims.matchedAssignmentUnits;
  const lost = links.claimWithoutAssignment + links.assignmentWithoutClaim;
  const losses = { observedUnionUnits: union, observedUnpairedUnits: lost, observedPairLossRate: union ? lost / union : null,
    pendingPairUnits: links.pendingClaimWithoutAssignment + links.pendingAssignmentWithoutClaim,
    populationDeliveryDenominator: null, populationDeliveryRate: null,
    independentReconciliation: evidenceRef(evidence?.independentDeliveryReconciliation, config.definitionHash) ? 'provided_verified_evidence_not_independently_certified' : 'missing_or_unverified' };
  const srm = metrics.assignmentLooks.map((look) => {
    const mature = timestamp(look.cutoff) + (config.trial?.deliveryLagMs ?? Infinity) <= asOfMs;
    const unknown = look.unknownVariant + look.ambiguousScopeUnits + look.unknownAssignmentTime + look.unknownPlanUnits;
    const n = look.control + look.treatment;
    if (!mature) return { ...look, state: 'pending_delivery_lag', pValue: null };
    if (unknown) return { ...look, state: 'unknown_assignment_membership', pValue: null };
    if (!n) return { ...look, state: 'not_started', pValue: null };
    if (!positive(config.srm?.minimumAssignedPerLook) || n < config.srm.minimumAssignedPerLook) return { ...look, state: 'insufficient_data', pValue: null };
    const statistic = exactSrm(look.control, look.treatment);
    const threshold = fraction(config.srm?.familyAlpha) && config.srm.familyAlpha > 0 && config.srm.lookAt?.length ? config.srm.familyAlpha / config.srm.lookAt.length : null;
    return { ...look, ...statistic, familyThreshold: threshold, state: threshold === null ? 'threshold_unfrozen' : statistic.logP <= Math.log(threshold) ? 'failed' : 'pass' };
  });
  const reasons = []; let failed = false; let uncertain = false;
  if (!['maxObservedAssignmentLoss', 'maxUnknownPrimaryFraction', 'maxUnknownVariantFraction', 'maxOriginConflictFraction'].every((id) => fraction(q[id])) || !safeId(q.definitionRef)) {
    reasons.push('data_loss_policy_unfrozen'); uncertain = true;
  }
  if (config.srm?.method !== 'exact_binomial_50_50_v1' || !fraction(config.srm.familyAlpha) || config.srm.familyAlpha <= 0
    || !Array.isArray(config.srm.lookAt) || !config.srm.lookAt.length) { reasons.push('assignment_srm_plan_unfrozen'); uncertain = true; }
  const breach = (value, threshold, reason) => { if (value !== null && fraction(threshold) && value > threshold) { reasons.push(reason); failed = true; } };
  breach(losses.observedPairLossRate, q.maxObservedAssignmentLoss, 'observed_pair_loss_threshold');
  breach(a.total ? a.unknownVariant / a.total : null, q.maxUnknownVariantFraction, 'unknown_variant_threshold');
  breach(p.denominator ? p.unknownUnits / p.denominator : null, q.maxUnknownPrimaryFraction, 'unknown_primary_threshold');
  breach(a.total ? (a.conflictingAssignments + metrics.firstClaims.conflicting) / a.total : null, q.maxOriginConflictFraction, 'origin_assignment_conflict_threshold');
  if (a.ambiguousScopeAssignmentUnits || metrics.quality.ambiguousClaimUnits) { reasons.push('ambiguous_scope_membership'); uncertain = true; }
  if (metrics.quality.missingFirstClaimFlagUnits) { reasons.push('missing_first_claim_metadata'); uncertain = true; }
  if (metrics.quality.trialPlanMismatchUnits) { reasons.push('missing_mixed_or_mismatched_trial_plan'); uncertain = true; }
  if (metrics.quality.unprovenOriginalQueryUnits) { reasons.push('unproven_assignment_original_query'); uncertain = true; }
  if (metrics.quality.nonNativeSdkUnits) { reasons.push('unknown_native_sdk_unit_provenance'); uncertain = true; }
  if (metrics.quality.source.invalidRecords || metrics.quality.source.missingSdkIdentity || metrics.quality.source.invalidSdkRecords) { reasons.push('unresolved_export_identity_or_schema'); uncertain = true; }
  if (q.independentDeliveryDenominatorRequired && losses.independentReconciliation === 'missing_or_unverified') { reasons.push('independent_delivery_proof_missing'); uncertain = true; }
  if (srm.some((look) => look.state === 'failed')) { reasons.push('assignment_srm_failed'); failed = true; }
  if (srm.some((look) => ['unknown_assignment_membership', 'threshold_unfrozen'].includes(look.state))) { reasons.push('assignment_srm_unknown'); uncertain = true; }
  const noUnits = !a.total && !union && !a.ambiguousScopeAssignmentUnits && !metrics.quality.ambiguousClaimUnits && !metrics.quality.missingFirstClaimFlagUnits
    && !metrics.quality.source.invalidRecords && !metrics.quality.source.missingSdkIdentity && !metrics.quality.source.invalidSdkRecords;
  const state = failed ? 'fail' : noUnits ? 'not_started' : uncertain ? 'unknown' : losses.pendingPairUnits ? 'pending' : 'pass';
  return { state, reasons, losses, srm, interpretation: 'Within provided evidence and observed export union; no population delivery estimate or independent fleet certification.' };
}
function guardAssessments(metrics, config, evidence, health, asOfMs) {
  const minArm = Math.min(metrics.primary.control.denominator, metrics.primary.treatment.denominator);
  return (config.guardPolicies ?? []).filter((g) => g?.required).map((g) => {
    const result = { id: GUARD_IDS.includes(g.id) ? g.id : 'unsupported', state: 'unknown', reason: 'unsupported_required_guard', method: g.method };
    if (!validGuard(g)) return { ...result, reason: 'invalid_required_guard_policy' };
    if (g.method === 'authoritative_incident_v1' && ['reward_integrity', 'checkout'].includes(g.id)) {
      const window = metrics.financialIntegrity.primaryWindow;
      if (g.unit !== 'assigned_sdk_player' || g.source !== 'domain_incident_proof' || g.direction !== 'zero_incidents'
        || g.harmMargin.unit !== 'count' || g.harmMargin.value !== 0 || g.window.origin !== 'first_request'
        || g.window.milliseconds !== window.milliseconds || g.window.calendarDay !== null)
        return { ...result, reason: 'unsupported_required_guard_unit_source_or_window' };
      const events = g.id === 'reward_integrity' ? window.provenDuplicateEntitlements : window.confirmedBrokenCheckouts;
      if (events) return { ...result, state: 'fail', reason: 'authoritative_incident', observedIncidents: events };
      const proof = g.id === 'reward_integrity' ? evidence?.rewardGuardObservability : evidence?.checkoutObservability;
      const possible = g.id === 'reward_integrity' ? window.possibleRewardWalletFacts : window.possibleBrokenCheckouts;
      if (!evidenceRef(proof, config.definitionHash) || proof.ref !== g.observabilityEvidenceRef || possible || window.consentGuardUnknownUnits
        || health.state !== 'pass' || minArm < g.minimumMaturePerArm || metrics.primary.total.immatureUnits || metrics.primary.total.unknownMaturityUnits)
        return { ...result, reason: 'incident_observability_or_maturity_unknown', observedIncidents: 0 };
      return { ...result, state: 'pass', reason: 'no_observed_incident_within_provided_observability', observedIncidents: 0 };
    }
    if (g.method === 'newcombe_wilson95_rate_diff_v1' && ['experiment_return_d1', 'experiment_return_d7'].includes(g.id)
      && g.unit === 'assigned_sdk_player' && g.harmMargin.unit === 'pp') {
      const day = g.id.endsWith('d1') ? 1 : 7;
      if (g.source !== 'raw_client' || g.window.origin !== 'exact_calendar_day' || g.window.calendarDay !== day || g.window.milliseconds !== null
        || g.harmMargin.value > 100 || !evidenceRef(evidence?.returnGuardObservability, config.definitionHash)
        || evidence.returnGuardObservability.ref !== g.observabilityEvidenceRef)
        return { ...result, reason: 'unsupported_or_unproven_return_guard_source_window' };
      const arms = metrics.experimentReturn[`D${day}`].gameplay;
      if ([arms.control, arms.treatment].some((arm) => arm.unknownUnits || arm.immatureUnits || arm.denominator < g.minimumMaturePerArm)) return { ...result, reason: 'return_guard_incomplete' };
      const interval = difference95(arms.treatment.numerator, arms.treatment.denominator, arms.control.numerator, arms.control.denominator);
      if (!interval) return { ...result, reason: 'return_guard_no_units' };
      const margin = g.harmMargin.value / 100;
      const safe = g.direction === 'higher_better' ? interval.lower >= -margin : interval.upper <= margin;
      const harm = g.direction === 'higher_better' ? interval.upper < -margin : interval.lower > margin;
      return { ...result, state: safe ? 'pass' : harm ? 'fail' : 'unknown', reason: safe ? 'within_frozen_harm_margin' : harm ? 'outside_harm_margin' : 'harm_interval_inconclusive', interval };
    }
    return { ...result, reason: g.method === 'external_reviewed_distribution_v1' ? 'distribution_guard_not_implemented_or_independently_verified' : 'unsupported_required_guard_unit_or_metric', asOf: new Date(asOfMs).toISOString() };
  });
}
function evaluateHelpExperimentDecision(report) {
  if (report.safety?.confirmedIncident) return { kind: 'stop_safety', reason: 'authoritative_domain_incident', activationPerformed: false };
  if (!report.metrics) return { kind: report.status === 'needs_raw_data' ? 'needs_raw_data' : 'not_ready', activationPerformed: false };
  if (report.phase === 'baseline') return { kind: 'baseline_observation', reason: 'baseline_is_not_a_trial_arm', activationPerformed: false };
  if (!report.readiness.trialReady) return { kind: 'not_ready', reason: 'trial_definition_or_external_proofs_incomplete', activationPerformed: false };
  if (report.dataHealth.state === 'fail') return { kind: 'stop_measurement', reason: 'assignment_or_delivery_integrity', activationPerformed: false };
  if (report.dataHealth.state === 'unknown') return { kind: 'measurement_inconclusive', reason: 'unknown_population_or_membership', activationPerformed: false };
  if (!report.finalPlan.sampleAchieved || !report.finalPlan.fullFollowupMature || report.dataHealth.srm.some((look) => look.state !== 'pass'))
    return { kind: report.finalPlan.fullFollowupMature ? 'inconclusive' : 'collect_to_frozen_plan', reason: 'fixed_sample_or_maturity_incomplete', activationPerformed: false };
  if (!report.effect?.interval || report.guards.some((g) => g.state !== 'pass')) return { kind: 'inconclusive', reason: 'effect_or_required_guards_unavailable', activationPerformed: false };
  const margin = report.finalPlan.minimumUsefulEffectPp / 100;
  return { kind: report.effect.interval.lower >= margin ? 'supports_treatment' : report.effect.interval.upper < margin ? 'no_supported_useful_effect' : 'inconclusive',
    reason: 'one_preregistered_primary_comparison', activationPerformed: false };
}
function analyzeHelpExperiment(records, options) {
  const o = validateAnalysisOptions(options); if (!Array.isArray(records)) throw new Error('Input must be an array of raw event objects.');
  if (!records.length) return buildNeedsRawDataReport(o);
  const base = reportBase(o); base.audit.recordsSha256 = inputFingerprint(records);
  const spec = phaseSpec(o.config, o.phase);
  if (!spec) return { ...base, status: 'definition_blocked', metrics: null, dataHealth: { state: 'unknown', reasons: ['declared_scope_or_window_missing_or_unsupported'] }, decision: { kind: 'not_ready', activationPerformed: false } };
  const freeze = o.phase === 'trial' ? finalFreeze(o.config) : null;
  const context = createHelpExperimentAnalysisContext(records, { asOf: o.asOf, timezone: o.config.timezone, source: o.source });
  const metrics = context.analyzeScope({ ...spec, assignmentLookAt: o.phase === 'trial' ? o.config.srm?.lookAt ?? [] : [], observationTo: freeze === null ? o.asOf : new Date(freeze).toISOString() });
  const report = { ...base, status: o.phase === 'baseline' ? 'baseline_observed' : 'trial_observed', metrics };
  if (o.phase === 'baseline') {
    const counts = metrics.primary.total; const duration = Math.max(0, Math.min(timestamp(o.asOf), timestamp(spec.enrollmentToExclusive)) - timestamp(spec.enrollmentFrom));
    const weeks = Number.isInteger(duration / (7 * DAY)) ? duration / (7 * DAY) : 0;
    report.baselineEstimate = { phase: 'baseline', eligibilityEpoch: spec.eligibilityEpoch, eligibilityVersion: VERSION,
      definitionHash: hash(o.config.definitionHash) ? o.config.definitionHash : null, timezone: o.config.timezone,
      from: spec.enrollmentFrom, toExclusive: spec.enrollmentToExclusive, asOf: o.asOf, windowMinutes: spec.primaryWindowMinutes, windowStatus: o.config.baseline.windowStatus,
      firstEligibleSdkUnits: metrics.firstClaims.valid, matureN: counts.denominator, successes: counts.numerator, knownFailures: counts.knownOutcomeUnits - counts.numerator,
      unknownOutcomes: counts.unknownUnits + counts.unprovenDenominatorUnits, immatureUnits: counts.immatureUnits,
      rate: metrics.quality.nonNativeSdkUnits ? null : counts.rate,
      wilson95: counts.rate === null || metrics.quality.nonNativeSdkUnits ? null : wilson95(counts.numerator, counts.denominator), identificationBounds: counts.bounds,
      arrival: { observedUnits: metrics.firstClaims.valid, completeObservableWeeks: weeks, perWeek: weeks ? metrics.firstClaims.valid / weeks : null }, sourceKind: o.source, provenanceRef: null };
    report.dataHealth = { state: metrics.assignments.total ? 'fail' : metrics.firstClaims.unknown || metrics.firstClaims.conflicting || metrics.quality.nonNativeSdkUnits ? 'unknown' : metrics.firstClaims.valid ? 'observed' : 'missing',
      reasons: metrics.assignments.total ? ['assignment_in_baseline'] : metrics.quality.nonNativeSdkUnits ? ['unknown_native_sdk_unit_provenance'] : [], populationDeliveryDenominator: null };
  } else {
    report.dataHealth = observedHealth(metrics, o.config, o.evidence, timestamp(o.asOf));
    if (!report.evidenceWorld.matchesDeclaredSource) { report.dataHealth.state = 'unknown'; report.dataHealth.reasons.push('evidence_world_does_not_match_declared_source'); }
    const p = metrics.primary;
    report.effect = { interval: report.dataHealth.state !== 'pass' || p.control.unknownUnits || p.treatment.unknownUnits || p.control.unknownMaturityUnits || p.treatment.unknownMaturityUnits || metrics.assignments.ambiguousScopeAssignmentUnits
      || o.config.statistics?.primaryIntervalMethod !== 'newcombe_wilson95_v1' ? null : difference95(p.treatment.numerator, p.treatment.denominator, p.control.numerator, p.control.denominator),
      missingOutcomeBounds: p.control.bounds && p.treatment.bounds ? { lower: p.treatment.bounds.lower - p.control.bounds.upper, upper: p.treatment.bounds.upper - p.control.bounds.lower } : null,
      interpretation: 'Sampling interval requires complete mature known SDK-unit outcomes. Missing-data bounds are separate, not a confidence interval.' };
    report.guards = guardAssessments(metrics, o.config, o.evidence, report.dataHealth, timestamp(o.asOf));
    report.safety = { confirmedIncident: metrics.financialIntegrity.provenDuplicateEntitlements > 0 || metrics.financialIntegrity.confirmedBrokenCheckouts > 0,
      authoritativeDuplicateEntitlements: metrics.financialIntegrity.provenDuplicateEntitlements, authoritativeBrokenCheckouts: metrics.financialIntegrity.confirmedBrokenCheckouts,
      unavailableProofs: ['economic_loss_without_journal_proof', 'critical_crash_without_authoritative_export'], diagnosticLatchEventAloneIsProof: false };
    report.finalPlan = { fullFollowupMature: freeze !== null && timestamp(o.asOf) >= freeze,
      requiredDataAsOf: freeze === null ? null : new Date(freeze).toISOString(), minimumUsefulEffectPp: o.config.trial.minimumUsefulEffectPp,
      sampleAchieved: positive(o.config.trial.nPerArm) && p.control.denominator >= o.config.trial.nPerArm && p.treatment.denominator >= o.config.trial.nPerArm
        && !p.control.immatureUnits && !p.treatment.immatureUnits && !p.control.unknownMaturityUnits && !p.treatment.unknownMaturityUnits };
  }
  report.decision = evaluateHelpExperimentDecision(report); return report;
}
function renderMarkdown(report) {
  const lines = ['# Slova P7 help experiment measurement', '', `Status: **${report.status}**. Phase: **${report.phase}**. Source: **${report.source.kind}**${report.source.synthetic ? ' — SYNTHETIC DEVELOPMENT DATA; NOT LIVE' : ''}.`,
    '', `Decision: **${report.decision.kind}**. Activation performed: false. Production metrics verified: false.`,
    `Declared cutoff: ${report.asOf}; timezone: ${report.timezone ?? 'unfrozen'}.`,
    `Baseline collection ready (provided evidence): ${report.readiness.baselineReady}; trial prelaunch ready (provided evidence): ${report.readiness.trialReady}.`, ''];
  if (!report.metrics) lines.push('Measured values unavailable. Raw player events and a declared phase/epoch/window are required.');
  else {
    lines.push('| Cohort | Success / mature N | Unknown | Immature | Rate |', '|---|---:|---:|---:|---:|');
    for (const name of ['total', 'control', 'treatment']) { const row = report.metrics.primary[name]; lines.push(`| ${name} | ${row.numerator}/${row.denominator} | ${row.unknownUnits} | ${row.immatureUnits} | ${row.rate === null ? 'unavailable' : `${(row.rate * 100).toFixed(2)}%`} |`); }
    lines.push('', 'Primary uses all actual scoped assignments, never only exposed/ad/reward users. Baseline and install retention are separate cohorts.',
      `Observed health: ${report.dataHealth.state}. Config fingerprint: ${report.audit.configSha256}.`,
      'Companion JSON retains membership/absence bounds, maturity, SRM looks, observed-union loss, required guards and full audit fingerprints without raw SDK or operation IDs.');
  }
  lines.push('', 'Readiness reasons:', '', ...report.readiness.reasons.map((r) => `- ${r}`), '', 'Limits:', '', ...report.limitations.map((r) => `- ${r}`), '');
  return lines.join('\n');
}
function parseArguments(argv) {
  const o = { input: [] }; const seen = new Set();
  const names = { '--config': 'configPath', '--evidence': 'evidencePath', '--phase': 'phase', '--epoch': 'epochSelector', '--as-of': 'asOf', '--source': 'source', '--output': 'output' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; if (arg === '--input') { const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error('--input requires a path.'); o.input.push(value); continue; }
    if (seen.has(arg)) throw new Error('Duplicate CLI argument.'); seen.add(arg);
    if (arg === '--needs-raw-data') { o.needsRawData = true; continue; }
    if (!names[arg]) throw new Error('Unknown CLI argument. See docs/runbooks/help-experiment-analysis.md.');
    const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error('CLI argument requires a value.'); o[names[arg]] = value;
  }
  if (!o.output || !o.phase || !o.asOf || !o.source) throw new Error('--output, --phase, --as-of and --source are required.');
  if (o.needsRawData && o.input.length || !o.needsRawData && !o.input.length) throw new Error('Use input files or explicit --needs-raw-data, not both.');
  return o;
}
function readJson(file, kind) { try { const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); if (!object(value)) throw new Error(); return value; } catch { throw new Error(`Invalid or unreadable ${kind} JSON (payload omitted).`); } }
function main(argv) {
  const o = parseArguments(argv); o.config = o.configPath ? readJson(o.configPath, 'configuration') : defaults; o.evidence = o.evidencePath ? readJson(o.evidencePath, 'evidence') : null;
  validateAnalysisOptions(o); const prefix = path.resolve(o.output); const outputs = [`${prefix}.json`, `${prefix}.md`];
  const inputs = [...o.input, o.configPath ?? path.resolve(__dirname, '../src/core/config/helpExperiment.defaults.json'), ...(o.evidencePath ? [o.evidencePath] : [])]
    .map((file) => { try { return { path: fs.realpathSync(file), stat: fs.statSync(file) }; } catch { throw new Error('Cannot read a protected input.'); } });
  const destinations = outputs.map((file) => ({ path: fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file), stat: fs.existsSync(file) ? fs.statSync(file) : null }));
  const aliases = (a, b) => a.path.toLowerCase() === b.path.toLowerCase() || a.stat && b.stat && a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino;
  if (destinations.some((out) => inputs.some((input) => aliases(input, out))) || aliases(destinations[0], destinations[1])) throw new Error('Report outputs must not alias any input or each other.');
  const report = o.needsRawData ? buildNeedsRawDataReport(o) : analyzeHelpExperiment(readInputFiles(o.input), o);
  try { fs.mkdirSync(path.dirname(prefix), { recursive: true }); fs.writeFileSync(outputs[0], `${JSON.stringify(report, null, 2)}\n`); fs.writeFileSync(outputs[1], renderMarkdown(report)); }
  catch { throw new Error('Cannot write report outputs.'); }
  process.stdout.write(`${JSON.stringify({ status: report.status, phase: report.phase, decision: report.decision.kind, source: report.source.kind, outputFiles: outputs.map((file) => path.basename(file)) })}\n`);
}
module.exports = { analyzeHelpExperiment, buildNeedsRawDataReport, validateHelpExperimentReadiness, evaluateHelpExperimentDecision, exactSrm, difference95, sampleSize, readInputFiles, renderMarkdown, parseArguments };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error instanceof SyntaxError ? 'Invalid JSON (payload omitted).' : error.message}\n`); process.exitCode = 1; } }
