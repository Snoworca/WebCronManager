<script lang="ts">
  import { statusLabel } from '../lib/format.ts';
  import type { RunStatus } from '../lib/types.ts';

  let { status, label }: { status: RunStatus | 'none'; label?: string } = $props();
</script>

<span class="badge b-{status}">{label ?? statusLabel(status)}</span>
