export interface Product {
  id: string;
  title: string;
  price: string;
}

export type InterstitialPlacement = 'level_complete';
export type RewardedPlacement = 'wheel' | 'double' | 'hint' | 'continue';

export type InterstitialResult = 'shown' | 'skipped' | 'unavailable';
export type RewardedResult = 'rewarded' | 'dismissed' | 'unavailable';
export type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

/** Реализации: NoopAdsProvider (web/test), YandexAdsProvider (native, флаг) — спека 05. */
export interface AdsProvider {
  init(): Promise<void>;
  showInterstitial(placement: InterstitialPlacement): Promise<InterstitialResult>;
  showRewarded(placement: RewardedPlacement): Promise<RewardedResult>;
  isRewardedReady(): boolean;
}

/** Реализации: NoopIapProvider (v1), RuStoreIapProvider (native, после RuStore Console). */
export interface IapProvider {
  init(): Promise<void>;
  getProducts(ids: string[]): Promise<Product[]>;
  purchase(id: string): Promise<PurchaseResult>;
  restore(): Promise<string[]>;
}
