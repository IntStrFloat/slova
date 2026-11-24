import { create } from 'zustand';

import { cellKey } from '@/core/engine/types';
import { storage } from '@/core/storage';
import { dayKey } from '@/core/time';
import { selectHelpContext, type HelpAnalyticsContext } from '@/features/analytics/helpContext';
import { puzzleIdentity } from '@/features/analytics/puzzleLifecycle';
import { useGame } from '@/features/game/store';
import type { AppliedHintPayment } from '@/features/game/hintJournal';
import type { NativeRewardReceipt } from '@/features/monetization/nativeRewardJournal';

import { getHelpFlow, isHelpFlow, type HelpFlow } from './help-flow';
import { unlockRewardedSemanticClue } from './index';

const LEDGER_KEY = 'game.rewarded-hint-entitlements.v1';
interface HintEntitlement {
  version: 1;
  receipt: NativeRewardReceipt;
  flow: HelpFlow;
  target: string;
  state: 'prepared' | 'earned' | 'applied';
  appliedAtMs?: number;
}
type Ledger = Record<string, HintEntitlement>;

/** Revision only: the durable entitlement ledger is the authority after restart. */
export const useRewardedHints = create<{ revision: number }>(() => ({ revision: 0 }));

function readLedger(): Ledger {
  const raw = storage.getString(LEDGER_KEY);
  if (raw == null) return {};
  const ledger: unknown = JSON.parse(raw);
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) throw new Error('Invalid rewarded hint ledger');
  for (const [id, value] of Object.entries(ledger)) {
    const item = value as HintEntitlement;
    if (!item || item.version !== 1 || !isHelpFlow(item.flow)
      || !item.receipt || item.receipt.rewardId !== id || item.receipt.kind !== 'hint'
      || item.receipt.amount !== 1 || item.receipt.flowContext?.origin_interaction_id !== item.flow.id
      || item.receipt.flowContext?.attemptId !== item.flow.attemptId
      || typeof item.target !== 'string' || !item.target
      || !['prepared', 'earned', 'applied'].includes(item.state)) throw new Error('Invalid rewarded hint entry');
  }
  return ledger as Ledger;
}

function saveLedger(ledger: Ledger): void {
  const raw = JSON.stringify(ledger);
  storage.set(LEDGER_KEY, raw);
  if (storage.getString(LEDGER_KEY) !== raw) throw new Error('Rewarded hint write unconfirmed');
  useRewardedHints.setState((state) => ({ revision: state.revision + 1 }));
}

function matchesCurrent(flow: HelpFlow): boolean {
  const { snapshot, play } = useGame.getState();
  return Boolean(snapshot && play && snapshot.attemptId === flow.attemptId
    && snapshot.globalLevel === flow.levelId && snapshot.contentVersion === flow.contentVersion
    && (!flow.contentFingerprint || puzzleIdentity(play.level, snapshot).content_fingerprint === flow.contentFingerprint)
    && snapshot.mode === (flow.mode === 'daily' ? 'daily' : 'normal')
    && (flow.mode !== 'daily' || snapshot.dailyId === flow.dateKey));
}

/** Freeze one exact help request before the ad. Retrying the offer reuses its ID. */
export function prepareRewardedHint(flow: HelpFlow, rewardId: string,
  context?: HelpAnalyticsContext): NativeRewardReceipt | null {
  if (!isHelpFlow(flow) || !matchesCurrent(flow) || flow.status === 'applied' || flow.status === 'closed') return null;
  const { snapshot, play } = useGame.getState();
  if (!snapshot || !play || snapshot.completion.status !== 'playing') return null;
  const ledger = readLedger();
  const previous = Object.values(ledger).find((item) => item.flow.id === flow.id);
  if (previous) return previous.state === 'prepared' ? previous.receipt : null;
  if (!/^[a-z0-9][a-z0-9_.:-]{0,191}$/i.test(rewardId) || ledger[rewardId]) return null;
  const target = flow.requestedHint === 'letter'
    ? play.level.grid.cells.find((cell) => play.filled[cellKey(cell)] !== cell.ch)
    : play.level.answers.find((answer) => !play.solvedWords.includes(answer.word));
  if (!target) return null;
  const receipt: NativeRewardReceipt = {
    version: 1, rewardId, kind: 'hint', amount: 1, createdAtMs: Date.now(), offerDay: dayKey(),
    flowContext: { ...selectHelpContext(context), origin_interaction_id: flow.id,
      attemptId: flow.attemptId, requested_hint: flow.requestedHint },
  };
  saveLedger({ ...ledger, [rewardId]: { version: 1, receipt, flow: { ...flow },
    target: 'word' in target ? target.word : cellKey(target), state: 'prepared' } });
  return receipt;
}

/** Called only from the SDK earned callback or the native earned journal, never dismissal. */
export function persistRewardedHint(receipt: NativeRewardReceipt): boolean {
  if (receipt.kind !== 'hint' || receipt.amount !== 1) return false;
  const ledger = readLedger();
  const item = ledger[receipt.rewardId];
  if (!item || item.receipt.createdAtMs !== receipt.createdAtMs || item.receipt.offerDay !== receipt.offerDay
    || item.flow.id !== receipt.flowContext?.origin_interaction_id
    || item.flow.attemptId !== receipt.flowContext?.attemptId
    || item.flow.requestedHint !== receipt.flowContext?.requested_hint) return false;
  if (item.state === 'prepared') saveLedger({ ...ledger, [receipt.rewardId]: { ...item, state: 'earned' } });
  return true;
}

export function hasEarnedRewardedHint(flowId: string | null | undefined): boolean {
  if (!flowId) return false;
  try { return Object.values(readLedger()).some((item) => item.flow.id === flowId && item.state !== 'prepared'); }
  catch { return false; }
}

export function getEarnedRewardedHintFlow(attemptId: string | undefined): HelpFlow | null {
  if (!attemptId) return null;
  try {
    const item = Object.values(readLedger()).find((item) => {
      if (item.flow.attemptId !== attemptId || item.state === 'prepared') return false;
      const current = getHelpFlow(item.flow.id);
      return item.state === 'earned' || Boolean(current && current.status !== 'applied' && current.status !== 'closed');
    });
    return item ? getHelpFlow(item.flow.id) ?? item.flow : null;
  } catch { return null; }
}

export function rewardedHintCountForDay(day = dayKey()): number {
  try { return Object.values(readLedger()).filter((item) => item.state !== 'prepared' && item.receipt.offerDay === day).length; }
  // Unreadable ownership must not invite another ad. Do not erase the evidence.
  catch { return 3; }
}

export type RewardedHintOutcome = 'applied' | 'pending' | 'unavailable';

/** Free effect on its frozen origin only. A different active puzzle retains the entitlement. */
export function applyRewardedHint(flowId: string,
  onApplied?: (payment: AppliedHintPayment) => void): RewardedHintOutcome {
  const ledger = readLedger();
  const item = Object.values(ledger).find((entry) => entry.flow.id === flowId && entry.state !== 'prepared');
  if (!item) return 'unavailable';
  if (item.state === 'applied') return 'applied';
  if (!matchesCurrent(item.flow)) return 'pending';
  const { play, snapshot } = useGame.getState();
  if (!play || !snapshot) return 'pending';
  if (item.flow.requestedHint === 'letter') {
    const cell = play.level.grid.cells.find((candidate) => cellKey(candidate) === item.target);
    if (!cell) return 'pending';
    // The target is frozen before show. A crash after the durable game write but
    // before the entitlement marker observes the same cell, never opens another.
    if (play.filled[item.target] !== cell.ch) {
      if (snapshot.completion.status !== 'playing') return 'pending';
      if (!useGame.getState().hint('bulb', cell)?.changed) return 'pending';
    }
  } else {
    if (!play.level.answers.some((answer) => answer.word === item.target)) return 'pending';
    unlockRewardedSemanticClue(item.flow.levelKey, snapshot.levelFingerprint, item.target, item.flow.attemptId);
  }
  const appliedAtMs = Date.now();
  saveLedger({ ...readLedger(), [item.receipt.rewardId]: { ...item, state: 'applied', appliedAtMs } });
  try {
    onApplied?.({ effectId: item.receipt.rewardId, transaction: null, chargedNow: 0,
      context: selectHelpContext(item.receipt.flowContext), appliedAtMs, timeKnown: true });
  } catch { /* Optional telemetry does not revoke the persisted effect. */ }
  return 'applied';
}
