# Явные локальные проверки SDK bridge

`slova://sdk-qa` — технический маршрут только для отдельного локального QA binary. В обычном интерфейсе ссылки на него нет. Доступ одновременно требует `EXPO_PUBLIC_LOCAL_SDK_QA=1` и `getCrashReportingCapabilities().localQa === true`. Последний нативный guard проверяет настоящий package `.sdkqa`, QA compile/manifest flags и пустой analytics key; одного JS-флага недостаточно. При отказе маршрут сразу перенаправляет на главную без запроса Review SDK.

План проверки: сначала regression tests закрытого маршрута и явного запуска; затем TypeScript/scoped ESLint. Сборка и Android-проверка выполняются root отдельно после включения маршрута в следующий QA artifact.

Кнопки:

- «Проверить Review bridge» читает только init-free availability, владельца открытой формы и существующий синхронный `NativeModules.RustorePush.getNativeVersionCode()` из настоящего PackageManager. Этот getter не инициализирует Push SDK. Доступная для Android UI-проверки строка имеет вид `SDK QA native_version_code: 33`; до нажатия — `not_checked`, неизвестный старый bridge/ошибка/невалидное значение — `0`. Принимается только целое положительное число не выше `2100000000`, без fallback на `app.json`/OTA config.
- «Подготовить Review» явно вызывает настоящий `prepareResult()` под общей точной Review lease. Background/blur/unmount, timeout 1500 ms или completion инвалидируют подготовку через `discard()` и освобождают только свою lease. Поздний callback не меняет состояние новой проверки.
- «Сбросить подготовку» явно инвалидирует текущую локальную подготовку.
- «На главную» возвращает в игру.

Запуск формы отсутствует. Этот маршрут не вызывает policy reservation, не меняет cooldown/handled, награды, сохранения или настройки согласия. Успешная подготовка немедленно отбрасывается и обозначается лишь `prepare_ready`. Остальные результаты выводятся ограниченными кодами, без raw exception/payload. `prepare_ready` или SDK callback не доказывают отправку отзыва.

Это native callback/error probe, а не доказательство достижения игрового milestone, показа или отправки формы, работы store channel и production метрик. Root фиксирует фактический artifact/исходники, нажатие, статус и сохранность профиля отдельно.

## Фактическая проверка исходников

`src/app/__tests__/sdk-qa.test.tsx`: **27 tests PASS** после добавления version inspection. Проверены обычные сборки/отсутствующий native guard без SDK side effects и вызова version getter, фактические значения `33`/`34`, неизвестный/ошибочный bridge и границы чисел, явный prepare/error/ready без launch, повторное нажатие, чужая lease/старая native form, timeout и поздний callback, blur/background и unmount. Scoped TypeScript с настоящими импортами страницы/тестов, ESLint и diff check — PASS. В исходном проходе общего TypeScript был чужой review probe `output/rustore-sdk-2026-11-02/sl-rv/code-review-probes.test.ts:84`; диагностики QA-файлов не было. Root позднее подтвердил исправление probe и общий TypeScript PASS; этот исполнитель не редактировал чужие файлы.

Сборка и Android runtime этой страницы ещё не выполнены этим исполнителем. Root должен использовать следующий QA artifact с указанным публичным флагом и проверять явный prepare на offline AVD; нельзя выдавать эти host-тесты за реальный callback SDK.

## Отключённый Updates в настоящем QA binary

- «Проверить Updates bridge» читает только `isSupported()` и `getNativeVersionCode()` существующего wrapper. Оба пути init-free. Доступная строка `SDK QA updates_version_code: 34` показывает настоящий PackageManager versionCode как строку, без fallback на `app.json`; до нажатия — `not_checked`, неизвестное значение — `0`.
- «Проверить отключённый Updates» после тех же двух QA guard, foreground/focus и проверки совместимости bridge явно вызывает только `checkAvailability()`. Ожидаемый ответ на `.sdkqa` — `SDK QA updates_status: unavailable:disabled`. Нативный Updates guard обязан вернуть его до создания SDK manager; его реальное выполнение и нулевой factory count проверяются отдельно владельцем UP/root.

Эти кнопки не вызывают `startFlexible`, `completeFlexible`, установку, открытие URL или UI обновления. Неожиданный `available` показывается как `available:unexpected_qa_result`, без info token, предложения или установки. Причины ограничены allowlist, raw exception/payload не отображаются.

Background check не получает fullscreen lease. Точное локальное request identity, deadline 1500 ms и инвалидирование при blur/background/unmount защищают UI от дубликатов и старых callbacks. Нативный `discard()` глобально не вызывается: отключённая проверка не создаёт prepared SDK state, а вызов мог бы инвалидировать проверку другого coordinator.

После расширения: **40 Jest tests PASS**, scoped TypeScript, ESLint и diff check — PASS. Сохранены прежние 27 guard/Review/Push-version сценариев; добавлены init-free Updates inspection, реальные строки native version `33`/`34`/unknown, двойной guard, неподдерживаемый bridge, typed disabled callback, unexpected available без запуска flow, sanitization, duplicate/timeout и stale lifecycle callbacks. Логи: `local-qa/qa-route-{jest,typecheck,eslint}-updates.log`. Actual default-disabled device acceptance относится к следующему QA artifact root, а не к этим mock tests.

## Метаданные аналитики без изменения consent

«Проверить метаданные аналитики» после тех же двух guard читает существующий pure `getSoftwareBuildInfo()` из AppMetrica bridge и readonly `isAnalyticsCollectionEnabled()`, затем явно вызывает существующий `trackAnalyticsHealthSummary()` без новых событий/схемы. Отображаются независимые строки `SDK QA analytics_build: 34`, `SDK QA analytics_version_name: 0.1.29` и `SDK QA collection_enabled: false`. Старый bridge остаётся `unknown`; версия не заимствуется из Push, Updates, `app.json` или OTA config.

Статус `health_summary_requested` подтверждает только вызов существующего void-метода. Он не означает enqueue, SDK handoff или доставку. В текущем keyless QA collection закрыта test-device/QA/consent gates; health summary пропускается даже при `optOut=false`. Кнопка не меняет согласие и не обходит эти gates, session-once policy или старые факты в очереди. На устройстве root проверяет pure installed metadata `34` и отказ сбора; доказательство новых envelope полей относится к отдельным тестам настоящего collector с fake native metadata. Production delivery остаётся за пределами этой локальной проверки.

Итог новых source checks: **44 Jest tests PASS**, scoped TypeScript, ESLint и diff check — PASS. Дополнительные четыре проверки покрывают отсутствие metadata/health вызовов до явного нажатия, нормальные и native-false guard, actual build/version name, readonly collection flag, unknown старого bridge без fallback и отсутствие утверждений об enqueue. Логи: `local-qa/qa-route-{jest,typecheck,eslint}-analytics-build.log`. Устройство/сборку этот исполнитель не запускал.
