type TestSdk = {
  adv: {
    showFullscreenAdv: jest.Mock;
    showRewardedVideo: jest.Mock;
  };
  features: {
    LoadingAPI: { ready: jest.Mock };
    GameplayAPI: { start: jest.Mock; stop: jest.Mock };
  };
  on: jest.Mock;
};

function makeSdk(): TestSdk {
  return {
    adv: {
      showFullscreenAdv: jest.fn(),
      showRewardedVideo: jest.fn(),
    },
    features: {
      LoadingAPI: { ready: jest.fn() },
      GameplayAPI: { start: jest.fn(), stop: jest.fn() },
    },
    on: jest.fn(),
  };
}

describe('Yandex Games platform lifecycle', () => {
  const originalPlatform = process.env.EXPO_PUBLIC_GAME_PLATFORM;
  const originalWindow = globalThis.window;

  afterEach(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_GAME_PLATFORM = originalPlatform;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  });

  it('initializes once and reports readiness only after the UI is ready', async () => {
    const sdk = makeSdk();
    const init = jest.fn().mockResolvedValue(sdk);
    process.env.EXPO_PUBLIC_GAME_PLATFORM = 'yandex-games';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { YaGames: { init } },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const platform = require('../yandexGames') as typeof import('../yandexGames');

    await platform.initYandexGames();
    expect(sdk.features.LoadingAPI.ready).not.toHaveBeenCalled();

    await platform.markYandexGameReady();
    await platform.markYandexGameReady();

    expect(init).toHaveBeenCalledTimes(1);
    expect(sdk.features.LoadingAPI.ready).toHaveBeenCalledTimes(1);
  });

  it('keeps gameplay stopped while an ad or platform pause is active', async () => {
    const sdk = makeSdk();
    const handlers = new Map<string, () => void>();
    sdk.on.mockImplementation((event: string, callback: () => void) => handlers.set(event, callback));
    process.env.EXPO_PUBLIC_GAME_PLATFORM = 'yandex-games';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { YaGames: { init: jest.fn().mockResolvedValue(sdk) } },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const platform = require('../yandexGames') as typeof import('../yandexGames');

    await platform.initYandexGames();
    platform.setYandexGameplayActive(true);
    platform.pauseYandexGameplay('ad');
    handlers.get('game_api_pause')?.();
    platform.resumeYandexGameplay('ad');

    expect(sdk.features.GameplayAPI.start).toHaveBeenCalledTimes(1);
    expect(sdk.features.GameplayAPI.stop).toHaveBeenCalledTimes(1);

    handlers.get('game_api_resume')?.();
    expect(sdk.features.GameplayAPI.start).toHaveBeenCalledTimes(2);
  });

  it('waits for the asynchronous Yandex loader before initializing', async () => {
    const sdk = makeSdk();
    const init = jest.fn().mockResolvedValue(sdk);
    const testWindow: { YaGames?: { init: typeof init } } = {};
    process.env.EXPO_PUBLIC_GAME_PLATFORM = 'yandex-games';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: testWindow,
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const platform = require('../yandexGames') as typeof import('../yandexGames');

    setTimeout(() => {
      testWindow.YaGames = { init };
    }, 10);

    await expect(platform.initYandexGames()).resolves.toBe(sdk);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('reuses the inline SDK bootstrap promise without initializing twice', async () => {
    const sdk = makeSdk();
    const init = jest.fn().mockResolvedValue(sdk);
    process.env.EXPO_PUBLIC_GAME_PLATFORM = 'yandex-games';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        YaGames: { init },
        __YANDEX_GAMES_SDK_PROMISE__: Promise.resolve(sdk),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const platform = require('../yandexGames') as typeof import('../yandexGames');

    await expect(platform.initYandexGames()).resolves.toBe(sdk);
    expect(init).not.toHaveBeenCalled();
  });

  it('reuses the early inline GameReady call without reporting readiness twice', async () => {
    const sdk = makeSdk();
    process.env.EXPO_PUBLIC_GAME_PLATFORM = 'yandex-games';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        __YANDEX_GAME_READY_CALLED__: true,
        __YANDEX_GAME_READY_PROMISE__: Promise.resolve(),
        __YANDEX_GAMES_SDK_PROMISE__: Promise.resolve(sdk),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const platform = require('../yandexGames') as typeof import('../yandexGames');

    await platform.markYandexGameReady();
    await platform.markYandexGameReady();

    expect(sdk.features.LoadingAPI.ready).not.toHaveBeenCalled();
  });
});
