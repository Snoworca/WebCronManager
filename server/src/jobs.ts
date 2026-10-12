// FR-WEBCRON-001: 작업 정의와 입력 검증
import { cronError } from './cron.ts';
import type { CliSpec, WebhookSpec } from './exec/types.ts';

export type JobType = 'cli' | 'webhook';

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

export interface Job extends JobInput {
  id: number;
  createdAt: number;
  updatedAt: number;
}

export type FieldErrors = Record<string, string>;

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_TIMEOUT = 7 * 24 * 3600;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringMap(v: unknown, field: string, keyRe: RegExp, errors: FieldErrors): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) { errors[field] = '키-값 객체여야 합니다.'; return {}; }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!keyRe.test(k)) { errors[`${field}.${k}`] = `이름 형식이 올바르지 않습니다: ${k}`; continue; }
    if (typeof val !== 'string') { errors[`${field}.${k}`] = '값은 문자열이어야 합니다.'; continue; }
    out[k] = val;
  }
  return out;
}

export function validateJob(body: unknown): { value: JobInput; errors?: undefined } | { value?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const b = isObj(body) ? body : {};

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) errors.name = '이름을 입력하세요.';
  else if (name.length > 100) errors.name = '이름은 100자 이하여야 합니다.';

  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length > 500) errors.description = '설명은 500자 이하여야 합니다.';

  const cron = typeof b.cron === 'string' ? b.cron.trim().replace(/\s+/g, ' ') : '';
  const ce = cronError(cron);
  if (ce) errors.cron = ce;

  const type = b.type;
  if (type !== 'cli' && type !== 'webhook') errors.type = '유형은 cli 또는 webhook 이어야 합니다.';

  const enabled = b.enabled === undefined ? true : b.enabled;
  if (typeof enabled !== 'boolean') errors.enabled = '활성 여부는 true 또는 false 여야 합니다.';

  const timeoutSec = b.timeoutSec === undefined ? 0 : b.timeoutSec;
  if (!Number.isInteger(timeoutSec) || (timeoutSec as number) < 0 || (timeoutSec as number) > MAX_TIMEOUT) {
    errors.timeoutSec = `타임아웃은 0 이상 ${MAX_TIMEOUT} 이하의 정수(초)여야 합니다.`;
  }

  let cli: CliSpec | null = null;
  let webhook: WebhookSpec | null = null;
  if (type === 'cli') {
    const c = isObj(b.cli) ? b.cli : {};
    const command = typeof c.command === 'string' ? c.command.trim() : '';
    if (!command) errors['cli.command'] = '실행할 명령을 입력하세요.';
    const cwd = typeof c.cwd === 'string' ? c.cwd.trim() : '';
    cli = { command, cwd: cwd || undefined, env: stringMap(c.env, 'cli.env', ENV_KEY, errors) };
  } else if (type === 'webhook') {
    const w = isObj(b.webhook) ? b.webhook : {};
    const method = w.method;
    if (method !== 'GET' && method !== 'POST') errors['webhook.method'] = '메서드는 GET 또는 POST 여야 합니다.';
    const url = typeof w.url === 'string' ? w.url.trim() : '';
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') errors['webhook.url'] = 'http 또는 https URL이어야 합니다.';
    } catch {
      errors['webhook.url'] = '올바른 URL을 입력하세요.';
    }
    const body = typeof w.body === 'string' ? w.body : '';
    if (body.length > 1_000_000) errors['webhook.body'] = '본문은 1MB 이하여야 합니다.';
    const retryCount = w.retryCount === undefined ? 0 : w.retryCount;
    if (!Number.isInteger(retryCount) || (retryCount as number) < 0 || (retryCount as number) > 5) {
      errors['webhook.retryCount'] = '재시도 횟수는 0~5 사이의 정수여야 합니다.';
    }
    webhook = {
      method: method as 'GET' | 'POST', url,
      headers: stringMap(w.headers, 'webhook.headers', HEADER_NAME, errors),
      body: method === 'POST' ? body : '',
      retryCount: retryCount as number,
    };
  }

  if (Object.keys(errors).length) return { errors };
  return { value: { name, description, cron, type: type as JobType, enabled: enabled as boolean, timeoutSec: timeoutSec as number, cli, webhook } };
}

/** SEC-WEBCRON-004: 감사 로그용으로 환경 변수와 헤더 값을 가린다. */
export function flattenJob(j: JobInput): Record<string, string> {
  const out: Record<string, string> = {
    name: j.name, description: j.description, cron: j.cron, type: j.type,
    enabled: String(j.enabled), timeoutSec: String(j.timeoutSec),
  };
  if (j.cli) {
    out['cli.command'] = j.cli.command;
    out['cli.cwd'] = j.cli.cwd ?? '';
    for (const k of Object.keys(j.cli.env ?? {})) out[`cli.env.${k}`] = '***';
  }
  if (j.webhook) {
    out['webhook.method'] = j.webhook.method;
    out['webhook.url'] = j.webhook.url;
    out['webhook.body'] = j.webhook.body ?? '';
    out['webhook.retryCount'] = String(j.webhook.retryCount ?? 0);
    for (const k of Object.keys(j.webhook.headers ?? {})) out[`webhook.headers.${k}`] = '***';
  }
  return out;
}

export interface FieldChange { field: string; before: string | null; after: string | null }

export function diffJobs(before: JobInput, after: JobInput): FieldChange[] {
  const a = flattenJob(before);
  const b = flattenJob(after);
  const changes: FieldChange[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const secret = k.startsWith('cli.env.') || k.startsWith('webhook.headers.');
    let changed = a[k] !== b[k];
    if (secret && !changed) {
      const [, , key] = k.split('.');
      const bv = k.startsWith('cli.') ? before.cli?.env?.[key] : before.webhook?.headers?.[key];
      const av = k.startsWith('cli.') ? after.cli?.env?.[key] : after.webhook?.headers?.[key];
      changed = bv !== av;
    }
    if (changed) changes.push({ field: k, before: a[k] ?? null, after: b[k] ?? null });
  }
  return changes;
}
