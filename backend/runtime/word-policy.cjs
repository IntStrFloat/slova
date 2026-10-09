const crypto = require('node:crypto');

const MAX_POLICY_BYTES = 256 * 1024;
const MAX_POLICY_ENTRIES = 2_000;
const POLICY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BLOCK_REASONS = new Set([
  'profanity',
  'slur_or_insult',
  'proper_name',
  'abbreviation',
  'malformed',
  'non_lemma',
  'low_quality',
  'manual_deny',
]);
const NORMALIZED_WORD = /^[а-я]{3,8}$/;
const CONTENT_VERSION = /^[A-Za-z0-9._-]{1,128}$/;
const FALLBACK_ID = /^[A-Za-z0-9._-]{1,128}$/;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksumForManifest(manifest) {
  const { checksum, ...payload } = manifest;
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function exactKeys(value, allowed, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => key in value);
}

function validIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateManifest(manifest) {
  if (!exactKeys(manifest, ['schemaVersion', 'locale', 'contentVersion', 'revision', 'publishedAt', 'expiresAt', 'checksum', 'allow', 'deny', 'fallbackByGlobalLevel'], ['schemaVersion', 'locale', 'contentVersion', 'revision', 'publishedAt', 'expiresAt', 'checksum', 'allow', 'deny', 'fallbackByGlobalLevel'])) {
    return { ok: false, error: 'bad_policy_shape' };
  }
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > MAX_POLICY_BYTES) return { ok: false, error: 'policy_too_large' };
  if (manifest.schemaVersion !== 1 || manifest.locale !== 'ru' || !CONTENT_VERSION.test(manifest.contentVersion)) {
    return { ok: false, error: 'bad_policy_scope' };
  }
  if (!Number.isSafeInteger(manifest.revision) || manifest.revision < 1) return { ok: false, error: 'bad_policy_revision' };
  if (!validIsoDate(manifest.publishedAt) || !validIsoDate(manifest.expiresAt) || Date.parse(manifest.expiresAt) <= Date.parse(manifest.publishedAt)) {
    return { ok: false, error: 'bad_policy_expiry' };
  }
  if (typeof manifest.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.checksum) || checksumForManifest(manifest) !== manifest.checksum) {
    return { ok: false, error: 'bad_policy_checksum' };
  }
  if (!Array.isArray(manifest.allow) || !Array.isArray(manifest.deny) || manifest.allow.length > MAX_POLICY_ENTRIES || manifest.deny.length > MAX_POLICY_ENTRIES) {
    return { ok: false, error: 'bad_policy_entries' };
  }
  const seen = new Set();
  for (const entry of manifest.allow) {
    if (!exactKeys(entry, ['word', 'rewardEligible'], ['word']) || !NORMALIZED_WORD.test(entry.word) || (entry.rewardEligible !== undefined && typeof entry.rewardEligible !== 'boolean') || seen.has(entry.word)) {
      return { ok: false, error: 'bad_policy_allow' };
    }
    seen.add(entry.word);
  }
  for (const entry of manifest.deny) {
    if (!exactKeys(entry, ['word', 'reason'], ['word', 'reason']) || !NORMALIZED_WORD.test(entry.word) || !BLOCK_REASONS.has(entry.reason) || seen.has(entry.word)) {
      return { ok: false, error: 'bad_policy_deny' };
    }
    seen.add(entry.word);
  }
  if (!manifest.fallbackByGlobalLevel || typeof manifest.fallbackByGlobalLevel !== 'object' || Array.isArray(manifest.fallbackByGlobalLevel)) {
    return { ok: false, error: 'bad_policy_fallbacks' };
  }
  for (const [globalLevel, fallbackId] of Object.entries(manifest.fallbackByGlobalLevel)) {
    if (!/^[1-9]\d*$/.test(globalLevel) || Number(globalLevel) > 100_000 || typeof fallbackId !== 'string' || !FALLBACK_ID.test(fallbackId)) {
      return { ok: false, error: 'bad_policy_fallbacks' };
    }
  }
  return { ok: true };
}

function policiesFrom(data) {
  return Array.isArray(data.wordPolicies) ? data.wordPolicies : [];
}

async function publishWordPolicy(store, manifest, options = {}) {
  const validation = validateManifest(manifest);
  if (!validation.ok) return validation;
  if (typeof options.validateFallbacks === 'function') {
    const fallbackResult = await options.validateFallbacks(manifest);
    if (fallbackResult !== true) return { ok: false, error: typeof fallbackResult === 'string' ? fallbackResult : 'invalid_policy_fallback' };
  } else if (Object.keys(manifest.fallbackByGlobalLevel).length > 0) {
    return { ok: false, error: 'fallback_validation_unavailable' };
  }

  const data = store.read();
  const policies = policiesFrom(data);
  const maxRevision = policies.reduce((max, policy) => Math.max(max, Number(policy.revision) || 0), 0);
  if (manifest.revision <= maxRevision) return { ok: false, error: 'non_monotonic_policy_revision' };
  data.wordPolicies = [...policies, manifest];

  const cutoff = Date.now() - POLICY_RETENTION_MS;
  const newestThree = new Set(data.wordPolicies.slice().sort((a, b) => b.revision - a.revision).slice(0, 3).map((policy) => policy.revision));
  data.wordPolicies = data.wordPolicies.filter((policy) => newestThree.has(policy.revision) || Date.parse(policy.publishedAt) >= cutoff);
  store.write(data); // FileStore writes temp file then atomically renames it.
  return { ok: true, manifest };
}

function latestPolicyFor(data, locale, contentVersion) {
  return policiesFrom(data)
    .filter((policy) => policy.locale === locale && policy.contentVersion === contentVersion)
    .sort((a, b) => b.revision - a.revision)[0] || null;
}

module.exports = {
  BLOCK_REASONS,
  MAX_POLICY_BYTES,
  MAX_POLICY_ENTRIES,
  NORMALIZED_WORD,
  canonicalJson,
  checksumForManifest,
  validateManifest,
  publishWordPolicy,
  latestPolicyFor,
};
