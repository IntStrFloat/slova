// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../withRuStorePush.js') as {
  patchProjectBuildGradle(contents: string): string;
  addProjectIdMeta(manifest: unknown, projectId: string): unknown;
  patchMainActivity(contents: string): string;
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
  const activity = `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}`;
  it('defers only notification intents before Expo Linking receives cold/warm intents', () => {
    const once = plugin.patchMainActivity(activity);
    expect(once.indexOf('sanitizeSlovaNotificationIntent(intent)')).toBeLessThan(once.indexOf('super.onCreate(null)'));
    expect(once).toContain('override fun onNewIntent(intent: android.content.Intent)');
    expect(once).toContain('super.onNewIntent(intent)');
    expect(once).toContain('vkpns.analytics_payload.message_id');
    expect(once).toContain('slovaReminderId');
    expect(once).toContain('intent.data = null');
    expect(once).toContain('setIntent(intent)');
    expect(plugin.patchMainActivity(once)).toBe(once);
  });
  it('preserves an existing warm-intent handler and CRLF while adding the guard once', () => {
    const existing = activity.replace('\n}', '\n  override fun onNewIntent(link: Intent) {\n    keepExisting(link)\n    super.onNewIntent(link)\n  }\n}').replace(/\n/g, '\r\n');
    const next = plugin.patchMainActivity(existing);
    expect(next).toContain('sanitizeSlovaNotificationIntent(link)');
    expect(next).toContain('keepExisting(link)');
    expect(next.match(/override fun onNewIntent/g)).toHaveLength(1);
    expect(next.replace(/\r\n/g, '')).not.toContain('\n');
    expect(plugin.patchMainActivity(next)).toBe(next);
  });
  it('rejects an unrecognised Activity shape instead of leaving a Linking bypass', () => {
    expect(() => plugin.patchMainActivity('class OtherActivity {}')).toThrow(/onCreate|MainActivity/);
  });
  it('adds the RuStore maven repository idempotently', () => {
    const once = plugin.patchProjectBuildGradle(ALLPROJECTS);
    expect(once).toContain('https://nexus-external.rustore.ru/repository/maven-rustore-exposed');
    expect(once).not.toContain('artifactory-external.vkpartner.ru');
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
