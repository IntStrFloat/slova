import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { track } from '@/features/analytics';
import { isDailyReminderAvailable, markPushSoftAskHandled, PushSoftAsk, requestDailyReminderPermission, shouldShowPushSoftAsk, syncDailyReminders } from '@/features/notifications';
import { useSettings } from '@/features/settings';
import { AppText, colors } from '@/ui';

/** A voluntary action. Showing this button never requests OS permission. */
export function ReminderAction({ screen, completedLevels = 0, dailyIntroduced = false }: {
  screen: 'home' | 'daily'; completedLevels?: number; dailyIntroduced?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const eligible = shouldShowPushSoftAsk({ completedLevels, dailyIntroduced });
  if (!isDailyReminderAvailable() || (!eligible && !message)) return null;
  const close = (result: 'dismissed' | 'declined') => {
    markPushSoftAskHandled(result);
    track('notification_soft_ask_result', { result, screen });
    setVisible(false);
    setMessage('Напоминания не включены. Кроссворд дня доступен без них.');
  };
  const allow = async () => {
    if (busy) return;
    setBusy(true);
    setVisible(false);
    try {
      const permission = await requestDailyReminderPermission(screen);
      track('notification_permission_result', { result: permission, screen });
      if (permission === 'granted') {
        markPushSoftAskHandled('allowed');
        useSettings.getState().set({ notifications: true });
        await syncDailyReminders();
        setMessage('Напомним завтра. Изменить напоминания можно в настройках.');
      } else {
        if (permission === 'denied') markPushSoftAskHandled('declined');
        if (permission === 'dismissed') markPushSoftAskHandled('dismissed');
        setMessage(permission === 'unavailable' ? 'Напоминания сейчас недоступны.' : 'Напоминания не включены. Играть можно как обычно.');
      }
    } catch { setMessage('Напоминания сейчас недоступны. Попробуйте позже.'); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 5 }}>
    {eligible ? <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Напомнить завтра"
      accessibilityState={{ disabled: busy }} onPress={() => {
        track('notification_opt_in_clicked', { screen }); setVisible(true);
      }} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 10 }}>
      <AppText preset="label" style={{ color: colors.cream, fontSize: 13, textAlign: 'center' }}>Напомнить завтра</AppText>
    </Pressable> : null}
    {message ? <AppText preset="body" accessibilityLiveRegion="polite" style={{ color: colors.cream, fontSize: 13, textAlign: 'center' }}>{message}</AppText> : null}
    <PushSoftAsk visible={visible} onAllow={() => void allow()} onDecline={() => close('declined')} onDismiss={() => close('dismissed')} />
  </View>;
}
