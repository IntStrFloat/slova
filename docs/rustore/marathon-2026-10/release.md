# Выпуск

Исходная опубликованная версия: 0.1.13/vc17, `com.intstrfloat.slova`. Подготовлено обновление 0.1.14/vc18 прежним `credentials/release.jks`.

- Final AAB: `output/release/slova-0.1.14-vc18-rustore-final.aab`, 126792077 bytes, SHA256 `f00ace0b06b8634ae228960fe421ffcd503329cfce6d2e7811a6ac29ab6ca65e`.
- Final APK: `output/release/slova-0.1.14-vc18-release.apk`, 165827190 bytes, SHA256 `8479d9f694b3e847cd03c022ee05e782ae06618dde82dfb6afbba829b5914f70`.
- Certificate SHA256: `8888e53939d854a282a0ee40e9a78e21360b50d0dd077efc2d107da155bfadcd`, matches original key and previous release.
- AAB verification: every raw/compressed entry preserved relative to Gradle source AAB; MANIFEST.MF/signatures reordered first for streaming compatibility; JarFile/JarInputStream verify every 2139 payload entry. `output/marathon-2026-10/aab-rustore-final-verification.json`.
- APK verification: not debuggable, package/version expected, armeabi-v7a/arm64-v8a/x86/x86_64, signature verified. `output/release/slova-0.1.14-vc18-verification.json`.
- Native: offline production install/cold deeplink plus isolated actual-win/restart/expiry and saved-result replay. `output/marathon-2026-10/native/verification-replay.json`.
- App signing in Console configured after explicit user authorization using encrypted PEPK ZIP + public PEM; original keystore unchanged. No passwords or private plaintext keys in logs/repo.

Публикация и ID версии/события записываются после фактического подтверждения Console. Подготовка артефакта не означает одобрения модерации.
