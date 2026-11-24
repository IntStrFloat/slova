/* eslint-disable @typescript-eslint/no-require-imports */
import { allLandmarks, landmarkUnlockedAt, WORLDS } from '@/core/config/worlds';

import { routeCardProgress } from '../routeProgress';

describe('worlds/landmarks', () => {
  test('retains every originally released postcard and its threshold on both routes', () => {
    const released: [string, number][][] = [
      [['eiffel', 10], ['louvre', 20], ['notredame', 30], ['arc', 90]],
      [['liberty', 110], ['empire', 130], ['centralpark', 150], ['brooklynbridge', 170]],
      [['kremlin', 190], ['redsquare', 210], ['bolshoi', 230], ['vdnh', 250]],
      [['london-bigben', 265], ['london-towerbridge', 280], ['london-britishmuseum', 295], ['london-eye', 310]],
      [['rome-colosseum', 325], ['rome-trevi', 340], ['rome-pantheon', 355], ['rome-stpeters', 370]],
      [['tokyo-shibuya', 385], ['tokyo-sensoji', 400], ['tokyo-tower', 415], ['tokyo-meiji', 430]],
      [['spb-hermitage', 447], ['spb-stisaac', 464], ['spb-peterhof', 482], ['spb-palacebridge', 500]],
    ];
    released.forEach((cards, index) => {
      cards.forEach(([id, threshold]) => {
        expect(landmarkUnlockedAt(`world${index + 1}`, threshold)?.id).toBe(id);
        expect(landmarkUnlockedAt(`world${index + 8}`, threshold + 500)?.id).toBe(`${id}-route2`);
        expect(landmarkUnlockedAt(`world${index + 15}`, threshold + 1000)?.id).toBe(`${id}-route3`);
      });
    });
  });

  test('preserves released cards and unlocks new route cards every few levels', () => {
    expect(landmarkUnlockedAt('world1', 5)?.id).toBe('paris-river-islands');
    expect(landmarkUnlockedAt('world1', 10)?.id).toBe('eiffel');
    expect(landmarkUnlockedAt('world1', 90)?.id).toBe('arc');
    expect(landmarkUnlockedAt('world2', 110)?.id).toBe('liberty');
    expect(landmarkUnlockedAt('world3', 250)?.id).toBe('vdnh');
    expect(landmarkUnlockedAt('world4', 265)?.id).toBe('london-bigben');
    expect(landmarkUnlockedAt('world5', 370)?.id).toBe('rome-stpeters');
    expect(landmarkUnlockedAt('world6', 430)?.id).toBe('tokyo-meiji');
    expect(landmarkUnlockedAt('world7', 500)?.id).toBe('spb-palacebridge');
    expect(landmarkUnlockedAt('world8', 505)?.id).toBe('paris-river-islands-route2');
    expect(landmarkUnlockedAt('world8', 510)?.id).toBe('eiffel-route2');
    expect(landmarkUnlockedAt('world14', 1000)?.id).toBe('spb-palacebridge-route2');
    expect(landmarkUnlockedAt('world15', 1005)?.id).toBe('paris-river-islands-route3');
    expect(landmarkUnlockedAt('world21', 1500)?.id).toBe('spb-palacebridge-route3');
    expect(landmarkUnlockedAt('world1', 11)).toBeNull();
    expect(landmarkUnlockedAt('world4', 266)).toBeNull();
  });

  test('keeps all 21 world ranges, with no card gap exceeding ten levels', () => {
    expect(WORLDS).toHaveLength(21);
    expect(WORLDS[0]).toMatchObject({ startsAt: 1, endsAt: 90 });
    expect(WORLDS[6]).toMatchObject({ startsAt: 431, endsAt: 500 });
    expect(WORLDS[13]).toMatchObject({ startsAt: 931, endsAt: 1000 });
    expect(WORLDS[14]).toMatchObject({ startsAt: 1001, endsAt: 1090 });
    expect(WORLDS[20]).toMatchObject({ startsAt: 1431, endsAt: 1500 });
    for (const world of WORLDS) {
      let previous = world.startsAt - 1;
      for (const landmark of world.landmarks) {
        expect(landmark.untilLevel).toBeGreaterThan(previous);
        expect(landmark.untilLevel - previous).toBeLessThanOrEqual(10);
        previous = landmark.untilLevel;
      }
      expect(previous).toBe(world.endsAt);
    }
    const cards = allLandmarks();
    expect(cards).toHaveLength(174);
    expect(new Set(cards.map((card) => card.id)).size).toBe(174);
    expect(new Set(cards.map((card) => card.world))).toEqual(
      new Set(Array.from({ length: 21 }, (_, index) => `world${index + 1}`)),
    );
  });

  test('pure card countdown crosses card, world, and route boundaries', () => {
    expect(routeCardProgress(0)).toMatchObject({ nextCardId: 'paris-river-islands', targetLevel: 5, remaining: 5, fraction: 0 });
    expect(routeCardProgress(5)).toMatchObject({ nextCardId: 'eiffel', targetLevel: 10, remaining: 5, fraction: 0 });
    expect(routeCardProgress(9)).toMatchObject({ nextCardId: 'eiffel', targetLevel: 10, remaining: 1, fraction: 0.8 });
    expect(routeCardProgress(10)).toMatchObject({ nextCardId: 'louvre', targetLevel: 20, remaining: 10 });
    expect(routeCardProgress(90)).toMatchObject({ nextCardId: 'newyork-battery', nextWorldId: 'world2', targetLevel: 100, remaining: 10 });
    expect(routeCardProgress(500)).toMatchObject({ nextCardId: 'paris-river-islands-route2', targetLevel: 505, remaining: 5 });
    expect(routeCardProgress(1000)).toMatchObject({ nextCardId: 'paris-river-islands-route3', nextWorldId: 'world15', targetLevel: 1005, remaining: 5 });
    expect(routeCardProgress(1499)).toMatchObject({ nextCardId: 'spb-palacebridge-route3', targetLevel: 1500, remaining: 1 });
    expect(routeCardProgress(1500)).toBeNull();
  });

  test('backfills passed card milestones once without granting currency', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { backfillUnlockedLandmarks, useCollection } = require('../store');
      const beforeCoins = useCurrency.getState().coins;

      expect(backfillUnlockedLandmarks([5, 10, 40, 90, 100, 500, 505])).toEqual([
        'paris-river-islands', 'eiffel', 'paris-montmartre', 'arc',
        'newyork-battery', 'spb-palacebridge', 'paris-river-islands-route2',
      ]);
      expect(backfillUnlockedLandmarks([5, 10, 40, 90, 100, 500, 505])).toEqual([]);
      expect(useCollection.getState().opened).toHaveLength(7);
      expect(useCurrency.getState().coins).toBe(beforeCoins);
    });
  });

  test('backfill preserves an Eiffel postcard saved by the earlier intro', () => {
    jest.isolateModules(() => {
      const { KEYS, storage } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.collection, JSON.stringify({ opened: ['eiffel'], selectedCoverId: null }));
      const { backfillUnlockedLandmarks, useCollection } = require('../store');

      expect(backfillUnlockedLandmarks([5])).toEqual(['paris-river-islands']);
      expect(useCollection.getState().opened).toEqual(['eiffel', 'paris-river-islands']);
    });
  });
});
