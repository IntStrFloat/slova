import { setLang } from '@/core/i18n';

type YandexAdCallbacks = {
  onOpen?: () => void;
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
};

export type YandexGamesSdk = {
  adv: {
    showFullscreenAdv(options?: { callbacks?: YandexAdCallbacks }): void;
    showRewardedVideo(options?: {
      callbacks?: YandexAdCallbacks & { onRewarded?: () => void };
    }): void;
  };
  environment?: {
    i18n?: { lang?: string };
  };
  features?: {
    LoadingAPI?: { ready(): void | Promise<void> };
    GameplayAPI?: {
      start(): void | Promise<void>;
      stop(): void | Promise<void>;
    };
  };
  on?(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
};

type YandexGamesGlobal = {
  init(): Promise<YandexGamesSdk>;
};

declare global {
  interface Window {
    YaGames?: YandexGamesGlobal;
    __YANDEX_GAME_READY_CALLED__?: boolean;
    __YANDEX_GAME_READY_PROMISE__?: Promise<void>;
    __YANDEX_GAMES_SDK_PROMISE__?: Promise<YandexGamesSdk>;
    __YANDEX_GAMES_LANGUAGE__?: string;
  }
}

type PauseReason = 'ad' | 'platform';

let sdk: YandexGamesSdk | null = null;
let initPromise: Promise<YandexGamesSdk | null> | null = null;
let eventsBound = false;
let readyRequested = false;
let readySent = false;
let gameplayDesired = false;
let gameplayRunning = false;
const pauseReasons = new Set<PauseReason>();

const SDK_BOOTSTRAP_TIMEOUT_MS = 10_000;
const SDK_BOOTSTRAP_POLL_MS = 25;

export function isYandexGamesBuild(): boolean {
  return process.env.EXPO_PUBLIC_GAME_PLATFORM === 'yandex-games';
}

function report(stage: string, error: unknown): void {
  console.warn(`[yandex-games] ${stage} failed`, error);
}

function applyYandexLanguage(currentSdk: YandexGamesSdk): void {
  const portalLanguage = window.__YANDEX_GAMES_LANGUAGE__
    ?? currentSdk.environment?.i18n?.lang
    ?? 'ru';
  setLang(portalLanguage === 'en' ? 'en' : 'ru');
}

async function waitForYandexGamesGlobal(): Promise<YandexGamesGlobal | null> {
  const deadline = Date.now() + SDK_BOOTSTRAP_TIMEOUT_MS;
  while (!window.YaGames && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SDK_BOOTSTRAP_POLL_MS));
  }
  return window.YaGames ?? null;
}

function syncGameplay(): void {
  if (!sdk) return;
  const shouldRun = gameplayDesired && pauseReasons.size === 0;
  if (shouldRun === gameplayRunning) return;

  gameplayRunning = shouldRun;
  try {
    const result = shouldRun
      ? sdk.features?.GameplayAPI?.start()
      : sdk.features?.GameplayAPI?.stop();
    void Promise.resolve(result).catch((error) => report('gameplay markup', error));
  } catch (error) {
    report('gameplay markup', error);
  }
}

function bindPlatformEvents(currentSdk: YandexGamesSdk): void {
  if (eventsBound || !currentSdk.on) return;
  eventsBound = true;
  currentSdk.on('game_api_pause', () => pauseYandexGameplay('platform'));
  currentSdk.on('game_api_resume', () => resumeYandexGameplay('platform'));
}

async function sendReadyIfRequested(): Promise<void> {
  if (!sdk || !readyRequested || readySent) return;
  try {
    if (window.__YANDEX_GAME_READY_PROMISE__) {
      await window.__YANDEX_GAME_READY_PROMISE__;
    } else {
      await sdk.features?.LoadingAPI?.ready();
    }
    readySent = true;
  } catch (error) {
    report('LoadingAPI.ready', error);
  }
}

export async function initYandexGames(): Promise<YandexGamesSdk | null> {
  if (!isYandexGamesBuild() || typeof window === 'undefined') return null;
  if (sdk) return sdk;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (window.__YANDEX_GAMES_SDK_PROMISE__) {
      const initialized = await window.__YANDEX_GAMES_SDK_PROMISE__;
      sdk = initialized;
      applyYandexLanguage(initialized);
      bindPlatformEvents(initialized);
      await sendReadyIfRequested();
      syncGameplay();
      return initialized;
    }

    const yaGames = await waitForYandexGamesGlobal();
    if (!yaGames) {
      report('SDK bootstrap', new Error('YaGames global is unavailable'));
      return null;
    }

    const initialized = await yaGames.init();
    sdk = initialized;
    applyYandexLanguage(initialized);
    bindPlatformEvents(initialized);
    await sendReadyIfRequested();
    syncGameplay();
    return initialized;
  })().catch((error) => {
    report('SDK initialization', error);
    return null;
  }).finally(() => {
    if (!sdk) initPromise = null;
  });

  return initPromise;
}

export function getYandexGamesSdk(): YandexGamesSdk | null {
  return sdk;
}

export async function markYandexGameReady(): Promise<void> {
  if (!isYandexGamesBuild()) return;
  readyRequested = true;
  await initYandexGames();
  await sendReadyIfRequested();
}

export function setYandexGameplayActive(active: boolean): void {
  if (!isYandexGamesBuild()) return;
  gameplayDesired = active;
  syncGameplay();
  if (!sdk) void initYandexGames();
}

export function pauseYandexGameplay(reason: PauseReason): void {
  if (!isYandexGamesBuild()) return;
  pauseReasons.add(reason);
  syncGameplay();
}

export function resumeYandexGameplay(reason: PauseReason): void {
  if (!isYandexGamesBuild()) return;
  pauseReasons.delete(reason);
  syncGameplay();
}

export function isYandexRewardedReady(): boolean {
  return isYandexGamesBuild() && sdk !== null;
}
