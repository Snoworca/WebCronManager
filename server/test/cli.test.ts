import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, OUTPUT_LIMIT } from '../src/exec/cli.ts';
import { nodeCmd, sleep, tempDir, waitFor } from './helpers.ts';

const never = () => new AbortController().signal;
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('FR-WEBCRON-004 AC-2: 종료 코드 0은 success, 그 외는 failure와 종료 코드를 기록한다', async () => {
  const ok = await runCli({ command: nodeCmd('console.log("hi")') }, { timeoutSec: 0, signal: never() });
  assert.equal(ok.status, 'success');
  assert.equal(ok.exitCode, 0);
  assert.match(ok.stdout, /hi/);
  const bad = await runCli({ command: nodeCmd('console.error("boom"); process.exit(3)') }, { timeoutSec: 0, signal: never() });
  assert.equal(bad.status, 'failure');
  assert.equal(bad.exitCode, 3);
  assert.match(bad.stderr, /boom/);
});

test('FR-WEBCRON-004 AC-1: OS 셸 스크립트(sh 또는 bat)를 실행한다', async () => {
  const t = tempDir();
  try {
    const win = process.platform === 'win32';
    const file = join(t.dir, win ? 'job.bat' : 'job.sh');
    writeFileSync(file, win ? '@echo off\r\necho from-bat\r\n' : 'echo from-sh\n');
    const r = await runCli({ command: win ? `"${file}"` : `sh "${file}"` }, { timeoutSec: 0, signal: never() });
    assert.equal(r.status, 'success');
    assert.match(r.stdout, win ? /from-bat/ : /from-sh/);
  } finally { t.cleanup(); }
});

test('FR-WEBCRON-004 AC-3: stdout은 64KB까지만 저장하고 잘림을 표시한다', async () => {
  const r = await runCli({ command: nodeCmd(`process.stdout.write("x".repeat(${OUTPUT_LIMIT + 5000}))`) }, { timeoutSec: 0, signal: never() });
  assert.equal(r.status, 'success');
  assert.ok(Buffer.byteLength(r.stdout) <= OUTPUT_LIMIT + 200);
  assert.match(r.stdout, /잘림/);
});

test('FR-WEBCRON-004 AC-4: 작업 디렉터리가 없으면 failure와 오류 메시지를 기록한다', async () => {
  const r = await runCli({ command: 'echo x', cwd: join(process.cwd(), 'no-such-dir-xyz') }, { timeoutSec: 0, signal: never() });
  assert.equal(r.status, 'failure');
  assert.match(r.error ?? '', /작업 디렉터리/);
});

test('FR-WEBCRON-004 AC-5: 작업 디렉터리와 환경 변수가 적용된다', async () => {
  const t = tempDir();
  try {
    const r = await runCli({ command: nodeCmd('console.log(process.cwd() + "|" + process.env.WC_TEST)'), cwd: t.dir, env: { WC_TEST: 'val-1' } }, { timeoutSec: 0, signal: never() });
    assert.equal(r.status, 'success');
    const [cwd, v] = r.stdout.trim().split('|');
    assert.equal(cwd.toLowerCase(), t.dir.toLowerCase());
    assert.equal(v, 'val-1');
  } finally { t.cleanup(); }
});

function treeScript(pidFile: string): string {
  // 손자 프로세스를 띄우고 그 PID를 기록한 뒤 오래 대기한다.
  return `const {spawn}=require("child_process");const fs=require("fs");` +
    `const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});` +
    `fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`;
}

test('FR-WEBCRON-006 AC-1, AC-2: 타임아웃이 지나면 프로세스 트리를 종료하고 timeout으로 기록한다', async () => {
  const t = tempDir();
  try {
    const pidFile = join(t.dir, 'child.pid');
    const started = Date.now();
    const r = await runCli({ command: nodeCmd(treeScript(pidFile)) }, { timeoutSec: 1, signal: never() });
    const took = Date.now() - started;
    assert.equal(r.status, 'timeout');
    assert.ok(took >= 900 && took < 5000, `took ${took}ms`);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    await waitFor(() => !isAlive(grandchild), 3000);
  } finally { t.cleanup(); }
});

test('FR-WEBCRON-006 AC-4: 타임아웃 0은 시간 제한이 없다', async () => {
  const r = await runCli({ command: nodeCmd('setTimeout(()=>{}, 1500)') }, { timeoutSec: 0, signal: never() });
  assert.equal(r.status, 'success');
});

test('FR-WEBCRON-009 AC-1: 중지하면 프로세스 트리를 종료하고 canceled로 기록한다', async () => {
  const t = tempDir();
  try {
    const pidFile = join(t.dir, 'child.pid');
    const ac = new AbortController();
    const p = runCli({ command: nodeCmd(treeScript(pidFile)) }, { timeoutSec: 0, signal: ac.signal });
    await waitFor(() => { try { readFileSync(pidFile); return true; } catch { return false; } });
    await sleep(100);
    ac.abort();
    const r = await p;
    assert.equal(r.status, 'canceled');
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    await waitFor(() => !isAlive(grandchild), 3000);
  } finally { t.cleanup(); }
});
