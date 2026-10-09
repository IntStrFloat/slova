const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const device = 'emulator-5586';
const adb = 'C:/Users/Dima2/AppData/Local/Android/Sdk/platform-tools/adb.exe';
function run(args, binary = false) {
  const result = spawnSync(adb, ['-s', device, ...args], { encoding: binary ? undefined : 'utf8', timeout: 20000, maxBuffer: 16000000 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(String(result.stderr));
  return result.stdout;
}
if (!run(['shell', 'dumpsys', 'activity', 'activities']).split('\n').some((line) => /topResumedActivity/.test(line) && line.includes('com.intstrfloat.slova.retentionqa/'))) {
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
if (count < 3 || count > 8) throw new Error('Unknown wheel geometry');
const density = Number([...run(['shell', 'wm', 'density']).matchAll(/(?:Override|Physical) density: (\d+)/g)].at(-1)[1]) / 160;
const diameter = bounds[2] - bounds[0];
const tileRadius = Math.max(21, Math.min(34, diameter / density * 0.106));
const radius = (diameter / density / 2 - tileRadius - 10) * density;
const cx = (bounds[0] + bounds[2]) / 2;
const cy = (bounds[1] + bounds[3]) / 2;
const first = [Math.round(cx), Math.round(cy - radius)];
const positions = Array.from({ length: count }, (_, index) => {
  const angle = -Math.PI / 2 + 2 * Math.PI * index / count;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
});
const second = positions[1].map(Math.round);
const ux = (second[0] - cx) / radius;
const uy = (second[1] - cy) / radius;
const cursor = [[0.55, 0.4], [0.4, 0.4], [0.55, -0.4], [0.35, 0.4]]
  .map(([radial, sideways]) => [Math.round(cx + radius * (radial * ux - sideways * uy)), Math.round(cy + radius * (radial * uy + sideways * ux))])
  .find(([x, y]) => positions.every(([tx, ty]) => Math.hypot(x - tx, y - ty) > (tileRadius + 10) * density)
    && (Math.abs(x - cx) > 50 * density || Math.abs(y - cy) > 30 * density));
if (!cursor) throw new Error('No safe gap outside the word pill; refusing another letter');
const folder = path.join(root, 'output/retention-2026-10-03');
const imagePath = path.join(folder, 'uniform-selection-native.png');
try {
  run(['shell', 'input', 'motionevent', 'DOWN', ...first.map(String)]);
  run(['shell', 'input', 'motionevent', 'MOVE', ...second.map(String)]);
  run(['shell', 'input', 'motionevent', 'MOVE', ...cursor.map(String)]);
  fs.writeFileSync(imagePath, run(['exec-out', 'screencap', '-p'], true));
} finally {
  // Two letters cannot submit a word: this preserves the manual-test profile.
  run(['shell', 'input', 'motionevent', 'UP', ...cursor.map(String)]);
}
const report = {
  imagePath, device, selectedLetters: 2, submittedWords: 0,
  samples: {
    fill: [Math.round(first[0] + (tileRadius + 8) * density * 0.65), first[1]],
    outline: [Math.round(first[0] + (tileRadius + 7) * density), first[1]],
    connection: [Math.round((first[0] + second[0]) / 2), Math.round((first[1] + second[1]) / 2)],
    leading: cursor,
  }, first, second, cursor,
};
fs.writeFileSync(path.join(folder, 'uniform-selection-native.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
