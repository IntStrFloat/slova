// Read-only verification of a signed, reordered AAB. Never builds or signs an artifact.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTION_API = 'https://slova.193.160.208.95.nip.io';
const HERMES_MAGIC = 'c61fbc03c103191f';
const ARCHITECTURES = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];
const PASSWORD_KEYS = ['ROBOKASSA_PASSWORD1', 'ROBOKASSA_PASSWORD2', 'ROBOKASSA_PASSWORD3',
  'ROBOKASSA_TEST_PASSWORD1', 'ROBOKASSA_TEST_PASSWORD2'];
const FRAMEWORK_LOCALHOST_SOURCES = [
  'node_modules/@expo/metro-runtime/src/location/install.native.ts',
  'node_modules/expo/src/async-require/fetchThenEvalJs.ts',
  'node_modules/react-native/Libraries/Core/Devtools/getDevServer.js',
];
const SOURCE_FILES = [
  'src/features/analytics/subscription.ts', 'src/features/analytics/index.ts',
  // privacy.ts is now a compatibility re-export; production code imports the v3 schema directly.
  'src/features/analytics/schema.ts', 'src/features/analytics/dedupe.ts',
  'src/features/analytics/sessionTelemetry.ts', 'src/features/analytics/navigationTelemetry.ts',
  'src/features/analytics/AnalyticsNavigationRoot.tsx', 'src/features/analytics/experiments.ts',
  'src/core/native/appmetrica.ts', 'src/core/storage/index.ts',
  'src/features/monetization/subscriptionOfferProgress.ts',
  'src/features/monetization/usePostAdSubscriptionOffer.ts',
  'src/features/monetization/PostAdSubscriptionOffer.tsx',
  'src/features/monetization/subscription.ts', 'src/features/monetization/entitlements.ts',
  'src/features/monetization/subscriptionAutoSync.ts',
  'src/features/monetization/yandexAds.native.ts', 'src/features/monetization/AdBanner.native.tsx',
  'src/app/shop.tsx', 'src/app/settings.tsx', 'src/app/index.tsx', 'src/app/_layout.tsx', 'src/core/net/index.ts',
  'src/features/monetization/SubscriptionOffer.tsx', 'src/ui/primitives.tsx',
  'src/core/config/env.ts', 'src/core/config/monetization.ts',
  'node_modules/expo/src/winter/runtime.native.ts',
  ...FRAMEWORK_LOCALHOST_SOURCES,
];

class VerificationError extends Error {}
function check(condition, code) { if (!condition) throw new VerificationError(code); }
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function fileHash(filename) {
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const descriptor = fs.openSync(filename, 'r');
  try {
    for (let size; (size = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0;) digest.update(buffer.subarray(0, size));
  } finally { fs.closeSync(descriptor); }
  return digest.digest('hex');
}

function parseArguments(args) {
  const allowed = new Set(['--artifact', '--report-dir', '--private-env', '--previous-report']);
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    check(allowed.has(key) && args[index + 1] && !args[index + 1].startsWith('--') && !result[key], 'invalid_arguments');
    result[key] = path.resolve(args[index + 1]);
  }
  check(result['--artifact'] && result['--report-dir'] && path.extname(result['--artifact']).toLowerCase() === '.aab', 'invalid_arguments');
  return {
    artifact: result['--artifact'], reportDir: result['--report-dir'], privateEnv: result['--private-env'],
    previousReport: result['--previous-report'] || path.join(ROOT, 'output/subscription-qa/subscription-native-release-verification.json'),
  };
}

function run(command, args, code, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024, timeout: 180000, env: { ...process.env, ...extraEnv } });
  // Child stderr/arguments can contain private paths or credentials; never echo them.
  check(!result.error && result.status === 0, code);
  return result.stdout;
}

function javaTools() {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const candidates = [process.env.JAVA_HOME, 'C:/Program Files/Android/Android Studio/jbr'].filter(Boolean);
  const home = candidates.find((candidate) => ['java', 'keytool', 'jarsigner']
    .every((name) => fs.existsSync(path.join(candidate, 'bin', name + suffix))));
  check(home, 'java_tools_unavailable');
  return Object.fromEntries(['java', 'keytool', 'jarsigner'].map((name) => [name, path.join(home, 'bin', name + suffix)]));
}

function findJar(directory) {
  if (!fs.existsSync(directory)) return null;
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => right.name.localeCompare(left.name, 'en', { numeric: true }));
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findJar(target);
      if (nested) return nested;
    } else if (entry.name.endsWith('.jar') && !/-(sources|javadoc)\.jar$/.test(entry.name)) return target;
  }
  return null;
}

function signingProperty(properties, key) {
  const raw = properties.match(new RegExp(`^\\s*${key}\\s*[=:]\\s*(.*)$`, 'm'))?.[1];
  check(raw !== undefined, 'signing_configuration_invalid');
  return raw.replace(/\\u([a-f0-9]{4})/gi, (_, value) => String.fromCharCode(parseInt(value, 16)))
    .replace(/\\(.)/g, (_, character) => ({ n: '\n', r: '\r', t: '\t', f: '\f' })[character] ?? character);
}

function parsePrivatePasswords(contents) {
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const assignment = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!assignment || !PASSWORD_KEYS.includes(assignment[1])) continue;
    check(!values.has(assignment[1]), 'private_secret_scan_failed');
    let value = assignment[2];
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch { throw new VerificationError('private_secret_scan_failed'); }
    } else if (value.startsWith("'")) {
      check(value.endsWith("'"), 'private_secret_scan_failed');
      value = value.slice(1, -1);
    }
    check(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\r\n\u0000]/.test(value), 'private_secret_scan_failed');
    values.set(assignment[1], value);
  }
  check(values.size === PASSWORD_KEYS.length, 'private_secret_scan_failed');
  return [...values.values()];
}

function verifyBundleMarkers(bundle, sourceMap) {
  const markers = [PRODUCTION_API, 'auth.robokassa.ru', '/Merchant/Index.aspx', 'robokassa-v3', 'X-Slova-Billing-Protocol',
    'privacyVersion', 'consentText', 'personalDataConsentVersion', 'personalDataConsentText', 'recurringConsented', 'personalDataConsented', 'userAgreementVersion'];
  check(markers.every((marker) => bundle.includes(Buffer.from(marker))), 'release_payment_markers_missing');
  // Check executable Hermes strings, not full dependency source-map comments/examples.
  const localOrigin = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10\.0\.2\.2|\[::1\])(?::\d+)?/gi;
  const origins = [...new Set(['latin1', 'utf16le'].flatMap((encoding) => bundle.toString(encoding).match(localOrigin) || []))];
  const frameworkFallbacks = [];
  for (const origin of origins) {
    check(origin === 'http://localhost:8081' && sourceMap, 'local_test_url_detected');
    const matchedSources = sourceMap.sources.flatMap((source, index) => {
      const content = sourceMap.sourcesContent[index];
      return typeof content === 'string' && content.includes(origin) ? [String(source).replaceAll('\\', '/').replace(/^\//, '')] : [];
    });
    // main() verifies these exact dependency sources against their compiled source-map
    // contents first. Any app/config occurrence still fails, including port 8081.
    check(matchedSources.includes('node_modules/react-native/Libraries/Core/Devtools/getDevServer.js')
      && matchedSources.every((source) => FRAMEWORK_LOCALHOST_SOURCES.some((allowed) => source === allowed || source.endsWith(`/${allowed}`))),
    'local_test_url_detected');
    frameworkFallbacks.push({ origin, sources: matchedSources });
  }
  return { slovaLocalTestApiEndpointsAbsent: true, frameworkFallbacks };
}

function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const { artifact, reportDir } = options;
  check(fs.statSync(artifact).isFile(), 'artifact_unavailable');
  const reportFiles = {
    inspection: path.join(reportDir, 'robokassa-aab-inspection.json'),
    signing: path.join(reportDir, 'robokassa-aab-jarsigner.log'),
    verification: path.join(reportDir, 'robokassa-native-release-verification.json'),
  };
  check(Object.values(reportFiles).every((filename) => !fs.existsSync(filename)), 'report_already_exists');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
  const previous = JSON.parse(fs.readFileSync(options.previousReport, 'utf8'));
  check(config.android.package === 'com.intstrfloat.slova' && typeof config.version === 'string'
    && Number.isSafeInteger(config.android.versionCode) && config.android.versionCode > previous.versionCode
    && previous.status === 'PASS' && /^[a-f0-9]{64}$/.test(previous.certificateSha256), 'release_configuration_invalid');

  const java = javaTools();
  const cache = path.join(process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'), 'caches/modules-2/files-2.1');
  const aapt = findJar(path.join(cache, 'com.android.tools.build/aapt2-proto'));
  const proto = findJar(path.join(cache, 'com.google.protobuf/protobuf-java'));
  const inspectorSource = path.join(ROOT, 'output/marathon-2026-10/InspectAab.java');
  check(aapt && proto && fs.existsSync(inspectorSource), 'manifest_inspector_unavailable');
  // Source-file mode avoids trusting a stale compiled inspector and writes no build output.
  const inspection = JSON.parse(run(java.java, ['-cp', [aapt, proto].join(path.delimiter), inspectorSource, artifact], 'aab_inspection_failed'));
  const certificateSha256 = inspection.certificateSha256List?.[0];
  check(inspection.package === config.android.package && inspection.versionName === config.version
    && inspection.versionCode === config.android.versionCode && inspection.debuggable === false
    && inspection.minSdkVersion === 24 && inspection.targetSdkVersion === 36
    && JSON.stringify(inspection.architectures) === JSON.stringify(ARCHITECTURES)
    && inspection.deepLinkSchemes?.includes('slova'), 'aab_identity_mismatch');
  check(inspection.signatureVerifiedByJarFile === true && inspection.signatureVerifiedByJarInputStream === true
    && inspection.manifestIsFirstJarEntry === true && inspection.jarInputStreamManifestAvailable === true
    && inspection.certificateSha256List.length === 1 && inspection.jarInputStreamCertificateSha256List?.length === 1
    && inspection.jarInputStreamCertificateSha256List[0] === certificateSha256
    && inspection.payloadEntries > 0 && inspection.signedPayloadEntries === inspection.payloadEntries
    && inspection.jarInputStreamPayloadEntries === inspection.payloadEntries
    && inspection.jarInputStreamSignedPayloadEntries === inspection.payloadEntries
    && inspection.unsignedPayloads?.length === 0 && inspection.jarInputStreamUnsignedPayloads?.length === 0,
  'aab_signature_coverage_failed');

  const properties = fs.readFileSync(path.join(ROOT, 'credentials/keystore.properties'), 'utf8');
  const expectedKey = path.join(ROOT, 'credentials/release.jks');
  const configuredKey = path.resolve(ROOT, 'android/app', signingProperty(properties, 'storeFile'));
  const canonicalPath = (filename) => process.platform === 'win32' ? fs.realpathSync(filename).toLowerCase() : fs.realpathSync(filename);
  check(canonicalPath(configuredKey) === canonicalPath(expectedKey), 'release_keystore_mismatch');
  const publicCertificate = run(java.keytool, ['-J-Duser.language=en', '-list', '-v', '-keystore', expectedKey,
    '-alias', signingProperty(properties, 'keyAlias'), '-storepass:env', 'SLOVA_VERIFY_STORE_PASSWORD'],
  'release_certificate_check_failed', { SLOVA_VERIFY_STORE_PASSWORD: signingProperty(properties, 'storePassword') });
  const keyCertificateSha256 = publicCertificate.match(/SHA256:\s*([A-F0-9:]+)/)?.[1].replaceAll(':', '').toLowerCase();
  check(keyCertificateSha256 && keyCertificateSha256 === certificateSha256 && previous.certificateSha256 === certificateSha256,
    'release_certificate_mismatch');
  const signing = run(java.jarsigner, ['-J-Duser.language=en', '-verify', artifact], 'jarsigner_failed');
  check(signing.includes('jar verified.') && !/internal inconsistencies|unsigned entries/i.test(signing), 'jarsigner_coverage_failed');

  const python = process.env.SLOVA_VERIFY_PYTHON || (fs.existsSync('C:/Python312/python.exe') ? 'C:/Python312/python.exe' : 'python');
  const bundle = JSON.parse(run(python, ['-c',
    'import sys,zipfile,hashlib,json; z=zipfile.ZipFile(sys.argv[1]); b=z.read("base/assets/index.android.bundle"); print(json.dumps({"sha256":hashlib.sha256(b).hexdigest(),"sizeBytes":len(b),"hermesMagic":b[:8].hex()}))',
    artifact], 'embedded_bundle_read_failed'));
  const generated = fs.readFileSync(path.join(ROOT, 'android/app/build/generated/assets/react/release/index.android.bundle'));
  check(bundle.sha256 === hash(generated) && bundle.sizeBytes === generated.length && bundle.hermesMagic === HERMES_MAGIC,
    'embedded_hermes_bundle_mismatch');

  const mapFilename = path.join(ROOT, 'android/app/build/generated/sourcemaps/react/release/index.android.bundle.map');
  const mapBytes = fs.readFileSync(mapFilename);
  const sourceMap = JSON.parse(mapBytes.toString('utf8'));
  check(Array.isArray(sourceMap.sources) && Array.isArray(sourceMap.sourcesContent), 'native_source_map_invalid');
  const sources = SOURCE_FILES.map((file) => {
    const indexes = sourceMap.sources.flatMap((source, index) => {
      const normalized = String(source).replaceAll('\\', '/');
      return normalized === file || normalized.endsWith(`/${file}`) ? [index] : [];
    });
    const current = fs.readFileSync(path.join(ROOT, file), 'utf8');
    check(indexes.length === 1 && sourceMap.sourcesContent[indexes[0]] === current, 'compiled_source_map_mismatch');
    return { file, sha256: hash(current), matchesCompiledSourceMap: true };
  });
  const localEndpointCheck = verifyBundleMarkers(generated, sourceMap);
  let privateSecretScan = { requested: false, checkedValues: 0, absent: null };
  if (options.privateEnv) {
    const passwords = parsePrivatePasswords(fs.readFileSync(options.privateEnv, 'utf8'));
    for (const password of passwords) {
      check(!generated.includes(Buffer.from(password, 'utf8')) && !generated.includes(Buffer.from(password, 'utf16le'))
        && !sourceMap.sourcesContent.some((source) => typeof source === 'string' && source.includes(password)), 'private_secret_scan_failed');
    }
    privateSecretScan = { requested: true, checkedValues: PASSWORD_KEYS.length, absent: true };
  }
  const artifactSha256 = fileHash(artifact);
  check(artifactSha256 === inspection.sha256 && fs.statSync(artifact).size === inspection.sizeBytes, 'artifact_changed_during_verification');
  const report = {
    status: 'PASS', checkedAtUtc: new Date().toISOString(), artifact, sha256: artifactSha256, sizeBytes: inspection.sizeBytes,
    package: inspection.package, versionName: inspection.versionName, versionCode: inspection.versionCode,
    architectures: inspection.architectures, minSdkVersion: inspection.minSdkVersion, targetSdkVersion: inspection.targetSdkVersion,
    debuggable: inspection.debuggable, certificateSha256, signatureVerifiedByJarFile: true, signatureVerifiedByJarInputStream: true,
    signedPayloadEntries: inspection.signedPayloadEntries, streamedSignedPayloadEntries: inspection.jarInputStreamSignedPayloadEntries,
    manifestIsFirstJarEntry: true, jarsignerVerified: true, matchesExistingReleaseKeystore: true, matchesPreviousReleaseCertificate: true,
    previousRelease: { versionName: previous.versionName, versionCode: previous.versionCode, report: options.previousReport },
    embeddedHermesBundle: bundle, sourceMapSha256: hash(mapBytes), sources,
    robokassaHostname: 'auth.robokassa.ru', robokassaCheckoutPath: '/Merchant/Index.aspx', billingProtocol: 'robokassa-v3',
    billingProtocolHeaderPresent: true, productionBackendUrlPresent: true, localEndpointCheck, privateSecretScan,
    warnings: ['Android upload certificates are self-signed; this does not verify a public trust chain or a trusted timestamp.',
      'JAR payload signatures do not protect POSIX ZIP attributes.',
      'The React Native localhost:8081 development-server fallback may remain in dependency bytecode. This check excludes Slova local API configuration, not every framework localhost constant.'],
    notVerified: ['Real provider checkout, recurring charge, fiscal receipt issuance and device browser return.', 'RuStore upload or moderation acceptance.'],
  };
  fs.mkdirSync(reportDir, { recursive: true });
  // Never overwrite the October reports or an earlier verification in this directory.
  fs.writeFileSync(reportFiles.inspection, `${JSON.stringify(inspection, null, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(reportFiles.signing, signing, { flag: 'wx' });
  fs.writeFileSync(reportFiles.verification, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, artifact, report: reportFiles.verification,
    versionName: report.versionName, versionCode: report.versionCode, sha256: artifactSha256, certificateSha256, privateSecretScan }, null, 2));
  return report;
}

module.exports = { parseArguments, parsePrivatePasswords, verifyBundleMarkers, main };
if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node scripts/verify-robokassa-aab.cjs --artifact <signed-reordered.aab> --report-dir <new-report-directory> [--private-env <private-robokassa.env>] [--previous-report <prior-verification.json>]');
  } else {
    try { main(); } catch (error) {
      console.error(error instanceof VerificationError ? error.message : 'aab_verification_failed');
      process.exitCode = 1;
    }
  }
}
