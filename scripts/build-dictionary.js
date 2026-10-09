/**
 * Пайплайн словаря (спека 15/19). Из ЧИСТОГО морфологического источника берёт
 * только НАЧАЛЬНЫЕ ФОРМЫ (леммы) существительных, прилагательных, глаголов —
 * склонения/спряжения НЕ используются (кроссворд оперирует словарными формами,
 * а не косвенными падежами). Строит ДВА словаря:
 *
 *   assets/dict/ru.json        — валидационный: все леммы 3–8 букв
 *                                (для bonusPool: «любое реальное слово — реальное»).
 *   assets/dict/ru-common.json — common: частотный поднабор узнаваемых лемм,
 *                                УПОРЯДОЧЕН по убыванию частоты (index = ранг).
 *                                Используется генератором для слов-ответов и сидов.
 *   assets/dict/ru.meta.json   — счётчики/пороги.
 *
 * Источник чистый (Wiktionary-производная Badestrand/russian-dictionary): без
 * обрывков/аббревиатур/имён собственных. Лемма — колонка `bare` (сущ. — им.п. ед.ч.,
 * прил. — м.р. ед.ч., глаг. — инфинитив). Частоты — hermitdave/FrequencyWords ru 2018.
 * См. docs/runbooks/dictionary-sources.md.
 * В рантайм игры словарь НЕ грузится — только генератор/бэкенд [03/13].
 *
 * CLI: node scripts/build-dictionary.js --src <dir> [--common-freq 40]
 */
const fs = require('node:fs');
const path = require('node:path');
const { FUNCTION_WORDS, PROFANITY_EXACT, isProfane, isLowQualityWord } = require('./dict/stoplists');
const { normalizeToken, sha256, writeJsonAtomic } = require('./dict/content');

/** Нормализация: нижний регистр, ё→е, снять ударение (') и любую не-кириллицу. */
function normalize(w) {
  return String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^а-я]/g, '');
}

/** Strict source normalization. Invalid source tokens are rejected, never repaired. */
function normalizeStrict(w) {
  return normalizeToken(w);
}

/** Совместимость со старым API: фильтр длины + стоп-листа. */
function filterWords(words, { min = 3, max = 8, stop = [] } = {}) {
  const stopSet = new Set(stop.map(normalize));
  const out = new Set();
  for (const raw of words) {
    const w = normalize(raw);
    if (w.length >= min && w.length <= max && !stopSet.has(w) && !isProfane(w) && !isLowQualityWord(w)) out.add(w);
  }
  return [...out].sort();
}

const MIN_LEN = 3;
const MAX_LEN = 8;

// Числительные/частые слова, отсутствующие в сущ./прил./глаг. источнике.
const EXTRA = [
  'ноль', 'нуль', 'один', 'одна', 'одно', 'одни', 'два', 'две', 'двое', 'три', 'трое',
  'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'двадцать', 'тридцать',
  'сорок', 'сто', 'двести', 'триста', 'тысяча', 'миллион', 'много', 'мало',
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь',
  'октябрь', 'ноябрь', 'декабрь', 'север', 'юг', 'запад', 'восток',
];

/**
 * Извлечь только ЛЕММЫ (начальные формы) из CSV (TSV) Badestrand — колонка `bare`.
 * Склонения/спряжения из остальных колонок намеренно НЕ берём (см. спека 15).
 */
function readLemmasFromCsv(file, into, rejected) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const tab = lines[i].indexOf('\t');
    const bare = tab < 0 ? lines[i] : lines[i].slice(0, tab);
    if (!bare) continue;
    for (const piece of bare.split(/[,;/]/)) {
      const w = normalizeStrict(piece);
      if (!w) {
        if (String(piece).trim()) rejected.push({ file: path.basename(file), token: String(piece).trim(), reason: 'malformed' });
        continue;
      }
      if (!isProfane(w) && !isLowQualityWord(w)) into.add(w);
    }
  }
}

/** Чистый словарь лемм из всех источников-CSV + EXTRA. */
function readClean(srcDir, rejected = []) {
  const clean = new Set();
  for (const f of ['nouns.csv', 'adjectives.csv', 'verbs.csv']) {
    const p = path.join(srcDir, f);
    if (fs.existsSync(p)) readLemmasFromCsv(p, clean, rejected);
  }
  for (const w of EXTRA) {
    const n = normalizeStrict(w);
    if (n && !isProfane(n) && !isLowQualityWord(n)) clean.add(n);
  }
  return clean;
}

/** Частотный список → Map<word,{f,rank}>. */
function readFreq(srcDir, rejected = []) {
  const text = fs.readFileSync(path.join(srcDir, 'ru_full.txt'), 'utf8');
  const freq = new Map();
  let rank = 0;
  for (const line of text.split(/\r?\n/)) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const raw = line.slice(0, sp);
    const w = normalizeStrict(raw);
    const f = parseInt(line.slice(sp + 1), 10) || 0;
    if (!w) {
      if (raw.trim()) rejected.push({ file: 'ru_full.txt', token: raw.trim(), reason: 'malformed' });
      continue;
    }
    if (!freq.has(w)) freq.set(w, { f, rank: rank++ });
  }
  return freq;
}

function buildFromSources({ srcDir, commonFreq = 40, sourceDateEpoch }) {
  const rejected = [];
  const clean = readClean(srcDir, rejected);
  const freq = readFreq(srcDir, rejected);

  // Валидационный словарь: все чистые леммы.
  const validList = [...clean].sort();

  // Common: чистые леммы, подтверждённые частотой, без служебных, по убыванию частоты.
  const MERGED = /^(что|кто|как|где|когда|куда|откуда|почему|зачем|какой|какая|какое|какие|чей|сколько|каков)(то|нибудь|либо)$|^кое(что|как|где|кто|когда|чем|кому|кого|какой)$/;
  const commonRanked = [];
  for (const w of clean) {
    const info = freq.get(w);
    if (!info || info.f < commonFreq) continue;
    if (FUNCTION_WORDS.has(w)) continue;
    if (MERGED.test(w)) continue;
    commonRanked.push([w, info.f]);
  }
  commonRanked.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const common = commonRanked.map(([w]) => w);

  const byLen = (arr) => {
    const h = {};
    for (const w of arr) h[w.length] = (h[w.length] || 0) + 1;
    return h;
  };
  const meta = {
    builtAt: sourceDateEpoch ? new Date(Number(sourceDateEpoch) * 1000).toISOString() : null,
    commonFreq,
    validCount: validList.length,
    commonCount: common.length,
    validByLen: byLen(validList),
    commonByLen: byLen(common),
    sources: ['Badestrand/russian-dictionary (Wiktionary)', 'hermitdave/FrequencyWords ru 2018'],
    rejectedTokenCount: rejected.length,
  };
  const blocked = [...PROFANITY_EXACT]
    .map((word) => ({ word, reason: 'profanity' }))
    .concat([...new Set([...FUNCTION_WORDS].filter((word) => word.length >= MIN_LEN && word.length <= MAX_LEN))]
      .map((word) => ({ word, reason: 'low_quality' })))
    .sort((a, b) => a.word.localeCompare(b.word));
  return { valid: validList, common, blocked, meta, rejected };
}

function verifySourcesLock(srcDir, lockPath) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.files) || !lock.files.length) {
    throw new Error(`Invalid sources lock: ${lockPath}`);
  }
  for (const source of lock.files) {
    if (!source.path || !/^[a-f0-9]{64}$/.test(source.sha256 || '') || !source.url || !source.ref || !source.license) {
      throw new Error(`Incomplete pinned source entry: ${JSON.stringify(source)}`);
    }
    const file = path.join(srcDir, source.path);
    if (!fs.existsSync(file)) throw new Error(`Pinned source is missing: ${file}`);
    const actual = sha256(fs.readFileSync(file));
    if (actual !== source.sha256) throw new Error(`Checksum mismatch for ${source.path}: expected ${source.sha256}, got ${actual}`);
  }
  return lock;
}

module.exports = { normalize, normalizeStrict, filterWords, buildFromSources, verifySourcesLock, MIN_LEN, MAX_LEN };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const srcDir = get('--src', path.join(__dirname, '..', '.dict-sources'));
  const lockPath = get('--sources-lock', path.join(__dirname, '..', 'assets', 'dict', 'sources.lock.json'));
  const commonFreq = parseInt(get('--common-freq', '40'), 10);
  if (!fs.existsSync(path.join(srcDir, 'nouns.csv'))) {
    console.error(`Не найдены источники в ${srcDir}. См. docs/runbooks/dictionary-sources.md`);
    process.exit(1);
  }
  if (!process.env.SOURCE_DATE_EPOCH) {
    console.error('SOURCE_DATE_EPOCH is required; use a pinned source retrieval timestamp.');
    process.exit(1);
  }
  try {
    verifySourcesLock(srcDir, lockPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const { valid, common, blocked, meta, rejected } = buildFromSources({ srcDir, commonFreq, sourceDateEpoch: process.env.SOURCE_DATE_EPOCH });
  const outDir = path.join(__dirname, '..', 'assets', 'dict');
  fs.mkdirSync(outDir, { recursive: true });
  meta.hashes = { ru: sha256(JSON.stringify(valid)), common: sha256(JSON.stringify(common)), blocked: sha256(JSON.stringify(blocked)) };
  writeJsonAtomic(path.join(outDir, 'ru.json'), valid);
  writeJsonAtomic(path.join(outDir, 'ru-common.json'), common);
  writeJsonAtomic(path.join(outDir, 'ru-blocked.json'), blocked);
  writeJsonAtomic(path.join(outDir, 'ru.meta.json'), meta);
  if (rejected.length) writeJsonAtomic(path.join(outDir, 'rejected-tokens.json'), rejected);
  console.log(`Словарь: valid=${meta.validCount}, common=${meta.commonCount}`);
  console.log('validByLen:', JSON.stringify(meta.validByLen));
  console.log('commonByLen:', JSON.stringify(meta.commonByLen));
}
