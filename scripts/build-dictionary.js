/**
 * Пайплайн словаря (спека 15): нормализация + фильтры длины/стоп-листа.
 * Используется генератором уровней и (в будущем) бэкендом. В рантайм игры не грузится.
 */
function normalize(w) {
  return String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^а-я]/g, '');
}

function filterWords(words, { min = 3, max = 8, stop = [] } = {}) {
  const stopSet = new Set(stop.map(normalize));
  const out = new Set();
  for (const raw of words) {
    const w = normalize(raw);
    if (w.length >= min && w.length <= max && !stopSet.has(w)) out.add(w);
  }
  return [...out].sort();
}

module.exports = { normalize, filterWords };
