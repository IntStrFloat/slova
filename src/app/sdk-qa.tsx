import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { AppState, NativeModules, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { discard, hasActiveForm, isAvailable, prepareResult } from '../../modules/rustore-review';
import { checkAvailability as checkUpdatesAvailability, getNativeVersionCode as getUpdatesVersionCode,
  isSupported as isUpdatesSupported, type CheckResult } from '../../modules/rustore-updates';
import { releaseFullscreen, tryAcquireFullscreen, type FullscreenLease } from '@/core/fullscreen';
import { getCrashReportingCapabilities, getSoftwareBuildInfo, type SoftwareBuildInfo } from '@/core/native/appmetrica';
import { isAnalyticsCollectionEnabled, trackAnalyticsHealthSummary } from '@/features/analytics';
import { loadProductQaPanel } from '@/features/product-qa/entry';
import { isExposureWindowFocused } from '@/features/retention-ui/viewportExposure';
import { AppButton, AppText, colors } from '@/ui';

function localQaAllowed(): boolean {
  return process.env.EXPO_PUBLIC_LOCAL_SDK_QA === '1'
    && getCrashReportingCapabilities()?.localQa === true;
}

type Preparation = { lease: FullscreenLease; timer?: ReturnType<typeof setTimeout> };
type UpdatesCheck = { timer?: ReturnType<typeof setTimeout> };

function updatesCheckStatus(result: CheckResult): string {
  if (result.result === 'available') return 'available:unexpected_qa_result';
  const reason = ['disabled', 'native_unavailable', 'busy', 'not_available', 'activity_not_ready',
    'store_missing', 'native_error', 'invalid_native_result', 'unknown_error', 'internal'].includes(result.reason)
    ? result.reason : 'unknown_error';
  return `${result.result}:${reason}`;
}

/** Explicit native-bridge probe. It never reserves a campaign attempt or opens a review form. */
function ReviewQaPanel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('not_checked');
  const [nativeVersionCode, setNativeVersionCode] = useState<number | null>(null);
  const [updatesVersionCode, setUpdatesVersionCode] = useState<string | null>(null);
  const [updatesStatus, setUpdatesStatus] = useState('not_checked');
  const [updatesBusy, setUpdatesBusy] = useState(false);
  const [analyticsBuildInfo, setAnalyticsBuildInfo] = useState<SoftwareBuildInfo | null | undefined>();
  const [collectionEnabled, setCollectionEnabled] = useState<boolean | null>(null);
  const [analyticsStatus, setAnalyticsStatus] = useState('not_checked');
  const [busy, setBusy] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [ProductPanel, setProductPanel] = useState<ComponentType<{ active: boolean }> | null>(null);
  const routeFocused = useRef(false);
  const windowFocused = useRef(isExposureWindowFocused());
  const windowFocusObserved = useRef(false);
  const [focused, setFocused] = useState(() => isExposureWindowFocused() && AppState.currentState === 'active');
  const current = useRef<Preparation | null>(null);
  const currentUpdatesCheck = useRef<UpdatesCheck | null>(null);

  const cancelUpdatesCheck = useCallback((reason: string) => {
    const request = currentUpdatesCheck.current;
    if (!request) return;
    currentUpdatesCheck.current = null;
    if (request.timer) clearTimeout(request.timer);
    // A native QA-disabled check creates no prepared SDK state to discard.
    setUpdatesBusy(false);
    setUpdatesStatus(reason);
  }, []);

  const cancelPreparation = useCallback((reason: string) => {
    const request = current.current;
    if (!request) return;
    current.current = null;
    if (request.timer) clearTimeout(request.timer);
    discard();
    releaseFullscreen(request.lease);
    setBusy(false);
    setStatus(reason);
  }, []);

  useFocusEffect(useCallback(() => {
    routeFocused.current = true;
    // A late route can inherit cached focus; a real local window signal wins.
    if (!windowFocusObserved.current) windowFocused.current = isExposureWindowFocused();
    setFocused(windowFocused.current && AppState.currentState === 'active');
    return () => {
      routeFocused.current = false;
      cancelPreparation('prepare_cancelled');
      cancelUpdatesCheck('cancelled:inactive');
    };
  }, [cancelPreparation, cancelUpdatesCheck]));

  useEffect(() => {
    const change = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      if (!active) {
        cancelPreparation('prepare_cancelled');
        cancelUpdatesCheck('cancelled:inactive');
      }
      setFocused(active && windowFocused.current);
    });
    const blur = AppState.addEventListener('blur', () => {
      windowFocusObserved.current = true;
      windowFocused.current = false;
      setFocused(false);
      cancelPreparation('prepare_cancelled');
      cancelUpdatesCheck('cancelled:inactive');
    });
    const focus = AppState.addEventListener('focus', () => {
      windowFocusObserved.current = true;
      windowFocused.current = true;
      setFocused(AppState.currentState === 'active');
    });
    return () => { change.remove(); blur.remove(); focus.remove(); };
  }, [cancelPreparation, cancelUpdatesCheck]);

  const inspect = () => {
    if (!localQaAllowed()) { setStatus('qa_unavailable'); return; }
    let version = 0;
    try {
      const value: unknown = NativeModules.RustorePush?.getNativeVersionCode?.();
      if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_100_000_000) version = value;
    } catch { /* Older/missing bridges expose no trusted installed version. */ }
    setNativeVersionCode(version);
    setStatus(hasActiveForm() ? 'native_form_active' : isAvailable() ? 'native_available' : 'native_unavailable');
  };

  const prepare = async () => {
    if (!localQaAllowed()) { setStatus('qa_unavailable'); return; }
    if (!routeFocused.current || !windowFocused.current || AppState.currentState !== 'active') {
      setStatus('not_focused'); return;
    }
    if (current.current || hasActiveForm()) { setStatus('fullscreen_busy'); return; }
    if (!isAvailable()) { setStatus('native_unavailable'); return; }
    const lease = tryAcquireFullscreen('review');
    if (!lease) { setStatus('fullscreen_busy'); return; }
    const request: Preparation = { lease };
    current.current = request;
    setBusy(true);
    setStatus('prepare_pending');
    request.timer = setTimeout(() => {
      if (current.current === request) cancelPreparation('prepare_timeout');
    }, 1500);
    try {
      const result = await prepareResult();
      if (current.current !== request) return;
      setStatus(result === 'ready' ? 'prepare_ready' : result === 'unavailable' ? 'prepare_unavailable' : 'prepare_error');
    } catch {
      if (current.current === request) setStatus('prepare_error');
    } finally {
      if (current.current === request) {
        current.current = null;
        if (request.timer) clearTimeout(request.timer);
        // Preparation is consumed only as a diagnostic result, never as permission to show UI.
        discard();
        releaseFullscreen(lease);
        setBusy(false);
      }
    }
  };

  const discardPreparation = () => {
    if (!localQaAllowed()) { setStatus('qa_unavailable'); return; }
    if (current.current) cancelPreparation('prepare_discarded');
    else {
      if (hasActiveForm()) { setStatus('fullscreen_busy'); return; }
      const lease = tryAcquireFullscreen('review');
      if (!lease) { setStatus('fullscreen_busy'); return; }
      try { discard(); setStatus('prepare_discarded'); } finally { releaseFullscreen(lease); }
    }
  };

  const inspectUpdates = () => {
    if (!localQaAllowed()) { setUpdatesStatus('unavailable:qa_guard'); return; }
    let supported = false;
    let version = '0';
    try {
      supported = isUpdatesSupported();
      version = getUpdatesVersionCode() ?? '0';
    } catch { /* Optional older bridges remain unavailable. */ }
    setUpdatesVersionCode(version);
    setUpdatesStatus(supported ? 'bridge_supported' : 'unavailable:native_unavailable');
  };

  const checkDisabledUpdates = async () => {
    if (!localQaAllowed()) { setUpdatesStatus('unavailable:qa_guard'); return; }
    if (!routeFocused.current || !windowFocused.current || AppState.currentState !== 'active') {
      setUpdatesStatus('unavailable:not_focused'); return;
    }
    if (currentUpdatesCheck.current) return;
    if (!isUpdatesSupported()) { setUpdatesStatus('unavailable:native_unavailable'); return; }
    const request: UpdatesCheck = {};
    currentUpdatesCheck.current = request;
    setUpdatesBusy(true);
    setUpdatesStatus('pending');
    request.timer = setTimeout(() => {
      if (currentUpdatesCheck.current === request) cancelUpdatesCheck('unknown:timeout');
    }, 1500);
    try {
      const result = await checkUpdatesAvailability();
      if (currentUpdatesCheck.current === request) setUpdatesStatus(updatesCheckStatus(result));
    } catch {
      if (currentUpdatesCheck.current === request) setUpdatesStatus('unknown:check_error');
    } finally {
      if (currentUpdatesCheck.current === request) {
        currentUpdatesCheck.current = null;
        if (request.timer) clearTimeout(request.timer);
        setUpdatesBusy(false);
      }
    }
  };

  const inspectAnalytics = () => {
    if (!localQaAllowed()) { setAnalyticsStatus('qa_unavailable'); return; }
    setAnalyticsBuildInfo(getSoftwareBuildInfo());
    setCollectionEnabled(isAnalyticsCollectionEnabled());
    try {
      // The existing consent/test-device gates and once-per-session policy decide whether to enqueue.
      trackAnalyticsHealthSummary();
      setAnalyticsStatus('health_summary_requested');
    } catch { setAnalyticsStatus('health_summary_error'); }
  };
  const openProductQa = async () => {
    if (!localQaAllowed() || productLoading || !routeFocused.current || !windowFocused.current || AppState.currentState !== 'active') return;
    setProductLoading(true);
    try {
      const panel = await loadProductQaPanel();
      if (panel && localQaAllowed() && routeFocused.current && windowFocused.current && AppState.currentState === 'active') setProductPanel(() => panel);
    } catch { /* Optional local QA UI fails closed. */ }
    finally { setProductLoading(false); }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: colors.cream }}
      contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, gap: 18 }}>
      <AppText preset="title" style={{ color: colors.brown }}>Локальная SDK QA</AppText>
      <AppText style={{ color: colors.brown }}>
        Диагностика Review не открывает форму оценки и не меняет историю. Продуктовые сценарии ниже запускаются отдельно и меняют только QA профиль.
      </AppText>
      <AppText selectable testID="sdk-qa-status" accessibilityLabel={`SDK QA status: ${status}`} style={{ color: colors.brown }}>
        {status}
      </AppText>
      <AppText selectable testID="sdk-qa-native-version-code"
        accessibilityLabel={`SDK QA native_version_code: ${nativeVersionCode ?? 'not_checked'}`} style={{ color: colors.brown }}>
        {`native_version_code: ${nativeVersionCode ?? 'not_checked'}`}
      </AppText>
      <AppButton label="Проверить Review bridge" disabled={busy} onPress={inspect} />
      <AppButton label="Подготовить Review" disabled={busy || !focused} onPress={() => { void prepare(); }} />
      <AppButton label="Сбросить подготовку" variant="cream" onPress={discardPreparation} />
      <AppText selectable testID="sdk-qa-updates-version-code"
        accessibilityLabel={`SDK QA updates_version_code: ${updatesVersionCode ?? 'not_checked'}`} style={{ color: colors.brown }}>
        {`updates_version_code: ${updatesVersionCode ?? 'not_checked'}`}
      </AppText>
      <AppText selectable testID="sdk-qa-updates-status" accessibilityLabel={`SDK QA updates_status: ${updatesStatus}`}
        style={{ color: colors.brown }}>{updatesStatus}</AppText>
      <AppButton label="Проверить Updates bridge" disabled={updatesBusy} onPress={inspectUpdates} />
      <AppButton label="Проверить отключённый Updates" disabled={updatesBusy || !focused}
        onPress={() => { void checkDisabledUpdates(); }} />
      <AppText selectable testID="sdk-qa-analytics-build"
        accessibilityLabel={`SDK QA analytics_build: ${analyticsBuildInfo === undefined ? 'not_checked' : analyticsBuildInfo?.versionCode ?? 'unknown'}`}
        style={{ color: colors.brown }}>
        {`analytics_build: ${analyticsBuildInfo === undefined ? 'not_checked' : analyticsBuildInfo?.versionCode ?? 'unknown'}`}
      </AppText>
      <AppText selectable testID="sdk-qa-analytics-version-name"
        accessibilityLabel={`SDK QA analytics_version_name: ${analyticsBuildInfo === undefined ? 'not_checked' : analyticsBuildInfo?.versionName ?? 'unknown'}`}
        style={{ color: colors.brown }}>
        {`analytics_version_name: ${analyticsBuildInfo === undefined ? 'not_checked' : analyticsBuildInfo?.versionName ?? 'unknown'}`}
      </AppText>
      <AppText selectable testID="sdk-qa-collection-enabled"
        accessibilityLabel={`SDK QA collection_enabled: ${collectionEnabled ?? 'not_checked'}`} style={{ color: colors.brown }}>
        {`collection_enabled: ${collectionEnabled ?? 'not_checked'}`}
      </AppText>
      <AppText selectable testID="sdk-qa-analytics-status" accessibilityLabel={`SDK QA analytics_status: ${analyticsStatus}`}
        style={{ color: colors.brown }}>{analyticsStatus}</AppText>
      <AppButton label="Проверить метаданные аналитики" onPress={inspectAnalytics} />
      <AppButton label="Открыть продуктовые QA сценарии" disabled={busy || updatesBusy || productLoading || !focused}
        onPress={() => { void openProductQa(); }} />
      {ProductPanel ? <ProductPanel active={focused} /> : null}
      <AppButton label="На главную" variant="cream" onPress={() => router.replace('/')} />
      <AppText style={{ color: colors.brown }}>SDK callback не подтверждает отправку отзыва.</AppText>
    </ScrollView>
  );
}

/** The native guard verifies the actual isolated package, compile flag, manifest and keyless policy. */
export default function SdkQa() {
  if (!localQaAllowed()) return <Redirect href="/" />;
  return <ReviewQaPanel />;
}
