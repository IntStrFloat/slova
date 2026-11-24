# Слова — каталог событий AppMetrica

Дата: 01.11.2026. Статус: draft целевого контракта; live-наблюдения measured. [Основной план](appmetrica-audit-and-plan-2026-11-01.md) · [Бриф аналитика](daily-analyst-brief-2026-11-01.md).

## Короткое сравнение

| Область | Сейчас | После изменений |
|---|---|---|
| Сессии/возвраты | SDK автоматически + custom game_session_start/first_open; собственная 30-минутная сессия | Чётко разделённые SDK и игровые сессии, active time и Dn_play |
| Уровни/слова | puzzle_started/resumed/completed, submit outcome, target word, intro milestones | Полный lifecycle с выходами/checkpoints/ошибками и устойчивым attempt/content ID |
| Клики | Home, daily, album, quests, event, subscription частично | Все значимые экраны/контролы по screen_viewed/ui_action или уже существующему эквиваленту |
| Подсказки | hint_used/help_used/semantic_clue_opened | Запрос → отказ/применение → реальный расход → следующий успех |
| Монеты/награды | Частичные coins_earned/reward_granted и legacy coins_spent | Полный committed wallet ledger + reward failures/recovery |
| Daily/неделя/quests/event | Большая часть lifecycle уже есть | Eligibility/exposure, исходное время, content fingerprints, надёжная выдача |
| Марафон | Вход/экран/нажать играть | Сохранённый вклад, пороги, выдачи, финал |
| Колесо | Отдельные начисления | Видимость, сохранённый spin, результат, связанная выдача |
| Реклама | Автособытия *_ads_sdk + частичные custom итоги | Коррелированные callback-стадии и один проверенный Ad Revenue канал |
| Подписка | Оффер/форма/checkout/status-события в коде | Backend verified lifecycle, entitlement, management, revenue/reconciliation |
| Профиль/тренировка/push/ошибки | Функции есть, покрытие неодинаковое | Результаты операций, маршрут возврата, normalized diagnostics |
| Эксперименты/качество | Поля variant/context без полного exposure-контракта | Реальные assignment/exposure и quality summary |

## Сверка кабинета и кода

В live-окне **02.10–01.11.2026** видны 101 имя; текущий прикладной код способен эмитировать 98. **89 совпадают**, **12 видны только в live**, **9 есть в коде, но не наблюдались в этом окне**. Разность 101−98 не означает «добавить 3 события».

12 live-only: 6 SDK-подобных имён `ad_request_ads_sdk, ad_attempt_ads_sdk, ad_filled_request_ads_sdk, ad_impression_ads_sdk, ad_click_ads_sdk, ad_reward_ads_sdk`; 6 исторических `level_start, level_complete, session_start, wrong_word, word_found, coins_spent`. Отсутствие ручного emitter для SDK-потока нормально; параметры/источник нужно подтвердить по установленному SDK.

9 code-only: `daily_carry_replaced, save_failed, subscription_browser_opened, subscription_checkout_started, subscription_invoice_created, subscription_payment_canceled, subscription_payment_confirmed, subscription_payment_failed, subscription_payment_pending`. Для них проверить reachability, опубликованную версию, eligibility, QA-gate и доставку. Не объявлять отсутствующий эмиттер или нулевую выручку по отсутствию строки.

Ниже полный union **110 имён**. «События / пользователи» — текущий снимок, а не конверсии. Пользователи пересекаются. Значения сохранены [в JSON](observed-events-2026-11-01.json); неполный день и расхождение суммы строк с заголовком на 2 описаны там. Все действия в столбце «Решение» — предлагаемые изменения, не применённые.

| Имя | Live: события / пользователи | Прикладной emitter сейчас | Решение | Источник кода |
|---|---:|---|---|---|
| `ad_attempt_ads_sdk` | 287410 / 2104 | Не прикладной emitter | Наблюдается SDK-поток; источник/семантику подтвердить, не дублировать вручную | Live Events |
| `ad_click_ads_sdk` | 6862 / 842 | Не прикладной emitter | Наблюдается SDK-поток; источник/семантику подтвердить, не дублировать вручную | Live Events |
| `ad_failed` | 2341 / 240 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/game.tsx:888](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:888); `track`: [src/features/monetization/rewarded.ts:34](C:/Users/Dima2/Documents/Slova/src/features/monetization/rewarded.ts:34) |
| `ad_filled_request_ads_sdk` | 251795 / 2077 | Не прикладной emitter | Наблюдается SDK-поток; источник/семантику подтвердить, не дублировать вручную | Live Events |
| `ad_impression_ads_sdk` | 225527 / 1784 | Не прикладной emitter | Наблюдается SDK-поток; источник/семантику подтвердить, не дублировать вручную | Live Events |
| `ad_request_ads_sdk` | 318577 / 2163 | Не прикладной emitter | Наблюдается SDK-поток; источник/семантику подтвердить, не дублировать вручную | Live Events |
| `ad_reward_ads_sdk` | 4402 / 275 | Не прикладной emitter | Наблюдается SDK-поток; источник/семантику подтвердить, не дублировать вручную | Live Events |
| `album_completed` | 2355 / 1128 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:98](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:98) |
| `album_help_seen` | 92 / 92 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/collection.tsx:106](C:/Users/Dima2/Documents/Slova/src/app/collection.tsx:106) |
| `album_opened` | 212 / 103 | Да | Канонический вход в альбом; сопоставить screen_viewed, не удваивать | `track`: [src/app/collection.tsx:134](C:/Users/Dima2/Documents/Slova/src/app/collection.tsx:134) |
| `coins_earned` | 5307 / 599 | Да | Legacy частичный источник; заменить в экономике wallet_transaction | `trackOnce`: [src/app/wheel.tsx:76](C:/Users/Dima2/Documents/Slova/src/app/wheel.tsx:76); `trackOnce`: [src/features/retention-ui/giftAnalytics.ts:11](C:/Users/Dima2/Documents/Slova/src/features/retention-ui/giftAnalytics.ts:11) |
| `coins_spent` | 4909 / 127 | Историческое имя | Исторический emitter отсутствует; заменить wallet_transaction | Live Events |
| `collectible_opened` | 154 / 23 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/collection.tsx:168](C:/Users/Dima2/Documents/Slova/src/app/collection.tsx:168) |
| `collectible_unlocked` | 22596 / 1668 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:86](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:86) |
| `collection_opened` | 212 / 103 | Да | Deprecated alias album_opened после миграции отчётов | `track`: [src/app/collection.tsx:135](C:/Users/Dima2/Documents/Slova/src/app/collection.tsx:135) |
| `cover_selected` | 8 / 7 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/collection.tsx:176](C:/Users/Dima2/Documents/Slova/src/app/collection.tsx:176) |
| `daily_album_action` | 28 / 19 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/daily.tsx:319](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:319) |
| `daily_bonus_claimed` | 581 / 236 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/retention-ui/giftAnalytics.ts:8](C:/Users/Dima2/Documents/Slova/src/features/retention-ui/giftAnalytics.ts:8) |
| `daily_bonus_seen` | 11457 / 1136 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/daily.tsx:92](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:92); `track`: [src/app/index.tsx:120](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:120) |
| `daily_carry_replaced` | Не наблюдалось | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/daily.tsx:182](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:182) |
| `daily_completed` | 1060 / 409 | Да | Original occurrence time + restore marker, daily join | `add`: [src/features/analytics/retentionEvents.ts:24](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:24) |
| `daily_eligible` | 1411 / 1264 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/daily.tsx:135](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:135); `trackOnce`: [src/app/index.tsx:158](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:158) |
| `daily_entered` | 1323 / 419 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/daily.tsx:133](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:133) |
| `daily_entry_clicked` | 1437 / 315 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/daily.tsx:168](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:168); `track`: [src/app/index.tsx:172](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:172) |
| `daily_entry_seen` | 16465 / 1243 | Да | Исправить/закрепить placement и реальную видимость | `track`: [src/app/daily.tsx:89](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:89); `track`: [src/app/index.tsx:119](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:119) |
| `daily_menu_viewed` | 903 / 171 | Да | Сохранить точный показ меню; не синоним первого redirect | `track`: [src/app/daily.tsx:90](C:/Users/Dima2/Documents/Slova/src/app/daily.tsx:90) |
| `daily_repeat_completed` | 144 / 121 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/analytics/puzzleLifecycle.ts:87](C:/Users/Dima2/Documents/Slova/src/features/analytics/puzzleLifecycle.ts:87) |
| `daily_started` | 913 / 433 | Да | Не суммировать с puzzle_started(mode=daily) | `trackOnce`: [src/app/game.tsx:432](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:432) |
| `event_action_selected` | 76 / 43 | Да | Сохранить; доменный ключ и original occurrence time при replay | `track`: [src/app/journey-event.tsx:35](C:/Users/Dima2/Documents/Slova/src/app/journey-event.tsx:35); `track`: [src/app/journey-event.tsx:39](C:/Users/Dima2/Documents/Slova/src/app/journey-event.tsx:39); `track`: [src/app/journey-event.tsx:43](C:/Users/Dima2/Documents/Slova/src/app/journey-event.tsx:43) |
| `event_eligible` | 1133 / 944 | Да | Сохранить; доменный ключ и original occurrence time при replay | `trackOnce`: [src/app/journey-event.tsx:28](C:/Users/Dima2/Documents/Slova/src/app/journey-event.tsx:28); `add`: [src/features/analytics/retentionEvents.ts:67](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:67) |
| `event_finished` | 616 / 466 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:79](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:79) |
| `event_milestone_granted` | 3611 / 912 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:75](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:75) |
| `event_progressed` | 38094 / 1018 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:70](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:70) |
| `event_screen_viewed` | 159 / 67 | Да | Сохранить; доменный ключ и original occurrence time при replay | `track`: [src/app/journey-event.tsx:26](C:/Users/Dima2/Documents/Slova/src/app/journey-event.tsx:26) |
| `feature_exposed` | 98 / 76 | Да | Расширить на все реальные карточки; visibility/feature/period | `trackOnce`: [src/app/journey-event.tsx:29](C:/Users/Dima2/Documents/Slova/src/app/journey-event.tsx:29); `trackOnce`: [src/app/quests.tsx:34](C:/Users/Dima2/Documents/Slova/src/app/quests.tsx:34) |
| `fifth_level_completed` | 1390 / 1386 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/analytics/puzzleLifecycle.ts:83](C:/Users/Dima2/Documents/Slova/src/features/analytics/puzzleLifecycle.ts:83) |
| `first_level_completed` | 1542 / 1539 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/analytics/puzzleLifecycle.ts:82](C:/Users/Dima2/Documents/Slova/src/features/analytics/puzzleLifecycle.ts:82) |
| `first_open` | 2002 / 1816 | Да | Только новый local profile; установки считать по SDK metadata | `trackOnce`: [src/features/analytics/index.ts:370](C:/Users/Dima2/Documents/Slova/src/features/analytics/index.ts:370) |
| `first_target_word_accepted` | 1664 / 1658 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/game.tsx:685](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:685) |
| `game_session_start` | 13364 / 2057 | Да | Собственная 30-минутная session; не SDK session и не attribution | `trackOnce`: [src/features/analytics/index.ts:379](C:/Users/Dima2/Documents/Slova/src/features/analytics/index.ts:379) |
| `gameplay_action` | 1930225 / 1937 | Да | Сократить частоту после миграции Dn_play; не складывать с submit/hint | `track`: [src/features/analytics/index.ts:384](C:/Users/Dima2/Documents/Slova/src/features/analytics/index.ts:384) |
| `help_offer_shown` | 949 / 641 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/game.tsx:553](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:553) |
| `help_progressed` | 25766 / 1686 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/game.tsx:691](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:691) |
| `help_used` | 18401 / 1084 | Да | Унифицировать successful help; opened semantic != новая покупка | `track`: [src/app/game.tsx:764](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:764); `track`: [src/app/game.tsx:803](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:803) |
| `hint_used` | 24822 / 1261 | Да | Сохранить applied bulb; добавить transaction/interaction | `track`: [src/app/game.tsx:763](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:763) |
| `home_primary_action` | 14619 / 1356 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/index.tsx:164](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:164); `track`: [src/app/index.tsx:171](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:171); `track`: [src/app/index.tsx:290](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:290); `track`: [src/app/index.tsx:294](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:294) |
| `home_secondary_action` | 185 / 99 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/index.tsx:295](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:295); `track`: [src/app/index.tsx:296](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:296) |
| `home_viewed` | 19445 / 1466 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/index.tsx:156](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:156) |
| `independent_level_completed` | 1588 / 1583 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/game/settlement.ts:151](C:/Users/Dima2/Documents/Slova/src/features/game/settlement.ts:151) |
| `interstitial_eligible` | 10071 / 959 | Да | Перенести канонический факт в ad_lifecycle eligible/skipped; старое имя оставить в истории, без двойного счёта | `track`: [src/app/game.tsx:879](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:879) |
| `interstitial_shown` | 9385 / 953 | Да | Legacy после dismiss; новый факт — ad_lifecycle(stage=impression) | `track`: [src/app/game.tsx:885](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:885) |
| `interstitial_skipped` | 78968 / 1829 | Да | Перенести канонический факт в ad_lifecycle eligible/skipped; старое имя оставить в истории, без двойного счёта | `track`: [src/app/game.tsx:874](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:874) |
| `intro_completed` | 1471 / 1464 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/game/settlement.ts:180](C:/Users/Dima2/Documents/Slova/src/features/game/settlement.ts:180) |
| `level_complete` | 4796 / 157 | Историческое имя | История прежней схемы; не добавлять заново | Live Events |
| `level_reward_claimed` | 95688 / 2000 | Да | Не считать второй победой; закрепить stage и награду | `track`: [src/app/game.tsx:577](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:577) |
| `level_start` | 16062 / 425 | Историческое имя | История прежней схемы; не добавлять заново | Live Events |
| `marathon_entry_clicked` | 447 / 236 | Да | Вернуть status после allowlist; entry/context | `track`: [src/features/retention-ui/MarathonEntry.tsx:29](C:/Users/Dima2/Documents/Slova/src/features/retention-ui/MarathonEntry.tsx:29) |
| `marathon_play_clicked` | 318 / 165 | Да | Вернуть status; intent не начало пазла | `track`: [src/app/marathon.tsx:82](C:/Users/Dima2/Documents/Slova/src/app/marathon.tsx:82) |
| `marathon_screen_viewed` | 571 / 237 | Да | Вернуть status; separate phase eligibility | `track`: [src/app/marathon.tsx:46](C:/Users/Dima2/Documents/Slova/src/app/marathon.tsx:46) |
| `notification_opt_in_clicked` | 28 / 28 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/features/retention-ui/ReminderAction.tsx:47](C:/Users/Dima2/Documents/Slova/src/features/retention-ui/ReminderAction.tsx:47) |
| `notification_permission_result` | 7 / 7 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/features/retention-ui/ReminderAction.tsx:30](C:/Users/Dima2/Documents/Slova/src/features/retention-ui/ReminderAction.tsx:30) |
| `notification_soft_ask_result` | 21 / 21 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/features/retention-ui/ReminderAction.tsx:20](C:/Users/Dima2/Documents/Slova/src/features/retention-ui/ReminderAction.tsx:20) |
| `onboarding_assigned` | 1980 / 1795 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/_layout.tsx:91](C:/Users/Dima2/Documents/Slova/src/app/_layout.tsx:91) |
| `onboarding_field_ready` | 1807 / 1792 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/game.tsx:474](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:474) |
| `puzzle_completed` | 91034 / 1866 | Да | Сохранить once-per-puzzle; исправить assisted, original time, active time | `trackOnce`: [src/features/analytics/puzzleLifecycle.ts:80](C:/Users/Dima2/Documents/Slova/src/features/analytics/puzzleLifecycle.ts:80) |
| `puzzle_resumed` | 9275 / 1272 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/analytics/puzzleLifecycle.ts:37](C:/Users/Dima2/Documents/Slova/src/features/analytics/puzzleLifecycle.ts:37) |
| `puzzle_started` | 84147 / 1843 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/analytics/puzzleLifecycle.ts:41](C:/Users/Dima2/Documents/Slova/src/features/analytics/puzzleLifecycle.ts:41) |
| `quest_action_selected` | 60 / 41 | Да | Сохранить; доменный ключ и original occurrence time при replay | `track`: [src/app/quests.tsx:39](C:/Users/Dima2/Documents/Slova/src/app/quests.tsx:39) |
| `quest_completed` | 12823 / 1480 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:56](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:56) |
| `quest_created` | 18558 / 1572 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:53](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:53) |
| `quest_screen_viewed` | 120 / 62 | Да | Сохранить; доменный ключ и original occurrence time при replay | `track`: [src/app/quests.tsx:33](C:/Users/Dima2/Documents/Slova/src/app/quests.tsx:33) |
| `quest_set_completed` | 3682 / 1333 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:60](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:60) |
| `reminder_consent` | 45 / 40 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/notifications/reminders.ts:148](C:/Users/Dima2/Documents/Slova/src/features/notifications/reminders.ts:148) |
| `reminder_delivered` | 34 / 9 | Да | Уточнить: факт native dispatch/публикации, не прочтение пользователем | `trackOnce (native ledger)`: [src/features/notifications/reminderTelemetry.ts:70](C:/Users/Dima2/Documents/Slova/src/features/notifications/reminderTelemetry.ts:70) |
| `reminder_gameplay` | 1 / 1 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/features/notifications/reminderTelemetry.ts:115](C:/Users/Dima2/Documents/Slova/src/features/notifications/reminderTelemetry.ts:115) |
| `reminder_opened` | 1 / 1 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce (native ledger)`: [src/features/notifications/reminderTelemetry.ts:70](C:/Users/Dima2/Documents/Slova/src/features/notifications/reminderTelemetry.ts:70) |
| `reminder_scheduled` | 149 / 39 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce (native ledger)`: [src/features/notifications/reminderTelemetry.ts:70](C:/Users/Dima2/Documents/Slova/src/features/notifications/reminderTelemetry.ts:70) |
| `review_flow_finished` | 1271 / 1269 | Да | SDK flow finished/dismiss; не published review | `track`: [src/app/game.tsx:940](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:940) |
| `reward_granted` | 55110 / 1730 | Да | Расширить на все reward sources; доменный rewardId, wallet не суммировать повторно | `track`: [src/app/game.tsx:851](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:851); `trackOnce`: [src/features/game/settlement.ts:187](C:/Users/Dima2/Documents/Slova/src/features/game/settlement.ts:187) |
| `reward_presentation_seen` | 1858 / 698 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/collection.tsx:169](C:/Users/Dima2/Documents/Slova/src/app/collection.tsx:169); `trackOnce`: [src/app/index.tsx:121](C:/Users/Dima2/Documents/Slova/src/app/index.tsx:121) |
| `rewarded_completed` | 4059 / 268 | Да | Legacy outcome; сверять provider reward и фактический grant | `track`: [src/features/monetization/rewarded.ts:33](C:/Users/Dima2/Documents/Slova/src/features/monetization/rewarded.ts:33) |
| `rewarded_requested` | 7210 / 429 | Да | Сохранить intent; добавить opportunity_id | `track`: [src/features/monetization/rewarded.ts:17](C:/Users/Dima2/Documents/Slova/src/features/monetization/rewarded.ts:17) |
| `route_card_opened` | 70 / 35 | Да | Вернуть landmarkId или canonical content ID | `track`: [src/app/collection.tsx:165](C:/Users/Dima2/Documents/Slova/src/app/collection.tsx:165) |
| `save_failed` | Не наблюдалось | Да | Сохранить совместимость; добавить normalized operation/retry | `track`: [src/app/game.tsx:586](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:586); `track`: [src/app/game.tsx:649](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:649); `track`: [src/app/game.tsx:730](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:730); `track`: [src/app/game.tsx:772](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:772); `track`: [src/app/game.tsx:848](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:848) |
| `semantic_clue_opened` | 756 / 336 | Да | Разделить already_owned/view от покупки; точный cost charged | `track`: [src/app/game.tsx:802](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:802) |
| `session_start` | 1808 / 211 | Историческое имя | История прежней схемы; не добавлять заново | Live Events |
| `setting_changed` | 164 / 102 | Да | Только разрешённые enum; отказ не обходить отдельным трекингом | `track`: [src/features/settings/index.ts:32](C:/Users/Dima2/Documents/Slova/src/features/settings/index.ts:32) |
| `shuffle_used` | 74359 / 1014 | Да | Сохранить; типизированный контракт/общий контекст | `track`: [src/app/game.tsx:820](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:820) |
| `subscription_browser_opened` | Не наблюдалось | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/subscription.ts:375](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:375) |
| `subscription_checkout_started` | Не наблюдалось | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/subscription.ts:500](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:500) |
| `subscription_error` | 427 / 141 | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/app/shop.tsx:113](C:/Users/Dima2/Documents/Slova/src/app/shop.tsx:113); `trackSubscription`: [src/app/shop.tsx:144](C:/Users/Dima2/Documents/Slova/src/app/shop.tsx:144); `trackSubscription`: [src/features/monetization/subscription.ts:404](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:404) |
| `subscription_form_opened` | 2 / 2 | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/app/shop.tsx:244](C:/Users/Dima2/Documents/Slova/src/app/shop.tsx:244) |
| `subscription_invoice_created` | Не наблюдалось | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/subscription.ts:223](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:223) |
| `subscription_offer_clicked` | 23 / 19 | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/app/settings.tsx:86](C:/Users/Dima2/Documents/Slova/src/app/settings.tsx:86); `trackSubscription`: [src/features/monetization/SubscriptionOffer.tsx:52](C:/Users/Dima2/Documents/Slova/src/features/monetization/SubscriptionOffer.tsx:52); `trackSubscription`: [src/features/monetization/usePostAdSubscriptionOffer.ts:103](C:/Users/Dima2/Documents/Slova/src/features/monetization/usePostAdSubscriptionOffer.ts:103) |
| `subscription_offer_dismissed` | 16 / 16 | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/SubscriptionOffer.tsx:48](C:/Users/Dima2/Documents/Slova/src/features/monetization/SubscriptionOffer.tsx:48); `trackSubscription`: [src/features/monetization/usePostAdSubscriptionOffer.ts:35](C:/Users/Dima2/Documents/Slova/src/features/monetization/usePostAdSubscriptionOffer.ts:35) |
| `subscription_offer_shown` | 685 / 162 | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/SubscriptionOffer.tsx:58](C:/Users/Dima2/Documents/Slova/src/features/monetization/SubscriptionOffer.tsx:58); `trackSubscription`: [src/features/monetization/usePostAdSubscriptionOffer.ts:93](C:/Users/Dima2/Documents/Slova/src/features/monetization/usePostAdSubscriptionOffer.ts:93) |
| `subscription_payment_canceled` | Не наблюдалось | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/subscription.ts:230](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:230); `trackSubscription`: [src/features/monetization/subscription.ts:409](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:409) |
| `subscription_payment_confirmed` | Не наблюдалось | Да | Клиент наблюдает backend; revenue только canonical server/native channel | `trackSubscription`: [src/features/monetization/subscription.ts:229](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:229) |
| `subscription_payment_failed` | Не наблюдалось | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/subscription.ts:231](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:231) |
| `subscription_payment_pending` | Не наблюдалось | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/features/monetization/subscription.ts:228](C:/Users/Dima2/Documents/Slova/src/features/monetization/subscription.ts:228) |
| `subscription_shop_viewed` | 16 / 12 | Да | Сохранить; типизированный контракт/общий контекст | `trackSubscription`: [src/app/shop.tsx:104](C:/Users/Dima2/Documents/Slova/src/app/shop.tsx:104) |
| `target_word_accepted` | 283941 / 1726 | Да | Сохранить для обучения/ответов; не второй submit | `track`: [src/app/game.tsx:672](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:672) |
| `tutorial_prompt_dismissed` | 1663 / 1658 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/game.tsx:689](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:689) |
| `tutorial_prompt_shown` | 1801 / 1789 | Да | Сохранить; типизированный контракт/общий контекст | `trackOnce`: [src/app/game.tsx:500](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:500) |
| `weekly_day_qualified` | 5396 / 1660 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:32](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:32) |
| `weekly_milestone_granted` | 2053 / 845 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:39](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:39) |
| `weekly_period_closed` | 774 / 448 | Да | Сохранить; доменный ключ и original occurrence time при replay | `add`: [src/features/analytics/retentionEvents.ts:44](C:/Users/Dima2/Documents/Slova/src/features/analytics/retentionEvents.ts:44) |
| `word_found` | 841 / 15 | Историческое имя | История прежней схемы; не добавлять заново | Live Events |
| `word_submit_outcome` | 1016568 / 2061 | Да | Сохранить канонический submit; добавить attempt/context/counters | `track`: [src/app/game.tsx:660](C:/Users/Dima2/Documents/Slova/src/app/game.tsx:660) |
| `wrong_word` | 1730 / 16 | Историческое имя | История прежней схемы; не добавлять заново | Live Events |

## Новые имена целевой схемы

Предложены **37 новых имён**, сгруппированных по функции. Это не требование отправлять 37 событий на каждое действие. Stage/result объединяют однотипные переходы; каждый факт имеет единственного владельца. P1 — измерение основного пути/денег/сбоев; P2 — второе расширение. P0 исправления существующего измерения перечислены в основном плане.

Все новые поля ниже нужно добавить в per-event schema и проверить после native boundary; текущий privacy.ts их автоматически не пропустит. Имена полей target schema — проектное решение, а не утверждение об уже доступном payload. Required поля по стадии уточняет таблица; неприменимые ID не заполняются фиктивными значениями. `available_actions` — enum/bitmask, не свободный JSON; все reason/result/type — ограниченные enum. Технические корреляционные ID не использовать как повседневные группировки в UI.

| Новое событие | Этап | Точный триггер | Поля помимо общей схемы | Ключ/кратность | Решение/метрика |
|---|---|---|---|---|---|
| `app_ready` | P1 | Первый интерактивный экран запуска; cold/warm отдельно | launch_id, launch_kind, startup_ms, screen, restore_result | launch_id | Запуск и активация |
| `screen_viewed` | P1 | Фактически видимый экран/модал после навигации; не React render | screen, previous_screen, screen_visit_id, entry_source, mode | screen_visit_id | Навигация/достижимость |
| `ui_action` | P1 | Тап по ещё не покрытому значимому контролу; action принят UI | interaction_id, screen, screen_visit_id, element_id, action, outcome, blocked_reason | interaction_id; повторный намеренный tap сохраняется | Куда нажимают; intent отдельно от результата |
| `gameplay_session_summary` | P1 | Checkpoint при pause/background и редкий foreground checkpoint; final не гарантирован | analytics_session_id, revision, gameplay_visible_ms, idle_adjusted_ms, ad_ms, screen_ms, last_action | session+revision; в витрине последняя cumulative revision, не сумма | Время всех игроков, включая незавершивших |
| `puzzle_paused` | P1 | Уровень перестал быть игровым foreground: background/ad/modal | attemptId, pause_id, reason, found, target, activeTimeMs | attempt+pause_id | Перерывы и потери foreground |
| `puzzle_exited` | P1 | Явный уход с незавершённого пазла по home/back/replace | attemptId, exit_id, levelKey, exit_reason, found, target, activeTimeMs, last_outcome | attempt+exit_id | Наблюдаемый выход; не permanent churn |
| `puzzle_checkpoint` | P1 | Сохранён прогресс на уходе и раз в 60s активной игры как стартовое проектное правило | attemptId, revision, found, errors, hints_count, activeTimeMs, last_success_elapsed_ms | attempt+revision; cumulative values не суммировать | Цензурированные попытки/длительность |
| `puzzle_blocked` | P1 | Открытие или продолжение не удалось; известен итог операции | operation_id, mode, levelKey, reason, retryable, restore_state | operation_id | Контент/сохранение/нет доступного daily |
| `campaign_completed` | P2 | Подтверждено первое достижение конца опубликованной кампании | catalog_version, last_level_id, completed_count, content_version | player+catalog_version | Исчерпание 1500 уровней |
| `hint_requested` | P1 | Выбран тип помощи до проверки баланса/доступности | interaction_id, attemptId, hint_type, displayed_cost, balance, already_owned | interaction_id | Намерение и цена, не расход |
| `hint_rejected` | P1 | Помощь не применена с известной причиной | interaction_id, attemptId, hint_type, reason, balance, cost | interaction_id+result | Дефицит/сбой/недоступность |
| `no_coins_shown` | P1 | Модал нехватки средств действительно стал видимым | modal_id, screen, attemptId, requested_hint, cost, balance, available_actions | modal_id | Знаменатель дефицита |
| `no_coins_action` | P1 | Выбран rewarded/wheel/close/back из модала | interaction_id, modal_id, action, outcome, available_actions | interaction_id | Выход из дефицита |
| `wallet_transaction` | P1 | Транзакция монет сохранена доменным кошельком; после commit | transaction_id, currency=coins, delta, balance_before, balance_after, source, sink, rewardId, attemptId | transaction_id; replay с тем же ключом | Полная внутриигровая экономика |
| `wallet_transaction_failed` | P1 | Известная неудача записи/списания; не успешная транзакция | operation_id, attempt_no, intended_delta, currency=coins, source, sink, reason, retryable | operation_id+attempt_no | Ошибка/отказ без фальшивых денег |
| `reward_grant_failed` | P1 | Обещанная подтверждённая награда ещё не записана после попытки | rewardId, operation_id, attempt_no, source, reason, retryable, pending_age_ms | rewardId+attempt_no | Невыдача и восстановление |
| `wheel_opened` | P2 | Экран колеса виден | screen_visit_id, free_available, rewarded_remaining, pending_spin | screen_visit_id | Доступность и вход |
| `wheel_spin_started` | P1 | Создан и сохранён spin, право вращения подтверждено | spin_id, free_or_rewarded, free_remaining, rewarded_remaining, ad_opportunity_id | spin_id | Реальный старт, не tap |
| `wheel_spin_result` | P1 | Результат spin сохранён; статус выдачи явно отделён | spin_id, result_revision, outcome_type, amount, rewardId, grant_state | spin_id+result_revision | Результат → wallet_transaction/reward_granted |
| `feature_eligible` | P2 | Игрок впервые получил доступ в данной версии правила/периоде | feature, eligibility_version, progress, periodId, eventInstanceId | player+feature+eligibility_version+period_if_needed | Корректные знаменатели доступных функций |
| `weekly_period_started` | P2 | Создана личная неделя и сохранён anchor | periodId, anchor_day, end_day, eligibility_version | player+periodId | Личная неделя, не календарная |
| `marathon_progressed` | P1 | Вклад пазла в марафон сохранён | eventInstanceId, contribution_id, completionId, points_delta, progress, mode | eventInstanceId+contribution_id | Вклад и темп |
| `marathon_milestone_reached` | P1 | Впервые пересечён порог марафона | eventInstanceId, milestone_id, progress, threshold, occurred_at | eventInstanceId+milestone_id | Порог до выдачи |
| `marathon_reward_granted` | P1 | Награда порога записана; не нажата кнопка | eventInstanceId, milestone_id, rewardId, amount, recovery | rewardId | Сверка с wallet, не второй доход |
| `marathon_finished` | P2 | Зафиксирован terminal result: completed или expired | eventInstanceId, result, final_progress, max_progress, occurred_at, observed_at | eventInstanceId+terminal_result; строго одно финальное состояние | Завершение события по модели |
| `ad_lifecycle` | P1 | eligible/skipped после policy check; requested до SDK load; затем реальные callbacks loaded/shown/impression/click/closed/reward/error | opportunity_id, request_id начиная с requested, callback_id, impression_id_if_available, format, placement, stage, reason, latency_ms, is_test | opportunity+policy_stage либо request+callback_id; повтор callback не новый показ | Связанная воронка всех форматов; SDK-события без общего ключа не заменяют её; revenue отдельным API |
| `subscription_server_event` | P1 | Только verified backend commit: paid/renewed/refunded/auto_renew_disabled/expired | server_event_id, pseudonymous_payment_key, event_type, amount_minor, currency, environment, product_id, effective_at, binding_state | server_event_id и provider business key | Авторитетная история денег и подписки |
| `subscription_manage_action` | P2 | Результат restore/cancel_auto_renew/check_status/change_receipt_email/migration_help | operation_id, action, stage, result, normalized_reason, source | operation_id+stage | Управление подпиской без email/кода |
| `subscription_entitlement_changed` | P1 | Клиент применил подтверждённое право/его истечение | entitlement_revision, old_status, new_status, source, policy_version | entitlement_revision | Доставка права; не финансовая выручка |
| `profile_action` | P2 | Создание/переименование профиля завершено или не удалось | operation_id, action=create_or_rename, result, reason, latency_ms | operation_id+result | Профиль, без nickname/tag/token |
| `practice_lifecycle` | P2 | start/step/completed/exit самостоятельной тренировки | practice_id, stage, step_id, activeTimeMs, assistance | practice_id+stage+step | Повтор обучения отдельно от campaign |
| `notification_route_result` | P1 | После tap подтверждён показ целевого экрана либо ошибка | open_id, prompt_id_or_campaign_id, provider, destination, result, reason, launch_kind | open_id+route_result | Дошёл ли возврат до нужной функции |
| `push_lifecycle` | P2 | RuStore push received/opened только при наличии соответствующего callback | message_id_hash, campaign_id, stage, occurred_at, provider=rustore | message+stage; отсутствие delivery callback остаётся unknown | Отдельно от local reminder |
| `technical_operation` | P1 | Сбой/восстановление save/load/content/profile/network; stage=summary учитывает все попытки, включая обычные успешные | stage, operation, mode; detail: operation_id, attempt_no, result, normalized_code, latency_ms, recovery; summary: summary_id, analytics_session_id, revision, attempts, successes, failures | detail: operation_id+attempt_no+result; summary: summary_id+revision, брать последнюю cumulative revision | Причина поломки и знаменатель save failure; не свободный exception |
| `experiment_assigned` | P2 | Неизменное назначение до воздействия; только настоящий механизм | experiment_id, assignment_id, variant, allocation_version, unit_type | experiment+unit+allocation_version | SRM/ITT и аудит назначения |
| `experiment_exposed` | P2 | Пользователь действительно получил экспериментальное воздействие | experiment_id, assignment_id, variant, exposure_point, exposure_version | experiment+unit+exposure_version | Экспозиция; первичный анализ по назначению |
| `analytics_health_summary` | P1 | Агрегированный счётчик качества после восстановления, максимум раз/сессию | window_id, queue_dropped, schema_rejected, oldest_pending_ms, handoff_failures, schema_version | window_id | Самодиагностика; отказ в согласии не обходить |

Для повторных callbacks без готового SDK ID определить устойчивый callback key из request_id, stage и документированной кратности; не генерировать новый случайный ID на каждый повтор обработчика. Для refresh баннера фиксировать новый request/impression согласно реальному SDK lifecycle.

**Базовые установки, foreground SDK sessions, crashes/ANR и Revenue/Ad Revenue** не превращать в одноимённые custom события ради счётчика. Возможность и доступность каждого SDK отчёта проверяются отдельно. Рекламный доход не вычислять как показы×придуманный eCPM.

Для `subscription_server_event` финансовый ledger остаётся источником истины. Доставка в AppMetrica требует проверенного разрешённого server channel, связки анонимной identity и idempotent outbox. Если identity/consent отсутствуют, сохраняется финансовый факт в допустимом backend учёте и агрегат unlinked; не создавать фальшивую идентичность и не обходить отказ от поведенческой аналитики. Одновременная отправка standard Revenue и custom lifecycle — разные представления одного факта; суммировать их как две выручки нельзя.

## Контракт сохраняемых групп

| Существующая группа | Уточнить payload / условия | Кратность / канонический смысл |
|---|---|---|
| first_open / onboarding_assigned / onboarding_field_ready | SDK install linkage, onboardingVersion, assignment, launch latency, build | local profile≠install; field-ready только реально показанное поле |
| tutorial_prompt_shown/dismissed / first_target_word_accepted | promptId, attemptId, step, assistance, original time | prompt once-per-step, first target per intro assignment; dismiss не всегда success |
| independent_level_completed / first_level_completed / fifth_level_completed / intro_completed | intro version, levelKey, completionId, manual/assisted включая semantic | первая самостоятельная победа L2–L5; L1 исключить; count players, не sum milestones |
| puzzle_started/resumed/completed | attemptId, global levelKey, content version/fingerprint, completionId, assistance, active time, creation/occurrence | start нового attempt; resume того же; completion фактический commit; once-per-puzzle vs attempt публиковать отдельно |
| word_submit_outcome / target_word_accepted | submission_id, outcome=target/bonus/repeat/invalid/too_short, len, manual, answerIndex, bonus_reward_eligible | один submit — один outcome; raw word не передавать |
| help_offer_shown/help_used/help_progressed/hint_used/semantic_clue_opened/shuffle_used | interaction/attempt/offer ID, assistanceType, trigger, actual charged amount, transactionId, alreadyOwned | shown только visible; apply только успех; progressed через реальный следующий target |
| home_* / daily_* / collection_* / quest_* / event_* UI | screen_visit_id, element/feature/placement, eligibility, entry_source, visibility | Нельзя суммировать domain event и ui_action как два клика; existing domain CTA предпочтителен |
| daily_eligible/started/completed/repeat/carry_replaced | dateKey, actionDay, templateId/fingerprint, content version, carry source, original time | dateKey не календарь activity; carry replaced не automatically permanent churn |
| daily_bonus_seen/claimed | gift cycle, day, rewardId, currency transaction, original claim time | seen — видимость; claimed — подтверждённое получение; повторный retry не новая награда |
| weekly_* / quest_* / event_* domain | period/eventInstance/template ID, goal/threshold, eligibility rule, original time, recovery/compensation | Уникальность business key; компенсация недоступной цели выделена |
| collectible_unlocked/album_completed/reward_presentation_seen | collectible/album/catalog version/reward ID; grant source | Получено/увидено/открыто разные факты; background reconciliation не seen |
| album_opened/route_card_opened/collectible_opened/cover_selected | content ID, screen_visit, source, selected/deselected | collection_opened постепенно alias; landmarkId сейчас фильтруется |
| interstitial_eligible/skipped + rewarded_requested | opportunity_id, placement/format, reason, policy revision, foreground gameplay | Один opportunity; interstitial eligible/skipped мигрируют в ad_lifecycle, rewarded_requested остаётся пользовательским intent, не network load |
| ad_failed/rewarded_completed/interstitial_shown | stage, callback proof, opportunity/request ID, provider/test flag | Legacy значения не переопределять; canonical callbacks в ad_lifecycle |
| subscription_* client | source/stage/reason, offer/product/version, interaction/checkout correlation без token/email/URL | pending/canceled/failed/confirmed требуют backend status; браузер не подтверждает покупку |
| reminder_* / notification_* | promptId, campaign/provider, OS permission, schedule/dispatch/open/route, original time | Notification published не доказывает, что человек увидел; send/delivery/open разные |
| setting_changed / review_flow_finished | enum setting/value, SDK outcome | No PII; opt-out применить до последующих событий; review completion≠published review |

## Карта кликов

Считать «все клики» как все доступные осмысленные действия, а не координаты/жестовые кадры. Для каждого контрола в реализации нужна строка coverage checklist: screen, element_id, existing canonical event или ui_action, expected result, QA case.

| Экран | Контролы для покрытия |
|---|---|
| home | continue/play, daily, gift, quests, suitcase, marathon, collection, wheel, settings, profile и реально показанный subscription offer |
| game | ручной submit, shuffle, bulb, semantic, help offer accept/dismiss, bonus piggy-bank explanation, home/back, retry, result next, result close |
| no-coins | rewarded, wheel, close/back; shop только если он реально показан |
| daily | entry/start/resume, date/carry choice, gift, weekly reward view, album, reminders, back |
| quests / journey-event / marathon | play/claim/target action, tab/card detail, close/back; реальную награду подтверждает домен |
| collection | card detail, cover select/reset, info/help, close/back |
| wheel | free/ad spin, retry grant, close/back |
| shop / subscription | offer, form submit, browser open, status refresh, resume payment, cancel autorenew, restore, receipt email change, migration help, back |
| settings / profile | audio/music/vibration/help/notifications/analytics, practice, profile rename confirm/cancel, back |
| notification destination | open, route success/failure, actual screen, subsequent gameplay |

Контрол, скрытый в данной версии/eligibility, не входит в знаменатель CTR. Screen view не равен exposure нижней карточки за пределами viewport. Для показов карточек предложено правило: ≥50% площади видно ≥1 секунду на активном экране; параметр visibility rule фиксируется версией и проверяется в UI тесте. Существующие shown события не объявлять соответствующими этому правилу без проверки.

## Условные события

Для teams/leaderboard, word report, cloud save, IAP coin packs и App Open ads каталог не вводит обязательных production-событий сейчас. После подключения функции добавить её из того же шаблона и пройти eligibility/reachability QA. Не внедрять отсутствующую игровую функцию под видом аналитического покрытия.

## Минимальные проверочные цепочки

1. Новый install → field ready → manual submit outcomes → L1 → independent L2–L5 → L5; каждое время и build сохраняются.
2. Start → pause/ad/background → resume → completed; второй start не появляется, idle/ad время не засчитывается игре.
3. Hint request → insufficient → no-coins → rewarded → provider reward → committed wallet credit → committed hint debit → applied hint → helped completion.
4. Wheel free/ad → saved spin → saved result → durable reward; kill/retry не создаёт второй spin/кошелёк.
5. Daily carry предыдущего дня → completion сегодня → personal-week/event contribution по actionDay, original dateKey сохранён.
6. Payment webhook → verified ledger → server event → entitlement sync; browser close/reopen не дублируют paid.
7. Opt-out → JS+native+automatic producer policy; offline/restart не отправляют запрещённую историю.
8. Payload каждого нового/изменённого имени проходит typed validation и native JSON assertion; отсутствие required field — failing test.

