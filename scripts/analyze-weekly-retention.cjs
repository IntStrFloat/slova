'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeRecord, linkInstallEpisodes } = require('./analyze-retention.cjs');
const { createCalendarObservationContext, readInputFiles, validateSdkRecordKind } = require('./analyze-help-funnel.cjs');
const product = require('./analyze-product-improvements.cjs');
const passport = require('../docs/marketing/slova/analytics/product-metric-passports-2026-11-04.json');

const DAY = 86400000;
const DAYS = [1, 7, 14];
const TEST_ENVS = new Set(['qa', 'test', 'testing', 'development', 'dev', 'debug', 'preview', 'staging']);
const VERSION = /^\d{1,5}(?:\.\d{1,5}){1,3}$/;
const supplied = (value) => value !== undefined && value !== null && value !== '';
const sdkBoolean = (value) => value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
const key = (...values) => JSON.stringify(values);
const distinct = (values) => [...new Set(values)];
const midnight = (time, offset) => Math.floor((time + offset * 60000) / DAY) * DAY - offset * 60000;
const safeVersion = (value) => typeof value === 'string' && VERSION.test(value) ? value : 'unknown';

function validateOptions(options = {}) {
  const reference = product.buildNeedsRawDataReport(options);
  const match = /^(?:UTC)?([+-])(\d{2}):(\d{2})$/.exec(options.timezone);
  const offset = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  if (!['production', 'unknown'].includes(options.sdkEnvironment ?? 'unknown')) throw new Error('sdkEnvironment must be production or unknown.');
  return { ...options, source: reference.source.kind, publicPeriods: reference.periods, offset, asOfMs: Date.parse(options.asOf),
    sdkEnvironment: options.sdkEnvironment ?? 'unknown', periods: ['baseline', 'current'].map((name) => ({ name,
      startMs: Date.parse(`${reference.periods[name].from}T00:00:00Z`) - offset * 60000,
      endMs: Date.parse(`${reference.periods[name].toExclusive}T00:00:00Z`) - offset * 60000 })) };
}

/** SDK flags belong to this Logs adapter, never the legacy normalizer. A
 * custom event, SDK session, upgrade or first observed row cannot create a
 * first-install unit. Missing reattribution is deliberately not false. */
function adaptRecord(raw, options, sdkKind) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid record.');
  const adapted = { ...raw };
  delete adapted.install_kind; delete adapted.install_type; delete adapted.is_reinstallation; delete adapted.is_reattribution;
  const reinstall = sdkBoolean(raw.is_reinstallation); const reattribute = sdkBoolean(raw.is_reattribution);
  const invalidFlags = ['is_reinstallation', 'is_reattribution'].some((field) => supplied(raw[field]) && sdkBoolean(raw[field]) === null);
  const classification = sdkKind !== 'install' || invalidFlags ? 'unknown'
    : reattribute === true ? 'reactivation' : reinstall === true ? 'reinstall'
      : reinstall === false && reattribute === false ? 'first' : 'unknown';
  if (sdkKind === 'install') adapted.install_kind = classification;
  if (sdkKind && !supplied(raw.environment) && options.sdkEnvironment === 'production') adapted.environment = 'production';
  return { raw: adapted, metadata: { sdkKind, classification, invalidFlags,
    environmentProvenance: !sdkKind ? 'custom_event_envelope' : supplied(raw.environment) ? 'record_declared'
      : options.sdkEnvironment === 'production' ? 'caller_attested' : 'unknown', original: raw } };
}

function prepare(records, options) {
  const quality = { records: records.length, invalidRecords: 0, missingSdkIdentity: 0, excludedTestRecords: 0, futureRecordsExcluded: 0,
    conflictingInstallEpisodes: 0, unknownInstallClassification: 0, eventsWithAmbiguousInstall: 0, eventsWithoutInstallEpisode: 0,
    sdkInstallRecords: 0, sdkSessionRecords: 0, customAppOpenRecords: 0, sdkEnvironmentUnknownRecords: 0,
    sdkEnvironmentCallerAttestedRecords: 0, sdkEnvironmentRecordDeclaredRecords: 0, sdkConsentUnknownRecords: 0,
    unknownCustomConsentRecords: 0, disabledCustomConsentRecords: 0, invalidSdkFlagRecords: 0, unknownSdkFlagRecords: 0,
    unassignedFirstInstallUnits: 0, unknownInstallVersionUnits: 0, unknownAcquisitionUnits: 0, conflictingAcquisitionUnits: 0,
    deduplicatedFirstInstallRecords: 0 };
  const entries = []; const adapted = []; const excludedInstalls = [];
  for (const raw of records) {
    let row; let event;
    const sdkKind = validateSdkRecordKind(raw);
    try { row = adaptRecord(raw, options, sdkKind); } catch { quality.invalidRecords++; continue; }
    try { event = normalizeRecord(row.raw); } catch { quality.invalidRecords++; continue; }
    if (!event.sdkId || event.sdkId.length > 256) { quality.missingSdkIdentity++; continue; }
    if (event.environment === null && typeof row.raw.environment === 'string') event.environment = row.raw.environment;
    event.sdkMetadata = row.metadata.sdkKind !== null;
    const entry = { event, ...row.metadata };
    const excluded = event.isTest || TEST_ENVS.has(event.environment) || [raw.is_qa, raw.is_qa_device, raw.is_test].some((value) => [true, 'true', 1, '1'].includes(value));
    if (excluded) { quality.excludedTestRecords++; if (entry.sdkKind === 'install') excludedInstalls.push(entry); continue; }
    if (event.emittedAtMs !== null && event.emittedAtMs > options.asOfMs) { quality.futureRecordsExcluded++; continue; }
    if (entry.sdkKind === 'install') {
      quality.sdkInstallRecords++;
      if (entry.invalidFlags) quality.invalidSdkFlagRecords++;
      else if (entry.classification === 'unknown') quality.unknownSdkFlagRecords++;
    } else if (entry.sdkKind === 'session') quality.sdkSessionRecords++;
    else {
      if (event.name === 'app_open') quality.customAppOpenRecords++;
      if (event.consentState === 'unknown') quality.unknownCustomConsentRecords++;
      if (event.consentState === 'disabled') quality.disabledCustomConsentRecords++;
    }
    if (entry.sdkKind && event.environment !== 'production') quality.sdkEnvironmentUnknownRecords++;
    if (entry.sdkKind && entry.environmentProvenance === 'caller_attested') quality.sdkEnvironmentCallerAttestedRecords++;
    if (entry.sdkKind && entry.environmentProvenance === 'record_declared') quality.sdkEnvironmentRecordDeclaredRecords++;
    if (entry.sdkKind && event.consentState === 'unknown') quality.sdkConsentUnknownRecords++;
    entries.push(entry); adapted.push(row.raw);
  }
  const episodes = linkInstallEpisodes(entries.map((entry) => entry.event), quality);
  return { entries, adapted, excludedInstalls, episodes, quality };
}

function acquisition(copies) {
  const fields = ['publisher_id', 'publisher_name', 'tracking_id', 'tracker_name', 'attributed_touch_type'];
  const values = {};
  let conflict = false; let invalid = false;
  for (const field of fields) {
    const all = distinct(copies.map((entry) => entry.original[field]).filter(supplied).map((value) => {
      if (field.endsWith('_id')) {
        if (value === 0 || value === '0') return null;
        if (typeof value === 'string' && /^[1-9][0-9]{0,39}$/.test(value)) return value;
        if (Number.isSafeInteger(value) && value > 0) return String(value);
      } else if (field === 'attributed_touch_type') {
        if (value === 'unknown') return null;
        if (['click', 'impression'].includes(value)) return value;
      } else if (typeof value === 'string' && value.length <= 512) return value.trim() || null;
      invalid = true; return null;
    }).filter((value) => value !== null));
    if (all.length > 1) conflict = true;
    values[field] = all.length === 1 ? all[0] : null;
  }
  const declarations = distinct(copies.filter((entry) => sdkBoolean(entry.original.attribution_verified) === true)
    .map((entry) => entry.original.attribution_classification).filter((value) => ['organic', 'unattributed', 'attributed'].includes(value)));
  const hasAttribution = Object.values(values).some(supplied);
  if (declarations.length > 1 || hasAttribution && declarations.some((value) => value !== 'attributed')) conflict = true;
  if (conflict) return { acquisitionClass: 'unknown', sourceReference: null, acquisitionProvenance: 'conflicting_sdk_install_attribution' };
  if (invalid) return { acquisitionClass: 'unknown', sourceReference: null, acquisitionProvenance: 'invalid_sdk_install_attribution' };
  if (hasAttribution) {
    // Publisher/tracker IDs are preferred; raw names remain private even when
    // they supply the only available source evidence. No click URL is read.
    const source = [values.publisher_id ?? values.publisher_name, values.tracking_id ?? values.tracker_name];
    return { acquisitionClass: 'attributed', sourceReference: source.some(supplied)
      ? `source_${createHash('sha256').update(key(...source)).digest('hex').slice(0, 20)}` : null,
    acquisitionProvenance: 'sdk_install_attribution' };
  }
  const classification = declarations[0] ?? 'unknown';
  return { acquisitionClass: classification, sourceReference: null,
    acquisitionProvenance: classification === 'unknown' ? 'missing_sdk_install_attribution' : 'caller_declared_verified_classification' };
}

function createUnits(context, options) {
  // Connected SDK/installation aliases are one sampling unit. Cross-SDK use
  // of an install ID creates one ambiguous unit, not two independent people.
  const parents = new Map(); const aliases = new Map();
  const find = (value) => { if (!parents.has(value)) parents.set(value, value); if (parents.get(value) !== value) parents.set(value, find(parents.get(value))); return parents.get(value); };
  for (const { event } of context.entries) {
    find(event.sdkId);
    if (event.installIdentity) {
      if (aliases.has(event.installIdentity)) parents.set(find(event.sdkId), find(aliases.get(event.installIdentity)));
      else aliases.set(event.installIdentity, event.sdkId);
    }
  }
  const groups = new Map();
  for (const entry of context.entries) {
    const id = find(entry.event.sdkId); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(entry);
  }
  const episodeIndex = new Map(context.episodes.map((episode) => [key(episode.sdkId, episode.key), episode]));
  const units = [];
  for (const entries of groups.values()) {
    const candidates = entries.filter((entry) => entry.sdkKind === 'install' && entry.classification === 'first');
    if (!candidates.length) continue;
    const sdkIds = distinct(entries.map((entry) => entry.event.sdkId));
    const candidateEpisodes = distinct(candidates.map((entry) => episodeIndex.get(key(entry.event.sdkId, entry.event.installKey))).filter(Boolean));
    const anchors = candidates.map(({ event }) => {
      const episode = candidateEpisodes.find((item) => item.sdkId === event.sdkId && item.key === event.installKey);
      return episode?.installMs ?? event.installMs ?? (options.offset === 180 && (episode?.installDay ?? event.installDay)
        ? Date.parse(`${episode?.installDay ?? event.installDay}T00:00:00+03:00`) : null);
    });
    const days = distinct(anchors.filter((value) => value !== null).map((value) => midnight(value, options.offset)));
    const period = anchors.every((value) => value !== null) && options.periods.find((item) => days.every((day) => day >= item.startMs && day < item.endMs));
    const episode = candidateEpisodes.length === 1 ? candidateEpisodes[0] : null;
    const originEntries = entries.filter((entry) => entry.sdkKind === 'install' && (candidates.includes(entry)
      || episode && entry.event.sdkId === episode.sdkId && entry.event.installKey === episode.key));
    const versions = distinct(originEntries.map((entry) => safeVersion(entry.original.app_version_name)).filter((value) => value !== 'unknown'));
    const invalidVersion = originEntries.some((entry) => supplied(entry.original.app_version_name) && safeVersion(entry.original.app_version_name) === 'unknown');
    const dimensions = { appVersion: versions.length === 1 && !invalidVersion ? versions[0] : 'unknown',
      versionProvenance: versions.length > 1 ? 'conflicting_sdk_install_versions' : invalidVersion ? 'invalid_sdk_install_version'
        : versions.length ? 'sdk_install_app_version' : 'missing_sdk_install_version',
      ...acquisition(originEntries) };
    let reason = sdkIds.length !== 1 ? 'unknown_install_identity' : candidateEpisodes.length !== 1 || !episode || episode.conflict
      || days.length !== 1 || originEntries.some((entry) => entry.invalidFlags || entry.event.conflictingEnvironmentMetadata
        || entry.event.invalidConsentMetadata || entry.event.conflictingConsentMetadata || entry.event.invalidConsentEpoch || entry.event.invalidTimeTrust
        || ['client_clock_anomaly', 'occurrence_unknown'].includes(entry.event.timeTrust)) ? 'conflicting_first_install_metadata'
        : originEntries.some((entry) => entry.event.environment !== 'production') ? 'unknown_install_environment' : null;
    if (context.excludedInstalls.some((entry) => sdkIds.includes(entry.event.sdkId)
      && (entry.event.installIdentity && candidates.some((candidate) => candidate.event.installIdentity === entry.event.installIdentity)
        || entry.event.installMs !== null && anchors.includes(entry.event.installMs)))) reason = 'unknown_install_environment';
    const unit = { period: period?.name ?? null, anchors, episode, dimensions, reason,
      returnEvents: entries.map((entry) => entry.event).filter((event) => !episode || !event.installKey || event.installKey === episode.key),
      sdkId: sdkIds.length === 1 ? sdkIds[0] : null, anchorMs: anchors.length && distinct(anchors).length === 1 ? anchors[0] : episode?.installMs ?? null };
    units.push(unit);
  }
  context.quality.unassignedFirstInstallUnits = units.filter((unit) => !unit.period && unit.anchors.some((anchor) => anchor === null
    || options.periods.some((period) => anchor >= period.startMs && anchor < period.endMs))).length;
  context.quality.unknownInstallVersionUnits = units.filter((unit) => unit.dimensions.appVersion === 'unknown').length;
  context.quality.unknownAcquisitionUnits = units.filter((unit) => unit.dimensions.acquisitionClass === 'unknown').length;
  context.quality.conflictingAcquisitionUnits = units.filter((unit) => unit.dimensions.acquisitionProvenance === 'conflicting_sdk_install_attribution').length;
  context.quality.deduplicatedFirstInstallRecords = context.entries.filter((entry) => entry.sdkKind === 'install' && entry.classification === 'first').length - units.length;
  return units;
}

function wilson95(successes, n) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(successes) || n < 0 || successes < 0 || successes > n) throw new Error('Invalid binomial counts.');
  if (!n) return null;
  const z = 1.959963984540054; const p = successes / n; const divisor = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / divisor;
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / divisor;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function summarize(rows) {
  const known = rows.filter((row) => row.state === 'mature'); const unknown = rows.filter((row) => row.state === 'unknown');
  const numerator = known.filter((row) => row.success === true).length; const n = known.length + unknown.length;
  const immature = rows.filter((row) => row.state === 'immature').length; const reasons = {};
  for (const row of rows) if (row.reason) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  return { numerator, denominator: n, N: n, rate: n && !unknown.length ? numerator / n : null,
    observedKnownRate: known.length ? numerator / known.length : null, knownOutcomeUnits: known.length, unknownOutcomeUnits: unknown.length,
    eligibleUnits: rows.length, immatureUnits: immature, bounds: n ? { lower: numerator / n, upper: (numerator + unknown.length) / n } : null,
    coverage: { numerator: known.length, denominator: n, rate: n ? known.length / n : null },
    samplingUncertainty: { method: 'wilson_score', confidence: 0.95, interval: unknown.length ? null : wilson95(numerator, n),
      status: unknown.length ? 'missing_outcomes_interval_unavailable' : !n ? 'no_mature_units' : n < 30 ? 'small_sample' : 'conditional_on_sdk_unit_sampling_assumptions' },
    reasons: Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b))),
    status: !rows.length ? 'unavailable' : unknown.length ? 'coverage_gap' : !n ? 'no_mature_units' : immature ? 'partially_mature' : 'observed' };
}
function retentionFor(units, day, context, options) {
  const result = {};
  for (const gameplay of [false, true]) {
    const rows = units.map((unit) => {
      if (unit.anchors.some((anchor) => anchor === null)) return { state: 'unknown', success: null, reason: 'unknown_calendar_origin' };
      if (unit.anchors.some((anchor) => midnight(anchor, options.offset) + (day + 1) * DAY > options.asOfMs)) return { state: 'immature', success: null, reason: 'partial_target_calendar_day' };
      if (unit.reason) return { state: 'unknown', success: null, reason: unit.reason };
      const observed = context.observe({ sdkId: unit.sdkId, installKey: unit.episode.key, anchorMs: unit.anchorMs, day, gameplay });
      // A session/custom return with no trustworthy occurrence or calendar day
      // cannot be ruled out from any target by its unreliable dispatch clock.
      // It never erases the existing helper's independently legal positive.
      if (observed.state === 'mature' && observed.success === false) {
        const start = midnight(unit.anchorMs, options.offset) + day * DAY;
        const target = new Date(start + options.offset * 60000).toISOString().slice(0, 10);
        const uncertain = unit.returnEvents.some((event) => {
          if (!(gameplay ? passport.calendar.gameplayEvents : passport.calendar.openEvents).includes(event.name)) return false;
          if (gameplay && event.manualState === 'auto') return false;
          if (gameplay && !['help_used', 'target_word_accepted'].includes(event.name) && event.canonical !== 'play') return false;
          const unknownClock = event.timeMs === null || event.timeTrust === 'client_clock_anomaly';
          const possibleDay = unknownClock ? !(options.offset === 180 && event.recordedActionDay && event.timeTrust !== 'client_clock_anomaly')
            || event.recordedActionDay === target : event.timeMs >= start && event.timeMs < start + DAY;
          return possibleDay && (unknownClock || event.installAmbiguous);
        });
        if (uncertain) return { state: 'unknown', success: null, reason: 'unknown_return_occurrence_or_context' };
      }
      return observed;
    });
    result[gameplay ? 'gameplay' : 'open'] = summarize(rows);
  }
  return result;
}
const VERSION_FIELDS = ['appVersion', 'versionProvenance'];
const ACQUISITION_FIELDS = ['acquisitionClass', 'sourceReference', 'acquisitionProvenance'];
function strata(units, fields, observe, options) {
  const groups = new Map();
  for (const unit of units) {
    const dimensions = Object.fromEntries(fields.map((field) => [field, unit.dimensions[field]])); const id = JSON.stringify(dimensions);
    if (!groups.has(id)) groups.set(id, []); groups.get(id).push(unit);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, values]) => ({ ...JSON.parse(id),
    firstInstallUnits: values.length, retention: Object.fromEntries(DAYS.map((day) => [`D${day}`, retentionFor(values, day, observe, options)])) }));
}

function baseReport(options) {
  return { reportVersion: 1, game_id: 'slova', scope: 'draft_point6_weekly_install_retention', periods: options.publicPeriods,
    source: { kind: options.source, synthetic: options.source === 'synthetic', productionMetricsVerified: false,
      sdkEnvironment: options.sdkEnvironment, environmentAttestationVerified: false },
    experiment: { status: 'draft_inactive', enabled: false, assignmentReturnIncluded: false },
    definitions: { days: DAYS, unit: 'one connected SDK first-install identity; repeated rows/episodes are not independent players',
      firstInstall: 'Only SDK installation metadata with explicit false is_reinstallation AND false is_reattribution. Missing flags are unknown.',
      origin: 'SDK install timestamp in fixed analysis timezone; never first observed custom event.',
      maturity: 'Exact target calendar day [00:00, next 00:00); every unit waits for target-day end, including an early observed success.',
      completeWeekMaturity: 'A Dk week is fully mature only at install-week end + k calendar days. Partial-week rates are diagnostics and are never directly compared with a full week.',
      openEvents: passport.calendar.openEvents, gameplayEvents: passport.calendar.gameplayEvents,
      open: 'Declared SDK session starts and legal custom open/entry events share the open metric; custom opens are not SDK sessions. Input signal counts are separate.',
      gameplay: 'Existing point 5 actual voluntary gameplay rule; automatic start/resume/completion, automatic word input, restore and letters_connected do not establish play.',
      strata: 'Install-origin SDK app_version_name and primary installation acquisition metadata; return-event/current app version and reattribution source never replace them.',
      acquisition: 'Source references hash private publisher/tracker identities. Missing attribution is unknown. Organic/unattributed require explicit verified caller classification; that assertion is not independently verified.',
      uncertainty: 'Wilson 95% score interval only for mature known binomial outcomes and distinct SDK units. Unknown outcomes retain N and missing-data bounds; their sampling interval is null. SDK-unit independence/representativeness is an assumption, not proof of independent humans.',
      consent: 'Reuses point 5 legal occurrence and observed re-enable/opt-out gap logic. Legal known returns remain positive; a possible unobserved interval makes absence unknown.' },
    interpretation: 'Observational weekly changes; they do not prove causal effects of advertising, dictionary, price or another product change.',
    limitations: ['The as-of is the caller-declared complete export cutoff, not evidence that every eligible SDK/custom event was delivered.',
      'Export source, production environment, consent coverage, SDK identity continuity and sampling assumptions require separate verification. Unobserved/refused players are outside the logs.',
      'Unknown first-install classification cannot enter a proven first-install denominator; unknown cohort membership is reported separately and blocks a complete-population comparison.',
      'Small groups have large uncertainty. Missing-data bounds are not sampling confidence intervals; a null interval/rate is not zero.',
      'SDK sessions and custom opens are distinct telemetry. Session duration is not active solving time.',
      'Point 7 assignment/request-day D1/D7 is a separate experiment metric. This CLI does not assign players, activate an experiment or create a schedule.'] };
}
function buildNeedsRawDataReport(options) {
  const validated = validateOptions(options);
  return { ...baseReport(validated), status: 'needs_raw_data', metrics: null, quality: null,
    coverageGates: [{ name: 'raw_slova_install_and_return_exports', state: 'missing' }],
    requiredInput: ['Slova SDK installation Logs metadata including both explicit reinstall/reattribution flags, SDK identity, installation identity and original install timestamp/version/acquisition fields.',
      'SDK session and custom event exports through the fixed cutoff with production/environment and consent/occurrence provenance; relevant prior install/consent context.',
      'Caller-declared source/environment scope and complete baseline/current seven-day install weeks; target days require additional follow-up.'],
    nextAction: 'Obtain usable Slova raw exports and verify instrumentation/coverage. Synthetic fixtures and aggregate event totals are not production retention.' };
}
function analyzeWeeklyRetention(records, options) {
  const validated = validateOptions(options);
  if (!Array.isArray(records)) throw new Error('Input must be an array of raw record objects.');
  if (!records.length) return buildNeedsRawDataReport(options);
  const context = prepare(records, validated);
  if (!context.entries.length) return { ...buildNeedsRawDataReport(options), quality: context.quality };
  const units = createUnits(context, validated); const observe = createCalendarObservationContext(context.adapted, options);
  const weeks = validated.periods.map((period) => {
    const values = units.filter((unit) => unit.period === period.name);
    return { week: period.name, firstInstallUnits: values.length,
      maturity: Object.fromEntries(DAYS.map((day) => [`D${day}`, { fullyMature: period.endMs + day * DAY <= validated.asOfMs,
        completeAt: new Date(period.endMs + day * DAY).toISOString() }])),
      retention: Object.fromEntries(DAYS.map((day) => [`D${day}`, retentionFor(values, day, observe, validated)])),
      strata: { versions: strata(values, VERSION_FIELDS, observe, validated), acquisition: strata(values, ACQUISITION_FIELDS, observe, validated),
        versionAcquisition: strata(values, [...VERSION_FIELDS, ...ACQUISITION_FIELDS], observe, validated) } };
  });
  const compare = (baseline, current, day, complete) => Object.fromEntries(['open', 'gameplay'].map((kind) => {
    const a = baseline?.[kind] ?? summarize([]); const b = current?.[kind] ?? summarize([]);
    return [kind, { baselineN: a.N, currentN: b.N, comparableFullWeeks: complete,
      rateDifference: complete && a.rate !== null && b.rate !== null ? b.rate - a.rate : null,
      missingDataDifferenceBounds: complete && a.bounds && b.bounds ? { lower: b.bounds.lower - a.bounds.upper, upper: b.bounds.upper - a.bounds.lower } : null,
      status: !complete ? 'incomplete_week_maturity_or_cohort_membership' : a.rate === null || b.rate === null ? 'missing_outcomes_or_empty_group' : 'observational_only', day: `D${day}` }];
  }));
  const comparison = { retention: {}, strata: {} };
  for (const day of DAYS) {
    const full = weeks.every((week) => week.maturity[`D${day}`].fullyMature) && !context.quality.unassignedFirstInstallUnits;
    comparison.retention[`D${day}`] = compare(weeks[0].retention[`D${day}`], weeks[1].retention[`D${day}`], day, full);
  }
  for (const [name, fields] of [['versions', VERSION_FIELDS], ['acquisition', ACQUISITION_FIELDS], ['versionAcquisition', [...VERSION_FIELDS, ...ACQUISITION_FIELDS]]]) {
    const ids = (row) => JSON.stringify(Object.fromEntries(fields.map((field) => [field, row[field]])));
    const all = distinct(weeks.flatMap((week) => week.strata[name].map(ids))).sort();
    comparison.strata[name] = all.map((id) => ({ ...JSON.parse(id), retention: Object.fromEntries(DAYS.map((day) => [`D${day}`,
      compare(weeks[0].strata[name].find((row) => ids(row) === id)?.retention[`D${day}`], weeks[1].strata[name].find((row) => ids(row) === id)?.retention[`D${day}`], day,
        comparison.retention[`D${day}`].open.comparableFullWeeks)])) }));
  }
  const classification = { first: 0, reinstall: 0, reattribution: 0, unknown: 0 };
  const sdkInstallIds = new Set(context.entries.filter((entry) => entry.sdkKind === 'install' && entry.event.installIdentity).map(({ event }) => key(event.sdkId, event.installIdentity)));
  const sdkInstallTimes = new Set(context.entries.filter((entry) => entry.sdkKind === 'install' && !entry.event.installIdentity && entry.event.installMs !== null).map(({ event }) => key(event.sdkId, event.installMs)));
  for (const episode of context.episodes.filter((item) => sdkInstallIds.has(key(item.sdkId, item.explicit)) || sdkInstallTimes.has(key(item.sdkId, item.installMs)))) classification[episode.kind === 'reactivation' ? 'reattribution' : episode.kind]++;
  return { ...baseReport(validated), status: 'observed_with_coverage_gaps', quality: context.quality,
    metrics: { population: { firstInstallUnits: units.length, unassignedFirstInstallUnits: context.quality.unassignedFirstInstallUnits, sdkInstallEpisodeClassification: classification }, weeks, comparison },
    coverageGates: [{ name: 'raw_slova_install_and_return_exports', state: 'observed_not_certified_complete' },
      { name: 'production_delivery_and_environment', state: 'unverified' },
      { name: 'sdk_first_install_classification', state: classification.unknown ? 'partial' : classification.first ? 'observed' : 'missing' },
      { name: 'cohort_membership', state: context.quality.unassignedFirstInstallUnits ? 'partial' : 'observed' },
      { name: 'install_acquisition', state: context.quality.unknownAcquisitionUnits ? 'partial' : units.length ? 'observed' : 'missing' },
      { name: 'experiment_activation', state: 'inactive' }],
    nextAction: 'Inspect complete-week maturity, group N, missing outcomes/bounds, source/version provenance and sampling uncertainty before interpreting any weekly change.' };
}

function renderMarkdown(report) {
  const pct = (value) => value === null || value === undefined ? 'unavailable' : `${(value * 100).toFixed(2)}%`;
  const interval = (value) => value ? `${pct(value.lower)}–${pct(value.upper)}` : 'unavailable';
  const lines = ['# Slova weekly install retention', '', `Status: **${report.status}**. Source: **${report.source.kind}**${report.source.synthetic ? ' — SYNTHETIC DEVELOPMENT DATA; NOT LIVE' : ''}.`,
    '', `Baseline ${report.periods.baseline.from}–${report.periods.baseline.toExclusive}; current ${report.periods.current.from}–${report.periods.current.toExclusive} (ends exclusive).`,
    `Fixed timezone ${report.periods.timezone}; caller-declared cutoff ${report.periods.asOf}. Production measurement verified: false.`, '', report.interpretation, ''];
  if (!report.metrics) lines.push('No measured retention values are available. Raw Slova exports are required.', '', ...report.requiredInput.map((item) => `- ${item}`));
  else {
    lines.push('| Week / day / return | Success / N | Rate | Unknown / immature | Missing-data bounds | Wilson 95% | Full-week maturity |', '|---|---:|---:|---:|---:|---:|---|');
    for (const week of report.metrics.weeks) for (const day of DAYS) for (const kind of ['open', 'gameplay']) {
      const row = week.retention[`D${day}`][kind];
      lines.push(`| ${week.week}/D${day}/${kind} | ${row.numerator}/${row.N} | ${pct(row.rate)} | ${row.unknownOutcomeUnits}/${row.immatureUnits} | ${interval(row.bounds)} | ${interval(row.samplingUncertainty.interval)} | ${week.maturity[`D${day}`].fullyMature ? 'complete' : 'PARTIAL; no full-week comparison'} |`);
    }
    for (const [name, title] of [['versions', 'Install versions'], ['acquisition', 'Primary install acquisition sources'], ['versionAcquisition', 'Install version and acquisition']]) {
      lines.push('', `## ${title}`, '', '| Week / bounded dimension / day / return | Success / N | Rate | Unknown / immature | Missing-data bounds | Wilson 95% |', '|---|---:|---:|---:|---:|---:|');
      for (const week of report.metrics.weeks) for (const group of week.strata[name]) for (const day of DAYS) for (const kind of ['open', 'gameplay']) {
        const label = [group.appVersion, group.versionProvenance, group.acquisitionClass, group.sourceReference, group.acquisitionProvenance].filter(supplied).join('/');
        const row = group.retention[`D${day}`][kind];
        lines.push(`| ${week.week}/${label}/D${day}/${kind} | ${row.numerator}/${row.N} | ${pct(row.rate)} | ${row.unknownOutcomeUnits}/${row.immatureUnits} | ${interval(row.bounds)} | ${interval(row.samplingUncertainty.interval)} |`);
      }
    }
    lines.push('', `Unassigned first-install units: ${report.metrics.population.unassignedFirstInstallUnits}. SDK session records: ${report.quality.sdkSessionRecords}; custom app_open records: ${report.quality.customAppOpenRecords}.`,
      'Companion JSON contains matched source/version comparisons and explicit maturity/provenance/coverage diagnostics. Partial weeks are never compared as the same fully followed population.');
  }
  lines.push('', 'Coverage gates:', '', ...report.coverageGates.map((gate) => `- ${gate.name}: ${gate.state}.`), '', 'Limitations:', '', ...report.limitations.map((item) => `- ${item}`), '', report.nextAction, '');
  return lines.join('\n');
}

function parseArguments(argv) {
  const options = { input: [], installs: [], sessions: [] }; const seen = new Set();
  const repeatable = { '--input': 'input', '--installs': 'installs', '--sessions': 'sessions' };
  const names = { '--baseline-start': 'baselineStart', '--current-start': 'currentStart', '--timezone': 'timezone', '--as-of': 'asOf',
    '--source': 'source', '--sdk-environment': 'sdkEnvironment', '--output': 'output' };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (repeatable[argument]) { const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error('Input argument requires a path.'); options[repeatable[argument]].push(value); continue; }
    if (seen.has(argument)) throw new Error('Duplicate CLI argument.'); seen.add(argument);
    if (argument === '--needs-raw-data') { options.needsRawData = true; continue; }
    if (!names[argument]) throw new Error('Unknown CLI argument. See docs/runbooks/weekly-retention-analysis.md.');
    const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error('CLI argument requires a value.'); options[names[argument]] = value;
  }
  const inputs = [...options.input, ...options.installs, ...options.sessions];
  if (!options.output) throw new Error('--output report prefix is required.');
  if (options.needsRawData && inputs.length) throw new Error('--needs-raw-data cannot be combined with input files.');
  if (!options.needsRawData && !inputs.length) throw new Error('Input files are required unless --needs-raw-data is explicit.');
  validateOptions(options); return options;
}
function main(argv) {
  const options = parseArguments(argv); const prefix = path.resolve(options.output); const outputs = [`${prefix}.json`, `${prefix}.md`];
  const paths = [...options.input, ...options.installs, ...options.sessions];
  const inputs = paths.map((input) => { try { return { path: fs.realpathSync(input), stat: fs.statSync(input) }; } catch { throw new Error('Cannot read an input file.'); } });
  const destinations = outputs.map((output) => ({ path: fs.existsSync(output) ? fs.realpathSync(output) : path.resolve(output), stat: fs.existsSync(output) ? fs.statSync(output) : null }));
  const aliases = (a, b) => a.path.toLowerCase() === b.path.toLowerCase() || a.stat && b.stat && a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino;
  for (const destination of destinations) if (inputs.some((input) => aliases(input, destination))) throw new Error('Output must not overwrite an input file.');
  if (aliases(destinations[0], destinations[1])) throw new Error('Output report files must not alias each other.');
  const withKind = (files, kind) => files.length ? readInputFiles(files).map((raw) => {
    if (supplied(raw.record_type) && raw.record_type !== kind) throw new Error('SDK input record_type conflicts with its declared file kind.');
    return { ...raw, record_type: kind };
  }) : [];
  const records = [...(options.input.length ? readInputFiles(options.input) : []), ...withKind(options.installs, 'install'), ...withKind(options.sessions, 'session')];
  const report = options.needsRawData ? buildNeedsRawDataReport(options) : analyzeWeeklyRetention(records, options);
  try { fs.mkdirSync(path.dirname(prefix), { recursive: true }); fs.writeFileSync(outputs[0], `${JSON.stringify(report, null, 2)}\n`); fs.writeFileSync(outputs[1], renderMarkdown(report)); }
  catch { throw new Error('Cannot write report outputs.'); }
  process.stdout.write(`${JSON.stringify({ status: report.status, source: report.source.kind, outputFiles: outputs.map((output) => path.basename(output)) })}\n`);
}
module.exports = { analyzeWeeklyRetention, buildNeedsRawDataReport, readInputFiles, renderMarkdown, parseArguments, wilson95 };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error instanceof SyntaxError ? 'Invalid JSON (payload omitted).' : error.message}\n`); process.exitCode = 1; } }
