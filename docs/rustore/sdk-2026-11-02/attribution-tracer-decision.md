# SL-IR и Tracer: решение по текущей базе

Дата проверки: 2 ноября 2026. Это результат проверки исходников и существующего локального AAB. Новые SDK, сборки, события и crash-report не создавались. Production-приёмка остаётся открытой.

Машиночитаемое доказательство: [attribution-crash-audit.json](../../../output/rustore-sdk-2026-11-02/g0/attribution-crash-audit.json).

## Проверенная база

- Рабочий HEAD — `52aa1b71622d4a1be7885c9b9ebe644e78f9f4cb`, с существующими незакоммиченными изменениями. Нельзя приписывать весь текущий код этому commit.
- Подключён `io.appmetrica.analytics:analytics:8.6.0`: [plugin](../../../plugins/withAppMetrica.js:13), [bridge](../../../modules/appmetrica/android/build.gradle:18).
- Локальный официальный SDK checkout чистый, tag `v8.6.0`, commit `d3363343944cdeeed3d1989869abcf1c524aa66c`. Путь `.omx/tmp/appmetrica-sdk-source-v8.6.0` является локальным исследовательским материалом, не новой зависимостью приложения.
- Проверен существующий `output/release/slova-0.1.29-vc33-rustore.aab`, SHA-256 `af6abb15d5f0644a7e4c66140b5032c27f281aad189bfe3d5171486611a47ac0`. Его публикация в магазине этой проверкой не установлена.
- Локальный SDK key присутствует, имеет формат UUID и найден в native DEX этого AAB. Значение и отпечаток ключа не записывались. Соответствие ключа нужному проекту в консоли и фактическая доставка событий ещё не подтверждены.

## SL-IR: второй collector пока не добавлять

**Решение:** сохранить AppMetrica владельцем install attribution; отдельный RuStore collector добавлять только при доказанном пробеле. Проверка покрытия исходников завершена, приёмка пары по реальной установке и выгрузке не завершена.

В [официальном исходнике AppMetrica 8.6.0](https://raw.githubusercontent.com/appmetrica/appmetrica-sdk-android/v8.6.0/analytics/src/main/java/io/appmetrica/analytics/impl/referrer/service/provider/ReferrerProviderFactory.kt) installer `ru.vk.store` выбирает `RuStoreReferrerProvider`. Его `RuStoreReferrerService` обращается к Binder RuStore для package приложения, разбирает referrer и времена клика/установки. В этом пути не требуется самостоятельная dependency `ru.rustore.sdk:installreferrer`.

`CachedReferrerProvider` и `VitalReferrerCache` сохраняют результат и признак проверки. Важно: failure тоже может стать сохранённым checked state. Отложенный запуск SDK после согласия не гарантирует восстановление referrer после любого срока или предыдущего неудачного чтения.

В опубликованном AppMetrica AAR внутренние классы обфусцированы. Имена классов из исходников поэтому не встречаются в DEX. В cached AAR и `classes3.dex` проверенного AAB найдены Binder action и все три специфичных ключа RuStore payload. Это подтверждает наличие соответствующего кода в локальном бинарнике; не подтверждает успешное получение referrer от магазина.

[Документация RuStore 10.6.1](https://www.rustore.ru/help/en/sdk/install-referrer/kotlin/10-6-1) отдельно описывает version 11: повторное чтение и хранение 90 дней нельзя автоматически обещать выбранному пути v10. Второй consumer способен конкурировать с MMP за первое чтение. FSA с телефоном в scope не входит.

### Источник истины и идентичность

1. Источник привлечения берётся из AppMetrica install export, а не из открытия уведомления, последнего deeplink или произвольной строки в JS.
2. `device_key` — строковый `DeviceIdHash`, `install_key` — строковый SDK UUID. Native callback ограничен таймаутом и повторно проверяет согласие: [bridge](../../../modules/appmetrica/android/src/main/java/expo/modules/appmetrica/AppMetricaModule.kt:48), [TS adapter](../../../src/core/native/appmetrica.ts:60).
3. До получения обеих идентичностей события могут иметь `identity_binding_state=unlinked`. Поздний callback не доказывает автоматическое связывание уже переданных ранних событий; это нужно проверить в экспорте.
4. Существующий `first_open` — `trackOnce('first_open', 'local_profile')`, вызывается при `newProfile`: [analytics](../../../src/features/analytics/index.ts:389), [bootstrap](../../../src/app/_layout.tsx:92). Это локальное свидетельство, а не дополнительный SDK install event. Второй `install/first_open` ради collector не создаётся.
5. Reinstall/reactivation/unknown учитываются отдельными install episodes по правилам [retention runbook](../../../docs/runbooks/retention-analysis.md:15). Переход на другое устройство не сливает когорты по campaign/referrer. Отсутствие referrer остаётся `unknown`, пока источник не дал достаточную классификацию organic.
6. Push/deeplink return campaigns хранятся отдельно. Referrer не участвует в retention assignment: [эксперименты](../../../src/features/analytics/experiments.ts:32) уже используют SDK installation ID.

Исторический отчёт `first-install-verification-2026-10-18.json` содержит одну click-attributed установку, но `end_to_end_install_test=false`, `postback_delivery_verified=false`. Он предшествует этой базе и не закрывает проверку нового SDK-пути.

### Что остаётся для приёмки SL-IR

Нужны размеченная RuStore-ссылка, выделенная тестовая аналитическая среда и реальная установка через магазин. Обычная `adb install` не выбирает `ru.vk.store` в factory и не проверяет этот транспорт. Нужны выгрузки installs и gameplay для paid, organic/unknown, offline, поздней идентичности и reinstall. Прогресс текущего гостевого профиля ради теста не удаляется.

Выгрузка должна позволять сверить источник/кампанию/креатив, единственный install episode, D7, расходы и фактический доход когорты. Существующий retention analyzer сам по себе не доказывает готовый CPI/LTV по кампаниям. Если обнаружится реальный gap, сначала определить единственного владельца v10-чтения и provenance; затем проектировать allowlisted collector с bounded retry, размером строки и безопасным parser. Старые когорты молча не пересчитываются.

Откат дополнительного collector, если он понадобится, отключает только новые запросы. Уже собранные метки сохраняют provider/provenance; SDK identity, эксперименты, согласие и прогресс остаются у существующих владельцев.

## Tracer: есть пробелы покрытия, второй SDK не выбран автоматически

**Решение:** сначала устранить или измерить пробелы существующего crash reporting. Подключение Tracer не обосновано одним фактом отсутствия его dependency. Одновременно нельзя считать текущее покрытие полным.

| Область | Факт текущей базы | Статус доказательства |
|---|---|---|
| Java/Kotlin unhandled | AppMetrica automatic crash reporting не отключён конфигурацией приложения | Путь есть; реальный полученный отчёт и его читаемость не проверены |
| Native C/C++ | Есть `analytics-ndkcrashes-api`, но это contract с dummy fallback. Реальных AppMetrica native `.so` в AAB не найдено | Полноценный NDK collector не подтверждён; API-зависимость не равна handler |
| ANR | В SDK 8.6.0 `DEFAULT_ANR_COLLECTING_ENABLED=false`; `withAnrMonitoring(true)` приложение не вызывает | Текущий конфиг не включает ANR |
| RN/Hermes JS | Локальный bridge предоставляет custom events/IDs/consent; structured JS exception adapter/global handler не найден | Fatal может стать JVM exception, но полезные JS frames/symbolication не доказаны |
| Source maps/symbols | Hermes source map проверяется локальным verifier; AAB содержит native debug symbols | Архивирование/наличие не равно upload или symbolicated crash |
| Upload/CI | В проверенных scripts/plugins и CI-путях crash upload workflow не найден | Доставка symbol/source map не подтверждена |

Основания: [AppMetrica crash handling](https://appmetrica.yandex.com/docs/en/sdk/android/analytics/android-crash), [Gradle plugin и символы](https://appmetrica.yandex.com/docs/en/sdk/android/analytics/android-gradle-plugin), [SDK source 8.6.0](https://github.com/appmetrica/appmetrica-sdk-android/tree/v8.6.0), [Tracer crashes](https://apptracer.ru/doc/intro/crashes/). При выборе Tracer отдельно проверить фактическую RN/Hermes-поддержку и SDK/version compatibility, а не предполагать её по общему описанию Android-сбоев.

### Следующий безопасный проход

- Выбрать расширение существующего AppMetrica либо Tracer по покрытию JVM, NDK, ANR и RN/Hermes. Новую dependency не добавлять только ради второго логотипа.
- Для AppMetrica проверить explicit ANR flag, реальный native crash module и совместимый upload механизм. Для JS использовать подтверждённый public API и корректную передачу управления исходному RN handler.
- Перед отправкой исключить tokens, raw referrer, subscription/checkout payload и значения save/profile. Сохранить native consent/QA gate; новая диагностика не должна обходить opt-out.
- Привязать карты/символы к package, versionCode, build и ABI; секрет upload хранить вне git. Сначала подготовить локальные артефакты, затем проверить реальную загрузку в выбранной среде.
- Выполнить controlled dev crash только в выделенной тестовой среде, перезапуск и сверку symbolicated отчёта. Production crash намеренно не провоцировать. Проверить отказ от аналитики, холодный старт и отсутствие двойного reporter.

Нынешний native gate исключает debug, emulator, preview package и explicit QA из production SDK. Поэтому «тестовый crash на эмуляторе не появился» не является доказательством поломки сервиса. Для сетевой приёмки нужна отдельная явно разрешённая тестовая destination, которой эта проверка не создавала.

## Приватность и пределы проверки

[AppMetricaPrivacy](../../../modules/appmetrica/android/src/main/java/expo/modules/appmetrica/AppMetricaPrivacy.kt:52) активирует SDK только после durable native согласия, выключает location tracking, отдельно управляет sessions/app opens и не включает SDK logs. Native refusal на холодном старте предотвращает активацию. Identifier callback повторно проверяет согласие. [README bridge](../../../modules/appmetrica/README.md:25) честно ограничивает обещание: public API не очищает внутренние SDK databases и не отменяет запросы, уже находящиеся в полёте; warm opt-out нельзя описывать как доказанное удаление всех записей.

Выполнены read-only inspection исходников, official SDK tag/source, cached AAR, существующего AAB и локальных исторических отчётов. Не выполнялись новые dependency resolution/build, unit/integration/device tests, консоли/API, upload symbols, controlled crash или финансовые действия. Секреты и пользовательские строки в артефакты не копировались.
