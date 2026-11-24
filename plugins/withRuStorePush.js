const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withMainActivity,
  withProjectBuildGradle,
} = require('expo/config-plugins');
const { patchRuStoreRepositories } = require('./rustoreRepositories');

// GitFlic RN wrapper6.9.1 uses the audited native Push7.4.0 through patch-package.
// 1) maven-репозиторий RuStore (ru.rustore.sdk:pushclient);
// 2) meta-data project_id — авто-инициализация SDK;
// 3) разрешение POST_NOTIFICATIONS (Android 13+).
// Messaging-сервис объявляет сам SDK в своём AndroidManifest.xml; вручную его
// добавлять не нужно.
const PROJECT_ID_META = 'ru.rustore.sdk.pushclient.project_id';

function patchProjectBuildGradle(contents) {
  // Push's existing Tracer transitives use their dedicated vendor repository.
  return patchRuStoreRepositories(contents, { includePushTracer: true });
}

function addProjectIdMeta(androidManifest, projectId) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, PROJECT_ID_META, projectId);
  return androidManifest;
}

function patchMainActivity(contents) {
  if (!/class MainActivity\b/.test(contents) || !/override fun onCreate\([^)]*\)\s*\{/.test(contents)) {
    throw new Error('RuStore Push: MainActivity.onCreate shape is not supported');
  }
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const marker = '// slova notification intent guard';
  if (contents.includes(marker) && ['setIntent(intent)', 'pendingOpenedId', 'pendingOpenedReminder'].every((value) => contents.includes(value))) return contents;
  let next = contents;
  if (next.includes(marker)) {
    const start = next.lastIndexOf('\n', next.indexOf(marker)) + 1;
    const opening = next.indexOf('{', next.indexOf(marker));
    let depth = 1, end = opening + 1;
    for (; end < next.length && depth; end++) { if (next[end] === '{') depth++; if (next[end] === '}') depth--; }
    if (opening < 0 || depth) throw new Error('RuStore Push: notification intent guard is malformed');
    next = next.slice(0, start) + next.slice(end);
  }
  next = next.replace(/(override fun onCreate\([^)]*\)\s*\{)(\s*)/, (body, opening, whitespace) =>
    next.slice(next.indexOf(body) + body.length).startsWith('sanitizeSlovaNotificationIntent(intent)')
      ? body : `${opening}${newline}    sanitizeSlovaNotificationIntent(intent)${whitespace}`);
  const handler = /override fun onNewIntent\(\s*(\w+)\s*:\s*(?:android\.content\.)?Intent\??\s*\)\s*\{/;
  let warmHandler = '';
  if (handler.test(next)) next = next.replace(handler, (declaration, parameter, offset) =>
    next.slice(offset + declaration.length).trimStart().startsWith(`sanitizeSlovaNotificationIntent(${parameter})`)
      ? declaration : `${declaration}${newline}    sanitizeSlovaNotificationIntent(${parameter})`);
  else {
    if (/override fun onNewIntent/.test(next)) throw new Error('RuStore Push: unsupported MainActivity.onNewIntent');
    warmHandler = `  override fun onNewIntent(intent: android.content.Intent) {${newline}    sanitizeSlovaNotificationIntent(intent)${newline}    super.onNewIntent(intent)${newline}  }${newline}${newline}`;
  }
  const close = next.lastIndexOf('}');
  if (close < 0) throw new Error('RuStore Push: MainActivity closing brace missing');
  const helper = `${newline}${warmHandler}  ${marker}${newline}  private fun sanitizeSlovaNotificationIntent(intent: android.content.Intent?) {${newline}`
    + `    if (intent != null && (intent.hasExtra("vkpns.analytics_payload.message_id") || intent.hasExtra("slovaReminderId"))) {${newline}`
    + `      intent.data = null${newline}      intent.action = android.content.Intent.ACTION_MAIN${newline}`
    + `      if (!intent.hasExtra("slovaNotificationOpenedAtMs")) intent.putExtra("slovaNotificationOpenedAtMs", System.currentTimeMillis())${newline}`
    + `      setIntent(intent)${newline}      try {${newline}`
    + `        intent.getStringExtra("vkpns.analytics_payload.message_id")?.takeIf { it.length <= 192 }?.let {${newline}`
    + `          getSharedPreferences("slova.push.delivery.v1", android.content.Context.MODE_PRIVATE).edit().putString("pendingOpenedId", it)${newline}`
    + `            .putLong("pendingOpenedAt", intent.getLongExtra("slovaNotificationOpenedAtMs", System.currentTimeMillis())).commit()${newline}        }${newline}`
    + `        intent.getStringExtra("slovaReminderId")?.takeIf { it.length <= 192 }?.let {${newline}`
    + `          getSharedPreferences("slova.daily.reminders.v1", android.content.Context.MODE_PRIVATE).edit().putString("pendingOpenedReminder", it)${newline}`
    + `            .putLong("pendingOpenedReminderAt", intent.getLongExtra("slovaNotificationOpenedAtMs", System.currentTimeMillis())).commit()${newline}        }${newline}`
    + `      } catch (_: Exception) { /* The current Activity intent still carries the bounded open. */ }${newline}    }${newline}  }${newline}`;
  return next.slice(0, close) + helper + next.slice(close);
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

  config = withMainActivity(config, (activityConfig) => {
    if (activityConfig.modResults.language !== 'kt') throw new Error('RuStore Push: MainActivity must be Kotlin');
    activityConfig.modResults.contents = patchMainActivity(activityConfig.modResults.contents);
    return activityConfig;
  });

  return config;
}

const plugin = createRunOncePlugin(withRuStorePush, 'with-rustore-push', '2.0.0');
module.exports = plugin;
module.exports.patchProjectBuildGradle = patchProjectBuildGradle;
module.exports.addProjectIdMeta = addProjectIdMeta;
module.exports.patchMainActivity = patchMainActivity;
