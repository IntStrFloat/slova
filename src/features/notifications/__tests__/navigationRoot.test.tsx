import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { getFullscreenSnapshot, releaseFullscreen, tryAcquireFullscreen } from '@/core/fullscreen';
import { acceptNotificationTap, clearNotificationTaps } from '../delivery';
import { parsePushMessage } from '../payload';
import { PushNavigationRoot } from '../PushNavigationRoot';
let mockPath = '/game'; let mockReady = false; let mockDailySolved = false;
const mockNavigate = jest.fn(); const mockRouter = { navigate: mockNavigate };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => mockPath,
  useRootNavigationState: () => mockReady ? { key: 'root-mounted' } : undefined }));
jest.mock('@/features/settings', () => ({ useSettings: (selector: (v: unknown) => unknown) => selector({ notifications: true }) }));
jest.mock('@/features/profile', () => ({ useProfile: (selector: (v: unknown) => unknown) => selector({ profile: { userId: 'owner' } }) }));
jest.mock('@/features/game/store', () => ({ useGame: { getState: () => ({ completion: { status: 'playing' } }) } }));
jest.mock('@/features/monetization/subscription', () => ({ useSubscription: { getState: () => ({ busy: false }) } }));
jest.mock('@/features/monetization/providers', () => ({ getAds: () => ({ getRewardedState: () => 'ready' }) }));
jest.mock('../context', () => ({ notificationOwner: () => 'owner', pushContentContext: () => ({
  nowMs: Date.now(), versionCode: 33, totalLevels: 1500, currentLevel: 600, unlockedRoutes: ['/', '/daily', '/wheel', '/events'],
  dailySolved: mockDailySolved,
}) }));
jest.mock('../analytics', () => ({ beginNotificationRoute: jest.fn(), clearRemoteReturn: jest.fn(), confirmNotificationRoute: jest.fn() }));
jest.mock('../provider', () => ({ getPush: () => ({ init: async () => {}, onNotificationTap: () => () => {} }) }));
const message = () => parsePushMessage({ messageId: 'queued-root-tap', data: { route: '/daily' } },
  { nowMs: Date.now(), versionCode: 33, totalLevels: 1500, currentLevel: 600, unlockedRoutes: ['/daily'] });
beforeEach(() => {
  clearNotificationTaps(); mockPath = '/game'; mockReady = false; mockDailySolved = false; mockNavigate.mockClear();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });
test('actual root wiring waits for Stack readiness and safe game exit, then consumes visible content once', async () => {
  acceptNotificationTap(message(), 'owner');
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PushNavigationRoot />); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockReady = true; await act(async () => { tree.update(<PushNavigationRoot />); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockPath = '/'; await act(async () => { tree.update(<PushNavigationRoot />); });
  expect(mockNavigate).toHaveBeenCalledTimes(1); expect(mockNavigate).toHaveBeenCalledWith('/daily');
  mockPath = '/daily'; await act(async () => { tree.update(<PushNavigationRoot />); });
  await act(async () => { tree.unmount(); tree = renderer.create(<PushNavigationRoot />); });
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
test('a shared fullscreen lease defers the existing queued route until release', async () => {
  mockPath = '/'; mockReady = true;
  const lease = tryAcquireFullscreen('review')!;
  acceptNotificationTap(message(), 'owner');
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PushNavigationRoot />); });
  expect(getFullscreenSnapshot().owner).toBe('review'); expect(mockNavigate).not.toHaveBeenCalled();
  await act(async () => { releaseFullscreen(lease); });
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  await act(async () => { tree.unmount(); });
});
test('a daily completed while the tap waits in the game is revalidated to Home on actual exit', async () => {
  const daily = parsePushMessage({ messageId: 'queued-daily', data: { route: '/daily', campaign_id: 'daily-reminder-v1' } },
    { nowMs: Date.now(), versionCode: 33, totalLevels: 1500, currentLevel: 600, unlockedRoutes: ['/daily'] });
  acceptNotificationTap(daily, 'owner'); mockReady = true;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PushNavigationRoot />); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockDailySolved = true; mockPath = '/'; await act(async () => { tree.update(<PushNavigationRoot />); });
  expect(mockNavigate).toHaveBeenCalledWith('/');
  await act(async () => tree.unmount());
});
