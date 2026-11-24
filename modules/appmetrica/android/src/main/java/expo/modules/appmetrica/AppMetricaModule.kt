package expo.modules.appmetrica

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.appmetrica.analytics.AppMetrica
import io.appmetrica.analytics.StartupParamsCallback
import java.util.concurrent.atomic.AtomicBoolean

/**
 * JS↔native-мост для кастомных событий AppMetrica (спека 16).
 * MainApplication supplies the API key to AppMetricaPrivacy before React starts.
 * Every entry point rechecks the persisted native consent/QA policy.
 */
class AppMetricaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Appmetrica")
    Events("onCrashQaRequested")

    OnCreate {
      appContext.reactContext?.let { context ->
        AppMetricaCrashQa.attach(context, this@AppMetricaModule) { runId ->
          if (appContext.reactContext != null) sendEvent("onCrashQaRequested", mapOf("runId" to runId))
        }
      }
    }
    OnDestroy { AppMetricaCrashQa.detach(this@AppMetricaModule) }

    Function("getCrashReportingCapabilities") {
      val context = appContext.reactContext
      val options = AppMetricaCrashOptions.read(context)
      val qa = AppMetricaCrashQa.enabled(context)
      mapOf("version" to 1, "enabled" to (options.extended || qa), "localQa" to qa)
    }

    Function("canRunCrashQa") { AppMetricaCrashQa.allowed(appContext.reactContext) }

    Function("reportJsError") { payload: Map<String, Any?> ->
      val context = appContext.reactContext
      val options = AppMetricaCrashOptions.read(context)
      val qa = AppMetricaCrashQa.enabled(context)
      if (context == null || (!options.extended && !qa)) "disabled"
      else if (qa && !AppMetricaPrivacy.hasCurrentConsent(context) || !qa && !AppMetricaPrivacy.canReport(context)) "disabled"
      else {
        val error = AppMetricaJsError.parse(payload)
        if (error == null) "invalid" else runCatching {
          val details = error.details(options.appVersion, options.buildId)
          if (qa) {
            if (AppMetricaCrashQa.record(context, details)) "qa_local" else "unavailable"
          } else {
            // Structured context is an error, not a second unhandled crash. The default JVM
            // fatal path is preserved and sanitized independently by ICrashTransformer.
            val reporter = AppMetrica.getPluginExtension()
            if (details.stacktrace.isNotEmpty()) reporter.reportError(details, "javascript_exception_redacted")
            else reporter.reportError("slova_js_${if (error.fatal) "fatal_context" else "error"}",
              "javascript_exception_redacted", details)
            "sdk_error_handoff"
          }
        }.getOrDefault("unavailable")
      }
    }

    Constant("isTestDevice") {
      AppMetricaPrivacy.isTestDevice(appContext.reactContext)
    }

    Function("setDataSendingEnabled") { enabled: Boolean ->
      AppMetricaPrivacy.setDataSendingEnabled(appContext.reactContext, enabled)
    }

    Function("getDataSendingPreference") {
      AppMetricaPrivacy.getDataSendingPreference(appContext.reactContext)
    }

    // This pure package query is available even to keyless/QA/opted-out callers.
    Function("getSoftwareBuildInfo") { AppMetricaBuildInfo.read(appContext.reactContext) }

    Function("reportEvent") { name: String, jsonValue: String? ->
      if (!AppMetricaPrivacy.canReport(appContext.reactContext)) {
        false
      } else {
        if (jsonValue.isNullOrEmpty()) {
          AppMetrica.reportEvent(name)
        } else {
          AppMetrica.reportEvent(name, jsonValue)
        }
        // Local SDK acceptance only, never a server delivery acknowledgement.
        true
      }
    }

    AsyncFunction("getIdentifiers") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null || !AppMetricaPrivacy.canReport(context)) {
        promise.resolve(emptyMap<String, String>())
      } else {
        val settled = AtomicBoolean(false)
        val handler = Handler(Looper.getMainLooper())
        val timeout = Runnable {
          if (settled.compareAndSet(false, true)) promise.resolve(emptyMap<String, String>())
        }
        handler.postDelayed(timeout, 5000L)
        fun finish(result: StartupParamsCallback.Result?) {
          if (!settled.compareAndSet(false, true)) return
          handler.removeCallbacks(timeout)
          if (!AppMetricaPrivacy.canReport(context)) {
            promise.resolve(emptyMap<String, String>())
            return
          }
          val identifiers = mutableMapOf<String, String>()
          // DeviceIdHash is the decimal appmetrica_device_id in Logs API.
          result?.deviceIdHash?.takeIf { it.matches(Regex("^[0-9]{1,20}$")) }
            ?.let { identifiers["deviceId"] = it }
          result?.uuid?.takeIf { it.matches(Regex("^[a-zA-Z0-9_.:-]{1,96}$")) }
            ?.let { identifiers["installationId"] = it }
          promise.resolve(identifiers)
        }
        runCatching {
          AppMetrica.requestStartupParams(context, object : StartupParamsCallback {
            override fun onReceive(result: StartupParamsCallback.Result?) = finish(result)
            override fun onRequestError(reason: StartupParamsCallback.Reason, result: StartupParamsCallback.Result?) = finish(result)
          }, listOf(StartupParamsCallback.APPMETRICA_DEVICE_ID_HASH, StartupParamsCallback.APPMETRICA_UUID))
        }.onFailure { finish(null) }
      }
    }
  }
}
