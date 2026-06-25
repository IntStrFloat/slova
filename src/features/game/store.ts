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

interface GameState {
  play: PlayState | null;
  coins: number;
  disk: string[];
  lastResult: SubmitResult | null;
  start: (level: Level) => void;
  submit: (word: string) => SubmitResult;
  doShuffle: () => void;
  hint: (h: HintType) => void;
}

export const useGame = create<GameState>((set, get) => ({
  play: null,
  coins: 0,
  disk: [],
  lastResult: null,
  start: (level) =>
    set({ play: initPlayState(level), coins: 0, disk: [...level.letters], lastResult: null }),
  submit: (word) => {
    const cur = get().play;
    if (!cur) return { kind: 'invalid', word };
    const { state, result } = submitWord(cur, word);
    let coins = get().coins + ('deltaCoins' in result ? result.deltaCoins : 0);
    if (result.kind === 'grid' && result.levelComplete) coins += GAME.levelClearBonus;
    set({ play: state, coins, lastResult: result });
    return result;
  },
  doShuffle: () => set({ disk: shuffle(get().disk, mulberry32((Date.now() & 0xffffffff) >>> 0)) }),
  hint: (h) => {
    const cur = get().play;
    if (!cur) return;
    const { state } = applyHint(cur, h);
    set({ play: state });
  },
}));
