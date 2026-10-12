// IR-WEBCRON-001: 웹 UI와 /api JSON REST API
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { LoginLimiter, Sessions } from './auth.ts';
import type { Config } from './config.ts';
import { cronError, nextRuns } from './cron.ts';
import type { Store } from './db.ts';
import type { RunStatus } from './exec/types.ts';
import { diffJobs, flattenJob, validateJob, type FieldErrors, type Job } from './jobs.ts';
import { registerMcp } from './mcp.ts';
import { generateKey } from './mcpkeys.ts';
import { verifyPassword } from './password.ts';
import type { Runner } from './runner.ts';
import type { Scheduler } from './scheduler.ts';

export interface AppDeps {
  config: Config;
  store: Store;
  runner: Runner;
  scheduler: Scheduler;
  webDir?: string;
  now?: () => number;
  logger?: boolean;
}

export const COOKIE = 'wc_session';

export type JobView = Job & { nextRunAt: string | null; lastRun: unknown; runningCount: number };
export interface Actor { req: FastifyRequest; via: 'web' | 'mcp'; mcpKey?: string }
export interface JobActions {
  listJobs(): JobView[];
  createJob(body: unknown, actor: Actor): { job: JobView; errors?: undefined } | { job?: undefined; errors: FieldErrors };
  deleteJob(id: number, actor: Actor): Job | null;
}
const RUN_STATUSES: RunStatus[] = ['running', 'success', 'failure', 'timeout', 'canceled', 'interrupted'];
const DAY = 86_400_000;

function int(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, store, runner, scheduler } = deps;
  const now = deps.now ?? Date.now;
  const sessions = new Sessions(config.sessionTtlMinutes * 60_000, now);
  const limiter = new LoginLimiter(now);

  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(fastifyCookie);

  // 빈 본문의 JSON 요청(예: 본문 없는 DELETE)도 받아들인다.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const s = String(body);
    if (s.trim() === '') { done(null, undefined); return; }
    try {
      done(null, JSON.parse(s));
    } catch {
      done(Object.assign(new Error('JSON 본문을 해석할 수 없습니다.'), { statusCode: 400 }), undefined);
    }
  });

  const audit = (event: string, req: FastifyRequest | null, job: { id: number; name: string } | null, detail: unknown = null) => {
    store.insertAudit({ event, ip: req?.ip ?? null, jobId: job?.id ?? null, jobName: job?.name ?? null, detail, at: now() });
  };

  const jobView = (job: Job, summary = store.jobRunSummary()): JobView => {
    const s = summary.get(job.id);
    const next = scheduler.nextRun(job.id);
    return { ...job, nextRunAt: next ? next.toISOString() : null, lastRun: s?.last ?? null, runningCount: s?.running ?? 0 };
  };

  // 웹 API와 MCP가 함께 쓰는 작업 동작 (FR-WEBCRON-001, FR-WEBCRON-011)
  const viaDetail = (a: Actor) => (a.via === 'mcp' ? { via: 'mcp', mcpKey: a.mcpKey } : { via: 'web' });
  const actions: JobActions = {
    listJobs: () => {
      const summary = store.jobRunSummary();
      return store.listJobs().map((j) => jobView(j, summary));
    },
    createJob: (body, actor) => {
      const v = validateJob(body);
      if (v.errors) return { errors: v.errors };
      const job = store.createJob(v.value, now());
      scheduler.sync(job);
      audit('job.create', actor.req, job, { job: flattenJob(job), ...viaDetail(actor) });
      return { job: jobView(job) };
    },
    deleteJob: (id, actor) => {
      const job = store.getJob(id);
      if (!job) return null;
      scheduler.remove(job.id);
      store.deleteJob(job.id);
      audit('job.delete', actor.req, job, { job: flattenJob(job), ...viaDetail(actor) });
      return job;
    },
  };

  // 인증과 Content-Type 검사
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url !== '/api/login' && !sessions.touch(req.cookies[COOKIE])) {
      return reply.code(401).send({ message: '로그인이 필요합니다.' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const ct = String(req.headers['content-type'] ?? '');
      if (!ct.toLowerCase().startsWith('application/json')) {
        return reply.code(415).send({ message: 'Content-Type: application/json 요청만 받습니다.' });
      }
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) req.log.error(err);
    reply.code(code).send({ message: code === 500 ? '서버 오류가 발생했습니다.' : err.message });
  });

  // ---------- 인증 ----------
  app.post('/api/login', async (req, reply) => {
    const ip = req.ip;
    const left = limiter.lockedFor(ip);
    if (left > 0) {
      reply.header('retry-after', String(left));
      return reply.code(429).send({ message: `로그인을 5회 연속 실패했습니다. ${left}초 뒤에 다시 시도하세요.`, retryAfterSec: left });
    }
    const b = (req.body ?? {}) as { password?: unknown };
    const pwOk = typeof b.password === 'string' && b.password !== '' && (await verifyPassword(b.password, config.passwordHash));
    if (pwOk) {
      limiter.success(ip);
      const token = sessions.create();
      reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict' });
      audit('login.success', req, null);
      return { ok: true };
    }
    const locked = limiter.fail(ip);
    audit('login.failure', req, null, { failures: limiter.failures(ip) });
    if (locked) audit('login.locked', req, null, { lockMinutes: 5 });
    return reply.code(401).send({ message: '비밀번호가 올바르지 않습니다.' });
  });

  app.post('/api/logout', async (req, reply) => {
    sessions.destroy(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    audit('logout', req, null);
    return { ok: true };
  });

  app.get('/api/me', async () => ({
    timezone: config.timezone, logRetentionDays: config.logRetentionDays,
  }));

  app.get('/api/stats', async () => {
    const s = store.stats(now() - DAY);
    const jobs = store.listJobs();
    return { success24h: s.success, failure24h: s.failure, running: s.running, enabledJobs: jobs.filter((j) => j.enabled).length, totalJobs: jobs.length };
  });

  // ---------- 작업 ----------
  const findJob = (req: FastifyRequest, reply: FastifyReply): Job | null => {
    const id = int((req.params as { id: string }).id);
    const job = id === undefined ? null : store.getJob(id);
    if (!job) reply.code(404).send({ message: '작업을 찾을 수 없습니다.' });
    return job;
  };

  app.get('/api/jobs', async () => ({ items: actions.listJobs() }));

  app.get('/api/jobs/:id', async (req, reply) => {
    const job = findJob(req, reply);
    return job ? jobView(job) : reply;
  });

  app.post('/api/jobs', async (req, reply) => {
    const r = actions.createJob(req.body, { req, via: 'web' });
    if (r.errors) return reply.code(400).send({ message: '입력값을 확인하세요.', errors: r.errors });
    return reply.code(201).send(r.job);
  });

  app.put('/api/jobs/:id', async (req, reply) => {
    const before = findJob(req, reply);
    if (!before) return reply;
    const v = validateJob(req.body);
    if (v.errors) return reply.code(400).send({ message: '입력값을 확인하세요.', errors: v.errors });
    const after = store.updateJob(before.id, v.value, now())!;
    scheduler.sync(after);
    const changes = diffJobs(before, after).filter((c) => c.field !== 'enabled');
    if (changes.length) audit('job.update', req, after, { changes });
    if (before.enabled !== after.enabled) audit(after.enabled ? 'job.enable' : 'job.disable', req, after);
    return jobView(after);
  });

  app.patch('/api/jobs/:id/enabled', async (req, reply) => {
    const job = findJob(req, reply);
    if (!job) return reply;
    const enabled = (req.body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== 'boolean') return reply.code(400).send({ message: '입력값을 확인하세요.', errors: { enabled: 'true 또는 false 여야 합니다.' } });
    if (job.enabled !== enabled) {
      const updated = store.updateJob(job.id, { ...job, enabled }, now())!;
      scheduler.sync(updated);
      audit(enabled ? 'job.enable' : 'job.disable', req, updated);
      return jobView(updated);
    }
    return jobView(job);
  });

  app.delete('/api/jobs/:id', async (req, reply) => {
    const job = findJob(req, reply);
    if (!job) return reply;
    actions.deleteJob(job.id, { req, via: 'web' });
    return { ok: true };
  });

  app.post('/api/jobs/:id/run', async (req, reply) => {
    const job = findJob(req, reply);
    if (!job) return reply;
    const runId = runner.start(job, 'manual');
    if (runId === null) return reply.code(503).send({ message: '서버가 종료 중입니다.' });
    audit('job.run_manual', req, job, { runId });
    return reply.code(202).send({ runId });
  });

  app.post('/api/cron/preview', async (req, reply) => {
    const cron = String((req.body as { cron?: unknown })?.cron ?? '');
    const err = cronError(cron);
    if (err) return reply.code(400).send({ message: err, errors: { cron: err } });
    return { timezone: config.timezone, next: nextRuns(cron, config.timezone, 5).map((d) => d.toISOString()) };
  });

  // ---------- 실행 이력 ----------
  app.get('/api/runs', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const status = RUN_STATUSES.includes(q.status as RunStatus) ? (q.status as RunStatus) : undefined;
    return store.listRuns({ jobId: int(q.jobId), status, from: int(q.from), to: int(q.to), page: int(q.page) ?? 1 });
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const id = int((req.params as { id: string }).id);
    const run = id === undefined ? null : store.getRun(id);
    return run ?? reply.code(404).send({ message: '실행 기록을 찾을 수 없습니다.' });
  });

  app.post('/api/runs/:id/cancel', async (req, reply) => {
    const id = int((req.params as { id: string }).id);
    const run = id === undefined ? null : store.getRun(id);
    if (!run) return reply.code(404).send({ message: '실행 기록을 찾을 수 없습니다.' });
    if (!runner.cancel(run.id)) return reply.code(409).send({ message: '이미 끝난 실행입니다.' });
    audit('run.cancel', req, { id: run.jobId, name: run.jobName }, { runId: run.id });
    return { ok: true };
  });

  // ---------- 감사 로그 (조회 전용) ----------
  app.get('/api/audit', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return store.listAudit({ event: q.event || undefined, from: int(q.from), to: int(q.to), page: int(q.page) ?? 1 });
  });

  // ---------- MCP 키 (FR-WEBCRON-010) ----------
  app.get('/api/mcp-keys', async () => ({ items: store.listMcpKeys() }));

  app.post('/api/mcp-keys', async (req, reply) => {
    const raw = (req.body as { name?: unknown })?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || name.length > 100) {
      return reply.code(400).send({ message: '입력값을 확인하세요.', errors: { name: '이름은 1~100자로 입력하세요.' } });
    }
    const { key, keyHash, prefix } = generateKey();
    const item = store.createMcpKey({ name, prefix, keyHash, at: now() });
    audit('mcp_key.create', req, null, { keyId: item.id, name, prefix });
    return reply.code(201).send({ key, item });
  });

  app.delete('/api/mcp-keys/:id', async (req, reply) => {
    const id = int((req.params as { id: string }).id);
    const item = id === undefined ? null : store.getMcpKey(id);
    if (!item) return reply.code(404).send({ message: 'MCP 키를 찾을 수 없습니다.' });
    if (!item.revokedAt) {
      store.revokeMcpKey(item.id, now());
      audit('mcp_key.revoke', req, null, { keyId: item.id, name: item.name, prefix: item.prefix });
    }
    return { item: store.getMcpKey(item.id) };
  });

  // ---------- MCP 엔드포인트 (IR-WEBCRON-002) ----------
  registerMcp(app, { store, now, actions });

  // ---------- 화면 ----------
  if (deps.webDir && existsSync(deps.webDir)) {
    // wildcard 모드: 서버 실행 중에 다시 빌드한 파일도 요청 시점에 디스크에서 찾는다.
    await app.register(fastifyStatic, { root: deps.webDir });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      // 확장자가 있는 경로(없는 정적 파일)는 index.html 로 대신하지 않는다.
      const isPage = req.method === 'GET' && !path.startsWith('/api/') && path !== '/mcp' && !/\.[a-z0-9]+$/i.test(path);
      if (isPage) return reply.sendFile('index.html');
      return reply.code(404).send({ message: '찾을 수 없습니다.' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ message: '찾을 수 없습니다.' }));
  }

  return app;
}
