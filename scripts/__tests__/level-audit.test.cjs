const assert = require('node:assert/strict');
const { test } = require('node:test');
const { gridErrors } = require('../audit-content');
const { WORLD_SPECS, THIRD_ROUTE_BLOCKED, THIRD_ROUTE_VARIETY, THIRD_ROUTE_ROOT_FAMILIES, fillDeferredBonus, generateWorld, loadDicts, localVarietyConflicts, milestoneFor, mechanicFor, sameRoot, sameThirdRouteRoot } = require('../gen-levels');

function tinyCrossword() {
  const horizontal = [{ row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' }];
  const vertical = [{ row: 0, col: 0, ch: 'к' }, { row: 1, col: 0, ch: 'и' }, { row: 2, col: 0, ch: 'т' }];
  return {
    grid: { rows: 3, cols: 3, cells: [...horizontal, ...vertical.slice(1)] },
    answers: [{ word: 'кот', dir: 'H', cells: horizontal }, { word: 'кит', dir: 'V', cells: vertical }],
  };
}

test('independent board audit accepts a connected crossword', () => {
  assert.deepEqual(gridErrors(tinyCrossword()), []);
});

test('independent board audit catches direction, glyph and bounds corruption', () => {
  const level = tinyCrossword();
  level.answers[0].dir = 'V';
  level.grid.cells[0] = { row: 0, col: 0, ch: 'х' };
  level.grid.cells.push({ row: 3, col: 0, ch: 'а' });
  const errors = gridErrors(level);
  assert(errors.some((error) => error.startsWith('nonlinear_answer:')));
  assert(errors.some((error) => error.startsWith('character_mismatch:')));
  assert(errors.some((error) => error.startsWith('out_of_bounds:')));
  assert(errors.some((error) => error.startsWith('uncovered_cell:')));
});

test('independent board audit catches accidental contacts and isolated cells', () => {
  const level = tinyCrossword();
  level.grid.cells.push({ row: 1, col: 1, ch: 'а' }, { row: 2, col: 2, ch: 'я' });
  const errors = gridErrors(level);
  assert(errors.some((error) => error.startsWith('side_touch:')));
  assert(errors.includes('disconnected_board'));
});

test('extension keeps released finales while adding the third route rhythm', () => {
  for (const id of [500, 1000, 1500]) assert.equal(milestoneFor(id), 'journey_finale');
  assert.equal(milestoneFor(1090), 'world_finale');
  for (const id of [1045, 1125, 1205, 1285, 1365, 1445]) assert.equal(milestoneFor(id), 'landmark');
  for (const id of [1075, 1145, 1225, 1305, 1385, 1465]) assert.equal(mechanicFor(id), 'ordered');
  for (const id of [1210, 1290, 1350, 1410, 1490]) assert.equal(mechanicFor(id), 'mastery');
  assert.equal(WORLD_SPECS.slice(14).reduce((sum, spec) => sum + spec.count, 0), 500);
});

test('third-route editorial exclusions cannot surface and remain explicitly blocked', () => {
  const dicts = loadDicts();
  const selected = new Set(['бумеранг', 'бармен', 'гурман', 'набег', 'гарем', 'берман']);
  const level = generateWorld({
    world: 'world15', count: 1, globalOffset: 1000,
    dicts: { ...dicts, commonEntries: dicts.commonEntries.filter((entry) => selected.has(entry.w)) },
    usedBases: new Set(), contentVersion: 'exclusion-regression',
  }).levels[0];
  const blocked = new Set(THIRD_ROUTE_BLOCKED.map((entry) => entry.word));
  for (const word of [...level.answers.map((answer) => answer.word), ...level.acceptedBonus]) assert(!blocked.has(word));
  assert(level.blockedPool.some((entry) => entry.word === 'берман' && entry.reason === 'proper_name'));
});

test('mandatory-first planning fills deterministic bonuses within the shared appearance budget', () => {
  const dicts = loadDicts();
  const selected = new Set(['бумеранг', 'бармен', 'гурман', 'набег', 'гарем', 'берман']);
  const plan = () => {
    const surfaceUsage = new Map();
    const levels = generateWorld({
      world: 'world15', count: 1, globalOffset: 1000,
      dicts: { ...dicts, commonEntries: dicts.commonEntries.filter((entry) => selected.has(entry.w)) },
      usedBases: new Set(), contentVersion: 'deferred-regression', surfaceUsage, deferBonus: true,
    }).levels;
    assert.deepEqual(levels[0].acceptedBonus, []);
    fillDeferredBonus(levels, dicts, surfaceUsage);
    assert(levels[0].acceptedBonus.length > 0);
    assert(levels[0].acceptedBonus.length <= 14);
    assert.deepEqual(levels[0].bonusPool, levels[0].acceptedBonus);
    assert.deepEqual(levels[0].rewardedBonus, levels[0].acceptedBonus);
    for (const count of surfaceUsage.values()) assert(count <= 3);
    return levels;
  };
  assert.deepEqual(plan(), plan());
});

test('local variety checks have exact bounded windows including the preserved tail', () => {
  const level = { ...tinyCrossword(), globalId: 1001, letters: ['к', 'о', 'т'] };
  assert.deepEqual(THIRD_ROUTE_VARIETY, { letterWindow: 20, answerWindow: 5, maxSharedAnswers: 2 });
  assert.equal(localVarietyConflicts(level, [{ ...level, globalId: 981 }]).filter((error) => error.kind === 'letters').length, 1);
  assert.deepEqual(localVarietyConflicts(level, [{ ...level, globalId: 980 }]), []);
  const overlapping = { ...level, globalId: 996, letters: ['м'], answers: [...level.answers, { word: 'том' }] };
  const candidate = { ...level, answers: [...level.answers, { word: 'том' }] };
  assert.equal(localVarietyConflicts(candidate, [overlapping]).filter((error) => error.kind === 'answers').length, 1);
  assert.deepEqual(localVarietyConflicts(candidate, [{ ...overlapping, globalId: 995 }]), []);
});

test('candidate selection rejects nearby duplicate wheels instead of weakening the guard', () => {
  const dicts = loadDicts();
  const selected = new Set(['бумеранг', 'бармен', 'гурман', 'набег', 'гарем', 'берман']);
  assert.throws(() => generateWorld({
    world: 'world15', count: 1, globalOffset: 1000,
    dicts: { ...dicts, commonEntries: dicts.commonEntries.filter((entry) => selected.has(entry.w)) },
    usedBases: new Set(), contentVersion: 'variety-regression', deferBonus: true,
    recentLevels: [{ globalId: 1000, letters: [...'бумеранг'], answers: [] }],
  }), /Unable to build level 1001/);
});

test('unsatisfiable planning rolls back chosen bases, word budgets, signatures and history', () => {
  const dicts = loadDicts();
  const selected = new Set(['бумеранг', 'бармен', 'гурман', 'набег', 'гарем', 'берман']);
  const usedBases = new Set();
  const answerUsage = new Map();
  const surfaceUsage = new Map();
  const signatures = new Set();
  const recentLevels = [];
  assert.throws(() => generateWorld({
    world: 'world15', count: 2, globalOffset: 1000,
    dicts: { ...dicts, commonEntries: dicts.commonEntries.filter((entry) => selected.has(entry.w)) },
    usedBases, answerUsage, surfaceUsage, signatures, recentLevels,
    contentVersion: 'rollback-regression', deferBonus: true,
  }), /Unable to build level 1002/);
  assert.equal(usedBases.size, 0);
  assert.equal(answerUsage.size, 0);
  assert.equal(surfaceUsage.size, 0);
  assert.equal(signatures.size, 0);
  assert.deepEqual(recentLevels, []);
});

test('curated root families close editorial gaps without changing released root matching', () => {
  assert.equal(sameRoot('сигара', 'сигарета'), false);
  assert.equal(sameThirdRouteRoot('сигара', 'сигарета'), true);
  for (const words of THIRD_ROUTE_ROOT_FAMILIES) {
    for (const left of words) for (const right of words) assert(sameThirdRouteRoot(left, right));
  }
  assert.equal(sameThirdRouteRoot('сигара', 'пиджак'), false);
});
