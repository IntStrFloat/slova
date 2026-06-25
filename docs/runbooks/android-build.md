# Runbook — локальная сборка и запуск на Android-эмуляторе

Проверено: приложение собрано (debug AAB/APK), установлено и запущено на эмуляторе `Pixel_8`; главный экран, игровой экран (свайп-диск + кроссворд + подсказки) и баннер Yandex Ads (demo) работают.

## Предусловия (окружение)

| Что | Значение на машине разработки |
|---|---|
| Node | 22.x |
| JDK | **17+** (используется Android Studio JBR — JDK 21): `C:/Program Files/Android/Android Studio/jbr` |
| Android SDK | `C:/Users/<user>/AppData/Local/Android/Sdk` |
| AVD | `Pixel_8` (или любой x86_64 Android 13+) |

Gradle требует JVM 17+. Если `JAVA_HOME` указывает на JDK 8 — сборка падает («Gradle requires JVM 17 or later»).

## Переменные окружения / локальные файлы

- `.env.local` (gitignored) — продакшн-значения Yandex/RuStore/AppMetrica; без них используются demo-юниты Yandex и Noop-провайдеры (см. [05](../specs/05-monetization.md)). Шаблон — `.env.example`.
- `android/local.properties` (генерится локально, gitignored): `sdk.dir=C:/Users/<user>/AppData/Local/Android/Sdk`.
- `android/gradle.properties`: `org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr` (или экспортировать `JAVA_HOME`).

## Шаги

```bash
# 0) зависимости и проверки
npm install
npx tsc --noEmit && npm test          # типы + 19 unit-тестов (движок, геометрия, частоты рекламы)

# 1) контент (если меняли словарь)
node scripts/gen-levels.js --world world1 --count 40

# 2) нативный проект
npx expo prebuild -p android

# 3) окружение сборки (PowerShell/bash)
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="/c/Users/<user>/AppData/Local/Android/Sdk"

# 4) запустить эмулятор
"$ANDROID_HOME/emulator/emulator" -avd Pixel_8 &

# 5a) одной командой (метро + сборка + установка + запуск)
npx expo run:android

# 5b) или вручную (детерминированно):
cd android && ./gradlew app:assembleDebug -x lint -x test
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
npx expo start            # метро (отдельный терминал)
adb shell monkey -p com.intstrfloat.slova -c android.intent.category.LAUNCHER 1
```

## Проверка (smoke)

```bash
adb logcat -d | grep -i 'ReactNativeJS: Running "main"'   # приложение стартовало (fabric:true)
adb exec-out screencap -p > shot.png                       # скриншот
```
Ожидаемо: главный экран «Слова» с кнопкой «Играть», сеткой мета-экранов и баннером Yandex Ads внизу; на `/game` — кроссворд + диск букв; подсказка «🔨 Слово» заполняет слово в сетке.

## Релиз (M6, спека 14)

Релизный артефакт — подписанный AAB (`bundleRelease`), не APK; keystore `credentials/release.jks`, инкремент `versionCode`. Деплой backend — изолированно от bloxx (спека 14).
