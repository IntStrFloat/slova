package ru.rustore.sdk.appupdate.manager.factory
import android.content.Context
import ru.rustore.sdk.appupdate.manager.RuStoreAppUpdateManager
object RuStoreAppUpdateManagerFactory {
  val manager = RuStoreAppUpdateManager()
  var creates = 0
  fun create(context: Context): RuStoreAppUpdateManager { creates++; return manager }
}
