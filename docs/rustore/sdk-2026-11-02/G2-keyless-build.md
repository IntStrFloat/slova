# G2 — analytics destination and intentional keyless builds

Local implementation scope. No store upload, production event, server configuration or payment is part of this change.

Production prebuild still requires a valid `APPMETRICA_API_KEY` by default. An intentionally keyless private/test build must explicitly set `APPMETRICA_REQUIRED=0` and an empty key, or supply plugin options `{ required: false, apiKey: '' }`. The required flag alone does not disable a configured key.

The plugin replaces the previous generated BuildConfig destination, including when switching to an empty key. One supported declaration is rewritten idempotently. Duplicate or unsupported declarations (including single-quoted or mixed forms) fail before returning a modified Gradle file; a stale destination is never silently retained beside a new declaration. No UUID or other environment value belongs in this report.

Native bootstrap normalizes an empty key to absent. Missing key participates in the same disabled branch as refusal/QA: call global SDK `setDataSendingEnabled(false)` and pause the tracked session, including when an earlier installed build saved consent. A request to enable analytics without a key returns false, so JS remains closed. Stored refusal and game/paid progress are not cleared.

Tests: existing plugin controls plus key replacement, explicit keyless mode, malformed/duplicate/parenthesized/single-quoted/mixed declarations. Initial two regressions failed before implementation. The independent single-quote probe exposed an additional failure; its regression failed before the guard correction. Current plugin result: 11 PASS (`g2/keyless-review-green.log`). Independent scenario recheck includes 8 hostile-form probes and 2 supported controls; see `g2/scenario-review.md` and its revision evidence.

The native missing-key global-disable correction was identified by independent code review and is subject to the integrated Kotlin compile and owned-AVD checks. Static inspection alone is not described as a physical-device or network test. Native SDK handoff and actual destination receipt remain distinct.

Source files: `plugins/withAppMetrica.js`, `src/core/config/__tests__/appMetricaPlugin.test.ts`, `modules/appmetrica/android/src/main/java/expo/modules/appmetrica/AppMetricaPrivacy.kt`, `.env.example`. Existing unrelated working-tree changes are preserved.

Local rollback owner: repository maintainer. Reverting optional-key support does not erase consent/progress or rotate credentials. Retain stale-destination rejection and the native refusal guard when modifying this path.
