package android.content.pm
class Metadata { var allowed = false; fun getBoolean(key: String, fallback: Boolean) = allowed }
class ApplicationInfo { val metaData: Metadata? = Metadata() }
class PackageInfo { var longVersionCode = 34L; var versionCode = 34 }
class PackageManager {
  companion object { const val GET_META_DATA = 128 }
  val application = ApplicationInfo()
  val info = PackageInfo()
  fun getApplicationInfo(name: String, flags: Int) = application
  fun getPackageInfo(name: String, flags: Int) = info
}
