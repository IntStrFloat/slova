const REPLACEMENT = /\uFFFD/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function fallbackSuffix(seed?: string): string {
  const digits = (seed ?? '').replace(/\D/g, '').slice(-4);
  return digits.padStart(4, '0') || '0000';
}

export function safeNickname(nickname: string | null | undefined, tag?: string): string {
  const trimmed = (nickname ?? '').trim();
  if (!trimmed || REPLACEMENT.test(trimmed) || CONTROL.test(trimmed)) {
    return `Игрок ${fallbackSuffix(tag ?? trimmed)}`;
  }
  return trimmed;
}

export function safeDisplayName(
  value: string | null | undefined,
  fallbackPrefix: string,
  seed?: string,
): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || REPLACEMENT.test(trimmed) || CONTROL.test(trimmed)) {
    return `${fallbackPrefix} ${fallbackSuffix(seed ?? trimmed)}`;
  }
  return trimmed;
}

export function safeTaggedName(nickname: string | null | undefined, tag?: string): string {
  const safe = safeNickname(nickname, tag);
  return tag ? `${safe}#${tag}` : safe;
}
