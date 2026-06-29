import { allLandmarks, landmarkUnlockedAt } from '@/core/config/worlds';

describe('worlds/landmarks', () => {
  test('открытие по последнему уровню диапазона', () => {
    expect(landmarkUnlockedAt('world1', 10)?.id).toBe('eiffel');
    expect(landmarkUnlockedAt('world1', 90)?.id).toBe('arc');
    expect(landmarkUnlockedAt('world2', 110)?.id).toBe('liberty');
    expect(landmarkUnlockedAt('world3', 250)?.id).toBe('vdnh');
  });
  test('на промежуточном уровне ничего не открывается', () => {
    expect(landmarkUnlockedAt('world1', 5)).toBeNull();
    expect(landmarkUnlockedAt('world1', 11)).toBeNull();
  });
  test('all landmarks', () => {
    expect(allLandmarks().length).toBe(12);
    expect(new Set(allLandmarks().map((l) => l.world))).toEqual(new Set(['world1', 'world2', 'world3']));
  });
});
