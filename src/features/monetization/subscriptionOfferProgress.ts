import { MONETIZATION } from '@/core/config/monetization';
import { getJSON, getString, KEYS, setJSON } from '@/core/storage';

interface OfferProgress {
  version: 1;
  shownInterstitialsSinceOffer: number;
  lastPresentedAt: number | null;
}

export function subscriptionOfferProgress(): OfferProgress {
  const saved = getJSON<Partial<OfferProgress> | null>(KEYS.subscriptionOfferProgress, null);
  return {
    version: 1,
    shownInterstitialsSinceOffer: saved?.version === 1 && Number.isSafeInteger(saved.shownInterstitialsSinceOffer)
      && saved.shownInterstitialsSinceOffer! >= 0
      ? Math.min(saved.shownInterstitialsSinceOffer!, MONETIZATION.subscriptionOffer.minShownInterstitials) : 0,
    lastPresentedAt: saved?.version === 1 && typeof saved.lastPresentedAt === 'number'
      && Number.isSafeInteger(saved.lastPresentedAt) && saved.lastPresentedAt >= 0 ? saved.lastPresentedAt : null,
  };
}

/** Called only after the ad provider resolves a successfully shown and closed interstitial. */
export function recordSubscriptionOfferInterstitial(): void {
  const progress = subscriptionOfferProgress();
  setJSON(KEYS.subscriptionOfferProgress, {
    ...progress,
    shownInterstitialsSinceOffer: Math.min(progress.shownInterstitialsSinceOffer + 1,
      MONETIZATION.subscriptionOffer.minShownInterstitials),
  });
}

/** Reserve the cooldown before presenting; a failed save must never cause repeated popups. */
export function reserveSubscriptionOffer(now: number): boolean {
  const progress = subscriptionOfferProgress();
  const dismissedUntil = Number(getString(KEYS.subscriptionOfferDismissedUntil));
  if (!Number.isSafeInteger(now) || now < 0
    || progress.shownInterstitialsSinceOffer < MONETIZATION.subscriptionOffer.minShownInterstitials
    || (Number.isFinite(dismissedUntil) && now < dismissedUntil)
    || (progress.lastPresentedAt !== null
      && now < progress.lastPresentedAt + MONETIZATION.subscriptionOffer.dismissForMs)) return false;

  setJSON(KEYS.subscriptionOfferProgress, { ...progress, shownInterstitialsSinceOffer: 0, lastPresentedAt: now });
  const saved = subscriptionOfferProgress();
  return saved.lastPresentedAt === now && saved.shownInterstitialsSinceOffer === 0;
}
