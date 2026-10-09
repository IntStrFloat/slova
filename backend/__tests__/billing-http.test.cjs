const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBillingHttp } = require('../runtime/billing-http.cjs');
const { createApi } = require('../runtime/api.cjs');
const { createMemoryStore, createFileStore } = require('../runtime/store.cjs');

function fixture() {
  const calls = [];
  const status = { active: false, activeUntil: null, autoRenew: false, nextPaymentAt: null, pendingPaymentId: null, serverTime: 0 };
  const billing = {
    catalog: () => ({ available: false, mode: 'test', plan: { amount: '99.00', periodDays: 30, consentVersion: 'no-ads-30-v1' } }),
    status: async (user) => { calls.push(['status', user]); return status; },
    manage: async (body) => { calls.push(['manage', body]); return status; },
    webhook: async (body) => { calls.push(['webhook', body]); return { ok: true }; },
    checkout: async () => { throw Object.assign(new Error('do not expose credentials'), { code: 'billing_disabled', status: 503 }); },
  };
  return { billing, calls };
}

test('catalog and provider notifications bypass game API key, subscription requires bearer', async () => {
  const { billing, calls } = fixture();
  const api = createApi({ store: createMemoryStore(), apiKey: 'game-service-key', billing, billingPublicBase: 'https://game.example' });
  const catalog = await api.handle({ method: 'GET', url: '/api/billing/catalog' });
  assert.equal(catalog.status, 200);
  assert.equal(JSON.parse(catalog.body).manageUrl, 'https://game.example/api/billing/manage');
  const notification = await api.handle({ method: 'POST', url: '/api/billing/webhook', body: '{"event":"payment.succeeded"}' });
  assert.equal(notification.status, 200);
  assert.equal(calls[0][0], 'webhook');
  assert.equal((await api.handle({ method: 'GET', url: '/api/billing/subscription' })).status, 401);
});

test('authenticated billing routes do not leak provider exception details', async () => {
  const { billing } = fixture();
  const api = createApi({ store: createMemoryStore(), billing });
  const bootstrap = await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: '{"nickname":"Тест"}' });
  const token = JSON.parse(bootstrap.body).authToken;
  const response = await api.handle({ method: 'POST', url: '/api/billing/checkout', headers: { authorization: `Bearer ${token}` }, body: '{}' });
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body), { error: 'billing_disabled' });
});

test('return page does not trust success, payment or user query parameters', async () => {
  const { billing, calls } = fixture();
  const http = createBillingHttp({ billing, publicBase: 'https://game.example' });
  const response = await http.handlePublic({ method: 'GET', url: '/api/billing/return?success=true&userId=attacker&paymentId=fake' });
  assert.equal(response.status, 200);
  assert.match(response.body, /slova:\/\/shop/);
  assert.deepEqual(calls, []);
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
});

test('management accepts form body, hides recovery code, and rate-limits attempts', async () => {
  const { billing } = fixture();
  const http = createBillingHttp({ billing, now: () => new Date(1000) });
  const request = { method: 'POST', url: '/api/billing/manage', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'recoveryCode=private-code&action=cancel', ip: '127.0.0.1' };
  const first = await http.handlePublic(request);
  assert.equal(first.status, 200);
  assert.ok(!first.body.includes('private-code'));
  for (let i = 1; i < 8; i++) assert.equal((await http.handlePublic(request)).status, 200);
  assert.equal((await http.handlePublic(request)).status, 429);
});

test('invalid or oversized webhook JSON is rejected before touching billing state', async () => {
  const { billing, calls } = fixture();
  const http = createBillingHttp({ billing });
  for (const body of ['not-json', '[]', '{}'.repeat(5000)]) {
    const response = await http.handlePublic({ method: 'POST', url: '/api/billing/webhook', body });
    assert.ok([400, 413].includes(response.status));
  }
  assert.deepEqual(calls, []);
});

test('seller details are escaped and terms include recurring amount and cancellation', async () => {
  const { billing } = fixture();
  const http = createBillingHttp({ billing, seller: { name: '<script>alert(1)</script>', inn: '123', email: 'support@example.com' } });
  const response = await http.handlePublic({ method: 'GET', url: '/api/billing/terms' });
  assert.ok(!response.body.includes('<script>'));
  assert.match(response.body, /&lt;script&gt;/);
  assert.match(response.body, /99\.00/);
  assert.match(response.body, /автопродление/i);
  assert.match(response.body, /24 часа/);
  assert.match(response.body, /Timeweb/);
});

test('public management shows postponed next payment independently from expired access', async () => {
  const { billing } = fixture();
  billing.manage = async () => ({ active: false, activeUntil: 1000, autoRenew: true, nextPaymentAt: Date.UTC(2026, 9, 8, 12), serverTime: 2000 });
  const http = createBillingHttp({ billing });
  const result = await http.handlePublic({ method: 'POST', url: '/api/billing/manage', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'recoveryCode=private-code&action=status' });
  assert.match(result.body, /Оплаченного доступа сейчас нет/);
  assert.match(result.body, /Следующее списание: 08\.10\.2026, 15:00:00 \(МСК\)/);
  assert.ok(!result.body.includes('private-code'));
});

test('strict billing store refuses corrupt state instead of losing payment idempotence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-billing-'));
  const filename = path.join(directory, 'billing.json');
  try {
    const store = createFileStore(filename, { strict: true, durable: true });
    assert.deepEqual(store.read(), { users: {} });
    store.write({ attempts: { payment: 'reserved' } });
    assert.deepEqual(store.read(), { attempts: { payment: 'reserved' } });
    fs.writeFileSync(filename, '{broken');
    assert.throws(() => store.read(), /store_unavailable/);
    fs.writeFileSync(filename, '[]');
    assert.throws(() => store.read(), /store_unavailable/);
  } finally {
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});
