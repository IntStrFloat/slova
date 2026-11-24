import { MONETIZATION } from '@/core/config/monetization';
import { RETENTION } from '@/core/config/retention';
import { DEFAULT_POLICY, getRuntimePolicy, resetRuntimePolicy, setConfiguredPolicy, setAttemptPolicy, setRuntimePolicyGuard, validPolicyValue } from '@/core/config/runtimePolicy';
import { parseRemotePolicy, selectRemotePolicy } from '../policy';
import { validateEventProperties } from '@/features/analytics/schema';

const assignment = { experiment_id: 'ad_delay', assignment_id: 'exp_test', variant: 'candidate', allocation_version: 1 };
const document = () => ({ schema_version: 1, config_version: 'local_test_v1', fetch_enabled: true,
  experiment_id: assignment.experiment_id, allocation_version: 1,
  variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { ads_interstitial_interval_seconds: 600 } } });

beforeEach(() => { resetRuntimePolicy(); setRuntimePolicyGuard(() => true); });

test('local control reproduces current policies and contains no economy/entitlement field', () => {
  expect(DEFAULT_POLICY.values.ads_interstitial_interval_seconds).toBe(MONETIZATION.interstitial.minVisibleGameplaySinceInterstitialSec);
  expect(DEFAULT_POLICY.values.ads_interstitial_new_levels).toBe(MONETIZATION.interstitial.minNewCampaignCompletionsSinceFullscreen);
  expect(DEFAULT_POLICY.values.retention_quests_unlock_wins).toBe(RETENTION.unlockAfterCampaignWins.quests);
  expect(DEFAULT_POLICY.values.retention_event_unlock_wins).toBe(RETENTION.unlockAfterCampaignWins.event);
  expect(Object.keys(DEFAULT_POLICY.values)).toHaveLength(4);
});

test.each([
  { schema_version: 2 }, { unknown: 7 }, { config_version: 'private@example.com' },
  { variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { entitlement: true } } },
  { variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { ads_interstitial_interval_seconds: 119 } } },
  { variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { ads_interstitial_interval_seconds: Infinity } } },
  { variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { ads_interstitial_interval_seconds: 600, retention_quests_unlock_wins: 12 } } },
  { variants: { control: { ads_interstitial_interval_seconds: 301 }, candidate: { ads_interstitial_interval_seconds: 600 } } },
])('invalid schema, range, uncontrolled keys and multi-factor documents are rejected: %j', (patch) => {
  expect(parseRemotePolicy(JSON.stringify({ ...document(), ...patch })).ok).toBe(false);
});

test('missing assignment, wrong version/variant and disabled fetch cannot assign a player', () => {
  const parsed = parseRemotePolicy(JSON.stringify(document()));
  if (!parsed.ok) throw Error('fixture');
  expect(selectRemotePolicy(parsed.document, null, 'profile_a')).toBeNull();
  expect(selectRemotePolicy(parsed.document, { ...assignment, allocation_version: 2 }, 'profile_a')).toBeNull();
  expect(selectRemotePolicy(parsed.document, { ...assignment, variant: 'unknown' }, 'profile_a')).toBeNull();
  expect(selectRemotePolicy({ ...parsed.document, fetch_enabled: false }, assignment, 'profile_a')?.values).toEqual(DEFAULT_POLICY.values);
});

test('snapshot is immutable, pinned attempt survives a newly applied policy, legacy attempt uses control', () => {
  const parsed = parseRemotePolicy(JSON.stringify(document()));
  if (!parsed.ok) throw Error('fixture');
  const first = selectRemotePolicy(parsed.document, assignment, 'profile_a')!;
  setConfiguredPolicy(first);
  setAttemptPolicy(first);
  setConfiguredPolicy(DEFAULT_POLICY);
  expect(getRuntimePolicy()).toEqual(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.values)).toBe(true);
  setAttemptPolicy(undefined);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  setAttemptPolicy(null);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
});

test('oversized payload and prototype-shaped fields fail closed', () => {
  expect(parseRemotePolicy(' '.repeat(16_385)).ok).toBe(false);
  expect(parseRemotePolicy('{"schema_version":1,"__proto__":{"entitlement":true}}').ok).toBe(false);
});

test('config diagnostics use a distinct document schema field and never admit full JSON or exception payloads', () => {
  const properties = { result: 'success', reason: 'fetched', config_schema_version: 1, config_version: 'fixture_v1', fallback_used: false, age_bucket: 'under_day' };
  expect(validateEventProperties('config_fetch_result', properties)).toEqual({ valid: true, properties, rejected: 0, missing: [] });
  const invalid = validateEventProperties('config_apply_result', { ...properties, json: '{private}', error: 'private@example.com' });
  expect(invalid.properties).toEqual(properties); expect(invalid.rejected).toBe(2);
});

test('finite integer allowlist boundaries are inclusive; fractions and each out-of-range neighbour fail', () => {
  for (const [key, lower, upper] of [
    ['ads_interstitial_interval_seconds', 120, 1800], ['ads_interstitial_new_levels', 3, 10],
    ['retention_quests_unlock_wins', 5, 50], ['retention_event_unlock_wins', 5, 100],
  ] as const) {
    expect(validPolicyValue(key, lower)).toBe(true); expect(validPolicyValue(key, upper)).toBe(true);
    for (const invalid of [lower - 1, upper + 1, lower + 0.5, NaN, Infinity, '10']) expect(validPolicyValue(key, invalid)).toBe(false);
  }
});
