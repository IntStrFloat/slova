const { spawnSync } = require('node:child_process');
const adb = 'C:/Users/Dima2/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const device = process.argv[2] ?? 'emulator-5578';
if (!['emulator-5574', 'emulator-5578', 'emulator-5582', 'emulator-5586'].includes(device)) throw new Error('Unknown QA device');
function run(args) {
  const result = spawnSync(adb, ['-s', device, ...args], { encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}
run(['shell', 'uiautomator', 'dump', '/sdcard/slova-retention-qa.xml']);
const xml = run(['shell', 'cat', '/sdcard/slova-retention-qa.xml']);
const nodes = [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]])));
console.log(JSON.stringify(nodes.filter((node) => node.package === 'com.intstrfloat.slova.retentionqa' &&
  (node.text || node['content-desc'] || node['resource-id'])).map((node) => ({ text: node.text, label: node['content-desc'], id: node['resource-id'], enabled: node.enabled, bounds: node.bounds })), null, 2));
