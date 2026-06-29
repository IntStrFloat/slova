import { useGoBack } from '@/core/nav';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useEvents } from '@/features/events';
import { useProfile } from '@/features/profile';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, safeNickname, WorldBackground } from '@/ui';

export default function Events() {
  const goBack = useGoBack();
  const profile = useProfile((s) => s.profile);
  const ensure = useProfile((s) => s.ensure);
  const { data, loading, offline, load } = useEvents();

  useEffect(() => {
    void ensure();
  }, [ensure]);

  useEffect(() => {
    if (profile) void load();
  }, [profile, load]);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
          <AppText preset="title">{t('events')}</AppText>
          <View style={{ width: 44 }} />
        </View>

        {!profile ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Создаём профиль для турниров…
            </AppText>
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
            {offline ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.offline }}>
                <Icon name="events" size={18} color={colors.amber} />
                <AppText preset="body" style={{ color: colors.textMuted }}>Нет связи — показан кэш турнира</AppText>
              </View>
            ) : null}
            <GlassPanel strong style={{ flex: 1, padding: 6 }}>
              <ScrollView>
                {(data?.board ?? []).map((r) => (
                  <View key={r.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: r.userId === data?.me?.userId ? colors.amber : r.rank <= 3 ? colors.offline : 'transparent' }}>
                    <AppText preset="label" style={{ width: 32, color: r.userId === data?.me?.userId ? colors.onAmber : colors.textMuted }}>{r.rank}</AppText>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText preset="label" style={{ color: r.userId === data?.me?.userId ? colors.onAmber : colors.text }} numberOfLines={1} ellipsizeMode="tail">{safeNickname(r.nickname, r.tag)}</AppText>
                      <AppText preset="body" style={{ color: r.userId === data?.me?.userId ? colors.onAmber : colors.textMuted, fontSize: 12 }} numberOfLines={1}>#{r.tag}</AppText>
                    </View>
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
