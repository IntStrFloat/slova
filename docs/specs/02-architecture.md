# 02 — Архитектура

Статус: утверждено · Обновлено: 2026-06-26

## Принципы

1. **Движок отделён от UI.** Игровая логика — чистый TypeScript без импортов React/RN. Тестируется Jest, переносима (web/сервер/боты).
2. **Модули = `features/`** с одной зоной ответственности; наружу только `index.ts` (public API). Кросс-импорты внутрь чужого модуля запрещены.
3. **Интеграции за интерфейсами.** Реклама, IAP, push, аналитика, backend-клиент — интерфейсы с Noop-реализацией. Реальные SDK — адаптеры за флагами. Приложение всегда собирается без них.
4. **Состояние** — zustand-сторы по модулям; персист — MMKV (синхронный). Без god-store.
5. **Конфиг вместо хардкода** — все игровые числа в конфиг-объектах.
6. **Сервер недоверчив к клиенту** — прогресс/очки ревалидируются на бэкенде (см. [11](11-profile-cloudsave-backend.md)).

## Структура

```
slova/
├── CLAUDE.md                    # индекс документации
├── docs/{specs,plans,runbooks}/
├── src/
│   ├── app/                     # expo-router: только композиция экранов из features
│   │   ├── _layout.tsx
│   │   ├── index.tsx            # Карта-путешествие (хаб)
│   │   ├── game.tsx
│   │   ├── daily.tsx  wheel.tsx  collection.tsx  shop.tsx
│   │   ├── leaderboard.tsx  events.tsx  teams.tsx
│   │   ├── profile.tsx  settings.tsx  onboarding.tsx
│   ├── core/
│   │   ├── engine/              # ЧИСТЫЙ TS: правила, валидация, генератор → 03
│   │   ├── config/              # GAME, ECONOMY, MONETIZATION, WORLDS
│   │   ├── storage/             # обёртка MMKV (get/set JSON, ключи в одном месте)
│   │   ├── net/                 # backend-клиент (fetch + очередь + Noop)
│   │   └── i18n/                # словари ru/en, t(key)
│   ├── features/
│   │   ├── game/ levels/ collection/ currency/ hints/
│   │   ├── dailypuzzle/ wheel/ dailybonus/
│   │   ├── leaderboard/ leagues/ events/ teams/
│   │   ├── profile/ cloudsave/
│   │   ├── monetization/        # ads/ + iap/ за интерфейсами → 05
│   │   ├── analytics/ notifications/ settings/ onboarding/ share/
│   └── ui/                      # design system → 04
│       ├── theme.ts  AppText.tsx  primitives/  icons/
├── assets/                      # шрифты, звуки (gen-script), картинки локаций
├── scripts/                     # gen-levels.js, gen-sounds.js, patch-signing.js …
├── plugins/                     # Expo config plugins (yandex, rustore-push, appmetrica)
└── backend/                     # Node TS, серверо-авторитетный → 11, 14
    ├── index.cjs  server.cjs
    ├── runtime/                 # зеркало core/engine для ревалидации уровней
    ├── migrations/  deploy/  __tests__/
```

## Зависимости модулей (только в этом направлении)

```
app → features → core, ui
features/game → core/engine, features/{hints,currency,monetization,settings}
features/levels → core/engine (generator/loader), features/currency
features/{leaderboard,leagues,events,teams,cloudsave} → core/net, features/profile
core/* → ничего из features/ui/app
ui → только токены и RN
```

## Поток данных (свайп по буквам)

```
жест (gesture-handler, UI-поток)
  → worklet ведёт палец по узлам диска → shared values (линия+подсветка)
  → onRelease (JS): engine.submitWord(state, word) → новый стейт + события
  → useGameStore.set(...) → React рендерит сетку/диск
  → события (gridFill | bonus | invalid | complete) → анимации/звук/хаптика
  → автосейв прогресса уровня в MMKV (throttle)
```

Движок отдаёт **события**, UI их проигрывает — единственный контракт логики и графики.

## MMKV-ключи

| Ключ | Что | Модуль |
|---|---|---|
| `game.current` | прогресс текущего уровня (resume) | game |
| `levels.progress` | пройденные уровни, миры, разлок | levels |
| `collection.v1` | открытые достопримечательности | collection |
| `currency.v1` | { coins, gems } | currency |
| `hints.v1` | инвентарь/счётчики подсказок | hints |
| `daily.puzzle` | { lastDay, streak, doneToday } | dailypuzzle |
| `daily.bonus` | { lastDay, count } логин-календарь | dailybonus |
| `wheel.v1` | { lastFreeSpinDay, spinsToday } | wheel |
| `settings.v1` | звук, музыка, вибро, язык, уведомления | settings |
| `iap.entitlements` | { removeAds, proUntil } (кэш) | monetization |
| `ads.meta` | счётчики частоты показов | monetization |
| `profile.v1` | анонимный профиль, authToken, ник, tag | profile |
| `cloudsave.v1` | { version, lastSyncAt, pending } | cloudsave |
| `leaderboard.v1` | кэш недели/лиги, очередь сабмитов | leaderboard |
| `analytics.v1` | локальная очередь событий, opt-out | analytics |

## Технологический стек

| Слой | Выбор | Почему |
|---|---|---|
| Платформа | Expo SDK 56, RN 0.85, New Arch, Hermes | проверенный release-пайплайн RuStore (зеркало blockblast) |
| Навигация | expo-router | стандарт Expo, typed routes |
| Анимации | reanimated 4 + worklets | 60fps свайпа на UI-потоке |
| Жесты | gesture-handler 2 | трекинг пальца без JS-моста |
| Состояние | zustand | минимум кода, селекторы |
| Персист | react-native-mmkv | синхронный |
| Графика | react-native-svg | диск букв, линии связи, сетка |
| Звук/Хаптика | expo-audio / expo-haptics | стандарт |
| Реклама | yandex-mobile-ads@8.1 | AdMob в РФ недоступен |
| IAP | RuStore Billing SDK (gitflic) | платежи в RuStore |
| Push | react-native-rustore-push (gitflic) | пуши RuStore |
| Backend | Node (cjs), JSON-стор → опц. SQLite | зеркало blockblast, серверо-авторитетный |

## Тестирование

- `core/engine` — Jest, полное покрытие (валидация слов, укладка сетки, события, завершение, детерминизм генератора).
- `backend/runtime` — node:test, ревалидация уровней совпадает с клиентом.
- Сторы — unit-тесты переходов (стрик через полночь, реконсиляция entitlements, синк-конфликты).
- Команды: `npm test`, `npm run backend:test`, `npx tsc --noEmit` — зелёные перед коммитом.
