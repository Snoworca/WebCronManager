import { t, tDynamic, type MessageKey } from './i18n.svelte.ts';
import { session } from './state.svelte.ts';
import type { AuditEntry, Run, RunStatus } from './types.ts';

/** 감사 로그 이벤트 목록 (필터 순서) */
export const EVENTS = [
  'login.success', 'login.failure', 'login.locked', 'logout',
  'job.create', 'job.update', 'job.delete', 'job.enable', 'job.disable', 'job.run_manual', 'run.cancel',
  'mcp_key.create', 'mcp_key.revoke', 'config.password_encrypted', 'server.start', 'server.stop',
];

export const statusLabel = (s: RunStatus | 'none'): string => t(`status.${s}` as MessageKey);
export const eventLabel = (ev: string): string => tDynamic(`event.${ev}`, ev);
export const typeLabel = (type: 'cli' | 'webhook'): string => t(`type.${type}` as MessageKey);
export const triggerLabel = (trigger: 'manual' | 'schedule'): string => t(`trigger.${trigger}` as MessageKey);

function parts(v: number | string): Record<string, string> {
  const d = new Date(v);
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: session.me?.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

/** 서버 타임존 기준 MM-DD HH:mm:ss */
export function shortTime(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const p = parts(v);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 서버 타임존 기준 YYYY-MM-DD HH:mm:ss */
export function fullTime(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const p = parts(v);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function duration(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 1000) return t('dur.ms', { n: Math.round(ms) });
  if (ms < 10_000) return t('dur.secFraction', { n: (ms / 1000).toFixed(1) });
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return t('dur.hour', { h, m });
  if (m) return t('dur.min', { m, s: String(sec).padStart(2, '0') });
  return t('dur.sec', { s: sec });
}

export function runDuration(r: Run, now = Date.now()): string {
  return r.finishedAt ? duration(r.finishedAt - r.startedAt) : t('dur.elapsed', { d: duration(now - r.startedAt) });
}

export function runCode(r: Run): string {
  if (r.status === 'running') return '—';
  if (r.jobType === 'cli') return r.exitCode === null ? '—' : `exit ${r.exitCode}`;
  return r.httpStatus ? `HTTP ${r.httpStatus}` : '—';
}

/** 목록에 보여줄 마지막 결과 라벨 */
export function resultLabel(r: Run): string {
  const base = statusLabel(r.status);
  const code = runCode(r);
  if (r.status === 'failure' && code !== '—') return `${base} · ${code}`;
  return base;
}

export function auditSummary(a: AuditEntry): string {
  const d = (a.detail ?? {}) as Record<string, unknown>;
  switch (a.event) {
    case 'job.update': return t('summary.fieldsChanged', { n: (d.changes as unknown[] | undefined)?.length ?? 0 });
    case 'login.failure': return t('summary.failures', { n: String(d.failures ?? '?') });
    case 'login.locked': return t('summary.locked', { min: String(d.lockMinutes ?? 5) });
    case 'job.run_manual':
    case 'run.cancel': return t('summary.run', { id: String(d.runId) });
    case 'server.start':
      return t('summary.serverStart', { version: String(d.version), jobs: String(d.jobs), tz: String(d.timezone) })
        + (d.interruptedRuns ? t('summary.interruptedClosed', { n: String(d.interruptedRuns) }) : '');
    case 'server.stop': return String(d.reason ?? '');
    case 'config.password_encrypted': return t('summary.passwordEncrypted');
    case 'job.create':
    case 'job.delete': {
      const j = (d.job ?? {}) as Record<string, string>;
      const via = d.via === 'mcp' ? ` · MCP(${d.mcpKey})` : '';
      return `${j.type === 'webhook' ? typeLabel('webhook') : typeLabel('cli')} · ${j.cron ?? ''}${via}`;
    }
    case 'mcp_key.create':
    case 'mcp_key.revoke': return `${d.name} (${d.prefix}…)`;
    default: return '';
  }
}

/** <input type="date"> 값(브라우저 로컬 날짜)을 epoch ms로 */
export function dateStart(v: string): number | undefined {
  return v ? new Date(`${v}T00:00:00`).getTime() : undefined;
}
export function dateEndExclusive(v: string): number | undefined {
  return v ? new Date(`${v}T00:00:00`).getTime() + 86_400_000 : undefined;
}
