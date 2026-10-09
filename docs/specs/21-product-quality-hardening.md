# 21 — Качество словаря и hardening retention-механик

Статус: draft · Обновлено: 2026-07-13

## 1. Назначение и источник истины

Эта спецификация устраняет выявленные release-блокеры качества контента и
функциональные разрывы, которые напрямую влияют на доверие, D1/D7 retention и
готовность приложения к масштабированию трафика.

Целевой продуктовый результат:

- любое нормативно допустимое русское слово, составимое из диска, принимается;
- нежелательные слова не попадают в обязательную сетку и имеют явную причину
  блокировки;
- завершение уровня не зависит от способа заполнения последней клетки;
- daily не уничтожает обычный прогресс незавершённого уровня;
- включённые в UI звук, push, события и команды дают реальную ценность, а не
  имитируют готовую функцию;
- сложность растёт по глобальному пути 1..250 и не сбрасывается при смене мира.

До явного утверждения этот draft не переопределяет действующие документы. После
утверждения при конфликте требований эта спека становится нормативным
remediation-overlay для
[03](03-engine-and-generator.md), [08](08-daily-wheel-streak.md),
[10](10-events-teams.md), [12](12-notifications.md),
[15](15-localization-dictionary.md), [16](16-analytics.md) и
[19](19-content-scale-quality.md). Остальные требования этих документов остаются
в силе.

## 2. Измеренная база на 2026-07-13

Аудит выполнен по текущим `assets/dict/*.json` и 250 уровням из трёх production-
паков.

| Метрика | Текущее значение | Корректная трактовка |
|---|---:|---|
| `ru.json` | 22 447 | уникальные нормализованные леммы |
| `ru-common.json` | 10 532 | кандидаты повышенной узнаваемости |
| Уровни | 250 | `world1=90`, `world2=80`, `world3=80` |
| Составимые пары `уровень × слово` | 3 313 | одно слово может встречаться для нескольких дисков |
| Принимаемые пары | 2 362 (71,3%) | слово есть в `answers` или ограниченном `bonusPool` |
| Отклоняемые пары | 951 (28,7%) | слово есть в `ru.json`, но отсутствует в пуле уровня |
| Уровни с пропусками | 214 из 250 | системная, а не единичная проблема |
| Уникальные составимые слова | 1 488 | дедупликация 3 313 пар |
| Отклоняются хотя бы на одном уровне | 563 | 284 из них принимаются на другом уровне |
| Никогда не принимаются | 279 | уникальные леммы |
| Вхождения обязательных ответов | 1 190 | по всем уровням |
| Уникальные обязательные ответы | 837 | повторных вхождений 353, или 29,7% |

Примеры обычных слов, которые текущий runtime может отклонять: `БАР`, `РАК`,
`РАБ`, `СТО`, `ЛЕС`, `СЕЛО`, `СМОЛА`, `САЛО`.

Непосредственная причина зафиксирована в текущем
[`submitWord`](../../src/core/engine/play.ts): ввод сверяется только с `answers`
и урезанным `bonusPool`. Completion-разрыв воспроизводится на связке
[`applyHint`](../../src/core/engine/hints.ts) и UI-ветки
[`game.tsx`](../../src/app/game.tsx), где overlay запускается только после submit.

Текущие SHA-256 нужны для воспроизводимости именно этой базы:

```text
assets/dict/ru.json          de43224c6ee700172223e1d00e719457a2ae59c93d464713e134dad8952e98e4
assets/dict/ru-common.json   77f71f19b555fcd25c37ea135ab966d38387a5175486e0af34f319473603bd7e
assets/levels/world1.json    57623a07185a3e62e9d6e6034d9e7af0e5f9af3abc5ed3d1448242fe863ad4ba
assets/levels/world2.json    222dbe47976f72acdef9df45a9e31f43fb9170874958ceaf4d506d2a5adf473c
assets/levels/world3.json    ec8bc0a4ad6e65d7bdebb6082f346d33f7a51220b99108e3d5cd0cca526545d8
```

Числа в [19](19-content-scale-quality.md) считаются устаревшими. После
реализации единственным источником количественной истины становится
генерируемый `assets/content/content-audit.json`; документация не должна
дублировать изменяемые counts вручную.

## 3. Приоритеты и release gates

| Приоритет | Скоуп | Gate |
|---|---|---|
| P0 | словарные слои, модерация 250 уровней, исчерпывающая приёмка, hint-completion, раздельные save slots | обязательно до следующего production release |
| P0.5 | «Сообщить о слове», remote allow/deny, content quarantine, privacy-safe telemetry | обязательно до масштабирования платного трафика |
| P1 | глобальная сложность, реальные SFX/музыка, real push или скрытая функция | до retention-экспериментов D7 |
| P1/P2 | отличимые события, командная цель, server-authoritative rewards | до публичного продвижения social-функций |

Если P0-gate не пройден, новую AAB нельзя объявлять готовой к загрузке в
RuStore. Если P0.5 не пройден, нельзя увеличивать закупку трафика.

## 4. Архитектурные ограничения

- Только Android, Expo SDK 56, RN 0.85, New Architecture, Hermes.
- `core/engine` остаётся чистым TypeScript без React/RN/network imports.
- Core puzzle полностью работает в airplane mode [17, NFR-3].
- Полный `ru.json` не загружается в runtime. Приложение использует только
  level-local пулы и малый закэшированный remote overlay.
- Новые зависимости не добавляются без отдельного решения. Для аудио
  используется уже установленный `expo-audio`.
- Любые серверные rewards, event/team progress и policy publication
  идемпотентны; сервер не доверяет произвольным клиентским числам.
- Remote config не содержит исполняемого кода и регулярных выражений.
- Backend и его данные остаются полностью изолированы от `bloxx-*` [14].
- Ключи, service tokens, SSH и персональные данные не коммитятся.

## 5. Целевая словарная модель

### 5.1 Четыре нормативных слоя

1. **Curated grid answers** — обязательные ответы, вручную и автоматически
   прошедшие строгую модерацию.
2. **Accepted bonus dictionary** — все допустимые слова из `ru.json`, которые
   можно собрать из диска конкретного уровня и которые не входят в сетку.
3. **Blocked dictionary** — явный deny-layer с reason code; слово не может быть
   ни grid answer, ни bonus.
4. **Feedback/remote policy** — пользовательские отчёты и малые allow/deny-
   корректировки без выпуска новой AAB.

`ru-common.json` остаётся источником кандидатов для grid answers, но сам факт
нахождения слова в `ru-common` не является достаточной модерацией.

Нормативная матрица качества:

| Категория | Grid answer | Accepted bonus | Blocked |
|---|---|---|---|
| Узнаваемая общеупотребительная нарицательная лемма | да, после review | да | нет |
| Нормативная, но редкая/устаревшая/профессиональная лемма | нет (`answer-deny`) | да | нет |
| Глагол, прилагательное, наречие, числительное в словарной форме | нет по умолчанию | да, если входит в утверждённый scope источника | нет |
| Собственное имя без подтверждённого нарицательного значения | нет | нет | `proper_name` |
| Аббревиатура без самостоятельного словарного значения | нет | нет | `abbreviation` |
| Оскорбление, slur, profanity | нет | нет | `slur_or_insult`/`profanity` |
| Повреждённый token или не-лемма | нет | нет | `malformed`/`non_lemma` |

Решение принимается по token и подтверждённому лексическому значению, а не по
одной возможной расшифровке. Поэтому безопасный омограф с общеупотребительным
значением (например, числительное `СТО`) не блокируется только из-за совпадения с
аббревиатурой; при этом он остаётся bonus-only, если не проходит grid-правила.
Для каждого решения сохраняются source refs и краткое нормализованное основание.

### 5.2 Level pack v2

```ts
type BlockReason =
  | 'profanity'
  | 'slur_or_insult'
  | 'proper_name'
  | 'abbreviation'
  | 'malformed'
  | 'non_lemma'
  | 'low_quality'
  | 'manual_deny';

interface BlockedWord {
  word: string;
  reason: BlockReason;
}

type Grid = { rows: number; cols: number; cells: Cell[] };

interface LevelV2 {
  id: number;                 // local id внутри world pack
  globalId: number;           // стабильный id 1..250
  world: string;
  contentVersion: string;
  fingerprint: string;        // hash immutable bundled puzzle payload
  letters: string[];
  grid: Grid;
  answers: Answer[];          // только curated grid answers
  acceptedBonus: string[];    // ИСЧЕРПЫВАЮЩИЙ level-local accepted layer
  rewardedBonus?: string[];   // необязательный экономический subset
  blockedPool: BlockedWord[]; // только blocked-слова, составимые из этого диска
  difficultyTier: 1 | 2 | 3 | 4 | 5;
  difficultyScore: number;
  difficultyRole: 'easy' | 'baseline' | 'hard' | 'breather' | 'climax';
}

interface LevelPackV2 {
  schemaVersion: 2;
  contentVersion: string;
  world: string;
  generatedAt: string;        // из pinned SOURCE_DATE_EPOCH, не wall-clock
  dictionaryHash: string;
  levels: LevelV2[];
}
```

`acceptedBonus` заменяет `bonusPool` как источник истины при submit. Ограничение
`--max-bonus=14` запрещено использовать для валидации. Если продукту нужен
ограниченный набор награждаемых bonus-слов, он хранится отдельно в
`rewardedBonus`; ненаграждаемое допустимое слово всё равно принимается и получает
положительный feedback.

`fingerprint` считается только по canonical bundled payload
`globalId+letters+grid+answers+acceptedBonus+blockedPool`. Remote policy в него не
входит: попытка отдельно закрепляет `policyRevision`, а смена overlay не делает
локальный уровень «другим». `generatedAt` берётся из обязательного
`SOURCE_DATE_EPOCH`, поэтому повторная сборка остаётся byte-identical.

На текущих 250 уровнях исчерпывающий pool добавляет около 10,9 KiB к трём JSON-
пакам (примерно 3,1%), поэтому ограничение acceptance ради размера не оправдано.

UI не показывает знаменатель вида `3/49`: пользователь не обязан исчерпать
словарь диска. Допустимы `Найдено бонусных: 3` и отдельная цель по
`rewardedBonus`.

### 5.3 Результат submit

```ts
type InvalidReason =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'malformed'
  | 'not_constructible'
  | 'not_in_dictionary';

type SubmitResult =
  | { kind: 'grid'; word: string; cells: Cell[]; deltaCoins: number; levelComplete: boolean }
  | { kind: 'bonus'; word: string; deltaCoins: number; rewarded: boolean; firstTime: boolean }
  | { kind: 'blocked'; word: string; reason: BlockReason }
  | { kind: 'duplicate'; word: string; previousKind: 'grid' | 'bonus' }
  | { kind: 'invalid'; word: string; reason: InvalidReason };
```

### 5.4 Нормализация и порядок решения

Нормализация:

1. Unicode NFC.
2. Нижний регистр.
3. `ё → е` в соответствии с текущим продуктовым контрактом.
4. Допустимы только `а-я`, длина 3..8.
5. Дефис, пробел, цифра или латиница делают исходный token `malformed`.

Текущая практика «удалить все неподходящие символы и склеить остаток» запрещена:
она может создавать несуществующее слово из повреждённого исходника.

До submit loader обязан вызвать `resolveActiveLevel(globalId, contentVersion,
policyRevision)`: либо вернуть исходный audited level, либо его bundled fallback.
Неразрешённый quarantined level нельзя открыть или передать в engine.

Порядок классификации:

1. Невалидная форма/длина → `invalid`.
2. Слово нельзя собрать из мультимножества букв → `invalid:not_constructible`.
3. Слово — обязательный answer уже разрешённого активного уровня → `grid`.
4. Слово входит в bundled `blockedPool` → `blocked`.
5. Слово входит в remote deny → `blocked`.
6. Слово входит в remote allow → `bonus`.
7. Слово входит в bundled `acceptedBonus` → `bonus`.
8. Иначе → `invalid:not_in_dictionary`.
9. После определения canonical `grid`/`bonus` проверяется, было ли слово уже
   найдено; только тогда возвращается `duplicate` с исходным `previousKind`.

Bundled blocked-list — hard safety boundary: обычный remote allow не может его
переопределить. Разблокировка ошибочно запрещённого слова требует новой
модерированной AAB/OTA-сборки словаря; emergency remote-слой умеет быстро
добавлять deny и разрешать только слова, которых нет в hard-blocked слое.

Remote deny не может молча сделать обязательный answer непроходимым. Такой
policy либо содержит валидную замену уровня из предвстроенного fallback-pack,
либо отклоняется publisher/client validator. При конфликте без fallback клиент
сохраняет проходимость answer, отправляет `word_policy_conflict` и не применяет
конфликтную ревизию.

### 5.5 Экономика bonus-слов

- Каждое уникальное допустимое слово получает success feedback.
- Монетная награда определяется `rewardedBonus` или единым бюджетом
  `GAME.maxBonusCoinsPerLevel`; расширение accepted-слоя не должно молча
  инфлировать экономику.
- Повторное bonus-слово не даёт монет.
- Remote allow по умолчанию принимается без монет до следующей curated-сборки;
  remote manifest может явно включить `rewardEligible=true` только после
  проверки экономики.

## 6. Build-time pipeline и модерация

### 6.1 Артефакты

```text
assets/dict/ru.json                       широкий accepted-слой
assets/dict/ru-common.json                кандидаты для grid answers
assets/dict/ru-blocked.json               явный blocked-слой с reason codes
assets/dict/ru.meta.json                  counts, hashes, build parameters
assets/dict/sources.lock.json             source URL/ref/hash/license/retrievedAt
assets/dict/curation/answer-allow.json     исчерпывающий approved registry для grid
assets/dict/curation/answer-deny.json      valid, но неподходящие grid-слова
assets/dict/curation/regression.json       mustAccept/mustBlock/mustNotBeAnswer
assets/content/content-audit.json          полный машинный QA-отчёт
assets/levels/fallback.json                заранее проверенные fallback-уровни
```

`sources.lock.json` обязателен. Сборка из неприкреплённого источника или при
несовпадении checksum завершается ошибкой. Лицензия и право коммерческого
использования фиксируются для каждого источника.

Source-policy различает `scope=all` и `scope=grid`. `all` компилируется в
level-local `blockedPool`; `grid` означает «валидное bonus-слово, но запрещённый
mandatory answer» и компилируется через `answer-deny.json`.

Каждый mandatory answer обязан иметь запись в `answer-allow.json` с полями
`word`, `reviewers`, `reviewedAt`, `sourceRefs`, `decision='allow_grid'` и
необязательным `note`. Для grid allow и любого unblock нужны минимум два разных
reviewer id; один из них — content owner. UI/CLI review показывает слово,
частотность, подтверждённые значения, все затронутые уровни и соседние answers.
Отсутствие записи — build error, а не неявное разрешение.

### 6.2 Pipeline

1. Прочитать pinned sources.
2. Строго нормализовать tokens; повреждённые строки отклонить, не «починить»
   удалением символов.
3. Построить `ru.json` и частотный `ru-common.json`.
4. Применить blocked/answer-deny/answer-allow и regression-наборы.
5. Сгенерировать grid answers только из curated grid candidates.
6. Для каждого диска перебрать **весь** `ru.json` и записать все составимые
   допустимые слова в `acceptedBonus`.
7. Для каждого диска записать составимые blocked-слова в `blockedPool`.
8. Рассчитать `globalId`, difficulty, immutable fingerprint и pack hashes.
9. Выполнить строгий content audit по всем 250 уровням.
10. Записать артефакты атомарно только после полного успешного аудита.

### 6.3 Content audit — обязательные инварианты

| ID | Инвариант |
|---|---|
| DICT-01 | `answers ∩ acceptedBonus = ∅` |
| DICT-02 | `(answers ∪ acceptedBonus) ∩ blockedPool = ∅` |
| DICT-03 | каждое слово собираемо из `letters` с учётом повторов |
| DICT-04 | каждая допустимая составимая пара `level × word` классифицирована как grid или bonus |
| DICT-05 | каждое исключённое слово присутствует в blocked-слое с reason code |
| DICT-06 | 0 obscene/insult/proper-name/abbreviation/malformed слов в `answers` |
| DICT-07 | 0 duplicate puzzle signatures |
| DICT-08 | первые 50 уровней не повторяют обязательное слово |
| DICT-09 | общая уникальность mandatory occurrences ≥85% |
| DICT-10 | одно mandatory-слово встречается не более трёх раз во всём pack |
| DICT-11 | 250/250 уровней проходят engine validation |
| DICT-12 | один seed+config+source hashes дают byte-identical packs |
| DICT-13 | каждый mandatory answer присутствует в approved registry с review metadata |
| DICT-14 | remote allow не может переопределить bundled blocked word |
| DICT-15 | `fingerprint` не меняется при смене только `policyRevision` |

DICT-08..10 — строгие production gates без исключений. Если их невозможно
выполнить без ухудшения узнаваемости, pack не выпускается: content owner сначала
меняет уровни либо отдельным изменением этой спеки пересматривает числовой порог.
Warnings в `content-audit.json` не превращают проваленный gate в успешный.

### 6.4 QA manifest

`content-audit.json` содержит:

- schema/content version и hashes входов/выходов;
- counts accepted/common/blocked;
- пары constructible/accepted/blocked/unclassified;
- список всех ответов по категориям модерации;
- повторы words и puzzle signatures;
- difficulty по global level и границам миров;
- размер каждого pack и суммарный размер;
- все warnings и moderation decisions; strict build не допускает обхода
  DICT-01..15 через warning/waiver.

## 7. Remote allow/deny и emergency quarantine

### 7.1 Публичный read-only endpoint

```http
GET /api/content/word-policy?locale=ru&contentVersion=<version>
If-None-Match: <etag>
```

```ts
interface WordPolicyManifest {
  schemaVersion: 1;
  locale: 'ru';
  contentVersion: string;
  revision: number;
  publishedAt: string;
  expiresAt: string;
  checksum: string;
  allow: Array<{ word: string; rewardEligible?: boolean }>;
  deny: Array<{ word: string; reason: BlockReason }>;
  fallbackByGlobalLevel: Record<string, string>; // globalId -> bundled fallbackId
}

interface FallbackLevel {
  fallbackId: string;
  replacesGlobalId: number;
  contentVersion: string;
  level: LevelV2;
  auditHash: string;
}

interface FallbackPack {
  schemaVersion: 1;
  contentVersion: string;
  generatedAt: string; // тот же pinned SOURCE_DATE_EPOCH
  levels: FallbackLevel[];
  checksum: string;
}
```

Ограничения:

- payload ≤256 KiB; `allow` и `deny` ≤2 000 записей каждый;
- только нормализованные `а-я`, 3..8;
- allow/deny не пересекаются;
- manifest scoped к точному `contentVersion`;
- revision монотонна; rollback публикуется новой большей revision;
- checksum проверяется до записи;
- checksum вычисляется по canonical payload без самого поля `checksum`;
- fallback может ссылаться только на заранее встроенный и audited level;
- fallback сохраняет тот же `globalId`, не содержит quarantined answers и сам
  проходит DICT-01..15;
- публикация атомарна: временный файл → validate → rename;
- arbitrary regex, JS и удалённые grid/cell definitions запрещены.

### 7.2 Клиентский cache

MMKV-key: `dictionary.policy.v1`.

- В игру всегда встроена рабочая bundled policy.
- Remote fetch не блокирует cold start и старт уровня.
- Fetch выполняется при старте не чаще одного раза в 6 часов и использует ETag.
- Новая revision сначала полностью валидируется, затем атомарно заменяет cache.
- При network/schema/checksum error используется last-known-good.
- Expiry инициирует refresh, но не ломает offline core.
- Политика другого `contentVersion` игнорируется.
- Активная попытка закрепляет применённую `policyRevision`. На resume loader может
  обнаружить новую revision, но меняет попытку только при обязательном quarantine
  resolve; обычные allow/deny вступают в силу со следующей новой попытки. Результат
  классификации не меняется посреди текущего уровня.
- В памяти строятся `Set` только для активного уровня; полный словарь не
  создаётся.

### 7.3 Emergency quarantine

Если remote deny пересекается с обязательным answer:

1. Publisher обязан добавить mapping global level → существующий `fallbackId`.
2. `resolveActiveLevel` валидирует contentVersion, mapping, auditHash и новый
   fingerprint до старта engine; при любой ошибке вся revision отклоняется.
3. Незавершённый snapshot исходного уровня инвалидируется по fingerprint.
4. Внешний global level/progress/world остаются прежними.
5. Игрок получает нейтральное сообщение «Головоломка обновлена» без раскрытия
   причины moderation.
6. Завершённые уровни не переигрываются и progress не откатывается.

Backend хранит текущий и минимум два предыдущих content/policy manifests, но не
менее 90 дней, чтобы отчёты и незавершённые outbox-записи оставались проверяемыми
во время staged rollout.

## 8. «Сообщить о слове»

### 8.1 UX

Для `invalid:not_in_dictionary` и `blocked` показывается ненавязчивый feedback:

```text
Слово не принято                         [Сообщить]
```

Toast-action доступен не менее 4 секунд и имеет accessibility label. Это только
быстрый путь: действие также постоянно доступно в списке последних непринятых
слов и через info/pause. При TalkBack фокус на action останавливает таймер, а
кнопка имеет role и понятный announcement. Bottom sheet:

- `Это настоящее слово`;
- `Слово неуместно или содержит ошибку`;
- `Отмена`.

После submit: `Спасибо! Проверим слово.` Повторный report того же слова/уровня
не создаёт второй запрос. Для уже принятого grid/bonus-слова жалоба на качество
доступна через long-press найденного слова или пункт info/pause.

### 8.2 Payload и очередь

```http
POST /api/word-reports
Authorization: Bearer <profile token>
Idempotency-Key: <reportId>
```

```ts
interface WordReport {
  reportId: string;
  createdAt: string;
  locale: 'ru';
  normalizedWord: string;
  reportKind: 'missing_valid' | 'inappropriate_or_wrong';
  currentClassification: 'grid' | 'bonus' | 'blocked' | 'invalid';
  globalLevel: number;
  world: string;
  mode: 'normal' | 'daily';
  contentVersion: string;
  levelFingerprint: string;
  policyRevision: number | null;
  appVersion: string;
}
```

- На клиенте очередь `wordReports.outbox.v1`, максимум 50 записей.
- До готовности автоматически созданного anonymous profile report остаётся в
  outbox; при отправке авторизация обязательна.
- Retry с exponential backoff только для network errors, 429 и 5xx. Остальные
  4xx становятся `dead_letter`, видны в диагностике 7 дней и затем удаляются.
- Сервер: ≤10 reports/user/day и ≤60/IP/hour; idempotency обязательна. `userId`
  — стабильный id anonymous/registered profile, не подменяемый client payload.
- Backend валидирует нормализацию, длину, constructibility и существование
  content/level version.
- Raw word хранится только в moderation backend 180 дней, доступен роли
  `content_moderator`; чтение и решения пишутся в audit log. Обезличенные counts
  и decision metadata хранятся 24 месяца. В AppMetrica raw word запрещён.
- CLI публикации policy читает reviewed decisions, прогоняет DICT-инварианты и
  создаёт новую revision. Админские credentials остаются вне git.

## 9. Единое завершение уровня после слова или подсказки

### 9.1 Проблема

Сейчас UI открывает completion только из ветки `SubmitResult.kind === 'grid'`.
`revealWord`/`hammer` могут заполнить последнюю сетку, но `applyHint` не возвращает
`levelComplete`; повторный ввод уже solved-слова становится `duplicate`.

### 9.2 Engine contract

```ts
type CompletionSource = 'submit' | 'bulb' | 'hammer' | 'revealWord';

interface HintResult {
  changed: boolean;
  revealed: Cell[];
  solvedWords: string[];
  levelComplete: boolean;
  source: Exclude<CompletionSource, 'submit'>;
}

function applyHint(
  state: PlayState,
  hint: HintType,
  target?: Cell,
): { state: PlayState; result: HintResult };
```

После любой мутации `filled` движок выполняет `reconcileSolvedWords`: answer
считается solved, если все его клетки заполнены правильными буквами. Это касается
пересечений и последовательности нескольких `bulb`.

### 9.3 Store state machine

```text
playing
  └─ grid complete from submit/hint
       → completion_pending
          └─ claim reward/progress once
               → reward_claimed
                  └─ close/next → finished
```

Единственный domain action `markCompletionPending(source)` вызывается результатом
и `submitWord`, и `applyHint`. UI только отображает store-state; отдельная логика
completion внутри `onWord` запрещена.

Гарантии:

- overlay открывается ровно один раз;
- `levelClearBonus`, normal progress, daily reward, landmark, leaderboard sync и
  analytics начисляются/отправляются ровно один раз;
- hint не начисляет награду за угаданное grid-слово, но обычный clear reward
  сохраняется;
- быстрые тапы, повторная подсказка, back/foreground не дублируют completion;
- completed-but-unclaimed snapshot восстанавливает overlay после process death.

### 9.4 Snapshot v2

```ts
interface CompletionState {
  status: 'playing' | 'completion_pending' | 'reward_claimed' | 'finished';
  source?: CompletionSource;
  completionId?: string; // hash(mode+attemptId+contentVersion+globalLevel|dailyId)
}

interface GameSnapshotV2 {
  version: 2;
  revision: number;
  updatedAt: string;
  mode: 'normal' | 'daily';
  attemptId: string;
  globalLevel: number;
  world: string;
  dailyId?: string;
  contentVersion: string;
  levelFingerprint: string;
  policyRevision: number | null;
  diskOrder: number[];
  filled: Record<string, string>;
  solvedWords: string[];
  foundBonus: string[];
  hintsUsed: HintType[];
  coinsEarnedInAttempt: number; // не общий wallet balance
  completion: CompletionState;
}
```

`completionId` является idempotency key для currency/progress/backend reward.
Полностью заполненный snapshot больше нельзя безусловно отбрасывать при restore.
`policyRevision` закрепляется при создании/возобновлении попытки. Все массивы и
cell keys при сериализации имеют canonical order.

Ровно-однократная выдача обеспечивается не только state machine, но и persistent
journal `reward.grants.v1`:

```ts
interface RewardGrant {
  completionId: string;
  status: 'pending' | 'applied';
  effects: Array<{ effectId: string; target: 'currency' | 'progress' | 'daily' | 'collection'; payload: unknown }>;
  createdAt: string;
}
```

Алгоритм: сначала атомарно записать pending grant, затем вызвать
`targetStore.applyOnce(effectId, payload)` для каждого эффекта и лишь после этого
пометить grant applied. Каждый target store хранит собственное состояние и
ограниченный ledger применённых `effectId` в одном атомарно записываемом MMKV-
объекте. После crash reconciler повторяет pending effects; уже применённый
`effectId` становится no-op. Analytics/backend outbox используют тот же
`completionId`, но имеют at-least-once delivery и server-side deduplication.
Applied ids удаляются только после очистки связанного snapshot, подтверждения
всех outbox и не раньше чем через 180 дней; pending entries не вытесняются.

### 9.5 Acceptance COMP

| ID | Проверка |
|---|---|
| COMP-01 | submit последнего answer открывает overlay один раз |
| COMP-02 | bulb последней клетки открывает overlay один раз |
| COMP-03 | hammer последнего слова открывает overlay один раз |
| COMP-04 | revealWord последнего слова открывает overlay один раз |
| COMP-05 | пересечения корректно reconciled в `solvedWords` |
| COMP-06 | повтор hint/submit после completion не даёт второй reward |
| COMP-07 | process restart в `completion_pending` восстанавливает overlay |
| COMP-08 | normal и daily используют один state machine, но разные reward handlers |
| COMP-09 | crash до/между/после reward effects после restart даёт каждый эффект ровно один раз |
| COMP-10 | legacy fully-filled hint-lock мигрируется в `completion_pending` и завершается |

## 10. Раздельные normal/daily save slots

### 10.1 Ключи и API

```ts
KEYS.gameCurrentNormal = 'game.current.normal';
KEYS.gameCurrentDaily = 'game.current.daily';

loadGameSnapshot(mode: PlayMode): GameSnapshotV2 | null;
saveGameSnapshot(mode: PlayMode, snapshot: GameSnapshotV2): void;
clearGameSnapshot(mode: PlayMode): void;
```

Каждая операция start/submit/shuffle/hint/finish изменяет только активный slot.
`finish('daily')` не трогает normal; `finish('normal')` не трогает daily.

Daily snapshot дополнительно содержит:

```ts
dailyId: string;          // YYYY-MM-DD
contentVersion: string;
levelFingerprint: string;
```

Snapshot вчерашнего daily не восстанавливается сегодня. Daily никогда не
вызывает `completeLevel()` и не меняет `levels.progress`.

### 10.2 Миграция legacy `game.current`

1. Новые ключи сначала читаются как источник истины.
2. При их отсутствии один раз прочитать legacy `game.current` и валидировать все
   поля, contentVersion/fingerprint или однозначно вычисляемый legacy level.
3. Определить mode и записать только соответствующий normal/daily slot.
4. Partial snapshot переносится со всеми `filled`, `solvedWords`, bonus words,
   disk order, hint/coin attempt state и получает `status='playing'`.
5. Полностью заполненный snapshot, для которого normal progress ещё не перешёл
   дальше и отсутствует daily completion record, переносится как
   `completion_pending`: это восстановление застрявшего hint-completion.
6. Если normal progress уже больше `globalLevel` либо daily ledger уже содержит
   `dailyId`, snapshot считается ранее завершённым и не восстанавливается; wallet,
   collection и streak не пересчитываются.
7. Сначала записать V2 slot и marker `game.snapshot.migration.v2`, перечитать и
   сравнить canonical payload; только затем удалить legacy key.
8. Повторный запуск по marker или существующему V2 ничего не дублирует.
9. Повреждённый/неоднозначный snapshot помещается в локальный diagnostic marker и
   удаляется безопасно; currency, collection, progress и streak не затрагиваются.

Binary downgrade после этой storage migration не поддерживается. Rollback
выполняется только новой V2-совместимой сборкой с выключенными feature flags;
возврат к старому бинарю, понимающему лишь `game.current`, запрещён rollout-
процедурой.

### 10.3 Cloud save v2

```ts
interface SaveSlot<T> {
  revision: number;
  updatedAt: string;
  value: T | null;
}

interface CloudSaveV2 {
  schemaVersion: 2;
  normal: SaveSlot<GameSnapshotV2>;
  daily: SaveSlot<GameSnapshotV2>;
  rewardLedgerRevision: number;
}
```

Normal и daily синхронизируются и merge-ятся независимо. Для каждого slot
побеждает большая `revision`, при равенстве — `updatedAt`; whole-blob last-write-
wins запрещён. Snapshot с неизвестным fingerprint не затирает локальный slot, а
попадает в conflict telemetry и требует сохранённого совместимого manifest.
Reward ledger merge — union по `effectId`, поэтому sync не может повторно
начислить уже применённый эффект.

### 10.4 Daily content

Текущий выбор `YYYYMMDD % 250` заменяется на детерминированный daily definition:

```ts
interface DailyDefinition {
  dailyId: string;
  seed: number;
  locale: 'ru';
  contentVersion: string;
  dailyContentVersion: string;
  level: LevelV2;
}
```

- daily использует отдельный bundled namespace/pool и не выбирает обычный level
  из пути 1..250;
- одинаковая дата+locale+dailyContentVersion → одинаковый пазл для всех игроков;
- за счёт отдельного namespace daily не заменяет и не перезаписывает normal
  current level; визуальное совпадение puzzle signature запрещено audit-гейтом;
- daily definition валидируется теми же DICT/engine-инвариантами;
- завершение идемпотентно по `daily:<dailyId>`;
- при отсутствии сети daily строится локально из bundled content.
- выбранные `dailyContentVersion`, fingerprint и policyRevision закрепляются до
  completion/expiry; staged update не заменяет пазл посреди попытки.

### 10.5 Acceptance SAVE

- Normal partial → Daily partial/complete → Normal возвращается к той же клетке,
  порядку диска, bonus-словам и локальным монетам.
- Daily → Normal → Daily в тот же день также восстанавливается.
- Вчерашний daily сегодня не восстанавливается.
- Legacy normal/daily мигрируются идемпотентно.
- Legacy partial/all-filled/already-completed покрыты отдельными fixtures.
- Несовпадение `contentVersion/fingerprint` сбрасывает только соответствующий
  in-level snapshot.
- Cloud save хранит normal/daily slots отдельно и не выбирает один по общей
  «последней дате».
- Cloud merge с разными revision одновременно сохраняет более новый normal и
  более новый daily, даже если они пришли с разных устройств.

## 11. Реальные SFX и музыка

### 11.1 Контракт AUDIO

Используется уже установленный `expo-audio`; новая зависимость не нужна.

```ts
type SfxKey =
  | 'select'
  | 'correct'
  | 'bonus'
  | 'error'
  | 'coin'
  | 'hint'
  | 'shuffle'
  | 'win';

initAudio(): Promise<void>;
playSfx(key: SfxKey): void;
startMusic(scene: 'map' | 'game'): void;
stopMusic(): void;
syncAudioSettings(settings: Settings): void;
disposeAudio(): void;
```

Обязательный минимум:

```text
assets/sfx/{select,correct,bonus,error,coin,hint,shuffle,win}.*
assets/music/{map-ambient,game-ambient}.*
assets/audio/licenses.json
```

Требования:

- core SFX preload после критического UI, без блокировки splash;
- единственный `AudioRoot` в app root владеет players/listeners весь lifecycle;
  screens только выбирают scene, а `disposeAudio` вызывается один раз при teardown;
- быстрый `select` не создаёт неограниченное число player instances;
- `sound=false` сразу запрещает новые SFX;
- `music=false` останавливает текущий loop;
- background ставит музыку на pause; foreground возобновляет только при
  включённой настройке;
- background playback/foreground service не включаются: игре не нужна музыка
  при свёрнутом приложении;
- отсутствующий один asset деградирует локально и не роняет игру;
- если обязательных assets нет в release build, переключатели sound/music
  скрыты или disabled с честной подписью, но не имитируют работу;
- источник, лицензия и commercial-use фиксируются в `licenses.json`;
- громкость нормализована, `error` не должен быть заметно громче `select`.

Acceptance AUDIO:

- AUDIO-01: все обязательные SFX и обе music scenes слышны в signed Android
  release build; отсутствующая функция скрыта, а не имитируется;
- AUDIO-02: sound/music toggles применяются без restart и сохраняются;
- AUDIO-03: background/foreground и audio focus не запускают второй music loop;
- AUDIO-04: 100 быстрых select не вызывают crash, leak или накопление players.

Техническая база: Expo SDK 56 рекомендует `expo-audio ~56.0.12`; проект уже
использует эту версию. См. <https://docs.expo.dev/versions/v56.0.0/sdk/audio/>.

## 12. Push notifications вместо Noop

### 12.1 Dependency gate

RuStore React Native Push SDK является новой native dependency. До добавления:

1. отдельное решение/одобрение зависимости;
2. compatibility spike с Expo 56/RN 0.85/New Architecture;
3. pin точного release/commit и лицензии;
4. Android release smoke на устройстве с RuStore/distributor и без него.

До прохождения gate функция скрыта feature flag; settings не должны показывать
работающий toggle поверх Noop.

### 12.2 Provider

```ts
interface PushProvider {
  init(): Promise<void>;
  getPermissionState(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  getToken(): Promise<string | null>;
  onTokenChanged(cb: (token: string | null) => void): Unsubscribe;
  onNotificationReceived(cb: (payload: PushPayload) => void): Unsubscribe;
  onNotificationTap(cb: (payload: PushPayload) => void): Unsubscribe;
}
```

Cold start `init()` только регистрирует listeners. Системный permission dialog
показывается исключительно после собственного soft-ask, после onboarding или
первой победы, и явного согласия пользователя.

Allowlist deep links: `/daily`, `/wheel`, `/events`. Любой неизвестный route
ведёт на `/`; сырая строка из push не передаётся напрямую router.
Даже allowlisted route открывается только если соответствующая feature flag и
данные доступны; иначе используется безопасный `/` с объясняющим toast.

### 12.3 Backend и consent

```http
POST   /api/push/register
DELETE /api/push/register
```

```ts
interface PushStateV1 {
  schemaVersion: 1;
  consent: 'unknown' | 'soft_declined' | 'granted' | 'system_denied';
  softAskShownAt: string | null;
  tokenHash: string | null;
  registrationRevision: number;
  pendingOperation: 'register' | 'unregister' | null;
}
```

Настройка мигрируется с default `notifications=false`; soft-ask показывается не
более одного раза без нового явного действия в Settings. Токен связывается с
авторизованным anonymous/registered `userId` и server-issued `deviceId`,
поддерживает rotation, `disabledAt` и
`lastSeenAt`. Raw token не логируется и не попадает в AppMetrica. Service token
RuStore хранится только на сервере.

Settings OFF выполняет backend unregister и сохраняет opt-out. Обновление
приложения не включает push автоматически. При permanent denial UI предлагает
системные настройки, а не повторяет dialog.

Register/unregister — durable idempotent outbox. Token rotation сначала ставит
новый register, затем tombstone старой регистрации; событие `token=null` также
создаёт unregister tombstone. Network/429/5xx повторяются с backoff, остальные
4xx уходят в dead-letter. Перезапуск приложения не теряет pending operation и не
создаёт параллельные регистрации одного `userId+deviceId+provider`.

Campaign guardrails:

- не более 1 marketing push/24h и 3/7d;
- quiet hours 21:00–10:00 по локальному времени;
- не отправлять retention push пользователю, активному последние 3 часа;
- streak/daily/event campaign idempotent по `userId+campaignId+day`;
- foreground/background/cold-start tap не создаёт двойную навигацию.

Официальные references: <https://www.rustore.ru/help/sdk/push-notifications> и
<https://gitflic.ru/project/rustore/react-native-rustore-push-sdk>.

Acceptance PUSH:

- PUSH-01: soft-ask/system permission появляются только по consent-contract;
- PUSH-02: grant, denial, permanent denial и settings OFF сохраняются после restart;
- PUSH-03: rotation и `token=null` приводят к одной актуальной регистрации либо
  unregister tombstone после offline/restart;
- PUSH-04: foreground/background/cold-start tap открывает route ровно один раз;
- PUSH-05: unknown/disabled route не передаётся router и безопасно ведёт домой;
- PUSH-06: native device smoke проходит с RuStore provider и при его отсутствии.

## 13. События, отличимые от недельного рейтинга

Текущий `weekly-*` event использует тот же weekly score, что leaderboard. До
реализации EVENT-v2 экран скрывается feature flag, а не показывается как
самостоятельная функция.

### 13.1 Общий подтверждённый run

Events и team goals потребляют один idempotent run pipeline, а не собственные
клиентские счётчики:

```http
POST /api/runs
Idempotency-Key: <runId>
```

```ts
interface RunReceipt {
  runId: string;
  completionId: string;
  contentVersion: string;
  levelFingerprint: string;
  globalLevel: number;
  mode: 'normal' | 'daily';
  bonusIndexes: number[]; // индексы acceptedBonus, а не raw words
  hintsUsed: HintType[];
  completedAt: string;
}
```

Сервер находит точный audited pack по `contentVersion+fingerprint`, проверяет
уровень, диапазоны/уникальность `bonusIndexes`, completion id и sanity limits,
затем один раз материализует verified metrics. Это не доказывает человеческое
прохождение, но исключает доверие к произвольному `delta` и не требует отправлять
raw bonus-слова. Один `runId` может быть применён к normal progress, event и team
goal только по одному разу в каждом ledger.

Для `unique_bonus_words` сервер преобразует каждый проверенный `bonusIndex` в
каноническое слово из сохранённого pack и строит стабильный
`wordId = sha256(dictionaryHash + normalizedWord)`. Уникальность хранится по
`eventId+userId+wordId`; повтор слова на другом уровне не увеличивает метрику.

```ts
interface EventDefinition {
  id: string;
  type: 'bonus_rush' | 'daily_chain' | 'world_sprint';
  title: string;
  startsAt: string;
  endsAt: string;
  metric: 'unique_bonus_words' | 'daily_completions' | 'verified_levels';
  rules: EventRules;
  rewardTiers: RewardTier[];
  leaderboardEnabled: boolean;
  contentVersion: string;
}
```

Первый MVP-event — `bonus_rush`: уникальные принятые bonus-слова за выходные,
personal milestones + optional board. Он не может вычисляться из общего
`user.score`.

API:

```http
GET  /api/events
GET  /api/events/:id
GET  /api/events/:id/board
POST /api/events/:id/progress
POST /api/events/:id/rewards/:tierId/claim
```

- progress содержит только `runId`; duplicate run не меняет score;
- сервер выводит вклад из подтверждённого run/result, а не принимает raw delta;
- expired event не принимает progress;
- claim возвращает `RewardGrantEnvelope { grantId, userId, sourceType, sourceId,
  effects, issuedAt }`; server ledger гарантирует один `grantId`, а клиент
  применяет effects через `applyOnce(effectId)` из §9.4;
- клиент хранит реальный cache с `updatedAt` и durable outbox;
- UI показывает правила, metric, server-synced timer, personal progress,
  reward tiers, board и active/upcoming/finished/empty/offline states.

Backend schema version хранится отдельно; миграции добавляют таблицы
`runs/event_definitions/event_progress/reward_grants` транзакционно, не
переписывают weekly leaderboard и безопасны при повторном запуске. Клиентские
keys — `events.cache.v2`, `runs.outbox.v1`, `reward.grants.v1`; definitions
хранятся сервером до конца claim window.

Acceptance EVENT-01: `bonus_rush` читает только verified `wordId` из run ledger и
никогда не читает/не копирует `user.score` или weekly leaderboard aggregate.
EVENT-02: повтор `runId` не увеличивает score. EVENT-03: повтор claim/grant после
network timeout или process death не меняет wallet второй раз. EVENT-04: source
pack для каждого принятого run доступен и checksum подтверждён.

## 14. Командная ценность: недельная общая цель

Lifetime `totalScore` остаётся статистикой, но не считается командной игровой
механикой.

```ts
interface TeamGoal {
  id: string;
  teamId: string;
  startsAt: string;
  endsAt: string;
  metric: 'verified_levels' | 'unique_bonus_words';
  target: number;
  total: number;
  rewards: Reward[];
}

interface TeamContribution {
  goalId: string;
  userId: string;
  amount: number;
  updatedAt: string;
}

interface TeamMembership {
  teamId: string;
  userId: string;
  role: 'leader' | 'member';
  status: 'requested' | 'active' | 'left' | 'removed';
  joinedAt: string | null;
  updatedAt: string;
}
```

Первый v1 goal: подтверждённые уровни за неделю.

- вклад считается только после `joinedAt`;
- выход не уменьшает уже заработанный total;
- late join не даёт reward без минимального личного вклада;
- повтор run не дублирует вклад;
- reward claim идемпотентен;
- member cap/join policy задаются сервером;
- создание команды бесплатно, пока currency не стала server-authoritative;
- leader transfer обязателен при выходе leader;
- chat вне scope v1.

Минимальный API membership:

```http
POST /api/teams/:id/join-requests
POST /api/teams/:id/join-requests/:userId/approve
POST /api/teams/:id/join-requests/:userId/reject
POST /api/teams/:id/members/:userId/remove
POST /api/teams/:id/leave
POST /api/team-goals/:goalId/rewards/claim
```

Claim разрешён только active member, вступившему до `endsAt`, с личным вкладом
не ниже server-configured minimum и до `claimEndsAt`. Leave/rejoin не обнуляет
историю eligibility и не позволяет получить награду дважды. Незабранная награда
после claim window сгорает; автоматический rollover запрещён. Все mutating
endpoints имеют idempotency key и проверяют server-side role.

UI: `total/target`, timer, моя доля, вклад участников за текущую цель, preview и
claim награды, состояния offline/full/request/empty. Lifetime score не
подписывается как progress текущей цели.

Миграция сохраняет существующие team id/name/leader/members, создаёт memberships
с `joinedAt=migrationAt` и начинает первый goal с нуля; ретроактивной награды за
lifetime score нет.
Backend migration выполняется транзакционно и идемпотентно, делает backup
исходного JSON/store и не меняет существующие team ids. Клиент использует
`teams.cache.v2` и общий `runs.outbox.v1`.

Acceptance TEAM:

- TEAM-01: два участника видят одинаковый server total из verified runs;
- TEAM-02: duplicate run и повторный claim не меняют contribution/wallet;
- TEAM-03: late join, leave/rejoin и removal соблюдают eligibility/claim window;
- TEAM-04: только leader может approve/reject/remove/transfer по server role;
- TEAM-05: миграция сохраняет ids/members, но не выдаёт retroactive reward.

## 15. Непрерывная глобальная сложность

### 15.1 Глобальная позиция

```ts
generateWorld({
  world,
  count,
  globalOffset,
  totalGlobalLevels,
  ...
});
```

Размер диска и target difficulty вычисляются по `globalOffset + localIndex`.
Смена world меняет тему, но не сбрасывает навык.

Точная формула: `globalId = globalOffset + localId`, где `localId` начинается с
1, а offsets равны `0/90/170`; первые ids миров обязаны быть `1/91/171`.

Целевые bands:

| Global levels | Диск | Ориентир mandatory answers |
|---|---|---|
| 1–30 | 3–4 | 2–3 |
| 31–80 | 4–5 | 2–4 |
| 81–150 | 5–6 | 3–5 |
| 151–220 | 6–7 | 4–6 |
| 221–250 | преимущественно 7 | 5–6 |

Внутри каждых 10 уровней допустима волна
`easy → baseline → hard → breather → climax`, но world boundary не является
breather автоматически.
Роль волны сохраняется явно в `difficultyRole`; rolling-gates могут исключать
только уровни с `difficultyRole='breather'`, а не произвольный провал score.

### 15.2 Composite score

`difficultyScore` детерминированно учитывает:

- letter count;
- mandatory answer count;
- grid cell/intersection complexity;
- частотный rank mandatory words;
- среднюю и максимальную длину answer.

Конкретные веса хранятся в generator config и включаются в content hash. Bonus-
слова не повышают обязательную сложность.

Acceptance DIFF:

- DIFF-01: `globalId` уникальны 1..250, первые ids миров равны 1/91/171;
- DIFF-02: 90→91 и 170→171: падение disk size/tier не больше 1; возврат 7→4 запрещён;
- DIFF-03: средний score следующих 20 уровней не ниже предыдущих 20 более чем на 10%,
  кроме явно помеченной breather-группы;
- DIFF-04: не более четырёх tier-5 уровней подряд;
- DIFF-05: tutorial level 1 фиксирован;
- DIFF-06: один seed/config/content version → идентичный результат;
- DIFF-07: QA export содержит global level, world, disk size, answer count, tier,
  role и score.

## 16. Analytics и privacy

### 16.1 Запрещённые данные

- Raw candidate word запрещён в AppMetrica для `word_found`, `wrong_word` и
  любых автоматических событий.
- Raw push token запрещён в analytics/logs.
- Snapshot, выбранные буквы и free-form moderation note не отправляются.

Фактическое слово отправляется только по явному действию «Сообщить» на
изолированный backend и хранится по moderation retention policy.

### 16.2 События

| Event | Обязательные props |
|---|---|
| `word_submit_outcome` | kind, reason, len, levelId, mode, contentVersion, policyRevision |
| `word_report_opened/submitted` | reportKind, currentClassification, len, levelId, requestId |
| `word_policy_loaded/rejected/conflict` | revision, contentVersion, result/reason |
| `level_completion_triggered` | levelId, mode, source, completionId |
| `level_reward_claimed` | levelId, mode, completionId, amount |
| `game_snapshot_migrated` | fromVersion, mode, result |
| `level_resume` | mode, levelId, dailyId, contentVersion, filledPercent |
| `daily_start/complete` | dailyId, streak, reward, contentVersion |
| `setting_changed` | sound/music/notifications, enabled |
| `push_*` | campaignId, route, permissionState, triggerPoint; без token |
| `event_*` | eventId, type, metric, score/rank/tier |
| `team_*` | teamId, goalId, memberCount, contribution, total/target |

`completionId`, `reportId` и `runId` технические UUID, не user PII.

## 17. Rollout, миграции и rollback

Порядок обязателен:

1. Добавить content audit и regression-наборы; зафиксировать текущую базу.
2. Реализовать completion state machine и regression tests.
3. Выпустить раздельные normal/daily save slots и legacy migration.
4. Собрать curated dictionary + LevelPack v2 + fallback pack.
5. Перегенерировать 250 уровней с global difficulty; сохранить global progress,
   инвалидировать только несовместимые in-level snapshots.
6. Включить `dictionaryV2` внутренней сборке, затем staged production rollout.
7. Развернуть report/policy backend, включить `wordReports` и
   `remoteWordPolicy` после smoke.
8. Добавить audio assets; включить UI toggles только после release-build smoke.
9. Push — только после dependency gate и native smoke.
10. Events/team goals — поверх общего server-authoritative, idempotent run
    pipeline; до готовности скрыть флагами.

Назначение contentVersion sticky: normal/daily snapshot и активная попытка всегда
остаются на закреплённых `contentVersion+fingerprint+policyRevision` до safe
boundary (completion, expiry daily или явный quarantine resolve). Процент staged
rollout не может заменить pack посреди уровня. Backend сохраняет manifests/packs,
нужные всем поддерживаемым sticky assignments.

Feature flags:

```text
dictionaryV2
wordReports
remoteWordPolicy
audioEnabled
pushEnabled
eventsV2
teamGoals
```

Rollback:

- старый level pack хранится минимум до завершения staged rollout и окна 90 дней;
- binary downgrade на legacy storage запрещён; откат выполняется новой
  V2-совместимой сборкой, а миграция остаётся безопасной при повторном запуске;
- remote policy rollback публикуется новой revision;
- при backend outage bundled content и normal/daily работают полностью offline;
- отключение social/push/report flags не влияет на core progress.

## 18. Тестовая матрица

| Слой | Обязательные проверки |
|---|---|
| Engine unit | grid/bonus/hard-block/remote deny/allow precedence; duplicate after canonical class; strict normalize; all hint completion paths |
| Dictionary unit | sources/checksums; normalization; blocked reasons; mustAccept/mustBlock/mustNotBeAnswer |
| Generator | deterministic build; exhaustive acceptedBonus; no blocked answers; duplicates; global difficulty |
| Content audit | 250/250 strict pass; 0 unclassified eligible pairs; 0 policy conflicts |
| Persistence | two slots; partial/all-filled/completed legacy fixtures; cloud merge; fingerprint invalidation; completion_pending restore |
| Store integration | normal↔daily; submit/hint completion; crash at every reward-journal boundary; process restart |
| Backend policy | ETag/revision/checksum/content scope; atomic publish; rollback; size limits |
| Reports | validation, rate limit, offline outbox, idempotency, no raw word in AppMetrica |
| Events/teams | server time, duplicate run, arbitrary delta rejection, reward ledger, cache/outbox |
| Push | soft-ask, grant/deny, token rotation/unregister, allowlisted deep links, three lifecycle states |
| Audio | settings, preload failure, focus/background, player disposal, Android release audibility |
| E2E Android | final cell via every hint; airplane mode; update from old snapshot; daily round trip |

Команды release gate:

```bash
npm test
npm run backend:test
npm run typecheck
npm run lint
node scripts/audit-content.js --strict
```

После автоматических тестов обязателен Android release-build smoke; web/Expo Go
не подтверждают RuStore push, native audio focus и process-death restore.

## 19. Измеримые критерии приёмки

### P0/P0.5

- Текущие 3 313 пар остаются frozen regression baseline: после повторной
  модерации каждая имеет явный результат grid/bonus/blocked с reason.
- Для **candidate production pack** denominator вычисляется заново как все пары
  `level × составимое слово` из pinned dictionary. Unclassified = 0; для всех
  допустимых пар acceptance coverage = 100%; levels with gaps = 0.
- 0 blocked/proper-name/abbreviation/obscene mandatory answers.
- 250/250 уровней проходят strict content audit.
- Mandatory uniqueness ≥85%; первые 50 без повторов; одно слово ≤3 mandatory
  occurrences. Исключения не разрешены production gate.
- Submit и каждый hint type завершают уровень ровно один раз, без двойной награды.
- Normal/daily сохраняются независимо во всех переходах и после restart.
- Report работает online/offline; remote policy обновляется/откатывается без AAB
  и не может сделать уровень непроходимым.
- В AppMetrica нет raw words и push tokens.

### P1/P2

- На 90→91 и 170→171 нет reset 7→4 и tier drop >1.
- Звуки и музыка реально слышны в signed release build либо функция скрыта.
- Push реально регистрирует/удаляет token и открывает allowlisted routes либо
  функция скрыта.
- Event использует собственную metric и reward tiers, а не копию weekly score.
- Team UI показывает текущую общую цель, personal contribution и idempotent
  reward, а не только lifetime sum.
- `npm test`, `backend:test`, typecheck, lint и content audit зелёные.

## 20. Traceability

| Requirement | Основные владельцы/пути | Тест/гейт | Flag |
|---|---|---|---|
| DICT-01..15 | `scripts/build-dictionary.js`, `scripts/gen-levels.js`, `scripts/dict/*`, `assets/dict/*` | `audit-content --strict` | `dictionaryV2` |
| Runtime classification | `src/core/engine/{normalize,play,types}.ts` | engine unit | `dictionaryV2` |
| Remote policy | `src/features/dictionary/*`, `backend/runtime/*` | policy backend + offline | `remoteWordPolicy` |
| Word report | `src/features/dictionary/*`, `src/app/game.tsx`, backend | outbox/idempotency/privacy | `wordReports` |
| COMP-01..10 | `src/core/engine/hints.ts`, `src/features/game/{store,persistence}.ts`, `src/app/game.tsx` | unit+integration+process restart | — |
| SAVE | `src/core/storage`, `src/features/game/persistence.ts`, cloud save | migration/round-trip | — |
| AUDIO | `src/features/audio`, `assets/sfx`, `assets/music`, settings | Jest + Android release | `audioEnabled` |
| PUSH | `src/features/notifications`, config plugin, backend | native lifecycle + backend | `pushEnabled` |
| EVENT | `src/features/events`, `src/app/events.tsx`, backend | lifecycle/run/reward | `eventsV2` |
| TEAM | `src/features/teams`, `src/app/teams.tsx`, backend | contribution/reward/migration | `teamGoals` |
| DIFF | `scripts/gen-levels.js`, level packs/loader | boundary+rolling audit | `dictionaryV2` |
| Analytics/privacy | `src/features/analytics`, all integrations | mapping/no-sensitive-data | соответствующий feature flag |

## 21. Обязательные последующие обновления документации

При реализации изменить, а не оставлять конфликтующие контракты:

- [02](02-architecture.md): новые MMKV keys, policy/report cache/outbox;
- [03](03-engine-and-generator.md): LevelV2, `SubmitResult`, `HintResult`,
  exhaustive accepted layer, global difficulty;
- [04](04-design-system.md): реальные audio assets и lifecycle;
- [08](08-daily-wheel-streak.md): отдельный daily slot и DailyDefinition;
- [10](10-events-teams.md): event metrics/reward tiers/team goals;
- [11](11-profile-cloudsave-backend.md): policy/report/push/run/reward API и
  cloud-save schema;
- [12](12-notifications.md): фактический provider, caps и consent;
- [15](15-localization-dictionary.md): четыре слоя и строгая нормализация;
- [16](16-analytics.md): новые events и запрет raw word/token;
- [17](17-nfr-acceptance.md): новые P0 gates;
- [19](19-content-scale-quality.md): удалить устаревшие counts и ссылаться на
  `content-audit.json`;
- `docs/runbooks/dictionary-sources.md`: pinned refs, checksums, rebuild/audit,
  moderation и policy publication.

## 22. Non-goals и решения по умолчанию

- Не добавлять iOS target/adapter.
- Не загружать полный `ru.json` в runtime.
- Не строить публичную moderation console в первой итерации; достаточно
  защищённого CLI/внутреннего workflow.
- Не добавлять chat в команды v1.
- Не начислять ретроактивные rewards за старый event/team lifetime score.
- Не использовать remote policy для доставки произвольных grid/cell layouts.
- Не обещать definition/etymology, пока нет лицензированного источника.
- Не расширять словарь формами склонения/спряжения без отдельного продуктового
  решения; текущая норма — леммы.
- Если product owner не задаёт другие числа, действуют defaults этой спеки:
  mandatory uniqueness ≥85%, ≤3 occurrences/word, push cap 1/day и 3/week,
  report cap 10/user/day, policy payload ≤256 KiB.
