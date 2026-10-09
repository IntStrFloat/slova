# Проверка восьми правок Retention

Финальная сборка: подписанный `output/release/slova-0.1.9-vc13-release.aab`, package `com.intstrfloat.slova`, versionCode13, все четыре прежние ABI. `jarsigner` подтвердил подпись; SHA256 сертификата совпадает с предыдущим релизом. Метаданные извлечены из manifest внутри AAB; полный результат — `output/release/slova-0.1.9-vc13-verification.json`. Публикация в RuStore и серверный деплой не выполнялись.

Финальная Android QA: настоящие ручные победы L1–L5 в отдельном пакете на Android15; нормальный экран и 320×568dp с системным шрифтом150%. На компактном экране проверены поле, собираемое слово, бесплатные кнопки, четыре основные карточки Home, добровольный диалог напоминания и пятая победа. Открытка, повод вернуться завтра и обе кнопки продолжения видны вместе без прокрутки (`compact-fifth-final.png`); итоговые visual verdict94–96/pass сохранены в `.omx/state/`. Только тестовый профиль QA очищался; пользовательские профили и серверы не менялись.

Проверки: полный прогон82наборов/484тестов, TypeScript, ESLint, backend32/32 и строгий аудит1000уровней прошли. После последних правок компоновки повторно прошли затронутые проверки навигации/диска19/19, результата4/4 и Home/daily22/22, typecheck и focused ESLint. Сохранение `cost=0` отдельно подтверждено новой точечной проверкой. Native модуль напоминаний ранее прошёл8/8 framework сценариев; полноценное открытие основной игры нажатием закрытого системного уведомления остаётся отдельным smoke ограничением.

Дата: 2026-10-03. Проверка текущего исходного кода и содержания регрессионных тестов. Финальный общий запуск у владельца задачи: 82 набора / 484 теста прошли, typecheck и lint прошли, backend 32 теста прошли, строгий аудит 1000 уровней прошёл. Дополнительная проверка сохранения `cost=0` прошла отдельно (1 тест). Подпись и финальный AAB проверяются в отчёте сборки. Продуктовый рост D1/D3/D7 ещё не измерен.

| № | Что реализовано и чем подтверждается | Статус |
|---|---|---|
| 1 | `introGuide.ts` скрывает руку во время взаимодействия и возвращает после его завершения; постоянное отключение связано с `firstTargetAccepted`. `LetterDisk.tsx` завершает и отменённый жест, перезапускает loop при пакетном обновлении React. `helpNudge.ts` предлагает помощь от 18 активных секунд при нуле ошибок; пятисекундный игровой тик даёт показ около 20 секунд. Тесты `introGuide.test.tsx`, `LetterDisk.test.tsx`, `helpNudge.test.ts` покрывают неудачный/короткий/отменённый ввод, фон и выключенную помощь. | Реализовано |
| 2 | Бесплатность разрешена только для назначенного профилю, проверенного intro-контента L1–L5 в обычном режиме. `hintJournal.ts` хранит `intro-free` intent с attempt/version/fingerprint; `hints/index.ts` сохраняет бесплатную смысловую наводку отдельно от кошелька. Подсказанная сетка требует ручного ввода ответов. `independentSettlement.test.ts` различает букву, наводку и самостоятельную победу, исключает L1 из первого самостоятельного прохождения. Фактически активная автоматическая рука L1 теперь сохраняется как assistance. | Реализовано |
| 3 | Текущий intro содержит 2/2/2/3/3 ответа; кампания L1–L10 — 2/2/2/3/3/3/3/3/3/3. Обязательный «бук» удалён из нового L5, «лот» отсутствует. L5→L6 сохраняет три ответа и четыре буквы. Бонусные слова не нужны для заполнения сетки. `legacy-early-levels.json` и проверка `restoreGame` сохраняют уже начатый старый пазл; `loadVerifiedReleasedGlobalLevel` сохраняет прежние fingerprint ежедневных шаблонов. Проверки intro, loader, daily content и строгий аудит контента охватывают этот контракт. | Реализовано |
| 4 | В `layout.ts` размер глифа умножен на 1.17, ранний диск получил 250/280 dp preferred и 225 dp compact minimum. Системный масштаб учитывается с геометрическим пределом; отдельно увеличены клетки и собираемое слово. SVG-буквы рисуются после линии. Формула выбора буквы не расширена отдельным множителем. Тесты layout покрывают 320×568 и пределы крупного шрифта. Нативные `compact-game-large-font.png` и `compact-game-word-large-font.png` проверены владельцем задачи на 320×568/fontScale 1.5, visual verdict 95/pass. | Реализовано и визуально проверено на компактном экране |
| 5 | На Home последовательность: играть/продолжить, daily, прямое получение подарка, ближайшая открытка. `nextHomePostcard` выбирает ближайшую из маршрута и наградного альбома. Видимость карточки считается по viewport, фон и удалённые layout исключены; дата/подарок обновляются при foreground. Получение использует существующий durable grant. `retention-home.test.tsx`, `homeModel.test.ts`, `viewportExposure.test.ts`, `foregroundRefresh.test.ts` покрывают логику. Финальная нативная `compact-home-final.png` при 320×568/fontScale 1.5 показывает все четыре элемента без прокрутки; verdict 94/pass сохранён в `.omx/state/retention-home-return/ralph-progress.json`. Реальный подарок изменил сохранённый баланс 160→170 один раз. | Реализовано и визуально проверено на компактном экране |
| 6 | `LevelComplete` после пятой победы сразу показывает открытку, завтра повод для daily, отдельные Continue/Daily/Menu. GameScreen завершает сохранённый результат перед реальным переходом; cold pending L5 сохраняет результат даже если durable progress уже L6. `intro-completion-navigation.test.tsx` проверяет реальные callback, отсутствие фиктивного старта L6, replay и недостоверный fingerprint. Первый альбом объясняется inline, отметка показа зависит от видимости/действия. | Реализовано |
| 7 | Добровольная кнопка доступна после обучения либо знакомства с daily, порог двух daily удалён. Новый явный opt-in + разрешение ОС отдельно сохраняются; D1/D2 начинаются завтра в 18:00, только для проверенных нерешённых дат. Cap 3/7 суток, quiet 21–10, отмена решённого/opt-out, boot/update восстановление реализованы и в JS, и native. Jest покрывает согласие, отбор и журнал; в `12-notifications.md` зафиксированы 8 прошедших Android framework сценариев. | Реализовано; полноценный холодный переход через системную шторку в основной игре требует smoke |
| 8 | First ready field→target word→first/fifth victory имеют attempt и фактический contentVersion. Новые starts отделены от resumes; готовый результат не создаёт старт. Завершение передаёт assistance и время, clock сохраняет последний частичный интервал. Показ daily/gift привязан к viewport; daily return считается по разным дням действия. Reminder ledger связывает schedule/deliver/open/game по promptId с подтверждением durable outbox. Анализатор JSONL сводит старые/new/reward evidence по SDK identity/puzzle, принимает только зрелые install cohorts и явно оставляет неизвестное неизвестным. `cost` разрешён numeric sanitizer, нулевая стоимость не теряется. | Реализовано |

## Закрытые замечания аудита

Автоматическая рука L1 теперь вызывает durable `recordIntroDemoHelpUsed(1)` при действительно активном guide на готовом поле; видимая помощь влияет на классификацию победы. Интеграционный тест реального GameScreen подтверждает `assisted=true`, `assistanceType=intro_help` без выдачи валюты. В numeric allowlist добавлен `cost`; отдельный тест подтверждает, что переданное SDK событие сохраняет нулевую стоимость.

Компактный Home повторно проверен после исправления: все четыре основные функции видны без прокрутки. Диалог добровольных напоминаний `PushSoftAsk` получил ограничение по доступной высоте, прокрутку пояснения и отдельно закреплённые кнопки, чтобы крупный системный шрифт не скрывал согласие/отказ.

## Группы исходных файлов этой реализации

Ниже только файлы, относящиеся к восьми требованиям; это не перечень всего ранее изменённого рабочего дерева.

- Обучение и бесплатная помощь: `src/features/onboarding/{introGuide,introPack,onboardingHelp}.ts`, `src/features/game/{helpNudge,hintJournal,settlement}.ts`, `src/features/hints/index.ts`, `src/core/engine/hints.ts`, `src/app/game.tsx` и соответствующие tests.
- Ранний контент и сохранения: `assets/levels/world1.json`, `assets/content/{early-route-policy,legacy-early-levels,preserved-packs,content-audit}.json`, `src/features/levels/loader.ts`, `src/features/dailypuzzle/content.ts`, генератор/аудит `scripts/{gen-levels,audit-content}.js` и проверки контента/совместимости.
- Размеры и чтение поля: `src/features/game/{layout.ts,LetterDisk.tsx,CrosswordGrid.tsx}`, `src/app/game.tsx`, tests layout/LetterDisk/CrosswordGrid.
- Возвращение и результат: `src/app/{index,daily,collection}.tsx`, `src/features/game/LevelComplete.tsx`, `src/features/retention-ui/{homeModel,viewportExposure,foregroundRefresh,giftAnalytics}.ts`, `ReminderAction.tsx`, tests Home/daily/collection/LevelComplete и реального перехода L5.
- Напоминания: `src/features/notifications/{softAsk,reminders,reminderTelemetry}.ts`, `PushSoftAsk.tsx`, `modules/reminders/src/RemindersModule.ts`, Android native module/scheduler/manifest/framework tests, `src/app/{_layout,settings}.tsx`, `docs/specs/12-notifications.md`.
- Измерение: `src/features/analytics/{index,privacy,puzzleLifecycle,retentionEvents}.ts`, `src/features/game/{persistence,store,useGameplayClock}.ts`, `src/app/{game,_layout}.tsx`, `scripts/analyze-retention.cjs`, `backend/scripts/__tests__/retention-analysis.test.cjs`, `docs/runbooks/retention-analysis.md` и focused tests.
- Совместимый серверный контент: `backend/runtime/content-catalog.cjs`, `backend/scripts/build-content-catalog.cjs`, `src/features/word-report/index.ts` и `backend/scripts/__tests__/content-catalog.test.cjs`; итоговый публичный каталог приложен ниже.
- Версия и локальная проверка: `app.json`, `app.config.js`, `scripts/{build,capture,inspect,input,run}-retention-qa.cjs`, `scripts/preview-retention.cjs`; QA-пакет отделён от production package и production аналитики.

## Координация релиза

Новый клиент сохраняет intro-v1 и текущие intro-v2 fingerprints; серверный `runtime/content-catalog.cjs` понимает обе версии. Готовый публичный артефакт — `content-catalog-0.1.9.json` рядом с этим отчётом, 322280 байт, SHA256 `4b2d38955be7a7ff7939dba4012475d938e1b82bc99c4b4e57b3cd3ef6087cfb`.

| Версия | Metadata entries |
|---|---:|
| intro-v1 | 5 |
| intro-v2 | 5 |
| retention-early-v2-de43224c6ee7 | 10 |
| dict-v3-de43224c6ee7 | 500, включая 10 старых campaign identity |
| dict-v4-de43224c6ee7 | 500 |

Каждая entry содержит только `world`, `fingerprint`, `letters`; ответов, макетов и персональных данных в каталоге нет. Выполнены 35 прямых проверок validator для нового/архивного раннего контента и обеих intro-версий. `node --test backend/scripts/__tests__/content-catalog.test.cjs`: 1/1 pass. Генератор создал новый файл с `wx`; старый каталог не перезаписывался.

Для публикации клиента выполнить отдельно согласованное обновление только изолированного Slova-сервиса:

1. Проверить реальный путь/пользователя и `CONTENT_CATALOG_PATH` сервиса `slova-backend`; не выбирать путь по соседнему `bloxx-*` проекту. Сохранить предыдущий runtime и каталог для rollback.
2. Подготовить новый `backend/runtime/content-catalog.cjs` и этот каталог во временных файлах внутри пути Slova, проверить SHA256 каталога и синтаксис runtime. Каталог не требует секретов; права/владелец должны позволять чтение только нужному сервису.
3. Атомарно заменить каталог по уже настроенному `CONTENT_CATALOG_PATH` и runtime в существующей установке Slova. Не менять порт, пользователя, data-dir, nginx, unit или другие сервисы ради этой правки.
4. Перезапустить только `slova-backend`, проверить health и действующий report validator с intro-v1, intro-v2, новым L1–L10 и архивным пазлом. Для HTTP smoke использовать выделенный тестовый профиль и не выдавать клиенту удалённые ответы/макеты.
5. При ошибке восстановить оба предыдущих файла и перезапустить только Slova. Выпуск клиента 0.1.9 допускается после совместимой серверной проверки.

Старый live-каталог может отвергнуть новые сообщения о словах как `unknown_content_level`. Сам offline gameplay от этого не зависит. Сервер в рамках этого аудита не подключался, не изменялся; `bloxx-*` не затрагивался.

Локальная `reminder_delivered` означает успешную публикацию Android-уведомления, не просмотр. В закрытом приложении она попадёт в AppMetrica лишь при следующем открытии; доставку тем, кто больше не вернулся, нельзя считать нулём. Проверка Android 15 не подтверждает фоновые ограничения всех производителей. Влияние макета и ранней помощи на Retention проверяется отдельно по зрелой когорте новых установок 0.1.9/intro-v2.
