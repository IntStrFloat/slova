const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildContentCatalog } = require('../build-content-catalog.cjs');
const { createCatalogValidators, INTRO_CATALOGS, isKnownIntroReport } = require('../../runtime/content-catalog.cjs');

test('catalog includes the five installed intro fingerprints and shipped SHA levels', () => {
  const catalog = buildContentCatalog(path.resolve(__dirname, '../../../assets/levels'));
  assert.equal(catalog.schemaVersion, 1);
  for (const [version, intro] of Object.entries(INTRO_CATALOGS)) {
    assert.deepEqual(catalog.contentVersions[version].levels, intro.levels);
  }
  const versions = Object.keys(catalog.contentVersions).filter((version) => !INTRO_CATALOGS[version]);
  const count = versions.reduce((sum, version) => sum + Object.keys(catalog.contentVersions[version].levels).length, 0);
  const { campaign: archived } = require('../../../assets/content/legacy-early-levels.json');
  assert.equal(count, 1500 + archived.length);
  const validator = createCatalogValidators(catalog).validateReportContext;
  for (const [version, intro] of Object.entries(INTRO_CATALOGS)) {
    for (const [id, level] of Object.entries(intro.levels)) {
      const report = { contentVersion: version, globalLevel: Number(id), world: 'world1', mode: 'normal',
        levelFingerprint: level.fingerprint, normalizedWord: level.letters.join('') };
      assert.equal(isKnownIntroReport(report), true);
      assert.equal(validator(report), true);
      assert.equal(validator({ ...report, normalizedWord: 'ттт' }), 'unconstructible_word');
      assert.equal(isKnownIntroReport({ ...report, mode: 'daily' }), false);
    }
  }
  assert.equal(isKnownIntroReport({ contentVersion: 'unknown', mode: 'normal', world: 'world1', globalLevel: 1 }), false);
  const campaign = require('../../../assets/levels/world1.json');
  const first = campaign.levels[0];
  assert.equal(validator({
    contentVersion: first.contentVersion, globalLevel: first.globalId, world: first.world,
    levelFingerprint: first.fingerprint, normalizedWord: first.answers[0].word,
  }), true);
  for (const level of archived) {
    assert.equal(validator({ contentVersion: level.contentVersion, globalLevel: level.globalId, world: level.world,
      levelFingerprint: level.fingerprint, normalizedWord: level.answers[0].word }), true);
    assert.deepEqual(Object.keys(catalog.contentVersions[level.contentVersion].levels[level.globalId]).sort(),
      ['fingerprint', 'letters', 'world']);
  }
});

test('third-route catalog validates the actual first and final shipped fingerprints', () => {
  const catalog = buildContentCatalog(path.resolve(__dirname, '../../../assets/levels'));
  const validate = createCatalogValidators(catalog).validateReportContext;
  for (const [world, localIndex, globalId] of [['world15', 0, 1001], ['world21', 69, 1500]]) {
    const level = require(`../../../assets/levels/${world}.json`).levels[localIndex];
    assert.equal(level.globalId, globalId);
    const metadata = catalog.contentVersions[level.contentVersion].levels[globalId];
    assert.deepEqual(metadata, { world, fingerprint: level.fingerprint, letters: level.letters });
    const context = { contentVersion: level.contentVersion, globalLevel: globalId, world,
      levelFingerprint: level.fingerprint, normalizedWord: level.answers[0].word };
    assert.equal(validate(context), true);
    assert.equal(validate({ ...context, globalLevel: 1501 }), 'unknown_content_level');
    assert.equal(validate({ ...context, world: 'world1' }), 'unknown_content_level');
  }
});

test('the replacement L9 has a distinct report identity while the saved L9 remains valid', () => {
  const catalog = buildContentCatalog(path.resolve(__dirname, '../../../assets/levels'));
  const validate = createCatalogValidators(catalog).validateReportContext;
  const current = require('../../../assets/levels/world1.json').levels[8];
  const previous = require('../../../assets/content/legacy-early-levels.json').campaign
    .find((level) => level.globalId === 9 && level.contentVersion.startsWith('retention-early-v2'));
  assert.notEqual(current.contentVersion, previous.contentVersion);
  assert.notEqual(current.fingerprint, previous.fingerprint);
  for (const level of [current, previous]) {
    for (const answer of level.answers) {
      const context = { contentVersion: level.contentVersion, globalLevel: 9, world: 'world1',
        mode: 'normal', levelFingerprint: level.fingerprint, normalizedWord: answer.word };
      assert.equal(validate(context), true);
      assert.equal(validate({ ...context, levelFingerprint: 'a'.repeat(64) }), 'unknown_content_level');
    }
  }
});
