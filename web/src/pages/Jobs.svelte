<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '../components/Badge.svelte';
  import Icon from '../components/Icon.svelte';
  import { api } from '../lib/api.ts';
  import { resultLabel, runDuration, shortTime } from '../lib/format.ts';
  import { notify } from '../lib/state.svelte.ts';
  import type { Job, RunStatus, Stats } from '../lib/types.ts';

  let jobs = $state<Job[]>([]);
  let stats = $state<Stats | null>(null);
  let loaded = $state(false);
  let error = $state('');
  let q = $state('');
  let type = $state('');
  let result = $state('');
  let ran = $state<{ name: string; runId: number } | null>(null);

  async function load() {
    try {
      const [j, s] = await Promise.all([api<{ items: Job[] }>('GET', '/api/jobs'), api<Stats>('GET', '/api/stats')]);
      jobs = j.items;
      stats = s;
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  });

  const lastStatus = (j: Job): RunStatus | 'none' => (j.runningCount > 0 ? 'running' : (j.lastRun?.status ?? 'none'));

  const shown = $derived(jobs.filter((j) =>
    (!q || `${j.name} ${j.description}`.toLowerCase().includes(q.toLowerCase())) &&
    (!type || j.type === type) &&
    (!result || lastStatus(j) === result || (result === 'failure' && lastStatus(j) === 'timeout'))));

  function target(j: Job): string {
    if (j.description) return j.description;
    return j.type === 'cli' ? (j.cli?.command ?? '') : `${j.webhook?.method} ${j.webhook?.url}`;
  }

  async function toggle(j: Job) {
    try {
      const updated = await api<Job>('PATCH', `/api/jobs/${j.id}/enabled`, { enabled: !j.enabled });
      jobs = jobs.map((x) => (x.id === j.id ? updated : x));
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function runNow(j: Job) {
    try {
      const r = await api<{ runId: number }>('POST', `/api/jobs/${j.id}/run`);
      ran = { name: j.name, runId: r.runId };
      load();
    } catch (e) {
      notify((e as Error).message);
    }
  }
</script>

<main class="wrap">
  <div class="head">
    <div>
      <h1>작업</h1>
      <p>등록된 작업 {jobs.length}개 · 활성 {jobs.filter((j) => j.enabled).length}개</p>
    </div>
    <a class="btn btn-primary btn-lg" href="#/jobs/new"><Icon name="plus" size={18} />새 작업</a>
  </div>

  {#if ran}
    <div class="notice" role="status">
      <span>‘{ran.name}’ 작업을 지금 실행했습니다. 결과는 실행 이력에서 확인하세요.</span>
      <a href="#/runs?run={ran.runId}" style="font-weight:600">실행 결과 보기</a>
    </div>
  {/if}
  {#if error}<div class="alert alert-bad" role="alert">{error}</div>{/if}

  <section class="stats" aria-label="최근 24시간 요약">
    <div class="card stat"><span>최근 24시간 성공</span><b style="color:var(--ok)">{stats?.success24h ?? '—'}</b></div>
    <div class="card stat"><span>최근 24시간 실패</span><b style="color:var(--bad)">{stats?.failure24h ?? '—'}</b></div>
    <div class="card stat"><span>지금 실행 중</span><b style="color:var(--accent)">{stats?.running ?? '—'}</b></div>
    <div class="card stat"><span>활성 작업</span><b>{stats?.enabledJobs ?? '—'} <small style="font-size:16px;font-weight:500;color:var(--muted)">/ {stats?.totalJobs ?? '—'}</small></b></div>
  </section>

  <section class="card" aria-label="작업 목록">
    <div class="filters">
      <label class="field" style="flex:1 1 260px">작업 검색<input class="input" type="search" placeholder="이름 또는 설명" bind:value={q} /></label>
      <label class="field" style="flex:0 1 160px">유형
        <select class="input" bind:value={type}><option value="">전체</option><option value="cli">CLI</option><option value="webhook">웹훅</option></select>
      </label>
      <label class="field" style="flex:0 1 170px">마지막 결과
        <select class="input" bind:value={result}>
          <option value="">전체</option><option value="success">성공</option><option value="failure">실패</option>
          <option value="timeout">시간 초과</option><option value="running">실행 중</option><option value="none">기록 없음</option>
        </select>
      </label>
    </div>
    <div class="tbl-box">
      <table style="min-width:1000px">
        <thead><tr><th style="width:72px">활성</th><th>작업</th><th>유형</th><th>일정</th><th>다음 실행</th><th>마지막 결과</th><th style="text-align:right">동작</th></tr></thead>
        <tbody>
          {#each shown as j (j.id)}
            <tr class:off={!j.enabled}>
              <td><button type="button" class="sw" role="switch" aria-checked={j.enabled} aria-label="{j.name} 활성 전환" onclick={() => toggle(j)}></button></td>
              <td><a class="t-main" href="#/jobs/{j.id}">{j.name}</a><span class="t-sub mono" style="font-size:12px">{target(j)}</span></td>
              <td><span class="type"><Icon name={j.type} />{j.type === 'cli' ? 'CLI' : '웹훅'}</span></td>
              <td><span class="mono" style="font-size:13px">{j.cron}</span></td>
              <td class="mono" style="font-size:13px;white-space:nowrap">{j.enabled ? shortTime(j.nextRunAt) : '— 비활성'}</td>
              <td>
                {#if j.runningCount > 0}
                  <Badge status="running" label="실행 중 · {j.runningCount}건" />
                {:else if j.lastRun}
                  <Badge status={j.lastRun.status} label={resultLabel(j.lastRun)} />
                  <span class="t-sub" style="font-size:12px;margin-top:4px;white-space:nowrap">{shortTime(j.lastRun.startedAt)} · {runDuration(j.lastRun)}</span>
                {:else}
                  <Badge status="none" />
                {/if}
              </td>
              <td style="text-align:right;white-space:nowrap">
                <button type="button" class="btn" onclick={() => runNow(j)}><Icon name="play" size={14} />지금 실행</button>
                <a class="btn" href="#/jobs/{j.id}" style="margin-left:6px">편집</a>
              </td>
            </tr>
          {:else}
            <tr><td colspan="7" class="empty">
              {#if !loaded}불러오는 중…{:else if jobs.length === 0}등록된 작업이 없습니다. <a href="#/jobs/new">새 작업</a>을 만들어 보세요.{:else}조건에 맞는 작업이 없습니다.{/if}
            </td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>
