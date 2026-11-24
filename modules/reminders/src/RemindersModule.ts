import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

export type ReminderPermissionResult = 'granted' | 'denied' | 'dismissed' | 'unavailable';

export interface RemindersNativeModule {
  permissionGranted(): boolean;
  requestPermission(): Promise<ReminderPermissionResult>;
  replaceSchedules(json: string): number;
  cancelDate(day: string): void;
  cancelAll(): void;
  sentHistory(): string;
  reserveRemoteNotification?(json: string): string;
  settleRemoteNotification?(id: string, acceptedOrUnknown: boolean): boolean;
  readTelemetry(): string;
  acknowledgeTelemetry(json: string): void;
  addListener(event: 'onReminderTelemetry', listener: () => void): EventSubscription;
}

export default requireOptionalNativeModule<RemindersNativeModule>('Reminders');
