<script lang="ts">
  import Pager from '../components/Pager.svelte';
  import { api, qs } from '../lib/api.ts';
  import { auditSummary, dateEndExclusive, dateStart, EVENTS, eventLabel, fullTime, shortTime } from '../lib/format.ts';
  import { t } from '../lib/i18n.svelte.ts';
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
      <h1>{t('audit.title')}</h1>
      <p>{t('audit.subtitle', { days: session.me?.logRetentionDays ?? 30 })}</p>
    </div>
  </div>
  <div class="split">
    <section class="card main-col" aria-label={t('audit.listAria')}>
      <div class="filters">
        <label class="field" style="flex:1 1 220px">{t('audit.event')}
          <select class="input" bind:value={event} onchange={resetPage}>
            <option value="">{t('audit.allEvents')}</option>
            {#each EVENTS as v (v)}<option value={v}>{eventLabel(v)} ({v})</option>{/each}
          </select>
        </label>
        <label class="field" style="flex:0 1 160px">{t('runs.from')}<input class="input" type="date" bind:value={from} onchange={resetPage} /></label>
        <label class="field" style="flex:0 1 160px">{t('runs.to')}<input class="input" type="date" bind:value={to} onchange={resetPage} /></label>
      </div>
      <div class="tbl-box">
        <table style="min-width:760px">
          <thead><tr><th>{t('audit.colTime')}</th><th>{t('audit.colEvent')}</th><th>{t('audit.colTarget')}</th><th>{t('audit.colIp')}</th><th>{t('audit.colSummary')}</th></tr></thead>
          <tbody>
            {#each page.items as a (a.id)}
              <tr class:sel={a.id === selectedId}>
                <td class="mono" style="font-size:13px;white-space:nowrap">{shortTime(a.at)}</td>
                <td>
                  <button type="button" class="linkbtn" onclick={() => (selectedId = a.id)}>{eventLabel(a.event)}</button>
                  <span class="t-sub"><span class="ev">{a.event}</span></span>
                </td>
                <td>{a.jobName ?? '—'}</td>
                <td class="mono" style="font-size:13px">{a.ip ?? '—'}</td>
                <td style="color:var(--text-2)">{auditSummary(a)}</td>
              </tr>
            {:else}
              <tr><td colspan="5" class="empty">{loaded ? t('audit.empty') : t('common.loading')}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={page.page} pageSize={page.pageSize} total={page.total} onpage={(p) => (pageNo = p)} />
    </section>

    <aside class="card side-col" aria-label={t('audit.detailAria')}>
      {#if selected}
        <div class="card-h"><h2>{eventLabel(selected.event)}</h2><span class="ev">{selected.event}</span></div>
        <div class="card-b">
          <dl class="meta">
            <dt>{t('audit.time')}</dt><dd class="mono">{fullTime(selected.at)}</dd>
            <dt>{t('audit.target')}</dt><dd>{selected.jobName ?? '—'}{selected.jobId ? ` (#${selected.jobId})` : ''}</dd>
            <dt>{t('audit.ip')}</dt><dd class="mono">{selected.ip ?? '—'}</dd>
            {#if selected.detail?.via}
              <dt>{t('audit.via')}</dt><dd>{selected.detail.via === 'mcp' ? t('audit.viaMcp', { key: String(selected.detail.mcpKey) }) : t('audit.viaWeb')}</dd>
            {/if}
            <dt>{t('audit.summary')}</dt><dd>{auditSummary(selected) || '—'}</dd>
          </dl>
          {#if changes}
            <div class="out-h"><span>{t('audit.changes')}</span><span class="hint">{t('audit.maskHint')}</span></div>
            <div class="tbl-box">
              <table class="diff">
                <thead><tr><th>{t('audit.field')}</th><th>{t('audit.before')}</th><th>{t('audit.after')}</th></tr></thead>
                <tbody>
                  {#each changes as c (c.field)}
                    <tr><td class="mono">{c.field}</td><td class="mono old">{c.before ?? '—'}</td><td class="mono new">{c.after ?? '—'}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else if snapshot}
            <div class="out-h"><span>{t('audit.snapshot')}</span><span class="hint">{t('audit.maskHint')}</span></div>
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
        <div class="card-b" style="color:var(--muted)">{t('audit.selectHint')}</div>
      {/if}
    </aside>
  </div>
</main>
