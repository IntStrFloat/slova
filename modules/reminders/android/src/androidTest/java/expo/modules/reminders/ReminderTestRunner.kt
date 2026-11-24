package expo.modules.reminders

import android.Manifest
import android.app.Activity
import android.app.Instrumentation
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.SimpleTimeZone
import java.util.TimeZone

/** Framework-only runner: no testing dependency and never opens or resets the game's profile. */
class ReminderTestRunner : Instrumentation() {
  override fun onCreate(arguments: Bundle?) {
    super.onCreate(arguments)
    start()
  }

  override fun onStart() {
    val originalZone = TimeZone.getDefault()
    val passed = mutableListOf<String>()
    try {
      val testContext = context
      check(testContext.packageName == "expo.modules.reminders.test") { "Must run in isolated test package" }
      val prefs = testContext.getSharedPreferences("slova.daily.reminders.v1", Context.MODE_PRIVATE)
      fun clear() {
        ReminderScheduler.cancelAll(testContext)
        prefs.edit().clear().commit()
      }
      fun day(at: Long) = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("GMT+03:00")
      }.format(at)
      fun plan(at: Long) = JSONArray().put(JSONObject().put("dateKey", day(at)).put("fireAtMs", at)).toString()
      fun events() = JSONArray(ReminderScheduler.readTelemetry(testContext))
      fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(uiAutomation.executeShellCommand(command)).use { it.readBytes() }
      }
      // notify/cancel enqueue work in system_server; observe the real result with a bounded wait.
      fun awaitNotifications(reason: String, ready: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 2_000L
        while (!ready()) {
          check(SystemClock.elapsedRealtime() < deadline) { reason }
          SystemClock.sleep(20)
        }
      }
      val future = System.currentTimeMillis() + 24 * 60 * 60 * 1000L

      clear()
      check(ReminderScheduler.replace(testContext, plan(future)) == 1)
      check(events().length() == 1 && events().getJSONObject(0).getString("kind") == "scheduled")
      ReminderScheduler.replace(testContext, plan(future))
      check(events().length() == 1) { "Unchanged resume must not repeat scheduled event" }
      val scheduledId = events().getJSONObject(0).getString("eventId")
      check(ReminderScheduler.readTelemetry(testContext) == ReminderScheduler.readTelemetry(testContext))
      ReminderScheduler.acknowledgeTelemetry(testContext, JSONArray().put(scheduledId).toString())
      check(events().length() == 0)
      ReminderScheduler.replace(testContext, plan(future))
      check(events().length() == 0) { "Acknowledged unchanged schedule must stay retired" }
      passed.add("schedule_journal_read_ack_and_resync")

      ReminderScheduler.restoreAfterBoot(testContext)
      check(JSONArray(prefs.getString("plan", "[]")).length() == 1)
      ReminderBootReceiver().onReceive(testContext, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))
      check(JSONArray(prefs.getString("plan", "[]")).length() == 1)
      ReminderScheduler.cancelDate(testContext, day(future))
      check(JSONArray(prefs.getString("plan", "[]")).length() == 0)
      passed.add("boot_update_restore_and_solved_date_cancellation")

      clear()
      val now = System.currentTimeMillis()
      val utcHour = Calendar.getInstance(TimeZone.getTimeZone("UTC")).get(Calendar.HOUR_OF_DAY)
      // App-process local zone only: exercise the real daytime branch without changing the emulator clock.
      TimeZone.setDefault(SimpleTimeZone((15 - utcHour) * 60 * 60 * 1000, "reminders-test"))
      val date = day(now)
      // Revoke before am instrument: runtime permission revocation kills a running test process.
      check(!ReminderScheduler.canNotify(testContext)) { "Revoke POST_NOTIFICATIONS before running this test" }
      prefs.edit().putBoolean("enabled", true).putString("plan", plan(now - 1000)).commit()
      ReminderScheduler.onAlarm(testContext, date)
      check(events().length() == 0)
      check(JSONArray(ReminderScheduler.sentHistory(testContext)).length() == 0)
      check(JSONArray(prefs.getString("plan", "[]")).length() == 0)
      passed.add("os_permission_denial_cancels_without_delivery")
      // Only this isolated APK gets permission; wait for the shell command before delivery.
      shell("pm grant ${testContext.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
      check(ReminderScheduler.canNotify(testContext))
      prefs.edit().putBoolean("enabled", true).putString("plan", plan(now - 1000)).commit()
      ReminderScheduler.onAlarm(testContext, date)
      val delivery = events().getJSONObject(0)
      check(delivery.getString("kind") == "delivered")
      check(delivery.getLong("occurredAtMs") >= now)
      check(JSONArray(ReminderScheduler.sentHistory(testContext)).length() == 1)
      val manager = testContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      awaitNotifications("Delivered notification must become visible") { manager.activeNotifications.size == 1 }
      passed.add("actual_delivery_history_and_visible_notification")

      val bad = Intent().putExtra("slovaReminderId", "daily_unknown")
      check(!ReminderScheduler.captureTap(testContext, bad))
      val tap = Intent().putExtra("slovaReminderId", delivery.getString("reminderId"))
      check(ReminderScheduler.captureTap(testContext, tap))
      check(!ReminderScheduler.captureTap(testContext, tap))
      check(events().length() == 2 && events().getJSONObject(1).getString("kind") == "opened")
      ReminderScheduler.cancelDate(testContext, date)
      awaitNotifications("Solved date must remove the posted notification") { manager.activeNotifications.isEmpty() }
      passed.add("genuine_tap_once_and_solved_date_removes_posted_notification")

      prefs.edit().putString("plan", plan(now - 1000)).commit()
      ReminderScheduler.onAlarm(testContext, date)
      check(manager.activeNotifications.isEmpty()) { "Already sent day must not post again" }
      passed.add("duplicate_delivery_cap")

      clear()
      prefs.edit().putBoolean("enabled", true).commit()
      val reservation = JSONObject(ReminderScheduler.reserveRemote(testContext, "{\"requestId\":\"push_a_b\"}", now))
      check(reservation.getBoolean("allowed"))
      val reservationId = reservation.getString("id")
      check(JSONObject(ReminderScheduler.reserveRemote(testContext, "{\"requestId\":\"push_c_d\"}", now)).getString("reason") == "same_day")
      check(ReminderScheduler.settleRemote(testContext, reservationId, false, now))
      val accepted = JSONObject(ReminderScheduler.reserveRemote(testContext, "{\"requestId\":\"push_e_f\"}", now))
      check(accepted.getBoolean("allowed"))
      check(ReminderScheduler.settleRemote(testContext, accepted.getString("id"), true, now))
      check(ReminderScheduler.recordRemoteReceipt(testContext, "remote_${accepted.getString("id")}", now))
      check(JSONArray(ReminderScheduler.sentHistory(testContext)).length() == 1) { "Ack+receipt must consume one budget unit" }
      check(JSONObject(ReminderScheduler.reserveRemote(testContext, "{\"requestId\":\"push_e_f\"}", now)).getString("reason") == "already_accepted")
      prefs.edit().putString("plan", plan(now - 1000)).commit()
      ReminderScheduler.onAlarm(testContext, day(now))
      check(manager.activeNotifications.isEmpty()) { "Remote receipt blocks a stale same-day alarm without JS" }
      passed.add("shared_remote_reservation_receipt_local_collision")

      clear()
      prefs.edit().putBoolean("enabled", true).commit()
      val remoteWeek = JSONArray()
      for (offset in 1..3) {
        val sentAt = now - offset * 24 * 60 * 60 * 1000L
        remoteWeek.put(JSONObject().put("dateKey", day(sentAt)).put("sentAtMs", sentAt)
          .put("reminderId", "remote_old_$offset").put("channel", "remote"))
      }
      prefs.edit().putString("sent", remoteWeek.toString()).commit()
      check(JSONObject(ReminderScheduler.reserveRemote(testContext, "{\"requestId\":\"push_f_a\"}", now)).getString("reason") == "weekly_limit")
      prefs.edit().putString("plan", plan(now - 1000)).commit()
      ReminderScheduler.onAlarm(testContext, day(now))
      check(manager.activeNotifications.isEmpty())
      passed.add("shared_remote_local_rolling_week_cap")

      clear()
      prefs.edit().putBoolean("enabled", true).commit()
      val futureReservation = JSONObject().put("id", "a".repeat(32)).put("requestId", "push_a_a")
        .put("status", "pending").put("createdAtMs", now + 24 * 60 * 60 * 1000L)
        .put("expiresAtMs", now + 24 * 60 * 60 * 1000L + 120_000L)
      prefs.edit().putString("remote.reservations.v1", JSONArray().put(futureReservation).toString()).commit()
      check(JSONObject(ReminderScheduler.reserveRemote(testContext, "{\"requestId\":\"push_a_a\"}", now)).getString("reason") == "clock_backwards")
      check(JSONObject(ReminderScheduler.reserveRemote(testContext, "{\"requestId\":\"push_b_b\"}", now)).getString("reason") == "clock_backwards")
      check(JSONArray(prefs.getString("remote.reservations.v1", "[]")).length() == 1)
      prefs.edit().putString("plan", plan(now - 1000)).commit()
      ReminderScheduler.onAlarm(testContext, day(now))
      check(manager.activeNotifications.isEmpty())
      check(JSONArray(ReminderScheduler.sentHistory(testContext)).length() == 0)
      passed.add("future_pending_reservation_blocks_remote_reuse_and_local_alarm")

      clear()
      val history = JSONArray()
      for (offset in 1..3) {
        val sentAt = now - offset * 24 * 60 * 60 * 1000L
        history.put(JSONObject().put("dateKey", day(sentAt)).put("sentAtMs", sentAt))
      }
      prefs.edit().putBoolean("enabled", true).putString("plan", plan(now - 1000))
        .putString("sent", history.toString()).commit()
      ReminderScheduler.onAlarm(testContext, date)
      check(manager.activeNotifications.isEmpty())
      check(events().length() == 0) { "Three recent notifications must cap a fourth" }
      passed.add("rolling_three_per_week_cap")

      clear()
      TimeZone.setDefault(SimpleTimeZone((5 - utcHour) * 60 * 60 * 1000, "reminders-quiet-test"))
      prefs.edit().putBoolean("enabled", true).putString("plan", plan(now - 1000)).commit()
      ReminderScheduler.onAlarm(testContext, date)
      check(JSONArray(ReminderScheduler.sentHistory(testContext)).length() == 0)
      check(manager.activeNotifications.isEmpty())
      val nextLocalTen = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 10); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
      }.timeInMillis
      val quietPlan = JSONArray(prefs.getString("plan", "[]"))
      if (day(nextLocalTen) == date) {
        check(quietPlan.length() == 1 && quietPlan.getJSONObject(0).getString("dateKey") == date)
        passed.add("quiet_hours_defer_within_same_product_date_without_delivery")
      } else {
        check(quietPlan.length() == 0) { "Do not defer an outdated daily into a different product date" }
        passed.add("quiet_hours_retire_outdated_daily_without_delivery")
      }
      clear()
      finish(Activity.RESULT_OK, Bundle().apply {
        putInt("tests_passed", passed.size)
        putString("passed", passed.joinToString(","))
      })
    } catch (error: Throwable) {
      finish(Activity.RESULT_CANCELED, Bundle().apply {
        putString("Error", error.stackTraceToString())
        putString("passed", passed.joinToString(","))
      })
    } finally {
      TimeZone.setDefault(originalZone)
      ReminderScheduler.cancelAll(context)
    }
  }
}
