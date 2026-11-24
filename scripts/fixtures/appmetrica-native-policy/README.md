# Native analytics privacy regression

Run from the repository root:

```powershell
node scripts/verify-native-analytics-policy.cjs
node scripts/verify-native-analytics-policy.cjs --demonstrate-red
```

The verifier compiles the entire production `AppMetricaPrivacy.kt` directly, using the already cached Kotlin 2.3.0 compiler and Android Studio JBR. These fixtures replace only Android and AppMetrica APIs. They contain no replacement privacy policy, Android runtime, SDK network implementation, production key or external request. Missing cached compiler prerequisites cause a failure instead of downloading or skipping tests.

Each scenario runs in a fresh JVM. Public bootstrap, consent changes, reporting eligibility and registered Activity callbacks are exercised. The fake preference store preserves commit semantics; the fake SDK records activation, sending and session calls. The warm keyless scenario first establishes a real tracked session through the compiled production policy, then exercises the missing-key transition. Other cases cover absent/refused consent, valid opt-in, repeated bootstrap/resume, QA/debug/preview/emulator exclusions, preference write failure, SDK-disable failure and absent context.

The optional red demonstration compiles a temporary full-source copy with only the known missing-key branch correction inverted. The source hash matches the reviewed pre-fix branch. Exactly the cold previously-enabled sender and warm tracked-session cases fail there; the control cases pass. The production source remains untouched and its hash is rechecked after execution.

Results and compiler logs are written under `output/rustore-sdk-2026-11-02/g2/native-policy*`. Generated temporary source/JAR files are removed individually from a verified task-owned directory. This host test checks policy calls and state behavior against the declared API fakes. Actual Android/SDK ABI, release build, device behavior and server delivery require their own evidence. The SDK-disable-failure case intentionally proves the wrapper closes and pause is attempted; it does not claim cancellation when the SDK throws.
