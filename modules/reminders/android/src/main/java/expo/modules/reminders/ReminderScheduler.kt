package expo.modules.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

private data class PlannedReminder(val dateKey: String, val fireAtMs: Long) {
  val reminderId: String get() = "daily_${dateKey}_${fireAtMs}"
}
private data class SentReminder(
  val dateKey: String, val localDateKey: String, val sentAtMs: Long,
  val reminderId: String = "", val fireAtMs: Long = 0,
)

/** Persisted native gates still apply if the JS process has been killed. */
internal object ReminderScheduler {
  private const val PREFS = "slova.daily.reminders.v1"
  private const val PLAN = "plan"
  private const val SENT = "sent"
  private const val ENABLED = "enabled"
  private const val TELEMETRY = "telemetry"
  private const val EXTRA_REMINDER = "slovaReminderId"
  private const val CHANNEL = "slova_daily_reminders"
  private const val EXTRA_DATE = "dateKey"
  private const val WINDOW_MS = 10 * 60 * 1000L
  private const val WEEK_MS = 7 * 24 * 60 * 60 * 1000L
  private const val MAX_PER_WEEK = 3
  private const val MAX_TELEMETRY = 256
  private const val HISTORY_MS = 30 * 24 * 60 * 60 * 1000L
  private val datePattern = Regex("\\d{4}-\\d{2}-\\d{2}")

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun readPlan(context: Context): List<PlannedReminder> {
    val json = prefs(context).getString(PLAN, "[]") ?: "[]"
    return try {
      val array = JSONArray(json)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        val date = item.optString("dateKey")
        val at = item.optLong("fireAtMs", -1)
        if (datePattern.matches(date) && at > 0) PlannedReminder(date, at) else null
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun writePlan(context: Context, plan: List<PlannedReminder>) {
    val array = JSONArray()
    plan.forEach { array.put(JSONObject().put("dateKey", it.dateKey).put("fireAtMs", it.fireAtMs)) }
    prefs(context).edit().putString(PLAN, array.toString()).commit()
  }

  private fun readSent(context: Context): List<SentReminder> {
    val json = prefs(context).getString(SENT, "[]") ?: "[]"
    return try {
      val array = JSONArray(json)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        val date = item.optString("dateKey")
        val at = item.optLong("sentAtMs", -1)
        val localDate = item.optString("localDateKey").takeIf { datePattern.matches(it) }
          ?: deviceDay(at)
        if (datePattern.matches(date) && at > 0) SentReminder(
          date, localDate, at, item.optString("reminderId"), item.optLong("fireAtMs"),
        ) else null
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun writeSent(context: Context, history: List<SentReminder>) {
    val array = JSONArray()
    history.forEach {
      array.put(JSONObject().put("dateKey", it.dateKey)
        .put("localDateKey", it.localDateKey).put("sentAtMs", it.sentAtMs)
        .put("reminderId", it.reminderId).put("fireAtMs", it.fireAtMs))
    }
    prefs(context).edit().putString(SENT, array.toString()).commit()
  }

  @Synchronized
  fun sentHistory(context: Context): String {
    val array = JSONArray()
    readSent(context).forEach {
      array.put(JSONObject().put("dateKey", it.dateKey)
        .put("localDateKey", it.localDateKey).put("sentAtMs", it.sentAtMs)
        .put("reminderId", it.reminderId).put("fireAtMs", it.fireAtMs))
    }
    return array.toString()
  }

  private fun telemetry(context: Context): JSONArray = try {
    JSONArray(prefs(context).getString(TELEMETRY, "[]") ?: "[]")
  } catch (_: Exception) { JSONArray() }

  private fun recordTelemetry(context: Context, reminder: PlannedReminder, kind: String, atMs: Long) {
    val eventId = "${reminder.reminderId}:${kind}"
    val current = telemetry(context)
    val retained = JSONArray()
    for (index in 0 until current.length()) {
      val event = current.optJSONObject(index) ?: continue
      if (event.optString("eventId") == eventId) return
      if (index >= current.length() - MAX_TELEMETRY + 1) retained.put(event)
    }
    retained.put(JSONObject().put("eventId", eventId).put("reminderId", reminder.reminderId)
      .put("kind", kind).put("dateKey", reminder.dateKey).put("fireAtMs", reminder.fireAtMs)
      .put("occurredAtMs", atMs))
    prefs(context).edit().putString(TELEMETRY, retained.toString()).commit()
  }

  @Synchronized
  fun readTelemetry(context: Context): String = telemetry(context).toString()

  @Synchronized
  fun acknowledgeTelemetry(context: Context, json: String) {
    val ids = try {
      val array = JSONArray(json)
      (0 until minOf(array.length(), MAX_TELEMETRY)).map { array.optString(it) }.toSet()
    } catch (_: Exception) { emptySet<String>() }
    val current = telemetry(context)
    val retained = JSONArray()
    for (index in 0 until current.length()) {
      val event = current.optJSONObject(index) ?: continue
      if (!ids.contains(event.optString("eventId"))) retained.put(event)
    }
    prefs(context).edit().putString(TELEMETRY, retained.toString()).commit()
  }

  /** A local tap is accepted only when this module previously delivered that reminder. */
  @Synchronized
  fun captureTap(context: Context, intent: Intent?): Boolean {
    val id = intent?.getStringExtra(EXTRA_REMINDER) ?: return false
    val sent = readSent(context).find { it.reminderId == id && it.fireAtMs > 0 } ?: return false
    recordTelemetry(context, PlannedReminder(sent.dateKey, sent.fireAtMs), "opened", System.currentTimeMillis())
    // Activity retains its launch intent on resume. Consume once even after JS acknowledges.
    intent.removeExtra(EXTRA_REMINDER)
    return true
  }

  fun canNotify(context: Context): Boolean {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!manager.areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      return false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) {
      return false
    }
    return true
  }

  private fun productDay(atMs: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("GMT+03:00")
    }.format(atMs)

  private fun deviceDay(atMs: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(atMs)

  private fun requestCode(day: String) = day.replace("-", "").toInt()

  private fun alarmIntent(context: Context, day: String, flags: Int): PendingIntent? {
    val intent = Intent(context, ReminderReceiver::class.java).putExtra(EXTRA_DATE, day)
    return PendingIntent.getBroadcast(
      context,
      requestCode(day),
      intent,
      flags or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun cancelAlarm(context: Context, day: String) {
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmIntent(context, day, PendingIntent.FLAG_NO_CREATE)?.let {
      alarm.cancel(it)
      it.cancel()
    }
  }

  private fun scheduleAlarm(context: Context, day: String, atMs: Long) {
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = alarmIntent(context, day, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
    // No exact-alarm permission: a flexible window respects Android 12+ limits.
    alarm.setWindow(AlarmManager.RTC_WAKEUP, atMs, WINDOW_MS, intent)
  }

  /** Replaces future reminders after JS has checked content, opt-in and daily completion. */
  @Synchronized
  fun replace(context: Context, json: String): Int {
    val now = System.currentTimeMillis()
    val incoming = try {
      val array = JSONArray(json)
      (0 until minOf(array.length(), 14)).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        val day = item.optString("dateKey")
        val at = item.optLong("fireAtMs", -1)
        if (datePattern.matches(day) && at > now && productDay(at) == day) {
          PlannedReminder(day, at)
        } else null
      }.distinctBy { it.dateKey }
    } catch (_: Exception) {
      emptyList()
    }
    val previous = readPlan(context)
    previous.forEach { cancelAlarm(context, it.dateKey) }
    prefs(context).edit().putBoolean(ENABLED, true).commit()
    writePlan(context, incoming)
    incoming.forEach {
      scheduleAlarm(context, it.dateKey, it.fireAtMs)
      if (previous.none { prior -> prior.reminderId == it.reminderId }) {
        recordTelemetry(context, it, "scheduled", now)
      }
    }
    return incoming.size
  }

  @Synchronized
  fun cancelDate(context: Context, day: String) {
    if (!datePattern.matches(day)) return
    cancelAlarm(context, day)
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(requestCode(day))
    writePlan(context, readPlan(context).filterNot { it.dateKey == day })
  }

  @Synchronized
  fun cancelAll(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    readPlan(context).forEach { cancelAlarm(context, it.dateKey); manager.cancel(requestCode(it.dateKey)) }
    readSent(context).forEach { manager.cancel(requestCode(it.dateKey)) }
    prefs(context).edit().putBoolean(ENABLED, false).putString(PLAN, "[]").commit()
  }

  @Synchronized
  fun restoreAfterBoot(context: Context) {
    if (!prefs(context).getBoolean(ENABLED, false)) return
    val now = System.currentTimeMillis()
    val future = readPlan(context).filter { it.fireAtMs > now }
    writePlan(context, future)
    future.forEach { scheduleAlarm(context, it.dateKey, it.fireAtMs) }
  }

  private fun quietHour(nowMs: Long): Boolean {
    val hour = Calendar.getInstance().apply { timeInMillis = nowMs }.get(Calendar.HOUR_OF_DAY)
    return hour < 10 || hour >= 21
  }

  private fun nextTen(nowMs: Long): Long {
    val calendar = Calendar.getInstance().apply {
      timeInMillis = nowMs
      set(Calendar.HOUR_OF_DAY, 10)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (calendar.timeInMillis <= nowMs) calendar.add(Calendar.DAY_OF_MONTH, 1)
    return calendar.timeInMillis
  }

  private fun post(context: Context, reminder: PlannedReminder) {
    val day = reminder.dateKey
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL, "Кроссворд дня", NotificationManager.IMPORTANCE_DEFAULT,
      ))
    }
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW).setPackage(context.packageName)
    open.action = Intent.ACTION_VIEW
    open.data = Uri.parse("slova://daily")
    open.putExtra(EXTRA_REMINDER, reminder.reminderId)
    open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tap = PendingIntent.getActivity(
      context, requestCode(day), open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val icon = context.resources.getIdentifier("slova_notification", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.ic_dialog_info
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL)
    } else {
      Notification.Builder(context)
    }
    val notification = builder
      .setSmallIcon(icon)
      .setContentTitle("Новый кроссворд готов")
      .setContentText("Продолжим коллекцию?")
      .setContentIntent(tap)
      .setAutoCancel(true)
      .build()
    manager.notify(requestCode(day), notification)
  }

  /** Called by the manifest receiver even when React Native is not running. */
  @Synchronized
  fun onAlarm(context: Context, day: String) {
    if (!prefs(context).getBoolean(ENABLED, false)) return
    val reminder = readPlan(context).find { it.dateKey == day } ?: return
    val now = System.currentTimeMillis()
    if (productDay(now) != day || !canNotify(context)) {
      cancelDate(context, day)
      return
    }
    if (quietHour(now)) {
      val deferred = nextTen(now)
      if (productDay(deferred) == day) scheduleAlarm(context, day, deferred)
      else cancelDate(context, day)
      return
    }
    val allHistory = readSent(context).filter { now - it.sentAtMs < HISTORY_MS }
    val history = allHistory.filter { now - it.sentAtMs < WEEK_MS }
    if (history.any { it.dateKey == day || it.localDateKey == deviceDay(now) } ||
      history.size >= MAX_PER_WEEK) {
      cancelDate(context, day)
      return
    }
    try {
      post(context, reminder)
      writeSent(context, allHistory + SentReminder(day, deviceDay(now), now, reminder.reminderId, reminder.fireAtMs))
      recordTelemetry(context, reminder, "delivered", now)
    } catch (_: SecurityException) {
      // Permission can be revoked between the check and notify().
    }
    // Retire the alarm while preserving the posted notification until tap or daily completion.
    cancelAlarm(context, day)
    writePlan(context, readPlan(context).filterNot { it.dateKey == day })
  }
}

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val day = intent.getStringExtra("dateKey") ?: return
    ReminderScheduler.onAlarm(context, day)
  }
}

class ReminderBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED -> ReminderScheduler.restoreAfterBoot(context)
      Intent.ACTION_MY_PACKAGE_REPLACED -> ReminderScheduler.restoreAfterBoot(context)
    }
  }
}
