package ru.rustore.sdk.appupdate.model
class AppUpdateInfo(val packageName: String = "com.intstrfloat.slova.unit", val availableVersionCode: Long = 35,
  val installStatus: Int = 0, val updateAvailability: Int = 2, val allowed: Boolean = true) {
  fun isUpdateTypeAllowed(type: Int) = allowed && type == 0
}
class AppUpdateOptions(val type: Int) {
  class Builder { private var type = -1; fun appUpdateType(value: Int) = apply { type = value }; fun build() = AppUpdateOptions(type) }
}
object AppUpdateType { const val FLEXIBLE = 0 }
class InstallState(val packageName: String, val installStatus: Int, val installErrorCode: Int = 0)
