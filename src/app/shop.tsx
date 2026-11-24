import * as Linking from 'expo-linking';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ENV } from '@/core/config/env';
import { MONETIZATION } from '@/core/config/monetization';
import { useGoBack } from '@/core/nav';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { track } from '@/features/analytics';
import { normalizeSubscriptionReason, normalizeSubscriptionSource, trackSubscription, trackSubscriptionCheckoutAction } from '@/features/analytics/subscription';
import { useSubscription } from '@/features/monetization/subscription';
import { subscriptionConsentIdentity, validateCheckoutInput, type CheckoutInputValidation } from '@/features/monetization/checkoutValidation';
import { useEntitlements } from '@/features/monetization/entitlements';
import { newMonetizationId } from '@/features/monetization/adTelemetry';
import { AppButton, AppText, colors, GlassPanel, radius, WorldBackground } from '@/ui';

function dateLabel(timestamp: number) {
  return `${new Date(timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'medium', timeStyle: 'short' })} МСК`;
}

function paidUntilLabel(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long' });
}

function errorMessage(code: string): string {
  if (code === 'billing_provider_migration_required') return 'Предыдущая оплата требует проверки после смены платёжного сервиса. Нажмите «Проверить предыдущую оплату». Если проверка недоступна, обратитесь в поддержку.';
  if (code === 'billing_migration_unresolved') return 'Статус предыдущей оплаты пока не подтверждён. Обратитесь в поддержку; новую оплату оформлять не нужно.';
  if (code === 'billing_client_update_required') return 'Для оплаты обновите игру до последней версии.';
  if (code === 'billing_personal_data_consent_required') return 'Подтвердите согласие на обработку персональных данных.';
  if (/consent/.test(code)) return 'Подтвердите согласие на автоматические списания по условиям оферты.';
  if (code === 'billing_email_change_pending') return 'Почту можно изменить после завершения текущего платежа. Нажмите «Проверить оплату».';
  if (/email/.test(code)) return 'Проверьте адрес электронной почты.';
  if (/recovery|restore/.test(code)) return 'Не удалось восстановить подписку. Проверьте код; если код потерян, обратитесь в поддержку.';
  if (/manual_reconciliation/.test(code)) return 'Результат платежа требует проверки поддержкой. Повторная оплата не нужна.';
  if (/pending/.test(code)) return 'Платёж ещё проверяется. Попробуйте проверить оплату позже.';
  if (/canceled/.test(code)) return 'Оплата отменена. Можно попробовать снова.';
  if (/already_subscribed|subscription_active/.test(code)) return 'Подписка уже действует. Нажмите «Проверить оплату».';
  if (/rate_limited/.test(code)) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
  if (/disabled|mode_conflict/.test(code)) return 'Покупка сейчас недоступна. Играть можно как обычно.';
  if (/confirmation|browser/.test(code)) return 'Не удалось открыть оплату. Попробуйте вернуться к оплате позже.';
  return 'Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.';
}

function validationMessage(result: Exclude<CheckoutInputValidation, 'accepted'>): string {
  if (result === 'empty_email') return 'Укажите почту для чека.';
  if (result === 'bad_email') return 'Проверьте адрес электронной почты.';
  if (result === 'personal_data_consent_required') return 'Подтвердите согласие на обработку персональных данных.';
  return 'Подтвердите согласие на автоматические списания по условиям оферты.';
}

export default function Shop() {
  return MONETIZATION.subscriptionVisible ? <SubscriptionShop /> : <Redirect href="/" />;
}

function ConsentMark({ checked }: { checked: boolean }) {
  return (
    <View accessible={false} pointerEvents="none" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 5, borderWidth: 2, borderColor: checked ? colors.playGreenDark : colors.brown, backgroundColor: checked ? colors.playGreenDark : colors.tile, alignItems: 'center', justifyContent: 'center' }}>
      {checked ? <View style={{ width: 9, height: 15, borderRightWidth: 3, borderBottomWidth: 3, borderColor: colors.cream, transform: [{ rotate: '45deg' }], marginTop: -3 }} /> : null}
    </View>
  );
}

function SubscriptionShop() {
  const goBack = useGoBack();
  const params = useLocalSearchParams<{ source?: string | string[] }>();
  const source = normalizeSubscriptionSource(params.source);
  const subscription = useSubscription();
  const [email, setEmail] = useState('');
  const [checkoutExpanded, setCheckoutExpanded] = useState(false);
  const [checkoutValidation, setCheckoutValidation] = useState<Exclude<CheckoutInputValidation, 'accepted'> | null>(null);
  const checkoutInFlight = useRef(false);
  const [acceptedTerms, setAcceptedTerms] = useState<string | null>(null);
  const [acceptedPersonalDataTerms, setAcceptedPersonalDataTerms] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [replacementEmail, setReplacementEmail] = useState('');
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);
  const [legalExpanded, setLegalExpanded] = useState(false);
  const [showMigrationSupport, setShowMigrationSupport] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { catalog, status, busy, error, recoveryCode, hasPendingCheckout, needsMigration } = subscription;
  const plan = catalog?.plan;
  const consentKey = subscriptionConsentIdentity(catalog);
  const [previousConsentKey, setPreviousConsentKey] = useState(consentKey);
  if (previousConsentKey !== consentKey) {
    setPreviousConsentKey(consentKey);
    setAcceptedTerms(null);
    setAcceptedPersonalDataTerms(null);
    setCheckoutValidation(null);
  }
  const consented = consentKey !== null && acceptedTerms === consentKey;
  const personalDataConsented = consentKey !== null && acceptedPersonalDataTerms === consentKey;
  const supported = !isYandexGamesBuild();
  const migrationSupport = supported && needsMigration ? subscription.migrationSupportData() : null;
  const active = useEntitlements((state) => state.subscriptionExpiresAt !== null && state.subscriptionExpiresAt > Date.now());
  const cachedPaidUntil = useEntitlements((state) => state.subscriptionUntil);
  const paidUntil = status?.activeUntil ?? cachedPaidUntil;
  const hasSubscription = active || status?.activeUntil != null || Boolean(status?.pendingPaymentId || status?.autoRenew);
  const paymentNeedsCheck = Boolean(hasPendingCheckout || status?.pendingPaymentId || (error && hasSubscription));
  const showOffer = supported && !active && !status?.autoRenew && !status?.pendingPaymentId && !hasPendingCheckout;
  const canPurchase = showOffer && Boolean(plan && catalog?.available);
  const paymentTerms = plan ? `Подписка «${plan.title}»: ${Number(plan.amount).toLocaleString('ru-RU')} ₽ каждые ${plan.periodDays} дней. Первый платёж — при подключении, следующие — до отключения автопродления.` : '';

  const visit = useRef({ focused: false, viewed: false, errors: new Set<string>(), source });
  const latest = useRef({ catalog, busy, error });
  const reportVisibleState = useCallback(() => {
    const current = visit.current;
    if (!current.focused || AppState.currentState !== 'active') return;
    const state = latest.current;
    const properties = { source: current.source, mode: state.catalog?.mode ?? 'unknown' };
    if (!current.viewed) {
      current.viewed = true;
      trackSubscription('subscription_shop_viewed', properties);
    }
    // Polling temporarily clears errors while loading. Keep a per-visit set so
    // the same visible failure cannot inflate the funnel on every retry.
    if (state.busy) return;
    const reason = state.error ? normalizeSubscriptionReason(state.error)
      : state.catalog && !state.catalog.available ? 'catalog_unavailable' : null;
    if (reason && !current.errors.has(reason)) {
      current.errors.add(reason);
      trackSubscription('subscription_error', { ...properties, stage: 'shop', reason });
    }
  }, []);

  useEffect(() => {
    latest.current = { catalog, busy, error };
    reportVisibleState();
  }, [catalog, busy, error, reportVisibleState]);

  useFocusEffect(useCallback(() => {
    if (!supported) return;
    visit.current = { focused: true, viewed: false, errors: new Set<string>(), source };
    reportVisibleState();
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') reportVisibleState();
    });
    return () => {
      visit.current.focused = false;
      listener.remove();
    };
  }, [source, supported, reportVisibleState]));

  useEffect(() => { if (supported) void useSubscription.getState().sync(); }, [supported]);

  const recordAction = (elementId: string, outcome = 'selected') => {
    track('ui_action', { screen: 'shop', element_id: elementId, interaction_id: newMonetizationId('si'),
      action: 'press', outcome, entry_source: source });
  };

  const openPage = async (path: 'terms' | 'privacy' | 'user-agreement' | 'personal-data-consent' | 'manage') => {
    recordAction(`legal_${path.replaceAll('-', '_')}`);
    try {
      const url = new URL(`/api/billing/${path}`, ENV.apiUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_url');
      await Linking.openURL(url.href);
    } catch {
      setNotice('Страница сейчас недоступна. Попробуйте позже.');
      trackSubscription('subscription_error', { source, mode: catalog?.mode ?? 'unknown', stage: 'legal', reason: 'browser_unavailable' });
    }
  };
  const cancel = async () => {
    if (await subscription.cancel()) setNotice('Автопродление отключено. Оплаченный срок сохранён.');
  };
  const updateEmail = async () => {
    setNotice(null);
    if (await subscription.updateEmail(replacementEmail)) {
      setReplacementEmail('');
      setNotice('Почта сохранена для следующих чеков и уведомлений о продлении.');
    }
  };
  const resolveMigration = async () => {
    setNotice(null);
    if (await subscription.resolveMigration()) {
      setAcceptedTerms(null);
      setAcceptedPersonalDataTerms(null);
      setNotice('Предыдущая попытка проверена. Новая оплата потребует вашего согласия.');
    }
  };
  const checkout = () => {
    if (!canPurchase || busy || checkoutInFlight.current) return;
    const interactionId = newMonetizationId('si');
    const context = { interactionId, source, mode: catalog?.mode };
    trackSubscriptionCheckoutAction(context);
    setNotice(null);
    const validation = validateCheckoutInput(email, consented, personalDataConsented);
    if (validation !== 'accepted') {
      setCheckoutValidation(validation);
      trackSubscriptionCheckoutAction(context, validation);
      return;
    }
    setCheckoutValidation(null);
    checkoutInFlight.current = true;
    setAcceptedTerms(null);
    setAcceptedPersonalDataTerms(null);
    void subscription.checkout(email, true, true, source, { interactionId, consentIdentity: consentKey })
      .finally(() => { checkoutInFlight.current = false; });
  };
  const legalDocuments = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      <Pressable accessibilityRole="link" accessibilityLabel="Публичная оферта" onPress={() => { void openPage('terms'); }} style={textActionStyle}>
        <AppText style={linkTextStyle}>Оферта</AppText>
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="Политика конфиденциальности" onPress={() => { void openPage('privacy'); }} style={textActionStyle}>
        <AppText style={linkTextStyle}>Конфиденциальность</AppText>
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="Пользовательское соглашение" onPress={() => { void openPage('user-agreement'); }} style={textActionStyle}>
        <AppText style={linkTextStyle}>Соглашение</AppText>
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="Согласие на обработку персональных данных" onPress={() => { void openPage('personal-data-consent'); }} style={textActionStyle}>
        <AppText style={linkTextStyle}>Обработка данных</AppText>
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}><AppButton label="На карту" variant="cream" icon="back" onPress={goBack} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
          <AppText preset="display">Игра без рекламы</AppText>
          <GlassPanel tone="cream" style={{ gap: 14 }}>
            {!active ? <AppText preset="title" style={{ color: colors.brown }}>Без баннеров и рекламы между уровнями</AppText> : null}
            {!active ? <AppText style={{ color: colors.brown, fontSize: 14 }}>Реклама за бонусы — по желанию.</AppText> : null}
            {!supported ? <AppText style={{ color: colors.brown }}>Покупки в этой версии игры недоступны.</AppText> : null}
            {catalog?.mode === 'test' && catalog.available ? <AppText style={{ color: colors.plum }}>Тестовый режим: реальные деньги не списываются.</AppText> : null}
            {supported && catalog && !catalog.available ? <AppText style={{ color: colors.brown }}>Покупка подписки пока недоступна. Играть можно как обычно.</AppText> : null}
            {active && paidUntil ? (
              <>
                <AppText preset="label" style={{ color: colors.playGreenDark }}>Подписка активна</AppText>
                <AppText selectable style={{ color: colors.brown }}>Оплачено до {paidUntilLabel(paidUntil)}</AppText>
                {status ? <AppText style={{ color: colors.brown }}>{status.autoRenew ? 'Автопродление включено.' : 'Автопродление выключено. Списаний не будет.'}</AppText> : null}
              </>
            ) : null}
            {status?.autoRenew && !active ? <AppText selectable style={{ color: colors.brown }}>{status.nextPaymentAt ? `Следующее списание: ${dateLabel(status.nextPaymentAt)}.` : 'Дата продления придёт на почту.'}</AppText> : null}
            {status?.autoRenew ? <AppButton label="Отключить автопродление" variant="cream" disabled={busy} onPress={() => { void cancel(); }} /> : null}
            {showOffer && plan ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
                  <AppText selectable preset="display" style={{ color: colors.plum }}>{Number(plan.amount).toLocaleString('ru-RU')} ₽</AppText>
                  <AppText style={{ color: colors.brown }}>каждые {plan.periodDays} дней</AppText>
                </View>
                <AppText style={{ color: colors.brown, fontSize: 14 }}>Автопродление. Отмена в любой момент.</AppText>
              </>
            ) : null}
            {canPurchase && plan ? (checkoutExpanded ? (
              <>
                <AppText style={{ color: colors.brown, fontSize: 14 }}>Первый платёж — при подключении.</AppText>
                <AppText style={{ color: colors.brown, fontSize: 14 }}>Карта российского банка</AppText>
                <AppText preset="label" style={{ color: colors.brown }}>Почта для чека</AppText>
                <TextInput
                  value={email} onChangeText={(value) => { setEmail(value); setCheckoutValidation(null); }} editable={!busy} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                  textContentType="emailAddress" accessibilityLabel="Электронная почта для чека" placeholder="Электронная почта" placeholderTextColor={colors.brown}
                  style={inputStyle}
                />
                <Pressable disabled={busy} accessibilityRole="checkbox" aria-checked={consented} accessibilityLabel={plan.consentText} accessibilityHint={paymentTerms} accessibilityState={{ checked: consented, disabled: busy }} onPress={() => { recordAction('recurring_consent', consented ? 'disabled' : 'enabled'); setCheckoutValidation(null); setAcceptedTerms((value) => value === consentKey ? null : consentKey); }} style={consentRowStyle}>
                  <ConsentMark checked={consented} />
                  <AppText style={{ flex: 1, fontSize: 14, color: colors.brown }}>{plan.consentText}</AppText>
                </Pressable>
                <Pressable disabled={busy} accessibilityRole="checkbox" aria-checked={personalDataConsented} accessibilityLabel={plan.personalDataConsentText} accessibilityState={{ checked: personalDataConsented, disabled: busy }} onPress={() => { recordAction('personal_data_consent', personalDataConsented ? 'disabled' : 'enabled'); setCheckoutValidation(null); setAcceptedPersonalDataTerms((value) => value === consentKey ? null : consentKey); }} style={consentRowStyle}>
                  <ConsentMark checked={personalDataConsented} />
                  <AppText style={{ flex: 1, fontSize: 14, color: colors.brown }}>{plan.personalDataConsentText}</AppText>
                </Pressable>
                {legalDocuments}
                {checkoutValidation ? <AppText accessibilityLiveRegion="polite" style={{ color: colors.brown }}>{validationMessage(checkoutValidation)}</AppText> : null}
                <AppButton label={busy ? 'Подготавливаем оплату…' : `Подключить за ${Number(plan.amount).toLocaleString('ru-RU')} ₽`} variant="cream" disabled={busy} onPress={checkout} />
              </>
            ) : <AppButton label="Оформить подписку" variant="cream" disabled={busy} onPress={() => {
              if (busy) return;
              setCheckoutExpanded(true);
              trackSubscription('subscription_form_opened', { source, mode: catalog?.mode ?? 'unknown', amount: Number(plan.amount), periodDays: plan.periodDays });
            }} />)
              : showOffer ? <AppButton label={!catalog && !error ? 'Загружаем условия…' : 'Подписка недоступна'} variant="cream" disabled onPress={checkout} /> : null}
            {hasPendingCheckout && needsMigration ? <AppButton label="Проверить предыдущую оплату" variant="cream" disabled={busy} onPress={() => { void resolveMigration(); }} /> : null}
            {hasPendingCheckout && !needsMigration && !active ? <AppButton label="Вернуться к оплате" variant="cream" disabled={busy} onPress={() => { setNotice(null); void subscription.resumeCheckout(); }} /> : null}
            {status?.pendingPaymentId || hasPendingCheckout ? <AppText style={{ color: colors.brown, fontSize: 14 }}>Проверяем платёж. Повторно покупать не нужно.{status?.pendingPaymentId ? ' Начатое списание может завершиться и после отмены автопродления.' : ''}</AppText> : null}
            {supported && paymentNeedsCheck ? <AppButton label={busy ? 'Проверяем…' : 'Проверить оплату'} variant="cream" disabled={busy} onPress={() => { setNotice(null); void subscription.sync('manual'); }} /> : null}
            {supported && !hasSubscription && !paymentNeedsCheck && !catalog?.available ? (
              <Pressable accessibilityRole="button" accessibilityLabel={catalog ? 'Обновить условия' : 'Повторить загрузку'} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { setNotice(null); void subscription.sync('manual'); }} style={textActionStyle}>
                <AppText style={linkTextStyle}>{catalog ? 'Обновить условия' : 'Повторить загрузку'}</AppText>
              </Pressable>
            ) : null}
            {migrationSupport ? (
              <>
                <AppButton label={showMigrationSupport ? 'Скрыть данные для поддержки' : 'Данные для поддержки'} variant="cream" onPress={() => setShowMigrationSupport((shown) => !shown)} />
                {showMigrationSupport ? (
                  <>
                    <AppText selectable preset="label" style={{ color: colors.plum }}>Обращение #{migrationSupport.draft.requestId.slice(-8).toUpperCase()}</AppText>
                    <AppText style={{ color: colors.brown }}>Скопируйте текст ниже и передайте в поддержку для проверки предыдущей оплаты.</AppText>
                    <AppText selectable style={{ fontSize: 14, lineHeight: 20, color: colors.brown }}>{JSON.stringify(migrationSupport, null, 2)}</AppText>
                  </>
                ) : null}
              </>
            ) : null}
            {supported && (!canPurchase || !checkoutExpanded) ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Условия подписки" accessibilityState={{ expanded: legalExpanded }} onPress={() => { recordAction('legal_details', legalExpanded ? 'collapsed' : 'expanded'); setLegalExpanded((expanded) => !expanded); }} style={textActionStyle}>
                  <AppText style={linkTextStyle}>{legalExpanded ? 'Условия подписки −' : 'Условия подписки +'}</AppText>
                </Pressable>
                {legalExpanded ? legalDocuments : null}
              </>
            ) : null}
          </GlassPanel>
          {error || notice ? <AppText selectable accessibilityLiveRegion="polite" style={{ color: error ? colors.amber : colors.text }}>{error ? errorMessage(error) : notice}</AppText> : null}
          {supported ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Восстановление и помощь" accessibilityState={{ expanded: recoveryExpanded }} onPress={() => { recordAction('recovery_details', recoveryExpanded ? 'collapsed' : 'expanded'); setRecoveryExpanded((expanded) => !expanded); }} style={{ ...textActionStyle, alignSelf: 'center' }}>
              <AppText style={photoLinkTextStyle}>{recoveryExpanded ? 'Восстановление и помощь −' : 'Восстановление и помощь +'}</AppText>
            </Pressable>
          ) : null}
          {supported && recoveryExpanded ? (
            <GlassPanel tone="cream" style={{ gap: 12 }}>
              {active && status?.autoRenew ? <AppText selectable style={{ color: colors.brown }}>{status.nextPaymentAt ? `Следующее списание: ${dateLabel(status.nextPaymentAt)}.` : 'Дата продления придёт на почту.'}</AppText> : null}
              {hasSubscription && !paymentNeedsCheck ? <AppButton label={busy ? 'Проверяем…' : 'Проверить оплату'} variant="cream" disabled={busy} onPress={() => { setNotice(null); void subscription.sync('manual'); }} /> : null}
              {hasSubscription ? (
                <>
                  <AppText preset="label" style={{ color: colors.brown }}>Почта для чеков и уведомлений</AppText>
                  <AppText style={{ color: colors.brown, fontSize: 14 }}>Для следующих чеков и напоминаний.</AppText>
                  <TextInput
                    value={replacementEmail} onChangeText={setReplacementEmail} editable={!busy} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                    textContentType="emailAddress" accessibilityLabel="Новая электронная почта подписки" placeholder="Новая электронная почта" placeholderTextColor={colors.brown}
                    maxLength={254} style={inputStyle}
                  />
                  <AppButton label="Сохранить почту" variant="cream" disabled={busy || !replacementEmail.trim()} onPress={() => { void updateEmail(); }} />
                </>
              ) : null}
              <AppText style={{ color: colors.brown, fontSize: 14 }}>Код поможет вернуть подписку после переустановки или на другом телефоне.</AppText>
              {recoveryCode ? <AppText selectable style={{ fontVariant: ['tabular-nums'], color: colors.plum }}>{recoveryCode}</AppText> : null}
              {active || status?.pendingPaymentId || status?.autoRenew ? (
                <>
                  <AppText style={{ color: colors.brown, fontSize: 14 }}>Новый код заменит прежний. Сохраните его.</AppText>
                  <AppButton label="Получить новый код" variant="cream" disabled={busy} onPress={() => { void subscription.issueRecovery(); }} />
                </>
              ) : null}
              <TextInput value={restoreCode} onChangeText={setRestoreCode} editable={!busy} autoCapitalize="none" autoCorrect={false} placeholder="Код восстановления" placeholderTextColor={colors.brown} accessibilityLabel="Код восстановления подписки" maxLength={128} style={inputStyle} />
              <AppButton label="Восстановить подписку" variant="cream" disabled={busy || !restoreCode.trim()} onPress={() => { void subscription.restore(restoreCode).then((ok) => { if (ok) { setRestoreCode(''); setNotice('Подписка восстановлена.'); } }); }} />
              <AppButton label="Управление вне игры" variant="cream" onPress={() => { void openPage('manage'); }} />
            </GlassPanel>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const inputStyle = { borderRadius: radius.md, borderWidth: 1, borderColor: colors.goldBorder, backgroundColor: colors.creamDeep, color: colors.brown, padding: 14, minHeight: 52, fontSize: 16 };
const consentRowStyle = { minHeight: 48, flexDirection: 'row' as const, gap: 12, alignItems: 'center' as const, paddingVertical: 10 };
const textActionStyle = { minHeight: 44, justifyContent: 'center' as const, paddingHorizontal: 6, paddingVertical: 8 };
const linkTextStyle = { color: colors.brown, fontSize: 14, textDecorationLine: 'underline' as const };
const photoLinkTextStyle = { ...linkTextStyle, color: colors.textMuted };
