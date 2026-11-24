import { isAppMetricaTestDevice } from '@/core/native/appmetrica';
import { getString, setString } from '@/core/storage';
import type { CheckoutValidationResult } from '@/features/monetization/checkoutValidation';

import { track, trackOnce, useAnalyticsPrefs } from './index';

export type SubscriptionSource = 'home_card' | 'settings' | 'post_ad' | 'direct';
export type SubscriptionEvent =
  | 'subscription_offer_shown' | 'subscription_offer_clicked' | 'subscription_offer_dismissed'
  | 'subscription_shop_viewed' | 'subscription_form_opened' | 'subscription_checkout_started'
  | 'subscription_invoice_created' | 'subscription_browser_opened' | 'subscription_payment_pending'
  | 'subscription_payment_confirmed' | 'subscription_payment_failed' | 'subscription_payment_canceled'
  | 'subscription_error' | 'subscription_manage_action' | 'subscription_entitlement_changed';

const QA_DEVICE_KEY = 'analytics.subscription-test-device.v1';
const events = new Set<string>([
  'subscription_offer_shown', 'subscription_offer_clicked', 'subscription_offer_dismissed',
  'subscription_shop_viewed', 'subscription_form_opened', 'subscription_checkout_started',
  'subscription_invoice_created', 'subscription_browser_opened', 'subscription_payment_pending',
  'subscription_payment_confirmed', 'subscription_payment_failed', 'subscription_payment_canceled',
  'subscription_error',
  'subscription_manage_action', 'subscription_entitlement_changed',
]);
const sources = new Set<SubscriptionSource>(['home_card', 'settings', 'post_ad', 'direct']);
const stages = new Set(['offer', 'shop', 'form', 'legal', 'checkout', 'browser', 'sync',
  'catalog', 'status', 'cancel', 'restore', 'recovery', 'email', 'migration', 'unknown']);
const triggers = new Set(['checkout', 'resume', 'poll', 'startup', 'foreground', 'deep_link',
  'manual', 'navigation', 'post_ad', 'eligible', 'interstitials', 'unknown']);
const results = new Set(['shown', 'clicked', 'dismissed', 'started', 'created', 'opened', 'resumed',
  'pending', 'confirmed', 'succeeded', 'canceled', 'failed', 'unavailable', 'active', 'inactive', 'unknown']);
const reasons = new Set([
  'unknown', 'later', 'background', 'screen_blur', 'unavailable', 'catalog_unavailable',
  'consent_required', 'empty_email', 'bad_email', 'profile_unavailable', 'profile_changed',
  'invalid_confirmation_url', 'browser_unavailable', 'recovery_required', 'checkout_unavailable',
  'offline', 'network', 'timeout', 'invalid_response', 'unauthorized', 'rate_limited',
  'billing_disabled', 'billing_unavailable', 'bad_request', 'bad_consent', 'bad_request_id',
  'subscription_active', 'checkout_pending', 'payment_pending', 'payment_canceled',
  'provider_unavailable', 'provider_error', 'payment_create_failed', 'not_found',
  'billing_bad_user', 'billing_bad_configuration', 'billing_ownership_changed',
  'billing_bad_recovery_code', 'billing_recovery_not_found', 'billing_payment_mismatch',
  'billing_payment_unverified', 'billing_payment_conflict', 'billing_gateway_unavailable',
  'billing_gateway_rejected', 'billing_gateway_invalid_response', 'billing_bad_request_id',
  'billing_consent_required', 'billing_receipt_email_required', 'billing_already_subscribed',
  'billing_checkout_canceled', 'billing_payment_pending', 'billing_manual_reconciliation_required',
  'billing_subscription_not_found', 'billing_restore_conflict', 'billing_mode_conflict',
  'billing_notification_rate_limited', 'billing_email_change_pending',
  'billing_provider_migration_required', 'billing_client_update_required', 'billing_migration_unresolved',
  'billing_personal_data_consent_required',
]);
const checkoutValidationResults = new Set<CheckoutValidationResult>([
  'empty_email', 'bad_email', 'consent_required', 'personal_data_consent_required',
  'profile_unavailable', 'catalog_unavailable', 'accepted',
]);
export type CheckoutTechnicalFailure = { reason: 'invalid_confirmation_url' | 'browser_unavailable' | 'payment_create_failed'
  | 'billing_gateway_invalid_response' | 'billing_bad_configuration'; stage: 'checkout'; mode: 'live' };
const checkoutFailureListeners = new Set<(failure: CheckoutTechnicalFailure) => void>();
export function subscribeCheckoutTechnicalFailure(listener: (failure: CheckoutTechnicalFailure) => void): () => void {
  checkoutFailureListeners.add(listener); return () => { checkoutFailureListeners.delete(listener); };
}
function observeCheckoutFailure(event: SubscriptionEvent, props: Record<string, unknown>): void {
  if (event !== 'subscription_error' || props.stage !== 'checkout' || props.mode !== 'live'
    || !['invalid_confirmation_url', 'browser_unavailable', 'payment_create_failed', 'billing_gateway_invalid_response', 'billing_bad_configuration'].includes(String(props.reason))) return;
  for (const listener of checkoutFailureListeners) {
    try { listener({ stage: 'checkout', mode: 'live', reason: props.reason as CheckoutTechnicalFailure['reason'] }); } catch { /* Domain checkout never depends on an observer. */ }
  }
}

export function normalizeSubscriptionInteractionId(value: unknown): string | undefined {
  return typeof value === 'string' && /^si_[a-z0-9]{1,16}_[a-z0-9]{1,16}_[a-z0-9]{1,8}$/.test(value) ? value : undefined;
}

function subscriptionCollectionEnabled(mode: unknown): boolean {
  return !__DEV__ && process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE !== '1'
    && process.env.EXPO_PUBLIC_YANDEX_TEST_ADS !== '1' && isAppMetricaTestDevice() === false
    && getString(QA_DEVICE_KEY) !== '1' && !useAnalyticsPrefs.getState().optOut && mode !== 'test';
}

/** A validation result belongs to the original press, never to a second user action. */
export function trackSubscriptionCheckoutAction(
  context: { interactionId: string; source?: unknown; mode?: unknown }, validation?: CheckoutValidationResult,
): void {
  try {
    const interactionId = normalizeSubscriptionInteractionId(context.interactionId);
    if (!interactionId || !subscriptionCollectionEnabled(context.mode)
      || validation !== undefined && !checkoutValidationResults.has(validation)) return;
    track('ui_action', {
      screen: 'shop', element_id: 'subscription_checkout', interaction_id: interactionId,
      action: validation === undefined ? 'press' : 'validate',
      outcome: validation === undefined ? 'started' : validation === 'accepted' ? 'accepted' : 'rejected',
      ...(validation !== undefined && validation !== 'accepted' ? { blocked_reason: validation } : {}),
      entry_source: normalizeSubscriptionSource(context.source),
    });
  } catch {
    // Optional telemetry cannot affect validation or checkout.
  }
}

export function normalizeSubscriptionSource(value: unknown): SubscriptionSource {
  return typeof value === 'string' && sources.has(value as SubscriptionSource) ? value as SubscriptionSource : 'direct';
}

/** An arbitrary exception, URL or contact detail can never become an event dimension. */
export function normalizeSubscriptionReason(value: unknown): string {
  return typeof value === 'string' && reasons.has(value) ? value : 'unknown';
}

/** Custom-event marker only. SDK-safe phone QA requires a build with APPMETRICA_QA_BUILD=true. */
export function setSubscriptionAnalyticsTestDevice(enabled: boolean): void {
  setString(QA_DEVICE_KEY, enabled ? '1' : '0');
}

/** Production funnel only. This is custom telemetry, not an AppMetrica Revenue report. */
export function trackSubscription(event: SubscriptionEvent, props: Record<string, unknown> = {}, dedupeKey?: string): string | null {
  observeCheckoutFailure(event, props);
  try {
    if (!events.has(event) || !subscriptionCollectionEnabled(props.mode)) return null;
    const safe: Record<string, string | number> = {
      source: normalizeSubscriptionSource(props.source),
      mode: props.mode === 'live' || props.mode === 'disabled' ? props.mode : 'unknown',
    };
    if (props.stage !== undefined) safe.stage = typeof props.stage === 'string' && stages.has(props.stage) ? props.stage : 'unknown';
    if (props.reason !== undefined) safe.reason = normalizeSubscriptionReason(props.reason);
    if (props.trigger !== undefined) safe.trigger = typeof props.trigger === 'string' && triggers.has(props.trigger) ? props.trigger : 'unknown';
    if (props.result !== undefined) safe.result = typeof props.result === 'string' && results.has(props.result) ? props.result : 'unknown';
    if (typeof props.amount === 'number' && Number.isFinite(props.amount) && props.amount > 0 && props.amount <= 1_000_000_000) safe.amount = props.amount;
    if (typeof props.periodDays === 'number' && Number.isSafeInteger(props.periodDays) && props.periodDays > 0 && props.periodDays <= 36_600) safe.periodDays = props.periodDays;
    const identifiers = ['operation_id', 'entitlement_revision', 'policy_version', 'checkout_id', 'offer_id', 'product_id'];
    for (const key of identifiers) {
      const value = props[key];
      if (typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,127}$/i.test(value)) safe[key] = value;
    }
    const interactionId = normalizeSubscriptionInteractionId(props.interaction_id);
    if (interactionId) safe.interaction_id = interactionId;
    const actions = new Set(['check_status', 'cancel_auto_renew', 'restore', 'issue_recovery', 'change_receipt_email', 'migration_help', 'resume_checkout']);
    if (typeof props.action === 'string' && actions.has(props.action)) safe.action = props.action;
    if (props.normalized_reason !== undefined) safe.normalized_reason = normalizeSubscriptionReason(props.normalized_reason);
    for (const key of ['old_status', 'new_status']) {
      if (props[key] === 'active' || props[key] === 'inactive') safe[key] = props[key];
    }
    if (dedupeKey !== undefined) {
      if (typeof dedupeKey !== 'string' || !/^[a-z0-9][a-z0-9_.:-]*$/i.test(dedupeKey)) return null;
      return trackOnce(event, dedupeKey, safe);
    }
    track(event, safe);
  } catch {
    // A telemetry failure must never affect the offer, consent or payment.
  }
  return null;
}
