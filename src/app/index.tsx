import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useCurrency } from '@/features/currency';
import { DEFAULT_WORLD, useLevels, worldLevelCount } from '@/features/levels';
import { AdBanner } from '@/features/monetization';
import { AppText, colors, radius } from '@/ui';

const META: { route: string; key: Parameters<typeof t>[0] }[] = [
  { route: '/daily', key: 'daily' },
  { route: '/wheel', key: 'wheel' },
  { route: '/collection', key: 'collection' },
  { route: '/shop', key: 'shop' },
  { route: '/leaderboard', key: 'leaderboard' },
  { route: '/events', key: 'events' },
  { route: '/teams', key: 'teams' },
  { route: '/profile', key: 'profile' },
  { route: '/settings', key: 'settings' },
];

export default function Home() {
  const router = useRouter();
  const currentLevel = useLevels((s) => s.currentLevel);
  const completed = useLevels((s) => s.completed.length);
  const coins = useCurrency((s) => s.coins);
  const total = worldLevelCount(DEFAULT_WORLD);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, alignItems: 'center' }}>
        <AppText preset="title">{t('appTitle')}</AppText>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14 }}>
          <AppText preset="coin">🪙 {coins}</AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 24, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 6, marginTop: 12 }}>
          <AppText preset="display">{t('level', { n: currentLevel })}</AppText>
          <AppText preset="body" style={{ color: colors.textMuted }}>
            {completed}/{total}
          </AppText>
        </View>

        <Pressable
          onPress={() => router.push('/game')}
          style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 16, paddingHorizontal: 64 }}
        >
          <AppText preset="display" style={{ color: colors.primaryText, fontSize: 22 }}>
            {t('play')}
          </AppText>
        </Pressable>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingHorizontal: 16 }}>
          {META.map((m) => (
            <Pressable
              key={m.route}
              onPress={() => router.push(m.route as never)}
              style={{ backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, minWidth: 104, alignItems: 'center' }}
            >
              <AppText preset="label">{t(m.key)}</AppText>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <AdBanner />
    </SafeAreaView>
  );
}
