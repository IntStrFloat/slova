import { getJSON, getString, removeKey, setJSON, storage } from '@/core/storage';
import { analyticsKeyToken } from '@/core/analyticsKeyToken.cjs';
export { analyticsKeyToken } from '@/core/analyticsKeyToken.cjs';

const PREFIX = 'analytics.once.v3.';
type Entry = { key: string; eventId: string };
type Bucket = { version: 1; entries: Entry[] };

function bucketKey(key: string): string {
  return PREFIX + (parseInt(analyticsKeyToken(key).slice(0, 2), 16) % 64).toString(16).padStart(2, '0');
}
function readBucket(key: string): Bucket {
  const value = getJSON<Partial<Bucket>>(bucketKey(key), {});
  return {
    version: 1,
    entries: Array.isArray(value.entries) ? value.entries.filter((entry) =>
      typeof entry?.key === 'string' && typeof entry?.eventId === 'string') : [],
  };
}
export function readAnalyticsOnce(key: string): string | null {
  return readBucket(key).entries.find((entry) => entry.key === key)?.eventId ?? null;
}
export function writeAnalyticsOnce(key: string, eventId: string): boolean {
  const bucket = readBucket(key);
  const existing = bucket.entries.find((entry) => entry.key === key);
  if (existing) return existing.eventId === eventId;
  bucket.entries.push({ key, eventId });
  const encoded = JSON.stringify(bucket);
  setJSON(bucketKey(key), bucket);
  return getString(bucketKey(key)) === encoded;
}
export function removeAnalyticsOnce(key: string): void {
  const bucket = readBucket(key);
  const next = bucket.entries.filter((entry) => entry.key !== key);
  if (next.length === bucket.entries.length) return;
  setJSON(bucketKey(key), { version: 1, entries: next });
}
export function clearAnalyticsOnce(): void {
  try {
    for (const key of storage.getAllKeys()) if (key.startsWith(PREFIX)) removeKey(key);
  } catch {
    // An unavailable store must not turn an opt-out into a crash. New collection remains disabled.
  }
}

