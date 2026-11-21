<script lang="ts">
  /**
   * Where a fact comes from. Every figure Blk shows that it did not compute
   * from geometry carries one of these directly under it: who published it,
   * a link to the record, and how fresh it is. Same words, same place, every
   * time, so a reader learns to look for it.
   *
   *   <Source by="HDB" via="data.gov.sg" href="https://data.gov.sg/…" asOf="Oct 2026" />
   *   → Source: HDB via data.gov.sg · Oct 2026
   */
  let {
    by,
    via,
    href,
    asOf,
    note
  }: {
    /** The body that owns the fact: "HDB", "OneMap", "CEA". */
    by: string;
    /** The service it was read through, if different: "data.gov.sg". */
    via?: string;
    /** The record or dataset page. */
    href?: string;
    /** How fresh: "Oct 2026", "18 Nov 2026". */
    asOf?: string;
    /** A short qualifier: "typical for this flat type". */
    note?: string;
  } = $props();

  const name = $derived(via ? `${by} via ${via}` : by);
</script>

<p class="source">
  Source:
  {#if href}<a {href} target="_blank" rel="noopener noreferrer">{name}</a>{:else}{name}{/if}{#if asOf}<span aria-hidden="true"> · </span>{asOf}{/if}{#if note}<span aria-hidden="true"> · </span>{note}{/if}
</p>

<style>
  .source {
    margin: 6px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    letter-spacing: 0.01em;
    color: var(--ink-2);
  }
  a {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: var(--ink-3);
    text-underline-offset: 2px;
  }
  a:hover {
    text-decoration-color: currentColor;
  }
</style>
