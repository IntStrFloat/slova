/** Числа экономики (спека 06). Меняются здесь, не в логике. */
export const ECONOMY = {
  hints: { bulb: 50, hammer: 120, revealWord: 300 },
  chest: [50, 120, 300],
  starterCoins: 200,
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
    puzzleStreakBase: 15, // база награды за пазл дня × множитель стрика
    puzzleStreakStep: 5,
  },
  packs: [
    { id: 'coins_small', coins: 500, price: '99 ₽' },
    { id: 'coins_medium', coins: 1500, price: '199 ₽' },
    { id: 'coins_large', coins: 4000, price: '379 ₽' },
  ],
  removeAdsPrice: '299 ₽',
  proWeeklyPrice: '299 ₽/нед',
} as const;
