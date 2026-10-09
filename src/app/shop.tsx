import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ENV } from '@/core/config/env';
import { useGoBack } from '@/core/nav';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { useSubscription } from '@/features/monetization/subscription';
import { useEntitlements } from '@/features/monetization/entitlements';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

function dateLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(code: string): string {
  if (/consent/.test(code)) return 'Подтвердите согласие с условиями подписки и автопродлением.';
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

export default function Shop() {
  const goBack = useGoBack();
  const subscription = useSubscription();
  const [email, setEmail] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { catalog, status, busy, error, recoveryCode, confirmationUrl } = subscription;
  const plan = catalog?.plan;
  const consentKey = plan ? [catalog.mode, plan.id, plan.consentVersion, plan.amount, plan.periodDays].join(':') : null;
  const consented = consentKey !== null && acceptedTerms === consentKey;
  const supported = !isYandexGamesBuild();
  const active = useEntitlements((state) => state.subscriptionExpiresAt !== null && state.subscriptionExpiresAt > Date.now());

  useEffect(() => { if (supported) void useSubscription.getState().sync(); }, [supported]);

  const openPage = async (path: 'terms' | 'manage') => {
    try {
      const url = new URL(`/api/billing/${path}`, ENV.apiUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_url');
      await Linking.openURL(url.href);
    } catch { setNotice('Страница сейчас недоступна. Попробуйте позже.'); }
  };
  const cancel = async () => {
    if (await subscription.cancel()) setNotice('Автопродление отключено. Оплаченный срок сохранён.');
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}><AppButton label="На карту" variant="glass" icon="back" onPress={goBack} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
          <AppText preset="display">Играйте спокойно</AppText>
          <GlassPanel strong style={{ gap: 14 }}>
            <Icon name="privacy" size={38} color={colors.amber} />
            <AppText preset="title">Без рекламных пауз</AppText>
            <AppText>Баннеры и рекламные паузы исчезнут. Реклама за дополнительные бонусы останется доступна по вашему желанию.</AppText>
            {!supported ? <AppText style={{ color: colors.textMuted }}>Покупки в этой версии игры недоступны.</AppText> : null}
            {supported && !catalog && !error ? <AppText accessibilityLiveRegion="polite">Загружаем условия подписки…</AppText> : null}
            {catalog?.mode === 'test' && catalog.available ? <AppText style={{ color: colors.amber }}>Тестовый режим: реальные деньги не списываются.</AppText> : null}
            {supported && catalog && !catalog.available ? <AppText style={{ color: colors.textMuted }}>Покупка подписки пока недоступна. Играть можно как обычно.</AppText> : null}
            {active && status?.activeUntil ? (
              <>
                <AppText preset="label" style={{ color: colors.success }}>Подписка активна</AppText>
                <AppText selectable>Без рекламных пауз до {dateLabel(status.activeUntil)}.</AppText>
                {!status.autoRenew ? <AppText>Автопродление выключено. Следующих списаний не будет.</AppText> : null}
              </>
            ) : null}
            {status?.autoRenew ? <AppText selectable>{status.nextPaymentAt ? `Следующее списание: ${dateLabel(status.nextPaymentAt)}.` : 'Дата продления будет сообщена по электронной почте.'}</AppText> : null}
            {status?.autoRenew ? <AppButton label="Отключить автопродление" variant="glass" disabled={busy} onPress={() => { void cancel(); }} /> : null}
            {supported && plan && catalog?.available && !active && !status?.autoRenew && !status?.pendingPaymentId && !confirmationUrl ? (
              <>
                <AppText preset="display">{Number(plan.amount).toLocaleString('ru-RU')} ₽</AppText>
                <AppText>За {plan.periodDays} дней. Автоматическое продление каждые {plan.periodDays} дней.</AppText>
                <AppText preset="label">Электронная почта</AppText>
                <TextInput
                  value={email} onChangeText={setEmail} editable={!busy} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                  textContentType="emailAddress" accessibilityLabel="Электронная почта для чека" placeholder="Для чека и связи по подписке" placeholderTextColor={colors.textMuted}
                  style={inputStyle}
                />
                <Pressable disabled={busy} accessibilityRole="checkbox" aria-checked={consented} accessibilityLabel="Согласие на автоматическое продление подписки" accessibilityState={{ checked: consented, disabled: busy }} onPress={() => setAcceptedTerms((value) => value === consentKey ? null : consentKey)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10 }}>
                  <Icon name={consented ? 'check' : 'close'} color={consented ? colors.success : colors.textMuted} size={26} />
                  <AppText style={{ flex: 1 }}>Согласен с условиями подписки и списанием {Number(plan.amount).toLocaleString('ru-RU')} ₽ каждые {plan.periodDays} дней до отключения автопродления.</AppText>
                </Pressable>
                <AppButton label={busy ? 'Подготавливаем оплату…' : `Подключить за ${Number(plan.amount).toLocaleString('ru-RU')} ₽`} variant="accent" disabled={busy || !consented || !email.trim()} onPress={() => { setNotice(null); void subscription.checkout(email, consented); }} />
                <AppText style={{ color: colors.textMuted }}>Первый платёж — при покупке. Отменить следующие списания можно здесь в любое время.</AppText>
                <AppText style={{ color: colors.textMuted }}>Перед продлением напомним по электронной почте. Следующее списание — не ранее чем через 24 часа после отправки напоминания.</AppText>
              </>
            ) : null}
            {confirmationUrl && !active ? <AppButton label="Вернуться к оплате" disabled={busy} onPress={() => { void subscription.resumeCheckout(); }} /> : null}
            {status?.pendingPaymentId ? <AppText>Платёж ещё проверяется. Новую покупку оформлять не нужно. Уже начатый платёж может завершиться после отключения автопродления.</AppText> : null}
            {supported ? <AppButton label={busy ? 'Проверяем…' : 'Проверить оплату'} variant="glass" disabled={busy} onPress={() => { setNotice(null); void subscription.sync(); }} /> : null}
            {supported && plan ? <AppButton label="Условия подписки" variant="glass" onPress={() => { void openPage('terms'); }} /> : null}
          </GlassPanel>
          {error || notice ? <AppText selectable accessibilityLiveRegion="polite" style={{ color: error ? colors.amber : colors.text }}>{error ? errorMessage(error) : notice}</AppText> : null}
          {supported ? (
            <GlassPanel strong style={{ gap: 12 }}>
              <AppText preset="title">Управление и восстановление</AppText>
              <AppText style={{ color: colors.textMuted }}>Сохраните код подписки. Он поможет восстановить доступ на другом устройстве и отключить списания после удаления игры.</AppText>
              {recoveryCode ? <AppText selectable style={{ fontVariant: ['tabular-nums'], color: colors.amber }}>{recoveryCode}</AppText> : null}
              {active || status?.pendingPaymentId || status?.autoRenew ? (
                <>
                  <AppText style={{ color: colors.textMuted }}>Новый код заменит предыдущий. Сохраните его до удаления игры.</AppText>
                  <AppButton label="Получить новый код" variant="glass" disabled={busy} onPress={() => { void subscription.issueRecovery(); }} />
                </>
              ) : null}
              <TextInput value={restoreCode} onChangeText={setRestoreCode} editable={!busy} autoCapitalize="none" autoCorrect={false} placeholder="Код восстановления" placeholderTextColor={colors.textMuted} accessibilityLabel="Код восстановления подписки" maxLength={128} style={inputStyle} />
              <AppButton label="Восстановить подписку" variant="glass" disabled={busy || !restoreCode.trim()} onPress={() => { void subscription.restore(restoreCode).then((ok) => { if (ok) { setRestoreCode(''); setNotice('Подписка восстановлена.'); } }); }} />
              <AppButton label="Управление вне игры" variant="glass" onPress={() => { void openPage('manage'); }} />
            </GlassPanel>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const inputStyle = { borderRadius: radius.md, borderWidth: 1, borderColor: colors.glassBorder, color: colors.text, padding: 14, minHeight: 52, fontSize: 16 };
