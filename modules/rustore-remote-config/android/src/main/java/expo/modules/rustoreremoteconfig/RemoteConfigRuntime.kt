package expo.modules.rustoreremoteconfig

import android.app.Application
import ru.rustore.sdk.remoteconfig.AppId
import ru.rustore.sdk.remoteconfig.RemoteConfigClient
import ru.rustore.sdk.remoteconfig.RemoteConfigClientBuilder
import ru.rustore.sdk.remoteconfig.UpdateBehaviour

/** Created only by Application.onCreate. No JS call may initialize a second SDK singleton. */
object RemoteConfigRuntime {
  @Volatile var client: RemoteConfigClient? = null
    private set
  @Volatile var configured = false
    private set
  @Volatile var allowed = false
    private set
  private var bootstrapped = false

  @Synchronized
  fun bootstrap(application: Application, appId: String, enabled: Boolean, consented: Boolean) {
    if (bootstrapped) return
    bootstrapped = true
    configured = enabled && appId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}"))
    allowed = configured && consented
    if (!allowed) return
    try {
      val instance = RemoteConfigClientBuilder(AppId(appId), application.applicationContext)
        // JS owns the bounded fetch/TTL. No independent background assignment or polling.
        .setUpdateBehaviour(UpdateBehaviour.Actual)
        .build()
      client = instance
      instance.init().addOnFailureListener { /* getRemoteConfig maps a later failure safely */ }
    } catch (_: Exception) {
      client = null
    }
  }

  @Synchronized
  fun setAllowed(value: Boolean) { allowed = configured && value }
}
