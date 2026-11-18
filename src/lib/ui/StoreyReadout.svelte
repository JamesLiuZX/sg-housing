<script lang="ts">
  import { untrack } from 'svelte';
  import { ms } from './motion';
  import { monthYear, saleWords, storeyTag } from './place';
  import type { Session } from './session.svelte';

  /**
   * The storey the scale is on, set large the way a lift panel shows it, and
   * beside it the plain facts of the latest resale on that stretch of
   * storeys. It sits at the foot of the scale, with the controls, so neither
   * the number nor the facts are ever read through the block.
   */
  let { session }: { session: Session } = $props();

  const storey = $derived(session.storey);
  const sale = $derived(session.sales[0] ? saleWords(session.sales[0]) : null);
  const others = $derived(Math.max(0, session.sales.length - 1));
  const since = $derived(session.sales.length > 1 ? monthYear(session.sales[session.sales.length - 1].month) : '');
  /** Whether the records in hand reach back to 2017, the start of the dataset, so "none" means none. */
  const complete = $derived(!!session.resales && session.resales.total <= session.resales.recent.length);

  /** Which way the storey last moved, so the new number arrives from the direction of travel, from the scale or the block alike. */
  let dir = $state(1);
  // svelte-ignore state_referenced_locally
  let last = session.storey;
  $effect.pre(() => {
    const s = storey;
    untrack(() => {
      if (s === last) return;
      dir = s > last ? 1 : -1;
      last = s;
    });
  });
</script>

<div class="readout" aria-live="polite">
  {#if sale}
    <p class="sale">
      <span class="where num">{sale.where}</span>
      <span class="what num">{sale.what}</span>
      {#if others}<span class="also">{others} more on these storeys since {since}</span>{/if}
    </p>
  {:else if session.resales}
    <p class="sale quiet">{complete ? 'No resales at this height since 2017' : 'No recent resales at this height'}</p>
  {/if}
  <div class="storey">
    <p class="cap num" aria-hidden="true">Storey</p>
    <p class="numeral" aria-label="Storey {storey}">
      {#key storey}
        <span class="digits num" style:--dir={dir} style:--ms="{ms(260)}ms">{storeyTag(storey)}</span>
      {/key}
    </p>
  </div>
</div>

<style>
  /* The facts, then the number at the right, under the scale's rail. It keeps its width; whatever shares its row gives way. */
  .readout {
    flex: none;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    gap: 12px;
    pointer-events: none;
    text-shadow:
      0 0 2px var(--surface),
      0 0 6px var(--surface),
      0 0 14px rgb(var(--surface-rgb) / 0.85);
  }
  .sale {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 0;
    padding-bottom: 2px;
    font-size: 11.5px;
    line-height: 1.3;
    text-align: right;
    animation: fade-in 240ms var(--ease-out) both;
  }
  .where,
  .what {
    white-space: nowrap;
  }
  .what {
    color: var(--ink-2);
  }
  .also,
  .quiet {
    font-size: 11px;
    color: var(--ink-2);
    text-wrap: balance;
  }
  .storey {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .cap {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  /* One cell for the old and new numbers, so the swap never shifts what is beside it. */
  .numeral {
    display: grid;
    justify-items: end;
    overflow: hidden;
    margin: 1px -4px 0 0;
    padding-right: 4px;
  }
  .digits {
    grid-area: 1 / 1;
    font: 700 44px/0.9 var(--font-mark);
    letter-spacing: -0.01em;
    font-feature-settings: 'tnum' 1;
    animation: storey-in var(--ms, 260ms) var(--spring-snappy) both;
  }
  @keyframes storey-in {
    from {
      opacity: 0;
      transform: translateY(calc(var(--dir) * 38%));
    }
  }

  @media (min-width: 820px) {
    .readout {
      gap: 14px;
    }
    .sale {
      font-size: 12px;
    }
    .digits {
      font-size: 64px;
    }
  }
</style>
