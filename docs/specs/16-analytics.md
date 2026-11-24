# 16 — Аналитика

Статус: реализация Android 0.1.29 / versionCode 33 · Редакция: 2026-11-01.

SDK: AppMetrica Android 8.6.0, существующий Expo bridge/config-plugin. API track/trackOnce/flushAnalytics сохранён. Плоский payload schema_version=3, storage version=2; миграция старой очереди сохраняет event_id, исходное время и контекст.

## Контракт событий

Источники истины — src/features/analytics/schema.ts, index.ts и dedupe.ts. Полный [каталог и сравнение со старой схемой](../marketing/slova/analytics/event-catalog-2026-11-01.md), [основания изменений](../marketing/slova/analytics/appmetrica-audit-and-plan-2026-11-01.md).

Envelope: event_id, occurred_at/observed_at/sdk_handoff_at, app/build, policy/content/onboarding versions, environment/release_channel, consent epoch, локальные и SDK identities при наличии. SDK UInt64 хранить строкой. Вариант эксперимента заморожен в событии при retry/restart.

Реализованы пути:

- Уровень: start/resume, pause/explicit exit, checkpoint, completion, blocked; active time и безопасный fingerprint.
- Слова/intro: результат завершённого ввода, помощь, первые самостоятельные победы; без потока буквенных кадров.
- Подсказки: запрос, отказ, применение/повторное открытие, фактическое списание, следующий успех.
- Экраны и значимые действия с фиксированными IDs. Retention-карточка считается показанной при ≥50% видимости ≥1 секунды.
- Кошелёк: подтверждённые транзакции, ошибки/повтор, reward integrity. Дополнительный wallet_balance_observed — исходный запас, не доход; это 38-е вспомогательное имя сверх 37 имён драфта.
- Daily, личная неделя, quests, suitcase, collection: original time, recovery и корректная доступность. Марафон: вклад, пороги, выдачи, финальный статус с revision.
- Колесо: сохранённый spin, результат, выдача.
- Реклама: реальные requested/loaded/shown/impression/click/closed/reward/error с correlation IDs. Preload может предшествовать показу; banner auto-refresh без request callback отмечается unknown. Рекламная выручка остаётся единственным автоматическим Ad Revenue каналом.
- Подписка: client offer/checkout/status/management/entitlement и отдельные backend verified facts.
- Профиль, настройки, тренировка, push route и технические операции.
- Реальные assignment/exposure: инфраструктура готова, активных продуктовых экспериментов по умолчанию нет.

Исторические level_start/level_complete/session_start/word_found не являются новой основной схемой и не суммируются с каноническими фактами.

## Доставка и приватность

Очередь512 с durable readback и диагностикой. Подтверждённые критичные бизнес-факты не вытесняются напоминаниями. Если новая критичная запись не помещается, возвращается null для retry доменным журналом. Lifetime dedupe не забывает факт после512ключей. Native acceptance не равен server acknowledgement.

Общий production/QA gate для custom events. Native bootstrap учитывает persisted refusal до activation; foreground SDK sessions управляются consent-gated pause/resume. Explicit off→on создаёт границу согласия: custom actions, время и достижения периода отказа позднее не отправляются. Прогресс игры/кошелёк сохраняются независимо от аналитики.

SDK8.6 не имеет публичного purge всей внутренней базы. Нельзя обещать отсутствие последующего replay внутренних SDK ad/crash записей. Runtime QA marker блокирует custom events; SDK-safe phone QA требует QA-сборки. Эмуляторы production analytics не отправляют.

Не отправляются слова, nickname/email, коды восстановления, токены, платёжные URL, произвольные ошибки и координаты касаний. Контракты принимают только разрешённые поля и bounded IDs/categories.

## Сервер и анализ

Backend сохраняет подтверждённые оплаты/продления/возвраты/изменения прав в durable journal. Custom и standard Revenue — представления одного факта, не две выручки. Transport требует отдельного Post API key и флага; без ключа external delivery выключена, endpoint/journal работают. Неоднозначный HTTP требует сверки event_id до повтора. [Runbook](../runbooks/billing-analytics.md).

[Нормализатор](../../scripts/analyze-retention.cjs) принимает legacy v2 и flat v3, различает device/install episodes и first/reinstall/unknown, считает A24, D1/D3/D7/D30 и Solve72. SDK sessions и собственная30-минутная сессия различаются. Exit не доказывает окончательный уход. Кумулятивные revisions анализируются по последней записи, не суммируются.

[Ежедневный аналитик](../marketing/slova/analytics/daily-analyst-brief-2026-11-01.md): качество/зрелость данных → инциденты → продуктовые сигналы → проверяемое действие. Расписание и продуктовые эксперименты не запускаются этим релизом.
