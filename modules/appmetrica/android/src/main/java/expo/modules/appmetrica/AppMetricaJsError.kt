package expo.modules.appmetrica

import io.appmetrica.analytics.plugins.PluginErrorDetails
import io.appmetrica.analytics.plugins.StackTraceItem

/** Pure boundary compiled/tested against the real SDK public error builders. */
data class AppMetricaJsError(val kind: String, val fatal: Boolean, val engine: String, val frames: List<Frame>) {
  data class Frame(val line: Int, val column: Int)

  fun details(appVersion: String, buildId: String): PluginErrorDetails = PluginErrorDetails.Builder()
    .withExceptionClass(kind)
    .withMessage("javascript_exception_redacted")
    .withPlatform(PluginErrorDetails.Platform.REACT_NATIVE)
    .withStacktrace(frames.map { StackTraceItem.Builder().withFileName("index.android.bundle")
      .withLine(it.line).withColumn(it.column).build() })
    .withPluginEnvironment(mapOf("diagnostic_schema" to "1", "fatal_context" to fatal.toString(),
      "js_engine" to engine, "app_version" to safeVersion(appVersion), "build_id" to safeVersion(buildId)))
    .build()

  companion object {
    private val KINDS = setOf("Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError")
    private val KEYS = setOf("schemaVersion", "errorKind", "fatal", "engine", "frames")
    private fun integer(value: Any?, minimum: Int): Int? {
      val number = (value as? Number)?.toDouble() ?: return null
      return if (number.isFinite() && number >= minimum && number <= Int.MAX_VALUE && number % 1.0 == 0.0) number.toInt() else null
    }
    fun safeVersion(value: String): String = value.takeIf { Regex("[A-Za-z0-9_.-]{1,40}").matches(it) } ?: "unknown"
    fun parse(input: Map<String, Any?>): AppMetricaJsError? {
      if (input.keys != KEYS || integer(input["schemaVersion"], 1) != 1) return null
      val kind = (input["errorKind"] as? String)?.takeIf { it in KINDS } ?: return null
      val fatal = input["fatal"] as? Boolean ?: return null
      val engine = (input["engine"] as? String)?.takeIf { it == "hermes" || it == "unknown" } ?: return null
      val rawFrames = input["frames"] as? List<*> ?: return null
      if (rawFrames.size > 32) return null
      val frames = rawFrames.map { value ->
        val frame = value as? Map<*, *> ?: return null
        if (frame.keys != setOf("file", "line", "column") || frame["file"] != "index.android.bundle") return null
        Frame(integer(frame["line"], 1) ?: return null, integer(frame["column"], 0) ?: return null)
      }
      return AppMetricaJsError(kind, fatal, engine, frames)
    }
  }
}
