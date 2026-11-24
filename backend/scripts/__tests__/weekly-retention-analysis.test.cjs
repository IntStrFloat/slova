'use strict';
/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { analyzeWeeklyRetention: analyze, buildNeedsRawDataReport, renderMarkdown, readInputFiles, parseArguments, wilson95 } = require('../../../scripts/analyze-weekly-retention.cjs');
const { createCalendarObservationContext } = require('../../../scripts/analyze-help-funnel.cjs');

const options = { baselineStart: '2026-10-01', currentStart: '2026-10-08', timezone: 'UTC+03:00', asOf: '2026-11-01T00:00:00+03:00', source: 'synthetic' };
const INSTALL = '2026-10-08T09:00:00Z';
let sequence = 0;
function install(player, when = INSTALL, extra = {}) {
  return { record_type: 'install', appmetrica_device_id: player, installation_id: `installation-${player}`,
    install_timestamp: String(Date.parse(when) / 1000), app_version_name: '0.1.29', environment: 'production',
    is_reinstallation: false, is_reattribution: false, ...extra };
}
function event(player, name, when = '2026-10-09T09:00:00Z', properties = {}, extra = {}) {
  const time = new Date(typeof when === 'number' ? when : Date.parse(when)).toISOString();
  return { appmetrica_device_id: player, installation_id: `installation-${player}`, event_name: name, event_datetime: time,
    app_version_name: '0.1.30', event_json: { schema_version: 3, event_id: `weekly-private-event-${++sequence}`,
      app_version: '0.1.30', environment: 'production', consent_state: 'enabled', time_trust: 'client_unverified', occurred_at: time, ...properties }, ...extra };
}
function session(player, when = '2026-10-09T09:00:00Z', extra = {}) {
  return { record_type: 'session', appmetrica_device_id: player, installation_id: `installation-${player}`,
    session_start_timestamp: String(Date.parse(when) / 1000), environment: 'production', app_version_name: '0.1.30', ...extra };
}
const week = (records, override = {}) => analyze(records, { ...options, ...override }).metrics.weeks[1];
const row = (records, day = 'D1', kind = 'gameplay', override = {}) => week(records, override).retention[day][kind];
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function temporary(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-retention-'));
  try { run(dir); } finally {
    assert.ok(path.resolve(dir).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(dir).startsWith('weekly-retention-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const cli = (args) => spawnSync(process.execPath, [path.resolve(__dirname, '../../../scripts/analyze-weekly-retention.cjs'), ...args], { encoding: 'utf8' });
const cliOptions = ['--baseline-start', options.baselineStart, '--current-start', options.currentStart, '--timezone', options.timezone, '--as-of', options.asOf, '--source', 'synthetic'];
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('no raw exports leaves measured values null, provenance unverified and experiment inactive', () => {
  const report = buildNeedsRawDataReport(options);
  assert.deepEqual(analyze([], options), report);
  assert.equal(report.status, 'needs_raw_data'); assert.equal(report.metrics, null); assert.equal(report.quality, null);
  assert.equal(report.source.synthetic, true); assert.equal(report.source.productionMetricsVerified, false);
  assert.equal(report.experiment.enabled, false); assert.equal(report.experiment.assignmentReturnIncluded, false);
  assert.match(renderMarkdown(report), /SYNTHETIC DEVELOPMENT DATA; NOT LIVE/);
  const production = buildNeedsRawDataReport({ ...options, source: 'production' });
  assert.equal(production.source.synthetic, false); assert.equal(production.source.productionMetricsVerified, false);
});

test('requires explicit two full ordered weeks, fixed timezone, as-of and bounded SDK environment', () => {
  for (const override of [{ baselineStart: '2026-02-30' }, { currentStart: '2026-10-07' }, { timezone: undefined },
    { timezone: 'Europe/Moscow' }, { asOf: '2026-10-14T00:00:00+03:00' }, { asOf: '2026-11-01 00:00:00' },
    { sdkEnvironment: 'live' }, { source: 'tracker-name' }]) assert.throws(() => analyze([], { ...options, ...override }));
  assert.throws(() => analyze({}, options), /array/);
});

test('known absent return is 0/N while no first-install denominator is null', () => {
  const known = row([install('zero')]);
  assert.equal(known.N, 1); assert.equal(known.numerator, 0); assert.equal(known.rate, 0);
  assert.deepEqual(known.bounds, { lower: 0, upper: 0 }); assert.ok(known.samplingUncertainty.interval.upper > 0.79);
  const missing = row([event('custom-only', 'word_submitted', undefined, { manual: true }, { install_kind: 'first', is_reinstallation: false, install_timestamp: Date.parse(INSTALL) / 1000 })]);
  assert.equal(missing.N, 0); assert.equal(missing.rate, null); assert.equal(missing.bounds, null); assert.equal(missing.samplingUncertainty.interval, null);
});

test('SDK flags accept boolean and explicit strings without changing legacy normalizer', () => {
  for (const flag of [false, 'false']) {
    const result = row([install('p', INSTALL, { is_reinstallation: flag, is_reattribution: flag }), event('p', 'word_submitted', undefined, { manual: true })]);
    assert.equal(result.N, 1); assert.equal(result.rate, 1);
  }
  for (const flags of [{ is_reinstallation: undefined }, { is_reattribution: undefined }, { is_reinstallation: 0 }, { is_reattribution: 'FALSE' }]) {
    const result = analyze([install('p', INSTALL, flags), event('p', 'app_open')], options);
    assert.equal(result.metrics.weeks[1].retention.D1.open.N, 0);
    assert.equal(result.metrics.population.sdkInstallEpisodeClassification.unknown, 1);
  }
});

test('reinstallation and reattribution never become new-player install cohorts', () => {
  for (const flags of [{ is_reinstallation: true }, { is_reinstallation: 'true' }, { is_reattribution: true }, { is_reattribution: 'true', is_reinstallation: 'false' }]) {
    const result = analyze([install('old', INSTALL, flags), event('old', 'word_submitted', undefined, { manual: true })], options);
    assert.equal(result.metrics.population.firstInstallUnits, 0);
    assert.equal(result.metrics.weeks[1].retention.D1.gameplay.N, 0);
    assert.equal(result.metrics.population.sdkInstallEpisodeClassification.reinstall + result.metrics.population.sdkInstallEpisodeClassification.reattribution, 1);
  }
});

test('exact D1 uses the requested timezone, including its inclusive start and exclusive end', () => {
  const start = Date.parse('2026-10-08T21:00:00Z'); const end = start + 86400000;
  for (const [time, expected] of [[start - 1, 0], [start, 1], [end - 1, 1], [end, 0]]) {
    assert.equal(row([install('p'), event('p', 'word_submitted', time, { manual: true })]).rate, expected);
  }
  const records = [install('p', '2026-10-08T23:59:00Z'), event('p', 'word_submitted', '2026-10-09T00:01:00Z', { manual: true })];
  assert.equal(row(records, 'D1', 'gameplay', { timezone: 'UTC' }).rate, 1);
  assert.equal(row(records).rate, 0);
});

test('D14 is an exact target day, never cumulative or rolling 24-hour retention', () => {
  for (const [when, expected] of [['2026-10-21T20:59:59.999Z', 0], ['2026-10-21T21:00:00Z', 1], ['2026-10-22T20:59:59.999Z', 1], ['2026-10-22T21:00:00Z', 0]]) {
    assert.equal(row([install('p'), event('p', 'word_submitted', when, { manual: true })], 'D14').rate, expected);
  }
  const early = [install('p'), event('p', 'word_submitted', '2026-10-22T09:00:00Z', { manual: true })];
  const beforeEnd = row(early, 'D14', 'gameplay', { asOf: '2026-10-22T20:59:59.999Z' });
  assert.equal(beforeEnd.N, 0); assert.equal(beforeEnd.immatureUnits, 1); assert.equal(beforeEnd.numerator, 0);
  assert.equal(row(early, 'D14', 'gameplay', { asOf: '2026-10-22T21:00:00Z' }).rate, 1);
});

test('incomplete week maturity blocks comparison even when every supplied sample is already mature', () => {
  const records = [install('baseline', '2026-10-01T09:00:00Z'), install('current')];
  const result = analyze(records, { ...options, asOf: '2026-10-23T00:00:00+03:00' });
  assert.equal(result.metrics.weeks[0].maturity.D14.fullyMature, true);
  assert.equal(result.metrics.weeks[1].retention.D14.gameplay.N, 1);
  assert.equal(result.metrics.weeks[1].retention.D14.gameplay.immatureUnits, 0);
  assert.equal(result.metrics.weeks[1].maturity.D14.fullyMature, false);
  assert.equal(result.metrics.comparison.retention.D14.gameplay.comparableFullWeeks, false);
  assert.equal(result.metrics.comparison.retention.D14.gameplay.rateDifference, null);
  assert.equal(result.metrics.comparison.strata.versions[0].retention.D14.gameplay.rateDifference, null);
  assert.match(renderMarkdown(result), /PARTIAL; no full-week comparison/);
});

test('partial maturity retains all eligible cohort units and exposes immature units outside mature N', () => {
  const result = week([install('early'), install('late', '2026-10-14T12:00:00Z')], { asOf: '2026-10-23T00:00:00+03:00' }).retention.D14.gameplay;
  assert.equal(result.eligibleUnits, 2); assert.equal(result.N, 1); assert.equal(result.immatureUnits, 1); assert.equal(result.status, 'partially_mature');
});

test('install version and primary attribution survive upgraded senders and later reattribution', () => {
  const first = install('p', INSTALL, { publisher_id: '42', tracking_id: '123', publisher_name: 'private-original-source' });
  const returned = event('p', 'word_submitted', undefined, { manual: true, entry_source: 'wheel', source: 'rewarded' }, { app_version_name: '9.9.9', publisher_id: '999' });
  const late = install('p', '2026-10-25T09:00:00Z', { installation_id: 'later-install', is_reattribution: 'true', publisher_id: '111', app_version_name: '0.1.31' });
  const result = week([first, returned, late]);
  assert.equal(result.retention.D1.gameplay.rate, 1);
  assert.equal(result.strata.versions[0].appVersion, '0.1.29'); assert.equal(result.strata.versions[0].versionProvenance, 'sdk_install_app_version');
  assert.deepEqual(result.strata.acquisition, week([first, returned]).strata.acquisition);
  assert.equal(result.strata.acquisition[0].acquisitionClass, 'attributed'); assert.match(result.strata.acquisition[0].sourceReference, /^source_[a-f0-9]{20}$/);
  assert.equal(JSON.stringify(result).includes('9.9.9'), false); assert.equal(JSON.stringify(result).includes('private-original-source'), false);
});

test('missing install version stays unknown instead of borrowing return or current app version', () => {
  const result = week([install('p', INSTALL, { app_version_name: undefined }), event('p', 'word_submitted', undefined, { manual: true })]);
  assert.equal(result.strata.versions[0].appVersion, 'unknown'); assert.equal(result.strata.versions[0].versionProvenance, 'missing_sdk_install_version');
  assert.equal(result.retention.D1.gameplay.rate, 1);
});

test('malformed supplied install version and attribution stay unknown even beside otherwise known copies', () => {
  const known = install('p', INSTALL, { publisher_id: '8' });
  const invalid = install('p', INSTALL, { app_version_name: 'PRIVATE_INVALID_VERSION@example.com', publisher_id: 'PRIVATE_INVALID_PUBLISHER', attribution_classification: 'organic', attribution_verified: true });
  const report = analyze([known, invalid], options);
  assert.deepEqual(report, analyze([invalid, known], options));
  const group = report.metrics.weeks[1].strata.versionAcquisition[0];
  assert.equal(group.appVersion, 'unknown'); assert.equal(group.versionProvenance, 'invalid_sdk_install_version');
  assert.equal(group.acquisitionClass, 'unknown'); assert.equal(group.acquisitionProvenance, 'conflicting_sdk_install_attribution');
  assert.equal(JSON.stringify(report).includes('PRIVATE_INVALID'), false);
  const only = week([invalid]).strata.acquisition[0];
  assert.equal(only.acquisitionClass, 'unknown'); assert.equal(only.acquisitionProvenance, 'invalid_sdk_install_attribution');
});

test('missing attribution, explicitly unattributed and confirmed organic are distinct strata', () => {
  const result = week([install('unknown'), install('unverified', INSTALL, { attribution_classification: 'organic' }),
    install('organic', INSTALL, { attribution_classification: 'organic', attribution_verified: true }),
    install('unattributed', INSTALL, { attribution_classification: 'unattributed', attribution_verified: 'true' })]);
  const classes = Object.fromEntries(result.strata.acquisition.map((group) => [group.acquisitionClass, group.firstInstallUnits]));
  assert.deepEqual(classes, { organic: 1, unattributed: 1, unknown: 2 });
  assert.equal(result.strata.acquisition.find((group) => group.acquisitionClass === 'unknown').sourceReference, null);
});

test('UI/domain/report source cannot serve as acquisition evidence', () => {
  const records = [install('p', INSTALL, { source: 'vk_ads', entry_source: 'home' }), event('p', 'word_submitted', undefined, { manual: true, source: 'explicit', entry_source: 'wheel' })];
  const group = week(records).strata.acquisition[0];
  assert.equal(group.acquisitionClass, 'unknown'); assert.equal(group.acquisitionProvenance, 'missing_sdk_install_attribution');
  assert.deepEqual(group, week(records, { source: 'production' }).strata.acquisition[0]);
});

test('first-install source conflicts and version conflicts are independent of input order', () => {
  const a = install('p', INSTALL, { publisher_id: '1', tracking_id: '10', app_version_name: '0.1.29' });
  const b = install('p', INSTALL, { publisher_id: '2', tracking_id: '20', app_version_name: '0.1.30' });
  const returned = event('p', 'word_submitted', undefined, { manual: true });
  const original = analyze([a, b, returned], options);
  for (const records of [[b, a, returned], [returned, a, b], [returned, b, a]]) assert.deepEqual(analyze(records, options), original);
  const group = original.metrics.weeks[1].strata.versionAcquisition[0];
  assert.equal(group.appVersion, 'unknown'); assert.equal(group.versionProvenance, 'conflicting_sdk_install_versions');
  assert.equal(group.acquisitionClass, 'unknown'); assert.equal(group.acquisitionProvenance, 'conflicting_sdk_install_attribution');
  assert.equal(group.retention.D1.gameplay.rate, 1); assert.equal(group.retention.D1.gameplay.N, 1);
});

test('missing-to-known install source enrichment is stable and organic claims conflict with attribution', () => {
  const empty = install('p'); const known = install('p', INSTALL, { publisher_id: '8', tracking_id: '9' });
  assert.deepEqual(analyze([empty, known], options), analyze([known, empty], options));
  assert.equal(week([empty, known]).strata.acquisition[0].acquisitionClass, 'attributed');
  const organic = install('p', INSTALL, { attribution_classification: 'organic', attribution_verified: true });
  assert.equal(week([known, organic]).strata.acquisition[0].acquisitionProvenance, 'conflicting_sdk_install_attribution');
});

test('repeated SDK first-install rows and episodes do not inflate independent sample N', () => {
  const first = install('p'); const returned = event('p', 'word_submitted', undefined, { manual: true });
  const result = analyze([first, { ...first }, returned, { ...returned }], options);
  assert.equal(result.metrics.population.firstInstallUnits, 1); assert.equal(result.metrics.weeks[1].retention.D1.gameplay.N, 1);
  assert.equal(result.quality.deduplicatedFirstInstallRecords, 1);
});

test('two conflicting first episodes for one SDK unit retain one unknown mature N', () => {
  const result = row([install('p'), install('p', '2026-10-08T12:00:00Z', { installation_id: 'other-first-episode' })]);
  assert.equal(result.N, 1); assert.equal(result.unknownOutcomeUnits, 1); assert.equal(result.rate, null);
  assert.deepEqual(result.bounds, { lower: 0, upper: 1 }); assert.equal(result.samplingUncertainty.interval, null);
});

test('same install ID on foreign SDK aliases creates one ambiguous unit, never two independent people', () => {
  const result = row([install('a', INSTALL, { installation_id: 'shared-private-install' }), install('b', INSTALL, { installation_id: 'shared-private-install' }),
    event('a', 'word_submitted', undefined, { manual: true }, { installation_id: 'shared-private-install' })]);
  assert.equal(result.N, 1); assert.equal(result.unknownOutcomeUnits, 1); assert.equal(result.reasons.unknown_install_identity, 1);
});

test('unknown install time/cohort membership is separately visible and blocks full-population comparisons', () => {
  const result = analyze([install('p', INSTALL, { install_timestamp: undefined }), install('known')], options);
  assert.equal(result.metrics.population.firstInstallUnits, 2); assert.equal(result.metrics.population.unassignedFirstInstallUnits, 1);
  assert.equal(result.metrics.weeks[1].firstInstallUnits, 1); assert.equal(result.metrics.comparison.retention.D1.gameplay.comparableFullWeeks, false);
  const naive = analyze([install('naive', INSTALL, { install_timestamp: undefined, install_datetime: '2026-10-08 09:00:00' })], options);
  assert.equal(naive.metrics.population.unassignedFirstInstallUnits, 1);
});

test('cross-week ambiguous first episodes never choose a convenient cohort', () => {
  const result = analyze([install('p', '2026-10-01T09:00:00Z'), install('p', INSTALL, { installation_id: 'second-first' })], options);
  assert.equal(result.metrics.population.firstInstallUnits, 1); assert.equal(result.metrics.population.unassignedFirstInstallUnits, 1);
  assert.equal(result.metrics.weeks[0].firstInstallUnits + result.metrics.weeks[1].firstInstallUnits, 0);
});

test('unknown return outcome stays in mature N and bounds instead of known-only denominator', () => {
  const records = [install('zero'), install('unknown'), event('unknown', 'word_submitted', undefined, { manual: true, timeKnown: false })];
  const result = row(records);
  assert.equal(result.N, 2); assert.equal(result.knownOutcomeUnits, 1); assert.equal(result.unknownOutcomeUnits, 1);
  assert.equal(result.rate, null); assert.equal(result.observedKnownRate, 0); assert.deepEqual(result.bounds, { lower: 0, upper: 0.5 });
  assert.equal(result.samplingUncertainty.interval, null);
});

test('an unlocated SDK session or unknown old dispatch clock cannot prove absence on a mature target', () => {
  const missing = session('p', undefined, { session_start_timestamp: undefined });
  assert.equal(row([install('p'), missing], 'D1', 'open').unknownOutcomeUnits, 1);
  assert.equal(row([install('p'), missing], 'D14', 'open').unknownOutcomeUnits, 1);
  const unknown = event('p', 'word_submitted', '2026-10-08T10:00:00Z', { manual: true, timeKnown: false });
  assert.equal(row([install('p'), unknown]).unknownOutcomeUnits, 1);
  const positive = event('p', 'word_submitted', undefined, { manual: true });
  assert.equal(row([install('p'), unknown, positive]).rate, 1);
  const knownOtherDay = event('p', 'word_submitted', '2026-10-08T10:00:00Z', { manual: true, timeKnown: false, actionDay: '2026-10-08' });
  assert.equal(row([install('p'), knownOtherDay]).rate, 0);
});

test('SDK sessions count as open telemetry and are distinct from custom opens and voluntary gameplay', () => {
  const result = analyze([install('sdk'), session('sdk'), install('custom'), event('custom', 'app_open')], options);
  const metric = result.metrics.weeks[1].retention.D1;
  assert.equal(metric.open.N, 2); assert.equal(metric.open.rate, 1); assert.equal(metric.gameplay.rate, 0);
  assert.equal(result.quality.sdkSessionRecords, 1); assert.equal(result.quality.customAppOpenRecords, 1);
});

test('R1 SDK kind/name contradictions are rejected before SDK exemptions in API and --sessions CLI', () => temporary((dir) => {
  const input = path.join(dir, 'install.json'); const sessions = path.join(dir, 'sessions.json');
  fs.writeFileSync(input, JSON.stringify([install('p')]));
  const valid = session('p');
  for (const fields of [{ event_name: 'word_submitted' }, { name: 'word_submitted' }, { event_name: 'session_start', name: 'word_submitted' },
    { event_name: 'PRIVATE_INVALID_NAME@example.com' }]) {
    const invalid = { ...valid, ...fields };
    assert.throws(() => analyze([install('p'), invalid], options), /SDK record type\/name conflict/);
    fs.writeFileSync(sessions, JSON.stringify([invalid]));
    const before = [sha(input), sha(sessions)]; const output = path.join(dir, 'rejected');
    const result = cli([...cliOptions, '--installs', input, '--sessions', sessions, '--output', output]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /SDK record type\/name conflict/);
    assert.deepEqual([sha(input), sha(sessions)], before); assert.equal(fs.existsSync(`${output}.json`), false);
    assert.equal(`${result.stdout}${result.stderr}`.includes('PRIVATE_INVALID_NAME'), false);
  }
  fs.writeFileSync(sessions, JSON.stringify([valid]));
  const output = path.join(dir, 'valid'); const result = cli([...cliOptions, '--installs', input, '--sessions', sessions, '--output', output]);
  assert.equal(result.status, 0, result.stderr);
  const metric = JSON.parse(fs.readFileSync(`${output}.json`, 'utf8')).metrics.weeks[1].retention.D1;
  assert.equal(metric.open.rate, 1); assert.equal(metric.gameplay.rate, 0);
  assert.throws(() => analyze([install('p', INSTALL, { event_name: 'word_submitted' })], options), /SDK record type\/name conflict/);
}));

test('R1 conflicting delivery clocks retain unknown mature N for D1/D7/D14 in both orders, legal return stays positive', () => {
  for (const day of [1, 7, 14]) {
    const target = Date.parse(INSTALL) + day * 86400000;
    const first = event('p', 'word_submitted', target, { manual: true });
    const later = structuredClone(first); later.event_datetime = new Date(target + 86400000).toISOString(); later.event_json.occurred_at = later.event_datetime;
    const forward = analyze([install('p'), first, later], options);
    const reverse = analyze([install('p'), later, first], options);
    assert.deepEqual(forward, reverse);
    const metric = forward.metrics.weeks[1].retention[`D${day}`].gameplay;
    assert.equal(metric.N, 1); assert.equal(metric.unknownOutcomeUnits, 1); assert.equal(metric.rate, null);
    assert.deepEqual(metric.bounds, { lower: 0, upper: 1 }); assert.equal(metric.samplingUncertainty.interval, null);
    const positive = event('p', 'word_submitted', target + 1000, { manual: true });
    for (const copies of [[first, later], [later, first]]) assert.equal(row([install('p'), ...copies, positive], `D${day}`).rate, 1);
  }
});

test('R1 conflicting delivery install scopes retain unknown N independent of copy order without exposing private evidence', () => {
  const first = event('p', 'word_submitted', undefined, { manual: true });
  const foreign = { ...structuredClone(first), installation_id: 'PRIVATE_FOREIGN_SCOPE_901' };
  for (const copies of [[first, foreign], [foreign, first]]) {
    const report = analyze([install('p'), ...copies], options); const metric = report.metrics.weeks[1].retention.D1.gameplay;
    assert.equal(metric.N, 1); assert.equal(metric.unknownOutcomeUnits, 1); assert.equal(metric.rate, null);
    assert.deepEqual(metric.bounds, { lower: 0, upper: 1 }); assert.equal(metric.samplingUncertainty.interval, null);
    const publicOutput = `${JSON.stringify(report)}\n${renderMarkdown(report)}`;
    assert.equal(publicOutput.includes('PRIVATE_FOREIGN_SCOPE_901'), false); assert.equal(publicOutput.includes(first.event_json.event_id), false);
    const positive = event('p', 'word_submitted', '2026-10-09T12:00:00Z', { manual: true });
    assert.equal(row([install('p'), ...copies, positive]).rate, 1);
  }
});

test('R2 calendar keeps all D1/D7/D14 clock/install/origin/reward alternatives and independent legal returns', () => {
  const variants = ['clock', 'install', 'origin', 'reward', 'clock_install', 'clock_origin', 'clock_reward', 'clock_install_origin_reward'];
  const secondTime = '2026-10-25T09:00:00Z';
  for (const day of [1, 7, 14]) for (const variant of variants) {
    const first = event('p', 'word_submitted', Date.parse(INSTALL) + day * 86400000, { manual: true, origin_interaction_id: 'origin' });
    const other = structuredClone(first);
    if (variant.includes('clock')) { other.event_datetime = variant.includes('install') ? '2026-10-26T09:00:00Z' : new Date(Date.parse(first.event_datetime) + 86400000).toISOString(); other.event_json.occurred_at = other.event_datetime; }
    if (variant.includes('install')) { other.installation_id = 'real-reinstall'; other.install_timestamp = Date.parse(secondTime) / 1000; }
    if (variant.includes('origin')) other.event_json.origin_interaction_id = 'PRIVATE_CALENDAR_ORIGIN_905';
    if (variant.includes('reward')) other.event_json.rewardId = 'PRIVATE_CALENDAR_REWARD_906';
    const seeds = [install('p'), install('p', secondTime, { installation_id: 'real-reinstall', is_reinstallation: true })];
    const positive = event('p', 'word_submitted', first.event_datetime, { manual: true });
    const values = [];
    for (const copies of [[first, other], [other, first]]) {
      const metric = row([...seeds, ...copies], `D${day}`); values.push(metric);
      assert.equal(metric.N, 1); assert.equal(metric.rate, null); assert.equal(metric.unknownOutcomeUnits, 1); assert.equal(metric.samplingUncertainty.interval, null);
      assert.deepEqual(metric.bounds, { lower: 0, upper: 1 }); assert.equal(row([...seeds, ...copies, positive], `D${day}`).rate, 1);
    }
    assert.deepEqual(values[0], values[1], `D${day}/${variant}`);
  }
});

test('automatic entries/completions/input/letters_connected do not prove voluntary gameplay', () => {
  for (const [name, fields] of [['puzzle_started', {}], ['puzzle_resumed', {}], ['puzzle_completed', {}], ['word_submitted', { manual: false }],
    ['target_word_accepted', { manual: false }], ['gameplay_action', { manual: true, action: 'letters_connected' }]]) {
    assert.equal(row([install('p'), event('p', name, undefined, fields)]).rate, 0, name);
  }
  for (const [name, fields] of [['word_submitted', { manual: true }], ['target_word_accepted', { manual: true }], ['help_used', { source: 'explicit' }]]) {
    assert.equal(row([install('p'), event('p', name, undefined, fields)]).rate, 1, name);
  }
  assert.equal(row([install('p'), event('p', 'help_used', undefined, { source: 'restore', recovery: true })]).unknownOutcomeUnits, 1);
});

test('unknown consent on custom return is visible while a legal positive return stays known', () => {
  const bad = [install('p'), event('p', 'word_submitted', undefined, { manual: true, consent_state: 'unknown' })];
  const result = analyze(bad, options);
  assert.equal(result.quality.unknownCustomConsentRecords, 1); assert.equal(result.metrics.weeks[1].retention.D1.gameplay.unknownOutcomeUnits, 1);
  assert.equal(row([...bad, event('p', 'word_submitted', '2026-10-09T10:00:00Z', { manual: true })]).rate, 1);
});

test('observed later re-enable gap makes absence unknown but cannot erase a legal return', () => {
  const epoch = '2026-10-10T09:00:00Z';
  const later = event('p', 'app_open', '2026-10-10T12:00:00Z', { consent_epoch_at: epoch });
  const records = [install('p'), later];
  const absent = row(records); assert.equal(absent.N, 1); assert.equal(absent.unknownOutcomeUnits, 1); assert.equal(absent.reasons.observed_consent_epoch_gap, 1);
  const before = event('p', 'word_submitted', '2026-10-09T09:00:00Z', { manual: true });
  assert.equal(row([...records, before]).rate, 1);
  const sameDayReenable = event('p', 'word_submitted', '2026-10-09T12:00:00Z', { manual: true, consent_epoch_at: '2026-10-09T10:00:00Z' });
  assert.equal(row([install('p'), sameDayReenable]).rate, 1);
});

test('a trustworthy old-epoch fact after the target bounds a later gap outside that target', () => {
  const records = [install('p'), event('p', 'app_open', '2026-10-10T09:00:00Z'),
    event('p', 'app_open', '2026-10-11T12:00:00Z', { consent_epoch_at: '2026-10-11T09:00:00Z' })];
  assert.equal(row(records).rate, 0);
});

test('opt-out inside target and reinstall boundary preserve unknown N instead of reporting churn', () => {
  const disabled = [install('p'), event('p', 'app_open', undefined, { consent_state: 'disabled' })];
  assert.equal(row(disabled).unknownOutcomeUnits, 1); assert.equal(row(disabled).reasons.observed_consent_state_gap, 1);
  const reinstall = [install('p'), install('p', '2026-10-09T12:00:00Z', { installation_id: 'reinstall-private', is_reinstallation: true })];
  assert.equal(row(reinstall).N, 1); assert.equal(row(reinstall).unknownOutcomeUnits, 1); assert.equal(row(reinstall).reasons.install_boundary, 1);
});

test('unknown SDK environment never becomes a known zero; explicit attestation stays unverified', () => {
  const raw = install('p', INSTALL, { environment: undefined });
  const unknown = row([raw]); assert.equal(unknown.N, 1); assert.equal(unknown.unknownOutcomeUnits, 1); assert.equal(unknown.reasons.unknown_install_environment, 1);
  const result = analyze([raw], { ...options, sdkEnvironment: 'production' });
  assert.equal(result.metrics.weeks[1].retention.D1.gameplay.rate, 0); assert.equal(result.source.environmentAttestationVerified, false);
  assert.equal(result.quality.sdkEnvironmentCallerAttestedRecords, 1);
  const excluded = analyze([install('qa', INSTALL, { environment: 'qa' })], options);
  assert.equal(excluded.metrics, null); assert.equal(excluded.quality.excludedTestRecords, 1);
});

test('negative excluded install metadata cannot manufacture a clean production outcome', () => {
  const result = row([install('p'), install('p', INSTALL, { environment: 'qa' })]);
  assert.equal(result.N, 1); assert.equal(result.unknownOutcomeUnits, 1); assert.equal(result.reasons.unknown_install_environment, 1);
});

test('Wilson intervals match reference values, preserve n0 null and show small-N uncertainty', () => {
  assert.equal(wilson95(0, 0), null);
  const symmetric = wilson95(5, 10); approx(symmetric.lower, 0.236593090512564); approx(symmetric.upper, 0.763406909487436);
  approx(wilson95(0, 1).upper, 0.7934506856227626); approx(wilson95(1, 1).lower, 0.20654931437723745);
  for (const [successes, n] of [[-1, 1], [2, 1], [0.5, 1], [1, NaN]]) assert.throws(() => wilson95(successes, n));
  assert.equal(row([install('p')]).samplingUncertainty.status, 'small_sample');
});

test('fully mature baseline/current comparison is an observational rate difference with source/version N', () => {
  const result = analyze([install('old', '2026-10-01T09:00:00Z'), install('new'), event('new', 'word_submitted', undefined, { manual: true })], options);
  const comparison = result.metrics.comparison.retention.D1.gameplay;
  assert.equal(comparison.comparableFullWeeks, true); assert.equal(comparison.rateDifference, 1); assert.equal(comparison.status, 'observational_only');
  assert.deepEqual(comparison.missingDataDifferenceBounds, { lower: 1, upper: 1 });
  assert.equal(result.metrics.comparison.strata.versions[0].retention.D1.gameplay.baselineN, 1);
  assert.equal(result.metrics.comparison.strata.versions[0].retention.D1.gameplay.currentN, 1);
});

test('new calendar seam rejects invalid requests/foreign anchors and returns no private context', () => {
  const context = createCalendarObservationContext([install('p'), event('p', 'word_submitted', undefined, { manual: true })], options);
  assert.deepEqual(Object.keys(context), ['observe']); assert.equal(Object.isFrozen(context), true);
  const request = { sdkId: 'p', installKey: 'installation-p', anchorMs: Date.parse(INSTALL), day: 14, gameplay: true };
  assert.deepEqual(Object.keys(context.observe(request)).sort(), ['reason', 'state', 'success']);
  for (const extra of [{ day: 0 }, { day: 1.5 }, { day: 31 }, { priorReason: 'private-payload' }, { gameplay: 'true' }]) assert.throws(() => context.observe({ ...request, ...extra }), /Invalid calendar/);
  assert.equal(context.observe({ ...request, sdkId: 'foreign' }).success, null);
  assert.equal(context.observe({ ...request, anchorMs: request.anchorMs + 1 }).success, null);
});

test('public JSON and Markdown contain only bounded aggregate dimensions, never payload identifiers or content', () => {
  const secrets = ['PRIVATE_PLAYER_901', 'PRIVATE_INSTALL_902', 'PRIVATE_TRACKER_903', 'PRIVATE_EMAIL_904@example.com', 'PRIVATE_WORD_905', 'https://private.example/click?id=906'];
  const first = install(secrets[0], INSTALL, { installation_id: secrets[1], publisher_name: secrets[3], tracker_name: secrets[2], click_url_parameters: secrets[5], profile_id: secrets[3], google_aid: 'PRIVATE_ADVERTISING_907' });
  const returned = event(secrets[0], 'word_submitted', undefined, { manual: true, word: secrets[4], email: secrets[3] }, { installation_id: secrets[1] });
  const report = analyze([first, returned], options); const output = `${JSON.stringify(report)}\n${renderMarkdown(report)}`;
  for (const secret of [...secrets, 'PRIVATE_ADVERTISING_907', returned.event_json.event_id]) assert.equal(output.includes(secret), false, secret);
  assert.match(output, /source_[a-f0-9]{20}/);
});

test('CLI uses known SDK file kinds, parser reuse and preserves large SDK identifiers and raw files', () => temporary((dir) => {
  const installs = path.join(dir, 'installs.json'); const sessions = path.join(dir, 'sessions.csv'); const output = path.join(dir, 'report');
  fs.writeFileSync(installs, JSON.stringify({ data: [install('18446744073709551615', INSTALL, { record_type: undefined, is_reinstallation: 'false', is_reattribution: 'false' })] }));
  fs.writeFileSync(sessions, 'appmetrica_device_id,installation_id,session_start_timestamp,environment\n18446744073709551615,installation-18446744073709551615,1791536400,production\n');
  const before = [sha(installs), sha(sessions)];
  assert.equal(readInputFiles([sessions])[0].appmetrica_device_id, '18446744073709551615');
  const result = cli([...cliOptions, '--installs', installs, '--sessions', sessions, '--output', output]);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual([sha(installs), sha(sessions)], before);
  const report = JSON.parse(fs.readFileSync(`${output}.json`, 'utf8'));
  assert.equal(report.metrics.weeks[1].retention.D1.open.N, 1); assert.equal(report.metrics.weeks[1].retention.D1.open.rate, 1); assert.equal(report.quality.sdkSessionRecords, 1);
  assert.equal(report.source.productionMetricsVerified, false); assert.match(fs.readFileSync(`${output}.md`, 'utf8'), /Wilson 95%/);
}));

test('CLI rejects direct/symlink/hardlink input overwrite and aliased JSON/Markdown output pair', () => temporary((dir) => {
  const input = path.join(dir, 'report.json'); fs.writeFileSync(input, JSON.stringify([install('p')]));
  const original = sha(input);
  const direct = cli([...cliOptions, '--input', input, '--output', path.join(dir, 'report')]);
  assert.notEqual(direct.status, 0); assert.match(direct.stderr, /overwrite an input/); assert.equal(sha(input), original);
  for (const linkType of ['hardlink', 'symlink']) {
    const prefix = path.join(dir, linkType); const destination = `${prefix}.json`;
    try { if (linkType === 'hardlink') fs.linkSync(input, destination); else fs.symlinkSync(input, destination, 'file'); }
    catch (error) { if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) continue; throw error; }
    const result = cli([...cliOptions, '--input', input, '--output', prefix]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /overwrite an input/); assert.equal(sha(input), original);
  }
  const pair = path.join(dir, 'pair'); fs.writeFileSync(`${pair}.json`, 'pair-original'); fs.linkSync(`${pair}.json`, `${pair}.md`);
  const before = sha(`${pair}.json`); const aliased = cli([...cliOptions, '--input', input, '--output', pair]);
  assert.notEqual(aliased.status, 0); assert.match(aliased.stderr, /alias each other/); assert.equal(sha(`${pair}.json`), before);
}));

test('CLI rejects invalid modes/kinds/payload safely and never prints malformed raw content', () => temporary((dir) => {
  assert.throws(() => parseArguments([...cliOptions, '--needs-raw-data', '--input', 'input.json', '--output', 'report']), /cannot be combined/);
  assert.throws(() => parseArguments([...cliOptions, '--needs-raw-data', '--source', 'synthetic', '--output', 'report']), /Duplicate/);
  const input = path.join(dir, 'secret.json'); fs.writeFileSync(input, '{"PRIVATE_PAYLOAD_999":');
  const malformed = cli([...cliOptions, '--input', input, '--output', path.join(dir, 'broken')]);
  assert.notEqual(malformed.status, 0); assert.equal(`${malformed.stdout}${malformed.stderr}`.includes('PRIVATE_PAYLOAD_999'), false);
  fs.writeFileSync(input, JSON.stringify([session('p')]));
  const conflict = cli([...cliOptions, '--installs', input, '--output', path.join(dir, 'kind')]);
  assert.notEqual(conflict.status, 0); assert.match(conflict.stderr, /conflicts/);
  const missing = cli([...cliOptions, '--needs-raw-data', '--output', path.join(dir, 'missing')]);
  assert.equal(missing.status, 0, missing.stderr); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'missing.json'), 'utf8')).metrics, null);
}));
