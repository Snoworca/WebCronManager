<script lang="ts">
  let { page, pageSize, total, onpage }: { page: number; pageSize: number; total: number; onpage: (p: number) => void } = $props();
  const last = $derived(Math.max(1, Math.ceil(total / pageSize)));
  const from = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
  const to = $derived(Math.min(total, page * pageSize));
</script>

<div class="pager">
  <span>{from.toLocaleString()}–{to.toLocaleString()} / {total.toLocaleString()}건</span>
  <div class="inline">
    <button class="btn" type="button" disabled={page <= 1} onclick={() => onpage(page - 1)}>이전</button>
    <button class="btn" type="button" disabled={page >= last} onclick={() => onpage(page + 1)}>다음</button>
  </div>
</div>
