@file:Suppress("UNUSED_PARAMETER", "FunctionName")
package expo.modules.kotlin.modules
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
open class Module {
  val appContext = AppContext()
  val emitted = mutableListOf<String>()
  fun sendEvent(name: String, body: Map<String, Any?>) { emitted += name }
  open fun definition(): ModuleDefinition = error("definition")
}
class AsyncDefinition { fun runOnQueue(queue: Queues) = this }
class ModuleDefinition(body: ModuleDefinition.() -> Unit) {
  val functions = mutableMapOf<String, () -> Any?>()
  val async = mutableMapOf<String, (Promise) -> Unit>()
  val strings = mutableMapOf<String, (String, Promise) -> Unit>()
  var destroy: () -> Unit = {}
  init { body() }
  fun Name(name: String) = Unit
  fun Events(vararg names: String) = Unit
  fun OnCreate(callback: () -> Unit) { callback() }
  fun <T> Function(name: String, callback: () -> T) { functions[name] = callback }
  fun AsyncFunction(name: String, callback: (Promise) -> Unit): AsyncDefinition { async[name] = callback; return AsyncDefinition() }
  fun AsyncFunction(name: String, callback: (String, Promise) -> Unit): AsyncDefinition { strings[name] = callback; return AsyncDefinition() }
  fun OnDestroy(callback: () -> Unit) { destroy = callback }
}
