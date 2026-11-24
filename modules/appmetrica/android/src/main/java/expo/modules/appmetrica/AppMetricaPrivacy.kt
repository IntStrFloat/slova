package expo.modules.appmetrica

import android.app.Application
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import io.appmetrica.analytics.AppMetrica
import io.appmetrica.analytics.AppMetricaConfig
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/**
 * One native consent gate for the JS bridge and SDK automatic reporting.
 *
 * An absent preference is deliberately disabled: on upgrade JS must first migrate
 * its existing opt-out preference before the SDK may be activated. A persisted
 * refusal also prevents activation on the next cold start, before React exists.
 */
object AppMetricaPrivacy {
  private const val PREFERENCES = "slova.analytics.native.v1"
  private const val SENDING_ENABLED = "data_sending_enabled"
  private const val PRODUCTION_PACKAGE = "com.intstrfloat.slova"

  @Volatile private var application: Application? = null
  @Volatile private var apiKey: String? = null
  @Volatile private var activated = false
  @Volatile private var sendingEnabled = false
  @Volatile private var qaBuild = false
  @Volatile private var consentWriteFailed = false
  private var lifecycleRegistered = false
  private var foregroundActivity: WeakReference<Activity>? = null
  private var trackedActivity: WeakReference<Activity>? = null
  private val reportedIntents = WeakHashMap<Activity, Intent>()

  fun isTestDevice(context: Context?): Boolean {
    if (context == null) return true
    val debug = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    val preview = context.packageName != PRODUCTION_PACKAGE
    val emulator = Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.startsWith("unknown") ||
      Build.MODEL.contains("google_sdk") || Build.MODEL.contains("Emulator") ||
      Build.MODEL.contains("Android SDK built for") || Build.MANUFACTURER.contains("Genymotion") ||
      Build.HARDWARE in setOf("goldfish", "ranchu", "vbox86") ||
      Build.PRODUCT.startsWith("sdk") || Build.PRODUCT.startsWith("gphone") ||
      (Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic"))
    return qaBuild || debug || preview || emulator
  }

  /** Called before React Native and the ads SDK; does not infer consent from app launch. */
  @Synchronized
  fun bootstrap(context: Application, key: String, testBuild: Boolean = false) {
    application = context
    apiKey = key.takeIf { it.isNotBlank() }
    qaBuild = testBuild
    if (!lifecycleRegistered) {
      context.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) = activityResumed(activity)
        override fun onActivityPaused(activity: Activity) = activityPaused(activity)
        override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = activityPaused(activity)
      })
      lifecycleRegistered = true
    }
    val enabled = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .getBoolean(SENDING_ENABLED, false)
    applyPolicy(enabled)
  }

  /** Null means an older installation has not yet migrated its JS preference. */
  fun getDataSendingPreference(context: Context?): Boolean? {
    val target = application ?: context?.applicationContext ?: return null
    val preferences = target.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    return if (preferences.contains(SENDING_ENABLED)) preferences.getBoolean(SENDING_ENABLED, false) else null
  }

  /** The preference must be durable before SDK policy is changed. */
  @Synchronized
  fun setDataSendingEnabled(context: Context?, enabled: Boolean): Boolean {
    val target = application ?: context?.applicationContext ?: return false
    val persisted = target.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit().putBoolean(SENDING_ENABLED, enabled).commit()
    if (!persisted) {
      consentWriteFailed = true
      sendingEnabled = false
      // A failed write must never leave a newly refused process transmitting.
      runCatching { AppMetrica.setDataSendingEnabled(false) }
      pauseTrackedSession()
      return false
    }
    consentWriteFailed = false
    return applyPolicy(enabled)
  }

  @Synchronized
  private fun applyPolicy(requested: Boolean): Boolean {
    val context = application
    val key = apiKey
    val enabled = requested && !isTestDevice(context) && key != null
    // Fail closed while activating, and on every refusal/test process.
    sendingEnabled = false
    if (!enabled) {
      val applied = runCatching { AppMetrica.setDataSendingEnabled(false) }.isSuccess
      pauseTrackedSession()
      // An intentionally keyless build also disables an already-enabled SDK.
      // It cannot acknowledge a request to enable custom collection.
      return applied && (!requested || key != null)
    }
    return runCatching {
      if (!activated) {
        val config = AppMetricaConfig.newConfigBuilder(requireNotNull(key))
          .withDataSendingEnabled(true)
          .withLocationTracking(false)
          .withCrashTransformer(AppMetricaCrashSafety { canReport(context) })
          .withAnrMonitoring(AppMetricaCrashOptions.read(context).extended)
          .withNativeCrashReporting(AppMetricaCrashOptions.read(context).extended)
          // Own the documented pause/resume calls so opting out stops keepalive
          // and foreground-session collection as well as network transmission.
          .withSessionsAutoTrackingEnabled(false)
          .withAppOpenTrackingEnabled(false)
          .build()
        AppMetrica.activate(context!!, config)
        activated = true
      }
      AppMetrica.setDataSendingEnabled(true)
      sendingEnabled = true
      resumeTrackedSession()
    }.isSuccess
  }

  @Synchronized
  private fun activityResumed(activity: Activity) {
    foregroundActivity = WeakReference(activity)
    resumeTrackedSession()
  }

  @Synchronized
  private fun activityPaused(activity: Activity) {
    if (foregroundActivity?.get() === activity) foregroundActivity = null
    if (trackedActivity?.get() === activity) pauseTrackedSession()
  }

  private fun resumeTrackedSession() {
    val activity = foregroundActivity?.get() ?: return
    if (!canReport(activity) || trackedActivity?.get() === activity) return
    pauseTrackedSession()
    if (runCatching { AppMetrica.resumeSession(activity) }.isSuccess) {
      trackedActivity = WeakReference(activity)
      // Preserve consented deeplink reporting after disabling SDK's unconditional
      // activity observer. Intent contents never enter the JS analytics payload.
      val intent = activity.intent
      if (intent != null && reportedIntents[activity] !== intent &&
        runCatching { AppMetrica.reportAppOpen(activity) }.isSuccess) {
        reportedIntents[activity] = intent
      }
    }
  }

  private fun pauseTrackedSession() {
    val activity = trackedActivity?.get()
    trackedActivity = null
    if (activity != null) runCatching { AppMetrica.pauseSession(activity) }
  }

  fun canReport(context: Context?): Boolean = sendingEnabled && activated && !isTestDevice(context)

  /** Only a boolean capability escapes; QA never reads or uses the SDK key. */
  fun isKeyless(): Boolean = apiKey == null

  /** A failed refusal commit must close local diagnostics too, even if the old disk value is true. */
  fun hasCurrentConsent(context: Context?): Boolean = runCatching {
    !consentWriteFailed && getDataSendingPreference(context) == true
  }.getOrDefault(false)
}
