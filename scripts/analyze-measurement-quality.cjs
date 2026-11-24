'use strict';

// Offline draft point 4. No network, secrets, raw identifiers, or conversion funnels in the report.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRecord } = require('./analyze-retention.cjs');
const { readInputFiles } = require('./analyze-product-improvements.cjs');

const DAY = 86400000;
const HEALTH_FIELDS = ['missing_required', 'dropped_properties', 'dedupe_hits', 'schema_rejected',
  'queue_dropped', 'queue_expired', 'handoff_exhausted', 'handoff_failures', 'durable_write_failures'];
const LIMITATIONS = [
  'All denominators describe supplied, observed records in the declared scope. Source, export completeness, production rollout and AppMetrica ingestion are not independently verified by this offline tool.',
  'The window uses raw SDK observation/session timestamps with explicit UTC/offset, not business occurredAtMs/occurred_at or a local sdk_handoff_at. Missing SDK observation time is excluded and counted.',
  'Custom events and SDK sessions are separate record types. Custom session_start/game_session_start events never manufacture the SDK-session denominator. Installs are outside this quality denominator.',
  'Custom events with the same event_id are one fact. Missing IDs remain observed rows with unknown duplicate coverage. Conflicting quality metadata for one ID are excluded; sender SDK version/time differences alone are delivery observations, not new facts.',
  'Versions are bounded numeric app version labels. Origin envelope version and SDK sender version are separate. A player or fact can occur in multiple version/schema rows; row player counts must not be summed as unique people.',
  'V3 device coverage is the intersection of observed v3 custom-event SDK devices and observed SDK-session devices within each sender version. It requires both supplied custom events and a session baseline. Unmatched custom devices are shown separately, not added to the numerator.',
  'Observed enabled/disabled/unknown consent metadata is not a consent rate for the app population. Refused or otherwise unobserved users are absent from logs; the population denominator and population consent rate remain null.',
  'Health summaries contain cumulative local counters. Use per-SDK-device + explicit consent-epoch maxima, never sum snapshots. Unknown epochs are separate. These maxima include history before the report window and are not period incident counts or failure rates.',
  'A counter decrease may be a reset or out-of-order delivery; it is a diagnostic, not a reason to add another counter total. Unknown-epoch resets cannot be reconstructed. Simultaneous conflicting snapshots use per-field maxima and have an ambiguity diagnostic.',
  'Local dedupe_hits measure suppressed local calls/queue rows. Repeated raw event IDs measure repeated exported copies. Neither is interchangeable with the other, and neither counts duplicate wallet credits.',
  'SDK handoff acceptance and sdk_handoff_at describe local submission only. This report cannot certify server acknowledgements, completeness, absent opted-out periods, or delivery of an event missing from the export.',
  'The parser reads complete files into memory. Use a bounded export; this is not a streaming warehouse pipeline. No point 5 conversion metric or point 6 retention estimate is implemented here.',
];

function fraction(numerator, denominator) { return { numerator, denominator, rate: denominator ? numerator / denominator : null }; }
function unavailable(reason) { return { numerator: null, denominator: null, rate: null, reason }; }
function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function offsetMinutes(value) {
  if (value === 'UTC' || value === 'Z') return 0;
  const match = /^(?:UTC)?([+-])(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match || Number(match[2]) > 14 || Number(match[3]) > 59 || Number(match[2]) === 14 && match[3] !== '00') {
    throw new Error('--timezone requires an explicit fixed offset, for example UTC+03:00; IANA/DST zones are unsupported.');
  }
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}
function timestamp(value) {
  if (typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    const ms = number < 1e11 ? number * 1000 : number;
    return Number.isFinite(ms) && ms >= 0 && ms <= 8640000000000000 ? ms : null;
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match || !validDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  try { offsetMinutes(match[5].toUpperCase()); } catch { return null; }
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
function validateOptions(options = {}) {
  if (!validDay(options.dateFrom) || !validDay(options.dateTo) || options.dateFrom > options.dateTo) {
    throw new Error('--date-from and --date-to require ordered YYYY-MM-DD dates; date-to is inclusive.');
  }
  const offset = offsetMinutes(options.timezone);
  const startMs = Date.parse(`${options.dateFrom}T00:00:00Z`) - offset * 60000;
  const endMs = Date.parse(`${options.dateTo}T00:00:00Z`) - offset * 60000 + DAY;
  if (typeof options.asOf !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(options.asOf)
      || timestamp(options.asOf) === null) throw new Error('--as-of requires a valid explicit UTC/offset timestamp.');
  const asOfMs = timestamp(options.asOf);
  if (asOfMs < endMs) throw new Error('--as-of must cover the complete inclusive date-to calendar day.');
  if (!['production', 'synthetic', 'observation'].includes(options.source)) {
    throw new Error('--source is required: production, synthetic, or observation.');
  }
  const toExclusive = new Date(endMs + offset * 60000).toISOString().slice(0, 10);
  if (!validDay(toExclusive)) throw new Error('Date range exceeds the supported calendar.');
  return { ...options, offset, startMs, endMs, asOfMs, toExclusive };
}
function baseReport(options) {
  return { game_id: 'slova', reportVersion: 1, scope: 'draft_point4_measurement_quality',
    date: new Date(options.asOfMs + options.offset * 60000).toISOString().slice(0, 10),
    source: { kind: options.source, synthetic: options.source === 'synthetic', productionMetricsVerified: false },
    window: { from: options.dateFrom, toInclusive: options.dateTo, toExclusive: options.toExclusive,
      timezone: options.timezone, asOf: new Date(options.asOfMs).toISOString(), timeBasis: 'raw_sdk_observation_or_session_start' },
    interpretation: 'Observed measurement coverage only; no population consent estimate, production certification or causal result.',
    limitations: LIMITATIONS };
}
function buildNeedsRawDataReport(options) {
  const validated = validateOptions(options);
  return { ...baseReport(validated), status: 'needs_raw_data', metrics: null,
    coverageGates: [{ name: 'raw_observed_custom_events', state: 'missing' }, { name: 'raw_sdk_sessions', state: 'missing' },
      { name: 'population_consent_denominator', state: 'unobservable', coverage: unavailable('refused_or_unobserved_users_are_absent_from_logs') }],
    requiredInput: ['Slova raw custom event JSON/JSONL/CSV with SDK identity, SDK observation clock, sender app version and bounded envelope metadata.',
      'Separate record_type=session SDK session records with SDK identity, production/QA provenance, observation/session clock and sender app version.',
      'analytics_health_summary snapshots with their original cumulative counters and consent_epoch_at when known.',
      'Complete declared export scope/cutoff; source label alone is not production rollout or delivery proof.'],
    next_action: 'Obtain usable Slova raw Logs, then run the same explicit scope. Aggregate counts and another game cannot substitute.' };
}
function identifier(value) {
  return typeof value === 'string' && /^[a-z0-9_.:-]{1,256}$/i.test(value) ? value
    : Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}
function version(value) { return typeof value === 'string' && /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value) ? value : 'unknown'; }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function values(objects, key) { return [...new Set(objects.filter(isObject).map((object) => object[key]).filter((value) => value !== undefined))]; }
function normalizeQualityRecord(record, index) {
  if (!isObject(record)) return { excluded: 'invalidRecord' };
  let payload = record.event_json ?? record.params ?? {};
  try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { return { excluded: 'invalidPayload' }; }
  if (!isObject(payload)) return { excluded: 'invalidPayload' };
  let normalized;
  try { normalized = normalizeRecord(record); } catch { return { excluded: 'invalidRecord' }; }
  const validV2 = payload.schema_version === 2 && isObject(payload.properties);
  const properties = validV2 ? payload.properties : payload;
  const metadata = [record, payload, ...(validV2 ? [properties] : [])];
  const flags = ['is_test', 'isTest', 'is_qa', 'is_qa_device'];
  if (normalized.isTest || flags.some((key) => values(metadata, key).some((value) => [true, 'true', 1, '1'].includes(value)))) return { excluded: 'testOrQa' };
  if (flags.some((key) => values(metadata, key).some((value) => ![false, 'false', 0, '0', null].includes(value)))) return { excluded: 'unknownTestStatus' };
  const environments = values(metadata, 'environment');
  if (environments.some((value) => ['qa', 'test', 'testing', 'development', 'dev', 'staging'].includes(value))) return { excluded: 'nonProductionEnvironment' };
  if (environments.length !== 1 || environments[0] !== 'production') return { excluded: 'unknownEnvironment' };
  let kind = 'custom';
  if (record.record_type === 'install') return { excluded: 'sdkInstallRecords' };
  if (record.record_type === 'session') kind = 'sdk_session';
  else if (record.record_type !== undefined && !['event', 'custom_event'].includes(record.record_type)) return { excluded: 'unsupportedRecordType' };
  // SDK export clocks only. A frozen business occurrence or local handoff is not export observation proof.
  const observedMs = (kind === 'sdk_session' ? timestamp(record.session_start_timestamp) ?? timestamp(record.session_start_datetime) : null)
    ?? timestamp(record.event_timestamp) ?? timestamp(record.event_datetime) ?? timestamp(record.occurred_at);
  if (observedMs === null) return { excluded: 'missingSdkObservationTime' };
  const consentValues = values(metadata, 'consent_state');
  const consent = consentValues.length === 1 && ['enabled', 'disabled'].includes(consentValues[0]) ? consentValues[0] : 'unknown';
  const epochValue = payload.consent_epoch_at !== undefined ? payload.consent_epoch_at : record.consent_epoch_at;
  const parsedEpoch = typeof epochValue === 'string' ? timestamp(epochValue) : null;
  const epoch = parsedEpoch !== null && parsedEpoch <= observedMs ? parsedEpoch : null;
  const counters = {}; let invalidCounters = 0;
  if (normalized.name === 'analytics_health_summary') for (const field of HEALTH_FIELDS) {
    if (Number.isSafeInteger(properties[field]) && properties[field] >= 0) counters[field] = properties[field];
    else if (properties[field] !== undefined) invalidCounters++;
  }
  const sdkId = identifier(normalized.sdkId);
  const sdkVersion = version(normalized.sdkAppVersion);
  const originVersion = version(normalized.originAppVersion);
  const schema = validV2 ? '2' : payload.schema_version === 3 ? '3' : 'unknown';
  const sessionId = identifier(record.sdk_session_id ?? record.session_id);
  const sessionStart = timestamp(record.session_start_timestamp) ?? timestamp(record.session_start_datetime);
  const event = { kind, index, name: normalized.name, observedMs, sdkId, sdkVersions: [sdkVersion], originVersion, schema,
    eventId: identifier(normalized.eventId), consent, epoch, counters, invalidCounters,
    invalidEpoch: epochValue !== undefined && epochValue !== null && epoch === null,
    consentConflict: consentValues.includes('enabled') && consentValues.includes('disabled'),
    consentInvalid: consentValues.some((value) => value !== null && !['enabled', 'disabled', 'unknown'].includes(value)),
    schemaUnknownReason: schema !== 'unknown' ? null : payload.schema_version === undefined || payload.schema_version === null ? 'missing'
      : Number.isSafeInteger(payload.schema_version) && ![2, 3].includes(payload.schema_version) ? 'unsupported' : 'invalid',
    localHandoffKnown: timestamp(payload.sdk_handoff_at) !== null,
    sessionKey: kind === 'sdk_session' && sdkId && (sessionId || sessionStart !== null)
      ? JSON.stringify([sdkId, sessionId ?? `start:${sessionStart}`]) : null };
  event.signature = JSON.stringify([event.kind, sdkId, event.name, schema, originVersion, consent, epoch,
    event.consentConflict, event.consentInvalid, event.invalidEpoch, counters,
    timestamp(properties.occurredAtMs) ?? timestamp(payload.occurred_at), kind === 'sdk_session' ? sessionStart : null]);
  return event;
}
function deduplicate(events, quality) {
  const groups = new Map(); const unkeyed = [];
  for (const event of events) {
    const key = event.kind === 'custom' && event.eventId ? `event:${event.eventId}`
      : event.kind === 'sdk_session' && event.sessionKey ? `session:${event.sessionKey}` : null;
    if (!key) { unkeyed.push(event); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const result = [...unkeyed];
  for (const copies of groups.values()) {
    const custom = copies[0].kind === 'custom';
    if (custom) quality.customEventIds++;
    if (copies.length > 1) {
      if (custom) { quality.repeatedCustomEventIdGroups++; quality.repeatedCustomEventIdCopies += copies.length - 1; }
      else quality.repeatedSdkSessionCopies += copies.length - 1;
    }
    if (new Set(copies.map((copy) => copy.signature)).size > 1) {
      if (custom) { quality.conflictingQualityMetadataEventIdGroups++; quality.conflictingCustomRowsExcluded += copies.length; }
      else { quality.conflictingSdkSessionGroups++; quality.conflictingSdkSessionRowsExcluded += copies.length; }
      continue;
    }
    copies.sort((a, b) => a.observedMs - b.observedMs || a.index - b.index);
    const sdkVersions = [...new Set(copies.flatMap((copy) => copy.sdkVersions))].sort();
    if (custom && sdkVersions.length > 1) quality.eventIdsObservedAcrossSdkVersions++;
    result.push({ ...copies[0], sdkVersions, localHandoffKnown: copies.some((copy) => copy.localHandoffKnown) });
  }
  return result;
}
function uniquePlayers(events) { return new Set(events.map((event) => event.sdkId).filter(Boolean)); }
function intersection(a, b) { return [...a].filter((value) => b.has(value)).length; }
function states(events) {
  const counts = { enabled: 0, disabled: 0, unknown: 0 };
  for (const event of events) counts[event.consent]++;
  return { counts, observedEvents: events.length, knownMetadataCoverage: fraction(counts.enabled + counts.disabled, events.length),
    enabledShareOfObservedEvents: fraction(counts.enabled, events.length),
    disabledShareOfObservedEvents: fraction(counts.disabled, events.length) };
}
function healthSummary(events) {
  const snapshots = events.filter((event) => event.name === 'analytics_health_summary');
  const diagnostics = { snapshots: snapshots.length, missingSdkIdentity: 0, unknownEpochSnapshots: 0,
    invalidEpochSnapshots: 0, invalidCounterFields: 0, counterDecreasesOrReordering: 0, simultaneousConflictingSnapshotGroups: 0 };
  const groups = new Map(); const aggregates = Object.fromEntries(HEALTH_FIELDS.map((field) => [field,
    { observedSnapshots: 0, knownEpoch: { cumulativeMaximaTotal: null, deviceEpochSegments: 0, overflowed: false },
      unknownEpoch: { cumulativeMaximaTotal: null, deviceEpochSegments: 0, overflowed: false } }]));
  for (const event of snapshots) {
    diagnostics.invalidCounterFields += event.invalidCounters;
    if (event.epoch === null) diagnostics.unknownEpochSnapshots++;
    if (event.invalidEpoch) diagnostics.invalidEpochSnapshots++;
    for (const field of Object.keys(event.counters)) aggregates[field].observedSnapshots++;
    if (!event.sdkId) { diagnostics.missingSdkIdentity++; continue; }
    const key = JSON.stringify([event.sdkId, event.epoch]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const segments = [];
  for (const group of groups.values()) {
    const times = new Map();
    for (const event of group) {
      if (!times.has(event.observedMs)) times.set(event.observedMs, []);
      times.get(event.observedMs).push(event);
    }
    const last = {}; const maxima = {}; const kind = group[0].epoch === null ? 'unknownEpoch' : 'knownEpoch';
    for (const [, sameTime] of [...times].sort(([a], [b]) => a - b)) {
      const current = {}; let conflict = false;
      for (const event of sameTime) for (const [field, value] of Object.entries(event.counters)) {
        if (current[field] !== undefined && current[field] !== value) conflict = true;
        current[field] = Math.max(current[field] ?? 0, value);
      }
      if (conflict) diagnostics.simultaneousConflictingSnapshotGroups++;
      if (Object.entries(current).some(([field, value]) => last[field] !== undefined && value < last[field])) {
        diagnostics.counterDecreasesOrReordering++;
      }
      for (const [field, value] of Object.entries(current)) {
        last[field] = value; maxima[field] = Math.max(maxima[field] ?? 0, value);
      }
    }
    if (Object.keys(maxima).length) segments.push({ kind, maxima });
  }
  for (const { kind, maxima } of segments) for (const [field, value] of Object.entries(maxima)) {
    const row = aggregates[field][kind];
    const sum = (row.cumulativeMaximaTotal ?? 0) + value;
    if (!Number.isSafeInteger(sum)) row.overflowed = true;
    row.cumulativeMaximaTotal = row.overflowed ? null : sum; row.deviceEpochSegments++;
  }
  return { semantics: 'Cumulative per-device/consent-epoch maxima; counter decreases are reset-or-reordering diagnostics only. Not snapshot sums, window incident counts, or failure rates.',
    diagnostics, counters: aggregates, knownEpochSegments: segments.filter((segment) => segment.kind === 'knownEpoch').length,
    unknownEpochSegments: segments.filter((segment) => segment.kind === 'unknownEpoch').length };
}
function analyzeMeasurementQuality(records, options) {
  const validated = validateOptions(options);
  if (!Array.isArray(records)) throw new Error('An array of raw records is required.');
  const exclusions = Object.fromEntries(['invalidRecord', 'invalidPayload', 'testOrQa', 'unknownTestStatus', 'nonProductionEnvironment', 'unknownEnvironment',
    'sdkInstallRecords', 'unsupportedRecordType', 'missingSdkObservationTime', 'beforeWindow', 'atOrAfterWindowEnd', 'afterAsOf'].map((name) => [name, 0]));
  const scoped = [];
  records.forEach((record, index) => {
    const event = normalizeQualityRecord(record, index);
    if (event.excluded) { exclusions[event.excluded]++; return; }
    if (event.observedMs > validated.asOfMs) { exclusions.afterAsOf++; return; }
    if (event.observedMs < validated.startMs) { exclusions.beforeWindow++; return; }
    if (event.observedMs >= validated.endMs) { exclusions.atOrAfterWindowEnd++; return; }
    scoped.push(event);
  });
  const quality = { inputRecords: records.length, rawCustomRowsInScope: scoped.filter((event) => event.kind === 'custom').length,
    rawSdkSessionRowsInScope: scoped.filter((event) => event.kind === 'sdk_session').length, exclusions,
    customEventIds: 0, repeatedCustomEventIdGroups: 0, repeatedCustomEventIdCopies: 0,
    conflictingQualityMetadataEventIdGroups: 0, conflictingCustomRowsExcluded: 0,
    repeatedSdkSessionCopies: 0, conflictingSdkSessionGroups: 0, conflictingSdkSessionRowsExcluded: 0,
    eventIdsObservedAcrossSdkVersions: 0 };
  const events = deduplicate(scoped, quality);
  const custom = events.filter((event) => event.kind === 'custom');
  const sessions = events.filter((event) => event.kind === 'sdk_session');
  const players = uniquePlayers(events); const customPlayers = uniquePlayers(custom); const sessionPlayers = uniquePlayers(sessions);
  const playerVersions = new Map();
  for (const event of events) if (event.sdkId) {
    if (!playerVersions.has(event.sdkId)) playerVersions.set(event.sdkId, new Set());
    for (const label of event.sdkVersions) playerVersions.get(event.sdkId).add(label);
  }
  const schemaCounts = { '2': 0, '3': 0, unknown: 0 }; const schemaUnknownReasons = { missing: 0, unsupported: 0, invalid: 0 };
  const matrix = new Map();
  for (const event of custom) {
    schemaCounts[event.schema]++;
    if (event.schemaUnknownReason) schemaUnknownReasons[event.schemaUnknownReason]++;
    const key = JSON.stringify([event.originVersion, event.schema]);
    if (!matrix.has(key)) matrix.set(key, { originAppVersion: event.originVersion, schema: event.schema, events: [] });
    matrix.get(key).events.push(event);
  }
  const versions = [...new Set(events.flatMap((event) => event.sdkVersions))].sort();
  const bySdkAppVersion = versions.map((sdkAppVersion) => {
    const observedCustom = custom.filter((event) => event.sdkVersions.includes(sdkAppVersion));
    const observedSessions = sessions.filter((event) => event.sdkVersions.includes(sdkAppVersion));
    const baseline = uniquePlayers(observedSessions); const v3 = uniquePlayers(observedCustom.filter((event) => event.schema === '3'));
    const coverage = !custom.length ? unavailable('missing_observed_custom_event_baseline')
      : !observedSessions.length ? unavailable('missing_sdk_session_baseline_for_version')
        : !baseline.size ? unavailable('missing_identified_sdk_session_players_for_version')
          : sdkAppVersion === 'unknown' ? unavailable('unknown_sdk_sender_version') : fraction(intersection(v3, baseline), baseline.size);
    return { sdkAppVersion, observedCustomEvents: observedCustom.length, observedCustomSdkPlayers: uniquePlayers(observedCustom).size,
      observedV3CustomSdkPlayers: v3.size, observedSdkSessionUnits: observedSessions.length,
      observedSdkSessionPlayers: baseline.size, v3SdkPlayerCoverage: coverage,
      v3CustomPlayersOutsideSessionBaseline: [...v3].filter((player) => !baseline.has(player)).length,
      knownConsentMetadataCoverage: states(observedCustom).knownMetadataCoverage };
  });
  const consent = states(custom);
  const health = healthSummary(custom);
  const metrics = {
    observed: { customEvents: custom.length, customEventUnit: 'one event_id fact; unkeyed legacy rows remain individual observations',
      sdkSessionUnits: sessions.length, sdkSessionUnit: 'one SDK-device/session-id or explicit session-start fact; unkeyed rows remain individual observations',
      sdkPlayers: players.size, customSdkPlayers: customPlayers.size, sdkSessionPlayers: sessionPlayers.size,
      customPlayersOutsideSessionBaseline: [...customPlayers].filter((player) => !sessionPlayers.has(player)).length,
      customRowsWithoutEventId: custom.filter((event) => !event.eventId).length,
      sessionRowsWithoutSessionIdentity: sessions.filter((event) => !event.sessionKey).length },
    schema: { customEvents: schemaCounts, unknownReasons: schemaUnknownReasons,
      knownCustomSchemaCoverage: fraction(schemaCounts['2'] + schemaCounts['3'], custom.length),
      v3ShareOfObservedCustomEvents: fraction(schemaCounts['3'], custom.length) },
    identity: { customEventSdkIdentityCoverage: fraction(custom.filter((event) => event.sdkId).length, custom.length),
      sdkSessionIdentityCoverage: fraction(sessions.filter((event) => event.sdkId).length, sessions.length),
      customEventIdCoverage: fraction(custom.filter((event) => event.eventId).length, custom.length) },
    versions: { originVersionCoverageOnCustomEvents: fraction(custom.filter((event) => event.originVersion !== 'unknown').length, custom.length),
      senderVersionCoverageOnCustomEvents: fraction(custom.filter((event) => event.sdkVersions.some((value) => value !== 'unknown')).length, custom.length),
      senderVersionCoverageOnSdkSessions: fraction(sessions.filter((event) => event.sdkVersions.some((value) => value !== 'unknown')).length, sessions.length),
      customEventsByOriginVersionAndSchema: [...matrix.values()].map((row) => ({ originAppVersion: row.originAppVersion, schema: row.schema,
        customEvents: row.events.length, observedSdkPlayers: uniquePlayers(row.events).size, consent: states(row.events) }))
        .sort((a, b) => a.originAppVersion.localeCompare(b.originAppVersion) || a.schema.localeCompare(b.schema)),
      bySdkAppVersion, sdkPlayersObservedInMultipleSenderVersions: [...playerVersions.values()].filter((memberships) => memberships.size > 1).length,
      rowOverlap: 'Version/schema rows are memberships, not a partition of SDK players; duplicates can also carry one fact across sender versions.' },
    consent: { ...consent, conflictingMetadataEvents: custom.filter((event) => event.consentConflict).length,
      invalidMetadataEvents: custom.filter((event) => event.consentInvalid).length,
      populationConsentRate: unavailable('refused_or_unobserved_users_are_absent_from_logs') },
    health,
    delivery: { rawRepeatedEventIdCopies: quality.repeatedCustomEventIdCopies,
      localDedupeCounter: health.counters.dedupe_hits,
      localHandoffTimestampCoverage: fraction(custom.filter((event) => event.localHandoffKnown).length, custom.length),
      serverAcknowledgementRate: unavailable('local_sdk_acceptance_is_not_server_acknowledgement_and_export_completeness_is_external') },
  };
  const gate = (name, coverage) => ({ name, state: !coverage.denominator ? 'missing' : coverage.numerator === coverage.denominator ? 'available' : 'partial', coverage });
  const coverageGates = [
    { name: 'raw_observed_custom_events', state: custom.length ? 'observed' : 'missing' },
    { name: 'raw_sdk_sessions', state: sessions.length ? 'observed' : 'missing' },
    gate('declared_custom_schema', metrics.schema.knownCustomSchemaCoverage),
    gate('custom_event_sdk_identity', metrics.identity.customEventSdkIdentityCoverage),
    gate('custom_event_id', metrics.identity.customEventIdCoverage),
    gate('sdk_session_identity', metrics.identity.sdkSessionIdentityCoverage),
    gate('origin_app_version_on_custom_events', metrics.versions.originVersionCoverageOnCustomEvents),
    gate('sdk_sender_version_on_custom_events', metrics.versions.senderVersionCoverageOnCustomEvents),
    gate('sdk_sender_version_on_sdk_sessions', metrics.versions.senderVersionCoverageOnSdkSessions),
    gate('observed_custom_consent_metadata', consent.knownMetadataCoverage),
    { name: 'runtime_health_snapshots', state: health.diagnostics.snapshots ? 'observed' : 'missing' },
    { name: 'population_consent_denominator', state: 'unobservable', coverage: metrics.consent.populationConsentRate },
    { name: 'production_ingestion_and_export_completeness', state: 'external_unverified' },
  ];
  return { ...baseReport(validated), status: !events.length ? 'needs_raw_data'
    : coverageGates.some((item) => ['missing', 'partial'].includes(item.state)) ? 'observed_with_coverage_gaps' : 'observed',
    metrics: events.length ? metrics : null, quality, coverageGates };
}
function renderMarkdown(report) {
  const percentage = (value) => value === null || value === undefined ? 'unavailable' : `${(value * 100).toFixed(2)}%`;
  const lines = ['# Slova draft point 4 measurement quality', '',
    `Status: **${report.status}**. Source: **${report.source.kind}**${report.source.synthetic ? ' — SYNTHETIC DEVELOPMENT DATA; NOT LIVE' : ''}.`,
    `Calendar ${report.window.from}–${report.window.toInclusive} inclusive; fixed timezone ${report.window.timezone}; explicit cutoff ${report.window.asOf}.`,
    '', report.interpretation, ''];
  if (!report.metrics) lines.push('No measured quality rates are available. Usable raw Slova custom events and SDK sessions are required.',
    ...(report.requiredInput ?? []).map((item) => `- ${item}`));
  else {
    const metrics = report.metrics;
    lines.push(`Observed custom facts/rows: ${metrics.observed.customEvents}; observed SDK session units: ${metrics.observed.sdkSessionUnits}; SDK players: ${metrics.observed.sdkPlayers}.`,
      '', '| Origin version | Declared schema | Custom facts/rows | SDK players | Known consent metadata |', '|---|---|---:|---:|---:|');
    for (const row of metrics.versions.customEventsByOriginVersionAndSchema) lines.push(`| ${row.originAppVersion} | ${row.schema} | ${row.customEvents} | ${row.observedSdkPlayers} | ${percentage(row.consent.knownMetadataCoverage.rate)} |`);
    lines.push('', '| SDK sender version | Custom facts/rows | SDK session units | Session SDK players | V3 SDK-device coverage, intersection |', '|---|---:|---:|---:|---:|');
    for (const row of metrics.versions.bySdkAppVersion) lines.push(`| ${row.sdkAppVersion} | ${row.observedCustomEvents} | ${row.observedSdkSessionUnits} | ${row.observedSdkSessionPlayers} | ${percentage(row.v3SdkPlayerCoverage.rate)} (${row.v3SdkPlayerCoverage.numerator ?? '?'}/${row.v3SdkPlayerCoverage.denominator ?? '?'}) |`);
    lines.push('', 'Players can appear in several rows. Never sum per-version players as unique people.',
      '', `Observed custom consent metadata: enabled ${metrics.consent.counts.enabled}, disabled ${metrics.consent.counts.disabled}, unknown ${metrics.consent.counts.unknown}; known coverage ${percentage(metrics.consent.knownMetadataCoverage.rate)}. Population consent rate: **unavailable**; refused/unobserved people are outside logs.`,
      '', `Repeated raw event-ID copies: ${metrics.delivery.rawRepeatedEventIdCopies}. Local dedupe_hits is a separate cumulative snapshot counter. SDK handoff is not server acknowledgement.`,
      '', '| Health counter | Known-epoch segment maxima total | Unknown-epoch segment maxima total | Snapshots with field |', '|---|---:|---:|---:|');
    for (const [field, row] of Object.entries(metrics.health.counters)) lines.push(`| ${field} | ${row.knownEpoch.cumulativeMaximaTotal ?? 'unavailable'} | ${row.unknownEpoch.cumulativeMaximaTotal ?? 'unavailable'} | ${row.observedSnapshots} |`);
    lines.push('', metrics.health.semantics,
      `Counter decreases (reset or reordering) ${metrics.health.diagnostics.counterDecreasesOrReordering}; ambiguous simultaneous snapshot groups ${metrics.health.diagnostics.simultaneousConflictingSnapshotGroups}.`,
      'Exact denominators, exclusions, missing identity/clock coverage, duplicate conflicts and metadata coverage are in the companion JSON. No player IDs, event IDs, epoch values, words or email values are exported.');
  }
  lines.push('', 'Coverage gates:', '', ...report.coverageGates.map((item) => `- ${item.name}: ${item.state}.`),
    '', 'Limitations:', '', ...report.limitations.map((item) => `- ${item}`), '');
  return lines.join('\n');
}
function parseArguments(argv) {
  const options = { input: [] }; const seen = new Set();
  const names = { '--date-from': 'dateFrom', '--date-to': 'dateTo', '--timezone': 'timezone', '--as-of': 'asOf', '--source': 'source', '--output': 'output' };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--needs-raw-data') {
      if (seen.has(argument)) throw new Error('Duplicate --needs-raw-data.');
      seen.add(argument); options.needsRawData = true; continue;
    }
    if (argument === '--input') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--input requires a path.');
      options.input.push(value); continue;
    }
    if (!Object.hasOwn(names, argument)) throw new Error('Unknown CLI argument. See docs/runbooks/measurement-quality.md.');
    if (seen.has(argument)) throw new Error(`Duplicate ${argument}.`);
    seen.add(argument);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    options[names[argument]] = value;
  }
  if (!options.output) throw new Error('--output report prefix is required.');
  if (options.needsRawData && options.input.length) throw new Error('--needs-raw-data cannot be combined with --input.');
  if (!options.needsRawData && !options.input.length) throw new Error('--input is required unless --needs-raw-data is explicit.');
  validateOptions(options);
  return options;
}
function main(argv) {
  const options = parseArguments(argv); const prefix = path.resolve(options.output);
  const outputs = [`${prefix}.json`, `${prefix}.md`];
  const inputs = options.input.map((file) => {
    try { return { path: fs.realpathSync(file), stat: fs.statSync(file) }; } catch { throw new Error('Cannot read an input file.'); }
  });
  for (const file of outputs) {
    const resolved = fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file);
    const stat = fs.existsSync(file) ? fs.statSync(file) : null;
    if (inputs.some((input) => input.path.toLowerCase() === resolved.toLowerCase()
        || stat && stat.ino === input.stat.ino && stat.dev === input.stat.dev)) throw new Error('Output must not overwrite an input file.');
  }
  const report = options.needsRawData ? buildNeedsRawDataReport(options) : analyzeMeasurementQuality(readInputFiles(options.input), options);
  try {
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(outputs[0], `${JSON.stringify(report, null, 2)}\n`); fs.writeFileSync(outputs[1], renderMarkdown(report));
  } catch { throw new Error('Cannot write report outputs.'); }
  process.stdout.write(`${JSON.stringify({ status: report.status, source: report.source.kind, outputFiles: 2 })}\n`);
}

module.exports = { analyzeMeasurementQuality, buildNeedsRawDataReport, readInputFiles, renderMarkdown, parseArguments };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
