import { dailyDateState, dateRange, displayDate, displayWeekday, shiftDate } from '../dateModel';

describe('daily calendar labels and states', () => {
  it('keeps a personal seven-day period intact across month and year boundaries', () => {
    expect(dateRange('2026-12-29', 7)).toEqual([
      '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01',
      '2027-01-02', '2027-01-03', '2027-01-04',
    ]);
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31');
    expect(displayDate('2027-01-01')).toBe('1 янв');
    expect(displayWeekday('2027-01-01')).toBe('пт');
  });

  it('distinguishes actual daily solves from week activity and pending puzzles', () => {
    const solved = ['2026-09-23'];
    expect(dailyDateState('2026-09-23', '2026-09-26', solved, ['2026-09-24'])).toBe('solved');
    expect(dailyDateState('2026-09-24', '2026-09-26', solved, ['2026-09-24', '2026-09-26'])).toBe('started');
    expect(dailyDateState('2026-09-26', '2026-09-26', solved, ['2026-09-24', '2026-09-26'])).toBe('started');
    expect(dailyDateState('2026-09-26', '2026-09-26', solved, [])).toBe('today');
    expect(dailyDateState('2026-09-27', '2026-09-26', solved, [])).toBe('future');
    expect(dailyDateState('2026-09-25', '2026-09-26', solved, [])).toBe('past');
  });
});
