import { NativeModules, Platform } from 'react-native';

export interface NativeRewardReceipt {
  version: 1;
  rewardId: string;
  kind: 'wheel' | 'coins' | 'hint';
  createdAtMs: number;
  /** Native SDK earned wall time, added by the native callback, never trusted from prepare. */
  earnedAtMs?: number;
  offerDay: string;
  amount: number;
  sector?: number;
  flowContext?: Record<string, unknown>;
}

interface JournalBridge {
  prepareReward: (adId: string, snapshotJson: string) => Promise<void>;
  listEarnedRewards: () => Promise<unknown>;
  ackReward: (rewardId: string) => Promise<void>;
  hasActiveRewardedShow: () => Promise<unknown>;
}

interface PreparedAd {
  prepareRewardSession?: (snapshotJson: string) => Promise<void>;
}

const SAFE_ID = /^[a-z0-9][a-z0-9_.:-]{0,191}$/i;
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
// Receipt v1 freezes physical sector positions, not sorted reward denominations.
// A future economy/order change needs a new receipt version and a decoder for pending v1 receipts.
const WHEEL_AMOUNTS = [10, 25, 50, 5, 100, 20, 200, 15] as const;
const SNAPSHOT_KEYS = new Set(['version', 'rewardId', 'kind', 'createdAtMs', 'earnedAtMs', 'offerDay', 'amount', 'sector', 'flowContext']);

function journalError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function bridge(): JournalBridge {
  const value = NativeModules.YandexRewardedAdModule as Partial<JournalBridge> | undefined;
  if (typeof value?.prepareReward !== 'function' || typeof value.listEarnedRewards !== 'function'
    || typeof value.ackReward !== 'function' || typeof value.hasActiveRewardedShow !== 'function') {
    throw journalError('reward_journal_unavailable');
  }
  return value as JournalBridge;
}

/** A missing native patch must block protected offers instead of silently losing crash recovery. */
export function isNativeRewardJournalAvailable(): boolean {
  if (Platform.OS === 'web') return true;
  try { bridge(); return true; } catch { return false; }
}

export function isNativeRewardReceipt(value: unknown): value is NativeRewardReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as NativeRewardReceipt;
  if (Object.keys(receipt).some((key) => !SNAPSHOT_KEYS.has(key)) || receipt.version !== 1
    || typeof receipt.rewardId !== 'string' || !SAFE_ID.test(receipt.rewardId)
    || (receipt.kind !== 'wheel' && receipt.kind !== 'coins' && receipt.kind !== 'hint')
    || !Number.isSafeInteger(receipt.createdAtMs) || receipt.createdAtMs <= 0
    || receipt.earnedAtMs !== undefined && (!Number.isSafeInteger(receipt.earnedAtMs) || receipt.earnedAtMs <= 0)
    || typeof receipt.offerDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.offerDay)
    || !Number.isSafeInteger(receipt.amount) || receipt.amount <= 0 || receipt.amount > 1_000_000) return false;
  if (receipt.kind === 'wheel') {
    if (!Number.isSafeInteger(receipt.sector) || WHEEL_AMOUNTS[receipt.sector ?? -1] !== receipt.amount) return false;
  } else if (receipt.sector !== undefined || receipt.kind === 'hint' && receipt.amount !== 1) return false;
  const context = receipt.flowContext;
  if (context !== undefined && (!context || typeof context !== 'object' || Array.isArray(context)
    || Object.keys(context).length > 24 || Object.entries(context).some(([key, item]) => !SAFE_KEY.test(key)
      || !(typeof item === 'boolean' || typeof item === 'string' && SAFE_ID.test(item)
        || typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER)))) return false;
  if (receipt.kind === 'hint' && (!context
    || typeof context.origin_interaction_id !== 'string' || typeof context.attemptId !== 'string'
    || (context.requested_hint !== 'letter' && context.requested_hint !== 'semantic'))) return false;
  try { return JSON.stringify(receipt).length <= 8192; } catch { return false; }
}

export async function prepareNativeReward(ad: PreparedAd, receipt: NativeRewardReceipt): Promise<void> {
  if (!isNativeRewardReceipt(receipt) || receipt.earnedAtMs !== undefined) throw journalError('reward_snapshot_invalid');
  if (Platform.OS === 'web') return;
  bridge();
  if (typeof ad.prepareRewardSession !== 'function') throw journalError('reward_journal_unavailable');
  await ad.prepareRewardSession(JSON.stringify(receipt));
}

/** Only actual earned callbacks are returned; prepared or dismissed ads never become rewards. */
export async function readNativeEarnedRewards(): Promise<NativeRewardReceipt[]> {
  if (Platform.OS === 'web') return [];
  const raw = await bridge().listEarnedRewards();
  if (!Array.isArray(raw)) throw journalError('reward_journal_invalid');
  const receipts: NativeRewardReceipt[] = [];
  const seen = new Map<string, string>();
  for (const item of raw) {
    if (typeof item !== 'string' || item.length > 8192) throw journalError('reward_journal_invalid');
    let receipt: unknown;
    try { receipt = JSON.parse(item); } catch { throw journalError('reward_journal_invalid'); }
    if (!isNativeRewardReceipt(receipt)) throw journalError('reward_journal_invalid');
    const serialized = JSON.stringify(receipt);
    const previous = seen.get(receipt.rewardId);
    if (previous !== undefined && previous !== serialized) throw journalError('reward_journal_conflict');
    if (previous === undefined) receipts.push(receipt);
    seen.set(receipt.rewardId, serialized);
  }
  return receipts;
}

/** Call only after the wallet's atomic balance/idempotency ledger confirms this reward ID. */
export async function acknowledgeNativeReward(rewardId: string): Promise<void> {
  if (typeof rewardId !== 'string' || !SAFE_ID.test(rewardId)) throw journalError('reward_snapshot_invalid');
  if (Platform.OS === 'web') return;
  await bridge().ackReward(rewardId);
}

/** A watchdog may release the JS request, but must not open another fullscreen over this native show. */
export async function hasActiveNativeRewardedShow(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const active = await bridge().hasActiveRewardedShow();
  if (typeof active !== 'boolean') throw journalError('reward_journal_invalid');
  return active;
}
