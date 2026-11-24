package expo.modules.rustoreremoteconfig

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicLong

class RuStoreRemoteConfigModule : Module() {
  @Volatile private var alive = true
  private val generation = AtomicLong(0L)
  @Volatile private var helpForeground = true
  private val helpForegroundGeneration = AtomicLong(0L)

  override fun definition() = ModuleDefinition {
    Name("RuStoreRemoteConfig")

    Function("isAvailable") { RemoteConfigRuntime.allowed && RemoteConfigRuntime.client != null }
    Function("status") {
      when {
        !RemoteConfigRuntime.configured -> "disabled"
        !RemoteConfigRuntime.allowed -> "consent_required"
        RemoteConfigRuntime.client == null -> "restart_required"
        else -> "ready"
      }
    }

    Function("setAllowed") { allowed: Boolean ->
      generation.incrementAndGet()
      RemoteConfigRuntime.setAllowed(allowed)
    }

    AsyncFunction("fetchConfig") { promise: Promise ->
      val client = RemoteConfigRuntime.client
      if (!RemoteConfigRuntime.allowed || client == null || !contextAlive()) {
        promise.resolve(mapOf("status" to "unavailable", "reason" to "not_initialized"))
      } else {
        val requestGeneration = generation.get()
        try {
          client.getRemoteConfig()
            .addOnSuccessListener { config ->
              if (contextAlive()) {
                if (requestGeneration != generation.get() || !RemoteConfigRuntime.allowed) {
                  promise.resolve(mapOf("status" to "cancelled", "reason" to "disabled"))
                } else {
                  val result = try {
                    if (!config.containsKey(POLICY_KEY)) mapOf("status" to "unavailable", "reason" to "missing_parameter")
                    else {
                      val json = config.getString(POLICY_KEY)
                      if (json.length > MAX_POLICY_LENGTH) mapOf("status" to "terminal", "reason" to "oversized_payload")
                      else mapOf("status" to "success", "json" to json)
                    }
                  } catch (_: Exception) {
                    mapOf("status" to "terminal", "reason" to "invalid_payload")
                  }
                  promise.resolve(result)
                }
              }
            }
            .addOnFailureListener {
              if (contextAlive()) promise.resolve(if (requestGeneration == generation.get() && RemoteConfigRuntime.allowed)
                mapOf("status" to "retryable", "reason" to "network")
                else mapOf("status" to "cancelled", "reason" to "disabled"))
            }
        } catch (_: Exception) {
          if (contextAlive()) promise.resolve(mapOf("status" to "retryable", "reason" to "unavailable"))
        }
      }
    }.runOnQueue(Queues.MAIN)

    // Separate fixed key and capability; the numeric policy API above keeps its existing contract.
    AsyncFunction("fetchHelpExperimentControl") { promise: Promise ->
      val client = RemoteConfigRuntime.client
      if (!RemoteConfigRuntime.allowed || client == null || !contextAlive()) {
        promise.resolve(mapOf("status" to "unavailable", "reason" to "not_initialized"))
      } else if (!helpForeground) {
        promise.resolve(mapOf("status" to "cancelled", "reason" to "background"))
      } else {
        val requestGeneration = generation.get()
        val foregroundGeneration = helpForegroundGeneration.get()
        val requestAllowed = {
          requestGeneration == generation.get() && RemoteConfigRuntime.allowed && helpForeground &&
            foregroundGeneration == helpForegroundGeneration.get()
        }
        try {
          // Application-owned client uses UpdateBehaviour.Actual: this task fetches from the SDK server.
          client.getRemoteConfig()
            .addOnSuccessListener { config ->
              if (contextAlive()) {
                if (!requestAllowed()) {
                  promise.resolve(mapOf("status" to "cancelled", "reason" to "disabled"))
                } else {
                  val result = try {
                    if (!config.containsKey(HELP_EXPERIMENT_STOP_KEY)) mapOf("status" to "unavailable", "reason" to "missing_parameter")
                    else {
                      val json = config.getString(HELP_EXPERIMENT_STOP_KEY)
                      if (json.length > MAX_POLICY_LENGTH || json.toByteArray(Charsets.UTF_8).size > MAX_POLICY_LENGTH)
                        mapOf("status" to "terminal", "reason" to "oversized_payload")
                      else mapOf("status" to "success", "json" to json, "source" to "actual_sdk_fetch")
                    }
                  } catch (_: Exception) {
                    mapOf("status" to "terminal", "reason" to "invalid_payload")
                  }
                  promise.resolve(result)
                }
              }
            }
            .addOnFailureListener {
              if (contextAlive()) promise.resolve(if (requestAllowed())
                mapOf("status" to "retryable", "reason" to "network")
                else mapOf("status" to "cancelled", "reason" to "disabled"))
            }
        } catch (_: Exception) {
          if (contextAlive()) promise.resolve(if (requestAllowed())
            mapOf("status" to "retryable", "reason" to "unavailable")
            else mapOf("status" to "cancelled", "reason" to "disabled"))
        }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersForeground { helpForeground = true; helpForegroundGeneration.incrementAndGet() }
    OnActivityEntersBackground { helpForeground = false; helpForegroundGeneration.incrementAndGet() }
    OnActivityDestroys { helpForeground = false; helpForegroundGeneration.incrementAndGet() }
    OnDestroy { alive = false; generation.incrementAndGet() }
  }

  private fun contextAlive(): Boolean = alive && appContext.hasActiveReactInstance

  companion object {
    private const val POLICY_KEY = "slova_policy_v1"
    private const val HELP_EXPERIMENT_STOP_KEY = "slova_help_experiment_stop_v1"
    private const val MAX_POLICY_LENGTH = 16_384
  }
}
