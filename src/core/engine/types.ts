export type Dir = 'H' | 'V';
export type Cell = { row: number; col: number; ch: string };
export type Answer = { word: string; cells: Cell[]; dir: Dir };

export type BlockReason =
  | 'profanity'
  | 'slur_or_insult'
  | 'proper_name'
  | 'abbreviation'
  | 'malformed'
  | 'non_lemma'
  | 'low_quality'
  | 'manual_deny';

export type BlockedWord = { word: string; reason: BlockReason };
export type DifficultyRole = 'easy' | 'baseline' | 'hard' | 'breather' | 'climax';
export type LevelMechanic = 'classic' | 'bonus_chest' | 'ordered' | 'mastery';
export type LevelMilestone = 'chest' | 'landmark' | 'world_finale' | 'journey_finale';

export interface Level {
  id: number;
  /** Стабильный id в общем пути; legacy-паки могут его не содержать. */
  globalId?: number;
  world: string;
  contentVersion?: string;
  fingerprint?: string;
  letters: string[]; // нормализованные буквы диска (нижний регистр, ё→е)
  grid: { rows: number; cols: number; cells: Cell[] };
  answers: Answer[];
  /** Legacy alias. Новые паки используют acceptedBonus. */
  bonusPool: string[];
  /** Полный level-local набор допустимых не-grid слов. */
  acceptedBonus?: string[];
  /** Необязательное экономическое подмножество acceptedBonus. */
  rewardedBonus?: string[];
  blockedPool?: BlockedWord[];
  /** Малый, уже валидированный remote overlay; не является частью fingerprint. */
  remoteAllow?: string[];
  remoteDeny?: string[];
  policyRevision?: number | null;
  difficulty: number;
  difficultyTier?: 1 | 2 | 3 | 4 | 5;
  difficultyScore?: number;
  difficultyRole?: DifficultyRole;
  /** Optional gameplay modifier introduced by the campaign director. */
  mechanic?: LevelMechanic;
  /** Reward/navigation beat attached to this level. */
  milestone?: LevelMilestone | null;
  /** Required bonus words for the optional bonus-chest objective. */
  bonusTarget?: number;
  /** Mandatory answer order for ordered levels. */
  answerOrder?: string[];
  /** Reader-facing topic used by world/landmark content. */
  theme?: string;
}

export interface PlayState {
  level: Level;
  filled: Record<string, string>; // "row,col" -> ch
  solvedWords: string[];
  foundBonus: string[];
  coinsEarned: number;
}

export type HintType = 'bulb' | 'hammer' | 'revealWord';
export type CompletionSource = 'submit' | HintType;
export type InvalidReason =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'malformed'
  | 'not_constructible'
  | 'not_in_dictionary';

export type SubmitResult =
  | { kind: 'grid'; word: string; cells: Cell[]; deltaCoins: number; levelComplete: boolean }
  | { kind: 'bonus'; word: string; deltaCoins: number; rewarded: boolean; firstTime: boolean }
  | { kind: 'constraint'; word: string; reason: 'wrong_order'; expectedLength: number }
  | { kind: 'blocked'; word: string; reason: BlockReason }
  | { kind: 'duplicate'; word: string; previousKind: 'grid' | 'bonus' }
  | { kind: 'invalid'; word: string; reason: InvalidReason };

export interface HintResult {
  changed: boolean;
  revealed: Cell[];
  solvedWords: string[];
  levelComplete: boolean;
  source: HintType;
}

export function cellKey(c: { row: number; col: number }): string {
  return `${c.row},${c.col}`;
}

export function initPlayState(level: Level): PlayState {
  return { level, filled: {}, solvedWords: [], foundBonus: [], coinsEarned: 0 };
}
