import { getJSON, getString, removeKey, setJSON } from '@/core/storage';
import { revalidatePushTarget, type ParsedPush, type PushContentContext } from './payload';
import { safeNotificationRoute } from './routing';

const KEY = 'notifications.routes.v2';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
type Tap = { message: ParsedPush; owner: string; queuedAtMs: number };
type State = { version: 2; pending: Tap | null; consumed: { id: string; owner: string; atMs: number; visible?: boolean; channel?: 'local' | 'remote' }[] };
let dispatched: string | null = null;
const listeners = new Set<() => void>();
const ID = /^push_[a-f0-9]{1,8}_[a-f0-9]{1,8}$/;
function read(now: number): State {
  const saved = getJSON<Partial<State>>(KEY, {});
  const consumed = Array.isArray(saved.consumed) ? saved.consumed.filter((v) => typeof v?.id === 'string' && ID.test(v.id)
    && typeof v.owner === 'string' && v.owner.length <= 96 && Number.isFinite(v.atMs) && now - v.atMs < TTL_MS).slice(-128) : [];
  const pending = saved.pending && typeof saved.pending.owner === 'string' && saved.pending.owner.length <= 96
    && typeof saved.pending.message?.id === 'string' && ID.test(saved.pending.message.id)
    && Number.isFinite(saved.pending.queuedAtMs) && now - saved.pending.queuedAtMs < TTL_MS
    ? { ...saved.pending, message: { ...saved.pending.message, route: safeNotificationRoute(saved.pending.message.route) } } : null;
  return { version: 2, consumed, pending };
}
function write(state: State): boolean { setJSON(KEY, state); return getString(KEY) === JSON.stringify(state); }
export function clearNotificationTaps(): void { dispatched = null; removeKey(KEY); }
export function subscribeNotificationTaps(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function startNotificationNavigationRuntime(): void { dispatched = null; }
export function hasPendingNotificationTap(): boolean { return read(Date.now()).pending !== null; }
export function storeNotificationTap(message: ParsedPush, owner: string, nowMs = Date.now()): 'queued' | 'already_durable' | 'storage_failed' {
  const state = read(nowMs);
  if (state.pending?.message.id === message.id && state.pending.owner === owner
    || state.consumed.some((v) => v.id === message.id && v.owner === owner)) return 'already_durable';
  if (state.pending) state.consumed.push({ id: state.pending.message.id, owner: state.pending.owner, atMs: nowMs });
  state.consumed = state.consumed.slice(-128);
  state.pending = { message, owner, queuedAtMs: nowMs };
  const saved = write(state);
  if (saved) { dispatched = null; listeners.forEach((listener) => listener()); }
  return saved ? 'queued' : 'storage_failed';
}
export function acceptNotificationTap(message: ParsedPush, owner: string, nowMs = Date.now()): boolean {
  return storeNotificationTap(message, owner, nowMs) === 'queued';
}
export function dispatchNotificationTap(context: { owner: string; ready: boolean; active: boolean; safe: boolean; nowMs?: number; content?: PushContentContext;
  onDispatch?: (message: ParsedPush) => void },
  navigate: (route: string) => void): boolean {
  const now = context.nowMs ?? Date.now(), state = read(now), pending = state.pending;
  if (!pending) return false;
  if (pending.owner !== context.owner) { state.pending = null; dispatched = null; write(state); return false; }
  if (!context.ready || !context.active || !context.safe || dispatched === pending.message.id) return false;
  if (context.content) pending.message = revalidatePushTarget(pending.message, context.content);
  if (!write(state)) return false;
  dispatched = pending.message.id;
  try {
    try { context.onDispatch?.(pending.message); } catch { /* Analytics cannot consume or prevent functional navigation. */ }
    navigate(safeNotificationRoute(pending.message.route));
    return true;
  } catch { dispatched = null; return false; }
}
/** Consumption follows visible content, so a cold start before navigation never loses the queued intent. */
export function confirmNotificationTap(pathname: string, owner: string, nowMs = Date.now()): boolean {
  const state = read(nowMs), pending = state.pending;
  if (!pending || pending.owner !== owner || pending.message.route !== pathname) return false;
  state.consumed.push({ id: pending.message.id, owner, atMs: nowMs, visible: pending.message.reason === 'accepted',
    channel: pending.message.channel ?? 'remote' }); state.consumed = state.consumed.slice(-128);
  state.pending = null;
  if (!write(state)) return false;
  dispatched = null;
  return true;
}
export function wasNotificationTapVisible(id: string, owner: string, channel: 'local' | 'remote', nowMs = Date.now()): boolean {
  return read(nowMs).consumed.some((entry) => entry.id === id && entry.owner === owner && entry.channel === channel
    && entry.visible === true && entry.atMs <= nowMs);
}
