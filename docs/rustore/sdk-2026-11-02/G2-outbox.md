# G2 — надёжность существующей очереди аналитики

Статус: **implemented_and_accepted_local_scope**, 4 ноября 2026; независимые ревью и actual QA34 software-build getter приняты в addendum root ниже. Исторические pending-строки описывают свои checkpoints. Scope — существующие `analytics.outbox.v2`, schema v3 и их тесты. Новая очередь, SDK, идентичность или assignment не вводятся.

## План до изменения кода

### Поздняя правка software-build metadata перед QA34

Финальный аудит обнаружил, что новые события берут `app_version/app_build` из JS `app.json` (0.1.29/33), даже если установленный Android binary имеет override34. План узкой правки: зафиксировать baseline track/adapter, затем red для новых Android событий, сохранённой очереди schema2/3 и старого binary; добавить pure PackageManager getter в существующий AppMetrica bridge и optional TS wrapper. Getter не читает SDK key/consent и не создаёт SDK factory. Новые Android envelopes используют фактические software fields; unavailable/invalid старый bridge означает явные `unknown`. PWA оставляет статическую bundle version. Уже записанные версии сохраняются; отсутствующая историческая версия остаётся `unknown`, а не переименовывается в текущую. Schema остаётся3, identity/outbox/event contracts не меняются. Проверки: настоящий текущий outbox с fake native boundary, pure Kotlin getter с Android API fakes, TypeScript/scoped ESLint; actual native compile/device — отдельный проход root.

Реализовано: `AppMetricaBuildInfo.read` читает PackageManager по настоящему `Context.packageName`, поэтому namespace и effective QA applicationId не смешиваются. На API28+ используется `longVersionCode`, на старых API — `versionCode`; native отдаёт decimal string без JS Number. Новый optional `getSoftwareBuildInfo` валидирует versionName и long versionCode независимо. Этот getter доступен keyless/QA/opted-out binary, но ничего не отправляет и не меняет согласие. `baseEnvelope` вызывает его только для **новых Android фактов**; restore возвращает сохранённые software fields либо `unknown` и не запрашивает текущий build. Для PWA используются статические version/build JS bundle. Это данные software version, не идентичность пользователя; новый envelope field/schema/provenance API не добавляется.

Фактическая проверка правки: baseline track/adapter — **65 PASS**; до реализации новые случаи дали **10 ожидаемых FAIL / 66 PASS**; после — **76 PASS**. Полный analytics-набор — **8 suites / 169 PASS**. Kotlin host test компилирует настоящий pure getter без AppMetrica SDK/storage API в classpath: **13 checks PASS** (QA package34, legacy API branch, точные большие Long, partial/missing/invalid metadata и PackageManager failure). Whole-worktree TypeScript, scoped ESLint четырёх TS-файлов, Node syntax и diff-check — PASS на зафиксированном checkpoint. Доказательства, команды и source hashes: [build-metadata-implementation.json](../../../output/rustore-sdk-2026-11-02/g2/build-metadata-implementation.json).

Actual Android compile/QA34 getter ещё проверяет root в общей сборке. Существующая QA exclusion сохраняется: это не разрешение отправлять production analytics с эмулятора. Host/mock результаты не называются реальной доставкой; старые queue/build33 и прежние артефактные доказательства не переименовываются в34. CR hook/flags/SDK reporting logic и события соседних SDK не изменялись.

1. Зафиксировать текущий контроль: `track.test.ts` и `schema.test.ts` — 2 набора, 72 теста PASS (`output/rustore-sdk-2026-11-02/g2/outbox-baseline-tests.log`).
2. Добавить регрессии для срока хранения, ограниченных повторов native handoff, восстановления метаданных, сохранения event_id/once-ключа и отсутствия блокировки следующих событий.
3. Расширить запись той же очереди необязательными для старых сохранений метаданными; удалить бесконечный немедленный повтор. Не менять предметные события, эксперименты, экономику и согласие.
4. Проверить целевые тесты, TypeScript и ESLint. Независимое ревью и общую сборку выполняет лидер отдельно.

## Политика

- Лимит — прежние 512 записей. Срок хранения — 7 суток **с постановки в локальную очередь**, а не с occurrence: восстановленный старый факт сохраняет исходную дату.
- Старые записи без retry-метаданных мигрируют с `observed_at`, если доступно, иначе получают время первого восстановления. Это однократная миграция, не перенос occurrence на сегодня.
- Не более 8 попыток передачи каждой записи в native SDK. После неудачи задержки: 1, 2, 4, 8, 16, 32, 60 секунд. Повтор происходит при следующем обычном flush после задержки; отдельной фоновой службы нет.
- Один flush делает не более 32 native вызовов. Запись, ожидающая повтора, не удерживает более поздние готовые записи.
- Попытка резервируется в storage до native вызова. При отказе записи storage SDK не вызывается. Истечение TTL/лимита сохраняет once-ключ: повторный доменный факт не превращается в новое событие.
- Большой откат часов (более 60 секунд относительно постановки/последней попытки) завершает затронутую запись как clock-invalid; её occurrence не переписывается. Небольшое расхождение не сбрасывает возраст или счётчик.
- Повторные persisted event_id/once-ключи объединяются до replay. Невалидные retry-метаданные закрываются как исчерпанные, чтобы повреждённый счётчик не выдавал новую серию попыток после каждого перезапуска.
- `queue_expired` и `handoff_exhausted` различают причины завершения; `queue_dropped` остаётся общей потерей. Метаданные retry не отправляются в payload.
- Успешный `reportEvent` — только принятие native SDK. Серверная доставка и его внутренние повторы этим кодом не контролируются. После сбоя сохранения/процесса возможен повтор handoff с тем же event_id; это не обещание exactly-once транспорта.

## Фактически выполнено (UTC-время — в JSON-отчёте)

| Проверка | Результат | Артефакт |
|---|---|---|
| Контроль до изменения кода: track/schema | 2 набора, 72 теста PASS | `g2/outbox-baseline-tests.log` |
| Новые регрессии до реализации | 8 ожидаемых FAIL, 31 прежний PASS | `g2/outbox-red-tests.log` |
| Все analytics-тесты после реализации | 7 наборов, 126 тестов PASS | `g2/analytics-tests-final.log` |
| TypeScript `--noEmit` | PASS | `g2/outbox-typecheck-final.log` |
| ESLint четырёх изменённых TS-файлов | PASS | `g2/outbox-eslint.log` |
| Privacy-регрессии после независимого ревью, до исправления | 2 ожидаемых FAIL | `g2/outbox-privacy-red-tests.log` |
| Track/schema после privacy-исправления | 2 набора, 86 тестов PASS | `g2/outbox-privacy-fixed-tests.log` |
| Все analytics-тесты после privacy-исправления | 7 наборов, 128 тестов PASS | `g2/analytics-tests-privacy-fixed.log` |
| TypeScript / ESLint изменённых при privacy-исправлении файлов | PASS | `g2/outbox-privacy-typecheck.log`, `g2/outbox-privacy-eslint.log` |

Пути логов указаны относительно `output/rustore-sdk-2026-11-02/`; команда, exit code и source-хеши находятся в `g2/outbox-implementation.json`.

Проверены TTL ровно на границе 7 суток, старый occurrence, стабильный event_id и once-ключ после 8 неудач/TTL, задержки и отсутствие head-of-line starvation, restart, отказ durable reservation, clock rollback, лимит работы flush, однократная offline-миграция, persisted duplicate и повреждённый retry budget. Прежние consent epoch, native opt-out, 512 priority queue и schema-приватность проходят в общей analytics-регрессии.

## Исправление по независимому ревью 4 ноября

Ревью обнаружило HIGH-регрессию: `return entry as DeliveryState` только менял TypeScript-тип и сохранял все runtime-поля исходной записи. Последующий spread мог заменить проверенный envelope его необработанной persisted-копией.

Теперь helper конструирует объект ровно из четырёх проверенных delivery-полей, а при сборке записи проверенные name/envelope ставятся после metadata. Две регрессии восстанавливают schema 2 и 3 с **валидными** retry-метаданными, синтетическими email/token и посторонним полем записи. До исправления воспроизводилась утечка; после исправления native payload и повторно сохранённая очередь очищены, event_id/occurrence и schema-миграция сохранены. Исправление затронуло только `index.ts` и `track.test.ts`; параллельные RC-изменения schema сохранены. Повторное независимое ревью остаётся за лидером.

## Ограничения и откат

По последнему решению владельца работа и проверки локальные; RuStore-публикация, изменение production/консоли/серверной конфигурации и реальные платежи не выполнялись. Нативное устройство и настоящая доставка AppMetrica данным набором не проверяются. Если в будущем планируется выпуск, release/device-проверка и согласование retention очереди входят в отдельную приёмку выпуска.

Нет отдельного retry timer или фонового job: обычные события и lifecycle flush забирают готовые записи; без новых flush очередь не обещает самостоятельную доставку. TTL проверяется при восстановлении/обработке очереди, а не как удалённый таймер, работающий при закрытом приложении. После восьми попыток/TTL telemetry теряется с диагностикой; доменный факт не переиздаётся под новым ID. Повреждённый clock/retry-state также закрывается безопасно. SDK может повторно принять тот же event_id после process death между handoff и удалением записи; exactly-once на стороне сервера не заявляется.

Откат исходников не меняет ключ storage/schema или игровые данные: старый binary игнорирует новые metadata-поля. Opt-out и предметные once-ключи сохраняют прежнюю семантику. Возврат старого binary возвращает его прежнюю неограниченную retry-политику; это не откат native SDK-кэша.

## Позднейшая локальная приёмка root

Независимые code/scenario ревью приняли исправления queue sanitization и native keyless guard. Реальный AppMetrica bridge с SDK8.6 скомпилирован в debug и R8 QA; отдельный package запущен offline. Host regression компилировал целый production Kotlin: 13 сценариев / 75 проверок PASS, прежняя ветка воспроизвела 2 FAIL. Устройство подтверждает работу игры и сохранения с keyless/QA exclusion; реальная AppMetrica доставка не утверждается. Доказательства: `g2/code-review.md`, `native-policy-result.json`, `local-qa/rc-runtime-verification.json`.

## Приёмка software-build metadata root — 4 ноября 2026

[Независимое ревью](../../../output/rustore-sdk-2026-11-02/g2/build-metadata-review.md) — APPROVE:12/12 author-manifest hashes,23 focused tests, scoped TypeScript/ESLint. Авторский analytics-набор169 PASS и13 pure-native getter checks имеют отдельные receipts; пересекающиеся числа не суммируются. Новые Android события получают PackageManager build установленного binary; сохранённая очередь удерживает исходный33, старый отсутствующий bridge даёт `unknown`, PWA использует bundle metadata. Consent/identity/schema/retry policy не изменены.

Реальный bridge скомпилирован в signed R8 QA34. [software-build-device-verification.json](../../../output/rustore-sdk-2026-11-02/g2/software-build-device-verification.json) и [qa34-analytics-build.xml](../../../output/rustore-sdk-2026-11-02/local-qa/qa34-analytics-build.xml) показывают **build34 / versionName0.1.29 / collection_enabled=false** на точном `up-minified-vc34` probe artifact. `health_summary_requested` означает только запрос: в QA collection запрещён политикой, событие не поставлено в production outbox и доставка не заявляется. Новые/старые envelopes проверены169+23 source tests, не device-enqueue. Финальный [compiled-input proof](../../../output/rustore-sdk-2026-11-02/local-qa/final-qa34-compiled-inputs.json) и [native leaf receipt](../../../output/rustore-sdk-2026-11-02/sl-up/local-device-verification.json) связывают тот же getter с текущим cold-render QA34. Отказ и native preference проверены при33→34 и затем исходная QA настройка восстановлена; main profile не менялся. [LOCAL-RESULT.md](LOCAL-RESULT.md) сохраняет отдельный future service/release checklist.
