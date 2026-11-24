export interface Product {
  id: string;
  title: string;
  price: string;
}

export type InterstitialPlacement = 'level_complete';
export type RewardedPlacement = 'wheel' | 'double' | 'hint' | 'continue';

export type InterstitialResult = 'shown' | 'skipped' | 'unavailable';
export type RewardedResult = 'rewarded' | 'dismissed' | 'unavailable';
export type RewardedState = 'ready' | 'loading' | 'not_ready' | 'no_fill' | 'fullscreen_busy'
  | 'background' | 'network_error' | 'load_error' | 'show_error' | 'save_failed' | 'offer_save_failed' | 'reward_check_failed';
export type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

export interface RewardConfirmation {
  /** Stable ID generated before showing this ad; reuse it for retries and duplicate callbacks. */
  rewardId: string;
  /** Return true only when the durable ledger contains rewardId (new or already present). */
  persistGrant: (rewardId: string) => boolean;
  /** Frozen local offer, recorded natively before show and earned before the JS callback. */
  receipt?: import('./nativeRewardJournal').NativeRewardReceipt;
  /** Saving a wheel outcome is earned-pending; it is not yet a wallet grant. */
  persistenceStage?: 'earned_pending' | 'grant_persisted';
}

export interface RewardedObservation { opportunityId: string; requestId: string }

/** Реализации: NoopAdsProvider (web/test), YandexAdsProvider (native, флаг) — спека 05. */
export interface AdsProvider {
  init(): Promise<void>;
  /** One upcoming eligible gameplay pause; initialization alone does not imply demand. */
  setInterstitialPreloadAllowed?(allowed: boolean): void;
  showInterstitial(placement: InterstitialPlacement): Promise<InterstitialResult>;
  showRewarded(placement: RewardedPlacement, confirmation?: RewardConfirmation,
    onOpportunity?: (observation: RewardedObservation) => void): Promise<RewardedResult>;
  isInterstitialReady(): boolean;
  isRewardedReady(): boolean;
  getRewardedState?(): RewardedState;
  getRewardedFailure?(): RewardedState | null;
  /** Notify when the readiness snapshot changes; callers read it with isRewardedReady(). */
  subscribeRewardedReady?(listener: () => void): () => void;
  /** Rich availability reasons can change while boolean readiness remains false. */
  subscribeRewardedState?(listener: () => void): () => void;
}

/** Реализации: NoopIapProvider (v1), RuStoreIapProvider (native, после RuStore Console). */
export interface IapProvider {
  init(): Promise<void>;
  getProducts(ids: string[]): Promise<Product[]>;
  purchase(id: string): Promise<PurchaseResult>;
  restore(): Promise<string[]>;
}
