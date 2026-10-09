import * as Linking from 'expo-linking';
import { create } from 'zustand';

import { getBackend, safeBillingError } from '@/core/net';
import type { BillingCatalog, SubscriptionCheckout, SubscriptionStatus } from '@/core/net';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { useProfile } from '@/features/profile';
import type { SavedProfile } from '@/features/profile';

import { useEntitlements } from './entitlements';

interface PendingCheckout {
  requestId: string;
  email: string;
  consentVersion: string;
  paymentId: string | null;
  confirmationUrl: string | null;
}

interface SavedSubscription {
  userId: string | null;
  pending: PendingCheckout | null;
  recoveryCode: string | null;
}

interface SubscriptionState {
  catalog: BillingCatalog | null;
  status: SubscriptionStatus | null;
  busy: boolean;
  error: string | null;
  recoveryCode: string | null;
  confirmationUrl: string | null;
  sync: () => Promise<void>;
  checkout: (email: string, consented: boolean) => Promise<boolean>;
  cancel: () => Promise<boolean>;
  restore: (code: string) => Promise<boolean>;
  issueRecovery: () => Promise<boolean>;
  resumeCheckout: () => Promise<boolean>;
}

const CLIENT_ERRORS = new Set([
  'consent_required', 'bad_email', 'profile_unavailable', 'profile_changed',
  'invalid_confirmation_url', 'browser_unavailable', 'recovery_required', 'checkout_unavailable',
]);
const CHECKOUT_VALIDATION_ERRORS = new Set([
  'billing_receipt_email_required', 'billing_consent_required', 'billing_bad_request_id',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validEmail(value: string): boolean {
  return value.length <= 254 && ![...value].some((character) => character.charCodeAt(0) < 32)
    && /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
}

function validRecoveryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}

/** Redirect hosts documented by YooKassa; payment state is never taken from this URL. */
export function isSafeConfirmationUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'yoomoney.ru' || url.hostname === 'yookassa.ru');
  } catch {
    return false;
  }
}

function requestId(): string {
  // This is a deduplication identifier, not an authentication or recovery secret.
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

function nullableTime(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function verifiedStatus(value: SubscriptionStatus): SubscriptionStatus {
  if (!value || typeof value.active !== 'boolean' || typeof value.autoRenew !== 'boolean'
    || !nullableTime(value.activeUntil) || !nullableTime(value.nextPaymentAt)
    || typeof value.serverTime !== 'number' || !Number.isSafeInteger(value.serverTime) || value.serverTime <= 0
    || !(value.pendingPaymentId === null
      || (typeof value.pendingPaymentId === 'string' && value.pendingPaymentId.length > 0 && value.pendingPaymentId.length <= 128))
    || (value.active && (value.activeUntil === null || value.activeUntil <= value.serverTime))) {
    throw new Error('invalid_response');
  }
  return {
    active: value.active,
    activeUntil: value.activeUntil,
    autoRenew: value.autoRenew,
    nextPaymentAt: value.nextPaymentAt,
    pendingPaymentId: value.pendingPaymentId,
    serverTime: value.serverTime,
  };
}

function verifiedCatalog(value: BillingCatalog): BillingCatalog {
  const plan = value?.plan;
  if (!value || typeof value.available !== 'boolean' || !['disabled', 'test', 'live'].includes(value.mode)
    || !plan || typeof plan.id !== 'string' || !plan.id || typeof plan.title !== 'string'
    || typeof plan.amount !== 'string' || !/^\d{1,9}\.\d{2}$/.test(plan.amount) || Number(plan.amount) <= 0
    || plan.currency !== 'RUB' || !Number.isSafeInteger(plan.periodDays) || plan.periodDays <= 0
    || typeof plan.consentVersion !== 'string' || !plan.consentVersion) {
    throw new Error('invalid_response');
  }
  return value;
}

const emptySaved: SavedSubscription = { userId: null, pending: null, recoveryCode: null };
const loaded = getJSON<Partial<SavedSubscription> | null>(KEYS.subscription, null);
const initialOwner = useProfile.getState().profile?.userId ?? null;
const pending = loaded?.pending;
let local: SavedSubscription = loaded?.userId === initialOwner && initialOwner !== null ? {
  userId: initialOwner,
  pending: pending && typeof pending.requestId === 'string' && UUID_PATTERN.test(pending.requestId)
    && typeof pending.email === 'string' && validEmail(pending.email)
    && typeof pending.consentVersion === 'string' && pending.consentVersion.length > 0 ? {
      requestId: pending.requestId,
      email: pending.email,
      consentVersion: pending.consentVersion,
      paymentId: typeof pending.paymentId === 'string' ? pending.paymentId : null,
      confirmationUrl: isSafeConfirmationUrl(pending.confirmationUrl) ? pending.confirmationUrl : null,
    } : null,
  recoveryCode: validRecoveryCode(loaded.recoveryCode) ? loaded.recoveryCode : null,
} : { ...emptySaved };

function persist(next: SavedSubscription): void {
  local = next;
  setJSON(KEYS.subscription, next);
}

export const useSubscription = create<SubscriptionState>((set, get) => {
  function assertOwner(userId: string): void {
    if (useProfile.getState().profile?.userId !== userId) throw new Error('profile_changed');
  }

  async function ensureAccount(): Promise<SavedProfile> {
    if (!await useProfile.getState().ensure()) throw new Error('profile_unavailable');
    const profile = useProfile.getState().profile;
    if (!profile) throw new Error('profile_unavailable');
    if (useEntitlements.getState().subscriptionOwnerId !== null
      && useEntitlements.getState().subscriptionOwnerId !== profile.userId) {
      useEntitlements.getState().clearSubscription();
    }
    if (local.userId !== profile.userId) {
      persist({ ...emptySaved, userId: profile.userId });
      set({ status: null, recoveryCode: null, confirmationUrl: null });
    }
    return profile;
  }

  function applyStatus(userId: string, response: SubscriptionStatus): SubscriptionStatus {
    const status = verifiedStatus(response);
    assertOwner(userId);
    // An unknown payment ID after a network failure is kept until checkout replay resolves it.
    if (local.pending?.paymentId && status.pendingPaymentId !== local.pending.paymentId) {
      persist({ ...local, pending: null });
      set({ confirmationUrl: null });
    }
    set({ status });
    useEntitlements.getState().applySubscription(userId, status);
    return status;
  }

  async function openConfirmation(url: string): Promise<void> {
    if (!isSafeConfirmationUrl(url)) throw new Error('invalid_confirmation_url');
    try {
      await Linking.openURL(url);
    } catch {
      throw new Error('browser_unavailable');
    }
  }

  async function submitCheckout(profile: SavedProfile, draft: PendingCheckout): Promise<void> {
    const backend = getBackend();
    let response: SubscriptionCheckout;
    try {
      response = await backend.subscriptionCheckout(profile.authToken, {
        requestId: draft.requestId, email: draft.email, consentVersion: draft.consentVersion,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (CHECKOUT_VALIDATION_ERRORS.has(code) && local.userId === profile.userId
        && local.pending?.requestId === draft.requestId) {
        persist({ ...local, pending: null });
        set({ confirmationUrl: null });
        if (code === 'billing_consent_required') {
          // Updated terms require the next explicit consent; never retry the charge automatically.
          set({ catalog: null });
          try {
            const catalog = verifiedCatalog(await backend.billingCatalog());
            assertOwner(profile.userId);
            set({ catalog });
          } catch {
            // Leave the catalog unresolved so a subsequent explicit attempt fetches current terms.
          }
        }
      }
      throw error;
    }
    assertOwner(profile.userId);
    verifiedStatus(response);
    if (typeof response.paymentId !== 'string' || !response.paymentId || response.paymentId.length > 128
      || !(response.recoveryCode === null || validRecoveryCode(response.recoveryCode))) {
      throw new Error('invalid_response');
    }
    const confirmationUrl = isSafeConfirmationUrl(response.confirmationUrl) ? response.confirmationUrl : null;
    persist({
      ...local,
      pending: { ...draft, paymentId: response.paymentId, confirmationUrl },
      recoveryCode: response.recoveryCode ?? local.recoveryCode,
    });
    set({ confirmationUrl, recoveryCode: local.recoveryCode });
    if (response.confirmationUrl !== null && !confirmationUrl) throw new Error('invalid_confirmation_url');
    applyStatus(profile.userId, response);
    if (local.pending && !confirmationUrl) throw new Error('billing_payment_pending');
    // Only this explicit purchase/resume action opens the browser. Returning from it grants nothing.
    if (local.pending && confirmationUrl) await openConfirmation(confirmationUrl);
  }

  async function action(task: () => Promise<void>): Promise<boolean> {
    if (get().busy) return false;
    if (isYandexGamesBuild()) {
      useEntitlements.getState().clearSubscription();
      set({ catalog: null, status: null, confirmationUrl: null, recoveryCode: null, error: 'billing_disabled' });
      return false;
    }
    set({ busy: true, error: null });
    useEntitlements.getState().refreshExpiration();
    try {
      await task();
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'billing_checkout_canceled') {
        persist({ ...local, pending: null });
        set({ confirmationUrl: null });
      }
      set({ error: CLIENT_ERRORS.has(code) ? code : safeBillingError(error) });
      return false;
    } finally {
      useEntitlements.getState().refreshExpiration();
      set({ busy: false });
    }
  }

  return {
    catalog: null,
    status: null,
    busy: false,
    error: null,
    recoveryCode: local.recoveryCode,
    confirmationUrl: local.pending?.confirmationUrl ?? null,
    sync: async () => {
      await action(async () => {
        const backend = getBackend();
        const results = await Promise.allSettled([
          backend.billingCatalog(),
          ensureAccount().then(async (profile) => ({
            userId: profile.userId, status: await backend.subscription(profile.authToken),
          })),
        ]);
        const [catalogResult, statusResult] = results;
        let failure: unknown;
        if (catalogResult.status === 'fulfilled') {
          try { set({ catalog: verifiedCatalog(catalogResult.value) }); } catch (error) { failure = error; }
        } else failure = catalogResult.reason;
        if (statusResult.status === 'fulfilled') {
          applyStatus(statusResult.value.userId, statusResult.value.status);
        } else failure = statusResult.reason;
        if (failure) throw failure;
      });
    },
    checkout: (email, consented) => action(async () => {
      if (consented !== true) throw new Error('consent_required');
      const normalizedEmail = email.trim();
      if (!validEmail(normalizedEmail)) throw new Error('bad_email');
      const profile = await ensureAccount();
      if (get().status?.active && !local.pending) {
        const cachedUntil = useEntitlements.getState().subscriptionExpiresAt;
        if (cachedUntil === null || cachedUntil <= Date.now()) {
          applyStatus(profile.userId, await getBackend().subscription(profile.authToken));
        }
        if (get().status?.active) throw new Error('subscription_active');
      }
      const catalog = get().catalog ?? verifiedCatalog(await getBackend().billingCatalog());
      set({ catalog });
      if (!catalog.available) throw new Error('billing_disabled');
      const draft = local.pending ?? {
        requestId: requestId(), email: normalizedEmail, consentVersion: catalog.plan.consentVersion,
        paymentId: null, confirmationUrl: null,
      };
      persist({ ...local, pending: draft });
      await submitCheckout(profile, draft);
    }),
    cancel: () => action(async () => {
      const profile = await ensureAccount();
      applyStatus(profile.userId, await getBackend().cancelSubscription(profile.authToken));
    }),
    restore: (code) => action(async () => {
      const normalized = code.trim();
      if (!validRecoveryCode(normalized)) throw new Error('recovery_required');
      const profile = await ensureAccount();
      applyStatus(profile.userId, await getBackend().restoreSubscription(profile.authToken, normalized));
      persist({ ...local, recoveryCode: normalized });
      set({ recoveryCode: normalized });
    }),
    issueRecovery: () => action(async () => {
      const profile = await ensureAccount();
      // A lost response can still invalidate the old code on the server.
      persist({ ...local, recoveryCode: null });
      set({ recoveryCode: null });
      const result = await getBackend().subscriptionRecovery(profile.authToken);
      assertOwner(profile.userId);
      if (!validRecoveryCode(result?.recoveryCode)) throw new Error('invalid_response');
      persist({ ...local, recoveryCode: result.recoveryCode });
      set({ recoveryCode: result.recoveryCode });
    }),
    resumeCheckout: () => action(async () => {
      const profile = await ensureAccount();
      applyStatus(profile.userId, await getBackend().subscription(profile.authToken));
      const draft = local.pending;
      if (!draft) {
        if (get().status?.active) return;
        throw new Error('checkout_unavailable');
      }
      if (draft.paymentId && draft.confirmationUrl) await openConfirmation(draft.confirmationUrl);
      else await submitCheckout(profile, draft);
    }),
  };
});

// A replaced/deleted profile must never keep another player's cached paid entitlement.
useProfile.subscribe((state, previous) => {
  if (state.profile?.userId === previous.profile?.userId) return;
  useEntitlements.getState().clearSubscription();
  persist({ ...emptySaved, userId: state.profile?.userId ?? null });
  useSubscription.setState({ status: null, recoveryCode: null, confirmationUrl: null });
});
