# M0+M1 — Каркас и играбельный оффлайн-срез — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запускающийся Expo-проект + чистый детерминированный движок word-connect/кроссворда, генератор валидных уровней из словаря, и играбельный экран (свайп→слово→сетка→бонусы→shuffle→подсказки→завершение), всё оффлайн.

**Architecture:** Зеркало `blockblast`. `core/engine` — чистый TS без React/RN, покрыт Jest. Контент (словарь, паки уровней) — данные в `assets/`, производятся build-скриптами. UI (`features/game`) проигрывает события движка; жесты на Reanimated/gesture-handler. Состояние — zustand + MMKV.

**Tech Stack:** Expo SDK 56, RN 0.85 (New Arch, Hermes), expo-router, TypeScript strict, zustand, react-native-mmkv, react-native-reanimated 4, react-native-gesture-handler, react-native-svg, Jest (jest-expo).

Спеки: [02](../specs/02-architecture.md), [03](../specs/03-engine-and-generator.md), [04](../specs/04-design-system.md), [07](../specs/07-levels-worlds-collection.md), [15](../specs/15-localization-dictionary.md).

---

## Файловая структура (создаётся этим планом)

```
package.json app.json tsconfig.json eslint.config.js jest-setup.js
src/core/config/game.ts
src/core/i18n/{index.ts,ru.ts,en.ts}
src/core/storage/index.ts
src/core/engine/{types.ts,normalize.ts,letters.ts,rng.ts,play.ts,hints.ts,validate.ts,index.ts}
src/core/engine/__tests__/{normalize,letters,play,hints,validate}.test.ts
src/features/levels/{store.ts,loader.ts,index.ts}
src/features/levels/__tests__/store.test.ts
src/features/game/{store.ts,geometry.ts,LetterDisk.tsx,CrosswordGrid.tsx,LevelComplete.tsx,index.ts}
src/features/game/__tests__/{store,geometry}.test.ts
src/ui/{theme.ts,AppText.tsx}
src/app/{_layout.tsx,index.tsx,game.tsx}
scripts/{build-dictionary.js,gen-levels.js}
assets/dict/ru.json
assets/levels/world1.json
```

---

## M0 — Каркас

### Task 0.1: Инициализация Expo-проекта

**Files:** Create `package.json`, `app.json`, `tsconfig.json`, `eslint.config.js`, `jest-setup.js`

- [ ] **Step 1: Создать Expo-проект в текущей папке**

Run:
```bash
cd /c/Users/Dima2/Documents/Slova
npx create-expo-app@latest . --template blank-typescript
```
Если папка непустая — создать во временной и перенести конфиги, не затирая `docs/`, `.git`, `README.md`, `CLAUDE.md`, `AGENTS.md`.

- [ ] **Step 2: Привести `package.json` к стеку blockblast**

Установить пины (как в `C:\Users\Dima2\Documents\blockblast\package.json`):
```bash
npx expo install expo-router react-native-reanimated react-native-gesture-handler react-native-svg react-native-mmkv react-native-worklets expo-audio expo-haptics expo-localization expo-image expo-asset zustand
npm i -D jest jest-expo @types/jest typescript eslint eslint-config-expo
```
Прописать `"main": "expo-router/entry"`, скрипты `test`/`typecheck`/`android`, и `jest` preset `jest-expo` + `setupFiles: ["<rootDir>/jest-setup.js"]` (скопировать секцию из blockblast).

- [ ] **Step 3: tsconfig strict**

`tsconfig.json`:
```json
{ "extends": "expo/tsconfig.base", "compilerOptions": { "strict": true, "baseUrl": ".", "paths": { "@/*": ["src/*"] } }, "include": ["src", "expo-env.d.ts"] }
```

- [ ] **Step 4: Проверить**

Run: `npx tsc --noEmit`
Expected: PASS (нет ошибок типов).

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "chore(m0): init Expo RN проект, стек, tsconfig strict"
```

### Task 0.2: Конфиг движка `GAME`

**Files:** Create `src/core/config/game.ts`

- [ ] **Step 1: Написать конфиг**
```ts
export const GAME = {
  diskLetters: { min: 3, max: 7 },
  coinsPerGridWord: 5,
  coinsPerBonusWord: 2,
  levelClearBonus: 20,
} as const;
```
- [ ] **Step 2: Проверить** — `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Commit** — `git commit -am "feat(config): GAME-константы движка"`

### Task 0.3: i18n, storage, theme, AppText, router-каркас

**Files:** Create `src/core/i18n/*`, `src/core/storage/index.ts`, `src/ui/theme.ts`, `src/ui/AppText.tsx`, `src/app/{_layout,index,game}.tsx`

- [ ] **Step 1: i18n** — `src/core/i18n/index.ts`:
```ts
import { ru } from './ru'; import { en } from './en';
const dict = { ru, en } as const;
let lang: keyof typeof dict = 'ru';
export function setLang(l: keyof typeof dict) { lang = l; }
export function t(key: keyof typeof ru, params?: Record<string, string|number>): string {
  let s = (dict[lang][key] ?? dict.ru[key] ?? key) as string;
  if (params) for (const k in params) s = s.replace(`{${k}}`, String(params[k]));
  return s;
}
```
`ru.ts`/`en.ts`: `export const ru = { play: 'Играть', shuffle: 'Перемешать' } as const;` (en — переводы тех же ключей).

- [ ] **Step 2: storage** — `src/core/storage/index.ts`:
```ts
import { MMKV } from 'react-native-mmkv';
const mmkv = new MMKV();
export const StorageKeys = { gameCurrent: 'game.current', levelsProgress: 'levels.progress' } as const;
export function getJSON<T>(key: string, fallback: T): T {
  const raw = mmkv.getString(key); if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
export function setJSON(key: string, value: unknown): void { mmkv.set(key, JSON.stringify(value)); }
```

- [ ] **Step 3: theme + AppText** — `src/ui/theme.ts` (токены из [04](../specs/04-design-system.md), минимум: color/space/radius). `AppText.tsx`: обёртка `<Text>` с пресетами `display|title|body|label|tileLetter`, без сырого `fontWeight` в экранах.

- [ ] **Step 4: router** — `src/app/_layout.tsx` (Stack), `index.tsx` (заглушка карты с кнопкой → `/game`), `game.tsx` (заглушка).

- [ ] **Step 5: Запуск** — Run: `npx expo start` → приложение открывается, кнопка ведёт на `/game`. `npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit** — `git commit -am "feat(m0): i18n, storage, theme, AppText, router-каркас"`

---

## M1 — Движок (чистый TS, TDD)

### Task 1.1: Типы движка

**Files:** Create `src/core/engine/types.ts`

- [ ] **Step 1: Написать типы и хелпер ключа клетки**
```ts
export type Dir = 'H' | 'V';
export type Cell = { row: number; col: number; ch: string };
export type Answer = { word: string; cells: Cell[]; dir: Dir };

export interface Level {
  id: number;
  world: string;
  letters: string[];          // нормализованные буквы диска (нижний регистр, ё→е)
  grid: { rows: number; cols: number; cells: Cell[] };
  answers: Answer[];
  bonusPool: string[];        // валидные слова из letters, не входящие в answers
  difficulty: number;
}

export interface PlayState {
  level: Level;
  filled: Record<string, string>;   // "row,col" -> ch
  solvedWords: string[];
  foundBonus: string[];
  coinsEarned: number;
}

export type HintType = 'bulb' | 'hammer' | 'revealWord';

export type SubmitResult =
  | { kind: 'grid'; word: string; cells: Cell[]; deltaCoins: number; levelComplete: boolean }
  | { kind: 'bonus'; word: string; deltaCoins: number; firstTime: boolean }
  | { kind: 'duplicate'; word: string }
  | { kind: 'invalid'; word: string };

export function cellKey(c: { row: number; col: number }): string { return `${c.row},${c.col}`; }
export function initPlayState(level: Level): PlayState {
  return { level, filled: {}, solvedWords: [], foundBonus: [], coinsEarned: 0 };
}
```
- [ ] **Step 2: Проверить** — `npx tsc --noEmit` → PASS.
- [ ] **Step 3: Commit** — `git commit -am "feat(engine): типы Level/PlayState/SubmitResult"`

### Task 1.2: `normalizeWord`

**Files:** Create `src/core/engine/normalize.ts`, `src/core/engine/__tests__/normalize.test.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { normalizeWord } from '../normalize';
test('нижний регистр и ё→е', () => {
  expect(normalizeWord(' Ёлка ')).toBe('елка');
  expect(normalizeWord('ДОМ')).toBe('дом');
});
test('убирает не-кириллицу', () => { expect(normalizeWord('к-о.т')).toBe('кот'); });
```
- [ ] **Step 2: Запуск — FAIL** — Run: `npx jest normalize` → FAIL (module not found).
- [ ] **Step 3: Реализация**
```ts
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/ё/g, 'е').replace(/[^а-я]/g, '');
}
```
- [ ] **Step 4: Запуск — PASS** — Run: `npx jest normalize` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): normalizeWord + тесты"`

### Task 1.3: `canBuildFromLetters`

**Files:** Create `src/core/engine/letters.ts`, `__tests__/letters.test.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { canBuildFromLetters } from '../letters';
test('собирается из мультимножества букв', () => {
  expect(canBuildFromLetters('кот', ['к','о','т','м'])).toBe(true);
  expect(canBuildFromLetters('ток', ['к','о','т'])).toBe(true);
});
test('не хватает повторов', () => {
  expect(canBuildFromLetters('кок', ['к','о','т'])).toBe(false);
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest letters`.
- [ ] **Step 3: Реализация**
```ts
export function canBuildFromLetters(word: string, letters: string[]): boolean {
  const pool = new Map<string, number>();
  for (const l of letters) pool.set(l, (pool.get(l) ?? 0) + 1);
  for (const ch of word) {
    const n = pool.get(ch) ?? 0;
    if (n === 0) return false;
    pool.set(ch, n - 1);
  }
  return true;
}
```
- [ ] **Step 4: Запуск — PASS** — `npx jest letters`.
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): canBuildFromLetters + тесты"`

### Task 1.4: `submitWord` + `isLevelComplete`

**Files:** Create `src/core/engine/play.ts`, `__tests__/play.test.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { Level, initPlayState } from '../types';
import { submitWord, isLevelComplete } from '../play';

const level: Level = {
  id: 1, world: 'world1', letters: ['к','о','т'], difficulty: 1,
  grid: { rows: 1, cols: 3, cells: [
    { row:0,col:0,ch:'к' },{ row:0,col:1,ch:'о' },{ row:0,col:2,ch:'т' },
  ]},
  answers: [{ word:'кот', dir:'H', cells: [
    { row:0,col:0,ch:'к' },{ row:0,col:1,ch:'о' },{ row:0,col:2,ch:'т' } ]}],
  bonusPool: ['ток'],
};

test('grid-слово заполняет сетку и завершает уровень', () => {
  const { state, result } = submitWord(initPlayState(level), 'КОТ');
  expect(result.kind).toBe('grid');
  if (result.kind === 'grid') { expect(result.levelComplete).toBe(true); expect(result.deltaCoins).toBe(5); }
  expect(isLevelComplete(state)).toBe(true);
});
test('повтор grid-слова — duplicate', () => {
  const s1 = submitWord(initPlayState(level), 'кот').state;
  expect(submitWord(s1, 'кот').result.kind).toBe('duplicate');
});
test('бонусное слово даёт меньше монет, не завершает', () => {
  const { state, result } = submitWord(initPlayState(level), 'ток');
  expect(result.kind).toBe('bonus');
  if (result.kind === 'bonus') expect(result.deltaCoins).toBe(2);
  expect(isLevelComplete(state)).toBe(false);
});
test('невалидное слово — invalid, без изменений', () => {
  const start = initPlayState(level);
  const { state, result } = submitWord(start, 'тт');
  expect(result.kind).toBe('invalid');
  expect(state.coinsEarned).toBe(0);
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest play`.
- [ ] **Step 3: Реализация**
```ts
import { GAME } from '../config/game';
import { Answer, Cell, cellKey, Level, PlayState, SubmitResult } from './types';
import { normalizeWord } from './normalize';

export function isLevelComplete(state: PlayState): boolean {
  return state.level.grid.cells.every((c) => state.filled[cellKey(c)] === c.ch);
}

function fillCells(filled: Record<string,string>, cells: Cell[]): Record<string,string> {
  const next = { ...filled };
  for (const c of cells) next[cellKey(c)] = c.ch;
  return next;
}

export function submitWord(state: PlayState, raw: string): { state: PlayState; result: SubmitResult } {
  const word = normalizeWord(raw);
  const answer: Answer | undefined = state.level.answers.find((a) => a.word === word);
  if (answer) {
    if (state.solvedWords.includes(word)) return { state, result: { kind: 'duplicate', word } };
    const next: PlayState = {
      ...state,
      filled: fillCells(state.filled, answer.cells),
      solvedWords: [...state.solvedWords, word],
      coinsEarned: state.coinsEarned + GAME.coinsPerGridWord,
    };
    return { state: next, result: { kind: 'grid', word, cells: answer.cells, deltaCoins: GAME.coinsPerGridWord, levelComplete: isLevelComplete(next) } };
  }
  if (state.level.bonusPool.includes(word)) {
    if (state.foundBonus.includes(word)) return { state, result: { kind: 'duplicate', word } };
    const next: PlayState = { ...state, foundBonus: [...state.foundBonus, word], coinsEarned: state.coinsEarned + GAME.coinsPerBonusWord };
    return { state: next, result: { kind: 'bonus', word, deltaCoins: GAME.coinsPerBonusWord, firstTime: true } };
  }
  return { state, result: { kind: 'invalid', word } };
}
```
> `levelClearBonus` начисляет слой `features/game` (Task 1.11) при `levelComplete`, чтобы движок отвечал только за пословные монеты.
- [ ] **Step 4: Запуск — PASS** — `npx jest play`.
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): submitWord + isLevelComplete + тесты"`

### Task 1.5: `rng` + `shuffle`

**Files:** Create `src/core/engine/rng.ts`, добавить `shuffle` в `play.ts`, тест в `__tests__/play.test.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { mulberry32 } from '../rng';
import { shuffle } from '../play';
test('shuffle детерминирован по seed и сохраняет мультимножество', () => {
  const a = shuffle(['к','о','т'], mulberry32(42));
  const b = shuffle(['к','о','т'], mulberry32(42));
  expect(a).toEqual(b);
  expect([...a].sort()).toEqual(['к','о','т'].sort());
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest play -t shuffle`.
- [ ] **Step 3: Реализация** — `rng.ts`:
```ts
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
```
В `play.ts` добавить:
```ts
import { Rng } from './rng';
export function shuffle(letters: string[], rng: Rng): string[] {
  const a = [...letters];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
```
- [ ] **Step 4: Запуск — PASS** — `npx jest play -t shuffle`.
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): детерминированный rng + shuffle"`

### Task 1.6: `applyHint`

**Files:** Create `src/core/engine/hints.ts`, `__tests__/hints.test.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { Level, initPlayState, cellKey } from '../types';
import { applyHint } from '../hints';
const level: Level = { id:1, world:'w', letters:['к','о','т'], difficulty:1,
  grid:{rows:1,cols:3,cells:[{row:0,col:0,ch:'к'},{row:0,col:1,ch:'о'},{row:0,col:2,ch:'т'}]},
  answers:[{word:'кот',dir:'H',cells:[{row:0,col:0,ch:'к'},{row:0,col:1,ch:'о'},{row:0,col:2,ch:'т'}]}], bonusPool:[] };
test('bulb открывает одну клетку', () => {
  const { state, revealed } = applyHint(initPlayState(level), 'bulb');
  expect(revealed).toHaveLength(1);
  expect(state.filled[cellKey(revealed[0])]).toBe(revealed[0].ch);
});
test('revealWord открывает целое слово и метит solved', () => {
  const { state, revealed } = applyHint(initPlayState(level), 'revealWord');
  expect(revealed).toHaveLength(3);
  expect(state.solvedWords).toContain('кот');
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest hints`.
- [ ] **Step 3: Реализация**
```ts
import { Cell, cellKey, HintType, PlayState } from './types';
function revealAnswer(state: PlayState, idx: number): { state: PlayState; revealed: Cell[] } {
  const ans = state.level.answers.filter((a) => !state.solvedWords.includes(a.word)).sort((x,y)=>x.word.length-y.word.length)[idx];
  if (!ans) return { state, revealed: [] };
  const filled = { ...state.filled }; for (const c of ans.cells) filled[cellKey(c)] = c.ch;
  return { state: { ...state, filled, solvedWords: [...state.solvedWords, ans.word] }, revealed: ans.cells };
}
export function applyHint(state: PlayState, hint: HintType, target?: Cell): { state: PlayState; revealed: Cell[] } {
  const isFilled = (c: Cell) => state.filled[cellKey(c)] === c.ch;
  if (hint === 'revealWord') return revealAnswer(state, 0);
  if (hint === 'hammer') return revealAnswer(state, 0); // открыть самое короткое неотгаданное слово
  const cell = (target && !isFilled(target)) ? target : state.level.grid.cells.find((c) => !isFilled(c));
  if (!cell) return { state, revealed: [] };
  return { state: { ...state, filled: { ...state.filled, [cellKey(cell)]: cell.ch } }, revealed: [cell] };
}
```
- [ ] **Step 4: Запуск — PASS** — `npx jest hints`.
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): applyHint (bulb/hammer/revealWord)"`

### Task 1.7: `validateLevel` + barrel `index.ts`

**Files:** Create `src/core/engine/validate.ts`, `__tests__/validate.test.ts`, `src/core/engine/index.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { Level } from '../types';
import { validateLevel } from '../validate';
const good: Level = { id:1, world:'w', letters:['к','о','т'], difficulty:1,
  grid:{rows:1,cols:3,cells:[{row:0,col:0,ch:'к'},{row:0,col:1,ch:'о'},{row:0,col:2,ch:'т'}]},
  answers:[{word:'кот',dir:'H',cells:[{row:0,col:0,ch:'к'},{row:0,col:1,ch:'о'},{row:0,col:2,ch:'т'}]}], bonusPool:['ток'] };
test('валидный уровень', () => { expect(validateLevel(good).ok).toBe(true); });
test('висячая клетка → ошибка', () => {
  const bad = { ...good, grid: { rows:1, cols:4, cells:[...good.grid.cells, {row:0,col:3,ch:'м'}] } } as Level;
  expect(validateLevel(bad).ok).toBe(false);
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest validate`.
- [ ] **Step 3: Реализация**
```ts
import { canBuildFromLetters } from './letters';
import { cellKey, Level } from './types';
export function validateLevel(level: Level): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const a of level.answers) {
    if (!canBuildFromLetters(a.word, level.letters)) errors.push(`not_buildable:${a.word}`);
    if (a.cells.length !== a.word.length) errors.push(`len_mismatch:${a.word}`);
    a.cells.forEach((c, i) => { if (c.ch !== a.word[i]) errors.push(`char_mismatch:${a.word}@${i}`); });
  }
  const covered = new Set<string>();
  for (const a of level.answers) for (const c of a.cells) covered.add(cellKey(c));
  for (const c of level.grid.cells) if (!covered.has(cellKey(c))) errors.push(`dangling:${cellKey(c)}`);
  const answerSet = new Set(level.answers.map((a) => a.word));
  for (const b of level.bonusPool) if (answerSet.has(b)) errors.push(`bonus_in_answers:${b}`);
  return errors.length ? { ok: false, errors } : { ok: true };
}
```
`index.ts`: реэкспорт всего public API движка (`types`, `normalize`, `letters`, `rng`, `play`, `hints`, `validate`).
- [ ] **Step 4: Запуск — PASS** — `npx jest validate`.
- [ ] **Step 5: Commit** — `git commit -am "feat(engine): validateLevel + barrel index"`

---

## M1 — Контент: словарь и генератор

### Task 1.8: Словарь (build-скрипт + сабсет)

**Files:** Create `scripts/build-dictionary.js`, `assets/dict/ru.json`, `scripts/__tests__/dictionary.test.js`

- [ ] **Step 1: Тест фильтра (падающий)**
```js
const { filterWords } = require('../build-dictionary');
test('фильтрует длину и стоп-лист, нормализует ё', () => {
  const out = filterWords(['Кот','ёж','а','оченьдлинноеслово','мат1'], { min:3, max:8, stop:['мат1'] });
  expect(out).toContain('кот'); expect(out).toContain('еж');   // ё→е, длина 2? «еж» = 2 буквы → должно отсеяться
});
```
> Скорректировать ассерты под правило длины (мин. 3): «еж» отсеивается; добавить слово длиной ≥3 для позитивной проверки нормализации (`'Ёлка'→'елка'`).

- [ ] **Step 2: Запуск — FAIL** — `node --test scripts/__tests__/dictionary.test.js` (или jest, если настроен на js).
- [ ] **Step 3: Реализация** — `build-dictionary.js`:
```js
function normalize(w){ return w.toLowerCase().replace(/ё/g,'е').replace(/[^а-я]/g,''); }
function filterWords(words, { min=3, max=8, stop=[] }={}){
  const stopSet = new Set(stop.map(normalize));
  const out = new Set();
  for (const raw of words){ const w = normalize(raw); if (w.length>=min && w.length<=max && !stopSet.has(w)) out.add(w); }
  return [...out].sort();
}
module.exports = { normalize, filterWords };
```
- [ ] **Step 4: Сгенерировать сабсет** — Положить вручную небольшой валидный список в `assets/dict/ru.json` (≥300 нарицательных слов длиной 3–8 для мира 1; полный корпус — отдельная контент-задача [15]). Прогнать через `filterWords` и сохранить.
- [ ] **Step 5: Запуск — PASS** — тест зелёный.
- [ ] **Step 6: Commit** — `git commit -am "feat(content): пайплайн словаря + ru-сабсет"`

### Task 1.9: Генератор уровней + пак мира 1

**Files:** Create `scripts/gen-levels.js`, `assets/levels/world1.json`, `scripts/__tests__/gen-levels.test.js`

- [ ] **Step 1: Тест (падающий)**
```js
const { generateLevel } = require('../gen-levels');
const { validateLevel } = require('../../src/core/engine/validate'); // через ts-node/собранный, см. шаг 4
test('детерминизм по seed', () => {
  const dict = ['кот','ток','кто','рот','тор','крот'];
  expect(generateLevel({ seed:7, dict, letters:['к','р','о','т'] }))
    .toEqual(generateLevel({ seed:7, dict, letters:['к','р','о','т'] }));
});
```
- [ ] **Step 2: Запуск — FAIL** — `node --test scripts/__tests__/gen-levels.test.js`.
- [ ] **Step 3: Реализация (жадная укладка кроссворда)** — `gen-levels.js`:
```js
const { normalize } = require('./build-dictionary');
// mulberry32 (копия из движка для детерминизма скрипта)
function rng(seed){ let a=seed>>>0; return ()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}; }
function canBuild(word, letters){ const p=new Map(); for(const l of letters)p.set(l,(p.get(l)||0)+1); for(const ch of word){const n=p.get(ch)||0; if(!n)return false; p.set(ch,n-1);} return true; }

function generateLevel({ seed, dict, letters }){
  const L = letters.map(normalize);
  const words = [...new Set(dict.map(normalize))].filter(w=>w.length>=3 && canBuild(w,L)).sort((a,b)=>b.length-a.length||a.localeCompare(b));
  const r = rng(seed);
  // 1) самое длинное слово горизонтально в строке 0
  const placed = [];          // {word,dir,cells:[{row,col,ch}]}
  const occupied = new Map();  // "r,c" -> ch
  const place = (word, dir, row, col) => {
    const cells=[]; for(let i=0;i<word.length;i++){ const rr=dir==='H'?row:row+i, cc=dir==='H'?col+i:col; const k=`${rr},${cc}`; const ex=occupied.get(k); if(ex && ex!==word[i]) return null; cells.push({row:rr,col:cc,ch:word[i]}); }
    return cells;
  };
  const commit = (word,dir,cells)=>{ for(const c of cells) occupied.set(`${c.row},${c.col}`,c.ch); placed.push({word,dir,cells}); };
  if(!words.length) return null;
  const first=words[0]; commit(first,'H',place(first,'H',0,0));
  // 2) пытаться скрестить остальные вертикально через общую букву
  for(const w of words.slice(1)){
    if(placed.some(p=>p.word===w)) continue;
    let done=false;
    for(const p of placed){ if(done)break;
      for(let i=0;i<p.cells.length && !done;i++){ const anchor=p.cells[i];
        for(let j=0;j<w.length && !done;j++){ if(w[j]!==anchor.ch) continue;
          const dir = p.dir==='H' ? 'V':'H';
          const row = dir==='V' ? anchor.row - j : anchor.row;
          const col = dir==='V' ? anchor.col : anchor.col - j;
          if(row<0||col<0) continue;
          const cells=place(w,dir,row,col);
          if(cells){ commit(w,dir,cells); done=true; }
        }
      }
    }
    if(placed.length>=6) break; // ограничить размер уровня
  }
  // 3) нормализовать координаты в неотрицательные и собрать Level
  const minR=Math.min(...placed.flatMap(p=>p.cells.map(c=>c.row)));
  const minC=Math.min(...placed.flatMap(p=>p.cells.map(c=>c.col)));
  const norm=cells=>cells.map(c=>({row:c.row-minR,col:c.col-minC,ch:c.ch}));
  const answers=placed.map(p=>({word:p.word,dir:p.dir,cells:norm(p.cells)}));
  const cellMap=new Map(); for(const a of answers) for(const c of a.cells) cellMap.set(`${c.row},${c.col}`,c);
  const cells=[...cellMap.values()];
  const rows=Math.max(...cells.map(c=>c.row))+1, cols=Math.max(...cells.map(c=>c.col))+1;
  const answerSet=new Set(answers.map(a=>a.word));
  const bonusPool=words.filter(w=>!answerSet.has(w));
  return { id:seed, world:'world1', letters:L, grid:{rows,cols,cells}, answers, bonusPool, difficulty:1 };
}
module.exports = { generateLevel };
```
- [ ] **Step 4: Тест на инварианты движком** — В тесте импортировать `validateLevel` (собрать движок в js через `tsc` отдельным конфигом, как `backend:build` в blockblast, либо продублировать минимальную проверку). Добавить:
```js
test('сгенерированный уровень валиден', () => {
  const dict=['кот','ток','кто','рот','тор','крот'];
  const lvl=generateLevel({seed:7,dict,letters:['к','р','о','т']});
  expect(lvl.answers.length).toBeGreaterThan(0);
  // каждый answer собирается из letters и совпадает с клетками
  for(const a of lvl.answers){ expect(a.cells.map(c=>c.ch).join('')).toBe(a.word); }
});
```
- [ ] **Step 5: Сгенерировать пак** — Скрипт-обёртка генерит N уровней (seed=1..N) из `assets/dict/ru.json`, валидирует каждый, отбрасывает невалидные, пишет в `assets/levels/world1.json`. Run: `node scripts/gen-levels.js --world world1 --count 30`.
- [ ] **Step 6: Запуск — PASS** — оба теста зелёные.
- [ ] **Step 7: Commit** — `git commit -am "feat(content): генератор уровней + пак world1"`

---

## M1 — Стор уровней и игровой UI

### Task 1.10: `features/levels` (прогресс + лоадер)

**Files:** Create `src/features/levels/{store.ts,loader.ts,index.ts}`, `__tests__/store.test.ts`

- [ ] **Step 1: Тест стора (падающий)**
```ts
import { useLevels } from '../store';
test('completeLevel инкрементит прогресс и не дублит', () => {
  const s = useLevels.getState();
  s.reset();
  s.completeLevel(1); s.completeLevel(1);
  expect(useLevels.getState().completed).toEqual([1]);
  expect(useLevels.getState().currentLevel).toBe(2);
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest features/levels`.
- [ ] **Step 3: Реализация** — `store.ts` (zustand + персист MMKV через `core/storage`):
```ts
import { create } from 'zustand';
import { getJSON, setJSON, StorageKeys } from '../../core/storage';
type S = { currentLevel:number; completed:number[]; completeLevel:(id:number)=>void; reset:()=>void };
const init = getJSON(StorageKeys.levelsProgress, { currentLevel:1, completed:[] as number[] });
export const useLevels = create<S>((set,get)=>({
  ...init,
  completeLevel:(id)=>{ const c=get().completed; if(c.includes(id))return; const completed=[...c,id]; const currentLevel=Math.max(get().currentLevel, id+1); set({completed,currentLevel}); setJSON(StorageKeys.levelsProgress,{currentLevel,completed}); },
  reset:()=>{ set({currentLevel:1,completed:[]}); setJSON(StorageKeys.levelsProgress,{currentLevel:1,completed:[]}); },
}));
```
`loader.ts`: `loadLevel(world,id): Level` — читает пак `assets/levels/<world>.json` (через `require`/expo-asset), возвращает уровень по индексу; fallback-ошибка «мир скоро». `index.ts` — public API (`useLevels`, `loadLevel`).
- [ ] **Step 4: Запуск — PASS** — `npx jest features/levels`.
- [ ] **Step 5: Commit** — `git commit -am "feat(levels): прогресс-стор + лоадер пака"`

### Task 1.11: `features/game/store.ts` (zustand поверх движка)

**Files:** Create `src/features/game/store.ts`, `__tests__/store.test.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { useGame } from '../store';
import { Level } from '../../../core/engine/types';
const level: Level = { id:1, world:'w', letters:['к','о','т'], difficulty:1,
  grid:{rows:1,cols:3,cells:[{row:0,col:0,ch:'к'},{row:0,col:1,ch:'о'},{row:0,col:2,ch:'т'}]},
  answers:[{word:'кот',dir:'H',cells:[{row:0,col:0,ch:'к'},{row:0,col:1,ch:'о'},{row:0,col:2,ch:'т'}]}], bonusPool:['ток'] };
test('submit grid-слова отдаёт событие и при завершении добавляет clear-бонус', () => {
  useGame.getState().start(level);
  const r = useGame.getState().submit('кот');
  expect(r.kind).toBe('grid');
  // 5 за слово + 20 clear-бонус
  expect(useGame.getState().coins).toBe(25);
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest features/game/__tests__/store`.
- [ ] **Step 3: Реализация**
```ts
import { create } from 'zustand';
import { GAME } from '../../core/config/game';
import { initPlayState, Level, PlayState, SubmitResult } from '../../core/engine/types';
import { submitWord, shuffle } from '../../core/engine/play';
import { applyHint } from '../../core/engine/hints';
import { mulberry32 } from '../../core/engine/rng';
import { HintType } from '../../core/engine/types';
type S = { play: PlayState | null; coins:number; disk:string[];
  start:(l:Level)=>void; submit:(w:string)=>SubmitResult; doShuffle:()=>void; hint:(h:HintType)=>void };
export const useGame = create<S>((set,get)=>({
  play:null, coins:0, disk:[],
  start:(l)=>set({ play:initPlayState(l), coins:0, disk:[...l.letters] }),
  submit:(w)=>{ const st=get().play!; const { state, result }=submitWord(st,w);
    let coins=get().coins + (('deltaCoins' in result)?result.deltaCoins:0);
    if(result.kind==='grid' && result.levelComplete) coins += GAME.levelClearBonus;
    set({ play:state, coins }); return result; },
  doShuffle:()=>set({ disk: shuffle(get().disk, mulberry32(Date.now()>>>0)) }),
  hint:(h)=>{ const { state }=applyHint(get().play!, h); set({ play:state }); },
}));
```
- [ ] **Step 4: Запуск — PASS** — `npx jest features/game/__tests__/store`.
- [ ] **Step 5: Commit** — `git commit -am "feat(game): стор поверх движка + clear-бонус"`

### Task 1.12: `geometry.ts` (тестируемая логика диска)

**Files:** Create `src/features/game/geometry.ts`, `__tests__/geometry.test.ts`

- [ ] **Step 1: Тест (падающий)**
```ts
import { tilePositions, hitTile } from '../geometry';
test('tilePositions раскладывает N плиток по окружности', () => {
  const p = tilePositions(3, 100, 50);
  expect(p).toHaveLength(3);
});
test('hitTile находит плитку под точкой', () => {
  const p = tilePositions(3, 100, 50);
  expect(hitTile(p, p[0].x, p[0].y, 24)).toBe(0);
  expect(hitTile(p, 9999, 9999, 24)).toBe(-1);
});
```
- [ ] **Step 2: Запуск — FAIL** — `npx jest geometry`.
- [ ] **Step 3: Реализация**
```ts
export type TilePos = { x:number; y:number };
export function tilePositions(n:number, radius:number, center:number): TilePos[] {
  return Array.from({length:n}, (_,i)=>{ const ang = -Math.PI/2 + (2*Math.PI*i)/n; return { x:center+radius*Math.cos(ang), y:center+radius*Math.sin(ang) }; });
}
export function hitTile(pos:TilePos[], x:number, y:number, r:number): number {
  for(let i=0;i<pos.length;i++){ const dx=pos[i].x-x, dy=pos[i].y-y; if(dx*dx+dy*dy<=r*r) return i; }
  return -1;
}
```
- [ ] **Step 4: Запуск — PASS** — `npx jest geometry`.
- [ ] **Step 5: Commit** — `git commit -am "feat(game): geometry диска (testable)"`

### Task 1.13: `LetterDisk` (SVG + gesture worklet)

**Files:** Create `src/features/game/LetterDisk.tsx`

- [ ] **Step 1: Реализация** — `react-native-svg` рисует плитки по `tilePositions`; `Gesture.Pan()` (gesture-handler) на UI-потоке через worklet ведёт палец, по `hitTile` собирает индексы в `useSharedValue` массив, рисует линию связи; на `onEnd` (`runOnJS`) формирует слово из выбранных индексов и вызывает `useGame.submit`. В drag-пути — только shared values, без setState (см. [13](../specs/13-performance.md)).
```tsx
// эскиз контракта компонента
export function LetterDisk({ letters, onWord }: { letters: string[]; onWord: (w: string) => void }) { /* svg + Gesture.Pan */ }
```
- [ ] **Step 2: Ручная проверка** — Run: `npx expo start`; на `/game` свайп по буквам рисует линию, отпускание шлёт слово (лог в консоль).
- [ ] **Step 3: Commit** — `git commit -am "feat(game): LetterDisk свайп-ввод"`

### Task 1.14: `CrosswordGrid` + экран `/game`

**Files:** Create `src/features/game/CrosswordGrid.tsx`, modify `src/app/game.tsx`

- [ ] **Step 1: `CrosswordGrid`** — рисует `level.grid` (пустые клетки), показывает буквы из `play.filled`; появление буквы — Reanimated scale/opacity; подсветка `revealed` из подсказки.
- [ ] **Step 2: Экран `/game`** — композиция: `loadLevel(world, currentLevel)` → `useGame.start(level)`; рендер `CrosswordGrid` + `LetterDisk` + кнопки Shuffle/Hints + `BonusWordTray` (счётчик). Проигрывание событий `submit` → анимация/хаптика (`expo-haptics`)/звук (`expo-audio`): grid=success, bonus=light+coin, invalid=warning+shake.
- [ ] **Step 3: Ручная проверка** — пройти сгенерированный уровень целиком; буквы встают в сетку; бонус-слово даёт «+2»; невалид — тряска.
- [ ] **Step 4: Commit** — `git commit -am "feat(game): CrosswordGrid + экран уровня с проигрыванием событий"`

### Task 1.15: LevelComplete-оверлей + переход

**Files:** Create `src/features/game/LevelComplete.tsx`, modify `src/app/game.tsx`, `src/features/game/index.ts`

- [ ] **Step 1: Оверлей** — при `levelComplete`: анимация заполнения, показ `coins`, кнопки «Далее» (→ `useLevels.completeLevel(id)` и загрузка следующего) и «Удвоить» (заглушка под rewarded из [05] — в M1 просто скрыта/неактивна за флагом). `index.ts` — public API фичи (`useGame`, `LetterDisk`, `CrosswordGrid`, `LevelComplete`).
- [ ] **Step 2: Ручная проверка** — завершение уровня показывает оверлей; «Далее» грузит следующий уровень; прогресс сохраняется (перезапуск приложения — продолжается с текущего).
- [ ] **Step 3: Финальный прогон** — Run: `npx jest` и `npx tsc --noEmit` → оба зелёные.
- [ ] **Step 4: Commit** — `git commit -am "feat(game): LevelComplete + переход между уровнями"`

---

## Self-Review (выполнено автором плана)

- **Покрытие спеки M1:** движок (03) — T1.1–1.7; словарь (15) — T1.8; генератор (03) — T1.9; уровни/прогрессия (07) — T1.10; игровой UI/события (02/04) — T1.11–1.15. ✓
- **Имена согласованы:** `submitWord`,`isLevelComplete`,`shuffle`,`applyHint`,`validateLevel`,`canBuildFromLetters`,`normalizeWord`,`cellKey`,`initPlayState`,`useLevels`,`useGame`,`tilePositions`,`hitTile` — единообразны во всех задачах. ✓
- **Плейсхолдеры:** UI-задачи (1.13–1.15) дают контракт компонента + ручную проверку (RN-компоненты не юнит-тестируем; вся тестируемая логика вынесена в `geometry.ts`/сторы/движок). ✓
- **levelClearBonus:** определён в `GAME` (T0.2), применяется в сторе (T1.11), движок отдаёт только пословные монеты — без двойного учёта. ✓

## Открытые зависимости для следующих планов
- Полный русский корпус словаря (сейчас сабсет) → контент-задача в рамках [15].
- rewarded «Удвоить» в LevelComplete — подключается в M2 ([05]).
- Серверная ревалидация прохождений — M4 ([11]).
