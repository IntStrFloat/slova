import { ECONOMY } from '@/core/config/economy';
import { getJSON, KEYS, storage } from '@/core/storage';

import { spinWheel, useWheel, type WheelState } from '../index';

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
      if ('value' in r) st = { ...r.state, pendingSpin: null };
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

  test('незавершённое вращение сохраняет сектор и блокирует повтор даже на следующий день', () => {
    const first = spinWheel(fresh, T, false, 42);
    expect('value' in first).toBe(true);
    if ('value' in first) {
      expect(first.state.pendingSpin).toEqual({
        effectId: `wheel:${T}:free`, sector: first.sector, value: first.value,
      });
      expect(spinWheel(first.state, T, false, 43)).toMatchObject({ error: 'pending_spin' });
      expect(spinWheel(first.state, '2026-06-27', false, 44)).toMatchObject({ error: 'pending_spin' });
    }
  });
});

test('pending wheel result is durable until its grant is acknowledged', () => {
  storage.clearAll();
  useWheel.getState().reset();
  const result = useWheel.getState().spin(false);
  expect(result).not.toBeNull();
  expect(getJSON<WheelState>(KEYS.wheel, fresh).pendingSpin).toEqual(result);
  expect(useWheel.getState().canFree()).toBe(false);
  expect(useWheel.getState().claimPending(result!.effectId)).toBe(true);
  expect(getJSON<WheelState>(KEYS.wheel, fresh).pendingSpin).toBeNull();
  expect(useWheel.getState().claimPending(result!.effectId)).toBe(false);
  useWheel.getState().reset();
});

test('free and earned spins freeze the origin help context independently of later screen state', () => {
  storage.clearAll();
  useWheel.getState().reset();
  const context = { origin_interaction_id: 'help:test:origin', attemptId: 'normal:6:origin', requested_hint: 'letter', displayed_cost: 50, balance: 20 };
  const free = useWheel.getState().spin(false, undefined, context)!;
  context.balance = 999;
  expect(free.flowContext).toMatchObject({ origin_interaction_id: 'help:test:origin', balance: 20 });
  expect(getJSON<WheelState>(KEYS.wheel, fresh).pendingSpin?.flowContext).toEqual(free.flowContext);
  useWheel.getState().claimPending(free.effectId);
  const receipt = useWheel.getState().prepareRewarded(context)!;
  context.balance = 0;
  expect(receipt.flowContext?.balance).toBe(999);
  expect(useWheel.getState().confirmRewarded(receipt)).toBe(true);
  expect(useWheel.getState().pendingSpin?.flowContext).toEqual(receipt.flowContext);
  useWheel.getState().claimPending(receipt.rewardId);
  expect(useWheel.getState().lastGrantedSpin?.flowContext).toEqual(receipt.flowContext);
});
