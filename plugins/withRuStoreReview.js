const { createRunOncePlugin, withProjectBuildGradle } = require('expo/config-plugins');

const RUSTORE_MAVEN_URL = 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed';

function patchProjectBuildGradle(contents) {
  if (contents.includes(RUSTORE_MAVEN_URL)) return contents;
  const pattern = /(allprojects\s*\{\s*repositories\s*\{)([\s\S]*?)(\n\s*\})/;
  if (!pattern.test(contents)) {
    throw new Error('RuStore Review: allprojects.repositories block was not found in android/build.gradle');
  }
  return contents.replace(pattern, `$1$2\n    maven { url '${RUSTORE_MAVEN_URL}' }$3`);
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
