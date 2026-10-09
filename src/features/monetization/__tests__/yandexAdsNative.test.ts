jest.mock('yandex-mobile-ads', () => ({
  MobileAds: { initialize: jest.fn(async () => {}) },
  InterstitialAdLoader: { create: jest.fn() },
  RewardedAdLoader: { create: jest.fn() },
}));

type MockRewardedAd = {
  show: jest.Mock<Promise<void>, []>;
  onRewarded?: () => void;
  onAdDismissed?: () => void;
  onAdFailedToShow?: (error: Error) => void;
};

async function loadedProvider() {
  jest.resetModules();
  const sdk = jest.requireMock('yandex-mobile-ads') as {
    InterstitialAdLoader: { create: jest.Mock };
    RewardedAdLoader: { create: jest.Mock };
  };
  const ad: MockRewardedAd = { show: jest.fn(async () => {}) };
  sdk.InterstitialAdLoader.create.mockResolvedValue({ loadAd: jest.fn(async () => ({})) });
  sdk.RewardedAdLoader.create.mockResolvedValue({ loadAd: jest.fn(async () => ad) });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { YandexAdsProvider } = require('../yandexAds.native') as typeof import('../yandexAds.native');
  await YandexAdsProvider.init();
  return { provider: YandexAdsProvider, ad };
}

describe('Yandex Android rewarded confirmation', () => {
  test('persists the reward at onRewarded before dismissal and only once per ad', async () => {
    const { provider, ad } = await loadedProvider();
    const persistGrant = jest.fn(() => true);
    const pending = provider.showRewarded('hint', {
      rewardId: 'rewarded-hint:2026-09-26:ad-1', persistGrant,
    });
    expect(persistGrant).not.toHaveBeenCalled();
    ad.onRewarded?.();
    expect(persistGrant).toHaveBeenCalledTimes(1);
    expect(persistGrant).toHaveBeenCalledWith('rewarded-hint:2026-09-26:ad-1');
    // A process killed here already has the ticket in the caller's durable ledger.
    ad.onRewarded?.();
    expect(persistGrant).toHaveBeenCalledTimes(1);
    ad.onAdDismissed?.();
    await expect(pending).resolves.toBe('rewarded');
  });

  test('an already durable ledger grant needs no second callback invocation', async () => {
    const { provider, ad } = await loadedProvider();
    const persistGrant = jest.fn(() => true);
    const pending = provider.showRewarded('hint', { rewardId: 'already-granted', persistGrant });
    ad.onRewarded?.();
    ad.onRewarded?.();
    ad.onAdDismissed?.();
    await expect(pending).resolves.toBe('rewarded');
    expect(persistGrant).toHaveBeenCalledTimes(1);
  });

  test('an unverified write can retry on duplicate SDK confirmation', async () => {
    const { provider, ad } = await loadedProvider();
    const persistGrant = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const pending = provider.showRewarded('hint', { rewardId: 'retryable-write', persistGrant });
    ad.onRewarded?.();
    ad.onRewarded?.();
    ad.onAdDismissed?.();
    await expect(pending).resolves.toBe('rewarded');
    expect(persistGrant).toHaveBeenCalledTimes(2);
  });

  test('dismissal alone never grants a ticket', async () => {
    const { provider, ad } = await loadedProvider();
    const persistGrant = jest.fn(() => true);
    const pending = provider.showRewarded('hint', { rewardId: 'no-confirmation', persistGrant });
    ad.onAdDismissed?.();
    await expect(pending).resolves.toBe('dismissed');
    expect(persistGrant).not.toHaveBeenCalled();
  });

  test('failed persistence can retry on a duplicate confirmation', async () => {
    const { provider, ad } = await loadedProvider();
    const persistGrant = jest.fn()
      .mockImplementationOnce(() => { throw new Error('temporary write failure'); })
      .mockReturnValueOnce(true);
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const pending = provider.showRewarded('hint', { rewardId: 'retryable', persistGrant });
    ad.onRewarded?.();
    ad.onRewarded?.();
    ad.onAdDismissed?.();
    await expect(pending).resolves.toBe('rewarded');
    expect(persistGrant).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  test('an invalid durable reward ID never starts the ad', async () => {
    const { provider, ad } = await loadedProvider();
    await expect(provider.showRewarded('hint', {
      rewardId: ' ', persistGrant: jest.fn(() => true),
    })).resolves.toBe('unavailable');
    expect(ad.show).not.toHaveBeenCalled();
  });
});
