import android.app.Activity
import android.app.Application
import android.content.Intent
import android.content.MemoryPreferences
import android.content.pm.ApplicationInfo
import android.os.Build
import expo.modules.appmetrica.AppMetricaPrivacy
import io.appmetrica.analytics.AppMetrica

private const val KEY = "00000000-0000-4000-8000-000000000001"
private var checks = 0

private fun verify(condition: Boolean, description: String) {
  checks += 1
  check(condition) { description }
}

private fun app(
  consent: Boolean? = true,
  packageName: String = "com.intstrfloat.slova",
  debug: Boolean = false,
): Application {
  val preferences = MemoryPreferences()
  if (consent != null) preferences.seedConsent(consent)
  return Application(preferences, packageName, ApplicationInfo(if (debug) ApplicationInfo.FLAG_DEBUGGABLE else 0))
}

private fun assertExcluded(application: Application, key: String = KEY, qa: Boolean = false) {
  AppMetrica.sendingEnabled = true
  AppMetricaPrivacy.bootstrap(application, key, qa)
  verify(!AppMetrica.sendingEnabled, "excluded process must explicitly disable a previously enabled SDK")
  verify(AppMetrica.sendingCalls.contains(false), "excluded process must call SDK false")
  verify(AppMetrica.activationCount == 0, "excluded process must not activate the SDK")
  verify(!AppMetricaPrivacy.canReport(application), "excluded process must refuse custom reporting")
  verify(AppMetricaPrivacy.getDataSendingPreference(application) == true, "exclusion must preserve saved consent")
}

private fun runScenario(name: String) {
  when (name) {
    "cold_keyless_existing_sender" -> {
      val application = app()
      assertExcluded(application, "")
      verify(!AppMetricaPrivacy.setDataSendingEnabled(application, true), "keyless enable must return false")
      verify(!AppMetrica.sendingEnabled, "keyless enable must leave the SDK disabled")
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == true, "missing key must not become a user refusal")
    }
    "warm_keyless_tracked_session" -> {
      val application = app()
      val activity = Activity(application)
      AppMetricaPrivacy.bootstrap(application, KEY)
      application.resume(activity)
      verify(AppMetrica.sendingEnabled, "control must start with an enabled sender")
      verify(AppMetricaPrivacy.canReport(activity), "control must allow reporting")
      verify(AppMetrica.resumeCount == 1, "control must have a tracked session")
      val activations = AppMetrica.activationCount
      val pauses = AppMetrica.pauseCount
      AppMetricaPrivacy.bootstrap(application, " \t ")
      verify(!AppMetrica.sendingEnabled, "blank-key transition must disable an existing SDK")
      verify(AppMetrica.pauseCount == pauses + 1, "blank-key transition must pause the tracked session")
      verify(AppMetrica.activationCount == activations, "blank-key transition must not activate again")
      verify(!AppMetricaPrivacy.canReport(activity), "blank-key transition must refuse custom events")
      verify(!AppMetricaPrivacy.setDataSendingEnabled(application, true), "blank-key request to enable must fail")
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == true, "blank-key transition must retain consent")
      verify(application.registeredCallbackCount == 1, "repeat bootstrap must not duplicate lifecycle listeners")
    }
    "missing_consent_then_opt_in" -> {
      val application = app(null)
      AppMetricaPrivacy.bootstrap(application, KEY)
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == null, "cold legacy preference must stay absent")
      verify(!AppMetrica.sendingEnabled, "missing consent must explicitly disable SDK sending")
      verify(AppMetrica.activationCount == 0, "missing consent must not activate")
      verify(AppMetricaPrivacy.setDataSendingEnabled(application, true), "durable explicit opt-in must succeed")
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == true, "opt-in must persist")
      verify(AppMetrica.sendingEnabled && AppMetricaPrivacy.canReport(application), "valid explicit opt-in must enable")
      verify(AppMetrica.activationCount == 1, "explicit opt-in must activate once")
    }
    "valid_opt_in_idempotent" -> {
      val application = app()
      val activity = Activity(application).also { it.intent = Intent() }
      AppMetricaPrivacy.bootstrap(application, KEY)
      AppMetricaPrivacy.bootstrap(application, KEY)
      application.resume(activity)
      application.resume(activity)
      verify(AppMetrica.activationCount == 1, "bootstrap must not activate twice")
      verify(application.registeredCallbackCount == 1, "bootstrap must not add duplicate callbacks")
      verify(AppMetrica.resumeCount == 1, "repeat resume must not duplicate the tracked session")
      verify(AppMetrica.appOpenCount == 1, "same intent must not be reported twice")
      verify(AppMetricaPrivacy.canReport(activity), "valid opted-in physical process must report")
      val config = checkNotNull(AppMetrica.lastConfig)
      verify(config.dataSending && !config.locationTracking, "config must enable sending without location")
      verify(!config.sessionsAutoTracking && !config.appOpenTracking, "policy must own session and app-open lifecycle")
      application.pause(activity)
      verify(AppMetrica.pauseCount == 1, "activity pause must pause the tracked session")
    }
    "persisted_refusal" -> {
      val application = app(false)
      AppMetricaPrivacy.bootstrap(application, KEY)
      verify(!AppMetrica.sendingEnabled, "persisted refusal must apply SDK false")
      verify(AppMetrica.activationCount == 0, "persisted refusal must prevent activation")
      verify(!AppMetricaPrivacy.canReport(application), "persisted refusal must reject reporting")
      verify(AppMetricaPrivacy.setDataSendingEnabled(application, false), "repeated explicit refusal must be acknowledged")
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == false, "refusal must remain durable")
    }
    "qa_build" -> assertExcluded(app(), qa = true)
    "debug_build" -> assertExcluded(app(debug = true))
    "preview_package" -> assertExcluded(app(packageName = "com.intstrfloat.slova.fixture"))
    "emulator" -> {
      Build.MODEL = "Android SDK built for x86_64"
      Build.HARDWARE = "ranchu"
      assertExcluded(app())
    }
    "keyless_explicit_refusal" -> {
      val application = app()
      AppMetricaPrivacy.bootstrap(application, "")
      verify(AppMetricaPrivacy.setDataSendingEnabled(application, false), "keyless explicit disable must succeed")
      verify(!AppMetrica.sendingEnabled && AppMetrica.activationCount == 0, "keyless refusal must not activate")
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == false, "explicit keyless refusal must persist")
    }
    "failed_preference_write" -> {
      val application = app()
      val activity = Activity(application)
      AppMetricaPrivacy.bootstrap(application, KEY)
      application.resume(activity)
      application.preferences.commitAllowed = false
      verify(!AppMetricaPrivacy.setDataSendingEnabled(application, false), "failed preference write must not return success")
      verify(!AppMetrica.sendingEnabled, "failed refusal write must still request native disable")
      verify(AppMetrica.pauseCount == 1, "failed refusal write must pause the existing session")
      verify(!AppMetricaPrivacy.canReport(activity), "failed refusal write must close custom reporting")
      verify(!AppMetricaPrivacy.hasCurrentConsent(application), "failed refusal write must close local diagnostics despite old disk consent")
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == true, "fake failed commit must leave prior preference intact")
    }
    "failed_sdk_disable" -> {
      val application = app()
      val activity = Activity(application)
      AppMetricaPrivacy.bootstrap(application, KEY)
      application.resume(activity)
      AppMetrica.disableThrows = true
      verify(!AppMetricaPrivacy.setDataSendingEnabled(application, false), "SDK disable exception must return false")
      verify(AppMetrica.sendingCalls.last() == false, "SDK disable must still be attempted")
      verify(AppMetrica.pauseCount == 1, "SDK disable exception must not skip session pause")
      verify(!AppMetricaPrivacy.canReport(activity), "SDK disable exception must close wrapper reporting")
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == false, "durable refusal must remain saved")
      // The fake deliberately stays globally enabled after throwing: no network cancellation is claimed.
    }
    "crash_defaults_and_refusal" -> {
      val application = app()
      AppMetricaPrivacy.bootstrap(application, KEY)
      val config = checkNotNull(AppMetrica.lastConfig)
      verify(!config.anr && !config.nativeCrash, "new capture flags must default off")
      val transformer = checkNotNull(config.transformer)
      val original = IllegalStateException("private-token user@example.org").apply {
        initCause(RuntimeException("subscription payload"))
        addSuppressed(RuntimeException("receipt"))
      }
      val safe = checkNotNull(transformer.process(original))
      verify(safe !== original && safe.message == "native_exception_redacted", "default JVM crash must be rebuilt, not dropped")
      verify(safe.cause == null && safe.suppressed.isEmpty(), "raw nested payload must not survive")
      AppMetricaPrivacy.setDataSendingEnabled(application, false)
      verify(transformer.process(original) == null, "warm refusal must suppress automatic Throwable handoff")
    }
    "qa_local_consent_failure" -> {
      val application = app(packageName = "com.intstrfloat.slova.sdkqa")
      AppMetricaPrivacy.bootstrap(application, "", true)
      verify(!AppMetricaPrivacy.canReport(application), "keyless QA must not enable SDK reporting")
      verify(AppMetricaPrivacy.hasCurrentConsent(application), "explicit persisted consent can permit isolated local diagnostics")
      application.preferences.commitAllowed = false
      AppMetricaPrivacy.setDataSendingEnabled(application, false)
      verify(AppMetricaPrivacy.getDataSendingPreference(application) == true, "fixture must retain the old value after failed commit")
      verify(!AppMetricaPrivacy.hasCurrentConsent(application), "failed refusal cannot reuse that old local consent")
      application.preferences.commitAllowed = true
      AppMetricaPrivacy.setDataSendingEnabled(application, true)
      verify(AppMetricaPrivacy.hasCurrentConsent(application), "only a new successful explicit consent write may reopen local diagnostics")
      verify(AppMetrica.activationCount == 0, "local diagnostic consent must never activate SDK on QA")
    }
    "extended_crash_flags" -> {
      val application = app()
      application.applicationInfo.metaData = android.os.Bundle().apply {
        putBoolean("slova.crash.extended_enabled", true)
      }
      AppMetricaPrivacy.bootstrap(application, KEY)
      verify(AppMetrica.lastConfig?.anr == true && AppMetrica.lastConfig?.nativeCrash == true,
        "explicit extended manifest flag must configure actual SDK ANR and native capture")
    }
    "missing_context" -> {
      verify(AppMetricaPrivacy.getDataSendingPreference(null) == null, "missing context must not invent a preference")
      verify(!AppMetricaPrivacy.setDataSendingEnabled(null, true), "missing context must reject enable")
      verify(!AppMetricaPrivacy.canReport(null), "missing context must reject reporting")
      verify(AppMetrica.activationCount == 0, "missing context must not activate")
    }
    else -> error("Unknown fixture scenario")
  }
}

fun main(arguments: Array<String>) {
  val name = arguments.single()
  runScenario(name)
  println("{\"scenario\":\"" + name + "\",\"passed\":true,\"checks\":" + checks +
    ",\"activationCount\":" + AppMetrica.activationCount +
    ",\"pauseCount\":" + AppMetrica.pauseCount +
    ",\"sdkSendingEnabled\":" + AppMetrica.sendingEnabled + "}")
}
