# Help experiment fleet stop

Status: local adapter implemented; production console configuration, ingestion, and a real fleet stop proof are **unverified**. The committed trial remains disabled with no production eligibility epoch or allocation version. Development fixtures do not authorize enrollment.

## Existing SDK and fixed key

Android uses the installed RuStore Remote Config SDK `10.5.1`, created once by `RemoteConfigRuntime.bootstrap` in `Application.onCreate`. The new optional native method `fetchHelpExperimentControl` reads the string parameter **`slova_help_experiment_stop_v1`** from that client's successful `getRemoteConfig()` result. Its `actual_sdk_fetch` source marks this code path; it is not a console-delivery proof. An older binary without this method returns `unavailable` in JS.

The existing client's `UpdateBehaviour.Actual` performs a server request for configuration rather than returning an allow from a persistent cache. See [RuStore's Kotlin 10.5.1 documentation](https://www.rustore.ru/help/developers/tools/engagement-tools/remote-config/sdk/kotlin/10-5-1). Native callbacks reuse the shared consent generation and active React-instance checks, with separate foreground-generation fences for the help capability. Android lifecycle hooks follow the [Expo module API](https://docs.expo.dev/modules/module-api/) and the installed Expo Modules source for [SDK 56 / RN 0.85](https://docs.expo.dev/versions/v56.0.0/).

The adapter does not initialize an SDK or call `setRemoteConfigAllowed`. The existing remote-policy runtime owns that shared permission. An already configured, consented client must exist from the cold launch; a missing client stays unavailable until the required restart. `fetchConfig`, the numeric parser/coordinator, and the existing `slova_policy_v1` parameter retain their contract.

## String parameter schema v1

All six properties are mandatory; additional or duplicate properties, including escaped duplicate names, are rejected. The UTF-8 string limit is 16 KiB. The payload contains only experiment control fields.

| Property | Required value |
| --- | --- |
| `schemaVersion` | Integer `1`; semantics below are fixed for v1. |
| `experimentId` | Exactly `slova_wheel_help_clarity_20261104`. |
| `eligibilityEpoch` | Exact reviewed trial epoch; safe identifier of 1–192 ASCII characters matching `[a-z0-9][a-z0-9_.:-]*` case-insensitively. |
| `allocationVersion` | Exact reviewed trial allocation version; positive safe integer. |
| `revision` | Positive safe integer; increase for each changed document in the same scope. |
| `disabledVariants` | Array of distinct `control` and/or `treatment`; at most two entries. |

An empty `disabledVariants` can grant only a fresh, temporary transport lease. Other readiness, identity, assignment, and request gates still apply. Any listed arm stops **all new enrollment**; existing presentation is clamped for listed arms while the original assignment and ITT remain intact. Received disabled arms form a permanent union for that scope. A later empty array, a higher revision, or deleting the parameter cannot resume those stopped arms. A changed document at the same revision or a lower revision is rejected. A new phase requires a separately reviewed epoch/allocation scope.

This complete example is **synthetic test data only**, not production configuration:

```json
{
  "schemaVersion": 1,
  "experimentId": "slova_wheel_help_clarity_20261104",
  "eligibilityEpoch": "fixture-trial-v1",
  "allocationVersion": 1,
  "revision": 2,
  "disabledVariants": ["control", "treatment"]
}
```

## Runtime reaction and persistence

`createHelpExperimentStopAdapter` receives `active` (trial enabled), `foreground`, `consentGranted`, optional `consentGeneration`, and the declared scope through `updateContext`. With an inactive or invalid context it neither imports the bridge nor fetches the new key. Baseline/control measurement does not depend on this trial adapter.

While active, it fetches immediately and then polls **30 seconds after each completed attempt**, with a **4 second timeout** and a **60 second maximum allow lease** from successful completion. Lease age and request age use monotonic elapsed milliseconds from React Native's [`performance.now()`](https://reactnative.dev/docs/0.85/global-performance), independently of wall-clock changes and JS timer delivery. Timers wake the checks; every `getSnapshot()` enforces elapsed lease expiry, and a response at or after 4,000 ms elapsed request age is rejected even before a delayed timeout callback runs. `leaseExpiresAt` is an observable wall timestamp, not the authority for extending a lease.

Tests may inject the optional `monotonicNow(): number` port alongside the existing wall `now()` port. A missing, throwing, non-finite, negative, unsafe, or regressing elapsed clock denies; there is no wall-only fallback. A wall timestamp must remain a nonnegative safe integer and cannot move backwards from the previous observation in the active context. A forward wall jump reaching the displayed expiry also denies conservatively. Clock anomalies revoke the lease and logical request generation; after a new valid clock sample, a new fetch may recover. They do not write a permanent arm stop.

A missing/invalid/wrong-scope parameter, missing capability, failed SDK task, timeout, clock anomaly, or expiry gives `connected=false` and denies enrollment and experimental presentation. No allow is written to storage or restored after restart/background. After an ordinary lifecycle interruption, a fresh valid response may restore presentation for the existing assignment.

Background, consent/scope/generation changes, `stop()`, and `dispose()` revoke the lease, clear owned timers, and fence old promises. They do not create a permanent stop. A queued fetch whose context was withdrawn before invocation is skipped. Native SDK tasks already in progress cannot be cancelled; their late results cannot authorize or persist a stop for the new generation. `stop()` permits a later explicit `updateContext` restart; `dispose()` is terminal.

Only a valid scoped nonempty `disabledVariants` produces `onStop({scope, revision, disabledVariants})`. The owning help runtime supplies `readStopped(scope)` and persists an identifier-free arm union plus maximum revision in its separate stop ledger. `onStop` must return `true` only after durable readback. A failed write/readback leaves the adapter disconnected and retains the memory revoke for retry; it cannot claim persistence. Corrupt or unreadable stop state denies. Consent withdrawal and normal cleanup do not erase an explicit stop.

## Later production verification

When the independently reviewed trial is ready, its release owner must use the existing Remote Config application and the fixed string key, with the exact approved scope. Every eligible experimental audience must receive the stop value; a narrower console rule is not proof of fleet coverage. To stop an arm, publish a higher revision containing that arm; to stop the phase, include both arms. Save identifier-free evidence that the intended build/environment fetched this key, the stop reached durable readback, new eligible requests were denied, and existing affected presentation was clamped without reassignment. Validate ingestion separately.

No console change or live stop verification was performed for this implementation. A successful mocked transport test demonstrates local code behavior only. Polling/leases require the app to execute: a stopped or suspended process cannot observe a new remote value, and an offline device denies once a fetch fails or the lease expires. The cadence is a technical bound, not an always-online delivery guarantee.

Development verification: `output/product-improvements-2026-11-04/p7/stop-adapter-repair-r1-development-verification.json`; the earlier report and independent R1 probe evidence are preserved. The root integration gate owns Android native compilation and complete runtime verification.
