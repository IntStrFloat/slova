export type PushPermissionResult = 'granted' | 'denied' | 'unavailable';

export interface PushTapPayload {
  route?: string;
  [key: string]: unknown;
}

export interface PushProvider {
  /** Starts the SDK event emitter. It must never open a system permission dialog. */
  init(): Promise<void>;
  /** Requests Android's notification permission after an explicit user action. */
  requestPermission(): Promise<PushPermissionResult>;
  /** Removes the RuStore device token when a player disables notifications. */
  unregister(): Promise<void>;
  /** Updates this release's topic audience without opening a permission dialog. */
  syncLevelExpansionAudience(currentLevel: number, notifications: boolean): Promise<void>;
  /** Subscribes to notification taps and returns an unsubscribe callback. */
  onNotificationTap(handler: (route: string) => void): () => void;
}
