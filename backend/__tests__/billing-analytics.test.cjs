const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createBilling } = require('../runtime/billing.cjs');
const { createApi } = require('../runtime/api.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');

const DAY = 86_400_000;
function fixture({ mode = 'live', enabled = true, fetchImpl = async () => ({ status: 200 }) } = {}) {
  let time = Date.parse('2026-11-01T06:00:00Z');
  const store = createMemoryStore({});
  const identity = { provider: 'robokassa', merchant: 'slova', mode };
  const gateway = {
    identity, capabilities: { recurring: true, refunds: true },
    prepareCheckout: (a) => ({ invoiceId: a.invoiceId, confirmationUrl: `https://auth.robokassa.ru/Merchant/Index.aspx?InvId=${a.invoiceId}` }),
    submitRenewal: async (a) => ({ invoiceId: a.invoiceId, status: 'pending' }),
    lookupPayment: async (a) => ({ ...identity, invoiceId: a.invoiceId, amountMinor: a.amountMinor,
      currency: 'RUB', status: 'succeeded', evidence: 'authenticated_status' }),
    verifyResult: (form, a) => {
      if (form.SignatureValue !== 'verified') throw Object.assign(new Error(), { code: 'billing_bad_signature' });
      return { ...identity, invoiceId: a.invoiceId, amountMinor: a.amountMinor, currency: 'RUB',
        status: 'succeeded', evidence: 'signed_result', operationKey: `operation-${a.invoiceId}` };
    },
    submitRefund: async (r) => ({ requestId: `request-${r.id}`, status: 'pending' }),
    lookupRefund: async (r) => ({ requestId: r.requestId, amountMinor: r.amountMinor, status: 'finished' }),
  };
  const notices = { configured: true, mode, ensureNotice: async (s) => ({ ready: true,
    notifiedAt: s.activeUntil - 3 * DAY, notBefore: s.activeUntil }) };
  const options = { store, gateway, notices, provider: 'robokassa', mode, merchantLogin: 'slova', enabled: true,
    now: () => new Date(time), analyticsOptions: { enabled, postApiKey: 'local-test-post-key', fetchImpl } };
  const billing = createBilling(options);
  const request = () => ({ requestId: crypto.randomUUID(), email: 'private-player@example.com',
    consentVersion: billing.catalog().plan.consentVersion, recurringConsented: true, personalDataConsented: true,
    personalDataConsentVersion: billing.catalog().plan.personalDataConsentVersion,
    provider: 'robokassa', protocol: billing.catalog().protocol, merchantLogin: 'slova', mode });
  const pay = async (owner = 'private-billing-user') => {
    const checkout = await billing.checkout(owner, request());
    await billing.result({ InvId: checkout.paymentId, OutSum: '99.00', SignatureValue: 'verified' });
    return checkout;
  };
  return { store, billing, options, pay, request, advance: (ms) => { time += ms; } };
}
const binding = { consent: true, deviceId: '18446744073709551615', installationId: 'sdk-installation-one' };
function facts(f) { return Object.values(f.store.read().analytics.events); }

test('verified payment commits one durable fact; webhook replay/restart cannot duplicate it or leak billing fields', async () => {
  const f = fixture();
  await f.billing.setAnalyticsBinding('private-billing-user', binding);
  const checkout = await f.pay();
  await createBilling(f.options).result({ InvId: checkout.paymentId, OutSum: '99.00', SignatureValue: 'verified' });
  const events = facts(f);
  assert.equal(events.filter((e) => e.payload.event_type === 'paid').length, 1);
  const paid = events.find((e) => e.payload.event_type === 'paid');
  assert.equal(paid.payload.amount_minor, 9900);
  assert.equal(paid.status, 'pending');
  assert.equal(paid.deviceId, binding.deviceId);
  const payload = JSON.stringify(paid.payload);
  for (const secret of ['private-player@example.com', 'private-billing-user', 'auth.robokassa.ru', 'SignatureValue', 'recoveryCode']) {
    assert.equal(payload.includes(secret), false);
  }
  assert.match(paid.payload.pseudonymous_payment_key, /^[0-9a-f]{64}$/);
  assert.equal(Object.values(f.store.read().payments).length, 1);
});

test('unknown/declined provider results create no paid fact and failed durable writes create no phantom analytics', async () => {
  const f = fixture();
  await f.billing.setAnalyticsBinding('owner', binding);
  const checkout = await f.billing.checkout('owner', f.request());
  await assert.rejects(f.billing.result({ InvId: checkout.paymentId, SignatureValue: 'forged' }));
  assert.equal(facts(f).length, 0);
  const original = f.store.write;
  f.store.write = () => { throw new Error('disk full'); };
  await assert.rejects(f.billing.result({ InvId: checkout.paymentId, SignatureValue: 'verified' }), { code: 'billing_store_unavailable' });
  f.store.write = original;
  assert.equal(facts(f).length, 0);
  await f.billing.result({ InvId: checkout.paymentId, SignatureValue: 'verified' });
  assert.equal(facts(f).length, 1);
});

test('consent applies prospectively; revocation invalidates pending payload and late consent never rebinds historical facts', async () => {
  let calls = 0;
  const f = fixture({ fetchImpl: async () => { calls++; return { status: 200 }; } });
  await f.pay();
  assert.equal(facts(f)[0].status, 'not_eligible');
  await f.billing.setAnalyticsBinding('private-billing-user', binding);
  await f.billing.flushAnalytics();
  assert.equal(calls, 0);
  const g = fixture({ fetchImpl: async () => { calls++; return { status: 200 }; } });
  await g.billing.setAnalyticsBinding('private-billing-user', binding);
  await g.pay();
  await g.billing.setAnalyticsBinding('private-billing-user', { consent: false });
  await g.billing.flushAnalytics();
  assert.equal(calls, 0);
  const canceled = facts(g)[0];
  assert.equal(canceled.status, 'consent_revoked');
  assert.equal(canceled.deviceId, null);
  assert.equal(canceled.payload.originating_installation_id, undefined);
});

test('Post API uses fixed origin, CSV body and background facts; ambiguous acceptance cannot be blindly replayed', async () => {
  const posts = [];
  const f = fixture({ fetchImpl: async (url, options) => { posts.push({ url, options }); throw new Error('timeout after acceptance'); } });
  await f.billing.setAnalyticsBinding('private-billing-user', binding);
  await f.pay();
  const first = await f.billing.flushAnalytics();
  assert.equal(first.uncertain, 2);
  await createBilling(f.options).flushAnalytics();
  assert.equal(posts.length, 2);
  assert.equal(new URL(posts[0].url).origin, 'https://api.appmetrica.yandex.ru');
  assert.equal(new URL(posts[0].url).pathname, '/logs/v1/import/events.csv');
  assert.equal(posts[0].options.body.includes('private-player@example.com'), false);
  assert.equal(posts[0].options.body.includes('background'), true);
  const event = facts(f)[0];
  await f.billing.reconcileAnalyticsImport(event.id, false);
  await f.billing.flushAnalytics();
  assert.equal(posts.length, 3);
  await f.billing.reconcileAnalyticsImport(event.id, true);
  await f.billing.flushAnalytics();
  assert.equal(posts.length, 3);
});

test('server-only renewals, cancellation, refund and deterministic expiry emit once without a client session', async () => {
  const f = fixture();
  await f.billing.setAnalyticsBinding('private-billing-user', binding);
  const checkout = await f.pay();
  f.advance(31 * DAY);
  await f.billing.runRenewals();
  assert.equal(facts(f).filter((e) => e.payload.event_type === 'renewed').length, 1);
  const refund = await f.billing.requestRefund(checkout.paymentId, 3300, crypto.randomUUID());
  await f.billing.reconcileRefund(refund.id);
  await f.billing.reconcileRefund(refund.id);
  assert.equal(facts(f).filter((e) => e.payload.event_type === 'refunded').length, 1);
  assert.equal(facts(f).find((e) => e.payload.event_type === 'refunded').payload.amount_minor, -3300);
  await f.billing.cancel('private-billing-user');
  await f.billing.cancel('private-billing-user');
  assert.equal(facts(f).filter((e) => e.payload.event_type === 'auto_renew_disabled').length, 1);
  f.advance(40 * DAY);
  await f.billing.flushAnalytics();
  await f.billing.flushAnalytics();
  // The original period expired before the delayed renewal; the renewed period
  // later expired too. Each effective expiry is recorded exactly once.
  assert.equal(facts(f).filter((e) => e.payload.event_type === 'expired').length, 2);
  assert.equal(facts(f).every((e) => !Object.hasOwn(e.payload, 'analytics_session_id')), true);
});

test('test mode and old imports never transmit production financial telemetry', async () => {
  let calls = 0;
  const f = fixture({ mode: 'test', fetchImpl: async () => { calls++; return { status: 200 }; } });
  await f.billing.setAnalyticsBinding('private-billing-user', binding);
  await f.pay(); await f.billing.flushAnalytics();
  assert.equal(calls, 0);
  assert.equal(facts(f)[0].status, 'not_eligible');
  const g = fixture({ fetchImpl: async () => { calls++; return { status: 200 }; } });
  await g.billing.setAnalyticsBinding('private-billing-user', binding);
  await g.pay(); g.advance(15 * DAY); await g.billing.flushAnalytics();
  assert.equal(calls, 0);
  assert.equal(facts(g)[0].status, 'outside_import_window');
});

test('analytics binding is authenticated and rejects unsafe identities/PII instead of forwarding them', async () => {
  const f = fixture();
  const api = createApi({ store: createMemoryStore(), billing: f.billing });
  const request = { method: 'POST', url: '/api/billing/analytics-binding', body: JSON.stringify(binding) };
  assert.equal((await api.handle(request)).status, 401);
  const auth = JSON.parse((await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: '{"nickname":"Тест"}' })).body);
  request.headers = { authorization: `Bearer ${auth.authToken}` };
  assert.equal((await api.handle(request)).status, 200);
  for (const input of [{ ...binding, deviceId: 18446744073709551615 }, { ...binding, deviceId: '99999999999999999999' }, { ...binding, deviceId: 'private@example.com' },
    { ...binding, email: 'private@example.com' }, { consent: 'yes' }]) {
    request.body = JSON.stringify(input);
    assert.equal((await api.handle(request)).status, 400);
  }
});

test('a damaged persisted payload cannot bypass the external privacy whitelist', async () => {
  let calls = 0;
  const f = fixture({ fetchImpl: async () => { calls++; return { status: 200 }; } });
  await f.billing.setAnalyticsBinding('private-billing-user', binding);
  await f.pay();
  const data = f.store.read();
  Object.values(data.analytics.events)[0].payload.email = 'private@example.com';
  f.store.write(data);
  await f.billing.flushAnalytics();
  assert.equal(calls, 0);
  assert.equal(facts(f)[0].status, 'invalid_payload');
});

test('the standard Revenue channel is authoritative, separate from custom diagnostics, and dispatches each financial fact once', async () => {
  const posts = [];
  const f = fixture({ fetchImpl: async (url, options) => { posts.push({ url, body: options.body }); return { status: 200 }; } });
  await f.billing.setAnalyticsBinding('private-billing-user', binding);
  await f.pay();
  const result = await f.billing.flushAnalytics();
  assert.deepEqual(result, { configured: true, sent: 1, revenueSent: 1, uncertain: 0 });
  await createBilling(f.options).flushAnalytics();
  assert.equal(posts.length, 2);
  const revenue = posts.find((post) => new URL(post.url).pathname.endsWith('/revenue.csv'));
  assert.ok(revenue);
  assert.match(revenue.body, /revenue_event_type/);
  assert.match(revenue.body, /"subscription_started"/);
  assert.match(revenue.body, /"99.00","RUB"/);
  assert.equal(revenue.body.includes('private-billing-user'), false);
  assert.equal(facts(f)[0].status, 'delivered');
  assert.equal(facts(f)[0].revenueStatus, 'delivered');
});
