const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const packed = [/* SLOVA_PACKED */].join('');
const allowed = ['index.cjs', 'runtime/api.cjs', 'runtime/store.cjs', 'runtime/billing.cjs',
  'runtime/billing-http.cjs', 'runtime/yookassa.cjs', 'runtime/renewal-notices.cjs',
  'runtime/timeweb-mail.cjs', 'runtime/content-catalog.cjs', 'runtime/word-policy.cjs'];
const root = '/opt/slova/backend';
const envPath = '/opt/slova/backend.env';
const stamp = Date.now().toString();
const stage = '/opt/slova/releases/console-' + stamp;
const backup = '/opt/slova/backups/console-' + stamp;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });

async function main() {
  if (process.platform !== 'linux' || process.getuid() !== 0 || fs.realpathSync(root) !== root
    || fs.realpathSync(envPath) !== envPath) throw new Error('unexpected_deployment_target');
  const unit = run('systemctl', ['show', 'slova-backend', '--property=WorkingDirectory', '--value']).trim();
  if (unit !== root) throw new Error('unexpected_service_directory');
  const manifest = JSON.parse(zlib.gunzipSync(Buffer.from(packed, 'base64')).toString('utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length !== allowed.length
    || new Set(manifest.files.map((entry) => entry.path)).size !== allowed.length) throw new Error('invalid_manifest');
  const files = manifest.files.map((entry) => {
    if (!allowed.includes(entry.path)) throw new Error('unexpected_file');
    const bytes = Buffer.from(entry.content, 'utf8');
    if (hash(bytes) !== entry.sha256) throw new Error('source_integrity_failed');
    const destination = path.join(root, entry.path);
    const parent = path.dirname(destination);
    if (fs.existsSync(parent) && fs.realpathSync(parent) !== parent) throw new Error('unexpected_parent');
    if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('unexpected_symlink');
    return { path: entry.path, bytes };
  });
  const owner = fs.statSync(root);
  const envBefore = fs.readFileSync(envPath);
  const original = new Map();
  for (const directory of ['/opt/slova/releases', '/opt/slova/backups']) {
    if (fs.existsSync(directory) && fs.realpathSync(directory) !== directory) throw new Error('unexpected_parent');
  }
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const staged = path.join(stage, file.path);
    fs.mkdirSync(path.dirname(staged), { recursive: true, mode: 0o700 });
    fs.writeFileSync(staged, file.bytes, { mode: 0o600 });
    run(process.execPath, ['--check', staged]);
    const destination = path.join(root, file.path);
    if (fs.existsSync(destination)) {
      const bytes = fs.readFileSync(destination);
      const metadata = fs.statSync(destination);
      original.set(file.path, { bytes, uid: metadata.uid, gid: metadata.gid, mode: metadata.mode & 0o777 });
      const saved = path.join(backup, file.path);
      fs.mkdirSync(path.dirname(saved), { recursive: true, mode: 0o700 });
      fs.writeFileSync(saved, bytes, { mode: 0o600 });
    }
  }
  fs.writeFileSync(path.join(backup, 'backend.env'), envBefore, { mode: 0o600 });
  const writeSource = (filename, bytes, metadata = { uid: owner.uid, gid: owner.gid, mode: 0o640 }) => {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o755 });
    const temporary = filename + '.console-' + stamp;
    fs.writeFileSync(temporary, bytes, { mode: metadata.mode, flag: 'wx' });
    fs.chmodSync(temporary, metadata.mode);
    fs.chownSync(temporary, metadata.uid, metadata.gid);
    fs.renameSync(temporary, filename);
  };
  try {
    let environment = envBefore.toString('utf8');
    environment = /^BILLING_ENABLED=/m.test(environment)
      ? environment.replace(/^BILLING_ENABLED=.*$/gm, 'BILLING_ENABLED=0')
      : environment + '\nBILLING_ENABLED=0\n';
    fs.writeFileSync(envPath, environment, { mode: 0o600 });
    for (const file of files) writeSource(path.join(root, file.path), file.bytes, original.get(file.path));
    run('systemctl', ['restart', 'slova-backend']);
    let healthy = false;
    for (let attempt = 0; attempt < 8 && !healthy; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:8788/api/health', { signal: AbortSignal.timeout(2000) });
        healthy = response.ok && (await response.json()).ok === true;
      } catch { /* Allow startup to settle before rolling back. */ }
      if (!healthy) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!healthy) throw new Error('health_check_failed');
    const catalog = await (await fetch('http://127.0.0.1:8788/api/billing/catalog', { signal: AbortSignal.timeout(3000) })).json();
    if (catalog.available !== false) throw new Error('sales_not_disabled');
    const httpsHealth = JSON.parse(run('curl', ['-fsS', '--max-time', '5', '--resolve',
      'slova.193.160.208.95.nip.io:443:127.0.0.1', 'https://slova.193.160.208.95.nip.io/api/health']));
    if (httpsHealth.ok !== true) throw new Error('https_check_failed');
    console.log(JSON.stringify({ deployed: true, files: files.length, backup, salesEnabled: false, httpsHealth: true }));
  } catch (error) {
    for (const [filename, metadata] of original) writeSource(path.join(root, filename), metadata.bytes, metadata);
    fs.writeFileSync(envPath, envBefore, { mode: 0o600 });
    run('systemctl', ['restart', 'slova-backend']);
    let restored = false;
    for (let attempt = 0; attempt < 8 && !restored; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:8788/api/health', { signal: AbortSignal.timeout(2000) });
        restored = response.ok && (await response.json()).ok === true;
      } catch { /* Verify recovery before claiming success. */ }
      if (!restored) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    console.log(JSON.stringify({ deployed: false, restored, unusedNewModulesRemain: true, reason: ['health_check_failed', 'sales_not_disabled', 'https_check_failed'].includes(error.message) ? error.message : 'deployment_failed' }));
    process.exitCode = 1;
  }
}
main().catch(() => { console.log(JSON.stringify({ deployed: false, reason: 'preflight_failed' })); process.exitCode = 1; });
