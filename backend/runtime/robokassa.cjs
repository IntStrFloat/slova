const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { isEmail } = require('./email.cjs');

const AUTH = 'https://auth.robokassa.ru';
const REFUNDS = 'https://services.robokassa.ru/RefundService/Refund';
const XML_NAMESPACE = 'http://merchant.roboxchange.com/WebService/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASHES = { MD5: 'md5', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512' };

function gatewayError(code, { retryable = false, ambiguous = false } = {}) {
  return Object.assign(new Error(code), { code, status: 503, retryable, ambiguous });
}
function invalid() { throw gatewayError('billing_gateway_invalid_response'); }
function invoice(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw gatewayError('billing_bad_provider_id');
  }
  return value;
}
function amount(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(value)) invalid();
  const [whole, fraction = ''] = value.split('.');
  if (/[^0]/.test(fraction.slice(2))) invalid();
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return Number(minor);
}
function money(minor) {
  if (!Number.isSafeInteger(minor) || minor <= 0) throw gatewayError('billing_bad_amount');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

// Parse the complete, small XML response rather than searching for a paid status
// anywhere in a document. DTDs, custom entities, namespace changes, duplicate
// attributes, mismatched tags and trailing documents are rejected, not repaired.
function parseXml(xml) {
  if (typeof xml !== 'string' || xml.length > 65536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) invalid();
  let offset = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  const declaration = /^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']utf-8["'])?\s*\?>/i.exec(xml.slice(offset));
  if (declaration) offset += declaration[0].length;
  const stack = [];
  let root;
  const decode = (text) => text.replace(/&([^;]*);|&/g, (entity, name) => {
    const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, name)) return predefined[name];
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name || '')) invalid();
    const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (!Number.isInteger(code) || !(code === 9 || code === 10 || code === 13 ||
      (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) invalid();
    return String.fromCodePoint(code);
  });
  while (offset < xml.length) {
    // The provider wraps its custom field names and values in literal CDATA.
    // Accept only those leaves, without interpreting entities or markup.
    if (xml.startsWith('<![CDATA[', offset)) {
      const leaf = stack[stack.length - 1];
      if (stack.length !== 4 || stack[0].name !== 'OperationStateResponse'
        || stack[1].name !== 'UserFields' || stack[2].name !== 'Field'
        || !['Name', 'Value'].includes(leaf.name) || leaf.children.length) invalid();
      const end = xml.indexOf(']]>', offset + 9);
      if (end === -1) invalid();
      leaf.text += xml.slice(offset + 9, end);
      offset = end + 3;
      continue;
    }
    if (xml[offset] !== '<') {
      const end = xml.indexOf('<', offset);
      const raw = xml.slice(offset, end === -1 ? xml.length : end);
      if (raw.includes(']]>')) invalid();
      const text = decode(raw);
      if (!stack.length && text.trim()) invalid();
      if (stack.length) stack[stack.length - 1].text += text;
      offset += raw.length;
      continue;
    }
    const close = /^<\/([A-Za-z_][A-Za-z0-9_.-]*)\s*>/.exec(xml.slice(offset));
    if (close) {
      if (!stack.length || stack.pop().name !== close[1]) invalid();
      offset += close[0].length;
      continue;
    }
    const open = /^<([A-Za-z_][A-Za-z0-9_.-]*)/.exec(xml.slice(offset));
    if (!open) invalid();
    offset += open[0].length;
    const attrs = Object.create(null);
    while (!/^\s*\/?>/.test(xml.slice(offset))) {
      const attr = /^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(xml.slice(offset));
      if (!attr || Object.hasOwn(attrs, attr[1])) invalid();
      attrs[attr[1]] = decode(attr[2] ?? attr[3]);
      offset += attr[0].length;
    }
    const end = /^\s*(\/?)>/.exec(xml.slice(offset));
    offset += end[0].length;
    const node = { name: open[1], attrs, children: [], text: '' };
    if (stack.length) {
      // OpStateExt annotates the direct Info child with its schema type.
      // Accept that exact annotation, without permitting namespace overrides
      // or arbitrary attributes elsewhere in the payment document.
      const typedInfo = stack.length === 1 && stack[0] === root && node.name === 'Info'
        && root.name === 'OperationStateResponse'
        && root.attrs['xmlns:xsi'] === 'http://www.w3.org/2001/XMLSchema-instance'
        && Object.keys(attrs).length === 1 && attrs['xsi:type'] === 'OperationInfoExt';
      if (Object.keys(attrs).length && !typedInfo) invalid();
      stack[stack.length - 1].children.push(node);
    } else {
      if (root) invalid();
      root = node;
    }
    if (stack.length >= 16) invalid();
    if (!end[1]) stack.push(node);
  }
  if (stack.length || !root || root.name !== 'OperationStateResponse' || root.attrs.xmlns !== XML_NAMESPACE) invalid();
  const allowed = { xmlns: XML_NAMESPACE, 'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema', 'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance' };
  if (Object.entries(root.attrs).some(([key, value]) => allowed[key] !== value)) invalid();
  return root;
}
function child(node, name, required = true) {
  if (!node || node.text.trim()) invalid();
  const found = node.children.filter((item) => item.name === name);
  if (found.length > 1 || (required && !found.length)) invalid();
  return found[0];
}
function scalar(node, name, required = true) {
  const found = child(node, name, required);
  if (!found) return undefined;
  if (found.children.length) invalid();
  return found.text.trim();
}

function resultFields(form) {
  let entries;
  if (typeof form === 'string') {
    if (form.length > 16384 || /%(?![0-9a-fA-F]{2})/.test(form)) invalid();
    try { decodeURIComponent(form.replace(/\+/g, ' ')); } catch { invalid(); }
    entries = new URLSearchParams(form).entries();
  } else if (form instanceof URLSearchParams) entries = form.entries();
  else if (form && typeof form === 'object' && !Array.isArray(form)) entries = Object.entries(form);
  else invalid();
  const fields = Object.create(null);
  const names = new Set();
  for (const [key, value] of entries) {
    const normalized = key.toLowerCase();
    if (names.size >= 64 || names.has(normalized) || typeof value !== 'string' || key.length > 64 || value.length > 2048 ||
      key.includes('\ufffd') || value.includes('\ufffd')) invalid();
    names.add(normalized);
    fields[key] = value;
  }
  return fields;
}

// The API uses three unrelated secrets. Never substitute live passwords for
// missing test passwords, or send a test renewal/refund to production-only APIs.
function createRobokassa({ merchantLogin, password1, password2, testPassword1, testPassword2, password3,
  mode = 'test', hashAlgorithm = 'SHA256', fetchImpl = fetch } = {}) {
  const algorithm = HASHES[hashAlgorithm];
  const secret = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 256 && !/[\s\u0000-\u001f]/.test(value);
  const pass1 = mode === 'test' ? testPassword1 : password1;
  const pass2 = mode === 'test' ? testPassword2 : password2;
  if (!['test', 'live'].includes(mode) || typeof merchantLogin !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(merchantLogin) ||
      !algorithm || !secret(pass1) || !secret(pass2) || pass1 === pass2 || typeof fetchImpl !== 'function' ||
      (password3 != null && password3 !== '' && !secret(password3))) throw gatewayError('billing_bad_configuration');
  const live = [password1, password2].filter(Boolean);
  const test = [testPassword1, testPassword2].filter(Boolean);
  if (test.some((value) => live.includes(value))) throw gatewayError('billing_key_mode_mismatch');
  const identity = Object.freeze({ provider: 'robokassa', merchant: merchantLogin, mode });
  const capabilities = Object.freeze({ recurring: mode === 'live', refunds: mode === 'live' && !!password3 });
  const hash = (text) => createHash(algorithm).update(text, 'utf8').digest('hex');
  function validate(attempt) {
    if (!attempt || !UUID.test(attempt.id) || attempt.provider !== identity.provider || attempt.merchant !== identity.merchant ||
      attempt.mode !== mode || attempt.currency !== 'RUB' || !['checkout', 'renewal'].includes(attempt.kind) ||
      attempt.recurring !== true || !isEmail(attempt.buyerEmail) || typeof attempt.description !== 'string' ||
      attempt.description.length < 1 || attempt.description.length > 100 || /[\u0000-\u001f\u007f]/.test(attempt.description)) {
      throw gatewayError('billing_bad_attempt');
    }
    invoice(attempt.invoiceId);
    money(attempt.amountMinor);
    if (attempt.kind === 'renewal') {
      invoice(attempt.previousInvoiceId);
      if (attempt.previousInvoiceId === attempt.invoiceId) throw gatewayError('billing_bad_provider_id');
    } else if (attempt.previousInvoiceId != null) throw gatewayError('billing_bad_attempt');
  }
  const suffix = (attempt) => `:Shp_attempt=${attempt.id}:Shp_mode=${mode}`;
  const normalized = (attempt, status, amountMinor, evidence, extra = {}) => ({
    ...identity, invoiceId: attempt.invoiceId, status, amountMinor, currency: 'RUB', evidence, ...extra,
  });
  function parameters(attempt) {
    const outSum = money(attempt.amountMinor);
    const sum = Number(outSum);
    if (amount(String(sum)) !== attempt.amountMinor) throw gatewayError('billing_bad_amount');
    // Robocheki SMZ uses the merchant's configured receipt service. Send its
    // required minimal nomenclature for BOTH parent and child payments, without
    // inventing a tax regime or 54-FZ payment_method/payment_object values.
    const receipt = encodeURIComponent(JSON.stringify({ items: [
      { name: attempt.description, quantity: 1, sum, tax: 'none' },
    ] }));
    // Hosted Index.aspx documents InvId; the recurring endpoint instead
    // requires InvoiceID. Do not depend on undocumented parameter aliases.
    // Receipt enters the signature preencoded. URLSearchParams then supplies
    // the transport encoding for both the hosted URL and recurring POST form,
    // matching official sdk-node RecurringService.create + formRequest.
    return new URLSearchParams({ MerchantLogin: merchantLogin, OutSum: outSum,
      [attempt.kind === 'checkout' ? 'InvId' : 'InvoiceID']: attempt.invoiceId,
      Description: attempt.description, Receipt: receipt, Email: attempt.buyerEmail, Culture: 'ru', Encoding: 'UTF-8',
      IsTest: mode === 'test' ? '1' : '0', Shp_attempt: attempt.id, Shp_mode: mode,
      SignatureValue: hash(`${merchantLogin}:${outSum}:${attempt.invoiceId}:${receipt}:${pass1}${suffix(attempt)}`) });
  }
  async function request(url, { method = 'GET', body, mutates = false, contentType } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      let response;
      try {
        response = await fetchImpl(url, { method, redirect: 'error', signal: controller.signal,
          ...(body !== undefined ? { body, headers: { 'Content-Type': contentType || 'application/x-www-form-urlencoded; charset=utf-8' } } : {}) });
      } catch { throw gatewayError('billing_gateway_unavailable', { retryable: !mutates, ambiguous: mutates }); }
      if (!response.ok) throw gatewayError('billing_gateway_unavailable', {
        retryable: !mutates && (response.status === 429 || response.status >= 500), ambiguous: mutates,
      });
      try {
        const text = await response.text();
        if (text.length > 65536) throw new Error('limit');
        return text;
      } catch { throw gatewayError('billing_gateway_invalid_response', { retryable: !mutates, ambiguous: mutates }); }
    } finally { clearTimeout(timer); }
  }
  function prepareCheckout(attempt) {
    validate(attempt);
    if (attempt.kind !== 'checkout') throw gatewayError('billing_bad_attempt');
    const fields = parameters(attempt);
    fields.set('Recurring', 'true');
    fields.set('IncCurrLabel', 'BankCard');
    return { invoiceId: attempt.invoiceId, confirmationUrl: `${AUTH}/Merchant/Index.aspx?${fields}` };
  }
  async function submitRenewal(attempt) {
    validate(attempt);
    if (attempt.kind !== 'renewal') throw gatewayError('billing_bad_attempt');
    if (!capabilities.recurring) throw gatewayError('billing_test_recurring_unavailable');
    const fields = parameters(attempt);
    fields.set('PreviousInvoiceID', attempt.previousInvoiceId);
    const text = (await request(`${AUTH}/Merchant/Recurring`, { method: 'POST', body: fields.toString(), mutates: true })).trim();
    // OK+ID acknowledges creation only. It is never payment evidence.
    if (text !== `OK${attempt.invoiceId}`) {
      throw gatewayError('billing_gateway_invalid_response', { ambiguous: true });
    }
    return { invoiceId: attempt.invoiceId, status: 'pending' };
  }
  function verifiedResult(form, attempt) {
    const fields = resultFields(form);
    if (fields.InvId !== attempt.invoiceId || fields.Shp_attempt !== attempt.id || fields.Shp_mode !== mode ||
      Object.keys(fields).some((name) => /^shp_/i.test(name) && !['Shp_attempt', 'Shp_mode'].includes(name)) ||
      amount(fields.OutSum) !== attempt.amountMinor || (fields.IsTest !== undefined && fields.IsTest !== (mode === 'test' ? '1' : '0'))) invalid();
    const expected = hash(`${fields.OutSum}:${fields.InvId}:${pass2}${suffix(attempt)}`);
    if (typeof fields.SignatureValue !== 'string' || !/^[a-fA-F0-9]+$/.test(fields.SignatureValue) || fields.SignatureValue.length !== expected.length ||
      !timingSafeEqual(Buffer.from(fields.SignatureValue.toLowerCase(), 'ascii'), Buffer.from(expected, 'ascii'))) {
      throw gatewayError('billing_bad_signature');
    }
    return normalized(attempt, 'succeeded', attempt.amountMinor, 'signed_result');
  }
  function verifyResult(form, attempt) {
    validate(attempt);
    try { return verifiedResult(form, attempt); } catch (error) {
      error.status = 400;
      throw error;
    }
  }
  async function lookupPayment(attempt) {
    validate(attempt);
    if (mode === 'test') return normalized(attempt, 'pending', null, 'test_pending');
    const fields = new URLSearchParams({ MerchantLogin: merchantLogin, InvoiceID: attempt.invoiceId,
      Signature: hash(`${merchantLogin}:${attempt.invoiceId}:${pass2}`) });
    const document = parseXml(await request(`${AUTH}/Merchant/WebService/Service.asmx/OpStateExt`, { method: 'POST', body: fields.toString() }));
    const code = scalar(child(document, 'Result'), 'Code');
    if (code === '3') return normalized(attempt, 'pending', null, 'authenticated_status');
    if (code !== '0') throw gatewayError('billing_gateway_rejected', { retryable: code === '1000' });
    const state = scalar(child(document, 'State'), 'Code');
    if (!['5', '10', '20', '50', '60', '80', '100'].includes(state)) invalid();
    if (state !== '100') return normalized(attempt, ['10', '60'].includes(state) ? 'canceled' : 'pending', null, 'authenticated_status');
    const info = child(document, 'Info');
    const paidAmount = amount(scalar(info, 'OutSum'));
    if (paidAmount !== attempt.amountMinor) throw gatewayError('billing_provider_amount_mismatch');
    const userFields = child(document, 'UserFields');
    const values = Object.create(null);
    for (const field of userFields.children) {
      if (field.name !== 'Field') invalid();
      const name = scalar(field, 'Name');
      if (Object.hasOwn(values, name)) invalid();
      values[name] = scalar(field, 'Value');
    }
    if (values.Shp_attempt !== attempt.id || values.Shp_mode !== mode) invalid();
    const operationKey = scalar(info, 'OpKey');
    if (!operationKey || !/^[A-Za-z0-9_-]{1,128}$/.test(operationKey)) invalid();
    return normalized(attempt, 'succeeded', paidAmount, 'authenticated_status', { operationKey });
  }
  function validateRefund(refund) {
    if (!capabilities.refunds) throw gatewayError('billing_refunds_unavailable');
    if (!refund || !/^[A-Za-z0-9_-]{1,128}$/.test(refund.operationKey || '')) throw gatewayError('billing_bad_refund');
    invoice(refund.invoiceId);
    money(refund.amountMinor);
  }
  async function submitRefund(refund) {
    validateRefund(refund);
    if (!UUID.test(refund.id || '')) throw gatewayError('billing_bad_refund');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    // InvoiceItems is 54-FZ fiscalization, not an NPD receipt or its annulment.
    const payload = Buffer.from(JSON.stringify({ OpKey: refund.operationKey, RefundSum: refund.amountMinor / 100 })).toString('base64url');
    const token = `${header}.${payload}`;
    const jwt = `${token}.${createHmac('sha256', password3).update(token).digest('base64url')}`;
    // The official OpenAPI requires a JSON string containing the JWT, not a
    // raw JWT body and not an object with a token property.
    const text = await request(`${REFUNDS}/Create`, { method: 'POST', body: JSON.stringify(jwt), contentType: 'application/json; charset=utf-8', mutates: true });
    let response;
    try { response = JSON.parse(text); } catch { throw gatewayError('billing_gateway_invalid_response', { ambiguous: true }); }
    if (response?.success === false && response.requestId === null) throw gatewayError('billing_refund_rejected');
    if (response?.success !== true || !UUID.test(response.requestId || '')) throw gatewayError('billing_gateway_invalid_response', { ambiguous: true });
    return { requestId: response.requestId, status: 'pending' };
  }
  async function lookupRefund(refund) {
    validateRefund(refund);
    if (!UUID.test(refund.requestId || '')) throw gatewayError('billing_bad_refund');
    const text = await request(`${REFUNDS}/GetState?id=${encodeURIComponent(refund.requestId)}`);
    let response;
    try { response = JSON.parse(text); } catch { invalid(); }
    if (response?.requestId !== refund.requestId || !['finished', 'processing', 'canceled'].includes(response.label) ||
      typeof response.amount !== 'number' || amount(String(response.amount)) !== refund.amountMinor) invalid();
    // GetState does NOT return OpKey: association comes only from the persisted
    // successful Create response. Never attach an arbitrary cabinet request ID.
    return { requestId: response.requestId, status: response.label === 'processing' ? 'pending' : response.label,
      operationKey: refund.operationKey, amountMinor: refund.amountMinor };
  }
  return Object.freeze({ identity, capabilities, prepareCheckout, submitRenewal, verifyResult, lookupPayment, submitRefund, lookupRefund });
}

module.exports = { createRobokassa, gatewayError };
