import { KEYS, storage } from '@/core/storage';

import { createGameplayAdSession } from '../gameplaySession';
import { loadAdsMeta, saveAdsMeta } from '../index';
import { recordCampaignLevelComplete, recordVisibleGameplay } from '../frequency';

describe('one protected gameplay visit per installation', () => {
  beforeEach(() => storage.clearAll());

  test('protects only the first actual visit, independently of elapsed time and analytics', () => {
    const first = createGameplayAdSession('first-runtime', false);
    expect(first().isFirstGameplaySession).toBe(true);
    storage.set('analytics.session.v1', JSON.stringify({ sessionCount: 999 }));
    expect(first().isFirstGameplaySession).toBe(true);
    expect(createGameplayAdSession('second-runtime', false)().isFirstGameplaySession).toBe(false);
    expect(createGameplayAdSession('month-later-runtime', false)().isFirstGameplaySession).toBe(false);
  });

  test('does not consume the first visit just by creating the session owner', () => {
    createGameplayAdSession('menu-only-runtime', false);
    expect(createGameplayAdSession('first-board-runtime', false)().isFirstGameplaySession).toBe(true);
  });

  test('does not grant another protected visit to an existing player after upgrade', () => {
    expect(createGameplayAdSession('upgrade-runtime', true)().isFirstGameplaySession).toBe(false);
    expect(createGameplayAdSession('next-runtime', false)().isFirstGameplaySession).toBe(false);
  });

  test('migrates existing completed and unfinished gameplay without using analytics', () => {
    storage.set(KEYS.levelsProgress, JSON.stringify({ completed: [1, 2, 3] }));
    expect(createGameplayAdSession('completed-player')().isFirstGameplaySession).toBe(false);
    storage.clearAll();
    storage.set(KEYS.gameCurrentNormal, JSON.stringify({ attemptId: 'unfinished-level-1' }));
    expect(createGameplayAdSession('unfinished-player')().isFirstGameplaySession).toBe(false);
  });

  test('background and repeated checks preserve counters; cold launch starts a new interval', () => {
    const visit = createGameplayAdSession('runtime-a', true);
    visit();
    let meta = recordVisibleGameplay(loadAdsMeta(), 301.5);
    meta = recordCampaignLevelComplete(meta, 6);
    saveAdsMeta({ ...meta, interstitialShownAt: [1234], rewardedCooldownActive: true });
    for (let resume = 0; resume < 3; resume++) expect(visit().isFirstGameplaySession).toBe(false);
    expect(loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(301.5);
    expect(loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(1);
    createGameplayAdSession('runtime-b', true)();
    expect(loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(0);
    expect(loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(0);
    expect(loadAdsMeta().interstitialShownAt).toEqual([1234]);
    expect(loadAdsMeta().rewardedCooldownActive).toBe(true);
  });

  test('save failure keeps gameplay available and retries conservatively', () => {
    const visit = createGameplayAdSession('runtime', false);
    const save = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(visit().isFirstGameplaySession).toBe(true);
    save.mockRestore();
    expect(visit().isFirstGameplaySession).toBe(true);
    expect(storage.getString(KEYS.adsMeta)).toBeDefined();
  });
});
