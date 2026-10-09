const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WORD_RE = /^[а-я]{3,8}$/;
const BLOCK_REASONS = new Set([
  'profanity', 'slur_or_insult', 'proper_name', 'abbreviation',
  'malformed', 'non_lemma', 'low_quality', 'manual_deny',
]);

function normalizeToken(value) {
  const word = String(value ?? '').normalize('NFC').toLowerCase().replace(/ё/g, 'е');
  return WORD_RE.test(word) ? word : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return sha256(canonicalize(value));
}

function countsOf(word) {
  const counts = new Map();
  for (const char of word) counts.set(char, (counts.get(char) || 0) + 1);
  return counts;
}

function isConstructible(word, letters) {
  const available = countsOf(letters.join(''));
  for (const char of word) {
    const remaining = available.get(char) || 0;
    if (!remaining) return false;
    available.set(char, remaining - 1);
  }
  return true;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function generatedAtFromEnv() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (!raw || !/^\d+$/.test(raw)) throw new Error('SOURCE_DATE_EPOCH is required for reproducible content generation');
  const date = new Date(Number(raw) * 1000);
  if (Number.isNaN(date.getTime())) throw new Error('SOURCE_DATE_EPOCH is invalid');
  return date.toISOString();
}

module.exports = {
  BLOCK_REASONS,
  WORD_RE,
  canonicalHash,
  canonicalize,
  countsOf,
  generatedAtFromEnv,
  isConstructible,
  normalizeToken,
  readJson,
  sha256,
  writeJsonAtomic,
};
