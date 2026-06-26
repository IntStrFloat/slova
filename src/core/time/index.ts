/** Локальный ключ дня YYYY-MM-DD и дельта дней (спека 08). */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Целых дней между двумя ключами (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = parseDayKey(b).getTime() - parseDayKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function isNewDay(lastDay: string | null, today: string = dayKey()): boolean {
  return lastDay !== today;
}

/** Защита от отката времени: возвращает «сегодня», но не раньше maxSeenDay. */
export function effectiveToday(maxSeenDay: string | null, today: string = dayKey()): string {
  if (maxSeenDay && daysBetween(maxSeenDay, today) < 0) return maxSeenDay;
  return today;
}
