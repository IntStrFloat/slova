import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { landmarksForWorld, type Landmark } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import type { HintType } from '@/core/engine/types';
import { track } from '@/features/analytics';
import { LandmarkReveal, useCollection } from '@/features/collection';
import { useCurrency } from '@/features/currency';
import { useSettings } from '@/features/settings';
import { useDailyPuzzle, dailySeed } from '@/features/dailypuzzle';
import { CrosswordGrid, LetterDisk, LevelComplete, useGame } from '@/features/game';
import { hintCost } from '@/features/hints';
import { useLeaderboard } from '@/features/leaderboard';
import { DEFAULT_WORLD, loadLevel, useLevels, worldLevelCount } from '@/features/levels';
import {
  getAds,
  loadAdsMeta,
  recordInterstitialShown,
  recordLevelComplete,
  saveAdsMeta,
  shouldShowInterstitial,
  useEntitlements,
} from '@/features/monetization';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, shadowCard, WorldBackground } from '@/ui';

function IconButton({ name, onPress }: { name: 'back'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.glassStrong,
        borderWidth: 1,
        borderColor: colors.glassBorder,
        ...shadowCard,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Icon name={name} size={24} color={colors.text} />
    </Pressable>
  );
}

export default function GameScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isDaily = mode === 'daily';

  const currentLevel = useLevels((s) => s.currentLevel);
  const completeLevel = useLevels((s) => s.completeLevel);
  const start = useGame((s) => s.start);
  const submit = useGame((s) => s.submit);
  const doShuffle = useGame((s) => s.doShuffle);
  const applyHint = useGame((s) => s.hint);
  const disk = useGame((s) => s.disk);
  const play = useGame((s) => s.play);
  const sessionCoins = useGame((s) => s.coins);
  const coins = useCurrency((s) => s.coins);
  const addCoins = useCurrency((s) => s.add);
  const spend = useCurrency((s) => s.spend);
  const removeAds = useEntitlements((s) => s.removeAds);
  const completeDaily = useDailyPuzzle((s) => s.complete);
  const maybeUnlock = useCollection((s) => s.maybeUnlockAtLevel);
  const haptics = useSettings((s) => s.haptics);
  const [done, setDone] = useState(false);
  const [reveal, setReveal] = useState<Landmark | null>(null);

  const levelId = isDaily
    ? (dailySeed() % Math.max(1, worldLevelCount(DEFAULT_WORLD))) + 1
    : currentLevel;
  const level = useMemo(() => loadLevel(DEFAULT_WORLD, levelId), [levelId]);

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
      if (haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (r.levelComplete) setTimeout(() => setDone(true), 450);
    } else if (r.kind === 'bonus') {
      if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (r.kind === 'invalid') {
      if (haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  const tryHint = (type: HintType) => {
    const cost = hintCost(type);
    if (spend('coins', cost)) {
      applyHint(type);
      if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      router.push('/shop' as never);
    }
  };

  const finalize = async () => {
    let meta = recordLevelComplete(loadAdsMeta());
    if (shouldShowInterstitial(meta, { enabled: true, removeAds, nowMs: Date.now() })) {
      const res = await getAds().showInterstitial('level_complete');
      if (res === 'shown') meta = recordInterstitialShown(meta, Date.now());
    }
    saveAdsMeta(meta);
  };

  const onNext = async () => {
    addCoins('coins', sessionCoins);
    track('level_complete', { id: level.id, daily: isDaily });
    if (isDaily) {
      completeDaily();
      router.back();
      return;
    }
    completeLevel(level.id);
    void useLeaderboard.getState().syncProgress(useLevels.getState().completed.length);
    const unlockedId = maybeUnlock(level.world, level.id);
    setDone(false);
    if (unlockedId) {
      const lm = landmarksForWorld(level.world).find((l) => l.id === unlockedId);
      if (lm) {
        setReveal(lm);
        return;
      }
    }
    await finalize();
  };

  const closeReveal = async () => {
    setReveal(null);
    await finalize();
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world={level.world} dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <IconButton name="back" onPress={() => router.back()} />
          <AppText preset="title">{isDaily ? t('daily') : t('level', { n: level.id })}</AppText>
          <CoinBadge value={coins} />
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
              <AppButton label={`${t('hintBulb')} · ${hintCost('bulb')}`} variant="glass" icon="bulb" onPress={() => tryHint('bulb')} />
              <AppButton label={t('shuffle')} variant="glass" icon="shuffle" onPress={() => doShuffle()} />
              <AppButton label={`${t('hintHammer')} · ${hintCost('revealWord')}`} variant="glass" icon="wand" onPress={() => tryHint('revealWord')} />
            </View>
            <LetterDisk letters={disk} onWord={onWord} />
          </View>
        </View>
      </SafeAreaView>

      {done && !reveal ? <LevelComplete coins={sessionCoins} onNext={onNext} /> : null}
      {reveal ? <LandmarkReveal landmark={reveal} onClose={closeReveal} /> : null}
    </View>
  );
}
