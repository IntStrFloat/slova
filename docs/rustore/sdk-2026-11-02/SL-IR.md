# SL-IR — AppMetrica остаётся единственным collector атрибуции

Статус: **accepted_local_decision_and_IR06_synthetic_contract**, 4 ноября 2026; актуальная приёмка root приведена в конце карточки. AppMetrica остаётся единственным collector. Исторические поля исходного решения сохраняются. Решение не утверждает полноту production MMP coverage или успешную доставку referrer с реальной установки.

| Поле | Значение |
|---|---|
| ID | `SL-IR` |
| Local decision | `not_integrate_additional_collector_current_scope` |
| Основание | В существующем AppMetrica 8.6.0 есть RuStore provider; соответствующий код подтверждён в локальном AAB. Доказанного пробела для отдельного collector и безопасного конкурентного чтения нет |
| Source SHA | `52aa1b71622d4a1be7885c9b9ebe644e78f9f4cb` плюс существующие рабочие изменения; SHA-256 проверенных файлов — в evidence JSON |
| SDK version | Используется существующий `io.appmetrica.analytics:analytics:8.6.0`; отдельная версия RuStore Install Referrer не выбиралась |
| Current paths | `plugins/withAppMetrica.js`, `modules/appmetrica/`, `src/core/native/appmetrica.ts`, `src/features/analytics/` |
| Proposed paths / data migration | Нового `modules/rustore-install-referrer`, JS collector, first-touch storage или миграции не добавляется |
| Feature flag / safe default | Не применимо: второго collector/fetch не существует; фиктивный флаг или Noop-интеграция не вводится |
| Изменения итерации | Только эта карточка и [source-decision.json](../../../output/rustore-sdk-2026-11-02/sl-ir/source-decision.json) |
| Ревью | `pending_independent_review`; автор не утверждает собственную карточку |
| Publication | Не запрошена; никаких действий |

## Подтверждённый путь и предел доказательства

AppMetrica 8.6.0 зафиксирован в [plugin](../../../plugins/withAppMetrica.js:13) и [Expo module](../../../modules/appmetrica/android/build.gradle:20). Локальный чистый checkout официального SDK имеет tag `v8.6.0`, commit `d3363343944cdeeed3d1989869abcf1c524aa66c`.

[ReferrerProviderFactory](../../../.omx/tmp/appmetrica-sdk-source-v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/referrer/service/provider/ReferrerProviderFactory.kt:20) выбирает `RuStoreReferrerProvider`, когда Android installer package равен `ru.vk.store`. Provider обращается к [RuStoreReferrerService](../../../.omx/tmp/appmetrica-sdk-source-v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/referrer/service/provider/rustore/RuStoreReferrerService.kt:34): сервис ищется по package/action RuStore, запрос выполняется для package приложения. Parser получает referrer и времена клика/установки, формирует источник `RS`. Внешняя dependency `ru.rustore.sdk:installreferrer` этому встроенному пути не требуется.

[CachedReferrerProvider](../../../.omx/tmp/appmetrica-sdk-source-v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/referrer/service/cache/CachedReferrerProvider.kt:21) использует [VitalReferrerCache](../../../.omx/tmp/appmetrica-sdk-source-v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/referrer/service/cache/VitalReferrerCache.kt:17). Сохраняется результат и признак проверки. Failure также может стать checked state: наличие кэша не доказывает успешную атрибуцию и не обещает повтор запроса после каждого сетевого сбоя.

Повторно проверен сохранённый локальный AAB `slova-0.1.29-vc33-rustore.aab`, SHA-256 `af6abb15d5f0644a7e4c66140b5032c27f281aad189bfe3d5171486611a47ac0`. В `base/dex/classes3.dex` присутствуют Binder action и все три специфичных ключа RuStore referrer payload. Предыдущий [combined audit](../../../output/rustore-sdk-2026-11-02/g0/attribution-crash-audit.json) также сопоставил эти признаки с cached AppMetrica AAR. Его внутренние классы обфусцированы, поэтому поиск необфусцированного имени source class в DEX не подходит для отрицательного вывода.

Это доказательства наличия встроенного пути в исходнике SDK и локальном базовом бинарнике. AAB не является новой сборкой текущего рабочего дерева. Эти проверки не подтверждают фактический installer, RuStore availability, Binder callback, paid/organic/unknown classification или MMP export конкретного пользователя. Наличие dependency само по себе также не считается достаточным доказательством.

Официальные источники были проверены в предыдущем аудите; сетевых обращений в этом проходе не было: [provider factory v8.6.0](https://raw.githubusercontent.com/appmetrica/appmetrica-sdk-android/v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/referrer/service/provider/ReferrerProviderFactory.kt), [RuStore Install Referrer 10.6.1](https://www.rustore.ru/help/en/sdk/install-referrer/kotlin/10-6-1). Документация RuStore отдельно оговаривает version 11. Гарантии 90 дней и независимого повторного чтения не переносятся автоматически на путь v10. Добавлять второй consumer без установленной совместимости опасно из-за возможной конкуренции за первое чтение; сам факт такой гонки на реальном устройстве этой карточкой не заявляется.

## Единственный владелец данных

1. AppMetrica остаётся владельцем install acquisition. Источник, campaign и creative для когорт берутся из подтверждённого MMP install export, а не из последнего push/deeplink или локального profile ID.
2. [Native bridge](../../../modules/appmetrica/android/src/main/java/expo/modules/appmetrica/AppMetricaModule.kt:48) получает SDK `DeviceIdHash` и UUID. [TS adapter](../../../src/core/native/appmetrica.ts:60) сохраняет их строками и отклоняет numeric/coerced или malformed значения. `install_key` не заменяется новым collector install ID.
3. [Analytics identity request](../../../src/features/analytics/index.ts:332) асинхронен, не задерживает старт и повторно проверяет collection gate. Ранние custom events могут иметь `identity_binding_state=unlinked`. Полноту последующего join нужно проверять по SDK identity и install episodes в экспорте; она не выводится из локального callback.
4. Существующий [first_open](../../../src/features/analytics/index.ts:478) вызывает `trackOnce('first_open', 'local_profile')`. [Bootstrap](../../../src/app/_layout.tsx:92) отправляет его для нового локального профиля. Это не второй SDK install event и не доказательство paid first install. Новый `install/first_open` либо `attribution_resolved` ради отсутствующего collector не создаётся.
5. [Assignment экспериментов](../../../src/features/analytics/experiments.ts:29) уже опирается на SDK installation ID. Referrer/campaign не становятся входом для assignment. Return campaign остаётся отдельно от приобретения установки.
6. Для анализа применяются [существующие install-episode правила](../../../docs/runbooks/retention-analysis.md:15): first/reinstall/reactivation/unknown, проверенный device/time join, отдельная новая установка на другом устройстве. Неизвестный источник не объявляется organic только из-за пустого/недоступного referrer; фактическая MMP classification требует внешней сверки. Старые когорты не пересчитываются молча.

Нового JS first-touch schema или parser нет, поскольку отдельный collector отклонён в текущем scope. Проектные allowlist/parser/size/retry тесты из условного дизайна не выдаются за существующую implementation или за PASS.

## Privacy и надёжность

[Текущий native gate](../../../modules/appmetrica/android/src/main/java/expo/modules/appmetrica/AppMetricaPrivacy.kt:52) применяет durable consent до активации. Отказ, QA/debug/emulator/preview или отсутствие configured key не включают production collection. Identifier callback ограничен пятью секундами и проверяет gate ещё раз перед разрешением promise. Outbox и `trackOnce` используют существующий owner, event ID и consent policy.

App bridge не выдаёт raw referrer в JS и не добавляет его в custom schema, crash-log или новый storage. FSA, номер телефона, auth token и отдельная авторизация для collector не подключаются. Внутренний SDK DebugLogger содержит raw-payload шаблоны, поэтому SDK logging остаётся выключенным; эта карточка не включает verbose logging ради диагностики. Секреты, raw strings и пользовательские IDs в evidence не копировались.

Public SDK sending gate не равен purge внутренних баз или отмене in-flight requests: [существующее ограничение](../../../modules/appmetrica/README.md:25) сохраняется. Смена этой документационной ветки не стирает consent, MMP identity, assignment, pending analytics или прогресс.

## Фактические local проверки

| Проверка | Actual result | Покрытие |
|---|---|---|
| Analytics adapter, track/outbox, root telemetry | **PASS — 3 suites, 61 tests**, exit 0 | Строковые SDK IDs, malformed/QA/unavailable handling, consent, stable once/dedup identity, privacy/retry и sticky assignment |
| Application bootstrap: новый и существующий campaign profile | **PASS — 1 suite, 2 tests**, 1 нерелевантный gameplay test skipped, exit 0 | Один `first_open` нового профиля; отсутствие нового `first_open` и сохранение cohort существующего профиля |
| SDK tag/source inventory | Завершён; `v8.6.0`, чистое рабочее дерево | Реальный встроенный provider/cache, а не предположение по dependency name |
| Существующий базовый AAB | SHA-256 совпал; 4/4 выбранных referrer markers присутствуют | Статическое наличие соответствующего native кода; execution/delivery не проверены |

Сохранённый общий G2 analytics прогон не повторялся. Во время сверки обнаружилось изменение schema относительно старого evidence; поэтому выполнен только необходимый актуальный прогон трёх identity/dedup suites. Bootstrap-проверки не были представлены тем прежним прогоном и выполнены отдельно. Точные команды, результаты и текущие хеши — в evidence JSON.

Проверки не запускали RuStore/MMP сеть, устройство, новые build/prebuild, платёж или серверные действия. Они не доказывают end-to-end attribution.

## Приёмка, откат и future release checklist

Локальный результат итерации — evidence-backed решение **не добавлять отдельный collector** при сохранении существующей identity/event/privacy модели. Принимается независимым reviewer после проверки source/binary evidence и тестов. Нет технического изменения, которому требовался бы runtime rollback: нового fetch/writer/dependency не вводилось.

Следующие пункты сохраняются как `future_release_checklist`, **не выполнены** и не блокируют текущую local-only поставку:

- Проверенная размеченная RuStore-ссылка и выделенная тестовая analytics environment.
- Установка через официальный store channel на подходящем реальном устройстве; sideload/`adb install` не проверяет factory selection `ru.vk.store`.
- Сверка paid/organic/unknown, late IDs, offline, reinstall и однозначного install episode по AppMetrica installs + events.
- Проверка реального campaign/creative mapping, временной методики, расходов/валюты и фактического дохода для CPI/LTV.
- Подтверждение отсутствия пропуска source из-за store version, cache failure или задержки согласия; никакого вывода по одной пустой колонке отчёта.

Если такая сверка докажет конкретный MMP gap, открывается отдельная условная итерация: source precedence/provenance и единственный владелец чтения, выбранный SDK protocol/version, untrusted-string allowlist/parser/размер, bounded retry, first-touch persistence и tests. Rollback её collector отключает только новые запросы и сохраняет уже собранные метки с provenance. Это будущий дизайн, а не выполненная интеграция этой карточки.

## IR06 LOCAL — SYNTHETIC join contract, 4 ноября 2026

Сценарий IR06 остаётся обязательным локально при решении без дополнительного
collector: [test-spec](../../../.omx/plans/test-spec-slova-rustore-sdk-2026-11-02.md:121)
требует детерминированную связку attribution → retention / net revenue / cost.
Прежние 61 identity/outbox и 2 bootstrap tests её не заменяют. Указание выше
«только карточка/source-decision» описывает первоначальное решение; этот
отдельный addendum добавляет только локальный analysis CLI, fixture и проверки.

[Тонкий join](../../../backend/scripts/attribution-join.cjs) переиспользует
существующие `normalizeRecord`, `linkInstallEpisodes`, `analyzeRecords` и чистый
billing journal protocol. Новый SDK/collector, app schema, runtime storage,
dependency или backend service не вводится. [SYNTHETIC report с ручным mapping](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-report.md),
[вход](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-input.json),
[aggregate JSON](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-report.json),
[команды/хеши](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-evidence.json).

First touch берётся из явно подтверждённого MMP install fixture с provenance;
return campaign не перезаписывает acquisition, неизвестное не становится
organic. Join использует строковый SDK device + installation episode,
дедупликацию business/event keys, отдельный reinstall и цензурирование прежнего
episode. Финансовый net берётся только из supplied signed settlement по
каноническому backend fact и supplied Boostnet net statement. Gross journal,
standard Revenue copy и SDK impression estimate не складываются как три дохода.
Реальные поля/гранулярность Boostnet этим fixture не подтверждаются.

Метод: **UTC+03:00 calendar D7**, как в существующем retention analyzer.
Это **не elapsed-24h D7 из G4**; объединять их как один эксперимент нельзя.
Доход — от момента install до конца calendar D7, только полная одинаковая
зрелость всей когорты. Явно заданный синтетический VAT parameter 0.25 служит
лишь проверке math/basis и не обозначает актуальную налоговую ставку.

Иллюстративная paid cohort: D7 play **1/2**, сопоставимый расход **12 000 minor
inclusive / 1.25 = 9 600 minor**, CPI **9 600/2 = 4 800 minor (48 RUB)**;
supplied net **7 500 − 2 000 refund + 4 500 Boostnet = 10 000 minor**;
наблюдаемый net ROAS **10 000/9 600 = 1.041666…**. Отдельная SDK estimate
**99 000 minor** не входит в эти 10 000. Все числа вымышленные. Пропущенная
валюта/definition/expense/coverage, несовместимый timezone/basis, несозревшая
когорта или unallocated ledger дают `null` зависимых метрик и причины.

Фактически выполнено: **27 join checks + 24 existing retention/billing
regressions = 51/51 PASS**, ESLint и Node syntax check scoped files PASS.
Сохранены исходный RED и дополнительный RED для трёх fail-closed edge cases,
затем GREEN. По independent review отдельно воспроизведены и исправлены ещё
четыре случая: signed-sum precision, backend observation после as-of,
неподтверждённый unallocated total и совпадение null install IDs. Отсутствующий
явный SDK install key не разрешает attribution/financial join. Самостоятельное
утверждение independent review не заявляется.
Отдельный [independent review — PASS](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-review.md)
проверил финальные SHA, **27/27 join**, **15/15 retention** и **11/11 независимых
probes**. Актуальная additive metadata правка общего retention analyzer
сохранена и проверена reviewer; исходный analyzer этим IR06-проходом не менялся.
Эта проверка закрывает проверяемую локальную часть **IR06**, не live MMP/store
delivery и не реальные финансовые результаты. Реальный campaign/cohort join
остаётся `future_release_checklist`. Атрибуция не доказывает causal effect;
наблюдаемый D0–D7 доход не является прогнозным LTV или прибылью. Production data,
аккаунты/кампании/расходы, сервер, устройство, SDK network и реальные платежи
в этом проходе не использовались.

## Приёмка root — 4 ноября 2026

Принято локальное решение сохранить встроенный RuStore referrer path существующего AppMetrica8.6 без второго collector, нового first-touch writer или install event. Source/AAB markers подтверждают наличие пути, но не выполнение factory selection или acquisition delivery: `adb install` отдельного QA package не заменяет установку с installer `ru.vk.store`. Исторический [source-decision.json](../../../output/rustore-sdk-2026-11-02/sl-ir/source-decision.json) этим addendum не переписывается.

IR06 закрыт в проверяемой локальной части: [независимый PASS](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-review.md) подтверждает27 join /15 retention /11 независимых probes; отдельный combined авторский прогон51 PASS имеет собственный состав. CLI, synthetic вход и [отчёт](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-report.md) связывают acquisition, retention, supplied net revenue и cost без production данных. Метод остаётся **calendar D7 UTC+03:00**, отдельно от elapsed-24h G4. Синтетический VAT0.25 не является налоговой рекомендацией; SDK estimate исключён из net/cost, реальный MMP/finance mapping остаётся будущей сверкой. Краткий общий статус и границы доказательств: [LOCAL-RESULT.md](LOCAL-RESULT.md).
