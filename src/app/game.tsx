import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import { useCurrency } from '@/features/currency';
import { CrosswordGrid, LetterDisk, LevelComplete, useGame } from '@/features/game';
import { DEFAULT_WORLD, loadLevel, useLevels } from '@/features/levels';
import {
  getAds,
  loadAdsMeta,
  recordInterstitialShown,
  recordLevelComplete,
  saveAdsMeta,
  shouldShowInterstitial,
  useEntitlements,
} from '@/features/monetization';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

function IconButton({ name, onPress }: { name: 'back'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.glass,
        borderWidth: 1,
        borderColor: colors.glassBorder,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Icon name={name} size={24} color={colors.text} />
    </Pressable>
  );
}

export default function GameScreen() {
  const router = useRouter();
  const currentLevel = useLevels((s) => s.currentLevel);
  const completeLevel = useLevels((s) => s.completeLevel);
  const start = useGame((s) => s.start);
  const submit = useGame((s) => s.submit);
  const doShuffle = useGame((s) => s.doShuffle);
  const hint = useGame((s) => s.hint);
  const disk = useGame((s) => s.disk);
  const play = useGame((s) => s.play);
  const sessionCoins = useGame((s) => s.coins);
  const addCoins = useCurrency((s) => s.add);
  const removeAds = useEntitlements((s) => s.removeAds);
  const [done, setDone] = useState(false);

  const level = useMemo(() => loadLevel(DEFAULT_WORLD, currentLevel), [currentLevel]);

  useEffect(() => {
    if (level) {
      start(level);
      setDone(false);
    }
  }, [level, start]);

  if (!level || !play) {
    return (
      <View style={{ flex: 1 }}>
        <WorldBackground world={DEFAULT_WORLD} dim />
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <AppText preset="title">{t('comingSoon')}</AppText>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
        </SafeAreaView>
      </View>
    );
  }

  const onWord = (w: string) => {
    const r = submit(w);
    if (r.kind === 'grid') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (r.levelComplete) setTimeout(() => setDone(true), 450);
    } else if (r.kind === 'bonus') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (r.kind === 'invalid') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  const onNext = async () => {
    addCoins('coins', sessionCoins);
    completeLevel(level.id);
    let meta = recordLevelComplete(loadAdsMeta());
    if (shouldShowInterstitial(meta, { enabled: true, removeAds, nowMs: Date.now() })) {
      const res = await getAds().showInterstitial('level_complete');
      if (res === 'shown') meta = recordInterstitialShown(meta, Date.now());
    }
    saveAdsMeta(meta);
    setDone(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world={level.world} dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <IconButton name="back" onPress={() => router.back()} />
          <AppText preset="title">{t('level', { n: level.id })}</AppText>
          <CoinBadge value={sessionCoins} />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <CrosswordGrid level={level} filled={play.filled} />
            <GlassPanel style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill }}>
              <AppText preset="body" style={{ color: colors.textMuted }}>
                {t('bonusWords')}: {play.foundBonus.length}
              </AppText>
            </GlassPanel>
          </View>

          <View style={{ alignItems: 'center', gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <AppButton label={t('hintBulb')} variant="glass" icon="bulb" onPress={() => hint('bulb')} />
              <AppButton label={t('shuffle')} variant="glass" icon="shuffle" onPress={() => doShuffle()} />
              <AppButton label={t('hintHammer')} variant="glass" icon="wand" onPress={() => hint('revealWord')} />
            </View>
            <LetterDisk letters={disk} onWord={onWord} />
          </View>
        </View>
      </SafeAreaView>

      {done ? <LevelComplete coins={sessionCoins} onNext={onNext} /> : null}
    </View>
  );
}
