import { ECONOMY } from '@/core/config/economy';
import { cellKey } from '@/core/engine/types';
import { getJSON, KEYS, storage } from '@/core/storage';
import { type HelpAnalyticsContext, selectHelpContext } from '@/features/analytics/helpContext';
import { useCurrency, type WalletTransactionRecord } from '@/features/currency';
import { useRetention } from '@/features/retention';
import { recordIntroDemoHelpUsed } from '@/features/onboarding/introGuide';
import { isFreeIntroHelpLevel } from '@/features/onboarding/onboardingHelp';

import type { GameSnapshot } from './persistence';
import { useGame } from './store';

type LetterPayment = 'free' | 'ticket' | 'coins';
export type LetterHintOutcome = 'applied' | 'insufficient' | 'unavailable';

export interface AppliedHintPayment {
  /** Local idempotency key; content-derived keys must never be emitted to analytics. */
  effectId: string;
  transaction: WalletTransactionRecord | null;
  chargedNow: number;
  context: HelpAnalyticsContext;
  appliedAtMs?: number;
  timeKnown: boolean;
}

interface LegacyHintIntent {
  version: 1;
  puzzleKey: string;
  cell: string;
  effectId: string;
  payment: LetterPayment;
  status?: 'applied' | 'cancelled';
  context?: HelpAnalyticsContext;
  initialLetterHintCount?: number;
  appliedAtMs?: number;
}

interface IntroFreeHintIntent {
  version: 2;
  puzzleKey: string;
  cell: string;
  effectId: string;
  payment: 'intro-free';
  attemptId: string;
  levelId: number;
  contentVersion: string;
  levelFingerprint: string;
  status?: 'applied' | 'cancelled';
  context?: HelpAnalyticsContext;
  initialLetterHintCount?: number;
  appliedAtMs?: number;
}

type HintIntent = LegacyHintIntent | IntroFreeHintIntent;

const settledEffects = new Map<string, 'applied' | 'cancelled'>();

function pending(): HintIntent | null {
  const value = getJSON<HintIntent | null>(KEYS.pendingHint, null);
  if (!value || typeof value.effectId !== 'string' || !value.effectId
    || typeof value.puzzleKey !== 'string' || !value.puzzleKey
    || typeof value.cell !== 'string' || !/^\d+,\d+$/.test(value.cell)
    || (value.status != null && value.status !== 'applied' && value.status !== 'cancelled')) return null;
  if (value.version === 1 && (value.payment === 'free' || value.payment === 'ticket'
    || value.payment === 'coins')) return value;
  if (value.version === 2 && value.payment === 'intro-free'
    && typeof value.attemptId === 'string' && value.attemptId
    && Number.isInteger(value.levelId) && value.levelId >= 1 && value.levelId <= 5
    && typeof value.contentVersion === 'string' && value.contentVersion
    && typeof value.levelFingerprint === 'string' && value.levelFingerprint) return value;
  return null;
}

function authorizesFreeHint(intent: IntroFreeHintIntent): boolean {
  const { play, mode, snapshot } = useGame.getState();
  return Boolean(play && snapshot && isFreeIntroHelpLevel(play.level, mode)
    && intent.puzzleKey === `campaign:${play.level.globalId}`
    && intent.levelId === play.level.id
    && intent.contentVersion === play.level.contentVersion
    && intent.levelFingerprint === play.level.fingerprint
    && snapshot.mode === 'normal'
    && snapshot.globalLevel === play.level.globalId && snapshot.levelId === play.level.id
    && snapshot.world === play.level.world
    && snapshot.contentVersion === intent.contentVersion
    && snapshot.levelFingerprint === intent.levelFingerprint
    && snapshot.attemptId === intent.attemptId
    && intent.effectId === `hint:${intent.puzzleKey}:${intent.attemptId}:${intent.cell}`
    && play.level.grid.cells.some((cell) => cellKey(cell) === intent.cell));
}

function save(intent: HintIntent): void {
  storage.set(KEYS.pendingHint, JSON.stringify(intent));
}

function clear(): boolean {
  try {
    storage.remove(KEYS.pendingHint);
    return true;
  } catch {
    // The applied cell and debit are already durable. A marked intent can be
    // replayed or replaced on the next puzzle without repeating either one.
    return false;
  }
}

function settledStatus(intent: HintIntent): 'applied' | 'cancelled' | null {
  return intent.status === 'applied' || intent.status === 'cancelled'
    ? intent.status : settledEffects.get(intent.effectId) ?? null;
}

function settleIntent(intent: HintIntent, status: 'applied' | 'cancelled', appliedAtMs?: number): void {
  settledEffects.set(intent.effectId, status);
  try {
    save({ ...intent, status, ...(appliedAtMs === undefined ? {} : { appliedAtMs }) });
  } catch {
    // Keep the in-process marker. Cleanup must not turn a committed hint into
    // a reported failure; the game snapshot and payment ledger remain canonical.
  }
  if (clear()) settledEffects.delete(intent.effectId);
}

function hintContext(context?: HelpAnalyticsContext): HelpAnalyticsContext {
  try { return selectHelpContext(context); } catch { return {}; }
}

function notifyApplied(intent: HintIntent, chargedNow: number, onApplied?: (payment: AppliedHintPayment) => void,
  appliedAtMs = intent.appliedAtMs): void {
  if (!onApplied) return;
  try {
    const timeKnown = Number.isSafeInteger(appliedAtMs) && (appliedAtMs ?? -1) >= 0;
    onApplied({ effectId: intent.effectId, chargedNow, timeKnown,
      ...(timeKnown ? { appliedAtMs } : {}),
      transaction: intent.payment === 'coins' ? useCurrency.getState().getTransaction(intent.effectId) : null,
      context: hintContext(intent.context) });
  } catch { /* An optional observer cannot change committed help. */ }
}

/** A filled cell alone may have been a manual answer; require saved hint evidence. */
function hasAppliedLetter(intent: HintIntent): boolean {
  const { snapshot, play } = useGame.getState();
  if (!snapshot || !play || !Number.isSafeInteger(intent.initialLetterHintCount)
    || (intent.initialLetterHintCount ?? -1) < 0) return false;
  const puzzleKey = snapshot.mode === 'daily' ? `daily:${snapshot.dailyId}` : `campaign:${snapshot.globalLevel}`;
  const baseEffectId = `hint:${puzzleKey}:${snapshot.attemptId}:${intent.cell}`;
  const cell = play.level.grid.cells.find((candidate) => cellKey(candidate) === intent.cell);
  return Boolean(cell && intent.puzzleKey === puzzleKey
    && (intent.effectId === baseEffectId || intent.effectId.startsWith(`${baseEffectId}:retry:`))
    && snapshot.filled[intent.cell] === cell.ch
    && snapshot.hintsUsed.filter((hint) => hint === 'bulb').length > intent.initialLetterHintCount!);
}

function savedSnapshotFor(intent: HintIntent): GameSnapshot | null {
  const daily = intent.puzzleKey.startsWith('daily:');
  const date = daily ? intent.puzzleKey.slice('daily:'.length) : '';
  const dailyPrimary = daily ? getJSON<Record<string, GameSnapshot> | null>(KEYS.gameDailySnapshots, null) : null;
  const dailyBackup = daily ? getJSON<Record<string, GameSnapshot> | null>(KEYS.gameDailySnapshotsBackup, null) : null;
  const candidates = daily
    ? [dailyPrimary?.[date], dailyBackup?.[date], getJSON<GameSnapshot | null>(KEYS.gameCurrentDaily, null)]
    : [getJSON<GameSnapshot | null>(KEYS.gameCurrentNormal, null),
      getJSON<GameSnapshot | null>(KEYS.gameCurrentNormalBackup, null)];
  return candidates.find((snapshot) => snapshot?.version === 2
    && snapshot.attemptId
    && intent.effectId === `hint:${intent.puzzleKey}:${snapshot.attemptId}:${intent.cell}`) ?? null;
}

function oldPuzzleCompleted(puzzleKey: string): boolean {
  if (puzzleKey.startsWith('campaign:')) {
    const id = Number(puzzleKey.slice('campaign:'.length));
    if (!Number.isInteger(id) || id < 1) return false;
    return [KEYS.levelsProgress, KEYS.levelsProgressBackup].some((key) => {
      const saved = getJSON<{ completed?: number[] } | null>(key, null);
      return Array.isArray(saved?.completed) && saved.completed.includes(id);
    });
  }
  if (puzzleKey.startsWith('daily:')) {
    const date = puzzleKey.slice('daily:'.length);
    return [KEYS.dailyPuzzle, KEYS.dailyPuzzleBackup].some((key) => {
      const saved = getJSON<{ solvedDates?: string[] } | null>(key, null);
      return Array.isArray(saved?.solvedDates) && saved.solvedDates.includes(date);
    });
  }
  return false;
}

function wasDebited(intent: HintIntent): boolean {
  return intent.payment === 'ticket'
    ? useRetention.getState().hasSpentTicket(intent.effectId)
    : intent.payment === 'coins'
      ? useCurrency.getState().hasApplied(intent.effectId)
      : false;
}

function refundId(effectId: string): string {
  return `hint-recovery:${effectId}`;
}

function refundOnce(intent: HintIntent): void {
  const id = refundId(intent.effectId);
  if (intent.payment === 'ticket') {
    useRetention.getState().grantLegacyTicketRefundOnce(id);
    useRetention.getState().reconcileRewards((effectId, amount) =>
      useCurrency.getState().addOnce(effectId, 'coins', amount));
  }
  if (intent.payment === 'coins') useCurrency.getState().addOnce(id, 'coins', ECONOMY.hints.bulb);
}

/** Pre-update intents cannot authorize a new free or ticket-funded reveal. */
function cancelLegacyIntent(intent: LegacyHintIntent): void {
  if (intent.payment === 'ticket' && wasDebited(intent)) refundOnce(intent);
  settleIntent(intent, 'cancelled');
}

/** A foreign raw intent must not keep a newer puzzle locked after restart. */
function reconcileForeignIntent(intent: HintIntent): void {
  if (intent.version === 2) {
    settleIntent(intent, 'cancelled');
    return;
  }
  if (intent.payment !== 'coins') {
    cancelLegacyIntent(intent);
    return;
  }
  const old = savedSnapshotFor(intent);
  if (old?.filled?.[intent.cell] || (!old && oldPuzzleCompleted(intent.puzzleKey))) {
    settleIntent(intent, 'applied');
    return;
  }
  // If payment committed but the cell did not, compensate exactly once. The
  // returned resource can be used on the old or a new puzzle.
  if (wasDebited(intent)) refundOnce(intent);
  settleIntent(intent, 'cancelled');
}

function nextEffectId(base: string): string {
  let candidate = base;
  for (let retry = 1; useCurrency.getState().hasApplied(refundId(candidate))
    || Boolean(useRetention.getState().rewardGrants[refundId(candidate)])
    || useRetention.getState().hasSpentTicket(candidate); retry++) {
    candidate = `${base}:retry:${retry}`;
  }
  return candidate;
}

export function hasClosedCell(): boolean {
  const { play, completion } = useGame.getState();
  return completion.status === 'playing' && Boolean(play?.level.grid.cells.some(
    (cell) => play.filled[cellKey(cell)] !== cell.ch,
  ));
}

/** Persist the authorized intent, pay if needed, reveal, then clear. A crash replays it. */
export function revealLetter(puzzleKey: string, context?: HelpAnalyticsContext,
  onApplied?: (payment: AppliedHintPayment) => void): LetterHintOutcome {
  const { play, mode, completion, snapshot } = useGame.getState();
  if (completion.status !== 'playing' || !play || !puzzleKey) return 'unavailable';
  let stored = pending();
  if (stored?.version === 1 && stored.payment !== 'coins') {
    cancelLegacyIntent(stored);
    stored = null;
  }
  if (stored && settledStatus(stored)) {
    if (clear()) settledEffects.delete(stored.effectId);
    stored = null;
  }
  if (stored && stored.puzzleKey !== puzzleKey) {
    reconcileForeignIntent(stored);
    stored = null;
  }
  if (stored?.version === 2 && !authorizesFreeHint(stored)) {
    settleIntent(stored, 'cancelled');
    stored = null;
  }
  const cell = stored
    ? play.level.grid.cells.find((candidate) => cellKey(candidate) === stored.cell)
    : play.level.grid.cells.find((candidate) => play.filled[cellKey(candidate)] !== candidate.ch);
  if (!cell) return 'unavailable';
  const key = cellKey(cell);
  if (play.filled[key] === cell.ch) {
    if (stored) {
      if (stored.version === 2) recordIntroDemoHelpUsed(stored.levelId);
      const applied = hasAppliedLetter(stored);
      settleIntent(stored, 'applied');
      if (applied) notifyApplied(stored, 0, onApplied);
      return 'applied';
    }
    return 'unavailable';
  }
  const baseEffectId = `hint:${puzzleKey}:${snapshot?.attemptId ?? 'unsaved'}:${key}`;
  const freeIntro = isFreeIntroHelpLevel(play.level, mode)
    && puzzleKey === `campaign:${play.level.globalId}` && snapshot?.attemptId;
  const intent: HintIntent = stored ?? (freeIntro ? {
    version: 2,
    puzzleKey,
    cell: key,
    effectId: baseEffectId,
    payment: 'intro-free',
    attemptId: snapshot.attemptId,
    levelId: play.level.id,
    contentVersion: play.level.contentVersion!,
    levelFingerprint: play.level.fingerprint!,
    context: hintContext(context),
    initialLetterHintCount: snapshot.hintsUsed.filter((hint) => hint === 'bulb').length,
  } : {
    version: 1,
    puzzleKey,
    cell: key,
    effectId: nextEffectId(baseEffectId),
    payment: 'coins',
    context: hintContext(context),
    initialLetterHintCount: snapshot?.hintsUsed.filter((hint) => hint === 'bulb').length ?? 0,
  });
  if (!stored) {
    settledEffects.delete(intent.effectId);
    save(intent);
  }

  let chargedNow = 0;
  if (intent.version === 1) {
    const debit = useCurrency.getState().spendOnce(intent.effectId, 'coins', ECONOMY.hints.bulb, intent.context);
    if (debit === 'insufficient') {
      settleIntent(intent, 'cancelled');
      return 'insufficient';
    }
    chargedNow = debit === 'spent' ? ECONOMY.hints.bulb : 0;
  }
  const result = useGame.getState().hint('bulb', cell);
  if (!result?.changed) return 'unavailable';
  const appliedAtMs = Date.now();
  if (intent.version === 2) recordIntroDemoHelpUsed(intent.levelId);
  settleIntent(intent, 'applied', appliedAtMs);
  notifyApplied(intent, chargedNow, onApplied, appliedAtMs);
  return 'applied';
}

/** Call after restoring a saved puzzle, before allowing another hint. */
export function replayPendingLetterHint(puzzleKey: string,
  onApplied?: (payment: AppliedHintPayment) => void): LetterHintOutcome | null {
  const intent = pending();
  if (!intent) return null;
  if (intent.version === 1 && intent.payment !== 'coins') {
    cancelLegacyIntent(intent);
    return null;
  }
  if (intent.puzzleKey !== puzzleKey) {
    if (settledStatus(intent)) {
      if (clear()) settledEffects.delete(intent.effectId);
    } else {
      reconcileForeignIntent(intent);
    }
    return null;
  }
  if (intent.version === 2 && !authorizesFreeHint(intent)) {
    settleIntent(intent, 'cancelled');
    return null;
  }
  const status = settledStatus(intent);
  if (status) {
    if (clear()) settledEffects.delete(intent.effectId);
    if (status === 'applied') notifyApplied(intent, 0, onApplied);
    return status === 'cancelled' ? null : 'applied';
  }
  const { play } = useGame.getState();
  if (!play) return null;
  if (play.filled[intent.cell]) {
    if (intent.version === 2) recordIntroDemoHelpUsed(intent.levelId);
    const applied = hasAppliedLetter(intent);
    settleIntent(intent, 'applied');
    if (applied) notifyApplied(intent, 0, onApplied);
    return 'applied';
  }
  return revealLetter(puzzleKey, undefined, onApplied);
}
