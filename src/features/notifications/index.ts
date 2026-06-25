/**
 * Push-уведомления (спека 12). v1: Noop-провайдер. Реальный RuStore Push
 * (react-native-rustore-push + plugins/withRuStorePush.js) включается отдельной
 * задачей M6 — по аналогии с blockblast (maven RuStore + meta-data project_id).
 */
export type NotificationRoute = string;

export interface PushProvider {
  init(): Promise<void>;
  onNotificationTap(handler: (route: NotificationRoute) => void): () => void;
}

const NoopPushProvider: PushProvider = {
  async init() {},
  onNotificationTap() {
    return () => {};
  },
};

export function getPush(): PushProvider {
  return NoopPushProvider;
}
