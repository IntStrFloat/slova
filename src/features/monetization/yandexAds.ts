import { NoopAdsProvider } from './noop';

/** Web/test fallback. Metro резолвит yandexAds.native.ts на нативной сборке. */
export const YandexAdsProvider = NoopAdsProvider;
