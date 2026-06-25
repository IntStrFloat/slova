/**
 * Генератор уровней (спека 03): из словаря детерминированно строит связный
 * компактный кроссворд. Жадная укладка: длинное слово горизонтально, остальные —
 * вертикально через общую букву. Валидирует инварианты и пишет пак мира.
 *
 * CLI: node scripts/gen-levels.js --world world1 --count 30
 */
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('./build-dictionary');

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

function canBuild(word, letters) {
  const p = new Map();
  for (const l of letters) p.set(l, (p.get(l) || 0) + 1);
  for (const ch of word) {
    const n = p.get(ch) || 0;
    if (!n) return false;
    p.set(ch, n - 1);
  }
  return true;
}

function validate(level) {
  const key = (c) => `${c.row},${c.col}`;
  const covered = new Set();
  for (const a of level.answers) {
    if (!canBuild(a.word, level.letters)) return false;
    if (a.cells.length !== a.word.length) return false;
    for (let i = 0; i < a.cells.length; i++) if (a.cells[i].ch !== a.word[i]) return false;
    for (const c of a.cells) covered.add(key(c));
  }
  for (const c of level.grid.cells) if (!covered.has(key(c))) return false;
  return true;
}

/** Построить один уровень из набора букв и словаря. Возвращает Level | null. */
function generateLevel({ seed, dict, letters }) {
  const L = letters.map(normalize);
  const words = [...new Set(dict.map(normalize))]
    .filter((w) => w.length >= 3 && canBuild(w, L))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (words.length === 0) return null;

  const occupied = new Map();
  const placed = [];
  const tryPlace = (word, dir, row, col) => {
    const cells = [];
    for (let i = 0; i < word.length; i++) {
      const rr = dir === 'H' ? row : row + i;
      const cc = dir === 'H' ? col + i : col;
      const ex = occupied.get(`${rr},${cc}`);
      if (ex && ex !== word[i]) return null;
      cells.push({ row: rr, col: cc, ch: word[i] });
    }
    return cells;
  };
  const commit = (word, dir, cells) => {
    for (const c of cells) occupied.set(`${c.row},${c.col}`, c.ch);
    placed.push({ word, dir, cells });
  };

  const first = words[0];
  commit(first, 'H', tryPlace(first, 'H', 0, 0));

  for (const w of words.slice(1)) {
    if (placed.length >= 6) break;
    if (placed.some((p) => p.word === w)) continue;
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

  if (placed.length < 2) return null; // слишком бедный уровень

  const allCells = placed.flatMap((p) => p.cells);
  const minR = Math.min(...allCells.map((c) => c.row));
  const minC = Math.min(...allCells.map((c) => c.col));
  const norm = (cells) => cells.map((c) => ({ row: c.row - minR, col: c.col - minC, ch: c.ch }));
  const answers = placed.map((p) => ({ word: p.word, dir: p.dir, cells: norm(p.cells) }));

  const cellMap = new Map();
  for (const a of answers) for (const c of a.cells) cellMap.set(`${c.row},${c.col}`, c);
  const cells = [...cellMap.values()];
  const rows = Math.max(...cells.map((c) => c.row)) + 1;
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  const answerSet = new Set(answers.map((a) => a.word));
  const bonusPool = words.filter((w) => !answerSet.has(w));

  // перемешать буквы диска детерминированно
  const r = rng(seed);
  const disk = [...L];
  for (let i = disk.length - 1; i > 0; i--) {
    const k = Math.floor(r() * (i + 1));
    [disk[i], disk[k]] = [disk[k], disk[i]];
  }

  return { id: seed, world: 'world1', letters: disk, grid: { rows, cols, cells }, answers, bonusPool, difficulty: 1 };
}

function generatePack({ world, count, dict }) {
  // базовые слова с растущей длиной → растущая сложность
  const bases = [...new Set(dict.map(normalize))]
    .filter((w) => w.length >= 4 && w.length <= 7)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const levels = [];
  let seed = 1;
  for (const base of bases) {
    if (levels.length >= count) break;
    const lvl = generateLevel({ seed, dict, letters: base.split('') });
    if (lvl && validate(lvl)) {
      lvl.id = levels.length + 1;
      lvl.world = world;
      lvl.difficulty = 1 + Math.floor(levels.length / 10);
      levels.push(lvl);
    }
    seed += 1;
  }
  return { world, levels };
}

module.exports = { generateLevel, generatePack, validate };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const world = get('--world', 'world1');
  const count = parseInt(get('--count', '30'), 10);
  const dictPath = path.join(__dirname, '..', 'assets', 'dict', 'ru.json');
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  const pack = generatePack({ world, count, dict });
  const outDir = path.join(__dirname, '..', 'assets', 'levels');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${world}.json`);
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 0));
  console.log(`Сгенерировано ${pack.levels.length} уровней → ${outPath}`);
}
