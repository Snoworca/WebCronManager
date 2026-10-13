import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { hashPassword } from '../src/password.ts';
import { Runner } from '../src/runner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { nodeCmd, sleep, tempDir, waitFor } from './helpers.ts';

const PASSWORD = 'correct horse';
const HASH = hashPassword(PASSWORD);

interface Ctx { app: FastifyInstance; store: Store; runner: Runner; scheduler: Scheduler; clock: { t: number }; cookie: string }

function setup(fn: (c: Ctx) => Promise<void>) {
  return async () => {
    const t = tempDir();
    const store = new Store(join(t.dir, 'data'));
    const runner = new Runner(store);
    const scheduler = new Scheduler('Asia/Seoul', () => {});
    const clock = { t: Date.now() };
    const config: Config = {
      envPath: join(t.dir, '.env'), host: '127.0.0.1', port: 0, passwordHash: HASH,
      sessionTtlMinutes: 10, timezone: 'Asia/Seoul', logRetentionDays: 30, dataDir: join(t.dir, 'data'),
    };
    const app = await buildApp({ config, store, runner, scheduler, now: () => clock.t });
    try {
      const res = await login(app, PASSWORD);
      assert.equal(res.statusCode, 200);
      await fn({ app, store, runner, scheduler, clock, cookie: cookieOf(res) });
    } finally {
      await runner.shutdown();
      scheduler.stopAll();
      await app.close();
      store.close();
      t.cleanup();
    }
  };
}

function login(app: FastifyInstance, password: string, ip = '10.0.0.1') {
  return app.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: ip });
}

function cookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw);
  return first.split(';')[0];
}

function api(c: Ctx, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return c.app.inject({
    method, url, headers: { cookie: c.cookie }, remoteAddress: '10.0.0.1',
    ...(method === 'GET' ? {} : { payload: (payload ?? {}) as object }),
  });
}

const cliJob = (over: Record<string, unknown> = {}) => ({
  name: '백업', description: '', cron: '0 3 * * *', type: 'cli', enabled: true, timeoutSec: 0,
  cli: { command: nodeCmd('console.log("done")'), env: { SECRET_TOKEN: 'tok-123' } }, ...over,
});
const hookJob = (over: Record<string, unknown> = {}) => ({
  name: '웹훅', description: '', cron: '*/5 * * * *', type: 'webhook', enabled: true, timeoutSec: 0,
  webhook: { method: 'POST', url: 'http://127.0.0.1:1/x', headers: { Authorization: 'Bearer abc' }, body: '{}', retryCount: 0 }, ...over,
});

const auditEvents = (c: Ctx) => c.store.listAudit({ page: 1 }).items.map((a) => a.event);

test('SEC-WEBCRON-001 AC-1: 로그인하면 HttpOnly, SameSite=Strict 세션 쿠키를 발급한다', setup(async (c) => {
  const res = await login(c.app, PASSWORD);
  const raw = String(res.headers['set-cookie']);
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Strict/i);
  assert.equal((await api(c, 'GET', '/api/me')).statusCode, 200);
}));

test('SEC-WEBCRON-001 AC-2: 비밀번호가 틀리면 401이다', setup(async (c) => {
  assert.equal((await login(c.app, 'wrong', '10.0.0.2')).statusCode, 401);
  const noPw = await c.app.inject({ method: 'POST', url: '/api/login', payload: {}, remoteAddress: '10.0.0.3' });
  assert.equal(noPw.statusCode, 401);
}));

test('SEC-WEBCRON-001 AC-3: 인증 없는 API 요청은 401이다', setup(async (c) => {
  for (const url of ['/api/jobs', '/api/runs', '/api/audit', '/api/me', '/api/stats']) {
    const r = await c.app.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 401, url);
  }
}));

test('SEC-WEBCRON-001 AC-4: 마지막 요청 후 TTL이 지나면 401이다', setup(async (c) => {
  c.clock.t += 9 * 60_000;
  assert.equal((await api(c, 'GET', '/api/me')).statusCode, 200);
  c.clock.t += 9 * 60_000; // 마지막 요청 기준으로는 아직 유효
  assert.equal((await api(c, 'GET', '/api/me')).statusCode, 200);
  c.clock.t += 11 * 60_000;
  assert.equal((await api(c, 'GET', '/api/me')).statusCode, 401);
}));

test('SEC-WEBCRON-001 AC-5: 로그아웃하면 세션이 무효가 된다', setup(async (c) => {
  assert.equal((await api(c, 'POST', '/api/logout')).statusCode, 200);
  assert.equal((await api(c, 'GET', '/api/me')).statusCode, 401);
  assert.ok(auditEvents(c).includes('logout'));
}));

test('SEC-WEBCRON-003 AC-1~AC-4: 5회 연속 실패하면 5분 동안 429를 준다', setup(async (c) => {
  const ip = '10.9.9.9';
  for (let i = 0; i < 5; i++) assert.equal((await login(c.app, 'bad', ip)).statusCode, 401);
  assert.equal((await login(c.app, PASSWORD, ip)).statusCode, 429);
  assert.ok(auditEvents(c).includes('login.locked'));
  assert.equal((await login(c.app, PASSWORD, '10.9.9.8')).statusCode, 200, '다른 IP는 영향 없음');
  c.clock.t += 5 * 60_000 + 1000;
  assert.equal((await login(c.app, PASSWORD, ip)).statusCode, 200);
  // AC-3: 성공하면 실패 횟수가 초기화된다
  for (let i = 0; i < 4; i++) await login(c.app, 'bad', ip);
  assert.equal((await login(c.app, PASSWORD, ip)).statusCode, 200);
  for (let i = 0; i < 4; i++) await login(c.app, 'bad', ip);
  assert.equal((await login(c.app, PASSWORD, ip)).statusCode, 200);
}));

test('FR-WEBCRON-001 AC-1, AC-2, AC-5: 작업을 만들고 수정하면 목록과 스케줄에 바로 반영된다', setup(async (c) => {
  const created = await api(c, 'POST', '/api/jobs', cliJob());
  assert.equal(created.statusCode, 201);
  const job = created.json();
  assert.ok(c.scheduler.nextRun(job.id));
  const list = (await api(c, 'GET', '/api/jobs')).json();
  assert.equal(list.items.length, 1);
  const item = list.items[0];
  for (const k of ['name', 'type', 'cron', 'enabled', 'nextRunAt', 'lastRun']) assert.ok(k in item, k);
  const upd = await api(c, 'PUT', `/api/jobs/${job.id}`, cliJob({ cron: '*/10 * * * * *', name: '백업2' }));
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().name, '백업2');
  const next = c.scheduler.nextRun(job.id)!;
  assert.ok(next.getTime() - Date.now() <= 10_000);
}));

test('FR-WEBCRON-001 AC-3: 비활성으로 바꾸면 스케줄에서 빠진다', setup(async (c) => {
  const job = (await api(c, 'POST', '/api/jobs', cliJob())).json();
  const r = await api(c, 'PATCH', `/api/jobs/${job.id}/enabled`, { enabled: false });
  assert.equal(r.statusCode, 200);
  assert.equal(c.scheduler.nextRun(job.id), null);
  assert.equal((await api(c, 'GET', '/api/jobs')).json().items[0].nextRunAt, null);
  await api(c, 'PATCH', `/api/jobs/${job.id}/enabled`, { enabled: true });
  assert.ok(c.scheduler.nextRun(job.id));
  const ev = auditEvents(c);
  assert.ok(ev.includes('job.disable') && ev.includes('job.enable'));
}));

test('FR-WEBCRON-001 AC-4: 작업을 삭제하면 스케줄이 사라진다', setup(async (c) => {
  const job = (await api(c, 'POST', '/api/jobs', cliJob())).json();
  assert.equal((await api(c, 'DELETE', `/api/jobs/${job.id}`)).statusCode, 200);
  assert.equal(c.scheduler.nextRun(job.id), null);
  assert.equal((await api(c, 'GET', `/api/jobs/${job.id}`)).statusCode, 404);
}));

test('FR-WEBCRON-002 AC-1, IR-WEBCRON-001 AC-3: 잘못된 입력은 400과 필드별 오류를 준다', setup(async (c) => {
  const r = await api(c, 'POST', '/api/jobs', cliJob({ cron: '* *', name: '' }));
  assert.equal(r.statusCode, 400);
  const body = r.json();
  assert.ok(body.errors.cron);
  assert.ok(body.errors.name);
  assert.equal((await api(c, 'GET', '/api/jobs')).json().items.length, 0);
}));

test('FR-WEBCRON-002 AC-4: 크론 미리보기는 다음 실행 시각 5개를 준다', setup(async (c) => {
  const r = await api(c, 'POST', '/api/cron/preview', { cron: '*/5 * * * *' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().next.length, 5);
  assert.equal(r.json().timezone, 'Asia/Seoul');
  assert.equal((await api(c, 'POST', '/api/cron/preview', { cron: 'nope' })).statusCode, 400);
}));

test('IR-WEBCRON-001 AC-4: 상태를 바꾸는 API는 JSON 요청만 받는다', setup(async (c) => {
  const r = await c.app.inject({ method: 'POST', url: '/api/jobs', headers: { cookie: c.cookie, 'content-type': 'text/plain' }, payload: 'x' });
  assert.equal(r.statusCode, 415);
}));

test('FR-WEBCRON-007 AC-1~AC-3: 비활성 작업도 수동 실행되고 trigger는 manual이다', setup(async (c) => {
  const job = (await api(c, 'POST', '/api/jobs', cliJob({ enabled: false }))).json();
  const r = await api(c, 'POST', `/api/jobs/${job.id}/run`);
  assert.equal(r.statusCode, 202);
  const runId = r.json().runId;
  await c.runner.idle();
  const run = (await api(c, 'GET', `/api/runs/${runId}`)).json();
  assert.equal(run.trigger, 'manual');
  assert.equal(run.status, 'success');
  assert.match(run.stdout, /done/);
  assert.ok(auditEvents(c).includes('job.run_manual'));
}));

test('FR-WEBCRON-008 AC-1, AC-2, AC-5: 실행 이력은 50건씩 나뉘고 필터와 집계가 동작한다', setup(async (c) => {
  const job = (await api(c, 'POST', '/api/jobs', cliJob())).json();
  const other = (await api(c, 'POST', '/api/jobs', cliJob({ name: '다른 작업' }))).json();
  const fullJob = c.store.getJob(job.id)!;
  const now = Date.now();
  for (let i = 0; i < 55; i++) {
    const id = c.store.insertRun({ job: fullJob, trigger: 'schedule', startedAt: now - i * 1000 });
    c.store.finishRun(id, { status: i % 5 === 0 ? 'failure' : i % 7 === 0 ? 'timeout' : 'success' });
  }
  const o = c.store.insertRun({ job: c.store.getJob(other.id)!, trigger: 'manual', startedAt: now });
  c.store.finishRun(o, { status: 'canceled' });
  const p1 = (await api(c, 'GET', '/api/runs')).json();
  assert.equal(p1.items.length, 50);
  assert.equal(p1.total, 56);
  assert.equal((await api(c, 'GET', '/api/runs?page=2')).json().items.length, 6);
  const fails = (await api(c, 'GET', `/api/runs?jobId=${job.id}&status=failure`)).json();
  assert.equal(fails.total, 11);
  const ranged = (await api(c, 'GET', `/api/runs?from=${now - 9500}&to=${now + 1}`)).json();
  assert.equal(ranged.total, 11);
  const stats = (await api(c, 'GET', '/api/stats')).json();
  // failure: i%5==0 → 11건, timeout: i%7==0 이면서 i%5!=0 → 6건, canceled는 집계 제외
  assert.equal(stats.success24h, 38);
  assert.equal(stats.failure24h, 17);
  assert.equal(stats.totalJobs, 2);
}));

test('FR-WEBCRON-009 AC-3, AC-4: 실행 중인 작업을 중지하고 끝난 실행은 409를 준다', setup(async (c) => {
  const job = (await api(c, 'POST', '/api/jobs', cliJob({ cli: { command: nodeCmd('setInterval(function(){},1000)') } }))).json();
  const runId = (await api(c, 'POST', `/api/jobs/${job.id}/run`)).json().runId;
  await sleep(150);
  assert.equal((await api(c, 'POST', `/api/runs/${runId}/cancel`)).statusCode, 200);
  await waitFor(() => c.store.getRun(runId)!.status !== 'running');
  assert.equal(c.store.getRun(runId)!.status, 'canceled');
  assert.equal((await api(c, 'POST', `/api/runs/${runId}/cancel`)).statusCode, 409);
  const a = c.store.listAudit({ event: 'run.cancel', page: 1 }).items[0];
  assert.equal(a.jobName, '백업');
  assert.equal((a.detail as { runId: number }).runId, runId);
}));

test('OBS-WEBCRON-001 AC-1, AC-2, SEC-WEBCRON-004: 감사 로그를 남기고 비밀 값은 가린다', setup(async (c) => {
  const job = (await api(c, 'POST', '/api/jobs', hookJob())).json();
  await api(c, 'PUT', `/api/jobs/${job.id}`, hookJob({ name: '웹훅2', webhook: { method: 'POST', url: 'http://127.0.0.1:1/y', headers: { Authorization: 'Bearer zzz' }, body: '{}', retryCount: 2 } }));
  await login(c.app, 'bad', '10.1.1.1');
  const ev = auditEvents(c);
  for (const e of ['login.success', 'login.failure', 'job.create', 'job.update']) assert.ok(ev.includes(e), e);
  const upd = c.store.listAudit({ event: 'job.update', page: 1 }).items[0];
  const changes = (upd.detail as { changes: { field: string; before: string; after: string }[] }).changes;
  const byField = Object.fromEntries(changes.map((x) => [x.field, x]));
  assert.deepEqual(byField.name, { field: 'name', before: '웹훅', after: '웹훅2' });
  assert.equal(byField['webhook.retryCount'].after, '2');
  assert.equal(byField['webhook.headers.Authorization'].after, '***');
  const all = JSON.stringify(c.store.listAudit({ page: 1 }).items);
  for (const secret of ['Bearer abc', 'Bearer zzz', PASSWORD, HASH, 'tok-123']) assert.ok(!all.includes(secret), secret);
  // 응답에도 비밀번호 해시가 없다
  const me = (await api(c, 'GET', '/api/me')).body;
  assert.ok(!me.includes(HASH) && !me.includes('enc:'));
}));

test('OBS-WEBCRON-001 AC-3, OBS-WEBCRON-002: 감사 로그는 조회·필터만 되고 수정할 수 없다', setup(async (c) => {
  await api(c, 'POST', '/api/jobs', cliJob());
  const list = (await api(c, 'GET', '/api/audit?event=job.create')).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].event, 'job.create');
  assert.equal(list.pageSize, 50);
  const id = list.items[0].id;
  assert.equal((await api(c, 'DELETE', `/api/audit/${id}`)).statusCode, 404);
  assert.equal((await api(c, 'PUT', `/api/audit/${id}`, {})).statusCode, 404);
  const future = (await api(c, 'GET', `/api/audit?from=${Date.now() + 60_000}`)).json();
  assert.equal(future.total, 0);
}));

test('IR-WEBCRON-003 AC-1: API 오류·검증 메시지는 Accept-Language 를 따르고 기본은 영어다', setup(async (c) => {
  const wrong = (lang?: string) => c.app.inject({
    method: 'POST', url: '/api/login', payload: { password: 'nope' }, remoteAddress: '10.7.7.7',
    headers: lang ? { 'accept-language': lang } : {},
  });
  assert.equal((await wrong('ko-KR,ko;q=0.9')).json().message, '비밀번호가 올바르지 않습니다.');
  assert.equal((await wrong('en-US,en;q=0.9')).json().message, 'Incorrect password.');
  assert.equal((await wrong()).json().message, 'Incorrect password.');

  const bad = (lang: string) => c.app.inject({
    method: 'POST', url: '/api/jobs', payload: cliJob({ name: '', cron: '* *' }),
    headers: { cookie: c.cookie, 'accept-language': lang }, remoteAddress: '10.0.0.1',
  });
  const ko = (await bad('ko')).json();
  const en = (await bad('en')).json();
  assert.equal(ko.errors.name, '이름을 입력하세요.');
  assert.equal(en.errors.name, 'Enter a name.');
  assert.match(en.errors.cron, /5 fields/);
  assert.equal(en.message, 'Check the input values.');
}));
