import { addDays, dayKey, daysBetween, effectiveToday, isDayKey, isNewDay, parseDayKey } from '../index';

describe('fixed UTC+3 product calendar', () => {
  test('rolls over at 00:00 UTC+3 for every device time zone', () => {
    expect(dayKey(new Date('2026-06-25T20:59:59.999Z'))).toBe('2026-06-25');
    expect(dayKey(new Date('2026-06-25T21:00:00.000Z'))).toBe('2026-06-26');
    expect(dayKey(new Date('2026-12-31T21:00:00.000Z'))).toBe('2027-01-01');
  });
  test('date arithmetic is independent of local daylight saving and month boundaries', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(parseDayKey('2026-06-26').toISOString()).toBe('2026-06-26T00:00:00.000Z');
  });
  test('rejects malformed and impossible calendar labels', () => {
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(isDayKey('2026-6-26')).toBe(false);
    expect(() => parseDayKey('2026-02-29')).toThrow(RangeError);
  });
  test('a rollback does not reopen already observed dates', () => {
    expect(isNewDay('2026-06-25', '2026-06-26')).toBe(true);
    expect(isNewDay('2026-06-26', '2026-06-26')).toBe(false);
    expect(effectiveToday('2026-06-26', '2026-06-20')).toBe('2026-06-26');
    expect(effectiveToday('2026-06-26', '2026-06-27')).toBe('2026-06-27');
  });
});
