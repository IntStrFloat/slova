# SL-GC — GameCenter отложен, в текущую локальную задачу не подключается

Статус на 5 ноября 2026: **accepted_local_deferral_decision**; [независимое decision review](../../../output/rustore-sdk-2026-11-02/decision-review.md) принимает отсрочку в текущем local-only scope. Первоначальная source-проверка и результаты ниже датированы 4 ноября 2026 и сохраняют свои границы. Новый cloud save, GameCenter bridge и Pay dependency не реализованы и не заявляются готовыми.

| Поле | Значение |
|---|---|
| ID | `SL-GC` |
| Текущее решение | `deferred_no_integration_current_scope` |
| Основание | Владелец оставил GameCenter отложенным и отдельно отказался от подключения Pay; текущая поставка ограничена локальной разработкой/QA |
| Source SHA | `52aa1b71622d4a1be7885c9b9ebe644e78f9f4cb` плюс существующие рабочие изменения; хеши проверенных файлов записаны в evidence JSON |
| SDK version | Не выбрана; новая dependency не добавляется |
| Existing paths | `src/features/profile/`, `src/features/leaderboard/`, `src/features/game/persistence.ts`, `src/features/levels/store.ts`, `src/features/progression/`, `src/features/collection/`, `src/features/monetization/subscription.ts`, `backend/runtime/api.cjs` |
| Proposed implementation paths | Отсутствуют в текущем scope; `CloudSavePort` ниже — только будущая проектная граница |
| Feature flag / default | Не применимо: GameCenter collector/bridge/configuration отсутствует; фиктивный флаг или Noop-интеграция не создаются |
| Изменения этой итерации | Только карточка и [source-decision.json](../../../output/rustore-sdk-2026-11-02/sl-gc/source-decision.json) |
| Ревью | [APPROVE для исходного local-only решения](../../../output/rustore-sdk-2026-11-02/decision-review.md); это не certification будущей GameCenter/cloud-save реализации |
| Publication | Не запрошена, не выполняется |

## Решение и его границы

GameCenter остаётся отложенным в соответствии с решением владельца. Pay ради GameCenter не подключается. В этой итерации не выбираются новый identity provider, authoritative cloud или способ переноса save. Удаление SDK, миграция профиля и смена backend не нужны: нового runtime-пути нет.

Отсрочка не означает, что существующий backend уже решает восстановление между устройствами. Такой end-to-end путь в текущем клиенте не найден. Нет и проверенной статистики обращений о потерянном прогрессе или успешных восстановлений, позволяющей измерить преимущество GameCenter. Эта карточка не подменяет отсутствие метрик выводом «проблемы нет».

## Что действительно существует

| Возможность | Подтверждено исходниками | Ограничение |
|---|---|---|
| Backend-профиль | `useProfile` загружает локально сохранённые `userId/authToken/nickname/tag`; `ensure()` вызывает bootstrap, если профиля нет | Bootstrap создаёт новый серверный UUID и bearer token. App login/link/recovery существующего игрового профиля, RuStore binding и logout другого аккаунта не найдены |
| Локальное сохранение партии | MMKV normal/daily snapshots, проверка schema/mode/level/content fingerprint, normal backup и отдельные daily-даты | Это восстановление на том же локальном хранилище. Оно не доказывает reinstall или переход на другое устройство |
| Локальные достижения | Campaign progress, reward ledger, milestone claims и коллекция сохраняются отдельно; есть backup/retry и идемпотентные операции | Эти независимые данные не упакованы в принятый remote save с общей revision/profile binding |
| Рейтинг | Клиент отправляет число завершённых уровней; backend считает score, ограничивает delta и не уменьшает progress | Ответ рейтинга не восстанавливает puzzle, completed IDs, кошелёк, коллекцию или ledger |
| Backend save API | Есть авторизованные `GET/POST /api/save` и transport `pullSave/pushSave` | В игровых feature/UI call sites этих transport-методов не найдено. `KEYS.cloudsave` только объявлен. Нет работающего application coordinator upload/restore |
| Подписка | `restore(code)` обращается к отдельному authenticated billing endpoint; право применяется только после проверенного server response | Это восстановление платёжного доступа, а не игрового save, старого profile token или коллекции |

Точные источники:

- [Profile store](../../../src/features/profile/index.ts:36), [bootstrap backend](../../../backend/runtime/api.cjs:294): текущий локальный профиль переиспользуется, а отсутствующий создаётся заново. Nickname не является доказательством владения старым профилем.
- [Local game persistence](../../../src/features/game/persistence.ts:218), [restoreGame](../../../src/features/game/persistence.ts:281), [levels](../../../src/features/levels/store.ts:83), [milestone ledger](../../../src/features/progression/store.ts:128), [collection](../../../src/features/collection/store.ts:65).
- [Leaderboard client](../../../src/features/leaderboard/index.ts:53), [post-level call](../../../src/app/game.tsx:993), [server progress](../../../backend/runtime/api.cjs:388).
- [Save transports](../../../src/core/net/index.ts:230), [server save](../../../backend/runtime/api.cjs:412), [storage key declaration](../../../src/core/storage/index.ts:39).
- [Subscription restore](../../../src/features/monetization/subscription.ts:534), [profile-change invalidation](../../../src/features/monetization/subscription.ts:607), [entitlement owner binding](../../../src/features/monetization/entitlements.ts:41).

`POST /api/save` хранит непрозрачный клиентский объект с числовой `version`, если incoming version не меньше текущей; одинаковая version также может перезаписать объект. Это не schema/revision compare-and-swap, не conflict resolver, не tombstone-протокол и не подтверждение стоимости, покупки или tournament score. Существующий unit round-trip проверяет лишь этот серверный маршрут на memory store.

## Сохранение прогресса и оплаченных прав

Эта итерация не меняет persisted keys, local player, backend token, кошелёк, reward ledger, analytics identity, notification topics или entitlement. GameCenter JSON не становится источником платных прав. Текущий backend остаётся владельцем проверки подписки Robokassa/legacy YooKassa, а локальное состояние подписки связано с текущим profile owner.

Проверены действующие регрессии: восстановление незавершённой партии и unclaimed completion; отбрасывание incompatible save; восстановление backup; расширение маршрутов без потери выполненных уровней; повторный milestone без повторной выдачи; backfill коллекции без валюты; сохранение legacy permanent purchase; очистка чужого cached subscription; защита от запоздалого ответа предыдущего профиля; сохранение valid same-owner paid cache при сетевой ошибке; восстановление только после server success.

Это local unit/in-memory доказательства. На устройстве, с реальным backend или с оплатой эти сценарии в рамках данной карточки не запускались.

## Фактически выполненные проверки

| Проверка | Actual result | Что доказывает |
|---|---|---|
| Jest: game persistence, levels store, progression store, collection, subscription | **PASS — 5 suites, 159 tests**, exit 0 | Действующие local persistence/claim/owner/paid-cache регрессии на текущих исходниках с mocks |
| Backend API: pattern `cloud save\|progress\|защищённые\|bootstrap` | **PASS — 7 tests**, exit 0 | Memory-store bootstrap/auth, монотонный server progress, bounded delta и save round-trip с отказом старой version |
| Backend billing: три выбранных recovery/restore теста | **PASS — 3 tests**, exit 0 | Mock gateway: перенос billing ownership, защита старого владельца/коллизий, ротация recovery code и сохранение оплаченного периода |
| Source inventory `pullSave/pushSave/KEYS.cloudsave`, GameCenter dependency/call sites | Завершён | Есть transport/API; application cloud wiring и прямой GameCenter в проверенных путях не найдены |

Команды и выбранные имена тестов сохранены в evidence JSON. Исторические smoke-отчёты не засчитывались как повторно пройденные device-проверки. Ни один тест не выполнил реальное списание, production API request или изменение серверных данных.

## Условный будущий контракт — не реализован

Следующее относится только к отдельному будущему решению о GameCenter/облаке. Оно не является выбранным SDK API, готовым кодом, fixtures или пройденными тестами.

1. До разработки определить identity binding: guest → явно выбранный RuStore profile, подтверждение пользователя и поведение logout/смены аккаунта. Offline сохраняет самостоятельную локальную игру. Отсутствие store/auth не блокирует бесплатную игру.
2. Выбрать единственный authoritative save: собственный backend либо GameCenter. Не подключать второй writer к существующему `/api/save`, предполагая готовое разрешение конфликтов. Отдельно пересмотреть Pay dependency с учётом действующего отказа владельца; отсрочка не даёт разрешения её установить.
3. Проектный `CloudSavePort` должен работать с versioned envelope: `schemaVersion`, `revision`, `profileBinding`, `contentVersion`, `updatedAt`, `tombstone`, allowlisted payload и идемпотентный operation ID. Schema version и revision — разные понятия. Лимиты/точные API выбираются по документации реально выбранной SDK версии.
4. Содержимое restore ограничить проверяемыми gameplay/collection данными. Currency, purchases и tournament score не выдаются по клиентскому JSON. Даже монотонный merge completed IDs требует защиты от повторной награды через сохранённые claim/operation IDs и подтверждённые источники прав.
5. Старый download, upload retry и удалённый save не могут молча перезаписать более новый local progress. Для немонотонных конфликтов нужен понятный выбор сохранения; для действительно монотонных достижений — отдельно проверенный merge.
6. Analytics пишет только allowlisted outcome/reason, schema/revision buckets; тело save, имя/email профиля и tokens не попадают в события/crash-log. Новый login не наследует чужие push topics/analytics bindings.

Будущая матрица fixtures/acceptance имеет статус **NOT_IMPLEMENTED — DEFERRED** для каждого пункта:

| Будущий сценарий | Требуемое доказательство |
|---|---|
| Два устройства, разные offline revision | Ни одна ветка не теряется молча; конфликт воспроизводим и разрешается согласно выбранной политике |
| Двойной upload/callback и stale download | Идемпотентность; старый save не отменяет новый progress |
| Guest → login, logout → другой профиль | Явное связывание; чужое сохранение недоступно; локальная игра остаётся |
| Неверная schema/content fingerprint, oversized save | Безопасный отказ и работа offline; миграция проверена на настоящем старом формате |
| Tombstone против offline revision | Удаление не воскресает бесконтрольно; подтверждённое восстановление отделено от обычной синхронизации |
| Restore levels/collection после earned reward | Награда и монетарные права не выдаются повторно |
| Store отсутствует/неавторизован/timeout | Typed unavailable/error; игра продолжает работать |

Ни один пункт этой будущей матрицы не отмечается PASS по результатам существующих local/backend unit tests.

## Приёмка, откат и оставшиеся риски

Локальная приёмка этой итерации — независимое подтверждение решения **GameCenter отложен**, корректности inventory и сохранения существующего поведения по выполненным регрессиям. Новое облако не является локальным deliverable при действующей отсрочке. Следующий инженерный проход не блокируется отсутствием production метрик, но сведения об их отсутствии сохраняются.

Rollback текущей итерации — отмена документационного решения; runtime writer/SDK не вводился. При будущем эксперименте требуется отдельный switch новых cloud writes, сохранение export/restore и понятный путь к прежнему authority без потери прогресса или прав.

`future_release_checklist`: реальные два устройства/аккаунта, выбранная SDK/Pay compatibility, физическое/официальное store-channel restore, действительная статистика потерь/restore success, migration evidence и агрегированное наблюдение после выпуска. Всё это **не выполнено** и находится вне текущей local-only поставки. Право на publication или production/server changes эта карточка не даёт.

Остаточные ограничения: собственный cross-device gameplay restore не внедрён; существующий `/api/save` не принят как безопасная основа полноценного облака; token/profile recovery отсутствует в найденном client flow; статистика restore gap не измерена. Эти факты не скрываются утверждением о «работающем backend cloud».
