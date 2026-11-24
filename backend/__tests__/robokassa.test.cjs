const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { createRobokassa } = require('../runtime/robokassa.cjs');

const config = {
  merchantLogin: 'slova', password1: 'live-password-one', password2: 'live-password-two',
  testPassword1: 'test-password-one', testPassword2: 'test-password-two', password3: 'refund-password-three',
};
const base = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001', invoiceId: '12', kind: 'checkout',
  amountMinor: 9900, currency: 'RUB', buyerEmail: 'player@example.com', description: 'Без рекламных пауз — 30 дней',
  previousInvoiceId: null, provider: 'robokassa', merchant: 'slova', mode: 'test', recurring: true,
});
const live = { ...base, mode: 'live' };
const renewal = { ...live, invoiceId: '13', previousInvoiceId: '12', kind: 'renewal' };
const refund = { id: '00000000-0000-4000-8000-000000000002', invoiceId: '12', operationKey: '0005F891-8CCD-434B-8455-816AFFFDBF37-0VOisWikFF', amountMinor: 9900 };
const requestId = '68cd7fa6-1338-4745-ba5c-28d16cbcdb3d';
// Frozen JSON and percent-encoded bytes are independent protocol fixtures. The
// SHA256 literals below were cross-checked with Python hashlib + urllib.quote.
const receipt99 = '{"items":[{"name":"Без рекламных пауз — 30 дней","quantity":1,"sum":99,"tax":"none"}]}';
const encodedReceipt99 = '%7B%22items%22%3A%5B%7B%22name%22%3A%22%D0%91%D0%B5%D0%B7%20%D1%80%D0%B5%D0%BA%D0%BB%D0%B0%D0%BC%D0%BD%D1%8B%D1%85%20%D0%BF%D0%B0%D1%83%D0%B7%20%E2%80%94%2030%20%D0%B4%D0%BD%D0%B5%D0%B9%22%2C%22quantity%22%3A1%2C%22sum%22%3A99%2C%22tax%22%3A%22none%22%7D%5D%7D';
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const signature = (value) => createHash('sha256').update(value).digest('hex');
function callback(extra = {}, attempt = base, secret = config.testPassword2) {
  const fields = { OutSum: '99.000000', InvId: attempt.invoiceId, Shp_attempt: attempt.id, Shp_mode: attempt.mode, ...extra };
  fields.SignatureValue = signature(`${fields.OutSum}:${fields.InvId}:${secret}:Shp_attempt=${fields.Shp_attempt}:Shp_mode=${fields.Shp_mode}`);
  return fields;
}
function fixture(options = {}, response = '') {
  const calls = [];
  const gateway = createRobokassa({ ...config, fetchImpl: async (...args) => { calls.push(args); return reply(response); }, ...options });
  return { gateway, calls };
}
function xml({ result = '0', state = '100', sum = '99.000000', fields = true, opKey = refund.operationKey } = {}) {
  return `<?xml version="1.0" encoding="utf-8"?><OperationStateResponse xmlns="http://merchant.roboxchange.com/WebService/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Result><Code>${result}</Code></Result><State><Code>${state}</Code></State>
    <Info><OutSum>${sum}</OutSum><OutCurrLabel>RUB</OutCurrLabel><OpKey>${opKey}</OpKey></Info>
    ${fields ? `<UserFields><Field><Name>Shp_attempt</Name><Value>${base.id}</Value></Field><Field><Name>Shp_mode</Name><Value>live</Value></Field></UserFields>` : ''}
    </OperationStateResponse>`;
}

// Fixed vectors use official /ru/pay-interface and /ru/notifications-and-redirects
// field order, with signed Shp_* sorted lexicographically. Expected hashes are
// literals, not computed through the adapter under test.
test('checkout is pure, deterministic and signed with test credentials', () => {
  const { gateway, calls } = fixture();
  const prepared = gateway.prepareCheckout(base);
  const url = new URL(prepared.confirmationUrl);
  assert.equal(prepared.invoiceId, '12');
  assert.equal(url.origin + url.pathname, 'https://auth.robokassa.ru/Merchant/Index.aspx');
  assert.equal(url.searchParams.get('SignatureValue'), '0fd4fbb964861ed26288c7e452cde9659bb658d4dc7f628aaf33bbe5ef6f5042');
  assert.equal(url.searchParams.get('InvId'), '12');
  assert.equal(url.searchParams.has('InvoiceID'), false);
  assert.equal(url.searchParams.get('Recurring'), 'true');
  assert.equal(url.searchParams.get('IsTest'), '1');
  assert.equal(url.searchParams.get('IncCurrLabel'), 'BankCard');
  assert.equal(url.searchParams.get('Email'), base.buyerEmail);
  assert.equal(url.searchParams.get('Receipt'), encodedReceipt99);
  assert.equal(decodeURIComponent(url.searchParams.get('Receipt')), receipt99);
  assert.match(url.search, /[?&]Receipt=%257B%2522items%2522%253A/);
  assert.deepEqual(gateway.prepareCheckout(base), prepared);
  assert.equal(calls.length, 0);
});

test('minimal receipt follows the official payment-interface example and is signed before Password1', () => {
  // /ru/pay-interface "С применением всех параметров": product, quantity 1,
  // sum 8.96, tax none. The app adds its two required signed Shp_* bindings.
  const example = { ...base, merchant: 'demo', invoiceId: '12345', description: 'product', amountMinor: 896 };
  const { gateway } = fixture({ merchantLogin: 'demo', testPassword1: 'password_1', hashAlgorithm: 'MD5' });
  const fields = new URL(gateway.prepareCheckout(example).confirmationUrl).searchParams;
  assert.equal(fields.get('Receipt'), '%7B%22items%22%3A%5B%7B%22name%22%3A%22product%22%2C%22quantity%22%3A1%2C%22sum%22%3A8.96%2C%22tax%22%3A%22none%22%7D%5D%7D');
  assert.equal(fields.get('SignatureValue'), 'a3be3ddb428c3736bd692da3a69b8d5a');
});

test('receipt always contains one minimal item in RUB, including kopecks, in both flows', async () => {
  const values = [[1, 0.01, '0.01'], [29, 0.29, '0.29'], [99, 0.99, '0.99'], [9900, 99, '99.00'], [9901, 99.01, '99.01'], [123456789, 1234567.89, '1234567.89']];
  for (const [amountMinor, rubles, outSum] of values) {
    const checkout = fixture();
    const fields = new URL(checkout.gateway.prepareCheckout({ ...base, amountMinor }).confirmationUrl).searchParams;
    const recurring = fixture({ mode: 'live' }, 'OK13');
    await recurring.gateway.submitRenewal({ ...renewal, amountMinor });
    const form = new URLSearchParams(recurring.calls[0][1].body);
    for (const requestFields of [fields, form]) {
      assert.equal(requestFields.get('OutSum'), outSum);
      const receipt = JSON.parse(decodeURIComponent(requestFields.get('Receipt')));
      assert.deepEqual(receipt, { items: [{ name: base.description, quantity: 1, sum: rubles, tax: 'none' }] });
      assert.equal(typeof receipt.items[0].sum, 'number');
      assert.deepEqual(Object.keys(receipt), ['items']);
      assert.deepEqual(Object.keys(receipt.items[0]), ['name', 'quantity', 'sum', 'tax']);
    }
  }
});

test('receipt escaping preserves Cyrillic, quotes, plus, percent and ampersand without extra parameters', async () => {
  const description = 'Тариф "Без рекламы" + 30 дней & бонус 100% / мир';
  const { gateway } = fixture();
  const url = new URL(gateway.prepareCheckout({ ...base, description }).confirmationUrl);
  const recurring = fixture({ mode: 'live' }, 'OK13');
  await recurring.gateway.submitRenewal({ ...renewal, description });
  const rawForm = recurring.calls[0][1].body;
  for (const wire of [url.search.slice(1), rawForm]) {
    assert.match(wire, /Receipt=%257B/);
    assert.match(wire, /%252B/);
    assert.match(wire, /%2526/);
    assert.match(wire, /%2525/);
    const fields = new URLSearchParams(wire);
    assert.equal(fields.getAll('Receipt').length, 1);
    assert.equal(fields.getAll('SignatureValue').length, 1);
    assert.equal(JSON.parse(decodeURIComponent(fields.get('Receipt'))).items[0].name, description);
    assert.equal(fields.get('Email'), base.buyerEmail);
  }
});

test('receipt refuses sums that JSON numbers would silently round by a kopeck', async () => {
  const amountMinor = Number.MAX_SAFE_INTEGER;
  assert.throws(() => fixture().gateway.prepareCheckout({ ...base, amountMinor }), /billing_bad_amount/);
  const recurring = fixture({ mode: 'live' }, 'OK13');
  await assert.rejects(recurring.gateway.submitRenewal({ ...renewal, amountMinor }), /billing_bad_amount/);
  assert.equal(recurring.calls.length, 0);
});

test('known ResultURL vector accepts six or two decimals and hex uppercase', () => {
  const { gateway } = fixture();
  const form = callback();
  assert.equal(form.SignatureValue, '766a3fe59af1b72a1c6df21b89569cf7f5295f111ac797e7165a7187e2d53cd5');
  const result = gateway.verifyResult({ ...form, SignatureValue: form.SignatureValue.toUpperCase() }, base);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.evidence, 'signed_result');
  assert.equal(result.amountMinor, 9900);
  const two = callback({ OutSum: '99.00' });
  assert.equal(two.SignatureValue, '897680dfb1926cbf15b91f313498e51d7188faebbcac30ea735289ed2c018bd2');
  assert.equal(gateway.verifyResult(new URLSearchParams(two).toString(), base).status, 'succeeded');
});

test('credentials cannot silently fall back or cross test/live boundaries', () => {
  for (const override of [{ testPassword1: undefined }, { testPassword2: undefined }, { testPassword1: config.password1 },
    { testPassword2: config.password1 }, { testPassword2: config.testPassword1 }, { hashAlgorithm: 'SHA1' },
    { merchantLogin: 'slova:other' }, { mode: 'sandbox' }]) {
    assert.throws(() => createRobokassa({ ...config, ...override }), /^Error: billing_/);
  }
  const { gateway } = fixture({ mode: 'live' });
  assert.throws(() => gateway.verifyResult(callback(), live), /^Error: billing_/);
  assert.throws(() => gateway.prepareCheckout(base), /billing_bad_attempt/);
  assert.equal(new URL(gateway.prepareCheckout(live).confirmationUrl).searchParams.get('IsTest'), '0');
});

test('frozen attempt requires durable positive numeric IDs, identity and exact RUB amount', () => {
  const { gateway } = fixture();
  for (const invoiceId of ['', '0', '-1', '01', '1.0', '12x', '9223372036854775808', 12]) {
    assert.throws(() => gateway.prepareCheckout({ ...base, invoiceId }), /billing_bad_provider_id/);
  }
  assert.equal(gateway.prepareCheckout({ ...base, invoiceId: '9223372036854775807' }).invoiceId, '9223372036854775807');
  for (const override of [{ merchant: 'other' }, { id: 'user' }, { provider: 'yookassa' }, { currency: 'USD' },
    { amountMinor: 0 }, { amountMinor: 99.1 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { buyerEmail: 'buyer@invalid' }, { previousInvoiceId: '11' }, { recurring: false }, { description: 'text\nsecond line' }]) {
    assert.throws(() => gateway.prepareCheckout({ ...base, ...override }), /^Error: billing_/);
  }
});

test('callback rejects duplicates including casing, malformed fields and unsigned extra Shp fields', () => {
  const { gateway } = fixture();
  const valid = new URLSearchParams(callback()).toString();
  for (const form of [`${valid}&InvId=12`, `${valid}&invid=12`, `${valid}&SignatureValue=anything`,
    `${valid}&Shp_mode=test`, `${valid}&Shp_extra=1`, `${valid}&Fee=0&fee=0`, `${valid}&EMail=%FF`,
    { ...callback(), InvId: ['12'] }, `${valid}&OutSum=%GG`]) {
    assert.throws(() => gateway.verifyResult(form, base), /^Error: billing_/);
  }
});

test('accepts the real ResultURL shape containing legacy aliases alongside signed canonical fields', () => {
  const { gateway } = fixture();
  const signed = callback();
  const form = { ...signed, out_summ: signed.OutSum, inv_id: signed.InvId, crc: signed.SignatureValue,
    PaymentMethod: 'BankCard', IncSum: signed.OutSum, IncCurrLabel: 'BankCardPSR', EMail: 'buyer@example.ru', Fee: '3.860000' };
  assert.equal(gateway.verifyResult(new URLSearchParams(form).toString(), base).status, 'succeeded');
  assert.throws(() => gateway.verifyResult({ ...form, InvId: '99' }, base), /^Error: billing_/);
  assert.throws(() => gateway.verifyResult({ ...form, SignatureValue: '0'.repeat(64) }, base), /^Error: billing_/);
});

test('callback fails forged signatures, invoice/owner/mode changes and success-page password', () => {
  const { gateway } = fixture();
  for (const form of [callback({ InvId: '13' }), callback({ Shp_attempt: refund.id }), callback({ Shp_mode: 'live' }),
    callback({ IsTest: '0' }), callback({}, base, config.testPassword1),
    { ...callback(), SignatureValue: 'a'.repeat(64) }, { ...callback(), SignatureValue: 'a'.repeat(63) },
    { ...callback(), SignatureValue: `${'a'.repeat(63)}!` }]) assert.throws(() => gateway.verifyResult(form, base),
    (error) => error.status === 400 && error.code.startsWith('billing_'));
});

test('signed numeric amount is exact, never float-rounded, truncated or exponential', () => {
  const { gateway } = fixture();
  for (const OutSum of ['99.000001', '99.009999', '99.01', '98.999999', '099.00', '99.0000000', '9.9e1', '99,00',
    '+99.00', ' 99.00', '99.00 ', '99.00x', 'NaN', 'Infinity', '-99', '0']) {
    assert.throws(() => gateway.verifyResult(callback({ OutSum }), base), /^Error: billing_/);
  }
  assert.equal(gateway.verifyResult(callback({ OutSum: '99' }), base).amountMinor, 9900);
});

test('test mode never calls production-only renewal, XML status or refund APIs', async () => {
  const { gateway, calls } = fixture();
  assert.deepEqual(gateway.capabilities, { recurring: false, refunds: false });
  const status = await gateway.lookupPayment(base);
  assert.equal(status.status, 'pending');
  assert.equal(status.amountMinor, null);
  assert.equal(status.evidence, 'test_pending');
  await assert.rejects(gateway.submitRenewal({ ...renewal, mode: 'test' }), /billing_test_recurring_unavailable/);
  await assert.rejects(gateway.submitRefund(refund), /billing_refunds_unavailable/);
  await assert.rejects(gateway.lookupRefund({ ...refund, requestId }), /billing_refunds_unavailable/);
  assert.equal(calls.length, 0);
});

test('renewal references the original parent and acknowledges only pending, never successful payment', async () => {
  const { gateway, calls } = fixture({ mode: 'live' }, 'OK13');
  assert.deepEqual(await gateway.submitRenewal(renewal), { invoiceId: '13', status: 'pending' });
  assert.equal(calls.length, 1);
  const [url, request] = calls[0];
  assert.equal(url, 'https://auth.robokassa.ru/Merchant/Recurring');
  assert.equal(request.method, 'POST');
  assert.equal(request.redirect, 'error');
  const fields = new URLSearchParams(request.body);
  assert.equal(fields.get('PreviousInvoiceID'), '12');
  assert.equal(fields.get('InvoiceID'), '13');
  assert.equal(fields.has('InvId'), false);
  assert.equal(fields.get('SignatureValue'), 'cd5ef0cc458b5f698a8289fae00acb80def979f2f3e161ccf1b11a06ed36c5bc');
  // Official sdk-node RecurringService puts the preencoded Receipt in a form;
  // formRequest serializes it again. The literal POST wire begins %257B.
  assert.match(request.body, /(?:^|&)Receipt=%257B%2522items%2522%253A/);
  assert.equal(fields.get('Receipt'), encodedReceipt99);
  assert.equal(decodeURIComponent(fields.get('Receipt')), receipt99);
  for (const name of ['Recurring', 'IncCurrLabel', 'ExpirationDate']) assert.equal(fields.has(name), false);
  const changedParent = { ...renewal, previousInvoiceId: '11' };
  await gateway.submitRenewal(changedParent);
  assert.equal(new URLSearchParams(calls[1][1].body).get('SignatureValue'), fields.get('SignatureValue'));
});

test('renewal unknown POST is ambiguous and nonretryable, with no internal retry', async () => {
  for (const response of [async () => { throw new Error('network secret details'); }, async () => reply('secret', 500),
    async () => reply('rate limit', 429), async () => reply('OK14'), async () => reply('OK+13'), async () => reply('Error:34'), async () => reply('<html>error</html>')]) {
    let calls = 0;
    const gateway = createRobokassa({ ...config, mode: 'live', fetchImpl: async (...args) => { calls += 1; return response(...args); } });
    await assert.rejects(gateway.submitRenewal(renewal), (error) => error.ambiguous === true && error.retryable === false && !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('live status authenticates requested merchant invoice and binds returned user fields', async () => {
  const { gateway, calls } = fixture({ mode: 'live' }, xml());
  const status = await gateway.lookupPayment(live);
  assert.deepEqual(status, { ...gateway.identity, invoiceId: '12', status: 'succeeded', amountMinor: 9900,
    currency: 'RUB', evidence: 'authenticated_status', operationKey: refund.operationKey });
  const fields = new URLSearchParams(calls[0][1].body);
  assert.equal(calls[0][0], 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt');
  assert.equal(fields.get('Signature'), 'de2c4d4613cfcf93a689949c3d8cfae68fdd7e0d9abd3e0213f124fa82493e49');
  assert.equal(fields.get('InvoiceID'), '12');
  assert.equal(fields.get('MerchantLogin'), 'slova');
  assert.equal(calls[0][1].redirect, 'error');
});

test('live status accepts the provider OperationInfoExt type only on the root Info element', async () => {
  const typed = xml().replace('<Info>', '<Info xsi:type="OperationInfoExt">')
    .replace(/<(Name|Value)>([^<]*)<\/\1>/g, '<$1><![CDATA[$2]]></$1>');
  const result = await fixture({ mode: 'live' }, typed).gateway.lookupPayment(live);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.amountMinor, 9900);
  assert.equal(result.evidence, 'authenticated_status');
  const invalidDocuments = [
    typed.replace('OperationInfoExt', 'UnexpectedType'),
    typed.replace(' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"', ''),
    typed.replace('http://www.w3.org/2001/XMLSchema-instance', 'https://attacker.invalid'),
    typed.replace('<Info xsi:type="OperationInfoExt">', '<Info xsi:type="OperationInfoExt" extra="1">'),
    typed.replace('<![CDATA[Shp_attempt]]>', '<![CDATA[Shp_attempt'),
    xml().replace('<State>', '<State xsi:type="OperationInfoExt">'),
    xml().replace('<OutSum>', '<OutSum xsi:type="OperationInfoExt">'),
    xml().replace('<Info>', '<Info xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="OperationInfoExt">'),
  ];
  for (const document of invalidDocuments) {
    await assert.rejects(fixture({ mode: 'live' }, document).gateway.lookupPayment(live), /billing_gateway_invalid_response/);
  }
});

test('status codes never grant for pending, hold, suspended, canceled or missing payments', async () => {
  for (const state of ['5', '10', '20', '50', '60', '80']) {
    const { gateway } = fixture({ mode: 'live' }, xml({ state, fields: false }));
    const result = await gateway.lookupPayment(live);
    assert.equal(result.status, ['10', '60'].includes(state) ? 'canceled' : 'pending');
    assert.equal(result.amountMinor, null);
  }
  const { gateway } = fixture({ mode: 'live' }, xml({ result: '3', fields: false }));
  assert.equal((await gateway.lookupPayment(live)).status, 'pending');
  for (const result of ['1', '2', '4', '1000', '999']) {
    await assert.rejects(fixture({ mode: 'live' }, xml({ result })).gateway.lookupPayment(live), /billing_gateway_rejected/);
  }
});

test('XML parse is whole-document and rejects malicious or ambiguous document structures', async () => {
  const good = xml();
  const badDocuments = [
    good.replace('</State>', '<Code>10</Code></State>'), good.replace('</Result>', '<Code>3</Code></Result>'),
    good.replace('</Info>', '<OutSum>99.00</OutSum></Info>'), good.replace('<State>', '<State xmlns="https://attacker.invalid">'),
    good.replace('<Code>100</Code>', '<Code><Nested>100</Nested></Code>'), good.replace('<Code>100</Code>', '<Code>100x</Code>'),
    good.replace('</State>', '</Info>'), good + good, good + 'trailing', good.slice(0, -25),
    good.replace('<OperationStateResponse ', '<!DOCTYPE response [<!ENTITY example "100">]><OperationStateResponse '),
    good.replace('<Code>100</Code>', '<Code>&example;</Code>'), good.replace('<Code>100</Code>', '<!-- <Code>100</Code> -->'),
    good.replace('<Code>100</Code>', '<Code><![CDATA[100]]></Code>'), good.replace('xmlns:xsd=', 'xmlns='),
    good.replace('http://merchant.roboxchange.com/WebService/', 'https://attacker.invalid/'),
    good.replace('<OutSum>99.000000</OutSum>', '<OutSum>99.000001</OutSum>'),
    good.replace(base.id, refund.id), good.replace('<Value>live</Value>', '<Value>test</Value>'),
    good.replace('<OpKey>', '<OpKey>&#0;'), xml({ fields: false }), xml({ sum: '98.99' }),
  ];
  for (const document of badDocuments) await assert.rejects(fixture({ mode: 'live' }, document).gateway.lookupPayment(live), /^Error: billing_/);
});

test('readonly lookup network failures are retryable and do not expose provider response content', async () => {
  const gateway = createRobokassa({ ...config, mode: 'live', fetchImpl: async () => reply('sensitive raw body', 500) });
  await assert.rejects(gateway.lookupPayment(live), (error) => error.retryable && !error.ambiguous && !error.message.includes('sensitive'));
  const rejected = createRobokassa({ ...config, mode: 'live', fetchImpl: async () => reply('unauthorized', 401) });
  await assert.rejects(rejected.lookupPayment(live), (error) => !error.retryable && !error.ambiguous);
});

test('refund create signs Password3 JWT, persists no fictitious receipt and returns pending', async () => {
  const { gateway, calls } = fixture({ mode: 'live' }, { success: true, requestId, message: null });
  assert.deepEqual(await gateway.submitRefund(refund), { requestId, status: 'pending' });
  const [url, request] = calls[0];
  assert.equal(url, 'https://services.robokassa.ru/RefundService/Refund/Create');
  assert.equal(request.redirect, 'error');
  assert.equal(request.headers['Content-Type'], 'application/json; charset=utf-8');
  const [header, payload, proof] = JSON.parse(request.body).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { OpKey: refund.operationKey, RefundSum: 99 });
  assert.equal(proof, createHmac('sha256', config.password3).update(`${header}.${payload}`).digest('base64url'));
  assert.equal(calls.length, 1);
});

test('missing Password3 disables refunds; unknown refund creation is never retried', async () => {
  const disabled = fixture({ mode: 'live', password3: undefined });
  assert.equal(disabled.gateway.capabilities.refunds, false);
  await assert.rejects(disabled.gateway.submitRefund(refund), /billing_refunds_unavailable/);
  assert.equal(disabled.calls.length, 0);
  for (const response of ['malformed', { success: true, requestId: null }, { success: false }]) {
    const { gateway, calls } = fixture({ mode: 'live' }, response);
    await assert.rejects(gateway.submitRefund(refund), (error) => error.ambiguous && !error.retryable);
    assert.equal(calls.length, 1);
  }
  await assert.rejects(fixture({ mode: 'live' }, { success: false, requestId: null }).gateway.submitRefund(refund),
    (error) => error.code === 'billing_refund_rejected' && !error.ambiguous);
});

test('refund lookup binds requestId and exact amount before reporting finished', async () => {
  for (const label of ['finished', 'processing', 'canceled']) {
    const { gateway, calls } = fixture({ mode: 'live' }, { requestId, amount: 99, label });
    assert.deepEqual(await gateway.lookupRefund({ ...refund, requestId }), { requestId, amountMinor: 9900,
      operationKey: refund.operationKey, status: label === 'processing' ? 'pending' : label });
    assert.equal(calls[0][0], `https://services.robokassa.ru/RefundService/Refund/GetState?id=${requestId}`);
  }
  for (const override of [{ requestId: refund.id }, { amount: 98.99 }, { amount: 99.000001 }, { amount: '99' }, { label: 'unknown' }]) {
    await assert.rejects(fixture({ mode: 'live' }, { requestId, amount: 99, label: 'finished', ...override }).gateway.lookupRefund({ ...refund, requestId }), /billing_gateway_invalid_response/);
  }
});
