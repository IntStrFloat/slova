/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { ECONOMY } from '@/core/config/economy';
import { NoCoinsModal } from '../NoCoinsModal';

jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn() }));
// Component presentation fixtures have an explicit assigned variant; real assignment/clamp is tested separately.
let mockAssignedVariant: 'control' | 'clarity' = 'clarity';
jest.mock('@/features/hints/help-experiment', () => ({
  useHelpExperimentState: () => 0, resolveHelpUxVariant: () => mockAssignedVariant, exposeHelpExperiment: jest.fn(),
}));
jest.mock('@/ui', () => ({
  ...require('@/ui/theme'), AppText: require('react-native').Text, GlassPanel: require('react-native').View,
  Icon: () => null,
  AppButton: (props: Record<string, unknown>) => require('react').createElement('Button', props),
}));

let tree: renderer.ReactTestRenderer;
const apply = jest.fn();
const ad = jest.fn();
const free = jest.fn();
const wheel = jest.fn();
const close = jest.fn();
const recover = jest.fn();
type Props = React.ComponentProps<typeof NoCoinsModal>;
async function mount(overrides: Partial<Props> = {}) {
  mockAssignedVariant = overrides.uxVariant ?? 'clarity';
  await act(async () => { tree = renderer.create(<NoCoinsModal priceCoins={50} currentCoins={20}
    requestedHint="letter" uxVariant="clarity" originInteractionId="help:first:origin" attemptId="attempt:original"
    canWatchAd canFreeSpin onApplyHint={apply} onWatchAd={ad} onFreeWheel={free} onWheel={wheel}
    onShop={() => {}} onClose={close} {...overrides} />); });
}
function text() { return tree.root.findAllByType(Text).map((node) => Array.isArray(node.props.children)
  ? node.props.children.join('') : String(node.props.children)).join(' '); }
function button(label: string) { return tree.root.findAll((node) => typeof node.type === 'string' && node.props.label === label)[0]; }
beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { if (tree) act(() => tree.unmount()); });

test('deficit, guaranteed coins, free/random/no-ad and paid/random/ad are explicit with unchanged economy', async () => {
  await mount();
  expect(text()).toContain('Для буквы нужно 50 монет. У вас 20. Не хватает 30.');
  expect(text()).toContain(`Гарантированно +${ECONOMY.rewardedCoins} монет`);
  expect(text()).toContain(`Без рекламы: случайный выигрыш ${Math.min(...ECONOMY.wheel.sectors)}–${Math.max(...ECONOMY.wheel.sectors)} монет`);
  expect(text()).toContain('Нужна реклама: случайный выигрыш');
  expect(text()).toContain('Его может не хватить на помощь.');
  expect(button('Бесплатное вращение')).toBeDefined();
  expect(button('Колесо за видео')).toBeDefined();
  expect(apply).not.toHaveBeenCalled(); expect(ad).not.toHaveBeenCalled(); expect(free).not.toHaveBeenCalled();
});

test('a sufficient balance offers one explicit purchase at its price and never buys on render', async () => {
  await mount({ currentCoins: 80 });
  expect(text()).toContain('Монет хватает на помощь');
  expect(button('Открыть букву → 50 монет')).toBeDefined();
  expect(apply).not.toHaveBeenCalled();
  expect(button('Колесо за видео')).toBeUndefined();
  const press = button('Открыть букву → 50 монет').props.onPress;
  await act(async () => { press(); press(); });
  expect(apply).toHaveBeenCalledTimes(1);
});

test('already owned semantic help can open for free without an earning detour', async () => {
  await mount({ priceCoins: 0, currentCoins: 0, requestedHint: 'semantic', hintName: 'наводку' });
  expect(button('Открыть наводку бесплатно')).toBeDefined();
  expect(button('Бесплатное вращение')).toBeUndefined();
  expect(button('Колесо за видео')).toBeUndefined();
  expect(apply).not.toHaveBeenCalled();
  await act(async () => { button('Открыть наводку бесплатно').props.onPress(); });
  expect(apply).toHaveBeenCalledTimes(1);
});

test('unready and exhausted methods are explained, while a saved spin is a no-ad recovery', async () => {
  await mount({ canWatchAd: false, rewardedEligible: true, rewardedState: 'loading', canFreeSpin: false, wheelRewardedRemaining: 0 });
  expect(button(`Посмотреть рекламу → +${ECONOMY.rewardedCoins} монет`).props.disabled).toBe(true);
  expect(text()).toContain('Реклама загружается');
  expect(button('Колесо за видео').props.disabled).toBe(true);
  expect(text()).toContain('На сегодня вращения за видео закончились.');
  await act(async () => { tree.update(<NoCoinsModal priceCoins={50} currentCoins={20} requestedHint="letter" uxVariant="clarity"
    canWatchAd={false} wheelPending wheelRewardedRemaining={0} onWatchAd={ad} onWheel={wheel} onShop={() => {}} onClose={close} />); });
  expect(button('Забрать выигрыш колеса').props.disabled).toBe(false);
  expect(text()).toContain('Повторная реклама не нужна.');
});

test('pending checks keep an escape and a retry rather than charging or requesting another ad', async () => {
  await mount({ busy: true, onRecoverReward: recover, recoveryChecking: false });
  expect(button('Открыть букву → 50 монет')).toBeUndefined();
  expect(button(`Посмотреть рекламу → +${ECONOMY.rewardedCoins} монет`).props.disabled).toBe(true);
  await act(async () => { button('Повторить проверку награды').props.onPress(); });
  expect(recover).toHaveBeenCalledTimes(1); expect(ad).not.toHaveBeenCalled();
  await act(async () => { button('Вернуться к слову').props.onPress(); });
  expect(close).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
});
