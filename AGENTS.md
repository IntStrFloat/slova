# Agent contract — slova

## Expo
Стек зафиксирован под Expo SDK 56 / RN 0.85 / New Architecture / Hermes (как в `blockblast`). Сверяться с версионной докой https://docs.expo.dev/versions/v56.0.0/ перед написанием native-кода.

## Платформа
Только Android. Не добавлять iOS-таргеты/адаптеры без явного запроса.

## Android release contract
- Релизный артефакт — **подписанный `.aab`** (`bundleRelease`), не APK.
- Переиспользовать `credentials/release.jks`; не генерировать новый release-ключ.
- Инкрементировать `versionCode` перед каждой загрузкой в RuStore.
- Проверять подпись AAB и отпечаток сертификата перед отчётом о готовности.

## Backend / деплой
- Деплой на тот же сервер, что и `blockblast`, но **полностью изолированно** (свой user, путь, порт, data-dir, systemd-unit, nginx-сервер-блок). См. [docs/specs/14-build-release-deploy.md](docs/specs/14-build-release-deploy.md).
- **Не трогать** сервис/файлы `bloxx-*` существующего проекта.

## Секреты
- Не коммитить `credentials/`, `*.env`, keystore, серверные/SSH-креды.
- SSH/деплой-креды — только локально, вне git.
