package android.content.pm
import android.os.Bundle

class ApplicationInfo(var flags: Int = 0) {
  var metaData: Bundle? = null
  companion object { const val FLAG_DEBUGGABLE = 2 }
}

class PackageManager(private val info: ApplicationInfo) {
  fun getApplicationInfo(packageName: String, flags: Int): ApplicationInfo {
    check(packageName.isNotBlank() && flags == GET_META_DATA)
    return info
  }
  companion object { const val GET_META_DATA = 128 }
}
