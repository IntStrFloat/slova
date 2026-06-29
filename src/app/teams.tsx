import { useGoBack } from '@/core/nav';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useProfile } from '@/features/profile';
import { useTeams } from '@/features/teams';
import { AppButton, AppText, colors, fonts, GlassPanel, Icon, radius, safeDisplayName, safeNickname, WorldBackground } from '@/ui';

export default function Teams() {
  const goBack = useGoBack();
  const profile = useProfile((s) => s.profile);
  const ensure = useProfile((s) => s.ensure);
  const { list, mine, offline, load, create, join, leave } = useTeams();
  const [name, setName] = useState('');

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
          <AppText preset="title">{t('teams')}</AppText>
          <View style={{ width: 44 }} />
        </View>

        {!profile ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Создаём профиль для клубов…
            </AppText>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {mine ? (
              <GlassPanel strong style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="teams" size={30} color={colors.onAmber} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText preset="title" numberOfLines={1}>{safeDisplayName(mine.name, 'Клуб', mine.id)}</AppText>
                    <AppText preset="body" style={{ color: colors.textMuted }}>{mine.memberCount} уч. · {mine.totalScore} очк.</AppText>
                  </View>
                </View>
                {mine.members.map((m, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                    <AppText preset="body" numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1 }}>{safeNickname(m.nickname)}</AppText>
                    <AppText preset="coin">{m.score}</AppText>
                  </View>
                ))}
                <AppButton label="Покинуть клуб" variant="glass" onPress={() => void leave()} />
              </GlassPanel>
            ) : (
              <GlassPanel strong style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="teams" size={30} color={colors.onGreen} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText preset="title">Создать клуб</AppText>
                    <AppText preset="body" style={{ color: colors.textMuted }}>Соберите друзей и копите очки клуба</AppText>
                  </View>
                </View>
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
                    fontFamily: fonts.body,
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

            {!mine && (
              <GlassPanel strong style={{ gap: 8 }}>
                <AppText preset="title">Клубы</AppText>
                {offline && (
                  <AppText preset="body" style={{ color: colors.textMuted, backgroundColor: colors.offline, borderRadius: radius.md, padding: 10 }}>
                    Нет связи — список обновится позже
                  </AppText>
                )}
                {list.map((tm) => (
                  <View key={tm.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="teams" size={20} color={colors.amber} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText preset="label" numberOfLines={1}>{safeDisplayName(tm.name, 'Клуб', tm.id)}</AppText>
                      <AppText preset="body" style={{ color: colors.textMuted }}>
                        {tm.memberCount} уч. · {tm.totalScore} очк.
                      </AppText>
                    </View>
                    <AppButton label="Вступить" variant="accent" onPress={() => void join(tm.id)} />
                  </View>
                ))}
                {list.length === 0 && (
                  <AppText preset="body" style={{ color: colors.textMuted }}>
                    Клубов пока нет — создайте первый!
                  </AppText>
                )}
              </GlassPanel>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
