const { createRunOncePlugin, withAndroidManifest, withProjectBuildGradle } = require('expo/config-plugins');
const { patchRuStoreRepositories } = require('./rustoreRepositories');
const ALLOW_REAL_SDK = 'expo.modules.rustoreupdates.ALLOW_REAL_SDK';

function patchManifest(manifest, { enabled = false, qa = false } = {}) {
  if (typeof enabled !== 'boolean' || typeof qa !== 'boolean') throw new Error('RuStore Updates: boolean enabled/qa required');
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error('RuStore Updates: Android application missing');
  const entries = application['meta-data'] ?? [];
  application['meta-data'] = entries.filter((entry) => entry.$?.['android:name'] !== ALLOW_REAL_SDK);
  application['meta-data'].push({ $: { 'android:name': ALLOW_REAL_SDK, 'android:value': String(enabled && !qa) } });
  return manifest;
}
function withRuStoreUpdates(config, options = {}) {
  const enabled = options.enabled ?? process.env.EXPO_PUBLIC_RUSTORE_UPDATES_ENABLED === '1';
  // Explicit true cannot override the QA process flag or the QA package suffix.
  const qa = options.qa === true || process.env.SLOVA_SDK_QA === '1' || config.android?.package?.endsWith('.sdkqa') === true;
  config = withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('RuStore Updates: Groovy required');
    mod.modResults.contents = patchRuStoreRepositories(mod.modResults.contents); return mod;
  });
  return withAndroidManifest(config, (mod) => { mod.modResults = patchManifest(mod.modResults, { enabled, qa }); return mod; });
}
module.exports = createRunOncePlugin(withRuStoreUpdates, 'with-rustore-updates', '1.0.0');
module.exports.patchManifest = patchManifest;
module.exports.patchProjectBuildGradle = patchRuStoreRepositories;
