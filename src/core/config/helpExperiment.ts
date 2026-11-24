import defaults from './helpExperiment.defaults.json';
export { helpExperimentPlanFingerprint } from '../analyticsKeyToken.cjs';

export const HELP_EXPERIMENT_ID = 'slova_wheel_help_clarity_20261104' as const;
export type MeasurementPhase = 'baseline' | 'trial';
export type GuardPolicy = {
  id: 'reward_integrity' | 'ad_readiness' | 'ad_failure' | 'wall_deadline' | 'active_time' | 'exit_after_request'
    | 'experiment_return_d1' | 'experiment_return_d7' | 'wallet_distribution' | 'checkout';
  required: boolean; definitionRef: string | null; numeratorRef: string | null; denominatorRef: string | null;
  unit: 'assigned_sdk_player' | 'origin_flow' | 'accepted_show_operation' | 'earned_entitlement' | 'completed_full_coverage_attempt';
  source: 'raw_client' | 'reconciled_server' | 'domain_incident_proof';
  window: { origin: 'first_request' | 'first_grant' | 'earned' | 'exact_calendar_day'; milliseconds: number | null; calendarDay: 1 | 7 | null };
  maturityRef: string | null; method: 'authoritative_incident_v1' | 'newcombe_wilson95_rate_diff_v1' | 'external_reviewed_distribution_v1' | null;
  direction: 'higher_better' | 'higher_worse' | 'zero_incidents'; harmMargin: { value: number; unit: 'pp' | 'ms' | 'coins' | 'count' } | null;
  minimumMaturePerArm: number | null; observabilityEvidenceRef: string | null;
};
export type HelpExperimentMeasurementConfigV1 = {
  schemaVersion: 1; experimentId: typeof HELP_EXPERIMENT_ID; protocolReference: 'EXP-SLOVA-20261104-WHEEL-HELP';
  eligibilityVersion: 'help_deficit_v1'; unitType: 'sdk_player'; expectedAllocation: { control: 1; treatment: 1 };
  approvedProtocolRef: string | null; frozenAt: string | null; definitionHash: string | null;
  timezone: string | null; acceptedOriginVersions: string[] | null; producerContractRef: string | null;
  identityPolicy: 'known_pre_epoch_continuity_only_v1' | null; historyPolicyRef: string | null;
  baseline: { enabled: boolean; eligibilityEpoch: string | null; enrollmentFrom: string | null; enrollmentToExclusive: string | null;
    analysisWindowMinutes: number | null; windowStatus: 'proposed' | 'reviewed' | null; definitionRef: string | null };
  trial: { enabled: boolean; eligibilityEpoch: string | null; enrollmentFrom: string | null; enrollmentToExclusive: string | null;
    allocationVersion: number | null; primaryWindowMinutes: number | null; baselineReviewRef: string | null;
    minimumUsefulEffectPp: number | null; mdePp: number | null; nPerArm: number | null; maximumDurationDays: number | null;
    relevantCycleDays: number | null; deliveryLagMs: number | null; samplePlanRef: string | null };
  statistics: { alpha: number; power: number; alternative: 'two_sided'; primaryIntervalMethod: 'newcombe_wilson95_v1' | null;
    sampleMethod: 'normal_two_proportion_05_80_v1' | null; missingOutcomePolicy: 'require_complete_primary_v1' | null };
  srm: { method: 'exact_binomial_50_50_v1' | null; familyAlpha: number | null; lookAt: string[] | null;
    multiplicity: 'bonferroni_fixed_looks_v1' | null; minimumAssignedPerLook: number | null };
  dataQuality: { maxObservedAssignmentLoss: number | null; maxUnknownPrimaryFraction: number | null;
    maxUnknownVariantFraction: number | null; maxOriginConflictFraction: number | null;
    independentDeliveryDenominatorRequired: boolean | null; definitionRef: string | null };
  guardPolicies: GuardPolicy[] | null;
};
export type EvidenceRef = { state: 'verified' | 'unverified' | 'missing' | 'failed'; sourceKind: 'production' | 'synthetic';
  ref: string; methodVersion: string; scopeHash: string; producerDefinitionHash: string;
  observedFrom: string; observedToExclusive: string; asOf: string };
export type BaselineEstimateV1 = { phase: 'baseline'; eligibilityEpoch: string; eligibilityVersion: 'help_deficit_v1';
  definitionHash: string; timezone: string; from: string; toExclusive: string; asOf: string; windowMinutes: number;
  windowStatus: 'proposed' | 'reviewed'; firstEligibleSdkUnits: number; matureN: number; successes: number;
  knownFailures: number; unknownOutcomes: number; immatureUnits: number; rate: number | null;
  wilson95: { lower: number; upper: number } | null; identificationBounds: { lower: number; upper: number } | null;
  arrival: { observedUnits: number; completeObservableWeeks: number; perWeek: number | null };
  sourceKind: 'production' | 'synthetic'; provenanceRef: string | null };
export type HelpExperimentEvidenceV1 = Record<'producerRollout' | 'rawIngestion' | 'originAndDedupeProof'
  | 'identityHistoryContinuity' | 'commonTechnicalSafety' | 'stopControl' | 'rewardGuardObservability'
  | 'adGuardObservability' | 'checkoutObservability' | 'returnGuardObservability' | 'timeAndWalletGuardObservability', EvidenceRef> & {
    baselineReview: { evidence: EvidenceRef; estimate: BaselineEstimateV1; reviewRef: string; populationComparabilityRef: string } | null;
    samplePlan: EvidenceRef | null; independentDeliveryReconciliation: EvidenceRef | null;
  };
export type ReadinessResultV1 = { baselineReady: boolean; trialReady: boolean; reasons: string[] };
export const HELP_EXPERIMENT_CONFIG = defaults as HelpExperimentMeasurementConfigV1;
/** Production proofs are deliberately absent; a config flag alone never enrolls a player. */
export const HELP_EXPERIMENT_EVIDENCE: HelpExperimentEvidenceV1 | null = null;

export const helpSafeId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,191}$/i.test(value);
const timestamp = (value: unknown): number => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const fraction = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
export function isHelpEvidenceRef(value: unknown, definitionHash: string | null): value is EvidenceRef {
  if (!value || typeof value !== 'object') return false;
  const e = value as EvidenceRef;
  return e.state === 'verified' && ['production', 'synthetic'].includes(e.sourceKind)
    && helpSafeId(e.ref) && helpSafeId(e.methodVersion) && hash(e.scopeHash)
    && hash(e.producerDefinitionHash) && e.producerDefinitionHash === definitionHash
    && timestamp(e.observedFrom) < timestamp(e.observedToExclusive) && timestamp(e.observedToExclusive) <= timestamp(e.asOf);
}
/** Pure prelaunch validator. Observed trial SRM/outcome/return maturity belongs to post-enrollment analysis. */
export function validateHelpExperimentReadiness(config: unknown, evidence: unknown): ReadinessResultV1 {
  const reasons: string[] = [];
  if (!config || typeof config !== 'object') return { baselineReady: false, trialReady: false, reasons: ['config_invalid'] };
  const c = config as HelpExperimentMeasurementConfigV1, e = evidence as Partial<HelpExperimentEvidenceV1> | null;
  if (['baseline', 'trial', 'statistics', 'srm', 'dataQuality'].some((key) => {
    const value = (config as Record<string, unknown>)[key]; return !value || typeof value !== 'object' || Array.isArray(value);
  })) return { baselineReady: false, trialReady: false, reasons: ['config_invalid'] };
  const requireGate = (ok: unknown, reason: string) => { if (!ok) reasons.push(reason); };
  requireGate(c.schemaVersion === 1 && c.experimentId === HELP_EXPERIMENT_ID && c.protocolReference === 'EXP-SLOVA-20261104-WHEEL-HELP'
    && c.eligibilityVersion === 'help_deficit_v1' && c.unitType === 'sdk_player'
    && c.expectedAllocation?.control === 1 && c.expectedAllocation?.treatment === 1, 'invalid_contract');
  requireGate(helpSafeId(c.approvedProtocolRef) && hash(c.definitionHash) && Number.isFinite(timestamp(c.frozenAt)), 'missing_frozen_definition');
  requireGate(typeof c.timezone === 'string' && /^(?:UTC|Z|(?:UTC)?[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(c.timezone), 'invalid_timezone');
  requireGate(Array.isArray(c.acceptedOriginVersions) && c.acceptedOriginVersions.length > 0 && c.acceptedOriginVersions.every((v) => typeof v === 'string' && /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(v))
    && helpSafeId(c.producerContractRef), 'missing_producer_contract');
  requireGate(c.identityPolicy === 'known_pre_epoch_continuity_only_v1' && helpSafeId(c.historyPolicyRef), 'missing_identity_history_policy');
  const baselineProofs = ['producerRollout', 'rawIngestion', 'originAndDedupeProof', 'identityHistoryContinuity', 'commonTechnicalSafety'] as const;
  for (const key of baselineProofs) requireGate(isHelpEvidenceRef(e?.[key], c.definitionHash), `unverified_${key}`);
  requireGate(new Set(baselineProofs.map((key) => e?.[key]?.sourceKind)).size === 1, 'unverified_common_world');
  const commonReady = reasons.length === 0;
  const b = c.baseline, t = c.trial;
  const declaredRange = (p: typeof b | typeof t | undefined) => !!p && helpSafeId(p.eligibilityEpoch)
    && Number.isFinite(timestamp(p.enrollmentFrom)) && Number.isFinite(timestamp(p.enrollmentToExclusive))
    && timestamp(p.enrollmentFrom) < timestamp(p.enrollmentToExclusive);
  const range = (p: typeof b | typeof t | undefined) => declaredRange(p) && timestamp(c.frozenAt) < timestamp(p?.enrollmentFrom);
  requireGate(b?.enabled === true, 'baseline_disabled'); requireGate(range(b), 'invalid_baseline_scope');
  const baselineReady = commonReady && b?.enabled === true && range(b);
  const trialStart = reasons.length;
  requireGate(t?.enabled === true, 'trial_disabled'); requireGate(range(t), 'invalid_trial_scope');
  requireGate(declaredRange(b) && b?.eligibilityEpoch !== t?.eligibilityEpoch
    && timestamp(b?.enrollmentToExclusive) <= timestamp(t?.enrollmentFrom), 'overlapping_phase_scopes');
  requireGate(positive(t?.allocationVersion), 'missing_allocation_version');
  requireGate(t?.primaryWindowMinutes === 10, 'unsupported_primary_window');
  requireGate(helpSafeId(t?.baselineReviewRef) && helpSafeId(t?.samplePlanRef) && positive(t?.nPerArm)
    && positive(t?.maximumDurationDays) && positive(t?.relevantCycleDays) && nonnegative(t?.deliveryLagMs)
    && t.maximumDurationDays >= t.relevantCycleDays
    && timestamp(t.enrollmentToExclusive) - timestamp(t.enrollmentFrom) <= t.maximumDurationDays * 86_400_000, 'missing_fixed_sample_horizon');
  requireGate(typeof t?.minimumUsefulEffectPp === 'number' && t.minimumUsefulEffectPp > 0 && t.minimumUsefulEffectPp <= 100
    && typeof t?.mdePp === 'number' && t.mdePp > 0 && t.mdePp <= 100, 'missing_effect_requirements');
  requireGate(c.statistics?.alpha === 0.05 && c.statistics?.power === 0.8 && c.statistics?.alternative === 'two_sided'
    && c.statistics.primaryIntervalMethod === 'newcombe_wilson95_v1' && c.statistics.sampleMethod === 'normal_two_proportion_05_80_v1'
    && c.statistics.missingOutcomePolicy === 'require_complete_primary_v1', 'unsupported_statistics');
  for (const key of ['stopControl', 'rewardGuardObservability', 'adGuardObservability', 'checkoutObservability', 'returnGuardObservability', 'timeAndWalletGuardObservability'] as const)
    requireGate(isHelpEvidenceRef(e?.[key], c.definitionHash), `unverified_${key}`);
  const review = e?.baselineReview, estimate = review?.estimate;
  const estimateValid = !!estimate && helpSafeId(b?.definitionRef) && estimate.phase === 'baseline' && estimate.eligibilityEpoch === b?.eligibilityEpoch
    && estimate.eligibilityVersion === c.eligibilityVersion && estimate.definitionHash === c.definitionHash && estimate.timezone === c.timezone
    && estimate.from === b.enrollmentFrom && estimate.toExclusive === b.enrollmentToExclusive && timestamp(estimate.asOf) <= timestamp(c.frozenAt)
    && estimate.windowStatus === 'reviewed' && estimate.windowMinutes === t?.primaryWindowMinutes
    && [estimate.matureN, estimate.firstEligibleSdkUnits, estimate.successes, estimate.knownFailures, estimate.unknownOutcomes, estimate.immatureUnits].every(nonnegative)
    && estimate.matureN > 0 && estimate.unknownOutcomes === 0 && estimate.immatureUnits === 0
    && estimate.successes + estimate.knownFailures === estimate.matureN && estimate.firstEligibleSdkUnits === estimate.matureN
    && estimate.rate === estimate.successes / estimate.matureN && estimate.rate > 0 && estimate.rate < 1
    && positive(estimate.arrival?.completeObservableWeeks) && estimate.arrival.observedUnits === estimate.firstEligibleSdkUnits
    && estimate.arrival.perWeek === estimate.arrival.observedUnits / estimate.arrival.completeObservableWeeks
    && helpSafeId(estimate.provenanceRef) && ['synthetic', 'production'].includes(estimate.sourceKind);
  requireGate(estimateValid && isHelpEvidenceRef(review?.evidence, c.definitionHash) && review?.reviewRef === t?.baselineReviewRef
    && timestamp(review?.evidence.asOf) <= timestamp(c.frozenAt) && helpSafeId(review?.populationComparabilityRef), 'missing_matching_baseline_review');
  requireGate(isHelpEvidenceRef(e?.samplePlan, c.definitionHash), 'unverified_sample_plan');
  if (estimateValid && typeof t?.mdePp === 'number' && positive(t?.nPerArm)) {
    const p0 = estimate!.rate!, p1 = p0 + t.mdePp / 100, mean = (p0 + p1) / 2;
    const n = Math.ceil((1.959963984540054 * Math.sqrt(2 * mean * (1 - mean))
      + 0.8416212335729143 * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) ** 2 / (p1 - p0) ** 2);
    requireGate(p1 <= 1 && Number.isSafeInteger(n) && t.nPerArm >= n, 'insufficient_sample_plan');
  }
  requireGate(c.srm?.method === 'exact_binomial_50_50_v1' && fraction(c.srm.familyAlpha) && c.srm.familyAlpha > 0
    && c.srm.familyAlpha < 1 && c.srm.multiplicity === 'bonferroni_fixed_looks_v1' && positive(c.srm.minimumAssignedPerLook)
    && Array.isArray(c.srm.lookAt) && c.srm.lookAt.length > 0 && c.srm.lookAt.every((look, i, looks) => timestamp(look) >= timestamp(t?.enrollmentFrom)
      && timestamp(look) <= timestamp(t?.enrollmentToExclusive) && (i === 0 || timestamp(look) > timestamp(looks[i - 1]))), 'missing_srm_plan');
  requireGate(!!c.dataQuality && ['maxObservedAssignmentLoss', 'maxUnknownPrimaryFraction', 'maxUnknownVariantFraction', 'maxOriginConflictFraction']
    .every((key) => fraction(c.dataQuality[key as keyof typeof c.dataQuality])) && typeof c.dataQuality.independentDeliveryDenominatorRequired === 'boolean'
    && helpSafeId(c.dataQuality.definitionRef), 'missing_data_quality_policy');
  if (c.dataQuality?.independentDeliveryDenominatorRequired) requireGate(isHelpEvidenceRef(e?.independentDeliveryReconciliation, c.definitionHash), 'unverified_independent_delivery');
  requireGate(Array.isArray(c.guardPolicies) && c.guardPolicies.length > 0 && c.guardPolicies.some((g) => g?.id === 'reward_integrity' && g.required)
    && new Set(c.guardPolicies.map((g) => g?.id)).size === c.guardPolicies.length
    && c.guardPolicies.some((g) => g?.id === 'checkout' && g.required)
    && c.guardPolicies.every((g) => validGuardDescriptor(g) && (!g.required || validGuard(g))), 'missing_guard_policies');
  const proofKinds = Object.values(e ?? {}).filter((v): v is EvidenceRef => !!v && typeof v === 'object' && 'sourceKind' in v).map((v) => v.sourceKind);
  requireGate(new Set(proofKinds).size === 1, 'mixed_evidence_sources');
  if (review) requireGate(review.estimate?.sourceKind === review.evidence?.sourceKind
    && review.evidence?.sourceKind === e?.producerRollout?.sourceKind, 'mixed_evidence_sources');
  const map: Record<string, string> = {
    invalid_contract: 'contract_unsupported', missing_frozen_definition: 'shared_definition_incomplete', invalid_timezone: 'shared_definition_incomplete',
    missing_producer_contract: 'shared_definition_incomplete', missing_identity_history_policy: 'identity_policy_unverified',
    invalid_baseline_scope: 'baseline_scope_invalid', invalid_trial_scope: 'trial_scope_invalid', overlapping_phase_scopes: 'trial_scope_invalid',
    missing_allocation_version: 'trial_plan_incomplete', unsupported_primary_window: 'trial_plan_incomplete', missing_fixed_sample_horizon: 'trial_plan_incomplete',
    missing_effect_requirements: 'trial_plan_incomplete', unsupported_statistics: 'trial_plan_incomplete',
    missing_matching_baseline_review: 'trial_baseline_unverified', unverified_sample_plan: 'trial_evidence_incomplete',
    insufficient_sample_plan: 'trial_sample_plan_invalid', missing_srm_plan: 'trial_srm_policy_incomplete',
    missing_data_quality_policy: 'trial_data_policy_incomplete', unverified_independent_delivery: 'trial_evidence_incomplete',
    missing_guard_policies: 'trial_guard_policy_incomplete', mixed_evidence_sources: 'evidence_invalid',
    unverified_common_world: 'baseline_evidence_incomplete',
  };
  const codes = reasons.map((r) => map[r] ?? (r.startsWith('unverified_')
    ? baselineProofs.some((key) => r === `unverified_${key}`) ? 'baseline_evidence_incomplete' : 'trial_evidence_incomplete' : r));
  return { baselineReady, trialReady: commonReady && reasons.length === trialStart, reasons: [...new Set(codes)].sort() };
}
function validGuardDescriptor(value: unknown): value is GuardPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const g = value as GuardPolicy;
  return typeof g.required === 'boolean'
    && ['reward_integrity', 'ad_readiness', 'ad_failure', 'wall_deadline', 'active_time', 'exit_after_request',
      'experiment_return_d1', 'experiment_return_d7', 'wallet_distribution', 'checkout'].includes(g.id)
    && ['assigned_sdk_player', 'origin_flow', 'accepted_show_operation', 'earned_entitlement', 'completed_full_coverage_attempt'].includes(g.unit)
    && ['raw_client', 'reconciled_server', 'domain_incident_proof'].includes(g.source);
}
function validGuard(g: GuardPolicy): boolean {
  return validGuardDescriptor(g) && helpSafeId(g.definitionRef) && helpSafeId(g.numeratorRef)
    && (helpSafeId(g.denominatorRef) || g.method === 'authoritative_incident_v1')
    && helpSafeId(g.maturityRef) && helpSafeId(g.observabilityEvidenceRef)
    && ['authoritative_incident_v1', 'newcombe_wilson95_rate_diff_v1', 'external_reviewed_distribution_v1'].includes(g.method ?? '')
    && ['higher_better', 'higher_worse', 'zero_incidents'].includes(g.direction) && !!g.harmMargin
    && typeof g.harmMargin.value === 'number' && Number.isFinite(g.harmMargin.value) && g.harmMargin.value >= 0
    && ['pp', 'ms', 'coins', 'count'].includes(g.harmMargin.unit) && positive(g.minimumMaturePerArm)
    && (g.window?.origin === 'exact_calendar_day' ? [1, 7].includes(g.window.calendarDay ?? 0) && g.window.milliseconds === null
      : ['first_request', 'first_grant', 'earned'].includes(g.window?.origin) && positive(g.window.milliseconds) && g.window.calendarDay === null);
}
