package expo.modules.appmetrica

import io.appmetrica.analytics.ICrashTransformer

/** Sanitizes the automatic JVM Throwable model, preserving the default crash report. */
class AppMetricaCrashSafety(private val allowed: () -> Boolean) : ICrashTransformer {
  override fun process(crash: Throwable): Throwable? {
    if (!runCatching { allowed() }.getOrDefault(false)) return null
    return runCatching {
      val result = when (crash) {
        is NullPointerException -> NullPointerException(MESSAGE)
        is IllegalArgumentException -> IllegalArgumentException(MESSAGE)
        is IllegalStateException -> IllegalStateException(MESSAGE)
        is IndexOutOfBoundsException -> IndexOutOfBoundsException(MESSAGE)
        else -> RuntimeException(MESSAGE)
      }
      result.stackTrace = crash.stackTrace.take(64).map { frame ->
        val codeClass = frame.className.takeIf { CLASS.matches(it) && PREFIXES.any(it::startsWith) }
        if (codeClass == null) StackTraceElement("redacted", "redacted", null, -1)
        else StackTraceElement(codeClass,
          frame.methodName.takeIf { METHOD.matches(it) } ?: "redacted",
          frame.fileName?.takeIf { FILE.matches(it) }, frame.lineNumber.coerceIn(-1, Int.MAX_VALUE))
      }.toTypedArray()
      // Never attach original cause/suppressed values, including RN extraData/message/stack strings.
      result
    }.getOrElse { RuntimeException(MESSAGE).apply { stackTrace = emptyArray() } }
  }

  companion object {
    const val MESSAGE = "native_exception_redacted"
    private val CLASS = Regex("[A-Za-z_$][A-Za-z0-9_$.]{0,191}")
    private val METHOD = Regex("[A-Za-z_$<>][A-Za-z0-9_$<>-]{0,95}")
    private val FILE = Regex("[A-Za-z0-9_$.-]{1,92}\\.(?:kt|java|js)")
    private val PREFIXES = listOf("java.", "javax.", "android.", "androidx.", "kotlin.", "kotlinx.",
      "expo.modules.", "com.facebook.", "com.intstrfloat.slova.", "io.appmetrica.")
  }
}
