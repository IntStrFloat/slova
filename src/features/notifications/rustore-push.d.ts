declare module 'react-native-rustore-push' {
  export interface RemoteMessage {
    messageId?: string;
    data?: Record<string, string>;
    receivedAtMs?: number;
    openedAtMs?: number;
    ownerScope?: string;
    notification?: {
      clickAction?: string;
      clickActionType?: string;
    };
  }

  export const PushEvents: {
    ON_MESSAGE_RECEIVED: 'ON_MESSAGE_RECEIVED';
    ON_OPENED: 'ON_OPENED';
    ON_NEW_TOKEN: 'ON_NEW_TOKEN';
  };

  export interface RustorePushModule {
    createPushEmitter(): void;
    deletePushEmitter?(): void;
    offNativeErrorHandling?(): void;
    setNotificationContext?(enabled: boolean, owner: string): void;
    acknowledgeNotificationOpen?(id: string): void;
    getNativeVersionCode?(): number;
    getToken(): Promise<string>;
    deleteToken(): Promise<boolean>;
    subscribeToTopic(topic: string): Promise<boolean>;
    unsubscribeFromTopic(topic: string): Promise<boolean>;
    checkPushAvailability(): Promise<boolean>;
    getInitialNotification(): Promise<RemoteMessage | null>;
  }

  export const eventEmitter: {
    addListener(event: string, listener: (message: RemoteMessage) => void): { remove(): void };
  };

  const RustorePushClient: RustorePushModule;
  export default RustorePushClient;
}
