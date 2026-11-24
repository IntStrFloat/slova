@file:Suppress("UNUSED_PARAMETER")

package io.appmetrica.analytics

import android.app.Activity
import android.content.Context

fun interface ICrashTransformer { fun process(crash: Throwable): Throwable? }

class AppMetricaConfig private constructor(
  val dataSending: Boolean,
  val locationTracking: Boolean,
  val sessionsAutoTracking: Boolean,
  val appOpenTracking: Boolean,
  val anr: Boolean,
  val nativeCrash: Boolean,
  val transformer: ICrashTransformer?,
) {
  class Builder(private val key: String) {
    private var sending = false
    private var location = true
    private var sessions = true
    private var appOpen = true
    private var anr = false
    private var nativeCrash = false
    private var transformer: ICrashTransformer? = null
    fun withDataSendingEnabled(value: Boolean) = apply { sending = value }
    fun withLocationTracking(value: Boolean) = apply { location = value }
    fun withSessionsAutoTrackingEnabled(value: Boolean) = apply { sessions = value }
    fun withAppOpenTrackingEnabled(value: Boolean) = apply { appOpen = value }
    fun withAnrMonitoring(value: Boolean) = apply { anr = value }
    fun withNativeCrashReporting(value: Boolean) = apply { nativeCrash = value }
    fun withCrashTransformer(value: ICrashTransformer) = apply { transformer = value }
    fun build(): AppMetricaConfig {
      check(key.isNotBlank()) { "Fixture SDK rejects an empty activation key" }
      return AppMetricaConfig(sending, location, sessions, appOpen, anr, nativeCrash, transformer)
    }
  }
  companion object { fun newConfigBuilder(key: String) = Builder(key) }
}

/** Observes SDK calls only. The production privacy policy is compiled separately, unchanged. */
object AppMetrica {
  var sendingEnabled = true
  var activationCount = 0
  var resumeCount = 0
  var pauseCount = 0
  var appOpenCount = 0
  var disableThrows = false
  var lastConfig: AppMetricaConfig? = null
  val sendingCalls = mutableListOf<Boolean>()

  fun setDataSendingEnabled(value: Boolean) {
    sendingCalls.add(value)
    if (!value && disableThrows) throw IllegalStateException("Fixture SDK disable failure")
    sendingEnabled = value
  }
  fun activate(context: Context, config: AppMetricaConfig) {
    activationCount += 1
    lastConfig = config
  }
  fun resumeSession(activity: Activity) { resumeCount += 1 }
  fun pauseSession(activity: Activity) { pauseCount += 1 }
  fun reportAppOpen(activity: Activity) { appOpenCount += 1 }
}
