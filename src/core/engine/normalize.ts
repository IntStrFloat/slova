import type { InvalidReason } from './types';

/** Нормализация словаря: NFC, lower-case и продуктовое ё→е. */
export function normalizeWord(raw: string): string {
  return raw.normalize('NFC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/**
 * Проверка пользовательского token. Ничего не вырезает: «к-о.т» не должно
 * становиться словом «кот» из-за повреждённого ввода.
 */
export function normalizeSubmission(raw: string):
  | { ok: true; word: string }
  | { ok: false; word: string; reason: InvalidReason } {
  if (raw.length === 0) return { ok: false, word: '', reason: 'empty' };
  const word = normalizeWord(raw);
  if (!/^[а-я]+$/.test(word)) return { ok: false, word, reason: 'malformed' };
  if (word.length < 3) return { ok: false, word, reason: 'too_short' };
  if (word.length > 8) return { ok: false, word, reason: 'too_long' };
  return { ok: true, word };
}
