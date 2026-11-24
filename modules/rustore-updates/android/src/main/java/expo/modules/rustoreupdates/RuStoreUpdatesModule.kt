package expo.modules.rustoreupdates

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.rustorereview.RuStoreReviewModule
import ru.rustore.sdk.appupdate.errors.RuStoreInstallException
import ru.rustore.sdk.appupdate.listener.InstallStateUpdateListener
import ru.rustore.sdk.appupdate.manager.RuStoreAppUpdateManager
import ru.rustore.sdk.appupdate.manager.factory.RuStoreAppUpdateManagerFactory
import ru.rustore.sdk.appupdate.model.AppUpdateInfo
import ru.rustore.sdk.appupdate.model.AppUpdateOptions
import ru.rustore.sdk.appupdate.model.AppUpdateType
import ru.rustore.sdk.appupdate.model.InstallState
import ru.rustore.sdk.core.exception.RuStoreApplicationBannedException
import ru.rustore.sdk.core.exception.RuStoreConnectionTimeout
import ru.rustore.sdk.core.exception.RuStoreFeatureAvailabilityException
import ru.rustore.sdk.core.exception.RuStoreNotInstalledException
import ru.rustore.sdk.core.exception.RuStoreOutdatedException
import ru.rustore.sdk.core.exception.RuStoreServiceUnavailableException
import ru.rustore.sdk.core.exception.RuStoreUserBannedException
import ru.rustore.sdk.core.exception.RuStoreUserUnauthorizedException
import java.util.Collections
import java.util.WeakHashMap

class RuStoreUpdatesModule : Module() {
  private class Request(val context: Context, val generation: Long, val promise: Promise)
  private class Prepared(val info: AppUpdateInfo, val context: Context, val generation: Long, val at: Long, val token: String, val installed: Long)
  private var generation = 0L
  private var destroyed = false
  private var checking: Request? = null
  private var prepared: Prepared? = null

  override fun definition() = ModuleDefinition {
    Name("RuStoreUpdates")
    Events("onDownloadState")
    OnCreate { synchronized(lock) { observers.add(this@RuStoreUpdatesModule) } }
    Function("getCapabilities") { mapOf("bridgeVersion" to 1, "guardianVersion" to RuStoreReviewModule.guardianVersion(),
      "flexible" to true, "realSdkAllowed" to allowed(appContext.reactContext)) }
    Function("getNativeVersionCode") { actualVersion(appContext.reactContext)?.toString() }
    AsyncFunction("checkAvailability") { promise: Promise -> check(promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("startFlexible") { token: String, promise: Promise -> launch(token, null, promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("completeFlexible") { versionCode: String, promise: Promise -> launch(null, versionCode, promise) }.runOnQueue(Queues.MAIN)
    Function("discard") { synchronized(lock) { checking = null; prepared = null } }
    OnDestroy {
      synchronized(lock) {
        destroyed = true; generation += 1; checking = null; prepared = null
        observers.remove(this@RuStoreUpdatesModule)
        if (observers.isEmpty()) detachListener()
        // The process owner and actual terminal callback outlive this JS context.
      }
    }
  }

  private fun live(context: Context?, requestGeneration: Long): Boolean = !destroyed && context != null &&
    generation == requestGeneration && appContext.hasActiveReactInstance && appContext.reactContext === context

  private fun ready(context: Context): Boolean {
    val activity = appContext.currentActivity
    return live(context, generation) && (context as? ReactContext)?.lifecycleState == LifecycleState.RESUMED &&
      activity != null && !activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()
  }

  private fun check(promise: Promise) {
    synchronized(lock) {
      val context = appContext.reactContext
      if (!live(context, generation)) return
      if (!allowed(context)) { promise.resolve(result("unavailable", "disabled")); return }
      if (checking != null || RuStoreReviewModule.hasProcessForm()) { promise.resolve(result("unavailable", "busy")); return }
      prepared = null
      val request = Request(requireNotNull(context), generation, promise)
      checking = request
      try {
        updateManager(request.context).getAppUpdateInfo()
          .addOnSuccessListener { info -> finishCheck(request, info, null) }
          .addOnFailureListener { error -> finishCheck(request, null, error) }
      } catch (error: Exception) { finishCheck(request, null, error) }
    }
  }

  private fun finishCheck(request: Request, info: AppUpdateInfo?, error: Throwable?) {
    synchronized(lock) {
      if (checking !== request) return
      checking = null
      if (!live(request.context, request.generation)) return
      if (error != null) { request.promise.resolve(failure(error)); return }
      if (info == null) { request.promise.resolve(result("unknown", "unknown_state")); return }
      if (info.packageName != request.context.packageName) { request.promise.resolve(result("unavailable", "invalid_version")); return }
      when (info.updateAvailability) {
        1 -> { request.promise.resolve(result("none", "not_available")); return }
        0 -> { request.promise.resolve(result("unknown", "unknown_state")); return }
        2, 3 -> Unit
        else -> { request.promise.resolve(result("unknown", "unknown_state")); return }
      }
      val installed = actualVersion(request.context)
      if (installed == null || info.availableVersionCode <= installed || info.availableVersionCode <= 0) {
        request.promise.resolve(result("unavailable", "invalid_version")); return
      }
      if (!info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) { request.promise.resolve(result("unavailable", "feature_unavailable")); return }
      val token = "up_${++sequence}"
      prepared = Prepared(info, request.context, request.generation, SystemClock.elapsedRealtime(), token, installed)
      targetVersion = info.availableVersionCode
      request.promise.resolve(mapOf("result" to "available", "versionCode" to info.availableVersionCode.toString(),
        "installedVersionCode" to installed.toString(), "state" to state(info.installStatus), "infoToken" to token))
    }
  }

  private fun launch(token: String?, expectedVersion: String?, promise: Promise) {
    synchronized(lock) {
      val context = appContext.reactContext
      if (!live(context, generation)) return
      if (!allowed(context)) { promise.resolve(result("unavailable", "disabled")); return }
      val info = prepared
      prepared = null // A launch attempt consumes app-held SDK information, even on failure.
      val age = if (info == null) -1 else SystemClock.elapsedRealtime() - info.at
      if (info == null || info.context !== context || info.generation != generation || age !in 0 until INFO_TTL_MS ||
        actualVersion(context) != info.installed || (token != null && info.token != token) ||
        (expectedVersion != null && (expectedVersion != info.info.availableVersionCode.toString() || info.info.installStatus != 1))) {
        promise.resolve(result("unavailable", "stale_info")); return
      }
      if (!ready(requireNotNull(context))) { promise.resolve(result("unavailable", "activity_not_ready")); return }
      val request = Request(context, generation, promise)
      if (!RuStoreReviewModule.tryAcquireUpdateForm(request)) { promise.resolve(result("unavailable", "busy")); return }
      activeFlow = request
      try {
        val manager = updateManager(context)
        val options = AppUpdateOptions.Builder().appUpdateType(AppUpdateType.FLEXIBLE).build()
        if (expectedVersion == null) {
          manager.startUpdateFlow(info.info, options)
            .addOnSuccessListener { code -> finishFlow(request, when (code) {
              -1 -> result("download_accepted", "accepted")
              0 -> result("cancelled", "declined")
              else -> result("unknown", "unknown_state")
            }) }
            .addOnFailureListener { error -> finishFlow(request, failure(error)) }
        } else {
          manager.completeUpdate(options)
            // SDK10.5.2 maps both Activity OK and cancellation to Unit success.
            .addOnSuccessListener { finishFlow(request, result("flow_ended_unconfirmed", "flow_returned")) }
            .addOnFailureListener { error -> finishFlow(request, failure(error)) }
        }
      } catch (error: Exception) { finishFlow(request, failure(error)) }
    }
  }

  private fun finishFlow(request: Request, value: Map<String, Any>) {
    synchronized(lock) {
      if (activeFlow !== request) return
      activeFlow = null
      RuStoreReviewModule.releaseUpdateForm(request)
      if (live(request.context, request.generation)) request.promise.resolve(value)
    }
  }

  private fun emitState(value: Map<String, Any>) {
    try { if (live(appContext.reactContext, generation)) sendEvent("onDownloadState", value) } catch (_: Exception) { /* Disposed emitter. */ }
  }

  companion object {
    const val ALLOW_REAL_SDK = "expo.modules.rustoreupdates.ALLOW_REAL_SDK"
    private const val INFO_TTL_MS = 120_000L
    private val lock = Any()
    private var sequence = 0L
    private var manager: RuStoreAppUpdateManager? = null
    private var listener: InstallStateUpdateListener? = null
    private var targetVersion: Long? = null
    private var activeFlow: Request? = null
    private val observers = Collections.newSetFromMap(WeakHashMap<RuStoreUpdatesModule, Boolean>())

    private fun result(outcome: String, reason: String): Map<String, Any> = mapOf("result" to outcome, "reason" to reason)
    private fun allowed(context: Context?): Boolean = try {
      context != null && !context.packageName.endsWith(".sdkqa") &&
        context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData?.getBoolean(ALLOW_REAL_SDK, false) == true
    } catch (_: Exception) { false }
    @Suppress("DEPRECATION")
    private fun actualVersion(context: Context?): Long? = try {
      if (context == null) null else {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        (if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()).takeIf { it > 0 }
      }
    } catch (_: Exception) { null }

    private fun updateManager(context: Context): RuStoreAppUpdateManager {
      check(allowed(context)) { "updates_disabled" }
      val value = manager ?: RuStoreAppUpdateManagerFactory.create(context.applicationContext).also { manager = it }
      if (listener == null) {
        val packageName = context.packageName
        val observer = object : InstallStateUpdateListener {
          override fun onStateUpdated(value: InstallState) {
            synchronized(lock) {
              val target = targetVersion ?: return
              if (value.packageName != packageName) return
              val event = mapOf("state" to state(value.installStatus), "versionCode" to target.toString(), "errorCode" to value.installErrorCode)
              observers.toList().forEach { it.emitState(event) }
            }
          }
        }
        value.registerListener(observer); listener = observer
      }
      return value
    }
    private fun detachListener() {
      val observer = listener ?: return
      try { manager?.unregisterListener(observer); listener = null } catch (_: Exception) { /* Retain identity to avoid duplicate registration. */ }
    }
    private fun state(code: Int): String = when (code) { 1 -> "downloaded"; 2 -> "downloading"; 3 -> "failed"; 4 -> "installing"; 5 -> "pending"; 6 -> "interrupted"; else -> "unknown" }
    private fun failure(error: Throwable): Map<String, Any> {
      val code = (error as? RuStoreInstallException)?.code
      val mapped = when (code) {
        4010 -> result("cancelled", "aborted")
        4016 -> result("cancelled", "interrupted")
        4002 -> result("retryable_error", "download")
        4006 -> result("retryable_error", "storage")
        4009 -> result("retryable_error", "internal")
        4014 -> result("retryable_error", "network")
        4003 -> result("terminal_error", "blocked")
        4004 -> result("terminal_error", "invalid_apk")
        4005 -> result("terminal_error", "conflict")
        4007 -> result("terminal_error", "incompatible")
        4008 -> result("terminal_error", "not_owned")
        4011 -> result("terminal_error", "missing_apk")
        4012 -> result("terminal_error", "source_denied")
        4015 -> result("terminal_error", "verification_blocked")
        2, 9901, 9902 -> result("unavailable", "activity_not_ready")
        else -> when (error) {
          is RuStoreNotInstalledException -> result("unavailable", "store_missing")
          is RuStoreOutdatedException -> result("unavailable", "store_outdated")
          is RuStoreUserUnauthorizedException -> result("unavailable", "unauthorized")
          is RuStoreUserBannedException, is RuStoreApplicationBannedException, is RuStoreFeatureAvailabilityException -> result("unavailable", "feature_unavailable")
          is RuStoreConnectionTimeout, is RuStoreServiceUnavailableException -> result("retryable_error", "network")
          else -> result("unknown", "unknown_error")
        }
      }
      return if (code == null) mapped else mapped + ("errorCode" to code)
    }
  }
}
