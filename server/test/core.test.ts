import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/db.ts';
import { Runner } from '../src/runner.ts';
import { Scheduler } from '../src/scheduler.ts';
import type { JobInput } from '../src/jobs.ts';
import { nodeCmd, sleep, tempDir, waitFor } from './helpers.ts';

function cliJob(over: Partial<JobInput> = {}, command = nodeCmd('console.log("ok")')): JobInput {
  return { name: 'job', description: '', cron: '0 0 1 1 *', type: 'cli', enabled: true, timeoutSec: 0, cli: { command }, webhook: null, ...over };
}

function withStore(fn: (store: Store, dir: string) => Promise<void> | void) {
  return async () => {
    const t = tempDir();
    const store = new Store(join(t.dir, 'data'));
    try { await fn(store, t.dir); } finally { store.close(); t.cleanup(); }
  };
}

test('DR-WEBCRON-001 AC-1, AC-2, AC-3: 데이터 디렉터리를 만들고 WAL로 열며 재기동 후에도 유지된다', async () => {
  const t = tempDir();
  try {
    const dir = join(t.dir, 'nested', 'data');
    const s1 = new Store(dir);
    assert.ok(existsSync(dir));
    assert.equal(s1.journalMode(), 'wal');
    const job = s1.createJob(cliJob({ name: '백업' }));
    const runId = s1.insertRun({ job, trigger: 'manual', startedAt: Date.now() });
    s1.insertAudit({ event: 'job.create', ip: '127.0.0.1', jobId: job.id, jobName: job.name, detail: null });
    s1.close();
    const s2 = new Store(dir);
    assert.equal(s2.getJob(job.id)?.name, '백업');
    assert.equal(s2.getRun(runId)?.status, 'running');
    assert.equal(s2.listAudit({ page: 1 }).total, 1);
    s2.close();
  } finally { t.cleanup(); }
});

test('FR-WEBCRON-001 AC-4: 작업을 지워도 실행 이력은 작업 이름과 함께 남는다', withStore((store) => {
  const job = store.createJob(cliJob({ name: '지울 작업' }));
  const runId = store.insertRun({ job, trigger: 'manual', startedAt: Date.now() });
  store.deleteJob(job.id);
  assert.equal(store.getJob(job.id), null);
  assert.equal(store.getRun(runId)?.jobName, '지울 작업');
}));

test('FR-WEBCRON-003 AC-1, AC-2: 같은 작업을 겹쳐 실행하면 각각 별도 실행으로 동시에 돈다', withStore(async (store) => {
  const runner = new Runner(store);
  const job = store.createJob(cliJob({}, nodeCmd('setTimeout(function(){}, 800)')));
  const a = runner.start(job, 'schedule')!;
  const b = runner.start(job, 'schedule')!;
  assert.notEqual(a, b);
  assert.equal(store.listRuns({ status: 'running', page: 1 }).total, 2);
  await runner.idle();
  assert.equal(store.getRun(a)?.status, 'success');
  assert.equal(store.getRun(b)?.status, 'success');
}));

test('REL-WEBCRON-002 AC-1, AC-2: 시작에 실패한 작업이 있어도 다른 작업은 정상 실행된다', withStore(async (store) => {
  const runner = new Runner(store);
  const broken = store.createJob(cliJob({ cli: { command: 'echo x', cwd: '/no/such/dir/xyz' } }));
  const weird = store.createJob(cliJob({ type: 'webhook', cli: null, webhook: { method: 'GET', url: 'notaurl' } }));
  const good = store.createJob(cliJob());
  const r1 = runner.start(broken, 'schedule')!;
  const r2 = runner.start(weird, 'schedule')!;
  const r3 = runner.start(good, 'schedule')!;
  await runner.idle();
  assert.equal(store.getRun(r1)?.status, 'failure');
  assert.equal(store.getRun(r2)?.status, 'failure');
  assert.equal(store.getRun(r3)?.status, 'success');
}));

test('FR-WEBCRON-009 AC-3: 끝난 실행은 중지할 수 없다', withStore(async (store) => {
  const runner = new Runner(store);
  const job = store.createJob(cliJob({}, nodeCmd('setInterval(function(){},1000)')));
  const id = runner.start(job, 'manual')!;
  await sleep(150);
  assert.equal(runner.cancel(id), true);
  await runner.idle();
  assert.equal(store.getRun(id)?.status, 'canceled');
  assert.equal(runner.cancel(id), false);
  assert.equal(store.getRun(id)?.status, 'canceled');
}));

test('REL-WEBCRON-001 AC-2: 이전에 running으로 남은 실행은 interrupted로 마감한다', withStore((store) => {
  const job = store.createJob(cliJob());
  const id = store.insertRun({ job, trigger: 'schedule', startedAt: Date.now() - 1000 });
  assert.equal(store.markInterrupted(Date.now()), 1);
  const run = store.getRun(id)!;
  assert.equal(run.status, 'interrupted');
  assert.ok(run.finishedAt);
}));

test('OPS-WEBCRON-002: 종료 시 실행 중인 작업을 interrupted로 마감하고 새 실행을 받지 않는다', withStore(async (store) => {
  const runner = new Runner(store);
  const job = store.createJob(cliJob({}, nodeCmd('setInterval(function(){},1000)')));
  const id = runner.start(job, 'schedule')!;
  await sleep(100);
  await runner.shutdown();
  assert.equal(store.getRun(id)?.status, 'interrupted');
  assert.equal(runner.start(job, 'schedule'), null);
}));

test('DR-WEBCRON-002 AC-1, AC-3: 보관 기간이 지난 기록을 지우되 실행 중인 기록은 남긴다', withStore((store) => {
  const day = 86_400_000;
  const now = Date.now();
  const job = store.createJob(cliJob());
  const old = store.insertRun({ job, trigger: 'schedule', startedAt: now - 31 * day });
  store.finishRun(old, { status: 'success' }, now - 31 * day);
  const recent = store.insertRun({ job, trigger: 'schedule', startedAt: now - 29 * day });
  store.finishRun(recent, { status: 'success' }, now - 29 * day);
  const oldRunning = store.insertRun({ job, trigger: 'schedule', startedAt: now - 40 * day });
  store.insertAudit({ event: 'login.success', ip: '1', jobId: null, jobName: null, detail: null, at: now - 31 * day });
  store.insertAudit({ event: 'login.success', ip: '1', jobId: null, jobName: null, detail: null, at: now - 29 * day });
  const removed = store.purge(now - 30 * day);
  assert.deepEqual(removed, { runs: 1, audit: 1 });
  assert.equal(store.getRun(old), null);
  assert.ok(store.getRun(recent));
  assert.ok(store.getRun(oldRunning));
  assert.equal(store.listAudit({ page: 1 }).total, 1);
}));

test('FR-WEBCRON-002 AC-2, FR-WEBCRON-001 AC-3: 활성 작업만 일정대로 실행된다', withStore(async (store) => {
  const fired: number[] = [];
  const sched = new Scheduler('UTC', (id) => fired.push(id));
  const on = store.createJob(cliJob({ cron: '* * * * * *' }));
  const off = store.createJob(cliJob({ cron: '* * * * * *', enabled: false }));
  sched.sync(on);
  sched.sync(off);
  try {
    await waitFor(() => fired.filter((x) => x === on.id).length >= 2, 4000);
    assert.equal(fired.includes(off.id), false);
    assert.equal(sched.nextRun(off.id), null);
    assert.ok(sched.nextRun(on.id));
    // FR-WEBCRON-001 AC-2: 비활성으로 바꾸면 재기동 없이 바로 멈춘다
    sched.sync({ ...on, enabled: false });
    const count = fired.length;
    await sleep(1300);
    assert.equal(fired.length, count);
  } finally { sched.stopAll(); }
}));
