// OPS-WEBCRON-002: 상시 구동과 정상 종료, REL-WEBCRON-001: 재기동 복원, DR-WEBCRON-002: 보관 기간 정리
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { Store } from './db.ts';
import { ts } from './i18n.ts';
import { Runner } from './runner.ts';
import { Scheduler } from './scheduler.ts';
import { VERSION } from './version.ts';

const DAY = 86_400_000;

export { VERSION };

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
    log(ts('log.passwordEncrypted', { path: config.envPath }));
  }
  const interrupted = store.markInterrupted();

  const runner = new Runner(store);
  const scheduler = new Scheduler(config.timezone, (jobId) => {
    const job = store.getJob(jobId);
    if (job?.enabled) runner.start(job, 'schedule');
  });
  const jobs = store.listJobs();
  for (const job of jobs) {
    try { scheduler.sync(job); } catch (e) { log(ts('log.scheduleFailed', { id: job.id, name: job.name, error: (e as Error).message })); }
  }

  const purge = () => {
    try {
      const r = store.purge(Date.now() - config.logRetentionDays * DAY);
      if (r.runs || r.audit) log(ts('log.purged', { days: config.logRetentionDays, runs: r.runs, audit: r.audit }));
    } catch (e) { log(ts('log.purgeFailed', { error: (e as Error).message })); }
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
  log(ts('log.started', { version: VERSION, url, jobs: jobs.length, tz: config.timezone }));
  if (interrupted) log(ts('log.interrupted', { count: interrupted }));

  let stopping: Promise<void> | null = null;
  const stop = (reason: string) => {
    stopping ??= (async () => {
      scheduler.stopAll();
      clearInterval(purgeTimer);
      await runner.shutdown();
      store.insertAudit({ event: 'server.stop', ip: null, jobId: null, jobName: null, detail: { reason } });
      await app.close();
      store.close();
      log(ts('log.stopped', { reason }));
    })();
    return stopping;
  };

  return { config, app, url, stop };
}
