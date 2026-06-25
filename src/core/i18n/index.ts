import { en } from './en';
import { ru, type I18nKey } from './ru';

const dict = { ru, en } as const;
type Lang = keyof typeof dict;

let lang: Lang = 'ru';

export function setLang(l: Lang): void {
  lang = l;
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  let s: string = dict[lang][key] ?? ru[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.replace(`{${k}}`, String(params[k]));
  }
  return s;
}

export type { I18nKey };
