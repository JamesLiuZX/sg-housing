<script lang="ts">
  import { ms } from './motion';
  import { monthYear, saleWords, soldRanges, storeyTag } from './place';
  import type { Session } from './session.svelte';

  /**
   * The block's height as a scale you run a thumb along, the way a lift
   * panel reads: one tick a storey, every fifth longer, and a darker stroke
   * where flats have been resold. Beside it the storey, set large, and the
   * plain facts of the latest resale on that stretch of storeys.
   */
  let { session }: { session: Session } = $props();

  const n = $derived(session.storeys);
  const storey = $derived(session.storey);
  const sold = $derived(soldRanges(session.resales));
  const sale = $derived(session.sales[0] ? saleWords(session.sales[0]) : null);
  const others = $derived(Math.max(0, session.sales.length - 1));
  const since = $derived(session.sales.length > 1 ? monthYear(session.sales[session.sales.length - 1].month) : '');
  /** Whether the records in hand reach back to 2017, the start of the dataset, so "none" means none. */
  const complete = $derived(!!session.resales && session.resales.total <= session.resales.recent.length);

  let rail = $state<HTMLElement>();
  let h = $state(0);
  /** Clear space at each end of the rail, so the thumb never runs off it. */
  const PAD = 12;
  const y = (s: number) => (n <= 1 ? h / 2 : h - PAD - ((s - 1) / (n - 1)) * (h - 2 * PAD));

  let held = $state(false);
  let pointer: number | null = null;
  /** Which way the numeral last moved, so the new number arrives from the direction of travel. */
  let dir = $state(1);

  function set(next: number): void {
    const s = Math.min(n, Math.max(1, Math.round(next)));
    if (s === storey) return;
    dir = s > storey ? 1 : -1;
    session.setStorey(s);
  }

  function at(clientY: number): number {
    const box = rail!.getBoundingClientRect();
    const t = (box.bottom - PAD - clientY) / Math.max(1, box.height - 2 * PAD);
    return 1 + t * (n - 1);
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0 || pointer !== null) return;
    rail!.setPointerCapture(e.pointerId);
    pointer = e.pointerId;
    held = true;
    set(at(e.clientY));
  }
  function move(e: PointerEvent): void {
    if (pointer === e.pointerId) set(at(e.clientY));
  }
  function release(e: PointerEvent): void {
    if (pointer !== e.pointerId) return;
    pointer = null;
    held = false;
  }

  const STEPS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
  function key(e: KeyboardEvent): void {
    const step = STEPS[e.key];
    if (step) set(storey + step);
    else if (e.key === 'Home') set(1);
    else if (e.key === 'End') set(n);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div class="storeys">
  <div class="readout" aria-live="polite">
    <p class="cap num" aria-hidden="true">Storey</p>
    <p class="numeral" aria-label="Storey {storey}">
      {#key storey}
        <span class="digits num" style:--dir={dir} style:--ms="{ms(260)}ms">{storeyTag(storey)}</span>
      {/key}
    </p>
    {#if sale}
      <p class="sale">
        <span class="where num">{sale.where}</span>
        <span class="what num">{sale.what}</span>
        {#if others}<span class="also">{others} more on these storeys since {since}</span>{/if}
      </p>
    {:else if session.resales}
      <p class="sale quiet">{complete ? 'No resales at this height since 2017' : 'No recent resales at this height'}</p>
    {/if}
  </div>

  <div
    class="rail"
    class:held
    bind:this={rail}
    bind:clientHeight={h}
    role="slider"
    tabindex="0"
    aria-orientation="vertical"
    aria-label="Storey"
    aria-valuemin={1}
    aria-valuemax={n}
    aria-valuenow={storey}
    aria-valuetext="Storey {storey} of {n}"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={release}
    onpointercancel={release}
    onkeydown={key}
  >
    {#if h > 0}
      <svg width="48" height={h} viewBox="0 0 48 {h}" aria-hidden="true">
        <line class="spine" x1="30" x2="30" y1={y(1)} y2={y(n)} />
        {#each { length: n } as _, i (i)}
          {@const s = i + 1}
          <line class="tick" class:major={s % 5 === 0 || s === 1 || s === n} x1={s % 5 === 0 ? 20 : 24} x2="30" y1={y(s)} y2={y(s)} />
        {/each}
        {#each sold as [a, b] (a)}
          <line class="sold" x1="34" x2="34" y1={y(Math.min(n, a))} y2={y(Math.min(n, b))} />
        {/each}
        <g class="thumb" style:transform="translateY({y(storey).toFixed(1)}px)">
          <line class="lead" x1="2" x2="18" y1="0" y2="0" />
          <rect x="18" y="-7" width="24" height="14" rx="7" />
        </g>
      </svg>
    {/if}
  </div>
</div>

<style>
  .storeys {
    display: flex;
    align-items: stretch;
    gap: 2px;
    height: 100%;
    pointer-events: none;
  }

  .readout {
    align-self: center;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    max-width: 196px;
    text-shadow:
      0 0 2px var(--surface),
      0 0 6px var(--surface),
      0 0 14px rgb(var(--surface-rgb) / 0.85);
  }
  .cap {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  /* One cell for the old and new numbers, so the swap never shifts the words under it. */
  .numeral {
    display: grid;
    justify-items: end;
    overflow: hidden;
    margin: 2px -4px 0 0;
    padding-right: 4px;
  }
  .digits {
    grid-area: 1 / 1;
    font: 700 64px/0.9 var(--font-mark);
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
  .sale {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    margin-top: 6px;
    font-size: 11.5px;
    line-height: 1.3;
    animation: fade-in 240ms var(--ease-out) both;
  }
  .what {
    color: var(--ink-2);
  }
  .also,
  .quiet {
    margin-top: 3px;
    font-size: 11px;
    color: var(--ink-2);
    text-wrap: balance;
  }

  .rail {
    position: relative;
    flex: none;
    width: 48px;
    height: 100%;
    touch-action: none;
    cursor: grab;
    pointer-events: auto;
    outline: none;
    border-radius: 14px;
  }
  .rail.held {
    cursor: grabbing;
  }
  .rail:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .spine {
    stroke: var(--line);
    stroke-width: 1;
  }
  .tick {
    stroke: var(--ink-3);
    stroke-width: 1;
  }
  .tick.major {
    stroke: var(--ink-2);
  }
  .sold {
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linecap: round;
    opacity: 0.55;
  }
  .thumb {
    transition: transform 220ms var(--spring-snappy);
  }
  .held .thumb {
    transition-duration: 60ms;
  }
  .thumb rect {
    fill: var(--ink);
    stroke: var(--surface);
    stroke-width: 1.5;
    transition: transform 260ms var(--spring);
    transform-origin: 30px 0;
  }
  .held .thumb rect {
    transform: scale(1.12);
  }
  .lead {
    stroke: var(--ink);
    stroke-width: 1;
  }

  @media (min-width: 820px) {
    .digits {
      font-size: 88px;
    }
    .readout {
      max-width: 240px;
    }
    .sale {
      font-size: 12.5px;
    }
  }
</style>
