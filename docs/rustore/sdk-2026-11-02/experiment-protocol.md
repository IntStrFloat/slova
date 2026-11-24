# SL-RC / G4 — protocol for a future single-factor experiment

Status: local development protocol; live dates, audience size and rollout remain unset. `ANALYTICS_EXPERIMENTS` stays empty and the new transport defaults to disabled. The owner requested local work without a RuStore update or production campaign. Synthetic local scenarios validate delivery, assignment and parameter consumption only.

## Hypothesis and treatment

Question: does increasing the required visible gameplay interval between interstitial ads preserve total value per install while improving return/play? The sole changed parameter is `ads_interstitial_interval_seconds`: control **300**, candidate **420**. This is the interval condition in the actual policy, rather than a promise that an ad appears at that time. First-session/onboarding protection, completed-level requirements, rewarded cooldown, reward amounts, level content and paid rights keep their existing values.

The control value must be revalidated against the eventual release's local defaults before activation. The Remote Config document changes one factor only; mixing retention unlocks or other ad counters is rejected by the parser. The schema-valid candidate fixture is [interval-experiment.example.json](interval-experiment.example.json); a schema-valid minimal disable document is [config-disabled.example.json](config-disabled.example.json). Neither file is imported by the app or sent to a remote service. The candidate's document flag does not activate the locally disabled transport or create an assignment; the active experiment list stays empty.

## Assignment and exposure

Analysis unit: the existing AppMetrica installation ID, with the existing durable experiment assignment and allocation version. Planned allocation is 1:1 control/candidate. The primary population is all randomized installs satisfying eligibility fixed before assignment (intention to treat); exposure is a separate diagnostic/secondary cohort, preventing selection only of players who returned far enough to see the feature. No second random assignment, Push token, account email, referrer or session weighting is introduced. Missing assignment/consent uses control and is classified separately under the predefined eligibility rule. A future live protocol must define eligible versions, geography, start/end dates and exclusions before adding an active experiment definition.

Enrollment follows the predefined eligible assignment rule; randomized installs remain in the primary population even when they never use the parameter. Exposure starts at the first actual interval-parameter consumption, using `experiment_exposed` and the assignment/parameter dedup key. Fetch, screen focus, an already-open activity or an earlier ad-policy guard does not qualify as exposure. Event occurrence time is retained during offline replay. A started attempt keeps its immutable pin through pause, process death and ordinary protocol expiry. A late use of a historical pin is marked with an inactive exposure window and does not create new enrollment after the specified end; it is never backdated. A new attempt after expiry uses control.

## Metrics and guardrails

Primary planned metric: verified **D7 net revenue per eligible randomized install**, combining the agreed net ad revenue and verified payment ledger on the same currency/tax/time basis. Impression revenue, clicks and SDK client success are separate diagnostic measures. Existing premium installs are handled by a predefined eligibility/stratification rule, not silently removed after outcomes are observed. Report exposure timing and eligible-to-exposed coverage separately; a D1 outcome that occurred before parameter use is not described as evidence of an exposure effect.

Guardrails: D1/D7 return and meaningful gameplay, first-level/onboarding completion, crash/ANR, saved-progress failures, ad frequency and reward integrity. Retention uses elapsed 24-hour windows from installation consistently: D1 `[24h,48h)`, D7 `[168h,192h)`, and optional D30 `[720h,744h)`. A future release may choose a different convention only before enrollment and must apply it to both groups. Missing or censored data stays explicit.

## Required live inputs and fixed stopping rule

Before activation obtain a version-matched baseline export: eligible daily install count; mean and variance of D7 net revenue; D1/D7 rates; source mix; crash/save failure rates; revenue/cost reconciliation; event-delivery completeness and consent coverage. Choose a minimum economically meaningful difference and acceptable guardrail bounds with the owner. None of these values is invented from local tests.

For an initial equal-size mean-metric estimate, with two-sided alpha 0.05 and power 0.8, use `n_per_group ≈ 2 × (1.96 + 0.84)^2 × variance / absolute_MDE^2`, then validate the required sample with the actual zero-heavy revenue distribution and selected analysis procedure. Predefine treatment of multiple guardrails and interval estimation. Record the resulting sample, maximum enrollment date and at least seven complete follow-up days after the last included install. Do not repeatedly stop on a favorable p-value. Insufficient sample yields an uncertain result.

Technical rollback can happen immediately for crashes, save/reward errors, overlap or invalid configuration; it does not establish product efficacy. Return the parameter to control and disable fetch as needed, preserving assignment/consent/history. Product stopping/expansion follows the predetermined sample/window and guardrails. A source revision affecting any of these assumptions requires an amended protocol before enrollment.

## Local acceptance versus future release evidence

Local fixtures cover exact control, bounded one-factor validation, sticky assignment, no fetch-only exposure, actual ad/retention use, delayed fetch, expiry, profile/consent isolation and immutable restoration. Their dated logs prove those software behaviors. Production baseline, cohort results, actual revenue and a rollout decision are future release evidence and are not asserted by this protocol.
