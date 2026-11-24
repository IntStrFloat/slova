import { create } from 'zustand';

import { getBackend, safeBillingError } from '@/core/net';
import type { BillingCatalog, BillingDraftIdentity, SubscriptionCheckout, SubscriptionStatus } from '@/core/net';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { normalizeSubscriptionInteractionId, normalizeSubscriptionReason, normalizeSubscriptionSource,
  trackSubscription, trackSubscriptionCheckoutAction, type SubscriptionSource } from '@/features/analytics/subscription';
import { useProfile } from '@/features/profile';
import type { SavedProfile } from '@/features/profile';

import { useEntitlements } from './entitlements';
import { syncSubscriptionAnalyticsBinding } from './analyticsBinding';
import { newMonetizationId } from './adTelemetry';
import { openCheckoutConfirmation } from './checkoutFullscreen';
import { subscriptionConsentIdentity, validateCheckoutInput, validEmail, type CheckoutValidationResult } from './checkoutValidation';

interface PendingCheckout extends BillingDraftIdentity {
  source?: SubscriptionSource;
  interactionId?: string;
  analyticsAmount?: number;
  analyticsPeriodDays?: number;
  email: string;
  consentVersion: string;
  recurringConsented: boolean | null;
  personalDataConsented: boolean | null;
  personalDataConsentVersion: string | null;
  confirmationUrl: string | null;
}

interface SavedSubscription {
  userId: string | null;
  pending: PendingCheckout | null;
  recoveryCode: string | null;
}

interface MigrationSupportData {
  userId: string;
  draft: BillingDraftIdentity;
  target: Pick<BillingCatalog, 'provider' | 'protocol' | 'merchantLogin' | 'mode'>;
}

export interface SubscriptionCheckoutObservation {
  interactionId: string;
  consentIdentity: string | null;
}

interface SubscriptionState {
  catalog: BillingCatalog | null;
  status: SubscriptionStatus | null;
  busy: boolean;
  error: string | null;
  recoveryCode: string | null;
  confirmationUrl: string | null;
  hasPendingCheckout: boolean;
  needsMigration: boolean;
  sync: (trigger?: 'manual' | 'poll') => Promise<void>;
  checkout: (email: string, consented: boolean, personalDataConsented: boolean, source?: SubscriptionSource,
    observation?: SubscriptionCheckoutObservation) => Promise<boolean>;
  cancel: () => Promise<boolean>;
  restore: (code: string) => Promise<boolean>;
  issueRecovery: () => Promise<boolean>;
  resumeCheckout: () => Promise<boolean>;
  updateEmail: (email: string) => Promise<boolean>;
  resolveMigration: () => Promise<boolean>;
  migrationSupportData: () => MigrationSupportData | null;
}

const CLIENT_ERRORS = new Set([
  'consent_required', 'empty_email', 'bad_email', 'profile_unavailable', 'profile_changed',
  'invalid_confirmation_url', 'browser_unavailable', 'recovery_required', 'checkout_unavailable',
]);
const CHECKOUT_VALIDATION_ERRORS = new Set([
  'billing_receipt_email_required', 'billing_consent_required', 'billing_bad_request_id',
  'billing_personal_data_consent_required',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validRecoveryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}

/** Only the agreed Robokassa checkout endpoint; payment state never comes from the URL. */
export function isSafeConfirmationUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && url.hostname === 'auth.robokassa.ru' && url.pathname === '/Merchant/Index.aspx';
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
  if (value && (value.provider !== 'robokassa' || value.protocol !== 'robokassa-v3')) {
    throw new Error('billing_provider_migration_required');
  }
  const plan = value?.plan;
  if (!value || typeof value.available !== 'boolean' || !['disabled', 'test', 'live'].includes(value.mode)
    || typeof value.merchantLogin !== 'string' || value.merchantLogin.length > 128
    || /[\s\u0000-\u001f\u007f-\u009f]/.test(value.merchantLogin) || (value.available && !value.merchantLogin)
    || !plan || typeof plan.id !== 'string' || !plan.id || typeof plan.title !== 'string'
    || typeof plan.amount !== 'string' || !/^\d{1,9}\.\d{2}$/.test(plan.amount) || Number(plan.amount) <= 0
    || plan.currency !== 'RUB' || !Number.isSafeInteger(plan.periodDays) || plan.periodDays <= 0
    || typeof plan.consentVersion !== 'string' || !plan.consentVersion
    || typeof plan.termsVersion !== 'string' || !plan.termsVersion
    || typeof plan.privacyVersion !== 'string' || !plan.privacyVersion
    || typeof plan.consentText !== 'string' || !plan.consentText.trim() || plan.consentText.length > 2000
    || typeof plan.userAgreementVersion !== 'string' || !plan.userAgreementVersion
    || typeof plan.personalDataConsentVersion !== 'string' || !plan.personalDataConsentVersion
    || typeof plan.personalDataConsentText !== 'string' || !plan.personalDataConsentText.trim() || plan.personalDataConsentText.length > 2000) {
    throw new Error('invalid_response');
  }
  return value;
}

type BillingBinding = Pick<BillingDraftIdentity, 'provider' | 'protocol' | 'merchantLogin' | 'mode'>;

function sameBinding(left: BillingBinding | null | undefined, right: BillingBinding): boolean {
  return Boolean(left && left.provider === right.provider && left.protocol === right.protocol
    && left.merchantLogin === right.merchantLogin && left.mode === right.mode);
}

function compatibleDraft(draft: PendingCheckout, catalog: BillingCatalog | null): boolean {
  return draft.provider === 'robokassa' && draft.protocol === 'robokassa-v3' && Boolean(draft.merchantLogin)
    && draft.recurringConsented === true && draft.personalDataConsented === true && Boolean(draft.personalDataConsentVersion)
    && (draft.mode === 'test' || draft.mode === 'live') && (!catalog || (sameBinding(draft, catalog)
      && draft.consentVersion === catalog.plan.consentVersion && draft.personalDataConsentVersion === catalog.plan.personalDataConsentVersion));
}

function draftIdentity(draft: PendingCheckout): BillingDraftIdentity {
  const { requestId, paymentId, provider, protocol, merchantLogin, mode } = draft;
  return { requestId, paymentId, provider, protocol, merchantLogin, mode };
}

function sameDraft(left: BillingDraftIdentity | null | undefined, right: BillingDraftIdentity): boolean {
  return Boolean(left && left.requestId === right.requestId && left.paymentId === right.paymentId && sameBinding(left, right));
}

const emptySaved: SavedSubscription = { userId: null, pending: null, recoveryCode: null };
const loaded = getJSON<Partial<SavedSubscription> | null>(KEYS.subscription, null);
const initialOwner = useProfile.getState().profile?.userId ?? null;
const pending = loaded?.pending;
let local: SavedSubscription = loaded?.userId === initialOwner && initialOwner !== null ? {
  userId: initialOwner,
  pending: pending && typeof pending.requestId === 'string' && UUID_PATTERN.test(pending.requestId)
    // Preserve older drafts for idempotent replay even if new email validation is stricter.
    && typeof pending.email === 'string' && pending.email.length <= 254
    && ![...pending.email].some((character) => character.charCodeAt(0) < 32)
    && /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/.test(pending.email)
    && typeof pending.consentVersion === 'string' && pending.consentVersion.length > 0 ? {
      provider: typeof pending.provider === 'string' ? pending.provider : 'yookassa',
      protocol: typeof pending.protocol === 'string' ? pending.protocol : null,
      merchantLogin: typeof pending.merchantLogin === 'string' ? pending.merchantLogin : null,
      mode: pending.mode === 'test' || pending.mode === 'live' || pending.mode === 'disabled' ? pending.mode : null,
      requestId: pending.requestId,
      email: pending.email,
      consentVersion: pending.consentVersion,
      recurringConsented: typeof pending.recurringConsented === 'boolean' ? pending.recurringConsented : null,
      personalDataConsented: typeof pending.personalDataConsented === 'boolean' ? pending.personalDataConsented : null,
      personalDataConsentVersion: typeof pending.personalDataConsentVersion === 'string' && pending.personalDataConsentVersion ? pending.personalDataConsentVersion : null,
      paymentId: typeof pending.paymentId === 'string' ? pending.paymentId : null,
      confirmationUrl: isSafeConfirmationUrl(pending.confirmationUrl) ? pending.confirmationUrl : null,
      ...(pending.source !== undefined ? { source: normalizeSubscriptionSource(pending.source) } : {}),
      ...(normalizeSubscriptionInteractionId(pending.interactionId) ? { interactionId: pending.interactionId } : {}),
      ...(typeof pending.analyticsAmount === 'number' && Number.isFinite(pending.analyticsAmount)
        && pending.analyticsAmount > 0 && pending.analyticsAmount <= 1_000_000_000 ? { analyticsAmount: pending.analyticsAmount } : {}),
      ...(typeof pending.analyticsPeriodDays === 'number' && Number.isSafeInteger(pending.analyticsPeriodDays)
        && pending.analyticsPeriodDays > 0 && pending.analyticsPeriodDays <= 36_600 ? { analyticsPeriodDays: pending.analyticsPeriodDays } : {}),
    } : null,
  recoveryCode: validRecoveryCode(loaded.recoveryCode) ? loaded.recoveryCode : null,
} : { ...emptySaved };

function persist(next: SavedSubscription): void {
  local = next;
  setJSON(KEYS.subscription, next);
}

export const useSubscription = create<SubscriptionState>((set, get) => {
  type ActionObservation = { stage: string; source?: SubscriptionSource; ownerId?: string;
    mode?: BillingCatalog['mode']; draft?: PendingCheckout | null; trigger?: 'manual' | 'poll'; manageAction?: string;
    interactionId?: string; inputRejected?: boolean };
  let lastObservedError: string | null = null;

  function draftProperties(draft: PendingCheckout, stage: string) {
    return { source: normalizeSubscriptionSource(draft.source), mode: draft.mode, stage,
      amount: draft.analyticsAmount, periodDays: draft.analyticsPeriodDays, checkout_id: draft.requestId,
      product_id: get().catalog?.plan.id ?? 'unknown', interaction_id: draft.interactionId };
  }

  function observeInvoice(draft: PendingCheckout, paymentId: string): void {
    trackSubscription('subscription_invoice_created', { ...draftProperties(draft, 'checkout'), result: 'created' }, `invoice:${paymentId}`);
  }

  function observePayment(draft: PendingCheckout, paymentId: string, state: 'pending' | 'succeeded' | 'canceled' | 'failed'): void {
    const properties = draftProperties(draft, 'status');
    if (state === 'pending') trackSubscription('subscription_payment_pending', { ...properties, result: 'pending' }, `invoice:${paymentId}`);
    if (state === 'succeeded') trackSubscription('subscription_payment_confirmed', { ...properties, result: 'confirmed' }, `invoice:${paymentId}`);
    if (state === 'canceled') trackSubscription('subscription_payment_canceled', { ...properties, result: 'canceled' }, `invoice:${paymentId}`);
    if (state === 'failed') trackSubscription('subscription_payment_failed', { ...properties, result: 'failed' }, `invoice:${paymentId}`);
  }

  function assertPendingBinding(catalog: BillingCatalog | null = get().catalog): void {
    const draft = local.pending;
    if (draft && !compatibleDraft(draft, catalog)) {
      throw new Error('billing_provider_migration_required');
    }
  }

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
      set({ status: null, recoveryCode: null, confirmationUrl: null, hasPendingCheckout: false });
    }
    if (getBackend().bindSubscriptionAnalytics) void syncSubscriptionAnalyticsBinding();
    assertOwner(profile.userId);
    return profile;
  }

  function applyStatus(userId: string, response: SubscriptionStatus, requestedDraft?: PendingCheckout | null): SubscriptionStatus {
    const status = verifiedStatus(response);
    assertOwner(userId);
    const catalog = get().catalog;
    const draft = local.pending;
    const quarantined = Boolean(draft && !compatibleDraft(draft, catalog));
    // A new consent protocol does not revoke an existing payment or prevent its
    // cancellation. Only the same provider/merchant/mode may update that status.
    if (quarantined && !(catalog && draft?.provider === catalog.provider
      && draft.merchantLogin === catalog.merchantLogin && draft.mode === catalog.mode)) {
      throw new Error('billing_provider_migration_required');
    }
    const resolution = response.checkoutResolution;
    if (resolution != null && requestedDraft) {
      if (!draft || !catalog || !compatibleDraft(draft, catalog) || !sameDraft(draft, requestedDraft)
        || resolution.requestId !== requestedDraft.requestId || !UUID_PATTERN.test(resolution.requestId)
        || typeof resolution.paymentId !== 'string' || !/^[1-9]\d{0,15}$/.test(resolution.paymentId)
        || !Number.isSafeInteger(Number(resolution.paymentId))
        || (draft.paymentId !== null && draft.paymentId !== resolution.paymentId)
        || !['pending', 'succeeded', 'canceled', 'failed'].includes(resolution.state)
        || (resolution.state === 'pending' && status.pendingPaymentId !== resolution.paymentId)) {
        throw new Error('invalid_response');
      }
      // Correlation is read-only and scoped to this authenticated request. A
      // paid older subscription alone never proves an unknown draft completed.
      observeInvoice(draft, resolution.paymentId);
      observePayment(draft, resolution.paymentId, resolution.state);
      if (resolution.state === 'pending') {
        persist({ ...local, pending: { ...draft, paymentId: resolution.paymentId } });
      } else {
        persist({ ...local, pending: null });
        set({ confirmationUrl: null, hasPendingCheckout: false });
      }
    }
    // An unknown payment ID after a network failure is kept until checkout replay resolves it.
    if (!quarantined && catalog && local.pending?.paymentId && status.pendingPaymentId !== local.pending.paymentId) {
      persist({ ...local, pending: null });
      set({ confirmationUrl: null, hasPendingCheckout: false });
    }
    set({ status });
    useEntitlements.getState().applySubscription(userId, status, catalog?.mode ?? 'unknown');
    return status;
  }

  async function openConfirmation(url: string): Promise<void> {
    if (!isSafeConfirmationUrl(url)) throw new Error('invalid_confirmation_url');
    await openCheckoutConfirmation(url);
  }

  async function submitCheckout(profile: SavedProfile, draft: PendingCheckout, trigger: 'checkout' | 'resume'): Promise<void> {
    assertOwner(profile.userId);
    const catalog = get().catalog;
    if (!catalog) throw new Error('checkout_unavailable');
    assertPendingBinding(catalog);
    if (draft.recurringConsented !== true || draft.personalDataConsented !== true || !draft.personalDataConsentVersion) {
      throw new Error('billing_provider_migration_required');
    }
    const backend = getBackend();
    let response: SubscriptionCheckout;
    try {
      response = await backend.subscriptionCheckout(profile.authToken, {
        provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin, mode: catalog.mode,
        requestId: draft.requestId, email: draft.email, consentVersion: draft.consentVersion,
        recurringConsented: draft.recurringConsented, personalDataConsented: draft.personalDataConsented,
        personalDataConsentVersion: draft.personalDataConsentVersion,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (CHECKOUT_VALIDATION_ERRORS.has(code) && local.userId === profile.userId
        && local.pending?.requestId === draft.requestId) {
        persist({ ...local, pending: null });
        set({ confirmationUrl: null, hasPendingCheckout: false });
        if (code === 'billing_consent_required' || code === 'billing_personal_data_consent_required') {
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
    observeInvoice(draft, response.paymentId);
    const confirmationUrl = isSafeConfirmationUrl(response.confirmationUrl) ? response.confirmationUrl : null;
    persist({
      ...local,
      pending: { ...draft, paymentId: response.paymentId, confirmationUrl },
      recoveryCode: response.recoveryCode ?? local.recoveryCode,
    });
    set({ confirmationUrl, recoveryCode: local.recoveryCode, hasPendingCheckout: true });
    if (response.confirmationUrl !== null && !confirmationUrl) throw new Error('invalid_confirmation_url');
    if (response.pendingPaymentId === response.paymentId) observePayment(draft, response.paymentId, 'pending');
    // Only a response to this authenticated checkout, bound to its invoice, may
    // prove a replayed checkout already paid. A generic active status cannot.
    if (response.active && response.pendingPaymentId === null) observePayment(draft, response.paymentId, 'succeeded');
    applyStatus(profile.userId, response);
    if (local.pending && !confirmationUrl) throw new Error('billing_payment_pending');
    // Only this explicit purchase/resume action opens the browser. Returning from it grants nothing.
    if (local.pending && confirmationUrl) {
      await openConfirmation(confirmationUrl);
      assertOwner(profile.userId);
      trackSubscription('subscription_browser_opened', { ...draftProperties(draft, 'browser'), trigger,
        result: trigger === 'resume' ? 'resumed' : 'opened' }, `${draft.requestId}:${trigger}`);
    }
  }

  async function action(task: () => Promise<void>, observation: ActionObservation = { stage: 'sync' }): Promise<boolean> {
    if (get().busy) return false;
    if (isYandexGamesBuild()) {
      useEntitlements.getState().clearSubscription();
      set({ catalog: null, status: null, confirmationUrl: null, recoveryCode: null, hasPendingCheckout: false, needsMigration: false, error: 'billing_disabled' });
      return false;
    }
    set({ busy: true, error: null });
    const manageActions: Record<string, string> = { sync: 'check_status', cancel: 'cancel_auto_renew',
      restore: 'restore', recovery: 'issue_recovery', email: 'change_receipt_email', migration: 'migration_help' };
    const manageAction = observation.manageAction ?? manageActions[observation.stage];
    const operationId = newMonetizationId('sm');
    const observeManagement = (result: 'started' | 'succeeded' | 'failed', reason?: string) => {
      if (!manageAction || observation.stage === 'sync' && observation.trigger !== 'manual') return;
      trackSubscription('subscription_manage_action', {
        operation_id: operationId, action: manageAction, stage: observation.stage,
        result, normalized_reason: reason, trigger: observation.trigger ?? 'manual',
        source: normalizeSubscriptionSource(observation.source), mode: observation.mode ?? get().catalog?.mode,
      }, `${operationId}:${result}`);
    };
    observeManagement('started');
    const startingOwner = useProfile.getState().profile?.userId;
    const startingDraft = local.pending;
    useEntitlements.getState().refreshExpiration();
    try {
      await task();
      observeManagement('succeeded');
      lastObservedError = null;
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      observeManagement('failed', normalizeSubscriptionReason(CLIENT_ERRORS.has(code) ? code : safeBillingError(error)));
      const ownerId = observation.ownerId ?? startingOwner;
      if (!observation.inputRejected && (ownerId === undefined || ownerId === useProfile.getState().profile?.userId)) {
        const draft = observation.draft ?? startingDraft;
        const stage = code === 'browser_unavailable' || code === 'invalid_confirmation_url' ? 'browser' : observation.stage;
        const reason = normalizeSubscriptionReason(CLIENT_ERRORS.has(code) ? code : safeBillingError(error));
        const errorIdentity = JSON.stringify([ownerId, draft?.requestId, stage, reason, observation.interactionId]);
        if (lastObservedError !== errorIdentity) {
          trackSubscription('subscription_error', { source: normalizeSubscriptionSource(draft?.source ?? observation.source),
            mode: draft?.mode ?? observation.mode ?? get().catalog?.mode, stage, reason,
            interaction_id: observation.interactionId });
          lastObservedError = errorIdentity;
        }
        if (code === 'billing_checkout_canceled' && draft && compatibleDraft(draft, get().catalog)) {
          trackSubscription('subscription_payment_canceled', { ...draftProperties(draft, 'checkout'), result: 'canceled' },
            draft.paymentId ? `invoice:${draft.paymentId}` : `request:${draft.requestId}`);
        }
      }
      if (code === 'billing_checkout_canceled') {
        persist({ ...local, pending: null });
        set({ confirmationUrl: null, hasPendingCheckout: false });
      }
      set({ error: CLIENT_ERRORS.has(code) ? code : safeBillingError(error) });
      return false;
    } finally {
      useEntitlements.getState().refreshExpiration();
      set({ busy: false, needsMigration: Boolean(local.pending && !compatibleDraft(local.pending, get().catalog)) });
    }
  }

  return {
    catalog: null,
    status: null,
    busy: false,
    error: null,
    recoveryCode: local.recoveryCode,
    confirmationUrl: local.pending?.confirmationUrl ?? null,
    hasPendingCheckout: local.pending !== null,
    needsMigration: Boolean(local.pending && !compatibleDraft(local.pending, null)),
    migrationSupportData: () => {
      const userId = useProfile.getState().profile?.userId;
      const draft = local.pending;
      const catalog = get().catalog;
      if (isYandexGamesBuild() || !userId || local.userId !== userId || !draft || !catalog
        || compatibleDraft(draft, catalog)) return null;
      const { provider, protocol, merchantLogin, mode } = catalog;
      // Explicit allowlist: account/draft identifiers only, never auth, recovery,
      // contact details or the signed payment URL.
      return { userId, draft: draftIdentity(draft), target: { provider, protocol, merchantLogin, mode } };
    },
    sync: async (trigger = 'poll') => {
      await action(async () => {
        const backend = getBackend();
        const results = await Promise.allSettled([
          backend.billingCatalog(),
          ensureAccount().then(async (profile) => {
            const draft = local.pending && compatibleDraft(local.pending, get().catalog) ? local.pending : null;
            return { userId: profile.userId, draft,
              status: await backend.subscription(profile.authToken, draft?.requestId) };
          }),
        ]);
        const [catalogResult, statusResult] = results;
        let failure: unknown;
        if (catalogResult.status === 'fulfilled') {
          try { set({ catalog: verifiedCatalog(catalogResult.value) }); } catch (error) { failure = error; }
        } else failure = catalogResult.reason;
        if (statusResult.status === 'fulfilled') {
          applyStatus(statusResult.value.userId, statusResult.value.status, statusResult.value.draft);
        } else failure = statusResult.reason;
        if (failure) throw failure;
      }, { stage: 'sync', trigger });
    },
    checkout: (email, consented, personalDataConsented, source, checkoutObservation) => {
      const interactionId = normalizeSubscriptionInteractionId(checkoutObservation?.interactionId);
      const consentIdentity = checkoutObservation?.consentIdentity;
      const observation: ActionObservation = { stage: 'checkout', source: normalizeSubscriptionSource(source),
        mode: get().catalog?.mode, interactionId };
      let validationReported = false;
      const observeValidation = (validation: CheckoutValidationResult) => {
        if (validationReported) return;
        validationReported = true;
        if (interactionId) trackSubscriptionCheckoutAction({ interactionId, source: observation.source,
          mode: observation.mode }, validation);
      };
      return action(async () => {
        const validation = validateCheckoutInput(email, consented, personalDataConsented);
        if (validation !== 'accepted') {
          observation.inputRejected = true;
          observeValidation(validation);
          throw new Error(validation === 'personal_data_consent_required' ? 'billing_personal_data_consent_required' : validation);
        }
        const normalizedEmail = email.trim();
        let profile: SavedProfile;
        try {
          profile = await ensureAccount();
        } catch (error) {
          if (!(error instanceof Error && error.message === 'profile_changed')) observeValidation('profile_unavailable');
          throw error;
        }
        observation.ownerId = profile.userId;
        if (get().status?.active && !local.pending) {
          const cachedUntil = useEntitlements.getState().subscriptionExpiresAt;
          if (cachedUntil === null || cachedUntil <= Date.now()) {
            applyStatus(profile.userId, await getBackend().subscription(profile.authToken));
          }
          if (get().status?.active) throw new Error('subscription_active');
        }
        let catalog: BillingCatalog;
        try {
          catalog = get().catalog ?? verifiedCatalog(await getBackend().billingCatalog());
        } catch (error) {
          observeValidation('catalog_unavailable');
          throw error;
        }
        observation.mode = catalog.mode;
        assertOwner(profile.userId);
        set({ catalog });
        assertPendingBinding(catalog);
        if (!catalog.available) {
          observeValidation('catalog_unavailable');
          throw new Error('billing_disabled');
        }
        if (consentIdentity !== undefined && consentIdentity !== subscriptionConsentIdentity(catalog)) {
          observation.inputRejected = true;
          observeValidation('consent_required');
          throw new Error('billing_consent_required');
        }
        observeValidation('accepted');
        const draft = local.pending ?? {
          provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin, mode: catalog.mode,
          requestId: requestId(), email: normalizedEmail, consentVersion: catalog.plan.consentVersion,
          recurringConsented: true, personalDataConsented: true, personalDataConsentVersion: catalog.plan.personalDataConsentVersion,
          paymentId: null, confirmationUrl: null,
          source: normalizeSubscriptionSource(source),
          ...(interactionId ? { interactionId } : {}),
          analyticsAmount: Number(catalog.plan.amount), analyticsPeriodDays: catalog.plan.periodDays,
        };
        observation.draft = draft;
        persist({ ...local, pending: draft });
        set({ hasPendingCheckout: true });
        trackSubscription('subscription_checkout_started', { ...draftProperties(draft, 'checkout'), trigger: 'checkout', result: 'started' }, draft.requestId);
        await submitCheckout(profile, draft, 'checkout');
      }, observation);
    },
    cancel: () => action(async () => {
      const profile = await ensureAccount();
      applyStatus(profile.userId, await getBackend().cancelSubscription(profile.authToken));
    }, { stage: 'cancel' }),
    updateEmail: (email) => action(async () => {
      const normalizedEmail = email.trim();
      if (!validEmail(normalizedEmail)) throw new Error('bad_email');
      const profile = await ensureAccount();
      applyStatus(profile.userId, await getBackend().updateSubscriptionEmail(profile.authToken, normalizedEmail));
    }, { stage: 'email' }),
    restore: (code) => action(async () => {
      const normalized = code.trim();
      if (!validRecoveryCode(normalized)) throw new Error('recovery_required');
      const profile = await ensureAccount();
      applyStatus(profile.userId, await getBackend().restoreSubscription(profile.authToken, normalized));
      persist({ ...local, recoveryCode: normalized });
      set({ recoveryCode: normalized });
    }, { stage: 'restore' }),
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
    }, { stage: 'recovery' }),
    resumeCheckout: () => {
      const observation: ActionObservation = { stage: 'checkout', draft: local.pending, manageAction: 'resume_checkout' };
      return action(async () => {
        const profile = await ensureAccount();
        observation.ownerId = profile.userId;
        const catalog = verifiedCatalog(await getBackend().billingCatalog());
        observation.mode = catalog.mode;
        assertOwner(profile.userId);
        set({ catalog });
        assertPendingBinding(catalog);
        const requestedDraft = local.pending;
        applyStatus(profile.userId, await getBackend().subscription(profile.authToken, requestedDraft?.requestId), requestedDraft);
        const draft = local.pending;
        if (!draft) {
          if (get().status?.active) return;
          throw new Error('checkout_unavailable');
        }
        // Refresh the signed URL (including receipt data) from the same durable attempt.
        await submitCheckout(profile, draft, 'resume');
      }, observation);
    },
    resolveMigration: () => action(async () => {
      const profile = await ensureAccount();
      const backend = getBackend();
      const catalog = verifiedCatalog(await backend.billingCatalog());
      assertOwner(profile.userId);
      set({ catalog });
      const draft = local.pending;
      if (!draft || compatibleDraft(draft, catalog)) throw new Error('checkout_unavailable');
      const identity = draftIdentity(draft);
      const response = await backend.resolveSubscriptionMigration(profile.authToken, identity);
      assertOwner(profile.userId);
      if (response?.resolution !== 'safe_to_discard'
        || !['retired_test_payment', 'operator_reviewed'].includes(response.reason)
        || !sameDraft(response.draft, identity) || !sameDraft(local.pending, identity)
        || !sameBinding(response.target, catalog) || !sameBinding(get().catalog, catalog)) {
        throw new Error('invalid_response');
      }
      // Only server-proven retired/reviewed attempts can be removed. Paid access,
      // profile and recovery code remain intact; this action never creates a payment.
      persist({ ...local, pending: null });
      set({ confirmationUrl: null, hasPendingCheckout: false, needsMigration: false });
      try {
        applyStatus(profile.userId, await backend.subscription(profile.authToken));
      } catch (error) {
        assertOwner(profile.userId);
        // Safe discard remains complete even if refreshing the current status is offline.
        set({ error: safeBillingError(error) });
      }
    }, { stage: 'migration' }),
  };
});

// A replaced/deleted profile must never keep another player's cached paid entitlement.
useProfile.subscribe((state, previous) => {
  if (state.profile?.userId === previous.profile?.userId) return;
  useEntitlements.getState().clearSubscription();
  persist({ ...emptySaved, userId: state.profile?.userId ?? null });
  useSubscription.setState({ status: null, recoveryCode: null, confirmationUrl: null, hasPendingCheckout: false, needsMigration: false });
});
