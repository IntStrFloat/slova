import { allLandmarks, landmarkUnlockedAt } from '@/core/config/worlds';

describe('worlds/landmarks', () => {
  test('открытие по последнему уровню диапазона', () => {
    expect(landmarkUnlockedAt('world1', 10)?.id).toBe('eiffel');
    expect(landmarkUnlockedAt('world1', 40)?.id).toBe('arc');
  });
  test('на промежуточном уровне ничего не открывается', () => {
    expect(landmarkUnlockedAt('world1', 5)).toBeNull();
    expect(landmarkUnlockedAt('world1', 11)).toBeNull();
  });
  test('all landmarks', () => {
    expect(allLandmarks().length).toBe(4);
    expect(allLandmarks().every((l) => l.world === 'world1')).toBe(true);
  });
});
