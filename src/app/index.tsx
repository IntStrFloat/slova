import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useCurrency } from '@/features/currency';
import { DEFAULT_WORLD, useLevels, worldLevelCount } from '@/features/levels';
import { AdBanner } from '@/features/monetization';
import {
  AppButton,
  AppText,
  CoinBadge,
  colors,
  GlassPanel,
  Icon,
  radius,
  WorldBackground,
  worldTheme,
  type IconName,
} from '@/ui';

const META: { route: string; key: Parameters<typeof t>[0]; icon: IconName }[] = [
  { route: '/daily', key: 'daily', icon: 'daily' },
  { route: '/wheel', key: 'wheel', icon: 'wheel' },
  { route: '/collection', key: 'collection', icon: 'collection' },
  { route: '/shop', key: 'shop', icon: 'shop' },
  { route: '/leaderboard', key: 'leaderboard', icon: 'leaderboard' },
  { route: '/events', key: 'events', icon: 'events' },
  { route: '/teams', key: 'teams', icon: 'teams' },
  { route: '/profile', key: 'profile', icon: 'profile' },
  { route: '/settings', key: 'settings', icon: 'settings' },
];

export default function Home() {
  const router = useRouter();
  const currentLevel = useLevels((s) => s.currentLevel);
  const completed = useLevels((s) => s.completed.length);
  const coins = useCurrency((s) => s.coins);
  const total = worldLevelCount(DEFAULT_WORLD);
  const theme = worldTheme(DEFAULT_WORLD);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world={DEFAULT_WORLD} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, alignItems: 'center' }}>
          <AppText preset="title">{t('appTitle')}</AppText>
          <CoinBadge value={coins} />
        </View>

        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 16, gap: 18 }}>
          <GlassPanel strong style={{ alignItems: 'center', gap: 4, marginTop: 8, paddingHorizontal: 36 }}>
            <AppText preset="body" style={{ color: colors.amber }}>
              {theme.name}
            </AppText>
            <AppText preset="display">{t('level', { n: currentLevel })}</AppText>
            <AppText preset="body" style={{ color: colors.textMuted }}>
              {completed}/{total}
            </AppText>
          </GlassPanel>

          <AppButton label={t('play')} icon="play" large onPress={() => router.push('/game')} />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, paddingHorizontal: 16 }}>
            {META.map((m) => (
              <Pressable
                key={m.route}
                onPress={() => router.push(m.route as never)}
                style={({ pressed }) => [
                  {
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                    borderWidth: 1,
                    borderRadius: radius.lg,
                    paddingVertical: 14,
                    width: 104,
                    alignItems: 'center',
                    gap: 6,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  },
                ]}
              >
                <Icon name={m.icon} size={24} color={colors.amber} />
                <AppText preset="label" style={{ fontSize: 13 }}>
                  {t(m.key)}
                </AppText>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <AdBanner />
      </SafeAreaView>
    </View>
  );
}
