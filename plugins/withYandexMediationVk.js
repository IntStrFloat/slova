const { createRunOncePlugin, withAppBuildGradle } = require('expo/config-plugins');

// VK Ads (ex. myTarget) adapter for Yandex Mobile Mediation. The adapter
// includes the compatible VK Ads SDK when added through Gradle.
const VK_ADS_MEDIATION_DEPENDENCY =
  'implementation("com.yandex.ads.mediation:mobileads-mytarget:5.45.3.4")';

function patchAppBuildGradle(contents) {
  if (contents.includes('com.yandex.ads.mediation:mobileads-mytarget:')) {
    return contents;
  }

  if (!/dependencies\s*\{/.test(contents)) {
    throw new Error('Yandex Mediation VK: app dependencies block was not found');
  }

  return contents.replace(
    /dependencies\s*\{/,
    `dependencies {\n    ${VK_ADS_MEDIATION_DEPENDENCY}`,
  );
}

function withYandexMediationVk(config) {
  return withAppBuildGradle(config, (appConfig) => {
    if (appConfig.modResults.language !== 'groovy') {
      throw new Error('Yandex Mediation VK: only Groovy app/build.gradle is supported');
    }

    appConfig.modResults.contents = patchAppBuildGradle(appConfig.modResults.contents);
    return appConfig;
  });
}

const plugin = createRunOncePlugin(
  withYandexMediationVk,
  'with-yandex-mediation-vk',
  '1.1.0',
);

module.exports = plugin;
module.exports.patchAppBuildGradle = patchAppBuildGradle;
