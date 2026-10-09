import {
  useFonts,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { flushAnalytics, setAnalyticsContext, trackFirstOpen, trackGameSessionStart, trackOnce } from '@/features/analytics';
import { AudioRoot } from '@/features/audio';
import { getAds } from '@/features/monetization';
import { useEntitlements } from '@/features/monetization/entitlements';
import { useSubscription } from '@/features/monetization/subscription';
import { getPush, startDailyReminderTelemetry, startLevelExpansionAudienceSync, syncDailyReminders } from '@/features/notifications';
import { useCurrency } from '@/features/currency';
import { backfillUnlockedLandmarks } from '@/features/collection/store';
import { useLevels } from '@/features/levels';
import { backfillCompletedChestCoins } from '@/features/progression/store';
import { reconcileRewards, useRetention } from '@/features/retention';
import { recoverMarathonProgress, reconcileMarathonRewards } from '@/features/marathon';
import { applyMarathonCoinsOnce } from '@/features/game/marathonRewards';
import { assignIntroPackForCurrentProfile, getAssignedIntroVersion, hasIntroPackAssignment } from '@/features/onboarding';
import { useProfile } from '@/features/profile';
import { flushWordReports } from '@/features/word-report';
import { isYandexGamesBuild, markYandexGameReady } from '@/core/platform/yandexGames';
import { colors } from '@/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

function backfillRouteRewards() {
  const completedLevels = useLevels.getState().completed;
  backfillUnlockedLandmarks(completedLevels);
  backfillCompletedChestCoins(completedLevels);
}

function recoverMarathonRewards() {
  recoverMarathonProgress(useRetention.getState());
  reconcileMarathonRewards(applyMarathonCoinsOnce);
}

export default function RootLayout() {
  const router = useRouter();
  const [platformReady, setPlatformReady] = useState(() => !isYandexGamesBuild());
  const [loaded] = useFonts({
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  useEffect(() => {
    if (!loaded) return;

    let isMounted = true;

    const finishLoading = async () => {
      await markYandexGameReady();

      if (!isMounted) return;

      setPlatformReady(true);
      await SplashScreen.hideAsync().catch(() => {});
    };

    void finishLoading();

    return () => {
      isMounted = false;
    };
  }, [loaded]);

  useEffect(() => {
    // Bootstrap runs before fonts/Home mount: fix the cohort before the first event.
    assignIntroPackForCurrentProfile();
    void getAds().init();
    // Профиль создаём автоматически для каждого игрока сразу (без отдельной кнопки).
    void useProfile.getState().ensure().then(() => {
      void flushWordReports();
      void useSubscription.getState().sync();
    });
    setAnalyticsContext({
      onboardingVersion: getAssignedIntroVersion() ?? 'legacy',
      variantId: getAssignedIntroVersion() ?? 'released',
    });
    if (useCurrency.getState().newProfile) trackFirstOpen();
    if (hasIntroPackAssignment()) {
      const assignedVersion = getAssignedIntroVersion()!;
      trackOnce('onboarding_assigned', assignedVersion, { onboardingVersion: assignedVersion });
    }
    trackGameSessionStart();
    flushAnalytics();
    try {
      backfillRouteRewards();
    } catch (error) {
      console.warn('[progression] completed rewards will retry on resume', error);
    }
    try {
      reconcileRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount));
      recoverMarathonRewards();
    } catch (error) {
      console.warn('[rewards] pending grants will retry on resume', error);
    }
    void syncDailyReminders();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      useEntitlements.getState().refreshExpiration();
      void useSubscription.getState().sync();
      trackGameSessionStart('resume');
      flushAnalytics();
      void flushWordReports();
      try {
        backfillRouteRewards();
      } catch (error) {
        console.warn('[progression] completed rewards will retry on resume', error);
      }
      try {
        reconcileRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount));
        recoverMarathonRewards();
      } catch (error) {
        console.warn('[rewards] pending grants will retry on resume', error);
      }
      void syncDailyReminders();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => useEntitlements.getState().refreshExpiration(), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const push = getPush();
    void push.init();
    return push.onNotificationTap((route) => {
      router.navigate(route as never);
    });
  }, [router]);

  useEffect(() => startLevelExpansionAudienceSync(), []);
  useEffect(() => startDailyReminderTelemetry(), []);

  if (!loaded || !platformReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <AudioRoot />
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
      />
    </GestureHandlerRootView>
  );
}
