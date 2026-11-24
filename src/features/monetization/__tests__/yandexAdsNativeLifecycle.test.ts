jest.mock('yandex-mobile-ads', () => ({
  MobileAds: { initialize: jest.fn(async () => {}) },
  InterstitialAdLoader: { create: jest.fn() },
  RewardedAdLoader: { create: jest.fn() },
}));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn() } },
}));

type MockAd = {
  show: jest.Mock<Promise<void>, []>;
  dispose?: jest.Mock<Promise<void>, []>;
  onAdDismissed?: () => void;
  onAdFailedToShow?: (error: Error) => void;
  onRewarded?: () => void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  jest.resetModules();
  const { AppState } = jest.requireMock('react-native') as {
    AppState: { currentState: string; addEventListener: jest.Mock };
  };
  const sdk = jest.requireMock('yandex-mobile-ads') as {
    MobileAds: { initialize: jest.Mock };
    InterstitialAdLoader: { create: jest.Mock };
    RewardedAdLoader: { create: jest.Mock };
  };
  const interstitialAds: MockAd[] = [];
  const rewardedAds: MockAd[] = [];
  const loader = (ads: MockAd[]) => ({
    loadAd: jest.fn(async (): Promise<MockAd> => {
      const ad = { show: jest.fn(async () => {}), dispose: jest.fn(async () => {}) };
      ads.push(ad);
      return ad;
    }),
  });
  const interstitialLoader = loader(interstitialAds);
  const rewardedLoader = loader(rewardedAds);
  sdk.InterstitialAdLoader.create.mockResolvedValue(interstitialLoader);
  sdk.RewardedAdLoader.create.mockResolvedValue(rewardedLoader);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { YandexAdsProvider } = require('../yandexAds.native') as typeof import('../yandexAds.native');
  YandexAdsProvider.setInterstitialPreloadAllowed?.(true);
  const provider = YandexAdsProvider as typeof YandexAdsProvider & {
    subscribeRewardedReady?: (listener: () => void) => () => void;
  };
  const appState = (state: string) => {
    AppState.currentState = state;
    AppState.addEventListener.mock.calls[0]?.[1](state);
  };
  return { sdk, provider, interstitialLoader, rewardedLoader, interstitialAds, rewardedAds, appState };
}

describe('Yandex Android native ad lifecycle', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('exposes loading, no fill, background and fullscreen states without assuming network failure', async () => {
    const { provider, rewardedLoader, appState, interstitialAds } = fixture();
    const load = deferred<MockAd>();
    rewardedLoader.loadAd.mockReturnValueOnce(load.promise);
    const initializing = provider.init();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(provider.getRewardedState?.()).toBe('loading');
    load.resolve({ show: jest.fn(async () => {}) });
    await initializing;
    expect(provider.getRewardedState?.()).toBe('ready');
    appState('background');
    expect(provider.getRewardedState?.()).toBe('background');
    appState('active');
    const showing = provider.showInterstitial('level_complete');
    expect(provider.getRewardedState?.()).toBe('fullscreen_busy');
    interstitialAds[0].onAdDismissed?.(); await showing;
    const rewarded = provider.showRewarded('wheel');
    rewardedLoader.loadAd.mockRejectedValueOnce(new Error('{"description":"No fill."}'));
    // Settle the retained ad returned by the deferred loader above via its captured value.
    const loaded = await load.promise;
    loaded.onAdDismissed?.(); await rewarded;
    await provider.init();
    expect(provider.getRewardedState?.()).toBe('no_fill');
    expect(provider.getRewardedFailure?.()).toBe('no_fill');
  });

  test('missing callback returns control but blocks a second fullscreen until the exact old ad terminates', async () => {
    const { provider, rewardedAds } = fixture();
    await provider.init();
    const first = provider.showRewarded('wheel');
    await jest.advanceTimersByTimeAsync(180_000);
    await expect(first).resolves.toBe('unavailable');
    expect(provider.getRewardedState?.()).toBe('fullscreen_busy');
    await expect(provider.showRewarded('wheel')).resolves.toBe('unavailable');
    await expect(provider.showInterstitial('level_complete')).resolves.toBe('unavailable');
    rewardedAds[0].onAdDismissed?.();
    await provider.init();
    expect(provider.isRewardedReady()).toBe(true);
    const second = provider.showRewarded('wheel');
    rewardedAds[0].onAdDismissed?.();
    expect(provider.isRewardedReady()).toBe(false);
    rewardedAds[1].onAdDismissed?.();
    await expect(second).resolves.toBe('dismissed');
  });

  test('rich state subscribers receive loading while legacy boolean subscribers observe only true readiness changes', async () => {
    const { provider } = fixture();
    const states: string[] = [];
    const ready: boolean[] = [];
    const stopState = provider.subscribeRewardedState?.(() => states.push(provider.getRewardedState!()));
    const stopReady = provider.subscribeRewardedReady?.(() => ready.push(provider.isRewardedReady()));
    await provider.init();
    expect(states).toEqual(['loading', 'ready']);
    expect(ready).toEqual([true]);
    stopState?.(); stopReady?.();
  });
  test('reuses one loader per format across repeated completed shows', async () => {
    const { provider, sdk, interstitialAds, rewardedAds, interstitialLoader, rewardedLoader } = fixture();
    await provider.init();
    for (let index = 0; index < 4; index += 1) {
      const interstitial = provider.showInterstitial('level_complete');
      interstitialAds[index].onAdDismissed?.();
      await expect(interstitial).resolves.toBe('shown');
      const rewarded = provider.showRewarded('wheel');
      rewardedAds[index].onAdDismissed?.();
      await expect(rewarded).resolves.toBe('dismissed');
      provider.setInterstitialPreloadAllowed?.(true);
      await provider.init();
    }
    expect(sdk.InterstitialAdLoader.create).toHaveBeenCalledTimes(1);
    expect(sdk.RewardedAdLoader.create).toHaveBeenCalledTimes(1);
    expect(interstitialLoader.loadAd).toHaveBeenCalledTimes(5);
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(5);
  });

  test('shares pending loader creation and loading between concurrent callers', async () => {
    const { provider, sdk, rewardedLoader } = fixture();
    const creation = deferred<typeof rewardedLoader>();
    sdk.RewardedAdLoader.create.mockReturnValue(creation.promise);
    const first = provider.init();
    const second = provider.init();
    await expect(provider.showRewarded('wheel')).resolves.toBe('unavailable');
    creation.resolve(rewardedLoader);
    await Promise.all([first, second]);
    expect(sdk.MobileAds.initialize).toHaveBeenCalledTimes(1);
    expect(sdk.RewardedAdLoader.create).toHaveBeenCalledTimes(1);
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(1);
    expect(provider.isRewardedReady()).toBe(true);
  });

  test.each(['interstitial', 'rewarded'] as const)('retries failed %s loader creation without caching the failure', async (format) => {
    const { provider, sdk, interstitialLoader, rewardedLoader } = fixture();
    const factory = format === 'interstitial' ? sdk.InterstitialAdLoader : sdk.RewardedAdLoader;
    const loader = format === 'interstitial' ? interstitialLoader : rewardedLoader;
    factory.create.mockRejectedValueOnce(new Error('creation unavailable'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await provider.init();
      await jest.advanceTimersByTimeAsync(2_000);
      await Promise.all([provider.init(), provider.init()]);
      expect(factory.create).toHaveBeenCalledTimes(2);
      expect(loader.loadAd).toHaveBeenCalledTimes(1);
      expect(format === 'interstitial' ? provider.isInterstitialReady() : provider.isRewardedReady()).toBe(true);
    } finally {
      warning.mockRestore();
    }
  });

  test.each(['interstitial', 'rewarded'] as const)('retries failed %s loads using the existing loader', async (format) => {
    const { provider, sdk, interstitialLoader, rewardedLoader } = fixture();
    const factory = format === 'interstitial' ? sdk.InterstitialAdLoader : sdk.RewardedAdLoader;
    const loader = format === 'interstitial' ? interstitialLoader : rewardedLoader;
    loader.loadAd.mockRejectedValueOnce(new Error('network unavailable'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await provider.init();
      await jest.advanceTimersByTimeAsync(2_000);
      await Promise.all([provider.init(), provider.init()]);
      expect(factory.create).toHaveBeenCalledTimes(1);
      expect(loader.loadAd).toHaveBeenCalledTimes(2);
      expect(format === 'interstitial' ? provider.isInterstitialReady() : provider.isRewardedReady()).toBe(true);
    } finally {
      warning.mockRestore();
    }
  });

  test.each(['interstitial', 'rewarded'] as const)('a synchronous %s refill failure releases the in-flight attempt', async (format) => {
    const { provider, sdk, interstitialLoader, rewardedLoader, interstitialAds, rewardedAds } = fixture();
    const factory = format === 'interstitial' ? sdk.InterstitialAdLoader : sdk.RewardedAdLoader;
    const loader = format === 'interstitial' ? interstitialLoader : rewardedLoader;
    await provider.init();
    loader.loadAd.mockImplementationOnce(() => { throw new Error('synchronous bridge failure'); });
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const shown = format === 'interstitial'
        ? provider.showInterstitial('level_complete') : provider.showRewarded('wheel');
      (format === 'interstitial' ? interstitialAds : rewardedAds)[0].onAdDismissed?.();
      await shown;
      provider.setInterstitialPreloadAllowed?.(true);
      await jest.advanceTimersByTimeAsync(2_000);
      await provider.init();
      expect(factory.create).toHaveBeenCalledTimes(1);
      expect(loader.loadAd).toHaveBeenCalledTimes(3);
      expect(format === 'interstitial' ? provider.isInterstitialReady() : provider.isRewardedReady()).toBe(true);
    } finally {
      warning.mockRestore();
    }
  });

  test('notifies readiness changes on load, taking an ad and refill, and supports unsubscribe', async () => {
    const { provider, rewardedAds } = fixture();
    const readiness: boolean[] = [];
    const unsubscribe = provider.subscribeRewardedReady?.(() => readiness.push(provider.isRewardedReady()));
    expect(readiness).toEqual([]);
    await provider.init();
    expect(readiness).toEqual([true]);
    await provider.init();
    expect(readiness).toEqual([true]);
    const shown = provider.showRewarded('wheel');
    expect(readiness).toEqual([true, false]);
    rewardedAds[0].onAdDismissed?.();
    await shown;
    await provider.init();
    expect(readiness).toEqual([true, false, true]);
    unsubscribe?.();
    unsubscribe?.();
    const next = provider.showRewarded('wheel');
    rewardedAds[1].onAdDismissed?.();
    await next;
    await provider.init();
    expect(readiness).toEqual([true, false, true]);
  });

  test('failed refill keeps readiness false without duplicate notifications and can recover', async () => {
    const { provider, rewardedAds, rewardedLoader } = fixture();
    const readiness: boolean[] = [];
    provider.subscribeRewardedReady?.(() => readiness.push(provider.isRewardedReady()));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await provider.init();
      rewardedLoader.loadAd.mockRejectedValueOnce(new Error('refill unavailable'));
      const shown = provider.showRewarded('wheel');
      rewardedAds[0].onAdDismissed?.();
      await shown;
      // Join the refill while it is pending instead of starting another attempt.
      await Promise.resolve();
      expect(provider.isRewardedReady()).toBe(false);
      expect(readiness).toEqual([true, false]);
      await jest.advanceTimersByTimeAsync(2_000);
      await provider.init();
      expect(readiness).toEqual([true, false, true]);
    } finally {
      warning.mockRestore();
    }
  });

  test('a failing readiness subscriber cannot discard a loaded ad or block other subscribers', async () => {
    const { provider } = fixture();
    const listener = jest.fn();
    provider.subscribeRewardedReady?.(() => { throw new Error('subscriber failed'); });
    provider.subscribeRewardedReady?.(listener);
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(provider.init()).resolves.toBeUndefined();
      expect(provider.isRewardedReady()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  test.each(['interstitial', 'rewarded'] as const)('recovers an offline %s load automatically, with one in-flight request', async (format) => {
    const { provider, sdk, interstitialLoader, rewardedLoader } = fixture();
    const loader = format === 'interstitial' ? interstitialLoader : rewardedLoader;
    const factory = format === 'interstitial' ? sdk.InterstitialAdLoader : sdk.RewardedAdLoader;
    const recovery = deferred<MockAd>();
    loader.loadAd.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(recovery.promise);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await provider.init();
    await provider.init();
    for (let index = 0; index < 10; index += 1) {
      provider.isInterstitialReady();
      provider.isRewardedReady();
    }
    expect(loader.loadAd).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(loader.loadAd).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    const joined = provider.init();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(loader.loadAd).toHaveBeenCalledTimes(2);
    expect(factory.create).toHaveBeenCalledTimes(1);
    recovery.resolve({ show: jest.fn(async () => {}) });
    await joined;
    expect(format === 'interstitial' ? provider.isInterstitialReady() : provider.isRewardedReady()).toBe(true);
  });

  test('backs off repeated failures, stops after a finite burst, and resumes recovery on foreground', async () => {
    const { provider, rewardedLoader, appState } = fixture();
    rewardedLoader.loadAd.mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await provider.init();
    for (const [index, delay] of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000].entries()) {
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(index + 1);
      await jest.advanceTimersByTimeAsync(1);
      expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(index + 2);
    }
    await jest.advanceTimersByTimeAsync(600_000);
    await provider.init();
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(7);
    appState('background');
    appState('active');
    await jest.advanceTimersByTimeAsync(0);
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(8);
  });

  test('cancels retries while backgrounded and recovers both missing formats on return', async () => {
    const { provider, interstitialLoader, rewardedLoader, appState } = fixture();
    interstitialLoader.loadAd.mockRejectedValueOnce(new Error('offline'));
    rewardedLoader.loadAd.mockRejectedValueOnce(new Error('offline'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await provider.init();
    appState('background');
    await jest.advanceTimersByTimeAsync(600_000);
    await provider.init();
    expect(interstitialLoader.loadAd).toHaveBeenCalledTimes(1);
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(1);
    appState('active');
    await provider.init();
    expect(interstitialLoader.loadAd).toHaveBeenCalledTimes(2);
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(2);
    expect(provider.isInterstitialReady()).toBe(true);
    expect(provider.isRewardedReady()).toBe(true);
  });

  test('does not initialize or request ads until the app is foregrounded', async () => {
    const { provider, sdk, interstitialLoader, rewardedLoader, appState } = fixture();
    // Subscribe first; backgrounding before init is also reflected in currentState below.
    appState('background');
    await provider.init();
    expect(sdk.MobileAds.initialize).not.toHaveBeenCalled();
    expect(interstitialLoader.loadAd).not.toHaveBeenCalled();
    expect(rewardedLoader.loadAd).not.toHaveBeenCalled();
    appState('active');
    await provider.init();
    expect(sdk.MobileAds.initialize).toHaveBeenCalledTimes(1);
  });

  test('recovers failed SDK initialization before attempting any ad loads', async () => {
    const { provider, sdk, interstitialLoader, rewardedLoader } = fixture();
    sdk.MobileAds.initialize.mockRejectedValueOnce(new Error('init unavailable'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await provider.init();
    expect(interstitialLoader.loadAd).not.toHaveBeenCalled();
    expect(rewardedLoader.loadAd).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(sdk.MobileAds.initialize).toHaveBeenCalledTimes(2);
    expect(interstitialLoader.loadAd).toHaveBeenCalledTimes(1);
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(1);
  });

  test.each(['interstitial', 'rewarded'] as const)('the %s fullscreen lock prevents overlap in both directions', async (format) => {
    const { provider, interstitialAds, rewardedAds } = fixture();
    await provider.init();
    const first = format === 'interstitial'
      ? provider.showInterstitial('level_complete') : provider.showRewarded('wheel');
    expect(provider.isInterstitialReady()).toBe(false);
    expect(provider.isRewardedReady()).toBe(false);
    await expect(provider.showInterstitial('level_complete')).resolves.toBe('unavailable');
    await expect(provider.showRewarded('wheel')).resolves.toBe('unavailable');
    expect(interstitialAds[0].show).toHaveBeenCalledTimes(format === 'interstitial' ? 1 : 0);
    expect(rewardedAds[0].show).toHaveBeenCalledTimes(format === 'rewarded' ? 1 : 0);
    (format === 'interstitial' ? interstitialAds : rewardedAds)[0].onAdDismissed?.();
    await first;
    await provider.init();
    const second = format === 'interstitial'
      ? provider.showRewarded('wheel') : provider.showInterstitial('level_complete');
    (format === 'interstitial' ? rewardedAds : interstitialAds)[0].onAdDismissed?.();
    await second;
  });

  test('background skips consume neither cached ad and readiness changes follow foreground and the lock', async () => {
    const { provider, interstitialAds, rewardedAds, appState } = fixture();
    const readiness: boolean[] = [];
    provider.subscribeRewardedReady?.(() => readiness.push(provider.isRewardedReady()));
    await provider.init();
    appState('background');
    await expect(provider.showInterstitial('level_complete')).resolves.toBe('unavailable');
    await expect(provider.showRewarded('wheel')).resolves.toBe('unavailable');
    expect(interstitialAds[0].show).not.toHaveBeenCalled();
    expect(rewardedAds[0].show).not.toHaveBeenCalled();
    appState('active');
    const shown = provider.showInterstitial('level_complete');
    interstitialAds[0].onAdDismissed?.();
    await shown;
    expect(readiness).toEqual([true, false, true, false, true]);
  });

  test.each(['interstitial', 'rewarded'] as const)('a synchronous %s show failure releases the fullscreen lock', async (format) => {
    const { provider, interstitialAds, rewardedAds } = fixture();
    await provider.init();
    (format === 'interstitial' ? interstitialAds : rewardedAds)[0].show.mockImplementationOnce(() => {
      throw new Error('native show failed synchronously');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(format === 'interstitial'
      ? provider.showInterstitial('level_complete') : provider.showRewarded('wheel')).resolves.toBe('unavailable');
    const next = format === 'interstitial'
      ? provider.showRewarded('wheel') : provider.showInterstitial('level_complete');
    (format === 'interstitial' ? rewardedAds : interstitialAds)[0].onAdDismissed?.();
    await next;
  });

  test.each(['interstitial', 'rewarded'] as const)('a rejected %s show releases the fullscreen lock and the next eligible demand refills once', async (format) => {
    const { provider, interstitialAds, rewardedAds, interstitialLoader, rewardedLoader } = fixture();
    await provider.init();
    const ads = format === 'interstitial' ? interstitialAds : rewardedAds;
    const loader = format === 'interstitial' ? interstitialLoader : rewardedLoader;
    ads[0].show.mockRejectedValueOnce(new Error('native show rejected'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(format === 'interstitial'
      ? provider.showInterstitial('level_complete') : provider.showRewarded('wheel')).resolves.toBe('unavailable');
    // A late duplicate native callback cannot release another show's lock or refill again.
    ads[0].onAdFailedToShow?.(new Error('duplicate callback'));
    provider.setInterstitialPreloadAllowed?.(true);
    await provider.init();
    expect(loader.loadAd).toHaveBeenCalledTimes(2);
    expect(provider.isInterstitialReady()).toBe(true);
    expect(provider.isRewardedReady()).toBe(true);
  });

  test('dismissal in the background postpones refill until foreground resumption', async () => {
    const { provider, rewardedAds, rewardedLoader, appState } = fixture();
    await provider.init();
    const shown = provider.showRewarded('wheel');
    appState('background');
    rewardedAds[0].onAdDismissed?.();
    await shown;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(1);
    expect(provider.isRewardedReady()).toBe(false);
    appState('active');
    await provider.init();
    expect(rewardedLoader.loadAd).toHaveBeenCalledTimes(2);
    expect(provider.isRewardedReady()).toBe(true);
  });
});
