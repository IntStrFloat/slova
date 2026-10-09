import { NoopPushProvider } from './noop';

/** Jest and non-native fallback; Metro picks rustorePush.native.ts for Android. */
export const RuStorePushProvider = NoopPushProvider;
