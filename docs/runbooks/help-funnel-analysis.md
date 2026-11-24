# Slova: паспорта метрик помощи (пункт 5)

P7 добавляет explicit `measurement_phase`/`eligibility_epoch` и отдельный
[experiment analyzer](help-experiment-analysis.md). Baseline/current здесь остаются
названиями P3 comparison weeks; это не enrollment phases. Primary/experiment-return
API требует declared `measurementScopes`; missing phase/epoch/declared scope даёт
unproven, без inferred baseline по отсутствию assignment. Новый aggregate-only
`createHelpExperimentAnalysisContext` принимает arbitrary declared phase range,
не подменяет P6 install-calendar port и сохраняет outside-range outcomes/consent/
private conflict alternatives. Production epochs/allocation/window остаются null/off.
Trial scope требует expected `trialPlanFingerprint` от общего pure helper;
missing/mixed/malformed JS-only `trial_plan_fingerprint` сохраняет assigned units
как unknown и блокирует SRM/effect. Baseline и native reward receipts этого token
не требуют. Подробный config/evidence/guard контракт — в experiment runbook.
Скопированный origin ID в assignment не доказывает original attempt: требуется
strict canonical SDK/install/attempt/content join, также для actual exposure.
Неподтверждённая связь сохраняет arm/ITT N, unknown и bounds. В P7 checkout
stage/reason берётся только из legal included raw copies, а authoritative время
и scope — из reconciled canonical event; excluded копия не может переместить
pre-assignment событие внутрь followup.

`scripts/analyze-help-funnel.cjs` — офлайн-отчёт по всем девяти паспортам из
[драфта](../marketing/slova/analytics/product-improvements-draft-2026-11-04.md).
Версионированный исполняемый источник определений —
[product-metric-passports-2026-11-04.json](../marketing/slova/analytics/product-metric-passports-2026-11-04.json).
Скрипт читает его окна, условия экспозиции, календарные события и контракт
будущего назначения; не включает эксперимент и не подтверждает production rollout.

## Запуск

```powershell
node scripts/analyze-help-funnel.cjs --input C:/private/slova-events.jsonl --input C:/private/slova-sdk-installs.csv --baseline-start 2026-10-21 --current-start 2026-10-28 --timezone UTC+03:00 --as-of 2026-11-04T15:00:00+03:00 --source observation --output output/product-improvements-2026-11-04/p5/help-funnel
```

Поддерживаются JSON, JSONL/NDJSON и CSV через существующий `readInputFiles`
пункта 3. `--input` можно повторять. Файлы не перезаписываются выходным отчётом;
проверяются canonical paths и file identity, включая hard-link aliases; JSON/MD
также не могут ссылаться на один файл.
ошибки JSON не выводят фрагмент приватного payload. SDK UInt64 IDs в CSV
остаются строками. Данные другого приложения и агрегаты event/user не заменяют
сырые события Slova.

```powershell
node scripts/analyze-help-funnel.cjs --needs-raw-data --baseline-start 2026-10-21 --current-start 2026-10-28 --timezone UTC+03:00 --as-of 2026-11-04T15:00:00+03:00 --source observation --output output/product-improvements-2026-11-04/p5/needs-raw-data
```

Без сырой выгрузки `metrics=null`, статус `needs_raw_data`, параметры production
не подтверждены. Synthetic development fixtures запускаются с `--source synthetic`
и явно обозначаются в JSON/Markdown. Даже `--source production` — заявление
вызывающей стороны, не независимая проверка происхождения или доставки.

Требуются две полные упорядоченные непересекающиеся семидневные недели. Даты —
`YYYY-MM-DD`; timezone — фиксированный offset (`UTC`, `UTC+03:00`, `UTC-05:00`),
без IANA/DST. `--as-of` требует timestamp с UTC/offset и должен покрывать конец
второй недели. Это заявленный полный cutoff выгрузки; скрипт не доказывает её
полноту. Разрешён контекст до начала недель и outcomes после них до cutoff.
Опциональный `--bootstrap-reps` (100–5000) передаётся существующему анализу слов.
Окна помощи 10 минут и earned→grant 24 часа не меняются флагом после просмотра
данных. Десять минут пока предложены драфтом; параметры production-теста ещё
не заморожены.

## Вход и покрытие

Используются прежние flat/schema 2/schema 3 правила `normalizeRecord` из
`analyze-retention.cjs`. Новые selected fields добавлены без изменения старой
canonicalization, retention time/version semantics и формулы пункта 3.
В v2 доменные поля находятся в `properties`; в v3 — в корне `event_json`.
Метаданные: SDK identity, установка/классификация, event ID, исходное время,
версия, production environment, `consent_state=enabled`, schema и `time_trust`.
QA/test/dev/preview/staging исключаются. Неизвестные consent/environment/version,
`client_clock_anomaly`, неизвестное время и конфликтующие copies
отражаются как пробелы покрытия, а не как нулевые outcomes.
`time_coverage=since_restore/mixed_consent` описывает полноту **activeTimeMs всей
попытки**, а не разрешение на сбор нового действия. Эта метка и aggregate active
counter не блокируют wall-clock конверсию свежего help/completion/manual-action
с известным исходным временем и действующим event consent. Явно переданный
consent epoch проверяется отдельно: событие до своего epoch, disabled consent,
неизвестное occurrence либо неподтверждённый recovery остаются unsupported.
Законно записанные origin и completion могут находиться по разные стороны
opt-out/opt-in с разными валидными epochs; доказанная победа не стирается меткой
active coverage или чужим disabled событием. Если победа не доказана, известный
consent gap сохраняет unknown outcome. Full-attempt active-time квантили P3
по-прежнему используют только `full_attempt`; формула P3 не изменяется.

Отсутствие результата отдельно проверяется по наблюдаемым consent epochs.
Producer создаёт новый durable `consent_epoch_at` при повторном включении
аналитики после отказа; во время отказа события обычно не попадают в экспорт.
Поэтому legal app_open/другой факт нового epoch может показать прежний разрыв
даже без строки disabled и без origin flow. Индекс строится по SDK/install,
исходным occurrence times и валидным epoch/provenance; не по SDK handoff.
Будущие после `asOf`, чужие SDK/install, QA, clock-invalid и противоречивые
semantic copies не подтверждают непрерывность. Счётчики `legalConsentFacts` и
`observedConsentEpochs` описывают только экспортированное свидетельство.

Для epoch start E последний legal prior-phase факт L строго раньше E ограничивает
возможное начало разрыва. Если результата нет и возможный `(L,E)` пересекает
query, outcome остаётся unknown со знаменателем и bounds. Поздний old-phase
факт после query может доказать, что разрыв начался вне него. При inclusive
deadline L на самом deadline сохраняет неопределённость порядка в миллисекунде;
календарный конец дня исключён. E на конце окна может скрывать действие прямо
перед концом. Current-epoch anchor ровно на E начинает окно после re-enable;
old-epoch anchor в той же миллисекунде не доказывает этот порядок.

Проверка действует только для absence в primary10m, earned24h, grant→help10m
и install/experiment D1/D7. Подтверждённые legal completion/wallet/help/manual
return до или после перехода остаются успехом; observed duplicate credit не
становится неизвестным только из-за gap. Без положительного свидетельства
разрыва зрелый same-epoch ноль остаётся нулём. Историческая initial/null epoch
допустима и не превращается в новую установку или автоматический gap.

Приватные связи: `origin_interaction_id` → отдельные `interaction_id`, `modal_id`,
`screen_visit_id`, `opportunity_id/request_id/operation_id/callback_id`, `spin_id`,
`rewardId`, `transaction_id`; исходный `attemptId` + mode/level/content.
Нужен оригинальный `hint_requested`, где interaction равен origin; продолжения
имеют новые action IDs и сохраняют origin. Цена, баланс и выбранная помощь
фиксируются в оригинальном запросе. Поддерживаются `is_available`, `already_owned`,
`previously_completed`; отсутствующий boolean остаётся неизвестным.
Отсутствие исходной просьбы/связи не восполняется ближайшим событием того же уровня.
Канонический campaign key содержит положительный safe integer и согласуется
с явно переданным числовым `levelId`; daily key содержит реальную календарную
дату и согласуется с mode и переданным `dateKey`. Строковые/невалидные supplied
IDs, невозможные даты и чрезмерно длинные ключи не исправляются догадкой и не
выводятся как публичный level. Exact content требует хотя бы одного общего
совпадающего `contentVersion`/fingerprint и отсутствия противоречий по другим
известным идентификаторам. Непересекающиеся доказательства остаются unknown.
Доверенный согласованный `puzzle_started/resumed` той же SDK/install/attempt
может явно связать оба content identifiers и присоединить сложность. Она не
требуется в каждом hint/input; противоречивые или чужие entry не заполняют её.

Доставка дедуплицируется по SDK/event ID, затем wallet facts по transaction ID,
earned по reward ID, показы по связанной операции. Две разные wallet transactions
— два экономических кредита, даже при равных суммах; повтор той же transaction —
повтор доставки. Конфликтующие copies не выбираются по порядку файлов.
Сигнатура сравнивает фиксированные business fields и исходные version/clock,
исключая SDK sender version и время повторной доставки. Missing→known install
metadata обогащается; противоречащая явная установка остаётся отдельной identity
ambiguity. Replay после обновления приложения не создаёт business conflict.
При разных delivery IDs одинаковая wallet transaction сверяется по всем
используемым immutable context/source/content/amount/clock полям. Missing→known
enrichment допустимо; разные известные значения дают integrity conflict во всех
перестановках входа. Контекст первой доставленной копии не выбирается.
То же правило применяется к semantic earned callbacks и accepted show intents:
сверяются все копии с разными delivery IDs, включая immutable clock/version,
consent/epoch, environment, schema и контекст операции. Разные известные значения
либо явно невалидные метаданные дают один unknown outcome со знаменателем и
границами; согласованное missing→known enrichment допустимо. SDK sender/handoff
и маркер live/recovery не выбирают более удобную копию. QA/test ad-запись сама
не создаёт production-единицу, но при совпадении с production-фактом сохраняется
как приватное отрицательное доказательство, а не исчезает из сверки.

## Девять результатов

| Поле недели | Что считается |
|---|---|
| `wheelEntry` | Origin flows с реальной доступной экспозицией half-visible 1s → принятый wheel/free_wheel tap → wheel_opened с тем же modal и action. Explicit close обрывает окно; unmount при точной навигационной связи допустим. Уникальные SDK players — отдельная диагностика. |
| `readiness.noCoins`, `.wheel` | Ready на входе / все rule-eligible visits, раздельно для overlay и wheel. Ready later не меняет entry state. Время берётся из ready callback, не из длительности позднего выхода; censored exits/open waits отдельно. |
| `show` | Shown / все принятые rewarded show_intent, включая prepare failures. Preload не входит. Pending остаются в all-accepted знаменателе и bounds; отсутствие terminal не создаёт выдуманный timeout. |
| `earnedGrant` | Ровно один положительный подтверждённый coin wallet credit за 24h / все зрелые earned entitlements, включая earned без grant. Earned/grant clocks исходные; даже ранний grant ждёт зрелости. Дубли внутри окна проваливают exactly-one, поздние дубли отдельно проваливают общий integrity gate. |
| `sufficiency` | Реальный balance_after первой подтверждённой связанной награды покрывает исходную цену / deficit flows с этой наградой. Не advertised reward/ожидание/сумма revisions/поздний баланс. |
| `returnHelp` | Возврат/присутствие в исходной попытке и применение выбранной помощи за 10 wall-clock минут после первой награды / все зрелые granted flows, включая не вернувшихся. |
| `primary` | Отдельно proven-first-eligible baseline и assigned-eligible ITT: durable completion точного исходного attempt за 10 wall-clock минут от первой просьбы. Реклама, grant и помощь не являются условиями знаменателя/успеха. |
| `invalidInput` | Completed explicit manual invalid / все supported manual outcomes. Raw/fixed comparison, frozen baseline weights, common support и player-cluster uncertainty берутся непосредственно из `analyzeProductImprovements(records, same options)`. |
| `installReturn.D1/D7` | Exact calendar open/gameplay return / зрелые явно first-install SDK episodes. Новая установка не выводится из первого custom event. |

Wheel bridge проверяет весь путь: frozen origin → qualified exposure → accepted
tap → opened, с одинаковой SDK/install и доказанной exact attempt/content связью.
Согласованности только exposure/open недостаточно. Чужая попытка в одном tap,
непересекающийся контент либо opened без доказанного accepted action оставляют
flow неизвестным; известная конверсия не восстанавливается выбором других строк.
Правильный same-modal/action переход после unmount по-прежнему считается.

Условные funnels диагностические: вариант может менять состав их участников.
Они не заменяют ITT и не доказывают пользу пути по росту открытий/показов.
Все формулы, единицы, окна, maturity, strata и причины отсутствия значений
включены в `definitions.passports` отчёта.

## Первая награда и реальный возврат

Для `sufficiency` и `returnHelp` фиксируется первая подтверждённая связанная
положительная coin transaction. Later grants/revisions никогда не запускают
окно заново и не спасают результат первой выдачи; их число выводится отдельно.
При одинаковом времени нескольких credits порядок первого баланса неизвестен;
transaction ID не является доказательством порядка ledger. При неизвестном
времени раннего grant весь первый anchor неизвестен.
Tied grants также оставляют row 6 неизвестной: нельзя выбрать direct/wheel
provenance первой строки. Grant до исходной просьбы либо до явно связанного
earned callback противоречит цепочке и остаётся unknown; поздняя выдача не
подменяет такой первый факт.

Монеты взаимозаменяемы. Достаточный баланс после grant может включать другие
доходы. `crossedPriceAtFirstGrant` отдельно показывает реальный переход через
цену, не приписывает источнику конкретное последующее списание.

Один `ui_action action=return` — намерение. Для wheel/home требуются accepted
return и последующее authoritative `help_used` точной исходной попытки/выбранного
типа либо подтверждённый arrival. Для direct rewarded coins фактический explicit
`help_used` с `entry_source=no_coins` доказывает применение в той же игре.
Recovery без такого доказательства возвращения остаётся неизвестным.
Поддержан будущий/добавочный `ui_action`: `element_id=help_origin`, `action=arrive`,
`outcome=returned` с исходным контекстом после проверки реального snapshot.
Само сохранённое `HelpFlow.status=returned` доказательством не считается.

## ITT пока не измерен

Будущий контракт пункта 7: durable `first_eligible_request=true`,
`eligibility_version=help_deficit_v1`, `previously_completed=false` до назначения;
явный доступный paid/non-owned deficit и связанный insufficient rejection.
Primary включает каждый назначенный eligible SDK player, даже без exposure/ad/
grant/help. Нужна точная origin-связь назначения с `unit_type=sdk_player`,
implementation experiment ID `slova_wheel_help_clarity_20261104`, assignment ID,
variant и одна явно согласованная положительная allocation version.
Human protocol reference — `EXP-SLOVA-20261104-WHEEL-HELP`.
Назначение и durable first-eligible claim принадлежат одной логической
транзакции первой просьбы: immutable `occurred_at`/`occurredAtMs` назначения
должен совпасть с замороженным временем исходной просьбы. Будущий producer
пункта 7 обязан фактически решить и сохранить assignment до UI/воздействия;
этот контракт не разрешает задним числом датировать более позднее решение.
SDK observation/handoff/retry может быть позже и сохраняет исходное время.
Без самостоятельного доказательства порядка exposure/treatment/outcome на том
же timestamp либо раньше assignment остаётся unknown. Нет произвольного
допуска в миллисекундах: позднее назначение не становится prospective ITT.

Production allocation version остаётся `null`, эксперимент `draft_inactive`.
Синтетическое доказательство позволяет проверить расчёт без активации теста.
Startup `sdk_install` assignment, earliest observed row и отсутствие старой
победы в усечённой выгрузке не доказывают eligible player. Конфликтующие assignment,
origin, variant, allocation или clocks сохраняют неизвестный ITT outcome/границы
и знаменатель; последний или удобный вариант не выбирается. Потеря original
request у явного target SDK-player assignment также оставляет неизвестную единицу.

`primary.provenFirstEligibleBaseline` и `.assignedEligibleItt` разделены.
`experimentReturn.D1/D7` отдельно якорится на календарный день первой eligible
просьбы/назначения, не установки. Старые игроки остаются участниками; calendar
install retention нельзя выдавать за экспериментальный return guard.

## Календарь и отсутствующие значения

D1/D7 — точный целевой день `[00:00, 00:00 следующего дня)`, не 24 часа и не
кумулятивная неделя. Все единицы ждут конца целевого дня, включая уже вернувшихся.
`installMs` пересчитывается в запрошенный fixed offset. Старый install_day/actionDay
имеет продуктовый календарь UTC+3 и используется без timestamp только при том же
offset; в другой timezone день не угадывается. Open и gameplay whitelists разделены
в config. Reinstall boundary/unknown clocks сохраняют unknown, не доказывают уход.
Gameplay означает добровольное действие: прежние canonical-play aliases исключают
auto/manual=false и `letters_connected`; новый `help_used` требует explicit
provenance, `target_word_accepted` — явного manual. Автоматический start/resume/
completion сам по себе не считается игрой; recovery без доказательства ручного
действия остаётся неизвестным и не переносит прошлое действие на день восстановления.

У каждого результата есть numerator/denominator, known outcome, unknown,
unproven denominator, immature, open/censored, ineligible, coverage и reasons.
Зрелый достоверный `0/N` даёт 0. Нулевой знаменатель, неизвестный context/time/
eligibility или outcome дают `rate=null`; известные denominator units не теряются.
`observedKnownRate` — условная диагностическая доля только известных outcomes;
`bounds` условны на известный знаменатель и не являются confidence interval.
Страты содержат исходную app version/provenance, source/hint, mode/level,
вторичный content digest, known difficulty/player class и diagnostic grant channel.
Для входов сохраняется `entryElement` (`wheel`, `free_wheel`, либо `mixed`),
для ad show/earned — bounded `placement` и известный rewarded channel.
Несколько квалифицированных options остаются одной flow-единицей headline;
`mixed` не удваивает знаменатель. В primary channel равен `not_applicable`,
чтобы последующий free/rewarded путь не делил причинный ITT.
Они не содержат SDK/player/install/origin/attempt/modal/request/reward/transaction/
assignment IDs, raw words, email или raw fingerprints.

## API и development-проверка

Экспорты: `analyzeHelpFunnel(records, options)`, `buildNeedsRawDataReport(options)`,
`readInputFiles(paths)`, `renderMarkdown(report)`, `parseArguments(argv)`.
Options соответствуют CLI. `report.metrics.weeks[0/1]` — baseline/current;
`report.metrics.invalidInputComparison` — оригинальный публичный point 3 comparison.
Возвращённые point 3 результаты не изменяются.

Общие `createCalendarObservationContext` и `validateSdkRecordKind` используются
weekly retention P6. Проверка SDK kind/name действует до metadata exemptions;
обычный P5 и calendar API помещают противоречивые строки только в private
quarantine с `quality.invalidSdkRecords`, без установок, legal positives или
consent-continuity proof. Конфликтные delivery clocks/install/origin/reward scopes
участвуют в candidate joins всех четырёх окон, включая реальный reinstall;
первый или устойчивый внутренний representative не доказывает фактический исход.
Независимый legal return/completion сохраняет existential success; возможный
второй distinct credit сохраняет unknown для exactly-one earned→grant. Формулы,
паспорт и повторно используемый point 3 расчёт остаются прежними.
Два независимых legal positive coin credits с разными transaction IDs, точной
SDK/install/reward/origin связью и внутри зрелого 24h окна уже доказывают known
duplicate failure: третий возможный credit не меняет bounds `[0,0]` на unknown.
Possible scope match и credit с конфликтными copies не входят в эти два proof;
неизвестный или незрелый earned anchor сохраняет unknown/immature.

Earned/credit proof требует известного однозначного resolved install scope;
два отсутствующих scope не становятся exact match. Inferred scope при возможном
unknown-clock peer остаётся неизвестным. Mature earned без такого scope сохраняет
`N` и bounds `[0,1]`, а actual-duplicate diagnostics считают только доказанные
scoped distinct credits. `reward_integrity=coverage_gap` блокирует готовность при
неразрешённых/конфликтных данных, но не доказывает потерю или дубль денег;
`failed` означает доказанный scoped duplicate, а не просто отсутствие metadata.

```powershell
node --test backend/scripts/__tests__/help-funnel-analysis.test.cjs backend/scripts/__tests__/product-improvements-analysis.test.cjs backend/scripts/__tests__/retention-analysis.test.cjs
node --check scripts/analyze-help-funnel.cjs
node --check scripts/analyze-retention.cjs
node node_modules/eslint/bin/eslint.js --no-ignore scripts/analyze-help-funnel.cjs scripts/analyze-retention.cjs backend/scripts/__tests__/help-funnel-analysis.test.cjs
```

Это development-проверки: реальные производственные значения требуют сырой
выгрузки и подтверждения rollout/покрытия. Пункт 5 не выполняет weekly D14/
checkout задачи пункта 6 и не реализует assignment/активацию пункта 7.
