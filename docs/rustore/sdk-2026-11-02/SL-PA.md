# SL-PA — решение не внедрять Pay SDK

Решение владельца от 2 ноября 2026: Pay SDK не подключать. Основание — продуктовое ограничение, указанное владельцем; юридическая допустимость здесь не устанавливается.

Статус итерации: `owner_decided_not_integrate`. Новые dependency, RuStorePayProvider, SKU и продажи не создаются. GameCenter остаётся отложенным по исходному драфту; его зависимость от Pay не отменяет это решение.

Исходная база: `52aa1b71622d4a1be7885c9b9ebe644e78f9f4cb` плюс существующее рабочее дерево, манифест `output/rustore-sdk-2026-11-02/g0/workspace-baseline.json`. Текущая оплата — Robokassa v3; legacy YooKassa provenance и безопасная миграция pending уже существуют в `src/features/monetization/subscription.ts`.

Платёжный код и пользовательские права этой итерацией не изменены. Отдельного флага включения Pay нет: библиотека и провайдер отсутствуют. Откат решения не производится автоматически; для будущего подключения нужен новый продуктовый выбор. Существующее восстановление и обслуживание оплат продолжают принадлежать текущему backend.

Локальная проверка: `subscription.test.ts` и `subscriptionAutoSync.test.ts`, 2 набора / 141 тест, PASS. Результат: `output/rustore-sdk-2026-11-02/g0/existing-entitlements-tests.log`. Это mock backend проверки сохранения текущего контракта; реальные списания, sandbox RuStore Pay и операции с production не выполнялись.

Новые Pay-сценарии PA02–PA07/PA09–PA10 в части нового провайдера: `not_applicable_owner_rejected`, а не PASS. Защита текущих прав и fullscreen исключение checkout остаются применимыми общими требованиями других локальных изменений.

Релиз и публикация исключены новым указанием владельца: текущая работа выполняется локально на выделенном AVD Slova. Будущие store-проверки не выдаются за выполненные.

## Сохранение existing provider — 5 ноября 2026

[Независимое decision review](../../../output/rustore-sdk-2026-11-02/decision-review.md) принимает решение не добавлять Pay в текущем local-only scope. Это review первоначальных карточек и границ evidence; его исторические хеши не заменяются хешами данного addendum. Новые Pay-provider сценарии остаются неприменимыми по решению владельца, а проверки существующих прав/checkout продолжают действовать.

После поздних shared subscription/shop правок текущая existing-provider ветка прошла **3 suites / 169 tests PASS** с обычным timeout: [receipt](../../../output/rustore-sdk-2026-11-02/local-qa/current-payment-final-quiet-result.json), [лог](../../../output/rustore-sdk-2026-11-02/local-qa/current-payment-final-quiet.log). Сохранён первоначальный 5000 ms timeout под нагрузкой native build, затем успешный isolated retry и quiet full 169; timeout не повышался. Исходный 141-test baseline выше остаётся отдельным датированным checkpoint.

Локальные fake-gateway backend regressions существующих providers — **200 PASS** ([scope receipt](../../../output/rustore-sdk-2026-11-02/local-qa/existing-payment-backend-regression-result.json), [лог](../../../output/rustore-sdk-2026-11-02/local-qa/existing-payment-backend-regression.log)); исторический полный backend checkpoint — **515 PASS** ([receipt](../../../output/rustore-sdk-2026-11-02/final2-backend-result.json), [лог](../../../output/rustore-sdk-2026-11-02/final2-backend.log)). Это пересекающиеся проверки, их числа не суммируются. [Final verification report](../../../output/rustore-sdk-2026-11-02/final-verification-report.json) сохраняет границы полного прогона и последующих shared-source проверок, включая отдельный текущий analysis/backend epoch 567. Нового Pay SDK/provider/SKU, реального платежа или выдачи новых прав этими проверками не создавалось; production/deploy/store действия не выполнялись.
