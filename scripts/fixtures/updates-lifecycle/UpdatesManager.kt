package ru.rustore.sdk.appupdate.manager
import ru.rustore.sdk.appupdate.listener.InstallStateUpdateListener
import ru.rustore.sdk.appupdate.model.AppUpdateInfo
import ru.rustore.sdk.appupdate.model.AppUpdateOptions
class Task<T> {
  private val success = mutableListOf<(T) -> Unit>()
  private val failure = mutableListOf<(Throwable) -> Unit>()
  fun addOnSuccessListener(callback: (T) -> Unit): Task<T> { success += callback; return this }
  fun addOnFailureListener(callback: (Throwable) -> Unit): Task<T> { failure += callback; return this }
  fun succeed(value: T) { success.toList().forEach { it(value) } }
  fun fail(error: Throwable) { failure.toList().forEach { it(error) } }
}
class RuStoreAppUpdateManager {
  val queries = mutableListOf<Task<AppUpdateInfo>>()
  val offers = mutableListOf<Task<Int>>()
  val installs = mutableListOf<Task<Unit>>()
  var listener: InstallStateUpdateListener? = null
  var registers = 0
  var unregisters = 0
  fun getAppUpdateInfo() = Task<AppUpdateInfo>().also { queries += it }
  fun startUpdateFlow(info: AppUpdateInfo, options: AppUpdateOptions): Task<Int> {
    check(options.type == 0); return Task<Int>().also { offers += it }
  }
  fun completeUpdate(options: AppUpdateOptions): Task<Unit> {
    check(options.type == 0); return Task<Unit>().also { installs += it }
  }
  fun registerListener(value: InstallStateUpdateListener) { check(listener == null); listener = value; registers++ }
  fun unregisterListener(value: InstallStateUpdateListener) { check(listener === value); listener = null; unregisters++ }
}
