const test = require('node:test');
const assert = require('node:assert/strict');
const { createRenewalNotices, noticeError } = require('../runtime/renewal-notices.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');

const HOUR = 3_600_000;
const START = Date.parse('2026-10-05T12:00:00Z');
const OPTIONS = { sender: 'Слова <billing@example.com>', supportEmail: 'support@example.com', publicBase: 'https://slova.example.com' };
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(extra = {}) {
  let time = START;
  const store = createMemoryStore({});
  const sends = [];
  const transport = { mode: 'test', idempotencyWindowMs: 23 * HOUR,
    async send(message, key) { sends.push({ message: copy(message), key }); return { id: 'provider-email-id' }; } };
  const sub = { id: 'subscription-id', userId: 'private-user', email: 'player@example.com', mode: 'test',
    activeUntil: time + 72 * HOUR, autoRenew: true, savedMethodId: 'private-payment-method',
    recoveryHash: 'private-recovery-hash', recoveryCode: 'private-raw-recovery', cancelGeneration: 0,
    plan: { id: 'no_ads_30', title: 'Без рекламных пауз', amount: '99.00', currency: 'RUB', periodDays: 30, consentVersion: 'no-ads-30-v1' } };
  const options = { ...OPTIONS, store, transport, now: () => time, ...extra };
  return { sub, store, transport, options, sends, notices: createRenewalNotices(options),
    advance: (ms) => { time += ms; }, time: () => time };
}

test('sends at the 72h boundary, persists before sending, and blocks a charge until its due date', async () => {
  const f = fixture();
  const originalSend = f.transport.send;
  f.transport.send = async (message, key) => {
    const record = Object.values(f.store.read().notices)[0];
    assert.equal(record.state, 'sending');
    assert.equal(record.firstSentAt, f.time());
    assert.equal(record.providerKey, key);
    return originalSend(message, key);
  };
  f.sub.activeUntil += 1;
  assert.equal((await f.notices.ensureNotice(f.sub)).reason, 'renewal_notice_too_early');
  assert.equal(f.sends.length, 0);
  f.advance(1);
  const notice = await f.notices.ensureNotice(f.sub);
  assert.deepEqual(notice, { ready: false, notifiedAt: START + 1, notBefore: f.sub.activeUntil, reason: 'renewal_notice_waiting' });
  f.advance(24 * HOUR);
  assert.equal((await f.notices.ensureNotice(f.sub)).ready, false);
  f.advance(48 * HOUR);
  assert.equal((await f.notices.ensureNotice(f.sub)).ready, true);
  assert.equal(f.sends.length, 1);
});

test('late notification freezes a future date with a 24h lead plus 1h margin', async () => {
  const f = fixture();
  f.sub.activeUntil = f.time() - HOUR;
  const notice = await f.notices.ensureNotice(f.sub);
  assert.equal(notice.notBefore, f.time() + 25 * HOUR);
  assert.match(f.sends[0].message.text, /06\.10\.2026, 16:00/);
  f.advance(25 * HOUR - 1);
  assert.equal((await f.notices.ensureNotice(f.sub)).ready, false);
  f.advance(1);
  assert.equal((await f.notices.ensureNotice(f.sub)).ready, true);
});

test('concurrent calls across service instances share one dispatch', async () => {
  const f = fixture();
  const pending = deferred();
  f.transport.send = async (message, key) => { f.sends.push({ message, key }); await pending.promise; return { id: 'accepted-id' }; };
  const second = createRenewalNotices(f.options);
  const tasks = [f.notices.ensureNotice(f.sub), second.ensureNotice(f.sub), f.notices.ensureNotice(copy(f.sub))];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.sends.length, 1);
  pending.resolve();
  const outcomes = await Promise.all(tasks);
  assert.deepEqual(outcomes[0], outcomes[1]);
  assert.deepEqual(outcomes[1], outcomes[2]);
});

test('accepted notice survives restart and the provider key expiry without another email', async () => {
  const f = fixture();
  await f.notices.ensureNotice(f.sub);
  const restarted = createRenewalNotices({ ...f.options, store: createMemoryStore(f.store.read()) });
  f.advance(72 * HOUR);
  assert.deepEqual(await restarted.ensureNotice(f.sub), { ready: true, notifiedAt: START, notBefore: f.sub.activeUntil });
  assert.equal(f.sends.length, 1);
});

test('ambiguous acceptance is retried after restart with exactly the frozen key and payload', async () => {
  const f = fixture();
  const accepted = new Map();
  f.transport.send = async (message, key) => {
    f.sends.push({ message: copy(message), key });
    if (!accepted.has(key)) {
      accepted.set(key, copy(message));
      throw new Error('timeout contains private credentials and player@example.com');
    }
    assert.deepEqual(message, accepted.get(key));
    return { id: 'already-accepted-email' };
  };
  assert.equal((await f.notices.ensureNotice(f.sub)).reason, 'renewal_notice_gateway_unavailable');
  assert.equal((await f.notices.ensureNotice(f.sub)).ready, false);
  assert.equal(f.sends.length, 1);
  const restartedStore = createMemoryStore(f.store.read());
  // Configuration changes must not change the payload of an idempotent retry.
  const restarted = createRenewalNotices({ ...f.options, store: restartedStore, supportEmail: 'new-support@example.com' });
  f.advance(60_000);
  const outcome = await restarted.ensureNotice(f.sub);
  assert.equal(outcome.notifiedAt, START + 60_000);
  assert.equal(f.sends[0].key, f.sends[1].key);
  assert.deepEqual(f.sends[0].message, f.sends[1].message);
  assert.equal(accepted.size, 1);
});

test('a crash after dispatch but before acknowledgement remains recoverable with the same key', async () => {
  const f = fixture();
  await f.notices.ensureNotice(f.sub);
  const data = f.store.read();
  const record = Object.values(data.notices)[0];
  record.state = 'sending';
  record.notifiedAt = null;
  record.providerId = null;
  const restarted = createRenewalNotices({ ...f.options, store: createMemoryStore(data) });
  f.advance(5 * HOUR);
  assert.equal((await restarted.ensureNotice(f.sub)).notifiedAt, START + 5 * HOUR);
  assert.equal(f.sends[0].key, f.sends[1].key);
  assert.deepEqual(f.sends[0].message, f.sends[1].message);
});

test('unknown outcome is quarantined at the bounded retry window and never resent with a fresh key', async () => {
  const f = fixture();
  f.transport.send = async () => { f.sends.push({}); throw new Error('timeout'); };
  await f.notices.ensureNotice(f.sub);
  f.advance(23 * HOUR);
  const restarted = createRenewalNotices({ ...f.options, store: createMemoryStore(f.store.read()) });
  assert.equal((await restarted.ensureNotice(f.sub)).reason, 'renewal_notice_manual_reconciliation_required');
  f.advance(100 * HOUR);
  assert.equal((await restarted.ensureNotice(f.sub)).ready, false);
  assert.equal(f.sends.length, 1);
});

test('transport without idempotency quarantines ambiguous send outcomes immediately', async () => {
  const f = fixture();
  f.transport.idempotencyWindowMs = 0;
  f.transport.send = async () => { f.sends.push({}); throw new Error('SMTP connection lost after DATA'); };
  const notices = createRenewalNotices(f.options);
  assert.equal(notices.configured, true);
  assert.equal((await notices.ensureNotice(f.sub)).reason, 'renewal_notice_manual_reconciliation_required');
  const restarted = createRenewalNotices({ ...f.options, store: createMemoryStore(f.store.read()) });
  f.advance(73 * HOUR);
  assert.equal((await restarted.ensureNotice(f.sub)).ready, false);
  assert.equal(f.sends.length, 1);
});

test('transport without idempotency cannot resend a persisted sending record after a crash', async () => {
  const f = fixture();
  f.transport.idempotencyWindowMs = 0;
  await f.notices.ensureNotice(f.sub);
  const data = f.store.read();
  const record = Object.values(data.notices)[0];
  record.state = 'sending';
  record.notifiedAt = null;
  record.providerId = null;
  const restarted = createRenewalNotices({ ...f.options, store: createMemoryStore(data) });
  assert.equal((await restarted.ensureNotice(f.sub)).reason, 'renewal_notice_manual_reconciliation_required');
  assert.equal(f.sends.length, 1);
});

test('transport without idempotency may retry only a definite rejection with no accepted outcome', async () => {
  const f = fixture();
  f.transport.idempotencyWindowMs = 0;
  const send = f.transport.send;
  let once = true;
  f.transport.send = async (message, key) => {
    if (once) { once = false; f.sends.push({ message, key }); throw noticeError('renewal_notice_gateway_unavailable', { retryable: true }); }
    return send(message, key);
  };
  const notices = createRenewalNotices(f.options);
  assert.equal((await notices.ensureNotice(f.sub)).ready, false);
  f.advance(60_000);
  assert.equal((await notices.ensureNotice(f.sub)).notifiedAt, f.time());
  assert.equal(f.sends[0].key, f.sends[1].key);
});

test('delayed acceptance extends the lead period without generating a fresh notice', async () => {
  const f = fixture();
  f.sub.activeUntil = START;
  f.transport.send = async () => { f.advance(2 * HOUR); return { id: 'slow-accepted-id' }; };
  const notice = await f.notices.ensureNotice(f.sub);
  assert.equal(notice.notBefore, START + 26 * HOUR);
  assert.equal(Object.values(f.store.read().notices)[0].scheduledAt, START + 25 * HOUR);
  f.advance(24 * HOUR);
  assert.equal((await f.notices.ensureNotice(f.sub)).ready, true);
  assert.equal(Object.keys(f.store.read().notices).length, 1);
});

test('definitive failure blocks charging and repeated dispatch', async () => {
  const f = fixture();
  f.transport.send = async () => { f.sends.push({}); throw noticeError('renewal_notice_gateway_rejected'); };
  const failed = await f.notices.ensureNotice(f.sub);
  assert.deepEqual(failed, { ready: false, notifiedAt: null, notBefore: null, reason: 'renewal_notice_gateway_rejected' });
  f.advance(73 * HOUR);
  assert.equal((await f.notices.ensureNotice(f.sub)).ready, false);
  assert.equal(f.sends.length, 1);
});

test('a retryable definite rejection reuses the durable key after its retry delay', async () => {
  const f = fixture();
  const send = f.transport.send;
  let once = true;
  f.transport.send = async (message, key) => {
    if (once) { once = false; f.sends.push({ message: copy(message), key }); throw noticeError('renewal_notice_gateway_unavailable', { retryable: true }); }
    return send(message, key);
  };
  await f.notices.ensureNotice(f.sub);
  f.advance(60_000);
  assert.equal((await f.notices.ensureNotice(f.sub)).notifiedAt, f.time());
  assert.equal(f.sends[0].key, f.sends[1].key);
});

test('changed due date, plan terms, cancellation generation or recipient revoke previous eligibility', async (t) => {
  const changes = [
    ['due date', (sub) => { sub.activeUntil += HOUR; }],
    ['amount', (sub) => { sub.plan.amount = '149.00'; }],
    ['period', (sub) => { sub.plan.periodDays = 60; }],
    ['terms', (sub) => { sub.plan.consentVersion = 'no-ads-30-v2'; }],
    ['generation', (sub) => { sub.cancelGeneration += 1; }],
    ['email', (sub) => { sub.email = 'other@example.com'; }],
  ];
  for (const [name, change] of changes) await t.test(name, async () => {
    const f = fixture();
    await f.notices.ensureNotice(f.sub);
    f.advance(72 * HOUR);
    change(f.sub);
    const outcome = await f.notices.ensureNotice(f.sub);
    assert.equal(outcome.ready, false);
    assert.equal(outcome.notifiedAt, f.time());
    assert.equal(outcome.notBefore, f.time() + 25 * HOUR);
    assert.equal(f.sends.length, 2);
    assert.notEqual(f.sends[0].key, f.sends[1].key);
  });
});

test('cancelled subscriptions and a cancellation during sending never qualify for charging', async () => {
  const f = fixture();
  f.sub.autoRenew = false;
  assert.equal((await f.notices.ensureNotice(f.sub)).reason, 'renewal_notice_cancelled');
  assert.equal(f.sends.length, 0);
  f.sub.autoRenew = true;
  f.transport.send = async () => { f.sub.autoRenew = false; f.sub.cancelGeneration += 1; return { id: 'email-id' }; };
  assert.equal((await f.notices.ensureNotice(f.sub)).reason, 'renewal_notice_subscription_changed');
});

test('missing configuration or a test/live mismatch cannot dispatch email', async () => {
  const f = fixture();
  const cases = [
    { transport: undefined }, { supportEmail: undefined }, { sender: undefined }, { publicBase: 'http://unsafe.example.com' },
    { transport: { ...f.transport, mode: 'live' } }, { mode: 'live' }, { transport: { ...f.transport, mode: undefined } },
  ];
  for (const extra of cases) {
    const notices = createRenewalNotices({ ...f.options, ...extra });
    assert.equal(notices.configured, false);
    assert.equal((await notices.ensureNotice(f.sub)).ready, false);
  }
  const testService = createRenewalNotices({ ...f.options, transport: { ...f.transport, mode: 'live' } });
  assert.equal((await testService.ensureNotice(f.sub)).reason, 'renewal_notice_mode_mismatch');
  assert.equal(f.sends.length, 0);
});

test('live mode works only with a transport explicitly declaring live', async () => {
  const f = fixture({ mode: 'live' });
  f.sub.mode = 'live';
  f.transport.mode = 'live';
  const notices = createRenewalNotices(f.options);
  assert.equal(notices.configured, true);
  assert.equal((await notices.ensureNotice(f.sub)).notifiedAt, START);
});

test('Russian message states agreed terms, Moscow date and recovery instructions without exposing secrets', async () => {
  const f = fixture();
  await f.notices.ensureNotice(f.sub);
  const { message, key } = f.sends[0];
  assert.match(message.text, /Без рекламных пауз/);
  assert.match(message.text, /99\.00 RUB за 30 дней/);
  assert.match(message.text, /08\.10\.2026, 15:00/);
  assert.match(message.text, /https:\/\/slova\.example\.com\/api\/billing\/manage/);
  assert.match(message.text, /сохранённый код восстановления/);
  assert.match(message.text, /support@example\.com/);
  assert.equal(message.html, undefined);
  assert.match(key, /^renewal\/[a-f0-9]{64}$/);
  const serialized = JSON.stringify({ stored: f.store.read(), sent: f.sends });
  for (const secret of [f.sub.savedMethodId, f.sub.recoveryHash, f.sub.recoveryCode, f.sub.userId]) assert.equal(serialized.includes(secret), false);
});

test('header injection, malformed terms and invalid mode are rejected before dispatch', async () => {
  const f = fixture();
  for (const change of [
    (sub) => { sub.email = 'player@example.com\r\nBcc: someone@example.com'; },
    (sub) => { sub.plan.title = 'Title\nInjected'; },
    (sub) => { sub.plan.amount = 'NaN'; },
    (sub) => { sub.plan.currency = 'USD'; },
    (sub) => { sub.cancelGeneration = -1; },
    (sub) => { sub.activeUntil = Number.MAX_SAFE_INTEGER; },
  ]) {
    const sub = copy(f.sub);
    change(sub);
    assert.equal((await f.notices.ensureNotice(sub)).reason, 'renewal_notice_invalid_subscription');
  }
  assert.throws(() => createRenewalNotices({ ...f.options, mode: 'invalid' }), { code: 'renewal_notice_bad_configuration' });
  assert.throws(() => createRenewalNotices({ ...f.options, minimumLeadMs: HOUR }), { code: 'renewal_notice_bad_configuration' });
  assert.equal(f.sends.length, 0);
});

test('unavailable or corrupt strict storage cannot send or fabricate an accepted notice', async () => {
  const f = fixture();
  for (const store of [
    { read: () => { throw new Error('sensitive path'); }, write() {} },
    { read: () => ({ notices: [] }), write() {} },
    { read: () => ({ noticeVersion: 1 }), write() {} },
    { read: () => ({}), write: () => { throw new Error('sensitive file'); } },
  ]) {
    const notices = createRenewalNotices({ ...f.options, store });
    await assert.rejects(notices.ensureNotice(f.sub), { code: 'renewal_notice_store_unavailable', message: 'renewal_notice_store_unavailable' });
  }
  assert.equal(f.sends.length, 0);
  await f.notices.ensureNotice(f.sub);
  const data = f.store.read();
  Object.values(data.notices)[0].notifiedAt = null;
  const corrupt = createRenewalNotices({ ...f.options, store: createMemoryStore(data) });
  await assert.rejects(corrupt.ensureNotice(f.sub), { code: 'renewal_notice_store_unavailable' });
  Object.values(data.notices)[0].state = 'failed';
  Object.values(data.notices)[0].errorCode = 'private-email-and-credentials';
  const unsafe = createRenewalNotices({ ...f.options, store: createMemoryStore(data) });
  await assert.rejects(unsafe.ensureNotice(f.sub), { code: 'renewal_notice_store_unavailable' });
});

test('existing falsy notice records cannot be replaced by a second SMTP send', async (t) => {
  for (const invalid of [null, false, 0, '', []]) await t.test(JSON.stringify(invalid), async () => {
    const f = fixture();
    f.transport.idempotencyWindowMs = 0;
    await f.notices.ensureNotice(f.sub);
    const data = f.store.read();
    data.notices[Object.keys(data.notices)[0]] = invalid;
    const restarted = createRenewalNotices({ ...f.options, store: createMemoryStore(data) });
    await assert.rejects(restarted.ensureNotice(f.sub), { code: 'renewal_notice_store_unavailable' });
    assert.equal(f.sends.length, 1);
  });
});
