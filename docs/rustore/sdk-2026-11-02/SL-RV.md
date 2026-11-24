# SL-RV — Review instrumentation and C03 ownership

Status: **implemented_and_accepted_local_scope**, 4 November 2026. Independent source/scenario reviews and actual signed R8 native failure/discard checks are accepted in the dated root addendum below. Actual store-form submission and publication remain unverified. Earlier pending paragraphs retain their original checkpoint scope.

## Bounded cleanup plan before code

The existing Review SDK remains `ru.rustore.sdk:review:10.5.1`. No dependency, threshold experiment, sentiment gate or incentive is added. Preserve minimum10 completions/level10, first postcard campaign completion,30-day cooldown **and**20 additional completions, maximum3 durable attempts, same-level exclusion and permanent `handled`. Preserve current result semantics: every actual attempt, including preparation failure, replaces the interstitial; callback completion does not prove a posted review.

1. Lock current behavior first. Baseline on the current shared sources:9 suites /217 tests PASS (`output/rustore-sdk-2026-11-02/sl-rv/implementation-baseline-tests.log`), covering Review policy/flow/bridge, the existing opaque token, native ads/lifecycle, subscription/autosync and reward recovery. Add focused boundary regressions before each change.
2. Remove hidden policy duplication by deriving the existing boolean eligibility from one reason-producing decision. Keep persistence key/version and atomic reservation. A storage failure grants no show permission. Add allowlisted eligibility/prepare/launch/result observations to the existing analytics pipeline; map the existing `review_flow_finished` once rather than creating duplicate completion events. Diagnostics are build-configurable and never control paid rights or rewards.
3. Repair the existing native request boundary: capture exact request identity, generation and live React context for preparation **and** launch; stale callbacks cannot mutate a newer request or resolve a dead/replaced context. Native UI ownership survives module destruction until the actual terminal callback. Discard invalidates prepared information, not an open form.
4. Reuse `src/core/fullscreen.ts` at actual provider launch boundaries. Keep existing ad/reward state machines and native reward journal. The rewarded watchdog transfers the same lease to its exact orphan; only exact terminal callbacks or existing positive native-inactive confirmation release it. Background and arbitrary time do not release UI ownership. Feed existing readiness subscriptions from shared ownership.
5. Add the smallest checkout boundary needed: reserve immediately before the existing `Linking.openURL`, install Android lifecycle/focus observation before launching, and retain the lease until an observed departure and a genuine active/focused return. Launch acceptance, a deep link, payment status or a timer are not browser return. Release on launch failure or actual UI return; an indefinite pending invoice does not own UI. Existing backend authority, saved checkout binding and autosync remain unchanged.
6. Read current game/ads/subscription files immediately before narrow patches because another writer is active. Reuse the current committed-victory/reward-recovery guards for the automatic Review safe point. Do not rewrite help flow, rewards, wallet, navigation, profile or payment logic. Notifications owns its shared-owner consumer and already reports that wiring/test green.

## Scope and rollout

Owned: `src/features/review/**`, `modules/rustore-review/**`, narrow Review registrations in `src/features/analytics/schema.ts`, exact launch-boundary additions in `yandexAds.native.ts` / `subscription.ts`, focused tests and one old completion-emitter removal in `game.tsx`. Shared owner already exists and is reused. Root owns app startup/config/build/device; Push and native AppMetrica are separate lanes.

`local_implementation`: pending. `future_release_checklist`: real signed store/phone form acceptance, instrumentation rollout and aggregate reviews/1000active; any later threshold experiment remains separately decided. `publication`: not_requested. No production analytics send, payment, store/console write, live campaign or device action is performed by this implementation lane.

Rollback owner: the game owner/root implementing the eventual release. Diagnostic disable must preserve Review history, progress, reward receipts, opt-out and paid rights. The shared safety owner is independent of telemetry and does not change business thresholds.

## Source references

- Existing integration map: `output/rustore-sdk-2026-11-02/sl-rv/current-fullscreen-map.md` (read current code before edits; its hash snapshot may be superseded).
- Official Review10.5.1 reference: <https://www.rustore.ru/help/en/sdk/reviews-ratings/kotlin-java/10-5-1>. Current read returned HTTP429 challenge; no newly fetched contents claimed. Installed pinned AAR/API evidence and prior official plan evidence will be recorded before native edits.
- Expo56 reference: <https://docs.expo.dev/versions/v56.0.0/>; actual installed `AppContext.hasActiveReactInstance` and RN0.85 lifecycle APIs are inspected rather than inferred from latest docs.

## Actual results / gaps

- Behavior baseline: PASS9 suites/217 tests on4 November2026. No production source changed for this baseline.
- Source implementation and scoped host checks are complete; independent reviews and final native/R8/owned-emulator acceptance remain pending.

## Implemented contract

`policy.ts` now produces one deterministic reason and derives the former boolean decision from it; the storage key/version and10/30days+20/max3/handled values are unchanged. Safety suppression (local/native/shared UI owner) has priority over policy suppression so a duplicate call cannot become the caller's fallback-ad permission. The game supplies a live safe-point callback, checked both before reservation and after asynchronous preparation: committed victory, focused/active screen, no unresolved reward recovery, prepared wheel reward or pending spin. Rewards are still granted by their existing settlement path, independently of Review.

Native preparation uses an exact per-request object, captured React context and module generation. Both success and failure reject stale identity/context; duplicate callbacks cannot resolve twice. `discard` clears only preparation. Launch has one process-wide exact native owner, retained through `OnDestroy`, released by its own terminal callback even when JS is dead; dead/replaced JS receives no completion. A new JS runtime observes that owner through `hasActiveForm`. The existing Expo wrapper detects both new capability methods and fails closed for automatic Review on an old binary; no repeated module initialization or reflection is added. The old Boolean `prepare` method remains for compatibility, while `prepareResult` exposes `ready/unavailable/error` for the new coordinator.

The C03 dependency changes only actual provider boundaries. Ads acquire the existing opaque token before SDK show/receipt preparation and release it on exact terminal paths. The180-second watchdog keeps the **same** token with its exact rewarded orphan; existing positive native-inactive reconciliation or an exact terminal callback releases it. Existing reward persistence/recovery/cooldowns and help context are preserved. Existing readiness listeners also subscribe to shared ownership. Ads and checkout consult `hasActiveForm` to protect a form left open by a replaced JS runtime. There is no added rewarded Activity observer.

Checkout retains its backend ledger, saved invoice/request binding, identity checks and autosync. `checkoutFullscreen.ts` observes Android change/blur/focus **before** the existing `Linking.openURL`, distinguishes acceptance from return, and releases only after observed departure plus active/focused return or a failed launch. A timer, pending invoice, deep link or payment status never releases the UI owner. A pending invoice does not keep ownership after the browser returns. No new payment provider, SDK or entitlement path is added.

| Control | Local default / scope | Disable behavior |
|---|---|---|
| `EXPO_PUBLIC_RUSTORE_REVIEW_ENABLED` | Existing feature retained unless build value is `0` | Suppress future automatic Review; preserve all history/progress/rights |
| `EXPO_PUBLIC_RUSTORE_REVIEW_DIAGNOSTICS` | New diagnostic stages off unless build value is `1` | Keep the existing single `review_flow_finished`, suppress new funnel stages |
| Shared/native UI safety | Always enforced for the current integration | Independent of analytics/consent/diagnostic flags; no TTL/background release |

These are bundled build-time flags, not arbitrary remote commands and not an active threshold experiment. An old binary lacks the new native lifecycle capability and is skipped by new JS. Rollback never clears `KEYS.reviewPrompt`, the reward journal, opt-out or paid rights. Normal gameplay remains available when Review/store is unavailable.

## Events / data ownership

All events use the existing analytics v3 schema, identity, consent gate and bounded outbox (512 entries,7-day TTL,8 bounded handoff attempts); no second queue or identity. Coordinator owns the emission. The former game completion emitter is removed to avoid duplicate completion. New stages require explicit build opt-in; old queued v3 completion payloads remain valid without a new required reason.

| Event | Exact local moment / repetition | Fields / interpretation |
|---|---|---|
| `review_eligibility` | One evaluation per explicit result-continue request | eligible/suppressed and allowlisted reason; suppression consumes no attempt |
| `review_prepare_result` | One bounded preparation result per reserved attempt | ready/error/unavailable; timeout is explicit; no raw exception |
| `review_launch_attempt` | Immediately before the native launch call | One local launch attempt, not proof of visible form |
| Existing `review_flow_finished` | Once at the coordinator's terminal result | completed means flow ended, including dismissal/quota/no form; never submitted/stars |

Per-attempt events share bounded `operation_id`; fields include `levelId`, `completed_count`, `attempt_no`, stage/result/reason and categorical source. `operation_id` is local ephemeral correlation, not account/token. There is no payload, review text, stars, phone/email, native exception or store identity. Attempts/handled remain in existing local version1 state; no new analytics persistence outside the standard outbox. Opt-out blocks stages without changing policy/history or reward settlement. Business effects are not retried by telemetry.

## Evidence recorded so far

- Actual existing pinned AAR: `api-evidence/inventory.json`, manifest/metadata and `review-public-api.txt` under the SL-RV output directory. `javap` confirms10.5.1 request/launch task signatures and factory Context overload. No dependency/version/toolchain changed.
- New cross-provider/checkout/policy tests:32 expected-red cases before their corresponding changes, then4 suites/32 PASS at the first source checkpoint. Intermediate source manifest: `implementation-checkpoint.json` (not final acceptance).
- Whole production `RuStoreReviewModule.kt` host harness:11 scenarios/34 checks PASS after expected-red old-source failures; declared Android/Expo/RuStore API fakes, not a copied policy or a real form/device result. Includes duplicate/stale preparation, old success/failure, context replacement/inactive/destroy, retained process native owner, stale launch callback, discard-open-form and TTL.
- Root reports actual Android Review Kotlin compilation PASS in the intermediate combined build. Root owns its exact artifact/source hashes and remaining R8/device results; those are not inferred from host fixtures.
- Final targeted test/type/lint results, independent code/scenario verdicts and root device evidence will be appended after execution. Current local implementation is not yet accepted. Future real signed store/phone form, rollout, aggregate ratings and threshold experiments remain unexecuted and outside this local-only deliverable.

## Independent-review repair and final author verification

The code reviewer reproduced a readiness gap after JS recreation: the old native form could finish after the new runtime had already received focus, leaving subscribed ad controls with a stale `fullscreen_busy` snapshot. The repair stays in the existing Review module: process-owner changes emit `onFormOwnerChanged` to weakly registered **current live** module instances. Destroyed instances receive neither events nor old Promise outcomes. Event delivery is an invalidation, with no user/state payload; JS reads the current native getter. A receiver failure cannot retain native UI or change the terminal outcome. `subscribeFormOwnership` feeds the existing ad readiness notifier. `getLifecycleVersion()===2` plus the existing Expo event capability is required for automatic Review; a v1 or older binary fails closed. No poller, arbitrary release timer, second native reward observer or global native arbiter is added.

The regression first failed on the prior implementation, then passed with the final source: whole-production native host **12 scenarios /40 checks PASS**. Final Kotlin SHA-256: `2e752646c22cd71d10da71849cb91d67bf0eb0289d1c78c1fd77205a77433b49` in `implementation-native-after.json`. Actual Android compilation of this **v2** source remains root work; the earlier combined build compiled the v1 process-owner checkpoint and is not v2 acceptance.

| Actual author check | Result / evidence |
|---|---|
| Broad affected policies/providers/data before final ownership-event repair |15 suites /310 tests PASS; `implementation-targeted-final-tests.log` |
| After final native-event/JS subscriber repair |7 affected suites /72 tests PASS; `implementation-owner-event-green-tests.log` |
| After checkout shade-only blur/focus correction |2 affected suites /139 tests PASS, including10 checkout-owner cases; `implementation-browser-final-tests.log` |
| Actual Android coordinator→schema→existing outbox fixture |7 tests PASS; `implementation-analytics-final.log`; captured `implementation-event-example.json`, explicitly local fake gateway, no SDK delivery |
| Current full TypeScript check |PASS exit0; `implementation-typecheck-owner-event.log` |
| Scoped production/test ESLint |PASS exit0, no warnings; `implementation-lint-owner-event.log` |
| Static checks |`git diff --check` and `node --check scripts/verify-native-review-lifecycle.cjs` PASS; LF/CRLF advisory only |

The existing billing regressions now model an actual complete browser lifecycle; dedicated ownership tests separately prove that acceptance alone, elapsed time, focus alone and notification-shade blur/focus do not release the owner. Checkout requires an observed Android background departure followed by active/focused return. Its unavailable reason remains distinct from browser launch failure. Repeated callbacks cannot release another provider's newer token. No fake browser response grants an entitlement.

`implementation-result.json` records31 author source/test/doc file hashes, named narrow additions to the foreign-dirty game/schema/ad/subscription files, reused unmodified coordinators and exact remaining acceptance. Independent reviewers own their separate reports; root owns signed v2 native/R8/device evidence and the final integrated candidate. No final local iteration completion is asserted here before those remaining checks.

## Root acceptance — 4 November 2026

[Code review](../../../output/rustore-sdk-2026-11-02/sl-rv/code-review.md) and [scenario review](../../../output/rustore-sdk-2026-11-02/sl-rv/scenario-review.md) approve their recorded source scope, including the lifecycle-v2 ownership-event repair. Root then compiled and ran that v2 source in the signed R8 QA33 binary: [local-device-verification.json](../../../output/rustore-sdk-2026-11-02/sl-rv/local-device-verification.json) records `native_available`, PackageManager version33, actual `prepare_error`, discard returning to `native_available`, unchanged level2/SON/160coins and absent Review-attempt history. The earlier v1 compile is retained as an intermediate result.

The later combined QA34 build includes the compatible guardian-v3 extension required by Updates. Its panel records native support, actual version34 and another preparation-error/discard path. [QA34 native verification](../../../output/rustore-sdk-2026-11-02/sl-up/local-device-verification.json) identifies the exact `up-minified-vc34` probe artifact and the unchanged native leaves in the final cold-render candidate; the underlying XML files remain in `local-qa/qa34-{panel-inspected,review-error,review-ready}.xml`. These are bridge/error-path checks; no Review form, eligibility seeding, attempt-history write or posted review is claimed. Actual opened-form/provider/browser lifetimes were exercised through the named deterministic/host scenarios, not a real store form or payment. The final candidate/source mapping and outstanding ordinary-build/cleanup work are in [LOCAL-RESULT.md](LOCAL-RESULT.md).
