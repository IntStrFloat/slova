package expo.modules.rustorereview

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

class RuStoreReviewModule : Module() {
  private val lock = Any()
  private var manager: RuStoreReviewManager? = null
  private var reviewInfo: ReviewInfo? = null
  private var preparedAt = 0L
  private var generation = 0L
  private var preparing = false
  private var launching = false

  override fun definition() = ModuleDefinition {
    Name("RuStoreReview")

    // The actual store/user eligibility is checked by requestReviewFlow.
    Function("isAvailable") { appContext.reactContext != null }

    AsyncFunction("prepare") { promise: Promise ->
      synchronized(lock) {
        if (preparing || launching || appContext.reactContext == null) {
          promise.resolve(false)
        } else if (hasFreshInfo()) {
          promise.resolve(true)
        } else {
          reviewInfo = null
          preparing = true
          val requestGeneration = generation
          try {
            reviewManager().requestReviewFlow()
              .addOnSuccessListener { info ->
                synchronized(lock) {
                  preparing = false
                  val valid = requestGeneration == generation
                  if (valid) {
                    reviewInfo = info
                    preparedAt = SystemClock.elapsedRealtime()
                  }
                  promise.resolve(valid)
                }
              }
              .addOnFailureListener {
                synchronized(lock) {
                  preparing = false
                  promise.resolve(false)
                }
              }
          } catch (_: Exception) {
            preparing = false
            promise.resolve(false)
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("launch") { promise: Promise ->
      synchronized(lock) {
        val activity = appContext.currentActivity
        val foreground = (appContext.reactContext as? ReactContext)?.lifecycleState == LifecycleState.RESUMED &&
          activity != null && !activity.isFinishing && !activity.isDestroyed
        if (preparing || launching || !foreground || !hasFreshInfo()) {
          promise.resolve("unavailable")
        } else {
          val info = requireNotNull(reviewInfo)
          // ReviewInfo is consumed once, even when launching fails.
          reviewInfo = null
          launching = true
          try {
            reviewManager().launchReviewFlow(info)
              .addOnSuccessListener { finishLaunch(promise, "completed") }
              .addOnFailureListener { finishLaunch(promise, "error") }
          } catch (_: Exception) {
            finishLaunch(promise, "error")
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    Function("discard") {
      synchronized(lock) {
        generation += 1
        reviewInfo = null
        // Invalidate preparation only. An open RuStore form ends by user action.
      }
    }

    OnDestroy {
      synchronized(lock) {
        generation += 1
        reviewInfo = null
      }
    }
  }

  private fun hasFreshInfo(): Boolean = reviewInfo != null &&
    SystemClock.elapsedRealtime() - preparedAt < REVIEW_INFO_MAX_AGE_MS

  private fun reviewManager(): RuStoreReviewManager {
    return manager ?: RuStoreReviewManagerFactory.create(
      requireNotNull(appContext.reactContext).applicationContext,
    ).also { manager = it }
  }

  private fun finishLaunch(promise: Promise, result: String) {
    synchronized(lock) {
      launching = false
      promise.resolve(result)
    }
  }

  companion object {
    // RuStore documents about five minutes; keep a safety margin.
    private const val REVIEW_INFO_MAX_AGE_MS = 4 * 60 * 1000L
  }
}
