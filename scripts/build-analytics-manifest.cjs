const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function digest(paths) {
  const hash = crypto.createHash('sha256');
  for (const name of [...paths].sort()) { hash.update(name); hash.update(fs.readFileSync(path.join(root, name))); }
  return hash.digest('hex').slice(0, 24);
}
const packs = fs.readdirSync(path.join(root, 'assets/levels')).filter((n) => /^world\d+\.json$/.test(n)).map((n) => `assets/levels/${n}`);
const policy = ['src/core/config/monetization.ts', 'src/core/config/economy.ts', 'src/core/config/retention.ts', 'src/core/config/marathon.ts'];
const content = [...packs, 'assets/content/legacy-early-levels.json', 'src/features/dailypuzzle/content.ts'];
const manifest = { version: 1, catalogVersion: `catalog-${digest(content)}`, policyVersion: `policy-${digest(policy)}`, packCount: packs.length };
fs.writeFileSync(path.join(root, 'assets/content/analytics-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
