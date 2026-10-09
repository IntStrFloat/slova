const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [
  'android/app/build.gradle',
  'android/app/src/main/java/com/intstrfloat/slova/MainApplication.kt',
  'android/app/src/main/AndroidManifest.xml',
];
const originals = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
const evidence = path.join(root, 'output/retention-2026-10-03');
fs.mkdirSync(evidence, { recursive: true });
try {
  fs.writeFileSync(path.join(root, files[0]), originals[0] + '\nafterEvaluate { android.buildTypes.release.applicationIdSuffix = ".retentionqa" }\n');
  const initialization = /    val appMetricaConfig =\s*\n\s*AppMetricaConfig\.newConfigBuilder\(BuildConfig\.APPMETRICA_API_KEY\)\.build\(\)\s*\n\s*AppMetrica\.activate\(this, appMetricaConfig\)/;
  if (!initialization.test(originals[1])) throw new Error('Unknown AppMetrica initialization: refusing a QA build that could send production events');
  fs.writeFileSync(path.join(root, files[1]), originals[1].replace(initialization, (block) =>
    `    if (!BuildConfig.APPLICATION_ID.endsWith(".retentionqa")) {\n${block}\n    }`));
  fs.writeFileSync(path.join(root, files[2]), originals[2].replace(/<meta-data\b[^>]*android:name="ru\.rustore\.sdk\.pushclient\.project_id"[^>]*\/>/g, ''));
  const result = spawnSync(path.join(root, 'android/gradlew.bat'), ['app:assembleRelease', '-PreactNativeArchitectures=x86_64', '--max-workers=1', '--console=plain', '--stacktrace'], {
    cwd: path.join(root, 'android'), shell: true, stdio: 'inherit',
    env: {
      ...process.env, JAVA_HOME: 'C:/Program Files/Android/Android Studio/jbr',
      ANDROID_HOME: 'C:/Users/Dima2/AppData/Local/Android/Sdk',
      EXPO_PUBLIC_API_URL: 'http://localhost:9', EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID: '',
      EXPO_PUBLIC_YANDEX_BANNER_AD_UNIT_ID: 'demo-banner-yandex',
      EXPO_PUBLIC_YANDEX_INTERSTITIAL_AD_UNIT_ID: 'demo-interstitial-yandex',
      EXPO_PUBLIC_YANDEX_REWARDED_AD_UNIT_ID: 'demo-rewarded-yandex',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`QA Gradle failed: ${result.status}`);
  fs.copyFileSync(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'), path.join(evidence, 'slova-retention-qa.apk'));
  console.log('Isolated QA package: com.intstrfloat.slova.retentionqa; production profiles and services are untouched.');
} finally {
  files.forEach((file, index) => fs.writeFileSync(path.join(root, file), originals[index]));
}
