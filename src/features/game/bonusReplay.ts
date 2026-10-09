import { cellKey, type Level } from '@/core/engine/types';
import { useCurrency } from '@/features/currency';
import { epochDay, recordWord, reconcileRewards } from '@/features/retention';

import { restoreGame, type GameSnapshot, type PlayMode } from './persistence';

export interface AcceptedWordReplayResult {
  /** Word effects newly recorded in the retention snapshot during this call. */
  recordedWords: number;
  /** Pending coin effects applied or acknowledged by the idempotent wallet. */
  reconciledCoinGrants: number;
}

/**
 * Restore manual word rewards after a game snapshot was saved but recordWord
 * did not finish. Invalid/stale snapshot entries are ignored; a storage write
 * error propagates so the game can offer a retry with the same saved snapshot.
 */
export function reconcileAcceptedWords(
  level: Level,
  mode: PlayMode,
  snapshot: GameSnapshot,
): AcceptedWordReplayResult {
  const settleCoins = () => reconcileRewards((id, amount) =>
    useCurrency.getState().addOnce(id, 'coins', amount));
  const dailyId = mode === 'daily' ? snapshot.dailyId : undefined;
  if (mode === 'daily' && !dailyId) return { recordedWords: 0, reconciledCoinGrants: settleCoins() };
  if (dailyId) {
    try { epochDay(dailyId); } catch { return { recordedWords: 0, reconciledCoinGrants: settleCoins() }; }
  }
  const restored = restoreGame(level, mode, snapshot, dailyId);
  if (!restored) return { recordedWords: 0, reconciledCoinGrants: settleCoins() };

  const puzzleKey = mode === 'daily' ? dailyId! : String(level.globalId ?? level.id);
  const rewardableBonus = new Set(level.rewardedBonus ?? level.bonusPool ?? []);
  const answers = new Map(level.answers.map((answer) => [answer.word, answer]));
  const foundBonus = new Set(restored.snapshot.foundBonus);
  const solvedWords = new Set(restored.snapshot.solvedWords);
  let recordedWords = 0;

  // wordDates is written only by manual submit. Hint-revealed answers never
  // receive an entry, even when they are present in solvedWords and the grid.
  for (const [key, actionDay] of Object.entries(restored.snapshot.wordDates ?? {})) {
    try { epochDay(actionDay); } catch { continue; }
    const divider = key.indexOf(':');
    if (divider < 0) continue;
    const kind = key.slice(0, divider);
    const word = key.slice(divider + 1);
    if (kind === 'grid') {
      const answer = answers.get(word);
      if (!answer || !solvedWords.has(word)
        || !answer.cells.every((cell) => restored.snapshot.filled[cellKey(cell)] === cell.ch)) continue;
    } else if (kind === 'bonus') {
      if (!foundBonus.has(word)) continue;
    } else {
      continue;
    }

    const result = recordWord({
      mode: mode === 'daily' ? 'daily' : 'campaign',
      puzzleKey,
      puzzleDay: dailyId,
      actionDay,
      word,
      bonus: kind === 'bonus' && rewardableBonus.has(word),
      manual: true,
    });
    if (result.accepted) recordedWords += 1;
  }

  const reconciledCoinGrants = settleCoins();
  return { recordedWords, reconciledCoinGrants };
}
