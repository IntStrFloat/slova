const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const device = 'emulator-5586';
const prefix = process.argv[2] ?? 'finger-follow-gap';
if (!/^[a-z0-9-]+$/.test(prefix)) throw new Error('Invalid evidence name');
const adb = 'C:/Users/Dima2/AppData/Local/Android/Sdk/platform-tools/adb.exe';
function run(args, binary = false) {
  const result = spawnSync(adb, ['-s', device, ...args], {
    encoding: binary ? undefined : 'utf8', timeout: 20000, maxBuffer: 16000000,
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(String(result.stderr));
  return result.stdout;
}
const foreground = run(['shell', 'dumpsys', 'activity', 'activities']);
if (!foreground.split('\n').some((line) => /topResumedActivity/.test(line) && line.includes('com.intstrfloat.slova.retentionqa/'))) {
  throw new Error('Slova QA is not foreground');
}
const inspected = spawnSync(process.execPath, [path.join(root, 'scripts/inspect-retention-qa.cjs'), device], { encoding: 'utf8' });
if (inspected.status !== 0) throw new Error(inspected.stderr);
const ui = JSON.parse(inspected.stdout);
const wheel = ui.find((node) => node.id === 'letter-disk');
const countLabel = ui.find((node) => /^Буква ., позиция 1 из \d+\.$/.test(node.label));
if (!wheel || !countLabel) throw new Error('No letter wheel');
const bounds = wheel.bounds.match(/\d+/g).map(Number);
const count = Number(countLabel.label.match(/из (\d+)/)[1]);
const density = Number([...run(['shell', 'wm', 'density']).matchAll(/(?:Override|Physical) density: (\d+)/g)].at(-1)[1]) / 160;
const diameter = bounds[2] - bounds[0];
const dpSize = diameter / density;
const tileRadius = Math.max(21, Math.min(34, dpSize * 0.106));
const radius = (dpSize / 2 - tileRadius - 10) * density;
const cx = (bounds[0] + bounds[2]) / 2;
const cy = (bounds[1] + bounds[3]) / 2;
const first = [Math.round(cx), Math.round(cy - radius)];
const gaps = [[cx + radius * 0.25, cy - radius * 0.55], [cx - radius * 0.25, cy - radius * 0.4]].map((p) => p.map(Math.round));
const positions = Array.from({ length: count }, (_, index) => {
  const angle = -Math.PI / 2 + 2 * Math.PI * index / count;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
});
if (gaps.some(([x, y]) => positions.some(([tx, ty]) => Math.hypot(x - tx, y - ty) <= (tileRadius + 10) * density))) {
  throw new Error('Probe points must lie between tiles; refusing a possible extra letter');
}
const folder = path.join(root, 'output/retention-2026-10-03');
let last = first;
try {
  run(['shell', 'input', 'motionevent', 'DOWN', ...first.map(String)]);
  for (let index = 0; index < gaps.length; index++) {
    last = gaps[index];
    run(['shell', 'input', 'motionevent', 'MOVE', ...last.map(String)]);
    const file = path.join(folder, `${prefix}-${index + 1}.png`);
    fs.writeFileSync(file, run(['exec-out', 'screencap', '-p'], true));
  }
} finally {
  // Only one letter is ever selected, so release cannot submit or award a word.
  run(['shell', 'input', 'motionevent', 'UP', ...last.map(String)]);
}
console.log(JSON.stringify({ device, first, gaps, selectedLetters: 1, submittedWords: 0 }));
