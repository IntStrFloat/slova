import android.os.SystemClock
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.rustoreupdates.RuStoreUpdatesModule
import expo.modules.rustorereview.RuStoreReviewModule
import ru.rustore.sdk.appupdate.manager.factory.RuStoreAppUpdateManagerFactory
import ru.rustore.sdk.appupdate.model.AppUpdateInfo
import ru.rustore.sdk.appupdate.model.InstallState
import ru.rustore.sdk.appupdate.errors.RuStoreInstallException

private var checks = 0
private val failures = mutableListOf<String>()
private fun verify(value: Boolean, code: String) { checks++; check(value) { code } }
private class Result : Promise { val values = mutableListOf<Any?>(); override fun resolve(value: Any?) { values += value } }
private data class Fixture(val module: RuStoreUpdatesModule, val definition: ModuleDefinition) {
  val manager get() = RuStoreAppUpdateManagerFactory.manager
  fun query() = Result().also { definition.async.getValue("checkAvailability")(it) }
  fun offer(token: String) = Result().also { definition.strings.getValue("startFlexible")(token, it) }
  fun install(version: String) = Result().also { definition.strings.getValue("completeFlexible")(version, it) }
  fun prepared(status: Int = 0): String {
    val result = query(); manager.queries.last().succeed(AppUpdateInfo(installStatus = status))
    return (result.values.last() as Map<*, *>)["infoToken"] as String
  }
  fun close() = definition.destroy()
}
private fun fixture(allowed: Boolean = true): Fixture {
  SystemClock.now = 1_000L
  val module = RuStoreUpdatesModule()
  module.appContext.reactContext!!.packageManager.application.metaData!!.allowed = allowed
  return Fixture(module, module.definition())
}
private fun outcome(result: Result) = (result.values.lastOrNull() as? Map<*, *>)?.get("result")
private fun scenario(name: String, body: () -> Unit) {
  try { body() } catch (error: Throwable) { failures += name + ":" + (error.message ?: error.javaClass.simpleName) }
}
fun main() {
  scenario("disabled_is_pure") {
    val f = fixture(false)
    verify(f.definition.functions.getValue("getNativeVersionCode")() == "34", "actual_version_missing")
    verify((f.definition.functions.getValue("getCapabilities")() as Map<*, *>)["guardianVersion"] == 3, "guardian_missing")
    verify(outcome(f.query()) == "unavailable", "disabled_query_allowed")
    verify(RuStoreAppUpdateManagerFactory.creates == 0, "capability_created_metrics_factory")
    f.module.appContext.reactContext!!.packageName += ".sdkqa"
    f.module.appContext.reactContext!!.packageManager.application.metaData!!.allowed = true
    verify(outcome(f.query()) == "unavailable", "qa_overrode_native_gate")
    verify(RuStoreAppUpdateManagerFactory.creates == 0, "qa_created_metrics_factory"); f.close()
  }
  scenario("none_and_unknown_are_distinct") {
    val f = fixture(); val none = f.query(); f.manager.queries.last().succeed(AppUpdateInfo(availableVersionCode = 0, updateAvailability = 1))
    verify(outcome(none) == "none", "none_became_invalid_version")
    val unknown = f.query(); f.manager.queries.last().succeed(AppUpdateInfo(updateAvailability = 0))
    verify(outcome(unknown) == "unknown", "unknown_became_none"); f.close()
  }
  scenario("one_use_and_duplicate_terminal") {
    val f = fixture(); val token = f.prepared(); val first = f.offer(token)
    verify(RuStoreReviewModule.hasProcessForm(), "no_process_owner")
    verify(outcome(f.offer(token)) == "unavailable", "used_info_relaunched")
    f.manager.offers.last().succeed(0); f.manager.offers.last().succeed(-1)
    verify(outcome(first) == "cancelled" && first.values.size == 1, "duplicate_or_cancel_mapping")
    verify(!RuStoreReviewModule.hasProcessForm(), "terminal_owner_retained"); f.close()
  }
  scenario("ttl_version_and_activity") {
    val f = fixture(); val token = f.prepared(); SystemClock.now += 120_000L
    verify(outcome(f.offer(token)) == "unavailable", "expired_info_used")
    val changed = f.prepared(); f.module.appContext.reactContext!!.packageManager.info.longVersionCode = 35
    verify(outcome(f.offer(changed)) == "unavailable", "native_version_change_used")
    f.module.appContext.reactContext!!.packageManager.info.longVersionCode = 34
    val focused = f.prepared(); f.module.appContext.currentActivity!!.focused = false
    verify(outcome(f.offer(focused)) == "unavailable", "unfocused_activity_launched"); f.close()
  }
  scenario("destroy_open_update_union_and_stale_callback") {
    val f = fixture(); val old = f.offer(f.prepared()); val callback = f.manager.offers.last(); f.close()
    val review = RuStoreReviewModule(); val rd = review.definition()
    verify(rd.functions.getValue("hasActiveForm")() == true, "new_review_did_not_see_old_update")
    val unavailable = Result().also { rd.async.getValue("prepareResult")(it) }
    verify(unavailable.values == listOf("unavailable"), "review_prepared_over_update")
    callback.succeed(0)
    verify(old.values.isEmpty(), "dead_js_resolved")
    verify(rd.functions.getValue("hasActiveForm")() == false, "dead_callback_did_not_cleanup_owner")
    verify(review.emitted.count { it == "onFormOwnerChanged" } == 1, "union_release_not_notified")
    val next = fixture(); val current = next.offer(next.prepared()); callback.succeed(-1)
    verify(RuStoreReviewModule.hasProcessForm(), "old_callback_released_new_owner")
    next.manager.offers.last().succeed(-1); verify(outcome(current) == "download_accepted", "new_owner_corrupted")
    next.close(); rd.destroy()
  }
  scenario("complete_unit_is_unconfirmed") {
    val f = fixture(); f.prepared(1); val complete = f.install("35")
    f.module.appContext.currentActivity!!.focused = false
    verify(RuStoreReviewModule.hasProcessForm(), "blur_released_form")
    f.manager.installs.last().succeed(Unit)
    verify(outcome(complete) == "flow_ended_unconfirmed", "unit_claimed_install")
    verify(f.definition.functions.getValue("getNativeVersionCode")() == "34", "sdk_result_changed_native_version"); f.close()
  }
  scenario("destroyed_or_replaced_preparation") {
    val f = fixture(); val old = f.query(); val task = f.manager.queries.last()
    f.module.appContext.reactContext = ReactContext().also { it.packageManager.application.metaData!!.allowed = true }; task.succeed(AppUpdateInfo())
    verify(old.values.isEmpty(), "replaced_context_resolved")
    val current = f.query(); val currentTask = f.manager.queries.last(); task.succeed(AppUpdateInfo())
    verify(current.values.isEmpty(), "old_callback_resolved_current_query")
    currentTask.fail(RuStoreInstallException(4006)); verify(outcome(current) == "retryable_error", "storage_not_retryable")
    verify(!current.values.toString().contains("@"), "raw_error_leak"); f.close()
  }
  scenario("foreign_package_and_listener_lifetime") {
    val f = fixture(); f.prepared(); val before = f.module.emitted.size
    f.manager.listener!!.onStateUpdated(InstallState("foreign.package", 1))
    verify(f.module.emitted.size == before, "foreign_download_emitted")
    f.manager.listener!!.onStateUpdated(InstallState("com.intstrfloat.slova.unit", 1))
    verify(f.module.emitted.size == before + 1, "current_download_lost")
    verify(RuStoreAppUpdateManagerFactory.creates == 1, "manager_recreated_for_js_lifecycle")
    f.close(); verify(f.manager.listener == null, "listener_not_detached")
  }
  scenario("bounded_error_codes") {
    val f = fixture()
    for (code in listOf(4002, 4006, 4009, 4014)) {
      val result = f.query(); f.manager.queries.last().fail(RuStoreInstallException(code))
      verify(outcome(result) == "retryable_error", "retryable_code_$code")
    }
    for (code in listOf(4003, 4004, 4005, 4007, 4008, 4011, 4012, 4015)) {
      val result = f.query(); f.manager.queries.last().fail(RuStoreInstallException(code))
      verify(outcome(result) == "terminal_error", "terminal_code_$code")
    }
    for (code in listOf(4010, 4016)) {
      val result = f.query(); f.manager.queries.last().fail(RuStoreInstallException(code))
      verify(outcome(result) == "cancelled", "cancel_code_$code")
    }
    val missing = f.query(); f.manager.queries.last().fail(ru.rustore.sdk.core.exception.RuStoreNotInstalledException())
    verify(outcome(missing) == "unavailable", "missing_store_not_unavailable")
    f.close()
  }
  println("{\"passed\":${failures.isEmpty()},\"checks\":$checks,\"failures\":[${failures.joinToString(",") { "\"$it\"" }}]}")
  check(failures.isEmpty()) { "updates_lifecycle_scenarios_failed" }
}
