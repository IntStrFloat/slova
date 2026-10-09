declare module 'react-native-rustore-push' {
  export interface RemoteMessage {
    data?: { key: string; value: string };
    notification?: {
      clickAction?: string;
      clickActionType?: string;
    };
  }

  export const PushEvents: {
    ON_OPENED: 'ON_OPENED';
  };

  export interface RustorePushModule {
    createPushEmitter(): void;
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
