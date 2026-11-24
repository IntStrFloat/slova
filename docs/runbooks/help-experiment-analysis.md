# P7: baseline и trial сквозного help-запроса

`scripts/analyze-help-experiment.cjs` — dependency-free offline analyzer. Он читает
тот же pure JSON default config, что runtime (`src/core/config/helpExperiment.defaults.json`),
и не импортирует Expo/native/storage. Он не включает trial, не получает remote
config, не меняет кампании и не выдаёт production certification.

```powershell
node scripts/analyze-help-experiment.cjs --input C:/private/slova-events.jsonl --input C:/private/slova-sdk.csv --config C:/private/reviewed-help-config.json --evidence C:/private/help-evidence.json --phase trial --epoch declared-trial-epoch --as-of 2026-11-05T15:00:00+03:00 --source observation --output output/product-improvements-2026-11-04/p7/trial-analysis
node scripts/analyze-help-experiment.cjs --needs-raw-data --phase trial --as-of 2026-11-05T15:00:00+03:00 --source observation --output output/product-improvements-2026-11-04/p7/needs-raw-data
```

Input JSON/JSONL/NDJSON/CSV и sanitized errors переиспользованы из P3/P5.
`--input` повторяется; `--config`/`--evidence` — JSON objects. Без config берётся
общий all-off defaults; без evidence — missing proofs. `--epoch` только проверяет
равенство объявленному epoch, не создаёт/не переопределяет его. Phase обязателен;
window/sample/MDE/harm/horizon CLI overrides отсутствуют. Защищены canonical paths
и inode identities всех raw/config/evidence inputs, включая hardlinks; JSON/MD не
могут alias друг друга. Parser errors не содержат сырой payload/секреты.

Без raw — `needs_raw_data`, `metrics=null`. Корректный draft config с null epoch/
allocation/window даёт blocked definition, а не выдуманные числа. Shipped defaults
сохраняют обе фазы disabled, production epochs/policy/allocation/window/baseline/
MDE/useful effect/n/harm/horizon/proofs null. Source production — только caller label;
`productionMetricsVerified=false` и `activationPerformed=false` сохраняются.

## Явные scopes

Runtime ID `slova_wheel_help_clarity_20261104`, eligibility version `help_deficit_v1`,
unit `sdk_player`, variants control/treatment. Native SDK UInt64 device ID — string,
installation — private continuity check. `clarity` не является trial arm.

First claim scope: SDK + implementation + eligibilityVersion + measurement_phase +
declared eligibility_epoch. Trial assignment добавляет allocationVersion.
Baseline — отдельная explicit control-only phase без assignment. Один SDK может
иметь baseline и позднее trial first claim. Два origins одного scope — конфликт.
Trial claim без assignment — observed linkage loss, никогда baseline/воображаемый arm.
Actual scoped assignments, включая orphan/unknown origin и no exposure/ad/grant/help,
остаются в ITT. Unknown variant/scope/clock не выбирается по первой или поздней копии.

Assignment связывается с immutable original query по известному SDK/install scope,
origin ID и strict canonical attempt/level/mode/date/content proof. Одного совпадения
origin ID и timestamp недостаточно. Same-level restart и disjoint content identifiers
не являются exact proof; consistent compact exact-attempt entry может явно соединить
известные content identifiers. Те же canonical proof rules действуют для exposure.
Неподтверждённая связь оставляет исходный arm/assigned N с unknown outcome/bounds и
блокирует data health/effect. Runtime assignment/exposure не дублируют hint quote:
отсутствие optional hint/price/balance не заполняется догадкой. Если они переданы,
значения должны быть typed и согласованными с original query; malformed supplied
values и противоречивые hint aliases не приравниваются к отсутствующим полям.

Missing phase/epoch — unproven. Certain selected membership, possible membership и
out-of-scope records различаются. Possible assignments имеют отдельный count/upper
bound и блокируют SRM/effect; их не вырезают ради хорошей доли. Phase selection идёт
после общей P6 reconciliation с сохранением private clock/install/identity alternatives.
Нельзя сначала отфильтровать raw array по phase/range: outcomes после enrollment end,
legal opt-in completion, consent continuity и альтернативная конфликтная копия должны
остаться в proof context.

## Общий proof context

Экспорты P5: `createHelpExperimentAnalysisContext(records,{asOf,timezone,source})` →
sealed closure с `analyzeScope(spec)` и numeric `quality()`; наружу выходят агрегаты,
не SDK/origin/attempt/event IDs. Spec: experimentId, eligibilityVersion, phase,
eligibilityEpoch, allocationVersion, enrollmentFrom, enrollmentToExclusive,
primaryWindowMinutes; optional acceptedOriginVersions, deliveryLagMs,
assignmentLookAt, observationTo. Trial spec также требует `trialPlanFingerprint`.
Primary window отдельно от неизменных help10m и
earned24h. Initial supported primary window — 10; иной выбор blocked, не mislabeled10.
Baseline analysis window может быть null: collection/arrival работают, estimate нет.

P6 install port `createCalendarObservationContext` и install D1/D7/D14 не меняются.
Trial D1/D7 — exact calendar day первого trial request, с all-assigned arm counts и
полной target-day maturity. Timezone — explicit fixed offset, максимум ±14:00.
ActiveTimeMs/time_coverage не permission нового wall-clock события; P6 per-event
consent/epoch/clock guards, absence gaps, exact canonical attempt/content и positive
proof-first behavior сохраняются. Никаких +1ms/tolerance/restart-as-origin.

`analyze-help-funnel.cjs` сохраняет weekly API и optional `measurementScopes` для
явных фаз. Имена baseline/current его P3 недель — comparison periods, не enrollment
phase. SDK-only implicit primary больше не используется. Historical first flags без
phase не создают baseline.

## Readiness, health, decision

`validateHelpExperimentReadiness(config,evidence)` — pure provided-world validator.
Shared full synthetic fixtures: `scripts/fixtures/help-experiment-readiness.v1.json`;
их читают CJS и TS validators. Valid synthetic baseline-ready не требует trial MDE/n/
window; valid trial-ready не требует уже наблюдённого trial SRM/D7. Actual runtime
добавляет production/native/consent/history/storage/continuity и live stop-adapter gates.
Каждый guard descriptor требует boolean `required` и поддержанные id/unit/source,
включая optional guards. При `required=true` дополнительно обязательны полные
refs/method/window/margin/minN. Optional known descriptor с незаполненным method
не становится required guard и не заменяет его. Shared corpus включает malformed
historical baseline ranges и unsupported/ill-typed guard contracts для TS/Node parity;
historical baseline range не зависит от текущего trial freeze predicate.
Для complete reviewed baseline, используемого в trial planning, все first-eligible
units должны быть учтены: при unknownOutcomes=immatureUnits=0 требуется
`firstEligibleSdkUnits === matureN` и `successes + knownFailures === matureN`.
Неучтённая часть cohort не превращается в complete-case estimate. Это ограничение
trial evidence; partial/read-only baseline и независимый сбор first claims допустимы.

Baseline collection требует frozen baseline scope и common proofs. Trial использует
declared baseline range/definitionRef, reviewed matching baseline и отдельный текущий
frozenAt после baseline review и до trial.from. Он не требует текущего baselineReady:
historical baseline analysis разрешён при выключенном baseline collection.
DefinitionHash — metric/producer definition; полный config/evidence/input SHA audit
отдельно фиксирует изменение n/MDE/guards/horizon. Ref не доказывает неизменность файла.

`trial_plan_fingerprint` — JS-only lower32hex token на original trial request,
парном rejection, assignment и exposure. Node и TS используют один pure
`src/core/analyticsKeyToken.cjs`: sorted full-config JSON с code-unit ordering
ключей, порядок arrays сохраняется. Expected token вычисляется из полного config;
baseline его не требует. Missing/malformed/mixed/mismatched token на любой semantic
или delivery copy сохраняет actual assigned SDK units в ITT с unknown/bounds,
блокирует SRM p-value и effect; matching-only cohort не строится. Token не входит
в native reward context. Это lookup token плана, не crypto proof, identity hash
или content fingerprint; отдельный SHA256 audit фиксирует config/evidence/input.

Observed health считает exact assigned SDK units, first-claim/assignment observed union,
orphans/pending joins/unknown scopes/versions и frozen data-loss rules после delivery lag.
Observed-union rate не population delivery rate: обе отсутствующие стороны не видны,
population denominator/rate null. Required independent reconciliation остаётся отдельным
provided evidence, не выводится из local enqueue/SDK handoff. N0 — not_started/missing,
не safe и не statistical failure. Unfrozen rules/ambiguity не дают health pass.

SRM — exact two-sided Binomial(n,.5), не exposure counts. Fixed preregistered assignment
cutoffs и alpha budget/number-of-looks; look pending до cutoff+delivery lag. Unknown
variant/membership/time → p=null; никаких favorable imputations. Exact calculation
uses mode-centred log recurrence, O(n)/O(1), underflow comparisons use logP.

Effect — P6 Wilson95 и Newcombe independent-proportion difference при complete mature
known outcomes и valid health. Unknown outcomes сохраняют N и identification bounds,
sampling CI null; complete cases не подменяют ITT. Поддержан declared normal-design
sample check alpha=.05/power=.8; n не вычисляется из отсутствующего baseline/MDE.
Minimum useful effect и MDE различаются, pp делятся на100 ровно один раз.

Final decision требует entire frozen enrollment/sample и primary/D7+lag horizon.
Сильный interim result не winner. После max horizon при недоборе — inconclusive,
без автопродления/докупки. При valid final CI lower ≥ useful margin и required guards
pass → supports_treatment advisory; interval/guard uncertainty — inconclusive.
Unsupported required distribution guard остаётся unavailable, не удаляется из плана.
Assessment также сверяет объявленные unit/source/window и observability EvidenceRef.
Return D1 не подменяется D7, а unsupported origin/duration не получает safe.
Incident guards поддерживают assigned SDK / domain proof / zero count / first-request
primary window; граница deadline inclusive, safe требует maturity. Отдельная safety
проверка сохраняет confirmed incidents на всём frozen followup, включая более поздние.

## Safety и fleet stop

Scoped two distinct real positive coin credits/reward с доказанным install scope —
authoritative duplicate. Exact legal `subscription_error`, stage checkout, mode live,
reason `invalid_confirmation_url|browser_unavailable|payment_create_failed|billing_gateway_invalid_response|billing_bad_configuration`
— narrow actual checkout observer proof. Raw stage copies сверяются отдельно с общим
canonical legal event; contradiction → possible/unknown, не выбранная первая копия.
QA/test, future после declared asOf и quarantined SDK rows не становятся stage/clock/
scope witnesses. Authoritative membership в followup/primary window доказывается
конкретным legal reconciled canonical event и известным assigned install scope.
Private conflicting alternatives могут локализовать possible/unknown, но не одолжить
canonical pre-assignment событию более позднее время. Missing event ID остаётся
possible, не authoritative; legal current incident не стирается исключённой будущей
или QA-копией.
Cancel/pending/validation/sandbox и technical_operation latch diagnostic не proof.
Loss/crash без authoritative export не имитируются. Confirmed incident даёт stop_safety
независимо от p/n; SDK assignment/ITT и reward recovery сохраняются.

Fleet contract: fixed RuStore RC key `slova_help_experiment_stop_v1`, typed schemaVersion/
experimentId/eligibilityEpoch/numeric allocationVersion/revision/disabledVariants и bounded
live monotonic lease. Локальный adapter прошёл отдельное независимое review
(`output/product-improvements-2026-11-04/reviews/point7-stop-review-2.json`);
native compile, реальная console value и fleet coverage пока не подтверждены.
Unavailable/stale/old binary/scope mismatch denies trial; baseline не требует
trial lease. CLI не fetches и не настраивает key. Pure stopControl EvidenceRef не actual
connection. Console value/fleet rollout/global proof сейчас не подтверждены, defaults off;
нельзя объявлять защиту установленной только из локального helper или fixture.

## API и development checks

Экспорты: analyzeHelpExperiment, buildNeedsRawDataReport, validateHelpExperimentReadiness,
evaluateHelpExperimentDecision, exactSrm, difference95, sampleSize, readInputFiles,
renderMarkdown, parseArguments. Public output содержит counts/bounds/reasons/guard states,
scopes, expected plan token и whole-input/config SHA; raw words/email/content fingerprint/SDK/install/assignment/flow/
reward/transaction IDs не выходят в JSON/MD/errors.

```powershell
node --test backend/scripts/__tests__/help-experiment-analysis.test.cjs backend/scripts/__tests__/help-funnel-analysis.test.cjs backend/scripts/__tests__/weekly-retention-analysis.test.cjs backend/scripts/__tests__/product-improvements-analysis.test.cjs backend/scripts/__tests__/retention-analysis.test.cjs
node --check scripts/analyze-help-experiment.cjs
node --check scripts/analyze-help-funnel.cjs
node --check scripts/analyze-retention.cjs
node node_modules/eslint/bin/eslint.js --no-ignore scripts/analyze-help-experiment.cjs scripts/analyze-help-funnel.cjs scripts/analyze-retention.cjs backend/scripts/__tests__/help-experiment-analysis.test.cjs backend/scripts/__tests__/help-funnel-analysis.test.cjs
```

Это implementer development evidence. Fresh whole-point Solo и formal acceptance root
выполняет после интеграции runtime/measurement/stop lanes. Local code/fixture PASS не
production raw baseline, rollout, console verification или trial activation.
