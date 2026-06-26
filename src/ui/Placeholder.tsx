import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { AppButton, GlassPanel } from './primitives';
import { colors } from './theme';
import { WorldBackground } from './WorldBackground';

/** Заглушка мета-экранов (M2–M5). Навигация работает, контент — «Скоро». */
export function Placeholder({ title, icon = 'wand' }: { title: string; icon?: IconName }) {
  const router = useRouter();
  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <GlassPanel strong style={{ alignItems: 'center', gap: 14, paddingVertical: 32, paddingHorizontal: 36 }}>
          <Icon name={icon} size={48} color={colors.amber} />
          <AppText preset="display">{title}</AppText>
          <AppText preset="body" style={{ color: colors.textMuted }}>
            {t('comingSoon')}
          </AppText>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
        </GlassPanel>
      </SafeAreaView>
    </View>
  );
}
