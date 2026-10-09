const crypto = require('node:crypto');

const HOUR = 3_600_000;
const MAX_RETRY_WINDOW = 23 * HOUR; // Never exceed a provider's declared retention.
const RETRY_DELAY = 60_000;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ERROR_CODES = new Set(['renewal_notice_invalid_message', 'renewal_notice_gateway_unavailable',
  'renewal_notice_gateway_invalid_response', 'renewal_notice_gateway_rejected', 'renewal_notice_manual_reconciliation_required']);
const coordinators = new WeakMap();

function noticeError(code, { retryable = false, ambiguous = false } = {}) {
  const error = new Error(code);
  error.code = code;
  error.status = 503;
  error.retryable = retryable;
  error.ambiguous = ambiguous;
  return error;
}
function email(value) { return typeof value === 'string' && value.length <= 254 && EMAIL.test(value); }
function senderAddress(value) {
  if (typeof value !== 'string' || value.length > 320 || CONTROL.test(value)) return null;
  if (email(value)) return value;
  const match = /^([^<>"\\]{1,64}) <([^<>]+)>$/.exec(value);
  return match && match[1].trim() && email(match[2]) ? value : null;
}
function managementUrl(value) {
  try {
    const address = new URL(value);
    if (address.protocol !== 'https:' || address.username || address.password || address.search || address.hash) return null;
    return new URL('/api/billing/manage', address.origin).href;
  } catch { return null; }
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }

/**
 * Separate, strict, durable store; one backend process per file (like billing).
 * transport = { mode, idempotencyWindowMs, send(message, key): Promise<{id}> }.
 * Use idempotencyWindowMs: 0 for a transport without provider deduplication.
 * ready means the provider accepted this exact notice AND the charge may start
 * now. notBefore is max(frozen scheduledAt, notifiedAt + minimumLeadMs).
 * API acceptance is not proof of inbox delivery. Failure always blocks charging.
 */
function createRenewalNotices({ store, transport, now = () => new Date(), leadMs = 72 * HOUR,
  minimumLeadMs = 24 * HOUR, mode = 'test', publicBase, supportEmail, sender } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function' ||
      typeof now !== 'function' || !['test', 'live'].includes(mode) ||
      !Number.isSafeInteger(leadMs) || !Number.isSafeInteger(minimumLeadMs) ||
      leadMs < minimumLeadMs || minimumLeadMs < 24 * HOUR || leadMs > 30 * 24 * HOUR) {
    throw noticeError('renewal_notice_bad_configuration');
  }
  const manage = managementUrl(publicBase);
  const configured = Boolean(manage && email(supportEmail) && senderAddress(sender) && transport &&
    transport.mode === mode && typeof transport.send === 'function' &&
    Number.isSafeInteger(transport.idempotencyWindowMs) && transport.idempotencyWindowMs >= 0 &&
    transport.idempotencyWindowMs <= MAX_RETRY_WINDOW);
  if (!coordinators.has(store)) coordinators.set(store, { queue: Promise.resolve(), inFlight: new Map() });
  const coordinator = coordinators.get(store);

  function clock() {
    const time = new Date(now()).getTime();
    if (!Number.isSafeInteger(time) || time < 0) throw noticeError('renewal_notice_bad_clock');
    return time;
  }
  function read() {
    try {
      const data = store.read();
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          (data.noticeVersion !== undefined && data.noticeVersion !== 1) ||
          (data.noticeVersion === 1 && data.notices === undefined) ||
          (data.notices !== undefined && (!data.notices || typeof data.notices !== 'object' || Array.isArray(data.notices)))) {
        throw new Error('invalid_store');
      }
      data.noticeVersion = 1;
      data.notices ??= {};
      return data;
    } catch { throw noticeError('renewal_notice_store_unavailable'); }
  }
  async function transaction(action) {
    const operation = coordinator.queue.then(() => {
      const data = read();
      const result = action(data);
      try { store.write(data); } catch { throw noticeError('renewal_notice_store_unavailable'); }
      return result;
    });
    coordinator.queue = operation.catch(() => {});
    return operation;
  }
  function snapshot(subscription) {
    if (!subscription || subscription.mode !== mode) return { reason: 'renewal_notice_mode_mismatch' };
    if (subscription.autoRenew !== true || !subscription.savedMethodId) return { reason: 'renewal_notice_cancelled' };
    const plan = subscription.plan;
    if (typeof subscription.id !== 'string' || !ID.test(subscription.id) || !email(subscription.email) ||
        !Number.isSafeInteger(subscription.activeUntil) || subscription.activeUntil < 1 ||
        !Number.isFinite(new Date(subscription.activeUntil).getTime()) ||
        !Number.isSafeInteger(subscription.cancelGeneration) || subscription.cancelGeneration < 0 ||
        !plan || typeof plan.id !== 'string' || !ID.test(plan.id) || typeof plan.title !== 'string' ||
        !plan.title.trim() || plan.title.length > 200 || CONTROL.test(plan.title) ||
        typeof plan.amount !== 'string' || !/^[1-9]\d{0,7}\.\d{2}$/.test(plan.amount) || plan.currency !== 'RUB' ||
        !Number.isSafeInteger(plan.periodDays) || plan.periodDays < 1 || plan.periodDays > 365 ||
        typeof plan.consentVersion !== 'string' || !ID.test(plan.consentVersion)) {
      return { reason: 'renewal_notice_invalid_subscription' };
    }
    const terms = { id: plan.id, title: plan.title, amount: plan.amount, currency: plan.currency,
      periodDays: plan.periodDays, consentVersion: plan.consentVersion };
    const binding = { subscriptionId: subscription.id, mode, dueAt: subscription.activeUntil,
      cancelGeneration: subscription.cancelGeneration, email: subscription.email, plan: terms };
    return { binding, key: crypto.createHash('sha256').update(JSON.stringify(binding)).digest('hex') };
  }
  function blocked(reason) { return { ready: false, notifiedAt: null, notBefore: null, reason }; }
  function result(record) {
    if (record.state !== 'sent') return blocked(record.errorCode ?? 'renewal_notice_pending');
    const notBefore = Math.max(record.scheduledAt, record.notifiedAt + minimumLeadMs);
    const ready = clock() >= notBefore;
    return { ready, notifiedAt: record.notifiedAt, notBefore,
      ...(!ready ? { reason: 'renewal_notice_waiting' } : {}) };
  }
  function message(binding, scheduledAt) {
    const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(scheduledAt);
    return { from: sender, to: [binding.email], reply_to: supportEmail,
      subject: 'Слова: напоминание о продлении подписки',
      text: [
        `Подписка «${binding.plan.title}» в игре «Слова» будет автоматически продлена.`,
        `Согласованная стоимость: ${binding.plan.amount} ${binding.plan.currency} за ${binding.plan.periodDays} дней.`,
        `Плановая дата списания: ${date} (московское время).`,
        'Списание произойдёт не раньше этой даты и не ранее 24 часов после отправки этого уведомления.',
        `До списания вы можете отключить автопродление: ${manage}`,
        'Для управления подпиской введите сохранённый код восстановления. Никому не сообщайте этот код.',
        `Поддержка: ${supportEmail}`,
      ].join('\n\n') };
  }
  async function dispatch(key, binding) {
    const operation = await transaction((data) => {
      const time = clock();
      let record = data.notices[key];
      if (Object.prototype.hasOwnProperty.call(data.notices, key)) {
        if (!record || typeof record !== 'object' || Array.isArray(record) ||
            record.subscriptionId !== binding.subscriptionId || record.mode !== mode || record.dueAt !== binding.dueAt ||
            record.cancelGeneration !== binding.cancelGeneration || record.providerKey !== `renewal/${key}` ||
            !['sending', 'ambiguous', 'retry', 'sent', 'failed', 'quarantined'].includes(record.state) ||
            !Number.isSafeInteger(record.firstSentAt) || record.firstSentAt < 0 || !record.message ||
            !Number.isSafeInteger(record.scheduledAt) || record.scheduledAt < record.dueAt ||
            !senderAddress(record.message.from) || !Array.isArray(record.message.to) ||
            record.message.to.length !== 1 || record.message.to[0] !== binding.email || !email(record.message.reply_to) ||
            typeof record.message.subject !== 'string' || CONTROL.test(record.message.subject) ||
            typeof record.message.text !== 'string' || !Number.isSafeInteger(record.retryWindowMs) ||
            record.retryWindowMs < 0 || record.retryWindowMs > MAX_RETRY_WINDOW ||
            (record.errorCode !== null && !ERROR_CODES.has(record.errorCode)) ||
            (record.retryAt !== null && !Number.isSafeInteger(record.retryAt)) ||
            (record.state === 'sent' && (!Number.isSafeInteger(record.notifiedAt) || record.notifiedAt < record.firstSentAt ||
              typeof record.providerId !== 'string' || !ID.test(record.providerId)))) {
          throw noticeError('renewal_notice_store_unavailable');
        }
        if (record.state === 'sent' || record.state === 'failed' || record.state === 'quarantined') return { record };
        // A restart may have lost the accepted response. Never create a fresh key
        // or resend beyond the original provider's bounded retention window.
        const noIdempotency = Math.min(record.retryWindowMs, transport.idempotencyWindowMs) === 0;
        const window = noIdempotency && record.state === 'retry' ? MAX_RETRY_WINDOW
          : Math.min(record.retryWindowMs, transport.idempotencyWindowMs);
        if (time < record.firstSentAt || time - record.firstSentAt >= window) {
          record.state = 'quarantined';
          record.errorCode = 'renewal_notice_manual_reconciliation_required';
          return { record };
        }
        if (record.retryAt !== null && time < record.retryAt) return { record };
        record.state = 'sending';
        record.retryAt = null;
      } else {
        const scheduledAt = Math.max(binding.dueAt, time + minimumLeadMs + HOUR);
        record = { subscriptionId: binding.subscriptionId, mode, dueAt: binding.dueAt,
          scheduledAt, cancelGeneration: binding.cancelGeneration, state: 'sending', firstSentAt: time,
          notifiedAt: null, providerId: null, providerKey: `renewal/${key}`,
          retryWindowMs: transport.idempotencyWindowMs, retryAt: null,
          message: message(binding, scheduledAt), errorCode: null };
        data.notices[key] = record;
      }
      return { record, send: true };
    });
    if (!operation.send) return result(operation.record);
    let accepted;
    try {
      accepted = await transport.send(copy(operation.record.message), operation.record.providerKey);
      if (!accepted || typeof accepted.id !== 'string' || !ID.test(accepted.id)) {
        throw noticeError('renewal_notice_gateway_invalid_response', { retryable: true, ambiguous: true });
      }
    } catch (error) {
      const code = ERROR_CODES.has(error?.code) && error.code !== 'renewal_notice_manual_reconciliation_required'
        ? error.code : 'renewal_notice_gateway_unavailable';
      const ambiguous = error?.ambiguous !== false;
      const retryable = error?.retryable !== false;
      const record = await transaction((data) => {
        const current = data.notices[key];
        const quarantine = ambiguous && Math.min(current.retryWindowMs, transport.idempotencyWindowMs) === 0;
        current.state = quarantine ? 'quarantined' : (ambiguous ? 'ambiguous' : (retryable ? 'retry' : 'failed'));
        current.errorCode = quarantine ? 'renewal_notice_manual_reconciliation_required' : code;
        current.retryAt = !quarantine && (retryable || ambiguous) ? clock() + RETRY_DELAY : null;
        return current;
      });
      return result(record);
    }
    const record = await transaction((data) => {
      const current = data.notices[key];
      current.state = 'sent';
      current.providerId = accepted.id;
      current.notifiedAt = clock(); // Conservative after crash/replay: wait another 24h.
      current.retryAt = null;
      current.errorCode = null;
      return current;
    });
    return result(record);
  }
  async function ensureNotice(subscription) {
    const captured = snapshot(subscription);
    if (captured.reason) return blocked(captured.reason);
    if (!configured) return blocked(transport && transport.mode !== mode
      ? 'renewal_notice_mode_mismatch' : 'renewal_notice_unconfigured');
    if (clock() < captured.binding.dueAt - leadMs) return blocked('renewal_notice_too_early');
    if (!coordinator.inFlight.has(captured.key)) {
      const promise = dispatch(captured.key, captured.binding).finally(() => coordinator.inFlight.delete(captured.key));
      coordinator.inFlight.set(captured.key, promise);
    }
    const outcome = await coordinator.inFlight.get(captured.key);
    // The billing owner must also reread its store after awaiting this function.
    const current = snapshot(subscription);
    return current.key === captured.key ? outcome : blocked('renewal_notice_subscription_changed');
  }
  return { ensureNotice, configured, mode };
}

module.exports = { createRenewalNotices, noticeError };
