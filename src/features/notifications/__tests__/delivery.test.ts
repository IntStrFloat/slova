import { getJSON, removeKey, storage } from '@/core/storage';
import { parsePushMessage } from '../payload';
import { acceptNotificationTap, dispatchNotificationTap, confirmNotificationTap, clearNotificationTaps } from '../delivery';
import { notificationAdmission } from '../budget';

jest.mock('../analytics', () => ({ beginNotificationRoute: jest.fn(), clearRemoteReturn: jest.fn() }));
const now = Date.UTC(2026, 10, 4, 12);
const context = { nowMs: now, versionCode: 33, totalLevels: 1500, currentLevel: 600,
  unlockedRoutes: ['/', '/daily', '/wheel', '/events'] as const };
const parse = (id = 'message-1', data: Record<string, string> = { route: '/daily' }) =>
  parsePushMessage({ messageId: id, data }, context);
beforeEach(() => { clearNotificationTaps(); removeKey('notifications.routes.v2'); });

test('accepts actual SDK data maps, bounded legacy routing and audited deep links', () => {
  expect(parse().route).toBe('/daily');
  expect(parsePushMessage({ messageId: 'legacy', data: { key: 'route', value: '/wheel' } }, context).route).toBe('/wheel');
  expect(parsePushMessage({ notification: { clickActionType: 'DEEP_LINK', clickAction: 'slova://daily' } }, context).route).toBe('/daily');
  expect(parsePushMessage({ data: { route: 'https://foreign.test' } }, context).route).toBe('/');
  expect(parsePushMessage({ data: { route: 'slova://daily?token=private' } }, context).route).toBe('/');
});

test('unavailable content/version, unknown campaigns and locked activities safely fall back', () => {
  expect(parse('a', { route: '/daily', min_version_code: '99' }).reason).toBe('version_unavailable');
  expect(parse('b', { route: '/daily', min_content_levels: '2000' }).reason).toBe('content_unavailable');
  expect(parse('c', { route: '/daily', campaign_id: 'foreign-campaign' }).reason).toBe('campaign_unknown');
  expect(parse('c', { route: '/daily', campaign_id: '79001234567' }).campaignId).toBe('unknown');
  expect(parsePushMessage({ data: { route: '/daily' } }, { ...context, unlockedRoutes: ['/'] }).route).toBe('/');
  expect(parsePushMessage({ data: { campaign_id: 'levels-expanded-1000-v1' } }, { ...context, currentLevel: 1001 }).reason).toBe('content_completed');
  expect(parsePushMessage({ messageId: 'x'.repeat(2000), data: { route: '/daily' } }, context).reason).toBe('invalid_payload');
});

test('ids are stable, payload free and bounded even when a provider omits its id', () => {
  expect(parse('secret-id').id).not.toContain('secret');
  expect(parse('secret-id').id).toBe(parse('secret-id').id);
  expect(parsePushMessage({ data: { route: '/daily' } }, context).id)
    .toBe(parsePushMessage({ data: { route: '/daily' } }, context).id);
});

test('keeps a durable pending tap through router loading and active gameplay, then dispatches once', () => {
  const message = parse(); const navigate = jest.fn();
  expect(acceptNotificationTap(message, 'owner', now)).toBe(true);
  expect(acceptNotificationTap(message, 'owner', now)).toBe(false);
  expect(dispatchNotificationTap({ owner: 'owner', ready: false, active: true, safe: true, nowMs: now }, navigate)).toBe(false);
  expect(dispatchNotificationTap({ owner: 'owner', ready: true, active: true, safe: false, nowMs: now }, navigate)).toBe(false);
  expect(getJSON<{ pending: unknown }>('notifications.routes.v2', { pending: null }).pending).not.toBeNull();
  expect(dispatchNotificationTap({ owner: 'owner', ready: true, active: true, safe: true, nowMs: now }, navigate)).toBe(true);
  expect(navigate).toHaveBeenCalledWith('/daily');
  expect(confirmNotificationTap('/daily', 'owner', now)).toBe(true);
  expect(acceptNotificationTap(message, 'owner', now)).toBe(false);
  expect(navigate).toHaveBeenCalledTimes(1);
});

test('does not attribute visibility until the destination is visible; failure and profile switch are safe', () => {
  acceptNotificationTap(parse(), 'owner', now);
  expect(confirmNotificationTap('/', 'owner', now)).toBe(false);
  expect(dispatchNotificationTap({ owner: 'owner', ready: true, active: true, safe: true, nowMs: now }, () => { throw Error('router'); })).toBe(false);
  expect(getJSON<{ pending: unknown }>('notifications.routes.v2', { pending: null }).pending).not.toBeNull();
  expect(dispatchNotificationTap({ owner: 'other', ready: true, active: true, safe: true, nowMs: now }, jest.fn())).toBe(false);
  expect(getJSON<{ pending: unknown }>('notifications.routes.v2', { pending: null }).pending).toBeNull();
});

test('failed persistence never silently consumes or navigates a tap', () => {
  const write = jest.spyOn(storage, 'set').mockImplementation(() => { throw Error('disk'); });
  expect(acceptNotificationTap(parse(), 'owner', now)).toBe(false);
  write.mockRestore();
});
test('a newer user tap supersedes the older intent without letting a cold callback resurrect it', () => {
  const first = parse('first'), second = parse('second', { route: '/wheel' });
  expect(acceptNotificationTap(first, 'owner', now)).toBe(true);
  expect(acceptNotificationTap(second, 'owner', now)).toBe(true);
  expect(acceptNotificationTap(first, 'owner', now)).toBe(false);
  const navigate = jest.fn();
  dispatchNotificationTap({ owner: 'owner', ready: true, active: true, safe: true, nowMs: now }, navigate);
  expect(navigate).toHaveBeenCalledWith('/wheel');
});
test.each([
  ['completed daily', { ...context, dailySolved: true }, 'content_completed'],
  ['now locked', { ...context, unlockedRoutes: ['/'] as const }, 'activity_locked'],
])('revalidates a queued target at safe exit: %s', (_case, current, reason) => {
  const message = parse('delayed', { route: '/daily', campaign_id: 'daily-reminder-v1' });
  acceptNotificationTap(message, 'owner', now);
  const navigate = jest.fn();
  dispatchNotificationTap({ owner: 'owner', ready: true, active: true, safe: true, nowMs: now, content: current }, navigate);
  expect(navigate).toHaveBeenCalledWith('/');
  const state = getJSON<{ pending: { message: { id: string; reason: string } } }>('notifications.routes.v2', {} as never);
  expect(state.pending.message.id).toBe(message.id); expect(state.pending.message.reason).toBe(reason);
  confirmNotificationTap('/', 'owner', now);
  expect(acceptNotificationTap(message, 'owner', now)).toBe(false);
});

const admission = (at = now, history: { atMs: number; localDay: string; id: string }[] = [], offset = 180) =>
  notificationAdmission({ nowMs: at, enabled: true, permissionGranted: true, history, timezoneOffsetMinutes: offset });
test('shared remote/local policy counts rolling seven days and one local-day collision', () => {
  const history = [1, 2, 3].map((n) => ({ id: `remote_${n}`, atMs: now - n * 86_400_000, localDay: `2026-11-0${4 - n}` }));
  expect(admission(now, history).reason).toBe('weekly_limit');
  expect(admission(now + 7 * 86_400_000, history).allowed).toBe(true);
  expect(admission(now, [{ id: 'remote', atMs: now - 1000, localDay: '2026-11-04' }]).reason).toBe('same_day');
});
test('quiet hours and timezone/clock changes are explicit', () => {
  expect(admission(Date.UTC(2026, 10, 4, 6, 59)).reason).toBe('quiet_hours');
  expect(admission(Date.UTC(2026, 10, 4, 7)).allowed).toBe(true);
  expect(admission(Date.UTC(2026, 10, 4, 17, 59)).allowed).toBe(true);
  expect(admission(Date.UTC(2026, 10, 4, 18)).reason).toBe('quiet_hours');
  expect(admission(now, [], -480).reason).toBe('quiet_hours');
  expect(admission(now, [{ id: 'future', atMs: now + 1000, localDay: '2026-11-04' }]).reason).toBe('clock_backwards');
});
