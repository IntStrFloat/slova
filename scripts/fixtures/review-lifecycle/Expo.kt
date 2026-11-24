package expo.modules.kotlin

import android.app.Activity
import android.content.Context
import com.facebook.react.bridge.ReactContext

interface Promise { fun resolve(value: Any?) }
class AppContext {
  var reactContext: Context? = ReactContext()
  var currentActivity: Activity? = Activity()
  var hasActiveReactInstance = true
}
