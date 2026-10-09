/** Product calendar: fixed UTC+03:00, independent of the device time zone and DST. */
export const PRODUCT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD for the instant in the product calendar. */
export function dayKey(instant: Date = new Date()): string {
  return new Date(instant.getTime() + PRODUCT_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export function isDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day;
}

/** UTC midnight of a calendar label; use for date arithmetic, not local midnight. */
export function parseDayKey(key: string): Date {
  if (!isDayKey(key)) throw new RangeError(`Invalid product day: ${key}`);
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Integer product calendar days between two labels (b - a). */
export function daysBetween(a: string, b: string): number {
  return (parseDayKey(b).getTime() - parseDayKey(a).getTime()) / DAY_MS;
}

export function addDays(day: string, count: number): string {
  if (!Number.isInteger(count)) throw new RangeError('Day offset must be an integer');
  return new Date(parseDayKey(day).getTime() + count * DAY_MS).toISOString().slice(0, 10);
}

export function isNewDay(lastDay: string | null, today: string = dayKey()): boolean {
  return lastDay !== today;
}

/** A local clock rollback cannot reopen a day already observed on this profile. */
export function effectiveToday(maxSeenDay: string | null, today: string = dayKey()): string {
  return maxSeenDay && isDayKey(maxSeenDay) && daysBetween(maxSeenDay, today) < 0
    ? maxSeenDay
    : today;
}
