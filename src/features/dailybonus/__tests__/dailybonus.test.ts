import { ECONOMY } from '@/core/config/economy';
import { getJSON, getString, KEYS, storage } from '@/core/storage';
import { dayKey } from '@/core/time';
import { useCurrency } from '@/features/currency';

import { claimLoginBonus, loadDailyBonus, loginGiftEffectId, useDailyBonus } from '../index';

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

describe('durable optional login gift', () => {
  let caseNumber = 0;

  beforeEach(() => {
    caseNumber += 1;
    jest.useFakeTimers().setSystemTime(new Date(`2026-07-${String(caseNumber).padStart(2, '0')}T21:01:00Z`));
    useDailyBonus.getState().reset();
  });

  afterEach(() => jest.useRealTimers());

  test('credits the wallet once and keeps the seven-day calendar state', () => {
    const date = dayKey();
    const before = useCurrency.getState().coins;
    expect(useDailyBonus.getState().claim()).toMatchObject({ reward: CAL[0], day: 1 });
    expect(useCurrency.getState().coins).toBe(before + CAL[0]);
    expect(useCurrency.getState().hasApplied(loginGiftEffectId(date))).toBe(true);
    expect(useDailyBonus.getState().lastDay).toBe(date);
    expect(useDailyBonus.getState().claim().reward).toBeNull();
    expect(useCurrency.getState().coins).toBe(before + CAL[0]);

    jest.setSystemTime(new Date(`2026-07-${String(caseNumber + 1).padStart(2, '0')}T21:01:00Z`));
    expect(useDailyBonus.getState().claim()).toMatchObject({ reward: CAL[1], day: 2 });
  });

  test('failed intent save leaves both calendar and wallet unchanged, then retries', () => {
    const beforeCoins = useCurrency.getState().coins;
    const originalSet = storage.set.bind(storage);
    const failing = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key === KEYS.dailyBonus) throw new Error('calendar write failed');
      originalSet(key, value);
    });
    try {
      expect(useDailyBonus.getState().claim()).toMatchObject({ reward: null, error: 'save_failed' });
      expect(useDailyBonus.getState()).toMatchObject({ lastDay: null, index: -1, pendingGift: null });
      expect(useCurrency.getState().coins).toBe(beforeCoins);
    } finally { failing.mockRestore(); }
    expect(useDailyBonus.getState().claim().reward).toBe(CAL[0]);
  });

  test('failed wallet save leaves a durable intent that reconciles without a duplicate', () => {
    const date = dayKey();
    const beforeCoins = useCurrency.getState().coins;
    const originalSet = storage.set.bind(storage);
    const failing = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key === KEYS.currency) throw new Error('wallet write failed');
      originalSet(key, value);
    });
    try {
      expect(useDailyBonus.getState().claim()).toMatchObject({ reward: null, error: 'save_failed' });
      expect(useDailyBonus.getState().pendingGift?.dateKey).toBe(date);
      expect(loadDailyBonus().pendingGift?.dateKey).toBe(date);
      expect(useDailyBonus.getState().lastDay).toBeNull();
      expect(useCurrency.getState().coins).toBe(beforeCoins);
    } finally { failing.mockRestore(); }
    expect(useDailyBonus.getState().reconcilePending()).toMatchObject({ reward: CAL[0], day: 1 });
    expect(useCurrency.getState().coins).toBe(beforeCoins + CAL[0]);
    expect(useDailyBonus.getState().pendingGift).toBeNull();
    expect(useDailyBonus.getState().reconcilePending().reward).toBeNull();
    expect(useCurrency.getState().coins).toBe(beforeCoins + CAL[0]);
  });

  test('failed final calendar save retries an already credited gift without extra coins', () => {
    const beforeCoins = useCurrency.getState().coins;
    let calendarWrites = 0;
    const originalSet = storage.set.bind(storage);
    const failing = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key === KEYS.dailyBonus && ++calendarWrites === 2) throw new Error('final calendar write failed');
      originalSet(key, value);
    });
    try {
      expect(useDailyBonus.getState().claim()).toMatchObject({ reward: null, error: 'save_failed' });
      expect(useDailyBonus.getState().pendingGift).not.toBeNull();
      expect(useDailyBonus.getState().lastDay).toBeNull();
      expect(useCurrency.getState().coins).toBe(beforeCoins + CAL[0]);
      expect(getJSON<{ pendingGift: unknown }>(KEYS.dailyBonus, { pendingGift: null }).pendingGift).not.toBeNull();
    } finally { failing.mockRestore(); }
    expect(useDailyBonus.getState().reconcilePending()).toMatchObject({ reward: CAL[0], day: 1 });
    expect(useCurrency.getState().coins).toBe(beforeCoins + CAL[0]);
  });

  test('recovers a corrupt calendar from the previous valid backup', () => {
    const currentRaw = getString(KEYS.dailyBonus);
    const backupRaw = getString(KEYS.dailyBonusBackup);
    try {
      const previous = { version: 2, lastDay: '2026-07-01', index: 0, maxSeenDay: '2026-07-01', pendingGift: null };
      storage.set(KEYS.dailyBonusBackup, JSON.stringify(previous));
      storage.set(KEYS.dailyBonus, '{corrupt');
      expect(loadDailyBonus()).toEqual(previous);
      expect(getJSON(KEYS.dailyBonus, null)).toEqual(previous);
    } finally {
      if (currentRaw === null) storage.remove(KEYS.dailyBonus);
      else storage.set(KEYS.dailyBonus, currentRaw);
      if (backupRaw === null) storage.remove(KEYS.dailyBonusBackup);
      else storage.set(KEYS.dailyBonusBackup, backupRaw);
    }
  });
});
