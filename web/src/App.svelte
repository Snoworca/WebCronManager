<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './components/Icon.svelte';
  import { api } from './lib/api.ts';
  import { go, notify, route, session, toast } from './lib/state.svelte.ts';
  import type { Me } from './lib/types.ts';
  import Audit from './pages/Audit.svelte';
  import JobEdit from './pages/JobEdit.svelte';
  import Jobs from './pages/Jobs.svelte';
  import Login from './pages/Login.svelte';
  import Runs from './pages/Runs.svelte';

  onMount(async () => {
    try {
      session.me = await api<Me>('GET', '/api/me');
      if (route.path === '/login') go('/jobs');
    } catch {
      session.me = null;
      go('/login');
    } finally {
      session.checked = true;
    }
  });

  const section = $derived(route.path.split('/')[1] || 'jobs');
  const editId = $derived.by(() => {
    const m = /^\/jobs\/(new|\d+)$/.exec(route.path);
    return m ? (m[1] === 'new' ? null : Number(m[1])) : undefined;
  });

  async function logout() {
    try { await api('POST', '/api/logout'); } catch (e) { notify((e as Error).message); }
    session.me = null;
    go('/login');
  }
</script>

{#if !session.checked}
  <div class="loading">불러오는 중…</div>
{:else if !session.me || route.path === '/login'}
  <Login />
{:else}
  <header class="top">
    <div class="wrap">
      <a class="brand" href="#/jobs"><Icon name="clock" size={26} stroke="#2B47C9" />WebCron</a>
      <nav class="nav" aria-label="주 메뉴">
        <a href="#/jobs" aria-current={section === 'jobs' ? 'page' : undefined}>작업</a>
        <a href="#/runs" aria-current={section === 'runs' ? 'page' : undefined}>실행 이력</a>
        <a href="#/audit" aria-current={section === 'audit' ? 'page' : undefined}>감사 로그</a>
      </nav>
      <div class="who">
        <span class="chip" title="설정 파일 WEBCRON_TIMEZONE">TZ {session.me.timezone}</span>
        <span style="color:var(--text-2)">{session.me.username}</span>
        <button class="btn" type="button" onclick={logout}>로그아웃</button>
      </div>
    </div>
  </header>

  {#key route.path + '?' + route.query.toString()}
    {#if editId !== undefined}
      <JobEdit id={editId} />
    {:else if section === 'runs'}
      <Runs />
    {:else if section === 'audit'}
      <Audit />
    {:else}
      <Jobs />
    {/if}
  {/key}
{/if}

{#if toast.text}<div class="toast" role="status">{toast.text}</div>{/if}
