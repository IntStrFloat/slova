const { isDeepStrictEqual } = require('node:util');
const { billingError } = require('./billing.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ['requestId', 'paymentId', 'provider', 'protocol', 'merchantLogin', 'mode'];
const ACTIVE_PROTOCOL = 'robokassa-v3';
const KNOWN_PROTOCOLS = ['robokassa-v1', 'robokassa-v2', ACTIVE_PROTOCOL];
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const unresolved = () => billingError('billing_migration_unresolved', 409);

function validDraft(draft) {
  return record(draft) && Object.keys(draft).length === FIELDS.length && FIELDS.every((key) => Object.hasOwn(draft, key)) &&
    UUID.test(draft.requestId ?? '') && (draft.paymentId === null || (typeof draft.paymentId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(draft.paymentId))) &&
    ['yookassa', 'robokassa', null].includes(draft.provider) &&
    (draft.protocol === null || KNOWN_PROTOCOLS.includes(draft.protocol)) &&
    (draft.merchantLogin === null || (typeof draft.merchantLogin === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(draft.merchantLogin))) &&
    [null, 'test', 'live'].includes(draft.mode);
}
function validTarget(target, historical = false) {
  return record(target) && Object.keys(target).length === 4 && target.provider === 'robokassa' &&
    (historical ? KNOWN_PROTOCOLS.includes(target.protocol) : target.protocol === ACTIVE_PROTOCOL) &&
    typeof target.merchantLogin === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(target.merchantLogin) && ['test', 'live'].includes(target.mode);
}
function validReview(review) {
  return record(review) && typeof review.userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(review.userId) &&
    // Historical approvals remain readable, but exact target comparison below
    // prevents them from authorizing a current-protocol reset without new review.
    validDraft(review.draft) && validTarget(review.target, true) && ['test_only', 'no_dispatch', 'closed_without_charge'].includes(review.disposition) &&
    typeof review.evidence === 'string' && review.evidence.trim().length >= 8 && review.evidence.length <= 1000 &&
    typeof review.reviewedAt === 'string' && Number.isFinite(Date.parse(review.reviewedAt));
}

// This resolver only authorizes discarding one checkout draft. It never changes
// payment journals, grants access, changes profile/recovery data or creates a bill.
function createBillingMigration({ target, sources = [], reviewedRead } = {}) {
  async function resolve(userId, draft) {
    if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(userId) || !validDraft(draft) || !validTarget(target)) throw unresolved();
    const accepted = (reason) => ({ resolution: 'safe_to_discard', reason, draft: { ...draft }, target: { ...target } });
    try {
      if (reviewedRead) {
        const reviewed = reviewedRead();
        if (!record(reviewed) || reviewed.version !== 1 || !Array.isArray(reviewed.resolutions) || !reviewed.resolutions.every(validReview)) throw unresolved();
        if (reviewed.resolutions.some((item) => item.userId === userId && isDeepStrictEqual(item.draft, draft) && isDeepStrictEqual(item.target, target))) {
          return accepted('operator_reviewed');
        }
      }
      if (!Array.isArray(sources) || !sources.length) throw unresolved();
      const matches = [];
      for (const source of sources) {
        if (!['yookassa', 'robokassa'].includes(source.provider) || typeof source.read !== 'function') throw unresolved();
        const data = source.read(); // Missing/corrupt configured sources never become empty ledgers.
        if (!record(data) || data.billingVersion !== (source.provider === 'yookassa' ? 1 : 2) ||
          !['requests', 'attempts', 'subscriptions', 'payments', 'refunds'].every((key) => record(data[key]))) throw unresolved();
        if (source.provider === 'robokassa' && (!record(data.identity) || data.identity.provider !== 'robokassa' ||
          typeof data.identity.merchant !== 'string' || !['test', 'live'].includes(data.identity.mode))) throw unresolved();
        const id = data.requests[draft.requestId];
        if (!id) continue;
        const attempt = data.attempts[id];
        const sub = data.subscriptions[attempt?.subscriptionId];
        if (!record(attempt) || attempt.id !== id || !record(sub) || sub.id !== attempt.subscriptionId) throw unresolved();
        matches.push({ source, data, attempt, sub });
      }
      if (matches.length !== 1) throw unresolved();
      const { source, data, attempt, sub } = matches[0];
      if (attempt.userId !== userId || sub.userId !== userId || attempt.mode !== 'test' || sub.mode !== 'test' ||
        (draft.provider !== null && draft.provider !== source.provider) || (draft.mode !== null && draft.mode !== 'test')) throw unresolved();
      const providerId = source.provider === 'robokassa' ? attempt.invoiceId : attempt.paymentId;
      if (draft.paymentId !== null && draft.paymentId !== providerId) throw unresolved();
      if (source.provider === 'robokassa') {
        if (data.identity.mode !== 'test' || attempt.mode !== data.identity.mode || attempt.provider !== 'robokassa' ||
          attempt.merchant !== data.identity.merchant || !KNOWN_PROTOCOLS.includes(draft.protocol) ||
          draft.merchantLogin !== data.identity.merchant) throw unresolved();
        // Protocol alone does not make a same-merchant TEST journal retired.
        // Clearing only the client draft would leave its server pending attempt
        // intact and trap the player in the next checkout's migration guard.
        if (target.mode === 'test' && target.merchantLogin === data.identity.merchant) throw unresolved();
      } else if (draft.protocol !== null || draft.merchantLogin !== null) throw unresolved();
      return accepted('retired_test_payment');
    } catch { throw unresolved(); }
  }
  return { resolve };
}

module.exports = { createBillingMigration, validDraft, validTarget, validReview };
