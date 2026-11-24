package expo.modules.appmetrica

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import io.appmetrica.analytics.plugins.PluginErrorDetails
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Explicit isolated QA only. It never activates or reports to the production SDK. */
object AppMetricaCrashQa {
  private const val PACKAGE = "com.intstrfloat.slova.sdkqa"
  private const val CONFIRM = "local-only-controlled-crash"
  private val lock = Any()
  private var registered = false
  private var observerOwner: Any? = null
  private var observer: ((String) -> Unit)? = null

  fun enabled(context: Context?): Boolean = context != null && BuildConfig.SLOVA_CRASH_QA &&
    context.packageName == PACKAGE && AppMetricaCrashOptions.read(context).qa && AppMetricaPrivacy.isKeyless()

  fun allowed(context: Context?): Boolean = enabled(context) && AppMetricaPrivacy.hasCurrentConsent(context)

  fun attach(context: Context, owner: Any, notifyJs: (String) -> Unit) {
    if (!enabled(context)) return
    synchronized(lock) {
      observerOwner = owner
      observer = notifyJs
      if (registered) return
      val application = context.applicationContext
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(target: Context, intent: Intent) { receive(application, intent) }
      }
      val filter = IntentFilter("$PACKAGE.CRASH_QA")
      if (Build.VERSION.SDK_INT >= 33) application.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      else application.registerReceiver(receiver, filter)
      registered = true
    }
  }

  fun detach(owner: Any) { synchronized(lock) {
    if (observerOwner === owner) { observerOwner = null; observer = null }
  } }

  private fun receive(context: Context, intent: Intent) {
    if (!allowed(context) ||
      intent.action != "$PACKAGE.CRASH_QA" || intent.getStringExtra("confirm") != CONFIRM) return
    val runId = intent.getStringExtra("run_id")?.takeIf { Regex("[a-z0-9_-]{1,48}").matches(it) } ?: return
    val kind = intent.getStringExtra("kind")?.takeIf { it in setOf("js", "jvm", "native", "anr") } ?: return
    // The durable claim precedes the trigger. Restart/replayed broadcasts cannot form a crash loop.
    synchronized(lock) {
      val preferences = context.getSharedPreferences("slova.crash.qa.v1", Context.MODE_PRIVATE)
      val used = preferences.getString("used_runs", "")!!.split(',').filter { it.isNotEmpty() }
      if (runId in used || used.size >= 16 || !preferences.edit().putString("used_runs", (used + runId).joinToString(",")).commit()) return
    }
    if (!write(context, JSONObject().put("kind", kind).put("run_id", runId).put("status", "trigger_claimed"))) return
    val handler = Handler(Looper.getMainLooper())
    when (kind) {
      "js" -> synchronized(lock) {
        val notify = observer
        if (notify != null) runCatching { notify(runId) }
          .onFailure { write(context, JSONObject().put("status", "js_hook_unavailable")) }
        else write(context, JSONObject().put("status", "js_hook_unavailable"))
      }
      "jvm" -> handler.postDelayed({ if (allowed(context)) throw IllegalStateException("slova_controlled_jvm_crash") }, 250L)
      "native" -> handler.postDelayed({
        if (!allowed(context)) return@postDelayed
        runCatching { Class.forName("expo.modules.appmetrica.CrashQaNativeFixture").getMethod("crash").invoke(null) }
          .onFailure { write(context, JSONObject().put("status", "native_fixture_unavailable")) }
      }, 250L)
      "anr" -> handler.postDelayed({ if (allowed(context)) Thread.sleep(6500L) }, 250L)
    }
  }

  /** Receives already validated real PluginErrorDetails; no raw exception is persisted. */
  fun record(context: Context, details: PluginErrorDetails): Boolean {
    if (!allowed(context)) return false
    val frames = JSONArray()
    details.stacktrace.forEach { frame -> frames.put(JSONObject().put("file", frame.fileName)
      .put("line", frame.line).put("column", frame.column)) }
    return write(context, JSONObject().put("status", "qa_local").put("sdk_activated", false)
      .put("platform", details.platform).put("error_kind", details.exceptionClass)
      .put("message", details.message).put("frames", frames).put("context", JSONObject(details.pluginEnvironment)))
  }

  private fun write(context: Context, value: JSONObject): Boolean {
    if (!allowed(context)) return false
    val bytes = value.toString().toByteArray(Charsets.UTF_8)
    if (bytes.size > 16_384) return false
    val file = AtomicFile(File(context.filesDir, "slova-crash-qa.json"))
    return runCatching {
      val output = file.startWrite()
      try { output.write(bytes); file.finishWrite(output); true }
      catch (_: Exception) { file.failWrite(output); false }
    }.getOrDefault(false)
  }
}
