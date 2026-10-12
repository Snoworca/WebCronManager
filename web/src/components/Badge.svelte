<script lang="ts">
  import { STATUS_LABEL } from '../lib/format.ts';
  import type { RunStatus } from '../lib/types.ts';

  let { status, label }: { status: RunStatus | 'none'; label?: string } = $props();
</script>

<span class="badge b-{status}">{label ?? (status === 'none' ? '기록 없음' : STATUS_LABEL[status])}</span>
