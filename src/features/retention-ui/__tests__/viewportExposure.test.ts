import { isExposed } from '../viewportExposure';

describe('viewport impressions', () => {
  it('rejects unmeasured and below-viewport cards', () => {
    expect(isExposed({ y: 80, height: 100 }, 0, 0)).toBe(false);
    expect(isExposed({ y: 600, height: 80 }, 0, 500)).toBe(false);
    expect(isExposed({ y: 0, height: 0 }, 0, 500)).toBe(false);
  });
  it('requires half of compact and tall cards', () => {
    expect(isExposed({ y: 80, height: 100 }, 0, 129)).toBe(false);
    expect(isExposed({ y: 80, height: 100 }, 0, 130)).toBe(true);
    expect(isExposed({ y: 600, height: 500 }, 550, 130)).toBe(false);
    expect(isExposed({ y: 600, height: 500 }, 550, 300)).toBe(true);
    expect(isExposed({ y: 600, height: 80 }, 641, 300)).toBe(false);
  });
});
