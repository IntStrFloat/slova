const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withProjectBuildGradle,
} = require('expo/config-plugins');

// Интеграция react-native-rustore-push 6.x (GitFlic), по аналогии с blockblast:
// 1) maven-репозиторий RuStore (ru.rustore.sdk:pushclient);
// 2) meta-data project_id — авто-инициализация SDK;
// 3) разрешение POST_NOTIFICATIONS (Android 13+).
// ВКЛЮЧАЕТСЯ в app.json plugins на этапе M6 (нужен react-native-rustore-push + truststore VK maven).
const RUSTORE_MAVEN_URL = 'https://artifactory-external.vkpartner.ru/artifactory/maven';
const RUSTORE_MAVEN = `maven { url '${RUSTORE_MAVEN_URL}' }`;
const PROJECT_ID_META = 'ru.rustore.sdk.pushclient.project_id';

function patchProjectBuildGradle(contents) {
  if (contents.includes(RUSTORE_MAVEN_URL)) return contents;
  const pattern = /(allprojects\s*\{\s*repositories\s*\{)([\s\S]*?)(\n\s*\})/;
  if (!pattern.test(contents)) {
    throw new Error('RuStore Push: allprojects.repositories block was not found');
  }
  return contents.replace(pattern, `$1$2\n    ${RUSTORE_MAVEN}$3`);
}

function addProjectIdMeta(androidManifest, projectId) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, PROJECT_ID_META, projectId);
  return androidManifest;
}

function withRuStorePush(config, props = {}) {
  const projectId = props.projectId ?? process.env.EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID ?? '';

  config = withProjectBuildGradle(config, (projectConfig) => {
    if (projectConfig.modResults.language !== 'groovy') {
      throw new Error('RuStore Push: only Groovy android/build.gradle is supported');
    }
    projectConfig.modResults.contents = patchProjectBuildGradle(projectConfig.modResults.contents);
    return projectConfig;
  });

  config = withAndroidManifest(config, (manifestConfig) => {
    AndroidConfig.Permissions.ensurePermission(
      manifestConfig.modResults,
      'android.permission.POST_NOTIFICATIONS',
    );
    if (projectId) addProjectIdMeta(manifestConfig.modResults, projectId);
    return manifestConfig;
  });

  return config;
}

const plugin = createRunOncePlugin(withRuStorePush, 'with-rustore-push', '1.0.0');
module.exports = plugin;
module.exports.patchProjectBuildGradle = patchProjectBuildGradle;
module.exports.addProjectIdMeta = addProjectIdMeta;
