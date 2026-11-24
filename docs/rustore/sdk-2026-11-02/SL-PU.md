# SL-PU — local Push reliability implementation

Status: **implemented_and_accepted_local_scope**, 4 November 2026. Source reviews, isolated Android instrumentation and signed R8 QA are accepted within the limits in the dated root addendum below. Live service delivery and production rollout remain unverified. Earlier acceptance/pending paragraphs record their original checkpoints.

## Scope and cleanup plan before source edits

1. Preserve the current local-reminder consent/planner/telemetry behavior with existing regression tests. Record the native Push wrapper/API and installed dependency baseline.
2. Verify Push 7.4.0 Android reference and actual AAR/POM signatures against the installed RN wrapper. Select a compatible native version for the new RuStore infrastructure, preserving Expo56/RN0.85/New Architecture and the existing patch-package compatibility fixes. No mass dependency upgrade or new NPM SDK.
3. Separate bounded notification parsing/identity, durable route side-effect dedup and readiness from transport callbacks. Unknown or unavailable content routes to Home. Queue until the router Stack is mounted and current gameplay/save/fullscreen work is safe. An analytics dedup entry is not a navigation lease.
4. Make token/topic synchronization generation-aware across consent, permission, profile and token changes. Keep the historical 500→1000 topic identity. Report OS permission and transport registration as different outcomes; log only bounded codes.
5. Introduce a shared remote/local notification admission and receipt ledger with rolling7 max3, quiet hours21:00–10:00, local-day collision and timezone handling. Native alarms must enforce the budget after JS death. Unmanaged OS-displayed pushes are receipts, never claimed as client-throttled; document the future sender admission/ack contract and exercise it with a local fake gateway.
6. Extend the existing route/gameplay telemetry with remote meaningful return within30minutes while preserving local events and keeping acquisition attribution separate. No raw message text, push token, URL query or SDK exception payload.
7. Run policy/state-machine and actual wiring tests for denied/unavailable/offline, token rotation, in-flight opt-out, duplicate/cold/warm/restart callbacks, navigation readiness, profile isolation, collisions/time boundaries and gameplay attribution. Independent reviews and local native build/AVD verification remain leader-owned.

## Boundaries

All development and tests are local. No server/console campaign change, production delivery, publication, Universal Push, MyTracker, Pay or GameCenter. Live delivery, server-wide enforcement, campaign inventory and D7/D30 effects are a future release checklist. SDK callback does not prove notification visibility or server acceptance.

The remote/local control remains the current voluntary local-reminder behavior. A future managed remote sender must reserve the same budget before sending and acknowledge actual acceptance/receipt; legacy console sends cannot be retroactively hidden by JS after the OS shows them. Free gameplay, saves, paid rights and notification refusal remain usable across errors and rollback.

## Evidence and acceptance

Source baseline: `52aa1b71622d4a1be7885c9b9ebe644e78f9f4cb` plus the existing shared working tree. This is an implementation diff, not proof that the baseline matches the published APK. The exact owned source digests, commands and outcomes are recorded in `output/rustore-sdk-2026-11-02/sl-pu/implementation.json`. Unrelated gameplay/help/reward changes from other writers were preserved. `_layout.tsx` and `analytics/schema.ts` are shared integration files; their final combined contents include other iterations.

### SDK selection and dependency boundary

Keep the installed GitFlic RN wrapper identity `react-native-rustore-push@6.9.1`; select native `ru.rustore.sdk:pushclient:7.4.0` in its existing persisted patch. The [Android Push 7.4.0 reference](https://www.rustore.ru/help/en/sdk/push-notifications/kotlin-java/7-4-0) and the [RuStore infrastructure migration notice](https://www.rustore.ru/developer/en/blog/rustore-updates-certificates-and-domains-what-developers-need-to-do) are the version/migration sources. This selection does not upgrade Expo, RN, Kotlin, AGP or the NPM dependency chain.

The actual official AAR/POM was inspected with `javap` (`sdk/api-7.4.0.txt`): `RemoteMessage.data` is a string map; SDK operations return the documented `Task`; availability returns `FeatureAvailabilityResult`. The bridge now maps those actual signatures and implements the current logger interface. Reflectively instantiated client parameters retain `@Keep`.

The selected POMs declare Push client/common/core `7.4.0`, RuStore core/coreui/metrics/reactive `8.0.0`, and existing transitive Tracer `1.1.7`. Tracer `1.1.7` is published on Maven Central; a 404 from the dedicated Tracer Nexus repository is not a missing SDK. The leader's local QA mirror records 25 vendor coordinates/49 original files, URLs and hashes in `../local-qa/offline-mirror-vendor-graph.json` under the output directory; mirror inventory is distinct from the final resolved runtime graph. A machine DNS failure required that mirror of exact original HTTPS artifacts, with certificate verification retained. No artifact substitution, POM rewrite or application repository fallback was introduced for that environment failure.

`patches/react-native-rustore-push+6.9.1.patch` persists all seven owned native files, including the pre-existing Kotlin compatibility fix and removal of the upstream unrestricted old repository injection. Final applicability, repeated application and byte equality against installed files are in `native-patch-verification-final.json`; no reinstall or package/lockfile edit was required.

### Current and proposed paths implemented

| Area | Existing path changed | New path or behavior |
| --- | --- | --- |
| Transport | `rustorePush.native.ts`, local SDK declarations, audience subscription | Actual-task FIFO and scoped consent/profile ownership in the native patch; bounded public deadline; persistent deletion retry |
| Payload and content | Existing safe route allowlist retained | `payload.ts`, `context.ts`: bounded fields, known campaigns, minimum binary/content version and fresh eligibility check |
| Navigation | Direct root callback routing removed | `delivery.ts`, `PushNavigationRoot.tsx`: durable one-pending route, readiness/safe-point dispatch and functional visible acknowledgement |
| Shared budget | Existing native ReminderScheduler/history/planner retained | `budget.ts`, `managedSender.ts`, native reserve/settle/receipt methods and a non-exported receipt receiver |
| Return measurement | Existing local reminder events retained | `analytics.ts`, updated `reminderTelemetry.ts`: visible destination before qualifying gameplay, channel separation, 30-minute window and consent binding |
| Prebuild | `withRuStorePush.js` | Cold/warm notification intent sanitization and durable opened-ID recovery before Expo/RN callbacks |
| Shared startup | Narrow `_layout.tsx` integration | Mount navigation root after Stack readiness; requested Tracer startup hook is the explicit cross-iteration dependency |

The route coordinator reuses the existing fullscreen snapshot and existing game/save, subscription and native rewarded guards. It creates no additional fullscreen singleton. Root callbacks do not navigate directly into an unfinished game or checkout.

### Transport, privacy and recovery contract

- Historical campaign/topic identity `levels-expanded-1000-v1` / `slova_levels_expanded_1000_v1` is unchanged. Registration follows the actual current profile, token and inclusive 500–1000 audience; it unsubscribes outside the range.
- OS permission `granted` is distinct from `registration_failed` / `registration_pending`. Permission denial never claims transport readiness. Persisted reminder refusal wins over a stale checked setting after an interrupted opt-out.
- SDK calls are serialized for their actual native task lifetime, including across React contexts. A 3-second public deadline releases the caller while the actual operation retains ownership. Opt-out deletion waits behind an in-flight subscription and retries durably if interrupted. A stale native callback cannot release the next owner's operation or send a result to a destroyed context. An SDK task that never completes can leave registration pending until callback/process restart; gameplay continues.
- New token callbacks carry no token to analytics. Raw SDK exceptions, receipt payloads, push tokens and message text are excluded from diagnostics. Only bounded result codes and hashed correlation IDs are emitted.
- Native receipt cache holds only routing fields, owner scope and provider message ID, capped at 32 records/30 days. A separate bounded opened-ID pointer survives warm taps before JS readiness. Profile/consent changes clear that routing scope. Ordinary app links keep their existing behavior.
- The actual installed Android version is read through the optional synchronous `RustorePush.getNativeVersionCode` capability, backed by `PackageManager` (`longVersionCode` on API28+, `versionCode` earlier). Missing/invalid capability is version0, so a positive minimum-version gate fails closed. Neither `app.json` nor an OTA-updated manifest is treated as proof of the installed binary; PWA never calls the Android getter.

### Navigation and attribution contract

Input fields are bounded before use: provider ID at most192 characters, at most32 data fields, string values at most512 characters, numeric minimums at most8 decimal digits, and an exact32-hex sender admission ID. Supported routes are the existing internal Home/Daily/Wheel/Events allowlist; unknown destinations fall back to Home. Campaign IDs are allowlisted; unknown values are not copied into analytics.

`notifications.routes.v2` stores one pending intent and at most128 consumed IDs for30 days. Initial/warm callbacks and process recreation share this durable side-effect dedup. A newer user tap supersedes the older pending tap. Persistence failure retains the native local opened event for retry; analytics acknowledgement cannot consume a functional intent. A router exception remains retryable.

At each safe dispatch the coordinator rechecks current version/content, activity unlock, daily completion and product date. A daily completed while waiting maps to Home with `content_completed`; a now-locked/unavailable target records its actual fallback reason. A matching, actually visible destination creates the functional acknowledgement. Analytics refusal never prevents that navigation.

Local and remote gameplay attribution both require that functional visibility, the original native open time and a qualifying action within an inclusive30-minute window. Old/current gameplay while a tap is queued is not a return. Both channels bind attribution to the analytics consent epoch; delayed taps from a prior epoch and legacy local attribution without a known binding cannot revive after re-consent. Acquisition/first-touch attribution is unchanged.

### Shared admission and future sender contract

The existing local behavior remains the control. Native admission and local alarms share sent receipts plus uncertain reservations: at most3 per rolling7 days, one device-local date, quiet hours21:00–10:00, and timezone/clock checks. A remote receipt cancels a colliding local plan even with JS stopped. A 2-minute send expiry does not free an uncertain slot: pending budget is retained for a bounded week; accepted records remain for30 days. A future-created pending reservation survives clock rollback and blocks reuse/new remote admission and local alarm delivery until time recovers.

`PUSH.managedRemoteEnabled` is **false**. `sendAdmittedNotification` has a real native admission port and an injected gateway; only local fake-gateway tests exercise sending. No backend route, console campaign or deployed sender was added. To enable it later, a reviewed sender must enforce idempotency by message/admission ID, reject expired admissions, keep the same daily/weekly reservation contract, and settle accepted/unknown/rejected outcomes. Unknown acceptance consumes a slot conservatively. Server acceptance, SDK receipt, OS visibility and user open remain distinct observations.

Legacy console pushes that the SDK/OS already displays cannot be hidden or frequency-throttled retrospectively by JS. The new receipt ledger limits subsequent local/managed notifications; it does not prove a global cap on unmanaged sends. Global campaign enforcement requires a future sender deployment and campaign inventory.

### Event contract

All events use the existing consent-gated analytics/outbox and schema; no parallel SDK analytics pipeline or second install event was added. Data retention and upload policy follow the analytics iteration. No raw payload is an event field.

| Event | Owner / moment | Repetition and interpretation |
| --- | --- | --- |
| `notification_permission_result` | Provider, actual OS permission response | One result per request; grant does not mean token ready |
| `push_registration_result` | Provider, bounded operation outcome | Ready/pending/retryable/unavailable with an allowlisted reason; no token |
| Existing `push_lifecycle` | SDK received callback / durable opened intent | Dedup by hashed message+stage; receipt does not prove visibility |
| Existing `notification_route_result` | Coordinator, observed destination | Actual destination and fallback reason; separate from functional acknowledgement |
| Existing local `reminder_*` | Native journal drain / qualifying gameplay | Existing native IDs/dedup preserved; delayed pre-consent events are retired without attribution |
| `notification_meaningful_return` | Remote visible target followed by gameplay | At most once per hashed message within30 minutes; channel=remote |
| `notification_admission_result` | Dormant managed sender adapter | Accepted/rejected/unknown and settlement state; not a delivery claim |

### Executed checks and review fixes

The final author check is **17 suites/156 tests PASS**, TypeScript exit0 and targeted ESLint exit0. Exact source hashes and commands are recorded in `implementation.json`, `tests-final.log`, `typecheck-final.log`, `lint-final.log` and `native-patch-verification-final.json`. Intermediate135/154-test results are checkpoints; they are not substituted for final source validation. The independent final scenario pass ran46 Jest cases,20 notification VM scenarios and15 actual-version VM scenarios with no stale probe inputs; it approves source/local scenarios and leaves binary/service acceptance to the leader.

| Scenario | Actual evidence |
| --- | --- |
| Initial/warm duplicate, recreation, delayed callbacks, token refresh/profile/opt-out, OS grant vs registration failure, old binary | Focused provider and native-bridge wiring Jest tests |
| Late subscription after public timeout and opt-out | Deterministic regression failed before the FIFO correction; passed after; actual native queue fixture included |
| Content completed/locked/version changed while waiting; fullscreen lease held then released | Actual delivery/root wiring tests; independent scenario VM probes |
| Local queued tap attributes current game too early | Before-fix regression failure; visible-ack tests pass after correction |
| First functional route write fails while analytics journal write succeeds | Native opened event remains until a durable route retry; deterministic regression and independent probe |
| Warm intent arrives before JS | Plugin tests plus native opened-ID recovery fixture; `setIntent` precedes `super.onNewIntent` |
| Clock rollback releases uncertain reservation | Verbatim native reservation/alarm methods compiled on host: before3 failures/2 passes; after5 passes, plus actual Android fixture |
| Prior consent epoch revives local/remote attribution | Local regression before3 failures, remote regression before2 failures; after routing remains usable and prior attribution is rejected |
| Config version differs from native binary; absent/invalid bridge; PWA | Before15 failures; after15 passes against actual context+payload wiring |
| Isolated Android framework tests | Leader-owned logs retain original asynchronous cancellation/Activity fixture failures and their corrections; final getter/quiet-date fixture acceptance requires the final test APK |

The native test runner now waits at most2 seconds for actual OS notification post/cancel visibility, constructs its Activity fixture on the main thread, and reports a controlled test stack on failure. Its quiet-hours case requires zero delivery and checks whether next local10 remains within the same product date; a cross-date stale daily must be retired. These are test fixture corrections, not weakened notification rules.

The leader's earlier combined R8/SDK7.4 build and isolated Push5/5 run are **prior checkpoints**: later consent guards and the native version getter are not retroactively attributed to that binary. Final APK/AAB source mapping, signing, release R8 and device results belong to the leader's final acceptance record. This implementation agent ran no Gradle build, prebuild, emulator action, SDK send, server/console mutation or publication.

### Default, rollout and rollback

An empty build-time Push project ID selects the harmless provider; new managed sending is locally disabled. Existing explicit reminder opt-in and refusal remain authoritative. The runtime setting disables registration/routes and requests token cleanup without deleting progress or reminder history. `PUSH.enabled` is the local build switch; no remotely fetched value is the only safety control.

Any future release starts with instrumentation/internal validation, then a separately approved small cohort and unchanged local-reminder holdout. Campaign ID/content minimums must match the binary/content actually available to that cohort. Rollback stops new managed sends and audience registration as needed, retains refusal/consumed IDs/consent boundaries/history, and keeps pending token cleanup. A native API/version change requires a new compatible binary; disabling a campaign needs no SDK removal.

### Remaining acceptance and limits

- Final independent review and combined binary/device acceptance must reference the final source hashes. Known earlier fixture failures remain visible in the evidence rather than being called passes.
- No real configured Push project/token/service transport, production signed-store installation or genuine remote delivery was exercised by this agent. Missing store, network/server acceptance, server campaigns, live token rotation and production notification presentation still need the separately authorized service/device validation.
- No claim is made about console campaign inventory, receipt completeness, complaints/opt-out impact, incremental return, D7/D30 or rollout metrics. A holdout and baseline export remain required before product conclusions.
- No backend gateway was deployed, no secrets were added to Markdown/logs, and no Pay, GameCenter, Universal Push or MyTracker integration was introduced.

## Root acceptance — 4 November 2026

Root accepts the local implementation after [final code review](../../../output/rustore-sdk-2026-11-02/sl-pu/final-code-review.md) and [final scenario review](../../../output/rustore-sdk-2026-11-02/sl-pu/final-scenario-review.md). The author's 17 suites / 156 tests are source evidence. Separately, actual Android instrumentation passed **11 reminder tests and 6 Push tests** in isolated test packages on the registered Slova AVD, including the native version getter, durable routing, owner/refusal clearing and actual transport FIFO. [native-instrumentation-verification.json](../../../output/rustore-sdk-2026-11-02/sl-pu/native-instrumentation-verification.json) preserves the exact test APK hashes and unchanged main-profile proof. Earlier Android fixture failures remain recorded.

The combined native code is present in the signed, minified `.sdkqa` builds. QA34 reports the actual native installed version **34**, while the ordinary main package remains versionCode33. The final cold-render candidate and its matching 199 JS / 30 native inputs are identified in [LOCAL-RESULT.md](LOCAL-RESULT.md); the prior build receipts keep their own source/version scope. Instrumentation did not initialize the Push service or send a remote notification. Registration, actual remote token/delivery, unmanaged campaign inventory and global sender enforcement remain the future release checklist above. `managedRemoteEnabled` stays false and no sender/server campaign was deployed.
