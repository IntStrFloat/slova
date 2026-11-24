// Creates a private installer; does not connect, deploy, charge, or send mail.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { FILES, MAIL_KEYS, SELLER_KEYS, ROBOKASSA_KEYS, MERCHANT, PROVIDER, secretKeys, hash,
  validateSecrets, validateManifest } = require('./subscription-deploy-installer.template.cjs');

const ROOT = path.resolve(__dirname, '..');
function parseCredentials(text, keys, required = keys) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const assignment = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!assignment || !keys.includes(assignment[1]) || Object.prototype.hasOwnProperty.call(values, assignment[1])) throw new Error('invalid_credentials_file');
    let value = assignment[2];
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { throw new Error('invalid_credentials_file'); } }
    else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error('invalid_credentials_file');
      value = value.slice(1, -1);
    }
    values[assignment[1]] = value;
  }
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(values, key))) throw new Error('missing_credentials');
  return values;
}
function parseArguments(args) {
  if (args.length !== 2 || args[0] !== '--mode' || !['test', 'live'].includes(args[1])) throw new Error('explicit_mode_required');
  return args[1];
}
function selectCredentials(mail, payment, mode, seller = {}) {
  const passwords = Object.entries(payment).filter(([key, value]) => /PASSWORD\d$/.test(key) && value).map(([, value]) => value);
  if (new Set(passwords).size !== passwords.length) throw new Error('test_live_passwords_must_differ');
  const source = { ...mail, ...payment };
  return validateSecrets({ ...Object.fromEntries(secretKeys(mode).map((key) => [key, source[key]])), ...seller }, mode);
}
function main(args = process.argv.slice(2)) {
  const mode = parseArguments(args);
  const payment = parseCredentials(fs.readFileSync(path.join(ROOT, 'credentials/robokassa.env'), 'utf8'),
    ROBOKASSA_KEYS, ['ROBOKASSA_MERCHANT_LOGIN', 'ROBOKASSA_HASH_ALGORITHM']);
  const mail = parseCredentials(fs.readFileSync(path.join(ROOT, 'credentials/timeweb-mail.env'), 'utf8'), MAIL_KEYS);
  const sellerFile = path.join(ROOT, 'credentials/robokassa-seller.env');
  const seller = fs.existsSync(sellerFile) ? parseCredentials(fs.readFileSync(sellerFile, 'utf8'), SELLER_KEYS) : {};
  const environment = selectCredentials(mail, payment, mode, seller);
  const files = FILES.map((filename) => {
    const source = path.join(ROOT, 'backend', filename);
    execFileSync(process.execPath, ['--check', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    const content = fs.readFileSync(source, 'utf8');
    return { path: filename, content, sha256: hash(Buffer.from(content, 'utf8')) };
  });
  const manifest = validateManifest({ version: 2, mode, files, environment });
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(manifest), 'utf8'), { level: 9 });
  const template = fs.readFileSync(path.join(__dirname, 'subscription-deploy-installer.template.cjs'), 'utf8');
  const installer = template.replace("/* SLOVA_PACKED */ ''", JSON.stringify(compressed.toString('base64')))
    .replace("/* SLOVA_PACKED_HASH */ ''", JSON.stringify(hash(compressed)));
  const output = path.join(ROOT, `credentials/subscription-deploy-${PROVIDER}-${MERCHANT}-${mode}`);
  const filename = path.join(output, 'installer.cjs');
  execFileSync('git', ['check-ignore', '--quiet', filename], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(output).toLowerCase() !== output.toLowerCase()
    || (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink())) throw new Error('unsafe_output_path');
  if (fs.existsSync(filename)) fs.chmodSync(filename, 0o600);
  fs.writeFileSync(filename, installer, { mode: 0o600 });
  execFileSync(process.execPath, ['--check', filename], { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(JSON.stringify({ path: filename, bytes: Buffer.byteLength(installer), sha256: hash(Buffer.from(installer)) }));
}
module.exports = { parseCredentials, parseArguments, selectCredentials };
if (require.main === module) {
  try { main(); } catch (error) {
    const safe = ['explicit_mode_required', 'missing_credentials', 'invalid_credentials', 'invalid_credentials_file',
      'unexpected_credentials', 'test_live_passwords_must_differ'];
    console.error(safe.includes(error.message) ? error.message : 'subscription_deploy_preparation_failed');
    process.exitCode = 1;
  }
}
