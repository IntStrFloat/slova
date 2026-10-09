/** Единый баланс экономики для кампании, daily и retention-наград. */
export const ECONOMY = {
  hints: { bulb: 50, clue: 30, hammer: 120, revealWord: 300 },
  chest: [50, 120, 300],
  starterCoins: 60,
  starterHintCoins: 100,
  legacyTicketCoins: 50,
  bonusBankCoins: 50,
  bonusWordCoins: 1,
  bonusBankThreshold: 10,
  dailyPuzzleCoins: 10,
  // Награда за просмотр rewarded-рекламы «за монеты» (спека 05/06).
  rewardedCoins: 60,
  wheel: {
    freeSpinsPerDay: 1,
    maxRewardedSpins: 5,
    // сектора колеса: монеты (или 'gems' с числом)
    sectors: [10, 25, 50, 5, 100, 20, 200, 15] as const,
  },
  daily: {
    // награда логин-календаря по дню (день 1..7), далее цикл
    loginCalendar: [10, 15, 20, 25, 30, 40, 75],
    // Retention v1 grants a fixed daily reward; the streak is presentation only.
    puzzleStreakBase: 10,
    puzzleStreakStep: 0,
  },
  packs: [
    { id: 'coins_small', coins: 500, price: '99 ₽' },
    { id: 'coins_medium', coins: 1500, price: '199 ₽' },
    { id: 'coins_large', coins: 4000, price: '379 ₽' },
  ],
  removeAdsPrice: '299 ₽',
  proWeeklyPrice: '299 ₽/нед',
} as const;
