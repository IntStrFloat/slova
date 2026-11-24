// Compiled separately against the actual cached SDK error builders, without activation.
import expo.modules.appmetrica.AppMetricaCrashSafety
import expo.modules.appmetrica.AppMetricaJsError
import com.facebook.react.common.JavascriptException

fun main() {
  var checks = 0
  fun verify(value: Boolean) { checks++; check(value) { "crash_boundary_check_$checks" } }
  val input: Map<String, Any?> = mapOf("schemaVersion" to 1, "errorKind" to "TypeError", "fatal" to true,
    "engine" to "hermes", "frames" to listOf(mapOf("file" to "index.android.bundle", "line" to 1, "column" to 812)))
  val parsed = checkNotNull(AppMetricaJsError.parse(input))
  val details = parsed.details("0.1.29", "33")
  verify(details.platform == "react_native" && details.exceptionClass == "TypeError")
  verify(details.message == "javascript_exception_redacted")
  verify(details.stacktrace.single().column == 812 && details.stacktrace.single().line == 1)
  verify(details.stacktrace.single().methodName == null && details.stacktrace.single().className == null)
  verify(details.pluginEnvironment["fatal_context"] == "true" && details.pluginEnvironment["build_id"] == "33")
  verify(parsed.details("user@example.org", "receipt=secret").pluginEnvironment["app_version"] == "unknown")
  verify(AppMetricaJsError.parse(input + ("message" to "private-token")) == null)
  verify(AppMetricaJsError.parse(input + ("errorKind" to "user@example.org")) == null)
  verify(AppMetricaJsError.parse(input + ("engine" to "private-token")) == null)
  verify(AppMetricaJsError.parse(input + ("frames" to List(33) { (input["frames"] as List<*>).single() })) == null)
  for (bad in listOf(-1, Double.NaN, Double.POSITIVE_INFINITY, 1.5, Long.MAX_VALUE)) {
    verify(AppMetricaJsError.parse(input + ("frames" to listOf(mapOf("file" to "index.android.bundle", "line" to 1, "column" to bad)))) == null)
  }
  val original = RuntimeException("private-token user@example.org", IllegalStateException("subscription receipt"))
  original.addSuppressed(RuntimeException("saved user profile"))
  original.stackTrace = arrayOf(StackTraceElement("com.intstrfloat.slova.App", "invoke", "App.kt", 12),
    StackTraceElement("user@example.org", "receipt=secret", "/private/user-token", 4))
  var allowed = true
  val transformer = AppMetricaCrashSafety { allowed }
  val safe = checkNotNull(transformer.process(original))
  verify(safe !== original && safe.message == AppMetricaCrashSafety.MESSAGE)
  verify(safe.cause == null && safe.suppressed.isEmpty())
  verify(safe.stackTrace.first().className == "com.intstrfloat.slova.App")
  verify(safe.stackTrace.last().className == "redacted" && safe.stackTrace.last().fileName == null)
  verify(!safe.stackTrace.contentToString().contains("secret"))
  // Every unmatched JVM crash is retained. There is no timestamp/JS-type suppression heuristic.
  verify(transformer.process(IllegalArgumentException("different private error")) != null)
  val rnOriginal = JavascriptException("receipt=private-token, stack:\nprivate@1:812\n").apply {
    extraDataAsJson = "{\"subscription\":\"private-token\",\"email\":\"user@example.org\"}"
    initCause(RuntimeException("raw user save"))
  }
  val rnSafe = checkNotNull(transformer.process(rnOriginal))
  verify(rnSafe !is JavascriptException && rnSafe !== rnOriginal)
  verify(rnSafe.message == AppMetricaCrashSafety.MESSAGE && rnSafe.cause == null)
  verify(!rnSafe.toString().contains("private-token"))
  allowed = false
  verify(transformer.process(original) == null)
  verify(AppMetricaCrashSafety { error("gate unavailable") }.process(original) == null)
  println("{\"passed\":true,\"checks\":$checks,\"realSdkErrorBuilders\":true,\"sdkActivated\":false}")
}
