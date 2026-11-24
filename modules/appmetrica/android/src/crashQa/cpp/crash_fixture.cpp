#include <jni.h>
#include <cstdlib>

// Explicit isolated QA trigger only. Its matching unstripped ELF is the local symbolication fixture.
__attribute__((noinline)) void slovaControlledNativeCrash() {
  std::abort();
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_appmetrica_CrashQaNativeFixture_crash(JNIEnv*, jclass) {
  slovaControlledNativeCrash();
}
