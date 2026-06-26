import { dayKey, daysBetween, effectiveToday, isNewDay } from '../index';

describe('time', () => {
  test('dayKey формат', () => {
    expect(dayKey(new Date(2026, 5, 26))).toBe('2026-06-26');
  });
  test('daysBetween', () => {
    expect(daysBetween('2026-06-25', '2026-06-26')).toBe(1);
    expect(daysBetween('2026-06-26', '2026-06-26')).toBe(0);
    expect(daysBetween('2026-06-26', '2026-06-23')).toBe(-3);
  });
  test('isNewDay', () => {
    expect(isNewDay('2026-06-25', '2026-06-26')).toBe(true);
    expect(isNewDay('2026-06-26', '2026-06-26')).toBe(false);
  });
  test('effectiveToday защищает от отката времени', () => {
    expect(effectiveToday('2026-06-26', '2026-06-20')).toBe('2026-06-26');
    expect(effectiveToday('2026-06-26', '2026-06-27')).toBe('2026-06-27');
  });
});
