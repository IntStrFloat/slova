# Runbook — подписанный релизный AAB (M6)

## Подпись (keystore)

- Release-ключ — `credentials/release.jks` (gitignored, **не пересоздавать**), параметры в `credentials/keystore.properties` (gitignored).
- Первый ключ сгенерирован: alias `slova`, RSA-2048, validity 10000 дней. Для обновлений RuStore переиспользовать этот же ключ.

## Сборка

```bash
# (при изменении нативной части) npx expo prebuild -p android
node scripts/patch-signing.js            # инжект release-подписи в android/app/build.gradle (идемпотентно)
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"   # JDK 17+
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
cd android && ./gradlew bundleRelease -x lint -x test
# артефакт: android/app/build/outputs/bundle/release/app-release.aab
```

Перед каждой загрузкой в RuStore — инкремент `android.versionCode` в `app.json` (спека 14).

## Проверка подписи

```bash
"$JAVA_HOME/bin/jarsigner" -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab | head
# или keytool -printcert -jarfile <aab>
```

## Внешние блокеры (требуют учёток/ключей — не выполнимо без них)

| Фича | Что нужно | Статус в коде |
|---|---|---|
| RuStore Billing (IAP/подписка) | регистрация приложения в RuStore Console, productId, `react-native-rustore-billing-sdk` (GitFlic) | `IapProvider` за флагом `iapEnabled=false`, Noop; UI магазина готов |
| RuStore Push | projectId в `EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID`, RuStore/distributor на тестовом устройстве, VK Maven truststore | SDK 6.9.1 и plugin подключены; soft-ask, settings и safe tap-routing реализованы |
| AppMetrica | валидный UUID `APPMETRICA_API_KEY` | `withAppMetrica` не в prebuild (плагин падает без UUID); `track()` Noop+лог, opt-out готов |

Все три — за интерфейсами с Noop; приложение собирается и работает без них. Включаются заведением соответствующих кредов и флагов (спеки 05/11/12/16).
