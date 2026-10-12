import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, ConfigError } from '../src/config.ts';
import { hashPassword, verifyPassword } from '../src/password.ts';
import { tempDir } from './helpers.ts';

function withEnv(text: string | null, fn: (path: string, dir: string) => void | Promise<void>) {
  return async () => {
    const t = tempDir();
    const p = join(t.dir, '.env');
    if (text !== null) writeFileSync(p, text);
    try { await fn(p, t.dir); } finally { t.cleanup(); }
  };
}

test('OPS-WEBCRON-001 AC-1, AC-3: 설정 파일이 없으면 템플릿을 만들고 ConfigError를 던진다', withEnv(null, (p) => {
  assert.throws(() => loadConfig(p), (e: unknown) => e instanceof ConfigError && /템플릿/.test(e.message));
  assert.ok(existsSync(p));
  const text = readFileSync(p, 'utf8');
  assert.match(text, /^WEBCRON_LOG_RETENTION_DAYS=30$/m);
  assert.match(text, /^WEBCRON_PASSWORD=/m);
  assert.doesNotMatch(text, /USERNAME/);
}));

test('OPS-WEBCRON-001 AC-2: 생략한 변수에 기본값을 적용한다', withEnv('WEBCRON_PASSWORD=pw\nWEBCRON_TIMEZONE=\n', (p, dir) => {
  const { config } = loadConfig(p);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8080);
  assert.equal(config.sessionTtlMinutes, 720);
  assert.equal(config.logRetentionDays, 30);
  assert.equal(config.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(config.dataDir, join(dir, 'data'));
}));

test('OPS-WEBCRON-001 AC-4: 비밀번호가 비거나 숫자 형식이 틀리면 변수명을 담아 실패한다', async (t) => {
  await t.test('비밀번호만으로 설정된다', withEnv('WEBCRON_PASSWORD=pw\n', (p) => {
    assert.ok(loadConfig(p).config.passwordHash.startsWith('enc:'));
  }));
  await t.test('password 누락', withEnv('WEBCRON_PASSWORD=\n', (p) => {
    assert.throws(() => loadConfig(p), /WEBCRON_PASSWORD/);
  }));
  await t.test('port 형식 오류', withEnv('WEBCRON_PASSWORD=b\nWEBCRON_PORT=80a\n', (p) => {
    assert.throws(() => loadConfig(p), /WEBCRON_PORT/);
  }));
});

test('DR-WEBCRON-002 AC-2: 보관 기간이 1 이상의 정수가 아니면 실패한다', async (t) => {
  for (const v of ['0', '-3', '1.5', 'abc']) {
    await t.test(v, withEnv(`WEBCRON_PASSWORD=b\nWEBCRON_LOG_RETENTION_DAYS=${v}\n`, (p) => {
      assert.throws(() => loadConfig(p), /WEBCRON_LOG_RETENTION_DAYS/);
    }));
  }
});

test('FR-WEBCRON-002 AC-5: 잘못된 타임존이면 실패한다', withEnv('WEBCRON_PASSWORD=b\nWEBCRON_TIMEZONE=Mars/Base\n', (p) => {
  assert.throws(() => loadConfig(p), /WEBCRON_TIMEZONE/);
}));

const SAMPLE = '# WebCron 설정\nWEBCRON_HOST=0.0.0.0\r\n\r\nWEBCRON_PASSWORD=s3cret-평문\r\n# 끝\r\n';

test('SEC-WEBCRON-002 AC-1, AC-4: 평문 비밀번호를 enc 해시로 바꾸고 다른 줄은 유지한다', withEnv(SAMPLE, async (p) => {
  const { config, passwordEncrypted } = loadConfig(p);
  assert.equal(passwordEncrypted, true);
  const text = readFileSync(p, 'utf8');
  assert.ok(!text.includes('s3cret-평문'));
  assert.match(text, /^WEBCRON_PASSWORD='enc:scrypt\$[^']+'\r$/m);
  assert.equal(text.replace(/WEBCRON_PASSWORD=.*\r/, 'X\r'), SAMPLE.replace(/WEBCRON_PASSWORD=.*\r/, 'X\r'));
  assert.ok(config.passwordHash.startsWith('enc:scrypt$'));
  // SEC-WEBCRON-002 AC-2
  assert.equal(await verifyPassword('s3cret-평문', config.passwordHash), true);
}));

test('SEC-WEBCRON-002 AC-3: 이미 enc 형식이면 파일을 수정하지 않는다', withEnv(`WEBCRON_PASSWORD='${hashPassword('pw')}'\n`, (p) => {
  const before = readFileSync(p, 'utf8');
  const { passwordEncrypted } = loadConfig(p);
  assert.equal(passwordEncrypted, false);
  assert.equal(readFileSync(p, 'utf8'), before);
}));

test('SEC-WEBCRON-002: 해시는 salt가 매번 다르고 틀린 비밀번호를 거부한다', async () => {
  const a = hashPassword('pw');
  const b = hashPassword('pw');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('pw', a), true);
  assert.equal(await verifyPassword('pW', a), false);
  assert.equal(await verifyPassword('pw', 'enc:garbage'), false);
});
