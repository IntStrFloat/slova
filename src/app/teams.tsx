import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useProfile } from '@/features/profile';
import { useTeams } from '@/features/teams';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

export default function Teams() {
  const router = useRouter();
  const profile = useProfile((s) => s.profile);
  const { list, mine, offline, load, create, join, leave } = useTeams();
  const [name, setName] = useState('');

  useEffect(() => {
    if (profile) void load();
  }, [profile, load]);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
          <AppText preset="title">{t('teams')}</AppText>
          <View style={{ width: 44 }} />
        </View>

        {!profile ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Создайте профиль, чтобы вступать в клубы.
            </AppText>
            <AppButton label={t('profile')} icon="profile" large onPress={() => router.push('/profile' as never)} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {mine ? (
              <GlassPanel strong style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Icon name="teams" size={26} color={colors.amber} />
                  <AppText preset="title" style={{ flex: 1 }}>{mine.name}</AppText>
                </View>
                <AppText preset="body" style={{ color: colors.textMuted }}>
                  Участников: {mine.memberCount} · Очки клуба: {mine.totalScore}
                </AppText>
                {mine.members.map((m, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <AppText preset="body">{m.nickname}</AppText>
                    <AppText preset="coin">{m.score}</AppText>
                  </View>
                ))}
                <AppButton label="Покинуть клуб" variant="glass" onPress={() => void leave()} />
              </GlassPanel>
            ) : (
              <GlassPanel strong style={{ gap: 10 }}>
                <AppText preset="title">Создать клуб</AppText>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Название клуба"
                  placeholderTextColor={colors.textMuted}
                  style={{
                    backgroundColor: colors.glass,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.glassBorder,
                    color: colors.text,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 17,
                  }}
                />
                <AppButton
                  label="Создать"
                  icon="teams"
                  onPress={() => {
                    if (name.trim().length >= 2) void create(name.trim());
                  }}
                />
              </GlassPanel>
            )}

            {!mine ? (
              <GlassPanel strong style={{ gap: 8 }}>
                <AppText preset="title">Клубы</AppText>
                {offline ? <AppText preset="body" style={{ color: colors.danger }}>Нет связи</AppText> : null}
                {list.map((tm) => (
                  <View key={tm.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <AppText preset="label">{tm.name}</AppText>
                      <AppText preset="body" style={{ color: colors.textMuted }}>
                        {tm.memberCount} уч. · {tm.totalScore} очк.
                      </AppText>
                    </View>
                    <AppButton label="Вступить" variant="accent" onPress={() => void join(tm.id)} />
                  </View>
                ))}
                {list.length === 0 ? (
                  <AppText preset="body" style={{ color: colors.textMuted }}>Клубов пока нет — создайте первый!</AppText>
                ) : null}
              </GlassPanel>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
