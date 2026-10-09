const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { expo: config } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const name = `slova-${config.version}-vc${config.android.versionCode}`;
const artifact = path.join(root, `output/release/${name}-release.apk`);
const sdk = 'C:/Users/Dima2/AppData/Local/Android/Sdk/build-tools/36.0.0';
const java = 'C:/Program Files/Android/Android Studio/jbr/bin';
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...extraEnv } });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} verification failed`);
  return result.stdout;
}
const badging = run(path.join(sdk, 'aapt.exe'), ['dump', 'badging', artifact]);
const metadata = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
if (!metadata || metadata[1] !== config.android.package || metadata[2] !== String(config.android.versionCode)
  || metadata[3] !== config.version || badging.includes('application-debuggable')) {
  throw new Error('Unexpected package, version or debuggable APK');
}
const architectures = [...(badging.match(/^native-code:(.*)$/m)?.[1] ?? '').matchAll(/'([^']+)'/g)]
  .map((match) => match[1]).sort();
if (architectures.join(',') !== ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].sort().join(',')) {
  throw new Error('APK must include all configured architectures');
}
const signature = run(path.join(java, 'java.exe'), ['-Duser.language=en', '-jar', path.join(sdk, 'lib/apksigner.jar'),
  'verify', '--verbose', '--print-certs', artifact]);
const certificateSha256 = signature.match(/certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1].toLowerCase();
if (!certificateSha256 || !signature.includes('Verifies')) throw new Error('APK signature not confirmed');

// Passwords stay in a child-process environment and never appear in arguments or output.
const properties = fs.readFileSync(path.join(root, 'credentials/keystore.properties'), 'utf8');
function property(key) {
  const raw = properties.match(new RegExp(`^\\s*${key}\\s*[=:]\\s*(.*)$`, 'm'))?.[1];
  if (raw === undefined) throw new Error(`Missing signing property: ${key}`);
  return raw.replace(/\\u([a-f0-9]{4})/gi, (_, value) => String.fromCharCode(parseInt(value, 16)))
    .replace(/\\(.)/g, (_, char) => ({ n: '\n', r: '\r', t: '\t', f: '\f' })[char] ?? char);
}
const configuredKey = path.resolve(root, 'android/app', property('storeFile'));
const expectedKey = path.join(root, 'credentials/release.jks');
if (fs.realpathSync(configuredKey).toLowerCase() !== fs.realpathSync(expectedKey).toLowerCase()) {
  throw new Error('Unexpected signing key file');
}
const keyCertificate = run(path.join(java, 'keytool.exe'), ['-J-Duser.language=en', '-list', '-v',
  '-keystore', expectedKey, '-alias', property('keyAlias'), '-storepass:env', 'SLOVA_VERIFY_STORE_PASSWORD'],
{ SLOVA_VERIFY_STORE_PASSWORD: property('storePassword') });
const keySha256 = keyCertificate.match(/SHA256:\s*([A-F0-9:]+)/)?.[1].replaceAll(':', '').toLowerCase();
if (!keySha256 || keySha256 !== certificateSha256) throw new Error('APK certificate does not match release.jks');
const previous = JSON.parse(fs.readFileSync(path.join(root, 'output/release/slova-0.1.9-vc13-verification.json'), 'utf8'));
if (previous.certificateSha256 !== certificateSha256) throw new Error('Certificate differs from the previous release');
const report = {
  package: metadata[1], versionName: metadata[3], versionCode: Number(metadata[2]),
  build: 'assembleRelease', debuggable: false, architectures,
  sizeBytes: fs.statSync(artifact).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),
  certificateSha256, signatureVerified: true, matchesReleaseKeystore: true,
  matchesPreviousReleaseCertificate: true, artifact,
};
fs.writeFileSync(path.join(root, `output/release/${name}-verification.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
