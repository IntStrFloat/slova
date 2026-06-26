import { ECONOMY } from '@/core/config/economy';

import { spinWheel, type WheelState } from '../index';

const T = '2026-06-26';
const fresh: WheelState = { day: null, freeUsed: false, rewardedUsed: 0 };

describe('spinWheel', () => {
  test('бесплатный спин доступен раз в день', () => {
    const r1 = spinWheel(fresh, T, false, 1);
    expect('value' in r1).toBe(true);
    if ('state' in r1 && 'value' in r1) {
      const r2 = spinWheel(r1.state, T, false, 2);
      expect('error' in r2).toBe(true);
    }
  });
  test('rewarded спины до лимита', () => {
    let st: WheelState = { day: T, freeUsed: true, rewardedUsed: 0 };
    for (let i = 0; i < ECONOMY.wheel.maxRewardedSpins; i++) {
      const r = spinWheel(st, T, true, i + 10);
      expect('value' in r).toBe(true);
      if ('state' in r) st = r.state;
    }
    const over = spinWheel(st, T, true, 99);
    expect('error' in over).toBe(true);
  });
  test('новый день сбрасывает счётчики', () => {
    const used: WheelState = { day: '2026-06-25', freeUsed: true, rewardedUsed: 5 };
    const r = spinWheel(used, T, false, 7);
    expect('value' in r).toBe(true);
  });
  test('значение из таблицы секторов', () => {
    const r = spinWheel(fresh, T, false, 42);
    if ('value' in r) expect(ECONOMY.wheel.sectors).toContain(r.value as never);
  });
});
