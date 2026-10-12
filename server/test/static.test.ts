import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { hashPassword } from '../src/password.ts';
import { Runner } from '../src/runner.ts';
import { Scheduler } from '../src/scheduler.ts';
import { tempDir } from './helpers.ts';

test('IR-WEBCRON-001 AC-2: 빌드한 정적 파일을 제공하고, 서버 실행 중에 다시 빌드한 파일도 제공한다', async () => {
  const t = tempDir();
  const webDir = join(t.dir, 'web');
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>WebCron</title>');
  writeFileSync(join(webDir, 'assets', 'old.js'), 'console.log(1)');
  const store = new Store(join(t.dir, 'data'));
  const scheduler = new Scheduler('UTC', () => {});
  const config: Config = {
    envPath: join(t.dir, '.env'), host: '127.0.0.1', port: 0, passwordHash: hashPassword('pw'),
    sessionTtlMinutes: 10, timezone: 'UTC', logRetentionDays: 30, dataDir: join(t.dir, 'data'),
  };
  const app = await buildApp({ config, store, runner: new Runner(store), scheduler, webDir });
  try {
    const index = await app.inject({ method: 'GET', url: '/' });
    assert.equal(index.statusCode, 200);
    assert.match(String(index.headers['content-type']), /text\/html/);

    const old = await app.inject({ method: 'GET', url: '/assets/old.js' });
    assert.equal(old.statusCode, 200);
    assert.match(String(old.headers['content-type']), /javascript/);

    // 서버가 떠 있는 동안 다시 빌드해 새 파일이 생긴 경우
    writeFileSync(join(webDir, 'assets', 'new.js'), 'console.log(2)');
    const fresh = await app.inject({ method: 'GET', url: '/assets/new.js' });
    assert.equal(fresh.statusCode, 200);
    assert.match(String(fresh.headers['content-type']), /javascript/);
    assert.equal(fresh.body, 'console.log(2)');

    // 없는 정적 파일은 index.html 이 아니라 404
    const missing = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    assert.equal(missing.statusCode, 404);

    // API 경로는 정적 파일 처리에 가려지지 않는다
    assert.equal((await app.inject({ method: 'GET', url: '/api/jobs' })).statusCode, 401);
  } finally {
    await app.close();
    store.close();
    t.cleanup();
  }
});
