import type { PushTapPayload } from './types';

export type NotificationRoute = '/' | '/daily' | '/wheel' | '/events';

const HOME: NotificationRoute = '/';
const ALLOWED_ROUTES = new Set<NotificationRoute>(['/daily', '/wheel', '/events']);

/** Never pass remote notification data directly to Expo Router. */
export function resolvePushRoute(payload: PushTapPayload | undefined): NotificationRoute {
  const route = payload?.route;
  return typeof route === 'string' && ALLOWED_ROUTES.has(route as NotificationRoute)
    ? (route as NotificationRoute)
    : HOME;
}

/** Compatibility helper for callers that already have only a route value. */
export function safeNotificationRoute(route: unknown): NotificationRoute {
  return resolvePushRoute(typeof route === 'string' ? { route } : {});
}
