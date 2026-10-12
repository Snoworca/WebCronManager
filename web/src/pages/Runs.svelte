<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '../components/Badge.svelte';
  import Icon from '../components/Icon.svelte';
  import Pager from '../components/Pager.svelte';
  import { api, qs } from '../lib/api.ts';
  import { dateEndExclusive, dateStart, fullTime, runCode, runDuration, shortTime } from '../lib/format.ts';
  import { notify, route, session } from '../lib/state.svelte.ts';
  import type { Job, Page, Run } from '../lib/types.ts';

  let jobs = $state<Job[]>([]);
  let page = $state<Page<Run>>({ items: [], total: 0, page: 1, pageSize: 50 });
  let loaded = $state(false);
  let jobId = $state(route.query.get('jobId') ?? '');
  let status = $state('');
  let from = $state('');
  let to = $state('');
  let pageNo = $state(1);
  let selectedId = $state<number | null>(route.query.get('run') ? Number(route.query.get('run')) : null);
  let detail = $state<Run | null>(null);
  let stopping = $state(false);
  let now = $state(Date.now());

  async function loadList() {
    try {
      page = await api<Page<Run>>('GET', `/api/runs${qs({ jobId, status, from: dateStart(from), to: dateEndExclusive(to), page: pageNo })}`);
      if (selectedId === null && page.items.length) selectedId = page.items[0].id;
    } catch (e) {
      notify((e as Error).message);
    } finally {
      loaded = true;
    }
  }

  async function loadDetail() {
    if (selectedId === null) { detail = null; return; }
    try {
      detail = await api<Run>('GET', `/api/runs/${selectedId}`);
    } catch {
      detail = null;
    }
  }

  // 필터나 페이지가 바뀌면 목록을 다시 읽는다.
  $effect(() => {
    void [jobId, status, from, to, pageNo];
    loadList();
  });
  $effect(() => {
    void selectedId;
    loadDetail();
  });

  onMount(() => {
    api<{ items: Job[] }>('GET', '/api/jobs').then((r) => (jobs = r.items)).catch(() => {});
    // FR-WEBCRON-008 AC-4: 실행 중인 항목은 5초 이내에 결과가 반영된다.
    const t = setInterval(() => {
      now = Date.now();
      loadList();
      if (detail?.status === 'running') loadDetail();
    }, 3000);
    return () => clearInterval(t);
  });

  function resetPage() { pageNo = 1; }

  async function stop() {
    if (!detail || !confirm(`‘${detail.jobName}’ 실행 #${detail.id}을(를) 중지할까요?`)) return;
    stopping = true;
    try {
      await api('POST', `/api/runs/${detail.id}/cancel`);
      notify('실행을 중지했습니다.');
      setTimeout(() => { loadDetail(); loadList(); }, 400);
    } catch (e) {
      notify((e as Error).message);
      loadDetail();
    } finally {
      stopping = false;
    }
  }
</script>

<main class="wrap">
  <div class="head">
    <div>
      <h1>실행 이력</h1>
      <p>최근 {session.me?.logRetentionDays ?? 30}일 실행 기록입니다. 보관 기간이 지난 기록은 자동으로 정리됩니다.</p>
    </div>
  </div>
  <div class="split">
    <section class="card main-col" aria-label="실행 목록">
      <div class="filters">
        <label class="field" style="flex:1 1 200px">작업
          <select class="input" bind:value={jobId} onchange={resetPage}>
            <option value="">전체 작업</option>
            {#each jobs as j (j.id)}<option value={String(j.id)}>{j.name}</option>{/each}
          </select>
        </label>
        <label class="field" style="flex:0 1 150px">결과
          <select class="input" bind:value={status} onchange={resetPage}>
            <option value="">전체</option><option value="success">성공</option><option value="failure">실패</option>
            <option value="timeout">시간 초과</option><option value="running">실행 중</option>
            <option value="canceled">중지됨</option><option value="interrupted">중단됨</option>
          </select>
        </label>
        <label class="field" style="flex:0 1 160px">시작일<input class="input" type="date" bind:value={from} onchange={resetPage} /></label>
        <label class="field" style="flex:0 1 160px">종료일<input class="input" type="date" bind:value={to} onchange={resetPage} /></label>
      </div>
      <div class="tbl-box">
        <table style="min-width:760px">
          <thead><tr><th>결과</th><th>작업</th><th>실행 방식</th><th>시작</th><th>소요</th><th>코드</th></tr></thead>
          <tbody>
            {#each page.items as r (r.id)}
              <tr class:sel={r.id === selectedId}>
                <td><Badge status={r.status} /></td>
                <td>
                  <button type="button" class="linkbtn" onclick={() => (selectedId = r.id)}>{r.jobName}</button>
                  <span class="t-sub mono" style="font-size:12px">#{r.id}</span>
                </td>
                <td><span class="type"><Icon name={r.jobType} />{r.trigger === 'manual' ? '수동' : '스케줄'}</span></td>
                <td class="mono" style="font-size:13px;white-space:nowrap">{shortTime(r.startedAt)}</td>
                <td style="white-space:nowrap">{runDuration(r, now)}</td>
                <td class="mono" style="font-size:13px;white-space:nowrap">{runCode(r)}</td>
              </tr>
            {:else}
              <tr><td colspan="6" class="empty">{loaded ? '조건에 맞는 실행 기록이 없습니다.' : '불러오는 중…'}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={page.page} pageSize={page.pageSize} total={page.total} onpage={(p) => (pageNo = p)} />
    </section>

    <aside class="card side-col" aria-label="실행 상세">
      {#if detail}
        <div class="card-h"><h2>{detail.jobName}</h2><Badge status={detail.status} /></div>
        <div class="card-b">
          <dl class="meta">
            <dt>실행 ID</dt><dd class="mono">#{detail.id}</dd>
            <dt>실행 방식</dt><dd>{detail.trigger === 'manual' ? '수동' : '스케줄'}</dd>
            <dt>시작</dt><dd class="mono">{fullTime(detail.startedAt)}</dd>
            <dt>종료</dt><dd class="mono">{fullTime(detail.finishedAt)}</dd>
            <dt>소요</dt><dd>{runDuration(detail, now)}</dd>
            {#if detail.jobType === 'cli'}
              <dt>종료 코드</dt><dd class="mono">{detail.exitCode ?? '—'}</dd>
            {:else}
              <dt>최종 URL</dt><dd class="mono">{detail.finalUrl ?? '—'}</dd>
              <dt>상태 코드</dt><dd class="mono">{detail.httpStatus ?? '—'}</dd>
              <dt>리다이렉트</dt><dd>{detail.redirects ?? 0}회</dd>
              <dt>시도</dt><dd>{detail.attempts ?? '—'}회</dd>
            {/if}
            {#if detail.error}<dt>오류</dt><dd style="color:var(--bad)">{detail.error}</dd>{/if}
          </dl>
          {#if detail.status === 'running'}
            <div style="margin-top:16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px" role="status">
              <span class="hint" style="font-size:13px">끝나면 결과가 자동으로 갱신됩니다.</span>
              <button type="button" class="btn btn-danger" onclick={stop} disabled={stopping}><Icon name="stop" size={14} />실행 중지</button>
            </div>
          {/if}
          {#if detail.jobType === 'cli'}
            <div class="out-h"><span>stdout</span><span class="hint">최대 64KB 저장</span></div>
            <pre class="out">{detail.stdout || '(출력 없음)'}</pre>
            <div class="out-h"><span>stderr</span></div>
            <pre class="out">{detail.stderr || '(출력 없음)'}</pre>
          {:else}
            <div class="out-h"><span>응답 본문</span><span class="hint">최대 64KB 저장</span></div>
            <pre class="out">{detail.responseBody || '(본문 없음)'}</pre>
          {/if}
        </div>
      {:else}
        <div class="card-b" style="color:var(--muted)">목록에서 실행을 선택하면 상세 내용이 나타납니다.</div>
      {/if}
    </aside>
  </div>
</main>
