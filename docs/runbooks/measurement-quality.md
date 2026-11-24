# Slova: качество измерения, draft point 4

`scripts/analyze-measurement-quality.cjs` строит отдельные JSON и Markdown по
сырым custom events и SDK-сессиям. Это проверка покрытия данных из пункта 4,
без конверсий пункта 5 и retention пункта 6. Существующие
`analyze-retention.cjs` и `analyze-product-improvements.cjs` не меняются:
используются их `normalizeRecord` и общий `readInputFiles`.

Пригодной локальной выгрузки сырых событий Slova на 04.11.2026 нет; доставка
локальной 0.1.29/schema 3 в production не подтверждена. Основание —
[production-rollout.json](../../output/product-improvements-2026-11-04/production-rollout.json).
Выбор `--source production` описывает предоставленный источник и не делает
`productionMetricsVerified` истинным. Агрегаты UI и данные другой игры не
заменяют нужную выгрузку.

## Запуск и границы

Все даты, timezone, cutoff и источник задаются явно. `--date-to` включительно;
внутри используется полуинтервал от начала `date-from` до начала следующего
дня после `date-to`. `--as-of` должен покрывать весь этот календарный период.
Это заявленный полный cutoff выгрузки, а не максимальное время одной строки.

```powershell
node scripts/analyze-measurement-quality.cjs --input C:/private/slova/events.jsonl --input C:/private/slova/sessions.csv --date-from 2026-10-28 --date-to 2026-11-03 --timezone UTC+03:00 --as-of 2026-11-04T12:00:00+03:00 --source production --output C:/private/slova/reports/measurement-quality
```

Результат — `measurement-quality.json` и `measurement-quality.md`. До получения
данных сохраняется честный артефакт с `status: needs_raw_data`, `metrics: null`:

```powershell
node scripts/analyze-measurement-quality.cjs --needs-raw-data --date-from 2026-10-28 --date-to 2026-11-03 --timezone UTC+03:00 --as-of 2026-11-04T12:00:00+03:00 --source production --output output/product-improvements-2026-11-04/p4/measurement-quality-needs-raw-data
```

`--source` обязателен: `production`, `observation` или `synthetic`. Последний
помечает оба отчёта как искусственные development-данные, не live. Режим
`--needs-raw-data` несовместим с `--input`. Пустой экспорт или набор, в котором
все строки исключены, также сохраняет `metrics: null`; причины исключения
остаются в `quality`.

Timezone — фиксированный offset: `UTC`, `UTC+03:00`, `+03:00`, `UTC-04:00`.
IANA/DST зоны не угадываются, timezone компьютера не используется. Для UTC+3
период 28.10–03.11 включает SDK-наблюдения с 27.10 21:00Z до 03.11 21:00Z,
правая граница не входит. Совпадение выбранного календаря с AppMetrica UI
требует отдельной проверки.

Публичный API:

```js
const { analyzeMeasurementQuality, buildNeedsRawDataReport, readInputFiles, renderMarkdown } =
  require('./scripts/analyze-measurement-quality.cjs');
const report = analyzeMeasurementQuality(records, {
  dateFrom: '2026-10-28', dateTo: '2026-11-03', timezone: 'UTC+03:00',
  asOf: '2026-11-04T12:00:00+03:00', source: 'synthetic',
});
```

Функция не меняет входные записи. CLI запрещает перезаписывать входной файл,
включая существующий hard link. Параметры с повтором, неизвестные флаги,
неверные даты/offset, неполный cutoff и ошибки файлов завершаются ошибкой.
Сообщения не печатают содержимое payload. Невалидная отдельная запись считается
исключением качества, а не прерывает весь пригодный экспорт.

## Входной контракт

Форматы и правила CSV/JSON совпадают с
[анализом состава уровней](product-improvements-analysis.md): `.jsonl`,
`.ndjson`, `.json` с массивом/`data`/`events`/`rows`, либо comma-separated CSV с
уникальными snake_case заголовками, стандартными кавычками и JSON внутри
ячейки. UInt64 ID передаются строками. Уже округлённое JSON-число не
восстанавливается; app-local `player_id` не подменяет SDK-идентичность.

| Поля | Назначение в отчёте качества |
|---|---|
| `appmetrica_device_id` / `sdk_id` / приоритетный `device_key` | SDK-устройство для внутренних связей; наружу только количества |
| `event_name` / `name`, `event_json` / `params` | Custom event и его envelope schema 2/3 или legacy payload |
| `event_timestamp`, `event_datetime`, top-level `occurred_at` | Время SDK-наблюдения строки; timestamp seconds/milliseconds либо ISO с UTC/offset |
| `record_type: session` | Явная строка из SDK-сессионной выгрузки |
| `session_start_timestamp` / `session_start_datetime` | Время начала SDK-сессии; для сессии имеет приоритет перед общим clock строки |
| top-level `sdk_session_id` / `session_id` | Идентичность SDK-сессии; fallback — явный session-start clock |
| `app_version_name` | Версия SDK-отправителя; отдельно от immutable envelope `app_version` |
| `environment` | Явное `production` в record/envelope; неизвестное и конфликтующее окружение исключается |
| `is_test`, `isTest`, `is_qa`, `is_qa_device` | Явные признаки теста/QA; boolean или `true/false/1/0` в CSV |
| `consent_state` | Только `enabled`, `disabled`; отсутствие, неизвестное значение или конфликт — `unknown` |
| `consent_epoch_at` | Явный ISO clock начала состояния аналитики; отсутствие, invalid/future clock — unknown epoch |

`record_type` для custom events отсутствует либо равен `event`/`custom_event`.
`record_type: install` находится вне знаменателя этого отчёта. Другие типы
исключаются. Сессионный знаменатель создаёт только `record_type: session`:
custom `session_start` или `game_session_start` его не заменяют. Эти отметки —
контракт входа CLI; не следует подписывать custom-строки как SDK-сессии.

Время внутри payload `occurredAtMs`/`occurred_at` может относиться к старому
действию из очереди. `sdk_handoff_at` описывает локальную передачу SDK. Ни одно
из них не заменяет clock сырой SDK-строки для окна качества. Строка без такого
clock исключается как `missingSdkObservationTime`, даже если бизнес-время
известно. Bare datetime без timezone не принимается. При известном clock SDK
строка может участвовать, даже если бизнес-операция имеет `timeKnown:false`.

Для SDK-сессий production/QA provenance также должен быть явно известен из
источника. Отсутствие `environment` не становится `production` из-за CLI
`--source production`; такой знаменатель остаётся закрыт. Нельзя дописывать
эти атрибуты догадкой. Явные test/QA, известное nonproduction, неизвестное
окружение и нераспознанный явный test flag имеют отдельные счётчики исключения.

## Знаменатели и версии

- `schema.customEvents` и `customEventsByOriginVersionAndSchema` относятся
  только к наблюдаемым custom-фактам/строкам. SDK-сессия не считается ещё одним
  custom event с неизвестной схемой. Схемы — `2`, `3`, `unknown`; missing,
  unsupported и invalid декларации неизвестной схемы показаны отдельно.
- Один `event_id` — один custom-факт. Legacy без ID остаётся отдельной строкой:
  её повторность неизвестна. Известная декларация schema не доказывает
  корректность всех доменных полей — для этого нужны контракты runtime и health.
- `originVersionCoverageOnCustomEvents` использует валидный immutable
  `app_version` распознанного envelope. SDK sender version показана отдельно,
  без подмены origin. Labels ограничены числовыми версиями с 2–4 компонентами;
  другие значения остаются `unknown`.
- `bySdkAppVersion[].v3SdkPlayerCoverage` — SDK-устройства с custom schema 3
  **и** SDK-сессией этой версии / наблюдаемые SDK-устройства с SDK-сессией этой
  версии. Custom-устройства вне сессионного baseline показаны отдельно и не
  раздувают числитель. SDK-устройство — единица связи, не доказанный уникальный
  человек.
- При отсутствии SDK-сессионного baseline для версии, usable identity или
  custom-данных числитель/знаменатель/ставка `null` с причиной. Нельзя объявлять
  нулевое покрытие только по отсутствующей выгрузке. При наблюдаемом baseline
  и usable custom-данных нулевое **наблюдаемое совпадение** допустимо; полнота
  источника всё ещё внешнее условие.
- Одно устройство может участвовать в нескольких версиях/схемах; строки не
  являются разбиением уникальных людей. Один `event_id`, повторно переданный
  после обновления SDK-версии, остаётся одним custom-фактом, но присутствие
  доставки в обеих версиях отражается в sender-version memberships.

Покрытие SDK identity/event ID/origin/sender version/consent и наличие health
имеют отдельные `coverageGates`. Значения нулевого знаменателя остаются `null`.
Статус `observed` означает наличие наблюдений с нужными атрибутами, не успешный
production rollout: `productionMetricsVerified` всегда `false`, gate полноты
AppMetrica ingestion остаётся `external_unverified`.

## Согласия, повторы и health

`consent.counts` и `knownMetadataCoverage` имеют знаменателем только наблюдаемые
custom-факты/строки. Видимое `disabled` — наблюдаемая аномалия для разбора
политики сбора, а не измерение всех отказавшихся. Даже если все события имеют
`enabled`, `populationConsentRate` остаётся `null`, gate — `unobservable`:
отказавшиеся и другие ненаблюдаемые пользователи отсутствуют в логах. Этот
отчёт не предлагает собирать телеметрию в обход отказа.

`quality.repeatedCustomEventIdCopies` считает дополнительные копии сырых
event IDs в выбранном production-scope. Конфликт схемы/origin-version/SDK
identity/consent/health metadata под одним ID исключает все его копии; нельзя
выбрать удобный вариант. Разница SDK sender-version/времени доставки сама по
себе не создаёт нового факта. Это проверка выбранных quality metadata, не
сравнение полного содержимого игровых событий. ID с разным содержимым слова
здесь не анализируется. Ни ID, ни значения введённых слов не попадают в отчёт.

`health.counters` читает только whitelist числовых safe-integer полей
`analytics_health_summary`: missing required, dropped properties, local dedupe,
schema aggregate, queue drops/expiry, exhausted handoffs, handoff/storage
failures. Отсутствующее старое поле остаётся `null`, а не нулём; invalid поля
посчитаны отдельно. `schema_rejected` runtime — исторический составной счётчик
rejected/missing, не число неуспешных событий.

Счётчики накопительные: для каждого SDK-устройства и известного `consent_epoch_at`
берётся максимум каждого поля среди snapshots. Затем максимумы разных
наблюдаемых device/epoch states объединяются; строки с unknown epoch идут
отдельно. Snapshots без SDK identity не добавляются к сумме. Уменьшение счётчика
в порядке SDK-наблюдений отмечается как reset-or-reordering diagnostic и не
создаёт дополнительную сумму: старая snapshot могла приехать позже. При
одновременных конфликтующих snapshots берётся максимум поля и отмечается
неопределённость порядка. Ненаблюдаемые resets unknown epoch восстановить
нельзя. Переполнение safe-integer суммы даёт `null` и `overflowed:true`.

Полученное число включает историю до начала окна и не является incident count
этой недели. Для incident rate нужен отдельный пригодный baseline/delta.
`dedupe_hits` — подавленные локальные calls/queue rows; raw повторные event IDs
— дополнительные копии в экспорте. Они не складываются и не означают дубли
денежного начисления. Handoff failure/acceptance — локальная граница SDK;
`serverAcknowledgementRate` остаётся `null`. Наличие строки в предоставленном
файле само по себе не сертифицирует источник и полноту ingestion AppMetrica.

## Проверка

```powershell
node --test backend/scripts/__tests__/measurement-quality.test.cjs
node --check scripts/analyze-measurement-quality.cjs
npx eslint --no-ignore scripts/analyze-measurement-quality.cjs backend/scripts/__tests__/measurement-quality.test.cjs
```

Тесты охватывают mixed schemas/versions, корректные знаменатели, unknown
consent и внешний population gate, повторные и конфликтующие IDs, UInt64,
накопительные health snapshots/epochs/decreases/delayed delivery, границы
времени, privacy, JSON/JSONL/CSV, независимость от timezone компьютера и запрет
перезаписи входа. Они не подтверждают live delivery и не заменяют независимое
Solo-review всего пункта 4.
