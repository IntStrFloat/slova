package android.os

class Bundle {
  private val values = mutableMapOf<String, Any>()
  fun putBoolean(key: String, value: Boolean) { values[key] = value }
  fun putString(key: String, value: String) { values[key] = value }
  fun getBoolean(key: String, fallback: Boolean): Boolean = values[key] as? Boolean ?: fallback
  fun get(key: String): Any? = values[key]
}

object Build {
  var FINGERPRINT = "fixture/vendor/device:35/release"
  var MODEL = "Fixture physical phone"
  var MANUFACTURER = "FixtureVendor"
  var HARDWARE = "fixture_soc"
  var PRODUCT = "fixture_product"
  var BRAND = "fixture_brand"
  var DEVICE = "fixture_device"
}
