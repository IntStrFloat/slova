const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const device = process.argv[2] ?? 'emulator-5582';
const command = (script, args) => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), device, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};
const levels = [['кот', 'ток'], ['сон', 'нос'], ['дело', 'лед'], ['рост', 'рот', 'трос'], ['клуб', 'лук', 'куб']];
for (let index = 0; index < levels.length; index++) {
  const ui = JSON.parse(command('inspect-retention-qa.cjs', []));
  if (!ui.some((node) => node.text === `Уровень ${index + 1}`)) throw new Error(`Expected actual level ${index + 1}`);
  for (const word of levels[index]) command('input-retention-qa.cjs', ['word', word]);
  const result = JSON.parse(command('inspect-retention-qa.cjs', []));
  if (!result.some((node) => node.label === (index === 4 ? 'Продолжить уровни' : 'Далее') && node.enabled === 'true')) {
    throw new Error(`Level ${index + 1} did not reach a saved victory`);
  }
  console.log(`Native level ${index + 1}: saved victory verified`);
  if (index < 4) command('input-retention-qa.cjs', ['label', 'Далее']);
}
