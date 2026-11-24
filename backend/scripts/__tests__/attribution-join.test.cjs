'use strict';
/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { analyzeAttributionJoin } = require('../attribution-join.cjs');
const { analyzeRecords } = require('../../../scripts/analyze-retention.cjs');
const { buildFixture, paid } = require('./fixtures/attribution-join.cjs');
const main = (report) => report.cohorts.find((c) => c.dimensions.campaign_id === 'synthetic-campaign');

test('synthetic join uses real journal facts and existing retention with exact D7 numerators/denominators', () => {
  const input = buildFixture();
  const report = analyzeAttributionJoin(input);
  const cohort = main(report);
  assert.equal(report.status, 'synthetic');
  assert.equal(cohort.installs, 2);
  assert.equal(cohort.mature_d7, 2);
  assert.deepEqual(cohort.d7_play, { numerator: 1, denominator: 2, rate: 0.5 });
  assert.equal(analyzeRecords(input.records, { asOf: input.metadata.as_of }).retention.find((r) => r.day === 7).play.numerator, 2);
  const facts = input.net_ledger.filter((r) => r.source === 'verified_backend');
  assert.deepEqual([...new Set(facts.map((r) => r.fact.payload.event_type))].sort(), ['paid', 'refunded']);
  for (const row of facts) {
    const supplied = row.supplied_settlement_components;
    assert.equal(row.net_amount_minor, Math.round(row.fact.payload.amount_minor / (1 + supplied.vat_rate)) - supplied.provider_fee_minor);
  }
  assert.ok(input.standard_revenue.some((r) => r.csv.includes('"refund"')));
  assert.equal(cohort.net_revenue.billing_minor, 5500);
  assert.equal(cohort.net_revenue.boostnet_minor, 4500);
  assert.equal(cohort.net_revenue.amount_minor, 10000);
  assert.equal(cohort.cost.amount_minor, 9600);
  assert.equal(cohort.metrics.cpi.numerator, 9600);
  assert.equal(cohort.metrics.cpi.denominator, 2);
  assert.equal(cohort.metrics.cpi.value, 4800);
  assert.equal(cohort.metrics.net_roas.value, 10000 / 9600);
  assert.equal(cohort.metrics.observed_net_arpu_d0_d7.value, 5000);
  assert.equal(cohort.sdk_impression_estimates.amount_minor, 99000);
  assert.equal(report.quality.duplicate_financial_entries, 1);
  assert.equal(report.quality.duplicate_attribution_records, 1);
  assert.equal(report.quality.ignored_standard_revenue_records, 2);
});

test('first acquisition touch and provenance survive replay, late result, return campaign and row order', () => {
  const input = buildFixture();
  // Callback/export arrival may be later than the initial custom events.
  input.attribution[0].recorded_at = '2026-10-20T23:00:00Z';
  input.attribution[input.attribution.length - 1].recorded_at = input.attribution[0].recorded_at;
  const a = analyzeAttributionJoin(input);
  input.attribution.reverse();
  const b = analyzeAttributionJoin(input);
  assert.deepEqual(a, b);
  assert.equal(main(a).installs, 2);
  assert.deepEqual(main(a).attribution_provenance, ['synthetic_confirmed_mmp_install_export']);
  assert.equal(a.quality.ignored_return_touches, 1);
  assert.equal(a.quality.ignored_later_acquisition_touches, 1);
  assert.equal(a.cohorts.some((c) => ['return-campaign', 'later-campaign'].includes(c.dimensions.campaign_id)), false);
});

test('unknown acquisition stays unknown; explicit MMP organic remains separate', () => {
  const report = analyzeAttributionJoin(buildFixture());
  assert.equal(report.cohorts.find((c) => c.dimensions.classification === 'unknown').installs, 1);
  assert.equal(report.cohorts.find((c) => c.dimensions.classification === 'organic').installs, 1);
  assert.equal(report.cohorts.find((c) => c.dimensions.classification === 'organic').metrics.cpi.value, null);
  const input = buildFixture();
  delete input.attribution.find((r) => r.install_key === 'synthetic-organic').provenance;
  assert.equal(analyzeAttributionJoin(input).cohorts.find((c) => c.dimensions.classification === 'unknown').installs, 2);
});

test('reinstall censors the old first install; new install and immature cohort cannot supply D7 money', () => {
  const report = analyzeAttributionJoin(buildFixture());
  const old = report.cohorts.find((c) => c.dimensions.campaign_id === 'reinstall-policy');
  const young = report.cohorts.find((c) => c.dimensions.campaign_id === 'young');
  assert.equal(old.installs, 1);
  assert.deepEqual(old.d7_play, { numerator: 0, denominator: 0, rate: null });
  assert.equal(old.net_revenue.amount_minor, null);
  assert.equal(young.mature_d7, 0);
  assert.equal(young.metrics.observed_net_arpu_d0_d7.value, null);
  assert.equal(report.quality.excluded_nonfirst_install_episodes, 1);
});

test('incomplete cohort cannot divide total cost by only mature installations or advertise full-horizon ROAS', () => {
  const input = buildFixture();
  input.records.push({ record_type: 'install', device_key: '18446744073709551614', install_key: 'synthetic-second-reinstall', install_kind: 'reinstall', install_datetime: '2026-10-22T10:00:00Z' });
  const cohort = main(analyzeAttributionJoin(input));
  assert.equal(cohort.mature_d7, 1);
  assert.equal(cohort.metrics.cpi.denominator, 2); // Acquisition cost still divides all first installs.
  assert.equal(cohort.metrics.net_roas.value, null);
  assert.equal(cohort.metrics.observed_net_arpu_d0_d7.value, null);
});

test('supplied VAT parameter converts inclusive spend; exclusive cost is never divided twice', () => {
  const input = buildFixture();
  input.costs[0].vat_rate = 0.5;
  assert.equal(main(analyzeAttributionJoin(input)).cost.amount_minor, 8000);
  input.costs[0].vat_basis = 'exclusive';
  assert.equal(main(analyzeAttributionJoin(input)).cost.amount_minor, 12000);
  delete input.costs[0].vat_rate;
  assert.equal(main(analyzeAttributionJoin(input)).metrics.cpi.value, null);
});

for (const mutation of ['currency', 'timezone', 'population', 'attribution_definition']) {
  test(`incompatible cost ${mutation} is unknown expense, never a free acquisition`, () => {
    const input = buildFixture();
    input.costs[0][mutation] = 'incompatible';
    const cohort = main(analyzeAttributionJoin(input));
    assert.equal(cohort.cost.amount_minor, null);
    assert.equal(cohort.metrics.cpi.value, null);
    assert.equal(cohort.metrics.net_roas.value, null);
  });
}

test('missing definition, currency, expense and settlement completeness produce explicit null metrics', () => {
  for (const key of ['currency', 'attribution_definition', 'retention_definition']) {
    const input = buildFixture();
    delete input.metadata[key];
    const cohort = main(analyzeAttributionJoin(input));
    assert.equal(cohort.metrics.net_roas.value, null, key);
    assert.ok(cohort.unsupported.length, key);
  }
  const input = buildFixture();
  input.financial_coverage = [];
  assert.equal(main(analyzeAttributionJoin(input)).net_revenue.amount_minor, null);
  assert.equal(analyzeAttributionJoin(input).cohorts.find((c) => c.dimensions.campaign_id === 'no-cost').cost.amount_minor, null);
});

test('missing or mismatched calendar definition cannot be reported as a measured D7 rate', () => {
  for (const [field, value] of [['retention_definition', undefined], ['retention_definition', 'elapsed24h_D7'], ['timezone', 'UTC']]) {
    const input = buildFixture();
    input.metadata[field] = value;
    const cohort = main(analyzeAttributionJoin(input));
    assert.equal(cohort.d7_play.rate, null, `${field}=${value}`);
    assert.equal(cohort.d7_open.rate, null, `${field}=${value}`);
    assert.ok(cohort.unsupported.some((reason) => /definition|timezone/.test(reason)));
  }
});

test('financial coverage cannot claim a reporting cutoff beyond the fixed as-of', () => {
  const input = buildFixture();
  input.financial_coverage[0].observed_through = '2026-12-01T00:00:00+03:00';
  assert.equal(main(analyzeAttributionJoin(input)).net_revenue.amount_minor, null);
});

test('financial coverage on elapsed-24h D7 cannot be joined into the calendar D7 cohort', () => {
  const input = buildFixture();
  input.financial_coverage[0].retention_definition = 'elapsed24h_D7';
  assert.equal(main(analyzeAttributionJoin(input)).net_revenue.amount_minor, null);
});

test('unknown input metadata is not copied into an aggregate report', () => {
  const input = buildFixture();
  input.metadata.private_debug = 'synthetic-private-metadata';
  const output = JSON.stringify(analyzeAttributionJoin(input));
  assert.equal(output.includes('synthetic-private-metadata'), false);
});

test('duplicate costs and impressions remain one record; conflicting attribution IDs fail closed', () => {
  const input = buildFixture();
  input.costs.push(structuredClone(input.costs[0]));
  input.sdk_impressions.push(structuredClone(input.sdk_impressions[0]));
  const report = analyzeAttributionJoin(input);
  assert.equal(main(report).cost.amount_minor, 9600);
  assert.equal(main(report).sdk_impression_estimates.amount_minor, 99000);
  assert.equal(report.quality.duplicate_cost_entries, 1);
  assert.equal(report.quality.duplicate_sdk_impressions, 1);
  input.attribution.push({ ...input.attribution[0], classification: 'organic' });
  assert.throws(() => analyzeAttributionJoin(input), /conflicting.*record_id/i);
});

test('signed refunds stay negative and unverified client financial lookalikes cannot become net revenue', () => {
  const input = buildFixture();
  for (const row of input.net_ledger.filter((r) => r.fact?.payload.event_type === 'refunded')) row.net_amount_minor = 2000;
  assert.equal(main(analyzeAttributionJoin(input)).net_revenue.amount_minor, null);
  const client = buildFixture();
  client.net_ledger[0].fact.payload.producer = 'client';
  assert.equal(main(analyzeAttributionJoin(client)).net_revenue.amount_minor, null);
});

test('SDK estimate and standard revenue changes cannot alter canonical net revenue', () => {
  const input = buildFixture();
  input.sdk_impressions[0].estimate_minor *= 1000;
  input.standard_revenue.push(...structuredClone(input.standard_revenue));
  assert.equal(main(analyzeAttributionJoin(input)).net_revenue.amount_minor, 10000);
});

test('wrong currency, missing settlement basis or unconfirmed settlement cannot become net revenue', () => {
  for (const [field, value] of [['currency', 'USD'], ['basis', null], ['confirmed', false]]) {
    const input = buildFixture();
    input.net_ledger[0][field] = value;
    const cohort = main(analyzeAttributionJoin(input));
    assert.equal(cohort.net_revenue.amount_minor, null, field);
    assert.equal(cohort.metrics.net_roas.value, null, field);
  }
});

test('unlinked Boostnet statement is separately reported, with no invented installation allocation', () => {
  const input = buildFixture();
  delete input.net_ledger[2].install_key;
  const report = analyzeAttributionJoin(input);
  assert.equal(report.quality.unallocated_financial_entries, 1);
  assert.equal(report.unallocated_net_ledger.amount_minor, 4500);
  assert.equal(main(report).net_revenue.amount_minor, null);
});

test('signed minor-unit sums are exact even if intermediate safe terms temporarily exceed safe range', () => {
  const input = buildFixture();
  input.net_ledger = [...new Map(input.net_ledger.map((r) => [r.entry_id, r])).values()];
  const paid = input.net_ledger.find((r) => r.fact?.payload.event_type === 'paid');
  const refund = input.net_ledger.find((r) => r.fact?.payload.event_type === 'refunded');
  const boost = input.net_ledger.find((r) => r.source === 'boostnet_statement');
  paid.net_amount_minor = paid.fact.payload.amount_minor = Number.MAX_SAFE_INTEGER;
  refund.net_amount_minor = refund.fact.payload.amount_minor = -Number.MAX_SAFE_INTEGER;
  const second = structuredClone(paid);
  second.entry_id = second.fact.id = second.fact.payload.event_id = second.fact.payload.server_event_id = 'f'.repeat(64);
  second.fact.payload.pseudonymous_payment_key = 'e'.repeat(64);
  second.net_amount_minor = second.fact.payload.amount_minor = 2;
  input.net_ledger = [paid, second, refund, boost];
  const cohort = main(analyzeAttributionJoin(input));
  assert.equal(cohort.net_revenue.billing_minor, 2);
  assert.equal(cohort.net_revenue.amount_minor, 4502);
  second.net_amount_minor = second.fact.payload.amount_minor = 3;
  input.net_ledger = [paid, second, boost];
  assert.throws(() => analyzeAttributionJoin(input), /safe integer range/);
});

test('canonical fact observed after as-of cannot enter a historical net report even with an earlier effective date', () => {
  const input = buildFixture();
  for (const row of input.net_ledger.filter((r) => r.fact?.payload.event_type === 'refunded')) {
    row.fact.payload.observed_at = '2026-12-01T00:00:00Z';
  }
  const cohort = main(analyzeAttributionJoin(input));
  assert.equal(cohort.net_revenue.amount_minor, null);
  assert.ok(cohort.unsupported.includes('invalid_or_incompatible_financial_settlement'));
});

test('unallocated totals require the same confirmation, source, time and currency contract as allocated net', () => {
  for (const [field, value] of [['confirmed', false], ['source', 'sdk_estimate'], ['timezone', 'UTC'],
    ['effective_at', '2026-12-01T00:00:00Z'], ['currency', 'USD']]) {
    const input = buildFixture();
    const row = { ...input.net_ledger.find((r) => r.source === 'boostnet_statement'),
      entry_id: 'synthetic-unconfirmed-unallocated', device_key: 'unmatched', install_key: 'unmatched', [field]: value };
    input.net_ledger.push(row);
    const report = analyzeAttributionJoin(input);
    assert.equal(report.unallocated_net_ledger.amount_minor, null, field);
    assert.equal(main(report).net_revenue.amount_minor, null, field);
  }
});

test('null installation IDs cannot turn a timestamp-only retention episode into paid financial attribution', () => {
  const input = buildFixture();
  input.records = input.records.filter((r) => r.device_key === '18446744073709551615');
  for (const row of input.records) delete row.install_key;
  input.attribution = input.attribution.filter((r) => r.device_key === '18446744073709551615');
  for (const row of input.attribution) row.install_key = null;
  input.net_ledger = [{ ...input.net_ledger.find((r) => r.source === 'boostnet_statement'),
    device_key: '18446744073709551615', install_key: null }];
  input.sdk_impressions = [];
  const report = analyzeAttributionJoin(input);
  assert.equal(report.cohorts.length, 1);
  assert.equal(report.cohorts[0].dimensions.classification, 'unknown');
  assert.equal(report.cohorts[0].installs, 1);
  assert.equal(report.quality.unallocated_financial_entries, 1);
  assert.equal(report.cohorts[0].net_revenue.amount_minor, null);
});

test('conflicting financial business keys fail closed and input objects are never mutated', () => {
  const input = buildFixture();
  const initial = structuredClone(input);
  analyzeAttributionJoin(input);
  assert.deepEqual(input, initial);
  input.net_ledger.push({ ...input.net_ledger[0], net_amount_minor: 1 });
  assert.throws(() => analyzeAttributionJoin(input), /conflicting.*entry_id/i);
});

test('canonical ledger effective time excludes a D8 refund and does not apply it twice to the D7 horizon', () => {
  const input = buildFixture();
  for (const row of input.net_ledger.filter((r) => r.fact?.payload.event_type === 'refunded')) {
    row.fact.effectiveAt = Date.parse('2026-10-28T00:00:00+03:00');
    row.fact.payload.effective_at = '2026-10-27T21:00:00.000Z';
    row.fact.payload.occurred_at = row.fact.payload.effective_at;
  }
  const report = analyzeAttributionJoin(input);
  assert.equal(main(report).net_revenue.amount_minor, 12000);
  assert.equal(report.quality.financial_entries_outside_horizon, 1);
});

test('CLI is deterministic, local, aggregate-only and emits no device/installation identifiers', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-ir06-local-'));
  const file = path.join(dir, 'synthetic.json');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  const input = buildFixture();
  fs.writeFileSync(file, JSON.stringify(input));
  const command = path.resolve(__dirname, '../attribution-join.cjs');
  const output = execFileSync(process.execPath, [command, '--input', file], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), analyzeAttributionJoin(input));
  assert.equal(output.includes('18446744073709551615'), false);
  assert.equal(output.includes('synthetic-install-a'), false);
  assert.equal(output.includes('synthetic-unused-key'), false);
  assert.equal(output.includes('synthetic-owner'), false);
  assert.deepEqual(main(JSON.parse(output)).dimensions, paid);
});
