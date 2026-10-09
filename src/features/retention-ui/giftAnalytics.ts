import { isDayKey } from '@/core/time';
import { trackOnce } from '@/features/analytics';

/** Recovery can happen on a later day; attribute the durable grant to its saved gift date. */
export function trackLoginGiftGrant(result: { reward: number | null; day: number }, date: string | null, screen: 'home' | 'daily', source: string): void {
  if (!result.reward || !date || !isDayKey(date)) return;
  const effectId = `login_gift:${date}`;
  trackOnce('daily_bonus_claimed', effectId, {
    day: result.day, reward: result.reward, dateKey: date, actionDay: date, screen, source,
  });
  trackOnce('coins_earned', effectId, { reason: 'daily_bonus', amount: result.reward, dateKey: date, actionDay: date });
}
