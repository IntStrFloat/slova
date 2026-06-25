/** Можно ли собрать слово из мультимножества букв диска. */
export function canBuildFromLetters(word: string, letters: string[]): boolean {
  const pool = new Map<string, number>();
  for (const l of letters) pool.set(l, (pool.get(l) ?? 0) + 1);
  for (const ch of word) {
    const n = pool.get(ch) ?? 0;
    if (n === 0) return false;
    pool.set(ch, n - 1);
  }
  return true;
}
