/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { KEYS, storage } from '@/core/storage';
import { readIntroGuidance, setIntroGuidanceEnabled } from '@/features/onboarding';

import Settings from '../settings';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' } } }));
jest.mock('@/core/nav', () => ({ useGoBack: () => jest.fn() }));
jest.mock('@/core/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/features/analytics', () => ({
  useAnalyticsPrefs: (selector: (value: unknown) => unknown) => selector({ optOut: false, setOptOut: jest.fn() }),
}));
jest.mock('@/features/audio', () => ({ isAudioAvailable: () => false }));
jest.mock('@/features/monetization', () => ({
  getIap: () => ({ restore: async () => [] }),
  MONETIZATION: { iapEnabled: false },
  useEntitlements: (selector: (value: unknown) => unknown) => selector({ setRemoveAds: jest.fn() }),
}));
jest.mock('@/features/notifications', () => ({
  cancelDailyReminders: jest.fn(), getPush: jest.fn(), isDailyReminderAvailable: () => false,
  requestDailyReminderPermission: jest.fn(), syncDailyReminders: jest.fn(),
}));
jest.mock('@/features/settings', () => ({
  useSettings: () => ({ haptics: true, sound: true, music: true, notifications: false, set: jest.fn() }),
}));
jest.mock('@/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    AppButton: ({ label, onPress }: any) => (
      <Pressable accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
    AppText: ({ children }: any) => <Text>{children}</Text>,
    GlassPanel: ({ children }: any) => <View>{children}</View>,
    Icon: () => null,
    WorldBackground: () => null,
    colors: { amber: '#EBA63D', glass: '#333', green: '#1E7A46', glassBorder: '#555', text: '#FFF', textMuted: '#FFF' },
    radius: { pill: 999 },
  };
});

test('settings re-enables the lesson and opens safe practice', () => {
  storage.clearAll();
  setIntroGuidanceEnabled(false);
  storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: 8, completed: [1, 2, 3, 4, 5, 6, 7] }));
  storage.set(KEYS.currency, JSON.stringify({ coins: 77 }));
  const progressBefore = storage.getString(KEYS.levelsProgress);
  const currencyBefore = storage.getString(KEYS.currency);
  mockPush.mockClear();
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<Settings />); });
  act(() => { tree.root.findByProps({ accessibilityLabel: 'Показать обучение снова' }).props.onPress(); });
  expect(readIntroGuidance().guidanceEnabled).toBe(true);
  expect(mockPush).toHaveBeenCalledWith('/tutorial-practice');
  expect(storage.getString(KEYS.levelsProgress)).toBe(progressBefore);
  expect(storage.getString(KEYS.currency)).toBe(currencyBefore);
  act(() => tree.unmount());
});
