const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { createBilling, DEFAULT_PLAN } = require('../runtime/billing.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');
const { createYooKassa } = require('../runtime/yookassa.cjs');
const { createRenewalNotices } = require('../runtime/renewal-notices.cjs');

const DAY = 86_400_000;
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(extra = {}) {
  let time = Date.parse('2026-10-05T12:00:00Z');
  const store = createMemoryStore({});
  const payments = new Map();
  const refunds = new Map();
  const byKey = new Map();
  const creates = [];
  let gets = 0;
  const gateway = {
    async createPayment(payload, key) {
      creates.push({ payload: copy(payload), key });
      if (!byKey.has(key)) {
        const id = crypto.randomUUID();
        byKey.set(key, id);
        payments.set(id, {
          id, amount: copy(payload.amount), metadata: copy(payload.metadata),
          status: 'pending', paid: false, test: extra.mode !== 'live',
          created_at: new Date(time).toISOString(),
          confirmation: { confirmation_url: `https://yookassa.ru/checkout/${id}` },
          payment_method: { saved: true, id: 'saved-method-id' },
        });
      }
      return copy(payments.get(byKey.get(key)));
    },
    async getPayment(id) { gets += 1; return copy(payments.get(id)); },
    async getRefund(id) { return copy(refunds.get(id)); },
  };
  const options = { store, gateway, now: () => new Date(time), enabled: true, ...extra };
  const billing = createBilling(options);
  const request = () => ({ requestId: crypto.randomUUID(), consentVersion: DEFAULT_PLAN.consentVersion, email: 'player@example.com' });
  const notification = (paymentId, event = 'payment.succeeded', extra = {}) => ({ type: 'notification', event, object: { id: paymentId, ...extra } });
  const succeed = (id) => Object.assign(payments.get(id), { status: 'succeeded', paid: true });
  const purchase = async (user = 'player') => {
    const checkout = await billing.checkout(user, request());
    succeed(checkout.paymentId);
    await billing.webhook(notification(checkout.paymentId));
    return checkout;
  };
  return { store, options, billing, gateway, payments, refunds, byKey, creates, request, notification, succeed, purchase,
    advance: (ms) => { time += ms; }, now: () => time, getCount: () => gets };
}

function noticeFixture(mode = 'live') {
  const notices = { mode, configured: true, async ensureNotice() { throw new Error('not initialized'); } };
  const f = fixture({ mode, notices });
  const noticeStore = createMemoryStore({});
  const emails = [];
  const transport = { mode, idempotencyWindowMs: 0,
    async send(message, key) { emails.push({ message: copy(message), key }); return { id: 'accepted-email' }; } };
  const noticeOptions = { store: noticeStore, transport, mode, now: f.now,
    sender: 'Слова <billing@example.com>', supportEmail: 'support@example.com', publicBase: 'https://slova.example.com' };
  Object.assign(notices, createRenewalNotices(noticeOptions));
  return { ...f, notices, noticeStore, transport, emails, noticeOptions };
}

test('disabled catalog prevents checkout/renewals but still allows cancellation and management', async () => {
  const f = fixture();
  const bought = await f.purchase();
  const paused = createBilling({ ...f.options, enabled: false });
  assert.equal(paused.catalog().available, false);
  await assert.rejects(paused.checkout('new-player', f.request()), { code: 'billing_unavailable' });
  await assert.rejects(paused.runRenewals(), { code: 'billing_unavailable' });
  assert.equal((await paused.status('player')).active, true);
  assert.equal((await paused.manage({ recoveryCode: bought.recoveryCode, action: 'cancel' })).autoRenew, false);
  assert.equal((await paused.cancel('player')).active, true);
  assert.match((await paused.recovery('player')).recoveryCode, /^[A-Za-z0-9_-]{32}$/);
});

test('paused sales still reconcile existing known payment IDs and verified refunds', async () => {
  const f = fixture();
  const c = await f.billing.checkout('player', f.request());
  const paused = createBilling({ ...f.options, enabled: false });
  f.succeed(c.paymentId);
  assert.equal((await paused.status('player')).active, true);
  assert.equal(f.creates.length, 1);
  const before = f.getCount();
  assert.deepEqual(await paused.webhook(f.notification('unknown-payment')), { ok: true, ignored: true });
  assert.equal(f.getCount(), before);
  f.refunds.set('paused-refund', { id: 'paused-refund', payment_id: c.paymentId, status: 'succeeded', amount: { value: '99.00', currency: 'RUB' } });
  await paused.webhook(f.notification('paused-refund', 'refund.succeeded', { payment_id: c.paymentId }));
  assert.equal((await paused.status('player')).active, false);
});

test('paused sales never retry an unknown charge without provider ID', async () => {
  const f = fixture();
  let creates = 0;
  f.gateway.createPayment = async () => { creates += 1; throw new Error('timeout'); };
  await assert.rejects(f.billing.checkout('player', f.request()));
  const paused = createBilling({ ...f.options, enabled: false });
  assert.equal((await paused.status('player')).active, false);
  assert.equal(creates, 1);
});

test('explicit consent, UUID request and receipt contact required before creating any payment', async () => {
  const f = fixture();
  for (const [change, code] of [
    [{ consentVersion: undefined }, 'billing_consent_required'],
    [{ consentVersion: 'outdated' }, 'billing_consent_required'],
    [{ requestId: '../../secrets' }, 'billing_bad_request_id'],
    [{ email: 'invalid' }, 'billing_receipt_email_required'],
    [{ email: 'a@b.com\nInjected' }, 'billing_receipt_email_required'],
  ]) await assert.rejects(f.billing.checkout('player', { ...f.request(), ...change }), { code });
  assert.equal(f.creates.length, 0);
  await f.billing.checkout('player', f.request());
  assert.equal(f.creates[0].payload.amount.value, '99.00');
  assert.equal(f.creates[0].payload.receipt, undefined);
  assert.equal(JSON.stringify(f.creates[0].payload).includes('player@example.com'), false);
});

test('pending checkout grants no access; concurrent retries reuse one durable attempt', async () => {
  const f = fixture();
  const req = f.request();
  const [a, b, c] = await Promise.all([
    f.billing.checkout('player', req), f.billing.checkout('player', req), f.billing.checkout('player', f.request()),
  ]);
  assert.equal(a.paymentId, b.paymentId);
  assert.equal(a.paymentId, c.paymentId);
  assert.equal(a.recoveryCode, b.recoveryCode);
  assert.equal(a.recoveryCode, c.recoveryCode);
  assert.equal(f.creates.length, 1);
  assert.equal((await f.billing.status('player')).active, false);
  assert.equal(Object.keys(f.store.read().attempts).length, 1);
});

test('fake success webhook uses provider status and cannot grant access', async () => {
  const f = fixture();
  const c = await f.billing.checkout('player', f.request());
  await f.billing.webhook(f.notification(c.paymentId, 'payment.succeeded', { paid: true, status: 'succeeded', activeUntil: 9999999999999 }));
  assert.equal((await f.billing.status('player')).active, false);
  const before = f.getCount();
  assert.deepEqual(await f.billing.webhook(f.notification('unknown-id')), { ok: true, ignored: true });
  assert.equal(f.getCount(), before);
});

test('concurrent success notifications grant exactly one period, then block duplicate subscription', async () => {
  const f = fixture();
  const req = f.request();
  const c = await f.billing.checkout('player', req);
  f.succeed(c.paymentId);
  await Promise.all(Array.from({ length: 8 }, () => f.billing.webhook(f.notification(c.paymentId))));
  const status = await f.billing.status('player');
  assert.equal(status.activeUntil, f.now() + 30 * DAY);
  assert.equal(status.autoRenew, true);
  assert.equal(status.pendingPaymentId, null);
  assert.equal(Object.keys(f.store.read().payments).length, 1);
  assert.equal((await f.billing.checkout('player', req)).paymentId, c.paymentId);
  await assert.rejects(f.billing.checkout('player', f.request()), { code: 'billing_already_subscribed' });
});

test('provider amount, currency, user, attempt, subscription and test-mode mismatches rejected', async () => {
  for (const mutate of [
    (p) => { p.amount.value = '0.01'; },
    (p) => { p.amount.currency = 'USD'; },
    (p) => { p.metadata.user_id = 'attacker'; },
    (p) => { p.metadata.attempt_id = crypto.randomUUID(); },
    (p) => { p.metadata.subscription_id = crypto.randomUUID(); },
    (p) => { p.metadata.plan_id = 'other-plan'; },
    (p) => { p.test = false; },
    (p) => { p.test = undefined; },
    (p) => { p.id = 'different-payment'; },
  ]) {
    const f = fixture();
    const c = await f.billing.checkout('player', f.request());
    f.succeed(c.paymentId);
    mutate(f.payments.get(c.paymentId));
    await assert.rejects(f.billing.webhook(f.notification(c.paymentId)), { code: 'billing_payment_mismatch' });
    assert.equal(Object.keys(f.store.read().payments).length, 0);
  }
});

test('uncaptured/unpaid and insecure confirmation never create subscription access', async () => {
  const f = fixture();
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async (...args) => {
    const p = await original(...args);
    f.payments.get(p.id).confirmation.confirmation_url = 'http://attacker.example/';
    return p;
  };
  await assert.rejects(f.billing.checkout('player', f.request()), { code: 'billing_payment_pending' });
  const id = f.creates[0].key;
  const paymentId = f.byKey.get(id);
  Object.assign(f.payments.get(paymentId), { status: 'succeeded', paid: false });
  await assert.rejects(f.billing.webhook(f.notification(paymentId)), { code: 'billing_payment_unverified' });
  assert.equal(Object.keys(f.store.read().payments).length, 0);
});

test('verified success without saved payment method grants paid access without recurrence', async () => {
  const f = fixture();
  const c = await f.billing.checkout('player', f.request());
  f.payments.get(c.paymentId).payment_method.saved = false;
  f.succeed(c.paymentId);
  await f.billing.webhook(f.notification(c.paymentId));
  const status = await f.billing.status('player');
  assert.equal(status.active, true);
  assert.equal(status.autoRenew, false);
  f.advance(31 * DAY);
  await f.billing.runRenewals();
  assert.equal(f.creates.length, 1);
});

test('timeout after charge creation survives restart and retries identical provider key and payload', async () => {
  const f = fixture();
  const original = f.gateway.createPayment;
  let first = true;
  f.gateway.createPayment = async (...args) => {
    const p = await original(...args);
    if (first) { first = false; throw new Error('secretKey should never escape'); }
    return p;
  };
  const req = f.request();
  await assert.rejects(f.billing.checkout('player', req), { code: 'billing_gateway_unavailable', message: 'billing_gateway_unavailable' });
  assert.equal(Object.keys(f.store.read().attempts).length, 1);
  const restarted = createBilling(f.options);
  const resumed = await restarted.checkout('player', req);
  assert.equal(f.creates[0].key, f.creates[1].key);
  assert.deepEqual(f.creates[0].payload, f.creates[1].payload);
  assert.equal(f.payments.size, 1);
  assert.equal(resumed.recoveryCode, null);
  const code = (await restarted.recovery('player')).recoveryCode;
  assert.equal((await restarted.manage({ recoveryCode: code, action: 'status' })).active, false);
});

test('unknown creation after idempotency retention stays blocked rather than charging again', async () => {
  const f = fixture();
  f.gateway.createPayment = async () => { throw new Error('timeout'); };
  const req = f.request();
  await assert.rejects(f.billing.checkout('player', req), { code: 'billing_gateway_unavailable' });
  f.advance(24 * 60 * 60 * 1000);
  const restarted = createBilling(f.options);
  await assert.rejects(restarted.checkout('player', f.request()), { code: 'billing_manual_reconciliation_required' });
  assert.equal(Object.keys(f.store.read().attempts).length, 1);
  assert.equal(f.payments.size, 0);
});

test('webhook reconciles timeout with unknown payment ID only via verified attempt metadata', async () => {
  const f = fixture();
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async (...args) => { await original(...args); throw new Error('timeout'); };
  await assert.rejects(f.billing.checkout('player', f.request()));
  const payment = [...f.payments.values()][0];
  f.succeed(payment.id);
  await f.billing.webhook(f.notification(payment.id, 'payment.succeeded', { metadata: payment.metadata }));
  assert.equal((await f.billing.status('player')).active, true);
  assert.equal(f.creates.length, 1);
});

test('simultaneous renewal jobs charge once and preserve paid duration', async () => {
  const f = fixture();
  await f.purchase();
  f.advance(30 * DAY);
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async (...args) => {
    const payment = await original(...args);
    f.succeed(payment.id);
    return payment;
  };
  await Promise.all([f.billing.runRenewals(), f.billing.runRenewals(), f.billing.runRenewals()]);
  await f.billing.runRenewals();
  assert.equal(f.creates.length, 2);
  assert.equal(f.creates[1].payload.payment_method_id, 'saved-method-id');
  assert.equal((await f.billing.status('player')).activeUntil, f.now() + 30 * DAY);
});

test('catalog price changes cannot change existing renewal consent', async () => {
  const f = fixture();
  await f.purchase();
  f.advance(30 * DAY);
  const modified = createBilling({ ...f.options, plan: { amount: '149.00', consentVersion: 'new-price-v2' } });
  await modified.runRenewals();
  assert.equal(f.creates[1].payload.amount.value, '99.00');
});

test('live availability requires an actually configured notice capability of the same mode', async () => {
  const f = fixture();
  for (const notices of [undefined, { configured: false, mode: 'live', ensureNotice() {} },
    { configured: true, mode: 'test', ensureNotice() {} }, { configured: true, mode: 'live' }]) {
    const live = createBilling({ ...f.options, mode: 'live', notices });
    assert.equal(live.catalog().available, false);
    await assert.rejects(live.checkout('player', f.request()), { code: 'billing_unavailable' });
    await assert.rejects(live.runRenewals(), { code: 'billing_unavailable' });
  }
  assert.equal(f.creates.length, 0);
  assert.equal(f.billing.catalog().available, true);
});

test('malformed valid-JSON billing ledgers fail closed before creating any payment', async (t) => {
  const corrupt = [
    null, [], 'ledger', { billingVersion: 2 }, { billingVersion: '1' },
    ...['subscriptions', 'attempts', 'requests', 'payments', 'refunds'].map((key) => {
      const versioned = { billingVersion: 1, subscriptions: {}, attempts: {}, requests: {}, payments: {}, refunds: {} };
      delete versioned[key];
      return versioned;
    }),
    ...['subscriptions', 'attempts', 'requests', 'payments', 'refunds'].flatMap((key) =>
      [ { [key]: [] }, { [key]: null }, { [key]: 'corrupt' } ]),
  ];
  for (const [index, initial] of corrupt.entries()) await t.test(`invalid ledger ${index}`, async () => {
    const store = createMemoryStore(initial);
    const f = fixture({ store });
    await assert.rejects(f.billing.checkout('player', f.request()), { code: 'billing_store_unavailable', message: 'billing_store_unavailable' });
    assert.equal(f.creates.length, 0);
    assert.deepEqual(store.read(), initial);
  });
});

test('a ledger write failure is sanitized and prevents an unrecorded payment request', async () => {
  const f = fixture({ store: { read: () => ({}), write: () => { throw new Error('private file path or credentials'); } } });
  await assert.rejects(f.billing.checkout('player', f.request()), { code: 'billing_store_unavailable', message: 'billing_store_unavailable' });
  assert.equal(f.creates.length, 0);
});

test('persisted checkout payload corruption is rejected before any provider POST', async (t) => {
  const changes = [
    ['amount', (attempt) => { attempt.payload.amount.value = '149.00'; }],
    ['currency', (attempt) => { attempt.payload.amount.currency = 'USD'; }],
    ['capture', (attempt) => { attempt.payload.capture = false; }],
    ['save method', (attempt) => { attempt.payload.save_payment_method = false; }],
    ['metadata attempt', (attempt) => { attempt.payload.metadata.attempt_id = crypto.randomUUID(); }],
    ['metadata user', (attempt) => { attempt.payload.metadata.user_id = 'another-player'; }],
    ['metadata plan', (attempt) => { attempt.payload.metadata.plan_id = 'different-plan'; }],
    ['extra metadata', (attempt) => { attempt.payload.metadata.extra = 'unapproved'; }],
    ['description', (attempt) => { attempt.payload.description = 'Different purchase'; }],
    ['receipt', (attempt) => { attempt.payload.receipt = { tax_system_code: 1 }; }],
    ['confirmation', (attempt) => { attempt.payload.confirmation = { type: 'direct' }; }],
    ['saved method injection', (attempt) => { attempt.payload.payment_method_id = 'different-method'; }],
    ['missing captured method', (attempt) => { delete attempt.savedMethodId; }],
    ['invalid frozen amount', (attempt) => { attempt.amount = 149; }],
    ['invalid frozen period', (attempt) => { attempt.periodDays = -1; }],
    ['payload array', (attempt) => { attempt.payload = []; }],
    ['payload null', (attempt) => { attempt.payload = null; }],
  ];
  for (const [name, change] of changes) await t.test(name, async () => {
    const f = fixture();
    const original = f.gateway.createPayment;
    f.gateway.createPayment = async () => { throw new Error('pause before network'); };
    const request = f.request();
    await assert.rejects(f.billing.checkout('player', request), { code: 'billing_gateway_unavailable' });
    const data = f.store.read();
    change(Object.values(data.attempts)[0]);
    f.store.write(data);
    f.gateway.createPayment = original;
    const restarted = createBilling(f.options);
    await assert.rejects(restarted.checkout('player', request), { code: 'billing_store_unavailable', message: 'billing_store_unavailable' });
    assert.equal(f.creates.length, 0);
  });
});

test('persisted renewal cannot replace its captured saved payment method', async () => {
  const f = fixture();
  await f.purchase();
  f.advance(30 * DAY);
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async () => { throw new Error('pause before network'); };
  await f.billing.runRenewals();
  const data = f.store.read();
  const attempt = Object.values(data.attempts).find((item) => item.kind === 'renewal');
  assert.equal(attempt.savedMethodId, 'saved-method-id');
  attempt.payload.payment_method_id = 'different-method';
  f.store.write(data);
  f.gateway.createPayment = original;
  const outcome = await createBilling(f.options).runRenewals();
  assert.equal(outcome.failures, 1);
  assert.equal(f.creates.length, 1);
});

test('changing frozen and payload price together still cannot override current agreed terms', async () => {
  const f = fixture();
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async () => { throw new Error('pause before network'); };
  const request = f.request();
  await assert.rejects(f.billing.checkout('player', request));
  const data = f.store.read();
  const attempt = Object.values(data.attempts)[0];
  attempt.amount = '149.00';
  attempt.payload.amount.value = '149.00';
  f.store.write(data);
  f.gateway.createPayment = original;
  await assert.rejects(createBilling(f.options).checkout('player', request), { code: 'billing_payment_pending' });
  assert.equal(f.creates.length, 0);
});

test('queued cancellation persisted during an awaited renewal reservation prevents the final provider POST', async () => {
  const f = noticeFixture();
  await f.purchase();
  f.advance(27 * DAY);
  await f.billing.runRenewals();
  f.advance(3 * DAY);
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async () => { throw new Error('pause before network'); };
  await f.billing.runRenewals();
  const data = f.store.read();
  const attempt = Object.values(data.attempts).find((item) => item.kind === 'renewal');
  // A valid durable reservation whose provider call has not yet started.
  attempt.firstSentAt = null;
  f.store.write(data);
  const events = [];
  const write = f.store.write;
  f.store.write = (current) => {
    if (Object.values(current.subscriptions)[0].autoRenew === false) events.push('cancellation persisted');
    write(current);
  };
  f.gateway.createPayment = async (...args) => { events.push('provider POST'); return original(...args); };
  await Promise.all([f.billing.status('player'), f.billing.cancel('player')]);
  assert.equal(events.includes('cancellation persisted'), true);
  assert.equal(events.includes('provider POST'), false);
  assert.equal(f.creates.length, 1);
  assert.equal(f.store.read().attempts[attempt.id].state, 'canceled');
});

test('live notices start 72h before expiry and never authorize an early renewal', async () => {
  const f = noticeFixture();
  await f.purchase();
  const expiry = (await f.billing.status('player')).activeUntil;
  f.advance(27 * DAY - 1);
  await f.billing.runRenewals();
  assert.equal(f.emails.length, 0);
  f.advance(1);
  await f.billing.runRenewals();
  assert.equal(f.emails.length, 1);
  assert.equal(f.creates.length, 1);
  assert.equal((await f.billing.status('player')).nextPaymentAt, expiry);
  f.advance(DAY);
  await f.billing.runRenewals();
  assert.equal(f.creates.length, 1);
  f.advance(2 * DAY);
  await Promise.all([f.billing.runRenewals(), f.billing.runRenewals()]);
  assert.equal(f.creates.length, 2);
  assert.equal(f.emails.length, 1);
  const renewal = Object.values(f.store.read().attempts).find((attempt) => attempt.kind === 'renewal');
  assert.equal(renewal.renewalDueAt, expiry);
  assert.equal(renewal.renewalNotBefore, expiry);
  assert.equal(renewal.firstSentAt - renewal.renewalNotifiedAt >= DAY, true);
  f.succeed(renewal.paymentId);
  const active = await f.billing.status('player');
  assert.equal(active.activeUntil, f.now() + 30 * DAY);
  const sub = Object.values(f.store.read().subscriptions)[0];
  assert.equal(sub.renewalPaymentAt, null);
  assert.equal(sub.renewalNoticeBinding, null);
  assert.equal(active.nextPaymentAt, active.activeUntil);
});

test('overdue live subscription publishes its postponed charge without extending paid access or changing notice identity', async () => {
  const f = noticeFixture();
  await f.purchase();
  const expiry = (await f.billing.status('player')).activeUntil;
  f.advance(31 * DAY);
  assert.equal((await f.billing.status('player')).nextPaymentAt, null);
  await f.billing.runRenewals();
  const scheduled = f.now() + 25 * 3_600_000;
  const status = await f.billing.status('player');
  assert.equal(status.active, false);
  assert.equal(status.activeUntil, expiry);
  assert.equal(status.autoRenew, true);
  assert.equal(status.nextPaymentAt, scheduled);
  const resumedNotices = createRenewalNotices({ ...f.noticeOptions, store: createMemoryStore(f.noticeStore.read()) });
  const resumedBilling = createBilling({ ...f.options, notices: resumedNotices });
  f.advance(DAY);
  await resumedBilling.runRenewals();
  assert.equal(f.creates.length, 1);
  assert.equal(f.emails.length, 1);
  assert.equal((await resumedBilling.status('player')).nextPaymentAt, scheduled);
  f.advance(3_600_000);
  await resumedBilling.runRenewals();
  assert.equal(f.creates.length, 2);
  assert.equal(f.emails.length, 1);
  assert.equal(Object.keys(f.noticeStore.read().notices).length, 1);
});

test('cancellation while the notice is being accepted wins before live charge reservation', async () => {
  const f = noticeFixture();
  await f.purchase();
  f.advance(30 * DAY);
  const started = deferred();
  const finish = deferred();
  const send = f.transport.send;
  f.transport.send = async (...args) => { started.resolve(); await finish.promise; return send(...args); };
  const running = f.billing.runRenewals();
  await started.promise;
  await f.billing.cancel('player');
  finish.resolve();
  await running;
  assert.equal(f.creates.length, 1);
  assert.equal(Object.keys(f.store.read().attempts).length, 1);
  const status = await f.billing.status('player');
  assert.equal(status.autoRenew, false);
  assert.equal(status.nextPaymentAt, null);
});

test('cancelling after a postponed renewal clears its scheduled public date', async () => {
  const f = noticeFixture();
  await f.purchase();
  f.advance(31 * DAY);
  await f.billing.runRenewals();
  assert.equal((await f.billing.status('player')).nextPaymentAt > f.now(), true);
  const status = await f.billing.cancel('player');
  assert.equal(status.nextPaymentAt, null);
  const sub = Object.values(f.store.read().subscriptions)[0];
  assert.equal(sub.renewalPaymentAt, null);
  assert.equal(sub.renewalNoticeBinding, null);
  f.advance(2 * DAY);
  await f.billing.runRenewals();
  assert.equal(f.creates.length, 1);
});

test('subscription identity and agreed terms are reread after asynchronous notice delivery', async (t) => {
  const changes = [
    ['email', (sub) => { sub.email = 'different@example.com'; }],
    ['price', (sub) => { sub.plan.amount = '149.00'; }],
    ['expiry', (sub) => { sub.activeUntil += DAY; }],
    ['generation', (sub) => { sub.cancelGeneration += 1; }],
    ['method', (sub) => { sub.savedMethodId = 'different-saved-method'; }],
    ['owner', (sub) => { sub.userId = 'restored-player'; }],
  ];
  for (const [name, change] of changes) await t.test(name, async () => {
    const f = noticeFixture();
    await f.purchase();
    f.advance(30 * DAY);
    f.notices.ensureNotice = async () => {
      const data = f.store.read();
      change(Object.values(data.subscriptions)[0]);
      f.store.write(data);
      return { ready: true, notifiedAt: f.now() - DAY, notBefore: f.now() };
    };
    await f.billing.runRenewals();
    assert.equal(f.creates.length, 1);
    assert.equal(Object.keys(f.store.read().attempts).length, 1);
  });
});

test('live charge validates notice timestamps independently of a ready flag', async () => {
  const f = noticeFixture();
  await f.purchase();
  f.advance(30 * DAY);
  for (const notice of [
    { ready: true, notifiedAt: f.now(), notBefore: f.now() },
    { ready: true, notifiedAt: f.now() + DAY, notBefore: f.now() + 2 * DAY },
    { ready: true, notifiedAt: null, notBefore: f.now() },
    { ready: true, notifiedAt: f.now() - DAY, notBefore: f.now() - 1 },
  ]) {
    f.notices.ensureNotice = async () => notice;
    await f.billing.runRenewals();
    assert.equal(f.creates.length, 1);
  }
});

test('ambiguous SMTP notice acceptance blocks renewal and reports an unconfirmed next payment date', async () => {
  const f = noticeFixture();
  await f.purchase();
  f.advance(30 * DAY);
  let sent = 0;
  f.transport.send = async () => { sent += 1; throw new Error('lost SMTP acknowledgement'); };
  await f.billing.runRenewals();
  f.advance(2 * DAY);
  await f.billing.runRenewals();
  assert.equal(sent, 1);
  assert.equal(f.creates.length, 1);
  assert.equal((await f.billing.status('player')).nextPaymentAt, null);
});

test('a legacy unsent live renewal without notice proof cannot call the payment provider', async () => {
  const f = noticeFixture();
  await f.purchase();
  f.advance(30 * DAY);
  const data = f.store.read();
  const sub = Object.values(data.subscriptions)[0];
  const id = crypto.randomUUID();
  const previous = Object.values(data.attempts)[0];
  const payload = copy(previous.payload);
  delete payload.save_payment_method;
  payload.payment_method_id = sub.savedMethodId;
  payload.metadata.attempt_id = id;
  data.attempts[id] = { ...previous, id, requestId: null, kind: 'renewal',
    state: 'pending', firstSentAt: null, paymentId: null, confirmationUrl: null,
    cancelGeneration: sub.cancelGeneration, savedMethodId: sub.savedMethodId, payload };
  sub.pendingAttemptId = id;
  f.store.write(data);
  await f.billing.runRenewals();
  assert.equal(f.creates.length, 1);
  assert.equal(f.store.read().attempts[id].state, 'canceled');
  assert.equal(f.store.read().attempts[id].errorCode, 'billing_renewal_notice_required');
});

test('test-to-live mode switch never grants test access or charges stored test method', async () => {
  const f = fixture();
  const bought = await f.purchase();
  const live = createBilling({ ...f.options, mode: 'live',
    notices: { configured: true, mode: 'live', async ensureNotice() { throw new Error('test subscription must be ignored'); } } });
  assert.equal((await live.status('player')).active, false);
  assert.equal((await live.status('player')).autoRenew, false);
  await assert.rejects(live.checkout('player', f.request()), { code: 'billing_mode_conflict' });
  f.advance(31 * DAY);
  await live.runRenewals();
  assert.equal(f.creates.length, 1);
  await live.manage({ recoveryCode: bought.recoveryCode, action: 'cancel' });
  assert.equal(Object.values(f.store.read().subscriptions)[0].autoRenew, false);
});

test('cancel during pending renewal clears saved method and never re-enables recurrence', async () => {
  const f = fixture();
  await f.purchase();
  f.advance(30 * DAY);
  const started = deferred();
  const finish = deferred();
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async (...args) => {
    const p = await original(...args);
    started.resolve(p.id);
    await finish.promise;
    f.succeed(p.id);
    return p;
  };
  const running = f.billing.runRenewals();
  await started.promise;
  await f.billing.cancel('player');
  finish.resolve();
  await running;
  const status = await f.billing.status('player');
  assert.equal(status.active, true);
  assert.equal(status.autoRenew, false);
  assert.equal(Object.values(f.store.read().subscriptions)[0].savedMethodId, null);
  f.advance(31 * DAY);
  await f.billing.runRenewals();
  assert.equal(f.creates.length, 2);
});

test('cancel during first purchase preserves paid access but blocks saved-method activation', async () => {
  const f = fixture();
  const c = await f.billing.checkout('player', f.request());
  await f.billing.cancel('player');
  f.succeed(c.paymentId);
  await f.billing.webhook(f.notification(c.paymentId));
  assert.equal((await f.billing.status('player')).autoRenew, false);
  assert.equal((await f.billing.status('player')).active, true);
  await assert.rejects(f.billing.checkout('player', f.request()), { code: 'billing_already_subscribed' });
  f.advance(30 * DAY);
  await f.billing.checkout('player', f.request());
  assert.equal(f.creates.length, 2);
});

test('cancellation after unknown timeout never resubmits potentially new charge', async () => {
  const f = fixture();
  let count = 0;
  f.gateway.createPayment = async () => { count += 1; throw new Error('timeout'); };
  await assert.rejects(f.billing.checkout('player', f.request()));
  await f.billing.cancel('player');
  await createBilling(f.options).runRenewals();
  await f.billing.status('player');
  assert.equal(count, 1);
});

test('failed recurrence stops permanently rather than running decline loops', async () => {
  const f = fixture();
  await f.purchase();
  f.advance(30 * DAY);
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async (...args) => {
    const p = await original(...args);
    f.payments.get(p.id).status = 'canceled';
    return p;
  };
  await f.billing.runRenewals();
  await f.billing.runRenewals();
  assert.equal(f.creates.length, 2);
  assert.equal((await f.billing.status('player')).autoRenew, false);
});

test('recovery transfers access, blocks old owner, rejects collisions and manages without app', async () => {
  const f = fixture();
  const req = f.request();
  const c = await f.billing.checkout('player', req);
  f.succeed(c.paymentId);
  await f.billing.webhook(f.notification(c.paymentId));
  await f.billing.restore('replacement', { recoveryCode: c.recoveryCode });
  assert.equal((await f.billing.status('player')).active, false);
  assert.equal((await f.billing.status('replacement')).active, true);
  await assert.rejects(f.billing.checkout('player', req), { code: 'billing_ownership_changed' });
  await assert.rejects(f.billing.recovery('player'), { code: 'billing_subscription_not_found' });
  await f.purchase('second-player');
  await assert.rejects(f.billing.restore('second-player', { recoveryCode: c.recoveryCode }), { code: 'billing_restore_conflict' });
  const managed = await f.billing.manage({ recoveryCode: c.recoveryCode, action: 'cancel' });
  assert.equal(managed.active, true);
  assert.equal(managed.autoRenew, false);
  assert.equal(managed.email, undefined);
  assert.equal(managed.savedMethodId, undefined);
  f.advance(30 * DAY);
  assert.equal((await f.billing.status('replacement')).active, false);
  assert.equal(JSON.stringify(f.store.read()).includes(c.recoveryCode), false);
});

test('restart preserves saved recovery code; deliberate replacement invalidates it', async () => {
  const f = fixture();
  const req = f.request();
  const c = await f.billing.checkout('player', req);
  const restarted = createBilling(f.options);
  assert.equal((await restarted.checkout('player', req)).recoveryCode, null);
  assert.equal((await restarted.manage({ recoveryCode: c.recoveryCode, action: 'status' })).active, false);
  const replacement = await restarted.recovery('player');
  assert.notEqual(replacement.recoveryCode, c.recoveryCode);
  await assert.rejects(restarted.manage({ recoveryCode: c.recoveryCode, action: 'status' }), { code: 'billing_recovery_not_found' });
  assert.equal((await restarted.manage({ recoveryCode: replacement.recoveryCode, action: 'status' })).active, false);
});

test('full verified refund revokes only unconsumed access once and stops recurring payments', async () => {
  const f = fixture();
  const c = await f.purchase();
  f.advance(10 * DAY);
  f.refunds.set('refund-1', { id: 'refund-1', payment_id: c.paymentId, status: 'succeeded', amount: { value: '99.00', currency: 'RUB' } });
  const body = f.notification('refund-1', 'refund.succeeded', { payment_id: c.paymentId });
  await Promise.all([f.billing.webhook(body), f.billing.webhook(body)]);
  const status = await f.billing.status('player');
  assert.equal(status.active, false);
  assert.equal(status.activeUntil, f.now());
  assert.equal(status.autoRenew, false);
  await f.billing.webhook(f.notification(c.paymentId));
  assert.equal((await f.billing.status('player')).active, false);
  assert.equal(Object.keys(f.store.read().refunds).length, 1);
});

test('two partial refunds proportionally shorten current period without over-revocation', async () => {
  const f = fixture();
  const c = await f.purchase();
  const expiry = (await f.billing.status('player')).activeUntil;
  for (const id of ['partial-1', 'partial-2']) {
    f.refunds.set(id, { id, payment_id: c.paymentId, status: 'succeeded', amount: { value: '24.75', currency: 'RUB' } });
    await f.billing.webhook(f.notification(id, 'refund.succeeded', { payment_id: c.paymentId }));
  }
  assert.equal((await f.billing.status('player')).activeUntil, expiry - 15 * DAY);
  assert.equal((await f.billing.status('player')).autoRenew, false);
});

test('refund of consumed earlier purchase cannot revoke later paid period', async () => {
  const f = fixture();
  const c = await f.purchase();
  f.advance(30 * DAY);
  const original = f.gateway.createPayment;
  f.gateway.createPayment = async (...args) => { const p = await original(...args); f.succeed(p.id); return p; };
  await f.billing.runRenewals();
  const expiry = (await f.billing.status('player')).activeUntil;
  f.refunds.set('old-refund', { id: 'old-refund', payment_id: c.paymentId, status: 'succeeded', amount: { value: '99.00', currency: 'RUB' } });
  await f.billing.webhook(f.notification('old-refund', 'refund.succeeded', { payment_id: c.paymentId }));
  assert.equal((await f.billing.status('player')).activeUntil, expiry);
});

test('forged refund status, unrelated payment and excessive refund amount do not revoke', async () => {
  for (const mutate of [
    (r) => { r.status = 'pending'; },
    (r) => { r.payment_id = 'wrong'; },
    (r) => { r.amount.value = '100.00'; },
    (r) => { r.amount.currency = 'USD'; },
  ]) {
    const f = fixture();
    const c = await f.purchase();
    const refund = { id: 'bad-refund', payment_id: c.paymentId, status: 'succeeded', amount: { value: '99.00', currency: 'RUB' } };
    mutate(refund);
    f.refunds.set(refund.id, refund);
    await assert.rejects(f.billing.webhook(f.notification(refund.id, 'refund.succeeded', { payment_id: c.paymentId })), { code: 'billing_refund_unverified' });
    assert.equal((await f.billing.status('player')).active, true);
  }
});

test('notification lookup abuse bounded before provider retrieval', async () => {
  const f = fixture();
  const c = await f.billing.checkout('player', f.request());
  for (let i = 0; i < 120; i += 1) await f.billing.webhook(f.notification(c.paymentId));
  const before = f.getCount();
  await assert.rejects(f.billing.webhook(f.notification(c.paymentId)), { code: 'billing_notification_rate_limited' });
  assert.equal(f.getCount(), before);
  await assert.rejects(f.billing.webhook(f.notification('../../secret')), { code: 'billing_bad_notification' });
});

test('YooKassa adapter fixes API origin, hosted redirect, capture and idempotency', async () => {
  const calls = [];
  const gateway = createYooKassa({ shopId: '123', secretKey: 'test_private', returnUrl: 'https://slova.example/billing/return',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: 'payment-1' }) }; } });
  const key = crypto.randomUUID();
  await gateway.createPayment({ amount: { value: '99.00', currency: 'RUB' }, capture: false }, key);
  const first = calls[0];
  assert.equal(first.url, 'https://api.yookassa.ru/v3/payments');
  assert.equal(first.options.headers['Idempotence-Key'], key);
  assert.equal(first.options.redirect, 'error');
  assert.equal(first.options.signal instanceof AbortSignal, true);
  assert.equal(first.options.headers.Authorization, `Basic ${Buffer.from('123:test_private').toString('base64')}`);
  const body = JSON.parse(first.options.body);
  assert.equal(body.capture, true);
  assert.equal(body.save_payment_method, true);
  assert.deepEqual(body.confirmation, { type: 'redirect', return_url: 'https://slova.example/billing/return' });
  await gateway.createPayment({ amount: { value: '99.00', currency: 'RUB' }, payment_method_id: 'saved-1' }, crypto.randomUUID());
  assert.equal(JSON.parse(calls[1].options.body).confirmation, undefined);
  await gateway.getPayment('payment-1');
  await gateway.getRefund('refund-1');
  assert.equal(calls[2].url, 'https://api.yookassa.ru/v3/payments/payment-1');
  assert.equal(calls[3].url, 'https://api.yookassa.ru/v3/refunds/refund-1');
  assert.throws(() => gateway.getPayment('../secret'), { code: 'billing_bad_provider_id' });
});

test('YooKassa adapter classifies unknown outcomes and never includes provider secrets in errors', async () => {
  for (const [status, retryable, ambiguous] of [[400, false, false], [401, false, false], [429, true, false], [500, true, true]]) {
    const gateway = createYooKassa({ shopId: '123', secretKey: 'test_private', returnUrl: 'https://slova.example/return',
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ description: 'private secret details' }) }) });
    await assert.rejects(gateway.createPayment({}, crypto.randomUUID()), (error) => {
      assert.equal(error.retryable, retryable);
      assert.equal(error.ambiguous, ambiguous);
      assert.equal(error.message.includes('private'), false);
      return true;
    });
  }
  const gateway = createYooKassa({ shopId: '123', secretKey: 'test_private', returnUrl: 'https://slova.example/return',
    fetchImpl: async () => { throw new Error('secret private timeout'); } });
  await assert.rejects(gateway.createPayment({}, crypto.randomUUID()), { code: 'billing_gateway_unavailable', ambiguous: true });
  await assert.rejects(gateway.getPayment('payment'), { code: 'billing_gateway_unavailable', ambiguous: false });
  assert.throws(() => createYooKassa({ shopId: '123', secretKey: 'test_private', returnUrl: 'http://slova.example' }), { code: 'billing_bad_configuration' });
});

test('YooKassa adapter rejects cross-mode or unknown key prefixes before any request', async () => {
  let requests = 0;
  const config = { shopId: '123', returnUrl: 'https://slova.example/return',
    fetchImpl: async () => { requests += 1; return { ok: true, json: async () => ({ id: 'payment-1' }) }; } };
  for (const [mode, secretKey] of [
    ['test', 'live_private'], ['live', 'test_private'], ['test', 'private'], ['live', 'private'],
    ['test', 'test_'], ['live', 'live_'], ['test', 'test_private\n'], ['live', 'live_private\n'],
  ]) assert.throws(() => createYooKassa({ ...config, mode, secretKey }), { code: 'billing_key_mode_mismatch' });
  assert.equal(requests, 0);
  for (const mode of ['test', 'live']) {
    const gateway = createYooKassa({ ...config, mode, secretKey: `${mode}_private` });
    await gateway.createPayment({}, crypto.randomUUID());
  }
  assert.equal(requests, 2);
});
