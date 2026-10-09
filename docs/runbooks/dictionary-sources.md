# Источники словаря

Статус: рабочий runbook. Источники хранятся локально в `.dict-sources/` и не коммитятся; в репозиторий попадают только производные артефакты `assets/dict/*.json`, `assets/levels/*.json` и `assets/content/content-audit.json`.

## Используемые источники

- `Badestrand/russian-dictionary` — Wiktionary-производные таблицы для существительных, прилагательных и глаголов. Берём только начальную форму (лемму) из колонки `bare`; словоформы и склонения из остальных колонок не используются.
- `hermitdave/FrequencyWords` `ru_full.txt` — частотный корпус русского языка. Используется только для ранжирования узнаваемости и выделения `ru-common.json`.

## Ожидаемые файлы

```text
.dict-sources/
  nouns.csv
  adjectives.csv
  verbs.csv
  ru_full.txt
```

## Пересборка

```bash
$env:SOURCE_DATE_EPOCH = "1783900800" # pinned retrieval/build timestamp
node scripts/build-dictionary.js --src .dict-sources --common-freq 40
node scripts/gen-levels.js --content-version dict-v2-<approved-version>
node scripts/audit-content.js --strict
```

## Текущий результат

- `assets/dict/ru.json`: 22448 валидных лемм 3–8 букв.
- `assets/dict/ru-common.json`: 10533 частотных леммы для ответов и базовых слов.
- `assets/levels/world1.json` … `assets/levels/world7.json`: 500 уровней суммарно.
- Контент-пак покрывает 7 миров, 1..500, дисковую кривую 3/4/5/6/7/8 и финалы 90/170/250/310/370/430/500.

## Правила качества

- Рантайм игры не грузит полный словарь; он использует level-local `answers`, `rewardedBonus`, `bonusPool` и `blockedPool`. `bonusPool` остаётся переходным alias для старых клиентов.
- Слова-ответы берутся только из `ru-common.json` и требуют валидной записи в `assets/dict/curation/answer-allow.json`: два разных reviewer id, один content owner, source refs и reviewedAt.
- Все составимые слова из `ru.json`, кроме hard-blocked, попадают в `rewardedBonus`/`acceptedBonus`; лимиты применяются отдельно для rewarded-пула.
- `answer-deny.json` исключает валидные слова из сетки, но не из bonus-слоя. `regression.json` содержит must-accept/must-block/must-not-be-answer проверки.
- `assets/content/content-audit.json` — единственный машинный источник текущих counts и release-gates; `npm run audit:content` обязан быть зелёным перед выпуском.
- Обсценная лексика, служебные слова и склеенные формы вроде `чтото` фильтруются в `scripts/dict/stoplists.js` и `scripts/build-dictionary.js`.
- Фильтр одной основы (`sameRoot` / `rootConflicts`) обязателен для answers, rewardedBonus и bonusPool, а повторяемость слова по паку ограничивается строгим аудитом.
