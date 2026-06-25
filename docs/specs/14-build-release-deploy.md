# 14 — Сборка, релиз, деплой

Статус: утверждено · Обновлено: 2026-06-26

## Android-релиз (клиент)

- Артефакт — **подписанный `.aab`** (`bundleRelease`), не APK.
- Пайплайн (зеркало blockblast): `npx expo prebuild -p android` → `node scripts/patch-signing.js` → `cd android && ./gradlew bundleRelease` (JBR).
- Keystore — `credentials/release.jks` (вне git). Не генерировать новый ключ для обновлений.
- Инкремент `versionCode` перед каждой загрузкой. Проверка подписи AAB и отпечатка сертификата перед отчётом.
- Чек-лист RuStore: package `com.<...>.slova` (финальный id согласовать), возрастной рейтинг, политика конфиденциальности (`docs/privacy` / hosted), скриншоты, описание, продукты IAP в Console.
- Конфиг подписи/PEPK — runbook `docs/runbooks/android-app-signing.md` (создать по образцу blockblast).

## Backend-деплой — ИЗОЛЯЦИЯ от bloxx (обязательно)

Тот же сервер (`193.160.208.95`), но всё своё. **Не трогать** `bloxx-*`, `/opt/bloxx`, `/var/lib/bloxx`, `/var/www/bloxx`, порт `8787`, сабдомен `bloxx.*`.

| Ресурс | blockblast (НЕ трогать) | slova (создать) |
|---|---|---|
| systemd unit | `bloxx-backend.service` | `slova-backend.service` |
| Linux user/group | `bloxx` | `slova` |
| Рабочая папка | `/opt/bloxx/backend` | `/opt/slova/backend` |
| EnvironmentFile | `/opt/bloxx/backend.env` | `/opt/slova/backend.env` |
| Данные (RW) | `/var/lib/bloxx` | `/var/lib/slova` |
| Порт (loopback) | `127.0.0.1:8787` | `127.0.0.1:8788` |
| nginx server_name | `bloxx.193.160.208.95.nip.io` | `slova.193.160.208.95.nip.io` |
| Статика | `/var/www/bloxx` | `/var/www/slova` |
| TLS cert | bloxx letsencrypt | отдельный certbot для slova-сабдомена |

### Артефакты деплоя (`backend/deploy/`)

- `slova-backend.service` — по образцу bloxx-unit (User=slova, WorkingDirectory=/opt/slova/backend, EnvironmentFile=/opt/slova/backend.env, ReadWritePaths=/var/lib/slova, ExecStart=node /opt/slova/backend/index.cjs).
- `nginx-slova.conf` — отдельный `limit_req_zone` (`slova_api`), `server_name slova.…nip.io`, `proxy_pass http://127.0.0.1:8788`, root `/var/www/slova`.
- `backend.env.example` — `PORT=8788`, `API_KEY=`, `DATA_PATH=/var/lib/slova/store.json` (реальный `backend.env` — вне git, на сервере).

### Процедура (runbook `docs/runbooks/backend-deploy.md`)

1. `useradd --system slova`; `mkdir -p /opt/slova/backend /var/lib/slova /var/www/slova`; chown slova.
2. Скопировать `backend/` в `/opt/slova/backend`; положить `/opt/slova/backend.env` (секреты, chmod 600).
3. Установить unit, `systemctl enable --now slova-backend`.
4. nginx: добавить `nginx-slova.conf` в `sites-available`, симлинк, `certbot --nginx -d slova.193.160.208.95.nip.io`, `nginx -t && systemctl reload nginx`.
5. Smoke: `curl https://slova.<...>.nip.io/api/health` → `{ok:true}`.
6. Клиент: `EXPO_PUBLIC_API_BASE=https://slova.<...>.nip.io`.

SSH/секреты деплоя — **только локально, вне git**; в репозитории лишь шаблоны.

## CI/локальные гейты

`npm test` + `npm run backend:test` + `npx tsc --noEmit` зелёные перед коммитом и перед сборкой релиза.
