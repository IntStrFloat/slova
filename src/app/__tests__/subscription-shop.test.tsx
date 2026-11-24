/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockCheckout = jest.fn(async (_email: string, _consented: boolean, _personalDataConsented: boolean, _source?: string, _observation?: unknown) => true);
const mockCancel = jest.fn(async () => true);
const mockSync = jest.fn(async () => {});
const mockResumeCheckout = jest.fn(async () => true);
const mockUpdateEmail = jest.fn(async (_email: string) => true);
const mockResolveMigration = jest.fn(async () => true);
const mockMigrationSupport = jest.fn();
const mockTrackSubscription = jest.fn();
const mockTrackUi = jest.fn();
const mockTrackCheckoutAction = jest.fn();
let mockSourceParams: { source?: unknown } = {};
let mockFocused = true;
let mockAppState = 'active';
const mockAppStateListeners = new Set<(next: string) => void>();
const consentText = 'Я согласен на автоматические списания согласно условиям оферты';
const personalDataConsentText = 'Я согласен на обработку персональных данных';
let mockSubscription: Record<string, unknown>;
let mockExpiresAt: number | null = null;
let mockPaidUntil: number | null = null;
let mockSubscriptionVisible = true;

jest.mock('@/core/config/monetization', () => ({
  MONETIZATION: { get subscriptionVisible() { return mockSubscriptionVisible; } },
}));
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => require('react').createElement('Redirect', props),
  useLocalSearchParams: () => mockSourceParams,
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(() => {
    if (mockFocused) return callback();
  }, [callback, mockFocused]),
}));

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) { return React.createElement(name, props, children); };
  return { View: host('View'), ScrollView: host('Scroll'), Pressable: host('Check'), TextInput: host('Input'),
    AppState: {
      get currentState() { return mockAppState; },
      addEventListener: (_event: string, listener: (next: string) => void) => {
        mockAppStateListeners.add(listener);
        return { remove: () => mockAppStateListeners.delete(listener) };
      },
    },
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
    TurboModuleRegistry: { get: () => null } };
});
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: React.PropsWithChildren) => children }));
jest.mock('@/core/nav', () => ({ useGoBack: () => () => {} }));
jest.mock('@/core/platform/yandexGames', () => ({ isYandexGamesBuild: () => false }));
jest.mock('@/features/analytics/subscription', () => ({
  normalizeSubscriptionSource: (source: unknown) => typeof source === 'string' && ['home_card', 'settings', 'post_ad'].includes(source) ? source : 'direct',
  normalizeSubscriptionReason: (reason: unknown) => ['network', 'bad_email', 'browser_unavailable'].includes(String(reason)) ? reason : 'unknown',
  trackSubscription: (...args: unknown[]) => mockTrackSubscription(...args),
  trackSubscriptionCheckoutAction: (...args: unknown[]) => mockTrackCheckoutAction(...args),
}));
jest.mock('@/features/analytics', () => ({ track: (...args: unknown[]) => mockTrackUi(...args), trackOnce: jest.fn() }));
jest.mock('@/features/monetization/subscription', () => ({
  useSubscription: Object.assign(() => mockSubscription, { getState: () => mockSubscription }),
}));
jest.mock('@/features/monetization/entitlements', () => ({
  useEntitlements: (selector: (state: { subscriptionExpiresAt: number | null; subscriptionUntil: number | null }) => unknown) => selector({ subscriptionExpiresAt: mockExpiresAt, subscriptionUntil: mockPaidUntil }),
}));
jest.mock('@/ui', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) { return React.createElement(name, props, children); };
  return { ...require('@/ui/theme'), AppText: host('Text'), GlassPanel: host('Panel'), Icon: () => null, WorldBackground: () => null,
    AppButton: ({ label, disabled, onPress, ...props }: { label: string; disabled?: boolean; onPress?: () => void }) =>
      React.createElement('Button', { ...props, disabled, onPress: disabled ? undefined : onPress }, label) };
});

const Shop = require('../shop').default;
let screen: renderer.ReactTestRenderer;
const button = (label: string) => screen.root.findAllByType('Button' as never).find((node) => node.props.children === label)!;
const pressButton = (label: string) => {
  const target = button(label);
  expect(target).toBeDefined();
  expect(target.props.disabled).not.toBe(true);
  target.props.onPress();
};
const emailInput = () => screen.root.findByProps({ accessibilityLabel: 'Электронная почта для чека' });
const checkbox = () => screen.root.findAllByType('Check' as never).filter((node) => node.props.accessibilityRole === 'checkbox')[0];
const personalDataCheckbox = () => screen.root.findAllByType('Check' as never).filter((node) => node.props.accessibilityRole === 'checkbox')[1];
const textAction = (label: string) => screen.root.findByProps({ accessibilityLabel: label });
const openCheckoutForm = () => act(() => button('Оформить подписку').props.onPress());
const openHelp = () => act(() => textAction('Восстановление и помощь').props.onPress());

beforeEach(() => {
  mockTrackSubscription.mockClear();
  mockTrackUi.mockClear();
  mockTrackCheckoutAction.mockClear();
  mockSourceParams = {};
  mockFocused = true;
  mockAppState = 'active';
  mockAppStateListeners.clear();
  mockSubscriptionVisible = true;
  mockCheckout.mockReset().mockResolvedValue(true); mockCancel.mockClear(); mockSync.mockClear(); mockExpiresAt = null; mockPaidUntil = null;
  mockResumeCheckout.mockClear(); mockUpdateEmail.mockReset().mockResolvedValue(true);
  mockResolveMigration.mockReset().mockResolvedValue(true);
  mockMigrationSupport.mockReset().mockReturnValue(null);
  mockSubscription = {
    catalog: { available: true, mode: 'test', provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova_test', plan: { id: 'no_ads_30', title: 'Без рекламных пауз', amount: '99.00', currency: 'RUB', periodDays: 30, consentVersion: 'no-ads-30-robokassa-v3', termsVersion: 'no-ads-30-robokassa-v3', privacyVersion: 'subscription-privacy-v2', consentText, userAgreementVersion: 'subscription-user-agreement-v1', personalDataConsentVersion: 'subscription-personal-data-v1', personalDataConsentText } },
    status: { active: false, activeUntil: null, autoRenew: false, nextPaymentAt: null, pendingPaymentId: null, serverTime: Date.now() },
    busy: false, error: null, recoveryCode: null, confirmationUrl: null, hasPendingCheckout: false, needsMigration: false,
    sync: mockSync, checkout: mockCheckout, cancel: mockCancel, restore: jest.fn(async () => true), issueRecovery: jest.fn(async () => true), resumeCheckout: mockResumeCheckout, updateEmail: mockUpdateEmail, resolveMigration: mockResolveMigration, migrationSupportData: mockMigrationSupport,
  };
});
afterEach(() => { if (screen) act(() => screen.unmount()); });

test('hidden subscription redirects direct visits without mounting payment UI', async () => {
  mockSubscriptionVisible = false;
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(screen.root.findByType('Redirect' as never).props.href).toBe('/');
  expect(screen.root.findAllByType('Button' as never)).toHaveLength(0);
  expect(mockSync).not.toHaveBeenCalled();
  expect(mockCheckout).not.toHaveBeenCalled();
  expect(mockTrackSubscription).not.toHaveBeenCalled();
});

test('shop views require foreground focus and count once per visit across payment-browser returns', async () => {
  mockSourceParams = { source: 'post_ad' };
  mockAppState = 'background';
  mockSubscription.catalog = { ...(mockSubscription.catalog as object), mode: 'live' };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(mockTrackSubscription).not.toHaveBeenCalled();
  const foreground = (state: string) => act(() => {
    mockAppState = state;
    mockAppStateListeners.forEach((listener) => listener(state));
  });
  foreground('active');
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_shop_viewed', { source: 'post_ad', mode: 'live' });
  foreground('background');
  foreground('active');
  act(() => screen.update(<Shop />));
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_shop_viewed')).toHaveLength(1);

  mockFocused = false;
  act(() => screen.update(<Shop />));
  foreground('background');
  foreground('active');
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_shop_viewed')).toHaveLength(1);
  mockFocused = true;
  act(() => screen.update(<Shop />));
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_shop_viewed')).toHaveLength(2);
  act(() => screen.unmount());
  expect(mockAppStateListeners.size).toBe(0);
});

test('an unfocused shop cannot report a view or hidden network errors', async () => {
  mockFocused = false;
  mockSubscription.error = 'network';
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(mockTrackSubscription).not.toHaveBeenCalled();
  mockFocused = true;
  act(() => screen.update(<Shop />));
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_shop_viewed', { source: 'direct', mode: 'test' });
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_error', { source: 'direct', mode: 'test', stage: 'shop', reason: 'network' });
});

test('offline shop entry is measurable before a catalog arrives and does not replay on catalog refresh', async () => {
  mockSourceParams = { source: 'settings' };
  mockSubscription.catalog = null;
  mockSubscription.error = 'network';
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_shop_viewed', { source: 'settings', mode: 'unknown' });
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_error', { source: 'settings', mode: 'unknown', stage: 'shop', reason: 'network' });
  mockSubscription = { ...mockSubscription, catalog: { mode: 'live', available: false }, error: null };
  act(() => screen.update(<Shop />));
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_error', { source: 'settings', mode: 'live', stage: 'shop', reason: 'catalog_unavailable' });
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_shop_viewed')).toHaveLength(1);
});

test('visible errors are sanitized and deduplicated across autosync retries within a visit', async () => {
  mockSubscription.error = 'network';
  await act(async () => { screen = renderer.create(<Shop />); });
  for (let index = 0; index < 3; index += 1) {
    mockSubscription = { ...mockSubscription, busy: true, error: null };
    act(() => screen.update(<Shop />));
    mockSubscription = { ...mockSubscription, busy: false, error: 'network' };
    act(() => screen.update(<Shop />));
  }
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_error')).toHaveLength(1);
  mockSubscription = { ...mockSubscription, error: 'bad_email' };
  act(() => screen.update(<Shop />));
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_error')).toHaveLength(2);
  mockSubscription = { ...mockSubscription, error: 'buyer@example.com https://auth.robokassa.ru/?secret=private' };
  act(() => screen.update(<Shop />));
  expect(mockTrackSubscription).toHaveBeenLastCalledWith('subscription_error', { source: 'direct', mode: 'test', stage: 'shop', reason: 'unknown' });
  expect(JSON.stringify(mockTrackSubscription.mock.calls)).not.toContain('buyer@example.com');
  expect(JSON.stringify(mockTrackSubscription.mock.calls)).not.toContain('secret=private');
});

test('form expansion is explicit and checkout retains the normalized entry source', async () => {
  mockSourceParams = { source: 'home_card' };
  mockSubscription.catalog = { ...(mockSubscription.catalog as object), mode: 'live' };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_form_opened')).toHaveLength(0);
  openCheckoutForm();
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_form_opened', { source: 'home_card', mode: 'live', amount: 99, periodDays: 30 });
  act(() => emailInput().props.onChangeText('private-payer@example.com'));
  act(() => { checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockCheckout).toHaveBeenCalledWith('private-payer@example.com', true, true, 'home_card', {
    interactionId: expect.stringMatching(/^si_/), consentIdentity: expect.any(String),
  });
  expect(mockTrackCheckoutAction).toHaveBeenCalledTimes(1);
  expect(mockTrackCheckoutAction.mock.calls[0][0].interactionId).toBe(mockCheckout.mock.calls[0][4] &&
    (mockCheckout.mock.calls[0][4] as { interactionId: string }).interactionId);
  expect(mockTrackSubscription.mock.calls.filter(([event]) => event === 'subscription_form_opened')).toHaveLength(1);
  expect(JSON.stringify(mockTrackSubscription.mock.calls)).not.toContain('private-payer@example.com');
  expect(JSON.stringify(mockTrackSubscription.mock.calls)).not.toContain(consentText);
});

test('arbitrary route parameters cannot become analytics source properties', async () => {
  mockSourceParams = { source: 'https://example.com/private?email=buyer@example.com' };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_shop_viewed', { source: 'direct', mode: 'test' });
  expect(JSON.stringify(mockTrackSubscription.mock.calls)).not.toContain('example.com');
});

test('failed document navigation reports only the safe stage and failure category', async () => {
  const openURL = require('expo-linking').openURL as jest.Mock;
  openURL.mockRejectedValueOnce(new Error('private-payer@example.com token=private'));
  await act(async () => { screen = renderer.create(<Shop />); });
  act(() => textAction('Условия подписки').props.onPress());
  await act(async () => textAction('Публичная оферта').props.onPress());
  expect(mockTrackSubscription).toHaveBeenCalledWith('subscription_error', { source: 'direct', mode: 'test', stage: 'legal', reason: 'browser_unavailable' });
  expect(JSON.stringify(mockTrackSubscription.mock.calls)).not.toContain('private-payer@example.com');
  expect(JSON.stringify(mockTrackSubscription.mock.calls)).not.toContain('token=private');
});

test('offline cold start keeps the cached paid period visible without inventing renewal status', async () => {
  mockExpiresAt = Date.now() + 86_400_000;
  mockPaidUntil = mockExpiresAt;
  mockSubscription.status = null;
  mockSubscription.error = 'network';
  await act(async () => { screen = renderer.create(<Shop />); });
  const text = screen.root.findAllByType('Text' as never).map((node) =>
    Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children)).join('\n');
  expect(text).toContain('Подписка активна');
  expect(text).toContain('Оплачено до');
  expect(text).not.toContain('Автопродление выключено');
  expect(button('Оформить подписку')).toBeUndefined();
});

test('enabled final submit validates email and both unchecked consents before checkout', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(screen.root.findAllByType('Text' as never).some((node) => node.props.children === 'Игра без рекламы')).toBe(true);
  expect(screen.root.findAllByProps({ accessibilityLabel: 'Электронная почта для чека' })).toHaveLength(0);
  openCheckoutForm();
  expect(mockCheckout).not.toHaveBeenCalled();
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(checkbox().props.accessibilityLabel).toBe(consentText);
  expect(checkbox().findAllByType('Text' as never).some((node) => node.props.children === consentText)).toBe(true);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props.accessibilityLabel).toBe(personalDataConsentText);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockTrackCheckoutAction.mock.calls.at(-1)?.[1]).toBe('empty_email');
  expect(screen.root.findAllByType('Text' as never).some((node) => node.props.children === 'Укажите почту для чека.')).toBe(true);
  act(() => emailInput().props.onChangeText('qa@example.com'));
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockTrackCheckoutAction.mock.calls.at(-1)?.[1]).toBe('consent_required');
  expect(mockCheckout).not.toHaveBeenCalled();
  act(() => checkbox().props.onPress());
  expect(checkbox().props['aria-checked']).toBe(true);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockTrackCheckoutAction.mock.calls.at(-1)?.[1]).toBe('personal_data_consent_required');
  expect(mockCheckout).not.toHaveBeenCalled();
  act(() => personalDataCheckbox().props.onPress());
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockCheckout).toHaveBeenCalledWith('qa@example.com', true, true, 'direct', {
    interactionId: expect.stringMatching(/^si_/), consentIdentity: expect.any(String),
  });
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  const calls = mockTrackCheckoutAction.mock.calls;
  expect(calls).toHaveLength(7);
  for (const index of [0, 2, 4]) {
    expect(calls[index]).toHaveLength(1);
    expect(calls[index + 1][0]).toEqual(calls[index][0]);
  }
  expect(new Set([calls[0][0].interactionId, calls[2][0].interactionId, calls[4][0].interactionId, calls[6][0].interactionId]).size).toBe(4);
  expect(JSON.stringify([mockTrackUi.mock.calls, mockTrackSubscription.mock.calls, calls])).not.toMatch(/qa@example|автоматические списания|персональных данных/);
});

test('each consent row is a full touch target and can be unchecked independently', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => emailInput().props.onChangeText('qa@example.com'));
  for (const row of [checkbox(), personalDataCheckbox()]) {
    expect(row.props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(row.props.accessibilityState).toEqual({ checked: false, disabled: false });
    act(() => row.props.onPress());
  }
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  act(() => checkbox().props.onPress());
  expect(checkbox().props.accessibilityState.checked).toBe(false);
  expect(personalDataCheckbox().props.accessibilityState.checked).toBe(true);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  act(() => checkbox().props.onPress());
  act(() => personalDataCheckbox().props.onPress());
  expect(checkbox().props.accessibilityState.checked).toBe(true);
  expect(personalDataCheckbox().props.accessibilityState.checked).toBe(false);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  expect(mockCheckout).not.toHaveBeenCalled();
});

test.each(['a@b..com', 'игрок@example.ru', 'player@пример.рф', '.player@example.ru', 'player..one@example.ru',
  'player.@example.ru', 'player@-example.ru', 'player@example-.ru', 'player@exam_ple.ru', 'player\r\n@example.ru',
  `${'a'.repeat(65)}@example.ru`, `player@${'a'.repeat(64)}.ru`])(
  'enabled submit rejects strict invalid email locally without losing consent: %s', async (email) => {
    await act(async () => { screen = renderer.create(<Shop />); });
    openCheckoutForm();
    act(() => { emailInput().props.onChangeText(email); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
    await act(async () => pressButton('Подключить за 99 ₽'));
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(mockTrackCheckoutAction).toHaveBeenCalledTimes(2);
    expect(mockTrackCheckoutAction.mock.calls[0]).toHaveLength(1);
    expect(mockTrackCheckoutAction.mock.calls[1]).toEqual([mockTrackCheckoutAction.mock.calls[0][0], 'bad_email']);
    expect(checkbox().props['aria-checked']).toBe(true);
    expect(personalDataCheckbox().props['aria-checked']).toBe(true);
    expect(screen.root.findAllByType('Text' as never).some((node) => node.props.children === 'Проверьте адрес электронной почты.')).toBe(true);
    expect(JSON.stringify([mockTrackUi.mock.calls, mockTrackSubscription.mock.calls, mockTrackCheckoutAction.mock.calls])).not.toContain(email);
  },
);

test('rapid final taps share one in-flight checkout and only one physical intent is admitted', async () => {
  let finish!: (ok: boolean) => void;
  mockCheckout.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
  act(() => { pressButton('Подключить за 99 ₽'); pressButton('Подключить за 99 ₽'); });
  expect(mockCheckout).toHaveBeenCalledTimes(1);
  expect(mockTrackCheckoutAction).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
});

test('busy and unavailable forms expose no reachable final press or validation event', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  mockSubscription = { ...mockSubscription, busy: true };
  act(() => screen.update(<Shop />));
  expect(button('Подготавливаем оплату…').props.disabled).toBe(true);
  expect(button('Подготавливаем оплату…').props.onPress).toBeUndefined();
  mockSubscription = { ...mockSubscription, busy: false, catalog: { ...(mockSubscription.catalog as object), available: false } };
  act(() => screen.update(<Shop />));
  expect(button('Подключить за 99 ₽')).toBeUndefined();
  expect(button('Подписка недоступна').props.onPress).toBeUndefined();
  expect(mockCheckout).not.toHaveBeenCalled();
  expect(mockTrackCheckoutAction).not.toHaveBeenCalled();
});

test.each([{ available: true }, { available: false }, null])('offer and privacy links remain available without accepting consent: %j', async (state) => {
  const openURL = require('expo-linking').openURL as jest.Mock;
  openURL.mockClear();
  mockSubscription.catalog = state === null ? null : { ...(mockSubscription.catalog as object), ...state };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(screen.root.findAllByProps({ accessibilityRole: 'link' })).toHaveLength(0);
  expect(textAction('Условия подписки').props.accessibilityState.expanded).toBe(false);
  act(() => textAction('Условия подписки').props.onPress());
  for (const label of ['Публичная оферта', 'Политика конфиденциальности', 'Пользовательское соглашение', 'Согласие на обработку персональных данных']) {
    expect(button(label)).toBeUndefined();
    expect(textAction(label).props.accessibilityRole).toBe('link');
    expect(textAction(label).props.style.minHeight).toBeGreaterThanOrEqual(44);
    await act(async () => textAction(label).props.onPress());
  }
  expect(openURL.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/billing/terms', '/api/billing/privacy', '/api/billing/user-agreement', '/api/billing/personal-data-consent']);
  expect(openURL.mock.calls.every(([url]) => new URL(url).protocol === 'https:')).toBe(true);
  expect(mockCheckout).not.toHaveBeenCalled();
  expect(screen.root.findAllByProps({ accessibilityRole: 'checkbox' })).toHaveLength(0);
});

test('new buyers see a compact recovery disclosure that opens the working restore form', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(screen.root.findAllByProps({ accessibilityLabel: 'Код восстановления подписки' })).toHaveLength(0);
  expect(button('Проверить оплату')).toBeUndefined();
  const disclosure = textAction('Восстановление и помощь');
  expect(disclosure.props.accessibilityState.expanded).toBe(false);
  act(() => disclosure.props.onPress());
  act(() => textAction('Код восстановления подписки').props.onChangeText('existing-recovery-code'));
  await act(async () => button('Восстановить подписку').props.onPress());
  expect(mockSubscription.restore).toHaveBeenCalledWith('existing-recovery-code');
  expect(mockCheckout).not.toHaveBeenCalled();
});

test('the initial offer keeps the price and renewal clear without forms or legal-link clutter', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  const text = screen.root.findAllByType('Text' as never).map((node) => String(node.props.children)).join('\n');
  expect(text).toContain('Без баннеров и рекламы между уровнями');
  expect(text).toContain('Реклама за бонусы — по желанию.');
  expect(text).toContain('99');
  expect(text).toContain('30');
  expect(text).toContain('Автопродление. Отмена в любой момент.');
  expect(button('Оформить подписку').props.disabled).toBe(false);
  expect(screen.root.findAllByType('Input' as never)).toHaveLength(0);
  expect(screen.root.findAllByType('Check' as never).filter((node) => ['checkbox', 'link'].includes(node.props.accessibilityRole))).toHaveLength(0);
});

test.each(['active', 'autoRenew', 'pending'])('existing %s subscriptions keep help collapsed and cancellation immediate', async (state) => {
  mockExpiresAt = state === 'active' ? Date.now() + 86_400_000 : null;
  mockSubscription.status = { active: state === 'active', activeUntil: mockExpiresAt,
    autoRenew: state !== 'pending', nextPaymentAt: mockExpiresAt,
    pendingPaymentId: state === 'pending' ? 'pending-payment' : null, serverTime: Date.now() };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(screen.root.findAllByProps({ accessibilityLabel: 'Код восстановления подписки' })).toHaveLength(0);
  expect(screen.root.findAllByProps({ accessibilityLabel: 'Новая электронная почта подписки' })).toHaveLength(0);
  expect(button('Управление вне игры')).toBeUndefined();
  expect(textAction('Восстановление и помощь').props.accessibilityState.expanded).toBe(false);
  expect(Boolean(button('Проверить оплату'))).toBe(state === 'pending');
  if (state !== 'pending') {
    await act(async () => button('Отключить автопродление').props.onPress());
    expect(mockCancel).toHaveBeenCalledTimes(1);
  }
  openHelp();
  expect(textAction('Код восстановления подписки')).toBeDefined();
  expect(button('Управление вне игры')).toBeDefined();
  expect(button('Проверить оплату')).toBeDefined();
});

test('a persisted recovery code stays reachable without forcing help open on each visit', async () => {
  mockSubscription.recoveryCode = 'saved-recovery-code';
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(screen.root.findAllByProps({ accessibilityLabel: 'Код восстановления подписки' })).toHaveLength(0);
  const code = () => screen.root.findAllByType('Text' as never).find((node) => node.props.children === 'saved-recovery-code');
  expect(code()).toBeUndefined();
  openHelp();
  expect(code()?.props.selectable).toBe(true);
  act(() => screen.unmount());
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(code()).toBeUndefined();
  expect(textAction('Восстановление и помощь').props.accessibilityState.expanded).toBe(false);
});

test('an issued recovery code is visible within help that the user already opened', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openHelp();
  mockSubscription.recoveryCode = 'new-issued-recovery-code';
  act(() => textAction('Код восстановления подписки').props.onChangeText('old-code'));
  const code = screen.root.findAllByType('Text' as never).find((node) => node.props.children === 'new-issued-recovery-code');
  expect(code?.props.selectable).toBe(true);
  expect(textAction('Код восстановления подписки')).toBeDefined();
});

test.each([{ busy: true, error: null, label: 'Загружаем условия…' }, { busy: false, error: 'network', label: 'Подписка недоступна' }])(
  'missing catalog gives loading/retry instead of a purchase: %j', async ({ busy, error, label }) => {
    mockSubscription.catalog = null;
    mockSubscription.busy = busy;
    mockSubscription.error = error;
    await act(async () => { screen = renderer.create(<Shop />); });
    expect(button('Подключить за 99 ₽')).toBeUndefined();
    expect(screen.root.findAllByProps({ accessibilityLabel: 'Электронная почта для чека' })).toHaveLength(0);
    expect(button(label).props.disabled).toBe(true);
    expect(button(label).props.onPress).toBeUndefined();
    expect(textAction('Повторить загрузку').props.disabled).toBe(busy);
    if (!busy) {
      await act(async () => textAction('Повторить загрузку').props.onPress());
      expect(mockSync).toHaveBeenCalledTimes(2);
    }
    expect(mockCheckout).not.toHaveBeenCalled();
  },
);

test('disabled billing clearly stays unavailable and offers only a terms refresh', async () => {
  mockSubscription.catalog = { ...(mockSubscription.catalog as object), available: false };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(button('Подключить за 99 ₽')).toBeUndefined();
  expect(screen.root.findAllByProps({ accessibilityRole: 'checkbox' })).toHaveLength(0);
  expect(screen.root.findAllByType('Text' as never).some((node) => String(node.props.children).includes('Покупка подписки пока недоступна'))).toBe(true);
  expect(button('Подписка недоступна').props.disabled).toBe(true);
  await act(async () => textAction('Обновить условия').props.onPress());
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockCheckout).not.toHaveBeenCalled();
});

test('reopening the purchase screen never restores a previous consent selection', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
  expect(checkbox().props['aria-checked']).toBe(true);
  act(() => screen.unmount());
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => emailInput().props.onChangeText('qa@example.com'));
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockTrackCheckoutAction.mock.calls.at(-1)?.[1]).toBe('consent_required');
  expect(mockCheckout).not.toHaveBeenCalled();
});

test.each([{ consentVersion: 'consent-v4' }, { termsVersion: 'terms-v4' }, { privacyVersion: 'privacy-v3' },
  { userAgreementVersion: 'agreement-v2' }, { personalDataConsentVersion: 'data-v2' }, { personalDataConsentText: `${personalDataConsentText}.` },
  { consentText: `${consentText}.` }, { periodDays: 31 }])('changed legal terms or payment schedule require renewed consent: %j', async (change) => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
  const previous = mockSubscription.catalog as { plan: Record<string, unknown> };
  mockSubscription = { ...mockSubscription, catalog: { ...previous, plan: { ...previous.plan, ...change } } };
  act(() => emailInput().props.onChangeText('qa+new@example.com'));
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockCheckout).not.toHaveBeenCalled();
  expect(mockTrackCheckoutAction.mock.calls.at(-1)?.[1]).toBe('consent_required');
});

test('restoring a previous catalog cannot revive an earlier consent selection', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
  const previous = mockSubscription.catalog as { plan: Record<string, unknown> };
  mockSubscription = { ...mockSubscription, catalog: { ...previous, plan: { ...previous.plan, privacyVersion: 'privacy-v2' } } };
  act(() => emailInput().props.onChangeText('qa+new@example.com'));
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  mockSubscription = { ...mockSubscription, catalog: previous };
  act(() => emailInput().props.onChangeText('qa@example.com'));
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockCheckout).not.toHaveBeenCalled();
});

test('changed price and terms require renewed consent without losing email draft', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
  const previous = mockSubscription.catalog as { plan: Record<string, unknown> };
  mockSubscription = { ...mockSubscription, catalog: { ...previous, plan: { ...previous.plan, amount: '149.00', consentVersion: 'no-ads-30-v2' } } };
  act(() => emailInput().props.onChangeText('qa+new@example.com'));
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(button('Подключить за 149 ₽').props.disabled).toBe(false);
  expect(emailInput().props.value).toBe('qa+new@example.com');
  await act(async () => pressButton('Подключить за 149 ₽'));
  expect(mockCheckout).not.toHaveBeenCalled();
});

test.each([{ provider: 'changed-provider' }, { protocol: 'robokassa-v4' }, { merchantLogin: 'changed-merchant' }])(
  'changed payment provider binding requires renewed consent: %j', async (change) => {
    await act(async () => { screen = renderer.create(<Shop />); });
    openCheckoutForm();
    act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
    mockSubscription = { ...mockSubscription, catalog: { ...(mockSubscription.catalog as object), ...change } };
    act(() => emailInput().props.onChangeText('qa+new@example.com'));
    expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
    expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
    await act(async () => pressButton('Подключить за 99 ₽'));
    expect(mockCheckout).not.toHaveBeenCalled();
  },
);

test('the purchase screen keeps unresolved legacy payments blocked', async () => {
  mockSubscription.hasPendingCheckout = true;
  mockSubscription.needsMigration = true;
  mockSubscription.error = 'billing_provider_migration_required';
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(button('Подключить за 99 ₽')).toBeUndefined();
  const text = screen.root.findAllByType('Text' as never).map((node) => String(node.props.children)).join('\n');
  expect(text).toContain('поддержку');
  expect(mockCheckout).not.toHaveBeenCalled();
  expect(button('Вернуться к оплате')).toBeUndefined();
  expect(button('Проверить предыдущую оплату').props.disabled).toBe(false);
});

test('expanded checkout keeps concise billing terms and the Russian-card limitation', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  const text = screen.root.findAllByType('Text' as never).map((node) => String(node.props.children)).join('\n');
  expect(text).toContain('Первый платёж — при подключении.');
  expect(text).toContain('Автопродление. Отмена в любой момент.');
  expect(text).toContain('Карта российского банка');
  expect(text).not.toContain('Робокасса — оплата в браузере');
  expect(text).not.toContain('Перед продлением напомним');
  expect(screen.root.findAllByType('Check' as never).filter((node) => node.props.accessibilityRole === 'link')).toHaveLength(4);
  expect(screen.root.findAllByProps({ accessibilityLabel: 'Условия подписки' })).toHaveLength(0);
});

test('subscription dates explicitly use Moscow time', async () => {
  const until = Date.UTC(2030, 0, 2, 12, 0);
  mockExpiresAt = until;
  mockSubscription.status = { active: true, activeUntil: until, autoRenew: true, nextPaymentAt: until, pendingPaymentId: null, serverTime: Date.now() };
  const formatting = jest.spyOn(Date.prototype, 'toLocaleString');
  const dateFormatting = jest.spyOn(Date.prototype, 'toLocaleDateString');
  try {
    await act(async () => { screen = renderer.create(<Shop />); });
    const text = screen.root.findAllByType('Text' as never).map((node) => String(node.props.children)).join('\n');
    expect(text).toContain('Оплачено до ');
    expect(text).toContain('2 января 2030 г.');
    expect(text).not.toContain('15:00');
    expect(text).not.toContain('Следующее списание:');
    expect(dateFormatting).toHaveBeenCalledWith('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long' });
    openHelp();
    const details = screen.root.findAllByType('Text' as never).map((node) => String(node.props.children)).join('\n');
    expect(details).toContain('Следующее списание:');
    expect(details.match(/15:00 МСК/g)).toHaveLength(1);
    expect(formatting).toHaveBeenCalledWith('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'medium', timeStyle: 'short' });
  } finally { formatting.mockRestore(); dateFormatting.mockRestore(); }
});

test('safe migration resolution requires fresh consent before any new checkout', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  openCheckoutForm();
  act(() => { emailInput().props.onChangeText('qa@example.com'); checkbox().props.onPress(); personalDataCheckbox().props.onPress(); });
  mockSubscription = { ...mockSubscription, hasPendingCheckout: true, needsMigration: true, error: 'billing_provider_migration_required' };
  act(() => emailInput().props.onChangeText('qa+new@example.com'));
  mockResolveMigration.mockImplementationOnce(async () => {
    mockSubscription = { ...mockSubscription, hasPendingCheckout: false, needsMigration: false, error: null };
    return true;
  });
  await act(async () => button('Проверить предыдущую оплату').props.onPress());
  expect(mockResolveMigration).toHaveBeenCalledTimes(1);
  expect(checkbox().props['aria-checked']).toBe(false);
  expect(personalDataCheckbox().props['aria-checked']).toBe(false);
  expect(button('Подключить за 99 ₽').props.disabled).toBe(false);
  await act(async () => pressButton('Подключить за 99 ₽'));
  expect(mockCheckout).not.toHaveBeenCalled();
});

test('migration support JSON is selectable only after explicitly opening the disclosure', async () => {
  const support = { userId: 'player-one', draft: { requestId: '12345678-1234-4123-8123-123456789abc', paymentId: 'legacy-payment', provider: 'yookassa', protocol: null, merchantLogin: null, mode: null },
    target: { provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova_test', mode: 'test' } };
  mockSubscription.hasPendingCheckout = true;
  mockSubscription.needsMigration = true;
  mockMigrationSupport.mockReturnValue(support);
  await act(async () => { screen = renderer.create(<Shop />); });
  const supportText = () => screen.root.findAllByType('Text' as never).find((node) => typeof node.props.children === 'string' && node.props.children.includes('"userId"'));
  expect(supportText()).toBeUndefined();
  act(() => button('Данные для поддержки').props.onPress());
  expect(supportText()?.props.selectable).toBe(true);
  expect(JSON.parse(supportText()!.props.children)).toEqual(support);
  act(() => button('Скрыть данные для поддержки').props.onPress());
  expect(supportText()).toBeUndefined();
});

test('ordinary subscription screen does not offer migration support data', async () => {
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(button('Данные для поддержки')).toBeUndefined();
  expect(mockMigrationSupport).not.toHaveBeenCalled();
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

test.each([true, false])('a persisted checkout can resume when new sales are available=%s', async (available) => {
  mockSubscription.catalog = { ...(mockSubscription.catalog as object), available };
  mockSubscription.hasPendingCheckout = true;
  mockSubscription.status = { active: false, activeUntil: null, autoRenew: false, nextPaymentAt: null, pendingPaymentId: 'payment-pending', serverTime: Date.now() };
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(button('Подключить за 99 ₽')).toBeUndefined();
  expect(button('Вернуться к оплате').props.disabled).toBe(false);
  const text = screen.root.findAllByType('Text' as never).map((node) => String(node.props.children)).join('\n');
  expect(text).toContain('Начатое списание может завершиться и после отмены автопродления.');
  await act(async () => button('Вернуться к оплате').props.onPress());
  expect(mockResumeCheckout).toHaveBeenCalledTimes(1);
  expect(mockCheckout).not.toHaveBeenCalled();
});

test('an unknown checkout outcome offers resume without asking for a new purchase', async () => {
  mockSubscription.hasPendingCheckout = true;
  await act(async () => { screen = renderer.create(<Shop />); });
  expect(button('Подключить за 99 ₽')).toBeUndefined();
  expect(button('Вернуться к оплате').props.disabled).toBe(false);
});

test('an existing subscription can correct email and retains the draft after a failed save', async () => {
  mockExpiresAt = Date.now() + 86_400_000;
  mockSubscription.status = { active: true, activeUntil: mockExpiresAt, autoRenew: true, nextPaymentAt: mockExpiresAt, pendingPaymentId: null, serverTime: Date.now() };
  mockUpdateEmail.mockResolvedValueOnce(false);
  await act(async () => { screen = renderer.create(<Shop />); });
  openHelp();
  const correctedEmailInput = () => screen.root.findByProps({ accessibilityLabel: 'Новая электронная почта подписки' });
  expect(button('Сохранить почту').props.disabled).toBe(true);
  act(() => correctedEmailInput().props.onChangeText('corrected@example.com'));
  await act(async () => button('Сохранить почту').props.onPress());
  expect(mockUpdateEmail).toHaveBeenCalledWith('corrected@example.com');
  expect(correctedEmailInput().props.value).toBe('corrected@example.com');
  await act(async () => button('Сохранить почту').props.onPress());
  expect(correctedEmailInput().props.value).toBe('');
  expect(mockCheckout).not.toHaveBeenCalled();
});
