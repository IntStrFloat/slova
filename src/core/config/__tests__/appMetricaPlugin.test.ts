const {
  patchAppBuildGradle,
  patchMainApplication,
  validateApiKey,
} = jest.requireActual('../../../../plugins/withAppMetrica');

describe('AppMetrica config plugin', () => {
  const apiKey = '00000000-0000-4000-8000-000000000001';

  it('keeps extended crash reporting off and allows explicit isolated keyless QA metadata only', () => {
    const { patchCrashManifest } = jest.requireActual('../../../../plugins/withAppMetrica');
    const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const read = (name: string) => (manifest.manifest.application[0] as { 'meta-data'?: { $: Record<string, string> }[] })
      ['meta-data']?.find((item) => item.$['android:name'] === name)?.$['android:value'];
    patchCrashManifest(manifest, { package: 'com.intstrfloat.slova', apiKey });
    expect(read('slova.crash.extended_enabled')).toBe('false');
    expect(read('slova.crash.qa_enabled')).toBe('false');
    expect(() => patchCrashManifest(manifest, { package: 'com.intstrfloat.slova', apiKey: '', crashQa: true }))
      .toThrow(/isolated keyless/);
    expect(() => patchCrashManifest(manifest, { package: 'com.intstrfloat.slova.sdkqa', apiKey, crashQa: true }))
      .toThrow(/isolated keyless/);
    patchCrashManifest(manifest, { package: 'com.intstrfloat.slova.sdkqa', apiKey: '', crashQa: true, version: '0.1.29', buildId: '33' });
    expect(read('slova.crash.qa_enabled')).toBe('true');
    patchCrashManifest(manifest, { package: 'com.intstrfloat.slova.sdkqa', apiKey: '', crashQa: true });
    expect((manifest.manifest.application[0] as { 'meta-data'?: unknown[] })['meta-data'])
      .toHaveLength(4);
  });

  it('accepts the effective SDKQA applicationId while preserving its production native namespace', () => {
    const { patchCrashManifest } = jest.requireActual('../../../../plugins/withAppMetrica');
    const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const config = { android: { package: 'com.intstrfloat.slova' }, extra: { sdkQa: true } };
    expect(() => patchCrashManifest(manifest, { package: config.android.package, sdkQa: config.extra.sdkQa,
      apiKey: '', crashQa: true })).not.toThrow();
    expect(config.android.package).toBe('com.intstrfloat.slova');
    expect(() => patchCrashManifest(manifest, { package: config.android.package, sdkQa: false,
      apiKey: '', crashQa: true })).toThrow(/isolated keyless/);
    expect(() => patchCrashManifest(manifest, { package: 'another.app', sdkQa: true,
      apiKey: '', crashQa: true })).toThrow(/isolated keyless/);
  });

  it('adds the SDK dependency and API key BuildConfig field idempotently', () => {
    const source = `android {
  defaultConfig {
    applicationId 'com.intstrfloat.slova'
  }
}

dependencies {
  implementation("com.facebook.react:react-android")
}
`;

    const patched = patchAppBuildGradle(source, apiKey);
    const patchedTwice = patchAppBuildGradle(patched, apiKey);

    expect(patched).toContain(
      'implementation("io.appmetrica.analytics:analytics:8.6.0")',
    );
    expect(patched).toContain(
      'buildConfigField "String", "APPMETRICA_API_KEY"',
    );
    expect(patchedTwice).toBe(patched);
  });

  it('installs the consent bootstrap before React Native without direct SDK activation', () => {
    const source = `package com.intstrfloat.slova

import android.app.Application
import com.facebook.react.ReactApplication

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
`;

    const patched = patchMainApplication(source);
    const patchedTwice = patchMainApplication(patched);

    expect(patched).toContain('import expo.modules.appmetrica.AppMetricaPrivacy');
    expect(patched).toContain(
      'AppMetricaPrivacy.bootstrap(this, BuildConfig.APPMETRICA_API_KEY, BuildConfig.APPMETRICA_QA_BUILD)',
    );
    expect(patched).not.toContain('AppMetrica.activate(');
    expect(patched.indexOf('AppMetricaPrivacy.bootstrap')).toBeLessThan(
      patched.indexOf('loadReactNative(this)'),
    );
    expect(patchedTwice).toBe(patched);
  });

  it('migrates the released unconditional startup activation idempotently', () => {
    const source = `package com.intstrfloat.slova
import io.appmetrica.analytics.AppMetrica
import io.appmetrica.analytics.AppMetricaConfig
class MainApplication {
  override fun onCreate() {
    super.onCreate()
    val appMetricaConfig =
      AppMetricaConfig.newConfigBuilder(BuildConfig.APPMETRICA_API_KEY).build()
    AppMetrica.activate(this, appMetricaConfig)
    loadReactNative(this)
  }
}
`;
    const patched = patchMainApplication(source);
    expect(patched).not.toContain('AppMetricaConfig');
    expect(patched).not.toContain('AppMetrica.activate(');
    expect(patched.match(/AppMetricaPrivacy\.bootstrap/g)).toHaveLength(1);
    expect(patchMainApplication(patched)).toBe(patched);
  });

  it('updates the existing SDK declaration rather than adding a second SDK dependency', () => {
    const source = `android { defaultConfig {} }
dependencies { implementation("io.appmetrica.analytics:analytics:8.3.0") }`;
    const patched = patchAppBuildGradle(source, apiKey);
    expect(patched).toContain('io.appmetrica.analytics:analytics:8.6.0');
    expect(patched.match(/io\.appmetrica\.analytics:analytics:/g)).toHaveLength(1);
    expect(patchAppBuildGradle(patched, apiKey)).toBe(patched);
  });

  it('pins the physical-release QA guard in BuildConfig and updates it idempotently', () => {
    const source = `android { defaultConfig {} }\ndependencies {}`;
    const qa = patchAppBuildGradle(source, apiKey, true);
    expect(qa).toContain('buildConfigField "boolean", "APPMETRICA_QA_BUILD", "true"');
    const production = patchAppBuildGradle(qa, apiKey, false);
    expect(production).toContain('buildConfigField "boolean", "APPMETRICA_QA_BUILD", "false"');
    expect(production.match(/APPMETRICA_QA_BUILD/g)).toHaveLength(1);
    expect(patchAppBuildGradle(production, apiKey, false)).toBe(production);
  });

  it('fails prebuild instead of leaving an unrecognised direct activation outside the consent gate', () => {
    const source = `package example
class App { fun onCreate() {
  super.onCreate()
  AppMetrica.activate(this, otherConfig)
} }`;
    expect(() => patchMainApplication(source)).toThrow('unsupported direct activation');
  });

  it('rejects missing or malformed API keys', () => {
    expect(() => validateApiKey(undefined)).toThrow(
      'APPMETRICA_API_KEY is missing',
    );
    expect(() => validateApiKey('not-a-key')).toThrow(
      'APPMETRICA_API_KEY must be a UUID',
    );
    expect(validateApiKey(apiKey)).toBe(apiKey);
  });

  it('allows an intentionally keyless private build without accepting a malformed key', () => {
    expect(validateApiKey(undefined, false)).toBe('');
    expect(() => validateApiKey('not-a-key', false)).toThrow('APPMETRICA_API_KEY must be a UUID');
    const source = 'android { defaultConfig {} }\ndependencies {}';
    const keyless = patchAppBuildGradle(source, undefined, true, false);
    expect(keyless).toContain('"APPMETRICA_API_KEY", "\\"\\""');
    expect(keyless).toContain('"APPMETRICA_QA_BUILD", "true"');
    expect(patchAppBuildGradle(keyless, undefined, true, false)).toBe(keyless);
  });

  it('replaces the previous build key when changing destination or making a build keyless', () => {
    const source = 'android { defaultConfig {} }\ndependencies {}';
    const previous = patchAppBuildGradle(source, apiKey);
    const nextKey = '00000000-0000-4000-8000-000000000002';
    const redirected = patchAppBuildGradle(previous, nextKey);
    expect(redirected).not.toContain(apiKey);
    expect(redirected).toContain(nextKey);
    const keyless = patchAppBuildGradle(redirected, '', true, false);
    expect(keyless).not.toContain(nextKey);
    expect(keyless.match(/buildConfigField "String", "APPMETRICA_API_KEY"/g)).toHaveLength(1);
    expect(() => patchAppBuildGradle(keyless, undefined)).toThrow('APPMETRICA_API_KEY is missing');
  });

  it('rejects duplicate or unsupported key fields instead of retaining a previous destination', () => {
    const source = 'android { defaultConfig {} }\ndependencies {}';
    const previous = patchAppBuildGradle(source, apiKey);
    const field = previous.match(/buildConfigField "String", "APPMETRICA_API_KEY", [^\n]+/)![0];
    expect(() => patchAppBuildGradle(previous.replace(field, `${field}\n${field}`), apiKey))
      .toThrow('duplicate API key');
    expect(() => patchAppBuildGradle(previous.replace('buildConfigField "String",', 'buildConfigField("String",'), apiKey))
      .toThrow('unsupported API key');
  });

  it('rejects a single-quoted or mixed key declaration before changing the analytics destination', () => {
    const source = 'android { defaultConfig {} }\ndependencies {}';
    const singleQuoted = `buildConfigField 'String', 'APPMETRICA_API_KEY', '\"${apiKey}\"'`;
    expect(() => patchAppBuildGradle(source.replace('defaultConfig {', `defaultConfig { ${singleQuoted}`), '', true, false))
      .toThrow('unsupported API key');
    const mixed = patchAppBuildGradle(source, apiKey).replace('defaultConfig {', `defaultConfig { ${singleQuoted}\n`);
    expect(() => patchAppBuildGradle(mixed, '', true, false)).toThrow('unsupported API key');
  });
});
