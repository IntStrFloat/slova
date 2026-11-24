# SL-RC — Remote Config, локальная реализация

Статус: **implemented_and_accepted_local_scope**, 4 ноября 2026. Исходная база — HEAD `52aa1b71622d4a1be7885c9b9ebe644e78f9f4cb` плюс исходный рабочий манифест G0. Текущая задача ограничена локальными исходниками, проверками и существующим AVD Slova; публикация, изменение консоли и production rollout исключены владельцем.

## Итоговая локальная приёмка root

Независимые code/scenario ревью приняли исправления exposure, resident TTL, stop-fetch expiry и обновления provenance одинакового документа. Полный прогон перед последней узкой правкой: 21 suite / 198 PASS; после неё — 2 suites / 16 PASS, TypeScript и scoped ESLint PASS. Счётчики разных прогонов не суммируются.

Выполнены фактический Android prebuild, dependency resolution без FAILED, Kotlin compile, x86_64 debug и R8-minified release QA build. Получены локальные APK и подписанный AAB отдельного `com.intstrfloat.slova.sdkqa`; исходный сертификат SHA-256 `8888e53939d854a282a0ee40e9a78e21360b50d0dd077efc2d107da155bfadcd` совпал. AAB: все 3189 payload entries проверены JarFile и jarsigner. Streaming JarInputStream для исходного Gradle-архива не заявлен; это приватный x86_64 QA artifact, подготовка магазинного артефакта вне текущего scope.

На зарегистрированном `Slova_Test_API35` (serial определён по имени) пройдён уровень 1 жестами КОТ/ТОК, выполнен переход на уровень 2 и введено СОН. После in-place debug→minified установки save был byte-exact до первого запуска. Холодный запуск minified/Hermes APK восстановил уровень 2, баланс 160 и заполненные клетки СОН без повторной награды. Три pixel-проверки отличают заполненные клетки от пустого контроля; некорректные SVG accessibility bounds не использовались как доказательство. Оба файла основного package MMKV остались byte-exact исходному G0-профилю.

Доказательства: `local-qa/rc-r8-artifact-verification.json`, `rc-r8-native-launch.json`, `rc-runtime-verification.json`, `rc-r8-partial-visual-check.json`, build-логи/скриншоты и независимые `sl-rc/code-review.md`, `scenario-review.md` в `output/rustore-sdk-2026-11-02/`. Runtime проверяет локальный control/default; включённая доставка, задержки, неверный payload, assignment и exposure проверены с fake gateway. SDK-проект и живые RuStore/production события не активировались.

## План до изменения поведения

1. Защитить текущие retention/ad defaults и новую границу конфигурации регрессиями. Доставка не создаёт новый assignment: используется сохранённый, действующий assignment существующей аналитики.
2. Добавить Android Expo bridge для `ru.rustore.sdk:remoteconfig:10.5.1`. Точные классы и методы сверены с официальной документацией и AAR через javap. Application bootstrap вызывается конфиг-плагином; `UpdateBehaviour.Actual` исключает отдельную фоновую синхронизацию SDK. Код игры не ожидает network/init.
3. Одна версия схемы и закрытый allowlist. Один эксперимент меняет один параметр; control равен локальным defaults. Ограничены размер, имена, диапазоны, варианты и возраст кэша. Цены, права, награды и содержание уровней в схеме отсутствуют.
4. Атомарно сохранять последний валидный документ и активный snapshot с readback. Новый snapshot применяется в безопасной точке между уровнями. Snapshot текущей попытки сохраняется вместе с игрой, включая process death и возврат к ранее отложенной daily. Старые сохранения используют control.
5. Привязать к локальному профилю, отказу от аналитики и действующему assignment. Смена профиля/отказ сбрасывает экспериментальные условия; запоздалый ответ не переносится. Нет отправки profile ID, email, телефона или второго SDK assignment.
6. Policy остаётся детерминированной; telemetry вызывается координатором в точке использования. `experiment_exposed` сохраняет один event family и текущий assignment, с parameter-use exposure point. Fetch/визит экрана не являются exposure.
7. Целевые unit/integration/bridge/plugin проверки, затем typecheck и lint. Root отдельно выполняет native build, AVD и независимые code/scenario ревью.

## Defaults и enable/rollback

Локально выключено: `EXPO_PUBLIC_RUSTORE_REMOTE_CONFIG_ENABLED=0`; native app ID задаётся только build-time `RUSTORE_REMOTE_CONFIG_APP_ID`. Нет ID/согласия/нового native capability — control. После первоначального согласия SDK включается при следующем cold start, чтобы соблюсти Application.onCreate и не инициализировать SDK до согласия. Opt-out запрещает последующие обращения без удаления прогресса.

Allowlist первой схемы: рекламный интервал, число новых уровней между рекламными возможностями, пороги открытия quests/event. Journey/daily/week после пятого уровня остаются защищённым обещанием onboarding. Уже выданные награды, коллекция и начатые задания не пересчитываются. Список активных экспериментов остаётся пустым до отдельного протокола; это полноценная локально проверяемая интеграция с безопасным control.

Откат: локальный флаг 0 и/или control/`fetch_enabled=false` в документе; новые fetch прекращаются, policy возвращается к control в безопасной точке. Отказ от аналитики и смена профиля сбрасывают персональную policy сразу; незавершённая игра и её награды сохраняются. Ответственный за локальный rollback — владелец проекта; source diff остаётся обратимым.

Официальный Android reference: https://www.rustore.ru/help/developers/tools/engagement-tools/remote-config/sdk/kotlin/10-5-1 . Это доставка параметров; MyTracker и RuStore A/B segmentation не подключаются.

## Точный transport и схема

Native API: `RemoteConfigClientBuilder(AppId(...), applicationContext).setUpdateBehaviour(UpdateBehaviour.Actual).build()`, `init()`, `getRemoteConfig()`, `containsKey()` и `getString()`. SDK-клиент создаётся в Application после существующего native consent bootstrap; bridge не создаёт singleton. JS capability различает отсутствие модуля, необходимость cold restart после первого согласия и готовый client. Callback проверяет generation, разрешение и живой React context. `Actual` исключает SDK background sync; начатый SDK Task не объявляется отменённым сетевым запросом, но его поздний результат не применяется после отказа/уничтожения JS context.

RuStore string-параметр: `slova_policy_v1`; максимум 16384 UTF-16 символа до разбора. Схема 1 принимает только перечисленные поля; 2–8 вариантов, обязательный `control`, одинаковый единственный параметр у всех вариантов. Значение control должно точно равняться текущему локальному default.

| Параметр | Default | Допустимые целые |
|---|---:|---:|
| ads_interstitial_interval_seconds | 300 | 120–1800 |
| ads_interstitial_new_levels | 3 | 3–10 |
| retention_quests_unlock_wins | 8 | 5–50 |
| retention_event_unlock_wins | 15 | 5–100 |

Пример локальной fixture (активный продуктовый эксперимент этим не создаётся):

```json
{
  "schema_version": 1,
  "config_version": "local_ad_delay_fixture_v1",
  "fetch_enabled": true,
  "experiment_id": "ad_delay",
  "allocation_version": 1,
  "variants": {
    "control": { "ads_interstitial_interval_seconds": 300 },
    "candidate": { "ads_interstitial_interval_seconds": 600 }
  }
}
```

Документ получает существующий действующий assignment через `analytics/experiments.ts`; неизвестный experiment/version/variant и пустой активный список дают control. SDK DeviceID/Account/short segments не используются как второй allocator. Локальный профиль используется только для хеша scope кэша/попытки; ID профиля не отправляется в RuStore.

Минимальный kill-документ: `{"schema_version":1,"config_version":"stop_v1","fetch_enabled":false}`. Он прекращает новые fetch и ставит control на ближайшую безопасную границу. Свежий cached kill сохраняется между запусками; срок кэша 7 суток. Вернуть fetch раньше можно явным локальным сбросом только `remote-config.*` state; прогресс, consent, покупки и Review state не затрагиваются. При смене Remote Config проекта его кэш также необходимо явно сбросить до новой локальной настройки; автоматическая миграция кэша между console-проектами не заявляется.

## Реальный application flow

`_layout` запускает coordinator fire-and-forget. Default OFF не импортирует SDK transport или дополнительные application stores. Включённый путь использует текущие analytics identifiers/assignment, 4-секундный timeout и 15-минутный fetch TTL; native SDK не задерживает fonts/navigation/gameplay.

Документ и активный snapshot сохраняются раздельно с readback: `remote-config.document.v1` и `remote-config.active.v1`, каждый с scope и временем получения. Неверный/просроченный кэш не применяется. Новый документ во время партии остаётся pending. Игра применяет его после завершённого сохранения/награды перед следующей попыткой, а не при fetch.

Аддитивное optional-поле `GameSnapshot.runtimePolicy` сохраняет immutable policy конкретной попытки при неизменной версии game save 2. Старые попытки без поля получают control. Пауза, process death и возврат к более старой daily не заимствуют свежую policy другого уровня. Истечение окна эксперимента не меняет уже начатую попытку: только сохранённое историческое владение assignment разрешает её старый pin; следующая попытка после expiry получает control. Смена профиля и явный opt-out являются отдельной privacy invalidation; игра/награды не стираются. Ошибка сохранения новой попытки возвращает предыдущий pin.

Retention model читает numeric snapshot без transport/analytics. Уже созданные quests/event остаются доступными при повышении порога; их состояние и выданные награды не пересчитываются. Home/quest/event подписаны на безопасные изменения policy; текст закрытого экрана использует фактический порог. Retention coordinator отмечает параметр при реальном eligibility calculation, а fullscreen coordinator — только когда ad policy дошла до соответствующего interval expression. Защитный ранний выход/не загруженная реклама не создают exposure.

## События

Новые `config_fetch_result` / `config_apply_result` содержат только result/reason, `config_version`, `config_schema_version`, `fallback_used`, `age_bucket`. Поле `config_schema_version=1` отличается от общего analytics envelope `schema_version=3`; collision/перезапись схем исключены. Age bucket ограничен `unknown/under_day/under_week/expired`.

Существующий `experiment_exposed` дополнен parameter-use point, фактической config version и `exposure_window=active/inactive`. Исторический pin после expiry может дать фактическое первое exposure с текущим временем и меткой inactive; оно не backdate-ится и не становится новым assignment. Устойчивый ключ — assignment + parameter, один на единицу SDK install/allocation. Тот же существующий analytics outbox/consent/once ledger используется без второго install event.

Список активных экспериментов в `analyticsExperiments.ts` остаётся пустым. Для будущего первого ad-delay protocol заранее определить install-единицу, одно изменение, MDE/window/sample и guardrails; local fixtures не заменяют rollout и не доказывают рост retention/revenue.

## Проверки и ограничения

Полный актуальный машинный результат и хеши находятся в `output/rustore-sdk-2026-11-02/sl-rc/implementation.json`; команды и логи — рядом. Первые policy/coordinator регрессии падали до добавления нового слоя. Контрольные старые consumers до изменения: 4 suites / 60 tests PASS. Последующий интегрированный прогон перед последними boundary additions: 20 suites / 190 tests PASS; финальный прогон отражён отдельно в JSON, TypeScript/ESLint — отдельными exit codes.

Сценарии покрывают schema/ranges/allowlist/one factor, sticky/current/historical assignment, delayed/timeout/late callback, cache restart/TTL/corruption, durable apply failure, remote stop-fetch, profile/consent invalidation, actual parameter exposure и short-circuit, startup/default OFF и повторный lifecycle owner, game-save restore/legacy/storage failure, сохранение уже начатых activities. Native bridge/plugin тесты проверяют typed capability/default/cold-restart semantics и idempotent bootstrap/configuration.

Исторический handoff executor не включал prebuild/Gradle/R8/AVD и независимое ревью; их позднейшие фактические результаты root приведены выше. Реальный console проект/доставка параметров/production events не проверялись и не требуются для текущего local-only scope; будущий выпуск потребует отдельной проверки. Локальная сборка не объявляется опубликованной.

Независимый code pass выявил два пропущенных случая: focus hook мог записать exposure, хотя feature flag/существующий instance обходили чтение порога; resident-процесс мог использовать active cache старше семи суток или держать истёкший stop-fetch без повторной проверки. Hook теперь использует тот же точный guard, выбранный параметр и подписку на retention state. Возраст active cache проверяется для configured policy; старый pin остаётся до завершения попытки, следующая безопасная граница возвращает control. Истёкший stop-fetch разрешает следующий bounded fetch. Добавлены четыре регрессии, включая 8-дневный resident process с offline refresh. По фактическому native compiler input исправлен lifecycle getter SDK56 на `appContext.hasActiveReactInstance`; повторная native сборка остаётся за root.

Финальные post-review checks на стабильных inputs: **21 suites / 198 tests PASS**, `tsc --noEmit` exit 0, scoped ESLint exit 0 без warnings, scoped `git diff --check` exit 0. Их точный scope, логи и 38 текущих source-хешей записаны в `implementation.json`. Никакие pending native/store/review строки этими результатами не закрываются.

Дополнительное TTL re-review: успешный повторный ответ с теми же version/values теперь обновляет durable active provenance в safe point. Равенство snapshot не означает равенство времени последнего валидного получения: до исправления day-6 refresh оставлял day-0 `fetchedAt`, и day-8 offline ошибочно возвращал control. Запись active cache с readback теперь предшествует ветке одинакового snapshot; обновляется только provenance, текущий pin/assignment/exposure не меняются. Новый same-process regression сначала воспроизвёл ошибку, после исправления coordinator/runtime — **2 suites / 16 tests PASS** (`same-document-ttl-before.log`, `same-document-ttl-after.log/json`). Исходный сценарий без day-6 refresh по-прежнему возвращает control после семи суток.
