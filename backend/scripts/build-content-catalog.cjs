#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { INTRO_CATALOGS } = require('../runtime/content-catalog.cjs');

const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9._-]{1,128}$/;
const LETTER = /^[а-я]$/;

/** Metadata only: layouts and answers never enter the server catalog. */
function buildContentCatalog(levelsDir) {
  const versions = Object.fromEntries(Object.entries(INTRO_CATALOGS)
    .map(([version, catalog]) => [version, { levels: { ...catalog.levels } }]));
  const files = fs.readdirSync(levelsDir).filter((name) => /^world\d+\.json$/.test(name));
  if (files.length === 0) throw new Error('No shipped world packs found');
  for (const file of files) {
    const pack = JSON.parse(fs.readFileSync(path.join(levelsDir, file), 'utf8'));
    if (!Array.isArray(pack.levels) || pack.world !== file.slice(0, -5)) {
      throw new Error(`Invalid world pack: ${file}`);
    }
    for (const level of pack.levels) {
      const version = level.contentVersion ?? pack.contentVersion;
      if (typeof version !== 'string' || !VERSION.test(version) || INTRO_CATALOGS[version] ||
          !Number.isSafeInteger(level.globalId) || level.globalId < 1 || level.globalId > 1000 ||
          !SHA256.test(level.fingerprint) || level.world !== pack.world ||
          !Array.isArray(level.letters) || level.letters.length < 3 ||
          level.letters.some((letter) => !LETTER.test(letter))) {
        throw new Error(`Invalid level metadata: ${file}:${level.id}`);
      }
      const entry = versions[version] ??= { levels: {} };
      if (entry.levels[level.globalId]) throw new Error(`Duplicate level ${level.globalId} in ${version}`);
      entry.levels[level.globalId] = {
        world: level.world,
        fingerprint: level.fingerprint,
        letters: level.letters,
      };
    }
  }
  // Saved normal puzzles and independently pinned daily templates still use
  // these shipped SHA identities after the first-ten campaign revision.
  const archiveFile = path.resolve(levelsDir, '../content/legacy-early-levels.json');
  if (fs.existsSync(archiveFile)) {
    const archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
    for (const level of archive.campaign ?? []) {
      if (typeof level.contentVersion !== 'string' || !VERSION.test(level.contentVersion) || INTRO_CATALOGS[level.contentVersion]
        || !SHA256.test(level.fingerprint) || level.world !== 'world1'
        || !Number.isSafeInteger(level.globalId) || level.globalId < 1 || level.globalId > 10
        || !Array.isArray(level.letters) || level.letters.length < 3
        || level.letters.some((letter) => !LETTER.test(letter))) {
        throw new Error(`Invalid archived level metadata: ${level.globalId}`);
      }
      const entry = versions[level.contentVersion] ??= { levels: {} };
      const existing = entry.levels[level.globalId];
      if (existing && existing.fingerprint !== level.fingerprint) {
        throw new Error(`Conflicting archived level ${level.globalId} in ${level.contentVersion}`);
      }
      entry.levels[level.globalId] = {
        world: level.world, fingerprint: level.fingerprint, letters: level.letters,
      };
    }
  }
  return { schemaVersion: 1, contentVersions: versions };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('Usage: node backend/scripts/build-content-catalog.cjs --output /absolute/path/content-catalog.json');
    process.exitCode = 1;
  } else {
    try {
      const output = path.resolve(args[1]);
      const levelsDir = path.resolve(__dirname, '../../assets/levels');
      const catalog = buildContentCatalog(levelsDir);
      fs.writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(`Wrote ${output}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { buildContentCatalog };
