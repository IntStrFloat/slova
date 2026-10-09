const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const adb = 'C:/Users/Dima2/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const root = path.resolve(__dirname, '..');
const name = process.argv[2] ?? 'native-first-level';
const device = process.argv[3] ?? 'emulator-5574';
if (!['emulator-5574', 'emulator-5578', 'emulator-5582', 'emulator-5586'].includes(device)) throw new Error('Unknown QA device');
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid screenshot name');
const folder = path.join(root, 'output/retention-2026-10-03');
fs.mkdirSync(folder, { recursive: true });
function run(args, binary = false) {
  const result = spawnSync(adb, ['-s', device, ...args], { encoding: binary ? undefined : 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return result.stdout;
}
const activity = run(['shell', 'dumpsys', 'activity', 'activities']);
console.log(activity.split('\n').filter((line) => /ResumedActivity|topResumedActivity/.test(line)).join('\n'));
const file = path.join(folder, `${name}.png`);
fs.writeFileSync(file, run(['exec-out', 'screencap', '-p'], true));
console.log(file);
console.log('QA PID:', run(['shell', 'pidof', 'com.intstrfloat.slova.retentionqa']).trim());
