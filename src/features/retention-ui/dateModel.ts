const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;

function utcDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function shiftDate(key: string, days: number): string {
  const date = utcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

export function dateRange(startDay: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftDate(startDay, index));
}

export function displayDate(key: string): string {
  const date = utcDate(key);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function displayWeekday(key: string): string {
  return WEEKDAYS[utcDate(key).getUTCDay()];
}

export function dailyDateState(
  key: string,
  today: string,
  solvedDates: readonly string[],
  pendingDates: readonly string[],
): 'solved' | 'started' | 'today' | 'future' | 'past' {
  if (solvedDates.includes(key)) return 'solved';
  if (pendingDates.includes(key)) return 'started';
  if (key === today) return 'today';
  return key > today ? 'future' : 'past';
}
