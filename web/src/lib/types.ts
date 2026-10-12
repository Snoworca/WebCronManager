export type JobType = 'cli' | 'webhook';
export type RunStatus = 'running' | 'success' | 'failure' | 'timeout' | 'canceled' | 'interrupted';

export interface CliSpec { command: string; cwd?: string; env?: Record<string, string> }
export interface WebhookSpec { method: 'GET' | 'POST'; url: string; headers?: Record<string, string>; body?: string; retryCount?: number }

export interface JobInput {
  name: string;
  description: string;
  cron: string;
  type: JobType;
  enabled: boolean;
  timeoutSec: number;
  cli: CliSpec | null;
  webhook: WebhookSpec | null;
}

export interface Run {
  id: number;
  jobId: number;
  jobName: string;
  jobType: JobType;
  trigger: 'schedule' | 'manual';
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

export interface Job extends JobInput {
  id: number;
  createdAt: number;
  updatedAt: number;
  nextRunAt: string | null;
  lastRun: Run | null;
  runningCount: number;
}

export interface AuditEntry {
  id: number;
  at: number;
  event: string;
  ip: string | null;
  jobId: number | null;
  jobName: string | null;
  detail: Record<string, unknown> | null;
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export interface Me { username: string; timezone: string; logRetentionDays: number }

export interface Stats { success24h: number; failure24h: number; running: number; enabledJobs: number; totalJobs: number }

export interface Pair { key: string; value: string }
