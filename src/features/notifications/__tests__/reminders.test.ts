import { dayKey } from '@/core/time';

import { planDailyReminders } from '../reminders';
import type { ReminderPlanInput } from '../reminders';

function input(overrides: Partial<ReminderPlanInput> = {}): ReminderPlanInput {
  return {
    now: new Date(2026, 8, 26, 11, 0),
    enabled: true,
    permissionGranted: true,
    solvedDates: ['2026-09-20', '2026-09-21'],
    sentHistory: [],
    hasVerifiedContent: () => true,
    ...overrides,
  };
}

describe('voluntary daily reminder policy', () => {
  test('does not require daily victories, but requires permission and enabled consent gate', () => {
    expect(planDailyReminders(input({ solvedDates: [] }))).toHaveLength(3);
    expect(planDailyReminders(input({ enabled: false }))).toEqual([]);
    expect(planDailyReminders(input({ permissionGranted: false }))).toEqual([]);
  });

  test('new opt-ins start tomorrow and day two; a solved target day is skipped', () => {
    const plan = planDailyReminders(input({ solvedDates: [], firstLocalDateKey: '2026-09-27' }));
    expect(plan.map((entry) => new Date(entry.fireAtMs).getDate())).toEqual([27, 28, 29]);
    const solved = dayKey(new Date(2026, 8, 27, 18, 0));
    expect(planDailyReminders(input({ solvedDates: [solved], firstLocalDateKey: '2026-09-27' })))
      .not.toContainEqual(expect.objectContaining({ dateKey: solved }));
  });

  test('plans only verified unsolved product dates at device-local 18:00', () => {
    const base = input();
    const dateAtSix = dayKey(new Date(2026, 8, 26, 18, 0));
    const planned = planDailyReminders(input({
      solvedDates: [...base.solvedDates, dateAtSix],
      hasVerifiedContent: (date) => date !== dayKey(new Date(2026, 8, 27, 18, 0)),
    }));
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.length).toBeLessThanOrEqual(3);
    expect(planned.every((entry) => new Date(entry.fireAtMs).getHours() === 18)).toBe(true);
    expect(planned.every((entry) => entry.dateKey === dayKey(new Date(entry.fireAtMs)))).toBe(true);
    expect(planned.some((entry) => entry.dateKey === dateAtSix)).toBe(false);
    expect(planned.some((entry) => entry.dateKey === dayKey(new Date(2026, 8, 27, 18, 0)))).toBe(false);
    expect(planDailyReminders(input({ hasVerifiedContent: () => false }))).toEqual([]);
  });

  test('does not schedule a date twice or exceed three in a rolling seven days', () => {
    const date = dayKey(new Date(2026, 8, 26, 18, 0));
    const now = new Date(2026, 8, 26, 11, 0);
    const recent = [1, 2, 3].map((n) => ({
      dateKey: `2026-09-2${n}`,
      sentAtMs: now.getTime() - n * 24 * 60 * 60 * 1000,
    }));
    expect(planDailyReminders(input({ now, sentHistory: recent })))
      .not.toContainEqual(expect.objectContaining({ dateKey: date }));
    expect(planDailyReminders(input({
      sentHistory: [{ dateKey: date, sentAtMs: now.getTime() - 60_000 }],
    }))).not.toContainEqual(expect.objectContaining({ dateKey: date }));
    const old = [{ dateKey: '2026-09-01', sentAtMs: now.getTime() - 8 * 24 * 60 * 60 * 1000 }];
    expect(planDailyReminders(input({ sentHistory: old }))).toHaveLength(3);
  });

  test('does not schedule a same-day reminder once the local 18:00 time passed', () => {
    const now = new Date(2026, 8, 26, 20, 0);
    const today = dayKey(new Date(2026, 8, 26, 18, 0));
    expect(planDailyReminders(input({ now }))).not.toContainEqual(expect.objectContaining({ dateKey: today }));
  });
});
