/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { KEYS, storage } from '@/core/storage';

import { PracticeLesson } from '../PracticeLesson';

let mockDiskProps: any;

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
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
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
});

test('real input cancels the delayed decorative demonstration', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<PracticeLesson onDone={jest.fn()} />); });
  act(() => mockDiskProps.onUserInteraction());
  act(() => jest.advanceTimersByTime(500));
  expect(mockDiskProps.demoRequestId).toBe(0);
  act(() => tree.unmount());
});
