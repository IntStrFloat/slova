/** Нормализация слова: нижний регистр, ё→е, только кириллица (спека 15). */
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/ё/g, 'е').replace(/[^а-я]/g, '');
}
