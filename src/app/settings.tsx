import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useGoBack } from '@/core/nav';
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useAnalyticsPrefs } from '@/features/analytics';
import { isAudioAvailable } from '@/features/audio';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import {
  cancelDailyReminders,
  getPush,
  hasDailyReminderConsent,
  isDailyReminderAvailable,
  requestDailyReminderPermission,
  syncDailyReminders,
} from '@/features/notifications';
import { readIntroGuidance, setIntroGuidanceEnabled } from '@/features/onboarding';
import { useSettings } from '@/features/settings';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, type IconName, WorldBackground } from '@/ui';

function Row({ label, value, icon, onChange }: { label: string; value: boolean; icon: IconName; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }}>
      <View style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={colors.amber} />
      </View>
      <AppText preset="label" style={{ flex: 1 }}>{label}</AppText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.green, false: colors.glassBorder }}
        thumbColor={colors.text}
      />
    </View>
  );
}

export default function Settings() {
  const router = useRouter();
  const goBack = useGoBack();
  const s = useSettings();
  const optOut = useAnalyticsPrefs((x) => x.optOut);
  const setOptOut = useAnalyticsPrefs((x) => x.setOptOut);
  const [guidanceEnabled, setGuidance] = useState(() => readIntroGuidance().guidanceEnabled);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

  const setNotifications = async (enabled: boolean) => {
    if (!enabled) {
      await cancelDailyReminders();
      await getPush().unregister();
      s.set({ notifications: false });
      setNotificationMessage('Напоминания выключены.');
      return;
    }
    const permission = await requestDailyReminderPermission('settings');
    if (permission === 'granted') {
      s.set({ notifications: true });
      await syncDailyReminders();
      setNotificationMessage('Напоминания включены.');
    } else if (permission === 'denied') {
      setNotificationMessage('Уведомления запрещены в настройках Android. Играть можно как обычно.');
    } else if (permission === 'dismissed') {
      setNotificationMessage('Вы сможете включить напоминания позже.');
    } else {
      setNotificationMessage('Напоминания сейчас недоступны.');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
        </View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 14 }}>
          <AppText preset="display">{t('settings')}</AppText>

          <GlassPanel strong style={{ gap: 2 }}>
            {isAudioAvailable() ? (
              <>
                <Row label="Звук" icon="sound" value={s.sound} onChange={(v) => s.set({ sound: v })} />
                <Row label="Музыка" icon="music" value={s.music} onChange={(v) => s.set({ music: v })} />
              </>
            ) : null}
            <Row label="Вибрация" icon="haptics" value={s.haptics} onChange={(v) => s.set({ haptics: v })} />
            <Row label="Подсказки обучения" icon="bulb" value={guidanceEnabled} onChange={(value) => {
              setIntroGuidanceEnabled(value);
              setGuidance(value);
            }} />
            <AppButton label="Показать обучение снова" variant="glass" icon="play" onPress={() => {
              setIntroGuidanceEnabled(true);
              setGuidance(true);
              router.push('/tutorial-practice' as never);
            }} />
            {isDailyReminderAvailable() ? (
              <Row label={t('notifications')} icon="notifications" value={s.notifications && hasDailyReminderConsent()} onChange={(v) => void setNotifications(v)} />
            ) : null}
            <Row label="Отключить аналитику" icon="privacy" value={optOut} onChange={setOptOut} />
          </GlassPanel>
          {notificationMessage ? <AppText preset="body" style={{ color: colors.textMuted }}>{notificationMessage}</AppText> : null}

          <GlassPanel style={{ gap: 10 }}>
            {!isYandexGamesBuild() ? (
              <AppButton label="Подписка и восстановление" variant="glass" icon="shop" onPress={() => router.push('/shop')} />
            ) : null}
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Версия {Constants.expoConfig?.version ?? '0.1.0'}
            </AppText>
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
