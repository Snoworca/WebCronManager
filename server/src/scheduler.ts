// FR-WEBCRON-002: 일정 실행, FR-WEBCRON-001 AC-2/AC-3: 수정 즉시 반영·비활성 제외
import { Cron } from 'croner';
import { CRON_MODE } from './cron.ts';
import type { Job } from './jobs.ts';

export class Scheduler {
  timezone: string;
  onFire: (jobId: number) => void;
  crons = new Map<number, Cron>();

  constructor(timezone: string, onFire: (jobId: number) => void) {
    this.timezone = timezone;
    this.onFire = onFire;
  }

  sync(job: Job): void {
    this.remove(job.id);
    if (!job.enabled) return;
    const c = new Cron(job.cron, {
      timezone: this.timezone,
      mode: CRON_MODE,
      catch: (e) => console.error(`[webcron] 작업 ${job.id} 예약 실행 오류:`, e),
    }, () => this.onFire(job.id));
    this.crons.set(job.id, c);
  }

  remove(jobId: number): void {
    this.crons.get(jobId)?.stop();
    this.crons.delete(jobId);
  }

  nextRun(jobId: number): Date | null {
    return this.crons.get(jobId)?.nextRun() ?? null;
  }

  stopAll(): void {
    for (const c of this.crons.values()) c.stop();
    this.crons.clear();
  }
}
