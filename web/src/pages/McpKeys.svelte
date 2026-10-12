<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.ts';
  import { fullTime } from '../lib/format.ts';
  import { notify } from '../lib/state.svelte.ts';
  import type { McpKey } from '../lib/types.ts';

  let keys = $state<McpKey[]>([]);
  let loaded = $state(false);
  let name = $state('');
  let nameError = $state('');
  let issuing = $state(false);
  let issued = $state<{ key: string; name: string } | null>(null);

  const endpoint = `${location.origin}/mcp`;
  const shownKey = $derived(issued?.key ?? '<발급한 키>');
  const cliExample = $derived(`claude mcp add --transport http webcron ${endpoint} --header "Authorization: Bearer ${shownKey}"`);
  const jsonExample = $derived(JSON.stringify({
    mcpServers: { webcron: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${shownKey}` } } },
  }, null, 2));

  async function load() {
    try {
      keys = (await api<{ items: McpKey[] }>('GET', '/api/mcp-keys')).items;
    } catch (e) {
      notify((e as Error).message);
    } finally {
      loaded = true;
    }
  }
  onMount(load);

  async function issue(e: SubmitEvent) {
    e.preventDefault();
    issuing = true;
    nameError = '';
    try {
      const r = await api<{ key: string; item: McpKey }>('POST', '/api/mcp-keys', { name });
      issued = { key: r.key, name: r.item.name };
      name = '';
      await load();
    } catch (err) {
      const ae = err as ApiError;
      nameError = ae.errors?.name ?? ae.message;
    } finally {
      issuing = false;
    }
  }

  async function revoke(k: McpKey) {
    if (!confirm(`‘${k.name}’ 키를 폐기할까요? 이 키를 쓰는 MCP 클라이언트는 바로 연결이 끊깁니다.`)) return;
    try {
      await api('DELETE', `/api/mcp-keys/${k.id}`);
      notify(`‘${k.name}’ 키를 폐기했습니다.`);
      if (issued && k.prefix === issued.key.slice(0, 12)) issued = null;
      await load();
    } catch (e) {
      notify((e as Error).message);
    }
  }

  // 복사한 버튼은 잠시 '복사됨'으로 바뀐다 (시안과 같은 동작).
  let copied = $state('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(value: string, which: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = which;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = ''), 1200);
    } catch {
      notify('복사하지 못했습니다. 직접 선택해서 복사하세요.');
    }
  }

  const usageExample = `사용자: 매주 월요일 9시에 리포트 웹훅 호출하는 작업 만들어 줘
→ create_job {
    "name": "주간 리포트 호출",
    "cron": "0 9 * * 1",
    "type": "webhook",
    "webhook": { "method": "POST",
                 "url": "https://report.internal/run" }
  }`;
</script>

<main class="wrap">
  <div class="head">
    <div>
      <h1>MCP</h1>
      <p>MCP 클라이언트(Claude Code 등)가 작업을 조회·생성·삭제할 수 있도록 키를 발급합니다.</p>
    </div>
  </div>

  <div class="alert alert-warn" role="note">
    MCP 키가 있으면 이 서버에서 CLI 명령을 실행하는 작업도 만들 수 있습니다. 키는 비밀번호처럼 보관하고, 쓰지 않는 키는 폐기하세요.
  </div>

  <div class="split">
    <div class="main-col" style="display:flex;flex-direction:column;gap:24px">
      <section class="card" aria-label="키 발급">
        <div class="card-h"><h2>키 발급</h2></div>
        <form class="card-b" onsubmit={issue} novalidate style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px">
          <label class="field" style="flex:1 1 260px">키 이름
            <input class="input" maxlength="100" placeholder="예: 내 노트북 Claude Code" bind:value={name} aria-invalid={!!nameError} />
            {#if nameError}<span class="err-text">{nameError}</span>{/if}
          </label>
          <button class="btn btn-primary btn-lg" type="submit" disabled={issuing || !name.trim()}>{issuing ? '발급 중…' : '키 발급'}</button>
        </form>

        {#if issued}
          <div class="card-b" style="border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px">
            <div class="alert alert-warn" role="status">‘{issued.name}’ 키를 발급했습니다. 이 키는 지금 한 번만 표시됩니다. 바로 복사해 두세요.</div>
            <div class="keybox">
              <code>{issued.key}</code>
              <button class="btn" type="button" onclick={() => copy(issued!.key, 'key')}>{copied === 'key' ? '복사됨' : '키 복사'}</button>
            </div>
          </div>
        {/if}
      </section>

      <section class="card" aria-label="MCP 등록 방법">
        <div class="card-h"><h2>MCP 등록 방법</h2></div>
        <div class="card-b" style="display:flex;flex-direction:column;gap:6px">
          <dl class="meta">
            <dt>엔드포인트</dt><dd class="mono">{endpoint}</dd>
            <dt>전송 방식</dt><dd>Streamable HTTP</dd>
            <dt>인증 헤더</dt><dd class="mono">Authorization: Bearer {'<'}키{'>'}</dd>
          </dl>
          <div class="out-h"><span>Claude Code</span><button class="btn" type="button" onclick={() => copy(cliExample, 'cli')}>{copied === 'cli' ? '복사됨' : '복사'}</button></div>
          <pre class="out">{cliExample}</pre>
          <div class="out-h"><span>.mcp.json</span><button class="btn" type="button" onclick={() => copy(jsonExample, 'json')}>{copied === 'json' ? '복사됨' : '복사'}</button></div>
          <pre class="out">{jsonExample}</pre>
          <p class="hint" style="margin:8px 0 0">AI 도구에 새 MCP 서버를 등록하기 전에 사내 정보보호팀 승인 절차를 확인하세요.</p>
        </div>
      </section>
    </div>

    <aside class="side-col card" aria-label="제공 도구">
      <div class="card-h"><h2>제공 도구</h2></div>
      <div class="card-b">
        <dl class="tools">
          <dt>list_jobs</dt><dd>모든 작업과 다음 실행 시각, 마지막 결과를 조회합니다.</dd>
          <dt>create_job</dt><dd>CLI 또는 웹훅 작업을 만들고 바로 일정에 등록합니다. 입력 검증은 웹 화면과 같습니다.</dd>
          <dt>delete_job</dt><dd>ID로 작업을 삭제합니다. 실행 이력은 남습니다.</dd>
        </dl>
        <div class="out-h"><span>사용 예</span></div>
        <pre class="out">{usageExample}</pre>
      </div>
    </aside>
  </div>

  <section class="card" aria-label="발급된 키">
    <div class="card-h"><h2>발급된 키</h2></div>
    <div class="tbl-box">
      <table style="min-width:720px">
        <thead><tr><th>이름</th><th>키 접두사</th><th>발급</th><th>마지막 사용</th><th>상태</th><th style="text-align:right">동작</th></tr></thead>
        <tbody>
          {#each keys as k (k.id)}
            <tr class:off={!!k.revokedAt}>
              <td style="font-weight:600">{k.name}</td>
              <td class="mono" style="font-size:13px">{k.prefix}…</td>
              <td class="mono" style="font-size:13px;white-space:nowrap">{fullTime(k.createdAt)}</td>
              <td class="mono" style="font-size:13px;white-space:nowrap">{k.lastUsedAt ? fullTime(k.lastUsedAt) : '사용 기록 없음'}</td>
              <td>
                {#if k.revokedAt}<span class="badge b-interrupted">폐기됨</span>{:else}<span class="badge b-success">사용 중</span>{/if}
              </td>
              <td style="text-align:right">
                {#if !k.revokedAt}<button class="btn btn-danger" type="button" onclick={() => revoke(k)}>폐기</button>{/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="6" class="empty">{loaded ? '발급된 키가 없습니다.' : '불러오는 중…'}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>
