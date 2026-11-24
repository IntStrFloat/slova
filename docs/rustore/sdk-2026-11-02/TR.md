# TR — локальное покрытие сбоев через существующий AppMetrica

Статус: **implemented_and_accepted_local_controlled_crash_scope**, 4 ноября 2026. После сохранённого первоначального JS FAIL приняты actual JS-C/JVM-B/native-B и matching offline symbolication на signed R8 QA33; независимые source/evidence ревью завершены. Точный scope и отдельный текущий QA34 приведены в приёмке root ниже. AppMetrica Android8.6.0; новый Tracer SDK не добавляется. SDK transport/production reports/uploads не включаются ради локального теста. Прежние pending-строки сохраняют историю checkpoints.

## План реализации и очистки до изменения кода

1. Зафиксировать регрессиями существующий bridge/consent и новые границы: не передавать raw Error, message/cause/extraData/URL в SDK; сохранить оригинальный fatal flow RN и все JVM crashes. Затем добавить только необходимые методы существующего Expo-модуля.
2. Устранить неполную границу JS-only санитизации: реальный публичный `ICrashTransformer` пересобирает автоматический JVM Throwable без исходных message/cause/suppressed. Он не подавляет unmatched crashes. Отдельные ANR/thread dumps/NDK memory/OS logs не объявляются им очищенными.
3. Добавить один capability-detected JS hook: pinned RN0.85 `RN$registerExceptionListener` при `RN$useAlwaysAvailableJSErrorHandling===true`, иначе ErrorUtils с передачей предыдущему handler ровно один раз. Наличие C++ registration function само по себе не подтверждает активный pipeline. Нет `preventDefault`, второго analytics identity/outbox или двух конкурирующих observer routes. Повторные callbacks дедуплицируются только в памяти текущего runtime.
4. Structured JS fatal context идёт как SDK plugin **error**, а обычный JVM fatal остаётся единственным automatic **crash**. Это сохраняет default Java crash handling и JS frames без небезопасного угадывания, какой JVM crash следует подавить. Не применять dedup по времени к `JavascriptException`.
5. Подключить реальный optional module `analytics-ndk-crashes:3.1.0` и public ANR/native flags за `slova.crash.extended_enabled=false`. Root отдельно доказывает compatibility/R8/ABI. Upstream source3.2.0 пока не опубликован; general dependencies/toolchain не обновляются.
6. QA-only fixture: package `com.intstrfloat.slova.sdkqa`, явный `slova.crash.qa_enabled=true`, пустой SDK key, отдельный compile flag native fixture. Только явный одноразовый broadcast/action с run ID; повтор не создаёт crash loop. Локальный sanitized record/реальные controlled JS/JVM/native crashes и offline symbolication; исходный игровой профиль не сбрасывается.
7. Сохранить build-matched Hermes map/bundle, native BuildIds/unstripped QA symbols и R8 mapping, когда он существует. Использовать установленный Metro/NDK/retrace; external upload/configuration остаются future release checklist.

Сначала проходят узкие red/regression tests, затем изменение границы, затем targeted Jest, TypeScript/ESLint и production Kotlin host-policy checks. Root выполняет настоящий native build/owned-AVD fixture и независимые code/scenario reviews после стабилизации SDK flow. Эта карточка не присваивает PASS будущим проверкам.

## Границы владения

### Исправление после actual JS QA 4 ноября

Первый controlled JS crash в R8 QA действительно завершил PID3923, но sink остался `trigger_claimed`; этот запуск не доказывает JS local capture. До изменения source установлен конкретный контракт RN0.85.3: `RN$registerExceptionListener` существует независимо от `RN$useAlwaysAvailableJSErrorHandling`, а при false/default после runtime readiness `RN$handleException` возвращает false и `ExceptionsManager` использует JS/ErrorUtils pipeline без C++ listeners. Исходный hook выбирал путь только по наличию функции.

Узкий план: сначала regression с настоящими установленными RN JS `error-guard`/`setUpErrorHandling`/`ExceptionsManager` и fake native fatal boundary; затем выбирать C++ listener только при явном true флага RN, иначе оборачивать активный ErrorUtils. Сохранить original fatal handler, synchronous native handoff, refusal/dedup и все native guards. Native/SDK API и fixture не менять без отдельного доказательства. Пройти targeted Jest/TypeScript/ESLint; root заново собирает QA, проверяет actual `qa_local` и symbolication с новой картой. Старый failed capture остаётся evidence, новый device PASS заранее не присваивается.

Выполнено: обе ситуации false/отсутствующий флаг дали red — реальный RN JS дошёл до native fatal boundary один раз, gateway получил ноль отчётов. После узкой проверки флага capture вызывается синхронно до того же native fatal handler, один раз; Hermes offsets3026435/3842239 сохраняются, приватный sentinel не передаётся. Native bridge/DTO/AtomicFile не менялись. Источники pinned RN: `ReactInstance.cpp:434,521,543`, `JsErrorHandler.cpp:228,376`, `cxxreact/ErrorUtils.h:14`, `setUpErrorHandling.js:13`, `ExceptionsManager.js:151`, `error-guard.js:49`. Hashes/точные границы fake и actual кода: [runtime-pipeline-fix.json](../../../output/rustore-sdk-2026-11-02/tracer/runtime-pipeline-fix.json). Это source-based объяснение actual провала; значение runtime-флага в старом устройстве отдельно не выгружалось.

Новые `src/features/crash-reporting/**`; узкие `src/core/native/appmetrica.ts`, `modules/appmetrica/**`, `plugins/withAppMetrica.js`/тесты и existing native privacy host fixtures; QA fixture/symbolication scripts. Startup hook экспортируется для root. `_layout`, Push, analytics schema/outbox и RC policy в этом проходе не редактируются.

Bootstrap `AppMetricaPrivacy.bootstrap(this,key,testBuild)` сохраняется. Новые manifest flags имеют false default. QA не загружает production key и не активирует production AppMetrica. Существующие G2 keyless/consent/QA boundaries остаются обязательными.

## Пределы доказательства

Public `ICrashTransformer` меняет Throwable model автоматического JVM отчёта; он не очищает отдельные all-thread данные, ANR или Crashpad dump. QA/report fixtures не используются для обещаний blanket redaction или server delivery. Public vendor NDK3.1 `.so` stripped; source-line offline proof относится к собственному matching QA ELF, а не к vendor internals.

API/dependency research: [api-evidence.txt](../../../output/rustore-sdk-2026-11-02/tracer/api-evidence.txt). Implementation/design evidence и фактические результаты будут дописаны после выполнения. Publication, production crash, реальные платежи, новые аккаунты/ключи и symbol uploads не выполняются.

## Реализованные пути

- `src/features/crash-reporting/index.ts`: root подключил `installCrashReporting()` на уровне модуля `_layout`, до render. Capability-safe новый binary; один C++ listener при явном always-available флаге либо активный ErrorUtils для legacy/default pipeline. Monotonic native callback watermark не даёт старому refused callback вернуться после заполнения кэша; application `error.id` в legacy route не сливает разные ошибки. Capability означает наличие feature, а current consent проверяется при каждом report/trigger; подписка при opt-in заново не устанавливается.
- `policy.ts`: максимум32 bundle frames, конечные целые координаты, canonical `index.android.bundle`; только известные asset aliases. Индексный обход не вызывает подменённые array methods/iterator, throwing accessors не выбрасывают ошибку наружу. Source column переводится в zero-based, Hermes bytecode offset сохраняется. Message/cause/componentStack/extraData/произвольные URL и method names не отправляются.
- `AppMetricaJsError.kt`: повторная строгая native-валидация DTO, реальные `PluginErrorDetails`/`StackTraceItem` builders SDK8.6, categorical error kind/fatal context и build/version. SDK void call считается только local handoff.
- `AppMetricaCrashSafety.kt`: сохраняет automatic JVM report при разрешённой политике и detached Throwable с фиксированным сообщением; исходный RN `JavascriptException.extraDataAsJson`/cause не передаётся. Отказ/неизвестный gate возвращает null, а ошибка санитизации создаёт безопасный fallback без исходного объекта.
- `AppMetricaPrivacy.kt`: прежний трёхаргументный bootstrap, прежние keyless/consent/session guards; transformer устанавливается до SDK activation. ANR/native flags берутся из false-default manifest. Реальный optional NDK module3.1 добавлен для последующей actual build/R8/ABI проверки root.

## Explicit QA protocol для root

Никакой fixture не запускается автоматически. Для bundled/R8 QA нужны все условия:

1. Package строго `com.intstrfloat.slova.sdkqa`; `APPMETRICA_API_KEY=""`, существующий QA flag и остальные серверные/SDK transports тестовой сборки отключены.
2. `withAppMetrica` options `required:false`, `apiKey:''`, `crashQa:true` **либо** соответствующая правка generated QA manifest. Metadata: `slova.crash.qa_enabled=true`, `slova.crash.app_version`, `slova.crash.build_id`. `slova.crash.extended_enabled` остаётся false, поскольку QA ничего не отправляет в SDK. Плагин отвергает QA option для другого package или непустого ключа.

   Контракт namespace: `config.android.package` остаётся `com.intstrfloat.slova`; `withSdkQa` меняет только effective applicationId. Для `config.extra.sdkQa===true` AppMetrica plugin выводит effective `.sdkqa`, не переименовывая MainApplication/BuildConfig namespace. Обычный base config без этого QA marker с `crashQa:true` отвергается. Runtime проверяет настоящий `Context.packageName` независимо от plugin marker.
3. Для module QA source set и JNI fixture — `-Pslova.crashQa=true`. В нормальной сборке default false; JNI class/library не включаются. Применяется текущий NDK, новый toolchain не устанавливается.
4. Root подключает экспортированный startup hook, запускает QA app и подтверждает готовность JS. Сохранённое native consent должно быть true для локального диагностического record; refusal блокирует record/trigger. Это не включает production SDK. Сначала отдельная проверка opt-out: SHA локального record и PID не меняются после запроса.
5. Перед настоящим controlled crash закончить сохранение текущей QA партии/выдачу награды. Main package и его MMKV/платные права не трогать. Сравнить нужные сохраняемые данные до/после restart; fixture не сбрасывает/не seed-ит игровой storage.

После разрешения AVD name → serial root выполняет одну явную команду на нужный вид сбоя:

```text
adb -s <owned-serial> shell am broadcast -p com.intstrfloat.slova.sdkqa \
  -a com.intstrfloat.slova.sdkqa.CRASH_QA \
  --es confirm local-only-controlled-crash --es kind js --es run_id tr-js-<unique-run>
```

`kind` — `js`, `jvm`, `native`, опционально `anr`. `run_id` содержит только `[a-z0-9_-]`, максимум48. Он синхронно и durable резервируется до trigger; повтор после restart не срабатывает. У fixture не более16 уникальных triggers на installation, дальше новые запросы отклоняются без автоматического сброса/удаления прогресса. Отказ между запросом и отложенным запуском отменяет запуск. Native метод вызывается только из защищённого QA route; отсутствие библиотеки фиксируется как unavailable, а не имитируется другим crash.

JS path: native event → реальный throw в `slovaControlledJsCrash` → новый observer → реальный SDK-shaped `PluginErrorDetails` → bounded private `files/slova-crash-qa.json` со статусом `qa_local`/`sdk_activated=false` → прежний RN fatal flow. После restart root выгружает именно этот файл. В debuggable QA возможен `run-as`; недебажная подписанная R8 QA его не допускает. На уже принадлежащем задаче userdebug AVD допустим root ADB и чтение только `/data/user/0/com.intstrfloat.slova.sdkqa/files/slova-crash-qa.json` через `adb -s <owned-serial> exec-out cat <exact-path>` после `adb root`/`wait-for-device` и повторной проверки имени AVD. Не менять debuggable, подпись, package/keyless/manifest guards ради доступа; если root недоступен, фиксируется ограничение извлечения, а не обход защиты на другом устройстве. Replayed run ID не вызывает новый crash. JVM и C++ markers фиксированы и не содержат пользовательских данных. Внешние reports/включение SDK на эмуляторе для доказательства не требуются и не заявляются.

## Offline symbols и actual proof

После **одной завершённой** сборки root архивирует её final composed map, executable Hermes bundle и matching app-owned unstripped native ELF. Пример:

```text
node scripts/crash-symbols.cjs archive --build-id <unique-build> \
  --artifact <workspace-qa-apk> \
  --bundle android/app/build/generated/assets/react/release/index.android.bundle \
  --map android/app/build/generated/sourcemaps/react/release/index.android.bundle.map \
  --native <module-build-cxx-path>/obj/x86_64/libslova_crash_qa.so \
  --mapping android/app/build/outputs/mapping/release/mapping.txt

node scripts/crash-symbols.cjs symbolicate --archive <archive-dir> --kind js \
  --trace <actual-native-qa-record.json> --output <js-symbolicated.txt> \
  --expect src/features/crash-reporting/index.ts

node scripts/crash-symbols.cjs symbolicate --archive <archive-dir> --kind native \
  --trace <actual-controlled-tombstone.txt> --abi x86_64 \
  --output <native-symbolicated.txt> --expect crash_fixture.cpp
```

Если R8 фактически выключен, `--mapping` опускается и retrace не называется выполненным. Для JVM с R8 — `--kind jvm` и соответствующий actual stack, native-имена не обрабатываются JS-картой. Archive проверяет source content трёх crash JS inputs и SHA executable bundle внутри APK/AAB. До записи archive каждый supplied native ELF сверяется с одноимённой библиотекой **в этом APK/AAB**: наличие ровно одной ZIP entry, ABI и непустой одинаковый BuildId обязательны. Хеш packaged stripped library сохраняется отдельно от unstripped symbols. При symbolication эта связь и все хеши проверяются заново, затем требуются DWARF и совпавший BuildId в actual frame. Старый native archive без packaged binding отклоняется и создаётся заново с новым build ID. Любой mismatch — ошибка. Простая синтетическая строка не является device evidence; root сохраняет отдельные capture/run/installation receipts.

`crash-symbols.cjs` не подключается к сервису. Его PASS относится к offline source resolution **переданного** stack, а не к выполнению crash или SDK delivery. Vendor NDK `.so` не содержат полных source symbols; acceptance проверяет реальный `slovaControlledNativeCrash` из собственного неурезанного ELF. Проверить совпадение ABI и BuildId, нормальный restart, отсутствие crash loop и сохранение QA game/opt-out; main package остаётся неизменённым.

## Фактические проверки и ещё не выполненное

Зафиксированы исходные23 bridge/plugin tests. Новые regessions сначала дали ожидаемый red (нет new hook/policy/manifest method), затем прошли. Дополнительные replay/application-id регрессии дали2 red на первой реализации и исправлены watermark/legacy object boundary.

- `node scripts/verify-native-crash-boundary.cjs`: **PASS, 26 checks**, реальные cached AppMetrica8.6 error builders/transformer и React Native0.85.3 release `JavascriptException`; никакой SDK activation или transport.
- `node scripts/verify-native-analytics-policy.cjs --demonstrate-red`: **PASS, 16 scenarios / 87 checks** текущего production privacy source с объявленными API fakes. Только2 ожидаемых pre-fix keyless cases красные; все текущие keyless/refusal/QA/session и новые flags/transformer cases зелёные. Даже failed refusal commit закрывает QA, несмотря на старое true в persisted preference; только новое успешное явное согласие открывает local diagnostics.
- Targeted Jest: **PASS, 6 suites / 43 tests**, включая actual RN JS legacy pipeline regression. Namespace/effective applicationId, poisoned-array и active-pipeline regressions сначала red, затем green. Scoped ESLint и diff-check — PASS. Последний full TypeScript после этой правки не имеет TR ошибок, но получил внешний `NoCoinsModal.tsx:330` (`StyleSheet.absoluteFillObject`, TS2551); его владелец/root устраняет и повторяет общую проверку. Предыдущий full TypeScript был PASS; текущему целому worktree PASS заранее не присваивается.
- `node --test scripts/__tests__/crash-symbols.test.cjs`: **PASS, 6 tests/subtests**. Реальные маленькие Android ELF A/B/другой ABI/no-BuildId компилируются установленным NDK только в закрытой test temp directory. Stripped A в synthetic APK/AAB сверяется с unstripped A; A+B, wrong ABI, missing packaged/source BuildId, missing library и forged stored binding отвергаются. JS ZIP/map fixtures синтетические; это доказательство archive enforcement, а не controlled app crash.
- [Static NDK linkage](../../../output/rustore-sdk-2026-11-02/tracer/static-ndk-linkage.json): **PASS** actual cached3.1/8.6 classfiles. Два отражаемых client/service implementations покрывают все7 abstract methods настоящего8.6 API;9 SDK boundary method/field references разрешены. Оба reflection target найдены в actual8.6 binary. Generic `ModuleEntryPoint` не является registration contract этого companion. Negative control удаляет getter только в модели памяти и получает ровно ожидаемый missing-method FAIL; AAR не изменяется. Никакого SDK/JNI activation этот static check не выполняет.
- Root [pinned module build](../../../output/rustore-sdk-2026-11-02/tracer/actual-module-pinned-build-result.json): **PASS, exit0, NDK27.1.12297006**, library QA compile четырёх ABI. Первый root library build выбрал AGP default27.0 и автоматически установил его; это выявленный build-hygiene сбой, не доказательство27.1. Узкая правка `android.ndkVersion rootProject.ext.ndkVersion` зафиксировала уже установленный Expo NDK, затем root выполнил успешный pinned повтор. Общие SDK-каталоги не удалялись. Library compile не равен app packaging/R8 или runtime handler acceptance.

**Промежуточный actual root checkpoint:** APK SHA256 `e6965f8cb870d4404123001f54e6c213c3e65fe0237daf95e4611bb20a9ba74f`. JVM и native controlled failures подтверждены отдельными platform traces, R8 retrace до `AppMetricaCrashQa.kt` и matching ELF BuildId до `slovaControlledNativeCrash`/`crash_fixture.cpp`; QA projection уровня2/«сон»/160coins до/после совпадает. Sink JVM/native остаётся `trigger_claimed`, доказательство сбоя — trace, а не этот статус. JS в этом checkpoint — **FAIL capture**, сохранён в `tr-js-20261104-a-failure.json`; нельзя смешивать его source map с исправленным JS.

**Root pending:** новая aggregate QA сборка и новый archive для исправленного JS, actual `qa_local` до original fatal и offline mapping; повторный полный набор JS/JVM/native/opt-out/replay/save checks на финальном артефакте, общий TypeScript и независимое code/scenario review. Пока эти пункты не выполнены, локальная итерация не объявляется закрытой. Static descriptors, packaging и controlled fixtures не доказывают SDK/Crashpad activation. **Future release checklist:** actual consented phone report receipt, service grouping/symbol upload, ANR/NDK warm-opt-out service limits и postrelease metrics. Они не подменяются local archive и не блокируют текущую local-only поставку.

Rollback новых путей: `slova.crash.extended_enabled=false`; normal Java reporting остаётся с native safe transformer, gameplay analytics/consent/progress не удаляются. QA flag/compile property false убирают fixture; никакого runtime crash trigger в production UI нет.

## Приёмка root — 4 ноября 2026

[local-device-verification.json](../../../output/rustore-sdk-2026-11-02/tracer/local-device-verification.json) принимает actual **JS-C, JVM-B и native-B** на `slova-sdkqa-v2-minified-vc33.apk`, SHA-256 `25e673eb0df448f7f47904852334207954ab8c9dfa8a2f4dabe4b93882b310cc`, archive `sdk-v2-vc33-20261104`. JS имеет `qa_local`/`sdk_activated=false`, затем прежний RN fatal; R8 JVM retrace и matching BuildId/DWARF собственного native ELF разрешают свои source frames. Replay не меняет PID/record; отказ блокирует trigger/capture до и после cold restart, исходное QA preference восстановлено. Уровень2/SON/160coins и основной профиль сохранены.

[Runtime code review](../../../output/rustore-sdk-2026-11-02/tracer/runtime-code-review.md) — APPROVE; [runtime scenario review](../../../output/rustore-sdk-2026-11-02/tracer/runtime-scenario-review.md) подтверждает **67 PASS /0 FAIL** сверок evidence. Это сверки локальных bytes/receipts, не67 новых Android tests. Первая потеря JS capture, ранняя перезапись B-receipt replay-файлом и первоначальный короткий JVM PID-poll остаются видимыми ограничениями. Приёмочный JS-C имеет отдельные capture/replay receipts; исправления инструментов не превращают старый FAIL в PASS.

Поздний QA34 добавляет software-build getter и финальный cold-render fix; его [compiled-input proof](../../../output/rustore-sdk-2026-11-02/local-qa/final-qa34-compiled-inputs.json) и артефакт описаны в [LOCAL-RESULT.md](LOCAL-RESULT.md). Эти три фактических crash-запуска остаются **QA33**, а не переименовываются в новые QA34 crashes. Source review не обещает AppMetrica/Crashpad activation, server grouping/upload, ANR receipt или source lines vendor NDK. После отдельного default library AAR принят [whole ordinary-app APK/AAB proof](../../../output/rustore-sdk-2026-11-02/local-qa/normal-whole-app-verification.json): main identity33/keyless/R8, все четыре ABI,10 matching DEX payloads без defined QA fixture class и без QA JNI library, public/native QA off; исходная подпись подтверждена. Ordinary artifacts не устанавливались. Их200 JS/30 native inputs имеют отдельный source epoch от199-input QA34. Общий TypeScript после исторической ошибки NoCoinsModal уже прошёл в `final2-typecheck-result.json`; прежний diagnostic сохранён.

## Финальная локальная сверка — 5 ноября 2026

[Final verification report](../../../output/rustore-sdk-2026-11-02/final-verification-report.json) — PASS; [current normal-source comparison](../../../output/rustore-sdk-2026-11-02/final-current-compiled-difference.json) не имеет различий для 200 JS inputs. [Device](../../../output/rustore-sdk-2026-11-02/local-qa/final-device-cleanup.json), [host](../../../output/rustore-sdk-2026-11-02/local-qa/final-host-cleanup.json) и [registry](../../../output/rustore-sdk-2026-11-02/local-qa/final-registry-release.json) receipts закрывают cleanup: собственные QA/test packages остановлены до восстановления исходных Wi-Fi/mobile data; основной профиль/QA preference сохранены; Slova AVD остановлен без wipe, owner освобождён; собственный backend остановлен, другие устройства не затронуты. Локальные технические проверки и уборка завершены. [107 требований](../../../output/rustore-sdk-2026-11-02/requirements-ledger.json) проиндексированы с отдельными future/inapplicable subsets; реальные service/store проверки сохраняются в future checklist, не в локальных pending.
