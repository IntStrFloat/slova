import { Platform } from 'react-native';

import { PUSH } from './config';
import { NoopPushProvider } from './noop';
import { RuStorePushProvider } from './rustorePush';
import type { PushProvider } from './types';

export function isPushAvailable(): boolean {
  return Platform.OS === 'android' && PUSH.enabled && PUSH.projectId !== '';
}

export function getPush(): PushProvider {
  return isPushAvailable() ? RuStorePushProvider : NoopPushProvider;
}
