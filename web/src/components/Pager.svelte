<script lang="ts">
  import { t } from '../lib/i18n.svelte.ts';

  let { page, pageSize, total, onpage }: { page: number; pageSize: number; total: number; onpage: (p: number) => void } = $props();
  const last = $derived(Math.max(1, Math.ceil(total / pageSize)));
  const from = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
  const to = $derived(Math.min(total, page * pageSize));
</script>

<div class="pager">
  <span>{t('pager.range', { from: from.toLocaleString(), to: to.toLocaleString(), total: total.toLocaleString() })}</span>
  <div class="inline">
    <button class="btn" type="button" disabled={page <= 1} onclick={() => onpage(page - 1)}>{t('common.prev')}</button>
    <button class="btn" type="button" disabled={page >= last} onclick={() => onpage(page + 1)}>{t('common.next')}</button>
  </div>
</div>
