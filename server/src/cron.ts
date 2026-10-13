// FR-WEBCRON-002: 5/6필드 크론 표현식과 타임존
import { Cron, type CronOptions } from 'croner';
import { t, type Locale } from './i18n.ts';

export const CRON_MODE: CronOptions['mode'] = '5-or-6-parts';

/** 표현식이 올바르면 null, 아니면 오류 메시지를 돌려준다. */
export function cronError(expr: string, locale: Locale = 'en'): string | null {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) return t(locale, 'cron.fields');
  try {
    new Cron(expr.trim(), { paused: true, mode: CRON_MODE });
    return null;
  } catch (e) {
    return t(locale, 'cron.invalid', { detail: (e as Error).message });
  }
}

export function nextRuns(expr: string, timezone: string, n: number, from?: Date): Date[] {
  const c = new Cron(expr.trim(), { paused: true, mode: CRON_MODE, timezone });
  return c.nextRuns(n, from);
}
