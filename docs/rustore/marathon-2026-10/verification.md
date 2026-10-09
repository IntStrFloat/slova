# Проверка

## Выполненные проверки

- `npm test -- --runInBand --silent`: 86 suites, 523 tests PASS (перед последней точечной поправкой replay UI).
- Последняя поправка replay UI: typecheck PASS и 28 затронутых game/marathon tests PASS.
- `npm run lint`: PASS. `npm run backend:test`: 33/33 PASS. `npm run audit:content`: 1000 levels, errors=0.
- Android `bundleRelease` + `assembleRelease`: PASS, build-final-replay.log.
- APK `scripts/verify-release-apk.cjs`: package/version 0.1.14/vc18, debuggable=false, четыре ABI, тот же release.jks/previous release certificate.
- Native gameplay: настоящие жесты на первом уровне, 160→170 coins и progress1; force-stop/restart сохраняет170; настоящая победа уровня2 после конца не даёт новых marathon coins/progress. `output/marathon-2026-10/native/verification.json`.
- Frozen production: offline install/cold start/deeplink, upcoming/active экраны; `production-final-verification.json`. Геометрия UI после replay-поправки не изменена; дополнительно проверяется восстановленный result UI.
- Visual verdict: 95/100 PASS, `.omx/state/rustore-marathon-ui/ralph-progress.json`. Artwork:94/100 PASS.
- Подпись AAB проверяется через JarFile и JarInputStream; raw ZIP record reorder устраняет streaming inconsistency без изменения bytes entry. Новые immutable артефакты получают новый hash и отдельный отчёт.
- DOCX: 6491 signs, 7 FAQ, 14 H1, Arial, три изображения, <5MB; source SHA `fa4ba60afa1c2a60afd47ef0767cf373d4d67c233956a08b424ebb5baab4c580`. Прямой импорт исходного DOCX и пять PNG bundled artifact-tool просмотрены. Он игнорирует keep-next/widow-control; точное совпадение пагинации Word не подтверждено. `store/rustore/marathon-2026-10/blog/qa.json`.
- Text.ru не выполнял проверку целого текста: гостевой лимит4000, статья больше; платный тариф не покупался. Численный процент уникальности не заявляется.

## Внешнее состояние

- Пользователь сам отправил статью; проверена страница `/blog-article-request/submit-success` с «Ваша статья отправлена». Screenshot `console/blog-submitted.jpg`.
- Пользователь явно разрешил передачу encrypted PEPK ZIP и public PEM. Console: Signing key loaded. Исходный keystore сохранён; passwords никогда не появлялись в process argv/логах, encrypted export остаётся в gitignored credentials.
- Первый совместимый AAB принят Console:120.92MB—Uploaded. Финальная source/replay поправка требует замены file до submission.
- Event draft содержит реальные даты/пороги/награды и загруженную обложку. Отправка/решение редакции будут записаны по фактическому состоянию Console.
