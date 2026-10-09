/** Игровые числа движка (спека 03). Меняются здесь, не в логике. */
export const GAME = {
  diskLetters: { min: 3, max: 7 },
  // Stable puzzle/word entitlements are granted by the retention ledger.
  coinsPerGridWord: 0,
  coinsPerBonusWord: 0,
  maxBonusCoinsPerLevel: 0,
  levelClearBonus: 0,
} as const;
