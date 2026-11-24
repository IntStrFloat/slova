'use strict';

// IR06 offline synthetic contract, not a collector or a financial source.
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { normalizeRecord, linkInstallEpisodes, analyzeRecords } = require('../../scripts/analyze-retention.cjs');

const DAY = 86400000;
const OFFSET = 3 * 3600000;
const ATTRIBUTION = 'confirmed_mmp_install_first_touch';
const RETENTION = 'calendar_D7_UTC+03:00';
const POPULATION = 'first_confirmed_install_episode';
const BASIS = 'net_ex_vat_after_provider_fees';
const dimensionKeys = ['install_day', 'classification', 'source', 'campaign_id', 'creative_id'];
const cohortKey = (row) => JSON.stringify(dimensionKeys.map((key) => row[key] ?? null));
const identityKey = (device, install) => JSON.stringify([device, install]);
const safeLabel = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,95}$/i.test(value);
const money = (value) => Number.isSafeInteger(value);
function clock(value) {
  return typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
}
function unique(rows, field, quality, counter) {
  const seen = new Map();
  for (const row of rows) {
    if (typeof row?.[field] !== 'string' || !row[field]) throw new Error(`${field} is required for deduplication.`);
    if (seen.has(row[field])) {
      if (!isDeepStrictEqual(seen.get(row[field]), row)) throw new Error(`Conflicting ${field}; no report produced.`);
      quality[counter]++;
    } else seen.set(row[field], row);
  }
  return [...seen.values()];
}
function sum(values) {
  // Signed refunds can cancel large positive terms. Never round an intermediate
  // Number sum before checking its final range.
  const total = values.reduce((a, b) => a + BigInt(b), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Minor-unit sum exceeds safe integer range.');
  }
  return Number(total);
}
function metric(numerator, denominator, unit) {
  return { numerator, denominator, value: numerator !== null && denominator > 0 ? numerator / denominator : null, unit };
}

function analyzeAttributionJoin(input) {
  const m = input?.metadata ?? {};
  if (m.status !== 'synthetic') throw new Error('This bounded IR06 contract requires metadata.status=synthetic.');
  const asOf = clock(m.as_of);
  if (asOf === null) throw new Error('as_of requires an explicit UTC/offset timestamp.');
  for (const field of ['records', 'attribution', 'net_ledger', 'standard_revenue', 'sdk_impressions', 'costs', 'financial_coverage']) {
    if (!Array.isArray(input[field])) throw new Error(`${field} must be an explicit array; missing is not zero.`);
  }
  const globalIssues = [];
  if (!/^[A-Z]{3}$/.test(m.currency ?? '')) globalIssues.push('missing_currency');
  if (m.timezone !== 'UTC+03:00') globalIssues.push('unsupported_timezone_existing_pipeline_requires_UTC+03:00');
  if (m.attribution_definition !== ATTRIBUTION) globalIssues.push('missing_or_incompatible_attribution_definition');
  if (m.retention_definition !== RETENTION) globalIssues.push('missing_or_incompatible_retention_definition');
  if (m.population !== POPULATION) globalIssues.push('missing_or_incompatible_population');
  if (m.revenue_basis !== BASIS) globalIssues.push('missing_or_incompatible_net_basis');
  if (m.revenue_horizon !== 'install_instant_through_end_of_calendar_D7') globalIssues.push('missing_or_incompatible_revenue_horizon');
  if (m.refund_policy !== 'signed_at_effective_time_no_restatement_after_horizon') globalIssues.push('missing_refund_recognition_policy');
  const costContractValid = /^[A-Z]{3}$/.test(m.currency ?? '') && m.timezone === 'UTC+03:00'
    && m.population === POPULATION && m.attribution_definition === ATTRIBUTION;
  const retentionContractValid = costContractValid && m.retention_definition === RETENTION;

  // Reuse the actual parser/episode linker and full retention implementation.
  // Its calendar and censoring rules stay authoritative; no app schema changes.
  const retention = analyzeRecords(input.records, { asOf: m.as_of });
  const events = [];
  const seenEvents = new Set();
  for (const raw of input.records) {
    let event;
    try { event = normalizeRecord(raw); } catch { continue; }
    if (!event.sdkId || event.isTest || ['test', 'development', 'debug', 'preview'].includes(event.environment)
        || event.emittedAtMs !== null && event.emittedAtMs > asOf
        || event.day && event.day > new Date(asOf + OFFSET).toISOString().slice(0, 10)) continue;
    const id = event.eventId ? identityKey(event.sdkId, event.eventId) : null;
    if (id && seenEvents.has(id)) continue;
    if (id) seenEvents.add(id);
    events.push(event);
  }
  const episodes = linkInstallEpisodes(events, { conflictingInstallEpisodes: 0, unknownInstallClassification: 0,
    eventsWithAmbiguousInstall: 0, eventsWithoutInstallEpisode: 0 });
  const quality = { duplicate_attribution_records: 0, duplicate_financial_entries: 0, duplicate_cost_entries: 0,
    duplicate_sdk_impressions: 0, ignored_return_touches: 0, ignored_later_acquisition_touches: 0,
    ignored_standard_revenue_records: input.standard_revenue.length, unallocated_financial_entries: 0,
    financial_entries_outside_horizon: 0, excluded_nonfirst_financial_entries: 0,
    excluded_nonfirst_install_episodes: episodes.filter((e) => e.kind !== 'first' || e.conflict).length };
  const attribution = unique(input.attribution, 'record_id', quality, 'duplicate_attribution_records');
  const ledger = unique(input.net_ledger, 'entry_id', quality, 'duplicate_financial_entries');
  const costs = unique(input.costs, 'entry_id', quality, 'duplicate_cost_entries');
  const impressions = unique(input.sdk_impressions, 'impression_id', quality, 'duplicate_sdk_impressions');
  quality.ignored_return_touches = attribution.filter((row) => row.touch_type === 'return').length;
  const groups = new Map();
  const episodeGroups = new Map();
  for (const episode of episodes.filter((e) => e.kind === 'first' && !e.conflict && e.installDay && e.installMs !== null)) {
    const touches = episode.explicit ? attribution.filter((row) => row.device_key === episode.sdkId && row.install_key === episode.explicit
      && row.touch_type === 'acquisition' && clock(row.recorded_at) !== null && clock(row.recorded_at) <= asOf)
      .sort((a, b) => clock(a.recorded_at) - clock(b.recorded_at) || a.record_id.localeCompare(b.record_id)) : [];
    const first = touches[0];
    quality.ignored_later_acquisition_touches += Math.max(0, touches.length - 1);
    const confirmed = first?.provider === 'appmetrica' && safeLabel(first.provenance)
      && ['paid', 'organic', 'unknown'].includes(first.classification)
      && (first.classification !== 'paid' || safeLabel(first.source) && safeLabel(first.campaign_id))
      && (first.classification !== 'organic' || first.source === 'organic');
    const classification = confirmed ? first.classification : 'unknown';
    const dimensions = { install_day: episode.installDay, classification,
      source: classification === 'unknown' ? 'unknown' : first.source,
      campaign_id: classification === 'paid' ? first.campaign_id : null,
      creative_id: classification === 'paid' && safeLabel(first.creative_id) ? first.creative_id : null };
    const key = cohortKey(dimensions);
    if (!groups.has(key)) groups.set(key, { dimensions, episodes: [], provenance: new Set(), financial: [], estimates: [], invalidFinancial: false });
    const group = groups.get(key);
    group.episodes.push(episode);
    if (confirmed) group.provenance.add(first.provenance);
    if (episode.explicit) episodeGroups.set(identityKey(episode.sdkId, episode.explicit), group);
  }

  const unallocated = [];
  for (const row of ledger) {
    const p = row.fact?.payload;
    const device = row.source === 'verified_backend' ? row.fact?.deviceId : row.device_key;
    const install = row.source === 'verified_backend' ? p?.originating_installation_id : row.install_key;
    const group = episodeGroups.get(identityKey(device, install));
    const at = row.source === 'verified_backend' ? row.fact?.effectiveAt : clock(row.effective_at);
    let valid = row.confirmed === true && money(row.net_amount_minor) && row.currency === m.currency
      && row.timezone === m.timezone && m.timezone === 'UTC+03:00' && row.basis === BASIS
      && m.revenue_basis === BASIS && Number.isSafeInteger(at) && at <= asOf
      && (row.observed_at === undefined || clock(row.observed_at) !== null && clock(row.observed_at) <= asOf);
    if (row.source === 'verified_backend') {
      valid &&= row.fact?.name === 'subscription_server_event' && row.fact?.id === row.entry_id
        && p?.event_id === row.entry_id && p?.server_event_id === row.entry_id
        && p?.schema_version === 3 && p?.producer === 'backend' && p?.environment === 'live'
        && p?.time_trust === 'server_verified' && p?.binding_state === 'bound'
        && ['paid', 'renewed', 'refunded'].includes(p?.event_type) && p?.currency === m.currency
        && clock(p?.effective_at) === at && clock(p?.occurred_at) === at
        && clock(p?.observed_at) !== null && clock(p?.observed_at) <= asOf
        && money(p?.amount_minor) && (p?.event_type === 'refunded'
          ? p.amount_minor < 0 && row.net_amount_minor <= 0 : p.amount_minor > 0 && row.net_amount_minor >= 0);
    } else valid &&= row.source === 'boostnet_statement';
    if (!group) {
      if (episodes.some((e) => e.sdkId === device && e.explicit === install && e.kind !== 'first')) quality.excluded_nonfirst_financial_entries++;
      else { quality.unallocated_financial_entries++; unallocated.push({ row, valid }); }
      continue;
    }
    const episode = group.episodes.find((e) => e.sdkId === device && e.explicit === install);
    const end = Date.parse(`${episode.installDay}T00:00:00Z`) - OFFSET + 8 * DAY;
    if (Number.isSafeInteger(at) && (at < episode.installMs || at >= Math.min(end, episode.endMs, asOf + 1))) {
      quality.financial_entries_outside_horizon++; continue;
    }
    if (!valid) group.invalidFinancial = true;
    else group.financial.push(row);
  }
  for (const row of impressions) {
    const group = episodeGroups.get(identityKey(row.device_key, row.install_key));
    const episode = group?.episodes.find((e) => e.sdkId === row.device_key && e.explicit === row.install_key);
    const at = clock(row.occurred_at);
    const end = episode && Date.parse(`${episode.installDay}T00:00:00Z`) - OFFSET + 8 * DAY;
    if (episode && at !== null && at >= episode.installMs && at < Math.min(end, episode.endMs, asOf + 1)) group.estimates.push(row);
  }

  const cohorts = [...groups.values()].map((group) => {
    const unsupported = [...globalIssues];
    const devices = new Set(group.episodes.map((e) => e.sdkId));
    const records = input.records.filter((raw) => { try { return devices.has(normalizeRecord(raw).sdkId); } catch { return false; } });
    const result = analyzeRecords(records, { asOf: m.as_of, cohortFrom: group.dimensions.install_day, cohortTo: group.dimensions.install_day });
    const d7 = result.retention.find((r) => r.day === 7);
    const installs = group.episodes.length;
    if (d7.play.denominator !== installs) unsupported.push('incomplete_or_reinstall_censored_D7_horizon');
    const exactCosts = costs.filter((row) => cohortKey(row) === cohortKey(group.dimensions));
    const validCosts = exactCosts.length > 0 && exactCosts.every((row) => money(row.amount_minor) && row.amount_minor >= 0
      && row.currency === m.currency && row.timezone === m.timezone && row.population === POPULATION
      && row.attribution_definition === ATTRIBUTION && ['inclusive', 'exclusive'].includes(row.vat_basis)
      && typeof row.vat_rate === 'number' && Number.isFinite(row.vat_rate) && row.vat_rate >= 0 && row.vat_rate <= 1);
    if (!validCosts) unsupported.push('missing_or_incompatible_cohort_expense_currency_timezone_VAT_or_population');
    const expense = costContractValid && validCosts
      ? sum(exactCosts.map((row) => row.vat_basis === 'inclusive' ? Math.round(row.amount_minor / (1 + row.vat_rate)) : row.amount_minor)) : null;
    const end = Date.parse(`${group.dimensions.install_day}T00:00:00Z`) - OFFSET + 8 * DAY;
    const coverage = input.financial_coverage.filter((row) => cohortKey(row) === cohortKey(group.dimensions));
    const complete = coverage.length === 1 && coverage[0].complete === true && coverage[0].currency === m.currency
      && coverage[0].timezone === m.timezone && coverage[0].basis === BASIS && clock(coverage[0].observed_through) >= end
      && clock(coverage[0].observed_through) <= asOf && coverage[0].retention_definition === RETENTION
      && coverage[0].revenue_horizon === m.revenue_horizon
      && Array.isArray(coverage[0].sources) && ['verified_backend', 'boostnet_statement'].every((s) => coverage[0].sources.includes(s));
    if (!complete) unsupported.push('missing_or_incomplete_financial_coverage');
    if (group.invalidFinancial) unsupported.push('invalid_or_incompatible_financial_settlement');
    if (unallocated.length) unsupported.push('unallocated_financial_facts_prevent_complete_cohort_reconciliation');
    if (expense === 0) unsupported.push('zero_expense_ROAS_denominator');
    const revenueKnown = !globalIssues.length && d7.play.denominator === installs && complete && !group.invalidFinancial && !unallocated.length;
    const billing = revenueKnown ? sum(group.financial.filter((r) => r.source === 'verified_backend').map((r) => r.net_amount_minor)) : null;
    const boostnet = revenueKnown ? sum(group.financial.filter((r) => r.source === 'boostnet_statement').map((r) => r.net_amount_minor)) : null;
    const net = revenueKnown ? sum([billing, boostnet]) : null;
    const estimateKnown = group.estimates.length > 0 && group.estimates.every((r) => money(r.estimate_minor) && r.estimate_minor >= 0 && r.currency === m.currency);
    return { dimensions: group.dimensions, installs, mature_d7: d7.play.denominator,
      attribution_provenance: [...group.provenance].sort(),
      d7_open: { ...d7.open, rate: retentionContractValid ? d7.open.rate : null },
      d7_play: { ...d7.play, rate: retentionContractValid ? d7.play.rate : null },
      cost: { amount_minor: expense, currency: m.currency ?? null, basis: 'vat_exclusive',
        vat_rates_supplied: [...new Set(exactCosts.map((r) => r.vat_rate).filter((v) => typeof v === 'number'))].sort(),
        rounding: 'per_cost_row_to_nearest_minor_unit' },
      net_revenue: { amount_minor: net, billing_minor: billing, boostnet_minor: boostnet, currency: m.currency ?? null, basis: BASIS },
      sdk_impression_estimates: { amount_minor: estimateKnown ? sum(group.estimates.map((r) => r.estimate_minor)) : null,
        currency: m.currency ?? null, financial_revenue: false },
      metrics: { cpi: metric(expense, installs, 'minor_currency_units_per_first_install'),
        net_roas: metric(net, expense, 'ratio'), observed_net_arpu_d0_d7: metric(net, installs, 'minor_currency_units_per_first_install') },
      unsupported: [...new Set(unsupported)].sort() };
  }).sort((a, b) => cohortKey(a.dimensions).localeCompare(cohortKey(b.dimensions)));
  const unallocatedKnown = unallocated.length > 0 && unallocated.every((entry) => entry.valid);
  return { game_id: m.game_id, run_id: m.run_id, product_version: m.product_version, geography: m.geography,
    store: m.store, date: m.date, status: 'synthetic', title: 'SYNTHETIC — IR06 local attribution/retention/net-ledger/cost join',
    metadata: Object.fromEntries(['as_of', 'timezone', 'currency', 'population', 'attribution_definition',
      'retention_definition', 'revenue_basis', 'revenue_horizon', 'refund_policy'].map((key) => [key, m[key] ?? null])),
    cohorts, quality, retention_quality: retention.quality,
    unallocated_net_ledger: { entries: unallocated.length, amount_minor: unallocatedKnown ? sum(unallocated.map((entry) => entry.row.net_amount_minor)) : null,
      currency: m.currency ?? null, attributed_to_cohorts: false },
    evidence: [{ id: 'IR06-LOCAL', type: 'observation', date: m.date, source: 'synthetic local fixtures through existing retention and pure billing journal protocol',
      limitation: 'No real SDK attribution, store install, network, financial or campaign result measured.' }],
    unsupported_fields: ['predicted_LTV', 'company_profit', 'causal_incrementality', 'statistical_significance',
      'variable_costs', 'creative_costs', 'fixed_costs', 'store_page_conversion'],
    decisions: ['Keep existing AppMetrica as acquisition owner; no additional collector.', 'Use only supplied canonical net settlements; never sum standard/custom revenue or SDK estimates.'],
    next_action: 'Review this local contract; actual tagged store/MMP/campaign/net-finance reconciliation remains a future release checklist.',
    limitations: ['Entirely synthetic input; live/production payload labels simulate the existing export protocol only.',
      'D7 uses existing UTC+03:00 complete calendar days, not rolling 168–192 hours. Revenue runs from installation instant to end of calendar D7.',
      'This source-specific calendar description is not the G4 elapsed-24h experiment protocol. Do not compare or merge the two D7 definitions.',
      'Billing runtime facts are gross. Net settlement amounts and Boostnet install-level linkage are explicitly supplied fixtures, not existing measured network fields.',
      'Coverage is an explicit input assertion, not a proof of export completeness. Missing coverage or unallocated financial facts yields null.',
      'VAT rates are supplied synthetic parameters, not legal tax rates; no fee/VAT is deducted again from supplied net revenue.',
      'CPI divides compatible whole-cohort expense by all first installs. D7 financial metrics require every install to have the full uncensored horizon.',
      'Signed refunds use effective time; later-horizon adjustments are reported outside this horizon rather than silently restating it.',
      'Backend observed_at and any supplied settlement observed_at must be available by as_of; an earlier effective date does not prove earlier observation.',
      'Attribution is not a causal effect. Observed D0–D7 revenue/ROAS is not predicted LTV or company profit; variable/creative/fixed costs and future tail are unsupported.'] };
}

module.exports = { analyzeAttributionJoin };
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--input') throw new Error('Usage: node backend/scripts/attribution-join.cjs --input synthetic.json');
    const input = JSON.parse(fs.readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
    process.stdout.write(`${JSON.stringify(analyzeAttributionJoin(input), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
