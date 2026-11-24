// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../withRuStoreUpdates.js') as {
  patchManifest(value: object, options?: { enabled?: boolean; qa?: boolean }): { manifest: { application: { 'meta-data': { $: Record<string, string> }[] }[] } };
  patchProjectBuildGradle(value: string): string;
};
function manifest() { return { manifest: { application: [{ 'meta-data': [{ $: { 'android:name': 'existing', 'android:value': 'keep' } }] }] } }; }
test('native real factory is disabled by default and force-disabled in QA even when enabled', () => {
  for (const options of [{}, { enabled: true, qa: true }, { enabled: false }]) {
    const value = plugin.patchManifest(manifest(), options);
    expect(value.manifest.application[0]['meta-data'][1].$['android:value']).toBe('false');
    expect(plugin.patchManifest(value, options)).toEqual(value);
  }
  expect(plugin.patchManifest(manifest(), { enabled: true }).manifest.application[0]['meta-data'][1].$['android:value']).toBe('true');
});
test('composed repository patch is idempotent and preserves myTarget', () => {
  const once = plugin.patchProjectBuildGradle("allprojects { repositories { google(); mavenCentral(); maven { url 'https://artifactory-external.vkpartner.ru/artifactory/maven' } } }");
  expect(plugin.patchProjectBuildGradle(once)).toBe(once); expect(once).toContain("includeGroupByRegex 'com[.]my[.]target'");
});
