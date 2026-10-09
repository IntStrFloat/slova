#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const { createFileStore } = require('../runtime/store.cjs');
const { loadContentCatalog, createCatalogValidators } = require('../runtime/content-catalog.cjs');
const { publishWordPolicy } = require('../runtime/word-policy.cjs');

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('usage: publish-word-policy.cjs <manifest.json>');
  const dataPath = process.env.DATA_PATH || path.join('/var/lib/slova', 'store.json');
  const catalogPath = process.env.CONTENT_CATALOG_PATH;
  const catalogValidators = catalogPath ? createCatalogValidators(loadContentCatalog(catalogPath)) : {};
  const manifest = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const result = await publishWordPolicy(createFileStore(dataPath), manifest, {
    validateFallbacks: catalogValidators.validateFallbacks,
  });
  if (!result.ok) throw new Error(`policy rejected: ${result.error}`);
  process.stdout.write(`published word policy revision ${result.manifest.revision}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
