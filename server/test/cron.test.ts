import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronError, nextRuns } from '../src/cron.ts';

test('FR-WEBCRON-002 AC-1: 잘못된 크론 표현식은 오류 메시지를 돌려준다', () => {
  assert.equal(cronError('*/5 * * * *'), null);
  assert.equal(cronError('*/10 * * * * *'), null);
  assert.ok(cronError('* * *'));
  assert.ok(cronError('61 * * * *'));
  assert.ok(cronError('0 0 0 1 1 * 2030'), '7필드는 허용하지 않는다');
  assert.ok(cronError(''));
});

test('FR-WEBCRON-002 AC-2: 6필드 */10 은 10초 간격이다', () => {
  const runs = nextRuns('*/10 * * * * *', 'UTC', 3, new Date('2026-10-13T00:00:01Z'));
  assert.deepEqual(runs.map((d) => d.toISOString()), [
    '2026-10-13T00:00:10.000Z', '2026-10-13T00:00:20.000Z', '2026-10-13T00:00:30.000Z',
  ]);
});

test('FR-WEBCRON-002 AC-3: 타임존 기준으로 다음 실행 시각을 계산한다', () => {
  const from = new Date('2026-10-12T20:00:00Z'); // 서울 기준 10-13 05:00
  const seoul = nextRuns('0 9 * * *', 'Asia/Seoul', 1, from)[0];
  const utc = nextRuns('0 9 * * *', 'UTC', 1, from)[0];
  assert.equal(seoul.toISOString(), '2026-10-13T00:00:00.000Z');
  assert.equal(utc.toISOString(), '2026-10-13T09:00:00.000Z');
});

test('FR-WEBCRON-002 AC-4: 미리보기는 5개를 돌려준다', () => {
  assert.equal(nextRuns('*/5 * * * *', 'Asia/Seoul', 5).length, 5);
});
