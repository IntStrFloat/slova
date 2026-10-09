import { canBuildFromLetters } from './letters';
import { cellKey, Level } from './types';

/** Инварианты уровня (спека 03): answers собираемы, клетки совпадают, нет висячих, bonus∩answers=∅. */
export function validateLevel(level: Level): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const a of level.answers) {
    if (!canBuildFromLetters(a.word, level.letters)) errors.push(`not_buildable:${a.word}`);
    if (a.cells.length !== a.word.length) errors.push(`len_mismatch:${a.word}`);
    a.cells.forEach((c, i) => {
      if (c.ch !== a.word[i]) errors.push(`char_mismatch:${a.word}@${i}`);
    });
  }
  const covered = new Set<string>();
  for (const a of level.answers) for (const c of a.cells) covered.add(cellKey(c));
  for (const c of level.grid.cells) if (!covered.has(cellKey(c))) errors.push(`dangling:${cellKey(c)}`);
  const answerSet = new Set(level.answers.map((a) => a.word));
  const acceptedBonus = level.acceptedBonus ?? level.bonusPool ?? [];
  const rewardedBonus = level.rewardedBonus ?? [];
  if (acceptedBonus.length > 14) errors.push(`bonus_cap:${acceptedBonus.length}`);
  if (rewardedBonus.length > 14) errors.push(`rewarded_bonus_cap:${rewardedBonus.length}`);
  for (const b of acceptedBonus) {
    if (answerSet.has(b)) errors.push(`bonus_in_answers:${b}`);
    if (!canBuildFromLetters(b, level.letters)) errors.push(`bonus_not_buildable:${b}`);
  }
  for (const b of rewardedBonus) {
    if (!acceptedBonus.includes(b)) errors.push(`rewarded_not_accepted:${b}`);
  }
  for (const blocked of level.blockedPool ?? []) {
    if (answerSet.has(blocked.word)) errors.push(`blocked_in_answers:${blocked.word}`);
    if (acceptedBonus.includes(blocked.word)) errors.push(`blocked_in_bonus:${blocked.word}`);
  }
  if (level.mechanic === 'bonus_chest') {
    if (!Number.isInteger(level.bonusTarget) || (level.bonusTarget ?? 0) < 1) errors.push('bonus_target_invalid');
    if ((level.bonusTarget ?? 0) > rewardedBonus.length) errors.push('bonus_target_exceeds_rewarded');
  } else if (level.bonusTarget != null) {
    errors.push('bonus_target_without_bonus_chest');
  }
  if (level.mechanic === 'ordered') {
    const answerOrder = level.answerOrder ?? [];
    if (answerOrder.length !== level.answers.length) errors.push('answer_order_len');
    if (answerOrder.some((word) => !answerSet.has(word))) errors.push('answer_order_unknown_word');
  } else if (level.answerOrder != null) {
    errors.push('answer_order_without_ordered');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
