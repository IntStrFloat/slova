import { validateLevel } from '@/core/engine';

import { loadGlobalLevel, totalLevelCount, worldForGlobalLevel, worldLevelCount } from '../loader';

describe('levels loader', () => {
  test('counts all generated worlds', () => {
    expect(worldLevelCount('world1')).toBe(90);
    expect(worldLevelCount('world2')).toBe(80);
    expect(worldLevelCount('world3')).toBe(80);
    expect(totalLevelCount()).toBe(250);
  });

  test('loads global linear levels with real world ids', () => {
    expect(loadGlobalLevel(1)?.world).toBe('world1');
    expect(loadGlobalLevel(90)?.world).toBe('world1');
    expect(loadGlobalLevel(91)?.world).toBe('world2');
    expect(loadGlobalLevel(170)?.world).toBe('world2');
    expect(loadGlobalLevel(171)?.world).toBe('world3');
    expect(loadGlobalLevel(250)?.world).toBe('world3');
    expect(loadGlobalLevel(251)).toBeNull();
  });

  test('first level is a simple tutorial without same-root forms', () => {
    const level = loadGlobalLevel(1);
    expect(level?.letters).toEqual(['с', 'о', 'н']);
    expect(level?.answers.map((a) => a.word)).toEqual(['сон', 'нос']);
    expect(level?.bonusPool).toEqual([]);
    expect(level && validateLevel(level).ok).toBe(true);
  });

  test('maps global progress to current world', () => {
    expect(worldForGlobalLevel(1)).toBe('world1');
    expect(worldForGlobalLevel(91)).toBe('world2');
    expect(worldForGlobalLevel(171)).toBe('world3');
  });
});
