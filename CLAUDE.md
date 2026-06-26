@AGENTS.md

# Слова — word-connect/кроссворд на Expo React Native

Казуальная головоломка: свайп по буквам на диске → составление слов → заполнение кроссворда. Путешествие по миру (миры/достопримечательности), ежедневные механики, онлайн-соревнования, монетизация. Только Android (RuStore). Зеркало архитектуры `blockblast`.

## Документация (источник истины — читать перед работой над разделом)

| Спека | Что описывает |
|---|---|
| [docs/specs/00-game-analysis.md](docs/specs/00-game-analysis.md) | Анализ оригинала (WOW/word-connect): правила, экраны, монетизация, юнит-экономика |
| [docs/specs/01-screens.md](docs/specs/01-screens.md) | Все экраны и оверлеи, навигация, состояние каждого |
| [docs/specs/02-architecture.md](docs/specs/02-architecture.md) | Модули, структура src/, зависимости, стек, MMKV-ключи, тесты |
| [docs/specs/03-engine-and-generator.md](docs/specs/03-engine-and-generator.md) | core/engine: модель уровня, валидация слов, события, генератор сеток |
| [docs/specs/04-design-system.md](docs/specs/04-design-system.md) | Токены, темы миров, типографика, анимации/хаптика/звук |
| [docs/specs/05-monetization.md](docs/specs/05-monetization.md) | AdsProvider/IapProvider, флаги, частоты, Yandex Ads + RuStore Billing |
| [docs/specs/06-economy-currencies.md](docs/specs/06-economy-currencies.md) | Монеты/кристаллы, подсказки, копилка, магазин, балансировка |
| [docs/specs/07-levels-worlds-collection.md](docs/specs/07-levels-worlds-collection.md) | Карта-путешествие, миры, разлок, коллекция достопримечательностей, сундуки |
| [docs/specs/08-daily-wheel-streak.md](docs/specs/08-daily-wheel-streak.md) | Ежедневный пазл, колесо фортуны, логин-календарь, стрик |
| [docs/specs/09-leaderboard-leagues.md](docs/specs/09-leaderboard-leagues.md) | Лидерборды (глобал/неделя), лиги/дивизионы, античит |
| [docs/specs/10-events-teams.md](docs/specs/10-events-teams.md) | Временные события/турниры, команды/клубы |
| [docs/specs/11-profile-cloudsave-backend.md](docs/specs/11-profile-cloudsave-backend.md) | Профиль/аккаунт, облачный сейв, backend API, модель данных |
| [docs/specs/12-notifications.md](docs/specs/12-notifications.md) | RuStore push: приём, soft-ask, ретеншн-кампании |
| [docs/specs/13-performance.md](docs/specs/13-performance.md) | Бюджеты 60fps, правила рендера/жестов/анимаций |
| [docs/specs/14-build-release-deploy.md](docs/specs/14-build-release-deploy.md) | Signed AAB, RuStore-чеклист, изолированный деплой backend |
| [docs/specs/15-localization-dictionary.md](docs/specs/15-localization-dictionary.md) | i18n ru/en, источник и обработка русского словаря |
| [docs/specs/16-analytics.md](docs/specs/16-analytics.md) | AppMetrica: воронки, события, KPI |
| [docs/specs/17-nfr-acceptance.md](docs/specs/17-nfr-acceptance.md) | Нефункциональные требования и критерии приёмки |
| [docs/specs/18-audience.md](docs/specs/18-audience.md) | Целевая аудитория 30–35+ и дизайн-решения под неё (фото, читаемость, clay) |

План реализации и задачи: [docs/plans/](docs/plans/) — выполнять по нему.

## Конвенции кода

- TypeScript strict; `npx tsc --noEmit` и `npm test` зелёные перед каждым коммитом.
- `core/engine` — чистый TS, ноль импортов React/RN; правится только вместе с тестами.
- Модули `features/*` экспортируют public API через `index.ts`; внутрь чужого модуля не импортируем.
- Текст — только `AppText` (пресеты), никаких сырых `<Text>`/`fontWeight`. Цвета — только из `ui/theme.ts`.
- Все игровые числа — в конфигах (`GAME`, `ECONOMY`, `MONETIZATION`), не в логике.
- Анимации — Reanimated shared values на UI-потоке; в жест-пути свайпа никаких setState/runOnJS (кроме завершения слова). См. 13.
- Строки UI — через `core/i18n` (ru/en).
- Интеграции (ads/iap/push/analytics/backend) — за интерфейсами с Noop-реализацией; реальные SDK включаются флагами.
- Коммиты: conventional (`feat(game): …`), сообщения на русском допустимы.

## Команды

```bash
npm test
npx tsc --noEmit
npx expo start
npm run backend:test
npx expo prebuild -p android && cd android && ./gradlew bundleRelease
```

## Чего НЕ делать

- Не добавлять нативные зависимости без обоснования в 13 (бюджет: mmkv + yandex-ads + rustore-billing/push сверх Expo).
- Не показывать рекламу/попапы вопреки анти-чеклисту из 05.
- Не коммитить credentials/секреты/SSH-креды.
- Не трогать деплой `bloxx-*` (blockblast) на общем сервере.
- Не публиковать `assembleRelease`: релиз — подписанный AAB.
