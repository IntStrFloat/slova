const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withMainApplication,
} = require('expo/config-plugins');

// Интеграция нативного AppMetrica SDK (спека 16), зеркало blockblast:
// 1) Gradle-зависимость io.appmetrica.analytics:analytics;
// 2) APPMETRICA_API_KEY в BuildConfig (ключ — build-time env, НЕ попадает в JS-бандл);
// 3) Нативный consent/QA bootstrap ДО старта React Native. SDK активируется
//    только после сохранённого согласия; первый JS sync переносит старый opt-out.
// Ключ берётся из process.env.APPMETRICA_API_KEY (.env.local, gitignored).
const APPMETRICA_VERSION = '8.6.0';
const APPMETRICA_DEPENDENCY =
  `implementation("io.appmetrica.analytics:analytics:${APPMETRICA_VERSION}")`;
const API_KEY_FIELD = 'buildConfigField "String", "APPMETRICA_API_KEY"';
const QA_BUILD_FIELD = 'buildConfigField "boolean", "APPMETRICA_QA_BUILD"';

function patchCrashManifest(manifest, options = {}) {
  const qa = options.crashQa === true;
  // withSdkQa changes applicationId only; the Kotlin namespace/MainApplication remain production.
  const effectivePackage = options.sdkQa === true && options.package === 'com.intstrfloat.slova'
    ? 'com.intstrfloat.slova.sdkqa' : options.package;
  if (qa && (effectivePackage !== 'com.intstrfloat.slova.sdkqa' || options.apiKey)) {
    throw new Error('AppMetrica crash QA requires an isolated keyless .sdkqa build');
  }
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const values = {
    'slova.crash.extended_enabled': options.extendedCrashReporting === true ? 'true' : 'false',
    'slova.crash.qa_enabled': qa ? 'true' : 'false',
    'slova.crash.app_version': options.version ?? 'unknown',
    'slova.crash.build_id': String(options.buildId ?? 'unknown'),
  };
  for (const [name, value] of Object.entries(values)) {
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, name, value);
  }
  return manifest;
}

function validateApiKey(apiKey, required = true) {
  if (!apiKey) {
    if (!required) return '';
    throw new Error(
      'AppMetrica: APPMETRICA_API_KEY is missing. Add it to .env.local.',
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      apiKey,
    )
  ) {
    throw new Error('AppMetrica: APPMETRICA_API_KEY must be a UUID.');
  }
  return apiKey;
}

function escapeGradleString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function patchAppBuildGradle(contents, apiKey, qaBuild = false, required = true) {
  const validatedApiKey = validateApiKey(apiKey, required);
  let next = contents;

  if (next.includes('io.appmetrica.analytics:analytics:')) {
    next = next.replace(/(io\.appmetrica\.analytics:analytics:)[0-9.]+/g, `$1${APPMETRICA_VERSION}`);
  } else {
    if (!/dependencies\s*\{/.test(next)) {
      throw new Error('AppMetrica: app dependencies block was not found');
    }
    next = next.replace(
      /dependencies\s*\{/,
      `dependencies {\n    ${APPMETRICA_DEPENDENCY}`,
    );
  }

  const escapedApiKey = escapeGradleString(validatedApiKey);
  const keyLine = `${API_KEY_FIELD}, "\\"${escapedApiKey}\\""`;
  const keyPattern = /buildConfigField\s+"String",\s*"APPMETRICA_API_KEY",\s*"(?:\\.|[^"\\])*"/g;
  const existingKeys = next.match(keyPattern) ?? [];
  if (existingKeys.length > 1) {
    throw new Error('AppMetrica: duplicate API key BuildConfig fields');
  }
  if (/['"]APPMETRICA_API_KEY['"]/.test(next.replace(keyPattern, ''))) {
    throw new Error('AppMetrica: unsupported API key BuildConfig field');
  }
  if (existingKeys.length === 1) {
    next = next.replace(keyPattern, () => keyLine);
  } else {
    const defaultConfigPattern = /(defaultConfig\s*\{)/;
    if (!defaultConfigPattern.test(next)) {
      throw new Error('AppMetrica: android.defaultConfig block was not found');
    }
    next = next.replace(
      defaultConfigPattern,
      `$1\n        ${keyLine}`,
    );
  }

  const qaLine = `${QA_BUILD_FIELD}, "${qaBuild ? 'true' : 'false'}"`;
  if (next.includes(QA_BUILD_FIELD)) {
    next = next.replace(/buildConfigField "boolean", "APPMETRICA_QA_BUILD", "(?:true|false)"/g, qaLine);
  } else {
    next = next.replace(/(defaultConfig\s*\{)/, `$1\n        ${qaLine}`);
  }

  return next;
}

function patchMainApplication(contents) {
  const bootstrap = 'AppMetricaPrivacy.bootstrap(this, BuildConfig.APPMETRICA_API_KEY, BuildConfig.APPMETRICA_QA_BUILD)';
  let next = contents
    .replace(/AppMetricaPrivacy\.bootstrap\(this, BuildConfig\.APPMETRICA_API_KEY\)/g, bootstrap)
    .replace(/^import io\.appmetrica\.analytics\.(?:AppMetrica|AppMetricaConfig)\r?\n/gm, '')
    // Migrate the released pre-consent activation block, preserving unrelated startup code.
    .replace(/^[ \t]*val appMetricaConfig =\s*\r?\n[ \t]*AppMetricaConfig\.newConfigBuilder\(BuildConfig\.APPMETRICA_API_KEY\)\.build\(\)\r?\n[ \t]*AppMetrica\.activate\(this, appMetricaConfig\)\r?\n/gm, '');

  if (!next.includes('import expo.modules.appmetrica.AppMetricaPrivacy')) {
    const packageLine = /^(package\s+[^\r\n]+[\r\n]+)/;
    if (!packageLine.test(next)) {
      throw new Error('AppMetrica: MainApplication package declaration was not found');
    }
    next = next.replace(packageLine, `$1\nimport expo.modules.appmetrica.AppMetricaPrivacy\n`);
  }

  if (!next.includes(bootstrap)) {
    const superOnCreate = /(\s+super\.onCreate\(\)\r?\n)/;
    if (!superOnCreate.test(next)) {
      throw new Error('AppMetrica: MainApplication.onCreate was not found');
    }
    next = next.replace(superOnCreate, `$1    ${bootstrap}\n`);
  }
  if (/AppMetrica\.activate\(/.test(next)) {
    throw new Error('AppMetrica: an unsupported direct activation remains; route it through the native privacy gate');
  }
  return next;
}

const withAppMetrica = (config, options = {}) => {
  // Release remains required by default. Private/test builds may opt out explicitly.
  const required = options.required ?? process.env.APPMETRICA_REQUIRED !== '0';
  const apiKey = validateApiKey(
    options.apiKey ?? process.env.APPMETRICA_API_KEY,
    required,
  );

  config = withAndroidManifest(config, (mod) => {
    patchCrashManifest(mod.modResults, { ...options, package: config.android?.package, sdkQa: config.extra?.sdkQa === true,
      apiKey, version: config.version, buildId: config.android?.versionCode });
    return mod;
  });

  config = withAppBuildGradle(config, (appConfig) => {
    if (appConfig.modResults.language !== 'groovy') {
      throw new Error('AppMetrica currently supports only Groovy build.gradle files');
    }
    appConfig.modResults.contents = patchAppBuildGradle(
      appConfig.modResults.contents,
      apiKey,
      options.qaBuild ?? (process.env.EXPO_PUBLIC_YANDEX_TEST_ADS === '1' || process.env.APPMETRICA_TEST_MODE === '1'),
      required,
    );
    return appConfig;
  });

  config = withMainApplication(config, (mainApplicationConfig) => {
    if (mainApplicationConfig.modResults.language !== 'kt') {
      throw new Error('AppMetrica currently supports only Kotlin MainApplication');
    }
    mainApplicationConfig.modResults.contents = patchMainApplication(
      mainApplicationConfig.modResults.contents,
    );
    return mainApplicationConfig;
  });

  return config;
};

const plugin = createRunOncePlugin(withAppMetrica, 'with-appmetrica', '2.0.0');

module.exports = plugin;
module.exports.patchAppBuildGradle = patchAppBuildGradle;
module.exports.patchMainApplication = patchMainApplication;
module.exports.validateApiKey = validateApiKey;
module.exports.patchCrashManifest = patchCrashManifest;
