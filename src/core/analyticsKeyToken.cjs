/** Stable 128-bit lookup token, not a cryptographic digest or an identity anonymizer.
 * @param {string} value
 * @returns {string}
 */
function analyticsKeyToken(value) {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds.map((seed) => {
    let hash = seed;
    for (let i = 0; i < value.length; i += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
      hash ^= hash >>> 13;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}

/** Object keys use locale-independent UTF-16 order; array order and JSON values are preserved.
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalPlan(value) {
  if (Array.isArray(value)) return value.map(canonicalPlan);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalPlan(item)]));
  return value;
}

/** Full-plan lookup token; the offline SHA-256 config/input audit remains a separate proof.
 * @param {unknown} config
 * @returns {string}
 */
function helpExperimentPlanFingerprint(config) {
  const json = JSON.stringify(canonicalPlan(config));
  if (json === undefined) throw new Error('Plan must have a JSON representation');
  return analyticsKeyToken(json);
}

module.exports = { analyticsKeyToken, helpExperimentPlanFingerprint };
