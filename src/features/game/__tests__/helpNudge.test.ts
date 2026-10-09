import { KEYS, storage } from '@/core/storage';

import { claimHelpNudge, dismissHelpNudge, isStalled } from '../helpNudge';

describe('voluntary help accent', () => {
  beforeEach(() => storage.remove(KEYS.helpNudge));

  test('uses the early introduction threshold only for intro puzzles', () => {
    expect(isStalled(17, 0, 'intro')).toBe(false);
    expect(isStalled(18, 0, 'intro')).toBe(true);
    expect(isStalled(18, 2, 'intro')).toBe(true);
    expect(isStalled(25, 3, 'intro')).toBe(true);
    expect(isStalled(25, 3)).toBe(false);
    expect(isStalled(59, 4)).toBe(false);
    expect(isStalled(60, 2)).toBe(false);
    expect(isStalled(60, 3)).toBe(true);
    expect(isStalled(119, 1)).toBe(false);
    expect(isStalled(120, 1)).toBe(true);
    expect(isStalled(Number.NaN, 3, 'intro')).toBe(false);
    expect(isStalled(18, Number.NaN, 'intro')).toBe(false);
    expect(isStalled(-1, 0, 'intro')).toBe(false);
  });

  test('commits one offer per puzzle across sessions and two per analytics session', () => {
    expect(claimHelpNudge('session-a', 'campaign:1')).toBe(true);
    expect(claimHelpNudge('session-a', 'campaign:1')).toBe(false);
    expect(claimHelpNudge('session-a', 'campaign:2')).toBe(true);
    expect(claimHelpNudge('session-a', 'campaign:3')).toBe(false);

    expect(JSON.parse(storage.getString(KEYS.helpNudge) ?? '{}')).toMatchObject({
      sessionId: 'session-a',
      sessionOffers: 2,
      offeredPuzzles: ['campaign:1', 'campaign:2'],
    });
    expect(claimHelpNudge('session-b', 'campaign:1')).toBe(false);
    expect(claimHelpNudge('session-b', 'campaign:3')).toBe(true);
    expect(claimHelpNudge('session-b', 'daily:2026-09-26')).toBe(true);
    expect(claimHelpNudge('session-b', 'campaign:4')).toBe(false);
  });

  test('an explicit dismissal is durable and idempotent', () => {
    expect(claimHelpNudge('session-a', 'campaign:1')).toBe(true);
    expect(dismissHelpNudge('campaign:1')).toBe(true);
    expect(dismissHelpNudge('campaign:1')).toBe(false);
    expect(JSON.parse(storage.getString(KEYS.helpNudge) ?? '{}').dismissedPuzzles)
      .toEqual(['campaign:1']);
    expect(claimHelpNudge('session-b', 'campaign:1')).toBe(false);
  });

  test('does not show an offer that could not be saved', () => {
    const set = jest.spyOn(storage, 'set').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      expect(claimHelpNudge('session-a', 'campaign:1')).toBe(false);
      expect(storage.getString(KEYS.helpNudge)).toBeUndefined();
    } finally {
      set.mockRestore();
    }
    expect(claimHelpNudge('session-a', 'campaign:1')).toBe(true);
  });

  test('a corrupted journal fails closed without erasing its contents', () => {
    storage.set(KEYS.helpNudge, '{broken');
    expect(claimHelpNudge('session-a', 'campaign:1')).toBe(false);
    expect(dismissHelpNudge('campaign:1')).toBe(false);
    expect(storage.getString(KEYS.helpNudge)).toBe('{broken');
  });
});
