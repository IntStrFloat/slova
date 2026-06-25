# 03 — Движок и генератор уровней

Статус: утверждено · Обновлено: 2026-06-26

`core/engine` — чистый TS, ноль импортов React/RN. Покрытие тестами обязательно.

## Модель данных

```ts
type Cell = { row: number; col: number; ch: string };   // клетка кроссворда
type Answer = { word: string; cells: Cell[]; dir: 'H' | 'V' };

interface Level {
  id: number;
  world: string;            // id мира/локации
  letters: string[];        // буквы диска (3–7), кириллица в нижнем регистре
  grid: { rows: number; cols: number; cells: Cell[] };  // целевая раскладка
  answers: Answer[];        // слова сетки (из letters, перестановки)
  bonusPool: string[];      // доп. валидные слова из letters (для бонусов)
  difficulty: number;       // 1..N (кривая по миру)
}

interface PlayState {
  level: Level;
  filled: Record<string, string>;   // "r,c" → буква
  solvedWords: string[];            // уже отгаданные answers
  foundBonus: string[];             // найденные бонусные
  coinsEarned: number;
}
```

## Контракт игры (события, UI проигрывает)

```ts
type SubmitResult =
  | { kind: 'grid'; word: string; cells: Cell[]; deltaCoins: number; levelComplete: boolean }
  | { kind: 'bonus'; word: string; deltaCoins: number; firstTime: boolean }
  | { kind: 'duplicate'; word: string }
  | { kind: 'invalid'; word: string };

function submitWord(state: PlayState, word: string): { state: PlayState; result: SubmitResult };
function shuffle(letters: string[], rng: Rng): string[];           // только перестановка диска
function applyHint(state: PlayState, hint: HintType, target?: Cell): { state: PlayState; revealed: Cell[] };
function isLevelComplete(state: PlayState): boolean;               // все клетки заполнены
```

Правила:
- `word` собирается из `letters` (каждая буква диска используется ≤ числа её вхождений).
- `grid` — если `word ∈ answers` и ещё не solved → заполнить клетки, начислить монеты, проверить завершение.
- `bonus` — `word ∈ bonusPool` и не найден → монеты (меньше, чем за grid), `firstTime` для анимации.
- `duplicate` — уже отгадано; `invalid` — нет в словаре уровня (тряска, без штрафа).
- Подсказки: `reveal-letter` (случайная/выбранная буква одного слова), `hammer` (открыть короткое слово / убрать лишние буквы — конфиг), `reveal-word` (целое слово). Стоимость — из [06](06-economy-currencies.md).

## Валидация слов

- Источник правды по словарю уровня — **сам Level** (`answers` + `bonusPool`), сгенерированный из общего словаря офлайн. Рантайм не грузит мегасловарь — только пул уровня. Глобальный словарь нужен лишь генератору и (опц.) бэкенду.
- Нормализация: нижний регистр, `ё→е` (конфиг), без дефисов/пробелов. См. [15](15-localization-dictionary.md).

## Генератор уровней (build-time)

Скрипт `scripts/gen-levels.js` (чистый TS/Node, переиспользует `core/engine`) детерминированно (seed) производит **контент-паки** `assets/levels/<world>.json`:

1. Выбрать базовый набор букв (длина по кривой сложности мира; гласные-консонанты баланс).
2. Перебрать все валидные слова словаря, составимые из набора (≥3 букв) → кандидаты в `answers` + `bonusPool`.
3. Уложить подмножество слов в **связный компактный кроссворд** (пересечения по буквам; backtracking; ограничения rows×cols, плотность). Отбросить раскладки с изолированными словами.
4. Проверить инварианты движком (`engine.validateLevel`): сетка консистентна, все answers собираемы из letters, единственность решения по клеткам.
5. Назначить `difficulty`, записать в пак. Логи отбраковки.

Инварианты (тестируются):
- Каждое `answers[i].word` собираемо из `letters`.
- Каждая клетка сетки покрыта ≥1 словом; нет «висячих» клеток.
- `bonusPool ∩ answers = ∅`.
- Детерминизм: один seed → идентичный пак.

## Конфиг (`core/config/game.ts`)

```ts
export const GAME = {
  diskLetters: { min: 3, max: 7 },
  coinsPerGridWord: 5,
  coinsPerBonusWord: 2,
  worldChestEvery: 10,         // уровней между сундуками
  difficultyCurve: [...],      // длина набора/число слов по диапазонам уровней
};
```

## Тесты

`core/engine/__tests__`: submitWord (grid/bonus/duplicate/invalid), завершение уровня, подсказки, shuffle-детерминизм, validateLevel, генератор (детерминизм + инварианты на сэмпле миров).
