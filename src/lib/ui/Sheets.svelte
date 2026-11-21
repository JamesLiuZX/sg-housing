<script lang="ts">
  import type { Component } from 'svelte';
  import type { Viewer } from '../engine/Viewer';
  import Sheet from './Sheet.svelte';
  import type { Session, SheetName } from './session.svelte';
  import MethodSheet from './sheets/MethodSheet.svelte';
  import NearbySheet from './sheets/NearbySheet.svelte';
  import RuleSheet from './sheets/RuleSheet.svelte';
  import SalesSheet from './sheets/SalesSheet.svelte';
  import ShareSheet from './sheets/ShareSheet.svelte';
  import ShortlistSheet from './sheets/ShortlistSheet.svelte';
  import YearSheet from './sheets/YearSheet.svelte';

  /**
   * The switchboard for everything that opens in the sheet. One sheet at a
   * time, named by session.sheet; set it to open one, clear it to close.
   * Each sheet's content lives in its own file under ./sheets.
   */
  let { session, viewer }: { session: Session; viewer: Viewer | null } = $props();

  type Content = Component<{ session: Session; viewer: Viewer | null }>;
  const SHEETS: Record<SheetName, { title: string; content: Content }> = {
    share: { title: 'Share', content: ShareSheet },
    sales: { title: 'Sales in this block', content: SalesSheet },
    nearby: { title: 'Nearby', content: NearbySheet },
    year: { title: 'Sun through the year', content: YearSheet },
    rule: { title: 'The rule in full', content: RuleSheet },
    shortlist: { title: 'Shortlist', content: ShortlistSheet },
    method: { title: 'How Blk works', content: MethodSheet }
  };

  // The sheet keeps its content while it slides away, so it does not empty on the way out.
  let last = $state<SheetName>('share');
  $effect(() => {
    if (session.sheet) last = session.sheet;
  });
  const shown = $derived(SHEETS[session.sheet ?? last]);
  const Content = $derived(shown.content);
</script>

<Sheet open={session.sheet !== null} title={shown.title} onclose={() => (session.sheet = null)}>
  <Content {session} {viewer} />
</Sheet>
