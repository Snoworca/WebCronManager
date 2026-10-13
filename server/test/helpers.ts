import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'webcron-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 플랫폼과 무관하게 현재 Node로 스크립트를 실행하는 셸 명령을 만든다.
 * 스크립트에 cmd.exe 특수문자(| & < > ^)를 넣지 않는다. cmd.exe 는 \" 를 이스케이프로 보지 않아
 * 그 문자들을 따옴표 밖으로 해석한다(예: ()=>{} 의 > 가 리다이렉션이 된다).
 */
export function nodeCmd(script: string): string {
  const exe = JSON.stringify(process.execPath);
  return `${exe} -e ${JSON.stringify(script)}`;
}

export async function waitFor(cond: () => boolean, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timeout');
    await sleep(stepMs);
  }
}
