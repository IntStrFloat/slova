const crypto = require('node:crypto');

const DAY = 86_400_000;
const MAX_POST_AGE = 14 * DAY;
const DEVICE_ID = /^[1-9]\d{0,19}$/;
const INSTALL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const validDeviceId = (value) => typeof value === 'string' && DEVICE_ID.test(value) && BigInt(value) <= 18446744073709551615n;
const PAYLOAD_KEYS = new Set(['event_id', 'server_event_id', 'schema_version', 'server_build', 'producer',
  'environment', 'time_trust', 'occurred_at', 'observed_at', 'effective_at', 'binding_state', 'event_type',
  'pseudonymous_payment_key', 'amount_minor', 'currency', 'product_id', 'period_end', 'originating_installation_id']);
function validStoredEvent(event) {
  const p = event?.payload;
  return p && typeof p === 'object' && !Array.isArray(p) && event.name === 'subscription_server_event'
    && /^[0-9a-f]{64}$/.test(event.id ?? '') && p.event_id === event.id && p.server_event_id === event.id
    && p.schema_version === 3 && p.producer === 'backend' && p.environment === 'live'
    && p.time_trust === 'server_verified' && p.binding_state === 'bound'
    && ['paid', 'renewed', 'refunded', 'auto_renew_disabled', 'expired'].includes(p.event_type)
    && Object.keys(p).every((key) => PAYLOAD_KEYS.has(key))
    && Object.values(p).every((v) => typeof v === 'string' || typeof v === 'number' && Number.isFinite(v))
    && validDeviceId(event.deviceId) && Number.isSafeInteger(event.effectiveAt)
    && typeof p.occurred_at === 'string' && Date.parse(p.occurred_at) === event.effectiveAt && p.effective_at === p.occurred_at
    && typeof p.observed_at === 'string' && Number.isFinite(Date.parse(p.observed_at))
    && typeof p.server_build === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(p.server_build)
    && typeof p.product_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.product_id)
    && (!Object.hasOwn(p, 'originating_installation_id') || INSTALL_ID.test(p.originating_installation_id))
    && (!Object.hasOwn(p, 'period_end') || Number.isFinite(Date.parse(p.period_end)))
    && (['paid', 'renewed', 'refunded'].includes(p.event_type)
      ? Number.isSafeInteger(p.amount_minor) && (p.event_type === 'refunded' ? p.amount_minor < 0 : p.amount_minor > 0)
        && p.currency === 'RUB' && /^[0-9a-f]{64}$/.test(p.pseudonymous_payment_key)
      : !Object.hasOwn(p, 'amount_minor'));
}

function analyticsError(code) { return Object.assign(new Error(code), { code, status: 400 }); }

/** Private billing journal, committed atomically with the verified financial fact. */
function ensureBillingAnalytics(data) {
  data.analytics ??= { version: 1, bindings: {}, events: {} };
  const state = data.analytics;
  if (state.version !== 1 || !state.bindings || typeof state.bindings !== 'object' || Array.isArray(state.bindings)
      || !state.events || typeof state.events !== 'object' || Array.isArray(state.events)) {
    throw Object.assign(new Error('billing_store_unavailable'), { code: 'billing_store_unavailable', status: 503 });
  }
  return state;
}

function snapshotBilling(data) {
  return {
    payments: new Set(Object.keys(data.payments ?? {})),
    refunds: Object.fromEntries(Object.entries(data.refunds ?? {}).map(([id, r]) => [id, r.state ?? 'recorded'])),
    subscriptions: Object.fromEntries(Object.entries(data.subscriptions ?? {}).map(([id, s]) => [id, {
      userId: s.userId, activeUntil: s.activeUntil, autoRenew: s.autoRenew === true,
    }])),
  };
}

function appendFact(data, options, userId, businessKey, eventType, details, effectiveAt) {
  const state = ensureBillingAnalytics(data);
  const id = hash(JSON.stringify([options.scope, eventType, businessKey]));
  if (state.events[id]) return;
  const binding = state.bindings[userId];
  const effective = Number.isSafeInteger(effectiveAt) ? effectiveAt : options.time;
  const bound = options.mode === 'live' && binding?.consent === true && validDeviceId(binding.deviceId)
    && binding.acceptedAt <= effective;
  // Only explicit whitelisted fields reach the external payload. No user ID,
  // invoice ID, receipt email, recovery code, URL or gateway metadata is copied.
  const payload = {
    event_id: id, server_event_id: id, schema_version: 3, server_build: options.serverBuild,
    producer: 'backend', environment: options.mode, time_trust: 'server_verified',
    occurred_at: new Date(effective).toISOString(), observed_at: new Date(options.time).toISOString(),
    effective_at: new Date(effective).toISOString(), binding_state: bound ? 'bound' : 'unlinked',
    event_type: eventType, ...details,
    ...(bound && binding.installationId ? { originating_installation_id: binding.installationId } : {}),
  };
  state.events[id] = {
    id, userId, name: 'subscription_server_event', payload, createdAt: options.time,
    effectiveAt: effective, bindingRevision: bound ? binding.revision : null,
    deviceId: bound ? binding.deviceId : null,
    status: bound ? 'pending' : 'not_eligible', revenueStatus: bound ? 'pending' : 'not_eligible', attempts: 0,
  };
}

/** Called before the same durable write as payment/refund/cancellation changes. */
function recordBillingChanges(data, before, options) {
  ensureBillingAnalytics(data);
  const paymentKey = (id) => hash(`${options.scope}:payment:${id}`);
  for (const [id, grant] of Object.entries(data.payments ?? {})) {
    if (before.payments.has(id)) continue;
    const attempt = data.attempts[grant.attemptId];
    const sub = data.subscriptions[grant.subscriptionId];
    if (!attempt || !sub || attempt.mode !== options.mode || sub.mode !== options.mode) continue;
    const amount = grant.amountMinor ?? grant.amountCents;
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    appendFact(data, options, sub.userId, id, attempt.kind === 'renewal' ? 'renewed' : 'paid', {
      pseudonymous_payment_key: paymentKey(id), amount_minor: amount, currency: 'RUB',
      product_id: attempt.planId ?? attempt.plan?.id ?? 'no_ads_30',
      period_end: new Date(grant.periodEnd).toISOString(),
    }, options.time);
  }
  for (const [id, refund] of Object.entries(data.refunds ?? {})) {
    const completed = refund.state === 'finished' || refund.state === 'succeeded'
      || (refund.state === undefined && refund.paymentId && Number.isSafeInteger(refund.amountCents));
    if (!completed || before.refunds[id] === (refund.state ?? 'recorded')) continue;
    const invoiceId = refund.invoiceId ?? refund.paymentId;
    const grant = data.payments[invoiceId];
    const sub = data.subscriptions[grant?.subscriptionId];
    const amount = refund.amountMinor ?? refund.amountCents;
    if (!sub || sub.mode !== options.mode || !Number.isSafeInteger(amount) || amount <= 0) continue;
    appendFact(data, options, sub.userId, id, 'refunded', {
      pseudonymous_payment_key: paymentKey(invoiceId), amount_minor: -amount,
      currency: 'RUB', product_id: 'no_ads_30',
    }, refund.confirmedAt ?? options.time);
  }
  for (const [id, sub] of Object.entries(data.subscriptions ?? {})) {
    if (sub.mode !== options.mode) continue;
    const previous = before.subscriptions[id];
    if (previous?.autoRenew && sub.autoRenew !== true) {
      appendFact(data, options, sub.userId, `${id}:${sub.cancelGeneration}`, 'auto_renew_disabled', {
        product_id: sub.plan?.id ?? 'no_ads_30',
      }, options.time);
    }
    if (Number.isSafeInteger(sub.activeUntil) && sub.activeUntil > 0 && sub.activeUntil <= options.time) {
      appendFact(data, options, sub.userId, `${id}:${sub.activeUntil}`, 'expired', {
        product_id: sub.plan?.id ?? 'no_ads_30',
      }, sub.activeUntil);
    }
  }
}

function setBinding(data, userId, input, time) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.consent !== 'boolean'
      || Object.keys(input).some((key) => !['consent', 'deviceId', 'installationId'].includes(key))) {
    throw analyticsError('billing_bad_analytics_binding');
  }
  const state = ensureBillingAnalytics(data);
  const previous = state.bindings[userId];
  if (input.consent && (!validDeviceId(input.deviceId)
      || (input.installationId !== undefined && (typeof input.installationId !== 'string' || !INSTALL_ID.test(input.installationId))))) {
    throw analyticsError('billing_bad_analytics_binding');
  }
  if (previous?.consent === input.consent && (!input.consent || previous.deviceId === input.deviceId
      && previous.installationId === (input.installationId ?? null))) return { consent: input.consent, bound: input.consent };
  // Changing identity or revoking consent invalidates every undelivered record
  // captured under the old binding; later consent never retroactively rebinds it.
  for (const event of Object.values(state.events)) {
    if (event.userId === userId && (event.status !== 'delivered' || event.revenueStatus !== 'delivered')) {
      if (event.status !== 'delivered') event.status = 'consent_revoked';
      if (event.revenueStatus !== 'delivered') event.revenueStatus = 'consent_revoked';
      event.deviceId = null;
      delete event.payload.originating_installation_id;
      event.payload.binding_state = 'unlinked';
    }
  }
  state.bindings[userId] = {
    consent: input.consent, deviceId: input.consent ? input.deviceId : null,
    installationId: input.consent ? input.installationId ?? null : null,
    acceptedAt: time, revision: (previous?.revision ?? 0) + 1,
  };
  return { consent: input.consent, bound: input.consent };
}

function importRequest(event, channel, applicationId, postApiKey) {
  const url = new URL(`https://api.appmetrica.yandex.ru/logs/v1/import/${channel === 'revenue' ? 'revenue' : 'events'}.csv`);
  url.searchParams.set('post_api_key', postApiKey);
  const p = event.payload;
  let fields; let values;
  if (channel === 'revenue') {
    const revenueType = { paid: 'subscription_started', renewed: 'subscription_renewed', refunded: 'refund',
      auto_renew_disabled: 'cancellation', expired: 'expired' }[p.event_type];
    // Revenue event type defines refund direction. The custom ledger retains a
    // signed amount; never sum custom and standard revenue as two purchases.
    const price = (Math.abs(p.amount_minor ?? 0) / 100).toFixed(2);
    const numericKey = (key) => BigInt(`0x${key.slice(0, 15)}`).toString();
    fields = ['application_id', 'appmetrica_device_id', 'revenue_event_type', 'event_timestamp', 'price', 'currency',
      'product_id', 'quantity', 'transaction_id', 'order_id', 'payload', 'session_type', 'app_package_name'];
    values = [applicationId, event.deviceId, revenueType, Math.floor(event.effectiveAt / 1000), price, 'RUB',
      p.product_id, 1, numericKey(event.id), numericKey(p.pseudonymous_payment_key ?? event.id),
      JSON.stringify({ event_id: event.id, source: 'verified_backend' }), 'background', 'com.intstrfloat.slova'];
  } else {
    fields = ['application_id', 'appmetrica_device_id', 'event_name', 'event_timestamp', 'event_json', 'session_type', 'app_package_name'];
    values = [applicationId, event.deviceId, event.name, Math.floor(event.effectiveAt / 1000),
      JSON.stringify(p), 'background', 'com.intstrfloat.slova'];
  }
  const csv = (value) => `"${String(value).replace(/"/g, '""')}"`;
  return { url: url.href, body: `${fields.join(',')}\n${values.map(csv).join(',')}\n` };
}

/** Post API has no documented idempotent event import. Ambiguous sends require
 * reconciliation by event_id; blindly retrying could duplicate AppMetrica data. */
function createBillingAnalytics({ read, transaction, now, scope, mode, serverBuild = 'billing-v3',
  enabled = false, postApiKey = '', applicationId = 6321823, fetchImpl = globalThis.fetch }) {
  const configured = enabled === true && mode === 'live' && typeof postApiKey === 'string' && postApiKey.length > 0
    && Number.isSafeInteger(applicationId) && applicationId > 0 && typeof fetchImpl === 'function';
  let flushing;
  const options = () => ({ scope, mode, serverBuild, time: now() });
  function capture(data, before) { recordBillingChanges(data, before, options()); }
  async function bind(userId, input) { return transaction((data) => setBinding(data, userId, input, now())); }
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      // Expiry is deterministic and is observed even without a client launch.
      await transaction(() => {});
      if (!configured) return { configured: false, sent: 0, revenueSent: 0, uncertain: 0 };
      let sent = 0; let revenueSent = 0; let uncertain = 0;
      const pending = Object.values(ensureBillingAnalytics(read()).events)
        .filter((e) => e.status === 'pending' || e.revenueStatus === 'pending').slice(0, 100);
      for (const candidate of pending) {
        for (const channel of ['event', 'revenue']) {
        const statusField = channel === 'revenue' ? 'revenueStatus' : 'status';
        const reserved = await transaction((data) => {
          const state = ensureBillingAnalytics(data); const event = state.events[candidate.id];
          const binding = state.bindings[event?.userId];
          if (!event || event[statusField] !== 'pending') return null;
          if (!validStoredEvent(event)) { event[statusField] = 'invalid_payload'; return null; }
          if (binding?.consent !== true || binding.revision !== event.bindingRevision || binding.deviceId !== event.deviceId) {
            event[statusField] = 'consent_revoked'; event.deviceId = null; return null;
          }
          if (now() - event.effectiveAt > MAX_POST_AGE || event.effectiveAt > now()) { event[statusField] = 'outside_import_window'; return null; }
          // Persist uncertain BEFORE the request. Process death cannot replay an
          // already accepted import without explicit reconciliation.
          event[statusField] = 'uncertain'; event.attempts += 1; event.lastAttemptAt = now();
          return structuredClone(event);
        });
        if (!reserved) continue;
        const state = ensureBillingAnalytics(read());
        const binding = state.bindings[reserved.userId];
        if (binding?.consent !== true || binding.revision !== reserved.bindingRevision) continue;
        const request = importRequest(reserved, channel, applicationId, postApiKey);
        let status = 'uncertain';
        try {
          const response = await fetchImpl(request.url, { method: 'POST', headers: { 'content-type': 'text/csv; charset=utf-8' },
            body: request.body, signal: AbortSignal.timeout(15_000), redirect: 'error' });
          status = response.status === 200 ? 'delivered' : [400, 403, 429].includes(response.status) ? 'rejected' : 'uncertain';
        } catch { /* Do not log a URL, token, device ID, response body or payload. */ }
        await transaction((data) => {
          const event = ensureBillingAnalytics(data).events[reserved.id];
          if (event[statusField] !== 'uncertain') return;
          event[statusField] = status;
          if (status === 'delivered') event[channel === 'revenue' ? 'revenueDeliveredAt' : 'deliveredAt'] = now();
        });
        if (status === 'delivered') { if (channel === 'revenue') revenueSent++; else sent++; }
        else if (status === 'uncertain') uncertain++;
        }
      }
      return { configured: true, sent, revenueSent, uncertain };
    })().finally(() => { flushing = null; });
    return flushing;
  }
  function diagnostics() {
    const events = Object.values(ensureBillingAnalytics(read()).events);
    const statuses = {}; const revenueStatuses = {};
    for (const event of events) {
      statuses[event.status] = (statuses[event.status] ?? 0) + 1;
      revenueStatuses[event.revenueStatus ?? 'unconfigured'] = (revenueStatuses[event.revenueStatus ?? 'unconfigured'] ?? 0) + 1;
    }
    return { configured, statuses, revenueStatuses, events: events.length };
  }
  async function reconcileImport(eventId, imported, channel = 'event') {
    if (typeof eventId !== 'string' || !/^[0-9a-f]{64}$/.test(eventId) || typeof imported !== 'boolean'
        || !['event', 'revenue'].includes(channel)) {
      throw analyticsError('billing_bad_analytics_reconciliation');
    }
    const statusField = channel === 'revenue' ? 'revenueStatus' : 'status';
    return transaction((data) => {
      const state = ensureBillingAnalytics(data); const event = state.events[eventId];
      if (!event || !['uncertain', 'rejected'].includes(event[statusField])) throw analyticsError('billing_analytics_reconciliation_conflict');
      const binding = state.bindings[event.userId];
      if (binding?.consent !== true || binding.revision !== event.bindingRevision) {
        event[statusField] = 'consent_revoked'; event.deviceId = null; return { status: event[statusField] };
      }
      event[statusField] = imported ? 'delivered' : 'pending';
      event.reconciledAt = now();
      if (imported) event[channel === 'revenue' ? 'revenueDeliveredAt' : 'deliveredAt'] = now();
      return { status: event[statusField] };
    });
  }
  return { capture, bind, flush, diagnostics, reconcileImport };
}

module.exports = { createBillingAnalytics, ensureBillingAnalytics, recordBillingChanges, snapshotBilling, setBinding, importRequest };
