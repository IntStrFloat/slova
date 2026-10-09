// Read-only verification for the October subscription build; no secret output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const artifact = path.join(__dirname, 'slova-0.1.14-vc18-subscription-rustore.aab');
const java = 'C:/Program Files/Android/Android Studio/jbr/bin';
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ...extraEnv } });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} verification failed (${result.status})`);
  return result.stdout;
}
function findJar(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findJar(target);
      if (nested) return nested;
    } else if (entry.name.endsWith('.jar')) return target;
  }
  return null;
}
const cache = 'C:/Users/Dima2/.gradle/caches/modules-2/files-2.1';
const aapt = findJar(path.join(cache, 'com.android.tools.build/aapt2-proto/8.13.1-13719691'));
const proto = findJar(path.join(cache, 'com.google.protobuf/protobuf-java/3.25.5'));
if (!aapt || !proto) throw new Error('Previously available manifest inspector dependencies are missing');
const inspection = JSON.parse(run(path.join(java, 'java.exe'), [
  '-cp', [path.join(root, 'output/marathon-2026-10'), aapt, proto].join(path.delimiter), 'InspectAab', artifact,
]));
if (inspection.package !== config.android.package || inspection.versionName !== config.version
  || inspection.versionCode !== config.android.versionCode || inspection.debuggable !== false
  || inspection.minSdkVersion !== 24 || inspection.targetSdkVersion !== 36
  || inspection.architectures.join(',') !== 'arm64-v8a,armeabi-v7a,x86,x86_64'
  || !inspection.signatureVerifiedByJarFile || !inspection.signatureVerifiedByJarInputStream
  || !inspection.manifestIsFirstJarEntry || inspection.certificateSha256List.length !== 1) {
  throw new Error('AAB identity, architecture or signature coverage verification failed');
}
// Same safe property decoding as the existing verify-release-apk.cjs.
const properties = fs.readFileSync(path.join(root, 'credentials/keystore.properties'), 'utf8');
function property(key) {
  const raw = properties.match(new RegExp(`^\\s*${key}\\s*[=:]\\s*(.*)$`, 'm'))?.[1];
  if (raw === undefined) throw new Error(`Missing signing property: ${key}`);
  return raw.replace(/\\u([a-f0-9]{4})/gi, (_, value) => String.fromCharCode(parseInt(value, 16)))
    .replace(/\\(.)/g, (_, char) => ({ n: '\n', r: '\r', t: '\t', f: '\f' })[char] ?? char);
}
const expectedKey = path.join(root, 'credentials/release.jks');
if (fs.realpathSync(path.resolve(root, 'android/app', property('storeFile'))).toLowerCase()
  !== fs.realpathSync(expectedKey).toLowerCase()) throw new Error('Unexpected signing key path');
const publicCertificate = run(path.join(java, 'keytool.exe'), ['-J-Duser.language=en', '-list', '-v',
  '-keystore', expectedKey, '-alias', property('keyAlias'), '-storepass:env', 'SLOVA_VERIFY_STORE_PASSWORD'],
  { SLOVA_VERIFY_STORE_PASSWORD: property('storePassword') });
const keyCertificateSha256 = publicCertificate.match(/SHA256:\s*([A-F0-9:]+)/)?.[1].replaceAll(':', '').toLowerCase();
const certificateSha256 = inspection.certificateSha256List[0];
const previous = JSON.parse(fs.readFileSync(path.join(root, 'output/marathon-2026-10/aab-rustore-final-verification.json'), 'utf8'));
if (keyCertificateSha256 !== certificateSha256 || previous.certificateSha256 !== certificateSha256) {
  throw new Error('AAB certificate does not match the existing release key and prior release');
}
const signing = run(path.join(java, 'jarsigner.exe'), ['-J-Duser.language=en', '-verify', artifact]);
fs.writeFileSync(path.join(__dirname, 'subscription-aab-jarsigner.log'), signing);
if (!signing.includes('jar verified.') || signing.includes('internal inconsistencies')) {
  throw new Error('Jarsigner verification failed or streaming inconsistency detected');
}
const bundle = JSON.parse(run('C:/Python312/python.exe', ['-c',
  'import sys,zipfile,hashlib,json; z=zipfile.ZipFile(sys.argv[1]); b=z.read("base/assets/index.android.bundle"); print(json.dumps({"sha256":hashlib.sha256(b).hexdigest(),"sizeBytes":len(b),"hermesMagic":b[:8].hex()}))',
  artifact,
]));
const generated = fs.readFileSync(path.join(root, 'android/app/build/generated/assets/react/release/index.android.bundle'));
if (bundle.sha256 !== hash(generated) || bundle.hermesMagic !== 'c61fbc03c103191f') {
  throw new Error('Embedded Hermes bundle differs from the current Gradle output');
}
if (!generated.includes(Buffer.from('https://slova.193.160.208.95.nip.io'))
  || generated.includes(Buffer.from('http://127.0.0.1:8791'))) {
  throw new Error('Production backend URL or absence of local test endpoint was not verified');
}
const map = JSON.parse(fs.readFileSync(path.join(root, 'android/app/build/generated/sourcemaps/react/release/index.android.bundle.map'), 'utf8'));
const currentSourceFiles = [
  'src/features/monetization/subscription.ts', 'src/features/monetization/entitlements.ts',
  'src/features/monetization/yandexAds.native.ts', 'src/features/monetization/AdBanner.native.tsx',
  'src/app/shop.tsx', 'src/app/_layout.tsx', 'src/core/net/index.ts', 'src/core/config/env.ts',
  'node_modules/expo/src/winter/runtime.native.ts',
];
const sources = currentSourceFiles.map((file) => {
  const index = map.sources.findIndex((source) => source.endsWith(`/${file}`));
  const bytes = fs.readFileSync(path.join(root, file), 'utf8');
  if (index < 0 || map.sourcesContent[index] !== bytes) throw new Error(`Compiled source map differs: ${file}`);
  return { file, sha256: hash(bytes), matchesCompiledSourceMap: true };
});
if (!map.sourcesContent.some((source) => typeof source === 'string'
  && source.includes('https://slova.193.160.208.95.nip.io'))) {
  throw new Error('Production backend URL is absent from the native bundle source map');
}
const report = {
  status: 'PASS', checkedAtUtc: new Date().toISOString(), artifact,
  sha256: hash(fs.readFileSync(artifact)), sizeBytes: fs.statSync(artifact).size,
  package: inspection.package, versionName: inspection.versionName, versionCode: inspection.versionCode,
  architectures: inspection.architectures, minSdkVersion: inspection.minSdkVersion,
  targetSdkVersion: inspection.targetSdkVersion, debuggable: inspection.debuggable, certificateSha256,
  signatureVerifiedByJarFile: true, signatureVerifiedByJarInputStream: true,
  signedPayloadEntries: inspection.signedPayloadEntries, matchesExistingReleaseKeystore: true,
  matchesPreviousReleaseCertificate: true, embeddedHermesBundle: bundle, sources,
  productionBackendUrlPresent: true, localTestBackendUrlAbsent: true, noNewDependencies: true,
  warnings: ['Self-signed Android upload certificate; no trusted timestamp, certificate expires in 2053.',
    'JAR signatures cover every payload, but POSIX ZIP attributes are not protected by the signature.'],
  notVerified: ['Native real-money checkout and NPD issuance; provider onboarding is pending.',
    'RuStore acceptance or upload: not submitted. VersionCode must increase before a new upload.'],
};
fs.writeFileSync(path.join(__dirname, 'subscription-aab-inspection.json'), `${JSON.stringify(inspection, null, 2)}\n`);
fs.writeFileSync(path.join(__dirname, 'subscription-native-release-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
