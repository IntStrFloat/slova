import {
  useFonts,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { flushAnalytics, setAnalyticsContext, trackAnalyticsHealthSummary, trackFirstOpen, trackGameSessionStart, trackOnce, useAnalyticsPrefs } from '@/features/analytics';
import { AudioRoot } from '@/features/audio';
import { getAds } from '@/features/monetization';
import { useEntitlements } from '@/features/monetization/entitlements';
import { startSubscriptionAutoSync } from '@/features/monetization/subscriptionAutoSync';
import { recoverRewardedGrants } from '@/features/monetization/rewardRecovery';
import { PushNavigationRoot, startDailyReminderTelemetry, startLevelExpansionAudienceSync, syncDailyReminders } from '@/features/notifications';
import { flushWalletAnalytics, useCurrency } from '@/features/currency';
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
import { AnalyticsNavigationRoot } from '@/features/analytics/AnalyticsNavigationRoot';
import { startRemoteConfig } from '@/features/remote-config';
import { startUpdates } from '@/features/updates';
import { installCrashReporting } from '@/features/crash-reporting';
import { startHelpExperimentRuntime, flushHelpEnrollmentFacts } from '@/features/hints/help-experiment';
import { primeSdkIdentity } from '@/features/analytics/sdkIdentity';
import analyticsManifest from '../../assets/content/analytics-manifest.json';

installCrashReporting();
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
    const stopHelpExperiment = startHelpExperimentRuntime();
    assignIntroPackForCurrentProfile();
    void getAds().init();
    void recoverRewardedGrants({ releaseUnconfirmed: true }).catch(() => {
      console.warn('[rewards] native earned grants remain pending');
    });
    // Профиль создаём автоматически для каждого игрока сразу (без отдельной кнопки).
    void useProfile.getState().ensure().then(() => {
      void flushWordReports();
    });
    setAnalyticsContext({
      configVersion: analyticsManifest.policyVersion,
      contentVersion: analyticsManifest.catalogVersion,
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
    flushWalletAnalytics();
    trackAnalyticsHealthSummary();
    const stopAnalyticsPrefs = useAnalyticsPrefs.subscribe(() => flushWalletAnalytics());
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
      void primeSdkIdentity().then(flushHelpEnrollmentFacts);
      void recoverRewardedGrants().catch(() => {});
      useEntitlements.getState().refreshExpiration();
      trackGameSessionStart('resume');
      flushAnalytics();
      flushWalletAnalytics();
      trackAnalyticsHealthSummary();
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
    return () => { subscription.remove(); stopAnalyticsPrefs(); stopHelpExperiment(); };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => useEntitlements.getState().refreshExpiration(), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => startSubscriptionAutoSync(), []);
  useEffect(() => startRemoteConfig(), []);
  useEffect(() => startUpdates(), []);

  useEffect(() => startLevelExpansionAudienceSync(), []);
  useEffect(() => startDailyReminderTelemetry(), []);

  if (!loaded || !platformReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <AnalyticsNavigationRoot ready={loaded && platformReady} />
      <PushNavigationRoot />
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
