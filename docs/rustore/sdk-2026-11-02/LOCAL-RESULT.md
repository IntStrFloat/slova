# Локальный результат SDK — 5 ноября 2026

Статус: **`local_scope_verified`**. Локальные технические работы, проверки и cleanup завершены; ordinary whole-app APK/AAB для четырёх ABI проверены и не устанавливались. [Реестр 107 требований](../../../output/rustore-sdk-2026-11-02/requirements-ledger.json) разделяет локальную приёмку, будущие release-проверки и неприменимые продуктовые ветки. Публикационная готовность этим статусом не заявляется.

Работа ограничена Android / Expo56 / RN0.85 / New Architecture / Hermes и существующим AVD `Slova_Test_API35`. Публикации RuStore, изменения production/консоли/кампаний/сервера, deployment и реальные платежи не выполнялись. Исходная база `52aa1b71622d4a1be7885c9b9ebe644e78f9f4cb` имеет совместные рабочие изменения; source receipts определяют проверенный состав точнее, чем один Git SHA. Исторические неудачи, промежуточные manifest hashes и author/test receipts сохранены.

## Решения по семи направлениям и Tracer

| Направление | Текущий локальный результат | Предел фактической проверки |
|---|---|---|
| [Pay](SL-PA.md) | Не подключается по решению владельца; существующий платёжный backend сохранён | Локальные backend/checkout regressions с fixtures; новых provider/SDK/платежей нет |
| [Push](SL-PU.md) | Existing RN wrapper6.9.1 с native Push7.4.0, durable routes, consent/FIFO и общий local/remote budget | Source reviews; Android instrumentation11 reminders +6 Push; реальная service delivery не выполнялась |
| [Review](SL-RV.md) | Existing SDK10.5.1; прежние пороги/history и общий fullscreen owner, lifecycle callbacks и diagnostics | Source/scenario/host и actual R8 prepare-error/discard; открытая store form/отзыв не проверены |
| [Remote Config](SL-RC.md) | Native SDK10.5.1, bounded allowlist/control, existing assignment и exposure | Fake gateway/scenarios и actual disabled/control binary; проект/console fetch не включён |
| [Updates](SL-UP.md) | Native SDK10.5.2 FLEXIBLE, saved-result action, exact guardian3 и durable result marker | Source reviews, actual native/R8 guards и sideload33→34 data preservation; service download/install не выполнялись |
| [Install Referrer](SL-IR.md) | Встроенный AppMetrica8.6 owner сохранён; отдельный collector не добавлен; IR06 synthetic join принят | SDK source/AAB path плюс local CLI fixtures; реальное acquisition/MMP finance mapping не подтверждено |
| [GameCenter](SL-GC.md) | Отложен; SDK, новый login/cloud-save coordinator и Pay ради него не добавлены | Existing local save/ownership/backend regressions; межустройственное восстановление не заявлено |
| [Tracer](TR.md) | Существующий AppMetrica8.6, bounded JS capture/JVM transformer и optional NDK3.1; нового Tracer collector нет | Actual controlled crashes и offline symbols на QA33; service receipt/grouping/ANR/vendor source lines не заявлены |

## Точный финальный QA артефакт

Файлы находятся в `output/rustore-sdk-2026-11-02/local-qa/`. Они используют отдельный `com.intstrfloat.slova.sdkqa`, versionName0.1.29 / versionCode34, x86_64, R8 и Hermes. Они локальные QA artifacts. [Проверка подписи и упаковки](../../../output/rustore-sdk-2026-11-02/local-qa/cold-static-34-r8-artifact-verification.json) — PASS; исходный certificate SHA-256 `8888e53939d854a282a0ee40e9a78e21360b50d0dd077efc2d107da155bfadcd`. AAB проверен JarFile/jarsigner; streaming JarInputStream verification для него не заявляется.

| Файл | Размер, bytes | SHA-256 |
|---|---:|---|
| [slova-sdkqa-cold-static-minified-vc34.apk](../../../output/rustore-sdk-2026-11-02/local-qa/slova-sdkqa-cold-static-minified-vc34.apk) |114015988|`a1809b81c09685fd4cebfeafd8b5ac561628e5dfc89f2aa0d4f5fbaf1b379d05`|
| [slova-sdkqa-cold-static-minified-vc34.aab](../../../output/rustore-sdk-2026-11-02/local-qa/slova-sdkqa-cold-static-minified-vc34.aab) |114503627|`87d72338ebcc18bf54869f0bef02124668cdf00a57ca9af3100a9c9af0a3a12c`|

[final-qa34-compiled-inputs.json](../../../output/rustore-sdk-2026-11-02/local-qa/final-qa34-compiled-inputs.json) — PASS:199 selected JS /30 native inputs, actual composed-map SHA-256 `9c654d15ad48422a91a51de4775bc0bcdf50943a1accea82fca50c1bf2cc156d`, frozen copies в `.omx/context/final-qa34-compiled-inputs`. Более ранний `up-34` snapshot сохраняет собственный source scope до исправления cold render; его не подменяет новый manifest.

## Обычный native source set — локальная упаковка

Отдельный [whole-app verification](../../../output/rustore-sdk-2026-11-02/local-qa/normal-whole-app-verification.json) — **PASS**: main identity `com.intstrfloat.slova`,0.1.29/33, keyless, R8 и четыре ABI (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`), public/native QA off. **Эти APK/AAB не устанавливались и не публиковались.** [Artifact verification](../../../output/rustore-sdk-2026-11-02/local-qa/native-defaults-r8-artifact-verification.json) подтверждает исходный сертификат выше и3346 signed payload entries; конфигурация не является публикационной.

| Файл | Размер, bytes | SHA-256 |
|---|---:|---|
| [slova-native-defaults-minified-vc33.apk](../../../output/rustore-sdk-2026-11-02/local-qa/slova-native-defaults-minified-vc33.apk) |194716683|`7ae99def257a2b8ccaa30cf9253b0ad40ba99ac59fd2c88c2cfe1e55050443f8`|
| [slova-native-defaults-minified-vc33.aab](../../../output/rustore-sdk-2026-11-02/local-qa/slova-native-defaults-minified-vc33.aab) |162774288|`8f60eb241c0efc8035223644b056a4aeeb68c1aa5c45ceee88be29b09f056400`|

Во всех10 DEX payloads APK/AAB байты совпадают, executable Hermes bundle совпадает. Actual [defined-class/JNI inspection](../../../output/rustore-sdk-2026-11-02/local-qa/native-defaults-fixture-dex.json) находит91714 defined classes без `CrashQaNativeFixture` и без QA JNI library; отдельный [QA positive control](../../../output/rustore-sdk-2026-11-02/local-qa/qa34-positive-fixture-dex.json) содержит91715 classes и fixture library. Это whole-app proof, дополняющий более ранний default library AAR. [Финальный Gradle graph](../../../output/rustore-sdk-2026-11-02/local-qa/final-native-dependencies.json) имеет0 FAILED и подтверждает Push7.4.0, Review10.5.1, Remote Config10.5.1, Updates10.5.2, AppMetrica8.6.0 и NDK companion3.1.0 из original offline mirror; runtime/service activation этим не доказывается.

[normal-final-compiled-inputs.json](../../../output/rustore-sdk-2026-11-02/local-qa/normal-final-compiled-inputs.json) — PASS:200 JS /30 native inputs совпали с current files при capture. Этот source epoch включает последующие shared правки `analytics/subscription.ts`, `monetization/subscription.ts`, новый `checkoutValidation.ts` и `shop.tsx`. Его не смешивают с199-JS QA34 snapshot или с прежним полным Jest: ordinary compile не является device acceptance этих новых UI paths. Текущая существующая платёжная ветка отдельно прошла3 suites /169 tests с обычным timeout после завершения native build; [receipt](../../../output/rustore-sdk-2026-11-02/local-qa/current-payment-final-quiet-result.json), [лог](../../../output/rustore-sdk-2026-11-02/local-qa/current-payment-final-quiet.log). Исходный5000ms timeout под нагрузкой и последующий isolated retry сохранены; timeout не повышался, новых Pay/provider/платежей не было.

Последняя [сверка compiled/current](../../../output/rustore-sdk-2026-11-02/final-current-compiled-difference.json) подтверждает все 200 JS inputs normal snapshot без различий с текущими исходниками. [Финальный verification report](../../../output/rustore-sdk-2026-11-02/final-verification-report.json) — `PASS_local_final_evidence`, accepted source manifest содержит 594 файла. Финальная документационная сверка не меняет app source epoch или исторические receipts.

При повторном чтении прежнего `final-accepted-verification-sources.json` обнаружены отличия четырёх shared analysis/test files: `backend/scripts/__tests__/help-funnel-analysis.test.cjs`, `backend/scripts/__tests__/weekly-retention-analysis.test.cjs`, `scripts/analyze-help-funnel.cjs`, `scripts/analyze-weekly-retention.cjs`. Все 200 compiled app JS и 30 native inputs по-прежнему совпали. История этого расхождения сохранена; более поздние analysis bytes не переименовываются в source прежнего полного backend 515 checkpoint. Документационная работа этих файлов не меняла.

Этот более поздний analysis epoch теперь проверен отдельно: **18 files / 567 tests PASS**, без skips, exit 0, `TestConcurrency=1`, прежние assertions/timeouts сохранены; [receipt](../../../output/rustore-sdk-2026-11-02/local-qa/latest-backend-sequential-result.json). [Before](../../../output/rustore-sdk-2026-11-02/last-analysis-before-verification-sources.json) и [after](../../../output/rustore-sdk-2026-11-02/last-analysis-after-verification-sources.json) snapshots содержат одинаковые 594 source entries, все совпали с файлами при финальной проверке. [Report от 5 ноября 00:12 MSK](../../../output/rustore-sdk-2026-11-02/final-verification-report.json) указывает на новый after manifest. Первый параллельный запуск дал 566 PASS / 1 fake-SMTP 30 ms timeout под нагрузкой; его failure receipts сохранены. Последовательный запуск неизменённых tests закрыл этот scheduling failure без ослабления timeout или assertions; реального SMTP/service вызова не выполнялось.

## Что фактически выполнено

| Проверка | Результат и доказательство |
|---|---|
| Полный Jest до последней узкой cold-render и поздних shared payment/shop правок |**158 suites /2116 tests PASS**,0 failed/skipped; [final2-jest.json](../../../output/rustore-sdk-2026-11-02/final2-jest.json) и result receipt |
| Полный локальный backend на том же verification checkpoint |**515 PASS**,17 files, fixtures only; [final2-backend-result.json](../../../output/rustore-sdk-2026-11-02/final2-backend-result.json), [лог](../../../output/rustore-sdk-2026-11-02/final2-backend.log). Прежние510 — исторический прогон |
| Последующий текущий backend/analysis epoch |**18 files / 567 tests PASS**,0 skips, последовательный runner с неизменёнными tests/timeouts; [receipt](../../../output/rustore-sdk-2026-11-02/local-qa/latest-backend-sequential-result.json), before/after594 source entries идентичны |
| Общие TypeScript и ESLint |Exit0; [TypeScript](../../../output/rustore-sdk-2026-11-02/final2-typecheck-result.json), [ESLint](../../../output/rustore-sdk-2026-11-02/final2-lint-result.json) |
| После outer-wrapper cold-render fix |**5 suites /85 tests PASS**, exact-diff TSX/read-only проверка без новых diagnostics; [targeted log](../../../output/rustore-sdk-2026-11-02/local-qa/cold-static-candidate-tests.log). Полный2116-test прогон не переименовывается в post-fix |
| Реальный R8 QA34 build |Exit0; [build-cold-static-34-result.json](../../../output/rustore-sdk-2026-11-02/local-qa/build-cold-static-34-result.json) и отдельная проверка подписанных bytes выше |
| Первый cold launch и два cold restarts финального QA34 |Все показывают160 и СОН без Home/resume/UIAutomator/diagnostic effect перед снимком; [captures](../../../output/rustore-sdk-2026-11-02/local-qa/cold-static-repeat-captures.json), [итоговый visual verdict100/pass](../../../output/rustore-sdk-2026-11-02/local-qa/cold-static-verdict.json) |
| Native Push/reminders |**11 +6 instrumentation tests PASS**, отдельные test packages, без SDK send/init; [receipt](../../../output/rustore-sdk-2026-11-02/sl-pu/native-instrumentation-verification.json) |
| UP независимые ревью |Code/scenario APPROVE на44+7 manifest inputs, receipt `504aa04e564378954370fee4a8a7e2a74325ea8c3daef7e1428a8213bd0d9567`;18 probes/124 affected tests имеют собственный scope |
| G2 native software fields |169 author analytics tests /13 pure getter checks; independent23 focused tests; actual panel показывает34/0.1.29 и `collection_enabled=false`; [review](../../../output/rustore-sdk-2026-11-02/g2/build-metadata-review.md), [actual device receipt](../../../output/rustore-sdk-2026-11-02/g2/software-build-device-verification.json) |
| IR06 synthetic CLI |Combined51 PASS; отдельно independent27 join /15 retention /11 probes; [review](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-review.md), [report](../../../output/rustore-sdk-2026-11-02/sl-ir/local-join-report.md) |

После поздних shared/cold-render правок [последний full TypeScript](../../../output/rustore-sdk-2026-11-02/local-qa/last-final-typecheck-result.json) и lint изменённых app files завершились с exit 0; состав и границы подтверждены [финальным report](../../../output/rustore-sdk-2026-11-02/final-verification-report.json). Node QA helper исключён конфигурацией project lint, поэтому ему не приписывается ESLint PASS: отдельно выполнены **9 privacy/config tests PASS** ([лог](../../../output/rustore-sdk-2026-11-02/local-qa/final-helper-config-tests.log)) и Node syntax check. Полный Jest 2116, исторический backend 515, последующие payment 169, cold 85 и новый backend 567 сохраняют свои source epochs и не суммируются.

Raw shared diff сохраняет CRLF и literal unified-patch-context whitespace warnings. [Read-only source check с учётом CR-at-EOL](../../../output/rustore-sdk-2026-11-02/local-qa/final-source-diff-check-windows-result.json) — exit0; обязательные literal patch-context строки исключены из этой проверки. Это не утверждение, что полный raw diff не содержит предупреждений. Глобальные Git-настройки/исходники ради форматирования не менялись.

Счётчики разных или пересекающихся прогонов не суммируются. `health_summary_requested` на QA34 — запрос, а не queued/delivered event: policy запрещает collection. Старые queued events сохраняют captured build33; отсутствие capability старого binary даёт `unknown`; PWA использует bundle version. Флаг не обходился ради проверки.

## Data preservation и runtime scope

[Actual33→34 migration](../../../output/rustore-sdk-2026-11-02/local-qa/up-34-migration-live-verification.json) выполнена signed sideload старого и нового **QA package**. Оба MMKV файла сохранились byte-exact до первого запуска, native preferences — без изменений. Live fixture: normal level2, решённое СОН,160coins/0gems, Review history отсутствует; refusal analytics=true/native sending=false и notification refusal сохранены. После проверки исходная QA настройка analytics opt-out=false/native requested=true восстановлена по [inventory](../../../output/rustore-sdk-2026-11-02/local-qa/qa34-restored-preference-inventory.json); QA production collection всё равно запрещена. Daily/marathon/premium/handled rich states покрыты названными deterministic suites, на устройстве они не создавались.

Первый snapshot reader ошибочно читал выделенный MMKV tail с устаревшим opt-outfalse. Reader исправлен на metadata-v4 logical actualSize+CRC; та же приватная before33 копия и live UI34 подтверждают opt-outtrue. [protectedProjectionCorrection](../../../output/rustore-sdk-2026-11-02/tracer/actual-install-up-34.json) сохраняет первоначальную ошибку и последующее корректное чтение. Byte-exact install proof от неё не зависел. Наличие storage marker не считается богатой fixture.

Основной `com.intstrfloat.slova`,0.1.29/33, не обновлялся. Два исходных main-profile хеша сохранены: `slova` — `8f7ffe538fc48a15cb02aea2ddccd08cc17f0f478acb17295bde59f02fd38ab2`; `slova.crc` — `a2248c757d033905055b9ef884e54c1ea63bb122db67fb36985351e0e73a5d58`.

Actual controlled **JS-C/JVM-B/native-B** принадлежат QA33 (`25e673eb0df448f7f47904852334207954ab8c9dfa8a2f4dabe4b93882b310cc`, archive `sdk-v2-vc33-20261104`), не QA34. [Device verification](../../../output/rustore-sdk-2026-11-02/tracer/local-device-verification.json), matching Hermes/R8/native source mapping, replay и refusal до/после restart приняты; independent evidence review —67 PASS/0 FAIL сверок. Service transport оставался off. Первоначальный JS FAIL, ограничения раннего capture и исходные fixture failures сохранены. Дополнительный QA34 crash без отдельного receipt не заявляется.

[QA34 native inspector](../../../output/rustore-sdk-2026-11-02/sl-up/local-device-verification.json) показывает Push number34, Updates decimal string34 и guardian3 support на точном `up-minified-vc34` probe artifact; receipt отдельно сверяет неизменённые native leaves с финальным cold-render candidate. `unavailable:disabled` получен до Updates factory; review prepare-error/discard не открывает форму и не создаёт attempt history. Это native guard/failure-path evidence, не реальный store/download/install. Acquisition через RuStore installer/MMP также не проверена sideload.

## Упрощения и сохранённые границы

Использованы existing analytics identity/outbox/consent, fullscreen token owner, native reminder budget и платёжная authority. Вторые collector/очередь/assignment, Pay и GameCenter не вводились. Updates имеет отдельный bounded durable result marker; он не заменён RAM-флагом и не переписывает unreadable старый transport. Не появилось нового deployed sender или фонового retry service.

[Cold-render дефект](cold-render-check.md) устранён узкой заменой внешнего `Animated.View` с enter/exit на обычный `View`; временный QA render-log удалён. SDK policy, сохранения, награды и данные этим исправлением не менялись. Optional R8 warnings существующих ad-mediation adapters сохранены; этот SDK проход их не вводил и не проверял реальные рекламные сети.

IR06 использует **calendar D7 UTC+03:00**, отдельно от elapsed-24h G4. VAT0.25 — supplied synthetic math parameter, не утверждение закона. SDK impression estimate исключён из net revenue/cost. Настоящие finance statements, acquisition mapping, causal effect и прибыль не выводятся из fixtures.

## Финальная локальная сверка и cleanup — 5 ноября 2026

[Device cleanup](../../../output/rustore-sdk-2026-11-02/local-qa/final-device-cleanup.json) подтверждает force-stop собственных QA/test packages **до** восстановления исходных `Wi-Fi=1 / mobileData=0`, удаление собственных reverse ports 18788/18081, сохранение обоих исходных main-profile hashes, QA level 2 / SON / 160 coins / 0 gems и исходной QA preference. Slova AVD остановлен без wipe, замены или удаления guest data. Частичный status этого device receipt в момент записи закрыт последующими host/registry receipts ниже.

[Host cleanup](../../../output/rustore-sdk-2026-11-02/local-qa/final-host-cleanup.json) подтверждает остановку проверенного backend PID 108856, отсутствие Metro и процессов собственного AVD. Другие устройства emulator-5554 / emulator-5558 оставлены работающими; shared Gradle daemon не завершался. [Registry release](../../../output/rustore-sdk-2026-11-02/local-qa/final-registry-release.json) — PASS: owner освобождён, guest state сохранён, остальные registry entries не изменены. Ordinary main APK/AAB никогда не устанавливались; основной профиль остался исходным.

Локальная реализация, ordinary/QA artifact verification, проверка сохранений и cleanup выполнены. Точные доказательства и их границы собраны в [финальной проверке](../../../output/rustore-sdk-2026-11-02/final-verification-report.json), [реестре требований](../../../output/rustore-sdk-2026-11-02/requirements-ledger.json) и [хэшированных локальных закрытиях](../../../output/rustore-sdk-2026-11-02/final-local-closures.json). Исторические неудачи и author checkpoints сохранены отдельно.

## Будущий выпуск — не выполнялся локально

Для выпуска отдельно нужны approved production configuration, больший versionCode, signed main-package AAB с исходным ключом и финальная проверка сертификата/канала; реальная store installation; live Push/token/sender admission; real Review form и Updates download/install/cancellation/reboot; AppMetrica/referrer/crash receipt с разрешённым сбором; актуальные privacy/declarations, cohorts/holdout и store requirements. Реальные ad networks, MMP exports и finance join также требуют своих проверок. Этот checklist не разрешает публикацию, серверный deploy, campaign write или платёж и не превращает локальный QA AAB в магазинный релиз.
