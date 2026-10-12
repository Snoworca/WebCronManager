// FR-WEBCRON-002: 5/6필드 크론 표현식과 타임존
import { Cron, type CronOptions } from 'croner';

export const CRON_MODE: CronOptions['mode'] = '5-or-6-parts';

/** 표현식이 올바르면 null, 아니면 오류 메시지를 돌려준다. */
export function cronError(expr: string): string | null {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) return '크론 표현식은 5필드(분 단위) 또는 6필드(초 단위)여야 합니다.';
  try {
    new Cron(expr.trim(), { paused: true, mode: CRON_MODE });
    return null;
  } catch (e) {
    return `크론 표현식이 올바르지 않습니다: ${(e as Error).message}`;
  }
}

export function nextRuns(expr: string, timezone: string, n: number, from?: Date): Date[] {
  const c = new Cron(expr.trim(), { paused: true, mode: CRON_MODE, timezone });
  return c.nextRuns(n, from);
}
