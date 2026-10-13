// FR-WEBCRON-012: 화면 언어 상태. 바꾸면 t()를 쓰는 모든 문구가 즉시 다시 그려진다.
import { messages, type Locale, type MessageKey } from './messages.ts';

export type { Locale, MessageKey };

const STORAGE_KEY = 'webcron.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch { /* 저장소를 쓸 수 없는 환경 */ }
  return (navigator.language ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export const i18n = $state({ locale: initialLocale() });
document.documentElement.lang = i18n.locale;

export function setLocale(locale: Locale): void {
  i18n.locale = locale;
  document.documentElement.lang = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* 저장하지 못해도 화면은 바뀐다 */ }
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = messages[i18n.locale][key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}

/** 'event.job.create' 처럼 동적으로 만든 키. 사전에 없으면 원래 값을 돌려준다. */
export function tDynamic(key: string, fallback: string): string {
  return (messages[i18n.locale] as Record<string, string>)[key] ?? fallback;
}
