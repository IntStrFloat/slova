import { isDayKey } from '@/core/time';
import { trackOnce } from '@/features/analytics';

/** Recovery can happen on a later day; attribute the durable grant to its saved gift date. */
export function trackLoginGiftGrant(result: { reward: number | null; day: number; occurredAtMs?: number }, date: string | null, screen: 'home' | 'daily', source: string): void {
  if (!result.reward || !date || !isDayKey(date)) return;
  const effectId = `login_gift:${date}`;
  const timing = { timeKnown: Number.isFinite(result.occurredAtMs), recovery: source === 'focus_recovery',
    ...(Number.isFinite(result.occurredAtMs) ? { occurredAtMs: result.occurredAtMs } : {}) };
  trackOnce('daily_bonus_claimed', effectId, {
    ...timing, day: result.day, reward: result.reward, dateKey: date, actionDay: date, screen, source,
  });
  trackOnce('coins_earned', effectId, { ...timing, reason: 'daily_bonus', amount: result.reward, dateKey: date, actionDay: date });
}
