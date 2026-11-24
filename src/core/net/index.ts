import { ENV } from '@/core/config/env';

export interface Row {
  userId: string;
  nickname: string;
  tag: string;
  score: number;
  division: string;
  rank: number;
}
export interface Snapshot {
  scope: string;
  week: string;
  top: Row[];
  me: Row | null;
  neighbors: Row[];
  total: number;
}
export interface Profile {
  userId: string;
  nickname: string;
  tag: string;
  levels: number;
  score: number;
  division: string;
}

export interface EventBoard {
  event: { id: string; title: string; metric: string; week: string };
  board: Row[];
  me: Row | null;
}
export interface TeamMember {
  nickname: string;
  score: number;
}
export interface Team {
  id: string;
  name: string;
  leaderId: string;
  memberCount: number;
  totalScore: number;
  members: TeamMember[];
}

export interface BillingPlan {
  id: string;
  title: string;
  amount: string;
  currency: 'RUB';
  periodDays: number;
  consentVersion: string;
  termsVersion: string;
  privacyVersion: string;
  consentText: string;
  userAgreementVersion: string;
  personalDataConsentVersion: string;
  personalDataConsentText: string;
}

export interface BillingCatalog {
  provider: 'robokassa';
  protocol: 'robokassa-v3';
  merchantLogin: string;
  available: boolean;
  mode: 'disabled' | 'test' | 'live';
  plan: BillingPlan;
  termsUrl?: string;
  manageUrl?: string;
}

export interface SubscriptionStatus {
  active: boolean;
  activeUntil: number | null;
  autoRenew: boolean;
  nextPaymentAt: number | null;
  pendingPaymentId: string | null;
  serverTime: number;
  checkoutResolution?: { requestId: string; paymentId: string; state: 'pending' | 'succeeded' | 'canceled' | 'failed' } | null;
}

export interface SubscriptionCheckoutRequest {
  provider: BillingCatalog['provider'];
  protocol: BillingCatalog['protocol'];
  merchantLogin: string;
  mode: BillingCatalog['mode'];
  requestId: string;
  consentVersion: string;
  recurringConsented: true;
  personalDataConsented: true;
  personalDataConsentVersion: string;
  email: string;
}

export interface SubscriptionCheckout extends SubscriptionStatus {
  paymentId: string;
  confirmationUrl: string | null;
  recoveryCode: string | null;
}

export interface BillingDraftIdentity {
  requestId: string;
  paymentId: string | null;
  provider: string;
  protocol: string | null;
  merchantLogin: string | null;
  mode: BillingCatalog['mode'] | null;
}

export interface BillingMigrationResolution {
  resolution: 'safe_to_discard';
  reason: 'retired_test_payment' | 'operator_reviewed';
  draft: BillingDraftIdentity;
  target: Pick<BillingCatalog, 'provider' | 'protocol' | 'merchantLogin' | 'mode'>;
}

const BILLING_ERROR_CODES = new Set([
  'offline', 'network', 'timeout', 'invalid_response', 'billing_disabled',
  'billing_unavailable', 'bad_request', 'bad_email', 'bad_consent', 'bad_request_id',
  'bad_recovery_code', 'invalid_recovery_code', 'recovery_not_found', 'recovery_rate_limited',
  'rate_limited', 'unauthorized', 'profile_not_found', 'subscription_not_found',
  'subscription_active', 'checkout_pending', 'payment_pending', 'payment_canceled',
  'provider_unavailable', 'provider_error', 'payment_create_failed', 'not_found',
  'billing_bad_user', 'billing_bad_configuration', 'billing_ownership_changed',
  'billing_bad_recovery_code', 'billing_recovery_not_found', 'billing_payment_mismatch',
  'billing_payment_unverified', 'billing_payment_conflict', 'billing_gateway_unavailable',
  'billing_gateway_rejected', 'billing_gateway_invalid_response', 'billing_bad_request_id',
  'billing_consent_required', 'billing_receipt_email_required', 'billing_already_subscribed',
  'billing_checkout_canceled', 'billing_payment_pending', 'billing_manual_reconciliation_required',
  'billing_subscription_not_found', 'billing_restore_conflict',
  'billing_mode_conflict', 'billing_notification_rate_limited',
  'billing_email_change_pending',
  'billing_provider_migration_required', 'billing_client_update_required',
  'billing_migration_unresolved',
  'billing_personal_data_consent_required',
]);

/** Never expose provider responses, credentials, or arbitrary exception text in the UI. */
export function safeBillingError(error: unknown): string {
  const code = error instanceof Error ? error.message : error;
  return typeof code === 'string' && BILLING_ERROR_CODES.has(code) ? code : 'billing_unavailable';
}

export interface BackendClient {
  bindSubscriptionAnalytics?(token: string, body: { consent: boolean; deviceId?: string; installationId?: string }): Promise<{ consent: boolean; bound: boolean }>;
  bootstrap(nickname: string): Promise<{ profile: Profile; authToken: string }>;
  rename(token: string, nickname: string): Promise<Profile>;
  submitProgress(token: string, levels: number): Promise<Snapshot>;
  leaderboard(token: string, scope: 'global' | 'weekly'): Promise<Snapshot>;
  pullSave(token: string): Promise<unknown>;
  pushSave(token: string, version: number, save: unknown): Promise<unknown>;
  eventsCurrent(token: string): Promise<EventBoard>;
  teamsList(token: string): Promise<{ teams: Team[] }>;
  teamMine(token: string): Promise<{ team: Team | null }>;
  teamCreate(token: string, name: string): Promise<{ team: Team }>;
  teamJoin(token: string, id: string): Promise<{ team: Team }>;
  teamLeave(token: string): Promise<{ ok: boolean }>;
  billingCatalog(): Promise<BillingCatalog>;
  subscription(token: string, checkoutRequestId?: string): Promise<SubscriptionStatus>;
  subscriptionCheckout(token: string, body: SubscriptionCheckoutRequest): Promise<SubscriptionCheckout>;
  cancelSubscription(token: string): Promise<SubscriptionStatus>;
  restoreSubscription(token: string, recoveryCode: string): Promise<SubscriptionStatus>;
  subscriptionRecovery(token: string): Promise<{ recoveryCode: string }>;
  updateSubscriptionEmail(token: string, email: string): Promise<SubscriptionStatus>;
  resolveSubscriptionMigration(token: string, draft: BillingDraftIdentity): Promise<BillingMigrationResolution>;
}

function makeHttp(base: string): BackendClient {
  async function req(path: string, method: string, token?: string, body?: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(base + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const result = await res.json();
      if (controller.signal.aborted) throw new Error('timeout');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('timeout');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function billing<T>(path: string, method: string, token?: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      let res: Response;
      try {
        res = await fetch(base + path, {
          method,
          headers: {
            'content-type': 'application/json',
            'X-Slova-Billing-Protocol': 'robokassa-v3',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw new Error(controller.signal.aborted ? 'timeout' : 'network');
      }
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        const fallback = res.status === 401 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'billing_unavailable';
        const code = result?.code ?? result?.error;
        throw new Error(typeof code === 'string' && BILLING_ERROR_CODES.has(code) ? code : fallback);
      }
      if (!result || typeof result !== 'object') throw new Error('invalid_response');
      return result as T;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    bindSubscriptionAnalytics: (token, body) => billing('/api/billing/analytics-binding', 'POST', token, body),
    bootstrap: (nickname) => req('/api/profile/bootstrap', 'POST', undefined, { nickname }),
    rename: (token, nickname) => req('/api/profile/rename', 'POST', token, { nickname }).then((r) => r.profile),
    submitProgress: (token, levels) => req('/api/progress', 'POST', token, { levels }),
    leaderboard: (token, scope) => req(`/api/leaderboard?scope=${scope}`, 'GET', token),
    pullSave: (token) => req('/api/save', 'GET', token).then((r) => r.save),
    pushSave: (token, version, save) => req('/api/save', 'POST', token, { version, save }).then((r) => r.save),
    eventsCurrent: (token) => req('/api/events/current', 'GET', token),
    teamsList: (token) => req('/api/teams', 'GET', token),
    teamMine: (token) => req('/api/teams/mine', 'GET', token),
    teamCreate: (token, name) => req('/api/teams', 'POST', token, { name }),
    teamJoin: (token, id) => req(`/api/teams/${id}/join`, 'POST', token),
    teamLeave: (token) => req('/api/teams/me/leave', 'POST', token),
    billingCatalog: () => billing('/api/billing/catalog', 'GET'),
    subscription: (token, checkoutRequestId) => billing(`/api/billing/subscription${checkoutRequestId ? `?checkoutRequestId=${encodeURIComponent(checkoutRequestId)}` : ''}`, 'GET', token),
    subscriptionCheckout: (token, body) => billing('/api/billing/checkout', 'POST', token, body),
    cancelSubscription: (token) => billing('/api/billing/subscription/cancel', 'POST', token, {}),
    restoreSubscription: (token, recoveryCode) => billing('/api/billing/restore', 'POST', token, { recoveryCode }),
    subscriptionRecovery: (token) => billing('/api/billing/recovery', 'POST', token, {}),
    updateSubscriptionEmail: (token, email) => billing('/api/billing/email', 'POST', token, { email }),
    resolveSubscriptionMigration: (token, draft) => billing('/api/billing/migration/resolve', 'POST', token, draft),
  };
}

const NoopBackend: BackendClient = {
  async bindSubscriptionAnalytics() { throw new Error('offline'); },
  async bootstrap() {
    throw new Error('offline');
  },
  async rename() {
    throw new Error('offline');
  },
  async submitProgress() {
    throw new Error('offline');
  },
  async leaderboard() {
    throw new Error('offline');
  },
  async pullSave() {
    return null;
  },
  async pushSave() {
    return null;
  },
  async eventsCurrent() {
    throw new Error('offline');
  },
  async teamsList() {
    throw new Error('offline');
  },
  async teamMine() {
    throw new Error('offline');
  },
  async teamCreate() {
    throw new Error('offline');
  },
  async teamJoin() {
    throw new Error('offline');
  },
  async teamLeave() {
    throw new Error('offline');
  },
  async billingCatalog() {
    throw new Error('offline');
  },
  async subscription() {
    throw new Error('offline');
  },
  async subscriptionCheckout() {
    throw new Error('offline');
  },
  async cancelSubscription() {
    throw new Error('offline');
  },
  async restoreSubscription() {
    throw new Error('offline');
  },
  async subscriptionRecovery() {
    throw new Error('offline');
  },
  async updateSubscriptionEmail() {
    throw new Error('offline');
  },
  async resolveSubscriptionMigration() {
    throw new Error('offline');
  },
};

export function getBackend(): BackendClient {
  return ENV.apiUrl ? makeHttp(ENV.apiUrl) : NoopBackend;
}
