import { storage } from '@/core/storage';
import { analyticsKeyToken, readAnalyticsOnce, writeAnalyticsOnce } from '../dedupe';

test('released lookup-token goldens and bucket stay byte-identical across the pure extraction', () => {
  storage.clearAll();
  const inputs = ['', 'event:repeat', 'sdk:18446744073709551615', 'slova_wheel_help_clarity_20261104:1:18446744073709551615', 'Слова:ёж🧩'];
  expect(Object.fromEntries(inputs.map((input) => [input, analyticsKeyToken(input)]))).toMatchInlineSnapshot(`
{
  "": "811c9dc59e3779b985ebca6bc2b2ae35",
  "event:repeat": "fc852afd0bab826d10b205eff9e35f1b",
  "sdk:18446744073709551615": "1a7196e9f1c6245e0b7e201ff8b9a671",
  "slova_wheel_help_clarity_20261104:1:18446744073709551615": "9cff2ab0d843df362a60ecc325476c0a",
  "Слова:ёж🧩": "5a447df8ec312ede7d70adc4c87ebc2a",
}
`);
  expect(writeAnalyticsOnce('event:repeat', 'e_original')).toBe(true);
  expect(storage.getAllKeys()).toMatchInlineSnapshot(`
[
  "analytics.once.v3.3c",
]
`);
  expect(readAnalyticsOnce('event:repeat')).toBe('e_original');
  expect(writeAnalyticsOnce('event:repeat', 'e_replacement')).toBe(false);
  expect(readAnalyticsOnce('event:repeat')).toBe('e_original');
});
