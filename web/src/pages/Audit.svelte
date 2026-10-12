<script lang="ts">
  import Pager from '../components/Pager.svelte';
  import { api, qs } from '../lib/api.ts';
  import { auditSummary, dateEndExclusive, dateStart, EVENT_LABEL, fullTime, shortTime } from '../lib/format.ts';
  import { notify, session } from '../lib/state.svelte.ts';
  import type { AuditEntry, Page } from '../lib/types.ts';

  interface Change { field: string; before: string | null; after: string | null }

  let page = $state<Page<AuditEntry>>({ items: [], total: 0, page: 1, pageSize: 50 });
  let loaded = $state(false);
  let event = $state('');
  let from = $state('');
  let to = $state('');
  let pageNo = $state(1);
  let selectedId = $state<number | null>(null);
  const selected = $derived(page.items.find((a) => a.id === selectedId) ?? null);
  const changes = $derived((selected?.detail?.changes as Change[] | undefined) ?? null);
  const snapshot = $derived((selected?.detail?.job as Record<string, string> | undefined) ?? null);

  $effect(() => {
    void [event, from, to, pageNo];
    (async () => {
      try {
        page = await api<Page<AuditEntry>>('GET', `/api/audit${qs({ event, from: dateStart(from), to: dateEndExclusive(to), page: pageNo })}`);
        if (!page.items.some((a) => a.id === selectedId)) selectedId = page.items[0]?.id ?? null;
      } catch (e) {
        notify((e as Error).message);
      } finally {
        loaded = true;
      }
    })();
  });

  function resetPage() { pageNo = 1; }
</script>

<main class="wrap">
  <div class="head">
    <div>
      <h1>감사 로그</h1>
      <p>감사 로그는 수정하거나 삭제할 수 없습니다. 보관 기간({session.me?.logRetentionDays ?? 30}일)이 지나면 자동으로 정리됩니다.</p>
    </div>
  </div>
  <div class="split">
    <section class="card main-col" aria-label="감사 로그 목록">
      <div class="filters">
        <label class="field" style="flex:1 1 220px">이벤트
          <select class="input" bind:value={event} onchange={resetPage}>
            <option value="">전체 이벤트</option>
            {#each Object.entries(EVENT_LABEL) as [v, l] (v)}<option value={v}>{l} ({v})</option>{/each}
          </select>
        </label>
        <label class="field" style="flex:0 1 160px">시작일<input class="input" type="date" bind:value={from} onchange={resetPage} /></label>
        <label class="field" style="flex:0 1 160px">종료일<input class="input" type="date" bind:value={to} onchange={resetPage} /></label>
      </div>
      <div class="tbl-box">
        <table style="min-width:760px">
          <thead><tr><th>시각</th><th>이벤트</th><th>대상</th><th>요청 IP</th><th>요약</th></tr></thead>
          <tbody>
            {#each page.items as a (a.id)}
              <tr class:sel={a.id === selectedId}>
                <td class="mono" style="font-size:13px;white-space:nowrap">{shortTime(a.at)}</td>
                <td>
                  <button type="button" class="linkbtn" onclick={() => (selectedId = a.id)}>{EVENT_LABEL[a.event] ?? a.event}</button>
                  <span class="t-sub"><span class="ev">{a.event}</span></span>
                </td>
                <td>{a.jobName ?? '—'}</td>
                <td class="mono" style="font-size:13px">{a.ip ?? '—'}</td>
                <td style="color:var(--text-2)">{auditSummary(a)}</td>
              </tr>
            {:else}
              <tr><td colspan="5" class="empty">{loaded ? '조건에 맞는 기록이 없습니다.' : '불러오는 중…'}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={page.page} pageSize={page.pageSize} total={page.total} onpage={(p) => (pageNo = p)} />
    </section>

    <aside class="card side-col" aria-label="감사 로그 상세">
      {#if selected}
        <div class="card-h"><h2>{EVENT_LABEL[selected.event] ?? selected.event}</h2><span class="ev">{selected.event}</span></div>
        <div class="card-b">
          <dl class="meta">
            <dt>시각</dt><dd class="mono">{fullTime(selected.at)}</dd>
            <dt>대상</dt><dd>{selected.jobName ?? '—'}{selected.jobId ? ` (#${selected.jobId})` : ''}</dd>
            <dt>요청 IP</dt><dd class="mono">{selected.ip ?? '—'}</dd>
            {#if selected.detail?.via}
              <dt>경로</dt><dd>{selected.detail.via === 'mcp' ? `MCP · ${selected.detail.mcpKey}` : '웹 화면'}</dd>
            {/if}
            <dt>요약</dt><dd>{auditSummary(selected) || '—'}</dd>
          </dl>
          {#if changes}
            <div class="out-h"><span>변경 내용</span><span class="hint">헤더·환경 변수 값은 *** 로 가림</span></div>
            <div class="tbl-box">
              <table class="diff">
                <thead><tr><th>필드</th><th>변경 전</th><th>변경 후</th></tr></thead>
                <tbody>
                  {#each changes as c (c.field)}
                    <tr><td class="mono">{c.field}</td><td class="mono old">{c.before ?? '—'}</td><td class="mono new">{c.after ?? '—'}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else if snapshot}
            <div class="out-h"><span>작업 내용</span><span class="hint">헤더·환경 변수 값은 *** 로 가림</span></div>
            <div class="tbl-box">
              <table class="diff">
                <tbody>
                  {#each Object.entries(snapshot) as [k, v] (k)}
                    <tr><td class="mono">{k}</td><td class="mono">{v || '—'}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {:else}
        <div class="card-b" style="color:var(--muted)">목록에서 항목을 선택하면 상세 내용이 나타납니다.</div>
      {/if}
    </aside>
  </div>
</main>
