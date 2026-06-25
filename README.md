# slova

«Слова: Игра в слова» — казуальная word-connect/кроссворд-головоломка (свайп по буквам → заполнение кроссворда) для Android / RuStore.

Клон-аналог *Words of Wonders* на стеке Expo + React Native (зеркало архитектуры проекта `blockblast`). Русский словарь, генерация уровней, путешествие по миру с достопримечательностями, ежедневные механики, онлайн-лидерборды/лиги/события/команды, монетизация Yandex Ads + RuStore Billing, серверо-авторитетный backend.

## Документация

Источник истины — `docs/specs/` (индекс в [CLAUDE.md](CLAUDE.md)). План реализации и декомпозиция задач — `docs/plans/`.

## Команды

```bash
npm test                 # Jest: движок + сторы + бэкенд-раннер
npx tsc --noEmit         # типы
npx expo start           # dev
npm run backend:test     # тесты бэкенда
npx expo prebuild -p android && cd android && ./gradlew bundleRelease   # signed AAB
```

## Платформа

Только Android (RuStore). iOS не поддерживается в текущей версии.
