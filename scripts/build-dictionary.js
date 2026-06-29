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
const { FUNCTION_WORDS, isProfane } = require('./dict/stoplists');

/** Нормализация: нижний регистр, ё→е, снять ударение (') и любую не-кириллицу. */
function normalize(w) {
  return String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^а-я]/g, '');
}

/** Совместимость со старым API: фильтр длины + стоп-листа. */
function filterWords(words, { min = 3, max = 8, stop = [] } = {}) {
  const stopSet = new Set(stop.map(normalize));
  const out = new Set();
  for (const raw of words) {
    const w = normalize(raw);
    if (w.length >= min && w.length <= max && !stopSet.has(w) && !isProfane(w)) out.add(w);
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
function readLemmasFromCsv(file, into) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const tab = lines[i].indexOf('\t');
    const bare = tab < 0 ? lines[i] : lines[i].slice(0, tab);
    if (!bare) continue;
    for (const piece of bare.split(/[,;/]/)) {
      const w = normalize(piece);
      if (w.length >= MIN_LEN && w.length <= MAX_LEN && !isProfane(w)) into.add(w);
    }
  }
}

/** Чистый словарь лемм из всех источников-CSV + EXTRA. */
function readClean(srcDir) {
  const clean = new Set();
  for (const f of ['nouns.csv', 'adjectives.csv', 'verbs.csv']) {
    const p = path.join(srcDir, f);
    if (fs.existsSync(p)) readLemmasFromCsv(p, clean);
  }
  for (const w of EXTRA) {
    const n = normalize(w);
    if (n.length >= MIN_LEN && n.length <= MAX_LEN && !isProfane(n)) clean.add(n);
  }
  return clean;
}

/** Частотный список → Map<word,{f,rank}>. */
function readFreq(srcDir) {
  const text = fs.readFileSync(path.join(srcDir, 'ru_full.txt'), 'utf8');
  const freq = new Map();
  let rank = 0;
  for (const line of text.split(/\r?\n/)) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const w = normalize(line.slice(0, sp));
    const f = parseInt(line.slice(sp + 1), 10) || 0;
    if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
    if (!freq.has(w)) freq.set(w, { f, rank: rank++ });
  }
  return freq;
}

function buildFromSources({ srcDir, commonFreq = 40 }) {
  const clean = readClean(srcDir);
  const freq = readFreq(srcDir);

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
    builtAt: new Date().toISOString().slice(0, 10),
    commonFreq,
    validCount: validList.length,
    commonCount: common.length,
    validByLen: byLen(validList),
    commonByLen: byLen(common),
    sources: ['Badestrand/russian-dictionary (Wiktionary)', 'hermitdave/FrequencyWords ru 2018'],
  };
  return { valid: validList, common, meta };
}

module.exports = { normalize, filterWords, buildFromSources, MIN_LEN, MAX_LEN };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const srcDir = get('--src', path.join(__dirname, '..', '.dict-sources'));
  const commonFreq = parseInt(get('--common-freq', '40'), 10);
  if (!fs.existsSync(path.join(srcDir, 'nouns.csv'))) {
    console.error(`Не найдены источники в ${srcDir}. См. docs/runbooks/dictionary-sources.md`);
    process.exit(1);
  }
  const { valid, common, meta } = buildFromSources({ srcDir, commonFreq });
  const outDir = path.join(__dirname, '..', 'assets', 'dict');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ru.json'), JSON.stringify(valid));
  fs.writeFileSync(path.join(outDir, 'ru-common.json'), JSON.stringify(common));
  fs.writeFileSync(path.join(outDir, 'ru.meta.json'), JSON.stringify(meta, null, 2));
  console.log(`Словарь: valid=${meta.validCount}, common=${meta.commonCount}`);
  console.log('validByLen:', JSON.stringify(meta.validByLen));
  console.log('commonByLen:', JSON.stringify(meta.commonByLen));
}
