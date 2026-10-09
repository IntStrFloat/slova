const fs = require('node:fs');
const path = require('node:path');
const { FUNCTION_WORDS, isLowQualityWord, isProfane } = require('./dict/stoplists');
const { BLOCK_REASONS, canonicalHash, generatedAtFromEnv, isConstructible, normalizeToken, readJson, sha256, writeJsonAtomic } = require('./dict/content');

const ALPHABET = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
const IDX = {};
[...ALPHABET].forEach((char, index) => {
  IDX[char] = index;
});

const VOWELS = new Set(['а', 'е', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я']);
const MAX_ACCEPTED_BONUS = 14;
const REPEAT_CAP = 3;
const PRESERVED_LEVELS = 500;
const EARLY_ROUTE_POLICY = require('../assets/content/early-route-policy.json');
const EXTENSION_GRID_LIMITS = { rows: 9, cols: 10 };
const EXTENSION_BLOCKED = Object.entries(require('../assets/content/extension-blocked.json'))
  .flatMap(([reason, words]) => words.map((word) => ({ word, reason })));
const WORLD_SPECS = [
  { world: 'world1', count: 90, globalOffset: 0 },
  { world: 'world2', count: 80, globalOffset: 90 },
  { world: 'world3', count: 80, globalOffset: 170 },
  { world: 'world4', count: 60, globalOffset: 250 },
  { world: 'world5', count: 60, globalOffset: 310 },
  { world: 'world6', count: 60, globalOffset: 370 },
  { world: 'world7', count: 70, globalOffset: 430 },
  { world: 'world8', count: 90, globalOffset: 500 },
  { world: 'world9', count: 80, globalOffset: 590 },
  { world: 'world10', count: 80, globalOffset: 670 },
  { world: 'world11', count: 60, globalOffset: 750 },
  { world: 'world12', count: 60, globalOffset: 810 },
  { world: 'world13', count: 60, globalOffset: 870 },
  { world: 'world14', count: 70, globalOffset: 930 },
];
const TOTAL_LEVELS = WORLD_SPECS.reduce((sum, spec) => sum + spec.count, 0);
const WORLD_FINALES = new Map(WORLD_SPECS.map((spec) => [spec.globalOffset + spec.count, spec.world]));
const LANDMARK_LEVELS = new Set([45, 125, 205, 285, 365, 445, 545, 625, 705, 785, 865, 945]);
const ORDERED_LEVELS = new Set([75, 145, 225, 305, 385, 465, 575, 645, 725, 805, 885, 965]);
const MASTERY_LEVELS = new Set([210, 290, 350, 410, 490, 710, 790, 850, 910, 990]);
const CURATED_EARLY_BASES = {
  ...Object.fromEntries(Object.entries(EARLY_ROUTE_POLICY.levels).map(([level, policy]) => [level, policy.base])),
  11: 'вина',
  12: 'долг',
  13: 'рост',
  14: 'окно',
  15: 'угол',
  16: 'мост',
  17: 'трон',
  18: 'крот',
  19: 'план',
  20: 'гроб',
  21: 'вино',
  22: 'ядро',
  23: 'блок',
  24: 'след',
  25: 'гром',
  26: 'порт',
  27: 'кора',
  28: 'танк',
  29: 'взор',
  30: 'евро',
};
const CURATED_EARLY_ANSWERS = {
  ...Object.fromEntries(Object.entries(EARLY_ROUTE_POLICY.levels).map(([level, policy]) => [level, policy.answers])),
  11: ['вина', 'нива'],
  12: ['долг', 'год', 'дог'],
  13: ['рост', 'сорт', 'трос'],
  14: ['окно', 'око'],
  15: ['угол', 'гул', 'луг'],
  16: ['мост', 'сом'],
  17: ['трон', 'рот', 'тон'],
  18: ['крот', 'кот', 'ток'],
  19: ['план', 'пан'],
  20: ['гроб', 'горб', 'бог', 'бор'],
  21: ['вино', 'воин'],
  22: ['ядро', 'ряд', 'род'],
  23: ['блок', 'бок', 'кол'],
  24: ['след', 'лес'],
  25: ['гром', 'морг', 'рог'],
  26: ['порт', 'пот'],
  27: ['кора', 'рак', 'рок'],
  28: ['танк', 'кант', 'акт'],
  29: ['взор', 'вор'],
  30: ['евро', 'вор', 'рев'],
};
const CURATED_EARLY_BONUS = {
  ...Object.fromEntries(Object.entries(EARLY_ROUTE_POLICY.levels).map(([level, policy]) => [level, policy.bonus])),
  11: [],
  12: ['гол'],
  13: ['рот', 'торс'],
  14: [],
  15: [],
  16: ['том'],
  17: [],
  18: ['рок'],
  19: [],
  20: ['рог'],
  21: ['ион'],
  22: ['ярд', 'дояр'],
  23: ['лоб'],
  24: [],
  25: [],
  26: ['троп', 'опт'],
  27: [],
  28: [],
  29: ['ров', 'зов', 'воз'],
  30: ['ров'],
};
const CURATED_FINALE_BASE_OPTIONS = {
  90: ['память'],
  170: ['уровень'],
  250: ['команда'],
  310: ['вариант'],
  370: ['наследие'],
  430: ['праздник'],
  500: ['горизонт'],
  590: ['конспект'],
  670: ['ликовать'],
  750: ['колымага'],
  810: ['винтовка'],
  870: ['почитать'],
  930: ['подлодка'],
  1000: ['бордовый'],
};
const CURATED_FINALE_ANSWERS = {
  90: ['память', 'мать', 'тьма', 'мята', 'яма'],
  170: ['уровень', 'нерв', 'урон', 'врун', 'руно'],
  250: ['команда', 'дама', 'кода', 'мода', 'мак'],
  310: ['вариант', 'тина', 'врата', 'трава', 'нрав'],
  370: ['наследие', 'седина', 'надел', 'идеал', 'длина', 'сила'],
  430: ['праздник', 'признак', 'каприз', 'карниз', 'парик'],
  500: ['горизонт', 'торги', 'орион', 'тигр', 'ринг', 'итог'],
  590: ['конспект', 'песок', 'отсек', 'конек', 'сонет', 'кокс'],
  670: ['ликовать', 'ловить', 'валить', 'кивать', 'вольт', 'тальк'],
  750: ['колымага', 'ломка', 'малка', 'гамак', 'мыло', 'лама'],
  810: ['винтовка', 'виконт', 'аконит', 'квинта', 'тоника', 'актив'],
  870: ['почитать', 'питать', 'топать', 'точить', 'почта', 'чтить'],
  930: ['подлодка', 'доклад', 'колода', 'полка', 'подол'],
  1000: ['бордовый', 'добро', 'выбор', 'обрыв', 'боров', 'роды'],
};
const CURATED_FINALE_BASES = Object.fromEntries(
  Object.entries(CURATED_FINALE_BASE_OPTIONS).map(([level, bases]) => [level, bases[0]])
);
const RESERVED_BASE_LEVELS = new Map([
  ...Object.entries(CURATED_EARLY_BASES).map(([level, base]) => [base, Number(level)]),
  ...Object.entries(CURATED_FINALE_BASE_OPTIONS).flatMap(([level, bases]) => bases.map((base) => [base, Number(level)])),
]);
const RESERVED_ANSWER_LEVELS = new Map(
  Object.entries(CURATED_FINALE_ANSWERS)
    .flatMap(([level, answers]) => answers.map((word) => [word, Number(level)])),
);
const ROOT_ENDINGS = [
  'иями', 'ями', 'ами', 'его', 'ого', 'ему', 'ому', 'ими', 'ыми', 'ала', 'ила', 'ыла',
  'али', 'или', 'ыли', 'ает', 'яет', 'ают', 'яют', 'ить', 'ать', 'ять', 'ешь', 'ишь',
  'ее', 'ие', 'ые', 'ой', 'ий', 'ый', 'ая', 'яя', 'ое', 'ам', 'ям', 'ах', 'ях', 'ом',
  'ем', 'ою', 'ею', 'ов', 'ев', 'ей', 'ия', 'ья', 'ла', 'ли', 'ет', 'ит', 'ют', 'ут',
  'ат', 'ят', 'ал', 'ил', 'ыл', 'ую', 'юю', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о',
];
const ROLE_BANDS = {
  easy: { 3: [2, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [4, 5], 8: [4, 5] },
  baseline: { 3: [2, 2], 4: [3, 3], 5: [3, 4], 6: [4, 5], 7: [4, 5], 8: [4, 5] },
  hard: { 3: [2, 2], 4: [3, 4], 5: [4, 5], 6: [5, 6], 7: [5, 6], 8: [5, 6] },
  breather: { 3: [2, 2], 4: [2, 2], 5: [3, 3], 6: [4, 4], 7: [4, 4], 8: [4, 4] },
  climax: { 3: [2, 2], 4: [3, 4], 5: [4, 5], 6: [5, 6], 7: [5, 6], 8: [5, 6] },
};
const ROLE_SCORE_BONUS = { easy: 0, baseline: 2, hard: 6, breather: -4, climax: 8 };

function maskOf(word) {
  let mask = 0;
  for (const char of word) {
    const index = IDX[char];
    if (index === undefined) return -1;
    mask |= 1 << index;
  }
  return mask;
}

function countsOf(word) {
  const counts = new Int8Array(ALPHABET.length);
  for (const char of word) counts[IDX[char]] += 1;
  return counts;
}

function fitsCounts(wordCounts, diskCounts) {
  for (let index = 0; index < ALPHABET.length; index += 1) {
    if (wordCounts[index] > diskCounts[index]) return false;
  }
  return true;
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellKey(cell) {
  return `${cell.row},${cell.col}`;
}

function hashStr(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash;
}

function rootStem(word) {
  let stem = String(word);
  for (const ending of ROOT_ENDINGS) {
    if (stem.length - ending.length >= 3 && stem.endsWith(ending)) {
      stem = stem.slice(0, -ending.length);
      break;
    }
  }
  return stem;
}

function consonantSkeleton(word) {
  return [...word].filter((char) => !VOWELS.has(char) && char !== 'ь' && char !== 'ъ').join('');
}

function commonPrefixLen(a, b) {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function sameRoot(a, b) {
  if (a === b) return true;
  const min = a.length <= b.length ? a : b;
  const max = a.length > b.length ? a : b;
  if (min.length >= 3 && max.includes(min)) return true;

  const stemA = rootStem(a);
  const stemB = rootStem(b);
  if (stemA.length >= 3 && stemB.length >= 3 && stemA === stemB) return true;

  const consonantsA = consonantSkeleton(a);
  const consonantsB = consonantSkeleton(b);
  return consonantsA.length >= 2 && consonantsA === consonantsB && commonPrefixLen(a, b) >= 2;
}

function conflictsWithAny(word, words) {
  return words.some((other) => sameRoot(word, other));
}

function rootConflicts(words) {
  const conflicts = [];
  for (let left = 0; left < words.length; left += 1) {
    for (let right = left + 1; right < words.length; right += 1) {
      if (sameRoot(words[left], words[right])) conflicts.push([words[left], words[right]]);
    }
  }
  return conflicts;
}

function roleBand(size, role) {
  return ROLE_BANDS[role][size];
}

function diskSizeFor(globalId) {
  if (EARLY_ROUTE_POLICY.levels[globalId]) return EARLY_ROUTE_POLICY.levels[globalId].base.length;
  if (globalId === 1) return 3;
  if (globalId <= 30) return 4;
  if (globalId <= 80) return 5;
  if (globalId <= 150) return 6;
  if (globalId <= 350) return 7;
  return 8;
}

function difficultyRoleFor(globalId) {
  if (globalId <= EARLY_ROUTE_POLICY.throughLevel) return 'easy';
  return ['easy', 'baseline', 'hard', 'breather', 'climax'][(globalId - 1) % 5];
}

function milestoneFor(globalId) {
  // Keep the released first-route finale immutable for saved games and rewards.
  if (globalId === PRESERVED_LEVELS || globalId === TOTAL_LEVELS) return 'journey_finale';
  if (WORLD_FINALES.has(globalId)) return 'world_finale';
  if (LANDMARK_LEVELS.has(globalId)) return 'landmark';
  if (globalId % 10 === 0) return 'chest';
  return null;
}

function mechanicFor(globalId) {
  // Early bonus words teach an optional reward, never an extra win condition.
  if (globalId <= EARLY_ROUTE_POLICY.throughLevel) return 'classic';
  if (WORLD_FINALES.has(globalId)) return 'classic';
  if (MASTERY_LEVELS.has(globalId)) return 'mastery';
  if (ORDERED_LEVELS.has(globalId)) return 'ordered';
  if (globalId % 10 === 0) return 'bonus_chest';
  return 'classic';
}

function levelFingerprintPayload(level) {
  return {
    id: level.id,
    globalId: level.globalId,
    world: level.world,
    letters: level.letters,
    grid: level.grid,
    answers: level.answers,
    acceptedBonus: level.acceptedBonus,
    rewardedBonus: level.rewardedBonus,
    blockedPool: level.blockedPool,
    difficultyTier: level.difficultyTier,
    difficultyScore: level.difficultyScore,
    difficultyRole: level.difficultyRole,
    mechanic: level.mechanic,
    milestone: level.milestone,
    bonusTarget: level.bonusTarget ?? null,
    answerOrder: level.answerOrder ?? null,
  };
}

function puzzleSignature(level) {
  return canonicalHash({
    letters: [...level.letters].sort(),
    answers: level.answers.map((answer) => answer.word).sort(),
  });
}

function placeCrossword(answerWords, maxWords) {
  const occupied = new Map();
  const placed = [];
  const occ = (row, col) => occupied.get(`${row},${col}`);

  const tryPlace = (word, dir, row, col) => {
    const dr = dir === 'V' ? 1 : 0;
    const dc = dir === 'H' ? 1 : 0;
    if (occ(row - dr, col - dc)) return null;
    if (occ(row + dr * word.length, col + dc * word.length)) return null;

    const cells = [];
    for (let index = 0; index < word.length; index += 1) {
      const rr = row + dr * index;
      const cc = col + dc * index;
      const existing = occ(rr, cc);
      if (existing) {
        if (existing !== word[index]) return null;
      } else if (occ(rr + dc, cc + dr) || occ(rr - dc, cc - dr)) {
        return null;
      }
      cells.push({ row: rr, col: cc, ch: word[index] });
    }
    return cells;
  };

  const commit = (word, dir, cells) => {
    for (const cell of cells) occupied.set(`${cell.row},${cell.col}`, cell.ch);
    placed.push({ word, dir, cells });
  };

  commit(answerWords[0], 'H', tryPlace(answerWords[0], 'H', 0, 0));

  for (const word of answerWords.slice(1)) {
    if (placed.length >= maxWords) break;
    if (placed.some((entry) => entry.word === word)) continue;
    if (conflictsWithAny(word, placed.map((entry) => entry.word))) continue;

    let done = false;
    for (const placedWord of placed) {
      if (done) break;
      for (let i = 0; i < placedWord.cells.length && !done; i += 1) {
        const anchor = placedWord.cells[i];
        for (let j = 0; j < word.length && !done; j += 1) {
          if (word[j] !== anchor.ch) continue;
          const dir = placedWord.dir === 'H' ? 'V' : 'H';
          const row = dir === 'V' ? anchor.row - j : anchor.row;
          const col = dir === 'V' ? anchor.col : anchor.col - j;
          if (row < 0 || col < 0) continue;
          const cells = tryPlace(word, dir, row, col);
          if (cells) {
            commit(word, dir, cells);
            done = true;
          }
        }
      }
    }
  }

  if (placed.length < 2) return null;

  const allCells = placed.flatMap((entry) => entry.cells);
  const minRow = Math.min(...allCells.map((cell) => cell.row));
  const minCol = Math.min(...allCells.map((cell) => cell.col));
  const normalizeCells = (cells) => cells.map((cell) => ({ row: cell.row - minRow, col: cell.col - minCol, ch: cell.ch }));

  const answers = placed.map((entry) => ({
    word: entry.word,
    dir: entry.dir,
    cells: normalizeCells(entry.cells),
  }));
  const cellMap = new Map();
  for (const answer of answers) {
    for (const cell of answer.cells) cellMap.set(cellKey(cell), cell);
  }
  const cells = [...cellMap.values()];
  return {
    answers,
    grid: {
      rows: Math.max(...cells.map((cell) => cell.row)) + 1,
      cols: Math.max(...cells.map((cell) => cell.col)) + 1,
      cells,
    },
  };
}

function validate(level) {
  const covered = new Set();
  for (const answer of level.answers) {
    if (answer.cells.length !== answer.word.length) return false;
    for (let index = 0; index < answer.cells.length; index += 1) {
      if (answer.cells[index].ch !== answer.word[index]) return false;
    }
    for (const cell of answer.cells) covered.add(cellKey(cell));
  }
  for (const cell of level.grid.cells) {
    if (!covered.has(cellKey(cell))) return false;
  }

  const answerWords = level.answers.map((answer) => answer.word);
  if (rootConflicts(answerWords).length > 0) return false;

  const answerSet = new Set(answerWords);
  const acceptedBonus = level.acceptedBonus ?? level.bonusPool ?? [];
  if (acceptedBonus.length > MAX_ACCEPTED_BONUS) return false;
  if ((level.rewardedBonus ?? []).length > MAX_ACCEPTED_BONUS) return false;

  for (const bonus of acceptedBonus) {
    if (answerSet.has(bonus) || !isConstructible(bonus, level.letters)) return false;
    if (conflictsWithAny(bonus, answerWords)) return false;
  }
  if (rootConflicts(acceptedBonus).length > 0) return false;

  for (const blocked of level.blockedPool ?? []) {
    if (answerSet.has(blocked.word)) return false;
    if (acceptedBonus.includes(blocked.word)) return false;
    if (!isConstructible(blocked.word, level.letters)) return false;
  }

  if (level.mechanic === 'bonus_chest') {
    if (!Number.isInteger(level.bonusTarget) || level.bonusTarget < 1) return false;
    if (level.bonusTarget > (level.rewardedBonus ?? []).length) return false;
  } else if (level.bonusTarget != null) {
    return false;
  }

  if (level.mechanic === 'ordered') {
    const answerOrder = level.answerOrder ?? [];
    if (answerOrder.length !== level.answers.length) return false;
    if (new Set(answerOrder).size !== answerOrder.length) return false;
    if (answerOrder.some((word) => !answerSet.has(word))) return false;
  } else if (level.answerOrder != null) {
    return false;
  }

  return true;
}

function scoreLevel(letters, built, difficultyRole) {
  const answerLengths = built.answers.map((answer) => answer.word.length);
  const intersections = answerLengths.reduce((sum, length) => sum + length, 0) - built.grid.cells.length;
  const uniqueStarts = new Set(built.answers.map((answer) => answer.word[0])).size;
  return letters.length * 12
    + built.answers.length * 9
    + Math.max(...answerLengths) * 4
    + Math.max(0, intersections) * 5
    + uniqueStarts
    + (ROLE_SCORE_BONUS[difficultyRole] ?? 0);
}

function buildLevel({
  id,
  globalId,
  world,
  base,
  dicts,
  seed,
  maxAnswers,
  maxRewardedBonus = MAX_ACCEPTED_BONUS,
  contentVersion,
  difficultyRole,
  answerUsage = new Map(),
  surfaceUsage = new Map(),
  repeatCap = REPEAT_CAP,
}) {
  if (!dicts.isGridApproved(base)) return null;
  const earlyPolicy = EARLY_ROUTE_POLICY.levels[globalId];
  if (earlyPolicy) maxAnswers = earlyPolicy.answers.length;

  const letters = [...base];
  const diskMask = maskOf(base);
  const diskCounts = countsOf(base);
  const curatedAnswers =
    CURATED_EARLY_ANSWERS[globalId] ?? CURATED_FINALE_ANSWERS[globalId] ?? null;
  const curatedBonus = CURATED_EARLY_BONUS[globalId] ?? null;
  const answerCandidates = [];
  for (const entry of dicts.commonEntries) {
    if (entry.len < 3 || entry.len > letters.length) continue;
    if ((entry.mask & ~diskMask) !== 0) continue;
    if (!fitsCounts(countsOf(entry.w), diskCounts)) continue;
    const wordRepeatCap = EARLY_ROUTE_POLICY.familiarWordRepeatCaps[entry.w] ?? repeatCap;
    if ((answerUsage.get(entry.w) || 0) >= wordRepeatCap) continue;
    if ((surfaceUsage.get(entry.w) || 0) >= wordRepeatCap) continue;
    if (RESERVED_ANSWER_LEVELS.has(entry.w) && RESERVED_ANSWER_LEVELS.get(entry.w) !== globalId) continue;
    if (curatedAnswers && !curatedAnswers.includes(entry.w)) continue;
    if (dicts.isGridApproved(entry.w)) answerCandidates.push(entry.w);
  }
  answerCandidates.sort((left, right) => {
    return right.length - left.length
      || (dicts.commonRank.get(left) ?? Number.MAX_SAFE_INTEGER) - (dicts.commonRank.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right, 'ru');
  });
  if (!answerCandidates.length) return null;

  const baseIndex = answerCandidates.indexOf(base);
  if (baseIndex === -1) return null;
  if (baseIndex > 0) {
    answerCandidates.splice(baseIndex, 1);
    answerCandidates.unshift(base);
  }

  const built = placeCrossword(answerCandidates, maxAnswers);
  if (!built) return null;

  const answerSet = new Set(built.answers.map((answer) => answer.word));
  const acceptedBonus = [];
  for (const entry of dicts.validEntries) {
    if (acceptedBonus.length >= MAX_ACCEPTED_BONUS) break;
    if (entry.len < 3 || entry.len > letters.length) continue;
    if (answerSet.has(entry.w)) continue;
    if ((entry.mask & ~diskMask) !== 0) continue;
    if (!fitsCounts(countsOf(entry.w), diskCounts)) continue;
    if (dicts.blockedByWord.has(entry.w)) continue;
    if ((surfaceUsage.get(entry.w) || 0) >= (EARLY_ROUTE_POLICY.familiarWordRepeatCaps[entry.w] ?? repeatCap)) continue;
    if (RESERVED_ANSWER_LEVELS.has(entry.w) && RESERVED_ANSWER_LEVELS.get(entry.w) !== globalId) continue;
    if (curatedBonus && !curatedBonus.includes(entry.w)) continue;
    if (conflictsWithAny(entry.w, built.answers.map((answer) => answer.word))) continue;
    if (conflictsWithAny(entry.w, acceptedBonus)) continue;
    acceptedBonus.push(entry.w);
  }

  const rewardedBonus = acceptedBonus.slice(0, Math.min(MAX_ACCEPTED_BONUS, maxRewardedBonus));
  const blockedPool = dicts.blockedEntries
    .filter((entry) => isConstructible(entry.word, letters))
    .filter((entry) => !answerSet.has(entry.word) && !acceptedBonus.includes(entry.word));

  const random = rng(seed);
  const disk = [...letters];
  for (let index = disk.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1));
    [disk[index], disk[pick]] = [disk[pick], disk[index]];
  }

  const size = letters.length;
  const difficultyTier = Math.max(1, Math.min(5, size - 2));
  const level = {
    id,
    globalId,
    world,
    contentVersion: earlyPolicy?.contentVersion ?? contentVersion,
    letters: disk,
    grid: built.grid,
    answers: built.answers,
    acceptedBonus,
    bonusPool: acceptedBonus,
    rewardedBonus,
    blockedPool,
    difficulty: difficultyTier,
    difficultyTier,
    difficultyScore: scoreLevel(letters, built, difficultyRole),
    difficultyRole,
  };
  if (mechanicFor(globalId) === 'bonus_chest' && rewardedBonus.length === 0) return null;
  return validate(level) ? level : null;
}

function tutorialLevel({ contentVersion }) {
  return {
    id: 1,
    globalId: 1,
    world: 'world1',
    contentVersion,
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
    acceptedBonus: [],
    bonusPool: [],
    rewardedBonus: [],
    blockedPool: [],
    difficulty: 1,
    difficultyTier: 1,
    difficultyScore: 53,
    difficultyRole: 'easy',
    mechanic: 'classic',
    milestone: null,
  };
}

function applyCampaignMetadata(level) {
  level.mechanic = mechanicFor(level.globalId);
  level.milestone = milestoneFor(level.globalId);
  level.bonusTarget = level.mechanic === 'bonus_chest'
    ? Math.max(1, Math.min(level.rewardedBonus.length, level.letters.length >= 7 ? 4 : 3))
    : undefined;
  level.answerOrder = level.mechanic === 'ordered'
    ? level.answers.map((answer) => answer.word)
    : undefined;
  level.fingerprint = canonicalHash(levelFingerprintPayload(level));
  return level;
}

function bumpUsage(level, answerUsage, surfaceUsage) {
  for (const word of level.answers.map((answer) => answer.word)) {
    answerUsage.set(word, (answerUsage.get(word) || 0) + 1);
    surfaceUsage.set(word, (surfaceUsage.get(word) || 0) + 1);
  }
  for (const word of level.acceptedBonus ?? []) {
    surfaceUsage.set(word, (surfaceUsage.get(word) || 0) + 1);
  }
}

function loadDicts() {
  const dictDir = path.join(__dirname, '..', 'assets', 'dict');
  const valid = JSON.parse(fs.readFileSync(path.join(dictDir, 'ru.json'), 'utf8'));
  const common = JSON.parse(fs.readFileSync(path.join(dictDir, 'ru-common.json'), 'utf8'));
  const blocked = readJson(path.join(dictDir, 'ru-blocked.json'), []);
  const curation = readJson(path.join(dictDir, 'curation', 'answer-allow.json'), []);
  const deny = readJson(path.join(dictDir, 'curation', 'answer-deny.json'), { entries: [] });
  const regression = readJson(path.join(dictDir, 'curation', 'regression.json'), {});

  const denyEntriesRaw = Array.isArray(deny) ? deny : deny.entries || [];
  const deniedByWord = new Map();
  for (const entry of denyEntriesRaw) {
    const word = normalizeToken(typeof entry === 'string' ? entry : entry.word);
    const reason = typeof entry === 'string' ? 'manual_deny' : entry.reason;
    if (!word || !BLOCK_REASONS.has(reason)) continue;
    deniedByWord.set(word, reason);
  }

  for (const entry of blocked) {
    const word = normalizeToken(entry.word);
    if (!word || !BLOCK_REASONS.has(entry.reason)) continue;
    deniedByWord.set(word, entry.reason);
  }

  const entries = Array.isArray(curation) ? curation : curation.entries || [];
  const owner = Array.isArray(curation) ? 'content-owner' : curation.contentOwner || 'content-owner';
  const approved = new Set();
  for (const entry of entries) {
    const word = normalizeToken(entry.word);
    const reviewers = [...new Set(Array.isArray(entry.reviewers) ? entry.reviewers.filter(Boolean) : [])];
    if (
      word
      && entry.decision === 'allow_grid'
      && entry.reviewedAt
      && Array.isArray(entry.sourceRefs)
      && entry.sourceRefs.length > 0
      && reviewers.length >= 2
      && reviewers.includes(owner)
      && !deniedByWord.has(word)
    ) {
      approved.add(word);
    }
  }

  const blockedEntries = [...deniedByWord.entries()]
    .map(([word, reason]) => ({ word, reason }))
    .sort((left, right) => left.word.localeCompare(right.word, 'ru'));
  const blockedByWord = new Map(blockedEntries.map((entry) => [entry.word, entry]));

  const sanitize = (words, { allowFunctionWords }) => {
    const out = [];
    const seen = new Set();
    for (const rawWord of words) {
      const word = normalizeToken(rawWord);
      if (!word || seen.has(word)) continue;
      if (deniedByWord.has(word)) continue;
      if (isLowQualityWord(word) || isProfane(word)) continue;
      if (!allowFunctionWords && FUNCTION_WORDS.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
    return out;
  };

  const commonWords = sanitize(common, { allowFunctionWords: false }).filter((word) => approved.has(word));
  const validWords = sanitize(valid, { allowFunctionWords: true });
  for (const rawWord of regression.mustAccept || []) {
    const word = normalizeToken(rawWord);
    if (!word || deniedByWord.has(word) || isLowQualityWord(word) || isProfane(word)) continue;
    if (!validWords.includes(word)) validWords.push(word);
  }
  const commonRank = new Map();
  commonWords.forEach((word, index) => commonRank.set(word, index));

  return {
    commonEntries: commonWords.map((word) => ({ w: word, mask: maskOf(word), len: word.length })),
    validEntries: validWords
      .map((word) => ({ w: word, mask: maskOf(word), len: word.length }))
      .sort((left, right) => {
        const leftRank = commonRank.has(left.w) ? commonRank.get(left.w) : Number.MAX_SAFE_INTEGER;
        const rightRank = commonRank.has(right.w) ? commonRank.get(right.w) : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || right.len - left.len || left.w.localeCompare(right.w, 'ru');
      }),
    commonRank,
    blockedEntries,
    blockedByWord,
    isGridApproved: (word) => approved.has(word) && !blockedByWord.has(word),
  };
}

function worldSpecFor(globalId) {
  return WORLD_SPECS.find((spec) => globalId > spec.globalOffset && globalId <= spec.globalOffset + spec.count) ?? WORLD_SPECS[0];
}

function candidateBaseFor(globalId) {
  if (CURATED_EARLY_BASES[globalId]) return [CURATED_EARLY_BASES[globalId]];
  if (CURATED_FINALE_BASE_OPTIONS[globalId]) return CURATED_FINALE_BASE_OPTIONS[globalId];
  return null;
}

function collectCandidates({
  world,
  localId,
  globalId,
  dicts,
  byLen,
  cursors,
  usedBases,
  answerUsage,
  surfaceUsage,
  signatures,
  contentVersion,
  count = 80,
}) {
  const size = diskSizeFor(globalId);
  const role = difficultyRoleFor(globalId);
  const earlyAnswerCount = EARLY_ROUTE_POLICY.levels[globalId]?.answers.length;
  const [minAnswers, maxAnswers] = earlyAnswerCount
    ? [earlyAnswerCount, earlyAnswerCount]
    : roleBand(size, role);
  const forcedBases = candidateBaseFor(globalId);
  const candidates = [];

  const tryBase = (base, seedOffset) => {
    // Reused curated bases need an explicit early-route allowance.
    if (usedBases.has(base) && EARLY_ROUTE_POLICY.reusedCuratedBases[globalId] !== base) return;
    const reservedLevel = RESERVED_BASE_LEVELS.get(base);
    if (!forcedBases && reservedLevel && reservedLevel !== globalId) return;
    const built = buildLevel({
      id: localId,
      globalId,
      world,
      base,
      dicts,
      seed: hashStr(`${world}:${globalId}:${base}`) + seedOffset,
      maxAnswers,
      maxRewardedBonus: MAX_ACCEPTED_BONUS,
      contentVersion,
      difficultyRole: role,
      answerUsage,
      surfaceUsage,
      repeatCap: REPEAT_CAP,
    });
    if (!built) return;
    if (built.answers.length < minAnswers) return;
    if (globalId > PRESERVED_LEVELS && (
      built.grid.rows > EXTENSION_GRID_LIMITS.rows || built.grid.cols > EXTENSION_GRID_LIMITS.cols
    )) return;
    applyCampaignMetadata(built);
    const signature = puzzleSignature(built);
    if (signatures.has(signature)) return;
    candidates.push({ base, level: built, signature });
  };

  if (forcedBases) {
    forcedBases.forEach((base, index) => tryBase(base, index));
    return candidates;
  }

  const pool = byLen.get(size) ?? [];
  let cursor = cursors.get(size) ?? 0;
  let scanned = 0;
  const maxScan = Math.min(pool.length, 12000);
  while (pool.length > 0 && candidates.length < count && scanned < maxScan) {
    const index = (cursor + scanned) % pool.length;
    const base = pool[index];
    scanned += 1;
    tryBase(base, scanned);
  }
  if (pool.length > 0) cursors.set(size, (cursor + scanned) % pool.length);
  return candidates;
}

function pickCandidate(role, candidates, waveState, globalId) {
  if (!candidates.length) return null;
  const preferred = mechanicFor(globalId) === 'bonus_chest' && candidates.some((candidate) => candidate.level.rewardedBonus.length > 0)
    ? candidates.filter((candidate) => candidate.level.rewardedBonus.length > 0)
    : candidates;
  const sorted = [...preferred].sort((left, right) => {
    return left.level.difficultyScore - right.level.difficultyScore
      || left.level.answers.length - right.level.answers.length
      || left.base.localeCompare(right.base, 'ru');
  });

  if (role === 'easy') return sorted[0];
  if (role === 'baseline') {
    return sorted.find((candidate) => candidate.level.difficultyScore >= (waveState.easy?.difficultyScore ?? 0)) ?? sorted[sorted.length - 1];
  }
  if (role === 'hard') {
    return sorted.find((candidate) => candidate.level.difficultyScore >= (waveState.baseline?.difficultyScore ?? 0)) ?? sorted[sorted.length - 1];
  }
  if (role === 'breather') {
    return [...sorted].reverse().find((candidate) => candidate.level.difficultyScore < (waveState.hard?.difficultyScore ?? Number.MAX_SAFE_INTEGER)) ?? sorted[0];
  }
  return [...sorted].reverse().find((candidate) => candidate.level.difficultyScore >= (waveState.hard?.difficultyScore ?? 0)) ?? sorted[sorted.length - 1];
}

function generateWorld({
  world,
  count,
  globalOffset = 0,
  dicts,
  usedBases,
  answerUsage = new Map(),
  surfaceUsage = new Map(),
  signatures = new Set(),
  contentVersion,
}) {
  if (globalOffset >= PRESERVED_LEVELS) {
    const blockedByWord = new Map([
      ...dicts.blockedByWord,
      ...EXTENSION_BLOCKED.map((entry) => [entry.word, entry]),
    ]);
    const allowed = (word) => !blockedByWord.has(word) && !FUNCTION_WORDS.has(word);
    const originalApproved = dicts.isGridApproved;
    dicts = {
      ...dicts,
      commonEntries: dicts.commonEntries.filter((entry) => allowed(entry.w)),
      validEntries: dicts.validEntries.filter((entry) => allowed(entry.w)),
      blockedByWord,
      blockedEntries: [...blockedByWord.values()].sort((left, right) => left.word.localeCompare(right.word, 'ru')),
      isGridApproved: (word) => allowed(word) && originalApproved(word),
    };
  }
  const byLen = new Map();
  for (const entry of dicts.commonEntries) {
    if (!byLen.has(entry.len)) byLen.set(entry.len, []);
    byLen.get(entry.len).push(entry.w);
  }
  const cursors = new Map();
  const levels = [];
  const waveState = {};

  if (world === 'world1' && globalOffset === 0) {
    const tutorial = applyCampaignMetadata(tutorialLevel({ contentVersion }));
    levels.push(tutorial);
    usedBases.add('сон');
    bumpUsage(tutorial, answerUsage, surfaceUsage);
    signatures.add(puzzleSignature(tutorial));
    waveState.easy = tutorial;
  }

  while (levels.length < count) {
    const localId = levels.length + 1;
    const globalId = globalOffset + localId;
    const role = difficultyRoleFor(globalId);
    if (role === 'easy') {
      delete waveState.easy;
      delete waveState.baseline;
      delete waveState.hard;
      delete waveState.breather;
      delete waveState.climax;
    }

    const candidates = collectCandidates({
      world,
      localId,
      globalId,
      dicts,
      byLen,
      cursors,
      usedBases,
      answerUsage,
      surfaceUsage,
      signatures,
      contentVersion,
    });
    const chosen = pickCandidate(role, candidates, waveState, globalId);
    if (!chosen) {
      throw new Error(`Unable to build level ${globalId} (${world}:${localId})`);
    }

    levels.push(chosen.level);
    usedBases.add(chosen.base);
    bumpUsage(chosen.level, answerUsage, surfaceUsage);
    signatures.add(chosen.signature);
    waveState[role] = chosen.level;
  }

  return { world, levels };
}

function writePack(pack) {
  const outDir = path.join(__dirname, '..', 'assets', 'levels');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${pack.world}.json`);
  writeJsonAtomic(outPath, pack);
  return outPath;
}

module.exports = {
  EARLY_ROUTE_POLICY,
  CURATED_EARLY_ANSWERS,
  CURATED_EARLY_BASES,
  CURATED_EARLY_BONUS,
  CURATED_FINALE_BASES,
  CURATED_FINALE_BASE_OPTIONS,
  CURATED_FINALE_ANSWERS,
  EXTENSION_BLOCKED,
  EXTENSION_GRID_LIMITS,
  LANDMARK_LEVELS,
  MASTERY_LEVELS,
  MAX_ACCEPTED_BONUS,
  ORDERED_LEVELS,
  PRESERVED_LEVELS,
  REPEAT_CAP,
  TOTAL_LEVELS,
  WORLD_FINALES,
  WORLD_SPECS,
  buildLevel,
  difficultyRoleFor,
  diskSizeFor,
  generateWorld,
  levelFingerprintPayload,
  loadDicts,
  mechanicFor,
  milestoneFor,
  placeCrossword,
  puzzleSignature,
  rootConflicts,
  sameRoot,
  validate,
  worldSpecFor,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };

  const dicts = loadDicts();
  const generatedAt = generatedAtFromEnv();
  const usedBases = new Set();
  const answerUsage = new Map();
  const surfaceUsage = new Map();
  const signatures = new Set();
  const oneWorld = get('--world', null);
  const requestedCount = get('--count', null);
  const requestedOffset = get('--global-offset', null);
  // Routine generation extends the released campaign; rebuilding old packs is explicit.
  const appendFromRaw = get('--append-from', oneWorld ? null : String(PRESERVED_LEVELS));
  const appendFrom = appendFromRaw == null ? 0 : Number(appendFromRaw);
  if (!Number.isInteger(appendFrom) || appendFrom < 0 || appendFrom > TOTAL_LEVELS) {
    throw new Error('--append-from must be a campaign boundary between 0 and 1000');
  }
  if (appendFrom && (oneWorld || requestedCount || requestedOffset || !WORLD_FINALES.has(appendFrom))) {
    throw new Error('--append-from requires a complete world boundary and cannot be combined with --world/--count/--global-offset');
  }
  const dictionaryHash = sha256(fs.readFileSync(path.join(__dirname, '..', 'assets', 'dict', 'ru.json')));
  const contentVersion = get('--content-version', `dict-v4-${dictionaryHash.slice(0, 12)}`);

  // Seed every uniqueness/repetition guard from the released packs without rewriting them.
  for (const spec of WORLD_SPECS.filter((entry) => entry.globalOffset + entry.count <= appendFrom)) {
    const pack = readJson(path.join(__dirname, '..', 'assets', 'levels', `${spec.world}.json`), null);
    if (!pack || pack.world !== spec.world || pack.levels.length !== spec.count) {
      throw new Error(`Cannot preserve missing or incomplete pack ${spec.world}`);
    }
    pack.levels.forEach((level, index) => {
      if (level.id !== index + 1 || level.globalId !== spec.globalOffset + index + 1 || level.world !== spec.world) {
        throw new Error(`Cannot preserve non-contiguous pack ${spec.world}`);
      }
      usedBases.add(level.answers[0].word);
      bumpUsage(level, answerUsage, surfaceUsage);
      signatures.add(puzzleSignature(level));
    });
    console.log(`${spec.world}: preserving ${spec.count} existing levels`);
  }

  const plan = oneWorld
    ? (() => {
      const spec = WORLD_SPECS.find((entry) => entry.world === oneWorld);
      if (!spec) throw new Error(`Unknown world: ${oneWorld}`);
      return [{
        world: spec.world,
        count: requestedCount ? parseInt(requestedCount, 10) : spec.count,
        globalOffset: requestedOffset ? parseInt(requestedOffset, 10) : spec.globalOffset,
      }];
    })()
    : WORLD_SPECS.filter((spec) => spec.globalOffset >= appendFrom);

  for (const spec of plan) {
    const generated = generateWorld({
      world: spec.world,
      count: spec.count,
      globalOffset: spec.globalOffset,
      dicts,
      usedBases,
      answerUsage,
      surfaceUsage,
      signatures,
      contentVersion,
    });
    const pack = {
      schemaVersion: 2,
      contentVersion,
      world: spec.world,
      generatedAt,
      dictionaryHash,
      levels: generated.levels,
    };
    const out = writePack(pack);
    const avgBonus = (
      pack.levels.reduce((sum, level) => sum + (level.acceptedBonus?.length ?? 0), 0) / Math.max(1, pack.levels.length)
    ).toFixed(1);
    console.log(`${pack.world}: ${pack.levels.length} levels, avgBonus=${avgBonus} -> ${out}`);
  }
}
