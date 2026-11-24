import { DEFAULT_POLICY, freezePolicy, isPolicyParameter, policyId, validPolicyValue,
  restoreRuntimePolicy,
  type PolicyAssignment, type PolicyParameter, type RuntimePolicySnapshot } from '@/core/config/runtimePolicy';

type ParameterValue = Partial<Record<PolicyParameter, number>>;
export type RemotePolicyDocument = { schema_version: 1; config_version: string; fetch_enabled: false }
  | { schema_version: 1; config_version: string; fetch_enabled: true; experiment_id: string;
    allocation_version: number; variants: Record<string, ParameterValue> };
type Parsed = { ok: true; document: RemotePolicyDocument } | { ok: false; reason: 'invalid_payload' };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keysIn = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));

export function parseRemotePolicy(json: string): Parsed {
  const invalid: Parsed = { ok: false, reason: 'invalid_payload' };
  if (typeof json !== 'string' || json.length > 16_384) return invalid;
  let value: unknown;
  try { value = JSON.parse(json); } catch { return invalid; }
  if (!plain(value) || value.schema_version !== 1 || !policyId(value.config_version) || typeof value.fetch_enabled !== 'boolean') return invalid;
  const baseKeys = ['schema_version', 'config_version', 'fetch_enabled'];
  if (!value.fetch_enabled) return keysIn(value, baseKeys)
    ? { ok: true, document: { schema_version: 1, config_version: value.config_version, fetch_enabled: false } } : invalid;
  if (!keysIn(value, [...baseKeys, 'experiment_id', 'allocation_version', 'variants'])
      || !policyId(value.experiment_id) || !Number.isSafeInteger(value.allocation_version)
      || (value.allocation_version as number) < 1 || (value.allocation_version as number) > 1_000_000
      || !plain(value.variants) || Object.keys(value.variants).length < 2 || Object.keys(value.variants).length > 8) return invalid;
  const variants: Record<string, ParameterValue> = {};
  let parameter: PolicyParameter | null = null;
  for (const [variant, raw] of Object.entries(value.variants)) {
    if (!policyId(variant) || !plain(raw) || Object.keys(raw).length !== 1) return invalid;
    const [key] = Object.keys(raw);
    if (!isPolicyParameter(key) || !validPolicyValue(key, raw[key]) || parameter !== null && parameter !== key) return invalid;
    parameter = key;
    variants[variant] = { [key]: raw[key] };
  }
  if (!parameter || !variants.control || variants.control[parameter] !== DEFAULT_POLICY.values[parameter]) return invalid;
  return { ok: true, document: { schema_version: 1, config_version: value.config_version, fetch_enabled: true,
    experiment_id: value.experiment_id, allocation_version: value.allocation_version as number, variants } };
}

export function selectRemotePolicy(document: RemotePolicyDocument, assignment: PolicyAssignment | null,
  profileScope: string): RuntimePolicySnapshot | null {
  if (!document.fetch_enabled) return DEFAULT_POLICY;
  if (!assignment || !policyId(profileScope) || assignment.experiment_id !== document.experiment_id
      || assignment.allocation_version !== document.allocation_version || !Object.hasOwn(document.variants, assignment.variant)) return null;
  const patch = document.variants[assignment.variant];
  const parameter = Object.keys(patch)[0] as PolicyParameter;
  return restoreRuntimePolicy(freezePolicy({ schemaVersion: 1, configVersion: document.config_version, profileScope,
    assignment, parameter, values: { ...DEFAULT_POLICY.values, ...patch } }));
}
