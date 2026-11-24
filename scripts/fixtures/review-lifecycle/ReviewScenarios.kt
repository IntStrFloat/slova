import android.os.SystemClock
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.rustorereview.RuStoreReviewModule
import ru.rustore.sdk.review.RuStoreReviewManager
import ru.rustore.sdk.review.RuStoreReviewManagerFactory
import ru.rustore.sdk.review.model.ReviewInfo

private var checks = 0
private val failures = mutableListOf<String>()
private fun verify(condition: Boolean, code: String) { checks++; check(condition) { code } }
private class Result : Promise { val values = mutableListOf<Any?>(); override fun resolve(value: Any?) { values += value } }
private data class Fixture(val module: RuStoreReviewModule, val definition: ModuleDefinition, val manager: RuStoreReviewManager) {
  fun call(name: String) = Result().also { definition.async.getValue(name)(it) }
  fun prepare() = call("prepare")
  fun launch() = call("launch")
  fun busy() = definition.functions["hasActiveForm"]?.invoke() == true
  fun ready() { prepare(); manager.prepares.last().succeed(ReviewInfo("current")) }
}
private fun fixture(): Fixture {
  SystemClock.now = 1_000L
  val manager = RuStoreReviewManager()
  RuStoreReviewManagerFactory.manager = manager
  val module = RuStoreReviewModule()
  return Fixture(module, module.definition(), manager)
}
private fun scenario(name: String, body: () -> Unit) {
  try { body() } catch (error: Throwable) { failures += name + ":" + (error.message ?: error.javaClass.simpleName) }
}

fun main() {
  scenario("duplicate_callback") {
    val f = fixture()
    val prepare = f.prepare()
    f.manager.prepares[0].succeed(ReviewInfo("one"))
    f.manager.prepares[0].succeed(ReviewInfo("duplicate"))
    verify(prepare.values == listOf(true), "prepare_resolved_more_than_once")
    val launch = f.launch()
    f.manager.launches[0].succeed(Unit)
    f.manager.launches[0].succeed(Unit)
    verify(launch.values == listOf("completed"), "launch_resolved_more_than_once")
  }
  scenario("discard_stale_success") {
    val f = fixture()
    val old = f.prepare()
    f.definition.functions.getValue("discard")()
    val current = f.prepare()
    verify(f.manager.prepares.size == 2, "discard_prevented_new_preparation")
    f.manager.prepares[0].succeed(ReviewInfo("stale"))
    verify(old.values.isEmpty(), "stale_prepare_resolved")
    verify(f.prepare().values == listOf(false), "stale_prepare_unlocked_new_request")
    verify(f.manager.prepares.size == 2, "parallel_preparation_started")
    f.manager.prepares[1].succeed(ReviewInfo("current"))
    verify(current.values == listOf(true), "current_prepare_not_ready")
  }
  scenario("discard_stale_failure") {
    val f = fixture()
    val old = f.prepare()
    f.definition.functions.getValue("discard")()
    val current = f.prepare()
    verify(f.manager.prepares.size == 2, "discard_prevented_new_preparation")
    f.manager.prepares[0].fail()
    verify(old.values.isEmpty(), "stale_failure_resolved")
    verify(f.prepare().values == listOf(false), "old_failure_unlocked_new_request")
    f.manager.prepares[1].succeed(ReviewInfo("current"))
    verify(current.values == listOf(true), "current_failure_corrupted")
  }
  scenario("replaced_context") {
    val f = fixture()
    val old = f.prepare()
    f.module.appContext.reactContext = ReactContext()
    f.manager.prepares[0].succeed(ReviewInfo("old_context"))
    verify(old.values.isEmpty(), "old_context_resolved")
    val current = f.prepare()
    verify(f.manager.prepares.size == 2, "old_context_cached_info")
    f.manager.prepares[1].succeed(ReviewInfo("current"))
    verify(current.values == listOf(true), "new_context_unavailable")
  }
  scenario("inactive_context") {
    val f = fixture()
    val old = f.prepare()
    f.module.appContext.hasActiveReactInstance = false
    f.manager.prepares[0].succeed(ReviewInfo("inactive"))
    verify(old.values.isEmpty(), "inactive_prepare_resolved")
    verify(f.definition.functions.getValue("isAvailable")() == false, "inactive_capability_available")
    f.prepare()
    verify(f.manager.prepares.size == 1, "inactive_context_started_request")
  }
  scenario("destroy_prepare") {
    val f = fixture()
    val old = f.prepare()
    f.definition.destroy()
    f.manager.prepares[0].succeed(ReviewInfo("destroyed"))
    verify(old.values.isEmpty(), "destroyed_prepare_resolved")
  }
  scenario("destroy_open_form") {
    val old = fixture()
    old.ready()
    val result = old.launch()
    verify(old.busy(), "native_form_has_no_process_owner")
    old.definition.destroy()
    val current = fixture()
    verify(current.busy(), "destroy_cleared_native_owner")
    verify(current.prepare().values == listOf(false), "new_runtime_prepared_while_old_form_open")
    old.manager.launches[0].succeed(Unit)
    verify(result.values.isEmpty(), "destroyed_launch_resolved")
    verify(!current.busy(), "dead_context_terminal_did_not_release_own_native_owner")
    current.ready()
    val next = current.launch()
    old.manager.launches[0].succeed(Unit)
    verify(current.busy(), "old_duplicate_released_new_native_form")
    current.manager.launches[0].succeed(Unit)
    verify(next.values == listOf("completed"), "new_native_form_did_not_complete")
  }
  scenario("discard_open_form") {
    val f = fixture()
    f.ready()
    val result = f.launch()
    f.definition.functions.getValue("discard")()
    verify(f.busy(), "discard_cleared_open_form")
    f.manager.launches[0].succeed(Unit)
    verify(result.values == listOf("completed"), "prepare_discard_invalidated_live_form_callback")
  }
  scenario("inactive_launch_callback") {
    val f = fixture()
    f.ready()
    val result = f.launch()
    f.module.appContext.hasActiveReactInstance = false
    f.manager.launches[0].fail()
    verify(result.values.isEmpty(), "inactive_launch_resolved")
    verify(!f.busy(), "inactive_terminal_retained_native_owner")
  }
  scenario("stale_info_ttl") {
    val f = fixture()
    f.ready()
    SystemClock.now += 4 * 60 * 1_000L
    verify(f.launch().values == listOf("unavailable"), "expired_info_launched")
    verify(f.manager.launches.isEmpty(), "expired_info_reached_sdk")
  }
  scenario("detailed_prepare_error") {
    val f = fixture()
    verify(f.definition.async.containsKey("prepareResult"), "missing_detailed_prepare_capability")
    val failure = f.call("prepareResult")
    f.manager.prepares[0].fail()
    verify(failure.values == listOf("error"), "sdk_failure_not_typed_error")
    f.manager.throwPrepare = true
    verify(f.call("prepareResult").values == listOf("error"), "thrown_sdk_failure_not_error")
  }
  scenario("new_runtime_terminal_invalidation") {
    val old = fixture()
    old.ready()
    val result = old.launch()
    old.definition.destroy()
    val current = fixture()
    val previousCount = current.module.emitted.size
    val destroyedCount = old.module.emitted.size
    verify(current.busy(), "new_runtime_did_not_observe_open_form")
    old.manager.launches[0].succeed(Unit)
    verify(current.module.emitted.size == previousCount + 1, "new_runtime_received_no_terminal_invalidation")
    verify(current.module.emitted.last() == "onFormOwnerChanged", "wrong_owner_event")
    verify(old.module.emitted.size == destroyedCount, "destroyed_module_received_event")
    verify(result.values.isEmpty(), "dead_js_received_terminal_result")
    verify(current.definition.functions["getLifecycleVersion"]?.invoke() == 3, "missing_shared_update_owner_capability")
  }
  val messages = failures.joinToString(",") { "\"" + it.replace("\"", "'") + "\"" }
  println("{\"passed\":" + failures.isEmpty() + ",\"scenarios\":12,\"checks\":" + checks + ",\"failures\":[" + messages + "]}")
  if (failures.isNotEmpty()) throw IllegalStateException("review_lifecycle_scenarios_failed")
}
