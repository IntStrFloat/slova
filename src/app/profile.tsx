import { useGoBack } from '@/core/nav';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allLandmarks } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { useCollection } from '@/features/collection';
import { totalLevelCount, useLevels } from '@/features/levels';
import { useProfile } from '@/features/profile';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, safeNickname, WorldBackground } from '@/ui';

export default function Profile() {
  const goBack = useGoBack();
  const profile = useProfile((s) => s.profile);
  const ensure = useProfile((s) => s.ensure);
  const busy = useProfile((s) => s.busy);
  const error = useProfile((s) => s.error);
  const completed = useLevels((s) => s.completed.length);
  const opened = useCollection((s) => s.opened.length);
  const totalLevels = totalLevelCount();
  const totalPlaces = allLandmarks().length;
  const initials = safeNickname(profile?.nickname, profile?.tag).slice(0, 1).toUpperCase();

  // Профиль создаётся автоматически; здесь лишь повторяем попытку, если её не было
  // (например, не было сети при старте).
  useEffect(() => {
    void ensure();
  }, [ensure]);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
        </View>
        <View style={{ padding: 16, gap: 16 }}>
          <AppText preset="display">{t('profile')}</AppText>

          <GlassPanel strong style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }}>
            <View style={{ width: 86, height: 86, borderRadius: radius.pill, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' }}>
              {profile ? <AppText preset="display" style={{ color: colors.onAmber }}>{initials}</AppText> : <Icon name="profile" size={44} color={colors.onAmber} />}
            </View>
            {profile ? (
              <>
                <AppText preset="title" numberOfLines={1}>{safeNickname(profile.nickname, profile.tag)}#{profile.tag}</AppText>
                <AppText preset="body" style={{ color: colors.textMuted }}>Путешественник слов</AppText>
              </>
            ) : (
              <>
                <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
                  {error
                    ? 'Профиль создастся автоматически при подключении к сети.'
                    : 'Создаём профиль…'}
                </AppText>
                {error ? (
                  <AppButton label={busy ? '...' : 'Повторить'} icon="profile" onPress={() => ensure()} />
                ) : null}
              </>
            )}
          </GlassPanel>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <GlassPanel strong style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <AppText preset="display" style={{ fontSize: 28 }}>{completed}</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>уровней</AppText>
              <View style={{ height: 5, alignSelf: 'stretch', borderRadius: radius.pill, backgroundColor: colors.glass }}>
                <View style={{ width: `${Math.min(100, (completed / Math.max(1, totalLevels)) * 100)}%`, height: 5, borderRadius: radius.pill, backgroundColor: colors.green }} />
              </View>
            </GlassPanel>
            <GlassPanel strong style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <AppText preset="display" style={{ fontSize: 28 }}>{opened}</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>мест</AppText>
              <View style={{ height: 5, alignSelf: 'stretch', borderRadius: radius.pill, backgroundColor: colors.glass }}>
                <View style={{ width: `${Math.min(100, (opened / Math.max(1, totalPlaces)) * 100)}%`, height: 5, borderRadius: radius.pill, backgroundColor: colors.amber }} />
              </View>
            </GlassPanel>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
