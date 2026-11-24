package android.content
import android.content.pm.PackageManager
open class Context {
  open val applicationContext: Context get() = this
  var packageName = "com.intstrfloat.slova.unit"
  val packageManager = PackageManager()
}
