import { session } from './state.svelte.ts';
import type { AuditEntry, Run, RunStatus } from './types.ts';

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: '실행 중', success: '성공', failure: '실패', timeout: '시간 초과', canceled: '중지됨', interrupted: '중단됨',
};

export const EVENT_LABEL: Record<string, string> = {
  'login.success': '로그인 성공',
  'login.failure': '로그인 실패',
  'login.locked': '로그인 차단',
  logout: '로그아웃',
  'job.create': '작업 생성',
  'job.update': '작업 수정',
  'job.delete': '작업 삭제',
  'job.enable': '작업 활성',
  'job.disable': '작업 비활성',
  'job.run_manual': '수동 실행',
  'run.cancel': '실행 중지',
  'mcp_key.create': 'MCP 키 발급',
  'mcp_key.revoke': 'MCP 키 폐기',
  'config.password_encrypted': '비밀번호 변환',
  'server.start': '서버 시작',
  'server.stop': '서버 종료',
};

function parts(t: number | string): Record<string, string> {
  const d = new Date(t);
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: session.me?.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

/** 서버 타임존 기준 MM-DD HH:mm:ss */
export function shortTime(t: number | string | null | undefined): string {
  if (t === null || t === undefined) return '—';
  const p = parts(t);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 서버 타임존 기준 YYYY-MM-DD HH:mm:ss */
export function fullTime(t: number | string | null | undefined): string {
  if (t === null || t === undefined) return '—';
  const p = parts(t);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function duration(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}초`;
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${String(sec).padStart(2, '0')}초`;
  return `${sec}초`;
}

export function runDuration(r: Run, now = Date.now()): string {
  return r.finishedAt ? duration(r.finishedAt - r.startedAt) : `${duration(now - r.startedAt)} 경과`;
}

export function runCode(r: Run): string {
  if (r.status === 'running') return '—';
  if (r.jobType === 'cli') return r.exitCode === null ? '—' : `exit ${r.exitCode}`;
  return r.httpStatus ? `HTTP ${r.httpStatus}` : '—';
}

/** 목록에 보여줄 마지막 결과 라벨 */
export function resultLabel(r: Run): string {
  const base = STATUS_LABEL[r.status];
  const code = runCode(r);
  if (r.status === 'failure' && code !== '—') return `${base} · ${code}`;
  return base;
}

export function auditSummary(a: AuditEntry): string {
  const d = (a.detail ?? {}) as Record<string, unknown>;
  switch (a.event) {
    case 'job.update': return `필드 ${(d.changes as unknown[] | undefined)?.length ?? 0}개 변경`;
    case 'login.failure': return `연속 실패 ${d.failures ?? '?'}회`;
    case 'login.locked': return `5회 연속 실패 · ${d.lockMinutes ?? 5}분 차단`;
    case 'job.run_manual':
    case 'run.cancel': return `실행 #${d.runId}`;
    case 'server.start': return `v${d.version} · 작업 ${d.jobs}개 · ${d.timezone}${d.interruptedRuns ? ` · 중단 ${d.interruptedRuns}건 마감` : ''}`;
    case 'server.stop': return String(d.reason ?? '');
    case 'config.password_encrypted': return '평문 비밀번호를 enc 해시로 변환';
    case 'job.create':
    case 'job.delete': {
      const j = (d.job ?? {}) as Record<string, string>;
      const via = d.via === 'mcp' ? ` · MCP(${d.mcpKey})` : '';
      return `${j.type === 'cli' ? 'CLI' : '웹훅'} · ${j.cron ?? ''}${via}`;
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
