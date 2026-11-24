import { useGoBack } from '@/core/nav';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allLandmarks } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { useCollection } from '@/features/collection';
import { useLeaderboard } from '@/features/leaderboard';
import { totalLevelCount, useLevels } from '@/features/levels';
import { useProfile } from '@/features/profile';
import { AppButton, AppText, colors, fonts, Icon, radius, safeNickname, WorldBackground } from '@/ui';

export default function Profile() {
  const goBack = useGoBack();
  const profile = useProfile((s) => s.profile);
  const ensure = useProfile((s) => s.ensure);
  const rename = useProfile((s) => s.rename);
  const busy = useProfile((s) => s.busy);
  const error = useProfile((s) => s.error);
  const completed = useLevels((s) => s.completed.length);
  const opened = useCollection((s) => s.opened.length);
  const totalLevels = totalLevelCount();
  const totalPlaces = allLandmarks().length;
  const initials = safeNickname(profile?.nickname, profile?.tag).slice(0, 1).toUpperCase();
  const [nick, setNick] = useState('');
  // Подставляем текущий ник в поле, когда профиль загрузился.
  useEffect(() => {
    if (!profile || nick) return;
    const timer = setTimeout(() => setNick(profile.nickname), 0);
    return () => clearTimeout(timer);
  }, [profile, nick]);

  // Профиль создаётся автоматически; здесь лишь повторяем попытку, если её не было
  // (например, не было сети при старте).
  useEffect(() => {
    void ensure();
  }, [ensure]);

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.toolbar}>
          <AppButton analyticsId="profile_back" label={t('map')} variant="glass" icon="back" onPress={goBack} style={styles.backButton} />
        </View>
        <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.avatarRing}>
              {profile ? <AppText preset="display" style={styles.avatarInitial}>{initials}</AppText> : <Icon name="profile" size={44} color={colors.cream} />}
            </View>
            {profile ? (
              <>
                <AppText preset="title" style={styles.displayName} numberOfLines={2}>{safeNickname(profile.nickname, profile.tag)}#{profile.tag}</AppText>
                <AppText preset="body" style={styles.travelerLabel}>Путешественник слов</AppText>
              </>
            ) : (
              <>
                <AppText preset="body" style={styles.profileStatus}>
                  {error
                    ? 'Профиль создастся автоматически при подключении к сети.'
                    : 'Создаём профиль…'}
                </AppText>
                {error ? (
                  <AppButton analyticsId="profile_retry" label={busy ? '...' : 'Повторить'} icon="profile" onPress={() => ensure()} />
                ) : null}
              </>
            )}
          </View>

          <View style={styles.statsPanel}>
            <AppText preset="label" style={styles.statsHeading}>ВАШ МАРШРУТ</AppText>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <AppText preset="display" style={styles.statValue}>{completed}</AppText>
                <AppText preset="body" style={styles.statLabel}>уровней</AppText>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressLevels, { width: `${Math.min(100, (completed / Math.max(1, totalLevels)) * 100)}%` }]} />
                </View>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <AppText preset="display" style={styles.statValue}>{opened}</AppText>
                <AppText preset="body" style={styles.statLabel}>мест</AppText>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressPlaces, { width: `${Math.min(100, (opened / Math.max(1, totalPlaces)) * 100)}%` }]} />
                </View>
              </View>
            </View>
          </View>

          {profile ? (
            <View style={styles.renamePanel}>
              <AppText preset="title" style={styles.renameTitle}>Никнейм</AppText>
              <AppText preset="body" style={styles.renameHint}>Так вас видят другие путешественники</AppText>
              <TextInput
                value={nick}
                onChangeText={setNick}
                placeholder="Ваш ник"
                placeholderTextColor={colors.brown}
                maxLength={16}
                autoCapitalize="none"
                accessibilityLabel="Никнейм"
                style={styles.nicknameInput}
              />
              {error ? (
                <AppText preset="body" style={styles.errorText}>
                  {error === 'bad_nickname'
                    ? 'Ник: 2–16 символов, без спецсимволов'
                    : 'Не удалось сохранить ник. Проверьте подключение.'}
                </AppText>
              ) : null}
              <AppButton
                analyticsId="profile_rename"
                label={busy ? 'Сохранение…' : 'Сохранить ник'}
                icon="profile"
                disabled={busy || nick.trim().length < 2 || nick.trim() === profile.nickname}
                style={styles.saveButton}
                onPress={async () => {
                  const ok = await rename(nick);
                  // Сразу обновляем кэш лидерборда, чтобы новый ник появился без переоткрытия.
                  if (ok) {
                    const scope = (useLeaderboard.getState().snapshot?.scope as 'global' | 'weekly') ?? 'global';
                    void useLeaderboard.getState().load(scope);
                  }
                }}
              />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  backButton: { paddingHorizontal: 14 },
  content: { paddingHorizontal: 18, paddingBottom: 28, gap: 18 },
  hero: { alignItems: 'center', gap: 10, paddingTop: 12, paddingBottom: 12 },
  avatarRing: { width: 96, height: 96, borderRadius: radius.pill, backgroundColor: 'rgba(29,19,35,0.44)', borderWidth: 2, borderColor: colors.cream, alignItems: 'center', justifyContent: 'center', boxShadow: '0 7px 18px rgba(5,8,16,0.24)' },
  avatarInitial: { color: colors.cream, fontSize: 34 },
  displayName: { color: colors.text, textAlign: 'center', fontSize: 20, lineHeight: 28, maxWidth: '100%' },
  travelerLabel: { color: colors.cream, textAlign: 'center', fontSize: 13 },
  profileStatus: { color: colors.cream, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  statsPanel: { backgroundColor: colors.cream, borderWidth: 2, borderColor: colors.goldBorder, borderRadius: radius.md, paddingHorizontal: 15, paddingVertical: 17, gap: 14, boxShadow: '0 8px 18px rgba(31,20,30,0.22)' },
  statsHeading: { color: colors.brown, textAlign: 'center', fontSize: 14, letterSpacing: 0.8 },
  statsRow: { flexDirection: 'row', alignItems: 'stretch' },
  stat: { flex: 1, alignItems: 'center', gap: 5, paddingHorizontal: 9 },
  statDivider: { width: 1, backgroundColor: colors.goldBorder, opacity: 0.65 },
  statValue: { color: colors.brown, fontSize: 29, lineHeight: 36 },
  statLabel: { color: colors.brown, fontSize: 13 },
  progressTrack: { height: 7, alignSelf: 'stretch', borderRadius: radius.pill, backgroundColor: colors.creamDeep, overflow: 'hidden', marginTop: 5 },
  progressLevels: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.playGreen },
  progressPlaces: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.goldBorder },
  renamePanel: { backgroundColor: colors.cream, borderWidth: 2, borderColor: colors.goldBorder, borderRadius: radius.md, padding: 16, gap: 10, boxShadow: '0 8px 18px rgba(31,20,30,0.22)' },
  renameTitle: { color: colors.brown, fontSize: 17 },
  renameHint: { color: colors.brown, opacity: 0.78, fontSize: 12 },
  nicknameInput: { backgroundColor: '#FFFCF2', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.goldBorder, color: colors.brown, fontFamily: fonts.body, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 52 },
  errorText: { color: colors.plumDeep, fontSize: 12 },
  saveButton: { alignSelf: 'stretch', backgroundColor: colors.playGreenDark, borderWidth: 2, borderColor: colors.playGreen },
});
