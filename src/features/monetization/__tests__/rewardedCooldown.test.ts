import { storage } from '@/core/storage';

import { loadAdsMeta, saveAdsMeta } from '../index';
import * as adsStorage from '../index';
import { recordCampaignLevelComplete, recordVisibleGameplay } from '../frequency';
import { requestRewarded } from '../rewarded';
import type { RewardedResult } from '../types';

const mockShowRewarded = jest.fn<Promise<RewardedResult>, unknown[]>();
jest.mock('../providers', () => ({ getAds: () => ({ showRewarded: mockShowRewarded }) }));
jest.mock('@/features/analytics', () => ({ track: () => {} }));

describe('rewarded delays the next interstitial across placements', () => {
  beforeEach(() => {
    storage.clearAll();
    mockShowRewarded.mockReset();
    let meta = recordVisibleGameplay(loadAdsMeta(), 300);
    for (const level of [6, 7, 8]) meta = recordCampaignLevelComplete(meta, level);
    saveAdsMeta(meta);
  });

  test.each(['hint', 'wheel'] as const)('%s resets cooldown but preserves interstitial progress', async (placement) => {
    mockShowRewarded.mockResolvedValue('rewarded');
    await requestRewarded(placement);
    expect(loadAdsMeta().rewardedCooldownActive).toBe(true);
    expect(loadAdsMeta().visibleGameplaySinceFullscreenSec).toBe(0);
    expect(loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(300);
    expect(loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(3);
  });

  test('early dismissal still delays automatic ads', async () => {
    mockShowRewarded.mockResolvedValue('dismissed');
    await requestRewarded('wheel');
    expect(loadAdsMeta().rewardedCooldownActive).toBe(true);
  });

  test('no-fill does not impose a cooldown', async () => {
    mockShowRewarded.mockResolvedValue('unavailable');
    await requestRewarded('hint');
    expect(loadAdsMeta().rewardedCooldownActive).toBe(false);
    expect(loadAdsMeta().visibleGameplaySinceFullscreenSec).toBe(300);
  });

  test('an optional cooldown save failure cannot hide an earned wheel reward', async () => {
    mockShowRewarded.mockResolvedValue('rewarded');
    const save = jest.spyOn(adsStorage, 'saveAdsMeta').mockImplementationOnce(() => { throw new Error('write failed'); });
    try {
      await expect(requestRewarded('wheel')).resolves.toBe('rewarded');
    } finally {
      save.mockRestore();
    }
  });
});
