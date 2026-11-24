# Android AppMetrica consent boundary

The existing Expo bridge uses AppMetrica Android SDK 8.6.0. It does not add a
second reporter or manually report revenue already collected by the SDK.

`AppMetricaPrivacy.bootstrap` runs before React Native. Missing native consent
is disabled until JS migrates its existing preference. An explicit persisted
native refusal takes precedence over a missing/failed JS preference write.
The preference is committed synchronously before enabling transmission.

Debug, preview-package, emulator and explicit QA builds do not activate the
production SDK or accept custom events. Prebuild maps
`EXPO_PUBLIC_YANDEX_TEST_ADS=1` or `APPMETRICA_TEST_MODE=1` to
`BuildConfig.APPMETRICA_QA_BUILD`. Existing physical devices that have no QA
marker must use the production consent policy; emulator detection cannot
identify every spoofed device.

While opted out, the bridge refuses custom events and identifier requests,
and calls the documented global `setDataSendingEnabled(false)`. Foreground
sessions are managed with consent-gated Activity `resumeSession`/`pauseSession`
calls; refusal pauses the tracked Activity and keepalive. Cold opted-out starts
do not activate AppMetrica. The JS outbox must also discard unsent custom events
and never enqueue actions performed while refused.

**Strict limit:** the public SDK API controls transmission, not deletion of
internal SDK databases or cancellation of requests already in flight. It does
not expose a stop-all-collection or purge API. Automatic SDK modules, including
ad/crash reporting, may retain internal records during a warm opt-out and may
send them after re-enabling. The implementation does not promise otherwise,
delete undocumented SDK files, or use internal reflection. Native end-to-end
network verification remains distinct from JS adapter/config-plugin tests.

`reportEvent` returns an explicit local acceptance boolean, not a server receipt.
`getIdentifiers` returns strings: `deviceId` is `DeviceIdHash` (the Logs API
`appmetrica_device_id`), and `installationId` is SDK UUID. Invalid/unavailable
identifiers stay absent. A five-second timeout and a second consent check prevent
a delayed callback exposing IDs after refusal.

## Local crash coverage

The existing reporter now has an optional structured JS error capability. Enable
the build-time manifest setting `slova.crash.extended_enabled` only after its own
acceptance; it defaults to false and configures JS context, ANR and the real optional
`analytics-ndk-crashes:3.1.0` handler. The normal JVM crash handler remains in place.
Its public `ICrashTransformer` rebuilds the Throwable model without original
messages, causes or suppressed payloads and rechecks the native consent gate.
Separate thread/ANR/NDK/OS data are outside that transformer's redaction scope.

Structured JS fatal context is an SDK plugin error. The original RN fatal path
still produces the automatic JVM crash, so no heuristic drops an unmatched crash.
The JS hook is capability-safe for older binaries and never calls preventDefault.
No additional install identity, analytics outbox or Tracer SDK is introduced.

Controlled QA additionally requires exact package `com.intstrfloat.slova.sdkqa`,
`slova.crash.qa_enabled=true`, `-Pslova.crashQa=true`, an empty native SDK key and
the durable native opt-in. It writes bounded sanitized local evidence and never
activates the production SDK. Startup alone cannot trigger a crash. Normal builds
do not contain the native fixture or its JNI library. See
[TR](../../docs/rustore/sdk-2026-11-02/TR.md) for explicit commands, one-shot limits,
root-owned build/device acceptance and the remaining service-delivery boundary.

Official references:

- [Android operations: consent and startup identifiers](https://appmetrica.yandex.ru/docs/ru/sdk/android/analytics/android-operations).
- [SDK 8.6.0 public API](https://github.com/appmetrica/appmetrica-sdk-android/blob/v8.6.0/analytics/src/main/java/io/appmetrica/analytics/AppMetrica.java).
- [SDK 8.6.0 report scheduling gate](https://github.com/appmetrica/appmetrica-sdk-android/blob/v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/ReportingTaskProcessor.java).
- [SDK 8.6.0 global reporter restriction](https://github.com/appmetrica/appmetrica-sdk-android/blob/v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/DataSendingRestrictionControllerImpl.java).
