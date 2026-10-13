import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGES, pickLocale, systemLocale, t } from '../src/i18n.ts';
import { envTemplate } from '../src/config.ts';
import { messages as WEB } from '../../web/src/lib/messages.ts';
import { tempDir } from './helpers.ts';

const HANGUL = /[가-힣]/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function sameShape(name: string, ko: Record<string, string>, en: Record<string, string>) {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort(), `${name}: 키 집합이 같아야 한다`);
  for (const k of Object.keys(ko)) {
    assert.equal(placeholders(ko[k]), placeholders(en[k]), `${name}.${k}: 자리표시자가 같아야 한다`);
    assert.ok(!HANGUL.test(en[k]), `${name}.${k}: 영어 문구에 한글이 있다`);
  }
}

test('FR-WEBCRON-012 AC-5: 웹 화면 한국어·영어 사전의 키와 자리표시자가 같다', () => {
  sameShape('web', WEB.ko, WEB.en);
});

test('IR-WEBCRON-003, OPS-WEBCRON-003: 서버 한국어·영어 사전의 키와 자리표시자가 같다', () => {
  sameShape('server', MESSAGES.ko, MESSAGES.en);
});

test('IR-WEBCRON-003 AC-1: Accept-Language 가 ko 로 시작할 때만 한국어다', () => {
  assert.equal(pickLocale('ko-KR,ko;q=0.9,en;q=0.8'), 'ko');
  assert.equal(pickLocale('ko'), 'ko');
  assert.equal(pickLocale('en-US,ko;q=0.9'), 'en');
  assert.equal(pickLocale(undefined), 'en');
  assert.equal(pickLocale(''), 'en');
  assert.equal(t('en', 'api.badPassword'), 'Incorrect password.');
  assert.equal(t('ko', 'api.locked', { sec: 30 }), MESSAGES.ko['api.locked'].replace('{sec}', '30'));
});

test('OPS-WEBCRON-003: 서버 로캘은 LC_ALL, LC_MESSAGES, LANG 순서로 정한다', () => {
  const saved = { LC_ALL: process.env.LC_ALL, LC_MESSAGES: process.env.LC_MESSAGES, LANG: process.env.LANG };
  try {
    process.env.LC_ALL = ''; process.env.LC_MESSAGES = ''; process.env.LANG = 'ko_KR.UTF-8';
    assert.equal(systemLocale(), 'ko');
    process.env.LANG = 'en_US.UTF-8';
    assert.equal(systemLocale(), 'en');
    process.env.LC_ALL = 'ko_KR.UTF-8';
    assert.equal(systemLocale(), 'ko');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('OPS-WEBCRON-003 AC-1, AC-2: .env 템플릿 주석은 로캘 언어를 따르고 변수는 같다', () => {
  const ko = envTemplate('ko');
  const en = envTemplate('en');
  assert.ok(HANGUL.test(ko));
  assert.ok(!HANGUL.test(en));
  const vars = (s: string) => s.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).join('\n');
  assert.equal(vars(ko), vars(en));
  assert.match(en, /^WEBCRON_LOG_RETENTION_DAYS=30$/m);
});

test('FR-WEBCRON-012 AC-1: index.html 은 언어를 미리 정하지 않고 화면이 정한다', () => {
  const t0 = tempDir();
  try {
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'web', 'index.html'), 'utf8');
    assert.ok(!HANGUL.test(html), 'index.html 에 한글 고정 문구가 없다');
  } finally { t0.cleanup(); }
});
