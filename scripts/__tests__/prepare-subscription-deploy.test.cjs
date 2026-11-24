const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { Buffer } = require('node:buffer');
const templatePath = path.join(path.dirname(module.filename), '../subscription-deploy-installer.template.cjs');
const { FILES, MAIL_KEYS, secretKeys, fixedEnvironment, hash, validateManifest, verifyCatalog, mergeEnvironment } = require(templatePath);
const { parseCredentials, parseArguments, selectCredentials } = require('../prepare-subscription-deploy.cjs');

const secrets = (mode = 'test') => ({ TIMEWEB_MAIL_USERNAME: 'sales@strsoft.ru', TIMEWEB_MAIL_PASSWORD: 'dummy$pass"\\word',
  BILLING_NOTICE_SENDER: 'Слова <sales@strsoft.ru>', BILLING_NOTICE_PROVIDER: 'timeweb',
  BILLING_SUPPORT_EMAIL: 'sales@strsoft.ru', ROBOKASSA_MERCHANT_LOGIN: 'slova', ROBOKASSA_HASH_ALGORITHM: 'SHA256',
  ...(mode === 'test' ? { ROBOKASSA_TEST_PASSWORD1: 'dummy-test-1', ROBOKASSA_TEST_PASSWORD2: 'dummy-test-2' }
    : { ROBOKASSA_PASSWORD1: 'dummy-live-1', ROBOKASSA_PASSWORD2: 'dummy-live-2', ROBOKASSA_PASSWORD3: 'dummy-live-3' }) });
const manifest = (mode = 'test') => ({ version: 2, mode, environment: secrets(mode), files: FILES.map((filename) => {
  const content = '// test';
  return { path: filename, content, sha256: hash(Buffer.from(content)) };
}) });

test('manifest validates all modules including provider/core and rejects traversal, missing and altered code', () => {
  assert.equal(validateManifest(manifest()).files.length, 15);
  assert.ok(FILES.includes('runtime/email.cjs') && FILES.includes('runtime/renewal-monitor.cjs'));
  assert.ok(FILES.includes('runtime/robokassa.cjs') && FILES.includes('runtime/billing-robokassa.cjs'));
  assert.ok(FILES.includes('runtime/billing-migration.cjs'));
  const traversal = manifest(); traversal.files[0].path = '../bloxx/index.cjs';
  assert.throws(() => validateManifest(traversal), /source_integrity_failed/);
  const missing = manifest(); missing.files.pop();
  assert.throws(() => validateManifest(missing), /invalid_manifest/);
  const changed = manifest(); changed.files[0].content = 'modified';
  assert.throws(() => validateManifest(changed), /source_integrity_failed/);
  const badMode = manifest(); delete badMode.mode;
  assert.throws(() => validateManifest(badMode), /invalid_mode/);
});

test('only intended live merchant and mail account can enter payload', () => {
  for (const [key, value] of [['ROBOKASSA_MERCHANT_LOGIN', 'different-shop'], ['ROBOKASSA_HASH_ALGORITHM', 'MD5'],
    ['TIMEWEB_MAIL_USERNAME', 'wrong@example.com'], ['BILLING_NOTICE_SENDER', 'wrong@example.com'],
    ['TIMEWEB_MAIL_PASSWORD', 'new\nBILLING_ENABLED=1']]) {
    const candidate = manifest(); candidate.environment[key] = value;
    assert.throws(() => validateManifest(candidate), /credentials/);
  }
});

test('environment merge preserves unrelated values, removes duplicates, quotes passwords and forces sales off', () => {
  const before = '# keep comment\nPORT=8788\nAPI_KEY=old-secret\nBILLING_ENABLED=1\nBILLING_ENABLED=1\n'
    + 'BILLING_DATA_PATH=/var/lib/slova/billing-test.json\nFEATURE_WORD_REPORTS=1\n'
    + 'YOOKASSA_SHOP_ID=1485481\nYOOKASSA_SECRET_KEY=keep-old-key\nROBOKASSA_PASSWORD1=keep-live-pair\n';
  const result = mergeEnvironment(before, secrets(), 'test');
  assert.ok(result.startsWith('# keep comment\nPORT=8788\nAPI_KEY=old-secret\nFEATURE_WORD_REPORTS=1\n'));
  for (const [key, value] of Object.entries(fixedEnvironment('test'))) {
    assert.equal(result.split('\n').filter((line) => line.startsWith(key + '=')).length, 1);
    assert.ok(result.includes(`${key}=${JSON.stringify(value)}\n`));
  }
  assert.ok(result.includes('TIMEWEB_MAIL_PASSWORD="dummy$pass\\"\\\\word"\n'));
  assert.doesNotMatch(result, /billing-test\.json/);
  assert.ok(result.includes('YOOKASSA_SECRET_KEY=keep-old-key\nROBOKASSA_PASSWORD1=keep-live-pair\n'));
  assert.equal(mergeEnvironment(result, secrets(), 'test'), result);
  assert.throws(() => mergeEnvironment('API_KEY=long\\\ncontinued', secrets(), 'test'), /unsupported_environment_format/);
});

test('credential parsing never accepts unlisted assignments or duplicate values', () => {
  assert.deepEqual(parseCredentials('A=first\nB="quoted"\n', ['A', 'B']), { A: 'first', B: 'quoted' });
  assert.throws(() => parseCredentials('A=one\nA=two', ['A']), /invalid_credentials_file/);
  assert.throws(() => parseCredentials('A=one\nB=two', ['A']), /invalid_credentials_file/);
  assert.throws(() => parseCredentials('A=one', ['A', 'B']), /missing_credentials/);
  assert.equal(secretKeys('test').length, MAIL_KEYS.length + 4);
});

test('preparation requires explicit mode and keeps test/live passwords out of the opposite artifact', () => {
  for (const args of [[], ['--mode'], ['--mode', 'auto'], ['--mode', 'test', '--enable']]) assert.throws(() => parseArguments(args), /explicit_mode_required/);
  assert.equal(parseArguments(['--mode', 'test']), 'test');
  assert.equal(parseArguments(['--mode', 'live']), 'live');
  const combined = { ...secrets('test'), ...secrets('live') };
  const mail = Object.fromEntries(MAIL_KEYS.map((key) => [key, combined[key]]));
  const payment = Object.fromEntries(Object.entries(combined).filter(([key]) => key.startsWith('ROBOKASSA_')));
  const testSelection = selectCredentials(mail, payment, 'test');
  assert.equal(testSelection.ROBOKASSA_PASSWORD1, undefined);
  assert.equal(testSelection.ROBOKASSA_PASSWORD3, undefined);
  const liveSelection = selectCredentials(mail, payment, 'live');
  assert.equal(liveSelection.ROBOKASSA_TEST_PASSWORD1, undefined);
  assert.ok(liveSelection.ROBOKASSA_PASSWORD3);
  assert.notEqual(fixedEnvironment('test').BILLING_DATA_PATH, fixedEnvironment('live').BILLING_DATA_PATH);
  assert.equal(fixedEnvironment('live').BILLING_DATA_PATH, '/var/lib/slova/billing-robokassa-slova-live.json');
  assert.deepEqual(JSON.parse(fixedEnvironment('test').BILLING_RETIRED_JOURNALS), []);
  assert.deepEqual(JSON.parse(fixedEnvironment('live').BILLING_RETIRED_JOURNALS), [
    { provider: 'robokassa', path: '/var/lib/slova/billing-robokassa-slova-test.json' },
  ]);
  assert.equal(fixedEnvironment('live').BILLING_MIGRATION_RESOLUTIONS_PATH, '/etc/slova/billing-migration-resolutions.json');
  payment.ROBOKASSA_PASSWORD1 = payment.ROBOKASSA_TEST_PASSWORD1;
  assert.throws(() => selectCredentials(mail, payment, 'test'), /test_live_passwords_must_differ/);
});

test('catalog verification rejects wrong provider, protocol, merchant, mode or enabled sales', () => {
  const catalog = { provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova', mode: 'test', available: false };
  verifyCatalog(catalog, 'test');
  for (const [key, value] of [['provider', 'yookassa'], ['protocol', 'legacy'], ['protocol', 'robokassa-v1'], ['merchantLogin', 'another'], ['mode', 'live'], ['available', true]]) {
    assert.throws(() => verifyCatalog({ ...catalog, [key]: value }, 'test'), /catalog_contract_failed/);
  }
});

test('seller details are optional, preserve existing values when absent and reject unrelated personal fields', () => {
  const before = 'BILLING_SELLER_NAME="Previous Seller"\nBILLING_SELLER_INN=123456789012\n';
  assert.ok(mergeEnvironment(before, secrets(), 'test').startsWith(before));
  const updated = { ...secrets(), BILLING_SELLER_NAME: 'New Seller', BILLING_SELLER_INN: '987654321012' };
  const merged = mergeEnvironment(before, updated, 'test');
  assert.ok(merged.includes('BILLING_SELLER_NAME="New Seller"\nBILLING_SELLER_INN="987654321012"\n'));
  assert.doesNotMatch(merged, /Previous Seller|123456789012/);
  assert.throws(() => mergeEnvironment(before, { ...updated, PASSPORT: 'not-allowed' }, 'test'), /invalid_credentials/);
  assert.throws(() => mergeEnvironment(before, { ...secrets(), BILLING_SELLER_NAME: 'Missing INN' }, 'test'), /invalid_credentials/);
});

test('rollback restores old bytes and removes only modules absent before deployment', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-deploy-test-'));
  const previous = path.join(directory, 'existing.cjs');
  const added = path.join(directory, 'new.cjs');
  const unrelated = path.join(directory, 'unrelated.cjs');
  try {
    fs.writeFileSync(previous, 'old'); fs.writeFileSync(added, 'new'); fs.writeFileSync(unrelated, 'unchanged');
    // Windows has no POSIX file ownership. Other real fs operations still run.
    const testFs = { ...fs, fchownSync: () => {} };
    const context = { require: (name) => name === 'node:fs' ? testFs : require(name),
      module: { exports: {} }, Buffer, process, console, setTimeout };
    vm.runInNewContext(fs.readFileSync(templatePath, 'utf8'), context);
    const metadata = fs.statSync(previous);
    const original = new Map([[previous, { bytes: Buffer.from('old'), metadata }], [added, null]]);
    fs.writeFileSync(previous, 'changed');
    context.module.exports.restoreFiles(original, 'test');
    assert.equal(fs.readFileSync(previous, 'utf8'), 'old');
    assert.equal(fs.existsSync(added), false);
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'unchanged');
    assert.deepEqual(fs.readdirSync(directory).sort(), ['existing.cjs', 'unrelated.cjs']);
  } finally { for (const entry of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, entry)); fs.rmdirSync(directory); }
});

for (const mode of ['test', 'live']) for (const tlsFailure of [false, true]) test(`simulated ${mode} installer ${tlsFailure ? 'rolls back after TLS failure' : 'completes with disabled catalog'}`, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-install-simulation-'));
  const mapped = (filename) => typeof filename === 'string' && filename.startsWith('/') ? path.join(directory, filename.slice(1)) : filename;
  const commands = [];
  const output = [];
  const oldEnv = 'PORT=8788\nAPI_KEY=retained\nBILLING_MODE=test\nBILLING_ENABLED=0\n';
  const envPath = '/opt/slova/backend.env';
  const root = '/opt/slova/backend';
  const processStub = { platform: 'linux', versions: { node: '18.20.8' }, getuid: () => 0, umask: () => 0, exitCode: 0 };
  try {
    fs.mkdirSync(mapped(`${root}/runtime`), { recursive: true });
    fs.mkdirSync(mapped('/var/lib/slova'), { recursive: true });
    fs.mkdirSync(mapped('/etc'), { recursive: true });
    fs.writeFileSync(mapped('/var/lib/slova/billing-live.json'), 'legacy-yookassa-ledger');
    fs.writeFileSync(mapped(envPath), oldEnv);
    fs.writeFileSync(mapped(`${root}/index.cjs`), '// original backend');
    const operatorOwnership = [];
    const testFs = { ...fs, fchownSync: () => {}, chownSync: (filename, uid, gid) => {
      assert.equal(filename, '/etc/slova'); assert.equal(uid, 0); assert.equal(gid, 1001);
      operatorOwnership.push([filename, uid, gid]);
    }, realpathSync: (filename) => {
      assert.equal(fs.realpathSync(mapped(filename)), mapped(filename)); return filename;
    }, lstatSync: (filename) => {
      const metadata = fs.lstatSync(mapped(filename));
      return { ...metadata, mode: metadata.isDirectory() ? 0o40755 : 0o100600, uid: 1001, gid: 1001, nlink: 1,
        isSymbolicLink: () => metadata.isSymbolicLink(), isDirectory: () => metadata.isDirectory(), isFile: () => metadata.isFile() };
    } };
    for (const operation of ['readFileSync', 'existsSync', 'mkdirSync', 'openSync', 'unlinkSync', 'chmodSync', 'readdirSync', 'rmdirSync']) {
      testFs[operation] = (filename, ...args) => fs[operation](mapped(filename), ...args);
    }
    testFs.renameSync = (from, to) => fs.renameSync(mapped(from), mapped(to));
    const execFileSync = (command, args) => {
      commands.push([command, ...args]);
      if (command === 'id') return '1001\n';
      if (command === '/usr/bin/node') return '';
      if (command === 'systemctl') {
        assert.equal(args.includes('slova-backend.service'), true);
        if (args[0] === 'show') return ({ '--property=WorkingDirectory': root, '--property=User': 'slova', '--property=Group': 'slova',
          '--property=ExecStart': `{ path=/usr/bin/node ; argv[]=/usr/bin/node ${root}/index.cjs ; ignore_errors=no ; }`,
          '--property=EnvironmentFiles': `${envPath} (ignore_errors=no)` })[args[2]];
        return args[0] === 'is-active' ? 'active\n' : '';
      }
      if (command === 'curl') {
        assert.equal(args.includes('--insecure') || args.includes('-k'), false);
        if (args.includes('--resolve')) {
          assert.ok(args.includes('slova.193.160.208.95.nip.io:443:127.0.0.1'));
          if (tlsFailure) throw new Error('private curl error must never escape');
        }
        return JSON.stringify(args.at(-1).endsWith('/api/health') ? { ok: true }
          : { provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova', available: false, mode });
      }
      throw new Error('unexpected command');
    };
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(manifest(mode))));
    const source = fs.readFileSync(templatePath, 'utf8')
      .replace("/* SLOVA_PACKED */ ''", JSON.stringify(compressed.toString('base64')))
      .replace("/* SLOVA_PACKED_HASH */ ''", JSON.stringify(hash(compressed)));
    const context = { require: (name) => name === 'node:fs' ? testFs : name === 'node:child_process' ? { execFileSync } : require(name),
      module: { exports: {} }, Buffer, process: processStub, console: { log: (value) => output.push(JSON.parse(value)) }, setTimeout };
    vm.runInNewContext(source, context);
    await context.module.exports.main();
    assert.equal(output.length, 1);
    assert.equal(output[0].deployed, !tlsFailure);
    assert.equal(processStub.exitCode, tlsFailure ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(output), /dummy|retained|private curl/);
    assert.equal(fs.readFileSync(mapped(path.posix.join(output[0].backup, 'backend.env')), 'utf8'), oldEnv);
    assert.equal(commands.filter(([command]) => command === '/usr/bin/node').length, 15);
    assert.deepEqual(operatorOwnership, [['/etc/slova', 0, 1001]]);
    assert.equal(fs.readFileSync(mapped('/var/lib/slova/billing-live.json'), 'utf8'), 'legacy-yookassa-ledger');
    if (tlsFailure) {
      assert.equal(output[0].restored, true);
      assert.equal(fs.readFileSync(mapped(envPath), 'utf8'), oldEnv);
      assert.equal(fs.readFileSync(mapped(`${root}/index.cjs`), 'utf8'), '// original backend');
      assert.equal(fs.existsSync(mapped(`${root}/runtime/email.cjs`)), false);
      assert.equal(fs.existsSync(mapped('/etc/slova')), false);
    } else {
      assert.equal(fs.readFileSync(mapped(envPath), 'utf8'), mergeEnvironment(oldEnv, secrets(mode), mode));
      assert.equal(fs.readFileSync(mapped(`${root}/runtime/email.cjs`), 'utf8'), '// test');
      assert.equal(fs.existsSync(mapped('/etc/slova')), true);
      const catalogs = commands.filter(([command, ...args]) => command === 'curl' && args.at(-1).endsWith('/api/billing/catalog'));
      assert.equal(catalogs.length, 8);
      assert.equal(catalogs.filter((args) => args.includes('X-Slova-Billing-Protocol: robokassa-v1')).length, 2);
      assert.equal(catalogs.filter((args) => args.includes('X-Slova-Billing-Protocol: robokassa-v2')).length, 2);
      assert.equal(catalogs.filter((args) => args.includes('X-Slova-Billing-Protocol: robokassa-v3')).length, 2);
    }
  } finally {
    // No computed recursive deletion: walk only this test's known, resolved temp tree.
    const remove = (folder) => {
      assert.ok(path.resolve(folder).startsWith(path.resolve(directory) + path.sep) || path.resolve(folder) === path.resolve(directory));
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const filename = path.join(folder, entry.name); if (entry.isDirectory()) remove(filename); else fs.unlinkSync(filename);
      }
      fs.rmdirSync(folder);
    };
    remove(directory);
  }
});
