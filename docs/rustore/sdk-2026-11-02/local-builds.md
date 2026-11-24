# Local SDK builds

Current acceptance, 5 November 2026: **local_scope_verified**. The final cold-render QA34 and separate ordinary main-identity/all-four-ABI whole-app APK/AAB are signed and verified locally; the ordinary artifacts were never installed. Cleanup is complete. [LOCAL-RESULT.md](LOCAL-RESULT.md) records exact artifact hashes, the requirement index and separate source epochs. No store-ready artifact is declared here.

These commands compile local artifacts. They do not install an application, create an AVD, submit a RuStore update or execute a purchase. Use the single registered `Slova_Test_API35`; resolve its current ADB serial from its name before device work. Keep the original main package and its profile.

## Isolated QA

```powershell
$env:SLOVA_SDK_QA_VERSION_CODE = '34'
node scripts/sdk-qa.cjs prebuild
node scripts/sdk-qa.cjs build-offline --with-native-tests
```

Keep the version override in the environment for **both** commands, so generated native version and embedded Expo configuration agree. The override changes only `.sdkqa`, not the `app.json` main version. The signed APK is for installation on the owned emulator; the signed AAB is a local packaging check. Verify package, version, original certificate and hashes before installation. Never install these artifacts over the main package.

The helper requires loopback backend and test ads; removes inherited financial credentials; disables dotenv reloading, production analytics, Push project registration, Remote Config fetch and real Updates. The QA native update module also rejects its real SDK factory for the actual `.sdkqa` package. The diagnostic route requires both the public QA switch and native compile/manifest/package/keyless guards. It has no normal product entry point.

`build-native-tests` builds the isolated reminders/Push instrumentation APKs without installing or running them. `backend` and `metro` start task-local loopback helpers. End their processes only after verifying their current identity/port; leave other projects' services alone.

## Offline dependency provenance

`build-offline` requires `.omx/private/sdkqa-maven.init.gradle`. This task's mirror contains original public Maven POM/AAR bytes with exact version-scoped entries; it does not override SDK versions or rewrite production repositories. The provenance reports under `output/rustore-sdk-2026-11-02/local-qa/` distinguish research inputs, mirror files and actual resolved dependencies.

The preparation script uses certificate-validated HTTPS to original vendor/Maven Central hosts with per-request DNS-over-HTTPS resolution when host DNS is unavailable. It does not change system DNS. Optional BOM entries in the mirror are not a claim that every mirrored SDK is a runtime dependency.

## Ordinary native source set

```powershell
node scripts/sdk-qa.cjs prebuild-native-defaults
node scripts/sdk-qa.cjs build-native-defaults-offline
```

This is a **keyless local compile** with the ordinary main application identity, all four Android ABIs, R8 and the controlled-crash native source set disabled. Public QA controls and the QA version override are removed. It checks that the fixture class/library cannot enter the ordinary binary. It is not configured for publication and must not be installed over the preserved main package. Its signature does not establish published-source mapping or authorize an upload. Before any later release, restore approved production configuration and perform the separate store checks/version increment.

Preserve QA artifacts, maps and exact source/input proofs before changing generated Android configuration or overwriting build outputs. `capture-compiled-inputs.cjs` checks actual composed-map content against current files; a differing later worktree is recorded separately from the compiled snapshot.

## Root artifact checkpoint — 4 November 2026

Accepted final QA files are `output/rustore-sdk-2026-11-02/local-qa/slova-sdkqa-cold-static-minified-vc34.{apk,aab}`. [Artifact verification](../../../output/rustore-sdk-2026-11-02/local-qa/cold-static-34-r8-artifact-verification.json) records `.sdkqa`,0.1.29/34, x86_64, R8/Hermes, original certificate and signed AAB payload verification. Actual file SHA-256 is APK `a1809b81c09685fd4cebfeafd8b5ac561628e5dfc89f2aa0d4f5fbaf1b379d05`; AAB `87d72338ebcc18bf54869f0bef02124668cdf00a57ca9af3100a9c9af0a3a12c`. [Final compiled inputs](../../../output/rustore-sdk-2026-11-02/local-qa/final-qa34-compiled-inputs.json) pass for199 JS and30 native entries; the earlier `up-34` snapshot predates the outer cold-render wrapper fix and remains a separate receipt.

Root installed this QA candidate and checked the initial cold launch plus two cold restarts without Home/resume, UIAutomator or a diagnostic effect before capture. The existing level2/SON/160coins renders on all three; [visual verdict](../../../output/rustore-sdk-2026-11-02/local-qa/cold-static-verdict.json) is100/pass. Temporary render logging is removed. The ordinary main package and its original profile remain unchanged.

The ordinary source-set [whole-app verification](../../../output/rustore-sdk-2026-11-02/local-qa/normal-whole-app-verification.json) and [artifact verification](../../../output/rustore-sdk-2026-11-02/local-qa/native-defaults-r8-artifact-verification.json) now pass for keyless main identity0.1.29/33, R8 and all four ABIs. QA/extended crash are off, no Push project is configured, Remote Config and the Updates factory remain off. All10 APK/AAB DEX payloads and the executable bundle match; the ordinary91714 defined classes and packaged JNI entries contain no QA fixture, with a separate positive QA control. The original certificate and3346 signed AAB payload entries verify. Ordinary files are `slova-native-defaults-minified-vc33.apk` (194716683 bytes, SHA-256 `7ae99def257a2b8ccaa30cf9253b0ad40ba99ac59fd2c88c2cfe1e55050443f8`) and `.aab` (162774288 bytes, SHA-256 `8f60eb241c0efc8035223644b056a4aeeb68c1aa5c45ceee88be29b09f056400`) under the local QA output directory. **Neither was installed or published.**

[normal-final-compiled-inputs.json](../../../output/rustore-sdk-2026-11-02/local-qa/normal-final-compiled-inputs.json) records200 JS /30 native inputs matching at capture; it includes later shared subscription/shop changes and is a separate source epoch from the199-input QA34 snapshot. [final-native-dependencies.json](../../../output/rustore-sdk-2026-11-02/local-qa/final-native-dependencies.json) confirms the pinned SDK graph with0 FAILED. These are local compile/packaging results; production configuration, a higher upload versionCode and store acceptance remain future work.

## Final local verification and cleanup — 5 November 2026

[Final verification](../../../output/rustore-sdk-2026-11-02/final-verification-report.json) passes for the latest 594-file after manifest. Broad 2116 Jest/historical 515 backend and later 169 existing-provider/85 cold-container checks retain separate scopes. The later shared analysis epoch passed [18 files / 567 backend tests](../../../output/rustore-sdk-2026-11-02/local-qa/latest-backend-sequential-result.json) sequentially with unchanged tests/timeouts; before/after source entries are identical and all 594 match current files. Its earlier parallel fake-SMTP 30 ms timeout remains recorded. Final TypeScript/changed-app lint exit 0. [Current compiled-source comparison](../../../output/rustore-sdk-2026-11-02/final-current-compiled-difference.json) has zero differences for all 200 normal-snapshot JS inputs. Node helper privacy/syntax checks are separate from project lint, which ignores that helper; raw shared whitespace warnings are retained with a narrower CR-at-EOL-aware source check.

[Device cleanup](../../../output/rustore-sdk-2026-11-02/local-qa/final-device-cleanup.json), [host cleanup](../../../output/rustore-sdk-2026-11-02/local-qa/final-host-cleanup.json) and [registry release](../../../output/rustore-sdk-2026-11-02/local-qa/final-registry-release.json) complete the local cleanup: own QA/test packages force-stopped before original Wi-Fi/mobile-data restoration; own reverse ports removed; verified loopback backend stopped; Metro absent; Slova AVD stopped without wipe and owner released. Main hashes/guest data and other devices/registry entries are preserved. Shared Gradle daemon was left alone. Only the final independent evidence audit and 107 requirement-index/goal bookkeeping remain root-owned. The ordinary artifacts remain uninstalled and unpublished.
