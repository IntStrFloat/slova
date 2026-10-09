/** A shared calendar event; the final instant belongs to the following day. */
export const MARATHON = {
  id: 'words-marathon-2026-10-26-v1',
  title: 'Марафон слов',
  startDay: '2026-10-26',
  endDay: '2026-11-02',
  startAtMs: Date.parse('2026-10-26T00:00:00.000+03:00'),
  endAtMs: Date.parse('2026-11-02T00:00:00.000+03:00'),
  utcOffsetMinutes: 180,
  thresholds: [1, 3, 6, 9, 13, 17, 21],
  stageCoins: 10,
  finalBonusCoins: 80,
  totalRewardCoins: 150,
} as const;
