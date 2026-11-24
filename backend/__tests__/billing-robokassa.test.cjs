const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createBilling } = require('../runtime/billing.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');
const { createBillingHttp } = require('../runtime/billing-http.cjs');
const { createRobokassa } = require('../runtime/robokassa.cjs');

const DAY = 86_400_000;
function fixture(mode = 'test', extra = {}) {
  let time = Date.parse('2026-10-11T12:00:00Z');
  const store = createMemoryStore({});
  const posts = [];
  const states = new Map();
  const identity = { provider: 'robokassa', merchant: 'slova', mode };
  const gateway = {
    identity, capabilities: { recurring: mode === 'live', refunds: mode === 'live' },
    prepareCheckout(a) { return { invoiceId: a.invoiceId, confirmationUrl: `https://auth.robokassa.ru/Merchant/Index.aspx?InvId=${a.invoiceId}` }; },
    async submitRenewal(a) { posts.push(structuredClone(a)); return { invoiceId: a.invoiceId, status: 'pending' }; },
    async lookupPayment(a) { return states.get(a.invoiceId) ?? { ...identity, invoiceId: a.invoiceId, amountMinor: null, currency: 'RUB', status: 'pending', evidence: mode === 'test' ? 'test_pending' : 'authenticated_status' }; },
    verifyResult(form, a) {
      if (form.SignatureValue !== 'verified') throw Object.assign(new Error('bad signature'), { code: 'billing_bad_signature', status: 400 });
      return { ...identity, invoiceId: form.InvId, amountMinor: Math.round(Number(form.OutSum) * 100), currency: 'RUB', status: 'succeeded', evidence: 'signed_result', operationKey: `op-${a.invoiceId}` };
    },
    async submitRefund(r) { return { requestId: `refund-${r.id}`, status: 'pending' }; },
    async lookupRefund(r) { return { requestId: r.requestId, amountMinor: r.amountMinor, status: 'finished' }; },
  };
  const notices = { configured: true, mode, async ensureNotice(s) { return { ready: time >= s.activeUntil, notifiedAt: s.activeUntil - 3 * DAY, notBefore: s.activeUntil }; }, diagnostics: () => ({ pending: 0, failed: 0, quarantined: 0 }) };
  const options = { provider: 'robokassa', merchantLogin: 'slova', mode, store, gateway, notices, enabled: true, now: () => new Date(time), ...extra };
  const billing = createBilling(options);
  const request = () => ({ requestId: crypto.randomUUID(), email: 'player@example.com', consentVersion: billing.catalog().plan.consentVersion,
    recurringConsented: true, personalDataConsented: true, personalDataConsentVersion: billing.catalog().plan.personalDataConsentVersion,
    provider: 'robokassa', protocol: billing.catalog().protocol, merchantLogin: 'slova', mode });
  const callback = (id) => ({ InvId: id, OutSum: '99.000000', SignatureValue: 'verified' });
  return { store, gateway, notices, options, billing, posts, states, request, callback, advance: (ms) => { time += ms; } };
}

test('Robokassa checkout reserves a durable invoice and reuses it across concurrent calls/restarts', async () => {
  const f = fixture();
  const req = f.request();
  const results = await Promise.all([f.billing.checkout('player', req), f.billing.checkout('player', req), f.billing.checkout('player', f.request())]);
  assert.match(results[0].paymentId, /^[1-9]\d*$/);
  assert.equal(results[0].active, false);
  assert.equal(new Set(results.map((r) => r.paymentId)).size, 1);
  assert.equal((await createBilling(f.options).checkout('player', req)).confirmationUrl, results[0].confirmationUrl);
  assert.equal(f.posts.length, 0);
  assert.equal(Object.keys(f.store.read().attempts).length, 1);
  assert.equal(f.billing.catalog().provider, 'robokassa');
  assert.equal(f.billing.catalog().merchantLogin, 'slova');
});

test('status correlates an owned checkout after a lost response without creating another invoice', async () => {
  const f = fixture('live');
  const request = f.request();
  const checkout = await f.billing.checkout('owner', request);
  const alias = f.request();
  await f.billing.checkout('owner', alias);
  assert.deepEqual((await f.billing.status('owner', request.requestId)).checkoutResolution,
    { requestId: request.requestId, paymentId: checkout.paymentId, state: 'pending' });
  assert.deepEqual((await f.billing.status('owner', alias.requestId)).checkoutResolution,
    { requestId: alias.requestId, paymentId: checkout.paymentId, state: 'pending' });
  await f.billing.result(f.callback(checkout.paymentId));
  const resolved = await f.billing.status('owner', request.requestId);
  assert.equal(resolved.active, true);
  assert.equal(resolved.pendingPaymentId, null);
  assert.deepEqual(resolved.checkoutResolution,
    { requestId: request.requestId, paymentId: checkout.paymentId, state: 'succeeded' });
  assert.equal(Object.keys(f.store.read().attempts).length, 1);
  assert.equal(f.store.read().consentEvents.length, 1);
  assert.equal(f.posts.length, 0);
  assert.equal(Object.hasOwn(await f.billing.status('owner'), 'checkoutResolution'), false);
});

test('status correlation never reveals a foreign or unknown request and rejects malformed IDs', async () => {
  const f = fixture('live');
  const request = f.request();
  await f.billing.checkout('owner', request);
  assert.deepEqual(await f.billing.status('other', request.requestId), await f.billing.status('other', crypto.randomUUID()));
  assert.equal((await f.billing.status('owner', crypto.randomUUID())).checkoutResolution, null);
  for (const id of ['', 'not-a-uuid', '123', {}, null]) {
    await assert.rejects(f.billing.status('owner', id), { code: 'billing_bad_request_id' });
  }
});

test('status correlation validates journal identity and retains cancellation as a terminal result', async () => {
  const f = fixture('live');
  const request = f.request();
  const checkout = await f.billing.checkout('owner', request);
  f.states.set(checkout.paymentId, { provider: 'robokassa', merchant: 'slova', mode: 'live',
    invoiceId: checkout.paymentId, amountMinor: null, currency: 'RUB', status: 'canceled', evidence: 'authenticated_status' });
  assert.equal((await f.billing.status('owner', request.requestId)).checkoutResolution.state, 'canceled');
  const data = f.store.read();
  data.attempts[data.requests[request.requestId]].merchant = 'foreign';
  f.store.write(data);
  await assert.rejects(f.billing.status('owner', request.requestId), { code: 'billing_store_unavailable' });
});

test('checkout records the exact displayed consent and conditions once before returning an invoice', async () => {
  const f = fixture('live');
  const request = f.request();
  const plan = f.billing.catalog().plan;
  assert.equal(plan.consentVersion, 'no-ads-30-robokassa-v3');
  assert.equal(plan.termsVersion, 'no-ads-30-robokassa-v3');
  assert.equal(plan.privacyVersion, 'subscription-privacy-v2');
  assert.equal(plan.consentText, 'Я согласен на автоматические списания согласно условиям оферты');
  assert.equal(plan.userAgreementVersion, 'subscription-user-agreement-v1');
  assert.equal(plan.personalDataConsentVersion, 'subscription-personal-data-v1');
  assert.equal(plan.personalDataConsentText, 'Я согласен на обработку персональных данных');
  const checkout = await f.billing.checkout('owner', request);
  await Promise.all([f.billing.checkout('owner', request), createBilling(f.options).checkout('owner', request)]);
  const data = f.store.read();
  assert.equal(data.consentEvents.length, 1);
  const event = data.consentEvents[0];
  const attempt = Object.values(data.attempts)[0];
  assert.equal(event.type, 'accepted');
  assert.equal(event.source, 'checkout');
  assert.equal(event.userId, 'owner');
  assert.equal(event.subscriptionId, attempt.subscriptionId);
  assert.equal(event.requestId, request.requestId);
  assert.equal(event.attemptId, attempt.id);
  assert.equal(event.timestamp, checkout.serverTime);
  assert.equal(event.consentText, plan.consentText);
  assert.equal(event.consentVersion, plan.consentVersion);
  assert.equal(event.termsVersion, plan.termsVersion);
  assert.equal(event.privacyVersion, plan.privacyVersion);
  assert.equal(event.recurringConsented, true);
  assert.equal(event.personalDataConsented, true);
  assert.equal(event.personalDataConsentVersion, plan.personalDataConsentVersion);
  assert.equal(event.personalDataConsentText, plan.personalDataConsentText);
  assert.equal(event.userAgreementVersion, plan.userAgreementVersion);
  assert.deepEqual(event.plan, { id: plan.id, title: plan.title, amount: '99.00', currency: 'RUB', periodDays: 30 });
  assert.equal(attempt.consentId, event.id);
  assert.equal(Object.values(data.subscriptions)[0].consentId, event.id);
  assert.equal(JSON.stringify(data.consentEvents).includes('player@example.com'), false);
  assert.equal(JSON.stringify(data.consentEvents).includes(checkout.recoveryCode), false);
});

test('new checkout requires both explicit acceptances and their current versions before reserving an invoice', async () => {
  const f = fixture();
  for (const [change, code] of [
    ...[undefined, false, null, 'true', 1].map((value) => [{ recurringConsented: value }, 'billing_consent_required']),
    ...[undefined, false, null, 'true', 1].map((value) => [{ personalDataConsented: value }, 'billing_personal_data_consent_required']),
    ...[undefined, null, 'subscription-personal-data-v0'].map((value) => [{ personalDataConsentVersion: value }, 'billing_personal_data_consent_required']),
    ...[undefined, 'no-ads-30-robokassa-v2', 'unknown'].map((value) => [{ consentVersion: value }, 'billing_consent_required']),
  ]) {
    await assert.rejects(f.billing.checkout('owner', { ...f.request(), ...change }), { code });
    assert.deepEqual(f.store.read(), {});
  }
  const request = f.request();
  await f.billing.checkout('owner', request);
  const accepted = f.store.read();
  await assert.rejects(f.billing.checkout('owner', { ...request, personalDataConsented: false }), { code: 'billing_personal_data_consent_required' });
  assert.deepEqual(f.store.read(), accepted);
  assert.equal(f.posts.length, 0);
});

test('renewal references original consent; cancellation history survives restoration and a new subscription', async () => {
  const f = fixture('live');
  const first = await f.billing.checkout('owner', f.request());
  await f.billing.result(f.callback(first.paymentId));
  const accepted = structuredClone(f.store.read().consentEvents[0]);
  f.advance(30 * DAY);
  await f.billing.runRenewals();
  const renewal = f.posts[0];
  assert.equal(renewal.consentId, accepted.id);
  assert.equal(f.store.read().consentEvents.length, 1);
  await f.billing.result(f.callback(renewal.invoiceId));
  await f.billing.restore('replacement', { recoveryCode: first.recoveryCode });
  const restarted = createBilling(f.options);
  await restarted.cancel('replacement');
  await restarted.manage({ recoveryCode: first.recoveryCode, action: 'cancel' });
  const events = f.store.read().consentEvents;
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], accepted);
  assert.equal(events[1].type, 'canceled');
  assert.equal(events[1].source, 'app');
  assert.equal(events[1].userId, 'replacement');
  assert.equal(events[1].consentId, accepted.id);
  assert.equal(events[1].consentText, accepted.consentText);
  assert.equal(events[1].personalDataConsentText, accepted.personalDataConsentText);
  assert.equal(events[1].personalDataConsentVersion, accepted.personalDataConsentVersion);
  assert.equal(events[1].personalDataConsented, true);
  assert.equal(events[1].cancellationScope, 'recurring');
  f.advance(31 * DAY);
  await restarted.checkout('replacement', f.request());
  const finalEvents = f.store.read().consentEvents;
  assert.equal(finalEvents.length, 3);
  assert.deepEqual(finalEvents.slice(0, 2), events);
  assert.equal(finalEvents[2].type, 'accepted');
  assert.notEqual(finalEvents[2].id, accepted.id);
});

test('published v2 consent history remains readable for callbacks, status, renewals and cancellation without separate PD acceptance', async () => {
  const f = fixture('live');
  const request = f.request();
  const checkout = await f.billing.checkout('owner', request);
  const old = f.store.read();
  const originalWords = 'Я даю согласие на регулярные списания, на обработку персональных данных и принимаю условия публичной оферты';
  const extra = ['recurringConsented', 'personalDataConsented', 'personalDataConsentVersion', 'personalDataConsentText', 'userAgreementVersion'];
  const oldDocuments = { consentVersion: 'no-ads-30-robokassa-v2', consentText: originalWords,
    termsVersion: 'no-ads-30-robokassa-v2', privacyVersion: 'subscription-privacy-v1' };
  for (const item of [...Object.values(old.attempts), ...Object.values(old.subscriptions)]) {
    Object.assign(item.plan, oldDocuments);
    for (const key of extra) delete item.plan[key];
  }
  Object.assign(old.consentEvents[0], oldDocuments);
  for (const key of extra) delete old.consentEvents[0][key];
  const originalEvent = structuredClone(old.consentEvents[0]);
  f.store.write(old);
  const restarted = createBilling(f.options);
  await assert.rejects(restarted.checkout('owner', { ...request, consentVersion: oldDocuments.consentVersion }), { code: 'billing_provider_migration_required' });
  assert.deepEqual(f.store.read(), old);
  await restarted.result(f.callback(checkout.paymentId));
  assert.equal((await restarted.status('owner')).active, true);
  f.advance(30 * DAY);
  await restarted.runRenewals();
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].consentId, originalEvent.id);
  assert.equal(f.posts[0].plan.personalDataConsentVersion, undefined);
  await restarted.cancel('owner');
  const saved = f.store.read();
  assert.deepEqual(saved.consentEvents[0], originalEvent);
  assert.equal(saved.consentEvents[1].personalDataConsented, undefined);
  assert.equal(saved.consentEvents[1].personalDataConsentVersion, undefined);
  assert.equal(saved.consentEvents[1].personalDataConsentText, undefined);
  assert.equal(saved.consentEvents[1].consentText, originalWords);
  assert.equal(saved.nextInvoiceId, old.nextInvoiceId + 2);
});

test('v3 consent facts and separate PD documents are immutable evidence required for payment reconciliation', async () => {
  for (const change of [{ personalDataConsented: false }, { recurringConsented: undefined }, { personalDataConsentText: 'different' },
    { personalDataConsentVersion: 'unknown' }, { userAgreementVersion: 'unknown' }]) {
    const f = fixture();
    const c = await f.billing.checkout('owner', f.request());
    const data = f.store.read();
    Object.assign(data.consentEvents[0], change);
    f.store.write(data);
    const persisted = f.store.read();
    await assert.rejects(f.billing.result(f.callback(c.paymentId)), { code: 'billing_store_unavailable' });
    assert.deepEqual(f.store.read(), persisted);
  }
});

test('cancel before first payment records revocation and a late callback cannot restore consent', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('owner', f.request());
  await f.billing.manage({ recoveryCode: c.recoveryCode, action: 'cancel' });
  await f.billing.result(f.callback(c.paymentId));
  assert.equal((await f.billing.status('owner')).autoRenew, false);
  assert.deepEqual(f.store.read().consentEvents.map((event) => event.type), ['accepted', 'canceled']);
  assert.equal(f.store.read().consentEvents[1].source, 'management');
});

test('legacy version-2 journals preserve old attempts without inventing acceptance of new terms', async () => {
  const f = fixture('live');
  const request = f.request();
  const original = await f.billing.checkout('owner', request);
  const old = f.store.read();
  delete old.consentEvents;
  for (const item of [...Object.values(old.attempts), ...Object.values(old.subscriptions)]) {
    delete item.consentId;
    item.plan.consentVersion = 'no-ads-30-robokassa-v1';
    delete item.plan.consentText;
    delete item.plan.termsVersion;
    delete item.plan.privacyVersion;
    delete item.plan.userAgreementVersion;
    delete item.plan.personalDataConsentVersion;
    delete item.plan.personalDataConsentText;
  }
  f.store.write(old);
  const restarted = createBilling(f.options);
  await assert.rejects(restarted.checkout('owner', { ...request, consentVersion: 'no-ads-30-robokassa-v1' }), { code: 'billing_provider_migration_required' });
  assert.deepEqual(f.store.read(), old);
  await restarted.result(f.callback(original.paymentId));
  assert.deepEqual(f.store.read().consentEvents, []);
  await restarted.cancel('owner');
  assert.equal(f.store.read().consentEvents[0].type, 'canceled');
  assert.equal(f.store.read().consentEvents[0].consentId, null);
  assert.equal(f.store.read().consentEvents[0].consentText, null);
  assert.equal(f.store.read().consentEvents[0].consentVersion, 'no-ads-30-robokassa-v1');
  await assert.rejects(restarted.checkout('new-owner', { ...f.request(), consentVersion: 'no-ads-30-robokassa-v1' }), { code: 'billing_consent_required' });
});

test('legacy pending checkout is quarantined without refreshing its old URL or inventing v2 consent', async () => {
  let network = 0;
  const gateway = createRobokassa({ merchantLogin: 'slova', mode: 'test', testPassword1: 'test_password_one_only', testPassword2: 'test_password_two_only',
    fetchImpl: async () => { network++; throw new Error('network forbidden'); } });
  const f = fixture('test', { gateway });
  const request = f.request();
  const c = await f.billing.checkout('owner', request);
  const old = f.store.read();
  delete old.consentEvents;
  for (const item of [...Object.values(old.attempts), ...Object.values(old.subscriptions)]) {
    delete item.consentId;
    item.plan.consentVersion = 'no-ads-30-robokassa-v1';
    delete item.plan.consentText; delete item.plan.termsVersion; delete item.plan.privacyVersion;
    delete item.plan.userAgreementVersion; delete item.plan.personalDataConsentVersion; delete item.plan.personalDataConsentText;
  }
  const attempt = Object.values(old.attempts)[0];
  attempt.confirmationUrl = `https://auth.robokassa.ru/Merchant/Index.aspx?InvId=${c.paymentId}`;
  const frozen = structuredClone(attempt);
  f.store.write(old);
  await assert.rejects(createBilling(f.options).checkout('owner', { ...request, consentVersion: 'no-ads-30-robokassa-v1' }), { code: 'billing_provider_migration_required' });
  const saved = Object.values(f.store.read().attempts)[0];
  assert.deepEqual(saved, frozen);
  assert.equal(f.store.read().consentEvents, undefined);
  assert.equal(f.store.read().nextInvoiceId, old.nextInvoiceId);
  assert.equal(network, 0);
});

test('corrupt consent history fails closed and changed subscription terms cannot reuse original consent for a renewal', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('owner', f.request());
  await f.billing.result(f.callback(c.paymentId));
  const valid = f.store.read();
  f.store.write({ ...valid, consentEvents: null });
  await assert.rejects(f.billing.status('owner'), { code: 'billing_store_unavailable' });
  assert.equal(f.store.read().consentEvents, null);
  f.store.write(valid);
  f.advance(30 * DAY);
  const changed = f.store.read();
  Object.values(changed.subscriptions)[0].plan.amount = '199.00';
  f.store.write(changed);
  const outcome = await f.billing.runRenewals();
  assert.equal(outcome.failures, 1);
  assert.equal(f.posts.length, 0);
  assert.deepEqual(f.store.read().consentEvents, valid.consentEvents);
});

test('Robokassa rejects legacy/nonmatching journals without rewriting them', async () => {
  for (const data of [{ billingVersion: 1, subscriptions: {}, attempts: {}, requests: {}, payments: {}, refunds: {} }, { subscriptions: { old: { userId: 'player' } } }]) {
    const store = createMemoryStore(data);
    const f = fixture('test', { store });
    await assert.rejects(f.billing.checkout('player', f.request()), { code: 'billing_store_unavailable' });
    assert.deepEqual(store.read(), data);
  }
  const f = fixture();
  await f.billing.checkout('player', f.request());
  const before = f.store.read();
  const other = createBilling({ ...f.options, merchantLogin: 'different', gateway: { ...f.gateway, identity: { ...f.gateway.identity, merchant: 'different' } } });
  await assert.rejects(other.status('player'), { code: 'billing_store_unavailable' });
  assert.deepEqual(f.store.read(), before);
});

test('merchant test and live journals allocate disjoint durable invoice IDs across restarts', async () => {
  const sandbox = fixture('test');
  const live = fixture('live');
  const testIds = [];
  const liveIds = [];
  for (let i = 0; i < 5; i++) {
    const testBilling = createBilling(sandbox.options);
    const liveBilling = createBilling(live.options);
    testIds.push((await testBilling.checkout(`test-${i}`, sandbox.request())).paymentId);
    liveIds.push((await liveBilling.checkout(`live-${i}`, live.request())).paymentId);
  }
  assert.deepEqual(testIds, ['2', '4', '6', '8', '10']);
  assert.deepEqual(liveIds, ['1', '3', '5', '7', '9']);
  assert.equal(new Set([...testIds, ...liveIds]).size, 10);
  assert.equal(sandbox.store.read().nextInvoiceId, 12);
  assert.equal(live.store.read().nextInvoiceId, 11);
});

test('wrong-mode, rewound and overflowing invoice counters fail without rewriting the journal', async () => {
  for (const mutate of [
    (data) => { data.nextInvoiceId = 3; },
    (data) => { data.nextInvoiceId = 2; },
    (data) => { data.nextInvoiceId = Number.MAX_SAFE_INTEGER + 1; },
    (data) => { Object.values(data.attempts)[0].invoiceId = '1'; },
  ]) {
    const f = fixture('test');
    await f.billing.checkout('player', f.request());
    const data = f.store.read();
    mutate(data);
    f.store.write(data);
    await assert.rejects(createBilling(f.options).checkout('other', f.request()), { code: 'billing_store_unavailable' });
    assert.deepEqual(f.store.read(), data);
  }
  const f = fixture('test');
  await f.billing.checkout('player', f.request());
  const data = f.store.read();
  data.nextInvoiceId = Number.MAX_SAFE_INTEGER - 1;
  f.store.write(data);
  await assert.rejects(f.billing.checkout('other', f.request()), { code: 'billing_store_unavailable' });
  assert.deepEqual(f.store.read(), data);
});

test('merchant/protocol/mode request binding is checked before reserving any invoice', async () => {
  const f = fixture();
  for (const wrong of [{ merchantLogin: 'other' }, { mode: 'live' }, { provider: 'yookassa' }, { protocol: undefined }]) {
    await assert.rejects(f.billing.checkout('player', { ...f.request(), ...wrong }), { code: 'billing_provider_migration_required' });
  }
  assert.deepEqual(f.store.read(), {});
});

test('failed journal persistence cannot return a checkout or send a charge', async () => {
  const f = fixture('test', { store: { read: () => ({}), write: () => { throw new Error('private filesystem detail'); } } });
  await assert.rejects(f.billing.checkout('player', f.request()), { code: 'billing_store_unavailable', message: 'billing_store_unavailable' });
  assert.equal(f.posts.length, 0);
});

test('real Robokassa adapter hosted URL and signed sandbox callback interoperate without any network', async () => {
  let calls = 0;
  const password2 = 'test_password_two_only';
  const gateway = createRobokassa({ merchantLogin: 'slova', mode: 'test', testPassword1: 'test_password_one_only', testPassword2: password2,
    fetchImpl: async () => { calls++; throw new Error('network forbidden'); } });
  const f = fixture('test', { gateway });
  const c = await f.billing.checkout('player', f.request());
  const fields = new URL(c.confirmationUrl).searchParams;
  const amount = '99.000000';
  const signature = crypto.createHash('sha256').update(`${amount}:${c.paymentId}:${password2}:Shp_attempt=${fields.get('Shp_attempt')}:Shp_mode=test`).digest('hex');
  await f.billing.result({ InvId: c.paymentId, OutSum: amount, SignatureValue: signature, Shp_attempt: fields.get('Shp_attempt'), Shp_mode: 'test' });
  assert.equal((await f.billing.status('player')).active, true);
  assert.equal(calls, 0);
});

test('signed callbacks grant once, reject mismatches, and test access never dispatches recurring payments', async () => {
  const f = fixture();
  const c = await f.billing.checkout('player', f.request());
  await assert.rejects(f.billing.result({ ...f.callback(c.paymentId), SignatureValue: 'forged' }));
  await assert.rejects(f.billing.result({ ...f.callback(c.paymentId), OutSum: '0.01' }), { code: 'billing_payment_mismatch' });
  await Promise.all(Array.from({ length: 6 }, () => f.billing.result(f.callback(c.paymentId))));
  assert.equal((await f.billing.status('player')).active, true);
  assert.equal(Object.keys(f.store.read().payments).length, 1);
  f.advance(31 * DAY);
  await f.billing.runRenewals();
  assert.equal(f.posts.length, 0);
  assert.equal((await f.billing.status('player')).active, false);
});

test('cancelled checkout can settle but cannot reenable recurring consent', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.cancel('player');
  await f.billing.result(f.callback(c.paymentId));
  const status = await f.billing.status('player');
  assert.equal(status.active, true);
  assert.equal(status.autoRenew, false);
});

test('unknown recurring POST is never replayed after timer ticks or restart', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  f.advance(30 * DAY);
  f.gateway.submitRenewal = async (a) => { f.posts.push(a); throw new Error('unknown outcome with private credentials'); };
  await Promise.all([f.billing.runRenewals(), f.billing.runRenewals()]);
  await createBilling(f.options).runRenewals();
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].previousInvoiceId, c.paymentId);
  assert.equal(f.billing.diagnostics().manualReconciliationPayments, 1);
  await f.billing.cancel('player');
  await f.billing.result(f.callback(f.posts[0].invoiceId));
  assert.equal((await f.billing.status('player')).active, true);
  assert.equal((await f.billing.status('player')).autoRenew, false);
});

test('paused sales reconcile a dispatched renewal using lookup only and never send a new child', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  f.advance(30 * DAY);
  await f.billing.runRenewals();
  const child = f.posts[0];
  assert.equal(f.billing.diagnostics().manualReconciliationPayments, 0);
  f.states.set(child.invoiceId, { ...f.gateway.identity, invoiceId: child.invoiceId, amountMinor: 9900, currency: 'RUB', status: 'succeeded', evidence: 'authenticated_status' });
  const paused = createBilling({ ...f.options, enabled: false });
  await paused.reconcilePending();
  assert.equal((await paused.status('player')).active, true);
  assert.equal(f.posts.length, 1);
});

test('notice race and unavailable notice proof cannot create a charge', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  f.advance(30 * DAY);
  f.notices.ensureNotice = async () => { await f.billing.updateEmail('player', { email: 'new@example.com' }); return { ready: true, notifiedAt: 0, notBefore: 0 }; };
  await f.billing.runRenewals();
  assert.equal(f.posts.length, 0);
  assert.equal(f.billing.diagnostics().pendingPayments, 0);
});

test('a crash before the renewal dispatch marker safely resumes once, but a changed owner cancels the reservation', async () => {
  for (const restore of [false, true]) {
    const f = fixture('live');
    const c = await f.billing.checkout('player', f.request());
    await f.billing.result(f.callback(c.paymentId));
    f.advance(30 * DAY);
    await f.billing.runRenewals();
    const data = f.store.read();
    const child = Object.values(data.attempts).find((a) => a.kind === 'renewal');
    child.firstSentAt = null; // Simulate the persisted reservation before any POST.
    f.store.write(data);
    f.posts.length = 0;
    if (restore) {
      await f.billing.restore('replacement', { recoveryCode: c.recoveryCode });
      f.notices.ensureNotice = async () => ({ ready: false, reason: 'renewal_notice_pending' });
    }
    await createBilling(f.options).runRenewals();
    await createBilling(f.options).runRenewals();
    assert.equal(f.posts.length, restore ? 0 : 1);
    if (restore) assert.equal(f.store.read().attempts[child.id].state, 'canceled');
  }
});

test('notice proof cannot authorize a charge before the independently checked 24-hour lead', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  f.advance(30 * DAY);
  const now = (await f.billing.status('player')).serverTime;
  f.notices.ensureNotice = async () => ({ ready: true, notifiedAt: now, notBefore: now });
  await f.billing.runRenewals();
  assert.equal(f.posts.length, 0);
});

test('signed callbacks remain valid after paused sales and late success after provider cancellation grants only once', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  f.states.set(c.paymentId, { ...f.gateway.identity, invoiceId: c.paymentId, amountMinor: null, currency: 'RUB', status: 'canceled', evidence: 'authenticated_status' });
  await f.billing.status('player');
  const paused = createBilling({ ...f.options, enabled: false });
  await paused.result(f.callback(c.paymentId));
  await paused.result(f.callback(c.paymentId));
  assert.equal((await paused.status('player')).active, true);
  assert.equal(Object.keys(f.store.read().payments).length, 1);
});

test('restore moves ownership while cancellation and email preserve paid time', async () => {
  const f = fixture('live');
  const req = f.request();
  const c = await f.billing.checkout('player', req);
  await assert.rejects(f.billing.updateEmail('player', { email: 'new@example.com' }), { code: 'billing_email_change_pending' });
  await f.billing.result(f.callback(c.paymentId));
  const until = (await f.billing.status('player')).activeUntil;
  await f.billing.restore('replacement', { recoveryCode: c.recoveryCode });
  await assert.rejects(f.billing.checkout('player', req), { code: 'billing_ownership_changed' });
  assert.equal((await f.billing.status('player', req.requestId)).checkoutResolution, null);
  assert.equal((await f.billing.status('replacement', req.requestId)).checkoutResolution.paymentId, c.paymentId);
  await f.billing.updateEmail('replacement', { email: 'new@example.com' });
  await f.billing.manage({ recoveryCode: c.recoveryCode, action: 'cancel' });
  assert.equal((await f.billing.status('replacement')).activeUntil, until);
  assert.equal((await f.billing.status('player')).active, false);
  assert.equal(JSON.stringify(f.store.read()).includes(c.recoveryCode), false);
});

test('refund acceptance alone does not revoke access and confirmed partial refunds apply once', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  const before = (await f.billing.status('player')).activeUntil;
  const request = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
  assert.equal((await f.billing.status('player')).activeUntil, before);
  assert.equal(f.billing.diagnostics().manualReceiptCorrections, 0);
  await f.billing.reconcileRefund(request.id);
  await f.billing.reconcileRefund(request.id);
  assert.equal((await f.billing.status('player')).activeUntil, before - 15 * DAY);
  assert.equal((await f.billing.status('player')).autoRenew, false);
  assert.equal(f.store.read().consentEvents.at(-1).source, 'refund');
  assert.equal(f.store.read().refunds[request.id].state, 'finished');
  const correction = f.store.read().payments[c.paymentId].receiptCorrection;
  assert.equal(correction.state, 'manual_replacement_required');
  assert.equal(correction.remainingMinor, 4950);
  assert.equal(correction.refundedMinor, 4950);
  assert.equal(correction.originalReceiptStatus, 'annulment_expected');
  assert.equal(f.billing.diagnostics().manualReceiptCorrections, 1);
});

test('partial refund receipt task survives restart and only exact operator evidence closes it idempotently', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  const refund = await f.billing.requestRefund(c.paymentId, 2475, crypto.randomUUID());
  await f.billing.reconcileRefund(refund.id);
  const restarted = createBilling(f.options);
  assert.equal(restarted.diagnostics().manualReceiptCorrections, 1);
  const evidence = { expectedRefundedMinor: 2475, remainingMinor: 7425, action: 'replacement_issued',
    receiptRef: 'corrected-receipt-1', annulledReceiptRefs: [], evidenceRef: 'review/receipt-1' };
  await assert.rejects(restarted.acknowledgeReceiptCorrection(c.paymentId, { ...evidence, expectedRefundedMinor: 4950 }), { code: 'billing_receipt_correction_conflict' });
  await assert.rejects(restarted.acknowledgeReceiptCorrection(c.paymentId, { ...evidence, remainingMinor: 9900 }), { code: 'billing_receipt_correction_conflict' });
  await restarted.acknowledgeReceiptCorrection(c.paymentId, evidence);
  const once = f.store.read();
  await createBilling(f.options).acknowledgeReceiptCorrection(c.paymentId, evidence);
  assert.deepEqual(f.store.read(), once);
  assert.equal(restarted.diagnostics().manualReceiptCorrections, 0);
  assert.equal(once.payments[c.paymentId].receiptCorrection.state, 'operator_confirmed');
  assert.equal(once.payments[c.paymentId].receiptCorrectionHistory[0].source, 'operator');
  assert.equal(once.payments[c.paymentId].receiptStatus, 'awaiting_provider_receipt');
  assert.equal(f.posts.length, 0);
});

test('another partial refund changes residual amount and requires annulment of an earlier manual replacement', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  const first = await f.billing.requestRefund(c.paymentId, 2475, crypto.randomUUID());
  await f.billing.reconcileRefund(first.id);
  await f.billing.acknowledgeReceiptCorrection(c.paymentId, { expectedRefundedMinor: 2475, remainingMinor: 7425, action: 'replacement_issued',
    receiptRef: 'replacement-1', annulledReceiptRefs: [], evidenceRef: 'review/first' });
  const second = await f.billing.requestRefund(c.paymentId, 2475, crypto.randomUUID());
  await f.billing.reconcileRefund(second.id);
  const correction = f.store.read().payments[c.paymentId].receiptCorrection;
  assert.equal(correction.remainingMinor, 4950);
  assert.equal(f.billing.diagnostics().manualReceiptCorrections, 1);
  const evidence = { expectedRefundedMinor: 4950, remainingMinor: 4950, action: 'replacement_issued',
    receiptRef: 'replacement-2', annulledReceiptRefs: [], evidenceRef: 'review/second' };
  await assert.rejects(f.billing.acknowledgeReceiptCorrection(c.paymentId, evidence), { code: 'billing_receipt_correction_conflict' });
  await f.billing.acknowledgeReceiptCorrection(c.paymentId, { ...evidence, annulledReceiptRefs: ['replacement-1'] });
  assert.equal(f.billing.diagnostics().manualReceiptCorrections, 0);
  assert.equal(f.store.read().payments[c.paymentId].receiptCorrectionHistory.length, 2);
});

test('full refund after partial stays manual until replacement cancellation or verified absence is recorded', async () => {
  for (const acknowledged of [false, true]) {
    const f = fixture('live');
    const c = await f.billing.checkout('player', f.request());
    await f.billing.result(f.callback(c.paymentId));
    const first = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
    await f.billing.reconcileRefund(first.id);
    if (acknowledged) await f.billing.acknowledgeReceiptCorrection(c.paymentId, { expectedRefundedMinor: 4950, remainingMinor: 4950,
      action: 'replacement_issued', receiptRef: 'replacement-1', annulledReceiptRefs: [], evidenceRef: 'review/partial' });
    const final = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
    await f.billing.reconcileRefund(final.id);
    const restarted = createBilling(f.options);
    assert.equal(restarted.diagnostics().manualReceiptCorrections, 1);
    assert.equal(f.store.read().payments[c.paymentId].receiptCorrection.state, 'manual_annulment_review_required');
    assert.equal(f.store.read().payments[c.paymentId].receiptCorrection.remainingMinor, 0);
    const none = { expectedRefundedMinor: 9900, remainingMinor: 0, action: 'no_replacement_issued', receiptRef: null,
      annulledReceiptRefs: [], evidenceRef: 'review/full' };
    if (acknowledged) {
      await assert.rejects(restarted.acknowledgeReceiptCorrection(c.paymentId, none), { code: 'billing_receipt_correction_conflict' });
      await restarted.acknowledgeReceiptCorrection(c.paymentId, { ...none, action: 'replacements_annulled', annulledReceiptRefs: ['replacement-1'] });
    } else await restarted.acknowledgeReceiptCorrection(c.paymentId, none);
    assert.equal(restarted.diagnostics().manualReceiptCorrections, 0);
  }
});

test('old confirmed refund journals are diagnosed without inventing receipts; direct full refund only expects provider annulment', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  const partial = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
  await f.billing.reconcileRefund(partial.id);
  const old = f.store.read();
  delete old.payments[c.paymentId].receiptCorrection;
  f.store.write(old);
  assert.equal(createBilling(f.options).diagnostics().manualReceiptCorrections, 1);
  assert.deepEqual(f.store.read(), old);
  const remainder = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
  await f.billing.reconcileRefund(remainder.id);
  const oldFull = f.store.read();
  delete oldFull.payments[c.paymentId].receiptCorrection;
  f.store.write(oldFull);
  assert.equal(createBilling(f.options).diagnostics().manualReceiptCorrections, 1);
  assert.deepEqual(f.store.read(), oldFull);
  const full = fixture('live');
  const paid = await full.billing.checkout('player', full.request());
  await full.billing.result(full.callback(paid.paymentId));
  const request = await full.billing.requestRefund(paid.paymentId, 9900, crypto.randomUUID());
  await full.billing.reconcileRefund(request.id);
  assert.equal(full.billing.diagnostics().manualReceiptCorrections, 0);
  assert.equal(full.store.read().payments[paid.paymentId].receiptCorrection.state, 'provider_annulment_expected');
});

test('refund settlement and manual receipt task are committed atomically across a failed write', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  const refund = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
  const before = f.store.read();
  const write = f.store.write;
  f.store.write = () => { throw new Error('disk unavailable'); };
  await assert.rejects(f.billing.reconcileRefund(refund.id), { code: 'billing_store_unavailable' });
  assert.deepEqual(f.store.read(), before);
  assert.equal(f.billing.diagnostics().manualReceiptCorrections, 0);
  f.store.write = write;
  const restarted = createBilling(f.options);
  await restarted.reconcileRefund(refund.id);
  await restarted.reconcileRefund(refund.id);
  assert.equal(f.store.read().payments[c.paymentId].refundedMinor, 4950);
  assert.equal(restarted.diagnostics().manualReceiptCorrections, 1);
});

test('canceled refunds never create fiscal correction tasks and malformed operator proof cannot hide one', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  const original = f.gateway.lookupRefund;
  f.gateway.lookupRefund = async (refund) => ({ ...await original(refund), status: 'canceled' });
  const canceled = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
  await f.billing.reconcileRefund(canceled.id);
  assert.equal(f.billing.diagnostics().manualReceiptCorrections, 0);
  f.gateway.lookupRefund = original;
  const partial = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
  await f.billing.reconcileRefund(partial.id);
  await f.billing.acknowledgeReceiptCorrection(c.paymentId, { expectedRefundedMinor: 4950, remainingMinor: 4950,
    action: 'replacement_issued', receiptRef: 'replacement', annulledReceiptRefs: [], evidenceRef: 'review/correction' });
  const valid = f.store.read();
  for (const corrupt of [{ invoiceId: '999' }, { recordedAt: null }, { receiptRef: null }, { action: 'no_replacement_issued' }]) {
    const data = structuredClone(valid);
    Object.assign(data.payments[c.paymentId].receiptCorrectionHistory[0], corrupt);
    f.store.write(data);
    assert.throws(() => f.billing.diagnostics(), { code: 'billing_store_unavailable' });
  }
});

test('unknown refund creation is durable and cannot be resubmitted or over-refunded', async () => {
  const f = fixture('live');
  const c = await f.billing.checkout('player', f.request());
  await f.billing.result(f.callback(c.paymentId));
  let calls = 0;
  f.gateway.submitRefund = async () => { calls++; throw new Error('timeout'); };
  const id = crypto.randomUUID();
  await assert.rejects(f.billing.requestRefund(c.paymentId, 9900, id));
  assert.equal((await createBilling(f.options).requestRefund(c.paymentId, 9900, id)).state, 'unknown');
  await assert.rejects(f.billing.requestRefund(c.paymentId, 9900, crypto.randomUUID()), { code: 'billing_refund_amount_mismatch' });
  assert.equal(calls, 1);
  assert.equal((await f.billing.status('player')).active, true);
  assert.equal(f.billing.diagnostics().manualReconciliationRefunds, 1);
  assert.equal(f.billing.diagnostics().manualReceiptCorrections, 0);
});

test('refund verification cannot revoke unrelated or unconfirmed payment amounts', async () => {
  for (const changed of [{ requestId: 'unrelated' }, { amountMinor: 9900 }]) {
    const f = fixture('live');
    const c = await f.billing.checkout('player', f.request());
    await f.billing.result(f.callback(c.paymentId));
    const before = (await f.billing.status('player')).activeUntil;
    const r = await f.billing.requestRefund(c.paymentId, 4950, crypto.randomUUID());
    const original = f.gateway.lookupRefund;
    f.gateway.lookupRefund = async (request) => ({ ...await original(request), ...changed });
    await assert.rejects(f.billing.reconcileRefund(r.id), { code: 'billing_refund_unverified' });
    assert.equal((await f.billing.status('player')).activeUntil, before);
  }
});

test('old client protocol cannot see available sales or create invoices; ResultURL is form-only and duplicate-safe', async () => {
  const f = fixture();
  const http = createBillingHttp({ billing: f.billing });
  assert.equal(JSON.parse((await http.handlePublic({ url: '/api/billing/catalog' })).body).available, false);
  assert.equal((await http.handleUser({ method: 'POST', url: '/api/billing/checkout', body: JSON.stringify(f.request()) }, 'player')).status, 409);
  assert.deepEqual(f.store.read(), {});
  const headers = { 'x-slova-billing-protocol': 'robokassa-v3' };
  assert.equal(JSON.parse((await http.handlePublic({ url: '/api/billing/catalog', headers: { 'x-slova-billing-protocol': 'robokassa-v2' } })).body).available, false);
  assert.equal((await http.handleUser({ method: 'POST', url: '/api/billing/checkout', body: JSON.stringify(f.request()),
    headers: { 'x-slova-billing-protocol': 'robokassa-v2' } }, 'player')).status, 409);
  assert.equal(JSON.parse((await http.handlePublic({ url: '/api/billing/catalog', headers: { 'x-slova-billing-protocol': 'robokassa-v1' } })).body).available, false);
  assert.equal((await http.handleUser({ method: 'POST', url: '/api/billing/checkout', body: JSON.stringify(f.request()),
    headers: { 'x-slova-billing-protocol': 'robokassa-v1' } }, 'player')).status, 409);
  assert.equal(JSON.parse((await http.handlePublic({ url: '/api/billing/catalog', headers })).body).available, true);
  const c = await f.billing.checkout('player', f.request());
  const body = new URLSearchParams(f.callback(c.paymentId)).toString();
  const req = { method: 'POST', url: '/api/billing/robokassa/result', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body };
  assert.equal((await http.handlePublic({ ...req, body: `${body}&InvId=${c.paymentId}` })).status, 400);
  const result = await http.handlePublic(req);
  assert.equal(result.body, `OK${c.paymentId}`);
  assert.match(result.headers['content-type'], /text\/plain/);
});

test('Robokassa terms expose seller, price, cancellation, SMZ receipt provider and the actual RuStore card', async () => {
  const f = fixture();
  const http = createBillingHttp({ billing: f.billing, seller: { name: 'Тестовый продавец', inn: '123456789012', email: 'support@example.com' } });
  const terms = await http.handlePublic({ method: 'GET', url: '/api/billing/terms' });
  for (const value of ['99.00', '30 дней', 'Тестовый продавец', 'support@example.com', 'Robokassa', 'Робочеки СМЗ',
    'https://www.rustore.ru/catalog/app/com.intstrfloat.slova', 'возврат', 'Отключить']) assert.ok(terms.body.includes(value), value);
});
