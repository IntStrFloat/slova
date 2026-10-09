/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import { removeKey } from '@/core/storage';

import Collection from '../collection';

const mockMarkSeen = jest.fn();
let mockOpened: string[] = [];
let mockCurrentLevel = 12;
const mockSelectCover = jest.fn(() => true);
let mockSelectedCoverId: string | null = null;
const baseCards: any[] = [
  { id: 'journey-1-1', kind: 'journey', title: 'Эйфелева башня', artId: 'eiffel', image: 1, owned: true, seen: false, threshold: 5 },
  { id: 'journey-1-2', kind: 'journey', title: 'Лувр', artId: 'louvre', image: 2, owned: false, seen: false, threshold: 9 },
  { id: 'daily-1-1', kind: 'daily', title: 'Парижский день', artId: 'eiffel', image: 1, owned: false, seen: false, threshold: 3 },
];
let mockCards = [...baseCards];

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn() }));
jest.mock('@/features/analytics/retentionEvents', () => ({ trackObservedRetentionMilestones: jest.fn() }));
jest.mock('@/core/config/worlds', () => {
  const worlds = [
    { id: 'world1', title: 'Париж', startsAt: 1, endsAt: 20, landmarks: [
      { id: 'paris-river-islands', title: 'Острова Сены', fact: 'Вдоль Сены.', image: 3, untilLevel: 5 },
      { id: 'eiffel', title: 'Эйфелева башня', fact: 'История места.', image: 1, untilLevel: 10 },
      { id: 'louvre', title: 'Лувр', fact: 'Королевский музей.', image: 2, untilLevel: 20 },
    ] },
    { id: 'world2', title: 'Нью-Йорк', startsAt: 21, endsAt: 30, landmarks: [
      { id: 'newyork-battery', title: 'Бэттери-парк', fact: 'Набережная.', image: 4, untilLevel: 25 },
      { id: 'liberty', title: 'Статуя Свободы', fact: 'Остров Свободы.', image: 5, untilLevel: 30 },
    ] },
  ];
  return {
    WORLDS: worlds,
    allLandmarks: () => worlds.flatMap((world) => world.landmarks.map((landmark) => ({ ...landmark, world: world.id }))),
  };
});
jest.mock('@/core/nav', () => ({ useGoBack: () => jest.fn() }));
jest.mock('@/features/collection', () => ({ useCollection: (selector: any) => selector({ opened: mockOpened, selectedCoverId: mockSelectedCoverId, selectCover: mockSelectCover }) }));
jest.mock('@/features/levels', () => ({ useLevels: (selector: any) => selector({ currentLevel: mockCurrentLevel }) }));
jest.mock('@/features/dailypuzzle', () => ({ useDailyPuzzle: () => ({ tomeProgress: () => ({ inVolume: 0 }) }) }));
jest.mock('@/features/retention', () => {
  const useRetention: any = () => ({});
  useRetention.getState = () => ({ markCollectibleSeen: mockMarkSeen });
  return {
    useRetention,
    getCollectibles: () => mockCards,
    getFeatureGates: () => ({ daily: true, week: true }),
    getJourneyStatus: () => ({ nextPostcardAt: 9, remaining: 4 }),
    getDailyCollectionStatus: () => ({ nextPostcardAt: 3, remaining: 3 }),
  };
});
jest.mock('@/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    AppButton: ({ label, onPress }: any) => <Pressable accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>,
    AppText: ({ children }: any) => <Text>{children}</Text>,
    GlassPanel: ({ children }: any) => <View>{children}</View>,
    Icon: () => null,
    WorldBackground: () => null,
    colors: { glassStrong: '#333', glassBorder: '#555', amber: '#eba63d', glass: '#444', textMuted: '#fff', text: '#fff', onAmber: '#000', bgBottom: '#111' },
    radius: { lg: 26, md: 18, pill: 999 },
  };
});

describe('collection screen', () => {
  beforeEach(() => { AppState.currentState = 'active'; removeKey('album.help.seen.v1'); mockMarkSeen.mockClear(); mockSelectCover.mockClear(); mockOpened = []; mockCurrentLevel = 12; mockSelectedCoverId = null; mockCards = [...baseCards]; });

  it('explains collecting in context only on the first album visit', () => {
    let first!: ReactTestRenderer;
    act(() => { first = TestRenderer.create(<Collection />); });
    const list = first.root.findAll((node) => Array.isArray(node.props.sections))[0];
    let header!: ReactTestRenderer;
    act(() => { header = TestRenderer.create(list.props.ListHeaderComponent); });
    expect(header.root.findAllByProps({ children: 'Как собирать открытки' }).length).toBeGreaterThan(0);
    act(() => { header.root.findByProps({ accessibilityLabel: 'Понятно про альбом' }).props.onPress(); });
    act(() => { header.unmount(); first.unmount(); });
    let second!: ReactTestRenderer;
    act(() => { second = TestRenderer.create(<Collection />); });
    const secondList = second.root.findAll((node) => Array.isArray(node.props.sections))[0];
    let nextHeader!: ReactTestRenderer;
    act(() => { nextHeader = TestRenderer.create(secondList.props.ListHeaderComponent); });
    expect(nextHeader.root.findAllByProps({ children: 'Как собирать открытки' })).toHaveLength(0);
    act(() => { nextHeader.unmount(); second.unmount(); });
  });

  it('keeps earned art large, explains locked cards, and marks seen only on opening', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Collection />); });
    expect(mockMarkSeen).not.toHaveBeenCalled();
    const list = tree.root.findAll((node) => Array.isArray(node.props.sections))[0];
    const rewards = list.props.sections.find((section: any) => section.title === 'Наградные открытки');
    let row!: ReactTestRenderer;
    act(() => { row = TestRenderer.create(list.props.renderItem({ item: rewards.data[0] })); });
    const owned = row.root.findByProps({ accessibilityLabel: 'Эйфелева башня. Открыть открытку' });
    const locked = row.root.findByProps({ accessibilityLabel: 'Лувр. Откроется после 9 завершённых уровней маршрута' });
    expect(locked.props.disabled).toBe(true);
    act(() => { owned.props.onPress(); });
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).toHaveBeenCalledWith('journey-1-1');
    expect(tree.root.findAllByProps({ children: 'История места.' }).length).toBeGreaterThan(0);
    act(() => { row.unmount(); });
    act(() => { tree.unmount(); });
  });

  it('shows opened route backgrounds before rewards and previews the next level without awarding it', () => {
    mockOpened = ['paris-river-islands', 'eiffel'];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Collection />); });
    const sections = tree.root.findAll((node) => Array.isArray(node.props.sections))[0].props.sections;
    expect(sections[0].title).toBe('Карточки фона · Париж');
    expect(sections[1].title).toBe('Наградные открытки');
    expect(sections[0].data.map((row: any[]) => row.length)).toEqual([2, 1]);
    expect(sections[0].data.flat().map((card: any) => [card.id, card.owned, card.threshold, card.image])).toEqual([
      ['route:paris-river-islands', true, 5, 3],
      ['route:eiffel', true, 10, 1],
      ['route:louvre', false, 20, 2],
    ]);
    expect(tree.root.findByProps({ accessibilityLabel: 'Лувр. Откроется после уровня 20' }).props.disabled).toBe(true);
    act(() => { tree.root.findAllByProps({ accessibilityLabel: 'Эйфелева башня. Открыть открытку' })[0].props.onPress(); });
    expect(mockMarkSeen).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ children: 'Карточка фона · Париж · уровень 10' }).length).toBeGreaterThan(0);
    act(() => { tree.unmount(); });
  });

  it('reflects backfilled ownership and shows only owned cards in completed worlds', () => {
    mockCurrentLevel = 26;
    mockOpened = ['paris-river-islands', 'eiffel', 'louvre'];
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Collection />); });
    const list = tree.root.findAll((node) => Array.isArray(node.props.sections))[0];
    expect(list.props.sections[0].data.flat().map((card: any) => card.id)).toEqual([
      'route:paris-river-islands', 'route:eiffel', 'route:louvre',
    ]);
    expect(list.props.sections[1].data.flat().map((card: any) => [card.id, card.owned])).toEqual([
      ['route:newyork-battery', false], ['route:liberty', false],
    ]);
    mockOpened = [...mockOpened, 'newyork-battery'];
    act(() => { tree.update(<Collection />); });
    expect(list.props.sections[1].data.flat().map((card: any) => [card.id, card.owned])).toEqual([
      ['route:newyork-battery', true], ['route:liberty', false],
    ]);
    let row!: ReactTestRenderer;
    act(() => { row = TestRenderer.create(list.props.renderItem({ item: list.props.sections[1].data[0] })); });
    expect(row.root.findByProps({ accessibilityLabel: 'Статуя Свободы. Откроется после уровня 30' }).props.disabled).toBe(true);
    act(() => { row.unmount(); });
    act(() => { tree.unmount(); });
  });

  it('lets the player choose an earned cover from its album detail', () => {
    mockCards.push({ id: 'journey-cover-1', kind: 'cover', title: 'Альбом путешествия', artId: 'eiffel', image: 1, owned: true, seen: true, threshold: null });
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Collection />); });
    const list = tree.root.findAll((node) => Array.isArray(node.props.sections))[0];
    const coverSection = list.props.sections.find((section: any) => section.title === 'Обложки');
    let coverRow!: ReactTestRenderer;
    act(() => { coverRow = TestRenderer.create(list.props.renderItem({ item: coverSection.data[0] })); });
    act(() => { coverRow.root.findByProps({ accessibilityLabel: 'Альбом путешествия. Открыть открытку' }).props.onPress(); });
    act(() => { tree.root.findByProps({ accessibilityLabel: 'Выбрать фон' }).props.onPress(); });
    expect(mockSelectCover).toHaveBeenCalledWith('journey-cover-1');
    act(() => { coverRow.unmount(); });
    act(() => { tree.unmount(); });
  });
});
