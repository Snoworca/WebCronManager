// DR-WEBCRON-001: SQLite 단일 파일 저장, DR-WEBCRON-002: 보관 기간 정리
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { ExecResult, RunStatus } from './exec/types.ts';
import type { Job, JobInput, JobType } from './jobs.ts';

export type Trigger = 'schedule' | 'manual';

export interface Run {
  id: number;
  jobId: number;
  jobName: string;
  jobType: JobType;
  trigger: Trigger;
  startedAt: number;
  finishedAt: number | null;
  status: RunStatus;
  exitCode: number | null;
  httpStatus: number | null;
  attempts: number | null;
  redirects: number | null;
  finalUrl: string | null;
  error: string | null;
  stdout?: string | null;
  stderr?: string | null;
  responseBody?: string | null;
}

export interface AuditEntry {
  id: number;
  at: number;
  event: string;
  ip: string | null;
  jobId: number | null;
  jobName: string | null;
  detail: unknown;
}

export const PAGE_SIZE = 50;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cron TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  timeout_sec INTEGER NOT NULL DEFAULT 0,
  spec TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  job_name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  exit_code INTEGER,
  http_status INTEGER,
  attempts INTEGER,
  redirects INTEGER,
  final_url TEXT,
  error TEXT,
  stdout TEXT,
  stderr TEXT,
  response_body TEXT
);
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS runs_job ON runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  ip TEXT,
  job_id INTEGER,
  job_name TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_logs(at DESC);
`;

type Row = Record<string, SQLInputValue>;

function toJob(r: Row): Job {
  const spec = JSON.parse(r.spec as string);
  return {
    id: r.id as number, name: r.name as string, description: r.description as string, cron: r.cron as string,
    type: r.type as JobType, enabled: r.enabled === 1, timeoutSec: r.timeout_sec as number,
    cli: spec.cli ?? null, webhook: spec.webhook ?? null,
    createdAt: r.created_at as number, updatedAt: r.updated_at as number,
  };
}

function toRun(r: Row, full: boolean): Run {
  const run: Run = {
    id: r.id as number, jobId: r.job_id as number, jobName: r.job_name as string, jobType: r.job_type as JobType,
    trigger: r.trigger as Trigger, startedAt: r.started_at as number, finishedAt: (r.finished_at as number) ?? null,
    status: r.status as RunStatus, exitCode: (r.exit_code as number) ?? null, httpStatus: (r.http_status as number) ?? null,
    attempts: (r.attempts as number) ?? null, redirects: (r.redirects as number) ?? null,
    finalUrl: (r.final_url as string) ?? null, error: (r.error as string) ?? null,
  };
  if (full) {
    run.stdout = (r.stdout as string) ?? null;
    run.stderr = (r.stderr as string) ?? null;
    run.responseBody = (r.response_body as string) ?? null;
  }
  return run;
}

function toAudit(r: Row): AuditEntry {
  return {
    id: r.id as number, at: r.at as number, event: r.event as string, ip: (r.ip as string) ?? null,
    jobId: (r.job_id as number) ?? null, jobName: (r.job_name as string) ?? null,
    detail: r.detail ? JSON.parse(r.detail as string) : null,
  };
}

export interface RunFilter { jobId?: number; status?: RunStatus; from?: number; to?: number; page: number }
export interface AuditFilter { event?: string; from?: number; to?: number; page: number }

export class Store {
  db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'webcron.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  journalMode(): string {
    return (this.db.prepare('PRAGMA journal_mode').get() as Row).journal_mode as string;
  }

  // ---------- jobs ----------
  listJobs(): Job[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY name COLLATE NOCASE, id').all() as Row[]).map(toJob);
  }

  getJob(id: number): Job | null {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
    return r ? toJob(r) : null;
  }

  createJob(j: JobInput, now = Date.now()): Job {
    const res = this.db.prepare(`INSERT INTO jobs (name, description, cron, type, enabled, timeout_sec, spec, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      j.name, j.description, j.cron, j.type, j.enabled ? 1 : 0, j.timeoutSec,
      JSON.stringify({ cli: j.cli, webhook: j.webhook }), now, now);
    return this.getJob(Number(res.lastInsertRowid))!;
  }

  updateJob(id: number, j: JobInput, now = Date.now()): Job | null {
    this.db.prepare(`UPDATE jobs SET name = ?, description = ?, cron = ?, type = ?, enabled = ?, timeout_sec = ?, spec = ?, updated_at = ?
      WHERE id = ?`).run(
      j.name, j.description, j.cron, j.type, j.enabled ? 1 : 0, j.timeoutSec,
      JSON.stringify({ cli: j.cli, webhook: j.webhook }), now, id);
    return this.getJob(id);
  }

  deleteJob(id: number): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  // ---------- runs ----------
  insertRun(a: { job: Job; trigger: Trigger; startedAt: number }): number {
    const res = this.db.prepare(`INSERT INTO runs (job_id, job_name, job_type, trigger, started_at, status)
      VALUES (?, ?, ?, ?, ?, 'running')`).run(a.job.id, a.job.name, a.job.type, a.trigger, a.startedAt);
    return Number(res.lastInsertRowid);
  }

  finishRun(id: number, r: ExecResult, finishedAt = Date.now()): void {
    this.db.prepare(`UPDATE runs SET finished_at = ?, status = ?, exit_code = ?, http_status = ?, attempts = ?, redirects = ?,
      final_url = ?, error = ?, stdout = ?, stderr = ?, response_body = ? WHERE id = ?`).run(
      finishedAt, r.status, r.exitCode ?? null, r.httpStatus ?? null, r.attempts ?? null, r.redirects ?? null,
      r.finalUrl ?? null, r.error ?? null, r.stdout ?? null, r.stderr ?? null, r.responseBody ?? null, id);
  }

  getRun(id: number): Run | null {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return r ? toRun(r, true) : null;
  }

  listRuns(f: RunFilter): { items: Run[]; total: number; page: number; pageSize: number } {
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (f.jobId !== undefined) { where.push('job_id = ?'); args.push(f.jobId); }
    if (f.status) { where.push('status = ?'); args.push(f.status); }
    if (f.from !== undefined) { where.push('started_at >= ?'); args.push(f.from); }
    if (f.to !== undefined) { where.push('started_at < ?'); args.push(f.to); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM runs ${w}`).get(...args) as Row).n as number;
    const page = Math.max(1, f.page);
    const rows = this.db.prepare(`SELECT id, job_id, job_name, job_type, trigger, started_at, finished_at, status, exit_code,
      http_status, attempts, redirects, final_url, error FROM runs ${w} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE) as Row[];
    return { items: rows.map((r) => toRun(r, false)), total, page, pageSize: PAGE_SIZE };
  }

  /** 작업별 가장 최근 실행과 실행 중 건수 */
  jobRunSummary(): Map<number, { last: Run | null; running: number }> {
    const out = new Map<number, { last: Run | null; running: number }>();
    const last = this.db.prepare(`SELECT r.id, r.job_id, r.job_name, r.job_type, r.trigger, r.started_at, r.finished_at, r.status,
      r.exit_code, r.http_status, r.attempts, r.redirects, r.final_url, r.error
      FROM runs r JOIN (SELECT job_id, MAX(id) AS id FROM runs GROUP BY job_id) m ON r.id = m.id`).all() as Row[];
    for (const r of last) out.set(r.job_id as number, { last: toRun(r, false), running: 0 });
    const running = this.db.prepare(`SELECT job_id, COUNT(*) AS n FROM runs WHERE status = 'running' GROUP BY job_id`).all() as Row[];
    for (const r of running) {
      const e = out.get(r.job_id as number) ?? { last: null, running: 0 };
      e.running = r.n as number;
      out.set(r.job_id as number, e);
    }
    return out;
  }

  /** FR-WEBCRON-008 AC-5: 성공/실패 집계. timeout은 실패에 포함하고 canceled는 제외한다. */
  stats(since: number): { success: number; failure: number; running: number } {
    const r = this.db.prepare(`SELECT
      SUM(CASE WHEN status = 'success' AND started_at >= ? THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status IN ('failure', 'timeout') AND started_at >= ? THEN 1 ELSE 0 END) AS failure,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running FROM runs`).get(since, since) as Row;
    return { success: (r.success as number) ?? 0, failure: (r.failure as number) ?? 0, running: (r.running as number) ?? 0 };
  }

  /** REL-WEBCRON-001 AC-2 */
  markInterrupted(now = Date.now()): number {
    const res = this.db.prepare(`UPDATE runs SET status = 'interrupted', finished_at = ?,
      error = '서버가 종료되어 실행이 중단되었습니다.' WHERE status = 'running'`).run(now);
    return Number(res.changes);
  }

  // ---------- audit ----------
  insertAudit(a: { event: string; ip: string | null; jobId: number | null; jobName: string | null; detail: unknown; at?: number }): void {
    this.db.prepare('INSERT INTO audit_logs (at, event, ip, job_id, job_name, detail) VALUES (?, ?, ?, ?, ?, ?)').run(
      a.at ?? Date.now(), a.event, a.ip, a.jobId, a.jobName, a.detail === null || a.detail === undefined ? null : JSON.stringify(a.detail));
  }

  listAudit(f: AuditFilter): { items: AuditEntry[]; total: number; page: number; pageSize: number } {
    const where: string[] = [];
    const args: SQLInputValue[] = [];
    if (f.event) { where.push('event = ?'); args.push(f.event); }
    if (f.from !== undefined) { where.push('at >= ?'); args.push(f.from); }
    if (f.to !== undefined) { where.push('at < ?'); args.push(f.to); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${w}`).get(...args) as Row).n as number;
    const page = Math.max(1, f.page);
    const rows = this.db.prepare(`SELECT * FROM audit_logs ${w} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE) as Row[];
    return { items: rows.map(toAudit), total, page, pageSize: PAGE_SIZE };
  }

  // ---------- retention ----------
  purge(cutoff: number): { runs: number; audit: number } {
    const runs = this.db.prepare(`DELETE FROM runs WHERE started_at < ? AND status <> 'running'`).run(cutoff);
    const audit = this.db.prepare('DELETE FROM audit_logs WHERE at < ?').run(cutoff);
    return { runs: Number(runs.changes), audit: Number(audit.changes) };
  }
}
