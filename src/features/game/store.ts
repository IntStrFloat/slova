import { create } from 'zustand';

import { GAME } from '@/core/config/game';
import { DEFAULT_POLICY, getAttemptPolicy, getConfiguredPolicy, setAttemptPolicy } from '@/core/config/runtimePolicy';
import { applyHint } from '@/core/engine/hints';
import { shuffle, submitWord } from '@/core/engine/play';
import { mulberry32 } from '@/core/engine/rng';
import {
  initPlayState,
  type Cell,
  type CompletionSource,
  type HintResult,
  type HintType,
  type Level,
  type PlayState,
  type SubmitResult,
} from '@/core/engine/types';
import { dayKey } from '@/core/time';
import { addGameplayTime } from '@/features/analytics/sessionTelemetry';

import {
  clearGameSnapshot,
  loadGameSnapshot,
  restoreGame,
  saveGameSnapshot,
  serializeGame,
  type CompletionState,
  type GameSnapshot,
  type PlayMode,
} from './persistence';

interface GameState {
  play: PlayState | null;
  level: Level | null;
  mode: PlayMode;
  dailyDate: string | null;
  coins: number;
  disk: string[];
  lastResult: SubmitResult | null;
  completion: CompletionState;
  snapshot: GameSnapshot | null;
  hintsUsed: HintType[];
  wordDates: Record<string, string>;
  mistakes: number;
  start: (level: Level, mode?: PlayMode, dailyDate?: string) => void;
  submit: (word: string) => SubmitResult;
  doShuffle: () => void;
  hint: (h: HintType, target?: Cell) => HintResult | null;
  claimCompletion: () => string | null;
  markRewardClaimed: () => void;
  finish: () => void;
  recordVisibleTime: (attemptId: string, elapsedMs: number) => void;
  recordSemanticHelp: (attemptId: string) => void;
}

function persist(state: Pick<GameState, 'level' | 'play' | 'mode' | 'dailyDate' | 'coins' | 'disk' | 'completion' | 'snapshot' | 'hintsUsed' | 'wordDates' | 'mistakes'>): GameSnapshot | null {
  if (!state.level || !state.play) return null;
  const snap = serializeGame(
    state.level,
    { ...state.play, coinsEarned: state.coins },
    state.disk,
    state.mode,
    state.completion,
    state.snapshot,
    state.hintsUsed,
    state.mode === 'daily' ? state.dailyDate ?? dayKey() : undefined,
    state.wordDates,
    state.mistakes,
  );
  saveGameSnapshot(state.mode, snap);
  return snap;
}

function pendingCompletion(
  completion: CompletionState,
  source: CompletionSource,
): CompletionState {
  if (completion.status !== 'playing') return completion;
  return { status: 'completion_pending', source, completedAt: new Date().toISOString() };
}

export const useGame = create<GameState>((set, get) => ({
  play: null,
  level: null,
  mode: 'normal',
  dailyDate: null,
  coins: 0,
  disk: [],
  lastResult: null,
  completion: { status: 'playing' },
  snapshot: null,
  hintsUsed: [],
  wordDates: {},
  mistakes: 0,
  recordVisibleTime: (attemptId, elapsedMs) => {
    const snapshot = get().snapshot;
    if (!snapshot || snapshot.attemptId !== attemptId || snapshot.completion.status !== 'playing'
      || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
    const delta = Math.round(elapsedMs);
    const next = { ...snapshot, revision: snapshot.revision + 1, updatedAt: new Date().toISOString(),
      activeTimeMs: (snapshot.activeTimeMs ?? 0) + delta };
    saveGameSnapshot(next.mode, next);
    set({ snapshot: next });
    addGameplayTime(delta);
  },
  recordSemanticHelp: (attemptId) => {
    const snapshot = get().snapshot;
    if (!snapshot || snapshot.attemptId !== attemptId || snapshot.completion.status !== 'playing'
      || snapshot.semanticHelpUsed) return;
    const next = { ...snapshot, semanticHelpUsed: true, revision: snapshot.revision + 1,
      updatedAt: new Date().toISOString() };
    saveGameSnapshot(next.mode, next);
    set({ snapshot: next });
  },
  start: (level, mode = 'normal', dailyDate) => {
    const pinnedDailyDate = mode === 'daily' ? dailyDate ?? dayKey() : null;
    const stored = loadGameSnapshot(mode, level, pinnedDailyDate ?? undefined);
    const restored = restoreGame(level, mode, stored, pinnedDailyDate ?? undefined);
    const play = restored?.play ?? initPlayState(level);
    const disk = restored?.disk ?? [...level.letters];
    const completion = restored?.snapshot.completion ?? { status: 'playing' };
    const coins = restored?.snapshot.coinsEarned ?? play.coinsEarned;
    const next = {
      play, level, mode, dailyDate: pinnedDailyDate, coins, disk, lastResult: null,
      completion, snapshot: restored?.snapshot ?? null, hintsUsed: restored?.snapshot.hintsUsed ?? [],
      wordDates: restored?.snapshot.wordDates ?? {},
      mistakes: restored?.snapshot.mistakes ?? 0,
    };
    const previousPolicy = getAttemptPolicy();
    setAttemptPolicy(restored ? restored.snapshot.runtimePolicy ?? DEFAULT_POLICY : getConfiguredPolicy());
    try {
      const snapshot = persist(next);
      set({ ...next, completion: snapshot?.completion ?? completion, snapshot });
    } catch (error) {
      setAttemptPolicy(previousPolicy);
      throw error;
    }
  },
  submit: (word) => {
    const cur = get().play;
    if (!cur) return { kind: 'invalid', word, reason: 'empty' };
    const { state, result } = submitWord(cur, word);
    const complete = result.kind === 'grid' && result.levelComplete;
    const completion = complete ? pendingCompletion(get().completion, 'submit') : get().completion;
    const clearBonus = complete && get().completion.status === 'playing' ? GAME.levelClearBonus : 0;
    const coins = get().coins + ('deltaCoins' in result ? result.deltaCoins : 0) + clearBonus;
    const wordDates = result.kind === 'grid' || result.kind === 'bonus'
      ? { ...get().wordDates, [`${result.kind}:${result.word}`]: dayKey() }
      : get().wordDates;
    const mistakes = result.kind === 'invalid' || result.kind === 'blocked'
      || result.kind === 'constraint' || result.kind === 'duplicate'
      ? get().mistakes + 1 : get().mistakes;
    const previous = get().snapshot;
    const next = { ...get(), play: state, coins, lastResult: result, completion, wordDates, mistakes,
      snapshot: previous && result.kind === 'grid'
        ? { ...previous, lastSuccessAt: new Date().toISOString() } : previous };
    const snapshot = persist(next);
    set({ play: state, coins, lastResult: result, completion: snapshot?.completion ?? completion, snapshot, wordDates, mistakes });
    return result;
  },
  doShuffle: () => {
    const disk = shuffle(get().disk, mulberry32((Date.now() & 0xffffffff) >>> 0));
    const next = { ...get(), disk };
    const snapshot = persist(next);
    set({ disk, snapshot });
  },
  hint: (hint, target) => {
    const cur = get().play;
    if (!cur) return null;
    const { state, result } = applyHint(cur, hint, target);
    if (!result.changed) return result;
    const completion = result.levelComplete ? pendingCompletion(get().completion, result.source) : get().completion;
    const clearBonus = result.levelComplete && get().completion.status === 'playing' ? GAME.levelClearBonus : 0;
    const next = {
      ...get(), play: state, coins: get().coins + clearBonus, completion,
      hintsUsed: [...get().hintsUsed, hint],
    };
    const snapshot = persist(next);
    set({
      play: state,
      coins: next.coins,
      completion: snapshot?.completion ?? completion,
      hintsUsed: next.hintsUsed,
      snapshot,
    });
    return result;
  },
  claimCompletion: () => {
    const current = get().completion;
    if (current.status !== 'completion_pending') return null;
    // Effects are applied by their own persistent ledgers before this transition.
    // If the process dies, the pending snapshot restores the overlay and each
    // effect's applyOnce operation is safe to retry.
    return current.completionId ?? get().snapshot?.completion.completionId ?? null;
  },
  markRewardClaimed: () => {
    const current = get().completion;
    if (current.status !== 'completion_pending') return;
    const completion = { ...current, status: 'reward_claimed' as const };
    const next = { ...get(), completion };
    const snapshot = persist(next);
    set({ completion: snapshot?.completion ?? completion, snapshot });
  },
  finish: () => {
    const completion = { ...get().completion, status: 'finished' as const };
    const next = { ...get(), completion };
    const snapshot = persist(next);
    set({ completion: snapshot?.completion ?? completion, snapshot });
    clearGameSnapshot(get().mode, get().dailyDate ?? undefined);
    setAttemptPolicy(null);
  },
}));
