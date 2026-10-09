import { getJSON, KEYS, removeKey } from '@/core/storage';

import {
  getPushSoftAskOutcome,
  markPushSoftAskHandled,
  recordFirstVictoryForPush,
  shouldShowPushSoftAsk,
} from '../softAsk';

describe('push soft-ask', () => {
  beforeEach(() => removeKey(KEYS.pushPrompt));

  it('does not ask before five campaign wins or the first daily introduction', () => {
    expect(shouldShowPushSoftAsk([])).toBe(false);
    expect(shouldShowPushSoftAsk({ completedLevels: 4 })).toBe(false);
    expect(shouldShowPushSoftAsk({ completedLevels: 5 })).toBe(true);
    expect(shouldShowPushSoftAsk({ dailyIntroduced: true })).toBe(true);
  });

  it('does not use the first campaign victory as the notification value moment', () => {
    recordFirstVictoryForPush(new Date('2026-07-20T12:00:00.000Z'));
    recordFirstVictoryForPush(new Date('2026-07-20T13:00:00.000Z'));
    expect(shouldShowPushSoftAsk([])).toBe(false);
    expect(getJSON<{ firstVictoryAt: string | null }>(KEYS.pushPrompt, { firstVictoryAt: null }).firstVictoryAt)
      .toBe('2026-07-20T12:00:00.000Z');
  });

  it('offers once and stores decline separately from dismissal', () => {
    const days = ['2026-07-20', '2026-07-21'];
    expect(shouldShowPushSoftAsk(days)).toBe(true);
    markPushSoftAskHandled('declined');
    expect(shouldShowPushSoftAsk(days)).toBe(false);
    expect(getPushSoftAskOutcome()).toBe('declined');
    removeKey(KEYS.pushPrompt);
    markPushSoftAskHandled('dismissed');
    expect(getPushSoftAskOutcome()).toBe('dismissed');
  });
});
