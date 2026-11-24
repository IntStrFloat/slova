package expo.modules.appmetrica

import android.content.Context
import android.os.Build

/** Installed software metadata only: no SDK activation, identifiers, consent or storage access. */
object AppMetricaBuildInfo {
  @Suppress("DEPRECATION")
  fun read(context: Context?): Map<String, String> {
    if (context == null) return emptyMap()
    return runCatching {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
      val name = info.versionName?.takeIf { Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}").matches(it) }
      buildMap {
        if (name != null) put("versionName", name)
        if (code >= 0) put("versionCode", code.toString())
      }
    }.getOrDefault(emptyMap())
  }
}
