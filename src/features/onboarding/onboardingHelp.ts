import type { Level } from '@/core/engine/types';

import { hasIntroPackAssignment, isVerifiedIntroLevel } from './introPack';

/** Numeric campaign IDs alone never authorize free introduction assistance. */
export function isFreeIntroHelpLevel(level: Level | null, mode: 'normal' | 'daily'): boolean {
  if (!level || mode !== 'normal' || !hasIntroPackAssignment()
    || !Number.isInteger(level.id) || level.id < 1 || level.id > 5) return false;
  return isVerifiedIntroLevel(level);
}

/** A request-only demo path. Rendering it must never submit or fill a word. */
export function firstUnsolvedIntroWord(level: Level, solvedWords: readonly string[]): string | null {
  if (!isVerifiedIntroLevel(level) || level.id !== 1 || level.globalId !== 1
    || level.answers.map((answer) => answer.word).join(',') !== 'кот,ток') {
    return null;
  }
  return level.answers.find((answer) => !solvedWords.includes(answer.word))?.word ?? null;
}
