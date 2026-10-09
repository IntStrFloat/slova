/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { RETENTION } from '@/core/config/retention';

import JourneyEvent from '../journey-event';
import Quests from '../quests';

const mockPush = jest.fn();
let mockWins = 0;
let mockEventActive = false;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: () => {},
}));
jest.mock('@/core/nav', () => ({ useGoBack: () => jest.fn() }));
jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn() }));
jest.mock('@/features/analytics/retentionEvents', () => ({ trackObservedRetentionMilestones: jest.fn() }));
jest.mock('@/core/time', () => ({ dayKey: () => '2026-09-26' }));
jest.mock('@/features/retention', () => ({
  useRetention: () => ({}),
  getFeatureGates: () => {
    const flags = require('@/core/config/retention').RETENTION.featureFlags;
    return { quests: mockWins >= 8 && flags.quests, event: mockWins >= 15 && flags.event, daily: flags.daily };
  },
  getQuestStatus: () => ({ day: '2026-09-26', allCompleted: false, quests: [
    { id: 'q1', kind: 'completions', title: 'Решатель', target: 3, progress: 1, completed: false, rewardCoins: 5 },
    { id: 'q2', kind: 'manualWords', title: 'Собиратель слов', target: 10, progress: 4, completed: false, rewardCoins: 5 },
    { id: 'q3', kind: 'bonusWords', title: 'Исследователь', target: 2, progress: 0, completed: false, rewardCoins: 5 },
  ] }),
  getEventStatus: () => mockEventActive ? ({ active: true, startDay: '2026-09-24', endDay: '2026-10-01', points: 4, tiers: [
    { points: 3, kind: 'coins', amount: 10, claimed: true },
    { points: 8, kind: 'coins', amount: 50, claimed: false },
    { points: 15, kind: 'collectible', collectibleId: 'event-1', claimed: false },
  ] }) : null,
  getCollectibles: () => [{ id: 'event-1', title: 'Чемодан путешественника' }],
}));
jest.mock('@/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    AppButton: ({ label, onPress }: any) => <Pressable accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>,
    AppText: ({ children }: any) => <Text>{children}</Text>,
    GlassPanel: ({ children }: any) => <View>{children}</View>,
    Icon: () => null,
    WorldBackground: () => null,
    colors: { amber: '#eba63d', textMuted: '#fff', glass: '#444', success: '#3fd27e', greenDark: '#155c34', offline: '#555' },
    radius: { pill: 999 },
  };
});

function hasText(tree: ReactTestRenderer, value: string): boolean {
  const flatten = (children: unknown): string => Array.isArray(children)
    ? children.map(flatten).join('')
    : typeof children === 'string' || typeof children === 'number' ? String(children) : '';
  return tree.root.findAll((node) => flatten(node.props.children) === value).length > 0;
}

describe('gated goals screens', () => {
  beforeEach(() => { mockPush.mockClear(); mockWins = 0; mockEventActive = false; });

  it('explains the quest threshold, then shows real progress and automatic rewards', () => {
    let locked!: ReactTestRenderer;
    act(() => { locked = TestRenderer.create(<Quests />); });
    expect(hasText(locked, 'Откроются после 8 уровней')).toBe(true);
    act(() => { locked.unmount(); });

    mockWins = 8;
    let active!: ReactTestRenderer;
    act(() => { active = TestRenderer.create(<Quests />); });
    expect(hasText(active, 'Решатель')).toBe(true);
    expect(hasText(active, 'Прогресс: 1 из 3')).toBe(true);
    expect(hasText(active, 'Награда · 5 монет')).toBe(true);
    act(() => { active.unmount(); });
  });

  it('shows inactive event status honestly and explains active earning rules', () => {
    mockWins = 15;
    let inactive!: ReactTestRenderer;
    act(() => { inactive = TestRenderer.create(<JourneyEvent />); });
    expect(hasText(inactive, 'Сейчас событие не идёт')).toBe(true);
    act(() => { inactive.unmount(); });

    mockEventActive = true;
    let active!: ReactTestRenderer;
    act(() => { active = TestRenderer.create(<JourneyEvent />); });
    expect(hasText(active, 'Чемодан')).toBe(true);
    expect(hasText(active, '4 очка')).toBe(true);
    expect(hasText(active, '3 очка · 10 монет')).toBe(true);
    expect(hasText(active, '8 очков · 50 монет')).toBe(true);
    expect(hasText(active, '15 очков · Чемодан путешественника')).toBe(true);
    act(() => { active.unmount(); });
  });

  it('shows paused-feature copy on direct quest and event routes', () => {
    const flags = RETENTION.featureFlags as { quests: boolean; event: boolean };
    flags.quests = false;
    flags.event = false;
    mockWins = 15;
    try {
      let quests!: ReactTestRenderer;
      let event!: ReactTestRenderer;
      act(() => { quests = TestRenderer.create(<Quests />); });
      act(() => { event = TestRenderer.create(<JourneyEvent />); });
      expect(hasText(quests, 'Задания сейчас недоступны')).toBe(true);
      expect(hasText(event, 'Событие сейчас не проводится')).toBe(true);
      act(() => { quests.unmount(); event.unmount(); });
    } finally {
      flags.quests = true;
      flags.event = true;
    }
  });
});
