# Сборка APK — инструкция

Текущий dev-контейнер **не содержит** JDK и Android SDK, поэтому gradle-сборку нужно
запускать на машине с установленным тулчейном **или** в облаке EAS. Всё остальное
(код, конфиг, секреты) уже подготовлено — сборка запускается одной командой.

## Переменные окружения / секреты

Единый файл секретов — **`.env.local`** (gitignored, не коммитится). Шаблон — `.env.example`.
Перед публикацией заполнить реальными значениями:

| Переменная | Назначение |
|---|---|
| `EXPO_PUBLIC_YANDEX_BANNER_AD_UNIT_ID` | ad-unit баннера (кабинет Яндекса) |
| `EXPO_PUBLIC_YANDEX_INTERSTITIAL_AD_UNIT_ID` | ad-unit межстраничной |
| `EXPO_PUBLIC_YANDEX_REWARDED_AD_UNIT_ID` | ad-unit rewarded |
| `EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID` | projectId пушей RuStore |
| `EXPO_PUBLIC_RUSTORE_CONSOLE_APP_ID` | appId для RuStore Billing |
| `APPMETRICA_API_KEY` | ключ AppMetrica (prebuild-плагин) |

Пустые значения → используются demo-юниты рекламы (без реальных показов). Игра при этом
полностью работоспособна (реклама/IAP за Noop/флагами).

## Вариант 1. Тестовый APK локально (debug)

Требуется: **JDK 17** (`brew install openjdk@17`) и **Android SDK** (`ANDROID_HOME`/`ANDROID_SDK_ROOT`).

```bash
npm run build:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Скрипт: грузит `.env.local` → `expo prebuild -p android` → `gradlew assembleDebug`.

## Вариант 2. APK в облаке EAS (без локального тулчейна)

```bash
npx eas login
npm run build:apk:cloud   # eas build -p android --profile preview (buildType: apk)
```

## Релиз в RuStore (подписанный AAB — отдельный поток, см. docs/specs/14)

1. Положить keystore: `credentials/release.jks` + `credentials/keystore.properties`
   (переиспользовать существующий ключ, не генерировать новый — см. AGENTS.md).
2. Инкрементировать `versionCode` в `app.json`.
3. ```bash
   npx expo prebuild -p android --clean
   node scripts/patch-signing.js
   cd android && ./gradlew bundleRelease
   # → android/app/build/outputs/bundle/release/app-release.aab
   ```
4. Проверить подпись AAB перед загрузкой в RuStore Console.

## Что требует ручной настройки перед публикацией (TODO)

- Реальные **Yandex ad-unit ID** в `.env.local` (иначе demo-юниты).
- **RuStore Billing**: зарегистрировать продукты в RuStore Console, затем
  `MONETIZATION.iapEnabled = true` и подключить RuStoreIapProvider (точка — `monetization/providers.ts`).
- **AppMetrica**: задать `APPMETRICA_API_KEY` и включить адаптер аналитики (`features/analytics`).
- **Звуки**: положить файлы в `assets/sfx/*` и раскомментировать `SOURCES` в `features/audio/index.ts`
  (архитектура готова, играет без правок логики).
- **Release keystore**: `credentials/release.jks` для подписанного AAB.
