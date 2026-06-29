import { create } from 'zustand';

import { GAME } from '@/core/config/game';
import { applyHint } from '@/core/engine/hints';
import { shuffle, submitWord } from '@/core/engine/play';
import { mulberry32 } from '@/core/engine/rng';
import {
  initPlayState,
  type HintType,
  type Level,
  type PlayState,
  type SubmitResult,
} from '@/core/engine/types';

import {
  clearGameSnapshot,
  loadGameSnapshot,
  restoreGame,
  saveGameSnapshot,
  serializeGame,
  type PlayMode,
} from './persistence';

interface GameState {
  play: PlayState | null;
  level: Level | null;
  mode: PlayMode;
  coins: number;
  disk: string[];
  lastResult: SubmitResult | null;
  start: (level: Level, mode?: PlayMode) => void;
  submit: (word: string) => SubmitResult;
  doShuffle: () => void;
  hint: (h: HintType) => void;
  finish: () => void;
}

/** Сохранить текущий снапшот уровня (in-level save, спека 10). */
function persist(level: Level | null, play: PlayState | null, disk: string[], mode: PlayMode): void {
  if (!level || !play) return;
  saveGameSnapshot(serializeGame(level, play, disk, mode));
}

export const useGame = create<GameState>((set, get) => ({
  play: null,
  level: null,
  mode: 'normal',
  coins: 0,
  disk: [],
  lastResult: null,
  start: (level, mode = 'normal') => {
    const restored = restoreGame(level, mode, loadGameSnapshot());
    const play = restored?.play ?? initPlayState(level);
    const disk = restored?.disk ?? [...level.letters];
    set({ play, level, mode, coins: play.coinsEarned, disk, lastResult: null });
    persist(level, play, disk, mode);
  },
  submit: (word) => {
    const cur = get().play;
    if (!cur) return { kind: 'invalid', word };
    const { state, result } = submitWord(cur, word);
    let coins = get().coins + ('deltaCoins' in result ? result.deltaCoins : 0);
    if (result.kind === 'grid' && result.levelComplete) coins += GAME.levelClearBonus;
    set({ play: state, coins, lastResult: result });
    persist(get().level, state, get().disk, get().mode);
    return result;
  },
  doShuffle: () => {
    const disk = shuffle(get().disk, mulberry32((Date.now() & 0xffffffff) >>> 0));
    set({ disk });
    persist(get().level, get().play, disk, get().mode);
  },
  hint: (h) => {
    const cur = get().play;
    if (!cur) return;
    const { state } = applyHint(cur, h);
    set({ play: state });
    persist(get().level, state, get().disk, get().mode);
  },
  finish: () => {
    // Снимаем in-level снапшот; play остаётся до start() следующего уровня,
    // чтобы не мигал fallback-экран на переходе level-complete.
    clearGameSnapshot();
  },
}));
