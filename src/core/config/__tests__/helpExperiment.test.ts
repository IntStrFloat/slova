import { HELP_EXPERIMENT_CONFIG, helpExperimentPlanFingerprint, validateHelpExperimentReadiness } from '../helpExperiment';
import { helpExperimentFixture } from '@/features/hints/__tests__/help-experiment-fixture';
const corpus = require('../../../../scripts/fixtures/help-experiment-readiness.v1.json') as {
  cases: { id: string; config: unknown; evidence: unknown; expected: { baselineReady: boolean; trialReady: boolean;
    reasonsInclude: string[]; reasonsExclude: string[]; trialPlanFingerprint: string } }[];
};
test.each(corpus.cases)('shared readiness golden: $id', ({ config, evidence, expected }) => {
  const result = validateHelpExperimentReadiness(config, evidence);
  expect(result.baselineReady).toBe(expected.baselineReady); expect(result.trialReady).toBe(expected.trialReady);
  for (const reason of expected.reasonsInclude ?? []) expect(result.reasons).toContain(reason);
  for (const reason of expected.reasonsExclude ?? []) expect(result.reasons).not.toContain(reason);
  expect(result.reasons).toEqual([...new Set(result.reasons)].sort());
  expect(helpExperimentPlanFingerprint(config)).toBe(expected.trialPlanFingerprint);
});
test('the pure full-plan token is key-order stable and changes with frozen sample, MDE and harm requirements', () => {
  const { config } = helpExperimentFixture();
  const original = helpExperimentPlanFingerprint(config);
  expect(original).toMatch(/^[a-f0-9]{32}$/);
  expect(helpExperimentPlanFingerprint(Object.fromEntries(Object.entries(config).reverse()))).toBe(original);
  for (const change of ['sample', 'mde', 'harm']) {
    const changed = JSON.parse(JSON.stringify(config)) as typeof config;
    if (change === 'sample') changed.trial.nPerArm! += 1;
    if (change === 'mde') changed.trial.mdePp! += 1;
    if (change === 'harm') changed.guardPolicies![0].harmMargin!.value += 1;
    expect(changed.definitionHash).toBe(config.definitionHash);
    expect(helpExperimentPlanFingerprint(changed)).not.toBe(original);
  }
});
test('shipped defaults and enable-only cannot activate either phase', () => {
  expect(validateHelpExperimentReadiness(HELP_EXPERIMENT_CONFIG, null)).toMatchObject({ baselineReady: false, trialReady: false });
  expect(validateHelpExperimentReadiness({ ...HELP_EXPERIMENT_CONFIG, trial: { ...HELP_EXPERIMENT_CONFIG.trial, enabled: true } }, null))
    .toMatchObject({ baselineReady: false, trialReady: false });
});
test.each([null, [], {}, { baseline: null }, { guardPolicies: [null] }])('invalid shape stays closed: %j', (config) => {
  expect(validateHelpExperimentReadiness(config, null)).toMatchObject({ baselineReady: false, trialReady: false });
});

test.each(['id', 'source', 'unit', 'required', 'historical_from', 'historical_definition', 'unaccounted_baseline'] as const)('R1 unsupported %s contract cannot become runtime trial-ready', (field) => {
  const { config, evidence } = helpExperimentFixture();
  const guard = config.guardPolicies![0] as unknown as Record<string, unknown>;
  if (field === 'id') config.guardPolicies!.push({ ...config.guardPolicies![0], id: 'unknown_guard' } as never);
  if (field === 'source') guard.source = 'sdk_handoff';
  if (field === 'unit') guard.unit = 'impression';
  if (field === 'required') guard.required = 'false';
  if (field === 'historical_from') {
    config.baseline.enrollmentFrom = 'invalid'; evidence.baselineReview!.estimate.from = 'invalid';
  }
  if (field === 'historical_definition') config.baseline.definitionRef = null;
  if (field === 'unaccounted_baseline') {
    const estimate = evidence.baselineReview!.estimate;
    estimate.firstEligibleSdkUnits += 1; estimate.arrival.observedUnits += 1;
    estimate.arrival.perWeek = estimate.arrival.observedUnits / estimate.arrival.completeObservableWeeks;
  }
  expect(validateHelpExperimentReadiness(config, evidence).trialReady).toBe(false);
});
test('R1 a valid historical baseline remains allowed when the current plan freezes after its review', () => {
  const { config, evidence } = helpExperimentFixture();
  const result = validateHelpExperimentReadiness(config, evidence);
  expect(result).toMatchObject({ baselineReady: false, trialReady: true });
});
