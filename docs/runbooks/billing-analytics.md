# Серверная аналитика подписки «Слова»

Реализация: `backend/runtime/billing-analytics.cjs`. Проверенные платежи, продления,
возвраты, отключение автопродления и истечение доступа фиксируются атомарно в
`analytics.events` того же durable billing journal. Provider callbacks остаются
источником финансовой истины; открытие браузера и клиентские события не создают
платёж. Повтор webhook, timer или restart не создаёт второй business fact.

## Привязка и отказ

Авторизованный клиент отправляет `POST /api/billing/analytics-binding`:

```json
{"consent":true,"deviceId":"18446744073709551615","installationId":"sdk-installation-id"}
```

Используются SDK identifiers, а не nickname, email или локальный player_id.
UInt64 device ID всегда строка. Endpoint наследует Bearer-аутентификацию профиля,
не принимает чужой userId и отвергает дополнительные поля/невалидные значения.
Ответ: `{"consent":true,"bound":true}`.

`{"consent":false}` очищает binding и запрещает недоставленные события. Отдельное
согласие на условия оплаты не подменяет согласие на поведенческую аналитику.
Последующее согласие или смена installation ID действует только для будущих
фактов: исторические unlinked/pending records не привязываются задним числом.
Продления без открытого приложения используют последний действующий binding.
Test billing факты сохраняются для сверки, но не уходят в production AppMetrica.

Внешний payload ограничен whitelist: pseudonymous business keys, тип факта,
сумма в копейках, RUB, product ID, server timestamps/build и originating SDK
installation ID при наличии. В нём нет billing user ID, email, recovery code,
номера/URL счёта, receipt fields или gateway metadata. Приватный billing journal
продолжает содержать данные, необходимые для обслуживания подписки; его не
коммитить и не прикладывать к общедоступным отчётам.

## Включение доставки

На сервере нужен **отдельный Post API key** приложения 6321823. Клиентский SDK key
не подходит. Существующие секреты не переносятся в git. В конфигурации сервера:

```text
APPMETRICA_SERVER_EVENTS_ENABLED=1
APPMETRICA_APPLICATION_ID=6321823
APPMETRICA_POST_API_KEY=<dedicated server key from local secret storage>
```

Значения по умолчанию в `backend.env.example` оставляют доставку выключенной.
Эта реализация не выпускала ключ и не меняла конфигурацию живого сервера.

Timer раз в минуту вызывает `billing.flushAnalytics()`. Конкурентные ticks
объединяются. Перед отправкой заново проверяются binding/consent и payload.
Истечение оплаченного периода наблюдается сервером даже без клиентского запуска.

Для одного факта предусмотрены два независимых представления:

- Custom `subscription_server_event` через
  `https://api.appmetrica.yandex.ru/logs/v1/import/events.csv`.
- Единственный standard Revenue канал через `/logs/v1/import/revenue.csv`:
  `subscription_started`, `subscription_renewed`, `refund`, `cancellation`,
  `expired`. В custom ledger возврат имеет отрицательный `amount_minor`, а в
  Revenue направлению соответствует тип `refund` с положительной ценой.

Эти представления **не складываются как два дохода**. Клиент не отправляет вторую
standard Revenue запись. Рекламный Ad Revenue этим модулем не производится.
Серверные события имеют background session type и не изображают игровой визит.

Основание протокола:
[Custom events](https://appmetrica.yandex.ru/docs/ru/mobile-api/post/post-import-events),
[Revenue](https://appmetrica.yandex.ru/docs/ru/mobile-api/post/post-revenue),
[ограничения](https://appmetrica.yandex.ru/docs/ru/mobile-api/post/restrictions).
Post API принимает только уже известные SDK идентификаторы и события не старше
14 дней. Устаревшие записи получают `outside_import_window`; дата факта не
подменяется сегодняшней ради загрузки.

## Доставка и сверка

У каждого факта отдельно `status` (custom) и `revenueStatus`. Значения:
`pending`, `delivered`, `rejected`, `uncertain`, `not_eligible`,
`consent_revoked`, `outside_import_window`, `invalid_payload`.

API не документирует идемпотентный import по event_id. Поэтому запись переводится
в `uncertain` **до** HTTP. Timeout, смерть процесса или неоднозначный 5xx не
вызывают автоматический повтор: иначе сервис может принять факт дважды.
Определённый HTTP 400/403/429 записывается как `rejected`. Вызов transport не
печатает URL с ключом, device ID, ответ сервиса или payload.

После сверки по `event_id` / stable numeric transaction ID оператор может вызвать
process-local `billing.reconcileAnalyticsImport(eventId, imported, channel)`:
`channel` — `event` или `revenue`; `imported=true` подтверждает доставку,
`false` разрешает один новый dispatch. Сначала установить факт приёма по экспорту
AppMetrica с учётом его задержки. Публичного HTTP endpoint для этого нет.
Отозванное согласие имеет приоритет над повтором.

`billing.analyticsDiagnostics()` возвращает только агрегаты состояний.
Server ledger сохраняет unlinked факты для финансовой сверки; неизвестная связь
не становится нулевой выручкой и не привязывается к выдуманному SDK пользователю.

Проверка:

```powershell
node --test backend/__tests__/billing-analytics.test.cjs
npm run backend:test
```
