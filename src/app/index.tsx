import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { landmarksForWorld } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { getString, KEYS } from '@/core/storage';
import { useCurrency } from '@/features/currency';
import { totalLevelCount, useLevels, worldForGlobalLevel } from '@/features/levels';
import { AdBanner } from '@/features/monetization';
import {
  AppButton,
  AppText,
  CoinBadge,
  colors,
  GlassPanel,
  Icon,
  radius,
  shadowCard,
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
  const total = totalLevelCount();
  const currentWorld = worldForGlobalLevel(currentLevel);
  const theme = worldTheme(currentWorld);
  const routeLevels = Array.from({ length: 7 }, (_, i) => Math.max(1, currentLevel - 2 + i));
  const nextLandmark = landmarksForWorld(currentWorld).find((l) => l.untilLevel >= currentLevel);

  const [ready] = useState(() => getString(KEYS.onboardingDone) !== null);
  useEffect(() => {
    if (!ready) router.replace('/onboarding' as never);
  }, [ready, router]);
  if (!ready) return null;

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world={currentWorld} image={nextLandmark?.image} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, alignItems: 'center' }}>
          <AppText preset="title">{t('appTitle')}</AppText>
          <CoinBadge value={coins} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 18, gap: 16 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {META.slice(0, 4).map((m) => (
              <Pressable
                key={m.route}
                onPress={() => router.push(m.route as never)}
                style={({ pressed }) => [
                  shadowCard,
                  {
                    backgroundColor: colors.glassStrong,
                    borderColor: colors.glassBorder,
                    borderWidth: 1,
                    borderRadius: radius.pill,
                    width: 52,
                    height: 52,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t(m.key)}
              >
                <Icon name={m.icon} size={24} color={colors.amber} />
              </Pressable>
            ))}
          </View>

          <GlassPanel strong style={{ overflow: 'hidden', padding: 0 }}>
            <View style={{ padding: 18, gap: 8 }}>
              <AppText preset="body" style={{ color: colors.amber }}>{theme.name}</AppText>
              <AppText preset="display">{t('level', { n: currentLevel })}</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>
                Маршрут {completed}/{total}
              </AppText>
            </View>

            <View style={{ minHeight: 360, paddingHorizontal: 26, paddingBottom: 18 }}>
              <View
                style={{
                  position: 'absolute',
                  left: 55,
                  top: 18,
                  bottom: 44,
                  width: 4,
                  borderRadius: radius.pill,
                  backgroundColor: colors.glassBorder,
                }}
              />
              {routeLevels.map((levelNo, index) => {
                const isCurrent = levelNo === currentLevel;
                const isPast = levelNo < currentLevel;
                const locked = levelNo > currentLevel;
                const milestone = nextLandmark?.untilLevel === levelNo;
                return (
                  <View
                    key={levelNo}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      minHeight: isCurrent ? 78 : 48,
                      marginLeft: index % 2 === 0 ? 0 : 42,
                    }}
                  >
                    <View
                      style={[
                        shadowCard,
                        {
                          width: isCurrent ? 68 : 46,
                          height: isCurrent ? 68 : 46,
                          borderRadius: radius.pill,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isCurrent ? colors.amber : isPast ? colors.green : colors.glassStrong,
                          borderWidth: 2,
                          borderColor: milestone ? colors.gridHint : colors.glassBorder,
                        },
                      ]}
                    >
                      <Icon name={milestone ? 'collection' : isPast ? 'check' : locked ? 'lock' : 'play'} size={isCurrent ? 28 : 20} color={isCurrent ? colors.onAmber : colors.text} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <AppText preset={isCurrent ? 'title' : 'label'} numberOfLines={1}>
                        {milestone ? nextLandmark?.title : t('level', { n: levelNo })}
                      </AppText>
                      <AppText preset="body" style={{ color: colors.textMuted }} numberOfLines={1}>
                        {isCurrent ? 'Текущая остановка' : isPast ? 'Пройдено' : milestone ? 'Следующая достопримечательность' : 'Скоро'}
                      </AppText>
                    </View>
                    {isCurrent ? (
                      <AppButton label={t('play')} icon="play" variant="accent" onPress={() => router.push('/game')} />
                    ) : null}
                  </View>
                );
              })}
            </View>
          </GlassPanel>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {META.slice(4).map((m) => (
              <Pressable
                key={m.route}
                onPress={() => router.push(m.route as never)}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: radius.pill,
                  backgroundColor: colors.glassStrong,
                  borderWidth: 1,
                  borderColor: colors.glassBorder,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <Icon name={m.icon} size={20} color={colors.amber} />
                <AppText preset="label" style={{ fontSize: 13 }}>{t(m.key)}</AppText>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <AdBanner />
      </SafeAreaView>
    </View>
  );
}
