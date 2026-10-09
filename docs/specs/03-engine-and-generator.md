# 03 — Движок и генератор уровней

Статус: утверждено · Обновлено: 2026-07-27

`core/engine` — чистый TypeScript без React/RN. Покрытие тестами обязательно.

## Модель данных

```ts
type Cell = { row: number; col: number; ch: string };
type Answer = { word: string; cells: Cell[]; dir: 'H' | 'V' };

type LevelMechanic = 'classic' | 'bonus_chest' | 'ordered' | 'mastery';
type LevelMilestone = 'chest' | 'landmark' | 'world_finale' | 'journey_finale';

interface Level {
  id: number;
  world: string;
  letters: string[];          // буквы диска, уже нормализованные
  grid: { rows: number; cols: number; cells: Cell[] };
  answers: Answer[];
  bonusPool: string[];        // полный пул дополнительных слов уровня
  rewardedBonus?: string[];   // curated subset, который реально показываем как бонусы
  difficulty: number;
  mechanic?: LevelMechanic;
  milestone?: LevelMilestone | null;
  bonusTarget?: number;
  answerOrder?: string[];
  theme?: string;
}

interface PlayState {
  level: Level;
  filled: Record<string, string>;
  solvedWords: string[];
  foundBonus: string[];
  coinsEarned: number;
}
```

## Контракт игры

```ts
type SubmitResult =
  | { kind: 'grid'; word: string; cells: Cell[]; deltaCoins: number; levelComplete: boolean }
  | { kind: 'bonus'; word: string; deltaCoins: number; firstTime: boolean }
  | { kind: 'duplicate'; word: string }
  | { kind: 'invalid'; word: string }
  | { kind: 'constraint'; reason: 'wrong_order'; expectedLength: number };

function submitWord(state: PlayState, word: string): { state: PlayState; result: SubmitResult };
function shuffle(letters: string[], rng: Rng): string[];
function applyHint(state: PlayState, hint: HintType, target?: Cell): { state: PlayState; revealed: Cell[] };
function isLevelComplete(state: PlayState): boolean;
```

Правила:

- `word` собирается из `letters` с учётом кратности букв на диске.
- `grid` — если `word ∈ answers` и он ещё не solved, заполнить клетки, начислить монеты и проверить завершение.
- `bonus` — если `word ∈ rewardedBonus`/`bonusPool` и он ещё не найден, начислить монеты; `firstTime` нужен для анимации.
- `duplicate` — слово уже отгадано.
- `invalid` — слова нет в словаре уровня; это мягкая ошибка без штрафа.
- `constraint.wrong_order` — для `ordered`-механики слово найдено, но не на ожидаемом шаге. UI должен показать текст вроде «Сначала слово из N букв».
- Подсказки: `reveal-letter`, `hammer`, `reveal-word`; стоимость берётся из [06](06-economy-currencies.md).

## Валидатор слов

- Источник правды по словарю уровня — **сам Level** (`answers` + `bonusPool` + `rewardedBonus`), сгенерированный офлайн. Рантайм не грузит мегасловарь, только level-local пул.
- Нормализация: нижний регистр, `ё → е`, без дефисов и пробелов.
- Внутри одного уровня запрещены слова одной основы в `answers + bonusPool + rewardedBonus`.
- Генератор и аудитор обязаны ловить повторяющиеся корни и повторяющиеся слова по всему паку уровней.

## Генератор уровней (build-time)

`scripts/gen-levels.js` детерминированно производит контент-паки `assets/levels/world*.json`.

Пайплайн:

1. Выбрать базовые ответы из `assets/dict/ru-common.json`.
2. Применить ручные override-списки для уровней 1–30 и всех финалов миров.
3. Построить диск по кривой длины:
   - tutorial: 3 буквы;
   - до 30: 4 буквы;
   - до 80: 5 букв;
   - до 150: 6 букв;
   - до 350: 7 букв;
   - до 1000: 8 букв.
4. Перебрать валидный словарь `assets/dict/ru.json` и собрать `bonusPool`; затем выделить `rewardedBonus` — видимый и отфильтрованный набор бонусов.
5. Назначить механику и волну сложности:
   - `easy` — tutorial и очень ранние уровни;
   - `baseline` — основная прогрессия;
   - `hard` — подъёмы сложности и новые ограничения;
   - `breather` — уровни с заметной наградой/передышкой;
   - `climax` — финалы миров и chapter finale.
6. Расставить `mechanic`:
   - `bonus_chest` — ранние и средние уровни с заметной наградой;
   - `ordered` — уровни, где нужно собирать слова в явном порядке;
   - `mastery` — поздние уровни без подсказок и с более жёсткой подачей.
7. Назначить `milestone`:
   - `chest` — каждые 10 уровней;
   - `landmark` — ключевые точки путешествия;
   - `world_finale` — финал каждого мира;
   - `journey_finale` — уровень 1000; прежняя веха 500 сохраняется для совместимости сохранений и наград.
8. Уложить слова в компактный связный кроссворд без касаний и без изолированных клеток.
9. Прогнать `engine.validateLevel`, генераторные инварианты и контент-аудит.

## Текущий production-контракт

- 14 миров, 1000 уровней суммарно: два маршрута по семи городам.
- Уровень 1 — tutorial `сон`/`нос`, без бонусных слов и без форм одного слова.
- Уровень 250 — финал первого большого chapter, но не конец игры.
- После уровня 500 открывается world8 и уровень 501. Текущий финал путешествия — 1000.
- Уровни 1–500 сохраняются побайтно; их SHA-256 зафиксированы в `assets/content/preserved-packs.json` и проверяются аудитом.
- Новое расширение строится командой `node scripts/gen-levels.js --append-from 500` с заданным `SOURCE_DATE_EPOCH`. Это также режим по умолчанию для `npm run gen:levels`: счётчики повторов и сигнатур заполняются из сохранённых паков, записываются только world8–14. Полная пересборка требует явного `--append-from 0` и не пройдёт проверку неизменности выпущенных паков при изменении их содержимого.
- Новые сетки ограничены 9 строками и 10 столбцами. Повтор обязательного или бонусного слова ограничен тремя появлениями на всю кампанию.
- `assets/content/extension-blocked.json` исключает из новых пазлов обнаруженные имена, сокращения, повреждённые слова и грубую лексику. Собираемые исключения попадают в `blockedPool`, существующие уровни не меняются.

## Инварианты

- Каждое `answers[i].word` собирается из `letters`.
- Каждая клетка сетки покрыта хотя бы одним словом.
- Нет «висячих» клеток.
- Нет касаний: соседние по стороне занятые клетки принадлежат либо одному слову, либо пересекаются в общей клетке.
- `bonusPool ∩ answers = ∅`, если слово не помечено как исключение аудитом.
- Внутри уровня нет конфликтов одной основы среди `answers + bonusPool + rewardedBonus`.
- Детеминизм: один seed → идентичный пак.

## Конфиг

```ts
export const GAME = {
  diskLetters: {
    tutorial: 3,
    until30: 4,
    until80: 5,
    until150: 6,
    until350: 7,
    until1000: 8,
  },
  coinsPerGridWord: 5,
  coinsPerBonusWord: 2,
  worldChestEvery: 10,
};
```

## Тесты

`core/engine/__tests__`: submitWord (grid/bonus/duplicate/invalid/constraint), завершение уровня, ordered-механика, подсказки, shuffle-детерминизм, validateLevel, генератор (детерминизм + инварианты на сэмпле миров).
