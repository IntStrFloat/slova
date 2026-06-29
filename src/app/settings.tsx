import Constants from 'expo-constants';
import { useGoBack } from '@/core/nav';
import { Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useAnalyticsPrefs } from '@/features/analytics';
import { getIap, useEntitlements } from '@/features/monetization';
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
  const goBack = useGoBack();
  const s = useSettings();
  const optOut = useAnalyticsPrefs((x) => x.optOut);
  const setOptOut = useAnalyticsPrefs((x) => x.setOptOut);
  const setRemoveAds = useEntitlements((x) => x.setRemoveAds);

  const restore = async () => {
    const ids = await getIap().restore();
    if (ids.includes('remove_ads')) setRemoveAds(true);
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
        </View>
        <View style={{ padding: 16, gap: 14 }}>
          <AppText preset="display">{t('settings')}</AppText>

          <GlassPanel strong style={{ gap: 2 }}>
            <Row label="Звук" icon="sound" value={s.sound} onChange={(v) => s.set({ sound: v })} />
            <Row label="Музыка" icon="music" value={s.music} onChange={(v) => s.set({ music: v })} />
            <Row label="Вибрация" icon="haptics" value={s.haptics} onChange={(v) => s.set({ haptics: v })} />
            <Row label="Отключить аналитику" icon="privacy" value={optOut} onChange={setOptOut} />
          </GlassPanel>

          <GlassPanel style={{ gap: 10 }}>
            <AppButton label="Восстановить покупки" variant="glass" icon="shop" onPress={restore} />
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Версия {Constants.expoConfig?.version ?? '0.1.0'}
            </AppText>
          </GlassPanel>
        </View>
      </SafeAreaView>
    </View>
  );
}
