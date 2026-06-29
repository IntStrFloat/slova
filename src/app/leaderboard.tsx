import { useGoBack } from '@/core/nav';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import type { Row } from '@/core/net';
import { useLeaderboard } from '@/features/leaderboard';
import { useProfile } from '@/features/profile';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, safeNickname, WorldBackground } from '@/ui';

function RowItem({ row, me }: { row: Row; me: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: radius.md,
        backgroundColor: me ? colors.amber : row.rank <= 3 ? colors.offline : 'transparent',
        borderWidth: row.rank <= 3 || me ? 1 : 0,
        borderColor: me ? colors.gridHint : colors.glassBorder,
      }}
    >
      <View style={{ width: 34, alignItems: 'center' }}>
        {row.rank <= 3 ? <Icon name="star" size={18} color={me ? colors.onAmber : colors.amber} /> : null}
        <AppText preset="label" style={{ color: me ? colors.onAmber : colors.textMuted }}>{row.rank}</AppText>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText preset="label" style={{ color: me ? colors.onAmber : colors.text }} numberOfLines={1} ellipsizeMode="tail">
          {safeNickname(row.nickname, row.tag)}
        </AppText>
        <AppText preset="body" style={{ color: me ? colors.onAmber : colors.textMuted, fontSize: 12 }} numberOfLines={1}>
          #{row.tag}
        </AppText>
      </View>
      <AppText preset="coin" style={{ color: me ? colors.onAmber : colors.amber }}>{row.score}</AppText>
    </View>
  );
}

export default function Leaderboard() {
  const goBack = useGoBack();
  const profile = useProfile((s) => s.profile);
  const ensure = useProfile((s) => s.ensure);
  const busy = useProfile((s) => s.busy);
  const error = useProfile((s) => s.error);
  const { snapshot, loading, offline, load } = useLeaderboard();
  const [scope, setScope] = useState<'global' | 'weekly'>('global');

  // Профиль создаётся автоматически; повторяем попытку при заходе (на случай оффлайна на старте).
  useEffect(() => {
    void ensure();
  }, [ensure]);

  useEffect(() => {
    if (profile) void load(scope);
  }, [profile, scope, load]);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
          <AppText preset="title">{t('leaderboard')}</AppText>
          <View style={{ width: 44 }} />
        </View>

        {!profile ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              {error
                ? 'Нет связи — профиль создастся автоматически при подключении.'
                : 'Создаём профиль…'}
            </AppText>
            {error ? (
              <AppButton label={busy ? '...' : 'Повторить'} icon="profile" large onPress={() => void ensure()} />
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder }}>
              <AppButton label="Глобальный" variant={scope === 'global' ? 'accent' : 'glass'} onPress={() => setScope('global')} style={{ flex: 1, minHeight: 48, paddingHorizontal: 10 }} />
              <AppButton label="Неделя" variant={scope === 'weekly' ? 'accent' : 'glass'} onPress={() => setScope('weekly')} style={{ flex: 1, minHeight: 48, paddingHorizontal: 10 }} />
            </View>

            {snapshot?.me ? (
              <GlassPanel strong style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <AppText preset="label" style={{ flex: 1 }}>Ваша лига: {snapshot.me.division}</AppText>
                <AppText preset="coin">#{snapshot.me.rank}</AppText>
              </GlassPanel>
            ) : null}

            {offline ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.offline }}>
                <Icon name="events" size={18} color={colors.amber} />
                <AppText preset="body" style={{ color: colors.textMuted }}>Нет связи — показан кэш</AppText>
              </View>
            ) : null}

            <GlassPanel strong style={{ flex: 1, padding: 6 }}>
              <ScrollView>
                {(snapshot?.top ?? []).map((r) => (
                  <RowItem key={r.userId} row={r} me={r.userId === snapshot?.me?.userId} />
                ))}
                {loading && !snapshot ? (
                  <AppText preset="body" style={{ color: colors.textMuted, padding: 16 }}>Загрузка…</AppText>
                ) : null}
                {!loading && (snapshot?.top?.length ?? 0) === 0 ? (
                  <AppText preset="body" style={{ color: colors.textMuted, padding: 16 }}>Пока пусто — будьте первым!</AppText>
                ) : null}
              </ScrollView>
            </GlassPanel>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
