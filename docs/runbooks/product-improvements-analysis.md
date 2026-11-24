# Slova: анализ состава уровней и отказов слов, draft point 3

`scripts/analyze-product-improvements.cjs` строит агрегированные JSON и Markdown
по локальным сырым данным без сети и дополнительных зависимостей. Он использует
`normalizeRecord` и связь install episodes из существующего
`scripts/analyze-retention.cjs`; прежняя retention-семантика сохранена.
Пункты 4–7 драфта, экономика, словарь, реклама и UX приложения здесь не меняются.

На 04.11.2026 пригодной локальной выгрузки сырых событий Slova нет. Live lookup
app 6321823 преимущественно показывает 0.1.28; доставка локальной 0.1.29/schema 3
не подтверждена, Logs UI показывает недоступные данные. Основание —
[production-rollout.json](../../output/product-improvements-2026-11-04/production-rollout.json).
Сводные количества пользователей/событий и выгрузка другой игры не заменяют
player/attempt данные. До их получения отчёт имеет статус `needs_raw_data`,
а измеренные значения отсутствуют.

## Запуск

Полная неделя задаётся начальной датой и ровно семью календарными днями.
Правая граница не входит в неделю. Периоды должны идти последовательно,
не пересекаться, и полностью закончиться к `--as-of`.

```powershell
node scripts/analyze-product-improvements.cjs --input C:/private/slova/events.jsonl --input C:/private/slova/installs.json --baseline-start 2026-10-21 --current-start 2026-10-28 --timezone UTC+03:00 --as-of 2026-11-04T12:00:00+03:00 --source production --output C:/private/slova/reports/point3
```

Получатся `point3.json` и `point3.md`. `--input` можно повторить; файлы читаются
совместно и дедуплицируются. Аргументы, неподдерживаемые форматы, отсутствие
файла, некорректный JSON/CSV и попытка перезаписать входной файл завершаются
ошибкой. Текст payload в сообщениях ошибок не печатается.

`--source` — `observation` (по умолчанию), `production` или `synthetic`. Это
заявление об источнике, не независимая проверка rollout. `--bootstrap-reps`
задаёт от 100 до 5000 повторов, по умолчанию 500. Остальные перечисленные
аргументы обязательны; `--as-of` никогда не берётся из часов компьютера.

Для честного артефакта недоступности данных:

```powershell
node scripts/analyze-product-improvements.cjs --needs-raw-data --baseline-start 2026-10-21 --current-start 2026-10-28 --timezone UTC+03:00 --as-of 2026-11-04T12:00:00+03:00 --output output/product-improvements-2026-11-04/p3/analysis-needs-raw-data
```

Этот режим несовместим с `--input`, возвращает `metrics: null` и список нужных
данных. Он не создаёт нулевые production-метрики. Development-примеры помечены
`synthetic`, являются наблюдением над искусственной фикстурой и ничего не
говорят о реальных игроках.

Timezone — фиксированный offset (`UTC+03:00`, `+03:00`, `UTC`, `UTC-04:00`),
а не IANA/DST зона. Это явно выбранный календарь анализа. Его совпадение с
timezone AppMetrica UI не подтверждено. `--as-of` означает заявленный конец
**полностью выгруженного** наблюдения. Максимальное время одной записи не
доказывает полноту выгрузки. Для последних попыток недели может понадобиться
следующий день наблюдения, иначе 24-часовое окно останется незрелым.

## Вход AppMetrica Logs

Поддержаны `.jsonl`/`.ndjson` (объект на строку), `.json` (массив, объект
`{"data":[...]}`, `{"events":[...]}`, `{"rows":[...]}` или один event), `.csv`
(comma-separated, snake_case заголовки, стандартные кавычки и `""` внутри).
CSV сохраняет UInt64 ID строками и поддерживает JSON/переносы строк в кавычках.
JSON-число UInt64, уже потерявшее точность, не восстанавливается догадкой:
SDK ID должен быть строкой. Если исходный экспорт имеет другие имена колонок,
привести их к этому контракту локально, сохранив исходник.

| Колонка | Нормализованное назначение |
|---|---|
| `appmetrica_device_id`, `sdk_id`, приоритетный `device_key` | SDK player/cluster ID, строка UInt64; local `player_id` не используется |
| `event_name` / `name` | Имя события |
| `event_json` / `params` | Объект или JSON-строка параметров AppMetrica custom event |
| `event_timestamp` | Unix seconds/milliseconds |
| `event_datetime` / `occurred_at` | ISO UTC/offset, если timestamp отсутствует |
| `app_version_name` | SDK версия при доставке; отдельный fallback для P3 только при отсутствии origin `app_version` envelope |
| `installation_id` / `install_key` | Подтверждённый эпизод установки |
| `install_timestamp`, `install_datetime`, `installed_at` | Реальное время установки |
| `install_kind` / `install_type` | `first`/`first_install`, `reinstall`, `reactivation`, `unknown` |
| `is_reinstallation` | Явный boolean; CSV `true`/`false` преобразуется в boolean |
| `record_type: install` / `session` | Строки SDK install/session выгрузки |

Legacy payload плоский; schema 2 хранит доменные поля в `properties`, schema 3
хранит их в корне. `event_id`, `occurred_at`, `app_version`, `content_version`,
`onboarding_version`, `device_key`, `install_key`, `time_trust` читаются с
сохранением существующих retention-правил. `occurredAtMs` имеет приоритет.
`timeKnown:false`, `time_known:false`, `time_trust: occurrence_unknown` и
отложенный calendar-only milestone не становятся точным временем победы.
SDK handoff/session duration не используется вместо `activeTimeMs`.

Для P3 `analysisAppVersion` берётся из валидного immutable `app_version`
schema 2/3 envelope: очередь/replay сохраняет версию возникновения события,
тогда как SDK `app_version_name` может уже относиться к обновлённой сборке.
Если origin отсутствует, используется SDK fallback; явно заданный невалидный
origin не подменяется SDK и исключается из exact strata. `versionProvenance`
показывает origin/fallback/invalid/unknown, `sdkReportedAppVersions` и
`originSdkVersionMismatches` показывают расхождения отдельно. Разные origin
версии не объединяются из-за одинаковой SDK версии доставки. Старое поле
`appVersion` retention сохраняет прежний приоритет SDK, его поведение не меняется.

Пример строки Logs, **искусственный**, без реального игрока:

```json
{"appmetrica_device_id":"example-sdk","event_name":"word_submit_outcome","event_datetime":"2026-10-21T09:00:00Z","app_version_name":"0.1.29","event_json":"{\"schema_version\":3,\"event_id\":\"example-event\",\"occurred_at\":\"2026-10-21T09:00:00Z\",\"attemptId\":\"example-attempt\",\"levelKey\":\"campaign:10\",\"mode\":\"campaign\",\"contentVersion\":\"main-v1\",\"content_fingerprint\":\"fp_0123456789abcdef\",\"manual\":true,\"kind\":\"invalid\",\"reason\":\"not_in_dictionary\"}"}
```

Для расчёта нужен весь связанный набор событий, а не только строки ввода:
`puzzle_started`, `puzzle_resumed`, `puzzle_completed`, checkpoints/pauses/exits,
`help_used`, `target_word_accepted` и SDK install/session metadata. Разрешено
подать контекст до начала baseline, чтобы присоединить carried attempts;
нельзя объявлять первый увиденный custom event установкой.

## Единицы, покрытие и сравнение

Поддерживаемые mode для точного сравнения: campaign (`normal` — известный
alias), daily, practice, training, challenge, weekly, event. Другие явно заданные
mode остаются в распределении `other`, но **не** входят в exact strata:
разные неизвестные режимы нельзя сравнивать после такого обобщения. Их число
показано в `manualInputs.coverage.unsupportedMode`, отсутствие mode — в
`unknownMode`. Явный неподдерживаемый mode имеет приоритет над legacy
`daily:false`/`daily:true` для P3 и не заимствует campaign/daily у entry.
Прежнее поле `mode` и расчёты retention этим не изменены.

`weeks[].attempts` — уникальные SDK player + install episode + `attemptId`,
**активные внутри недели** по старту, resume, вводу или checkpoint/другому
событию с известным временем. Долгая попытка может попасть в обе недели.
Отдельно показаны новые старты и resumed attempts без наблюдаемого старта.
Legacy события без `attemptId` не создают выдуманные попытки.

Распределения разделены на `intro`, `main_campaign`, `campaign_unknown`,
`daily`, известные другие режимы и unknown. По каждой группе выводятся уровни,
диапазоны прогресса, median/P75 и покрытие номера уровня. Daily level number
не является продвижением по основному маршруту. High difficulty — tier 4–5
среди **известных** tier; рядом есть доля попыток с известной сложностью.
При нулевом покрытии high share равен `null`.

`difficulty_tier`, `difficulty_role`, `mechanic`, `letter_count`, `target_count`
присоединяются только из `puzzle_started/resumed` по точному player/install/attempt.
Они не требуются в каждом вводе. Взаимно заданные identity-поля проверяются
по всем событиям attempt, включая случай без entry. При противоречии уровня,
контента или режима недостающий контент не наследуется от другого уровня:
exact-stratum исключается, а conflicts/missing puzzle identity для completion,
active time и help показаны отдельно, без выдуманной неуспешной попытки.
Надёжного соответствия runtime `fp_<16 hex>` и raw catalog fingerprint сейчас
нет, поэтому каталог не присоединяется догадкой.

В знаменатель input rates входят только `word_submit_outcome`, явные manual
(`manual:true` либо `autoOrManual:manual` без противоречия), поддержанный
завершённый outcome, SDK identity и известное occurrence time. Outcomes:
`invalid`, `grid`, `bonus`, `duplicate`, `blocked`, `constraint`. Accepted —
`grid+bonus`; nonAccepted включает также duplicate/blocked/constraint.
`word_submitted`, `word_found`, `wrong_word`, жесты и auto outcomes не заменяют
завершённый manual outcome. Неизвестный manual status/outcome/identity/time
показывается отдельными quality/coverage счётчиками.

Reasons ограничены engine enum: empty, too_short, too_long, malformed,
not_constructible, not_in_dictionary, wrong_order, profanity, slur_or_insult,
proper_name, abbreviation, non_lemma, low_quality, manual_deny. Всё остальное
становится `unknown`, отсутствие — `missing`. Есть counts/coverage для invalid,
blocked и constraint. Текст слова, raw fingerprint, email и player ID не
попадают ни в JSON, ни в Markdown. Content reference — вторичный digest для
агрегированной идентичности. Разрешены только структурированные level keys.

Доставка дедуплицируется по SDK ID + `event_id`; повтор одного
`submission_id` в одном player/install/attempt — по этой связке. Противоречивые
copies outcome исключаются из rates и разрывают известную input sequence.
Genuine repeated inputs с разными submission IDs остаются наблюдениями.
QA/test/development/debug/preview строки исключаются по явным флагам/среде;
неизвестная среда видна в quality. Повторные installs раздельны, конфликтующая
привязка к установке исключается.

Exact stratum содержит `levelKey` + доступные `contentVersion` и fingerprint +
mode + intro/main group + event-time app version + new/returning/unknown +
`policyRevision`/unknown. Наличие только версии или только fingerprint допустимо,
но отсутствие одного поля остаётся отдельной идентичностью; оно не объединяется
с известным значением. Разные версии приложения/контента не объединяются.

New означает подтверждённый first-install episode, начавшийся внутри данной
недели. Returning — подтверждённая более ранняя first install либо явно
classified reinstall/reactivation. Без установки/classification — unknown,
а не new. SDK first_open можно использовать вместе с реальными install metadata;
сам по себе первый наблюдаемый first_open/custom event не доказывает установку.
`install_day` fallback имеет существующий календарь UTC+3; в другом timezone
нужен точный `installMs`, иначе player class остаётся unknown.

Raw rate использует все пригодные manual inputs. Для exact baseline strata
замораживаются input веса `w_s = N_baseline,s / N_baseline,exact`.
На common support C они одинаково нормируются в обеих неделях:

```text
w_C,s = w_s / sum(s in C) w_s
fixed_week,C = sum(s in C) w_C,s * rate_week,s
within_C = fixed_current,C - fixed_baseline,C
mix_C = raw_current,C - raw_baseline,C - within_C
```

Это **условная ставка на common coverage**, не процент всей популяции.
Отдельно выводятся исходные raw rates/change, exact coverage, common coverage
обеих недель, исключённый baseline weight, новые unmatched strata/levels и
`null` отсутствующего наблюдения. `outsideCommonResidual` — арифметическая
разность full raw change и conditional common change, вклад вне покрытия
остаётся неизвестным. Это не причинная декомпозиция.

Медианные invalid/nonAccepted shares рассчитаны отдельно на игрока и attempt:
каждая единица имеет один голос независимо от числа вводов. Эти медианы не
равны input-weighted raw rates.

## Время, цензурирование, помощь и неопределённость

Inputs until next accepted включают принимающий ввод. Известная sequence
начинается на наблюдаемом старте или после известного accepted ввода. Prefix
resumed/carried attempt — left-censored; хвост без следующего accepted —
right-censored. Pause/exit, неизвестный manual/outcome, граница недели/экспорта
разрывают последовательность. Одинаковые input timestamps либо неизвестное
время ввода исключают неоднозначную последовательность; completion quantiles
считаются отдельно от censored tails.

P50/P90 active time используют только `puzzle_completed` с
`time_coverage: full_attempt` и конечным неотрицательным `activeTimeMs`.
Since-restore/mixed-consent, unknown coverage, отсутствие active time и unknown
occurrence time показаны отдельно; они не становятся нулями или wall time.

Completion 24h: cohort — известные **новые** `puzzle_started` данной недели;
успех — `puzzle_completed` того же player/install/attempt в пределах 24 часов.
Resume не добавляет denominator; победа перезапуска с другим attempt не
завершает исходный. Нужны полное окно до cutoff и отсутствие reinstall boundary.
Immature/censored/unknown-time/conflicting identity исключены отдельно.
Незавершение в окне не означает окончательный уход.

Help→progress 10m — диагностический показатель: первый `help_used` на attempt
в неделе → `target_word_accepted` либо completion **той же** попытки за 10 минут
обычного времени. Исходные ранее завершённые попытки и незрелые/цензурированные
окна исключены. Показатель не реализует primary origin-flow эксперимент из
пункта 5 и не доказывает пользу помощи. Его окно включает рекламу и фон.

Для изменений invalid/accepted и fixed/common mix — детерминированный paired
SDK-player cluster percentile bootstrap с seed `0x51a0a202`. Один multiplier
переносит все вводы/attempts игрока сразу в обе недели, сохраняя корреляцию у
общих игроков. Baseline weights условно фиксированы и не пересчитываются.
95% интервал доступен при минимум **20 разных игроках в каждой неделе**;
для fixed estimates также нужны 20 common-support игроков в каждой неделе
и минимум 80% пригодных bootstrap повторов с наблюдаемыми нужными strata.
Иначе CI — `null` с причиной. Тысяча вводов одного игрока остаётся одним
кластером. Input-independent binomial интервалы не используются.
Квантили — описательные, без обещания статистической значимости.

## API и development-проверка

Экспорты: `analyzeProductImprovements(records, options)`,
`buildNeedsRawDataReport(options)`, `readInputFiles(paths)`,
`renderMarkdown(report)`, `parseArguments(argv)`. Options соответствуют CLI:
`baselineStart`, `currentStart`, `timezone`, `asOf`, `source`, `bootstrapReps`.
Внутренние SDK IDs/attempt keys/исходные input records в возвращаемый отчёт
не входят. Runtime normalizer также сохраняет bounded help context для
повторного использования; новые рекламные/кошельковые funnels здесь не считаются.

```powershell
node --test backend/scripts/__tests__/product-improvements-analysis.test.cjs backend/scripts/__tests__/retention-analysis.test.cjs
node --check scripts/analyze-product-improvements.cjs
node --check scripts/analyze-retention.cjs
```

Проверки включают Simpson mix-only shift и реальный within shift, paired panel,
малое число player clusters, отсутствие/new strata, раздельные app/content/
intro/mode/player strata, manual filter и privacy, delivery duplicates,
censored sequences, active coverage, зрелость 24h, точный help/attempt join,
CSV UInt64 и безопасные CLI ошибки. Это development-верификация реализации;
production measurement gate остаётся закрытым до сырой выгрузки и проверки
полноты доставки.
