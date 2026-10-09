import { validateLevel } from '@/core/engine';
import { WORLDS } from '@/core/config/worlds';

import { loadGlobalLevel, totalLevelCount, worldForGlobalLevel, worldLevelCount } from '../loader';

describe('levels loader', () => {
  test('counts all generated worlds', () => {
    expect(worldLevelCount('world1')).toBe(90);
    expect(worldLevelCount('world2')).toBe(80);
    expect(worldLevelCount('world3')).toBe(80);
    expect(worldLevelCount('world4')).toBe(60);
    expect(worldLevelCount('world5')).toBe(60);
    expect(worldLevelCount('world6')).toBe(60);
    expect(worldLevelCount('world7')).toBe(70);
    for (const world of WORLDS) {
      expect(worldLevelCount(world.id)).toBe(world.endsAt - world.startsAt + 1);
    }
    expect(totalLevelCount()).toBe(1000);
  });

  test('loads global linear levels with real world ids', () => {
    expect(loadGlobalLevel(1)?.world).toBe('world1');
    expect(loadGlobalLevel(90)?.world).toBe('world1');
    expect(loadGlobalLevel(91)?.world).toBe('world2');
    expect(loadGlobalLevel(170)?.world).toBe('world2');
    expect(loadGlobalLevel(171)?.world).toBe('world3');
    expect(loadGlobalLevel(250)?.world).toBe('world3');
    expect(loadGlobalLevel(251)?.world).toBe('world4');
    expect(loadGlobalLevel(310)?.world).toBe('world4');
    expect(loadGlobalLevel(311)?.world).toBe('world5');
    expect(loadGlobalLevel(370)?.world).toBe('world5');
    expect(loadGlobalLevel(371)?.world).toBe('world6');
    expect(loadGlobalLevel(430)?.world).toBe('world6');
    expect(loadGlobalLevel(431)?.world).toBe('world7');
    expect(loadGlobalLevel(500)?.world).toBe('world7');
    expect(loadGlobalLevel(501)?.world).toBe('world8');
    expect(loadGlobalLevel(1000)?.world).toBe('world14');
    expect(loadGlobalLevel(1001)).toBeNull();
    for (const world of WORLDS) {
      expect(loadGlobalLevel(world.startsAt)).toMatchObject({ world: world.id, id: 1, globalId: world.startsAt });
      expect(loadGlobalLevel(world.endsAt)).toMatchObject({ world: world.id, globalId: world.endsAt });
      expect(worldForGlobalLevel(world.startsAt)).toBe(world.id);
      expect(worldForGlobalLevel(world.endsAt)).toBe(world.id);
    }
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
    expect(worldForGlobalLevel(251)).toBe('world4');
    expect(worldForGlobalLevel(311)).toBe('world5');
    expect(worldForGlobalLevel(371)).toBe('world6');
    expect(worldForGlobalLevel(431)).toBe('world7');
  });

  test('hydrates campaign metadata for finale and special levels', () => {
    expect(loadGlobalLevel(90)?.milestone).toBe('world_finale');
    expect(loadGlobalLevel(250)?.milestone).toBe('world_finale');
    expect(loadGlobalLevel(500)?.milestone).toBe('journey_finale');
    expect(loadGlobalLevel(590)?.milestone).toBe('world_finale');
    expect(loadGlobalLevel(1000)?.milestone).toBe('journey_finale');

    const chestLevel = loadGlobalLevel(100);
    expect(chestLevel?.mechanic).toBe('bonus_chest');
    expect(chestLevel?.milestone).toBe('chest');
    expect(chestLevel?.bonusTarget).toBeGreaterThan(0);

    const orderedLevel = loadGlobalLevel(145);
    expect(orderedLevel?.mechanic).toBe('ordered');
    expect(orderedLevel?.answerOrder).toEqual(orderedLevel?.answers.map((answer) => answer.word));

    expect(loadGlobalLevel(210)?.mechanic).toBe('mastery');
    expect(loadGlobalLevel(710)?.mechanic).toBe('mastery');
    expect(loadGlobalLevel(575)?.mechanic).toBe('ordered');
    expect(loadGlobalLevel(510)?.mechanic).toBe('bonus_chest');
  });

  test('new puzzles stay compact and never grow past eight wheel letters', () => {
    const signatures = new Set<string>();
    for (let id = 1; id <= totalLevelCount(); id += 1) {
      const level = loadGlobalLevel(id)!;
      const signature = `${[...level.letters].sort().join('')}:${level.answers.map((answer) => answer.word).sort().join(',')}`;
      expect(signatures.has(signature)).toBe(false);
      signatures.add(signature);
      expect(level.letters.length).toBeLessThanOrEqual(8);
      if (id > 500) {
        expect(level.grid.rows).toBeLessThanOrEqual(9);
        expect(level.grid.cols).toBeLessThanOrEqual(10);
        expect(level.answers.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  test('production packs do not include no-yo words that look broken', () => {
    const blocked = new Set(['\u043e\u0442\u0435\u043b']);
    let softSignLevels = 0;

    for (let id = 1; id <= totalLevelCount(); id += 1) {
      const level = loadGlobalLevel(id);
      expect(level).not.toBeNull();
      if (!level) continue;
      expect(validateLevel(level).ok).toBe(true);

      const words = [...level.answers.map((a) => a.word), ...level.bonusPool];
      for (const word of words) expect(blocked.has(word)).toBe(false);

      const hasSoftSign = [
        ...level.letters,
        ...words,
        ...level.grid.cells.map((c) => c.ch),
      ].some((value) => value.includes('\u044c'));
      if (hasSoftSign) softSignLevels += 1;
    }

    expect(softSignLevels).toBeGreaterThan(0);
  });
});
