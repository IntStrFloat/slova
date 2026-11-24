const { createRunOncePlugin, withProjectBuildGradle } = require('expo/config-plugins');
const { patchRuStoreRepositories } = require('./rustoreRepositories');

function patchProjectBuildGradle(contents) {
  return patchRuStoreRepositories(contents);
}

function withRuStoreReview(config) {
  return withProjectBuildGradle(config, (projectConfig) => {
    if (projectConfig.modResults.language !== 'groovy') {
      throw new Error('RuStore Review: only Groovy android/build.gradle is supported');
    }
    projectConfig.modResults.contents = patchProjectBuildGradle(projectConfig.modResults.contents);
    return projectConfig;
  });
}

module.exports = createRunOncePlugin(withRuStoreReview, 'with-rustore-review', '1.0.0');
module.exports.patchProjectBuildGradle = patchProjectBuildGradle;
