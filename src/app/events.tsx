import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useEvents } from '@/features/events';
import { useProfile } from '@/features/profile';
import { AppButton, AppText, colors, GlassPanel, WorldBackground } from '@/ui';

export default function Events() {
  const router = useRouter();
  const profile = useProfile((s) => s.profile);
  const { data, loading, offline, load } = useEvents();

  useEffect(() => {
    if (profile) void load();
  }, [profile, load]);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
          <AppText preset="title">{t('events')}</AppText>
          <View style={{ width: 44 }} />
        </View>

        {!profile ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Создайте профиль, чтобы участвовать в турнирах.
            </AppText>
            <AppButton label={t('profile')} icon="profile" large onPress={() => router.push('/profile' as never)} />
          </View>
        ) : (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            <GlassPanel strong style={{ gap: 4 }}>
              <AppText preset="title">{data?.event.title ?? 'Турнир недели'}</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>{data?.event.metric ?? 'Очки за неделю'}</AppText>
              {data?.me ? (
                <AppText preset="coin">Вы: {data.me.score} очк. · #{data.me.rank}</AppText>
              ) : null}
            </GlassPanel>
            {offline ? <AppText preset="body" style={{ color: colors.danger }}>Нет связи</AppText> : null}
            <GlassPanel strong style={{ flex: 1, padding: 6 }}>
              <ScrollView>
                {(data?.board ?? []).map((r) => (
                  <View key={r.userId} style={{ flexDirection: 'row', gap: 12, paddingVertical: 9, paddingHorizontal: 12 }}>
                    <AppText preset="label" style={{ width: 32, color: colors.textMuted }}>{r.rank}</AppText>
                    <AppText preset="label" style={{ flex: 1 }} numberOfLines={1}>{r.nickname}#{r.tag}</AppText>
                    <AppText preset="coin">{r.score}</AppText>
                  </View>
                ))}
                {!loading && (data?.board?.length ?? 0) === 0 ? (
                  <AppText preset="body" style={{ color: colors.textMuted, padding: 16 }}>Турнир стартовал — наберите очки!</AppText>
                ) : null}
              </ScrollView>
            </GlassPanel>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
