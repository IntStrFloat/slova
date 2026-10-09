/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import Home from '../index';

const mockPush = jest.fn();
let mockWins = 2;
let mockSurface = 'menu';
let mockSnapshot: unknown = null;
let mockCards: any[] = [];
let mockQuestReady = false;
let mockFlags = { daily: true, week: true, quests: true, event: true };
let mockGiftClaimable = true;
const mockClaimGift = jest.fn(() => ({ reward: 10, day: 1 }));
const mockReconcileGift = jest.fn((): { reward: number | null; day: number } => ({ reward: null, day: 1 }));
let mockFocusCallback: (() => void | (() => void)) | null = null;
const mockProgress = { ensureDay: jest.fn() };
let mockDay = '2026-09-26';
const mockRefreshDay = jest.fn(() => mockDay);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => { mockFocusCallback = callback; },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/features/retention-ui/MarathonEntry', () => ({ MarathonEntry: () => null }));
jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn() }));
jest.mock('@/features/analytics/retentionEvents', () => ({ trackObservedRetentionMilestones: jest.fn() }));
jest.mock('@/core/storage', () => ({
  KEYS: { introSurface: 'onboarding.surface.v1' },
  getString: () => mockSurface,
  setString: jest.fn(),
}));
jest.mock('@/core/config/worlds', () => ({
  WORLDS: [{
    id: 'world1', endsAt: 90,
    landmarks: [
      { id: 'first', title: 'Эйфелева башня', image: 1, untilLevel: 5 },
      { id: 'second', title: 'Лувр', image: 2, untilLevel: 20 },
    ],
  }],
  totalCampaignLevels: () => 1000,
  worldForCampaignLevel: () => 'world1',
  worldById: () => ({ title: 'Париж', image: 1 }),
  latestLandmarkAt: (_world: string, level: number) => level >= 5
    ? { id: 'first', title: 'Острова Сены', image: 1, untilLevel: 5 } : null,
}));
jest.mock('@/core/time', () => ({ dayKey: () => mockDay, isDayKey: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) }));
jest.mock('@/features/currency', () => ({ useCurrency: (selector: any) => selector({ coins: 42 }) }));
jest.mock('@/features/dailybonus', () => {
  const useDailyBonus: any = (selector: any) => selector({ canClaim: () => mockGiftClaimable, pendingGift: null });
  useDailyBonus.getState = () => ({ claim: mockClaimGift, reconcilePending: mockReconcileGift, lastDay: '2026-09-25' });
  return { useDailyBonus };
});
jest.mock('@/features/notifications', () => ({ isDailyReminderAvailable: () => false, shouldShowPushSoftAsk: () => false }));
jest.mock('@/features/settings', () => ({ useSettings: { getState: () => ({ set: jest.fn() }) } }));
jest.mock('@/features/collection/store', () => ({
  useCollection: (selector: any) => selector({ opened: mockWins >= 5 ? ['first'] : [] }),
}));
jest.mock('@/features/dailypuzzle', () => ({ useDailyPuzzle: Object.assign(() => ({ effectiveDay: () => mockDay, isDone: () => false, instances: {} }), { getState: () => ({ refreshDay: mockRefreshDay }) }) }));
jest.mock('@/features/game/persistence', () => ({ ...jest.requireActual('@/features/game/persistence'), loadGameSnapshot: () => mockSnapshot }));
jest.mock('@/features/levels', () => ({
  useLevels: Object.assign((selector: any) => selector({ completed: Array.from({ length: mockWins }, (_, i) => i + 1), currentLevel: mockWins + 1 }), {
    getState: () => ({ completed: Array.from({ length: mockWins }, (_, i) => i + 1), currentLevel: mockWins + 1 }),
  }),
  loadGlobalLevel: (id: number) => ({
    id, globalId: id, world: 'world1', contentVersion: 'test-v1', fingerprint: `test:${id}`,
    letters: ['к', 'о', 'т'], grid: { cells: [{ row: 0, col: 0, ch: 'к' }] },
    answers: [{ word: 'КОТ' }, { word: 'ТОК' }], bonusPool: [],
  }),
}));
jest.mock('@/features/monetization', () => ({ AdBanner: () => null, MONETIZATION: { iapEnabled: false } }));
jest.mock('@/features/onboarding/introPack', () => ({ assignIntroPackForCurrentProfile: () => true }));
jest.mock('@/features/progression/store', () => ({
  giftProgress: (completedLevel: number) => ({
    remaining: 10 - (completedLevel % 10),
    amountCoins: 50,
  }),
}));
jest.mock('@/features/retention', () => ({
  useRetention: Object.assign(() => mockProgress, { getState: () => mockProgress }),
  reconcileRewards: jest.fn(),
  getFeatureGates: () => ({
    daily: mockWins >= 5 && mockFlags.daily,
    week: mockWins >= 5 && mockFlags.week,
    quests: mockWins >= 8 && mockFlags.quests,
    event: mockWins >= 15 && mockFlags.event,
  }),
  getJourneyStatus: () => ({ remaining: mockWins >= 5 ? 4 : 5 - mockWins, nextPostcardAt: mockWins >= 5 ? 9 : 5, completedAfterAnchor: mockWins, nextCollectibleId: mockWins >= 5 ? 'second' : 'first' }),
  getWeeklyStatus: () => ({ activeCount: 0 }),
  getQuestStatus: () => mockQuestReady ? ({ quests: [{ completed: false }, { completed: false }, { completed: false }] }) : null,
  getEventStatus: () => null,
  getCollectibles: () => mockCards,
}));
jest.mock('@/ui', () => {
  const { Text, View } = require('react-native');
  return {
    AppText: ({ children }: any) => <Text>{children}</Text>,
    CoinBadge: () => <Text>42</Text>,
    GlassPanel: ({ children }: any) => <View>{children}</View>,
    Icon: () => null,
    WorldBackground: () => null,
    colors: {
      amber: '#eba63d', amberDeep: '#c07a1e', onAmber: '#13202f', textMuted: '#fff',
      glassStrong: '#222', glassBorder: '#555', glass: '#444', success: '#3fd27e',
    },
    radius: { pill: 999, lg: 26, md: 18 },
  };
});

function labels(tree: ReactTestRenderer): string[] {
  return tree.root.findAll((node) => typeof node.props.accessibilityLabel === 'string').map((node) => node.props.accessibilityLabel);
}

describe('retention home', () => {
  beforeEach(() => {
    AppState.currentState = 'active';
    (AppState.addEventListener as jest.Mock).mockImplementation(() => ({ remove: jest.fn() }));
    mockPush.mockClear();
    mockGiftClaimable = true;
    mockClaimGift.mockClear();
    mockReconcileGift.mockReset().mockReturnValue({ reward: null, day: 1 });
    mockFocusCallback = null;
    mockDay = '2026-09-26';
    mockRefreshDay.mockClear();
    mockProgress.ensureDay.mockClear();
    mockWins = 2;
    mockSurface = 'menu';
    mockSnapshot = null;
    mockQuestReady = false;
    mockFlags = { daily: true, week: true, quests: true, event: true };
    mockCards = [{ id: 'first', kind: 'journey', title: 'Эйфелева башня', image: 1, owned: false, seen: false }];
  });

  it('keeps play prominent after an early exit and hides daily and social distractions', () => {
    mockSnapshot = {
      mode: 'normal', globalLevel: 3, solvedWords: ['КОТ'], filled: { '0,0': 'К' }, completion: { status: 'playing' },
    };
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    const actions = labels(tree);
    expect(actions).toContain('Продолжить — уровень 3');
    expect(actions).not.toContain('Открыть альбом');
    expect(actions).not.toContain('Открыть кроссворд дня');
    expect(actions).not.toContain('Собери чемодан');
    expect(actions).not.toContain('Команды');
    expect(tree.root.findAllByProps({ children: 'Маршрут и альбом' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ children: 'Найдено слов: 1 из 2. Прогресс сохранён.' }).length).toBeGreaterThan(0);
  });

  it('reveals the first postcard and optional daily after five unique levels', () => {
    mockWins = 5;
    mockCards = [
      { id: 'first', kind: 'journey', title: 'Эйфелева башня', image: 1, owned: true, seen: false, threshold: 5 },
      { id: 'second', kind: 'journey', title: 'Лувр', image: 2, owned: false, seen: false, threshold: 9 },
    ];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    const actions = labels(tree);
    expect(actions).toContain('Играть — уровень 6');
    expect(actions).toContain('Открыть кроссворд дня');
    expect(actions).toContain('Альбом · новых: 1');
    expect(actions.indexOf('Играть — уровень 6')).toBeLessThan(actions.indexOf('Открыть кроссворд дня'));
    expect(actions.indexOf('Открыть кроссворд дня')).toBeLessThan(actions.indexOf('Забрать ежедневный подарок'));
    expect(JSON.stringify(tree.toJSON())).toContain('Ещё 4 уровня');
    expect(tree.root.findAllByProps({ children: 'Острова Сены' }).length).toBeGreaterThan(0);
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Играть — уровень 6' }).props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith('/game?source=home');
  });

  it('opens the real saved result even when durable progression has already advanced to six', () => {
    mockWins = 5;
    mockSnapshot = {
      version: 2, mode: 'normal', attemptId: 'normal:5:test', globalLevel: 5, levelId: 5, world: 'world1',
      contentVersion: 'test-v1', levelFingerprint: 'test:5', disk: ['к', 'о', 'т'],
      solvedWords: ['КОТ', 'ТОК'], foundBonus: [], filled: { '0,0': 'к' }, completion: { status: 'completion_pending' },
    };
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    expect(labels(tree)).toContain('Результат уровня 5');
    expect(labels(tree)).not.toContain('Играть — уровень 6');
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Результат уровня 5' }).props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith('/game?source=home');
    mockSnapshot = { ...(mockSnapshot as any), levelFingerprint: 'corrupt' };
    let cleanup: void | (() => void);
    act(() => { tree.update(<Home />); cleanup = mockFocusCallback?.(); });
    expect(labels(tree)).toContain('Играть — уровень 6');
    expect(labels(tree)).not.toContain('Результат уровня 5');
    act(() => { cleanup?.(); tree.unmount(); });
  });

  it('claims the gift on home through the existing durable grant without routing elsewhere', () => {
    mockWins = 5;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Забрать ежедневный подарок' }).props.onPress(); });
    expect(mockClaimGift).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Подарок получен');
    expect(labels(tree)).not.toContain('Забрать ежедневный подарок');
  });

  it('tracks a recovered gift once using its saved date instead of the later focus date', () => {
    const { trackOnce } = require('@/features/analytics');
    trackOnce.mockClear();
    mockWins = 5;
    mockReconcileGift.mockReturnValueOnce({ reward: 10, day: 1 });
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    let cleanup: void | (() => void);
    act(() => { cleanup = mockFocusCallback?.(); });
    expect(trackOnce).toHaveBeenCalledWith('daily_bonus_claimed', 'login_gift:2026-09-25', expect.objectContaining({ dateKey: '2026-09-25', source: 'focus_recovery', reward: 10 }));
    expect(trackOnce).toHaveBeenCalledWith('coins_earned', 'login_gift:2026-09-25', expect.objectContaining({ amount: 10 }));
    act(() => { cleanup?.(); cleanup = mockFocusCallback?.(); });
    expect(trackOnce.mock.calls.filter(([name]: [string]) => name === 'daily_bonus_claimed')).toHaveLength(1);
    expect(trackOnce.mock.calls.filter(([name]: [string]) => name === 'coins_earned')).toHaveLength(1);
    act(() => { cleanup?.(); tree.unmount(); });
  });

  it('tracks daily/gift impressions only after visible layout on a focused viewport', () => {
    const { track } = require('@/features/analytics');
    track.mockClear();
    mockWins = 5;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    expect(track).not.toHaveBeenCalledWith('daily_entry_seen', expect.anything());
    const scroll = tree.root.findAll((node) => node.props.scrollEventThrottle === 100 && typeof node.props.onScroll === 'function')[0];
    let cleanup: void | (() => void);
    act(() => { cleanup = mockFocusCallback?.(); });
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { height: 300 } } });
      tree.root.findByProps({ testID: 'home-daily-card' }).props.onLayout({ nativeEvent: { layout: { y: 80, height: 100 } } });
      tree.root.findByProps({ testID: 'home-gift-card' }).props.onLayout({ nativeEvent: { layout: { y: 600, height: 70 } } });
    });
    expect(track).toHaveBeenCalledWith('daily_entry_seen', expect.objectContaining({ screen: 'home', source: 'home_card' }));
    expect(track).not.toHaveBeenCalledWith('daily_bonus_seen', expect.anything());
    act(() => { scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 450 }, layoutMeasurement: { height: 300 } } }); });
    expect(track).toHaveBeenCalledWith('daily_bonus_seen', expect.objectContaining({ screen: 'home' }));
    act(() => { cleanup?.(); tree.unmount(); });
  });

  it('does not reuse a removed gift layout when returning after a claim on another screen', () => {
    const { track } = require('@/features/analytics');
    mockWins = 5;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    const scroll = tree.root.findAll((node) => node.props.scrollEventThrottle === 100 && typeof node.props.onScroll === 'function')[0];
    let cleanup: void | (() => void);
    act(() => { cleanup = mockFocusCallback?.(); });
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { height: 500 } } });
      tree.root.findByProps({ testID: 'home-gift-card' }).props.onLayout({ nativeEvent: { layout: { y: 300, height: 70 } } });
      cleanup?.();
    });
    track.mockClear();
    mockGiftClaimable = false;
    act(() => { tree.update(<Home />); });
    act(() => { cleanup = mockFocusCallback?.(); });
    expect(track).not.toHaveBeenCalledWith('daily_bonus_seen', expect.anything());
    act(() => { cleanup?.(); tree.unmount(); });
  });

  it('refreshes the daily date and gift immediately on next-day foreground return', () => {
    const callbacks: ((state: string) => void)[] = [];
    const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback: any) => {
      callbacks.push(callback); return { remove: jest.fn() };
    });
    const { track } = require('@/features/analytics');
    mockWins = 5;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    let cleanup: void | (() => void);
    act(() => { cleanup = mockFocusCallback?.(); });
    const scroll = tree.root.findAll((node) => node.props.scrollEventThrottle === 100 && typeof node.props.onScroll === 'function')[0];
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { height: 500 } } });
      tree.root.findByProps({ testID: 'home-daily-card' }).props.onLayout({ nativeEvent: { layout: { y: 100, height: 100 } } });
      callbacks.forEach((callback) => callback('background'));
    });
    track.mockClear(); mockRefreshDay.mockClear();
    mockDay = '2026-09-27';
    act(() => { callbacks.forEach((callback) => callback('active')); });
    expect(mockRefreshDay).toHaveBeenCalledTimes(1);
    expect(mockProgress.ensureDay).toHaveBeenCalledWith({ actionDay: '2026-09-27' });
    expect(track).toHaveBeenCalledWith('daily_entry_seen', expect.objectContaining({ dateKey: '2026-09-27' }));
    act(() => { cleanup?.(); tree.unmount(); });
    listener.mockRestore();
  });

  it('shows quests only at eight wins and the event entry only at fifteen wins', () => {
    mockQuestReady = true;
    mockWins = 7;
    let seven!: ReactTestRenderer;
    act(() => { seven = TestRenderer.create(<Home />); });
    expect(labels(seven).some((label) => label.startsWith('Задания дня'))).toBe(false);
    expect(labels(seven)).not.toContain('Собери чемодан');
    act(() => { seven.unmount(); });

    mockWins = 8;
    let eight!: ReactTestRenderer;
    act(() => { eight = TestRenderer.create(<Home />); });
    expect(labels(eight)).toContain('Задания дня · 0 из 3');
    expect(labels(eight)).not.toContain('Собери чемодан');
    act(() => { eight.unmount(); });

    mockWins = 15;
    let fifteen!: ReactTestRenderer;
    act(() => { fifteen = TestRenderer.create(<Home />); });
    expect(labels(fifteen)).toContain('Задания дня · 0 из 3');
    expect(labels(fifteen)).toContain('Собери чемодан');
    act(() => { fifteen.unmount(); });
  });

  it('hides independently disabled daily, quest and event entries while leaving the album', () => {
    mockWins = 15;
    mockQuestReady = true;
    mockFlags = { daily: false, week: false, quests: false, event: false };
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Home />); });
    const visible = labels(tree);
    expect(visible).not.toContain('Открыть кроссворд дня');
    expect(visible.some((label) => label.startsWith('Задания дня'))).toBe(false);
    expect(visible.some((label) => label.startsWith('Собери чемодан'))).toBe(false);
    expect(visible).toContain('Открыть альбом');
  });
});
