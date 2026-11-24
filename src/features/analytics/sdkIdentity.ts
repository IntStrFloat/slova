import * as native from '@/core/native/appmetrica';

export type SdkIdentitySnapshot = { status: 'pending' | 'unavailable' | 'blocked'; generation: number }
  | { status: 'ready'; generation: number; deviceId: string; installationId: string };
let generation = 0;
let snapshot: SdkIdentitySnapshot = { status: 'unavailable', generation };
let allowed: () => boolean = () => false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
export function validSdkPlayerId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)
    && (value.length < 20 || value <= '18446744073709551615');
}
function publish(next: SdkIdentitySnapshot) {
  snapshot = next;
  for (const listener of listeners) { try { listener(); } catch { /* An observer cannot restore or block a privacy boundary. */ } }
}
/** The analytics owner supplies its existing consent/native production gate, without a circular import. */
export function setSdkIdentityGate(gate: () => boolean): void { allowed = gate; }
export function getSdkIdentitySnapshot(): SdkIdentitySnapshot { return snapshot; }
export function subscribeSdkIdentity(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function invalidateSdkIdentity(): void {
  generation += 1; pending = null; publish({ status: 'blocked', generation });
}
export function primeSdkIdentity(): Promise<void> {
  if (!allowed()) { invalidateSdkIdentity(); return Promise.resolve(); }
  if (snapshot.status === 'ready') return Promise.resolve();
  if (pending) return pending;
  const requestedGeneration = generation;
  publish({ status: 'pending', generation });
  let response: Promise<{ deviceId?: string; installationId?: string }>;
  try { response = typeof native.getAppMetricaIdentifiers === 'function' ? native.getAppMetricaIdentifiers() : Promise.resolve({}); }
  catch { response = Promise.resolve({}); }
  const request = response.then((value) => {
    if (generation !== requestedGeneration || !allowed()) return;
    const deviceId = value.deviceId, installationId = value.installationId;
    publish(validSdkPlayerId(deviceId)
      && typeof installationId === 'string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(installationId)
      ? { status: 'ready', generation, deviceId, installationId } : { status: 'unavailable', generation });
  }).catch(() => {
    if (generation === requestedGeneration) publish({ status: 'unavailable', generation });
  }).finally(() => { if (generation === requestedGeneration && pending === request) pending = null; });
  pending = request;
  return request;
}
