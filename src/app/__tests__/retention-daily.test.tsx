/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import { RETENTION } from '@/core/config/retention';

import Daily from '../daily';

const mockPush = jest.fn();
const mockRouteReplace = jest.fn();
let mockFocusCallback: (() => void | (() => void)) | null = null;
let mockFocusCleanup: (() => void) | null = null;
const mockWalletAdd = jest.fn();
const mockBonusClaim = jest.fn(() => ({ reward: 10, day: 1 }));
let mockBonusClaimable = false;
const mockStart = jest.fn((date: string) => ({ dateKey: date }));
const mockReplace = jest.fn((date: string) => ({ kept: { dateKey: date }, discardedDates: ['2026-09-24'] }));
const mockMarkAsk = jest.fn();
const mockPermission = jest.fn(async () => 'granted');
const mockSync = jest.fn(async () => ({ scheduled: 2, reason: 'scheduled' }));
const mockSettingsSet = jest.fn();
let mockReminderAvailable = false;
let mockSoftAskEligible = false;
let mockNextPostcardAt: number | null = 3;
let mockDailyEnabled = true;
let mockSolvedDates: string[] = [];
let mockTodayInstance: unknown = null;
let mockPending: { dateKey: string } | null = { dateKey: '2026-09-25' };
let mockCarried: { dateKey: string }[] = [{ dateKey: '2026-09-25' }];
let mockSource = 'home_card';
let mockAttribution: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockRouteReplace }),
  useLocalSearchParams: () => ({ source: mockSource }),
  useFocusEffect: (callback: () => void | (() => void)) => { mockFocusCallback = callback; },
}));
jest.mock('@/core/nav', () => ({ useGoBack: () => jest.fn() }));
jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn() }));
jest.mock('@/features/analytics/retentionEvents', () => ({ trackObservedRetentionMilestones: jest.fn() }));
jest.mock('@/features/currency', () => ({ useCurrency: (selector: any) => selector({ coins: 42, add: mockWalletAdd }) }));
jest.mock('@/features/dailybonus', () => {
  const useDailyBonus: any = (selector: any) => selector({ canClaim: () => mockBonusClaimable, claim: mockBonusClaim, pendingGift: null });
  useDailyBonus.getState = () => ({ reconcilePending: () => ({ reward: null, day: 1 }), lastDay: '2026-09-26' });
  return { useDailyBonus };
});
jest.mock('@/features/dailypuzzle', () => {
  const current = () => ({
    effectiveDay: () => '2026-09-26',
    refreshDay: () => '2026-09-26',
    instances: { ...Object.fromEntries(mockCarried.map((instance) => [instance.dateKey, instance])), ...(mockTodayInstance ? { '2026-09-26': mockTodayInstance } : {}) },
    solvedDates: mockSolvedDates,
    carryCandidates: () => mockCarried,
    pendingOlder: () => mockPending,
    replaceCarriedDaily: mockReplace,
    tomeProgress: () => ({ volume: 1, inVolume: 2, total: 2, nextThreshold: 3 }),
    getOrStartDaily: mockStart,
  });
  const useDailyPuzzle: any = () => current();
  useDailyPuzzle.getState = current;
  return { useDailyPuzzle };
});
jest.mock('@/features/notifications', () => ({
  getReminderGameplayAttribution: () => mockAttribution,
  isDailyReminderAvailable: () => mockReminderAvailable,
  shouldShowPushSoftAsk: () => mockSoftAskEligible,
  markPushSoftAskHandled: (...args: unknown[]) => mockMarkAsk(...args),
  requestDailyReminderPermission: () => mockPermission(),
  syncDailyReminders: () => mockSync(),
  PushSoftAsk: ({ visible, onAllow, onDecline, onDismiss }: any) => {
    if (!visible) return null;
    const { Pressable, Text, View } = require('react-native');
    return <View>
      <Pressable accessibilityLabel="Разрешить" onPress={onAllow}><Text>Разрешить</Text></Pressable>
      <Pressable accessibilityLabel="Не нужно" onPress={onDecline}><Text>Не нужно</Text></Pressable>
      <Pressable accessibilityLabel="Закрыть" onPress={onDismiss}><Text>Закрыть</Text></Pressable>
    </View>;
  },
}));
jest.mock('@/features/retention', () => {
  const useRetention: any = () => ({});
  useRetention.getState = () => ({ ensureDay: jest.fn() });
  return {
  useRetention,
  getFeatureGates: () => ({ daily: mockDailyEnabled, week: true }),
  getWeeklyStatus: () => ({ startDay: '2026-09-24', endDay: '2026-09-30', activeDays: ['2026-09-24'], activeCount: 1 }),
  getDailyCollectionStatus: () => ({ completedDays: 2, ownedCount: 0, nextPostcardAt: mockNextPostcardAt }),
  reconcileRewards: jest.fn(),
  };
});
jest.mock('@/features/settings', () => {
  const useSettings: any = (selector: any) => selector({ notifications: false });
  useSettings.getState = () => ({ set: mockSettingsSet });
  return { useSettings };
});
jest.mock('@/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    AppButton: ({ label, onPress }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>,
    AppText: ({ children }: any) => <Text>{children}</Text>,
    CoinBadge: () => <Text>42</Text>,
    GlassPanel: ({ children }: any) => <View>{children}</View>,
    Icon: () => null,
    WorldBackground: () => null,
    colors: { textMuted: '#fff', amber: '#eba63d', glass: '#444', glassBorder: '#555', greenDark: '#155c34', offline: '#555', gridHint: '#ffd37a', success: '#3fd27e' },
    radius: { pill: 999, md: 18 },
  };
});

function actions(tree: ReactTestRenderer): string[] {
  return tree.root.findAll((node) => node.props.accessibilityRole === 'button').map((node) => node.props.accessibilityLabel);
}

describe('daily screen', () => {
  beforeEach(() => {
    AppState.currentState = 'active';
    mockPush.mockClear();
    mockRouteReplace.mockClear();
    mockFocusCallback = null;
    mockFocusCleanup?.();
    mockFocusCleanup = null;
    mockWalletAdd.mockClear();
    mockBonusClaim.mockClear();
    mockBonusClaimable = false;
    mockDailyEnabled = true;
    mockStart.mockClear();
    mockReplace.mockClear();
    mockMarkAsk.mockClear();
    mockPermission.mockClear();
    mockSync.mockClear();
    mockSettingsSet.mockClear();
    mockReminderAvailable = false;
    mockSoftAskEligible = false;
    mockNextPostcardAt = 3;
    mockSolvedDates = [];
    mockTodayInstance = null;
    mockPending = { dateKey: '2026-09-25' };
    mockCarried = [{ dateKey: '2026-09-25' }];
    mockSource = 'home_card'; mockAttribution = {};
  });

  afterEach(() => { mockFocusCleanup?.(); mockFocusCleanup = null; });

  it('opens the starter grid on the first voluntary visit without showing calendar or gift', () => {
    mockPending = null;
    mockCarried = [];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    expect(tree.root.findAllByProps({ children: 'Календарь' })).toHaveLength(0);
    expect(actions(tree)).not.toContain('Забрать подарок');
    act(() => { mockFocusCleanup = mockFocusCallback?.() ?? null; });
    expect(mockStart).toHaveBeenCalledWith('2026-09-26', 'starter');
    expect(mockRouteReplace).toHaveBeenCalledWith('/game?mode=daily&date=2026-09-26&source=home_card');
    act(() => { tree.unmount(); });
  });

  it('shows resume and calendar on return, then the personal-week explanation after a credited daily', () => {
    mockPending = null;
    mockCarried = [];
    mockTodayInstance = { dateKey: '2026-09-26' };
    let resumed!: ReactTestRenderer;
    act(() => { resumed = TestRenderer.create(<Daily />); });
    expect(actions(resumed)).toContain('Продолжить');
    expect(resumed.root.findAllByProps({ children: 'Календарь' }).length).toBeGreaterThan(0);
    expect(JSON.stringify(resumed.toJSON())).not.toContain('Личная неделя');
    act(() => { mockFocusCleanup = mockFocusCallback?.() ?? null; });
    expect(mockRouteReplace).not.toHaveBeenCalled();
    act(() => { resumed.unmount(); });

    mockSolvedDates = ['2026-09-26'];
    let credited!: ReactTestRenderer;
    act(() => { credited = TestRenderer.create(<Daily />); });
    expect(JSON.stringify(credited.toJSON())).toContain('Личная неделя');
    act(() => { credited.unmount(); });
  });

  it('keeps a carried puzzle separate from today and opens each pinned date', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    expect(actions(tree)).toContain('Играть кроссворд дня');
    expect(actions(tree)).toContain('Продолжить за 25 сен');
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Продолжить за 25 сен' }).props.onPress(); });
    expect(mockStart).toHaveBeenCalledWith('2026-09-25');
    expect(mockPush).toHaveBeenCalledWith('/game?mode=daily&date=2026-09-25&source=carry');
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Играть кроссворд дня' }).props.onPress(); });
    expect(mockStart).toHaveBeenCalledWith('2026-09-26');
    expect(mockPush).toHaveBeenCalledWith('/game?mode=daily&date=2026-09-26&source=daily_menu');
  });

  it('does not offer a duplicate solve for a completed date', () => {
    mockSolvedDates = ['2026-09-26'];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    expect(actions(tree)).not.toContain('Играть кроссворд дня');
    expect(actions(tree)).not.toContain('Продолжить кроссворд дня');
    expect(tree.root.findAllByProps({ children: 'Отметка за сегодня получена' }).length).toBeGreaterThan(0);
  });

  it('lets the gift store settle its wallet grant without a second screen credit', () => {
    mockBonusClaimable = true;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Забрать подарок' }).props.onPress(); });
    expect(mockBonusClaim).toHaveBeenCalledTimes(1);
    expect(mockWalletAdd).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Подарок получен, 10 монет' }).length).toBeGreaterThan(0);
    expect(actions(tree)).not.toContain('Забрать подарок');
  });

  it('hides puzzle entry when daily is disabled while preserving the separate login gift', () => {
    const flags = RETENTION.featureFlags as { daily: boolean };
    flags.daily = false;
    mockDailyEnabled = false;
    mockBonusClaimable = true;
    try {
      let tree!: ReactTestRenderer;
      act(() => { tree = TestRenderer.create(<Daily />); });
      expect(actions(tree)).not.toContain('Играть кроссворд дня');
      expect(actions(tree)).not.toContain('Продолжить за 25 сен');
      expect(actions(tree)).toContain('Забрать подарок');
      expect(tree.root.findAllByProps({ children: 'Режим пока недоступен' }).length).toBeGreaterThan(0);
      act(() => { tree.root.findByProps({ accessibilityLabel: 'Забрать подарок' }).props.onPress(); });
      expect(mockBonusClaim).toHaveBeenCalledTimes(1);
      expect(mockStart).not.toHaveBeenCalled();
    } finally {
      flags.daily = true;
    }
  });

  it('requires an explicit choice before replacing extra carried puzzles', () => {
    mockCarried = [{ dateKey: '2026-09-25' }, { dateKey: '2026-09-24' }];
    mockPending = null;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    expect(actions(tree)).not.toContain('Играть кроссворд дня');
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Оставить кроссворд за 25 сен' }).props.onPress(); });
    expect(mockReplace).not.toHaveBeenCalled();
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Подтвердить замену' }).props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith('2026-09-25');
  });

  it('offers voluntary reminders on introduction and keeps decline separate from permission grant', async () => {
    mockReminderAvailable = true;
    mockSoftAskEligible = true;
    mockSolvedDates = [];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    expect(mockPermission).not.toHaveBeenCalled();
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Напомнить завтра' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Не нужно' }).props.onPress(); });
    expect(mockMarkAsk).toHaveBeenCalledWith('declined');
    expect(mockPermission).not.toHaveBeenCalled();
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Напомнить завтра' }).props.onPress(); });
    await act(async () => { await tree.root.findByProps({ accessibilityLabel: 'Разрешить' }).props.onPress(); });
    expect(mockPermission).toHaveBeenCalledTimes(1);
    expect(mockMarkAsk).toHaveBeenCalledWith('allowed');
    expect(mockSettingsSet).toHaveBeenCalledWith({ notifications: true });
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('offers reminders after one daily solve without waiting for a second', () => {
    mockReminderAvailable = true;
    mockSoftAskEligible = true;
    mockSolvedDates = ['2026-09-25'];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    expect(actions(tree)).toContain('Напомнить завтра');
  });

  it('records the first auto entry with source without claiming that a hidden menu was seen', () => {
    const { track } = require('@/features/analytics');
    track.mockClear();
    mockPending = null;
    mockCarried = [];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    act(() => { mockFocusCleanup = mockFocusCallback?.() ?? null; });
    expect(track).toHaveBeenCalledWith('daily_entered', expect.objectContaining({ source: 'home_card', entryKind: 'first_play' }));
    expect(track).not.toHaveBeenCalledWith('daily_entry_seen', expect.anything());
    expect(track).not.toHaveBeenCalledWith('daily_menu_viewed', expect.anything());
    act(() => { tree.unmount(); });
  });

  it('joins direct native notification entry to its real reminder id without overriding an explicit source', () => {
    const { track } = require('@/features/analytics');
    track.mockClear();
    mockSource = '';
    mockAttribution = { promptId: 'daily_2026-09-26_1', source: 'local_reminder', dateKey: '2026-09-26' };
    mockPending = null; mockCarried = [];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    act(() => { mockFocusCleanup = mockFocusCallback?.() ?? null; });
    expect(track).toHaveBeenCalledWith('daily_entered', expect.objectContaining({ source: 'reminder', promptId: 'daily_2026-09-26_1' }));
    expect(mockRouteReplace).toHaveBeenCalledWith('/game?mode=daily&date=2026-09-26&source=reminder');
    act(() => { tree.unmount(); mockFocusCleanup?.(); mockFocusCleanup = null; });
    track.mockClear(); mockSource = 'home_card';
    act(() => { tree = TestRenderer.create(<Daily />); });
    act(() => { mockFocusCleanup = mockFocusCallback?.() ?? null; });
    expect(track).toHaveBeenCalledWith('daily_entered', expect.objectContaining({ source: 'home_card' }));
    act(() => { tree.unmount(); });
  });

  it('does not promise an unpublished postcard when the daily catalog is exhausted', () => {
    mockNextPostcardAt = null;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Daily />); });
    expect(tree.root.findAllByProps({ children: 'Все доступные открытки собраны. Решения сохраняются для новых томов.' }).length).toBeGreaterThan(0);
  });
});
