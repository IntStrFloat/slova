export type Dir = 'H' | 'V';
export type Cell = { row: number; col: number; ch: string };
export type Answer = { word: string; cells: Cell[]; dir: Dir };

export interface Level {
  id: number;
  world: string;
  letters: string[]; // нормализованные буквы диска (нижний регистр, ё→е)
  grid: { rows: number; cols: number; cells: Cell[] };
  answers: Answer[];
  bonusPool: string[]; // валидные слова из letters, не входящие в answers
  difficulty: number;
}

export interface PlayState {
  level: Level;
  filled: Record<string, string>; // "row,col" -> ch
  solvedWords: string[];
  foundBonus: string[];
  coinsEarned: number;
}

export type HintType = 'bulb' | 'hammer' | 'revealWord';

export type SubmitResult =
  | { kind: 'grid'; word: string; cells: Cell[]; deltaCoins: number; levelComplete: boolean }
  | { kind: 'bonus'; word: string; deltaCoins: number; firstTime: boolean }
  | { kind: 'duplicate'; word: string }
  | { kind: 'invalid'; word: string };

export function cellKey(c: { row: number; col: number }): string {
  return `${c.row},${c.col}`;
}

export function initPlayState(level: Level): PlayState {
  return { level, filled: {}, solvedWords: [], foundBonus: [], coinsEarned: 0 };
}
