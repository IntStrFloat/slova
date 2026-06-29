#!/usr/bin/env bash
# Сборка тестового APK (debug, самоподписанный debug-ключом) для проверки на устройстве.
# Релизный артефакт RuStore — подписанный AAB (см. docs/specs/14), это отдельный поток.
#
# Требования окружения (в текущем dev-контейнере ОТСУТСТВУЮТ — ставятся локально):
#   - JDK 17  (brew install openjdk@17  или Android Studio JBR)
#   - Android SDK + platform-tools + build-tools (ANDROID_HOME / ANDROID_SDK_ROOT)
#
# Переменные окружения берутся из .env.local (единый файл секретов).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
  echo "✓ .env.local загружен"
fi

echo "→ expo prebuild (android)…"
npx expo prebuild -p android --clean

# Подключить release-подпись, если есть credentials/keystore.properties (для AAB-потока).
if [ -f credentials/keystore.properties ]; then
  node scripts/patch-signing.js || true
fi

echo "→ gradle assembleDebug…"
cd android
./gradlew assembleDebug

APK="app/build/outputs/apk/debug/app-debug.apk"
echo "✓ APK готов: android/${APK}"
