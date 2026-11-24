package expo.modules.appmetrica

import android.content.Context
import android.content.pm.PackageManager

/** Build-time manifest settings; failures keep every new path disabled. */
data class AppMetricaCrashOptions(val extended: Boolean = false, val qa: Boolean = false,
  val appVersion: String = "unknown", val buildId: String = "unknown") {
  companion object {
    fun read(context: Context?): AppMetricaCrashOptions = runCatching {
      if (context == null) return AppMetricaCrashOptions()
      val metadata = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
      AppMetricaCrashOptions(metadata?.getBoolean("slova.crash.extended_enabled", false) == true,
        metadata?.getBoolean("slova.crash.qa_enabled", false) == true,
        safeVersion(metadata?.get("slova.crash.app_version")?.toString() ?: "unknown"),
        safeVersion(metadata?.get("slova.crash.build_id")?.toString() ?: "unknown"))
    }.getOrDefault(AppMetricaCrashOptions())
    private fun safeVersion(value: String): String = value.takeIf { Regex("[A-Za-z0-9_.-]{1,40}").matches(it) } ?: "unknown"
  }
}
