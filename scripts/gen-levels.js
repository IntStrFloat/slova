/**
 * Генератор уровней (спека 03/19). Детерминированно строит связные компактные
 * кроссворды из словарей build-dictionary:
 *   - слова-ОТВЕТЫ берутся из common-словаря (узнаваемые слова);
 *   - bonusPool — из валидационного словаря (любое реальное слово), частотный,
 *     с ограничением по количеству;
 *   - размер диска растёт с прогрессом (4→7) → кривая сложности;
 *   - базовые слова не повторяются между уровнями/мирами (разнообразие).
 *
 * CLI: node scripts/gen-levels.js            (все миры из WORLDS_PLAN)
 *      node scripts/gen-levels.js --world world1 --count 90
 */
const fs = require('node:fs');
const path = require('node:path');

const ALPHABET = 'абвгдежзийклмнопрстуфхцчшщъыьэюя'; // 32 буквы (ё→е на этапе словаря)
const IDX = {};
[...ALPHABET].forEach((c, i) => (IDX[c] = i));

function maskOf(w) {
  let m = 0;
  for (const c of w) {
    const i = IDX[c];
    if (i === undefined) return -1;
    m |= 1 << i;
  }
  return m;
}
const ALPHA_N = ALPHABET.length; // 32 (рус. алфавит без ё)
function countsOf(w) {
  const a = new Int8Array(ALPHA_N);
  for (const c of w) a[IDX[c]]++;
  return a;
}
function fitsCounts(wc, dc) {
  for (let i = 0; i < ALPHA_N; i++) if (wc[i] > dc[i]) return false;
  return true;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (c) => `${c.row},${c.col}`;

const VOWELS = new Set([... 'аеёиоуыэюя']);
const ROOT_ENDINGS = [
  'иями', 'ями', 'ами', 'его', 'ого', 'ему', 'ому', 'ими', 'ыми', 'ала', 'ила', 'ыла',
  'али', 'или', 'ыли', 'ает', 'яет', 'ают', 'яют', 'ить', 'ать', 'ять', 'ешь', 'ишь',
  'ого', 'ему', 'ее', 'ие', 'ые', 'ой', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ам',
  'ям', 'ах', 'ях', 'ом', 'ем', 'ою', 'ею', 'ов', 'ев', 'ей', 'ия', 'ья', 'ла',
  'ли', 'ет', 'ит', 'ют', 'ут', 'ат', 'ят', 'ал', 'ил', 'ыл', 'ой', 'ий', 'ый',
  'ая', 'яя', 'ое', 'ую', 'юю', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о',
];

function rootStem(word) {
  let w = String(word);
  for (const ending of ROOT_ENDINGS) {
    if (w.length - ending.length >= 3 && w.endsWith(ending)) {
      w = w.slice(0, -ending.length);
      break;
    }
  }
  return w;
}

function consonantSkeleton(word) {
  return [...word].filter((ch) => !VOWELS.has(ch) && ch !== 'ь' && ch !== 'ъ').join('');
}

function commonPrefixLen(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Практический фильтр "одной основы" для word-connect уровней.
 * Покрывает самые заметные для игрока случаи: дом/дома, жук/жука, бил/убил,
 * глаз/глаза, один/одни. Это намеренно консервативный эвристический фильтр,
 * а не академический морфоразбор корня.
 */
function sameRoot(a, b) {
  if (a === b) return true;
  const min = a.length <= b.length ? a : b;
  const max = a.length > b.length ? a : b;
  if (min.length >= 3 && max.includes(min)) return true;

  const sa = rootStem(a);
  const sb = rootStem(b);
  if (sa.length >= 3 && sb.length >= 3 && sa === sb) return true;

  const ca = consonantSkeleton(a);
  const cb = consonantSkeleton(b);
  return ca.length >= 2 && ca === cb && commonPrefixLen(a, b) >= 2;
}

function conflictsWithAny(word, words) {
  return words.some((other) => sameRoot(word, other));
}

function rootConflicts(words) {
  const conflicts = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      if (sameRoot(words[i], words[j])) conflicts.push([words[i], words[j]]);
    }
  }
  return conflicts;
}

/** Жадная укладка кроссворда: первое слово — горизонтально, остальные — крест-накрест. */
function placeCrossword(answerWords, maxWords) {
  const occupied = new Map();
  const placed = [];
  const occ = (r, c) => occupied.get(`${r},${c}`);
  // Укладка слова с запретом «касаний»: два разных слова могут делить только
  // реальную клетку-пересечение. Иначе они визуально слипаются в один ряд
  // (напр. «пот» вертикально + «топ» горизонтально → «ТТОП»).
  //  - клетки сразу перед началом и после конца (вдоль слова) должны быть пусты;
  //  - у каждой НЕ-пересекающейся клетки перпендикулярные соседи должны быть пусты.
  const tryPlace = (word, dir, row, col) => {
    const dr = dir === 'V' ? 1 : 0; // шаг вдоль слова
    const dc = dir === 'H' ? 1 : 0;
    if (occ(row - dr, col - dc)) return null; // примыкание к концу другого слова
    if (occ(row + dr * word.length, col + dc * word.length)) return null;
    const cells = [];
    for (let i = 0; i < word.length; i++) {
      const rr = row + dr * i;
      const cc = col + dc * i;
      const ex = occ(rr, cc);
      if (ex) {
        if (ex !== word[i]) return null; // конфликт буквы
      } else if (occ(rr + dc, cc + dr) || occ(rr - dc, cc - dr)) {
        return null; // параллельное касание соседнего слова (перпенд. соседи)
      }
      cells.push({ row: rr, col: cc, ch: word[i] });
    }
    return cells;
  };
  const commit = (word, dir, cells) => {
    for (const c of cells) occupied.set(`${c.row},${c.col}`, c.ch);
    placed.push({ word, dir, cells });
  };

  const first = answerWords[0];
  commit(first, 'H', tryPlace(first, 'H', 0, 0));

  for (const w of answerWords.slice(1)) {
    if (placed.length >= maxWords) break;
    if (placed.some((p) => p.word === w)) continue;
    if (conflictsWithAny(w, placed.map((p) => p.word))) continue;
    let done = false;
    for (const p of placed) {
      if (done) break;
      for (let i = 0; i < p.cells.length && !done; i++) {
        const anchor = p.cells[i];
        for (let j = 0; j < w.length && !done; j++) {
          if (w[j] !== anchor.ch) continue;
          const dir = p.dir === 'H' ? 'V' : 'H';
          const row = dir === 'V' ? anchor.row - j : anchor.row;
          const col = dir === 'V' ? anchor.col : anchor.col - j;
          if (row < 0 || col < 0) continue;
          const cells = tryPlace(w, dir, row, col);
          if (cells) {
            commit(w, dir, cells);
            done = true;
          }
        }
      }
    }
  }
  if (placed.length < 2) return null;

  const all = placed.flatMap((p) => p.cells);
  const minR = Math.min(...all.map((c) => c.row));
  const minC = Math.min(...all.map((c) => c.col));
  const norm = (cells) => cells.map((c) => ({ row: c.row - minR, col: c.col - minC, ch: c.ch }));
  const answers = placed.map((p) => ({ word: p.word, dir: p.dir, cells: norm(p.cells) }));
  const cellMap = new Map();
  for (const a of answers) for (const c of a.cells) cellMap.set(key(c), c);
  const cells = [...cellMap.values()];
  const rows = Math.max(...cells.map((c) => c.row)) + 1;
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  return { answers, grid: { rows, cols, cells } };
}

function validate(level) {
  const covered = new Set();
  for (const a of level.answers) {
    if (a.cells.length !== a.word.length) return false;
    for (let i = 0; i < a.cells.length; i++) if (a.cells[i].ch !== a.word[i]) return false;
    for (const c of a.cells) covered.add(key(c));
  }
  for (const c of level.grid.cells) if (!covered.has(key(c))) return false;
  const answerSet = new Set(level.answers.map((a) => a.word));
  for (const b of level.bonusPool) if (answerSet.has(b)) return false;
  return true;
}

/**
 * Построить уровень из базового слова.
 * @param dicts { commonEntries:[{w,mask,len}], validEntries:[{w,mask}] }
 */
function buildLevel({ id, world, base, dicts, seed, maxAnswers, maxBonus }) {
  const letters = [...base];
  const diskMask = maskOf(base);
  const diskCounts = countsOf(base);

  // Кандидаты-ответы: common-слова (узнаваемые), собираемые из диска, длина 3..N.
  const answerCands = [];
  for (const e of dicts.commonEntries) {
    if (e.len < 3 || e.len > letters.length) continue;
    if ((e.mask & ~diskMask) !== 0) continue;
    if (!fitsCounts(countsOf(e.w), diskCounts)) continue;
    answerCands.push(e.w);
  }
  // длиннее и популярнее — раньше (commonEntries уже в порядке частоты)
  answerCands.sort((a, b) => b.length - a.length);
  if (!answerCands.length || answerCands[0] !== base) {
    // гарантируем, что базовое слово — первое (самое длинное, оно есть среди кандидатов)
    const i = answerCands.indexOf(base);
    if (i > 0) {
      answerCands.splice(i, 1);
      answerCands.unshift(base);
    } else if (i < 0) {
      answerCands.unshift(base);
    }
  }

  const built = placeCrossword(answerCands, maxAnswers);
  if (!built) return null;

  const answerSet = new Set(built.answers.map((a) => a.word));

  // bonusPool: валидные слова из диска, не среди ответов, частотные, с лимитом.
  const bonusCandidates = [];
  const answerWords = [...answerSet];
  for (const e of dicts.validEntries) {
    if (e.len < 3 || e.len > letters.length) continue;
    if (answerSet.has(e.w)) continue;
    if ((e.mask & ~diskMask) !== 0) continue;
    if (!fitsCounts(countsOf(e.w), diskCounts)) continue;
    if (conflictsWithAny(e.w, answerWords)) continue;
    bonusCandidates.push(e.w);
  }
  // приоритет узнаваемым: сначала те, что в common (по частоте), затем по длине
  const commonRank = dicts.commonRank;
  bonusCandidates.sort((a, b) => {
    const ra = commonRank.has(a) ? commonRank.get(a) : Number.MAX_SAFE_INTEGER;
    const rb = commonRank.has(b) ? commonRank.get(b) : Number.MAX_SAFE_INTEGER;
    return ra - rb || b.length - a.length || a.localeCompare(b);
  });
  const bonusPool = [];
  const levelWords = [...answerWords];
  for (const w of bonusCandidates) {
    if (conflictsWithAny(w, levelWords)) continue;
    bonusPool.push(w);
    levelWords.push(w);
    if (bonusPool.length >= maxBonus) break;
  }

  // детерминированное перемешивание букв диска
  const r = rng(seed);
  const disk = [...letters];
  for (let i = disk.length - 1; i > 0; i--) {
    const k = Math.floor(r() * (i + 1));
    [disk[i], disk[k]] = [disk[k], disk[i]];
  }

  const difficulty = 1 + Math.min(4, Math.floor((letters.length - 4)));
  const level = { id, world, letters: disk, grid: built.grid, answers: built.answers, bonusPool, difficulty };
  return validate(level) ? level : null;
}

/** Размер диска по позиции в мире (кривая сложности 4→7). */
function diskSizeFor(i, count) {
  const t = i / Math.max(1, count - 1);
  if (t < 0.18) return 4;
  if (t < 0.42) return 5;
  if (t < 0.72) return 6;
  return 7;
}

function generateWorld({ world, count, dicts, used, maxBonus }) {
  // индекс common-слов по длине (порядок частоты сохранён)
  const byLen = new Map();
  for (const e of dicts.commonEntries) {
    if (!byLen.has(e.len)) byLen.set(e.len, []);
    byLen.get(e.len).push(e.w);
  }
  const cursor = new Map(); // длина → позиция курсора в частотном списке
  const levels = [];
  let seed = (hashStr(world) >>> 0) + 1;
  // Минимум слов-ответов по размеру диска — отсекаем «бедные» уровни.
  const minAns = (s) => (s >= 6 ? 4 : s >= 5 ? 3 : 2);
  if (world === 'world1' && count > 0) {
    levels.push(tutorialLevel());
    used.add('сон');
    used.add('нос');
  }

  for (let i = levels.length; i < count; i++) {
    const size = diskSizeFor(i, count);
    const pool = byLen.get(size) || [];
    const want = minAns(size);
    let made = null;
    let fallback = null; // лучший виденный, если идеального нет
    let c = cursor.get(size) || 0;
    let tries = 0;
    while (c < pool.length && !made && tries < 300) {
      const base = pool[c++];
      if (used.has(base)) continue;
      tries++;
      const lvl = buildLevel({
        id: levels.length + 1,
        world,
        base,
        dicts,
        seed: seed + i,
        maxAnswers: Math.min(size, 6),
        maxBonus,
      });
      if (!lvl || lvl.answers.length < 2) continue;
      const rich = lvl.answers.length + lvl.bonusPool.length;
      if (lvl.answers.length >= want && rich >= 5) {
        used.add(base);
        made = lvl;
      } else if (!fallback || lvl.answers.length + lvl.bonusPool.length > fallback._rich) {
        lvl._rich = rich;
        fallback = lvl;
        fallback._base = base;
      }
    }
    cursor.set(size, c);
    const chosen = made || fallback;
    if (chosen) {
      if (!made && chosen._base) used.add(chosen._base);
      delete chosen._rich;
      delete chosen._base;
      levels.push(chosen);
    }
  }
  return { world, levels };
}

function tutorialLevel() {
  return {
    id: 1,
    world: 'world1',
    letters: ['с', 'о', 'н'],
    grid: {
      rows: 3,
      cols: 3,
      cells: [
        { row: 0, col: 0, ch: 'с' },
        { row: 0, col: 1, ch: 'о' },
        { row: 0, col: 2, ch: 'н' },
        { row: 1, col: 2, ch: 'о' },
        { row: 2, col: 2, ch: 'с' },
      ],
    },
    answers: [
      {
        word: 'сон',
        dir: 'H',
        cells: [
          { row: 0, col: 0, ch: 'с' },
          { row: 0, col: 1, ch: 'о' },
          { row: 0, col: 2, ch: 'н' },
        ],
      },
      {
        word: 'нос',
        dir: 'V',
        cells: [
          { row: 0, col: 2, ch: 'н' },
          { row: 1, col: 2, ch: 'о' },
          { row: 2, col: 2, ch: 'с' },
        ],
      },
    ],
    bonusPool: [],
    difficulty: 1,
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}

function loadDicts() {
  const dictDir = path.join(__dirname, '..', 'assets', 'dict');
  const valid = JSON.parse(fs.readFileSync(path.join(dictDir, 'ru.json'), 'utf8'));
  const common = JSON.parse(fs.readFileSync(path.join(dictDir, 'ru-common.json'), 'utf8'));
  const commonEntries = common.map((w) => ({ w, mask: maskOf(w), len: w.length }));
  const validEntries = valid.map((w) => ({ w, mask: maskOf(w), len: w.length }));
  const commonRank = new Map();
  common.forEach((w, i) => commonRank.set(w, i));
  return { commonEntries, validEntries, commonRank };
}

// План миров по умолчанию (фоны/темы уже есть: Париж/Нью-Йорк/Москва).
const WORLDS_PLAN = [
  { world: 'world1', count: 90 },
  { world: 'world2', count: 80 },
  { world: 'world3', count: 80 },
];

function writePack(pack) {
  const outDir = path.join(__dirname, '..', 'assets', 'levels');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${pack.world}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ world: pack.world, levels: pack.levels }));
  return outPath;
}

module.exports = {
  buildLevel,
  generateWorld,
  validate,
  placeCrossword,
  loadDicts,
  rootConflicts,
  sameRoot,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const maxBonus = parseInt(get('--max-bonus', '14'), 10);
  const dicts = loadDicts();
  const used = new Set();
  const oneWorld = get('--world', null);
  const plan = oneWorld
    ? [{ world: oneWorld, count: parseInt(get('--count', '80'), 10) }]
    : WORLDS_PLAN;
  for (const p of plan) {
    const pack = generateWorld({ world: p.world, count: p.count, dicts, used, maxBonus });
    const out = writePack(pack);
    const avgBonus = (
      pack.levels.reduce((s, l) => s + l.bonusPool.length, 0) / Math.max(1, pack.levels.length)
    ).toFixed(1);
    console.log(`${pack.world}: ${pack.levels.length} уровней, ср.bonus=${avgBonus} → ${out}`);
  }
}
