import { cellKey, type Level } from '@/core/engine';
import type { SubmitResult } from '@/core/engine/types';

export type FeedbackKind = SubmitResult['kind'] | 'save_error';

export const MIN_SELECTION_TO_SUBMIT = 3;
export const FEEDBACK_VISIBLE_MS = 2400;

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function feedbackCaption(kind: FeedbackKind): string {
  switch (kind) {
    case 'grid':
      return 'Слово в сетке';
    case 'bonus':
      return 'Бонусное слово';
    case 'constraint':
      return 'Сначала короткое слово';
    case 'duplicate':
      return 'Уже было';
    case 'invalid':
      return 'Не подходит';
    case 'blocked':
      return 'Слово недоступно';
    case 'save_error':
      return 'Не удалось сохранить';
  }
}

export function feedbackAnnouncement(
  word: string,
  kind: FeedbackKind,
  details?: { expectedLength?: number },
): string {
  const visibleWord = word.toUpperCase();
  switch (kind) {
    case 'grid':
      return `Слово ${visibleWord} добавлено в сетку.`;
    case 'bonus':
      return `Слово ${visibleWord} засчитано как бонусное.`;
    case 'constraint':
      return details?.expectedLength
        ? `Сначала нужно слово из ${details.expectedLength} букв.`
        : 'Сначала нужно более короткое слово.';
    case 'duplicate':
      return `Слово ${visibleWord} уже было найдено.`;
    case 'invalid':
      return `Слово ${visibleWord} не подходит.`;
    case 'blocked':
      return `Слово ${visibleWord} недоступно для этой игры.`;
    case 'save_error':
      return `Слово ${visibleWord} пока не сохранено. Попробуйте ещё раз.`;
  }
}

export function constraintCaption(expectedLength?: number): string {
  return expectedLength ? `Сначала слово из ${expectedLength} букв` : 'Сначала короткое слово';
}

export function selectionSummary(word: string, selectedCount: number, totalLetters: number): string {
  if (selectedCount === 0) {
    return `Букв на диске: ${totalLetters}. Выбор пуст.`;
  }
  return `Выбрано ${selectedCount} ${pluralizeRu(selectedCount, 'буква', 'буквы', 'букв')}. Текущее слово: ${word.toUpperCase()}.`;
}

export function gridAccessibilitySummary(level: Level, filled: Record<string, string>): string {
  const totalCells = level.grid.cells.length;
  const solvedCells = level.grid.cells.filter((cell) => filled[cellKey(cell)] === cell.ch).length;
  const totalWords = level.answers.length;
  const solvedWords = level.answers.filter((answer) =>
    answer.cells.every((cell) => filled[cellKey(cell)] === cell.ch),
  ).length;

  return `Кроссворд: заполнено ${solvedCells} из ${totalCells} ${pluralizeRu(totalCells, 'клетки', 'клеток', 'клеток')}. Собрано ${solvedWords} из ${totalWords} ${pluralizeRu(totalWords, 'слова', 'слов', 'слов')}.`;
}

export function letterAccessibilityLabel(letter: string, index: number, totalLetters: number): string {
  return `Буква ${letter.toUpperCase()}, позиция ${index + 1} из ${totalLetters}.`;
}

export function letterAccessibilityHint(selected: boolean): string {
  return selected
    ? 'Эта буква уже выбрана. Подтвердите слово или очистите выбор.'
    : 'Дважды нажмите, чтобы добавить букву в слово.';
}
