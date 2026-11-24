const { AndroidConfig, createRunOncePlugin, withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');

const QA_META = 'slova.local_sdk_qa';
const CLEARTEXT_BEFORE = 'slova.local_sdk_qa.previous_cleartext';
const PUSH_META = 'ru.rustore.sdk.pushclient.project_id';

function patchApplicationId(contents, baseApplicationId, enabled) {
  if (typeof baseApplicationId !== 'string' || !/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+$/i.test(baseApplicationId)) {
    throw new Error('SDK QA: valid base application ID required');
  }
  const pattern = /\bapplicationId\s+(['"])([^'"\r\n]+)\1/g;
  if ((contents.match(pattern) ?? []).length !== 1) throw new Error('SDK QA: one applicationId declaration required');
  const target = enabled ? `${baseApplicationId}.sdkqa` : baseApplicationId;
  return contents.replace(pattern, (_, quote) => `applicationId ${quote}${target}${quote}`);
}

function patchManifest(manifest, enabled) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const previous = app['meta-data']?.find((entry) => entry.$['android:name'] === CLEARTEXT_BEFORE)?.$['android:value'];
  if (enabled) {
    if (previous === undefined) AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, CLEARTEXT_BEFORE,
      app.$['android:usesCleartextTraffic'] ?? 'absent');
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, QA_META, 'true');
    app.$['android:usesCleartextTraffic'] = 'true';
    app['meta-data'] = app['meta-data'].filter((entry) => entry.$['android:name'] !== PUSH_META);
  } else {
    if (previous === 'absent') delete app.$['android:usesCleartextTraffic'];
    else if (previous !== undefined) app.$['android:usesCleartextTraffic'] = previous;
    if (app['meta-data']) app['meta-data'] = app['meta-data'].filter((entry) =>
      ![QA_META, CLEARTEXT_BEFORE].includes(entry.$['android:name']));
  }
  return manifest;
}

function withSdkQa(config, options = {}) {
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('SDK QA: Groovy required');
    mod.modResults.contents = patchApplicationId(mod.modResults.contents, options.baseApplicationId, options.enabled === true);
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    patchManifest(mod.modResults, options.enabled === true);
    return mod;
  });
}

module.exports = createRunOncePlugin(withSdkQa, 'with-slova-sdk-qa', '1.0.0');
module.exports.patchApplicationId = patchApplicationId;
module.exports.patchManifest = patchManifest;
