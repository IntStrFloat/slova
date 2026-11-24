package android.app

import android.content.Context
import android.content.Intent
import android.content.MemoryPreferences
import android.content.pm.ApplicationInfo
import android.os.Bundle

class Application(
  val preferences: MemoryPreferences = MemoryPreferences(),
  override val packageName: String = "com.intstrfloat.slova",
  override val applicationInfo: ApplicationInfo = ApplicationInfo(),
) : Context() {
  private val callbacks = mutableListOf<ActivityLifecycleCallbacks>()
  val registeredCallbackCount: Int get() = callbacks.size

  override fun getSharedPreferences(name: String, mode: Int): MemoryPreferences {
    check(name == "slova.analytics.native.v1")
    check(mode == MODE_PRIVATE)
    return preferences
  }

  fun registerActivityLifecycleCallbacks(listener: ActivityLifecycleCallbacks) { callbacks.add(listener) }
  fun resume(activity: Activity) { callbacks.toList().forEach { it.onActivityResumed(activity) } }
  fun pause(activity: Activity) { callbacks.toList().forEach { it.onActivityPaused(activity) } }

  interface ActivityLifecycleCallbacks {
    fun onActivityResumed(activity: Activity)
    fun onActivityPaused(activity: Activity)
    fun onActivityCreated(activity: Activity, state: Bundle?)
    fun onActivityStarted(activity: Activity)
    fun onActivityStopped(activity: Activity)
    fun onActivitySaveInstanceState(activity: Activity, state: Bundle)
    fun onActivityDestroyed(activity: Activity)
  }
}

class Activity(private val owner: Application) : Context() {
  override val applicationContext: Context get() = owner
  override val packageName: String get() = owner.packageName
  override val applicationInfo: ApplicationInfo get() = owner.applicationInfo
  var intent: Intent? = null
  override fun getSharedPreferences(name: String, mode: Int): MemoryPreferences =
    owner.getSharedPreferences(name, mode)
}
