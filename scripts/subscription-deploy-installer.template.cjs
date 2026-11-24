// Standalone Node 18 installer. Generated copies contain credentials: keep private.
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const packed = /* SLOVA_PACKED */ '';
const packedHash = /* SLOVA_PACKED_HASH */ '';
const ROOT = '/opt/slova/backend';
const ENV_PATH = '/opt/slova/backend.env';
const SERVICE = 'slova-backend.service';
const HOST = 'slova.193.160.208.95.nip.io';
const PROVIDER = 'robokassa';
const MERCHANT = 'slova';
const PROTOCOL = 'robokassa-v3';
const OPERATOR_DIRECTORY = '/etc/slova';
const OPERATOR_RECORDS = `${OPERATOR_DIRECTORY}/billing-migration-resolutions.json`;
const RETIRED_TEST_JOURNAL = '/var/lib/slova/billing-robokassa-slova-test.json';
const FILES = ['index.cjs', 'runtime/api.cjs', 'runtime/store.cjs', 'runtime/billing.cjs',
  'runtime/billing-http.cjs', 'runtime/yookassa.cjs', 'runtime/renewal-notices.cjs',
  'runtime/timeweb-mail.cjs', 'runtime/content-catalog.cjs', 'runtime/word-policy.cjs',
  'runtime/email.cjs', 'runtime/renewal-monitor.cjs', 'runtime/robokassa.cjs', 'runtime/billing-robokassa.cjs',
  'runtime/billing-migration.cjs'];
const MAIL_KEYS = ['TIMEWEB_MAIL_USERNAME', 'TIMEWEB_MAIL_PASSWORD', 'BILLING_NOTICE_SENDER',
  'BILLING_NOTICE_PROVIDER', 'BILLING_SUPPORT_EMAIL'];
const SELLER_KEYS = ['BILLING_SELLER_NAME', 'BILLING_SELLER_INN'];
const ROBOKASSA_KEYS = ['ROBOKASSA_MERCHANT_LOGIN', 'ROBOKASSA_HASH_ALGORITHM', 'ROBOKASSA_PASSWORD1',
  'ROBOKASSA_PASSWORD2', 'ROBOKASSA_PASSWORD3', 'ROBOKASSA_TEST_PASSWORD1', 'ROBOKASSA_TEST_PASSWORD2'];
const PREFLIGHT_ERRORS = new Set(['payload_integrity_failed', 'invalid_manifest', 'invalid_credentials',
  'unexpected_credentials', 'source_integrity_failed', 'invalid_mode', 'unsupported_environment_format',
  'unsafe_target_permissions', 'unsupported_host', 'unexpected_service_user', 'unexpected_environment_owner',
  'unexpected_service_configuration', 'unexpected_service_command', 'unexpected_service_environment',
  'service_not_active', 'unexpected_ledger_owner', 'unsafe_operator_permissions', 'unexpected_retired_identity']);
function fixedEnvironment(mode) {
  if (!['test', 'live'].includes(mode)) fail('invalid_mode');
  return { BILLING_PROVIDER: PROVIDER, BILLING_MODE: mode, BILLING_ENABLED: '0', BILLING_LIVE_READY: '0',
    ROBOKASSA_MERCHANT_CONFIRMED: '0', ROBOKASSA_RECURRING_CONFIRMED: '0', ROBOKASSA_SMZ_CONFIRMED: '0',
    BILLING_DATA_PATH: `/var/lib/slova/billing-${PROVIDER}-${MERCHANT}-${mode}.json`,
    BILLING_NOTICES_DATA_PATH: `/var/lib/slova/renewal-notices-${PROVIDER}-${MERCHANT}-${mode}.json`,
    BILLING_RETIRED_JOURNALS: JSON.stringify(mode === 'live' ? [{ provider: PROVIDER, path: RETIRED_TEST_JOURNAL }] : []),
    BILLING_MIGRATION_RESOLUTIONS_PATH: OPERATOR_RECORDS };
}
function secretKeys(mode) {
  if (!['test', 'live'].includes(mode)) fail('invalid_mode');
  return [...MAIL_KEYS, 'ROBOKASSA_MERCHANT_LOGIN', 'ROBOKASSA_HASH_ALGORITHM', ...(mode === 'test'
    ? ['ROBOKASSA_TEST_PASSWORD1', 'ROBOKASSA_TEST_PASSWORD2']
    : ['ROBOKASSA_PASSWORD1', 'ROBOKASSA_PASSWORD2', 'ROBOKASSA_PASSWORD3'])];
}
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { throw new Error(code); };
const run = (command, args) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, maxBuffer: 256 * 1024,
});

function validateSecrets(environment, mode) {
  const keys = secretKeys(mode);
  if (!environment || Object.keys(environment).some((key) => !keys.includes(key) && !SELLER_KEYS.includes(key))
    || keys.some((key) => typeof environment[key] !== 'string' || !environment[key])
    || Object.values(environment).some((value) => typeof value !== 'string' || !value
      || /[\u0000-\u001f\u007f-\u009f]/.test(value))) fail('invalid_credentials');
  if (SELLER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(environment, key))
    && (!SELLER_KEYS.every((key) => typeof environment[key] === 'string')
      || !environment.BILLING_SELLER_NAME.trim() || environment.BILLING_SELLER_NAME.length > 200
      || !/^\d{12}$/.test(environment.BILLING_SELLER_INN))) fail('invalid_credentials');
  const passwords = keys.filter((key) => /PASSWORD\d$/.test(key)).map((key) => environment[key]);
  if (environment.ROBOKASSA_MERCHANT_LOGIN !== MERCHANT || environment.ROBOKASSA_HASH_ALGORITHM !== 'SHA256'
    || new Set(passwords).size !== passwords.length
    || environment.TIMEWEB_MAIL_USERNAME !== 'sales@strsoft.ru'
    || environment.BILLING_SUPPORT_EMAIL !== 'sales@strsoft.ru'
    || environment.BILLING_NOTICE_PROVIDER !== 'timeweb'
    || !(environment.BILLING_NOTICE_SENDER === 'sales@strsoft.ru'
      || /^[^<>]+ <sales@strsoft\.ru>$/.test(environment.BILLING_NOTICE_SENDER))) fail('unexpected_credentials');
  return environment;
}

function validateManifest(manifest) {
  if (manifest?.version !== 2 || !Array.isArray(manifest.files) || manifest.files.length !== FILES.length
    || new Set(manifest.files.map((entry) => entry.path)).size !== FILES.length) fail('invalid_manifest');
  validateSecrets(manifest.environment, manifest.mode);
  for (const entry of manifest.files) {
    if (!FILES.includes(entry.path) || typeof entry.content !== 'string'
      || hash(Buffer.from(entry.content, 'utf8')) !== entry.sha256) fail('source_integrity_failed');
  }
  return manifest;
}

function quoteValue(value) { return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function mergeEnvironment(before, environment, mode) {
  validateSecrets(environment, mode);
  // A continuation could consume a newly appended assignment in systemd's parser.
  if (/\\\r?\n/.test(before) || /\u0000/.test(before)) fail('unsupported_environment_format');
  const updates = { ...environment, ...fixedEnvironment(mode) };
  const retained = before.split(/\r?\n/).filter((line) => {
    const assignment = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    return !assignment || !Object.prototype.hasOwnProperty.call(updates, assignment[1]);
  });
  while (retained[retained.length - 1] === '') retained.pop();
  return retained.concat(Object.entries(updates).map(([key, value]) => `${key}=${quoteValue(value)}`)).join('\n') + '\n';
}

function inspect(filename, directory = false, privateFile = false) {
  const metadata = fs.lstatSync(filename);
  if (fs.realpathSync(filename) !== filename || metadata.isSymbolicLink()
    || (directory ? !metadata.isDirectory() : !metadata.isFile())
    || (metadata.mode & 0o022) !== 0 || (!directory && metadata.nlink !== 1)
    || (privateFile && (metadata.mode & 0o077) !== 0)) fail('unsafe_target_permissions');
  return metadata;
}

function preflight(mode) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || Number(process.versions.node.split('.')[0]) < 18) fail('unsupported_host');
  for (const directory of ['/opt', '/opt/slova', ROOT, `${ROOT}/runtime`, '/var', '/var/lib', '/var/lib/slova', '/etc']) inspect(directory, true);
  const owner = { uid: Number(run('id', ['-u', 'slova']).trim()), gid: Number(run('id', ['-g', 'slova']).trim()) };
  if (!Number.isSafeInteger(owner.uid) || owner.uid < 1 || !Number.isSafeInteger(owner.gid) || owner.gid < 1) fail('unexpected_service_user');
  const envMetadata = inspect(ENV_PATH, false, true);
  if (![0, owner.uid].includes(envMetadata.uid)) fail('unexpected_environment_owner');
  const expected = { WorkingDirectory: ROOT, User: 'slova', Group: 'slova' };
  for (const [property, value] of Object.entries(expected)) {
    if (run('systemctl', ['show', SERVICE, `--property=${property}`, '--value']).trim() !== value) fail('unexpected_service_configuration');
  }
  const exec = run('systemctl', ['show', SERVICE, '--property=ExecStart', '--value']).trim();
  if (!/^\{ path=\/usr\/bin\/node ; argv\[\]=\/usr\/bin\/node \/opt\/slova\/backend\/index\.cjs ;[^{}]*\}$/.test(exec)) fail('unexpected_service_command');
  if (run('systemctl', ['show', SERVICE, '--property=EnvironmentFiles', '--value']).trim()
    !== '/opt/slova/backend.env (ignore_errors=no)') fail('unexpected_service_environment');
  if (run('systemctl', ['is-active', SERVICE]).trim() !== 'active') fail('service_not_active');
  for (const key of ['BILLING_DATA_PATH', 'BILLING_NOTICES_DATA_PATH']) {
    const filename = fixedEnvironment(mode)[key];
    if (fs.existsSync(filename)) {
      const metadata = inspect(filename, false, true);
      if (metadata.uid !== owner.uid) fail('unexpected_ledger_owner');
    }
  }
  const operatorDirectoryExists = fs.existsSync(OPERATOR_DIRECTORY);
  if (operatorDirectoryExists) {
    const metadata = inspect(OPERATOR_DIRECTORY, true);
    if (metadata.uid !== 0 || metadata.gid !== owner.gid || (metadata.mode & 0o777) !== 0o750) fail('unsafe_operator_permissions');
  }
  if (fs.existsSync(OPERATOR_RECORDS)) {
    const metadata = inspect(OPERATOR_RECORDS);
    if (metadata.uid !== 0 || metadata.gid !== owner.gid || (metadata.mode & 0o777) !== 0o640) fail('unsafe_operator_permissions');
  }
  if (mode === 'live' && fs.existsSync(RETIRED_TEST_JOURNAL)) {
    const metadata = inspect(RETIRED_TEST_JOURNAL, false, true);
    if (metadata.uid !== owner.uid) fail('unexpected_ledger_owner');
    const retired = JSON.parse(fs.readFileSync(RETIRED_TEST_JOURNAL, 'utf8'));
    if (retired?.identity?.provider !== PROVIDER || retired.identity.merchant !== MERCHANT
      || retired.identity.mode !== 'test') fail('unexpected_retired_identity');
  }
  return { owner, envMetadata, operatorDirectoryExists };
}

function atomicWrite(filename, bytes, metadata, stamp) {
  const temporary = `${filename}.subscription-${stamp}`;
  let created = false;
  try {
    const descriptor = fs.openSync(temporary, 'wx', metadata.mode & 0o777);
    created = true;
    try { fs.writeFileSync(descriptor, bytes); fs.fchmodSync(descriptor, metadata.mode & 0o777); fs.fchownSync(descriptor, metadata.uid, metadata.gid); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, filename);
  } finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function restoreFiles(original, stamp) {
  for (const [filename, saved] of original) {
    if (saved === null) { if (fs.existsSync(filename)) fs.unlinkSync(filename); }
    else atomicWrite(filename, saved.bytes, saved.metadata, stamp);
  }
}

function privateDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  inspect(directory, true);
}
function savePrivate(filename, bytes) {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
function jsonEndpoint(route, tls = false, protocol = null) {
  const args = ['--silent', '--show-error', '--fail', '--noproxy', '*', '--max-time', '5'];
  if (protocol) args.push('--header', `X-Slova-Billing-Protocol: ${protocol}`);
  if (tls) args.push('--resolve', `${HOST}:443:127.0.0.1`);
  args.push(`${tls ? `https://${HOST}` : 'http://127.0.0.1:8788'}${route}`);
  return JSON.parse(run('curl', args));
}
function verifyCatalog(catalog, mode) {
  if (catalog?.available !== false || catalog.provider !== PROVIDER || catalog.protocol !== PROTOCOL
    || catalog.merchantLogin !== MERCHANT || catalog.mode !== mode) fail('catalog_contract_failed');
}
async function health() {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { if (jsonEndpoint('/api/health').ok === true) return true; } catch { /* bounded startup retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function main() {
  process.umask(0o077);
  const compressed = Buffer.from(packed, 'base64');
  if (hash(compressed) !== packedHash) fail('payload_integrity_failed');
  const manifest = validateManifest(JSON.parse(zlib.gunzipSync(compressed).toString('utf8')));
  const { owner, envMetadata, operatorDirectoryExists } = preflight(manifest.mode);
  const before = fs.readFileSync(ENV_PATH);
  const environment = mergeEnvironment(before.toString('utf8'), manifest.environment, manifest.mode);
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  for (const directory of ['/opt/slova/releases', '/opt/slova/backups']) privateDirectory(directory);
  const stage = `/opt/slova/releases/subscription-${stamp}`;
  const backup = `/opt/slova/backups/subscription-${stamp}`;
  fs.mkdirSync(stage, { mode: 0o700 });
  fs.mkdirSync(backup, { mode: 0o700 });
  fs.mkdirSync(`${stage}/runtime`, { mode: 0o700 });
  fs.mkdirSync(`${backup}/runtime`, { mode: 0o700 });
  const original = new Map([[ENV_PATH, { bytes: before, metadata: envMetadata }]]);
  savePrivate(`${backup}/backend.env`, before);
  savePrivate(`${stage}/backend.env`, environment);
  for (const entry of manifest.files) {
    const destination = `${ROOT}/${entry.path}`;
    if (fs.existsSync(destination)) {
      const metadata = inspect(destination);
      const bytes = fs.readFileSync(destination);
      original.set(destination, { bytes, metadata });
      savePrivate(`${backup}/${entry.path}`, bytes);
    } else original.set(destination, null);
    savePrivate(`${stage}/${entry.path}`, entry.content);
    run('/usr/bin/node', ['--check', `${stage}/${entry.path}`]);
  }
  savePrivate(`${backup}/manifest.json`, JSON.stringify({ files: [...original].map(([filename, saved]) => ({
    filename, existed: saved !== null, sha256: saved ? hash(saved.bytes) : null,
    mode: saved?.metadata.mode, uid: saved?.metadata.uid, gid: saved?.metadata.gid,
  })) }, null, 2));
  let stopped = false;
  let operatorDirectoryCreated = false;
  try {
    if (!operatorDirectoryExists) {
      fs.mkdirSync(OPERATOR_DIRECTORY, { mode: 0o750 });
      operatorDirectoryCreated = true;
      fs.chownSync(OPERATOR_DIRECTORY, 0, owner.gid);
      fs.chmodSync(OPERATOR_DIRECTORY, 0o750);
    }
    // Prevent a request from lazily loading modules while files are being replaced.
    stopped = true;
    run('systemctl', ['stop', SERVICE]);
    atomicWrite(ENV_PATH, environment, { uid: envMetadata.uid, gid: envMetadata.gid, mode: 0o600 }, stamp);
    for (const entry of manifest.files) {
      const filename = `${ROOT}/${entry.path}`;
      atomicWrite(filename, entry.content, original.get(filename)?.metadata ?? { ...owner, mode: 0o640 }, stamp);
    }
    run('systemctl', ['restart', SERVICE]);
    if (!await health()) fail('health_check_failed');
    // Legacy clients omit the header or send v1/v2. Only v3 records both consents;
    // this installation keeps every generation unable to buy until activation.
    for (const protocol of [null, 'robokassa-v1', 'robokassa-v2', PROTOCOL]) verifyCatalog(jsonEndpoint('/api/billing/catalog', false, protocol), manifest.mode);
    if (jsonEndpoint('/api/health', true).ok !== true) fail('https_check_failed');
    for (const protocol of [null, 'robokassa-v1', 'robokassa-v2', PROTOCOL]) verifyCatalog(jsonEndpoint('/api/billing/catalog', true, protocol), manifest.mode);
    if (run('systemctl', ['is-active', SERVICE]).trim() !== 'active') fail('service_not_active');
    console.log(JSON.stringify({ deployed: true, files: manifest.files.length, backup, salesEnabled: false,
      provider: PROVIDER, merchantLogin: MERCHANT, protocol: PROTOCOL, billingMode: manifest.mode,
      httpHealth: true, httpsHealth: true, publicCatalog: true, oldClientUnavailable: true, smtpSent: false }));
  } catch (error) {
    let restored = false;
    try {
      if (stopped) run('systemctl', ['stop', SERVICE]);
      restoreFiles(original, `${stamp}-rollback`);
      for (const [filename, saved] of original) {
        if (saved === null ? fs.existsSync(filename) : hash(fs.readFileSync(filename)) !== hash(saved.bytes)) fail('rollback_integrity_failed');
      }
      run('systemctl', ['restart', SERVICE]);
      restored = await health() && run('systemctl', ['is-active', SERVICE]).trim() === 'active';
      if (operatorDirectoryCreated && fs.readdirSync(OPERATOR_DIRECTORY).length === 0) fs.rmdirSync(OPERATOR_DIRECTORY);
    } catch { /* Keep the private backup for manual recovery. */ }
    const reasons = ['health_check_failed', 'catalog_contract_failed', 'https_check_failed', 'service_not_active'];
    console.log(JSON.stringify({ deployed: false, restored, backup,
      reason: reasons.includes(error.message) ? error.message : 'deployment_failed' }));
    process.exitCode = 1;
  }
}

module.exports = { FILES, MAIL_KEYS, SELLER_KEYS, ROBOKASSA_KEYS, PROVIDER, MERCHANT, PROTOCOL, secretKeys, fixedEnvironment,
  hash, validateSecrets, validateManifest, verifyCatalog, mergeEnvironment, atomicWrite, restoreFiles, main };
if (require.main === module) main().catch((error) => {
  console.log(JSON.stringify({ deployed: false, reason: PREFLIGHT_ERRORS.has(error.message) ? error.message : 'preflight_failed' })); process.exitCode = 1;
});
