import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import type { Row } from '@/core/net';
import { useLeaderboard } from '@/features/leaderboard';
import { useProfile } from '@/features/profile';
import { AppButton, AppText, colors, GlassPanel, radius, WorldBackground } from '@/ui';

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
        backgroundColor: me ? colors.amber : 'transparent',
      }}
    >
      <AppText preset="label" style={{ width: 34, color: me ? colors.onAmber : colors.textMuted }}>{row.rank}</AppText>
      <AppText preset="label" style={{ flex: 1, color: me ? colors.onAmber : colors.text }} numberOfLines={1}>
        {row.nickname}#{row.tag}
      </AppText>
      <AppText preset="coin" style={{ color: me ? colors.onAmber : colors.amber }}>{row.score}</AppText>
    </View>
  );
}

export default function Leaderboard() {
  const router = useRouter();
  const profile = useProfile((s) => s.profile);
  const ensure = useProfile((s) => s.ensure);
  const busy = useProfile((s) => s.busy);
  const { snapshot, loading, offline, load } = useLeaderboard();
  const [scope, setScope] = useState<'global' | 'weekly'>('global');

  useEffect(() => {
    if (profile) void load(scope);
  }, [profile, scope, load]);

  const createProfile = async () => {
    const ok = await ensure(`Игрок${Math.floor(1000 + Math.random() * 9000)}`);
    if (ok) void load(scope);
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
          <AppText preset="title">{t('leaderboard')}</AppText>
          <View style={{ width: 44 }} />
        </View>

        {!profile ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Создайте профиль, чтобы соревноваться в таблице лидеров.
            </AppText>
            <AppButton label={busy ? '...' : 'Создать профиль'} icon="profile" large onPress={createProfile} />
          </View>
        ) : (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <AppButton label="Глобальный" variant={scope === 'global' ? 'accent' : 'glass'} onPress={() => setScope('global')} />
              <AppButton label="Неделя" variant={scope === 'weekly' ? 'accent' : 'glass'} onPress={() => setScope('weekly')} />
            </View>

            {snapshot?.me ? (
              <GlassPanel strong style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <AppText preset="label" style={{ flex: 1 }}>Ваша лига: {snapshot.me.division}</AppText>
                <AppText preset="coin">#{snapshot.me.rank}</AppText>
              </GlassPanel>
            ) : null}

            {offline ? (
              <AppText preset="body" style={{ color: colors.danger }}>Нет связи — показан кэш</AppText>
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
