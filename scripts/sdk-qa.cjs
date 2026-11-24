/* global __dirname */
// Local-only entry point. Does not install apps, create AVDs, deploy or publish.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, '.omx', 'private', 'sdkqa-backend');
const API_PORT = 18788;
const METRO_PORT = 18081;

function qaEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(APPMETRICA_|ROBOKASSA_|YOOKASSA_|TIMEWEB_|BILLING_)/.test(key)) delete env[key];
  }
  return {
    ...env,
    SLOVA_SDK_QA: '1',
    EXPO_PUBLIC_LOCAL_SDK_QA: '1',
    EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_GAME_PLATFORM: 'android',
    EXPO_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
    EXPO_PUBLIC_RELEASE_CHANNEL: 'local-sdk-qa',
    EXPO_PUBLIC_YANDEX_TEST_ADS: '1',
    EXPO_PUBLIC_ANALYTICS_TEST_DEVICE: '1',
    APPMETRICA_API_KEY: '', APPMETRICA_REQUIRED: '0', APPMETRICA_TEST_MODE: '1',
    EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID: '', EXPO_PUBLIC_RUSTORE_CONSOLE_APP_ID: '',
    RUSTORE_REMOTE_CONFIG_APP_ID: '', EXPO_PUBLIC_RUSTORE_REMOTE_CONFIG_ENABLED: '0',
    EXPO_PUBLIC_RUSTORE_REVIEW_DIAGNOSTICS: '1',
    EXPO_PUBLIC_RUSTORE_UPDATES_ENABLED: '0',
    PORT: String(API_PORT),
    API_KEY: '', TRUST_PROXY: '0', CONTENT_CATALOG_PATH: '',
    DATA_PATH: path.join(DATA, 'store.json'),
    MODERATION_DATA_PATH: path.join(DATA, 'moderation.json'),
    BILLING_DATA_PATH: path.join(DATA, 'billing.json'),
    BILLING_NOTICES_DATA_PATH: path.join(DATA, 'notices.json'),
    BILLING_MIGRATION_RESOLUTIONS_PATH: path.join(DATA, 'migration-resolutions.json'),
    BILLING_RETIRED_JOURNALS: '[]', BILLING_ENABLED: '0', BILLING_LIVE_READY: '0',
    BILLING_PROVIDER: 'robokassa', BILLING_MODE: 'test',
    BILLING_PUBLIC_BASE: `http://127.0.0.1:${API_PORT}`,
    BILLING_NOTICE_PROVIDER: '', ROBOKASSA_MERCHANT_LOGIN: '',
    APPMETRICA_SERVER_EVENTS_ENABLED: '0', APPMETRICA_POST_API_KEY: '',
    FEATURE_REMOTE_WORD_POLICY: '0', FEATURE_WORD_REPORTS: '0',
    CI: '0',
  };
}

/** Compile the ordinary native source set locally, without any live service configuration. */
function nativeDefaultEnvironment() {
  const env = { ...qaEnvironment(), SLOVA_SDK_QA: '0', EXPO_PUBLIC_LOCAL_SDK_QA: '0',
    EXPO_PUBLIC_RUSTORE_REVIEW_DIAGNOSTICS: '0', EXPO_PUBLIC_RELEASE_CHANNEL: 'local-native-defaults' };
  delete env.SLOVA_SDK_QA_VERSION_CODE;
  return env;
}

function run(args, next, env = qaEnvironment()) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
  child.on('error', () => { console.error('SDK QA: local helper failed to start'); process.exitCode = 1; });
  child.on('exit', (code) => {
    if (code === 0 && next) next();
    else process.exitCode = code ?? 1;
  });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  return child;
}

function main(command) {
  if (command === 'prebuild') {
    return run(['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install'],
      () => run(['scripts/patch-signing.js']));
  }
  if (command === 'prebuild-native-defaults') {
    const env = nativeDefaultEnvironment();
    return run(['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install'],
      () => run(['scripts/patch-signing.js'], undefined, env), env);
  }
  if (command === 'backend') {
    fs.mkdirSync(DATA, { recursive: true });
    console.log(`Local SDK QA backend: 127.0.0.1:${API_PORT}; payments, mail and server analytics disabled`);
    return run(['backend/index.cjs']);
  }
  if (command === 'metro') {
    // SDK 56 treats --offline and --localhost as mutually exclusive; EXPO_OFFLINE
    // disables outbound CLI requests while --localhost also binds Metro locally.
    return run(['--dns-result-order=ipv4first', 'node_modules/expo/bin/cli', 'start', '--localhost', '--port', String(METRO_PORT)]);
  }
  if (['build', 'build-offline', 'build-native-tests', 'build-native-defaults-offline'].includes(command)) {
    const nativeDefaults = command === 'build-native-defaults-offline';
    const env = nativeDefaults ? nativeDefaultEnvironment() : qaEnvironment();
    const studioJdk = path.join(env.ProgramFiles ?? 'C:/Program Files', 'Android', 'Android Studio', 'jbr');
    if (fs.existsSync(path.join(studioJdk, 'bin', 'java.exe'))) env.JAVA_HOME = studioJdk;
    env.ANDROID_HOME ??= path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
    env.CMAKE_BUILD_PARALLEL_LEVEL = '2';
    const offlineArgs = [];
    if (command !== 'build') {
      const initScript = path.join(ROOT, '.omx', 'private', 'sdkqa-maven.init.gradle');
      if (!fs.existsSync(initScript)) throw new Error('Prepare the verified local QA Maven mirror first.');
      offlineArgs.push('--offline', '--init-script', initScript);
    }
    const nativeTests = [':reminders:assembleDebugAndroidTest', ':react-native-rustore-push:assembleDebugAndroidTest'];
    const tasks = command === 'build-native-tests' ? nativeTests : [':app:assembleRelease', ':app:bundleRelease'];
    if (command !== 'build-native-tests' && process.argv.includes('--with-native-tests')) tasks.push(...nativeTests);
    if (nativeDefaults && process.argv.includes('--with-dependencies')) tasks.unshift(':app:dependencies', '--configuration', 'releaseRuntimeClasspath');
    const child = spawn('cmd.exe', ['/d', '/c', 'gradlew.bat', ...tasks,
      '--max-workers=2', '--no-parallel', nativeDefaults
        ? '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64' : '-PreactNativeArchitectures=x86_64',
      '-Pkotlin.compiler.execution.strategy=in-process', '-Pandroid.enableMinifyInReleaseBuilds=true',
      '-Pandroid.enableShrinkResourcesInReleaseBuilds=true', '-Pslova.crashQa=' + !nativeDefaults, ...offlineArgs],
    { cwd: path.join(ROOT, 'android'), env, stdio: 'inherit', windowsHide: true });
    child.on('error', () => { console.error('SDK QA: local Gradle build failed to start'); process.exitCode = 1; });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
    return child;
  }
  throw new Error('Usage: node scripts/sdk-qa.cjs prebuild|backend|metro|build|build-offline|build-native-tests|prebuild-native-defaults|build-native-defaults-offline');
}

module.exports = { qaEnvironment, nativeDefaultEnvironment, API_PORT, METRO_PORT };
if (require.main === module) {
  try { main(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
