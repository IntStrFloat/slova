import { getJSON, removeKey, setJSON } from '@/core/storage';
import { getAppMetricaIdentifiers } from '@/core/native/appmetrica';
import { ANALYTICS_EXPERIMENTS, type AnalyticsExperiment } from '@/core/config/analyticsExperiments';
import { analyticsKeyToken } from './dedupe';
import { isAnalyticsCollectionEnabled, setAnalyticsContext, trackOnce, useAnalyticsPrefs } from './index';
import { policyId, type PolicyAssignment, type PolicyParameter, type RuntimePolicySnapshot } from '@/core/config/runtimePolicy';

const KEY = 'analytics.experiments.v1';
type Assignment = { experiment_id: string; assignment_id: string; variant: string; allocation_version: number; startsAt: number; endsAt: number; screens: readonly string[] };
function read(): Assignment[] {
  const value = getJSON<Assignment[]>(KEY, []);
  return Array.isArray(value) ? value.filter((v) => !!v && typeof v === 'object'
    && policyId(v.experiment_id) && policyId(v.assignment_id) && policyId(v.variant)
    && Number.isSafeInteger(v.allocation_version) && v.allocation_version > 0
    && Number.isFinite(v.startsAt) && Number.isFinite(v.endsAt) && v.endsAt > v.startsAt
    && Array.isArray(v.screens) && v.screens.every(policyId)) : [];
}

export function chooseExperimentVariant(spec: AnalyticsExperiment, installationId: string): string | null {
  if (!/^[a-z][a-z0-9_-]{0,47}$/.test(spec.id) || !installationId || !Number.isInteger(spec.allocationVersion)) return null;
  if (spec.variants.length < 2 || spec.variants.some((v) => !/^[a-z][a-z0-9_-]{0,47}$/.test(v.id) || !Number.isSafeInteger(v.weight) || v.weight <= 0)
    || new Set(spec.variants.map((v) => v.id)).size !== spec.variants.length) return null;
  const total = spec.variants.reduce((sum, v) => sum + v.weight, 0);
  if (!Number.isSafeInteger(total)) return null;
  const hash = analyticsKeyToken(`${spec.id}:${spec.allocationVersion}:${installationId}`);
  const bucket = parseInt(hash.slice(0, 8), 16) / 0x1_0000_0000 * total;
  let edge = 0;
  for (const variant of spec.variants) { edge += variant.weight; if (bucket < edge) return variant.id; }
  return null;
}

export async function initializeAnalyticsExperiments(specs = ANALYTICS_EXPERIMENTS): Promise<void> {
  if (useAnalyticsPrefs.getState().optOut) { removeKey(KEY); return; }
  if (!specs.length || !isAnalyticsCollectionEnabled()) return;
  const { installationId } = await getAppMetricaIdentifiers();
  if (!installationId || !isAnalyticsCollectionEnabled()) return;
  const now = Date.now();
  const assignments = read();
  for (const spec of specs) {
    // This experiment enrolls only at a proven first deficit query, never at startup.
    if (spec.id === 'slova_wheel_help_clarity_20261104') continue;
    const startsAt = Date.parse(spec.startsAt), endsAt = Date.parse(spec.endsAt);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || now < startsAt || now >= endsAt) continue;
    const variant = chooseExperimentVariant(spec, installationId);
    if (!variant) continue;
    const assignmentId = 'exp_' + analyticsKeyToken(`${spec.id}:${spec.allocationVersion}:${installationId}`);
    let assigned = assignments.find((a) => a.assignment_id === assignmentId);
    if (!assigned) {
      assigned = { experiment_id: spec.id, assignment_id: assignmentId, variant,
        allocation_version: spec.allocationVersion, startsAt, endsAt, screens: spec.exposureScreens };
      assignments.push(assigned);
      setJSON(KEY, assignments);
      // Durable readback: a missing persisted assignment must never expose a different variant.
      if (!read().some((a) => a.assignment_id === assignmentId)) continue;
    }
    trackOnce('experiment_assigned', assignmentId, { experiment_id: assigned.experiment_id,
      assignment_id: assigned.assignment_id, variant: assigned.variant,
      allocation_version: assigned.allocation_version, unit_type: 'sdk_install' });
  }
  const active = read().filter((a) => now >= a.startsAt && now < a.endsAt);
  setAnalyticsContext({ experimentVariants: Object.fromEntries(active.map((a) => [a.experiment_id, a.variant])) });
}

export function exposeAnalyticsExperiments(screen: string): void {
  if (!isAnalyticsCollectionEnabled()) return;
  for (const a of read()) {
    if (a.experiment_id === 'slova_wheel_help_clarity_20261104') continue;
    if (Date.now() < a.startsAt || Date.now() >= a.endsAt || !a.screens.includes(screen)) continue;
    trackOnce('experiment_exposed', `${a.assignment_id}:${screen}`, { experiment_id: a.experiment_id,
      assignment_id: a.assignment_id, variant: a.variant, exposure_point: screen, exposure_version: a.allocation_version });
  }
}

export function clearAnalyticsExperiments(): void { removeKey(KEY); }

/** Remote delivery consumes this existing assignment; it never allocates a second cohort. */
export function getAnalyticsExperimentAssignment(id: string, allocationVersion: number,
  specs = ANALYTICS_EXPERIMENTS): PolicyAssignment | null {
  if (!isAnalyticsCollectionEnabled() || useAnalyticsPrefs.getState().optOut) return null;
  const now = Date.now();
  const spec = specs.find((item) => item.id === id && item.allocationVersion === allocationVersion
    && now >= Date.parse(item.startsAt) && now < Date.parse(item.endsAt));
  if (!spec) return null;
  const saved = read().find((item) => item.experiment_id === id && item.allocation_version === allocationVersion
    && policyId(item.assignment_id) && policyId(item.variant)
    && now >= item.startsAt && now < item.endsAt && spec.variants.some((variant) => variant.id === item.variant));
  return saved ? { experiment_id: saved.experiment_id, assignment_id: saved.assignment_id,
    variant: saved.variant, allocation_version: saved.allocation_version } : null;
}

/** Historical ownership may validate a paused attempt; it cannot start or expose a new experiment. */
export function hasStoredAnalyticsAssignment(assignment: PolicyAssignment): boolean {
  if (!isAnalyticsCollectionEnabled() || useAnalyticsPrefs.getState().optOut) return false;
  return read().some((saved) => saved.experiment_id === assignment.experiment_id
    && saved.assignment_id === assignment.assignment_id && policyId(saved.assignment_id) && policyId(saved.variant)
    && saved.variant === assignment.variant && saved.allocation_version === assignment.allocation_version
    && Number.isFinite(saved.startsAt) && saved.endsAt > saved.startsAt);
}

export function exposeAnalyticsParameter(snapshot: RuntimePolicySnapshot, parameter: PolicyParameter, point: string, historicalPin = false): boolean {
  const assignment = snapshot.assignment;
  if (!assignment || snapshot.parameter !== parameter) return false;
  const current = getAnalyticsExperimentAssignment(assignment.experiment_id, assignment.allocation_version);
  const active = current?.assignment_id === assignment.assignment_id && current.variant === assignment.variant;
  if (!active && (!historicalPin || !hasStoredAnalyticsAssignment(assignment))) return false;
  return !!trackOnce('experiment_exposed', `${assignment.assignment_id}:parameter:${parameter}`, {
    experiment_id: assignment.experiment_id, assignment_id: assignment.assignment_id, variant: assignment.variant,
    exposure_point: `${point}:${parameter}`, exposure_version: assignment.allocation_version,
    config_version: snapshot.configVersion,
    exposure_window: active ? 'active' : 'inactive',
  });
}
