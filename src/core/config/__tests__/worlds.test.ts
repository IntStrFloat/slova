import { allLandmarks, landmarkForLevel, landmarkUnlockedAt, latestLandmarkAt, totalCampaignLevels, worldForCampaignLevel, WORLDS } from '../worlds';
import { THIRD_ROUTE_STORIES } from '../thirdRouteStories';

describe('campaign worlds config', () => {
  test('covers three routes and 1500 campaign levels', () => {
    expect(WORLDS).toHaveLength(21);
    expect(totalCampaignLevels()).toBe(1500);
    expect(WORLDS[0]?.startsAt).toBe(1);
    expect(WORLDS[6]?.endsAt).toBe(500);
    expect(WORLDS[13]?.endsAt).toBe(1000);
    expect(WORLDS[20]?.endsAt).toBe(1500);
    WORLDS.forEach((world, index) => {
      if (index > 0) expect(world.startsAt).toBe(WORLDS[index - 1].endsAt + 1);
      expect(worldForCampaignLevel(world.startsAt)).toBe(world.id);
      expect(worldForCampaignLevel(world.endsAt)).toBe(world.id);
    });
  });

  test('maps world boundaries to the expected world ids', () => {
    expect(worldForCampaignLevel(1)).toBe('world1');
    expect(worldForCampaignLevel(90)).toBe('world1');
    expect(worldForCampaignLevel(91)).toBe('world2');
    expect(worldForCampaignLevel(170)).toBe('world2');
    expect(worldForCampaignLevel(171)).toBe('world3');
    expect(worldForCampaignLevel(250)).toBe('world3');
    expect(worldForCampaignLevel(251)).toBe('world4');
    expect(worldForCampaignLevel(310)).toBe('world4');
    expect(worldForCampaignLevel(311)).toBe('world5');
    expect(worldForCampaignLevel(370)).toBe('world5');
    expect(worldForCampaignLevel(371)).toBe('world6');
    expect(worldForCampaignLevel(430)).toBe('world6');
    expect(worldForCampaignLevel(431)).toBe('world7');
    expect(worldForCampaignLevel(500)).toBe('world7');
    expect(worldForCampaignLevel(501)).toBe('world8');
    expect(worldForCampaignLevel(1000)).toBe('world14');
    expect(worldForCampaignLevel(1001)).toBe('world15');
    expect(worldForCampaignLevel(1500)).toBe('world21');
    expect(worldForCampaignLevel(1501)).toBe('world21');
  });

  test('keeps landmark progression aligned to the current world', () => {
    expect(landmarkForLevel('world1', 1)?.id).toBe('paris-river-islands');
    expect(landmarkForLevel('world4', 251)?.id).toBe('london-stpauls');
    expect(landmarkForLevel('world4', 265)?.id).toBe('london-bigben');
    expect(landmarkForLevel('world4', 310)?.id).toBe('london-eye');
    expect(landmarkForLevel('world7', 464)?.id).toBe('spb-stisaac');
    expect(landmarkForLevel('world7', 500)?.id).toBe('spb-palacebridge');
    expect(landmarkForLevel('world8', 501)?.id).toBe('paris-river-islands-route2');
    expect(landmarkForLevel('world8', 510)?.id).toBe('eiffel-route2');
    expect(landmarkForLevel('world14', 1000)?.id).toBe('spb-palacebridge-route2');
    expect(landmarkForLevel('world15', 1001)?.id).toBe('paris-river-islands-route3');
    expect(landmarkForLevel('world21', 1500)?.id).toBe('spb-palacebridge-route3');
  });

  test('retains released milestones and has no card gap longer than ten levels', () => {
    const released: [string, number][][] = [
      [['eiffel', 10], ['louvre', 20], ['notredame', 30], ['arc', 90]],
      [['liberty', 110], ['empire', 130], ['centralpark', 150], ['brooklynbridge', 170]],
      [['kremlin', 190], ['redsquare', 210], ['bolshoi', 230], ['vdnh', 250]],
      [['london-bigben', 265], ['london-towerbridge', 280], ['london-britishmuseum', 295], ['london-eye', 310]],
      [['rome-colosseum', 325], ['rome-trevi', 340], ['rome-pantheon', 355], ['rome-stpeters', 370]],
      [['tokyo-shibuya', 385], ['tokyo-sensoji', 400], ['tokyo-tower', 415], ['tokyo-meiji', 430]],
      [['spb-hermitage', 447], ['spb-stisaac', 464], ['spb-peterhof', 482], ['spb-palacebridge', 500]],
    ];
    released.forEach((cards, worldIndex) => cards.forEach(([id, level]) => {
      expect(landmarkUnlockedAt(`world${worldIndex + 1}`, level)?.id).toBe(id);
      expect(landmarkUnlockedAt(`world${worldIndex + 8}`, level + 500)?.id).toBe(`${id}-route2`);
      expect(landmarkUnlockedAt(`world${worldIndex + 15}`, level + 1000)?.id).toBe(`${id}-route3`);
    }));
    WORLDS.forEach((world) => {
      let previous = world.startsAt - 1;
      world.landmarks.forEach((landmark) => {
        expect(landmark.untilLevel - previous).toBeGreaterThan(0);
        expect(landmark.untilLevel - previous).toBeLessThanOrEqual(10);
        previous = landmark.untilLevel;
      });
      expect(previous).toBe(world.endsAt);
    });
  });

  test('changes the background only after the corresponding card was earned', () => {
    expect(latestLandmarkAt('world1', 0)).toBeNull();
    expect(latestLandmarkAt('world1', 4)).toBeNull();
    expect(latestLandmarkAt('world1', 5)?.id).toBe('paris-river-islands');
    expect(latestLandmarkAt('world1', 9)?.id).toBe('paris-river-islands');
    expect(latestLandmarkAt('world1', 10)?.id).toBe('eiffel');
    expect(latestLandmarkAt('world1', 40)?.id).toBe('paris-montmartre');
    expect(latestLandmarkAt('world2', 90)).toBeNull();
    expect(latestLandmarkAt('world8', 505)?.id).toBe('paris-river-islands-route2');
    expect(latestLandmarkAt('world15', 1004)).toBeNull();
    expect(latestLandmarkAt('world15', 1005)?.id).toBe('paris-river-islands-route3');
  });

  test('reuses city art while keeping second-route collection rewards unique', () => {
    const landmarks = allLandmarks();
    expect(new Set(landmarks.map((landmark) => landmark.id)).size).toBe(landmarks.length);
    for (let index = 0; index < 7; index += 1) {
      const original = WORLDS[index];
      const continuation = WORLDS[index + 7];
      expect(continuation.image).toBe(original.image);
      expect(continuation.startsAt).toBe(original.startsAt + 500);
      continuation.landmarks.forEach((landmark, landmarkIndex) => {
        expect(landmark.image).toBe(original.landmarks[landmarkIndex].image);
        expect(landmark.untilLevel).toBe(original.landmarks[landmarkIndex].untilLevel + 500);
      });
    }
  });

  test('gives every third-route card a new story with matching art and cadence', () => {
    const originalCards = WORLDS.slice(0, 7).flatMap((world) => world.landmarks);
    expect(Object.keys(THIRD_ROUTE_STORIES).sort()).toEqual(originalCards.map((card) => card.id).sort());
    expect(new Set(Object.values(THIRD_ROUTE_STORIES)).size).toBe(58);
    for (let index = 0; index < 7; index += 1) {
      const original = WORLDS[index];
      const stories = WORLDS[index + 14];
      expect(stories.title).toBe(`${original.title} · Истории`);
      expect(stories.image).toBe(original.image);
      expect(stories.startsAt).toBe(original.startsAt + 1000);
      expect(stories.endsAt).toBe(original.endsAt + 1000);
      stories.landmarks.forEach((card, cardIndex) => {
        const previous = original.landmarks[cardIndex];
        expect(card.id).toBe(`${previous.id}-route3`);
        expect(card.image).toBe(previous.image);
        expect(card.untilLevel).toBe(previous.untilLevel + 1000);
        expect(card.fact.length).toBeGreaterThan(40);
        expect(card.fact).not.toBe(previous.fact);
      });
    }
  });
});
