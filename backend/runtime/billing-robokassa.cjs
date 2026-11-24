const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { isDeepStrictEqual } = require('node:util');
const { billingError, DEFAULT_PLAN } = require('./billing.cjs');
const { isEmail } = require('./email.cjs');
const { createBillingAnalytics, snapshotBilling } = require('./billing-analytics.cjs');

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVOICE = /^[1-9]\d{0,15}$/;
const PROTOCOL = 'robokassa-v3';
const SEPARATE_CONSENT_FIELDS = ['recurringConsented', 'personalDataConsented',
  'userAgreementVersion', 'personalDataConsentVersion', 'personalDataConsentText'];
// Published wording/version tuples are immutable: change consentVersion when
// consent text or the applicable offer/privacy versions change.
const PLAN = Object.freeze({ ...DEFAULT_PLAN,
  consentVersion: 'no-ads-30-robokassa-v3', termsVersion: 'no-ads-30-robokassa-v3', privacyVersion: 'subscription-privacy-v2',
  consentText: 'Я согласен на автоматические списания согласно условиям оферты',
  userAgreementVersion: 'subscription-user-agreement-v1', personalDataConsentVersion: 'subscription-personal-data-v1',
  personalDataConsentText: 'Я согласен на обработку персональных данных',
});
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const validUser = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw billingError('billing_bad_user');
};
const invoice = (value) => typeof value === 'string' && INVOICE.test(value) && Number.isSafeInteger(Number(value));
const safeError = (error) => ['billing_gateway_unavailable', 'billing_gateway_rejected', 'billing_gateway_invalid_response',
  'billing_provider_amount_mismatch'].includes(error?.code) ? error.code : 'billing_gateway_unavailable';

// Deliberately separate from the legacy YooKassa journal. No ID, saved method,
// idempotency guarantee or test payment is portable between provider accounts.
function createRobokassaBilling({ store, gateway, notices, merchantLogin = gateway?.identity?.merchant ?? '',
  mode = 'test', enabled = false, now = () => new Date(), analyticsOptions = {} }) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function' ||
    !['test', 'live'].includes(mode) || typeof merchantLogin !== 'string' ||
    (merchantLogin && !/^[A-Za-z0-9_.-]{1,100}$/.test(merchantLogin))) throw billingError('billing_bad_configuration', 503);
  const identity = { provider: 'robokassa', merchant: merchantLogin, mode };
  // Robokassa invoice IDs share a merchant namespace across TEST and LIVE.
  // Keep isolated journals but reserve even IDs for test and odd IDs for live.
  const firstInvoiceId = mode === 'test' ? 2 : 1;
  const modeInvoice = (value) => invoice(value) && Number(value) % 2 === firstInvoiceId % 2;
  const configured = Boolean(merchantLogin && gateway && isDeepStrictEqual(gateway.identity, identity) &&
    ['prepareCheckout', 'submitRenewal', 'lookupPayment', 'verifyResult'].every((key) => typeof gateway[key] === 'function'));
  const noticeReady = notices?.configured === true && notices.mode === mode && typeof notices.ensureNotice === 'function';
  const available = enabled === true && configured && (mode === 'test' || (noticeReady && gateway.capabilities?.recurring === true));
  let queue = Promise.resolve();
  let renewalRun;
  const lookups = new Map();
  const codes = new Map();
  const clock = () => {
    const value = new Date(now()).getTime();
    if (!Number.isSafeInteger(value) || value < 0) throw billingError('billing_bad_clock', 503);
    return value;
  };
  function read() {
    try {
      const data = store.read();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      if (!Object.keys(data).length || (Object.keys(data).length === 1 && data.users && !Object.keys(data.users).length)) {
        return { billingVersion: 2, identity: { ...identity }, nextInvoiceId: firstInvoiceId,
          subscriptions: {}, attempts: {}, requests: {}, payments: {}, refunds: {}, consentEvents: [] };
      }
      if (data.billingVersion !== 2 || !isDeepStrictEqual(data.identity, identity) ||
        !Number.isSafeInteger(data.nextInvoiceId) || !modeInvoice(String(data.nextInvoiceId))) throw new Error();
      for (const key of ['subscriptions', 'attempts', 'requests', 'payments', 'refunds']) {
        if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw new Error();
      }
      // Existing v2 journals did not record consent text. Do not fabricate past
      // acceptance events or silently label their old terms as the current ones.
      if (data.consentEvents === undefined) data.consentEvents = [];
      if (!Array.isArray(data.consentEvents)) throw new Error();
      const consentIds = new Set();
      for (const event of data.consentEvents) {
        if (!event || !UUID.test(event.id ?? '') || consentIds.has(event.id) || !['accepted', 'canceled'].includes(event.type) ||
          !Number.isSafeInteger(event.timestamp) || event.timestamp < 0 || typeof event.userId !== 'string' ||
          !UUID.test(event.subscriptionId ?? '') || !event.plan || typeof event.consentVersion !== 'string' ||
          (event.consentText !== null && typeof event.consentText !== 'string') ||
          (event.type === 'accepted' && (event.consentId !== event.id || !event.consentText || !event.termsVersion || !event.privacyVersion))) throw new Error();
        if (event.consentVersion === 'no-ads-30-robokassa-v3' || SEPARATE_CONSENT_FIELDS.some((key) => Object.hasOwn(event, key))) {
          if (event.recurringConsented !== true || event.personalDataConsented !== true ||
            ['userAgreementVersion', 'personalDataConsentVersion', 'personalDataConsentText'].some((key) =>
              typeof event[key] !== 'string' || !event[key])) throw new Error();
        }
        consentIds.add(event.id);
      }
      const invoiceIds = new Set();
      for (const attempt of Object.values(data.attempts)) {
        if (!modeInvoice(attempt?.invoiceId) || invoiceIds.has(attempt.invoiceId) ||
          Number(attempt.invoiceId) >= data.nextInvoiceId ||
          (attempt.previousInvoiceId != null && !modeInvoice(attempt.previousInvoiceId))) throw new Error();
        invoiceIds.add(attempt.invoiceId);
      }
      for (const sub of Object.values(data.subscriptions)) {
        if (sub?.savedMethodId != null && !modeInvoice(sub.savedMethodId)) throw new Error();
        if (sub?.consentId != null && !data.consentEvents.some((event) => event.id === sub.consentId && event.type === 'accepted' && event.subscriptionId === sub.id)) throw new Error();
      }
      for (const [id, payment] of Object.entries(data.payments)) {
        if (!modeInvoice(id) || payment?.invoiceId !== id || !invoiceIds.has(id)) throw new Error();
      }
      for (const refund of Object.values(data.refunds)) {
        if (!modeInvoice(refund?.invoiceId) || !invoiceIds.has(refund.invoiceId)) throw new Error();
      }
      return data;
    } catch { throw billingError('billing_store_unavailable', 503); }
  }
  function transaction(action) {
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
    scope: JSON.stringify(identity) });
  const subFor = (data, userId) => Object.values(data.subscriptions).find((sub) => sub.userId === userId);
  const binding = (sub) => hash(JSON.stringify([identity, sub.id, sub.userId, sub.email, sub.activeUntil,
    sub.cancelGeneration, sub.savedMethodId, sub.plan]));
  function clearNotice(sub) { sub.renewalPaymentAt = null; sub.renewalNoticeBinding = null; }
  function consentDocuments(source) {
    return { consentVersion: source.consentVersion, consentText: source.consentText ?? null,
      termsVersion: source.termsVersion ?? null, privacyVersion: source.privacyVersion ?? null,
      ...Object.fromEntries(['userAgreementVersion', 'personalDataConsentVersion', 'personalDataConsentText']
        .filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])) };
  }
  function consentSnapshot(plan) {
    return { plan: { id: plan.id, title: plan.title, amount: plan.amount, currency: plan.currency, periodDays: plan.periodDays },
      ...consentDocuments(plan) };
  }
  function acceptConsent(data, sub, attempt, input) {
    const id = crypto.randomUUID();
    data.consentEvents.push({ id, type: 'accepted', source: 'checkout', timestamp: clock(), ...identity,
      userId: sub.userId, subscriptionId: sub.id, requestId: attempt.requestId, attemptId: attempt.id, consentId: id,
      ...consentSnapshot(attempt.plan), recurringConsented: input.recurringConsented, personalDataConsented: input.personalDataConsented });
    sub.consentId = id;
    attempt.consentId = id;
  }
  function stopRecurring(data, sub, source, triggerAttempt) {
    const accepted = data.consentEvents.find((event) => event.id === sub.consentId && event.type === 'accepted');
    const original = accepted ? data.attempts[accepted.attemptId]
      : Object.values(data.attempts).filter((attempt) => attempt.subscriptionId === sub.id && attempt.kind === 'checkout').at(-1);
    const consentId = accepted?.id ?? null;
    // Repeated cancellation requests are not a new consent decision. The next
    // subscription has a new acceptance ID, so it gets its own revocation event.
    if (original && !data.consentEvents.some((event) => event.type === 'canceled' && event.subscriptionId === sub.id &&
      event.consentId === consentId && event.acceptedAttemptId === original.id)) {
      const snapshot = accepted ? { plan: { ...accepted.plan }, ...consentDocuments(accepted),
        ...Object.fromEntries(['recurringConsented', 'personalDataConsented'].filter((key) => Object.hasOwn(accepted, key))
          .map((key) => [key, accepted[key]])) }
        : consentSnapshot(original.plan);
      data.consentEvents.push({ id: crypto.randomUUID(), type: 'canceled', source, timestamp: clock(), ...identity,
        userId: sub.userId, subscriptionId: sub.id, requestId: original.requestId,
        attemptId: triggerAttempt?.id ?? original.id, acceptedAttemptId: original.id, consentId,
        cancellationScope: 'recurring', ...snapshot });
    }
    sub.autoRenew = false;
    sub.savedMethodId = null;
    sub.cancelGeneration += 1;
    clearNotice(sub);
  }
  function publicStatus(data, sub) {
    const time = clock();
    const pending = sub?.pendingAttemptId ? data.attempts[sub.pendingAttemptId] : null;
    return { active: (sub?.activeUntil ?? 0) > time, activeUntil: sub?.activeUntil ?? null,
      autoRenew: sub?.autoRenew === true,
      nextPaymentAt: sub?.autoRenew === true ? (sub.renewalNoticeBinding === binding(sub) && Number.isSafeInteger(sub.renewalPaymentAt)
        ? Math.max(sub.activeUntil ?? 0, sub.renewalPaymentAt) : ((sub.activeUntil ?? 0) > time ? sub.activeUntil : null)) : null,
      pendingPaymentId: pending?.state === 'pending' ? pending.invoiceId : null, serverTime: time };
  }
  function issueCode(sub) {
    const code = crypto.randomBytes(24).toString('base64url');
    sub.recoveryHash = hash(code);
    codes.set(sub.id, code);
    return code;
  }
  function findRecovery(data, code) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(code)) throw billingError('billing_bad_recovery_code');
    const expected = Buffer.from(hash(code), 'hex');
    const sub = Object.values(data.subscriptions).find((item) => {
      const actual = Buffer.from(item.recoveryHash ?? '', 'hex');
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    });
    if (!sub) throw billingError('billing_recovery_not_found', 404);
    return sub;
  }
  function owner(data, attempt, userId) {
    const sub = data.subscriptions[attempt?.subscriptionId];
    if (!sub || sub.userId !== userId) throw billingError('billing_ownership_changed', 409);
    return sub;
  }
  function validateAttempt(data, id) {
    const a = data.attempts[id];
    const sub = data.subscriptions[a?.subscriptionId];
    if (!a || a.id !== id || !UUID.test(id) || !sub || !invoice(a.invoiceId) || a.provider !== identity.provider ||
      a.merchant !== identity.merchant || a.mode !== mode || a.currency !== 'RUB' || !Number.isSafeInteger(a.amountMinor) ||
      a.amountMinor < 1 || !isEmail(a.buyerEmail) || !['checkout', 'renewal'].includes(a.kind) || a.recurring !== true ||
      !['pending', 'succeeded', 'canceled', 'failed'].includes(a.state) || !Number.isSafeInteger(a.periodDays) ||
      a.periodDays < 1 || a.periodDays > 365 || !Number.isSafeInteger(a.createdAt) ||
      !Number.isSafeInteger(a.cancelGeneration) || (a.firstSentAt !== null && !Number.isSafeInteger(a.firstSentAt)) ||
      (a.kind === 'renewal' ? !invoice(a.previousInvoiceId) : a.previousInvoiceId !== null) ||
      !a.plan || a.description !== `${a.plan.title} — ${a.periodDays} дней` || a.plan.periodDays !== a.periodDays ||
      Math.round(Number(a.plan.amount) * 100) !== a.amountMinor || a.plan.currency !== 'RUB') {
      throw billingError('billing_store_unavailable', 503);
    }
    if (a.consentId != null) {
      const accepted = data.consentEvents.find((event) => event.id === a.consentId && event.type === 'accepted');
      if (!accepted || accepted.subscriptionId !== a.subscriptionId || !isDeepStrictEqual(consentSnapshot(a.plan), {
        plan: accepted.plan, ...consentDocuments(accepted),
      })) throw billingError('billing_store_unavailable', 503);
    }
    return a;
  }
  function newAttempt(data, sub, kind, requestId, notice) {
    if (data.nextInvoiceId > Number.MAX_SAFE_INTEGER - 2) throw billingError('billing_store_unavailable', 503);
    const invoiceId = String(data.nextInvoiceId);
    data.nextInvoiceId += 2;
    if (Object.values(data.attempts).some((a) => a.invoiceId === invoiceId)) throw billingError('billing_store_unavailable', 503);
    const a = { ...identity, id: crypto.randomUUID(), invoiceId, subscriptionId: sub.id, userId: sub.userId,
      kind, requestId, amountMinor: Math.round(Number(sub.plan.amount) * 100), currency: 'RUB', buyerEmail: sub.email,
      description: `${sub.plan.title} — ${sub.plan.periodDays} дней`, periodDays: sub.plan.periodDays, plan: { ...sub.plan },
      previousInvoiceId: kind === 'renewal' ? sub.savedMethodId : null, recurring: true,
      consentId: sub.consentId ?? null,
      createdAt: clock(), cancelGeneration: sub.cancelGeneration, firstSentAt: null, acceptedAt: null, state: 'pending',
      confirmationUrl: null, ...(notice ? { notice: { ...notice }, renewalBinding: binding(sub) } : {}) };
    data.attempts[a.id] = a;
    sub.pendingAttemptId = a.id;
    if (requestId) data.requests[requestId] = a.id;
    return a;
  }
  function validatePayment(a, payment) {
    if (!payment || payment.provider !== identity.provider || payment.merchant !== identity.merchant || payment.mode !== mode ||
      payment.invoiceId !== a.invoiceId || payment.currency !== 'RUB' || !['pending', 'succeeded', 'canceled'].includes(payment.status) ||
      !['signed_result', 'authenticated_status', ...(mode === 'test' ? ['test_pending'] : [])].includes(payment.evidence) ||
      (payment.status === 'succeeded' && (payment.amountMinor !== a.amountMinor || payment.evidence === 'test_pending')) ||
      (payment.amountMinor !== null && payment.amountMinor !== a.amountMinor)) throw billingError('billing_payment_mismatch', 409);
  }
  function applyPayment(id, payment) {
    return transaction((data) => {
      const a = validateAttempt(data, id);
      validatePayment(a, payment);
      const sub = data.subscriptions[a.subscriptionId];
      let grant = data.payments[a.invoiceId];
      if (grant && grant.attemptId !== id) throw billingError('billing_payment_conflict', 409);
      if (payment.status === 'succeeded') {
        if (!grant) {
          const start = Math.max(sub.activeUntil ?? 0, clock());
          grant = { attemptId: id, subscriptionId: sub.id, invoiceId: a.invoiceId, amountMinor: a.amountMinor,
            periodStart: start, periodEnd: start + a.periodDays * DAY, refundedMinor: 0, revokedMs: 0,
            receiptEmail: a.buyerEmail, receiptStatus: mode === 'test' ? 'test' : 'awaiting_provider_receipt' };
          data.payments[a.invoiceId] = grant;
          sub.activeUntil = grant.periodEnd;
          clearNotice(sub);
          if (a.kind === 'checkout' && sub.cancelGeneration === a.cancelGeneration && mode === 'live' && gateway.capabilities.recurring) {
            sub.autoRenew = true;
            sub.savedMethodId = a.invoiceId; // Robokassa mother invoice, never a Yoo payment-method ID.
          }
        }
        if (payment.operationKey) grant.operationKey = payment.operationKey;
        a.state = 'succeeded';
        a.errorCode = null;
      } else if (payment.status === 'canceled' && !grant) {
        a.state = 'canceled';
        if (a.kind === 'renewal') { a.errorCode = 'billing_payment_canceled'; stopRecurring(data, sub, 'payment_canceled', a); }
      }
      if (a.state !== 'pending' && sub.pendingAttemptId === id) sub.pendingAttemptId = null;
      return publicStatus(data, sub);
    });
  }
  async function reconcile(id) {
    if (!configured || !id) return;
    if (lookups.has(id)) return lookups.get(id);
    const operation = (async () => {
      const a = validateAttempt(read(), id);
      try { await applyPayment(id, await gateway.lookupPayment(a)); }
      catch (error) { throw billingError(safeError(error), 503); }
    })().finally(() => lookups.delete(id));
    lookups.set(id, operation);
    return operation;
  }
  async function status(userId, checkoutRequestId) {
    validUser(userId);
    if (checkoutRequestId !== undefined && !UUID.test(checkoutRequestId)) throw billingError('billing_bad_request_id');
    const sub = subFor(read(), userId);
    if (sub?.pendingAttemptId) { try { await reconcile(sub.pendingAttemptId); } catch (error) { if (error.status !== 503) throw error; } }
    const data = read();
    const result = publicStatus(data, subFor(data, userId));
    if (checkoutRequestId !== undefined) {
      result.checkoutResolution = null;
      const id = data.requests[checkoutRequestId];
      // Unknown and foreign requests are indistinguishable. Never disclose an
      // invoice belonging to another profile, including after recovery transfer.
      if (id && data.subscriptions[data.attempts[id]?.subscriptionId]?.userId === userId) {
        const attempt = validateAttempt(data, id);
        owner(data, attempt, userId);
        if (attempt.kind === 'checkout') {
          result.checkoutResolution = { requestId: checkoutRequestId, paymentId: attempt.invoiceId, state: attempt.state };
        }
      }
    }
    return result;
  }
  async function checkout(userId, input = {}) {
    if (!available) throw billingError('billing_unavailable', 503);
    validUser(userId);
    if (input.provider !== identity.provider || input.protocol !== PROTOCOL || input.merchantLogin !== merchantLogin || input.mode !== mode) {
      throw billingError('billing_provider_migration_required', 409);
    }
    if (!UUID.test(input.requestId ?? '')) throw billingError('billing_bad_request_id');
    return transaction((data) => {
      let sub = subFor(data, userId);
      let a = data.requests[input.requestId] ? validateAttempt(data, data.requests[input.requestId]) : null;
      if (a) sub = owner(data, a, userId);
      else if (sub?.pendingAttemptId) { a = validateAttempt(data, sub.pendingAttemptId); data.requests[input.requestId] = a.id; }
      // Older checkouts did not present the separate v3 personal-data consent. Keep
      // its provider reconciliation/callback intact, but do not reopen payment
      // or pretend that an idempotent retry accepted the newly displayed text.
      if (a && a.plan.consentVersion !== PLAN.consentVersion) throw billingError('billing_provider_migration_required', 409);
      if (input.recurringConsented !== true || input.consentVersion !== (a ? a.plan.consentVersion : PLAN.consentVersion)) {
        throw billingError('billing_consent_required');
      }
      if (input.personalDataConsented !== true || input.personalDataConsentVersion !== (a ? a.plan.personalDataConsentVersion : PLAN.personalDataConsentVersion)) {
        throw billingError('billing_personal_data_consent_required');
      }
      if (!a) {
        if (!isEmail(input.email)) throw billingError('billing_receipt_email_required');
        if (sub && (sub.autoRenew || (sub.activeUntil ?? 0) > clock())) throw billingError('billing_already_subscribed', 409);
        if (!sub) {
          sub = { id: crypto.randomUUID(), userId, mode, provider: identity.provider, merchant: merchantLogin,
            activeUntil: null, autoRenew: false, savedMethodId: null, pendingAttemptId: null, cancelGeneration: 0 };
          issueCode(sub);
          data.subscriptions[sub.id] = sub;
        }
        sub.email = input.email;
        sub.plan = { ...PLAN };
        clearNotice(sub);
        a = newAttempt(data, sub, 'checkout', input.requestId);
        acceptConsent(data, sub, a, input);
        const prepared = gateway.prepareCheckout(a);
        let url;
        try { url = new URL(prepared.confirmationUrl); } catch { throw billingError('billing_gateway_invalid_response', 503); }
        if (prepared.invoiceId !== a.invoiceId || url.origin !== 'https://auth.robokassa.ru' ||
          url.pathname !== '/Merchant/Index.aspx' || url.username || url.password || url.hash) throw billingError('billing_gateway_invalid_response', 503);
        a.confirmationUrl = url.href;
      }
      if (['failed', 'canceled'].includes(a.state)) throw billingError('billing_checkout_canceled', 409);
      return { ...publicStatus(data, sub), paymentId: a.invoiceId, confirmationUrl: a.confirmationUrl,
        recoveryCode: codes.get(sub.id) ?? null };
    });
  }
  async function result(form) {
    if (!configured) throw billingError('billing_unavailable', 503);
    const invoiceId = form?.InvId;
    if (!invoice(invoiceId)) throw billingError('billing_bad_notification');
    const data = read();
    const a = Object.values(data.attempts).find((item) => item.invoiceId === invoiceId);
    if (!a) throw billingError('billing_payment_not_found', 404);
    validateAttempt(data, a.id);
    let verified;
    try { verified = gateway.verifyResult(form, a); } catch { throw billingError('billing_bad_signature'); }
    await applyPayment(a.id, verified);
    return invoiceId;
  }
  async function cancel(userId) {
    validUser(userId);
    return transaction((data) => {
      const sub = subFor(data, userId);
      if (sub) {
        stopRecurring(data, sub, 'app', data.attempts[sub.pendingAttemptId]);
        const a = data.attempts[sub.pendingAttemptId];
        if (a?.kind === 'renewal' && a.firstSentAt === null) { a.state = 'canceled'; sub.pendingAttemptId = null; }
      }
      return publicStatus(data, sub);
    });
  }
  async function updateEmail(userId, { email } = {}) {
    validUser(userId);
    if (!isEmail(email)) throw billingError('billing_receipt_email_required');
    return transaction((data) => {
      const sub = subFor(data, userId);
      if (!sub) throw billingError('billing_subscription_not_found', 404);
      if (sub.email !== email) {
        if (sub.pendingAttemptId) throw billingError('billing_email_change_pending', 409);
        sub.email = email;
        sub.cancelGeneration += 1;
        clearNotice(sub);
      }
      return publicStatus(data, sub);
    });
  }
  async function recovery(userId) {
    validUser(userId);
    return transaction((data) => {
      const sub = subFor(data, userId);
      if (!sub) throw billingError('billing_subscription_not_found', 404);
      return { recoveryCode: issueCode(sub) };
    });
  }
  async function restore(userId, { recoveryCode } = {}) {
    validUser(userId);
    return transaction((data) => {
      const sub = findRecovery(data, recoveryCode);
      const existing = subFor(data, userId);
      if (existing && existing.id !== sub.id) throw billingError('billing_restore_conflict', 409);
      sub.userId = userId;
      clearNotice(sub);
      return publicStatus(data, sub);
    });
  }
  async function manage({ recoveryCode, action } = {}) {
    if (!['status', 'cancel'].includes(action)) throw billingError('billing_bad_manage_action');
    return transaction((data) => {
      const sub = findRecovery(data, recoveryCode);
      if (action === 'cancel') stopRecurring(data, sub, 'management', data.attempts[sub.pendingAttemptId]);
      return publicStatus(data, sub);
    });
  }
  function mayCharge(a, sub) {
    return available && mode === 'live' && gateway.capabilities.recurring && a.kind === 'renewal' && a.state === 'pending' &&
      a.firstSentAt === null && sub.autoRenew && sub.userId === a.userId && sub.savedMethodId === a.previousInvoiceId &&
      (a.consentId ?? null) === (sub.consentId ?? null) &&
      sub.cancelGeneration === a.cancelGeneration && isDeepStrictEqual(a.plan, sub.plan) && a.renewalBinding === binding(sub) &&
      Number.isSafeInteger(a.notice?.notifiedAt) && Number.isSafeInteger(a.notice?.notBefore) && a.notice.notifiedAt >= 0 &&
      a.notice.notBefore >= Math.max(sub.activeUntil, a.notice.notifiedAt + DAY) && clock() >= a.notice.notBefore;
  }
  async function dispatchRenewal(id) {
    const reserved = await transaction((data) => {
      const a = validateAttempt(data, id);
      if (!mayCharge(a, data.subscriptions[a.subscriptionId])) {
        if (a.state === 'pending' && a.firstSentAt === null) {
          a.state = 'canceled';
          const sub = data.subscriptions[a.subscriptionId];
          if (sub.pendingAttemptId === id) sub.pendingAttemptId = null;
        }
        return null;
      }
      a.firstSentAt = clock();
      return { ...a };
    });
    if (!reserved) return;
    // Recheck a queued cancellation after awaiting the reservation. Never POST
    // again once firstSentAt was persisted; even a crash before POST quarantines.
    const data = read();
    const a = validateAttempt(data, id);
    const sub = data.subscriptions[a.subscriptionId];
    if (!mayCharge({ ...a, firstSentAt: null }, sub)) {
      await transaction((current) => {
        const attempt = current.attempts[id];
        if (attempt.state === 'pending') {
          attempt.state = 'canceled';
          const owner = current.subscriptions[attempt.subscriptionId];
          if (owner.pendingAttemptId === id) owner.pendingAttemptId = null;
        }
      });
      return;
    }
    try {
      const response = await gateway.submitRenewal(a);
      if (response?.invoiceId !== a.invoiceId || response.status !== 'pending') throw new Error();
      await transaction((current) => {
        if (current.attempts[id].state === 'pending') current.attempts[id].acceptedAt = clock();
      });
    } catch (error) {
      await transaction((current) => {
        const attempt = current.attempts[id];
        if (attempt.state !== 'pending') return;
        attempt.errorCode = 'billing_manual_reconciliation_required';
        if (error?.ambiguous === false && error?.retryable === false) {
          attempt.state = 'failed'; attempt.errorCode = safeError(error);
          const owner = current.subscriptions[attempt.subscriptionId];
          if (owner.pendingAttemptId === id) owner.pendingAttemptId = null;
          stopRecurring(current, owner, 'payment_failed', attempt);
        }
      });
      throw billingError(safeError(error), 503);
    }
    await reconcile(id);
  }
  async function reconcilePending() {
    let failures = 0;
    const pending = Object.values(read().attempts).filter((a) => a.state === 'pending');
    for (const a of pending) { try { await reconcile(a.id); } catch { failures += 1; } }
    for (const refund of Object.values(read().refunds).filter((r) => r.state === 'pending' && r.requestId)) {
      try { await reconcileRefund(refund.id); } catch { failures += 1; }
    }
    return { reconciled: pending.length, failures };
  }
  async function renewals() {
    if (!available) throw billingError('billing_unavailable', 503);
    const reconciled = await reconcilePending();
    let failures = reconciled.failures;
    let blockedNotices = 0;
    let attempted = 0;
    // A durable reservation with no dispatch marker is safe to send. A marker
    // with an unknown outcome is only looked up, never posted again.
    for (const a of Object.values(read().attempts).filter((a) => a.state === 'pending' && a.kind === 'renewal' && a.firstSentAt === null)) {
      try { await dispatchRenewal(a.id); } catch { failures += 1; }
    }
    const candidates = mode === 'live' ? Object.values(read().subscriptions).filter((s) => s.autoRenew && s.savedMethodId &&
      !s.pendingAttemptId && Number.isSafeInteger(s.activeUntil) && s.activeUntil <= clock() + 3 * DAY) : [];
    for (const captured of candidates) {
      let notice;
      try { notice = await notices.ensureNotice(captured); } catch { failures += 1; continue; }
      if (notice?.ready !== true && notice?.reason !== 'renewal_notice_waiting') blockedNotices += 1;
      const id = await transaction((data) => {
        const sub = data.subscriptions[captured.id];
        if (!sub || !sub.autoRenew || sub.pendingAttemptId || binding(sub) !== binding(captured)) return null;
        if (!Number.isSafeInteger(notice?.notifiedAt) || !Number.isSafeInteger(notice?.notBefore) || notice.notifiedAt < 0 ||
          notice.notifiedAt > clock() || notice.notBefore < Math.max(sub.activeUntil, notice.notifiedAt + DAY)) return null;
        sub.renewalPaymentAt = notice.notBefore; sub.renewalNoticeBinding = binding(sub);
        if (notice.ready !== true || clock() < notice.notBefore) return null;
        return newAttempt(data, sub, 'renewal', null, notice).id;
      });
      if (id) { attempted += 1; try { await dispatchRenewal(id); } catch { failures += 1; } }
    }
    return { attempted, reconciled: reconciled.reconciled, failures, blockedNotices };
  }
  function runRenewals() {
    if (!renewalRun) renewalRun = renewals().finally(() => { renewalRun = null; });
    return renewalRun;
  }
  // Operator-only methods, never exposed on public/game HTTP routes. The
  // request UUID is mandatory so a retried operator command cannot refund twice.
  async function requestRefund(invoiceId, amountMinor, requestId) {
    if (mode !== 'live' || !gateway?.capabilities?.refunds) throw billingError('billing_refunds_unavailable', 503);
    if (!invoice(invoiceId) || !Number.isSafeInteger(amountMinor) || amountMinor < 1 || !UUID.test(requestId ?? '')) throw billingError('billing_bad_refund');
    let data = read();
    const existing = data.refunds[requestId];
    if (existing) {
      if (existing.invoiceId !== invoiceId || existing.amountMinor !== amountMinor) throw billingError('billing_refund_conflict', 409);
      return { id: existing.id, state: existing.state };
    }
    let grant = data.payments[invoiceId];
    if (!grant) throw billingError('billing_payment_not_found', 404);
    if (!grant.operationKey) { await reconcile(grant.attemptId); data = read(); grant = data.payments[invoiceId]; }
    if (!grant.operationKey) throw billingError('billing_refund_unverified', 409);
    const reserved = await transaction((current) => {
      if (current.refunds[requestId]) {
        const previous = current.refunds[requestId];
        if (previous.invoiceId !== invoiceId || previous.amountMinor !== amountMinor) throw billingError('billing_refund_conflict', 409);
        return null;
      }
      const payment = current.payments[invoiceId];
      const pendingMinor = Object.values(current.refunds).filter((r) => r.invoiceId === invoiceId && ['pending', 'unknown'].includes(r.state))
        .reduce((sum, r) => sum + r.amountMinor, 0);
      if (amountMinor + pendingMinor + payment.refundedMinor > payment.amountMinor) throw billingError('billing_refund_amount_mismatch', 409);
      const refund = { id: requestId, invoiceId, operationKey: payment.operationKey, amountMinor,
        state: 'unknown', requestId: null, createdAt: clock() };
      current.refunds[requestId] = refund;
      return refund;
    });
    if (!reserved) return { id: requestId, state: read().refunds[requestId].state };
    try {
      const result = await gateway.submitRefund(reserved);
      if (typeof result?.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.requestId) || result.status !== 'pending') throw new Error();
      await transaction((current) => {
        if (Object.values(current.refunds).some((r) => r.id !== requestId && r.requestId === result.requestId)) throw billingError('billing_refund_conflict', 409);
        Object.assign(current.refunds[requestId], { requestId: result.requestId, state: 'pending' });
      });
    } catch (error) {
      if (error?.ambiguous === false && error?.retryable === false) await transaction((current) => { current.refunds[requestId].state = 'canceled'; });
      throw billingError(safeError(error), 503);
    }
    return { id: requestId, state: 'pending' };
  }
  async function reconcileRefund(id) {
    const refund = read().refunds[id];
    if (!refund || refund.state !== 'pending' || !refund.requestId) return;
    const result = await gateway.lookupRefund(refund);
    if (result?.requestId !== refund.requestId || result.amountMinor !== refund.amountMinor || !['pending', 'finished', 'canceled'].includes(result.status)) {
      throw billingError('billing_refund_unverified', 409);
    }
    return transaction((data) => {
      const current = data.refunds[id];
      if (current.state !== 'pending') return;
      if (result.status === 'pending') return;
      current.state = result.status;
      if (result.status === 'canceled') return;
      const grant = data.payments[current.invoiceId];
      const a = validateAttempt(data, grant.attemptId);
      if (grant.refundedMinor + current.amountMinor > grant.amountMinor) throw billingError('billing_refund_amount_mismatch', 409);
      grant.refundedMinor += current.amountMinor;
      // Monetary settlement and fiscal correction are separate facts. Robokassa
      // annuls the original NPD receipt on any refund; a partial refund needs a
      // manually issued replacement, which this backend must never invent.
      grant.receiptCorrection = { ...receiptCorrectionState(data, grant), updatedAt: clock() };
      const end = grant.periodEnd - grant.revokedMs;
      const desired = Math.round(a.periodDays * DAY * grant.refundedMinor / grant.amountMinor);
      const revoked = Math.min(Math.max(0, desired - grant.revokedMs), Math.max(0, end - Math.max(clock(), grant.periodStart)));
      grant.revokedMs += revoked;
      for (const other of Object.values(data.payments)) if (other !== grant && other.subscriptionId === grant.subscriptionId && other.periodStart >= end) {
        other.periodStart -= revoked; other.periodEnd -= revoked;
      }
      const sub = data.subscriptions[grant.subscriptionId];
      sub.activeUntil -= revoked; stopRecurring(data, sub, 'refund', a);
      current.revokedMs = revoked; current.confirmedAt = clock();
    });
  }
  const receiptRefValid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const evidenceRefValid = (value) => typeof value === 'string' && /^[A-Za-z0-9._:/-]{3,256}$/.test(value);
  function receiptHistory(grant) {
    const history = grant.receiptCorrectionHistory ?? [];
    if (!Array.isArray(history) || history.some((entry) => !entry || entry.source !== 'operator' ||
      entry.invoiceId !== grant.invoiceId || !Number.isSafeInteger(entry.recordedAt) || entry.recordedAt < 0 ||
      !Number.isSafeInteger(entry.refundedMinor) || entry.refundedMinor <= 0 ||
      !Number.isSafeInteger(entry.remainingMinor) || entry.remainingMinor < 0 ||
      entry.refundedMinor + entry.remainingMinor !== grant.amountMinor ||
      !['replacement_issued', 'replacements_annulled', 'no_replacement_issued'].includes(entry.action) ||
      (entry.receiptRef !== null && !receiptRefValid(entry.receiptRef)) || !evidenceRefValid(entry.evidenceRef) ||
      !Array.isArray(entry.annulledReceiptRefs) || entry.annulledReceiptRefs.some((ref) => !receiptRefValid(ref)) ||
      new Set(entry.annulledReceiptRefs).size !== entry.annulledReceiptRefs.length ||
      (entry.action === 'replacement_issued' ? entry.remainingMinor <= 0 || !receiptRefValid(entry.receiptRef) ||
        entry.annulledReceiptRefs.includes(entry.receiptRef)
        : entry.remainingMinor !== 0 || entry.receiptRef !== null ||
          (entry.action === 'replacements_annulled' ? entry.annulledReceiptRefs.length === 0 : entry.annulledReceiptRefs.length !== 0)))) {
      throw billingError('billing_store_unavailable', 503);
    }
    return history;
  }
  function receiptCorrectionState(data, grant) {
    const refundedMinor = grant.refundedMinor;
    const remainingMinor = grant.amountMinor - refundedMinor;
    if (!Number.isSafeInteger(refundedMinor) || refundedMinor < 0 || !Number.isSafeInteger(remainingMinor) || remainingMinor < 0) {
      throw billingError('billing_store_unavailable', 503);
    }
    const history = receiptHistory(grant);
    const hadPartialRefund = (refundedMinor > 0 && remainingMinor > 0) || grant.receiptCorrection?.hadPartialRefund === true ||
      history.some((entry) => entry.remainingMinor > 0) || Object.values(data.refunds).some((refund) =>
        refund.invoiceId === grant.invoiceId && refund.state === 'finished' && refund.amountMinor < grant.amountMinor);
    const last = history.at(-1);
    const acknowledged = last && last.refundedMinor === refundedMinor && last.remainingMinor === remainingMinor;
    return { state: refundedMinor === 0 ? 'not_required' : acknowledged ? 'operator_confirmed'
      : remainingMinor > 0 ? 'manual_replacement_required'
        : hadPartialRefund ? 'manual_annulment_review_required' : 'provider_annulment_expected',
    refundedMinor, remainingMinor, hadPartialRefund, originalReceiptStatus: 'annulment_expected' };
  }
  // Operator-only evidence acknowledgement, never an HTTP endpoint or a call to
  // MyTax. The operator verifies the actual receipt and any prior annulments.
  async function acknowledgeReceiptCorrection(invoiceId, { expectedRefundedMinor, remainingMinor, action,
    receiptRef = null, annulledReceiptRefs = [], evidenceRef } = {}) {
    if (!invoice(invoiceId) || !Number.isSafeInteger(expectedRefundedMinor) || expectedRefundedMinor <= 0 ||
      !Number.isSafeInteger(remainingMinor) || remainingMinor < 0 || !evidenceRefValid(evidenceRef) ||
      !['replacement_issued', 'replacements_annulled', 'no_replacement_issued'].includes(action) ||
      (receiptRef !== null && !receiptRefValid(receiptRef)) || !Array.isArray(annulledReceiptRefs) ||
      annulledReceiptRefs.length > 100 || annulledReceiptRefs.some((ref) => !receiptRefValid(ref)) ||
      new Set(annulledReceiptRefs).size !== annulledReceiptRefs.length) throw billingError('billing_bad_receipt_correction');
    return transaction((data) => {
      const grant = data.payments[invoiceId];
      if (!grant) throw billingError('billing_payment_not_found', 404);
      if (grant.refundedMinor !== expectedRefundedMinor || grant.amountMinor - grant.refundedMinor !== remainingMinor) {
        throw billingError('billing_receipt_correction_conflict', 409);
      }
      const history = receiptHistory(grant);
      const acknowledgement = { refundedMinor: expectedRefundedMinor, remainingMinor, action, receiptRef,
        annulledReceiptRefs: [...annulledReceiptRefs].sort(), evidenceRef };
      const last = history.at(-1);
      if (last?.refundedMinor === expectedRefundedMinor) {
        const previous = { refundedMinor: last.refundedMinor, remainingMinor: last.remainingMinor, action: last.action,
          receiptRef: last.receiptRef, annulledReceiptRefs: last.annulledReceiptRefs, evidenceRef: last.evidenceRef };
        if (!isDeepStrictEqual(previous, acknowledgement)) throw billingError('billing_receipt_correction_conflict', 409);
        return { invoiceId, ...receiptCorrectionState(data, grant) };
      }
      const state = receiptCorrectionState(data, grant);
      if (!['manual_replacement_required', 'manual_annulment_review_required'].includes(state.state)) {
        throw billingError('billing_receipt_correction_conflict', 409);
      }
      const referenced = [receiptRef, ...annulledReceiptRefs].filter(Boolean);
      if (Object.values(data.payments).some((other) => other !== grant && receiptHistory(other).some((entry) =>
        entry.receiptRef !== null && referenced.includes(entry.receiptRef)))) throw billingError('billing_receipt_correction_conflict', 409);
      const outstanding = new Set();
      for (const entry of history) {
        for (const ref of entry.annulledReceiptRefs) outstanding.delete(ref);
        if (entry.action === 'replacement_issued') outstanding.add(entry.receiptRef);
      }
      if ([...outstanding].some((ref) => !annulledReceiptRefs.includes(ref)) ||
        (remainingMinor > 0 ? action !== 'replacement_issued' || !receiptRef || annulledReceiptRefs.includes(receiptRef) ||
          history.some((entry) => entry.receiptRef === receiptRef)
          : receiptRef !== null || action === 'replacement_issued' ||
            (action === 'replacements_annulled' ? annulledReceiptRefs.length === 0
              : annulledReceiptRefs.length > 0 || history.some((entry) => entry.action === 'replacement_issued')))) {
        throw billingError('billing_receipt_correction_conflict', 409);
      }
      grant.receiptCorrectionHistory = [...history, { ...acknowledgement, invoiceId, source: 'operator', recordedAt: clock() }];
      grant.receiptCorrection = { ...receiptCorrectionState(data, grant), updatedAt: clock() };
      return { invoiceId, ...grant.receiptCorrection };
    });
  }
  function diagnostics() {
    const data = read();
    const attempts = Object.values(data.attempts);
    const subscriptions = Object.values(data.subscriptions);
    return { pendingPayments: attempts.filter((a) => a.state === 'pending').length,
      stalePendingPayments: attempts.filter((a) => a.state === 'pending' && clock() - a.createdAt >= DAY).length,
      failedPayments: attempts.filter((a) => a.state === 'failed' || a.errorCode === 'billing_payment_canceled').length,
      manualReconciliationPayments: attempts.filter((a) => a.state === 'pending' &&
        (a.errorCode === 'billing_manual_reconciliation_required' || (a.kind === 'renewal' && a.firstSentAt !== null && a.acceptedAt == null))).length,
      overdueSubscriptions: subscriptions.filter((s) => s.autoRenew && (s.activeUntil ?? Infinity) <= clock()).length,
      invalidEmails: subscriptions.filter((s) => !isEmail(s.email)).length,
      pendingRefunds: Object.values(data.refunds).filter((r) => r.state === 'pending').length,
      manualReconciliationRefunds: Object.values(data.refunds).filter((r) => r.state === 'unknown').length,
      manualReceiptCorrections: Object.values(data.payments).filter((grant) =>
        ['manual_replacement_required', 'manual_annulment_review_required'].includes(receiptCorrectionState(data, grant).state)).length,
      notices: notices?.diagnostics ? notices.diagnostics(subscriptions) : { pending: 0, failed: 0, quarantined: 0 } };
  }
  return { catalog: () => ({ provider: identity.provider, protocol: PROTOCOL, merchantLogin, mode, available, plan: { ...PLAN } }),
    checkout, status, result, cancel, updateEmail, recovery, restore, manage, runRenewals, reconcilePending,
    diagnostics, requestRefund, reconcileRefund, acknowledgeReceiptCorrection,
    setAnalyticsBinding: (userId, input) => { validUser(userId); return analytics.bind(userId, input); },
    flushAnalytics: analytics.flush, analyticsDiagnostics: analytics.diagnostics,
    reconcileAnalyticsImport: analytics.reconcileImport };
}

module.exports = { createRobokassaBilling };
