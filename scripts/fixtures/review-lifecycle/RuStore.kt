@file:Suppress("UNUSED_PARAMETER")
package ru.rustore.sdk.review

import android.content.Context
import ru.rustore.sdk.review.model.ReviewInfo

class Task<T> {
  private val success = mutableListOf<(T) -> Unit>()
  private val failure = mutableListOf<(Exception) -> Unit>()
  fun addOnSuccessListener(callback: (T) -> Unit): Task<T> { success += callback; return this }
  fun addOnFailureListener(callback: (Exception) -> Unit): Task<T> { failure += callback; return this }
  fun succeed(value: T) { success.forEach { it(value) } }
  fun fail() { failure.forEach { it(IllegalStateException("fixture")) } }
}
class RuStoreReviewManager {
  val prepares = mutableListOf<Task<ReviewInfo>>()
  val launches = mutableListOf<Task<Unit>>()
  var throwPrepare = false
  var throwLaunch = false
  fun requestReviewFlow(): Task<ReviewInfo> {
    check(!throwPrepare)
    return Task<ReviewInfo>().also { prepares += it }
  }
  fun launchReviewFlow(info: ReviewInfo): Task<Unit> {
    check(!throwLaunch)
    return Task<Unit>().also { launches += it }
  }
}
object RuStoreReviewManagerFactory {
  var manager = RuStoreReviewManager()
  fun create(context: Context) = manager
}
