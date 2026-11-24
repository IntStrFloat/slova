# Проверка Retention по выгрузке событий

`node scripts/analyze-retention.cjs` анализирует локальный JSONL без запросов к
AppMetrica и без сторонних зависимостей. Секреты и идентификаторы игроков в
итоговый отчёт не попадают. Исходную выгрузку хранить локально вне git.

## Подготовка данных

Нужны сырые события и метаданные установок/сессий за полный период наблюдения.
Сводная таблица количества пользователей по отдельным событиям не содержит
пересечения аудиторий и не заменяет выгрузку. Нельзя сложить пользователей
`level_complete`, `level_reward_claimed`, `puzzle_completed`: один игрок может
входить в каждое множество.

Одна строка JSONL — один объект. Скрипт принимает следующие поля:

| Поле | Назначение |
|---|---|
| `appmetrica_device_id` или `sdk_id` | единая SDK-идентичность между версиями; UInt64 сохранять строкой |
| `device_key` | нормализованный SDK device ID, при наличии имеет приоритет |
| `installation_id` или `install_key` | отдельный эпизод установки; не local player_id |
| `install_kind` / `install_type` | `first` / `first_install`, `reinstall`, `reactivation` или `unknown`; mapping определяется семантикой исходного install-экспорта |
| `is_reinstallation` | явный boolean из источника: false — first, true — reinstall; строка `"false"` не boolean |
| `event_name` или `name` | имя события |
| `event_json` или `params` | JSON-строка либо объект параметров |
| `event_timestamp` | Unix seconds/milliseconds |
| `event_datetime` / `occurred_at` | альтернативный ISO timestamp с `Z`/offset |
| `install_timestamp` / `install_datetime` / `installed_at` | реальное время установки |
| `install_day` | альтернативная дата установки уже в календаре UTC+3 |
| `app_version_name` | версия из SDK; для новых событий есть fallback на envelope |
| `record_type: install` / `session` | нормализованные строки из выгрузки установок/сессий |

Привести реальные имена столбцов экспорта к этому контракту. Дата без явного
часового пояса (`2026-09-20 10:00:00`) не принимается как timestamp: сначала
преобразовать её с известным часовым поясом источника. Не подставлять время
первого увиденного custom event вместо установки. Новое локальное `player_id`
не связывает историю до появления analytics envelope v2.

Старые `event_json` — плоские параметры. Envelope v2 имеет `schema_version: 2`,
`event_id`, `occurred_at`, `app_version`, `onboarding_version`,
`content_version`, `properties`. Schema v3 содержит доменные поля в корне,
контейнера `properties` нет. Все три формата принимаются. `timeKnown:false`
для восстановленного legacy milestone сохраняет неизвестное точное время:
envelope handoff не становится временем решения.

Основная A24/Dn когорта — первые **подтверждённые install episodes**. Первую
видимую запись в усечённом экспорте нельзя автоматически назвать первой
установкой. Без явной классификации эпизод попадает в unknown и не входит в
primary знаменатель. Reinstall/reactivation показываются отдельно.

Событие присоединяется по installation ID либо проверенному device/time
интервалу до следующей переустановки. Конфликтующая связь исключается и
отражается в quality. Переустановка цензурирует наблюдение предыдущего эпизода;
возврат после неё не засчитывается первоначальной установке. Версия события
продолжает отличаться от версии установки.

Пример:

```json
{"sdk_id":"local-example","installation_id":"install-example","install_kind":"first","event_name":"level_start","event_datetime":"2026-09-20T10:00:00Z","install_datetime":"2026-09-20T09:59:00Z","event_json":{"id":1,"daily":false}}
```

## Запуск

```powershell
node scripts/analyze-retention.cjs --input C:/private/slova/events.jsonl --as-of 2026-10-03T12:00:00+03:00 --cohort-from 2026-09-04 --cohort-to 2026-09-25
```

`--as-of` обязателен: расчёт не зависит от даты на машине. Когорты ограничивают
только D1/D3/D7; показатели событий/прохождений относятся ко всей входной
выгрузке. `--attempt-window-hours` меняет окно прохождения (по умолчанию 72).
Вывод — агрегированный JSON в stdout; при необходимости перенаправить его
в локальный файл.

## Что означают показатели

- `completionEvidence.usersInBoth` — пересечение игроков со стартом и любым
  свидетельством завершения. Не означает последовательность в первой сессии.
- `uniquePlayerPuzzleConversion` — уникальные игрок–пазл с известным стартом,
  полным окном наблюдения и завершением в этом окне. Возобновления не увеличивают
  знаменатель. Старый `id` без world/global identity может смешивать уровни:
  проверить `quality.ambiguousLegacyLevelIds`.
- `measuredAttempts` — только новые `puzzle_started` с `attemptId`. Старый
  `level_start` включает повторные открытия. `incompleteWithinWindow` означает
  отсутствие зафиксированного завершения в окне, не окончательный уход.
- `activation24h` — первая самостоятельная победа L2–L5 в первые 24 часа
  подтверждённого first-install episode / все такие эпизоды с полным окном.
- `retention.open` — сессия/открытие или реальное игровое действие в Dn.
  `retention.play` — только игровое действие; фоновая доставка напоминания и
  забранный бонус сюда не входят. Установки без полной даты наблюдения Dn и
  без SDK install metadata исключены. D1/D3/D7/D30 используют полные календарные
  дни UTC+3; текущий неполный продуктовый день не участвует в знаменателе.
- `installCohort` отдельно показывает reinstall/reactivation/unknown episodes.
  `devicesWithMultipleInstallEpisodes` не является ошибкой: конфликтующая
  identity/дата установки учитывается отдельно в `conflictingInstallEpisodes`.
- `versions` — сегменты версии, onboarding и контента **на момент события**.
  Один обновившийся игрок может входить в несколько строк. Это не рандомизированный
  A/B-тест и не версия при установке.

`level_complete`, `puzzle_completed`, `level_reward_claimed`, `daily_completed`
сведены в свидетельства завершения; каждое исходное имя остаётся в `eventCounts`.
Доставка сначала дедуплицируется по SDK identity + `event_id`, прохождение —
по SDK identity + puzzle key. Старые завершения после «Далее» не дают точное
время победы.

Для daily дата активности — `actionDay`, а `dateKey` — дата самого пазла.
При позднем восстановлении milestone точное время завершения может быть
неизвестно; такие результаты исключаются из точного окна conversion и
отражаются в `quality.unknownPuzzleCompletionTimes`. Новые события передают
`occurredAtMs`, замороженный в момент победы. `received_at` — передача SDK,
не серверное подтверждение.

Перед выводами проверить `quality` и `limitations`: неизвестную установку,
идентичность, время, смешанные поколения или недостаточное покрытие событий
нельзя заменить нулём. Для чистой оценки intro-v2 экспортировать отдельную
когорту настоящих новых установок 0.1.9; обновившиеся intro-v1/legacy игроки
имеют другое обучение и контент.

## Контракт новых событий

- `puzzle_started`: один новый attempt; `puzzle_resumed`: существующий attempt
  один раз за analytics session. Восстановление готового результата не создаёт
  новый старт.
- `puzzle_completed`: прежний стабильный once-per-puzzle key, дополненный
  `attemptId`, `levelKey`, настоящим `contentVersion`, `completionSource`,
  `assisted`, `assistanceType`, `occurredAtMs`. При известном создании snapshot
  есть `durationSec`; при измерении активного времени есть `activeTimeMs`.
- `first_level_completed` / `fifth_level_completed`: реальные победы intro
  на L1/L5 один раз за профиль. `independent_level_completed` — первая победа
  без помощи на L2–L5; L1 исключён.
- `daily_repeat_completed`: daily завершён в другой продуктовый день. Решение
  двух архивных пазлов за один день не считается повторным возвращением.
- `daily_entry_seen` / `daily_bonus_seen` — реальная видимость карточки;
  `daily_entered` — добровольный вход. Эти события больше нельзя трактовать
  по старому отсутствующему показу меню при первом redirect.
- `reminder_scheduled`, `reminder_delivered`, `reminder_opened`,
  `reminder_gameplay`, `reminder_consent` сохраняются с приоритетом. Native
  ledger подтверждается только при truthy event id из durable `trackOnce`;
  полностью занятая критическими событиями очередь возвращает `null` для retry.

Проверка:

```powershell
npm test -- --runInBand src/features/analytics/__tests__ src/features/game/__tests__/independentSettlement.test.ts
node --test backend/scripts/__tests__/retention-analysis.test.cjs
```
