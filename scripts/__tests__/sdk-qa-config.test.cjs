/* global __dirname */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const configure = require('../../app.config.js');

function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
const source = () => ({ name: 'Слова', slug: 'slova', android: { package: 'com.intstrfloat.slova' },
  plugins: ['./plugins/withRuStorePush', ['./plugins/withAppMetrica', { custom: 'retained' }],
    './plugins/withRuStoreRemoteConfig', ['./plugins/withRuStoreUpdates', { enabled: true, qa: false }],
    'expo-router'], extra: { retained: true }, experiments: { typedRoutes: true } });
const optionsFor = (result, name) => result.plugins.find((entry) => Array.isArray(entry) && entry[0] === name)?.[1];

test('local SDK QA preserves the native namespace while disabling production destinations', () => {
  withEnvironment({ SLOVA_SDK_QA: '1', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:18788', EXPO_PUBLIC_YANDEX_TEST_ADS: '1' }, () => {
    const original = source();
    const result = configure({ config: original });
    assert.equal(result.android.package, original.android.package);
    assert.equal(result.extra.sdkQa, true);
    assert.equal(result.extra.retained, true);
    assert.match(result.name, /SDK QA/);
    assert.deepEqual(optionsFor(result, './plugins/withAppMetrica'), { custom: 'retained', apiKey: '', required: false, qaBuild: true,
      crashQa: true, extendedCrashReporting: false });
    assert.equal(optionsFor(result, './plugins/withRuStorePush').projectId, '');
    assert.equal(optionsFor(result, './plugins/withRuStoreRemoteConfig').enabled, false);
    assert.deepEqual(optionsFor(result, './plugins/withRuStoreUpdates'), { enabled: false, qa: true });
    assert.equal(optionsFor(result, './plugins/withSdkQa').enabled, true);
    assert.deepEqual(original, source());
  });
});

test('SDK QA requires an explicit local backend and rejects remote or credentialled URLs', () => {
  for (const api of [undefined, 'https://example.com', 'http://127.0.0.1.evil.test:18788',
    'http://secret@localhost:18788', 'http://127.0.0.1:18788?token=fake']) {
    withEnvironment({ SLOVA_SDK_QA: '1', EXPO_PUBLIC_API_URL: api, EXPO_PUBLIC_YANDEX_TEST_ADS: '1' }, () => {
      assert.throws(() => configure({ config: source() }), /local SDK QA backend/);
    });
  }
  for (const api of ['http://127.0.0.1:18788', 'http://localhost:18788/', 'http://10.0.2.2:18788']) {
    withEnvironment({ SLOVA_SDK_QA: '1', EXPO_PUBLIC_API_URL: api, EXPO_PUBLIC_YANDEX_TEST_ADS: '1' }, () => assert.equal(configure({ config: source() }).extra.sdkQa, true));
  }
});

test('SDK QA refuses production ad units without the explicit test-ad switch', () => {
  withEnvironment({ SLOVA_SDK_QA: '1', EXPO_PUBLIC_API_URL: 'http://localhost:18788', EXPO_PUBLIC_YANDEX_TEST_ADS: undefined }, () => {
    assert.throws(() => configure({ config: source() }), /TEST_ADS=1/);
  });
});

test('QA package and cleartext metadata revert without changing the normal namespace or manifest', () => {
  const plugin = require('../../plugins/withSdkQa');
  const gradle = `android { namespace 'com.intstrfloat.slova'; defaultConfig { applicationId 'com.intstrfloat.slova' } }`;
  const qa = plugin.patchApplicationId(gradle, 'com.intstrfloat.slova', true);
  assert.match(qa, /applicationId 'com.intstrfloat.slova.sdkqa'/);
  assert.match(qa, /namespace 'com.intstrfloat.slova'/);
  assert.equal(plugin.patchApplicationId(qa, 'com.intstrfloat.slova', true), qa);
  assert.equal(plugin.patchApplicationId(qa, 'com.intstrfloat.slova', false), gradle);
  for (const cleartext of [undefined, 'false', 'true']) {
    const value = { manifest: { application: [{ $: { 'android:name': '.MainApplication',
      ...(cleartext === undefined ? {} : { 'android:usesCleartextTraffic': cleartext }) }, 'meta-data': [
      { $: { 'android:name': 'unrelated', 'android:value': 'keep' } },
      { $: { 'android:name': 'ru.rustore.sdk.pushclient.project_id', 'android:value': 'test-project' } },
    ] }] } };
    plugin.patchManifest(value, true);
    const first = JSON.stringify(value);
    assert.equal(value.manifest.application[0].$['android:usesCleartextTraffic'], 'true');
    assert.equal(value.manifest.application[0]['meta-data'].some((item) => item.$['android:name'].includes('project_id')), false);
    plugin.patchManifest(value, true);
    assert.equal(JSON.stringify(value), first);
    plugin.patchManifest(value, false);
    assert.equal(value.manifest.application[0].$['android:usesCleartextTraffic'], cleartext);
    assert.deepEqual(value.manifest.application[0]['meta-data'], [{ $: { 'android:name': 'unrelated', 'android:value': 'keep' } }]);
  }
});

test('the local launcher drops inherited financial credentials and enables only loopback services', () => {
  const { qaEnvironment } = require('../sdk-qa.cjs');
  withEnvironment({ ROBOKASSA_PASSWORD1: 'synthetic-secret', APPMETRICA_POST_API_KEY: 'synthetic-key',
    BILLING_ENABLED: '1', BILLING_NOTICE_PROVIDER: 'timeweb', TIMEWEB_MAIL_PASSWORD: 'synthetic-mail' }, () => {
    const env = qaEnvironment();
    assert.equal(env.ROBOKASSA_PASSWORD1, undefined);
    assert.equal(env.TIMEWEB_MAIL_PASSWORD, undefined);
    assert.equal(env.APPMETRICA_API_KEY, '');
    assert.equal(env.APPMETRICA_POST_API_KEY, '');
    assert.equal(env.BILLING_ENABLED, '0');
    assert.equal(env.BILLING_NOTICE_PROVIDER, '');
    assert.equal(env.APPMETRICA_SERVER_EVENTS_ENABLED, '0');
    assert.equal(env.EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID, '');
    assert.equal(env.EXPO_PUBLIC_RUSTORE_UPDATES_ENABLED, '0');
    assert.equal(env.EXPO_PUBLIC_API_URL, 'http://127.0.0.1:18788');
    assert.match(env.DATA_PATH.replaceAll('\\', '/'), /\/\.omx\/private\/sdkqa-backend\/store.json$/);
  });
});

test('the real Expo environment loader cannot repopulate QA credentials from project dotenv files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { qaEnvironment } = require('../sdk-qa.cjs');
  const fixture = path.resolve(__dirname, '../../.omx/tmp/sdk-qa-dotenv-fixture');
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, '.env.local'), 'ROBOKASSA_PASSWORD1=synthetic-only\nAPPMETRICA_API_KEY=synthetic-only\n');
  const result = spawnSync(process.execPath, ['-e',
    'const loader=require(process.argv[1]); const loaded=loader.loadProjectEnv(process.argv[2],{mode:"development",force:true,silent:true}); console.log(JSON.stringify({files:loaded.files,financialKeyPresent:!!process.env.ROBOKASSA_PASSWORD1,analyticsKey:process.env.APPMETRICA_API_KEY}));',
    require.resolve('@expo/env'), fixture], { env: qaEnvironment(), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim());
  assert.equal(observed.financialKeyPresent, false);
  assert.equal(observed.analyticsKey, '');
  assert.deepEqual(observed.files, []);
});

test('ordinary builds retain their configured analytics, push and remote config', () => {
  withEnvironment({ SLOVA_SDK_QA: undefined, EXPO_PUBLIC_API_URL: undefined }, () => {
    const original = source();
    const result = configure({ config: original });
    assert.equal(result.name, 'Слова');
    assert.equal(result.extra.sdkQa, false);
    assert.deepEqual(result.plugins.slice(0, original.plugins.length), original.plugins);
    assert.equal(optionsFor(result, './plugins/withSdkQa').enabled, false);
  });
});

test('a local two-version fixture can raise QA versionCode without editing the main app config', () => {
  const input = source(); input.android.versionCode = 33;
  withEnvironment({ SLOVA_SDK_QA: '1', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:18788',
    EXPO_PUBLIC_YANDEX_TEST_ADS: '1', SLOVA_SDK_QA_VERSION_CODE: '34' }, () => {
    assert.equal(configure({ config: input }).android.versionCode, 34);
    assert.equal(input.android.versionCode, 33);
  });
  for (const value of ['0', '-1', '3.4', '2147483648', 'unexpected']) {
    withEnvironment({ SLOVA_SDK_QA: '1', EXPO_PUBLIC_API_URL: 'http://localhost:18788',
      EXPO_PUBLIC_YANDEX_TEST_ADS: '1', SLOVA_SDK_QA_VERSION_CODE: value }, () => {
      assert.throws(() => configure({ config: input }), /QA versionCode/);
    });
  }
  withEnvironment({ SLOVA_SDK_QA: undefined, SLOVA_SDK_QA_VERSION_CODE: '34' }, () => {
    assert.equal(configure({ config: input }).android.versionCode, 33);
  });
});

test('ordinary native-source compilation remains keyless and cannot inherit QA controls or version override', () => {
  const { nativeDefaultEnvironment } = require('../sdk-qa.cjs');
  withEnvironment({ SLOVA_SDK_QA_VERSION_CODE: '34', APPMETRICA_API_KEY: 'synthetic-only',
    EXPO_PUBLIC_RUSTORE_UPDATES_ENABLED: '1', ROBOKASSA_PASSWORD1: 'synthetic-only' }, () => {
    const env = nativeDefaultEnvironment();
    assert.equal(env.SLOVA_SDK_QA, '0');
    assert.equal(env.EXPO_PUBLIC_LOCAL_SDK_QA, '0');
    assert.equal(env.SLOVA_SDK_QA_VERSION_CODE, undefined);
    assert.equal(env.APPMETRICA_API_KEY, '');
    assert.equal(env.EXPO_PUBLIC_RUSTORE_UPDATES_ENABLED, '0');
    assert.equal(env.EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID, '');
    assert.equal(env.ROBOKASSA_PASSWORD1, undefined);
    assert.equal(env.BILLING_ENABLED, '0');
    assert.equal(env.EXPO_NO_DOTENV, '1');
  });
});
