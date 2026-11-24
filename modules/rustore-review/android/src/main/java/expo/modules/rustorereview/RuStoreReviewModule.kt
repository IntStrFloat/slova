package expo.modules.rustorereview

import android.content.Context
import android.os.SystemClock
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import ru.rustore.sdk.review.RuStoreReviewManager
import ru.rustore.sdk.review.RuStoreReviewManagerFactory
import ru.rustore.sdk.review.model.ReviewInfo
import java.util.Collections
import java.util.WeakHashMap

class RuStoreReviewModule : Module() {
  private class Request(val context: Context, val generation: Long, val promise: Promise, val detailed: Boolean = false)
  private var manager: RuStoreReviewManager? = null
  private var reviewInfo: ReviewInfo? = null
  private var preparedContext: Context? = null
  private var preparedAt = 0L
  private var generation = 0L
  private var destroyed = false
  private var preparing: Request? = null

  override fun definition() = ModuleDefinition {
    Name("RuStoreReview")
    Events("onFormOwnerChanged")
    OnCreate { synchronized(lock) { observers.add(this@RuStoreReviewModule) } }

    // Actual store/user eligibility belongs to requestReviewFlow, not this capability check.
    Function("isAvailable") { synchronized(lock) { live(appContext.reactContext, generation) } }
    Function("hasActiveForm") { hasProcessForm() }
    Function("getLifecycleVersion") { guardianVersion() }

    // Keep the previous Boolean method for older JS, with the same lifecycle guards.
    AsyncFunction("prepare") { promise: Promise -> requestPreparation(promise, false) }.runOnQueue(Queues.MAIN)
    AsyncFunction("prepareResult") { promise: Promise -> requestPreparation(promise, true) }.runOnQueue(Queues.MAIN)

    AsyncFunction("launch") { promise: Promise ->
      synchronized(lock) {
        val context = appContext.reactContext
        if (live(context, generation)) {
          val activity = appContext.currentActivity
          val foreground = (context as? ReactContext)?.lifecycleState == LifecycleState.RESUMED &&
            activity != null && !activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()
          if (preparing != null || hasProcessForm() || !foreground || !hasFreshInfo(context)) {
            promise.resolve("unavailable")
          } else {
            val info = requireNotNull(reviewInfo)
            clearPrepared()
            val request = Request(requireNotNull(context), generation, promise)
            activeLaunch = request
            notifyOwnerChange()
            try {
              reviewManager(request.context).launchReviewFlow(info)
                .addOnSuccessListener { finishLaunch(request, "completed") }
                .addOnFailureListener { finishLaunch(request, "error") }
            } catch (_: Exception) { finishLaunch(request, "error") }
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    Function("discard") {
      synchronized(lock) {
        preparing = null
        clearPrepared()
        // Discard invalidates preparation only, not a live user-owned form.
      }
    }
    OnDestroy {
      synchronized(lock) {
        destroyed = true
        observers.remove(this@RuStoreReviewModule)
        generation += 1
        preparing = null
        clearPrepared()
        // A new JS runtime must still observe an old native form until its terminal callback.
      }
    }
  }

  private fun live(context: Context?, requestGeneration: Long): Boolean = !destroyed &&
    generation == requestGeneration && context != null && appContext.hasActiveReactInstance &&
    appContext.reactContext === context

  private fun clearPrepared() {
    reviewInfo = null
    preparedContext = null
  }

  private fun hasFreshInfo(context: Context?): Boolean = reviewInfo != null && preparedContext === context &&
    SystemClock.elapsedRealtime() - preparedAt in 0 until REVIEW_INFO_MAX_AGE_MS

  private fun requestPreparation(promise: Promise, detailed: Boolean) {
    synchronized(lock) {
      val context = appContext.reactContext
      if (!live(context, generation)) return
      val request = Request(requireNotNull(context), generation, promise, detailed)
      if (preparing != null || hasProcessForm()) {
        resolvePreparation(request, "unavailable")
      } else if (hasFreshInfo(context)) {
        resolvePreparation(request, "ready")
      } else {
        clearPrepared()
        preparing = request
        try {
          reviewManager(request.context).requestReviewFlow()
            .addOnSuccessListener { info -> finishPreparation(request, "ready", info) }
            .addOnFailureListener { finishPreparation(request, "error") }
        } catch (_: Exception) { finishPreparation(request, "error") }
      }
    }
  }

  private fun finishPreparation(request: Request, result: String, info: ReviewInfo? = null) {
    synchronized(lock) {
      if (preparing !== request) return
      preparing = null
      if (!live(request.context, request.generation)) return
      if (result == "ready" && info != null) {
        reviewInfo = info
        preparedContext = request.context
        preparedAt = SystemClock.elapsedRealtime()
      }
      resolvePreparation(request, result)
    }
  }

  private fun resolvePreparation(request: Request, result: String) {
    if (request.detailed) request.promise.resolve(result) else request.promise.resolve(result == "ready")
  }

  private fun reviewManager(context: Context): RuStoreReviewManager = manager ?:
    RuStoreReviewManagerFactory.create(context.applicationContext).also { manager = it }

  private fun finishLaunch(request: Request, result: String) {
    synchronized(lock) {
      if (activeLaunch !== request) return
      activeLaunch = null
      notifyOwnerChange()
      // Terminal cleanup belongs to this native owner, even when its JS runtime is gone.
      if (live(request.context, request.generation)) request.promise.resolve(result)
    }
  }

  private fun emitOwnerChange() {
    try {
      if (!live(appContext.reactContext, generation)) return
      sendEvent("onFormOwnerChanged", emptyMap<String, Any?>())
    } catch (_: Exception) {
      // A disposed event emitter cannot retain native UI or change its terminal result.
    }
  }

  companion object {
    private val lock = Any()
    private var activeLaunch: Request? = null
    private var updateFormOwner: Any? = null
    private val observers = Collections.newSetFromMap(WeakHashMap<RuStoreReviewModule, Boolean>())
    private fun notifyOwnerChange() { observers.toList().forEach { it.emitOwnerChange() } }
    fun guardianVersion(): Int = 3
    fun hasProcessForm(): Boolean = synchronized(lock) { activeLaunch != null || updateFormOwner != null }
    fun tryAcquireUpdateForm(owner: Any): Boolean = synchronized(lock) {
      if (activeLaunch != null || updateFormOwner != null) false else {
        updateFormOwner = owner; notifyOwnerChange(); true
      }
    }
    fun releaseUpdateForm(owner: Any) {
      synchronized(lock) {
        if (updateFormOwner !== owner) return
        updateFormOwner = null; notifyOwnerChange()
      }
    }
    private const val REVIEW_INFO_MAX_AGE_MS = 4 * 60 * 1000L
  }
}
