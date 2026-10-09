# Требования и приёмка

| ID | Требование | Доказательство | Статус |
|---|---|---|---|
| E1 | Реальный ограниченный по времени марафон на семь суток МСК | Boundary/model tests и native upcoming/active/ended | verified |
| E2 | Семь этапов и суммарная награда 150 монет | Model tiers/reward tests, actual native first win +10 | verified |
| E3 | Доступ с первого уровня, офлайн, без отдельной платы | Home, slova://marathon, fresh native QA profile | verified |
| E4 | Первые campaign / сегодняшние daily; повторы, старые результаты и архивные daily исключены | Model/persistence tests, actual win after expiry | verified |
| E5 | Durable прогресс, идемпотентная награда, восстановление после ошибок записи/рестарта | Unit/integration, native restart и два saved-result restores | verified |
| E6 | Текущий прогресс, старые события и валюта сохраняются | 86 suites/523 tests, immutable production profile и native restores | verified |
| E7 | Подписанное обновление AAB с прежним сертификатом | Final manifest/signature/equality report, APK/native smoke | verified |
| E8 | Обложка и тексты заявки соответствуют игре и правилам | Размеры/байты/лимиты, actual Console preview | verified |
| E9 | Заявка на событие отправлена в RuStore | Request 12159, Review, даты 26.10 00:00–02.11 00:00 | verified |
| B1 | Полезная статья именно про «Слова», до 7000 знаков, FAQ и реальные изображения | 6491 signs, 7 FAQ, three images, DOCX/render QA with stated renderer limits | verified |
| B2 | Статья предложена редакции через Хелп-центр | User submission + Console submit-success | verified |
| E10 | Обновление доступно пользователям после модерации | Console 0.1.14(18) Waiting for moderation, Automatic,100%; approved/published ещё не подтверждено | in_progress |
| B3 | Численная проверка уникальности ≥90% по требованиям статьи | Text.ru guest limit4000; ContentWatch prohibits automation; alternate checker blocked by exhausted CAPTCHA quota. Процент не заявляется; ожидается проверка редакцией | in_progress |

## Проверки

Unit: даты МСК, первая победа, все пороги, повтор/отложенный settlement, уже завершённые уровни, старый daily, recovery outbox, повреждённые сохранения. Integration: реальная точка settlement и startup reconciliation. Проверки проекта: typecheck, lint, Jest, backend tests, content audit. Android: подписанная сборка, deeplink, настоящий игровой ход, сохранение/перезапуск, итог события. Материалы: лимиты строк, обложка 2880×2160 ≤3 МБ, статья Arial/.docx с изображениями и FAQ.

Решение редакции по размещению события/статьи дополнительно ожидается; отправка не считается одобрением или ростом трафика.
