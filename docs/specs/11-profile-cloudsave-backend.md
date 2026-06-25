# 11 — Профиль, облачный сейв, backend

Статус: утверждено · Обновлено: 2026-06-26

Backend — Node (cjs), серверо-авторитетный, **зеркало паттерна blockblast** (JSON-стор → опц. SQLite при росте). Деплой — изолированно от bloxx [14](14-build-release-deploy.md). Клиент — `core/net` (fetch + очередь + Noop) и фичи `profile`/`cloudsave`.

## Профиль (`features/profile`)

- Анонимный bootstrap при первом онлайне: сервер выдаёт `userId`, `authToken`, `tag`; ник задаёт игрок. `profile.v1` = `{ userId, authToken, nickname, tag, avatar }`.
- Гость может играть полностью оффлайн; для лидербордов/событий/команд/облака нужен профиль (ненавязчивый soft-ask).
- Переименование/смена аватара (`/api/profile/rename`, `/api/profile/avatar`).

## Облачный сейв (`features/cloudsave`)

- Синхронизирует прогресс (уровни, коллекция, валюты, стрики, entitlements-флаги — но НЕ как источник правды для премиума, см. ниже).
- `cloudsave.v1` = `{ version, lastSyncAt, pending }`. Стратегия конфликта: версия + last-write-wins по полю; прогресс уровней — берётся максимум (монотонность). Валюта — серверо-авторитетна, чтобы не дюпать.
- Эндпойнты: `GET /api/save` (снять снапшот), `POST /api/save` (залить с версией, сервер ребейзит/мерджит).

## Ревалидация прогресса (античит)

- Клиент шлёт «уровень N пройден + найденные слова» (`POST /api/runs`/`/api/progress`).
- Сервер пересчитывает через `backend/runtime` (зеркало `core/engine`): слова принадлежат словарю уровня, заполняют сетку, уровень действительно завершается. Только тогда прогресс/очки засчитываются.
- Санити-лимиты: макс. уровней/прирост за интервал, rate-limit (nginx + `x-api-key`).
- Идемпотентность: один уровень не засчитывается дважды (по `levelId`).

## IAP-валидация

- `POST /api/iap/validate` — проверка чека RuStore для `pro_weekly`/крупных паков; сервер — источник правды по подписке (`proUntil`). Клиентский флаг — лишь кэш [05].

## API (сводка)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | статус |
| POST | `/api/profile/bootstrap` | создать/получить профиль |
| POST | `/api/profile/rename` | ник |
| POST | `/api/progress` | подтвердить прохождение (ревалидация) |
| GET/POST | `/api/save` | облачный сейв |
| GET | `/api/leaderboard` | снапшот (scope) |
| GET | `/api/events` … | события [10] |
| GET/POST | `/api/teams` … | команды [10] |
| POST | `/api/iap/validate` | валидация чека |

Аутентификация — `Authorization: Bearer <authToken>`; сервис-ключ `x-api-key`. CORS/OPTIONS как в blockblast.

## Модель хранения

`backend/runtime/store`: `{ users, profiles, progress, saves, leaderboard, events, teams }`. Старт — JSON-файл в `/var/lib/slova` (атомарная запись), миграции в `backend/migrations`. При росте нагрузки — перевод на SQLite (интерфейс стора уже абстрагирован).

## Клиент `core/net`

```ts
interface BackendClient {
  bootstrap(nickname: string): Promise<Profile>;
  submitProgress(p: ProgressPayload): Promise<void>;     // через очередь
  getLeaderboard(scope): Promise<Snapshot>;
  pullSave(): Promise<SaveSnapshot>; pushSave(s): Promise<void>;
  // events/teams/iap …
}
```
`NoopBackendClient` для web/тестов и оффлайна; реальный `HttpBackendClient` за флагом + base URL из `EXPO_PUBLIC_API_BASE`.

## Тесты (`backend/__tests__`, node:test)

bootstrap/auth, ревалидация прогресса (валид/невалид/повтор), сейв-мердж/конфликты, снапшот лидерборда, лиги-промоушн, событие-лайфцикл, idempotency наград, rate-limit.
