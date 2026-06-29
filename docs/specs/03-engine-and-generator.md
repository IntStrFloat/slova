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

Скрипт `scripts/gen-levels.js` (Node) детерминированно (seed) производит **контент-паки** `assets/levels/<world>.json`:

1. Выбрать базовое слово из `assets/dict/ru-common.json` (частотный слой узнаваемых слов); длина диска растёт по кривой 4→7.
2. Перебрать все частотные слова, составимые из набора (≥3 букв) → кандидаты в `answers`.
3. Перебрать полный валидационный словарь `assets/dict/ru.json` → `bonusPool`, отсортированный по узнаваемости и ограниченный лимитом.
4. Уложить подмножество слов в **связный компактный кроссворд** (пересечения по буквам; ограничения rows×cols, плотность). Отбросить раскладки с изолированными словами. **Без касаний:** два разных слова делят только реальную клетку-пересечение — у непересекающихся клеток перпендикулярные соседи пусты, и слова не примыкают торцами; иначе соседние слова визуально слипаются в один ряд (напр. `пот`+`топ` → `ТТОП`).
5. Отбросить слова одной основы внутри уровня: `answers` и `bonusPool` не должны содержать пары вроде `убил`/`бил`, `глаз`/`глаза`, `жук`/`жука`.
6. Проверить инварианты движком (`engine.validateLevel`): сетка консистентна, все answers собираемы из letters, единственность решения по клеткам.
7. Назначить `difficulty`, записать в пак. Логи отбраковки.

Текущий production-пак: 3 мира, 250 уровней суммарно. Уровень 1 закреплён как tutorial `сон`/`нос`, чтобы избежать форм одного слова в первом контакте.

Инварианты (тестируются):
- Каждое `answers[i].word` собираемо из `letters`.
- Каждая клетка сетки покрыта ≥1 словом; нет «висячих» клеток.
- Нет «касаний»: любые две ортогонально соседние занятые клетки — последовательные внутри одного слова (разные слова касаются только в клетке-пересечении).
- `bonusPool ∩ answers = ∅`.
- В пределах одного уровня нет конфликтов одной основы среди `answers + bonusPool`.
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
