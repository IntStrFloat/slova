import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ECONOMY } from '@/core/config/economy';
import { landmarkForLevel, landmarksForWorld, type Landmark } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { useGoBack } from '@/core/nav';
import type { HintType, SubmitResult } from '@/core/engine/types';
import { track } from '@/features/analytics';
import { playSfx } from '@/features/audio';
import { LandmarkReveal, useCollection } from '@/features/collection';
import { useCurrency } from '@/features/currency';
import { useSettings } from '@/features/settings';
import { useDailyPuzzle, dailySeed } from '@/features/dailypuzzle';
import { CrosswordGrid, LetterDisk, LevelComplete, useGame } from '@/features/game';
import { hintCost } from '@/features/hints';
import { useLeaderboard } from '@/features/leaderboard';
import { DEFAULT_WORLD, loadGlobalLevel, useLevels, totalLevelCount } from '@/features/levels';
import {
  getAds,
  isRewardedReady,
  loadAdsMeta,
  NoCoinsModal,
  recordInterstitialShown,
  recordLevelComplete,
  requestRewarded,
  saveAdsMeta,
  shouldShowInterstitial,
  useEntitlements,
} from '@/features/monetization';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, shadowCard, WorldBackground, type IconName } from '@/ui';

function HintChip({
  icon,
  label,
  cost,
  onPress,
  compact = false,
}: {
  icon: IconName;
  label: string;
  cost?: number;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        shadowCard,
        {
          flex: 1,
          minWidth: compact ? 76 : 104,
          backgroundColor: colors.glassStrong,
          borderWidth: 1,
          borderColor: colors.glassBorder,
          borderRadius: radius.md,
          paddingVertical: compact ? 8 : 10,
          paddingHorizontal: compact ? 8 : 10,
          alignItems: 'center',
          gap: 3,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}
    >
      <Icon name={icon} size={compact ? 21 : 22} color={colors.amber} />
      <AppText
        preset="label"
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        numberOfLines={1}
        style={{ width: '100%', textAlign: 'center', fontSize: compact ? 11 : 12 }}
      >
        {label}
      </AppText>
      {cost != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Icon name="coin" size={12} color={colors.amber} />
          <AppText preset="body" style={{ fontSize: 12, color: colors.amber }}>{cost}</AppText>
        </View>
      ) : (
        <View style={{ height: 15 }} />
      )}
    </Pressable>
  );
}

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
  const goBack = useGoBack();
  const { width, height } = useWindowDimensions();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isDaily = mode === 'daily';

  const currentLevel = useLevels((s) => s.currentLevel);
  const completeLevel = useLevels((s) => s.completeLevel);
  const start = useGame((s) => s.start);
  const submit = useGame((s) => s.submit);
  const doShuffle = useGame((s) => s.doShuffle);
  const applyHint = useGame((s) => s.hint);
  const finish = useGame((s) => s.finish);
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
  const [pendingHint, setPendingHint] = useState<HintType | null>(null);
  const [doubled, setDoubled] = useState(false);
  // Гарды от двойного начисления награды при быстром повторном тапе.
  const claiming = useRef(false);
  const doubling = useRef(false);

  const levelId = isDaily
    ? (dailySeed() % Math.max(1, totalLevelCount())) + 1
    : currentLevel;
  const level = useMemo(() => loadGlobalLevel(levelId), [levelId]);
  const compactHeight = height <= 780;
  const tinyHeight = height <= 745;
  const horizontalInset = width <= 370 ? 10 : 16;
  const diskSize = Math.max(248, Math.min(width - horizontalInset * 2 - 18, tinyHeight ? 260 : compactHeight ? 280 : 312));
  const gridMaxHeight = tinyHeight ? 210 : compactHeight ? 245 : 300;

  useEffect(() => {
    if (level) {
      start(level, isDaily ? 'daily' : 'normal');
      track('level_start', { id: level.id, daily: isDaily });
      queueMicrotask(() => {
        setDone(false);
        setDoubled(false);
        setPendingHint(null);
      });
      claiming.current = false;
      doubling.current = false;
    }
  }, [level, start, isDaily]);

  if (!level || !play) {
    return (
      <View style={{ flex: 1 }}>
        <WorldBackground world={DEFAULT_WORLD} dim />
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <AppText preset="title">{t('comingSoon')}</AppText>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
        </SafeAreaView>
      </View>
    );
  }

  const onWord = (w: string): SubmitResult['kind'] => {
    const r = submit(w);
    if (r.kind === 'grid') {
      track('word_found', { word: r.word, id: level.id });
      playSfx(r.levelComplete ? 'win' : 'correct');
      if (haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (r.levelComplete) setTimeout(() => setDone(true), 450);
    } else if (r.kind === 'bonus') {
      track('word_found', { word: r.word, bonus: true, id: level.id });
      playSfx('bonus');
      if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (r.kind === 'invalid') {
      track('wrong_word', { word: r.word, id: level.id });
      playSfx('error');
      if (haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    return r.kind;
  };

  const runHint = (type: HintType) => {
    applyHint(type);
    track('hint_used', { type, id: level.id });
    if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const tryHint = (type: HintType) => {
    const cost = hintCost(type);
    if (spend('coins', cost)) {
      track('coins_spent', { reason: 'hint', amount: cost });
      runHint(type);
    } else {
      // Не хватает монет → предложить rewarded-рекламу за монеты или магазин (спека 05/08).
      setPendingHint(type);
    }
  };

  // Просмотр rewarded за монеты; при успехе — начисление и авто-применение отложенной подсказки.
  const onWatchAdForCoins = async () => {
    const type = pendingHint;
    setPendingHint(null);
    const res = await requestRewarded('hint');
    if (res !== 'rewarded') return;
    addCoins('coins', ECONOMY.rewardedCoins);
    track('coins_earned', { reason: 'rewarded', amount: ECONOMY.rewardedCoins });
    if (type) {
      const cost = hintCost(type);
      if (useCurrency.getState().coins >= cost && spend('coins', cost)) {
        track('coins_spent', { reason: 'hint', amount: cost });
        runHint(type);
      }
    }
  };

  // Удвоение награды за уровень через rewarded (спека 05). Начисляем ровно один раз.
  const onDouble = async () => {
    if (doubling.current || doubled) return;
    doubling.current = true;
    const res = await requestRewarded('double');
    if (res === 'rewarded') {
      addCoins('coins', sessionCoins);
      track('coins_earned', { reason: 'double', amount: sessionCoins });
      setDoubled(true);
      if (haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    doubling.current = false;
  };

  const finalize = async () => {
    let meta = recordLevelComplete(loadAdsMeta());
    if (shouldShowInterstitial(meta, { enabled: true, removeAds, nowMs: Date.now() })) {
      const res = await getAds().showInterstitial('level_complete');
      if (res === 'shown') {
        meta = recordInterstitialShown(meta, Date.now());
        track('interstitial_shown', { placement: 'level_complete' });
      } else if (res === 'unavailable') {
        track('ad_failed', { placement: 'level_complete', kind: 'interstitial' });
      }
    }
    saveAdsMeta(meta);
  };

  const onNext = async () => {
    if (claiming.current) return;
    claiming.current = true;
    addCoins('coins', sessionCoins);
    track('coins_earned', { reason: 'level', amount: sessionCoins });
    track('level_complete', { id: level.id, daily: isDaily });
    if (isDaily) {
      const { reward } = completeDaily();
      if (reward > 0) addCoins('coins', reward);
      finish();
      goBack();
      return;
    }
    completeLevel(level.id);
    finish();
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
      <WorldBackground world={level.world} image={landmarkForLevel(level.world, level.id)?.image} dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: horizontalInset }}>
          <IconButton name="back" onPress={goBack} />
          <AppText preset="title">{isDaily ? t('daily') : t('level', { n: level.id })}</AppText>
          <CoinBadge value={coins} />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingTop: tinyHeight ? 2 : 8, paddingBottom: 12 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: tinyHeight ? 8 : 12, paddingHorizontal: horizontalInset }}>
            <CrosswordGrid level={level} filled={play.filled} maxWidth={width - horizontalInset * 2} maxHeight={gridMaxHeight} />
            {level.bonusPool.length > 0 ? (
              <GlassPanel style={{ paddingVertical: tinyHeight ? 6 : 8, paddingHorizontal: 14, borderRadius: radius.lg, alignItems: 'center', gap: 6, maxWidth: 320 }}>
                <AppText preset="body" style={{ color: colors.textMuted }}>
                  {tinyHeight ? 'Бонус' : t('bonusWords')}: {play.foundBonus.length}/{level.bonusPool.length}
                </AppText>
                {play.foundBonus.length > 0 && !tinyHeight ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
                    {play.foundBonus.map((w) => (
                      <View
                        key={w}
                        style={{
                          backgroundColor: colors.amber,
                          borderRadius: radius.pill,
                          paddingVertical: 3,
                          paddingHorizontal: 10,
                        }}
                      >
                        <AppText preset="label" style={{ color: colors.onAmber, fontSize: 13 }}>
                          {w.toUpperCase()}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </GlassPanel>
            ) : null}
          </View>

          <View style={{ alignItems: 'center', gap: tinyHeight ? 8 : 12, paddingHorizontal: horizontalInset }}>
            <View style={{ width: '100%', maxWidth: 380, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <HintChip compact={compactHeight} icon="bulb" label={t('hintBulb')} cost={hintCost('bulb')} onPress={() => tryHint('bulb')} />
              <HintChip compact={compactHeight} icon="shuffle" label="Микс" onPress={() => doShuffle()} />
              <HintChip compact={compactHeight} icon="wand" label={t('hintHammer')} cost={hintCost('revealWord')} onPress={() => tryHint('revealWord')} />
            </View>
            <LetterDisk letters={disk} onWord={onWord} size={diskSize} />
          </View>
        </View>
      </SafeAreaView>

      {done && !reveal ? (
        <LevelComplete
          coins={sessionCoins}
          onNext={onNext}
          onDouble={onDouble}
          canDouble={!removeAds && isRewardedReady()}
          doubled={doubled}
        />
      ) : null}
      {reveal ? <LandmarkReveal landmark={reveal} onClose={closeReveal} /> : null}
      {pendingHint && !done ? (
        <NoCoinsModal
          deficit={Math.max(0, hintCost(pendingHint) - coins)}
          rewardCoins={ECONOMY.rewardedCoins}
          canWatchAd={!removeAds && isRewardedReady()}
          onWatchAd={onWatchAdForCoins}
          onShop={() => {
            setPendingHint(null);
            router.push('/shop' as never);
          }}
          onClose={() => setPendingHint(null)}
        />
      ) : null}
    </View>
  );
}
