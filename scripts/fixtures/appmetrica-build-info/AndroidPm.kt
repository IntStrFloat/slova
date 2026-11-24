package android.content.pm

class PackageInfo(val versionName: String?, val versionCode: Int, val longVersionCode: Long)

class PackageManager(val expectedPackage: String, var info: PackageInfo) {
  var fail = false
  var calls = 0
  fun getPackageInfo(packageName: String, flags: Int): PackageInfo {
    calls += 1
    check(packageName == expectedPackage && flags == 0)
    check(!fail) { "synthetic package unavailable" }
    return info
  }
}
