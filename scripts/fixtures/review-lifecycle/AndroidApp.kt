package android.app

open class Activity {
  var isFinishing = false
  var isDestroyed = false
  var focused = true
  fun hasWindowFocus() = focused
}
