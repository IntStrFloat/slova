const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withGradleProperties,
  withProjectBuildGradle,
} = require('expo/config-plugins');
const { patchRuStoreRepositories, updateProjectRepositories } = require('./rustoreRepositories');

// Match the already pinned native SDK 8.6.0. All adapters, including Google,
// are provided by Yandex's unified build; network settings belong to Yandex.
const MEDIATION = 'com.yandex.android:mobileads-mediation:8.6.0.0';
// A mediated SDK brings Kotlin 2.3 metadata. Use a matching compiler rather than
// suppressing metadata checks or downgrading a network's runtime library.
const KOTLIN_VERSION = '2.3.0';
const GOOGLE_APP_ID_META = 'com.google.android.gms.ads.APPLICATION_ID';
const REPOSITORIES = [
  ['https://android-sdk.is.com/', ['com[.]ironsource([.].*)?', 'com[.]unity3d[.]ads-mediation']],
  ['https://artifact.bytedance.com/repository/pangle', ['com[.]pangle([.].*)?', 'com[.]bytedance([.].*)?']],
  ['https://sdk.tapjoy.com/', ['com[.]tapjoy']],
  ['https://dl-maven-android.mintegral.com/repository/mbridge_android_sdk_oversea', ['com[.]mbridge([.].*)?']],
  ['https://cboost.jfrog.io/artifactory/chartboost-ads/', ['com[.]chartboost', 'com[.]iab[.]omid[.]library']],
  ['https://dl.appnext.com/', ['com[.]appnext([.].*)?']],
  ['https://developer.huawei.com/repo/', ['com[.]huawei([.].*)?']],
  ['https://artifactory.bidmachine.io/bidmachine', ['io[.]bidmachine([.].*)?', 'com[.]explorestack([.].*)?']],
];
const EXISTING_REPOSITORIES = [
  ['https://www.jitpack.io', ['com[.]github([.].*)?']],
];

function patchAppBuildGradle(contents) {
  // Migrate the previous standalone VK adapter and any generated unified version.
  const cleaned = contents.replace(
    /^[ \t]*implementation\(?["'](?:com\.yandex\.ads\.mediation:mobileads-mytarget|com\.yandex\.android:mobileads-mediation):[^"']+["']\)?[ \t]*\r?\n/gm,
    '',
  );
  if (!/dependencies\s*\{/.test(cleaned)) {
    throw new Error('Yandex Easy Monetization: app dependencies block was not found');
  }
  return cleaned.replace(/dependencies\s*\{/, `dependencies {\n    implementation("${MEDIATION}")`);
}

function patchProjectBuildGradle(contents) {
  contents = contents.replace(
    /classpath\(?['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin(?::[^'"]+)?['"]\)?/,
    `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}")`,
  );
  contents = updateProjectRepositories(contents, (repositories, newline) => {
    // Unified mediation has version ranges. Avoid asking every vendor repository
    // for every unrelated module's metadata (minutes of redundant TLS requests).
    const declaration = ([url, groups]) => `maven { url '${url}'; content { ${groups.map((group) => `includeGroupByRegex '${group}'`).join('; ')} } }`;
    for (const entry of [...REPOSITORIES, ...EXISTING_REPOSITORIES]) {
      const url = entry[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      repositories = repositories.replace(new RegExp(`maven\\s*\\{\\s*url\\s+['"]${url}['"](?:;\\s*content\\s*\\{[^{}\\n]*\\})?\\s*\\}`, 'g'), declaration(entry));
    }
    const missing = REPOSITORIES.filter(([url]) => !repositories.includes(url));
    const closingIndent = repositories.match(/(?:^|\r?\n)([ \t]*)$/)?.[1] ?? '  ';
    return repositories.trimEnd() + missing.map((entry) => `${newline}${closingIndent}  ${declaration(entry)}`).join('')
      + newline + closingIndent;
  });
  return patchRuStoreRepositories(contents, { includeMyTarget: true });
}

function patchGradleProperties(properties) {
  const previous = properties.find((item) => item.type === 'property' && item.key === 'org.gradle.jvmargs')?.value ?? '';
  // D8 needs more than the template's 2 GiB when merging the full mediation SDK.
  const minimum = (value, pattern, megabytes, flag) => pattern.test(value)
    ? value.replace(pattern, (original, count, unit) => Number(count) * (unit.toLowerCase() === 'g' ? 1024 : 1) >= megabytes ? original : flag)
    : `${value} ${flag}`;
  let memory = minimum(previous, /-Xmx(\d+)([gm])/i, 6144, '-Xmx6144m');
  memory = minimum(memory, /-XX:MaxMetaspaceSize=(\d+)([gm])/i, 1024, '-XX:MaxMetaspaceSize=1024m').trim();
  return [
    ...properties.filter((item) => item.type !== 'property' || !['android.kotlinVersion', 'org.gradle.jvmargs'].includes(item.key)),
    { type: 'property', key: 'android.kotlinVersion', value: KOTLIN_VERSION },
    { type: 'property', key: 'org.gradle.jvmargs', value: memory },
  ];
}

function addGoogleAppId(manifest, appId) {
  if (!appId) return manifest;
  if (!/^ca-app-pub-\d{16}~\d{10}$/.test(appId)) {
    throw new Error('Yandex Easy Monetization: invalid Google APPLICATION_ID');
  }
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, GOOGLE_APP_ID_META, appId);
  return manifest;
}

function withYandexEasyMonetization(config, props = {}) {
  const googleAppId = props.googleAppId ?? process.env.YANDEX_ADS_GOOGLE_APP_ID ?? '';
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Yandex Easy Monetization requires Groovy Gradle');
    mod.modResults.contents = patchAppBuildGradle(mod.modResults.contents);
    return mod;
  });
  config = withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Yandex Easy Monetization requires Groovy Gradle');
    mod.modResults.contents = patchProjectBuildGradle(mod.modResults.contents);
    return mod;
  });
  config = withGradleProperties(config, (mod) => {
    mod.modResults = patchGradleProperties(mod.modResults);
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    addGoogleAppId(mod.modResults, googleAppId);
    return mod;
  });
}

module.exports = createRunOncePlugin(withYandexEasyMonetization, 'with-yandex-easy-monetization', '1.0.0');
module.exports.patchAppBuildGradle = patchAppBuildGradle;
module.exports.patchProjectBuildGradle = patchProjectBuildGradle;
module.exports.addGoogleAppId = addGoogleAppId;
module.exports.patchGradleProperties = patchGradleProperties;
