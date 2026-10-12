// OPS-WEBCRON-002: 상시 구동과 정상 종료, REL-WEBCRON-001: 재기동 복원, DR-WEBCRON-002: 보관 기간 정리
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { Store } from './db.ts';
import { Runner } from './runner.ts';
import { Scheduler } from './scheduler.ts';

const DAY = 86_400_000;

export const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export interface Running {
  config: Config;
  app: FastifyInstance;
  url: string;
  stop: (reason: string) => Promise<void>;
}

export async function startServer(opts: { envPath: string; webDir?: string; log?: (msg: string) => void }): Promise<Running> {
  const log = opts.log ?? ((m: string) => console.log(`[webcron] ${m}`));
  const { config, passwordEncrypted } = loadConfig(opts.envPath);
  const store = new Store(config.dataDir);

  if (passwordEncrypted) {
    store.insertAudit({ event: 'config.password_encrypted', ip: null, jobId: null, jobName: null, detail: { envPath: config.envPath } });
    log(`평문 비밀번호를 enc 해시로 바꿔 저장했습니다: ${config.envPath}`);
  }
  const interrupted = store.markInterrupted();

  const runner = new Runner(store);
  const scheduler = new Scheduler(config.timezone, (jobId) => {
    const job = store.getJob(jobId);
    if (job?.enabled) runner.start(job, 'schedule');
  });
  const jobs = store.listJobs();
  for (const job of jobs) {
    try { scheduler.sync(job); } catch (e) { log(`작업 ${job.id}(${job.name}) 일정을 등록하지 못했습니다: ${(e as Error).message}`); }
  }

  const purge = () => {
    try {
      const r = store.purge(Date.now() - config.logRetentionDays * DAY);
      if (r.runs || r.audit) log(`보관 기간(${config.logRetentionDays}일)이 지난 기록을 정리했습니다: 실행 ${r.runs}건, 감사 ${r.audit}건`);
    } catch (e) { log(`기록 정리 실패: ${(e as Error).message}`); }
  };
  purge();
  const purgeTimer = setInterval(purge, DAY);
  purgeTimer.unref();

  const app = await buildApp({ config, store, runner, scheduler, webDir: opts.webDir });
  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${port}`;

  store.insertAudit({
    event: 'server.start', ip: null, jobId: null, jobName: null,
    detail: { version: VERSION, jobs: jobs.length, interruptedRuns: interrupted, timezone: config.timezone },
  });
  log(`v${VERSION} 시작: ${url} (작업 ${jobs.length}개, 타임존 ${config.timezone})`);
  if (interrupted) log(`이전 종료 때 실행 중이던 ${interrupted}건을 interrupted 로 마감했습니다.`);

  let stopping: Promise<void> | null = null;
  const stop = (reason: string) => {
    stopping ??= (async () => {
      scheduler.stopAll();
      clearInterval(purgeTimer);
      await runner.shutdown();
      store.insertAudit({ event: 'server.stop', ip: null, jobId: null, jobName: null, detail: { reason } });
      await app.close();
      store.close();
      log(`종료했습니다 (${reason}).`);
    })();
    return stopping;
  };

  return { config, app, url, stop };
}
