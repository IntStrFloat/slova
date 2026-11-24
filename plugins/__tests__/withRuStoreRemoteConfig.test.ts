/* eslint-disable @typescript-eslint/no-require-imports */
const plugin = require('../withRuStoreRemoteConfig') as {
  patchAppBuildGradle(contents: string, appId?: string, enabled?: boolean): string;
  patchMainApplication(contents: string): string;
  validateAppId(value: unknown): string;
};
const appMetrica = require('../withAppMetrica') as { patchMainApplication(contents: string): string };
const gradle = 'android {\n  defaultConfig {\n    applicationId "com.intstrfloat.slova"\n  }\n}\ndependencies {}';
const application = 'package com.intstrfloat.slova\nimport android.app.Application\nclass MainApplication : Application() {\n override fun onCreate() {\n  super.onCreate()\n  loadReactNative(this)\n }\n}\n';

test('configuration is dormant by default, updates fields safely, and is idempotent', () => {
  const off = plugin.patchAppBuildGradle(gradle);
  expect(off).toContain('"RUSTORE_REMOTE_CONFIG_ENABLED", "false"');
  const on = plugin.patchAppBuildGradle(off, 'local-test-app', true);
  expect(on).toContain('local-test-app');
  expect(on).toContain('"RUSTORE_REMOTE_CONFIG_ENABLED", "true"');
  expect(plugin.patchAppBuildGradle(on, 'local-test-app', true)).toBe(on);
  const missing = plugin.patchAppBuildGradle(on, '', true);
  expect(missing).not.toContain('local-test-app');
  expect(missing).toContain('"RUSTORE_REMOTE_CONFIG_ENABLED", "false"');
  expect(() => plugin.validateAppId('invalid"; token')).toThrow('invalid app ID');
});

test('Application creates the SDK after native consent bootstrap and before React; no lazy JS init', () => {
  const source = appMetrica.patchMainApplication(application);
  const next = plugin.patchMainApplication(source);
  expect(next.indexOf('RemoteConfigRuntime.bootstrap')).toBeGreaterThan(next.indexOf('AppMetricaPrivacy.bootstrap'));
  expect(next.indexOf('RemoteConfigRuntime.bootstrap')).toBeLessThan(next.indexOf('loadReactNative'));
  expect(next).toContain('AppMetricaPrivacy.canReport(this)');
  expect(plugin.patchMainApplication(next)).toBe(next);
  expect(() => plugin.patchMainApplication(application)).toThrow('consent bootstrap');
});

test('unsupported or duplicate existing fields and changed host shapes fail without retaining old destinations', () => {
  const valid = plugin.patchAppBuildGradle(gradle, 'previous', true);
  const unsupported = valid.replace('"RUSTORE_REMOTE_CONFIG_APP_ID"', "'RUSTORE_REMOTE_CONFIG_APP_ID'");
  expect(() => plugin.patchAppBuildGradle(unsupported)).toThrow('unsupported BuildConfig');
  expect(() => plugin.patchAppBuildGradle('android {}')).toThrow('defaultConfig');
});
