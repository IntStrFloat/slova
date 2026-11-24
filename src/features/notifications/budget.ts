export const NOTIFICATION_BUDGET = { maxPerWeek: 3, weekMs: 7 * 86_400_000, reservationTtlMs: 120_000 } as const;
export interface NotificationBudgetEntry { id: string; atMs: number; localDay: string }
export function notificationAdmission(input: { nowMs: number; enabled: boolean; permissionGranted: boolean;
  history: readonly NotificationBudgetEntry[]; timezoneOffsetMinutes: number }): { allowed: boolean; reason: string } {
  const deny = (reason: string) => ({ allowed: false, reason });
  if (!input.enabled) return deny('disabled');
  if (!input.permissionGranted) return deny('permission');
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.timezoneOffsetMinutes)
    || Math.abs(input.timezoneOffsetMinutes) > 14 * 60) return deny('invalid_time');
  const local = new Date(input.nowMs + input.timezoneOffsetMinutes * 60_000), hour = local.getUTCHours();
  if (hour < 10 || hour >= 21) return deny('quiet_hours');
  if (input.history.some((entry) => entry.atMs > input.nowMs)) return deny('clock_backwards');
  const history = input.history.filter((entry) => Number.isFinite(entry.atMs) && entry.atMs >= 0
    && input.nowMs - entry.atMs < NOTIFICATION_BUDGET.weekMs);
  if (history.some((entry) => entry.localDay === local.toISOString().slice(0, 10))) return deny('same_day');
  if (history.length >= NOTIFICATION_BUDGET.maxPerWeek) return deny('weekly_limit');
  return { allowed: true, reason: 'accepted' };
}
