# 16 — Аналитика

Статус: утверждено · Обновлено: 2026-06-26

SDK: AppMetrica (Expo config-plugin `plugins/withAppMetrica.js`, зеркало blockblast). За интерфейсом `Analytics` + флаг + opt-out. Локальная очередь `analytics.v1`, отправка батчами.

## Интерфейс

```ts
interface Analytics { init(): void; track(event: string, props?: object): void; setUser(id?: string): void; optOut(v: boolean): void; }
```
Noop по умолчанию (web/тесты/opt-out).

## Ключевые события (воронки)

| Событие | Когда | Props |
|---|---|---|
| `app_open` / `session_start` | старт | source |
| `onboarding_step` / `onboarding_done` | туториал | step |
| `level_start` / `level_complete` | уровень | levelId, world, durationSec, hintsUsed |
| `level_abandon` | выход без завершения | levelId, progress% |
| `word_found` | слово | kind(grid/bonus), len |
| `hint_used` | подсказка | type, levelId, paidWith(coins/rewarded) |
| `currency_change` | начисл/списание | kind, delta, source/sink |
| `ad_impression` / `ad_click` / `ad_reward` | реклама | format, placement |
| `iap_view` / `iap_purchase` | магазин | productId, price |
| `daily_claim` / `wheel_spin` / `streak_break` | дейли | day, streak |
| `leaderboard_view` / `event_join` / `team_join` | онлайн | scope/eventId/teamId |

## KPI (дашборды)

Ретеншн D1/D7/D30; средняя длина сессии и число сессий; конверсия туториала; точки оттока по уровням (`level_abandon` по levelId); ARPDAU/ARPU и сплит ad/IAP; eCPM/частоты по плейсментам; конверсия rewarded; конверсия IAP/подписки.

## Приватность

- Opt-out в Настройках; уважать согласие [01]. Не собирать PII. Соответствие 152-ФЗ.
- Серверная отправка — за флагом; в раннем v1 можно держать минимальной.

## Тесты

Маппинг событий, батч/опт-аут, отсутствие отправки при opt-out, отсутствие PII в props.
