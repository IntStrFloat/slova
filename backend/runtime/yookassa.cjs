const { Buffer } = require('node:buffer');

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const API = 'https://api.yookassa.ru/v3';

function gatewayError(code, { retryable = false, ambiguous = false } = {}) {
  const error = new Error(code);
  error.code = code;
  error.status = 503;
  error.retryable = retryable;
  error.ambiguous = ambiguous;
  return error;
}

// Keys stay on the backend. A fixed origin and redirect:error prevent credentials
// from following a redirect to a different host.
function createYooKassa({ shopId, secretKey, returnUrl, fetchImpl = fetch, mode = 'test' }) {
  let returnAddress;
  try { returnAddress = new URL(returnUrl); } catch { throw gatewayError('billing_bad_return_url'); }
  if (returnAddress.protocol !== 'https:' || returnAddress.username || returnAddress.password ||
      !/^\d{1,32}$/.test(String(shopId)) || typeof secretKey !== 'string' || !secretKey ||
      !['test', 'live'].includes(mode) || typeof fetchImpl !== 'function') {
    throw gatewayError('billing_bad_configuration');
  }
  // Fail before any request: response.test validation happens too late to prevent
  // an accidental real charge. Unknown key formats also fail closed.
  const expectedKey = mode === 'test' ? /^test_[A-Za-z0-9_-]+$/ : /^live_[A-Za-z0-9_-]+$/;
  if (!expectedKey.test(secretKey)) throw gatewayError('billing_key_mode_mismatch');
  const authorization = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;

  async function request(method, endpoint, payload, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      let response;
      try {
        response = await fetchImpl(`${API}${endpoint}`, {
          method, redirect: 'error', signal: controller.signal,
          headers: { Authorization: authorization, 'Content-Type': 'application/json', ...(key ? { 'Idempotence-Key': key } : {}) },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
      } catch {
        throw gatewayError('billing_gateway_unavailable', { retryable: true, ambiguous: method === 'POST' });
      }
      if (!response.ok) {
        // Provider error bodies may contain sensitive request details. Never expose them.
        const retryable = response.status === 429 || response.status >= 500;
        throw gatewayError(retryable ? 'billing_gateway_unavailable' : 'billing_gateway_rejected', {
          retryable, ambiguous: method === 'POST' && response.status >= 500,
        });
      }
      try { return await response.json(); } catch {
        throw gatewayError('billing_gateway_invalid_response', { retryable: true, ambiguous: method === 'POST' });
      }
    } finally { clearTimeout(timer); }
  }

  function validId(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw gatewayError('billing_bad_provider_id');
    return encodeURIComponent(id);
  }
  return {
    createPayment(payload, idempotenceKey) {
      validId(idempotenceKey);
      const firstPurchase = !payload.payment_method_id;
      return request('POST', '/payments', {
        ...payload, capture: true,
        ...(firstPurchase ? { save_payment_method: true, confirmation: { type: 'redirect', return_url: returnAddress.href } } : {}),
      }, idempotenceKey);
    },
    getPayment: (id) => request('GET', `/payments/${validId(id)}`),
    getRefund: (id) => request('GET', `/refunds/${validId(id)}`),
  };
}

module.exports = { createYooKassa, gatewayError };
