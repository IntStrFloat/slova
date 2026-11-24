// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../withYandexEasyMonetization.js') as {
  patchAppBuildGradle(contents: string): string;
  patchProjectBuildGradle(contents: string): string;
  addGoogleAppId(manifest: unknown, appId: string): unknown;
  patchGradleProperties(properties: { type: string; key?: string; value?: string }[]): unknown;
};

const APP = 'android {}\n\ndependencies {\n    implementation("com.facebook.react:react-android")\n}\n';
const PROJECT = 'buildscript { repositories { google() } }\nallprojects {\n  repositories {\n    google()\n    mavenCentral()\n    maven { url \'https://nexus-external.rustore.ru/repository/maven-rustore-exposed\' }\n  }\n}\n';
const META = 'com.google.android.gms.ads.APPLICATION_ID';
type Manifest = { manifest: { application: { $: Record<string, string>; 'meta-data'?: { $: Record<string, string> }[] }[] } };
const manifest = (): Manifest => ({ manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } });

describe('Yandex Easy Monetization native configuration', () => {
  test('migrates the VK-only setup to the full unified build without exclusions or duplicates', () => {
    const old = APP.replace('dependencies {', 'dependencies {\n    implementation("com.yandex.ads.mediation:mobileads-mytarget:5.51.2.2")');
    const next = plugin.patchAppBuildGradle(old);
    expect(next).toContain('com.yandex.android:mobileads-mediation:8.6.0.0');
    expect(next).not.toContain('mobileads-mytarget:');
    expect(next).not.toContain('exclude');
    expect(next).toContain('com.facebook.react:react-android');
    expect(plugin.patchAppBuildGradle(next)).toBe(next);
  });

  test('upgrades an existing unified dependency', () => {
    const old = plugin.patchAppBuildGradle(APP).replace('8.6.0.0', '8.5.0.0');
    const next = plugin.patchAppBuildGradle(old);
    expect(next).not.toContain('8.5.0.0');
    expect(next.match(/mobileads-mediation:/g)).toHaveLength(1);
  });

  test('adds the documented repositories in allprojects, preserving other repositories', () => {
    const next = plugin.patchProjectBuildGradle(PROJECT);
    expect(next).toContain('https://android-sdk.is.com/');
    expect(next).toContain('https://artifact.bytedance.com/repository/pangle');
    expect(next).toContain('https://sdk.tapjoy.com/');
    expect(next).toContain('https://dl-maven-android.mintegral.com/repository/mbridge_android_sdk_oversea');
    expect(next).toContain('https://cboost.jfrog.io/artifactory/chartboost-ads/');
    expect(next).toContain('https://dl.appnext.com/');
    expect(next).toContain('https://developer.huawei.com/repo/');
    expect(next).toContain('https://artifactory.bidmachine.io/bidmachine');
    expect(next).toContain("includeGroupByRegex 'io[.]bidmachine([.].*)?'");
    expect(next).toContain('https://nexus-external.rustore.ru/repository/maven-rustore-exposed');
    expect(next.startsWith('buildscript { repositories { google() } }')).toBe(true);
    expect(plugin.patchProjectBuildGradle(next)).toBe(next);
  });

  test('never invents a Google application ID when the manager has not provided one', () => {
    const value = manifest();
    const original = JSON.stringify(value);
    plugin.addGoogleAppId(value, '');
    expect(JSON.stringify(value)).toBe(original);
  });

  test('uses a matching Kotlin compiler and catalog version without skipping metadata checks', () => {
    const next = plugin.patchProjectBuildGradle(PROJECT.replace('buildscript {', 'buildscript { dependencies { classpath(\'org.jetbrains.kotlin:kotlin-gradle-plugin\') }'));
    expect(next).toContain('classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.0")');
    const properties = [{ type: 'property', key: 'hermesEnabled', value: 'true' },
      { type: 'property', key: 'android.kotlinVersion', value: '2.1.20' }];
    const updated = plugin.patchGradleProperties(properties);
    expect(updated).toEqual([
      properties[0], { type: 'property', key: 'android.kotlinVersion', value: '2.3.0' },
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx6144m -XX:MaxMetaspaceSize=1024m' },
    ]);
    expect(plugin.patchGradleProperties(updated as typeof properties)).toEqual(updated);
    expect(next).not.toContain('skip-metadata');
  });

  test('raises template build memory while preserving other JVM options and larger limits', () => {
    const patch = (value: string) => plugin.patchGradleProperties([
      { type: 'property', key: 'org.gradle.jvmargs', value },
    ]);
    expect(patch('-Xmx2g -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8')).toEqual(expect.arrayContaining([
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx6144m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8' },
    ]));
    expect(patch('-Xmx8g -XX:MaxMetaspaceSize=2g')).toEqual(expect.arrayContaining([
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx8g -XX:MaxMetaspaceSize=2g' },
    ]));
  });

  test('adds or updates a supplied application ID and rejects ad-unit IDs', () => {
    const value = manifest();
    plugin.addGoogleAppId(value, 'ca-app-pub-1111111111111111~1111111111');
    plugin.addGoogleAppId(value, 'ca-app-pub-2222222222222222~2222222222');
    const entries = value.manifest.application[0]['meta-data']?.filter((entry) => entry.$['android:name'] === META);
    expect(entries).toHaveLength(1);
    expect(entries?.[0].$['android:value']).toBe('ca-app-pub-2222222222222222~2222222222');
    expect(() => plugin.addGoogleAppId(value, 'R-M-20249615-1')).toThrow(/invalid Google/);
  });

  test('stops when generated Gradle structure is unexpected', () => {
    expect(() => plugin.patchAppBuildGradle('android {}')).toThrow(/dependencies block/);
    expect(() => plugin.patchProjectBuildGradle('buildscript {}')).toThrow(/allprojects.repositories/);
  });
});
