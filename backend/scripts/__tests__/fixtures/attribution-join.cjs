'use strict';

// Entirely synthetic. These pure journal functions do not construct a gateway,
// start a backend, send telemetry, or execute a payment.
const { setBinding, snapshotBilling, recordBillingChanges, importRequest } = require('../../../runtime/billing-analytics.cjs');

const dimensions = (installDay, classification, source, campaign = null, creative = null) => ({
  install_day: installDay, classification, source, campaign_id: campaign, creative_id: creative,
});
const paid = dimensions('2026-10-20', 'paid', 'vk_ads', 'synthetic-campaign', 'synthetic-creative');
const organic = dimensions('2026-10-20', 'organic', 'organic');

function buildFixture() {
  const input = {
    metadata: {
      game_id: 'slova', run_id: 'IR06-LOCAL-SYNTHETIC-2026-11-04', product_version: 'synthetic-0.1.30',
      geography: 'synthetic-RU', store: 'RuStore', date: '2026-11-04', status: 'synthetic',
      as_of: '2026-11-04T00:00:00+03:00', timezone: 'UTC+03:00', currency: 'RUB',
      population: 'first_confirmed_install_episode', attribution_definition: 'confirmed_mmp_install_first_touch',
      retention_definition: 'calendar_D7_UTC+03:00', revenue_basis: 'net_ex_vat_after_provider_fees',
      revenue_horizon: 'install_instant_through_end_of_calendar_D7',
      refund_policy: 'signed_at_effective_time_no_restatement_after_horizon',
    },
    records: [], attribution: [], net_ledger: [], standard_revenue: [], sdk_impressions: [],
    costs: [{ entry_id: 'synthetic-spend', ...paid, amount_minor: 12000, currency: 'RUB', timezone: 'UTC+03:00',
      population: 'first_confirmed_install_episode', attribution_definition: 'confirmed_mmp_install_first_touch',
      vat_basis: 'inclusive', vat_rate: 0.25 }],
    financial_coverage: [{ ...paid, complete: true, currency: 'RUB', timezone: 'UTC+03:00',
      basis: 'net_ex_vat_after_provider_fees', sources: ['verified_backend', 'boostnet_statement'],
      retention_definition: 'calendar_D7_UTC+03:00', revenue_horizon: 'install_instant_through_end_of_calendar_D7',
      observed_through: '2026-10-28T00:00:00+03:00' }],
  };
  function install(device, key, at, dims, kind = 'first') {
    input.records.push({ record_type: 'install', device_key: device, install_key: key,
      install_datetime: at, install_kind: kind, app_version_name: input.metadata.product_version });
    if (dims) input.attribution.push({ record_id: `mmp-${key}`, device_key: device, install_key: key,
      touch_type: 'acquisition', provider: 'appmetrica', provenance: 'synthetic_confirmed_mmp_install_export',
      recorded_at: at, ...dims });
  }
  function activity(device, key, at, id) {
    input.records.push({ device_key: device, install_key: key, event_name: 'word_submit_outcome', event_timestamp: at,
      event_json: { schema_version: 3, event_id: id, occurred_at: at, app_version: input.metadata.product_version,
        environment: 'production', mode: 'campaign', manual: true, outcome: 'grid' } });
  }
  // Both belong to Moscow Oct 20, although the first UTC timestamp is Oct 19.
  install('18446744073709551615', 'synthetic-install-a', '2026-10-19T21:30:00Z', paid);
  install('18446744073709551614', 'synthetic-install-b', '2026-10-20T09:00:00Z', paid);
  activity('18446744073709551615', 'synthetic-install-a', '2026-10-26T21:05:00Z', 'synthetic-d7-a');
  activity('18446744073709551614', 'synthetic-install-b', '2026-10-26T20:59:59Z', 'synthetic-d6-b');
  input.records.push(structuredClone(input.records[2])); // SDK delivery replay.
  install('1003', 'synthetic-organic', '2026-10-20T10:00:00Z', organic);
  activity('1003', 'synthetic-organic', '2026-10-27T10:00:00Z', 'synthetic-d7-organic');
  install('1004', 'synthetic-unknown', '2026-10-20T10:00:00Z', null);
  const censored = dimensions('2026-10-20', 'paid', 'vk_ads', 'reinstall-policy', 'synthetic-creative');
  install('1005', 'synthetic-old-install', '2026-10-20T10:00:00Z', censored);
  install('1005', 'synthetic-reinstall', '2026-10-22T10:00:00Z', censored, 'reinstall');
  activity('1005', 'synthetic-reinstall', '2026-10-27T10:00:00Z', 'synthetic-after-reinstall');
  install('1006', 'synthetic-no-cost', '2026-10-20T10:00:00Z', dimensions('2026-10-20', 'paid', 'vk_ads', 'no-cost', 'synthetic-creative'));
  install('1007', 'synthetic-young', '2026-11-01T10:00:00Z', dimensions('2026-11-01', 'paid', 'vk_ads', 'young', 'synthetic-creative'));
  // A return campaign and a later acquisition correction never rewrite first touch.
  input.attribution.push({ ...input.attribution[0], record_id: 'synthetic-return', touch_type: 'return', campaign_id: 'return-campaign', recorded_at: '2026-10-27T10:00:00Z' });
  input.attribution.push({ ...input.attribution[0], record_id: 'synthetic-later-touch', campaign_id: 'later-campaign', recorded_at: '2026-10-21T10:00:00Z' });
  input.attribution.push(structuredClone(input.attribution[0]));

  const data = { attempts: {}, subscriptions: {}, payments: {}, refunds: {} };
  const options = { scope: 'synthetic-ir06', mode: 'live', serverBuild: 'synthetic-fixture', time: Date.parse('2026-10-20T10:00:00Z') };
  setBinding(data, 'synthetic-owner', { consent: true, deviceId: '18446744073709551615', installationId: 'synthetic-install-a' }, options.time - 1000);
  let before = snapshotBilling(data);
  data.attempts['synthetic-attempt'] = { mode: 'live', kind: 'initial', planId: 'no_ads_30' };
  data.subscriptions['synthetic-subscription'] = { userId: 'synthetic-owner', mode: 'live', activeUntil: options.time + 30 * 86400000 };
  data.payments['synthetic-payment'] = { attemptId: 'synthetic-attempt', subscriptionId: 'synthetic-subscription', amountMinor: 10000, periodEnd: options.time + 30 * 86400000 };
  recordBillingChanges(data, before, options);
  before = snapshotBilling(data);
  data.refunds['synthetic-refund'] = { state: 'finished', invoiceId: 'synthetic-payment', amountMinor: 2500, confirmedAt: options.time + 86400000 };
  recordBillingChanges(data, before, { ...options, time: options.time + 86400000 });
  recordBillingChanges(data, before, { ...options, time: options.time + 86400000 }); // Idempotent journal replay.
  for (const event of Object.values(data.analytics.events)) {
    const fact = { id: event.id, name: event.name, deviceId: event.deviceId, effectiveAt: event.effectiveAt, payload: event.payload };
    input.net_ledger.push({ entry_id: event.id, source: 'verified_backend', fact,
      // Supplied synthetic settlement: 100 gross / 1.25 - 5 fee = 75;
      // refund -25 gross / 1.25 = -20. This is not a runtime net field.
      net_amount_minor: event.payload.event_type === 'paid' ? 7500 : -2000,
      supplied_settlement_components: { gross_minor: event.payload.amount_minor, vat_basis: 'inclusive',
        vat_rate: 0.25, provider_fee_minor: event.payload.event_type === 'paid' ? 500 : 0 },
      currency: 'RUB', timezone: 'UTC+03:00', basis: 'net_ex_vat_after_provider_fees', confirmed: true });
    const imported = importRequest(event, 'revenue', '123456', 'synthetic-unused-key');
    input.standard_revenue.push({ event_id: event.id, csv: imported.body });
  }
  input.net_ledger.push({ entry_id: 'synthetic-boostnet-net', source: 'boostnet_statement', confirmed: true,
    device_key: '18446744073709551614', install_key: 'synthetic-install-b', effective_at: '2026-10-27T11:00:00Z',
    net_amount_minor: 4500, currency: 'RUB', timezone: 'UTC+03:00', basis: 'net_ex_vat_after_provider_fees' });
  input.net_ledger.push(structuredClone(input.net_ledger[1])); // Financial export replay.
  input.sdk_impressions.push({ impression_id: 'synthetic-estimate', device_key: '18446744073709551614', install_key: 'synthetic-install-b',
    occurred_at: '2026-10-27T11:00:00Z', estimate_minor: 99000, currency: 'RUB' });
  return input;
}

module.exports = { buildFixture, paid };
