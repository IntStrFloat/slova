# Weekly install retention — point 6

`scripts/analyze-weekly-retention.cjs` — локальный offline-анализ недельных
SDK first-install когорт Slova: D1/D7/D14, открытие и добровольная игра,
размер группы, неопределённость, исходная версия и источник привлечения.
CLI ничего не отправляет, не меняет игру и не создаёт расписание.

Реальная сырьевая выгрузка Slova для этого анализа пока отсутствует.
`buildNeedsRawDataReport(options)` и пустой массив возвращают
`status: needs_raw_data`, `metrics: null`. `source: synthetic` всегда явно
маркируется как development fixture; `source: production` не является
проверкой происхождения. `productionMetricsVerified: false` во всех режимах.
Серверный платёжный журнал и статус доставки серверных событий не являются
выгрузкой установок/возвратов и не заполняют retention.

## Вход и происхождение

Используется проверенный парсер P3/P5: JSON array / `{data:[...]}` / JSONL /
NDJSON / CSV с уникальными snake_case заголовками. UInt64 SDK IDs сохранять
строками. JSON unsafe numeric ID не округляется в достоверную identity.
Исходные файлы не изменяются; direct/symlink/hardlink aliases входа и выходов,
а также взаимный alias JSON/Markdown результатов отклоняются до записи.

| Вход | CLI | API `record_type` | Время |
|---|---|---|---|
| SDK installations Logs | repeatable `--installs path` | `install` | `install_timestamp` Unix seconds; либо `install_datetime` с явным UTC/offset |
| SDK sessions_starts Logs | repeatable `--sessions path` | `session` | `session_start_timestamp`; либо `session_start_datetime` с явным UTC/offset |
| Custom events / уже размеченная смесь | repeatable `--input path` | явный тип для SDK, без него запись не становится SDK installation | исходный v2/v3 occurrence и его provenance |

Тип файла — заявление caller о соответствующем SDK export, не независимая
аутентификация. Противоречащий `record_type` в `--installs/--sessions` отвергается.
SDK `event_name` и `name`, если переданы, должны совпадать с `install` или
`session_start` соответственно. Общее строгое правило
`validateSdkRecordKind` применяется до SDK schema/consent exemptions.
Weekly API/CLI полностью отклоняет конфликт общей ошибкой до записи результатов;
это относится и к `--sessions`. Обычный P5 API и exported calendar context
сохраняют такую строку только в приватном quarantine: возможный исход остаётся
unknown, `quality.invalidSdkRecords` показывает проблему. Quarantine не создаёт
установку, legal return или consent continuity. Независимый подтверждённый
возврат остаётся успехом; genuine SDK sessions остаются open-only.
Не следует маркировать custom `sdk_install`/`app_open` как SDK install metadata.

Минимальный установки набор: `appmetrica_device_id`, `installation_id`,
`install_timestamp`, `app_version_name`, **оба** `is_reinstallation` и
`is_reattribution`. Boolean и точные строки `"true"`/`"false"` поддерживаются
локальным SDK adapter. Legacy normalizer не менялся. Первой установкой считается
только `false/false`. Reinstall и reattribution не создают нового игрока;
missing/invalid flags оставляют классификацию неизвестной, даже если custom
строка содержит `install_kind: first`. Это консервативный контракт анализатора.
Официальный [Logs installations](https://appmetrica.yandex.ru/docs/en/mobile-api/logs/ref/installations)
описывает эти поля и секунды Unix; [attribution policy](https://appmetrica.yandex.ru/docs/en/mobile-tracking/policy)
описывает reattribution существующих пользователей.

SDK export не несёт custom-event envelope `environment`. Для отдельных SDK
файлов разрешён `--sdk-environment production` после проверки области выгрузки
caller. По умолчанию он `unknown`. Явный QA/test исключается; отсутствие
достоверного production scope делает исход известной first-install единицы
неизвестным. Attestation не перезаписывает явную среду. JSON показывает
record-declared/caller-attested/unknown counts и
`environmentAttestationVerified: false`. Custom события сохраняют собственные
environment/consent/schema/original-occurrence проверки P5. Неизвестный custom
consent, отключённый consent и неизвестный SDK consent диагностируются отдельно;
SDK metadata не приписывается фиктивный custom opt-in.

Для privacy-minimal SDK session export нужны SDK identity, original session
start timestamp и, если доступен, installation ID. Иначе разрешена только
однозначная связь с SDK install-time interval. Это [SDK session starts](https://appmetrica.yandex.ru/docs/en/mobile-api/logs/ref/sessions_starts),
а не произвольный custom `app_open`. Оба могут входить в объявленную `open`
метрику, но `quality.sdkSessionRecords` и `customAppOpenRecords` разделены.
SDK session duration не используется как активное время решения.

Не запрашивать IP, рекламные IDs, profile/email, click URL, raw слова.
Они не нужны для расчёта. Public JSON/Markdown содержат только агрегаты,
ограниченные числовые версии с provenance и безопасные source references.
SDK/player/install/event IDs, tracker names/URLs и исходное содержимое не
выводятся. Исходные join IDs остаются только в памяти процесса.

## Версия и первичный acquisition

Версия — только `app_version_name` **SDK установки**, в ограниченном числовом
формате, с provenance `sdk_install_app_version`, missing, invalid или conflicting.
Версия return event, SDK sender после upgrade и текущая app version не подменяют
её. Повторные согласованные metadata строки могут обогащать missing поля;
конфликтующие известные значения не выбираются по порядку файлов.

Primary install attribution использует только поля исходной установки:
`publisher_id`, `publisher_name`, `tracking_id`, `tracker_name`,
`attributed_touch_type`. Поздняя reinstall/reattribution source не переписывает
first cohort. SDK publisher/tracker IDs приоритетны для устойчивого reference;
если их нет, private names могут дать hashed reference. Raw значения наружу не
попадают. Конфликт metadata даёт unknown с
`conflicting_sdk_install_attribution` и не разрывает одну sampling единицу.

Отсутствие attribution — `unknown`, не organic. Для отдельно проверенных
неприписанных/organic SDK установок caller может добавить в **install metadata**:

```json
{ "attribution_classification": "organic", "attribution_verified": true }
```

Разрешены `organic`, `unattributed`, `attributed`. Без явного verified boolean
или точной string `"true"` декларация не доказывает класс. Это дополнительная
caller annotation, а не колонка официального Logs endpoint и не независимая
проверка анализатором. Organic/unattributed, противоречащие реальным attribution
полям, дают unknown. `attributed_touch_type: unknown` сам по себе не доказывает
ни organic, ни конкретный канал. UI `entry_source`, domain `source` и CLI
`--source observation|synthetic|production` не являются acquisition.

Разрезы `weeks[].strata.versions`, `.acquisition`, `.versionAcquisition`
показывают `firstInstallUnits` и все D1/D7/D14 open/gameplay outcomes. Comparison
сопоставляет те же ограниченные dimensions между неделями, включая unknown.

## Единица, календарь, maturity и unknown

Повторные строки и first-install episodes одной SDK identity не независимые
люди. Анализ объединяет SDK/install aliases в одну sampling единицу;
повторный install ID на разных SDK identities остаётся одной ambiguous единицей.
Несколько противоречащих первых episodes не превращаются в несколько игроков.
Когда все возможные install дни относятся к одной неделе, mature unknown outcome
сохраняется в её `N`. Неизвестное время или разные возможные недели не позволяют
выбрать удобную неделю: единица видна в `population.unassignedFirstInstallUnits`
и закрывает full-population comparison gate. SDK installs с неизвестной first
классификацией показаны отдельно; они не объявляются proven first denominator.

Baseline/current — явные полные непересекающиеся семь календарных дней в
переданном fixed offset. `asOf` должен покрывать current install week.
Строка времени без UTC/offset не интерпретируется в локальном часовом поясе ПК.
Legacy `install_day` разрешён только при исходном продуктовом UTC+03:00;
в другом offset из него нельзя восстанавливать install time/day.

Для установки в день I, Dk — `[I+k 00:00, I+k+1 00:00)` в выбранном offset.
Окно не rolling 24h и не cumulative return за k дней. Все единицы, в том числе
ранние успехи, ждут конца своего целевого дня. **Вся недельная когорта** Dk
созрела только к `install-week end + k days`; это вычисляется независимо от
того, какие ранние установки случайно присутствуют в файле. Partial week
помечена в `maturity.Dk` и Markdown, а `rateDifference` и difference bounds
закрыты, если хотя бы одна неделя не созрела полностью. Пустая/неизвестная
группа не создаёт измеренного нуля.

Используется неизменённый P5 calendarOutcome и consent-gap механизм через
additive `createCalendarObservationContext(records, options)`:
private events/episodes/options и consent indexes остаются в замыкании;
`observe({sdkId, installKey, anchorMs, day, gameplay, priorReason})` возвращает
только `{state, success, reason}`. Якорь обязан соответствовать реальному
SDK install origin и installation scope. `day` — safe integer 1..30;
`priorReason` — только внутренние ограниченные коды. Публичный P5 report,
паспорт [1,7] и его формулы не изменены; [1,7,14] принадлежат только P6.

Общий P5 proof handling сохраняет все normalized copies конфликтного
SDK/event-ID delivery в приватном индексе для calendar, primary10m, return/help10m
и earned→grant24h. Противоречащие install поля не выбираются по первой строке;
возможные clocks/install/origin/reward scopes участвуют в candidate joins до
вывода об отсутствии, включая смену реальной установки. Устойчивый внутренний
representative нужен только индексу/диагностике и никогда не доказывает actual
occurrence, install, return или consent continuity. Независимая точная origin
связь может найти возможный outcome, но не делает untrusted copy легальным.
Отдельный неконфликтный legal return/completion сохраняет existential success.
Для earned→grant действует exactly-one: возможный дополнительный distinct credit
оставляет unknown/integrity risk даже при независимом известном credit. Это
correction общего proof handling, помимо additive P6 API; определения и формулы
метрик, P5 паспорт, P3 normalizer и P3 расчёт не меняются.

Подтверждённое добровольное действие доказывает gameplay: P5 canonical-play,
explicit help use, manual target acceptance. Auto start/resume/completion,
manual=false, restore/recovery без ручного действия, letters_connected не
доказывают игру. Legal success на целевой день остаётся положительным до/после
consent transition. Новая наблюдаемая эпоха re-enable может показать opt-out gap,
поэтому отсутствие return внутри возможного разрыва — unknown. Явный disabled,
неизвестный clock/context и reinstall boundary также не объявляются уходом.
SDK session/custom return без достоверного времени и календарного дня нельзя
исключить из целевого дня по dispatch timestamp. Такой кандидат оставляет
отсутствие unknown; отдельный legal positive по-прежнему доказывает return.
Без положительного свидетельства gap зрелый законный ноль остаётся нулём.

## Чтение неопределённости

У каждой строки `N = knownOutcomeUnits + unknownOutcomeUnits` — зрелые единицы.
`numerator` — только legal known returns. `immatureUnits` видны отдельно и не
включаются в mature N; `eligibleUnits` сохраняет размер всей представленной
когорты. При неизвестном исходе headline `rate: null`; диагностическая
`observedKnownRate` имеет только известный знаменатель и не заменяет headline.

Missing-data `bounds = [knownSuccess/N, (knownSuccess+unknown)/N]` показывают
возможный диапазон при неизвестных исходах. Они не оценивают sampling error.
При N=0 bounds и rate null; известный 0/N даёт 0.

Для полностью известных binomial outcomes по distinct SDK first-install units
используется двухсторонний Wilson score 95% с z=1.959963984540054, как в
[NIST confidence-interval reference](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
При N=0 или хотя бы одном unknown sampling interval null. `small_sample` для
N<30 — явная описательная метка, не расчёт мощности и не основание победы.
Например, 0/1 имеет upper около 79.35%; 5/10 — около 23.66–76.34%.
Предпосылки независимого/представительного SDK-unit sampling остаются условием,
а не доказанным свойством данных или независимости реальных людей.

`rateDifference = current - baseline` — наблюдение только полностью зрелых
недель и известных outcomes. Difference missing-data bounds используют
`[current.lower-baseline.upper, current.upper-baseline.lower]` и тоже не являются
CI разницы. Персональный opt-out, неполная доставка и недоказанный rollout не
исчезают из ограничений из-за узкого Wilson interval.
Связь рекламы/словаря/цены с уходом требует отдельного исследования причин.
P7 assignment/request-day D1/D7 остаётся отдельным, неактивным экспериментом.

## Команды и development verification

```powershell
node scripts/analyze-weekly-retention.cjs --installs private/installations.json --sessions private/sessions.csv --input private/events.jsonl --sdk-environment production --baseline-start 2026-10-01 --current-start 2026-10-08 --timezone UTC+03:00 --as-of 2026-11-01T00:00:00+03:00 --source observation --output output/private-weekly-retention
node scripts/analyze-weekly-retention.cjs --needs-raw-data --baseline-start 2026-10-01 --current-start 2026-10-08 --timezone UTC+03:00 --as-of 2026-11-01T00:00:00+03:00 --source observation --output output/weekly-retention-needs-raw
node --test backend/scripts/__tests__/weekly-retention-analysis.test.cjs backend/scripts/__tests__/help-funnel-analysis.test.cjs backend/scripts/__tests__/product-improvements-analysis.test.cjs backend/scripts/__tests__/retention-analysis.test.cjs backend/scripts/__tests__/measurement-quality.test.cjs
node --check scripts/analyze-weekly-retention.cjs
node --check scripts/analyze-help-funnel.cjs
node node_modules/eslint/bin/eslint.js --no-ignore scripts/analyze-weekly-retention.cjs scripts/analyze-help-funnel.cjs backend/scripts/__tests__/weekly-retention-analysis.test.cjs
```

API exports: `analyzeWeeklyRetention`, `buildNeedsRawDataReport`, forwarded
`readInputFiles`, `renderMarkdown`, `parseArguments`, `wilson95`.
Обязательные options: `baselineStart`, `currentStart`, `timezone`, `asOf`;
`source` по умолчанию observation; `sdkEnvironment` по умолчанию unknown.
Выход CLI — `<prefix>.json` и `<prefix>.md`.

Это development verification реализации. Приёмка P6 требует отдельного fresh
SoloReview, исправлений до PASS и последующих formal tests+analysis. Ни наличие
synthetic отчёта, ни прохождение development tests не объявляет P6 принятым.
