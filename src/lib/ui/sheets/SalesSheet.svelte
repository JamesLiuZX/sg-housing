<script lang="ts">
  import type { Viewer } from '../../engine/Viewer';
  import type { Session } from '../session.svelte';

  /**
   * Sales in this block. Past sales in this block for this flat type, the lease left, and how an asking price compares.
   *
   * Shown inside the shared Sheet by Sheets.svelte, which supplies the title
   * and the way to close. This file is the whole of the sheet's content.
   */
  let { session, viewer }: { session: Session; viewer: Viewer | null } = $props();
  void session;
  void viewer;
</script>

<p class="soon">Not built yet.</p>

<style>
  .soon {
    margin: 8px 0 12px;
    color: var(--ink-2);
  }
</style>
