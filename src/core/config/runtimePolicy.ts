import analyticsManifest from '../../../assets/content/analytics-manifest.json';
import { MONETIZATION } from './monetization';
import { RETENTION } from './retention';

/** Only future eligibility is configurable. Rewards, prices and content never enter this schema. */
export const POLICY_PARAMETERS = {
  ads_interstitial_interval_seconds: { default: MONETIZATION.interstitial.minVisibleGameplaySinceInterstitialSec, min: 120, max: 1800 },
  ads_interstitial_new_levels: { default: MONETIZATION.interstitial.minNewCampaignCompletionsSinceFullscreen, min: 3, max: 10 },
  retention_quests_unlock_wins: { default: RETENTION.unlockAfterCampaignWins.quests, min: 5, max: 50 },
  retention_event_unlock_wins: { default: RETENTION.unlockAfterCampaignWins.event, min: 5, max: 100 },
} as const;
export type PolicyParameter = keyof typeof POLICY_PARAMETERS;
export type PolicyValues = Readonly<Record<PolicyParameter, number>>;
export type PolicyAssignment = Readonly<{
  experiment_id: string; assignment_id: string; variant: string; allocation_version: number;
}>;
export type RuntimePolicySnapshot = Readonly<{
  schemaVersion: 1; configVersion: string; profileScope: string; values: PolicyValues;
  assignment: PolicyAssignment | null; parameter: PolicyParameter | null;
}>;

export function policyId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,95}$/i.test(value);
}
export function isPolicyParameter(value: string): value is PolicyParameter {
  return Object.hasOwn(POLICY_PARAMETERS, value);
}
export function validPolicyValue(key: PolicyParameter, value: unknown): value is number {
  const range = POLICY_PARAMETERS[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= range.min && value <= range.max;
}
const controlValues = Object.freeze(Object.fromEntries(Object.entries(POLICY_PARAMETERS).map(([key, value]) => [key, value.default])) as Record<PolicyParameter, number>);
export const DEFAULT_POLICY: RuntimePolicySnapshot = Object.freeze({
  schemaVersion: 1, configVersion: analyticsManifest.policyVersion, profileScope: 'unbound',
  values: controlValues, assignment: null, parameter: null,
});

export function freezePolicy(snapshot: RuntimePolicySnapshot): RuntimePolicySnapshot {
  return Object.freeze({ ...snapshot, values: Object.freeze({ ...snapshot.values }),
    assignment: snapshot.assignment ? Object.freeze({ ...snapshot.assignment }) : null });
}
/** Strict reconstruction of the optional game-save field; never trust a spread from MMKV. */
export function restoreRuntimePolicy(value: unknown): RuntimePolicySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<RuntimePolicySnapshot>;
  if (record.schemaVersion !== 1 || !policyId(record.configVersion) || !policyId(record.profileScope)
      || !record.values || typeof record.values !== 'object' || Array.isArray(record.values)
      || Object.keys(record.values).length !== Object.keys(POLICY_PARAMETERS).length) return null;
  const values = {} as Record<PolicyParameter, number>;
  for (const key of Object.keys(POLICY_PARAMETERS) as PolicyParameter[]) {
    const candidate = record.values[key];
    if (!validPolicyValue(key, candidate)) return null;
    values[key] = candidate;
  }
  if (record.assignment === null && record.parameter === null) {
    return Object.keys(POLICY_PARAMETERS).every((key) => values[key as PolicyParameter] === controlValues[key as PolicyParameter])
      ? DEFAULT_POLICY : null;
  }
  const assignment = record.assignment;
  if (!assignment || typeof assignment !== 'object' || !policyId(assignment.experiment_id)
      || !policyId(assignment.assignment_id) || !policyId(assignment.variant)
      || !Number.isSafeInteger(assignment.allocation_version) || assignment.allocation_version < 1
      || assignment.allocation_version > 1_000_000 || typeof record.parameter !== 'string'
      || !isPolicyParameter(record.parameter)) return null;
  if (Object.keys(POLICY_PARAMETERS).some((key) => key !== record.parameter
      && values[key as PolicyParameter] !== controlValues[key as PolicyParameter])) return null;
  return freezePolicy({ schemaVersion: 1, configVersion: record.configVersion, profileScope: record.profileScope,
    parameter: record.parameter, values, assignment: {
      experiment_id: assignment.experiment_id, assignment_id: assignment.assignment_id,
      variant: assignment.variant, allocation_version: assignment.allocation_version,
    } });
}

let configured: RuntimePolicySnapshot = DEFAULT_POLICY;
let attempt: RuntimePolicySnapshot | null = null;
let allowed: (snapshot: RuntimePolicySnapshot) => boolean = () => false;
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };
export function subscribeRuntimePolicy(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

export function setRuntimePolicyGuard(guard: (snapshot: RuntimePolicySnapshot) => boolean): void { allowed = guard; changed(); }
function effective(snapshot: RuntimePolicySnapshot): RuntimePolicySnapshot {
  if (!snapshot.assignment) return DEFAULT_POLICY;
  try { return allowed(snapshot) ? snapshot : DEFAULT_POLICY; } catch { return DEFAULT_POLICY; }
}
export function getConfiguredPolicy(): RuntimePolicySnapshot { return effective(configured); }
export function getRuntimePolicy(): RuntimePolicySnapshot { return effective(attempt ?? configured); }
export function getAttemptPolicy(): RuntimePolicySnapshot | null { return attempt; }
export function setConfiguredPolicy(snapshot: RuntimePolicySnapshot): void { configured = restoreRuntimePolicy(snapshot) ?? DEFAULT_POLICY; changed(); }
/** undefined is a legacy/invalid attempt; null leaves the board and returns to configured policy. */
export function setAttemptPolicy(snapshot: unknown): void { attempt = snapshot === null ? null : restoreRuntimePolicy(snapshot) ?? DEFAULT_POLICY; changed(); }
export function resetRuntimePolicy(): void { configured = DEFAULT_POLICY; attempt = null; allowed = () => false; changed(); }

/** Numeric policy only: no storage, transport, assignment or analytics side effects. */
export function getRetentionUnlocks() {
  const values = getRuntimePolicy().values;
  return { ...RETENTION.unlockAfterCampaignWins,
    quests: values.retention_quests_unlock_wins, event: values.retention_event_unlock_wins };
}
