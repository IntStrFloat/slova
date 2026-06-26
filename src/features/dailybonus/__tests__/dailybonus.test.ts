import { ECONOMY } from '@/core/config/economy';

import { claimLoginBonus } from '../index';

const CAL = ECONOMY.daily.loginCalendar;

describe('claimLoginBonus', () => {
  test('первый клейм — день 1', () => {
    const r = claimLoginBonus({ lastDay: null, index: -1 }, '2026-06-26');
    expect(r.reward).toBe(CAL[0]);
    expect(r.day).toBe(1);
  });
  test('повтор в тот же день — null', () => {
    const r = claimLoginBonus({ lastDay: '2026-06-26', index: 0 }, '2026-06-26');
    expect(r.reward).toBeNull();
  });
  test('следующий подряд день — день 2', () => {
    const r = claimLoginBonus({ lastDay: '2026-06-25', index: 0 }, '2026-06-26');
    expect(r.reward).toBe(CAL[1]);
    expect(r.day).toBe(2);
  });
  test('пропуск дня — сброс на день 1', () => {
    const r = claimLoginBonus({ lastDay: '2026-06-23', index: 4 }, '2026-06-26');
    expect(r.reward).toBe(CAL[0]);
    expect(r.day).toBe(1);
  });
});
