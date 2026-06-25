# «Слова» — Roadmap реализации (декомпозиция на задачи)

> Полная разбивка спеки ([docs/specs](../specs)) на вехи и конкретные задачи. Каждая веха — работающий тестируемый срез. Детальные TDD-планы вех — отдельные файлы `docs/plans/MX-*.md` (создаются перед своей фазой; M1 готов).

**Легенда задачи:** `ID — заголовок` · _files_ · _tests_ · _deps_. Все задачи под Definition of Done из [17](../specs/17-nfr-acceptance.md): код + тесты + `tsc` зелёные + соответствие спеке.

Зависимости вех: **M0 → M1 → M2 → M3 → M4 → M5 → M6** (M2/M3 можно частично параллелить после M1; M4 нужен до M5).

---

## M0 — Каркас проекта
Цель: пустой, но запускающийся Expo-проект со структурой, дизайн-системой, i18n, MMKV, конфигами, CI-гейтами. Спеки: [02](../specs/02-architecture.md),[04](../specs/04-design-system.md).

| ID | Задача | Files | Tests | Deps |
|---|---|---|---|---|
| T0.1 | Init Expo SDK56/RN0.85, TS strict, Hermes, New Arch | `package.json`,`app.json`,`tsconfig.json`,`eslint.config.js` | `tsc` | — |
| T0.2 | Скелет папок `src/{app,core,features,ui}`, `backend/`,`scripts/`,`plugins/`,`assets/` | дерево | — | T0.1 |
| T0.3 | `ui/theme.ts` (токены, worldThemes-заглушка), `AppText`, primitives (Button/Overlay/ProgressBar/Badge) | `src/ui/*` | render-smoke | T0.2 |
| T0.4 | `core/i18n` (ru/en, `t()`) | `src/core/i18n/*` | unit | T0.2 |
| T0.5 | `core/storage` MMKV-обёртка + реестр ключей | `src/core/storage/index.ts` | unit (mock mmkv) | T0.2 |
| T0.6 | `core/config` (`GAME`,`ECONOMY`,`MONETIZATION`,`WORLDS`) | `src/core/config/*` | typecheck | T0.2 |
| T0.7 | expo-router `_layout` + роуты-заглушки всех экранов [01](../specs/01-screens.md) | `src/app/*` | smoke | T0.3 |
| T0.8 | jest-expo preset, `jest-setup.js`, scripts (`test`,`typecheck`,`backend:test`,`android`) | `package.json`,`jest-setup.js` | `npm test` пуст-зелёный | T0.1 |

Acceptance: `npx expo start` открывает карту-заглушку; `npm test` и `npx tsc --noEmit` зелёные.

---

## M1 — Играбельный оффлайн-срез ⭐ (детальный план: [M1-foundation-playable.md](M1-foundation-playable.md))
Цель: один мир, генератор валидных уровней, свайп→слово→сетка→бонусы→shuffle→подсказки, прогресс/resume, всё оффлайн. Спеки: [03](../specs/03-engine-and-generator.md),[15](../specs/15-localization-dictionary.md),[07](../specs/07-levels-worlds-collection.md).

| ID | Задача | Files | Tests |
|---|---|---|---|
| T1.1 | Типы движка (`Level`,`PlayState`,`SubmitResult`,`HintType`) | `core/engine/types.ts` | tsc |
| T1.2 | `normalizeWord` (регистр,`ё→е`) | `core/engine/normalize.ts` | unit |
| T1.3 | `canBuildFromLetters(word,letters)` | `core/engine/letters.ts` | unit |
| T1.4 | `submitWord` (grid/bonus/duplicate/invalid + complete) | `core/engine/play.ts` | unit |
| T1.5 | `isLevelComplete`,`shuffle(rng)` | `core/engine/play.ts`,`rng.ts` | unit |
| T1.6 | `applyHint` (bulb/hammer/revealWord) | `core/engine/hints.ts` | unit |
| T1.7 | `validateLevel` (инварианты сетки) | `core/engine/validate.ts` | unit |
| T1.8 | Словарь-пайплайн `build-dictionary.js` + сабсет ru | `scripts/build-dictionary.js`,`assets/dict/ru.json` | unit (фильтры) |
| T1.9 | Генератор `gen-levels.js` (детерминизм+инварианты) + пак мира 1 | `scripts/gen-levels.js`,`assets/levels/world1.json` | unit (детерминизм, validateLevel) |
| T1.10 | `levels` стор/лоадер (`levels.progress`, resume) | `features/levels/*` | unit |
| T1.11 | `useGameStore` (zustand) поверх движка | `features/game/store.ts` | unit |
| T1.12 | `LetterDisk` (svg + gesture worklet → candidate) | `features/game/LetterDisk.tsx` | manual + worklet-логика unit |
| T1.13 | `CrosswordGrid` (svg, появление букв) | `features/game/CrosswordGrid.tsx` | manual |
| T1.14 | Экран `/game` + проигрывание событий (anim/haptic/sound) | `src/app/game.tsx`,`features/game/*` | manual |
| T1.15 | LevelComplete-оверлей + переход на след. уровень | `features/game/LevelComplete.tsx` | manual |

Acceptance: M1 из [17](../specs/17-nfr-acceptance.md).

---

## M2 — Экономика, монетизация, ежедневки
Спеки: [05](../specs/05-monetization.md),[06](../specs/06-economy-currencies.md),[08](../specs/08-daily-wheel-streak.md).

| ID | Задача | Files | Tests |
|---|---|---|---|
| T2.1 | `currency` стор (add/spend, лог source/sink) | `features/currency/*` | unit (insufficient, идемпотентность) |
| T2.2 | `hints` интеграция стоимости + бесплатные Pro-подсказки | `features/hints/*` | unit |
| T2.3 | Оверлей «нет монет» → shop/rewarded | `features/game/NoCoins.tsx` | manual |
| T2.4 | Интерфейсы `AdsProvider`/`IapProvider` + Noop + фабрика по флагам | `features/monetization/*` | unit (Noop) |
| T2.5 | `entitlements` стор (`removeAds`,`proUntil`) | `features/monetization/entitlements.ts` | unit (реконсиляция) |
| T2.6 | `YandexAdsProvider`: banner/interstitial/rewarded/appopen + частоты | `features/monetization/ads/yandex.ts`,`plugins/withYandexAds.js` | manual + частоты unit |
| T2.7 | `RuStoreIapProvider`: products/purchase/restore/subscription (флаг off до Console) | `features/monetization/iap/rustore.ts` | manual |
| T2.8 | Экран `/shop` (паки/no-ads/Pro/офферы) | `src/app/shop.tsx` | manual |
| T2.9 | `dailybonus` логин-календарь (`daily.bonus`) | `features/dailybonus/*` | unit (полночь/сброс) |
| T2.10 | `dailypuzzle` (`/daily`, seed=дата, стрик) | `features/dailypuzzle/*`,`src/app/daily.tsx` | unit (стрик, идемпотентность дня) |
| T2.11 | `wheel` (`/wheel`, free+rewarded спины) | `features/wheel/*`,`src/app/wheel.tsx` | unit (лимиты спинов) |
| T2.12 | Защита от перевода времени | `core/time/*` | unit (откат) |

Acceptance: M2 из [17](../specs/17-nfr-acceptance.md).

---

## M3 — Мета: карта, миры, коллекция, онбординг
Спеки: [07](../specs/07-levels-worlds-collection.md),[04](../specs/04-design-system.md),[01](../specs/01-screens.md).

| ID | Задача | Files | Tests |
|---|---|---|---|
| T3.1 | Карта-путешествие `/` (дорога, узлы, состояние, HUD, бейджи) | `features/levels/MapScreen.tsx`,`src/app/index.tsx` | manual |
| T3.2 | Сундуки на узлах + награда + rewarded-удвоение | `features/levels/Chest.tsx` | unit (награда) + manual |
| T3.3 | Темы миров (рескин карты/поля) + выбор в Settings | `ui/theme.ts`,`features/settings/*` | manual |
| T3.4 | `collection` стор + reveal-оверлей + экран `/collection` | `features/collection/*`,`src/app/collection.tsx` | unit (без дублей) + manual |
| T3.5 | Онбординг (туториал 1–3) + soft-ask пушей | `features/onboarding/*`,`src/app/onboarding.tsx` | manual |
| T3.6 | Ленивая докачка паков/картинок по мирам | `features/levels/loader.ts` | unit (fallback «скоро») |

Acceptance: M3 из [17](../specs/17-nfr-acceptance.md).

---

## M4 — Онлайн-ядро: backend, профиль, облако, лидерборды, лиги
Спеки: [11](../specs/11-profile-cloudsave-backend.md),[09](../specs/09-leaderboard-leagues.md),[14](../specs/14-build-release-deploy.md).

| ID | Задача | Files | Tests |
|---|---|---|---|
| T4.1 | Backend scaffold: `index.cjs`,`server.cjs`, JSON-стор (атомарная запись), `/api/health` | `backend/*` | node:test (health) |
| T4.2 | `runtime/` — зеркало `core/engine` (валидация уровня) + тест на совпадение с клиентом | `backend/runtime/*` | node:test (parity) |
| T4.3 | `core/net` `BackendClient` + `Noop` + очередь + флаг/`EXPO_PUBLIC_API_BASE` | `core/net/*` | unit (очередь/ретрай) |
| T4.4 | Профиль: `/api/profile/bootstrap`,`/rename` + `features/profile` + soft-ask | `backend/server.cjs`,`features/profile/*`,`src/app/profile.tsx` | node:test + unit |
| T4.5 | Ревалидация прогресса `/api/progress` (idempotent, sanity-лимиты) | `backend/server.cjs` | node:test (валид/невалид/повтор) |
| T4.6 | Облачный сейв `/api/save` GET/POST + merge (`features/cloudsave`) | `backend/server.cjs`,`features/cloudsave/*` | node:test + unit (конфликт) |
| T4.7 | Лидерборд `/api/leaderboard` (scope) + `features/leaderboard` + UI | `backend/server.cjs`,`features/leaderboard/*`,`src/app/leaderboard.tsx` | node:test (снапшот) + unit (очередь) |
| T4.8 | Лиги (дивизионы, промоушн/демоушн, награды) | `backend/runtime/leagues.js`,`features/leagues/*` | node:test (промоушн) |
| T4.9 | Деплой-артефакты: `slova-backend.service`,`nginx-slova.conf`,`backend.env.example` + runbook | `backend/deploy/*`,`docs/runbooks/backend-deploy.md` | — |
| T4.10 | Деплой на сервер (изолированно от bloxx, порт 8788, `/opt/slova`,`/var/lib/slova`, сабдомен, certbot) + smoke `/api/health` | (сервер) | curl smoke |

Acceptance: M4 из [17](../specs/17-nfr-acceptance.md) + NFR-13 (изоляция от bloxx).

---

## M5 — Социальное: события/турниры, команды/клубы
Спека: [10](../specs/10-events-teams.md).

| ID | Задача | Files | Tests |
|---|---|---|---|
| T5.1 | Backend события: `/api/events`,`/:id/progress`(ревалид),`/:id/board` + награды (idempotent) | `backend/runtime/events.js`,`backend/server.cjs` | node:test (лайфцикл,идемпотентность) |
| T5.2 | `features/events` + `/events` UI (таймер, очки, тиры, бейдж на карте) | `features/events/*`,`src/app/events.tsx` | unit + manual |
| T5.3 | Backend команды: `/api/teams` CRUD/поиск,`/join`,`/leave`, прогресс | `backend/runtime/teams.js`,`backend/server.cjs` | node:test (join/leave/агрегация) |
| T5.4 | `features/teams` + `/teams` UI (карточка, участники, вклад, цель) | `features/teams/*`,`src/app/teams.tsx` | unit + manual |
| T5.5 | Флаги `FEATURES.events/teams` + мягкая деградация оффлайн | `core/config/features.ts` | unit |

Acceptance: M5 из [17](../specs/17-nfr-acceptance.md).

---

## M6 — Релиз: push, аналитика, перф, локализация, AAB
Спеки: [12](../specs/12-notifications.md),[16](../specs/16-analytics.md),[13](../specs/13-performance.md),[14](../specs/14-build-release-deploy.md),[15](../specs/15-localization-dictionary.md).

| ID | Задача | Files | Tests |
|---|---|---|---|
| T6.1 | Push: `withRuStorePush.js` + интерфейс + регистрация токена + `/api/push/register` | `plugins/withRuStorePush.js`,`features/notifications/*` | unit (диплинки/soft-ask) |
| T6.2 | Push-кампании (триггерный планировщик на бэке + ручные из консоли) | `backend/runtime/push.js` | node:test |
| T6.3 | Аналитика: `withAppMetrica.js` + `Analytics` + события воронок + opt-out | `plugins/withAppMetrica.js`,`features/analytics/*` | unit (маппинг/opt-out) |
| T6.4 | Перф-полировка (свайп 60fps, старт ≤3–4с, мемоизация сетки) | `features/game/*` | профайл |
| T6.5 | Локализация-аудит (100% строк через i18n, grep сырых `<Text>`) | весь src | lint/grep |
| T6.6 | Signed-AAB пайплайн: `patch-signing.js`, prebuild+gradle, keystore, проверка подписи + runbook | `scripts/patch-signing.js`,`docs/runbooks/android-app-signing.md` | подпись AAB |
| T6.7 | RuStore-чеклист: продукты IAP в Console, возрастной рейтинг, privacy-страница, скриншоты, описание | `docs/privacy.html` | ручной чек |

Acceptance: M6 + все NFR из [17](../specs/17-nfr-acceptance.md).

---

## Сводка вех

| Веха | Результат | Спеки |
|---|---|---|
| M0 | запускающийся каркас | 02,04 |
| M1 | играбельный оффлайн-срез | 03,07,15 |
| M2 | экономика+реклама+IAP+дейли | 05,06,08 |
| M3 | карта/миры/коллекция/онбординг | 07,04,01 |
| M4 | backend+профиль+облако+лидерборды+лиги (деплой) | 09,11,14 |
| M5 | события+команды | 10 |
| M6 | push+аналитика+перф+локализация+релиз AAB | 12,13,14,15,16 |
