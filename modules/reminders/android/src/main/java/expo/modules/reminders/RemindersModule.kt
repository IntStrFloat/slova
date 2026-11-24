package expo.modules.reminders

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RemindersModule : Module() {
  private var permissionRequest: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("Reminders")
    Events("onReminderTelemetry")

    OnActivityEntersForeground {
      val context = appContext.reactContext
      if (context != null && ReminderScheduler.captureTap(context, appContext.currentActivity?.intent)) {
        sendEvent("onReminderTelemetry", emptyMap<String, Any>())
      }
    }

    OnNewIntent { intent ->
      appContext.reactContext?.let { context ->
        if (ReminderScheduler.captureTap(context, intent)) {
          sendEvent("onReminderTelemetry", emptyMap<String, Any>())
        }
      }
    }

    Function("permissionGranted") {
      val context = appContext.reactContext
      context != null && ReminderScheduler.canNotify(context)
    }

    // This function is called only after the player accepts the in-app soft ask.
    AsyncFunction("requestPermission") { promise: Promise ->
      val context = appContext.reactContext
      val activity = appContext.currentActivity as? PermissionAwareActivity
      if (context == null) {
        promise.resolve("unavailable")
      } else if (ReminderScheduler.canNotify(context)) {
        promise.resolve("granted")
      } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || activity == null) {
        promise.resolve(if (activity == null) "unavailable" else "denied")
      } else if (permissionRequest != null) {
        promise.resolve("unavailable")
      } else {
        permissionRequest = promise
        val listener = PermissionListener { requestCode, _, grantResults ->
          if (requestCode != PERMISSION_REQUEST_CODE) {
            false
          } else {
            val result = when {
              grantResults.isEmpty() -> "dismissed"
              grantResults[0] == PackageManager.PERMISSION_GRANTED &&
                ReminderScheduler.canNotify(context) -> "granted"
              else -> "denied"
            }
            permissionRequest?.resolve(result)
            permissionRequest = null
            true
          }
        }
        try {
          activity.requestPermissions(
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            PERMISSION_REQUEST_CODE,
            listener,
          )
        } catch (_: Exception) {
          permissionRequest = null
          promise.resolve("unavailable")
        }
      }
    }.runOnQueue(Queues.MAIN)

    Function("replaceSchedules") { json: String ->
      val context = requireNotNull(appContext.reactContext)
      ReminderScheduler.replace(context, json)
    }

    Function("cancelDate") { day: String ->
      appContext.reactContext?.let { ReminderScheduler.cancelDate(it, day) }
    }

    Function("cancelAll") {
      appContext.reactContext?.let { ReminderScheduler.cancelAll(it) }
    }

    Function("sentHistory") {
      appContext.reactContext?.let { ReminderScheduler.sentHistory(it) } ?: "[]"
    }

    Function("reserveRemoteNotification") { json: String ->
      appContext.reactContext?.let { ReminderScheduler.reserveRemote(it, json) }
        ?: "{\"allowed\":false,\"reason\":\"unavailable\"}"
    }
    Function("settleRemoteNotification") { id: String, acceptedOrUnknown: Boolean ->
      appContext.reactContext?.let { ReminderScheduler.settleRemote(it, id, acceptedOrUnknown) } ?: false
    }

    Function("readTelemetry") {
      appContext.reactContext?.let {
        ReminderScheduler.captureTap(it, appContext.currentActivity?.intent)
        ReminderScheduler.readTelemetry(it)
      } ?: "[]"
    }

    Function("acknowledgeTelemetry") { json: String ->
      appContext.reactContext?.let { ReminderScheduler.acknowledgeTelemetry(it, json) }
    }
  }

  companion object {
    private const val PERMISSION_REQUEST_CODE = 7951
  }
}
