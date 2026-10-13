// FR-WEBCRON-003: 병렬 실행, FR-WEBCRON-009: 중지, REL-WEBCRON-002: 실패 격리
import type { Store, Trigger } from './db.ts';
import { runCli } from './exec/cli.ts';
import { ts } from './i18n.ts';
import type { ExecResult } from './exec/types.ts';
import { runWebhook } from './exec/webhook.ts';
import type { Job } from './jobs.ts';

interface Active {
  ctl: AbortController;
  done: Promise<void>;
  shutdown: boolean;
}

export class Runner {
  store: Store;
  active = new Map<number, Active>();
  accepting = true;

  constructor(store: Store) {
    this.store = store;
  }

  /** 새 실행을 시작하고 실행 ID를 돌려준다. 종료 중이면 null. */
  start(job: Job, trigger: Trigger): number | null {
    if (!this.accepting) return null;
    const runId = this.store.insertRun({ job, trigger, startedAt: Date.now() });
    const ctl = new AbortController();
    const entry: Active = { ctl, shutdown: false, done: Promise.resolve() };
    entry.done = this.execute(job, ctl.signal)
      .catch((e: unknown): ExecResult => ({ status: 'failure', error: ts('exec.error', { error: (e as Error)?.message ?? String(e) }) }))
      .then((result) => {
        if (entry.shutdown) result = { ...result, status: 'interrupted', error: ts('exec.interrupted') };
        try { this.store.finishRun(runId, result); } catch (e) { console.error(`[webcron] failed to save run ${runId}:`, e); }
      })
      .finally(() => this.active.delete(runId));
    this.active.set(runId, entry);
    return runId;
  }

  private execute(job: Job, signal: AbortSignal): Promise<ExecResult> {
    const opts = { timeoutSec: job.timeoutSec, signal };
    if (job.type === 'cli') {
      if (!job.cli) return Promise.resolve({ status: 'failure', error: ts('exec.noCli') });
      return runCli(job.cli, opts);
    }
    if (!job.webhook) return Promise.resolve({ status: 'failure', error: ts('exec.noWebhook') });
    return runWebhook(job.webhook, opts);
  }

  /** 실행 중이면 중지하고 true, 이미 끝났으면 false. */
  cancel(runId: number): boolean {
    const a = this.active.get(runId);
    if (!a) return false;
    a.ctl.abort();
    return true;
  }

  isRunning(runId: number): boolean {
    return this.active.has(runId);
  }

  async idle(): Promise<void> {
    while (this.active.size) await Promise.all([...this.active.values()].map((a) => a.done));
  }

  /** OPS-WEBCRON-002: 새 실행을 막고 실행 중인 작업을 interrupted로 마감한다. */
  async shutdown(): Promise<void> {
    this.accepting = false;
    for (const a of this.active.values()) { a.shutdown = true; a.ctl.abort(); }
    await this.idle();
  }
}
