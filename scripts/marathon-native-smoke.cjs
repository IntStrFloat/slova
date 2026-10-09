const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/marathon-2026-10/native');
const adb = 'C:/Users/Dima2/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const device = 'emulator-5574';
const qa = 'com.intstrfloat.slova.marathonqa';
const production = 'com.intstrfloat.slova';
const mode = process.argv[2] ?? 'all';
fs.mkdirSync(output, { recursive: true });

function run(args, binary = false, timeout = 30_000) {
  const result = spawnSync(adb, ['-s', device, ...args], {
    encoding: binary ? undefined : 'utf8', timeout, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(String(result.stderr || result.stdout));
  return result.stdout;
}
function wait(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function assert(value, message) { if (!value) throw new Error(message); }
function foreground(packageName) {
  const activities = run(['shell', 'dumpsys', 'activity', 'activities']);
  assert(activities.split('\n').some((line) => /topResumedActivity|ResumedActivity:/.test(line)
    && line.includes(`${packageName}/`)), `Expected ${packageName} in foreground`);
}
function ui(packageName, name) {
  foreground(packageName);
  let dumped = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = run(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/slova-marathon-qa.xml']);
    if (result.includes('dumped to:')) { dumped = true; break; }
    wait(1000);
  }
  assert(dumped, 'UIAutomator did not produce a fresh XML hierarchy');
  const xml = run(['shell', 'cat', '/sdcard/slova-marathon-qa.xml']);
  const nodes = [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
  )).filter((node) => node.package === packageName);
  if (name) fs.writeFileSync(path.join(output, `${name}.xml`), xml);
  return nodes;
}
function has(nodes, text) { return nodes.some((node) => node.text.includes(text) || node['content-desc'].includes(text)); }
function capture(packageName, name) {
  const nodes = ui(packageName, name);
  fs.writeFileSync(path.join(output, `${name}.png`), run(['exec-out', 'screencap', '-p'], true));
  fs.writeFileSync(path.join(output, `${name}.nodes.json`), JSON.stringify(nodes, null, 2));
  console.log(`SCREENSHOT_READY ${name}.png`);
  return nodes;
}
function launch(packageName, route = 'marathon') {
  run(['shell', 'am', 'force-stop', packageName]);
  run(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `slova://${route}`, '-p', packageName]);
  wait(2000);
}
function bounds(node) { return node.bounds.match(/\d+/g).map(Number); }
function tap(packageName, label) {
  assert(packageName === qa, 'Input is restricted to the isolated marathon QA profile');
  const nodes = ui(packageName);
  const matches = nodes.filter((node) => node.clickable === 'true' && node.enabled === 'true'
    && (node['content-desc'] === label || node.text === label || node['content-desc'].endsWith(`, ${label}`)));
  assert(matches.length === 1, `Expected one enabled ${label}; found ${matches.length}`);
  const [x1, y1, x2, y2] = bounds(matches[0]);
  assert(x2 - x1 >= 10 && y2 - y1 >= 10, 'Button has no visible area');
  run(['shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))]);
  wait(1500);
}
function word(text) {
  assert(/^[а-яё]{3,8}$/i.test(text), 'Invalid QA word');
  const nodes = ui(qa);
  const wheel = nodes.find((node) => node['resource-id'] === 'letter-disk');
  assert(wheel, 'No visible letter wheel');
  const box = bounds(wheel);
  const density = Number([...run(['shell', 'wm', 'density']).matchAll(/(?:Override|Physical) density: (\d+)/g)].at(-1)?.[1]);
  assert(density > 0, 'Unknown device density');
  const dpSize = (box[2] - box[0]) / (density / 160);
  const tileRadius = Math.max(21, Math.min(34, dpSize * 0.106));
  const radius = (dpSize / 2 - tileRadius - 10) * density / 160;
  const letters = nodes.map((node) => node['content-desc'].match(/^Буква (.), позиция (\d+) из (\d+)\.$/))
    .filter(Boolean).sort((a, b) => Number(a[2]) - Number(b[2])).map((match) => match[1].toLowerCase());
  const used = new Set();
  const points = [...text.toLowerCase()].map((letter) => {
    const index = letters.findIndex((value, position) => value === letter && !used.has(position));
    assert(index >= 0, `Cannot select ${text} from actual visible letters`);
    used.add(index);
    const angle = -Math.PI / 2 + 2 * Math.PI * index / letters.length;
    return [Math.round((box[0] + box[2]) / 2 + radius * Math.cos(angle)), Math.round((box[1] + box[3]) / 2 + radius * Math.sin(angle))];
  });
  run(['shell', 'input', 'motionevent', 'DOWN', ...points[0].map(String)]);
  for (const point of points.slice(1)) run(['shell', 'input', 'motionevent', 'MOVE', ...point.map(String)]);
  run(['shell', 'input', 'motionevent', 'UP', ...points.at(-1).map(String)]);
  wait(800);
}
function balance(nodes) {
  const badges = nodes.filter((node) => /^\d+$/.test(node.text)
    && bounds(node)[0] > 540 && bounds(node)[3] < 250);
  assert(badges.length === 1, 'Expected one numeric coin balance in the visible header');
  return Number(badges[0].text);
}
function setDate(iso) {
  run(['shell', 'settings', 'put', 'global', 'auto_time', '0']);
  run(['shell', 'date', '-u', `@${Math.floor(Date.parse(iso) / 1000)}`]);
  const actual = Number(run(['shell', 'date', '+%s']).trim());
  assert(Math.abs(actual - Date.parse(iso) / 1000) < 30, 'Emulator date did not change');
}

// Utility commands intentionally only act on the dedicated QA package.
if (mode === 'inspect') { console.log(JSON.stringify(ui(qa), null, 2)); process.exit(0); }
if (mode === 'tap') { tap(qa, process.argv[3]); process.exit(0); }
if (mode === 'word') { word(process.argv[3]); process.exit(0); }
if (mode === 'capture') { capture(qa, process.argv[3]); process.exit(0); }

assert(['all', '--production-only', '--qa-only', '--production-final', '--replay'].includes(mode), 'Unknown smoke mode');
assert(run(['shell', 'getprop', 'ro.kernel.qemu']).trim() === '1', 'QA requires an emulator');
assert(run(['shell', 'getprop', 'ro.boot.qemu.avd_name']).trim() === 'Slova_Test_API35', 'Wrong emulator; refusing date/profile changes');
run(['root']);
run(['wait-for-device']);
const original = {
  autoTime: run(['shell', 'settings', 'get', 'global', 'auto_time']).trim(),
  airplaneMode: run(['shell', 'settings', 'get', 'global', 'airplane_mode_on']).trim(),
  wifi: run(['shell', 'settings', 'get', 'global', 'wifi_on']).trim(),
  data: run(['shell', 'settings', 'get', 'global', 'mobile_data']).trim(),
};
const evidencePath = path.join(output, mode === '--production-final' ? 'production-final-verification.json'
  : mode === '--replay' ? 'verification-replay.json' : 'verification.json');
const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : {};
delete evidence.error;
evidence.device = device;
evidence.avd = 'Slova_Test_API35';
evidence.startedAt = new Date().toISOString();
evidence.networkOffline = true;
const apk = path.join(root, 'output/release/slova-0.1.14-vc18-release.apk');
evidence.productionApkSha256 = createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
if (mode === '--production-final') {
  assert(evidence.productionApkSha256 === '8479d9f694b3e847cd03c022ee05e782ae06618dde82dfb6afbba829b5914f70',
    'Frozen final production APK hash differs');
}
if (mode === '--replay') {
  assert(evidence.productionApkSha256 === '8479d9f694b3e847cd03c022ee05e782ae06618dde82dfb6afbba829b5914f70',
    'Production APK does not contain the reviewed presentation-replay fix');
}
try {
  run(['shell', 'svc', 'wifi', 'disable']);
  run(['shell', 'svc', 'data', 'disable']);
  run(['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable']);
  wait(1500);
  evidence.offlineConnectivity = run(['shell', 'dumpsys', 'connectivity']).split('\n')
    .filter((line) => /Active default network|NetworkAgentInfo/.test(line));
  assert(evidence.offlineConnectivity.some((line) => /Active default network: (none|null)/.test(line)), 'Device still has a default network');
  if (mode !== '--qa-only') {
    console.log(run(['install', '-r', apk], false, 120_000).trim());
    const packageInfo = run(['shell', 'dumpsys', 'package', production]);
    const versionCode = Number(packageInfo.match(/versionCode=(\d+)/)?.[1]);
    const versionName = packageInfo.match(/versionName=([^\s]+)/)?.[1];
    assert(versionCode === 18 && versionName === '0.1.14', 'Unexpected installed production version');
    launch(production);
    const upcoming = capture(production, mode === '--production-final' ? 'production-upcoming-final'
      : mode === '--replay' ? 'production-upcoming-replay' : 'production-upcoming');
    assert(has(upcoming, 'Начнётся 26 октября'), 'Final production APK does not show upcoming marathon');
    evidence.production = { installed: true, versionCode, versionName, coldStart: true,
      deepLink: 'slova://marathon', upcoming: true, offline: true };
    if (mode === '--production-final') {
      const before = balance(upcoming);
      setDate('2026-10-26T09:00:00.000Z');
      launch(production);
      const active = capture(production, 'production-active-final');
      assert(has(active, 'Играть в марафоне') && (has(active, 'из 7 этапов') || has(active, 'Все этапы пройдены!')),
        'Frozen final production APK does not show active marathon');
      assert(balance(active) === before, 'Viewing active event unexpectedly changed the production balance');
      assert(!has(active, 'Этап 1 · Этап 1'), 'Final UI still duplicates tier titles');
      evidence.production.active = true;
      evidence.production.profileCleared = false;
      evidence.production.gameplayActions = [];
      evidence.production.upcomingCoins = before;
      evidence.production.activeCoins = balance(active);
      evidence.production.activeClockUtc = run(['shell', 'date', '-u']).trim();
    }
    run(['shell', 'am', 'force-stop', production]);
  }
  if (mode === '--replay') {
    const qaApk = path.join(output, 'slova-marathon-qa.apk');
    assert(fs.existsSync(qaApk), 'Build the isolated marathon QA APK first');
    evidence.qaBuild = JSON.parse(fs.readFileSync(path.join(output, 'qa-build-verification.json'), 'utf8'));
    evidence.qaApkSha256 = createHash('sha256').update(fs.readFileSync(qaApk)).digest('hex');
    assert(evidence.qaApkSha256 === evidence.qaBuild.apkSha256, 'QA APK does not match the restored build evidence');
    console.log(run(['install', '-r', qaApk], false, 120_000).trim());
    assert(run(['shell', 'pm', 'clear', qa]).includes('Success'), 'Could not clear the isolated QA profile');
    setDate('2026-10-26T09:00:00.000Z');
    launch(qa);
    const active = capture(qa, 'qa-active-newcomer-replay');
    assert(has(active, '0 из 7 этапов') && has(active, 'Пройдено головоломок: 0'), 'Expected active fresh profile');
    const beforeCoins = balance(active);
    tap(qa, 'Играть в марафоне');
    assert(has(ui(qa), 'Уровень 1'), 'Did not open real first campaign level');
    word('кот');
    word('ток');
    const first = capture(qa, 'qa-first-win-replay');
    assert(has(first, 'Получено 10 монет') && has(first, 'Далее'), 'Actual first win did not present its 10-coin reward');
    // Explicit cold launch of the saved result, rather than reading a model or injecting state.
    launch(qa, 'game');
    const restored = capture(qa, 'qa-saved-result-replay');
    assert(has(restored, 'Получено 10 монет') && has(restored, 'Далее'),
      'Cold restored result lost the pinned marathon reward presentation');
    launch(qa);
    const saved = capture(qa, 'qa-marathon-after-result-replay');
    assert(has(saved, '1 из 7 этапов') && has(saved, 'Пройдено головоломок: 1'), 'Saved result changed event progress');
    const afterCoins = balance(saved);
    assert(afterCoins === beforeCoins + 10, 'Saved result lost or duplicated wallet coins');
    launch(qa, 'game');
    const restoredAgain = capture(qa, 'qa-saved-result-second-replay');
    assert(has(restoredAgain, 'Получено 10 монет'), 'Second cold result restore lost its presentation');
    launch(qa);
    const stable = capture(qa, 'qa-marathon-stable-replay');
    assert(has(stable, 'Пройдено головоломок: 1') && balance(stable) === afterCoins,
      'Second result restore duplicated progress or coins');
    evidence.replay = { freshProfile: true, actualGestures: ['кот', 'ток'], beforeCoins, afterCoins,
      firstRewardShown: 10, coldRestoredRewardShown: 10, secondColdRestoredRewardShown: 10,
      balanceStable: true, completionCount: 1, progressStable: true, seededGameState: false };
  }
  if (mode === 'all' || mode === '--qa-only') {
    const qaApk = path.join(output, 'slova-marathon-qa.apk');
    assert(fs.existsSync(qaApk), 'Build the isolated marathon QA APK first');
    console.log(run(['install', '-r', qaApk], false, 120_000).trim());
    assert(run(['shell', 'pm', 'clear', qa]).includes('Success'), 'Could not clear the isolated QA profile');
    setDate('2026-10-04T09:00:00.000Z');
    launch(qa);
    const upcoming = capture(qa, 'qa-upcoming');
    assert(has(upcoming, 'Начнётся 26 октября'), 'Fresh QA profile does not show upcoming');
    setDate('2026-10-26T09:00:00.000Z');
    launch(qa);
    const active = capture(qa, 'qa-active-newcomer');
    assert(has(active, '0 из 7 этапов') && has(active, 'Пройдено головоломок: 0'), 'Fresh profile is not active with zero progress');
    const before = balance(active);
    tap(qa, 'Играть в марафоне');
    const level = capture(qa, 'qa-level-one');
    assert(has(level, 'Уровень 1'), 'Marathon did not open the real first level');
    word('кот');
    word('ток');
    const victory = capture(qa, 'qa-first-win');
    assert(has(victory, 'Далее'), 'Actual first-level gestures did not reach victory');
    launch(qa);
    const after = capture(qa, 'qa-active-first-win');
    assert(has(after, '1 из 7 этапов') && has(after, 'Пройдено головоломок: 1'), 'Real first win did not advance the marathon');
    const afterCoins = balance(after);
    assert(afterCoins === before + 10, `Expected exactly +10 coins; got ${before} -> ${afterCoins}`);
    launch(qa);
    const restart = capture(qa, 'qa-active-restart');
    assert(has(restart, 'Пройдено головоломок: 1') && balance(restart) === afterCoins, 'Cold restart duplicated or lost marathon reward');
    setDate('2026-11-02T09:00:00.000Z');
    launch(qa);
    const ended = capture(qa, 'qa-ended');
    assert(has(ended, 'Марафон завершён') && has(ended, 'За событие пройдено головоломок: 1'), 'Event did not end with preserved progress');
    assert(balance(ended) === afterCoins, 'Expiry changed the saved balance');
    tap(qa, 'Играть обычные уровни');
    const pending = ui(qa);
    if (has(pending, 'Далее')) tap(qa, 'Далее');
    assert(has(ui(qa), 'Уровень 2'), 'Could not continue to a real new level after event expiry');
    word('сон');
    word('нос');
    assert(has(ui(qa), 'Далее'), 'Actual second-level gestures did not reach victory');
    launch(qa);
    const expiredWin = capture(qa, 'qa-ended-new-win');
    assert(has(expiredWin, 'За событие пройдено головоломок: 1') && balance(expiredWin) === afterCoins,
      'A new win after expiry changed marathon progress or paid an extra reward');
    evidence.qa = { freshProfile: true, actualGestures: ['кот', 'ток', 'сон', 'нос'],
      upcoming: true, active: true, actualFirstWin: true, beforeCoins: before, afterCoins,
      completionCount: 1, coldRestartStable: true, ended: true, newWinAfterExpiryIgnored: true };
  }
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.error = error.stack;
  throw error;
} finally {
  run(['shell', 'am', 'force-stop', production]);
  run(['shell', 'am', 'force-stop', qa]);
  run(['shell', 'date', '-u', `@${Math.floor(Date.now() / 1000)}`]);
  run(['shell', 'settings', 'put', 'global', 'auto_time', original.autoTime]);
  run(['shell', 'cmd', 'connectivity', 'airplane-mode', original.airplaneMode === '1' ? 'enable' : 'disable']);
  run(['shell', 'svc', 'wifi', original.wifi === '1' ? 'enable' : 'disable']);
  run(['shell', 'svc', 'data', original.data === '1' ? 'enable' : 'disable']);
  evidence.restored = { autoTime: run(['shell', 'settings', 'get', 'global', 'auto_time']).trim(),
    deviceUtc: run(['shell', 'date', '-u']).trim(), originalSettings: original,
    networkSettings: {
      airplaneMode: run(['shell', 'settings', 'get', 'global', 'airplane_mode_on']).trim(),
      wifi: run(['shell', 'settings', 'get', 'global', 'wifi_on']).trim(),
      data: run(['shell', 'settings', 'get', 'global', 'mobile_data']).trim(),
    } };
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
}
console.log(`NATIVE_SMOKE_PASSED ${mode}`);
