const { spawnSync } = require('node:child_process');
const adb = 'C:/Users/Dima2/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const device = process.argv[2];
if (!['emulator-5574', 'emulator-5578', 'emulator-5582', 'emulator-5586'].includes(device)) throw new Error('Unknown QA device');
const label = process.argv[3] === 'label' ? process.argv[4] : null;
const word = process.argv[3] === 'word' ? process.argv[4] : null;
let points = label || word ? [] : process.argv.slice(3).map(Number);
function run(args) {
  const result = spawnSync(adb, ['-s', device, ...args], { encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}
const resumed = run(['shell', 'dumpsys', 'activity', 'activities']).split('\n').filter((line) => /topResumedActivity|ResumedActivity:/.test(line));
if (!resumed.some((line) => line.includes('com.intstrfloat.slova.retentionqa/'))) throw new Error('QA app is not foreground; refusing to touch another app');
if (label || word) {
  run(['shell', 'uiautomator', 'dump', '/sdcard/slova-retention-qa.xml']);
  const xml = run(['shell', 'cat', '/sdcard/slova-retention-qa.xml']);
  const nodes = [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]])));
  if (word) {
    if (!/^[а-яё]{3,8}$/i.test(word)) throw new Error('Invalid QA word');
    const wheel = nodes.find((node) => node['resource-id'] === 'letter-disk');
    if (!wheel) throw new Error('No visible letter wheel');
    const bounds = wheel.bounds.match(/\d+/g).map(Number);
    const density = Number([...run(['shell', 'wm', 'density']).matchAll(/(?:Override|Physical) density: (\d+)/g)].at(-1)?.[1]);
    if (!density) throw new Error('Unknown Android density');
    const diameter = bounds[2] - bounds[0];
    const dpSize = diameter / (density / 160);
    const tileRadius = Math.max(21, Math.min(34, dpSize * 0.106));
    const radius = (dpSize / 2 - tileRadius - 10) * density / 160;
    const letters = nodes.map((node) => node['content-desc'].match(/^Буква (.), позиция (\d+) из (\d+)\.$/)).filter(Boolean).sort((a, b) => Number(a[2]) - Number(b[2])).map((match) => match[1].toLowerCase());
    const used = new Set();
    points = [...word.toLowerCase()].flatMap((letter) => {
      const index = letters.findIndex((value, position) => value === letter && !used.has(position));
      if (index < 0) throw new Error(`Word ${word} cannot be selected from the visible letters`);
      used.add(index);
      const angle = -Math.PI / 2 + 2 * Math.PI * index / letters.length;
      return [Math.round((bounds[0] + bounds[2]) / 2 + radius * Math.cos(angle)), Math.round((bounds[1] + bounds[3]) / 2 + radius * Math.sin(angle))];
    });
  } else {
  const matches = nodes.filter((node) => node.package === 'com.intstrfloat.slova.retentionqa' && node.clickable === 'true' && node.enabled === 'true' &&
    (node['content-desc'] === label || node.text === label || node['content-desc']?.endsWith(`, ${label}`)));
  if (matches.length !== 1) throw new Error(`Expected one enabled visible button ${label}; found ${matches.length}`);
  const bounds = matches[0].bounds.match(/\d+/g).map(Number);
  if (bounds[2] - bounds[0] < 10 || bounds[3] - bounds[1] < 10) throw new Error('Button has no usable visible bounds');
  points = [Math.round((bounds[0] + bounds[2]) / 2), Math.round((bounds[1] + bounds[3]) / 2)];
  }
}
if (points.length < 2 || points.length % 2 || points.some((value) => !Number.isFinite(value) || value < 0 || value > 3000)) throw new Error('Invalid input coordinates');
if (points.length === 2) run(['shell', 'input', 'tap', String(points[0]), String(points[1])]);
else {
  run(['shell', 'input', 'motionevent', 'DOWN', String(points[0]), String(points[1])]);
  for (let index = 2; index < points.length; index += 2) run(['shell', 'input', 'motionevent', 'MOVE', String(points[index]), String(points[index + 1])]);
  run(['shell', 'input', 'motionevent', 'UP', String(points.at(-2)), String(points.at(-1))]);
}
console.log('QA input completed');
