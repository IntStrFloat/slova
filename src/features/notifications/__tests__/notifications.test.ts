import { getPush, isPushAvailable, resolvePushRoute } from '@/features/notifications';

import { NoopPushProvider } from '../noop';

describe('push provider and routing', () => {
  it('uses the harmless provider without a configured RuStore project', () => {
    expect(isPushAvailable()).toBe(false);
    expect(getPush()).toBe(NoopPushProvider);
  });

  it('keeps every push tap on audited in-app routes', () => {
    expect(resolvePushRoute({ route: '/daily' })).toBe('/daily');
    expect(resolvePushRoute({ route: '/wheel' })).toBe('/wheel');
    expect(resolvePushRoute({ route: '/events' })).toBe('/events');
    expect(resolvePushRoute({ route: '/settings' })).toBe('/');
    expect(resolvePushRoute({ route: 'https://example.test' })).toBe('/');
    expect(resolvePushRoute(undefined)).toBe('/');
  });

  it('keeps the unavailable provider side-effect-free', async () => {
    await expect(NoopPushProvider.init()).resolves.toBeUndefined();
    await expect(NoopPushProvider.requestPermission()).resolves.toBe('unavailable');
    await expect(NoopPushProvider.unregister()).resolves.toBeUndefined();
    expect(() => NoopPushProvider.onNotificationTap(() => {})()).not.toThrow();
  });
});
