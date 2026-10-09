/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act } from 'react-test-renderer';
import Marathon from '../marathon';

const mockPush = jest.fn();
let mockLevel = 1;
let mockDaily = true;
let mockPending: number | null = null;

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }), useFocusEffect: jest.fn(),
}));
jest.mock('@/core/nav', () => ({ useGoBack: () => jest.fn() }));
jest.mock('@/core/config/worlds', () => ({ totalCampaignLevels: () => 1000 }));
jest.mock('@/features/analytics', () => ({ track: jest.fn() }));
jest.mock('@/features/currency', () => ({ useCurrency: (selector: (value: { coins: number }) => unknown) => selector({ coins: 150 }) }));
jest.mock('@/features/game/marathonRewards', () => ({ applyMarathonCoinsOnce: jest.fn() }));
jest.mock('@/features/game/persistence', () => ({ loadGameSnapshot: () => null }));
jest.mock('@/features/levels', () => ({
  useLevels: (selector: (value: { currentLevel: number }) => unknown) => selector({ currentLevel: mockLevel }),
  loadGlobalLevel: jest.fn(),
}));
jest.mock('@/features/retention-ui/homeModel', () => ({ pendingNormalResultLevel: () => mockPending }));
jest.mock('@/features/retention', () => ({ useRetention: () => ({}), getFeatureGates: () => ({ daily: mockDaily }) }));
jest.mock('@/features/marathon', () => ({
  useMarathon: () => ({}), recoverMarathonProgress: jest.fn(), reconcileMarathonRewards: jest.fn(),
  getMarathonStatus: () => ({ status: 'active', completionCount: 0, tiers: [], earnedCoins: 0 }),
}));
jest.mock('@/ui', () => {
  const { Text, View, Pressable } = require('react-native');
  return {
    AppText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    AppButton: ({ label, onPress }: { label: string; onPress: () => void }) => <Pressable accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>,
    GlassPanel: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    CoinBadge: () => null, Icon: () => null, WorldBackground: () => null, colors: {}, radius: {},
  };
});

describe('marathon play destination', () => {
  beforeEach(() => { mockPush.mockClear(); mockLevel = 1; mockDaily = true; mockPending = null; });
  function press(label: string) {
    let screen!: TestRenderer.ReactTestRenderer;
    act(() => { screen = TestRenderer.create(<Marathon />); });
    act(() => { screen.root.findByProps({ accessibilityLabel: label }).props.onPress(); });
    act(() => { screen.unmount(); });
  }
  test('a newcomer can enter campaign without a retention unlock', () => {
    press('Играть в марафоне');
    expect(mockPush).toHaveBeenCalledWith('/game?source=marathon');
  });
  test('after campaign exhaustion the current daily remains playable', () => {
    mockLevel = 1001;
    press('Кроссворд текущего дня');
    expect(mockPush).toHaveBeenCalledWith('/daily?source=marathon');
  });
  test('a pending final result is opened before changing modes', () => {
    mockLevel = 1001; mockPending = 1000;
    press('Играть в марафоне');
    expect(mockPush).toHaveBeenCalledWith('/game?source=marathon');
  });
  test('disabled daily sends an exhausted player to the album', () => {
    mockLevel = 1001; mockDaily = false;
    press('Открыть альбом');
    expect(mockPush).toHaveBeenCalledWith('/collection');
  });
});
