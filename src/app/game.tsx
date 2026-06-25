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
import { AppText, colors, radius } from '@/ui';

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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgBottom, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <AppText preset="title">{t('comingSoon')}</AppText>
        <Pressable onPress={() => router.back()} style={btnAlt}>
          <AppText preset="label">← {t('map')}</AppText>
        </Pressable>
      </SafeAreaView>
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
        <Pressable onPress={() => router.back()} style={btnAlt}>
          <AppText preset="label">←</AppText>
        </Pressable>
        <AppText preset="title">{t('level', { n: level.id })}</AppText>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14 }}>
          <AppText preset="coin">🪙 {sessionCoins}</AppText>
        </View>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <CrosswordGrid level={level} filled={play.filled} />
          <AppText preset="body" style={{ color: colors.textMuted, marginTop: 10 }}>
            {t('bonusWords')}: {play.foundBonus.length}
          </AppText>
        </View>

        <View style={{ alignItems: 'center', gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => hint('bulb')} style={btnHint}>
              <AppText preset="label">💡 {t('hintBulb')}</AppText>
            </Pressable>
            <Pressable onPress={() => doShuffle()} style={btnHint}>
              <AppText preset="label">🔀 {t('shuffle')}</AppText>
            </Pressable>
            <Pressable onPress={() => hint('revealWord')} style={btnHint}>
              <AppText preset="label">🔨 {t('hintHammer')}</AppText>
            </Pressable>
          </View>
          <LetterDisk letters={disk} onWord={onWord} />
        </View>
      </View>

      {done ? <LevelComplete coins={sessionCoins} onNext={onNext} /> : null}
    </SafeAreaView>
  );
}

const btnAlt = {
  backgroundColor: colors.surfaceAlt,
  borderRadius: radius.pill,
  paddingVertical: 10,
  paddingHorizontal: 16,
} as const;

const btnHint = {
  backgroundColor: colors.surface,
  borderRadius: radius.md,
  paddingVertical: 10,
  paddingHorizontal: 14,
} as const;
