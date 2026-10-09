// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../withAndroidResourceFallbacks.js') as {
  addNotificationResourceMetaData(manifest: unknown): unknown;
};

type ManifestApp = {
  $: Record<string, string>;
  'meta-data'?: { $: Record<string, string> }[];
};

const makeManifest = (): { manifest: { application: ManifestApp[] } } => ({
  manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] },
});

describe('withAndroidResourceFallbacks config plugin', () => {
  it('adds stable RuStore notification resources as manifest metadata', () => {
    const manifest = makeManifest();
    plugin.addNotificationResourceMetaData(manifest);

    const entries = manifest.manifest.application[0]['meta-data'] ?? [];
    expect(entries).toEqual(
      expect.arrayContaining([
        {
          $: {
            'android:name': 'ru.rustore.sdk.pushclient.default_notification_icon',
            'android:resource': '@drawable/slova_notification',
          },
        },
        {
          $: {
            'android:name': 'ru.rustore.sdk.pushclient.default_notification_color',
            'android:resource': '@color/colorPrimary',
          },
        },
      ]),
    );
  });

  it('upserts metadata without leaving a conflicting android:value', () => {
    const manifest = makeManifest();
    manifest.manifest.application[0]['meta-data'] = [
      {
        $: {
          'android:name': 'ru.rustore.sdk.pushclient.default_notification_icon',
          'android:value': '@drawable/old_icon',
        },
      },
    ];

    plugin.addNotificationResourceMetaData(manifest);

    const icon = manifest.manifest.application[0]['meta-data']?.find(
      (entry) => entry.$['android:name'] === 'ru.rustore.sdk.pushclient.default_notification_icon',
    );
    expect(icon).toEqual({
      $: {
        'android:name': 'ru.rustore.sdk.pushclient.default_notification_icon',
        'android:resource': '@drawable/slova_notification',
      },
    });
  });
});
