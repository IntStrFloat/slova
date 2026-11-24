package expo.modules.appmetrica

/** Compiled only with -Pslova.crashQa=true; normal release has no JNI fixture/library. */
object CrashQaNativeFixture {
  init { System.loadLibrary("slova_crash_qa") }
  @JvmStatic external fun crash()
}
