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

test('checkout correlation query is forwarded only with the authenticated owner', async () => {
  const { billing } = fixture();
  const seen = [];
  billing.status = async (userId, requestId) => { seen.push({ userId, requestId }); return { checkoutResolution: null }; };
  const api = createApi({ store: createMemoryStore(), billing });
  const requestId = '12345678-1234-4123-8123-123456789abc';
  const url = `/api/billing/subscription?checkoutRequestId=${requestId}&userId=foreign`;
  assert.equal((await api.handle({ method: 'GET', url })).status, 401);
  assert.equal(seen.length, 0);
  const auth = JSON.parse((await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: '{"nickname":"Тест"}' })).body);
  assert.equal((await api.handle({ method: 'GET', url, headers: { authorization: `Bearer ${auth.authToken}` } })).status, 200);
  assert.deepEqual(seen, [{ userId: auth.profile.userId, requestId }]);
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

test('email correction is authenticated, scoped to the session owner and rate limited', async () => {
  const { billing, calls } = fixture();
  billing.updateEmail = async (user, body) => { calls.push(['email', user, body]); return billing.status(user); };
  const api = createApi({ store: createMemoryStore(), billing });
  const request = { method: 'POST', url: '/api/billing/email', body: '{"email":"new@example.com","userId":"someone-else"}' };
  assert.equal((await api.handle(request)).status, 401);
  const bootstrap = JSON.parse((await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: '{"nickname":"Тест"}' })).body);
  request.headers = { authorization: `Bearer ${bootstrap.authToken}` };
  const response = await api.handle(request);
  assert.equal(response.status, 200);
  assert.equal(calls[0][1], bootstrap.profile.userId);
  assert.equal(calls[0][2].email, 'new@example.com');
  assert.equal(JSON.parse(response.body).email, undefined);
  for (let i = 1; i < 6; i++) assert.equal((await api.handle(request)).status, 200);
  assert.equal((await api.handle(request)).status, 429);
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

test('all four Robokassa documents remain public while sales are disabled and expose no checkout action', async () => {
  const { billing } = fixture();
  const { createRobokassaBilling } = require('../runtime/billing-robokassa.cjs');
  const catalogData = createRobokassaBilling({ store: createMemoryStore(), merchantLogin: 'slova' }).catalog();
  billing.catalog = () => catalogData;
  const http = createBillingHttp({ billing, publicBase: 'https://game.example', seller: { name: 'Продавец <script>', inn: '123', email: 'support@example.com' } });
  const catalog = JSON.parse((await http.handlePublic({ method: 'GET', url: '/api/billing/catalog' })).body);
  assert.equal(catalog.available, false);
  assert.equal(catalog.privacyUrl, 'https://game.example/api/billing/privacy');
  assert.equal(catalog.userAgreementUrl, 'https://game.example/api/billing/user-agreement');
  assert.equal(catalog.personalDataConsentUrl, 'https://game.example/api/billing/personal-data-consent');
  const offer = await http.handlePublic({ method: 'GET', url: '/api/billing/terms' });
  const privacy = await http.handlePublic({ method: 'GET', url: '/api/billing/privacy' });
  const userAgreement = await http.handlePublic({ method: 'GET', url: '/api/billing/user-agreement' });
  const personalDataConsent = await http.handlePublic({ method: 'GET', url: '/api/billing/personal-data-consent' });
  for (const result of [offer, privacy, userAgreement, personalDataConsent]) {
    assert.equal(result.status, 200);
    assert.match(result.body, /Продавец &lt;script&gt;/);
    assert.doesNotMatch(result.body, /<script>|<form|ЮKassa/);
    assert.match(result.body, /href="\/api\/billing\/terms"/);
    assert.match(result.body, /href="\/api\/billing\/privacy"/);
    assert.match(result.body, /href="\/api\/billing\/user-agreement"/);
    assert.match(result.body, /href="\/api\/billing\/personal-data-consent"/);
    assert.match(result.body, /href="\/api\/billing\/manage"/);
    assert.equal(result.headers['referrer-policy'], 'no-referrer');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.match(result.headers['content-security-policy'], /default-src 'none'/);
    assert.match(result.headers['content-security-policy'], /form-action 'self'/);
    assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  }
  for (const expected of ['Публичная оферта', '99.00', '30 дней', '24 часа', 'Галочка заранее не установлена',
    'обработку персональных данных', 'Робочеки СМЗ', 'частичного возврата', catalogData.plan.consentVersion]) {
    assert.ok(offer.body.includes(expected), `offer missing ${expected}`);
  }
  for (const expected of ['Политика конфиденциальности', 'Timeweb', 'Robokassa', 'ФНС', 'номер карты', 'отзыва согласия', catalogData.plan.privacyVersion]) {
    assert.ok(privacy.body.includes(expected), `privacy missing ${expected}`);
  }
  assert.match(userAgreement.body, /<h1>Пользовательское соглашение<\/h1>/);
  assert.match(userAgreement.body, /использование игры само по себе не оформляет платную подписку/);
  assert.match(userAgreement.body, /subscription-user-agreement-v1/);
  assert.match(personalDataConsent.body, /<h1>Согласие на обработку персональных данных<\/h1>/);
  assert.match(personalDataConsent.body, /subscription-personal-data-v1/);
  assert.match(personalDataConsent.body, /Я согласен на обработку персональных данных/);
  assert.match(personalDataConsent.body, /Просмотр документа не является согласием/);
  assert.match(personalDataConsent.body, /не разрешает общедоступное распространение данных или рекламные рассылки/);
  assert.doesNotMatch(offer.body, /Я даю согласие на регулярные списания, на обработку персональных данных/);
});

test('Robokassa public documents withhold incomplete seller information', async () => {
  const { billing } = fixture();
  const original = billing.catalog();
  billing.catalog = () => ({ ...original, provider: 'robokassa' });
  const http = createBillingHttp({ billing, seller: { name: 'Incomplete seller' } });
  for (const name of ['terms', 'privacy', 'user-agreement', 'personal-data-consent']) {
    const result = await http.handlePublic({ method: 'GET', url: `/api/billing/${name}` });
    assert.equal(result.status, 200);
    assert.match(result.body, /Продажи ещё не открыты/);
    assert.doesNotMatch(result.body, /Incomplete seller/);
  }
});

test('Robokassa legal pages use the configured plan and preserve the payment and privacy boundaries', async () => {
  const { billing } = fixture();
  billing.catalog = () => ({ provider: 'robokassa', available: false, protocol: 'robokassa-v3', plan: {
    amount: '99.00', periodDays: 30, consentVersion: 'no-ads-30-robokassa-v3', termsVersion: 'no-ads-30-robokassa-v3',
    privacyVersion: 'subscription-privacy-v2', userAgreementVersion: 'subscription-user-agreement-v1',
    personalDataConsentVersion: 'subscription-personal-data-v1',
    consentText: 'Я согласен на автоматические списания согласно условиям оферты',
    personalDataConsentText: 'Я согласен на обработку персональных данных',
  } });
  const http = createBillingHttp({ billing, seller: { name: 'Тестовый продавец', inn: '123456789012', email: 'support@example.com' } });
  const offer = await http.handlePublic({ method: 'GET', url: '/api/billing/terms' });
  for (const expected of ['99.00 ₽ за 30 дней', '30 × 24 часа', 'Europe/Moscow', 'Первый платёж списывается при оформлении',
    'не начинается ранее чем через 24 часа', 'Карты иностранных банков не поддерживаются',
    'предложению продавца, направленному покупателю по email', 'только после нового явного согласия',
    'Действующие подписки сохраняют исходные цену и период', 'Автоматической смены тарифа нет',
    'Изменение публичного тарифа для новых покупок не меняет условия существующих списаний',
    'Для полного или частичного возврата', 'не ограничивает обязательные права потребителя', 'no-ads-30-robokassa-v3']) {
    assert.ok(offer.body.includes(expected), `offer missing ${expected}`);
  }
  const consent = await http.handlePublic({ method: 'GET', url: '/api/billing/personal-data-consent' });
  for (const expected of ['Тестовый продавец', '123456789012', 'support@example.com', 'Цели:', 'Перечень данных:',
    'Разрешённые действия:', 'со дня его подтверждения', 'отозвать письмом', 'самостоятельное законное основание',
    'отдельный, заранее не установленный флажок', 'subscription-personal-data-v1']) {
    assert.ok(consent.body.includes(expected), `consent missing ${expected}`);
  }
  const management = await http.handlePublic({ method: 'GET', url: '/api/billing/manage' });
  assert.match(management.body, /href="\/api\/billing\/personal-data-consent"/);
  for (const document of ['terms', 'privacy', 'user-agreement', 'personal-data-consent']) {
    assert.equal((await http.handlePublic({ method: 'POST', url: `/api/billing/${document}` })).status, 405);
  }
});

test('every Robokassa document escapes all seller fields and version values', async () => {
  const { billing } = fixture();
  billing.catalog = () => ({ provider: 'robokassa', plan: {
    amount: '99.00', periodDays: 30, consentVersion: '<version>', privacyVersion: '<version>',
    userAgreementVersion: '<version>', personalDataConsentVersion: '<version>',
  } });
  const http = createBillingHttp({ billing, seller: { name: '<seller>', inn: '<inn>', email: '<email>' } });
  for (const document of ['terms', 'privacy', 'user-agreement', 'personal-data-consent']) {
    const result = await http.handlePublic({ method: 'GET', url: `/api/billing/${document}` });
    for (const value of ['seller', 'inn', 'email', 'version']) {
      assert.ok(result.body.includes(`&lt;${value}&gt;`));
      assert.ok(!result.body.includes(`<${value}>`));
    }
  }
});

test('checkout transparently forwards separate consent fields only after protocol and authentication checks', async () => {
  const { billing, calls } = fixture();
  const original = billing.catalog();
  billing.catalog = () => ({ ...original, provider: 'robokassa', protocol: 'robokassa-v3' });
  billing.checkout = async (user, body) => { calls.push(['checkout', user, body]); return { paymentId: '123' }; };
  const api = createApi({ store: createMemoryStore(), billing });
  const body = { email: 'buyer@example.com', consentAccepted: true, consentVersion: 'no-ads-30-robokassa-v3', personalDataConsentAccepted: true, personalDataConsentVersion: 'subscription-personal-data-v1' };
  const request = { method: 'POST', url: '/api/billing/checkout', headers: { 'content-type': 'application/json', 'x-slova-billing-protocol': 'robokassa-v3' }, body: JSON.stringify(body) };
  assert.equal((await api.handle(request)).status, 401);
  const bootstrap = JSON.parse((await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: '{"nickname":"Тест"}' })).body);
  request.headers.authorization = `Bearer ${bootstrap.authToken}`;
  request.headers['x-slova-billing-protocol'] = 'robokassa-v2';
  assert.equal((await api.handle(request)).status, 409);
  assert.deepEqual(calls, []);
  request.headers['x-slova-billing-protocol'] = 'robokassa-v3';
  assert.equal((await api.handle(request)).status, 200);
  assert.deepEqual(calls, [['checkout', bootstrap.profile.userId, body]]);
});

test('legacy billing clients can manage existing subscriptions but cannot start a v3 purchase or migration', async () => {
  const { billing, calls } = fixture();
  const original = billing.catalog();
  billing.catalog = () => ({ ...original, available: true, provider: 'robokassa', protocol: 'robokassa-v3' });
  for (const method of ['cancel', 'recovery', 'restore', 'updateEmail']) {
    billing[method] = async (user, body) => { calls.push([method, user, body]); return { ok: true }; };
  }
  const api = createApi({ store: createMemoryStore(), billing });
  const bootstrap = JSON.parse((await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: '{"nickname":"Тест"}' })).body);
  const management = [
    ['GET', 'subscription', 'status'],
    ['POST', 'subscription/cancel', 'cancel'],
    ['POST', 'recovery', 'recovery'],
    ['POST', 'restore', 'restore'],
    ['POST', 'email', 'updateEmail'],
  ];
  for (const protocol of ['robokassa-v2', undefined]) {
    const headers = { 'content-type': 'application/json', ...(protocol ? { 'x-slova-billing-protocol': protocol } : {}) };
    const catalog = await api.handle({ method: 'GET', url: '/api/billing/catalog', headers });
    assert.equal(JSON.parse(catalog.body).available, false);
    for (const [method, route, operation] of management) {
      const request = { method, url: `/api/billing/${route}`, headers, body: '{"email":"buyer@example.com","recoveryCode":"private-code"}' };
      assert.equal((await api.handle(request)).status, 401);
      const response = await api.handle({ ...request, headers: { ...headers, authorization: `Bearer ${bootstrap.authToken}` } });
      assert.equal(response.status, 200, `${protocol ?? 'no protocol'} ${route}`);
      assert.equal(calls.at(-1)[0], operation);
      assert.equal(calls.at(-1)[1], bootstrap.profile.userId);
    }
    const previousCalls = calls.length;
    for (const route of ['checkout', 'migration/resolve']) {
      const response = await api.handle({ method: 'POST', url: `/api/billing/${route}`, headers: { ...headers, authorization: `Bearer ${bootstrap.authToken}` }, body: '{}' });
      assert.equal(response.status, 409);
      assert.deepEqual(JSON.parse(response.body), { error: 'billing_client_update_required' });
    }
    assert.equal(calls.length, previousCalls);
  }
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
