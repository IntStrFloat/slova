const { createRunOncePlugin, withAppBuildGradle, withMainApplication, withProjectBuildGradle } = require('expo/config-plugins');
const { patchRuStoreRepositories } = require('./rustoreRepositories');

function validateAppId(value) {
  if (typeof value !== 'string' || value && !/^[a-z0-9][a-z0-9_.:-]{0,127}$/i.test(value)) {
    throw new Error('RuStore Remote Config: invalid app ID');
  }
  return value;
}
function patchAppBuildGradle(contents, appId = '', enabled = false) {
  if (typeof enabled !== 'boolean') throw new Error('RuStore Remote Config: enabled must be boolean');
  const fields = {
    RUSTORE_REMOTE_CONFIG_APP_ID: `buildConfigField "String", "RUSTORE_REMOTE_CONFIG_APP_ID", "\\"${validateAppId(appId)}\\""`,
    RUSTORE_REMOTE_CONFIG_ENABLED: `buildConfigField "boolean", "RUSTORE_REMOTE_CONFIG_ENABLED", "${enabled && !!appId}"`,
  };
  let next = contents;
  for (const [name, declaration] of Object.entries(fields)) {
    const pattern = new RegExp(`buildConfigField\\s+"(?:String|boolean)",\\s*"${name}",\\s*"(?:\\\\.|[^"\\\\])*"`, 'g');
    const previous = next.match(pattern) ?? [];
    if (previous.length > 1) throw new Error('RuStore Remote Config: duplicate BuildConfig field');
    if (new RegExp(`['"]${name}['"]`).test(next.replace(pattern, ''))) throw new Error('RuStore Remote Config: unsupported BuildConfig field');
    if (previous.length) next = next.replace(pattern, () => declaration);
    else {
      if (!/defaultConfig\s*\{/.test(next)) throw new Error('RuStore Remote Config: defaultConfig block missing');
      next = next.replace(/defaultConfig\s*\{/, (opening) => `${opening}\n        ${declaration}`);
    }
  }
  return next;
}
function patchMainApplication(contents) {
  const importLine = 'import expo.modules.rustoreremoteconfig.RemoteConfigRuntime';
  const bootstrap = 'RemoteConfigRuntime.bootstrap(this, BuildConfig.RUSTORE_REMOTE_CONFIG_APP_ID, BuildConfig.RUSTORE_REMOTE_CONFIG_ENABLED, AppMetricaPrivacy.canReport(this))';
  let next = contents;
  if (!next.includes('import expo.modules.appmetrica.AppMetricaPrivacy')) {
    throw new Error('RuStore Remote Config: AppMetrica consent bootstrap must run first');
  }
  if (!next.includes(importLine)) next = next.replace(/^(package\s+[^\r\n]+[\r\n]+)/m, `$1\n${importLine}\n`);
  if (!next.includes(importLine)) throw new Error('RuStore Remote Config: MainApplication package missing');
  if (!next.includes(bootstrap)) {
    if (!/super\.onCreate\(\)\r?\n/.test(next)) throw new Error('RuStore Remote Config: Application.onCreate missing');
    next = next.replace(/(AppMetricaPrivacy\.bootstrap\([^\r\n]+\)\r?\n)/, `$1    ${bootstrap}\n`);
    if (!next.includes(bootstrap)) throw new Error('RuStore Remote Config: consent bootstrap missing');
  }
  return next;
}
function withRuStoreRemoteConfig(config, options = {}) {
  const appId = validateAppId(options.appId ?? process.env.RUSTORE_REMOTE_CONFIG_APP_ID ?? '');
  const enabled = options.enabled ?? process.env.EXPO_PUBLIC_RUSTORE_REMOTE_CONFIG_ENABLED === '1';
  config = withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('RuStore Remote Config: Groovy required');
    mod.modResults.contents = patchRuStoreRepositories(mod.modResults.contents); return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('RuStore Remote Config: Groovy required');
    mod.modResults.contents = patchAppBuildGradle(mod.modResults.contents, appId, enabled); return mod;
  });
  return withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt') throw new Error('RuStore Remote Config: Kotlin required');
    mod.modResults.contents = patchMainApplication(mod.modResults.contents); return mod;
  });
}
module.exports = createRunOncePlugin(withRuStoreRemoteConfig, 'with-rustore-remote-config', '1.0.0');
module.exports.patchAppBuildGradle = patchAppBuildGradle;
module.exports.patchMainApplication = patchMainApplication;
module.exports.validateAppId = validateAppId;
