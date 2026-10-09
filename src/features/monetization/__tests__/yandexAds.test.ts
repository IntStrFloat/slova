jest.mock('@/core/platform/yandexGames', () => ({
  initYandexGames: jest.fn(),
  pauseYandexGameplay: jest.fn(),
  resumeYandexGameplay: jest.fn(),
  isYandexRewardedReady: jest.fn(() => true),
}));

const mockPlatform = jest.requireMock('@/core/platform/yandexGames') as {
  initYandexGames: jest.Mock;
  pauseYandexGameplay: jest.Mock;
  resumeYandexGameplay: jest.Mock;
  isYandexRewardedReady: jest.Mock;
};

// Import after the hoisted platform mock so the web provider binds to the test double.
// eslint-disable-next-line import/first
import { YandexGamesAdsProvider } from '../yandexGamesAds';

const {
  initYandexGames: mockInitYandexGames,
  pauseYandexGameplay: mockPauseYandexGameplay,
  resumeYandexGameplay: mockResumeYandexGameplay,
} = mockPlatform;

describe('Yandex Games web ads provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves rewarded only after the SDK reward callback', async () => {
    let callbacks: Record<string, (...args: unknown[]) => void> = {};
    mockInitYandexGames.mockResolvedValue({
      adv: {
        showRewardedVideo: ({ callbacks: next }: { callbacks: typeof callbacks }) => {
          callbacks = next;
        },
      },
    });

    const result = YandexGamesAdsProvider.showRewarded('double');
    await Promise.resolve();
    callbacks.onOpen?.();
    callbacks.onRewarded?.();
    callbacks.onClose?.(true);

    await expect(result).resolves.toBe('rewarded');
    expect(mockPauseYandexGameplay).toHaveBeenCalledWith('ad');
    expect(mockResumeYandexGameplay).toHaveBeenCalledWith('ad');
  });

  it('reports a fullscreen call that was throttled as skipped', async () => {
    let callbacks: Record<string, (...args: unknown[]) => void> = {};
    mockInitYandexGames.mockResolvedValue({
      adv: {
        showFullscreenAdv: ({ callbacks: next }: { callbacks: typeof callbacks }) => {
          callbacks = next;
        },
      },
    });

    const result = YandexGamesAdsProvider.showInterstitial('level_complete');
    await Promise.resolve();
    callbacks.onClose?.(false);

    await expect(result).resolves.toBe('skipped');
    expect(mockResumeYandexGameplay).toHaveBeenCalledWith('ad');
  });

  it('keeps the game playable when the SDK is unavailable', async () => {
    mockInitYandexGames.mockResolvedValue(null);

    await expect(YandexGamesAdsProvider.showRewarded('hint')).resolves.toBe('unavailable');
    await expect(YandexGamesAdsProvider.showInterstitial('level_complete')).resolves.toBe('unavailable');
    expect(mockPauseYandexGameplay).not.toHaveBeenCalled();
  });
});
