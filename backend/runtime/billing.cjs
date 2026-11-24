const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { isDeepStrictEqual } = require('node:util');
const { isEmail } = require('./email.cjs');
const { createBillingAnalytics, snapshotBilling } = require('./billing-analytics.cjs');

const DAY = 86_400_000;
const RETRY_WINDOW = 23 * 60 * 60 * 1000; // YooKassa retains idempotence keys for 24h.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Preserve old immutable attempts for reconciliation; new input uses SMTP rules.
const LEDGER_EMAIL = /^[^\s@\u0000-\u001f]{1,64}@[^\s@\u0000-\u001f.]+(?:\.[^\s@\u0000-\u001f.]+)+$/;
const RECOVERY = /^[A-Za-z0-9_-]{32}$/;
const DEFAULT_PLAN = Object.freeze({
  id: 'no_ads_30', title: 'Без рекламных пауз', amount: '99.00', currency: 'RUB',
  periodDays: 30, consentVersion: 'no-ads-30-v1',
});

function billingError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
function hashCode(code) { return crypto.createHash('sha256').update(code).digest('hex'); }
function validUser(userId) {
  if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw billingError('billing_bad_user');
}
function cents(amount) {
  return typeof amount === 'string' && /^(?:0|[1-9]\d{0,7})\.\d{2}$/.test(amount) ? Math.round(Number(amount) * 100) : null;
}
function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// This store is independent from progress/profile writes. Run one backend process
// for this JSON store; the queue serializes short read/check/write transactions.
function createYooKassaBilling({ store, gateway, notices, now = () => new Date(), enabled = false, mode = 'test', plan = DEFAULT_PLAN, analyticsOptions = {} }) {
  const currentPlan = { ...DEFAULT_PLAN, ...plan };
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function' ||
      !['test', 'live'].includes(mode) || currentPlan.currency !== 'RUB' || !cents(currentPlan.amount) ||
      !Number.isSafeInteger(currentPlan.periodDays) || currentPlan.periodDays < 1 || currentPlan.periodDays > 365 ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(currentPlan.id) || !/^[A-Za-z0-9_-]{1,64}$/.test(currentPlan.consentVersion)) {
    throw billingError('billing_bad_configuration', 503);
  }
  const configured = Boolean(gateway && ['createPayment', 'getPayment', 'getRefund'].every((key) => typeof gateway[key] === 'function'));
  const noticesConfigured = Boolean(notices && notices.configured === true && notices.mode === mode && typeof notices.ensureNotice === 'function');
  const noticeRequired = mode === 'live' || noticesConfigured;
  const available = enabled === true && configured && (mode === 'test' || noticesConfigured);
  let queue = Promise.resolve();
  let renewalRun = null;
  const inFlight = new Map();
  const recoveryCodes = new Map(); // Never persisted or logged; replay after restart returns null.
  let notificationWindow = 0;
  let notificationCount = 0;

  function clock() { return new Date(now()).getTime(); }
  function read() {
    try {
      const data = store.read();
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          (data.billingVersion !== undefined && data.billingVersion !== 1)) throw new Error('invalid_store');
      for (const key of ['subscriptions', 'attempts', 'requests', 'payments', 'refunds']) {
        if (data.billingVersion === 1 && data[key] === undefined) throw new Error('invalid_store');
        if (data[key] !== undefined && (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))) {
          throw new Error('invalid_store');
        }
        data[key] ??= {};
      }
      data.billingVersion = 1;
      return data;
    } catch { throw billingError('billing_store_unavailable', 503); }
  }
  async function transaction(action) {
    const task = queue.then(() => {
      const data = read();
      const before = snapshotBilling(data);
      const result = action(data);
      analytics.capture(data, before);
      try { store.write(data); } catch { throw billingError('billing_store_unavailable', 503); }
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }
  const analytics = createBillingAnalytics({ ...analyticsOptions, read, transaction, now: clock, mode,
    scope: JSON.stringify(['yookassa', mode]) });
  function requireAvailable() { if (!available) throw billingError('billing_unavailable', 503); }
  function subscriptionFor(data, userId) {
    return Object.values(data.subscriptions).find((sub) => sub.userId === userId) ?? null;
  }
  function renewalBinding(sub) {
    const plan = sub.plan ?? {};
    return hashCode(JSON.stringify([sub.id, sub.userId, sub.mode, sub.activeUntil, sub.email, sub.savedMethodId,
      sub.cancelGeneration, plan.id, plan.title, plan.amount, plan.currency, plan.periodDays, plan.consentVersion]));
  }
  function clearRenewalNotice(sub) {
    sub.renewalPaymentAt = null;
    sub.renewalNoticeBinding = null;
  }
  function publicStatus(data, sub) {
    const time = clock();
    const sameMode = sub?.mode === mode;
    const until = sameMode ? sub.activeUntil ?? null : null;
    const pending = sub?.pendingAttemptId ? data.attempts[sub.pendingAttemptId] : null;
    return {
      active: until !== null && until > time, activeUntil: until,
      autoRenew: sameMode && sub?.autoRenew === true,
      nextPaymentAt: sameMode && sub?.autoRenew === true
        ? (sub.renewalNoticeBinding === renewalBinding(sub) && Number.isSafeInteger(sub.renewalPaymentAt)
          ? Math.max(until ?? 0, sub.renewalPaymentAt) : (noticeRequired && (until ?? 0) <= time ? null : until)) : null,
      pendingPaymentId: sameMode && pending?.state === 'pending' ? pending.paymentId ?? null : null,
      serverTime: time,
    };
  }
  function owner(data, attempt, userId) {
    const sub = data.subscriptions[attempt.subscriptionId];
    if (!sub || sub.userId !== userId) throw billingError('billing_ownership_changed', 409);
    if (sub.mode !== mode) throw billingError('billing_mode_conflict', 409);
    return sub;
  }
  function issueCode(sub) {
    const code = crypto.randomBytes(24).toString('base64url');
    sub.recoveryHash = hashCode(code);
    recoveryCodes.set(sub.id, code);
    return code;
  }
  function findRecovery(data, recoveryCode) {
    if (typeof recoveryCode !== 'string' || !RECOVERY.test(recoveryCode)) throw billingError('billing_bad_recovery_code');
    const expected = Buffer.from(hashCode(recoveryCode), 'hex');
    let match = null;
    for (const sub of Object.values(data.subscriptions)) {
      const actual = Buffer.from(sub.recoveryHash, 'hex');
      if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) match = sub;
    }
    if (!match) throw billingError('billing_recovery_not_found', 404);
    return match;
  }
  function stopRecurring(sub) {
    sub.autoRenew = false;
    sub.savedMethodId = null;
    sub.cancelGeneration += 1;
    clearRenewalNotice(sub);
  }
  function attemptPayload(attempt, savedMethodId) {
    return {
      amount: { value: attempt.amount, currency: 'RUB' }, capture: true,
      description: `${attempt.title} — ${attempt.periodDays} дней`,
      metadata: {
        attempt_id: attempt.id, subscription_id: attempt.subscriptionId,
        user_id: attempt.userId, plan_id: attempt.planId,
      },
      // Email stays in the private subscription for manual NPD receipt issuance.
      // YooKassa's discontinued NPD service and 54-FZ receipts are not enabled here.
      ...(savedMethodId ? { payment_method_id: savedMethodId } : { save_payment_method: true }),
    };
  }
  function validateAttempt(data, id) {
    const attempt = data.attempts[id];
    const sub = data.subscriptions[attempt?.subscriptionId];
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt) || attempt.id !== id || !UUID.test(id) ||
        typeof attempt.subscriptionId !== 'string' || !UUID.test(attempt.subscriptionId) ||
        typeof attempt.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(attempt.userId) ||
        !['test', 'live'].includes(attempt.mode) || !['checkout', 'renewal'].includes(attempt.kind) ||
        !['pending', 'succeeded', 'canceled', 'failed'].includes(attempt.state) || !cents(attempt.amount) ||
        !Number.isSafeInteger(attempt.periodDays) || attempt.periodDays < 1 || attempt.periodDays > 365 ||
        typeof attempt.planId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(attempt.planId) ||
        typeof attempt.consentVersion !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(attempt.consentVersion) ||
        typeof attempt.title !== 'string' || !attempt.title.trim() || attempt.title.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(attempt.title) ||
        typeof attempt.receiptEmail !== 'string' || attempt.receiptEmail.length > 254 || !LEDGER_EMAIL.test(attempt.receiptEmail) ||
        !Number.isSafeInteger(attempt.cancelGeneration) || attempt.cancelGeneration < 0 ||
        !Number.isSafeInteger(attempt.createdAt) || attempt.createdAt < 0 ||
        (attempt.firstSentAt !== null && (!Number.isSafeInteger(attempt.firstSentAt) || attempt.firstSentAt < attempt.createdAt)) ||
        (attempt.paymentId !== null && (typeof attempt.paymentId !== 'string' || !PROVIDER_ID.test(attempt.paymentId))) ||
        (attempt.confirmationUrl !== null && (typeof attempt.confirmationUrl !== 'string' || !httpsUrl(attempt.confirmationUrl))) ||
        (attempt.kind === 'checkout' ? (!UUID.test(attempt.requestId ?? '') || attempt.savedMethodId !== null)
          : (attempt.requestId !== null || typeof attempt.savedMethodId !== 'string' || !PROVIDER_ID.test(attempt.savedMethodId))) ||
        !sub || typeof sub !== 'object' || Array.isArray(sub) || sub.id !== attempt.subscriptionId || sub.mode !== attempt.mode) {
      throw billingError('billing_store_unavailable', 503);
    }
    const expected = attemptPayload(attempt, attempt.savedMethodId);
    // Exact whitelist equality prevents a damaged journal from changing amount,
    // capture, metadata, saved method or adding receipt/confirmation parameters.
    if (!isDeepStrictEqual(attempt.payload, expected)) throw billingError('billing_store_unavailable', 503);
    return expected;
  }
  function agreedTermsMatch(attempt, sub) {
    const plan = sub.plan;
    return plan && plan.id === attempt.planId && plan.title === attempt.title && plan.amount === attempt.amount &&
      plan.currency === 'RUB' && plan.periodDays === attempt.periodDays && plan.consentVersion === attempt.consentVersion;
  }
  function mayPost(attempt, sub) {
    if (!sub || attempt.state !== 'pending' || attempt.mode !== mode || sub.mode !== mode ||
        sub.userId !== attempt.userId || sub.cancelGeneration !== attempt.cancelGeneration ||
        !agreedTermsMatch(attempt, sub) || (attempt.firstSentAt !== null &&
          (clock() < attempt.firstSentAt || clock() - attempt.firstSentAt >= RETRY_WINDOW))) return false;
    if (attempt.kind !== 'renewal') return true;
    if (sub.autoRenew !== true || sub.savedMethodId !== attempt.savedMethodId) return false;
    return !noticeRequired || (Number.isSafeInteger(attempt.renewalNotifiedAt) && attempt.renewalNotifiedAt >= 0 &&
      Number.isSafeInteger(attempt.renewalNotBefore) && attempt.renewalDueAt === sub.activeUntil &&
      attempt.renewalNoticeBinding === renewalBinding(sub) &&
      attempt.renewalNotBefore >= Math.max(attempt.renewalDueAt, attempt.renewalNotifiedAt + DAY) &&
      clock() >= Math.max(attempt.renewalDueAt, attempt.renewalNotBefore, attempt.renewalNotifiedAt + DAY));
  }
  function newAttempt(data, sub, kind, requestId, notice = null) {
    const id = crypto.randomUUID();
    const agreedPlan = kind === 'renewal' ? sub.plan : currentPlan;
    const attempt = {
      id, subscriptionId: sub.id, userId: sub.userId, kind, requestId,
      amount: agreedPlan.amount, periodDays: agreedPlan.periodDays, planId: agreedPlan.id,
      title: agreedPlan.title, consentVersion: agreedPlan.consentVersion, receiptEmail: sub.email,
      cancelGeneration: sub.cancelGeneration, createdAt: clock(), firstSentAt: null,
      state: 'pending', paymentId: null, confirmationUrl: null, mode,
      savedMethodId: kind === 'renewal' ? sub.savedMethodId : null,
      ...(notice ? { renewalDueAt: sub.activeUntil, renewalNoticeBinding: renewalBinding(sub),
        renewalNotifiedAt: notice.notifiedAt, renewalNotBefore: notice.notBefore } : {}),
    };
    attempt.payload = attemptPayload(attempt, attempt.savedMethodId);
    data.attempts[id] = attempt;
    sub.pendingAttemptId = id;
    if (requestId) data.requests[requestId] = id;
    return id;
  }
  function validatePayment(payment, attempt) {
    const metadata = payment?.metadata;
    if (!payment || attempt.mode !== mode || !PROVIDER_ID.test(payment.id ?? '') || payment.test !== (mode === 'test') ||
        payment.amount?.value !== attempt.amount || payment.amount?.currency !== 'RUB' ||
        metadata?.attempt_id !== attempt.id || metadata.subscription_id !== attempt.subscriptionId ||
        metadata.user_id !== attempt.userId || metadata.plan_id !== attempt.planId ||
        (attempt.paymentId && attempt.paymentId !== payment.id)) {
      throw billingError('billing_payment_mismatch', 409);
    }
    if (!['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(payment.status) ||
        (payment.status === 'succeeded' && payment.paid !== true)) throw billingError('billing_payment_unverified', 409);
  }
  async function applyPayment(attemptId, payment) {
    return transaction((data) => {
      const attempt = data.attempts[attemptId];
      validatePayment(payment, attempt);
      const sub = data.subscriptions[attempt.subscriptionId];
      const previous = data.payments[payment.id];
      if (previous && previous.attemptId !== attemptId) throw billingError('billing_payment_conflict', 409);
      attempt.paymentId = payment.id;
      const confirmation = httpsUrl(payment.confirmation?.confirmation_url);
      if (confirmation) attempt.confirmationUrl = confirmation;
      if (payment.status === 'succeeded' && !previous) {
        // Observation time is authoritative; no expiry is accepted from client or metadata.
        const start = Math.max(sub.activeUntil ?? 0, clock());
        const end = start + attempt.periodDays * DAY;
        data.payments[payment.id] = { attemptId, subscriptionId: sub.id, periodStart: start, periodEnd: end,
          amountCents: cents(attempt.amount), refundedCents: 0, revokedMs: 0, mode,
          receiptEmail: attempt.receiptEmail, receiptStatus: 'pending_manual' };
        sub.activeUntil = end;
        clearRenewalNotice(sub);
        if (attempt.kind === 'checkout') {
          const saved = payment.payment_method?.saved === true && PROVIDER_ID.test(payment.payment_method.id ?? '');
          if (saved && sub.cancelGeneration === attempt.cancelGeneration) {
            sub.savedMethodId = payment.payment_method.id;
            sub.autoRenew = true;
          } else { sub.savedMethodId = null; sub.autoRenew = false; }
        }
        attempt.state = 'succeeded';
      } else if (payment.status === 'canceled' && attempt.state !== 'succeeded') {
        attempt.state = 'canceled';
        if (attempt.kind === 'renewal') {
          attempt.errorCode = 'billing_payment_canceled';
          stopRecurring(sub);
        }
      }
      if (attempt.state !== 'pending' && sub.pendingAttemptId === attemptId) sub.pendingAttemptId = null;
      return publicStatus(data, sub);
    });
  }
  function safeProviderError(error) {
    const code = ['billing_gateway_unavailable', 'billing_gateway_rejected', 'billing_gateway_invalid_response'].includes(error?.code)
      ? error.code : 'billing_gateway_unavailable';
    const safe = billingError(code, 503);
    safe.retryable = error?.retryable !== false;
    safe.ambiguous = error?.ambiguous !== false;
    return safe;
  }
  async function performAttempt(attemptId) {
    let attempt = read().attempts[attemptId];
    if (!attempt || attempt.state !== 'pending') return;
    if (attempt.mode !== mode) return;
    if (!attempt.paymentId) {
      if (!available) return; // Paused sales may verify existing IDs, never create new charges.
      const dispatch = await transaction((data) => {
        const current = data.attempts[attemptId];
        validateAttempt(data, attemptId);
        const sub = data.subscriptions[current.subscriptionId];
        if (current.state !== 'pending') return false;
        if (sub.cancelGeneration !== current.cancelGeneration) {
          if (current.firstSentAt === null) {
            current.state = 'canceled';
            if (sub.pendingAttemptId === attemptId) sub.pendingAttemptId = null;
          }
          return false; // Never POST an unknown charge again after cancellation.
        }
        if (current.kind === 'renewal' && noticeRequired &&
            (!Number.isSafeInteger(current.renewalNotifiedAt) || !Number.isSafeInteger(current.renewalNotBefore) ||
             current.renewalDueAt !== sub.activeUntil || current.renewalNoticeBinding !== renewalBinding(sub) ||
             sub.autoRenew !== true || current.payload.payment_method_id !== sub.savedMethodId ||
             clock() < Math.max(current.renewalDueAt, current.renewalNotBefore, current.renewalNotifiedAt + DAY))) {
          current.errorCode = 'billing_renewal_notice_required';
          if (current.firstSentAt === null) {
            current.state = 'canceled';
            if (sub.pendingAttemptId === current.id) sub.pendingAttemptId = null;
          }
          return false;
        }
        if (current.firstSentAt !== null && clock() - current.firstSentAt >= RETRY_WINDOW) {
          current.errorCode = 'billing_manual_reconciliation_required';
          if (current.kind === 'renewal') stopRecurring(sub);
          return false;
        }
        if (!mayPost(current, sub)) return false;
        const firstDispatch = current.firstSentAt === null;
        if (firstDispatch) current.firstSentAt = clock();
        return { firstDispatch };
      });
      if (!dispatch) return;
      // A queued cancellation can finish while the reservation transaction is
      // awaited. Reread both records synchronously immediately before POST.
      const latest = read();
      attempt = latest.attempts[attemptId];
      const payload = validateAttempt(latest, attemptId);
      if (!mayPost(attempt, latest.subscriptions[attempt.subscriptionId])) {
        if (dispatch.firstDispatch) {
          await transaction((data) => {
            const current = data.attempts[attemptId];
            if (current.state === 'pending' && !current.paymentId) {
              current.state = 'canceled';
              const sub = data.subscriptions[current.subscriptionId];
              if (sub.pendingAttemptId === attemptId) sub.pendingAttemptId = null;
            }
          });
        }
        return;
      }
      let created;
      // No await between the final eligibility check and the provider call.
      try { created = await gateway.createPayment(payload, attempt.id); } catch (error) {
        const safe = safeProviderError(error);
        await transaction((data) => {
          const current = data.attempts[attemptId];
          if (current.state !== 'pending') return;
          current.errorCode = safe.code;
          // Unknown network/5xx outcomes remain durable. Definitive rejection stops
          // renewal, avoiding repeated decline or configuration-error charges.
          if (!safe.retryable && !safe.ambiguous && !current.paymentId) {
            current.state = 'failed';
            const sub = data.subscriptions[current.subscriptionId];
            if (sub.pendingAttemptId === attemptId) sub.pendingAttemptId = null;
            if (current.kind === 'renewal') stopRecurring(sub);
          }
        });
        throw safe;
      }
      if (!PROVIDER_ID.test(created?.id ?? '')) throw billingError('billing_gateway_invalid_response', 503);
      await transaction((data) => {
        const current = data.attempts[attemptId];
        if (current.paymentId && current.paymentId !== created.id) throw billingError('billing_payment_conflict', 409);
        current.paymentId = created.id;
      });
    }
    attempt = read().attempts[attemptId];
    let payment;
    try { payment = await gateway.getPayment(attempt.paymentId); } catch (error) { throw safeProviderError(error); }
    await applyPayment(attemptId, payment);
  }
  function reconcile(attemptId) {
    if (!attemptId || !configured) return Promise.resolve();
    if (inFlight.has(attemptId)) return inFlight.get(attemptId);
    const work = performAttempt(attemptId).finally(() => inFlight.delete(attemptId));
    inFlight.set(attemptId, work);
    return work;
  }
  async function status(userId) {
    validUser(userId);
    let data = read();
    const sub = subscriptionFor(data, userId);
    if (sub?.pendingAttemptId && configured) {
      try { await reconcile(sub.pendingAttemptId); } catch (error) {
        if (![503].includes(error.status)) throw error;
      }
      data = read();
    }
    return publicStatus(data, subscriptionFor(data, userId));
  }
  async function checkout(userId, { requestId, consentVersion, email } = {}) {
    requireAvailable();
    validUser(userId);
    if (typeof requestId !== 'string' || !UUID.test(requestId)) throw billingError('billing_bad_request_id');
    if (consentVersion !== currentPlan.consentVersion) throw billingError('billing_consent_required');
    const attemptId = await transaction((data) => {
      if (data.requests[requestId]) {
        const attempt = data.attempts[data.requests[requestId]];
        owner(data, attempt, userId);
        return attempt.id;
      }
      let sub = subscriptionFor(data, userId);
      if (sub && sub.mode !== mode) throw billingError('billing_mode_conflict', 409);
      if (sub?.pendingAttemptId) {
        data.requests[requestId] = sub.pendingAttemptId;
        return sub.pendingAttemptId;
      }
      if (!isEmail(email)) throw billingError('billing_receipt_email_required');
      if (sub && (sub.autoRenew || (sub.activeUntil ?? 0) > clock())) throw billingError('billing_already_subscribed', 409);
      if (!sub) {
        const id = crypto.randomUUID();
        sub = { id, userId, email, mode, activeUntil: null, autoRenew: false, savedMethodId: null,
          pendingAttemptId: null, cancelGeneration: 0 };
        issueCode(sub);
        data.subscriptions[id] = sub;
      }
      sub.email = email;
      sub.plan = { ...currentPlan };
      clearRenewalNotice(sub);
      return newAttempt(data, sub, 'checkout', requestId);
    });
    await reconcile(attemptId);
    const data = read();
    const attempt = data.attempts[attemptId];
    const sub = owner(data, attempt, userId);
    if (attempt.state === 'failed' || attempt.state === 'canceled') throw billingError('billing_checkout_canceled', 409);
    if (!attempt.paymentId || (!attempt.confirmationUrl && attempt.state !== 'succeeded')) {
      throw billingError(attempt.errorCode === 'billing_manual_reconciliation_required' ? attempt.errorCode : 'billing_payment_pending', 503);
    }
    return { ...publicStatus(data, sub), paymentId: attempt.paymentId,
      confirmationUrl: attempt.confirmationUrl, recoveryCode: recoveryCodes.get(sub.id) ?? null };
  }
  async function cancel(userId) {
    validUser(userId);
    return transaction((data) => {
      const sub = subscriptionFor(data, userId);
      if (sub) stopRecurring(sub);
      return publicStatus(data, sub);
    });
  }
  async function updateEmail(userId, { email } = {}) {
    validUser(userId);
    if (!isEmail(email)) throw billingError('billing_receipt_email_required');
    return transaction((data) => {
      const sub = subscriptionFor(data, userId);
      if (!sub) throw billingError('billing_subscription_not_found', 404);
      if (sub.mode !== mode) throw billingError('billing_mode_conflict', 409);
      if (sub.email === email) return publicStatus(data, sub);
      // A dispatched or uncertain payment keeps its frozen receipt contact and
      // idempotency payload. Reconcile it before allowing contact changes.
      if (sub.pendingAttemptId) throw billingError('billing_email_change_pending', 409);
      sub.email = email;
      // Also invalidate prior notices if the player later switches back to an
      // earlier address. No payment is pending, so no frozen attempt is changed.
      sub.cancelGeneration += 1;
      clearRenewalNotice(sub);
      return publicStatus(data, sub);
    });
  }
  async function recovery(userId) {
    validUser(userId);
    return transaction((data) => {
      const sub = subscriptionFor(data, userId);
      if (!sub) throw billingError('billing_subscription_not_found', 404);
      return { recoveryCode: issueCode(sub) };
    });
  }
  async function restore(userId, { recoveryCode } = {}) {
    validUser(userId);
    return transaction((data) => {
      const sub = findRecovery(data, recoveryCode);
      const existing = subscriptionFor(data, userId);
      if (existing && existing.id !== sub.id) throw billingError('billing_restore_conflict', 409);
      sub.userId = userId;
      return publicStatus(data, sub);
    });
  }
  async function manage({ recoveryCode, action } = {}) {
    if (!['status', 'cancel'].includes(action)) throw billingError('billing_bad_manage_action');
    return transaction((data) => {
      const sub = findRecovery(data, recoveryCode);
      if (action === 'cancel') stopRecurring(sub);
      return publicStatus(data, sub);
    });
  }
  function notificationBudget() {
    const minute = Math.floor(clock() / 60_000);
    if (notificationWindow !== minute) { notificationWindow = minute; notificationCount = 0; }
    if (++notificationCount > 120) throw billingError('billing_notification_rate_limited', 429);
  }
  async function refundNotification(body) {
    const refundId = body.object.id;
    let data = read();
    if (data.refunds[refundId]) return { ok: true };
    const paymentId = body.object.payment_id;
    const known = Object.values(data.attempts).find((attempt) => attempt.paymentId === paymentId);
    if (!known) return { ok: true, ignored: true };
    notificationBudget();
    let refund;
    let payment;
    try {
      refund = await gateway.getRefund(refundId);
      payment = await gateway.getPayment(paymentId);
    } catch (error) { throw safeProviderError(error); }
    if (refund?.id !== refundId || refund.payment_id !== paymentId || refund.status !== 'succeeded' ||
        refund.amount?.currency !== 'RUB' || !cents(refund.amount?.value) || cents(refund.amount.value) > cents(known.amount)) {
      throw billingError('billing_refund_unverified', 409);
    }
    await applyPayment(known.id, payment);
    return transaction((current) => {
      if (current.refunds[refundId]) return { ok: true };
      const grant = current.payments[paymentId];
      if (!grant) throw billingError('billing_refund_unverified', 409);
      const amount = cents(refund.amount.value);
      if (grant.refundedCents + amount > grant.amountCents) throw billingError('billing_refund_amount_mismatch', 409);
      grant.refundedCents += amount;
      const desired = Math.round(known.periodDays * DAY * grant.refundedCents / grant.amountCents);
      const effectiveEnd = grant.periodEnd - grant.revokedMs;
      const remaining = Math.max(0, effectiveEnd - Math.max(clock(), grant.periodStart));
      const revoked = Math.min(Math.max(0, desired - grant.revokedMs), remaining);
      // Partial refunds revoke the proportional, unconsumed part of this purchase.
      // Later paid periods move back by the same duration; already consumed access
      // or unrelated purchases are never revoked.
      grant.revokedMs += revoked;
      for (const other of Object.values(current.payments)) {
        if (other.subscriptionId === grant.subscriptionId && other !== grant && other.periodStart >= effectiveEnd) {
          other.periodStart -= revoked;
          other.periodEnd -= revoked;
        }
      }
      const sub = current.subscriptions[grant.subscriptionId];
      sub.activeUntil = (sub.activeUntil ?? 0) - revoked;
      stopRecurring(sub);
      current.refunds[refundId] = { paymentId, amountCents: amount, revokedMs: revoked, verifiedAt: clock() };
      return { ok: true };
    });
  }
  async function webhook(body) {
    if (!configured) throw billingError('billing_unavailable', 503);
    if (!body || body.type !== 'notification' || !['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture', 'refund.succeeded'].includes(body.event) ||
        !body.object || typeof body.object.id !== 'string' || !PROVIDER_ID.test(body.object.id)) throw billingError('billing_bad_notification');
    if (body.event === 'refund.succeeded') return refundNotification(body);
    const data = read();
    const paymentId = body.object.id;
    let attempt = Object.values(data.attempts).find((item) => item.paymentId === paymentId);
    if (!attempt) {
      const candidate = data.attempts[body.object.metadata?.attempt_id];
      if (candidate?.state === 'pending' && !candidate.paymentId) attempt = candidate;
    }
    if (!attempt) return { ok: true, ignored: true };
    if (data.payments[paymentId] || attempt.state === 'canceled') return { ok: true };
    notificationBudget();
    let payment;
    try { payment = await gateway.getPayment(paymentId); } catch (error) { throw safeProviderError(error); }
    if (payment?.id !== paymentId) throw billingError('billing_payment_mismatch', 409);
    await applyPayment(attempt.id, payment);
    return { ok: true };
  }
  async function renewals() {
    requireAvailable();
    const pendingIds = Object.values(read().attempts).filter((attempt) => attempt.state === 'pending').map((attempt) => attempt.id);
    let failures = 0;
    let blockedNotices = 0;
    for (const id of pendingIds) {
      try { await reconcile(id); } catch { failures += 1; }
    }
    const candidates = Object.values(read().subscriptions).filter((sub) => sub.mode === mode && sub.autoRenew &&
      sub.savedMethodId && Number.isSafeInteger(sub.activeUntil) && !sub.pendingAttemptId &&
      sub.activeUntil <= clock() + (noticeRequired ? 3 * DAY : 0));
    const ids = [];
    for (const captured of candidates) {
      const binding = renewalBinding(captured);
      let notice = null;
      if (noticeRequired) {
        try { notice = await notices.ensureNotice(captured); } catch { failures += 1; continue; }
        if (notice?.ready !== true && !['renewal_notice_waiting', 'renewal_notice_too_early',
          'renewal_notice_cancelled', 'renewal_notice_subscription_changed'].includes(notice?.reason)) blockedNotices += 1;
      }
      const id = await transaction((data) => {
        const sub = data.subscriptions[captured.id];
        // Notice I/O happens outside the billing transaction. Cancellation,
        // restore, refund or any agreed-term change must win before reservation.
        if (!sub || sub.autoRenew !== true || !sub.savedMethodId || sub.pendingAttemptId ||
            sub.mode !== mode || renewalBinding(sub) !== binding) return null;
        if (noticeRequired) {
          if (!Number.isSafeInteger(notice?.notifiedAt) || !Number.isSafeInteger(notice?.notBefore) ||
              notice.notifiedAt < 0 || notice.notifiedAt > clock() ||
              notice.notBefore < Math.max(sub.activeUntil, notice.notifiedAt + DAY)) return null;
          sub.renewalPaymentAt = notice.notBefore;
          sub.renewalNoticeBinding = binding;
          if (notice.ready !== true || clock() < Math.max(sub.activeUntil, notice.notBefore, notice.notifiedAt + DAY)) return null;
        } else if (sub.activeUntil > clock()) return null;
        return newAttempt(data, sub, 'renewal', null, notice);
      });
      if (id) ids.push(id);
    }
    for (const id of ids) {
      try { await reconcile(id); } catch { failures += 1; }
    }
    return { attempted: ids.length, reconciled: pendingIds.length, failures, blockedNotices };
  }
  function runRenewals() {
    if (renewalRun) return renewalRun;
    renewalRun = renewals().finally(() => { renewalRun = null; });
    return renewalRun;
  }
  // Process-local operator view only: aggregate counts, never contacts or IDs.
  function diagnostics() {
    const data = read();
    const subscriptions = Object.values(data.subscriptions).filter((sub) => sub.mode === mode);
    const attempts = Object.values(data.attempts).filter((attempt) => attempt.mode === mode);
    const latest = new Map();
    for (const attempt of attempts) latest.set(attempt.subscriptionId, attempt);
    return {
      pendingPayments: attempts.filter((attempt) => attempt.state === 'pending').length,
      // Operational alert after 24h, including known provider IDs. This is not
      // a payment expiry: only provider confirmation resolves the attempt.
      stalePendingPayments: attempts.filter((attempt) => attempt.state === 'pending' &&
        Number.isSafeInteger(attempt.createdAt) && clock() - attempt.createdAt >= DAY).length,
      failedPayments: [...latest.values()].filter((attempt) => attempt.state === 'failed' ||
        (attempt.kind === 'renewal' && attempt.state === 'canceled' && attempt.errorCode === 'billing_payment_canceled')).length,
      manualReconciliationPayments: attempts.filter((attempt) => attempt.state === 'pending' &&
        (attempt.errorCode === 'billing_manual_reconciliation_required' || (!attempt.paymentId &&
          attempt.firstSentAt !== null && clock() - attempt.firstSentAt >= RETRY_WINDOW))).length,
      overdueSubscriptions: subscriptions.filter((sub) => sub.autoRenew && (sub.activeUntil ?? Infinity) <= clock()).length,
      invalidEmails: subscriptions.filter((sub) => !isEmail(sub.email)).length,
      notices: typeof notices?.diagnostics === 'function' ? notices.diagnostics(subscriptions)
        : { pending: 0, failed: 0, quarantined: 0 },
    };
  }
  return { catalog: () => ({ available: Boolean(available), mode, plan: { ...currentPlan } }),
    status, checkout, cancel, updateEmail, recovery, restore, manage, webhook, runRenewals, diagnostics,
    setAnalyticsBinding: (userId, input) => { validUser(userId); return analytics.bind(userId, input); },
    flushAnalytics: analytics.flush, analyticsDiagnostics: analytics.diagnostics,
    reconcileAnalyticsImport: analytics.reconcileImport };
}

function createBilling(options) {
  if (options.provider === 'robokassa' || options.gateway?.identity?.provider === 'robokassa') {
    return require('./billing-robokassa.cjs').createRobokassaBilling(options);
  }
  return createYooKassaBilling(options);
}

module.exports = { createBilling, billingError, DEFAULT_PLAN };
