#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { BLOCK_REASONS, canonicalHash, isConstructible, normalizeToken, readJson, sha256, writeJsonAtomic } = require('./dict/content');
const {
  EARLY_ROUTE_POLICY,
  CURATED_EARLY_ANSWERS,
  CURATED_EARLY_BASES,
  CURATED_EARLY_BONUS,
  CURATED_FINALE_ANSWERS,
  CURATED_FINALE_BASE_OPTIONS,
  EXTENSION_BLOCKED,
  EXTENSION_GRID_LIMITS,
  EXTENSION_START_LEVEL,
  MAX_ACCEPTED_BONUS,
  PRESERVED_LEVELS,
  REPEAT_CAP,
  TOTAL_LEVELS,
  THIRD_ROUTE_BLOCKED,
  THIRD_ROUTE_VARIETY,
  THIRD_ROUTE_ROLE_ANSWERS,
  THIRD_ROUTE_ROOT_FAMILIES,
  WORLD_FINALES,
  WORLD_SPECS,
  difficultyRoleFor,
  diskSizeFor,
  levelFingerprintPayload,
  loadDicts,
  mechanicFor,
  milestoneFor,
  puzzleSignature,
  sameRoot,
  sameThirdRouteRoot,
  scoreLevel,
  worldSpecFor,
} = require('./gen-levels');

const ROOT = path.join(__dirname, '..');
const DICT_DIR = path.join(ROOT, 'assets', 'dict');
const LEVEL_DIR = path.join(ROOT, 'assets', 'levels');

function addError(errors, id, message, details = {}) {
  errors.push({ ...details, id, message });
}

function sameWords(actual, expected) {
  return actual.length === expected.length
    && [...actual].sort((left, right) => left.localeCompare(right, 'ru'))
      .every((word, index) => word === [...expected].sort((left, right) => left.localeCompare(right, 'ru'))[index]);
}

function loadPack(world) {
  const file = path.join(LEVEL_DIR, `${world}.json`);
  return { file, pack: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function registryMap(registry) {
  const entries = Array.isArray(registry) ? registry : registry.entries || [];
  const owner = Array.isArray(registry) ? 'content-owner' : registry.contentOwner || 'content-owner';
  const out = new Map();
  for (const entry of entries) {
    const word = normalizeToken(entry.word);
    const reviewers = [...new Set(Array.isArray(entry.reviewers) ? entry.reviewers.filter(Boolean) : [])];
    const valid = Boolean(
      word
      && entry.decision === 'allow_grid'
      && entry.reviewedAt
      && Array.isArray(entry.sourceRefs)
      && entry.sourceRefs.length > 0
      && reviewers.length >= 2
      && reviewers.includes(owner)
    );
    if (word) out.set(word, { valid, entry });
  }
  return out;
}

function worldExpectedGlobalId(world, localId) {
  const spec = WORLD_SPECS.find((entry) => entry.world === world);
  return spec ? spec.globalOffset + localId : null;
}

/** Validate the actual board, independently of the generator's placement routine. */
function gridErrors(level) {
  const errors = [];
  const grid = level.grid || {};
  const cells = Array.isArray(grid.cells) ? grid.cells : [];
  const answers = Array.isArray(level.answers) ? level.answers : [];
  const byCell = new Map();
  const memberships = new Map();
  const key = (cell) => `${cell.row},${cell.col}`;
  if (!Number.isInteger(grid.rows) || grid.rows < 1 || !Number.isInteger(grid.cols) || grid.cols < 1 || cells.length === 0) errors.push('invalid_dimensions');
  for (const cell of cells) {
    const id = key(cell);
    if (byCell.has(id)) errors.push(`duplicate_cell:${id}`);
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col) || cell.row < 0 || cell.col < 0 || cell.row >= grid.rows || cell.col >= grid.cols) errors.push(`out_of_bounds:${id}`);
    if (typeof cell.ch !== 'string' || !/^[а-я]$/.test(cell.ch)) errors.push(`invalid_character:${id}`);
    byCell.set(id, cell);
  }
  answers.forEach((answer, index) => {
    const wordCells = Array.isArray(answer.cells) ? answer.cells : [];
    if (!['H', 'V'].includes(answer.dir) || wordCells.length !== answer.word.length || wordCells.length === 0) errors.push(`invalid_answer:${answer.word}`);
    const first = wordCells[0];
    wordCells.forEach((cell, offset) => {
      const id = key(cell);
      if (!byCell.has(id) || byCell.get(id).ch !== cell.ch || cell.ch !== answer.word[offset]) errors.push(`character_mismatch:${answer.word}:${id}`);
      if (first && (cell.row !== first.row + (answer.dir === 'V' ? offset : 0) || cell.col !== first.col + (answer.dir === 'H' ? offset : 0))) errors.push(`nonlinear_answer:${answer.word}`);
      if (!memberships.has(id)) memberships.set(id, []);
      memberships.get(id).push({ index, dir: answer.dir });
    });
    if (first) {
      const dr = answer.dir === 'V' ? 1 : 0;
      const dc = answer.dir === 'H' ? 1 : 0;
      if (byCell.has(`${first.row - dr},${first.col - dc}`) || byCell.has(`${first.row + dr * wordCells.length},${first.col + dc * wordCells.length}`)) errors.push(`touching_end:${answer.word}`);
    }
  });
  for (const [id, cell] of byCell) {
    const owners = memberships.get(id) || [];
    if (owners.length === 0) errors.push(`uncovered_cell:${id}`);
    if (owners.length > 2 || new Set(owners.map((entry) => entry.dir)).size !== owners.length) errors.push(`invalid_overlap:${id}`);
    for (const [dr, dc] of [[1, 0], [0, 1]]) {
      const neighbor = `${cell.row + dr},${cell.col + dc}`;
      if (byCell.has(neighbor) && !owners.some((owner) => (memberships.get(neighbor) || []).some((other) => other.index === owner.index))) errors.push(`side_touch:${id}:${neighbor}`);
    }
  }
  const seen = new Set();
  const queue = byCell.size ? [byCell.keys().next().value] : [];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const cell = byCell.get(id);
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = `${cell.row + dr},${cell.col + dc}`;
      if (byCell.has(next) && !seen.has(next)) queue.push(next);
    }
  }
  if (seen.size !== byCell.size) errors.push('disconnected_board');
  return [...new Set(errors)];
}

function auditLevel({ level, dicts, approvals, commonWords, validWords, blockedWords, surfaceOccurrence, mandatoryOccurrence, signatures, errors, difficulty }) {
  const answers = Array.isArray(level.answers) ? level.answers.map((answer) => answer.word) : [];
  const accepted = Array.isArray(level.acceptedBonus) ? level.acceptedBonus : [];
  const rewarded = Array.isArray(level.rewardedBonus) ? level.rewardedBonus : [];
  const blocked = Array.isArray(level.blockedPool) ? level.blockedPool : [];
  const answerSet = new Set(answers);
  const acceptedSet = new Set(accepted);
  const rewardedSet = new Set(rewarded);
  const blockedSet = new Set(blocked.map((entry) => entry.word));
  const label = `${level.world || '?'}:${level.id || '?'}:${level.globalId || '?'}`;
  const rootMatcher = level.globalId > PRESERVED_LEVELS ? sameThirdRouteRoot : sameRoot;
  const geometryErrors = gridErrors(level);
  if (geometryErrors.length) addError(errors, 'GRID-02', 'Crossword board violates topology or cell invariants', { level: label, geometryErrors });
  if (!sameWords(level.bonusPool || [], accepted)) addError(errors, 'BONUS-06', 'Legacy bonusPool alias differs from acceptedBonus', { level: label });

  if (level.globalId > PRESERVED_LEVELS) {
    const minimum = THIRD_ROUTE_ROLE_ANSWERS[difficultyRoleFor(level.globalId)];
    const maximum = minimum;
    if (answers.length < minimum || answers.length > maximum) addError(errors, 'DIFF-03', 'Mandatory answer count differs from the existing role band', { level: label, minimum, maximum, actual: answers.length });
    const expectedScore = scoreLevel(level.letters, { answers: level.answers, grid: level.grid }, level.difficultyRole);
    if (level.difficultyScore !== expectedScore) addError(errors, 'DIFF-04', 'Difficulty score differs from the actual puzzle', { level: label, expectedScore });
  }

  if (level.globalId > EXTENSION_START_LEVEL && (
    level.grid?.rows > EXTENSION_GRID_LIMITS.rows || level.grid?.cols > EXTENSION_GRID_LIMITS.cols
  )) addError(errors, 'GRID-01', 'Extension grid exceeds the mobile layout budget', { level: label, rows: level.grid?.rows, cols: level.grid?.cols });
  if (level.globalId > EXTENSION_START_LEVEL) {
    for (const entry of [...EXTENSION_BLOCKED, ...(level.globalId > PRESERVED_LEVELS ? THIRD_ROUTE_BLOCKED : [])]) {
      if (answerSet.has(entry.word) || acceptedSet.has(entry.word)) {
        addError(errors, 'EXTENSION-01', 'Excluded extension word is surfaced', { level: label, ...entry });
      }
      if (isConstructible(entry.word, level.letters || []) && !blocked.some((blockedEntry) => blockedEntry.word === entry.word && blockedEntry.reason === entry.reason)) {
        addError(errors, 'EXTENSION-02', 'Excluded constructible extension word is missing from blockedPool', { level: label, ...entry });
      }
    }
  }

  if (answerSet.size !== answers.length) addError(errors, 'DICT-01', 'Duplicate mandatory answer', { level: label });
  if (acceptedSet.size !== accepted.length) addError(errors, 'BONUS-01', 'Duplicate accepted bonus word', { level: label });
  if (rewardedSet.size !== rewarded.length) addError(errors, 'BONUS-02', 'Duplicate rewarded bonus word', { level: label });
  if (accepted.length > MAX_ACCEPTED_BONUS) addError(errors, 'BONUS-03', 'acceptedBonus exceeds cap', { level: label, count: accepted.length });
  if (rewarded.length > MAX_ACCEPTED_BONUS) addError(errors, 'BONUS-04', 'rewardedBonus exceeds cap', { level: label, count: rewarded.length });

  const answerRootConflicts = [];
  for (let i = 0; i < answers.length; i += 1) {
    for (let j = i + 1; j < answers.length; j += 1) {
      if (rootMatcher(answers[i], answers[j])) answerRootConflicts.push([answers[i], answers[j]]);
    }
  }
  if (answerRootConflicts.length > 0) addError(errors, 'ROOT-01', 'Mandatory answers share the same root', { level: label, conflicts: answerRootConflicts });

  const bonusRootConflicts = [];
  for (let i = 0; i < accepted.length; i += 1) {
    if (answers.some((answer) => rootMatcher(accepted[i], answer))) bonusRootConflicts.push([accepted[i], 'answers']);
    for (let j = i + 1; j < accepted.length; j += 1) {
      if (rootMatcher(accepted[i], accepted[j])) bonusRootConflicts.push([accepted[i], accepted[j]]);
    }
  }
  if (bonusRootConflicts.length > 0) addError(errors, 'ROOT-02', 'Bonus words share a root with answers or each other', { level: label, conflicts: bonusRootConflicts });

  for (const word of answers) {
    if (!normalizeToken(word) || !isConstructible(word, level.letters || [])) addError(errors, 'DICT-03', 'Invalid or non-constructible mandatory answer', { level: label, word });
    if (!commonWords.has(word)) addError(errors, 'DICT-16', 'Mandatory answer is not in the common dictionary', { level: label, word });
    if (!approvals.get(word)?.valid) addError(errors, 'DICT-13', 'Mandatory answer is missing valid approval', { level: label, word });
    if (!validWords.has(word)) addError(errors, 'DICT-17', 'Mandatory answer is absent from the filtered dictionary', { level: label, word });
    if (blockedWords.has(word)) addError(errors, 'DICT-06', 'Blocked word is used as mandatory answer', { level: label, word, reason: blockedWords.get(word) });
    mandatoryOccurrence.set(word, (mandatoryOccurrence.get(word) || 0) + 1);
    surfaceOccurrence.set(word, (surfaceOccurrence.get(word) || 0) + 1);
  }

  for (const word of accepted) {
    if (!normalizeToken(word) || !isConstructible(word, level.letters || [])) addError(errors, 'DICT-03', 'Invalid or non-constructible accepted bonus', { level: label, word });
    if (!validWords.has(word)) addError(errors, 'DICT-18', 'Accepted bonus is absent from the filtered dictionary', { level: label, word });
    if (answerSet.has(word)) addError(errors, 'DICT-01', 'Answer is also accepted bonus', { level: label, word });
    if (blockedSet.has(word) || blockedWords.has(word)) addError(errors, 'DICT-02', 'Accepted bonus is blocked', { level: label, word });
    surfaceOccurrence.set(word, (surfaceOccurrence.get(word) || 0) + 1);
  }

  for (const word of rewarded) {
    if (!acceptedSet.has(word)) addError(errors, 'BONUS-05', 'rewardedBonus must be a subset of acceptedBonus', { level: label, word });
  }

  for (const entry of blocked) {
    if (!entry || !normalizeToken(entry.word) || !BLOCK_REASONS.has(entry.reason)) {
      addError(errors, 'DICT-05', 'Blocked entry lacks a valid word or reason', { level: label, entry });
      continue;
    }
    if (!isConstructible(entry.word, level.letters || [])) addError(errors, 'DICT-03', 'Blocked word is not constructible', { level: label, word: entry.word });
    if (answerSet.has(entry.word) || acceptedSet.has(entry.word)) addError(errors, 'DICT-02', 'Blocked word overlaps accepted content', { level: label, word: entry.word });
  }

  const expectedGlobalId = worldExpectedGlobalId(level.world, level.id);
  if (expectedGlobalId !== level.globalId) addError(errors, 'WORLD-01', 'globalId does not match world/local id boundary', { level: label, expectedGlobalId });
  if (diskSizeFor(level.globalId) !== (level.letters || []).length) addError(errors, 'DIFF-01', 'Disk size does not match campaign curve', { level: label, expected: diskSizeFor(level.globalId), actual: (level.letters || []).length });
  if (difficultyRoleFor(level.globalId) !== level.difficultyRole) addError(errors, 'DIFF-02', 'difficultyRole does not match wave slot', { level: label, expected: difficultyRoleFor(level.globalId), actual: level.difficultyRole });
  if (mechanicFor(level.globalId) !== level.mechanic) addError(errors, 'MECH-01', 'mechanic does not match campaign schedule', { level: label, expected: mechanicFor(level.globalId), actual: level.mechanic });
  if (milestoneFor(level.globalId) !== (level.milestone ?? null)) addError(errors, 'MECH-02', 'milestone does not match campaign schedule', { level: label, expected: milestoneFor(level.globalId), actual: level.milestone ?? null });

  if (level.mechanic === 'bonus_chest') {
    if (!Number.isInteger(level.bonusTarget) || level.bonusTarget < 1 || level.bonusTarget > rewarded.length) {
      addError(errors, 'MECH-03', 'bonus_chest level must declare a valid bonusTarget', { level: label, bonusTarget: level.bonusTarget, rewardedCount: rewarded.length });
    }
  } else if (level.bonusTarget != null) {
    addError(errors, 'MECH-04', 'bonusTarget is only allowed on bonus_chest levels', { level: label, bonusTarget: level.bonusTarget });
  }

  if (level.mechanic === 'ordered') {
    const answerOrder = Array.isArray(level.answerOrder) ? level.answerOrder : [];
    if (answerOrder.length !== answers.length || answerOrder.some((word) => !answerSet.has(word)) || new Set(answerOrder).size !== answerOrder.length) {
      addError(errors, 'MECH-05', 'ordered level must declare a full answerOrder', { level: label, answerOrder: level.answerOrder ?? null });
    }
  } else if (level.answerOrder != null) {
    addError(errors, 'MECH-06', 'answerOrder is only allowed on ordered levels', { level: label });
  }

  const fingerprint = canonicalHash(levelFingerprintPayload(level));
  if (level.fingerprint !== fingerprint) addError(errors, 'DICT-15', 'Level fingerprint differs from immutable bundled payload', { level: label });

  const signature = puzzleSignature(level);
  if (signatures.has(signature)) addError(errors, 'DICT-07', 'Duplicate puzzle signature', { level: label, duplicateOf: signatures.get(signature) });
  else signatures.set(signature, label);

  difficulty.push({
    globalId: level.globalId,
    world: level.world,
    diskSize: (level.letters || []).length,
    answerCount: answers.length,
    tier: level.difficultyTier,
    role: level.difficultyRole,
    score: level.difficultyScore,
    mechanic: level.mechanic,
    milestone: level.milestone ?? null,
  });
}

function audit({ worlds = WORLD_SPECS.map((spec) => spec.world) } = {}) {
  const errors = [];
  const warnings = [];
  for (const entry of [...EXTENSION_BLOCKED, ...THIRD_ROUTE_BLOCKED]) {
    if (!normalizeToken(entry.word) || !BLOCK_REASONS.has(entry.reason)) {
      addError(errors, 'EXTENSION-03', 'Extension exclusion must contain a normalized word and supported reason', { ...entry });
    }
  }
  const dicts = loadDicts();
  const familyWords = new Set();
  for (const [index, words] of THIRD_ROUTE_ROOT_FAMILIES.entries()) {
    if (!Array.isArray(words) || words.length < 2 || words.some((word) => !normalizeToken(word) || familyWords.has(word))) addError(errors, 'ROOT-03', 'Curated third-route root families must contain distinct normalized words', { family: index });
    for (const word of words) familyWords.add(word);
  }
  const bundledDictionaryHash = sha256(fs.readFileSync(path.join(DICT_DIR, 'ru.json')));
  const rawValidWords = new Set(readJson(path.join(DICT_DIR, 'ru.json'), []).map(normalizeToken).filter(Boolean));
  const approvals = registryMap(readJson(path.join(DICT_DIR, 'curation', 'answer-allow.json'), []));
  const validWords = new Set(dicts.validEntries.map((entry) => entry.w));
  const commonWords = new Set(dicts.commonEntries.map((entry) => entry.w));
  const blockedWords = new Map(dicts.blockedEntries.map((entry) => [entry.word, entry.reason]));
  const packs = worlds.map(loadPack);
  const levels = packs.flatMap(({ pack }) => pack.levels || []);
  const seenGlobalIds = new Set();
  const signatures = new Map();
  const surfaceOccurrence = new Map();
  const mandatoryOccurrence = new Map();
  const difficulty = [];

  for (const { file, pack } of packs) {
    if (pack.schemaVersion !== 2) addError(errors, 'DICT-11', 'Level pack is not schemaVersion 2', { file: path.relative(ROOT, file), schemaVersion: pack.schemaVersion || null });
    if (!pack.contentVersion || !pack.generatedAt || !pack.dictionaryHash) addError(errors, 'DICT-12', 'Pack lacks reproducibility metadata', { file: path.relative(ROOT, file) });
    if (WORLD_SPECS.find((spec) => spec.world === pack.world)?.globalOffset >= PRESERVED_LEVELS) {
      if (pack.dictionaryHash !== bundledDictionaryHash) addError(errors, 'DICT-19', 'New pack dictionary hash differs from its approved source', { file: path.relative(ROOT, file) });
      for (const level of pack.levels || []) {
        if (level.contentVersion !== pack.contentVersion) addError(errors, 'DICT-20', 'New level content version differs from its pack', { globalId: level.globalId });
      }
    }
  }

  const preserved = readJson(path.join(ROOT, 'assets', 'content', 'preserved-packs.json'), null);
  if (preserved?.throughLevel !== PRESERVED_LEVELS) addError(errors, 'PRESERVE-03', 'Preservation manifest must cover all released levels', { expected: PRESERVED_LEVELS, actual: preserved?.throughLevel });
  for (const spec of WORLD_SPECS.filter((entry) => entry.globalOffset < PRESERVED_LEVELS)) {
    const fileName = `${spec.world}.json`;
    const expected = preserved?.sha256?.[fileName];
    const actual = sha256(fs.readFileSync(path.join(LEVEL_DIR, fileName)));
    if (!expected || expected !== actual) {
      addError(errors, 'PRESERVE-01', 'Released campaign pack must remain byte-identical', { file: fileName, expected, actual });
    }
    const revision = preserved?.intendedRevisions?.[fileName];
    if (revision) {
      const current = readJson(path.join(LEVEL_DIR, fileName), {});
      const unchanged = (current.levels || []).filter((level) => level.globalId >= revision.unchangedFromGlobalId);
      if (revision.unchangedFromGlobalId !== EARLY_ROUTE_POLICY.throughLevel + 1
        || canonicalHash(unchanged) !== revision.unchangedLevelsSha256) {
        addError(errors, 'PRESERVE-02', 'Later released levels changed during the approved early-route revision', { file: fileName });
      }
    }
  }

  for (const level of levels) {
    if (!Number.isInteger(level.globalId) || level.globalId < 1 || level.globalId > TOTAL_LEVELS || seenGlobalIds.has(level.globalId)) {
      addError(errors, 'WORLD-02', 'globalId must be unique in campaign range', { globalId: level.globalId, world: level.world, id: level.id });
    }
    seenGlobalIds.add(level.globalId);
    auditLevel({
      level,
      dicts,
      approvals,
      commonWords,
      validWords,
      blockedWords,
      surfaceOccurrence,
      mandatoryOccurrence,
      signatures,
      errors,
      difficulty,
    });
  }

  if (levels.length !== TOTAL_LEVELS) addError(errors, 'WORLD-03', `Production content must contain exactly ${TOTAL_LEVELS} levels`, { levels: levels.length });
  for (const spec of WORLD_SPECS) {
    const worldLevels = levels.filter((level) => level.world === spec.world);
    if (worldLevels.length !== spec.count) addError(errors, 'WORLD-04', 'World count does not match campaign contract', { world: spec.world, expected: spec.count, actual: worldLevels.length });
  }

  for (let globalId = 1; globalId <= 30; globalId += 1) {
    const level = levels.find((entry) => entry.globalId === globalId);
    const expectedBase = CURATED_EARLY_BASES[globalId];
    const expectedAnswers = CURATED_EARLY_ANSWERS[globalId] ?? [];
    const expectedBonus = CURATED_EARLY_BONUS[globalId] ?? [];
    if (!level) continue;
    if ([...(level.letters ?? [])].sort().join('') !== [...expectedBase].sort().join('')) {
      addError(errors, 'CURATE-01', 'Early level differs from its manually curated base', { globalId, expectedBase, letters: level.letters });
    }
    if (!sameWords(level.answers.map((answer) => answer.word), expectedAnswers)) {
      addError(errors, 'CURATE-02', 'Early level differs from its manually curated answers', { globalId, expectedAnswers, actualAnswers: level.answers.map((answer) => answer.word) });
    }
    if (!sameWords(level.acceptedBonus ?? [], expectedBonus)) {
      addError(errors, 'CURATE-03', 'Early level differs from its manually curated bonus words', { globalId, expectedBonus, actualBonus: level.acceptedBonus ?? [] });
    }
  }

  for (const [globalIdText, bases] of Object.entries(CURATED_FINALE_BASE_OPTIONS)) {
    const globalId = Number(globalIdText);
    const level = levels.find((entry) => entry.globalId === globalId);
    if (!level) continue;
    const diskSignature = [...(level.letters ?? [])].sort().join('');
    if (!bases.some((base) => [...base].sort().join('') === diskSignature)) {
      addError(errors, 'CURATE-04', 'World finale does not use an approved curated base', { globalId, bases, letters: level.letters });
    }
    const actualAnswers = level.answers.map((answer) => answer.word);
    const expectedAnswers = CURATED_FINALE_ANSWERS[globalId] ?? [];
    if (!sameWords(actualAnswers, expectedAnswers)) {
      addError(errors, 'CURATE-05', 'World finale differs from its manually curated answers', {
        globalId,
        expectedAnswers,
        actualAnswers,
      });
    }
  }

  for (const [word, count] of mandatoryOccurrence) {
    const repeatCap = EARLY_ROUTE_POLICY.familiarWordRepeatCaps[word] ?? REPEAT_CAP;
    if (count > repeatCap) addError(errors, 'REPEAT-01', 'Mandatory word exceeds repeat cap', { word, count, repeatCap });
  }
  for (const [word, count] of surfaceOccurrence) {
    const repeatCap = EARLY_ROUTE_POLICY.familiarWordRepeatCaps[word] ?? REPEAT_CAP;
    if (count > repeatCap) addError(errors, 'REPEAT-02', 'Surfaced word exceeds repeat cap', { word, count, repeatCap });
  }
  for (const [word, cap] of Object.entries(EARLY_ROUTE_POLICY.familiarWordRepeatCaps)) {
    if (cap !== REPEAT_CAP + 1 || !levels.some((level) => level.globalId <= EARLY_ROUTE_POLICY.throughLevel
      && level.answers.some((answer) => answer.word === word))) {
      addError(errors, 'REPEAT-03', 'Extra repetition is only allowed once for a familiar early-route answer', { word, cap });
    }
  }
  for (const level of levels.filter((entry) => entry.globalId <= EARLY_ROUTE_POLICY.throughLevel)) {
    const count = level.answers.length;
    const minimum = level.globalId <= 5 ? 2 : 3;
    const maximum = level.globalId <= 3 ? 2 : level.globalId <= 5 ? 3 : 4;
    if (count < minimum || count > maximum || level.mechanic !== 'classic' || level.bonusTarget != null) {
      addError(errors, 'EARLY-01', 'Early route must stay short with optional bonus words', { globalId: level.globalId, count });
    }
  }

  const sortedDifficulty = difficulty.sort((left, right) => left.globalId - right.globalId);
  const byGlobalId = new Map(levels.map((level) => [level.globalId, level]));
  for (const level of levels.filter((entry) => entry.globalId > PRESERVED_LEVELS)) {
    const letters = [...level.letters].sort().join('');
    const answers = new Set(level.answers.map((answer) => answer.word));
    for (let distance = 1; distance <= THIRD_ROUTE_VARIETY.letterWindow; distance += 1) {
      const previous = byGlobalId.get(level.globalId - distance);
      if (!previous) continue;
      if ([...previous.letters].sort().join('') === letters) addError(errors, 'VARIETY-01', 'Nearby levels reuse the same wheel multiset', { globalId: level.globalId, previousGlobalId: previous.globalId, distance });
      if (distance <= THIRD_ROUTE_VARIETY.answerWindow) {
        const sharedAnswers = previous.answers.map((answer) => answer.word).filter((word) => answers.has(word));
        if (sharedAnswers.length > THIRD_ROUTE_VARIETY.maxSharedAnswers) addError(errors, 'VARIETY-02', 'Nearby levels share too many mandatory answers', { globalId: level.globalId, previousGlobalId: previous.globalId, distance, sharedAnswers });
      }
    }
  }
  for (let index = 0; index < sortedDifficulty.length; index += 5) {
    const wave = sortedDifficulty.slice(index, index + 5);
    if (wave.length < 5) continue;
    // The first ten levels are a learning curve; normal five-slot waves start at 11.
    if (wave[0].globalId <= EARLY_ROUTE_POLICY.throughLevel) continue;
    const [easy, baseline, hard, breather, climax] = wave;
    if (easy.role !== 'easy' || baseline.role !== 'baseline' || hard.role !== 'hard' || breather.role !== 'breather' || climax.role !== 'climax') {
      addError(errors, 'WAVE-01', 'Wave role ordering is broken', { start: easy.globalId, roles: wave.map((entry) => entry.role) });
      continue;
    }
    if (easy.score > baseline.score || baseline.score > hard.score || breather.score >= hard.score || climax.score < hard.score) {
      addError(errors, 'WAVE-02', 'Wave score invariant is broken', {
        start: easy.globalId,
        scores: wave.map((entry) => ({ globalId: entry.globalId, role: entry.role, score: entry.score })),
      });
    }
  }

  for (const finale of WORLD_FINALES.keys()) {
    const level = sortedDifficulty.find((entry) => entry.globalId === finale);
    if (!level) addError(errors, 'WORLD-05', 'Missing world finale level', { globalId: finale });
  }
  if (sortedDifficulty.find((entry) => entry.globalId === TOTAL_LEVELS)?.milestone !== 'journey_finale') {
    addError(errors, 'WORLD-06', 'Final campaign level must be journey_finale', { globalId: TOTAL_LEVELS });
  }

  const mechanicCounts = new Map();
  for (const entry of sortedDifficulty) {
    mechanicCounts.set(entry.mechanic, (mechanicCounts.get(entry.mechanic) || 0) + 1);
  }
  for (const mechanic of ['bonus_chest', 'ordered', 'mastery']) {
    if (!mechanicCounts.get(mechanic)) addError(errors, 'MECH-07', 'Required special mechanic is absent', { mechanic });
  }

  const regression = readJson(path.join(DICT_DIR, 'curation', 'regression.json'), {});
  for (const word of regression.mustNotBeAnswer || []) {
    if (mandatoryOccurrence.has(word)) addError(errors, 'REGRESSION', 'mustNotBeAnswer word is mandatory', { word });
  }
  for (const entry of regression.mustBlock || []) {
    if (blockedWords.get(entry.word) !== entry.reason) addError(errors, 'REGRESSION', 'mustBlock entry is absent or has wrong reason', { entry });
  }
  for (const word of regression.mustAccept || []) {
    if (!rawValidWords.has(word)) addError(errors, 'REGRESSION', 'mustAccept word is absent from dictionary', { word });
  }

  return {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    inputHashes: {
      dictionary: sha256(JSON.stringify([...validWords])),
      common: sha256(JSON.stringify([...commonWords])),
      blocked: sha256(JSON.stringify(dicts.blockedEntries)),
      extensionPolicy: sha256(fs.readFileSync(path.join(ROOT, 'assets', 'content', 'extension-blocked.json'))),
      thirdRoutePolicy: sha256(fs.readFileSync(path.join(ROOT, 'assets', 'content', 'third-route-blocked.json'))),
      thirdRouteVariety: canonicalHash(THIRD_ROUTE_VARIETY),
      thirdRouteRoleAnswers: canonicalHash(THIRD_ROUTE_ROLE_ANSWERS),
      thirdRouteRootFamilies: sha256(fs.readFileSync(path.join(ROOT, 'assets', 'content', 'third-route-root-families.json'))),
      preservedPacks: sha256(fs.readFileSync(path.join(ROOT, 'assets', 'content', 'preserved-packs.json'))),
      packs: Object.fromEntries(packs.map(({ file }) => [path.basename(file), sha256(fs.readFileSync(file))])),
    },
    counts: {
      acceptedDictionary: validWords.size,
      commonDictionary: commonWords.size,
      blockedDictionary: blockedWords.size,
      levels: levels.length,
      mandatoryOccurrences: [...mandatoryOccurrence.values()].reduce((sum, count) => sum + count, 0),
      mandatoryUnique: mandatoryOccurrence.size,
      surfacedOccurrences: [...surfaceOccurrence.values()].reduce((sum, count) => sum + count, 0),
      surfacedUnique: surfaceOccurrence.size,
      mechanics: Object.fromEntries([...mechanicCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    },
    duplicates: {
      mandatory: [...mandatoryOccurrence].filter(([, count]) => count > 1).map(([word, count]) => ({ word, count })),
      surfaced: [...surfaceOccurrence].filter(([, count]) => count > 1).map(([word, count]) => ({ word, count })),
      puzzleSignatures: signatures.size,
    },
    difficulty: sortedDifficulty,
    levelChecks: levels.filter((level) => level.globalId > PRESERVED_LEVELS).map((level) => {
      const label = `${level.world}:${level.id}:${level.globalId}`;
      const mandatory = level.answers.map((answer) => answer.word);
      const surfaced = [...mandatory, ...level.acceptedBonus];
      const levelErrors = errors.filter((error) => error.level === label || error.globalId === level.globalId
        || (error.word && surfaced.includes(error.word))
        || (error.start && level.globalId >= error.start && level.globalId < error.start + 5));
      return {
        globalId: level.globalId,
        world: level.world,
        answers: mandatory,
        acceptedBonus: level.acceptedBonus,
        rows: level.grid.rows,
        cols: level.grid.cols,
        role: level.difficultyRole,
        difficultyScore: level.difficultyScore,
        mechanic: level.mechanic,
        fingerprint: level.fingerprint,
        puzzleSignature: puzzleSignature(level),
        maximumMandatoryOccurrences: Math.max(...mandatory.map((word) => mandatoryOccurrence.get(word))),
        maximumSurfacedOccurrences: Math.max(...surfaced.map((word) => surfaceOccurrence.get(word))),
        passed: levelErrors.length === 0,
        errors: levelErrors,
      };
    }),
    warnings,
    errors,
    passed: errors.length === 0,
  };
}

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  const report = audit();
  writeJsonAtomic(path.join(ROOT, 'assets', 'content', 'content-audit.json'), report);
  console.log(`content audit: ${report.passed ? 'PASS' : 'FAIL'}; errors=${report.errors.length}; levels=${report.counts.levels}`);
  if (strict && !report.passed) process.exitCode = 1;
}

module.exports = { audit, gridErrors };
