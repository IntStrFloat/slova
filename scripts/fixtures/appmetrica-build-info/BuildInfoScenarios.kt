import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.appmetrica.AppMetricaBuildInfo

private var checks = 0
private fun verify(value: Boolean) { checks += 1; check(value) { "software metadata scenario failed at $checks" } }

fun main() {
  verify(AppMetricaBuildInfo.read(null).isEmpty())
  val manager = PackageManager("com.intstrfloat.slova.sdkqa", PackageInfo("0.1.34", 33, 34L))
  val context = Context("com.intstrfloat.slova.sdkqa", manager)
  verify(AppMetricaBuildInfo.read(context) == mapOf("versionName" to "0.1.34", "versionCode" to "34"))
  verify(manager.calls == 1)
  Build.VERSION.SDK_INT = 27
  verify(AppMetricaBuildInfo.read(context)["versionCode"] == "33")
  Build.VERSION.SDK_INT = 35
  manager.info = PackageInfo("0.1.35", 35, 9007199254740993L)
  verify(AppMetricaBuildInfo.read(context)["versionCode"] == "9007199254740993")
  manager.info = PackageInfo("0.1.35", 35, Long.MAX_VALUE)
  verify(AppMetricaBuildInfo.read(context)["versionCode"] == "9223372036854775807")
  manager.info = PackageInfo("0.1.35", 35, -1L)
  verify(AppMetricaBuildInfo.read(context) == mapOf("versionName" to "0.1.35"))
  manager.info = PackageInfo("private user@example.org", 35, 35L)
  verify(AppMetricaBuildInfo.read(context) == mapOf("versionCode" to "35"))
  manager.info = PackageInfo(null, 35, 35L)
  verify(AppMetricaBuildInfo.read(context) == mapOf("versionCode" to "35"))
  manager.info = PackageInfo("v".repeat(193), 35, 35L)
  verify(AppMetricaBuildInfo.read(context) == mapOf("versionCode" to "35"))
  manager.info = PackageInfo("0.1.0", 0, 0L)
  verify(AppMetricaBuildInfo.read(context) == mapOf("versionName" to "0.1.0", "versionCode" to "0"))
  manager.fail = true
  verify(AppMetricaBuildInfo.read(context).isEmpty())
  manager.fail = false
  verify(AppMetricaBuildInfo.read(Context("wrong.package", manager)).isEmpty())
  println("{\"passed\":true,\"checks\":$checks,\"sdkPresentInClasspath\":false,\"storageApiPresentInFixture\":false}")
}
