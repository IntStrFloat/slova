/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockCheckout = jest.fn(async () => true);
const mockCancel = jest.fn(async () => true);
const mockSync = jest.fn(async () => {});
let mockSubscription: Record<string, unknown>;
let mockExpiresAt: number | null = null;

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) { return React.createElement(name, props, children); };
  return { View: host('View'), ScrollView: host('Scroll'), Pressable: host('Check'), TextInput: host('Input'),
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
    TurboModuleRegistry: { get: () => null } };
});
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: React.PropsWithChildren) => children }));
jest.mock('@/core/nav', () => ({ useGoBack: () => () => {} }));
jest.mock('@/core/platform/yandexGames', () => ({ isYandexGamesBuild: () => false }));
jest.mock('@/features/monetization/subscription', () => ({
  useSubscription: Object.assign(() => mockSubscription, { getState: () => mockSubscription }),
}));
jest.mock('@/features/monetization/entitlements', () => ({
  useEntitlements: (selector: (state: { subscriptionExpiresAt: number | null }) => unknown) => selector({ subscriptionExpiresAt: mockExpiresAt }),
}));
jest.mock('@/ui', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) { return React.createElement(name, props, children); };
  return { ...require('@/ui/theme'), AppText: host('Text'), GlassPanel: host('Panel'), Icon: () => null, WorldBackground: () => null,
    AppButton: ({ label, ...props }: { label: string }) => React.createElement('Button', props, label) };
});

const Shop = require('../shop').default;
let screen: renderer.ReactTestRenderer;
const button = (label: string) => screen.root.findAllByType('Button' as never).find((node) => node.props.children === label)!;
const emailInput = () => screen.root.findByProps({ accessibilityLabel: 'Электронная почта для чека' });
const checkbox = () => screen.root.findByProps({ accessibilityRole: 'checkbox' });

beforeEach(() => {
  mockCheckout.mockClear(); mockCancel.mockClear(); mockSync.mockClear(); mockExpiresAt = null;
  mockSubscription = {
    catalog: { available: true, mode: 'test', plan: { id: 'no_ads_30', title: 'Без рекламных пауз', amount: '99.00', currency: 'RUB', periodDays: 30, consentVersion: 'no-ads-30-v1' } },
    status: { active: false, activeUntil: null, autoRenew: false, nextPaymentAt: null, pendingPaymentId: null, serverTime: Date.now() },
    busy: false, error: null, recoveryCode: null, confirmationUrl: null,
    sync: mockSync, checkout: mockCheckout, cancel: mockCancel, restore: jest.fn(async () => true), issueRecovery: jest.fn(async () => true), resumeCheckout: jest.fn(async () => true),
  };
});
afterEach(() => { if (screen) act(() => screen.unmount()); });

test('subscription requires email and unchecked separate renewal consent before checkout', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(button('Подключить за 99 ₽').props.disabled).toBe(true);
  act(() => emailInput().props.onChangeText('qa@example.com'));
  expect(button('Подключить за 99 ₽').props.disabled).toBe(true);
  expect(mockCheckout).not.toHaveBeenCalled();
  act(() => checkbox().props.onPress());
  expect(checkbox().props['aria-checked']).toBe(true);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => button('Подключить за 99 ₽').props.onPress());
  expect(mockCheckout).toHaveBeenCalledWith('qa@example.com', true);
});

test('changed price and terms require renewed consent without losing email draft', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); });
  const previous = mockSubscription.catalog as { plan: Record<string, unknown> };
  mockSubscription = { ...mockSubscription, catalog: { ...previous, plan: { ...previous.plan, amount: '149.00', consentVersion: 'no-ads-30-v2' } } };
  act(() => emailInput().props.onChangeText('qa+new@example.com'));
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(button('Подключить за 149 ₽').props.disabled).toBe(true);
  expect(emailInput().props.value).toBe('qa+new@example.com');
});

test('expired access with pending renewal still offers working cancellation', async () => {
  mockSubscription.status = { active: false, activeUntil: Date.now() - 1, autoRenew: true, nextPaymentAt: Date.now() - 1, pendingPaymentId: 'renewal-pending', serverTime: Date.now() };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(button('Отключить автопродление').props.disabled).toBe(false);
  await act(async () => button('Отключить автопродление').props.onPress());
  expect(mockCancel).toHaveBeenCalledTimes(1);
});

test('expired access awaiting renewal shows postponed date and prevents a second checkout', async () => {
  const nextPaymentAt = Date.now() + 2 * 86_400_000;
  mockSubscription.status = { active: false, activeUntil: Date.now() - 1, autoRenew: true, nextPaymentAt, pendingPaymentId: null, serverTime: Date.now() };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(screen.root.findAllByType('Button' as never).some((node) => node.props.children === 'Подключить за 99 ₽')).toBe(false);
  expect(screen.root.findAllByType('Text' as never).some((node) => String(node.props.children).startsWith('Следующее списание: '))).toBe(true);
  expect(button('Отключить автопродление').props.disabled).toBe(false);
});
