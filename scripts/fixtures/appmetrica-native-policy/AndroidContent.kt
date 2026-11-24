package android.content

import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager

open class Context {
  open val applicationContext: Context get() = this
  open val packageName: String get() = "com.intstrfloat.slova"
  open val applicationInfo: ApplicationInfo get() = ApplicationInfo()
  open val packageManager: PackageManager get() = PackageManager(applicationInfo)
  open fun getSharedPreferences(name: String, mode: Int): MemoryPreferences =
    error("A fixture must provide its own preference store")
  companion object { const val MODE_PRIVATE = 0 }
}

class Intent

class MemoryPreferences {
  private val values = mutableMapOf<String, Boolean>()
  var commitAllowed = true

  fun seedConsent(value: Boolean) { values["data_sending_enabled"] = value }
  fun contains(key: String): Boolean = values.containsKey(key)
  fun getBoolean(key: String, fallback: Boolean): Boolean = values[key] ?: fallback
  fun edit(): Editor = Editor()

  inner class Editor {
    private val pending = mutableMapOf<String, Boolean>()
    fun putBoolean(key: String, value: Boolean): Editor {
      pending[key] = value
      return this
    }
    fun commit(): Boolean {
      if (!commitAllowed) return false
      values.putAll(pending)
      return true
    }
  }
}
