const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const SPLASH_IMAGE = 'assets/images/splash-icon.png';
const SPLASH_RESOURCE = 'splashscreen_logo.png';
const NOTIFICATION_ICON_RESOURCE = 'slova_notification.xml';
const NOTIFICATION_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M12,22a2.5,2.5 0,0 0,2.45 -2h-4.9A2.5,2.5 0,0 0,12 22zM18,16v-5c0,-3.07 -1.63,-5.64 -4.5,-6.32V4a1.5,1.5 0,0 0,-3 0v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1z" />
</vector>
`;

const DEFAULT_NOTIFICATION_ICON = 'ru.rustore.sdk.pushclient.default_notification_icon';
const DEFAULT_NOTIFICATION_COLOR = 'ru.rustore.sdk.pushclient.default_notification_color';

function upsertResourceMetaData(application, name, resource) {
  const entries = application['meta-data'] ?? [];
  const existing = entries.find((entry) => entry.$?.['android:name'] === name);
  const attributes = {
    'android:name': name,
    'android:resource': resource,
  };

  if (existing) {
    existing.$ = { ...existing.$, ...attributes };
    delete existing.$['android:value'];
  } else {
    entries.push({ $: attributes });
  }

  application['meta-data'] = entries;
  return application;
}

function addNotificationResourceMetaData(manifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  upsertResourceMetaData(application, DEFAULT_NOTIFICATION_ICON, '@drawable/slova_notification');
  upsertResourceMetaData(application, DEFAULT_NOTIFICATION_COLOR, '@color/colorPrimary');
  return manifest;
}

function withAndroidResourceFallbacks(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = addNotificationResourceMetaData(manifestConfig.modResults);
    return manifestConfig;
  });

  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const androidMainPath = path.join(projectRoot, 'android', 'app', 'src', 'main');
      const drawablePath = path.join(androidMainPath, 'res', 'drawable');
      const splashSource = path.join(projectRoot, SPLASH_IMAGE);

      if (!fs.existsSync(splashSource)) {
        throw new Error(`Android resource fallback: splash asset not found: ${SPLASH_IMAGE}`);
      }

      await fs.promises.mkdir(drawablePath, { recursive: true });
      await fs.promises.copyFile(splashSource, path.join(drawablePath, SPLASH_RESOURCE));
      await fs.promises.writeFile(
        path.join(drawablePath, NOTIFICATION_ICON_RESOURCE),
        NOTIFICATION_ICON_XML,
        'utf8',
      );

      return modConfig;
    },
  ]);
}

const plugin = createRunOncePlugin(
  withAndroidResourceFallbacks,
  'with-android-resource-fallbacks',
  '1.0.0',
);

module.exports = plugin;
module.exports.addNotificationResourceMetaData = addNotificationResourceMetaData;
module.exports.upsertResourceMetaData = upsertResourceMetaData;
