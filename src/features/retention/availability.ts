import { validateLevel, type Level } from '@/core/engine';
import { loadGameSnapshot, type GameSnapshot } from '@/features/game/persistence';
import { selectDailyContent } from '@/features/dailypuzzle/content';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { loadGlobalLevel, totalLevelCount } from '@/features/levels/loader';
import { useLevels } from '@/features/levels/store';

import type { DayOptions, QuestContentProof, RetentionSnapshot } from './model';

/** Four forthcoming campaign grids plus today's and one carried daily grid. */
const CAMPAIGN_LOOKAHEAD = 4;

export interface VerifiedQuestAvailability extends DayOptions {
  remainingNewPuzzles: number;
  availableManualWords: number;
  availableBonusWords: number;
  contentProof: QuestContentProof[];
}

function proofKey(mode: 'campaign' | 'daily', key: string): string {
  return `${mode}:${key}`;
}

function puzzleSnapshot(mode: 'campaign' | 'daily', key: string): GameSnapshot | null {
  const saved = mode === 'campaign' ? loadGameSnapshot('normal') : loadGameSnapshot('daily', undefined, key);
  if (!saved) return null;
  if (mode === 'campaign' && String(saved.globalLevel) !== key) return null;
  return saved;
}

function usableLevel(level: Level | null): level is Level {
  if (!level) return false;
  try {
    return validateLevel(level).ok;
  } catch {
    return false;
  }
}

function countWords(
  snapshot: RetentionSnapshot,
  mode: 'campaign' | 'daily',
  key: string,
  level: Level,
): { manual: number; bonus: number } {
  const previous = puzzleSnapshot(mode, key);
  const saved = previous?.levelFingerprint === level.fingerprint ? previous : null;
  const found = new Set(saved?.solvedWords ?? []);
  const foundBonus = new Set(saved?.foundBonus ?? []);
  const acceptedBonus = new Set(level.acceptedBonus ?? level.bonusPool ?? []);
  const blocked = new Set([
    ...(level.remoteDeny ?? []),
    ...(level.blockedPool ?? []).map((entry) => entry.word),
  ]);
  const eligibleBonus = new Set(level.rewardedBonus ?? level.bonusPool ?? []);
  const prefix = `${mode}:${key}:`;
  const manualAnswers = level.answers.filter((answer) =>
    !found.has(answer.word) && !snapshot.manualWordKeys[`${prefix}${answer.word}`]);
  const manualBonus = [...acceptedBonus].filter((word) =>
    !blocked.has(word) && !foundBonus.has(word) && !snapshot.manualWordKeys[`${prefix}${word}`]);
  const bonus = manualBonus.filter((word) => eligibleBonus.has(word)
    && !snapshot.bonusWordKeys[`${prefix}${word}`]).length;
  return { manual: manualAnswers.length + manualBonus.length, bonus };
}

/** Only verified, reachable and still rewardable local content can pin quests. */
export function getVerifiedQuestAvailability(
  snapshot: RetentionSnapshot,
  actionDay: string,
): VerifiedQuestAvailability {
  const levels = useLevels.getState();
  const completed = new Set(levels.completed.map(String));
  const proof: QuestContentProof[] = [];
  let manual = 0;
  let bonus = 0;

  const start = Math.max(1, levels.currentLevel);
  let inspected = 0;
  for (let id = start; id <= totalLevelCount() && inspected < CAMPAIGN_LOOKAHEAD; id++) {
    const key = String(id);
    if (completed.has(key) || snapshot.campaignCompletions[key]) continue;
    const level = loadGlobalLevel(id);
    // The campaign is sequential: content past a missing grid is unreachable.
    if (!usableLevel(level)) break;
    inspected += 1;
    proof.push({ puzzleKey: proofKey('campaign', key), fingerprint: level.fingerprint ?? '' });
    const counts = countWords(snapshot, 'campaign', key, level);
    manual += counts.manual;
    bonus += counts.bonus;
  }

  const daily = useDailyPuzzle.getState();
  if (daily.effectiveDay() === actionDay && !daily.solvedDates.includes(actionDay)
    && !snapshot.dailyCompletions[actionDay]) {
    const instance = daily.instances[actionDay];
    const level = instance?.level ?? selectDailyContent(actionDay, 'starter')?.level ?? null;
    if (usableLevel(level)) {
      proof.push({ puzzleKey: proofKey('daily', actionDay), fingerprint: level.fingerprint ?? '' });
      const counts = countWords(snapshot, 'daily', actionDay, level);
      manual += counts.manual;
      bonus += counts.bonus;
    }
  }
  const carried = daily.pendingOlder();
  if (carried && !daily.solvedDates.includes(carried.dateKey)
    && !snapshot.dailyCompletions[carried.dateKey] && usableLevel(carried.level)) {
    proof.push({ puzzleKey: proofKey('daily', carried.dateKey), fingerprint: carried.level.fingerprint ?? '' });
    const counts = countWords(snapshot, 'daily', carried.dateKey, carried.level);
    manual += counts.manual;
    bonus += counts.bonus;
  }

  return {
    actionDay,
    remainingNewPuzzles: proof.length,
    availableManualWords: manual,
    availableBonusWords: bonus,
    contentProof: proof,
  };
}

/** A removed or changed puzzle is a content failure, not a player's hint choice. */
export function hasUnavailablePinnedContent(
  pinned: QuestContentProof[] | undefined,
  current: QuestContentProof[],
  snapshot: RetentionSnapshot,
): boolean {
  if (!pinned?.length) return false;
  const currentProof = new Map(current.map((entry) => [entry.puzzleKey, entry.fingerprint]));
  return pinned.some((entry) => {
    const divider = entry.puzzleKey.indexOf(':');
    const mode = entry.puzzleKey.slice(0, divider);
    const key = entry.puzzleKey.slice(divider + 1);
    const completed = mode === 'campaign'
      ? snapshot.campaignCompletions[key]
      : snapshot.dailyCompletions[key];
    return !completed && currentProof.get(entry.puzzleKey) !== entry.fingerprint;
  });
}

/** Pure threshold check against an already frozen quest instance. */
export function questCannotFinish(
  kind: 'completions' | 'manualWords' | 'bonusWords',
  remaining: number,
  availability: VerifiedQuestAvailability,
): boolean {
  if (remaining <= 0) return false;
  if (kind === 'completions') return availability.remainingNewPuzzles < remaining;
  if (kind === 'bonusWords') return availability.availableBonusWords < remaining;
  return availability.availableManualWords < remaining;
}
