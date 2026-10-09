// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../withRuStorePush.js') as {
  patchProjectBuildGradle(contents: string): string;
  addProjectIdMeta(manifest: unknown, projectId: string): unknown;
};

const ALLPROJECTS = `allprojects {
  repositories {
    google()
    mavenCentral()
  }
}
`;

const PROJECT_ID_META = 'ru.rustore.sdk.pushclient.project_id';

type ManifestApp = { $: Record<string, string>; 'meta-data'?: { $: Record<string, string> }[] };
const makeManifest = (): { manifest: { application: ManifestApp[] } } => ({
  manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] },
});

describe('withRuStorePush config plugin', () => {
  it('adds the RuStore maven repository idempotently', () => {
    const once = plugin.patchProjectBuildGradle(ALLPROJECTS);
    expect(once).toContain('artifactory-external.vkpartner.ru/artifactory/maven');
    expect(plugin.patchProjectBuildGradle(once)).toBe(once);
  });

  it('fails loudly if the expected Gradle repository block changes', () => {
    expect(() => plugin.patchProjectBuildGradle('buildscript {}')).toThrow(/allprojects\.repositories/);
  });

  it('upserts the project id manifest metadata', () => {
    const manifest = makeManifest();
    plugin.addProjectIdMeta(manifest, 'first');
    plugin.addProjectIdMeta(manifest, 'second');
    const entries = (manifest.manifest.application[0]['meta-data'] ?? [])
      .filter((item) => item.$['android:name'] === PROJECT_ID_META);
    expect(entries).toHaveLength(1);
    expect(entries[0].$['android:value']).toBe('second');
  });
});
