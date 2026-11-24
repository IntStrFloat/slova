/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import { KEYS, storage } from '@/core/storage';
import { getAnalyticsConsentEpoch, isAnalyticsCollectionEnabled, trackOnce } from '@/features/analytics';

import { PracticeLesson } from '../PracticeLesson';

let mockDiskProps: any;

jest.mock('@/features/analytics', () => ({
  trackOnce: jest.fn(), isAnalyticsCollectionEnabled: jest.fn(() => true),
  getAnalyticsConsentEpoch: jest.fn(() => null),
}));

jest.mock('@/features/game/LetterDisk', () => {
  const { View } = require('react-native');
  return {
    LetterDisk: (props: any) => {
      mockDiskProps = props;
      return <View testID="practice-letter-disk" />;
    },
  };
});

jest.mock('@/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    AppButton: ({ label, onPress }: any) => (
      <Pressable accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
    AppText: ({ children }: any) => <Text>{children}</Text>,
    GlassPanel: ({ children }: any) => <View>{children}</View>,
    WorldBackground: () => null,
    colors: { amber: '#EBA63D', textMuted: '#FFFFFF' },
  };
});

beforeEach(() => {
  storage.clearAll();
  mockDiskProps = null;
  jest.mocked(trackOnce).mockClear();
  jest.mocked(isAnalyticsCollectionEnabled).mockReturnValue(true);
  jest.mocked(getAnalyticsConsentEpoch).mockReturnValue(null);
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('practice accepts either word locally and never writes campaign progress', () => {
  const onDone = jest.fn();
  storage.set(KEYS.levelsProgress, JSON.stringify({ currentLevel: 8, completed: [1, 2, 3, 4, 5, 6, 7] }));
  storage.set(KEYS.currency, JSON.stringify({ coins: 77 }));
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PracticeLesson onDone={onDone} />); });
  const valuesBefore = Object.fromEntries(storage.getAllKeys().map((key) => [key, storage.getString(key)]));
  expect(mockDiskProps.demoWord).toBe('кот');
  expect(mockDiskProps.demoRequestId).toBe(0);
  act(() => { expect(mockDiskProps.onWord('кот')).toBe('grid'); });
  expect(mockDiskProps.demoWord).toBe('ток');
  act(() => { expect(mockDiskProps.onWord('кот')).toBe('duplicate'); });
  act(() => { expect(mockDiskProps.onWord('ток')).toBe('grid'); });
  act(() => { expect(mockDiskProps.onWord('кто')).toBe('invalid'); });
  expect(Object.fromEntries(storage.getAllKeys().map((key) => [key, storage.getString(key)]))).toEqual(valuesBefore);
  act(() => { tree.root.findByProps({ accessibilityLabel: 'Показать жест' }).props.onPress(); });
  expect(mockDiskProps.demoRequestId).toBe(1);
  expect(Object.fromEntries(storage.getAllKeys().map((key) => [key, storage.getString(key)]))).toEqual(valuesBefore);
  act(() => { tree.root.findByProps({ accessibilityLabel: 'Готово' }).props.onPress(); });
  expect(onDone).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
  const stages = jest.mocked(trackOnce).mock.calls.map(([, , properties]) => properties?.stage);
  expect(stages).toEqual(['start', 'step', 'step', 'completed', 'step']);
  expect(stages.filter((stage) => stage === 'completed')).toHaveLength(1);
  expect(stages).not.toContain('exit');
});

test('real input cancels the delayed decorative demonstration', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PracticeLesson onDone={jest.fn()} />); });
  act(() => mockDiskProps.onUserInteraction());
  act(() => jest.advanceTimersByTime(500));
  expect(mockDiskProps.demoRequestId).toBe(0);
  act(() => tree.unmount());
});

test('leaving an unfinished practice records exit once and excludes background time', () => {
  let listener!: (state: string) => void;
  const { AppState } = require('react-native');
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event: unknown, callback: unknown) => {
    listener = callback as (state: string) => void;
    return { remove: jest.fn() };
  });
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PracticeLesson onDone={jest.fn()} />); });
  act(() => { mockDiskProps.onUserInteraction(); jest.advanceTimersByTime(1000); listener('background'); });
  act(() => { jest.advanceTimersByTime(30000); listener('active'); jest.advanceTimersByTime(500); });
  act(() => tree.root.findByProps({ accessibilityLabel: 'Готово' }).props.onPress());
  act(() => tree.unmount());
  const exits = jest.mocked(trackOnce).mock.calls.filter(([, , properties]) => properties?.stage === 'exit');
  expect(exits).toHaveLength(1);
  expect(exits[0][2]).toMatchObject({ activeTimeMs: 1500, assistance: false });
  subscription.mockRestore();
});

test('a later opt-in does not report practice time accumulated during opt-out', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PracticeLesson onDone={jest.fn()} />); });
  const firstId = jest.mocked(trackOnce).mock.calls[0][2]?.practice_id;
  act(() => { mockDiskProps.onUserInteraction(); jest.advanceTimersByTime(1000); });
  jest.mocked(isAnalyticsCollectionEnabled).mockReturnValue(false);
  act(() => mockDiskProps.onWord('кот'));
  expect(trackOnce).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(30000));
  jest.mocked(getAnalyticsConsentEpoch).mockReturnValue(Date.now());
  jest.mocked(isAnalyticsCollectionEnabled).mockReturnValue(true);
  act(() => mockDiskProps.onWord('ток'));
  const completed = jest.mocked(trackOnce).mock.calls.find(([, , props]) => props?.stage === 'completed')?.[2];
  expect(completed?.practice_id).not.toBe(firstId);
  expect(completed?.activeTimeMs).toBe(0);
  act(() => tree.unmount());
});
