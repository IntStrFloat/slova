import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';

import { AppText } from './AppText';
import { colors, radius } from './theme';

/** Заглушка мета-экранов (M2–M5). Навигация работает, контент — «Скоро». */
export function Placeholder({ title }: { title: string }) {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 }}>
        <AppText preset="display">{title}</AppText>
        <AppText preset="body" style={{ color: colors.textMuted }}>
          {t('comingSoon')}
        </AppText>
        <Pressable
          onPress={() => router.back()}
          style={{
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.pill,
            paddingVertical: 12,
            paddingHorizontal: 28,
          }}
        >
          <AppText preset="label">← {t('map')}</AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
