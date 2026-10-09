const fs = require('node:fs');
const { NORMALIZED_WORD } = require('./word-policy.cjs');

// Textual intro fingerprints remain reportable after a saved puzzle resumes.
const LEGACY_INTRO_CATALOG = {
  levels: {
    1: { world: 'world1', fingerprint: 'intro-v1:1:кот:кот,ток', letters: ['к', 'о', 'т'] },
    2: { world: 'world1', fingerprint: 'intro-v1:2:сон:сон,нос', letters: ['с', 'о', 'н'] },
    3: { world: 'world1', fingerprint: 'intro-v1:3:дело:дело,лед', letters: ['д', 'е', 'л', 'о'] },
    4: { world: 'world1', fingerprint: 'intro-v1:4:рост:рост,рот,трос', letters: ['р', 'о', 'с', 'т'] },
    5: { world: 'world1', fingerprint: 'intro-v1:5:клуб:клуб,лук,куб,бук', letters: ['к', 'л', 'у', 'б'] },
  },
};

const INTRO_CATALOG = {
  levels: {
    1: { world: 'world1', fingerprint: 'intro-v2:1:кот:кот,ток', letters: ['к', 'о', 'т'] },
    2: { world: 'world1', fingerprint: 'intro-v2:2:сон:сон,нос', letters: ['с', 'о', 'н'] },
    3: { world: 'world1', fingerprint: 'intro-v2:3:дело:дело,лед', letters: ['д', 'е', 'л', 'о'] },
    4: { world: 'world1', fingerprint: 'intro-v2:4:рост:рост,рот,трос', letters: ['р', 'о', 'с', 'т'] },
    5: { world: 'world1', fingerprint: 'intro-v2:5:клуб:клуб,лук,куб', letters: ['к', 'л', 'у', 'б'] },
  },
};
const INTRO_CATALOGS = { 'intro-v1': LEGACY_INTRO_CATALOG, 'intro-v2': INTRO_CATALOG };

function isKnownIntroReport(report) {
  if (!report || report.mode !== 'normal' ||
      report.world !== 'world1' || !Number.isSafeInteger(report.globalLevel)) return false;
  const level = INTRO_CATALOGS[report.contentVersion]?.levels?.[report.globalLevel];
  return Boolean(level && level.fingerprint === report.levelFingerprint);
}

function constructible(letters, word) {
  if (!Array.isArray(letters) || !NORMALIZED_WORD.test(word)) return false;
  const available = new Map();
  for (const letter of letters) available.set(letter, (available.get(letter) ?? 0) + 1);
  for (const letter of word) {
    const remaining = available.get(letter) ?? 0;
    if (remaining < 1) return false;
    available.set(letter, remaining - 1);
  }
  return true;
}

function loadContentCatalog(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// The catalog deliberately contains only shipped content metadata, never remote layouts.
// Expected shape: { contentVersions: { [version]: { levels: { [globalId]: { world, fingerprint, letters } }, fallbacks?: { [fallbackId]: { replacesGlobalId, auditHash } } } } }.
function createCatalogValidators(catalog) {
  if (!catalog || !catalog.contentVersions || typeof catalog.contentVersions !== 'object') return {};
  const versionFor = (version) => INTRO_CATALOGS[version] ?? catalog.contentVersions[version];
  return {
    validateReportContext(report) {
      const version = versionFor(report.contentVersion);
      const level = version && version.levels && version.levels[String(report.globalLevel)];
      if (!level || level.world !== report.world || level.fingerprint !== report.levelFingerprint) return 'unknown_content_level';
      return constructible(level.letters, report.normalizedWord) || 'unconstructible_word';
    },
    validateFallbacks(manifest) {
      const version = versionFor(manifest.contentVersion);
      if (!version || !version.fallbacks) return 'unknown_fallback_pack';
      return Object.entries(manifest.fallbackByGlobalLevel).every(([globalLevel, fallbackId]) => {
        const fallback = version.fallbacks[fallbackId];
        return fallback && Number(fallback.replacesGlobalId) === Number(globalLevel) && typeof fallback.auditHash === 'string' && fallback.auditHash.length > 0;
      }) || 'invalid_policy_fallback';
    },
  };
}

module.exports = { loadContentCatalog, createCatalogValidators, INTRO_CATALOG, INTRO_CATALOGS, isKnownIntroReport };
