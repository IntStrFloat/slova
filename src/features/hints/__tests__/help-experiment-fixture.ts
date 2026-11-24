import defaults from '@/core/config/helpExperiment.defaults.json';
import type { EvidenceRef, GuardPolicy, HelpExperimentEvidenceV1, HelpExperimentMeasurementConfigV1 } from '@/core/config/helpExperiment';

/** Fully declared development world. These values are never imported by production config. */
export function helpExperimentFixture() {
  const config = JSON.parse(JSON.stringify(defaults)) as HelpExperimentMeasurementConfigV1;
  Object.assign(config, { approvedProtocolRef: 'fixture_protocol', frozenAt: '2026-11-02T01:00:00Z', definitionHash: 'a'.repeat(64),
    timezone: 'UTC+03:00', acceptedOriginVersions: ['0.1.29'], producerContractRef: 'fixture_producer',
    identityPolicy: 'known_pre_epoch_continuity_only_v1', historyPolicyRef: 'fixture_history' });
  Object.assign(config.baseline, { enabled: true, eligibilityEpoch: 'baseline_fixture_v1', enrollmentFrom: '2026-10-21T00:00:00Z',
    enrollmentToExclusive: '2026-10-28T00:00:00Z', analysisWindowMinutes: 10, windowStatus: 'reviewed', definitionRef: 'fixture_baseline' });
  Object.assign(config.trial, { enabled: true, eligibilityEpoch: 'trial_fixture_v1', enrollmentFrom: '2026-11-03T00:00:00Z',
    enrollmentToExclusive: '2026-11-17T00:00:00Z', allocationVersion: 1, primaryWindowMinutes: 10,
    baselineReviewRef: 'fixture_review', minimumUsefulEffectPp: 5, mdePp: 20, nPerArm: 1000, maximumDurationDays: 14,
    relevantCycleDays: 7, deliveryLagMs: 0, samplePlanRef: 'fixture_sample' });
  Object.assign(config.statistics, { primaryIntervalMethod: 'newcombe_wilson95_v1', sampleMethod: 'normal_two_proportion_05_80_v1', missingOutcomePolicy: 'require_complete_primary_v1' });
  Object.assign(config.srm, { method: 'exact_binomial_50_50_v1', familyAlpha: 0.01, lookAt: ['2026-11-10T00:00:00Z', '2026-11-17T00:00:00Z'],
    multiplicity: 'bonferroni_fixed_looks_v1', minimumAssignedPerLook: 20 });
  Object.assign(config.dataQuality, { maxObservedAssignmentLoss: 0, maxUnknownPrimaryFraction: 0, maxUnknownVariantFraction: 0,
    maxOriginConflictFraction: 0, independentDeliveryDenominatorRequired: false, definitionRef: 'fixture_data' });
  config.guardPolicies = ['reward_integrity', 'checkout'].map((id) => ({ id, required: true, definitionRef: `fixture_${id}`,
    numeratorRef: 'fixture_incidents', denominatorRef: null, unit: 'assigned_sdk_player', source: 'domain_incident_proof',
    window: { origin: 'first_request', milliseconds: 600_000, calendarDay: null }, maturityRef: 'fixture_maturity',
    method: 'authoritative_incident_v1', direction: 'zero_incidents', harmMargin: { value: 0, unit: 'count' },
    minimumMaturePerArm: 1, observabilityEvidenceRef: 'fixture_observer' })) as GuardPolicy[];
  const proof = (): EvidenceRef => ({ state: 'verified', sourceKind: 'production', ref: 'fixture_proof', methodVersion: 'fixture_v1',
    scopeHash: 'b'.repeat(64), producerDefinitionHash: config.definitionHash!, observedFrom: '2026-10-01T00:00:00Z',
    observedToExclusive: '2026-11-02T00:00:00Z', asOf: '2026-11-02T00:00:00Z' });
  const evidence = Object.fromEntries(['producerRollout', 'rawIngestion', 'originAndDedupeProof', 'identityHistoryContinuity',
    'commonTechnicalSafety', 'stopControl', 'rewardGuardObservability', 'adGuardObservability', 'checkoutObservability',
    'returnGuardObservability', 'timeAndWalletGuardObservability'].map((key) => [key, proof()])) as unknown as HelpExperimentEvidenceV1;
  evidence.samplePlan = proof(); evidence.independentDeliveryReconciliation = null;
  evidence.baselineReview = { evidence: proof(), reviewRef: 'fixture_review', populationComparabilityRef: 'fixture_population', estimate: {
    phase: 'baseline', eligibilityEpoch: config.baseline.eligibilityEpoch!, eligibilityVersion: 'help_deficit_v1', definitionHash: config.definitionHash!,
    timezone: config.timezone!, from: config.baseline.enrollmentFrom!, toExclusive: config.baseline.enrollmentToExclusive!, asOf: '2026-11-02T00:00:00Z',
    windowMinutes: 10, windowStatus: 'reviewed', firstEligibleSdkUnits: 100, matureN: 100, successes: 50, knownFailures: 50,
    unknownOutcomes: 0, immatureUnits: 0, rate: 0.5, wilson95: { lower: 0.4038, upper: 0.5962 }, identificationBounds: { lower: 0.5, upper: 0.5 },
    arrival: { observedUnits: 100, completeObservableWeeks: 1, perWeek: 100 }, sourceKind: 'production', provenanceRef: 'fixture_raw' } };
  return { config, evidence };
}
