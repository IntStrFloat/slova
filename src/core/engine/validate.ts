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
  for (const b of level.bonusPool) if (answerSet.has(b)) errors.push(`bonus_in_answers:${b}`);
  return errors.length ? { ok: false, errors } : { ok: true };
}
