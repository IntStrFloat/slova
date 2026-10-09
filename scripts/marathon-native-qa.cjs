const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/marathon-2026-10/native');
const files = [
  'android/app/build.gradle',
  'android/app/src/main/java/com/intstrfloat/slova/MainApplication.kt',
  'android/app/src/main/AndroidManifest.xml',
];
const originals = files.map((file) => fs.readFileSync(path.join(root, file)));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const releases = ['output/release/slova-0.1.14-vc18-release.apk', 'output/release/slova-0.1.14-vc18-release.aab'];
const releaseHashes = Object.fromEntries(releases.map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]));
const generatedBundle = path.join(root, 'android/app/build/generated/assets/react/release/index.android.bundle');
fs.mkdirSync(output, { recursive: true });
let built = false;
let bundleIsolation = null;
try {
  // Gradle does not track EXPO_PUBLIC environment changes as bundle inputs.
  // Remove the single generated bundle output so these QA values are rebuilt.
  if (fs.existsSync(generatedBundle)) fs.unlinkSync(generatedBundle);
  fs.writeFileSync(path.join(root, files[0]), originals[0].toString('utf8')
    + '\nafterEvaluate { android.buildTypes.release.applicationIdSuffix = ".marathonqa" }\n');
  const application = originals[1].toString('utf8');
  const initialization = /    val appMetricaConfig =\s*\n\s*AppMetricaConfig\.newConfigBuilder\(BuildConfig\.APPMETRICA_API_KEY\)\.build\(\)\s*\n\s*AppMetrica\.activate\(this, appMetricaConfig\)/;
  if (!initialization.test(application)) throw new Error('Unknown AppMetrica initialization; refusing unsafe QA build');
  fs.writeFileSync(path.join(root, files[1]), application.replace(initialization, (block) =>
    `    if (!BuildConfig.APPLICATION_ID.endsWith(".marathonqa")) {\n${block}\n    }`));
  const manifest = originals[2].toString('utf8');
  const push = /<meta-data\b[^>]*android:name="ru\.rustore\.sdk\.pushclient\.project_id"[^>]*\/>/g;
  if (!push.test(manifest)) throw new Error('Unknown push configuration; refusing unsafe QA build');
  fs.writeFileSync(path.join(root, files[2]), manifest.replace(push, ''));
  const log = fs.openSync(path.join(output, 'qa-build.log'), 'w');
  console.log('Building com.intstrfloat.slova.marathonqa; production release copies remain untouched.');
  let result;
  try {
    result = spawnSync(path.join(root, 'android/gradlew.bat'), [
      'app:assembleRelease', '-PreactNativeArchitectures=x86_64', '--max-workers=1', '--console=plain', '--stacktrace',
    ], {
      cwd: path.join(root, 'android'), shell: true, stdio: ['ignore', log, log],
      env: {
        ...process.env, JAVA_HOME: 'C:/Program Files/Android/Android Studio/jbr',
        ANDROID_HOME: 'C:/Users/Dima2/AppData/Local/Android/Sdk',
        EXPO_PUBLIC_API_URL: 'http://localhost:9', EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID: '',
        EXPO_PUBLIC_YANDEX_BANNER_AD_UNIT_ID: 'demo-banner-yandex',
        EXPO_PUBLIC_YANDEX_INTERSTITIAL_AD_UNIT_ID: 'demo-interstitial-yandex',
        EXPO_PUBLIC_YANDEX_REWARDED_AD_UNIT_ID: 'demo-rewarded-yandex',
      },
    });
  } finally { fs.closeSync(log); }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`QA Gradle failed: ${result.status}; see qa-build.log`);
  fs.copyFileSync(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'), path.join(output, 'slova-marathon-qa.apk'));
  const check = spawnSync('C:/Python312/python.exe', ['-c', [
    'import json,sys,zipfile',
    "bundle=zipfile.ZipFile(sys.argv[1]).read('assets/index.android.bundle')",
    "values=['http://localhost:9','demo-banner-yandex','demo-interstitial-yandex','demo-rewarded-yandex']",
    'print(json.dumps({value: value.encode() in bundle for value in values}))',
  ].join('\n'), path.join(output, 'slova-marathon-qa.apk')], { encoding: 'utf8' });
  if (check.error || check.status !== 0) throw check.error ?? new Error(check.stderr);
  bundleIsolation = JSON.parse(check.stdout);
  if (!Object.values(bundleIsolation).every(Boolean)) throw new Error('QA APK bundle does not contain the required isolated configuration');
  built = true;
} finally {
  files.forEach((file, index) => fs.writeFileSync(path.join(root, file), originals[index]));
  // Do not let a later production build reuse the QA API/ad configuration.
  if (fs.existsSync(generatedBundle)) fs.unlinkSync(generatedBundle);
  const sourceChecks = files.map((file, index) => ({
    path: file, before: hash(originals[index]), after: hash(fs.readFileSync(path.join(root, file))),
  }));
  const releaseChecks = releases.map((file) => ({
    path: file, before: releaseHashes[file], after: hash(fs.readFileSync(path.join(root, file))),
  }));
  if ([...sourceChecks, ...releaseChecks].some((check) => check.before !== check.after)) {
    throw new Error('QA build restoration verification failed');
  }
  fs.writeFileSync(path.join(output, 'qa-build-verification.json'), JSON.stringify({
    built, packageName: 'com.intstrfloat.slova.marathonqa', architecture: 'x86_64',
    isolation: { appMetricaActivation: false, api: 'http://localhost:9', ads: 'demo', pushProjectId: '' },
    bundleIsolation,
    sourceChecks, releaseChecks,
    apkSha256: built ? hash(fs.readFileSync(path.join(output, 'slova-marathon-qa.apk'))) : null,
  }, null, 2));
}
console.log('QA APK ready; every temporarily modified native source restored byte-for-byte.');
