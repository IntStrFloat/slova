import { NativeModules, Platform } from 'react-native';
import { getJSON, KEYS } from '@/core/storage';
import { totalCampaignLevels } from '@/core/config/worlds';
import { getRetentionUnlocks } from '@/core/config/runtimePolicy';
import { RETENTION } from '@/core/config/retention';
import { useLevels } from '@/features/levels/store';
import { selectDailyContent, useDailyPuzzle } from '@/features/dailypuzzle';
import { dayKey } from '@/core/time';
import { notificationHash, type PushContentContext } from './payload';
import type { NotificationRoute } from './routing';

export function notificationOwner(): string {
  return notificationHash(getJSON<{ userId?: string } | null>(KEYS.profile, null)?.userId ?? 'guest');
}
function nativeVersionCode(): number {
  if (Platform.OS !== 'android') return 0;
  try {
    const value: unknown = NativeModules.RustorePush?.getNativeVersionCode?.();
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647 ? value : 0;
  } catch { return 0; }
}
export function pushContentContext(nowMs = Date.now()): PushContentContext {
  const levels = useLevels.getState(), unlocks = getRetentionUnlocks();
  const routes: NotificationRoute[] = ['/', '/wheel'];
  if (RETENTION.featureFlags.daily && levels.completed.length >= unlocks.daily) routes.push('/daily');
  if (RETENTION.featureFlags.event && levels.completed.length >= unlocks.event) routes.push('/events');
  return { nowMs, versionCode: nativeVersionCode(), totalLevels: totalCampaignLevels(),
    currentLevel: levels.currentLevel, unlockedRoutes: routes,
    productDate: dayKey(new Date(nowMs)),
    dailySolved: useDailyPuzzle.getState().solvedDates.includes(dayKey(new Date(nowMs))),
    hasDailyContent: selectDailyContent(dayKey(new Date(nowMs)), 'starter') !== null };
}
