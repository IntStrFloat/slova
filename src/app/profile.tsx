import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useCollection } from '@/features/collection';
import { useLevels } from '@/features/levels';
import { useProfile } from '@/features/profile';
import { AppButton, AppText, colors, GlassPanel, Icon, WorldBackground } from '@/ui';

export default function Profile() {
  const router = useRouter();
  const profile = useProfile((s) => s.profile);
  const ensure = useProfile((s) => s.ensure);
  const busy = useProfile((s) => s.busy);
  const completed = useLevels((s) => s.completed.length);
  const opened = useCollection((s) => s.opened.length);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
        </View>
        <View style={{ padding: 16, gap: 16 }}>
          <AppText preset="display">{t('profile')}</AppText>

          <GlassPanel strong style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
            <Icon name="profile" size={56} color={colors.amber} />
            {profile ? (
              <AppText preset="title">{profile.nickname}#{profile.tag}</AppText>
            ) : (
              <>
                <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
                  Создайте профиль для лидербордов, событий и облачного сохранения.
                </AppText>
                <AppButton
                  label={busy ? '...' : 'Создать профиль'}
                  icon="profile"
                  large
                  onPress={() => ensure(`Игрок${Math.floor(1000 + Math.random() * 9000)}`)}
                />
              </>
            )}
          </GlassPanel>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <GlassPanel strong style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <AppText preset="display" style={{ fontSize: 28 }}>{completed}</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>уровней</AppText>
            </GlassPanel>
            <GlassPanel strong style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <AppText preset="display" style={{ fontSize: 28 }}>{opened}</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>мест</AppText>
            </GlassPanel>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
