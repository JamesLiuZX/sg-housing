<script lang="ts">
  import BlockOutline from './BlockOutline.svelte';
  import FlatChooser from './FlatChooser.svelte';
  import { facingWords, factsLine, roadName, storeyTag } from './place';
  import type { Session } from './session.svelte';
  import StoreyScrubber from './StoreyScrubber.svelte';
  import SunPill from './SunPill.svelte';

  /**
   * The block stage: the real block stands in the middle, and round it only
   * what it takes to find a flat in it. Who the block is, top left. Its
   * height, as a scale at the right edge under the thumb. The side the
   * living room faces, tapped on the block (or on its outline, top right).
   * The flat type and the way in at the bottom, with the sun, which arrives
   * low in the west so the shadows say where it will fall.
   */
  let {
    session,
    wide,
    leaving,
    bottom = $bindable(0),
    left = $bindable(0),
    onenter,
    onback
  }: {
    session: Session;
    wide: boolean;
    leaving: boolean;
    bottom?: number;
    left?: number;
    onenter: () => void;
    onback: () => void;
  } = $props();

  const hit = $derived(session.place?.hit);
  const facts = $derived(factsLine(session.facts));
  const source = $derived(session.facts?.source ?? null);
  const faces = $derived(session.facade ? facingWords(session.facade.bearing) : null);

  let head = $state(0);
  let panel = $state<HTMLElement>();
  let panelW = $state(0);
  $effect(() => {
    void panelW;
    left = wide && panel ? Math.round(panel.offsetLeft + panel.offsetWidth) : 0;
  });
</script>

{#snippet who(big: boolean)}
  <div class="who" class:big>
    <button class="back glass" onclick={onback} aria-label="Back to search">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M11 4 6 9l5 5" /></svg>
      {#if big}<span>Search</span>{/if}
    </button>
    <div class="name">
      <h1 class="blk" aria-label="Block {hit?.blk}">Blk {hit?.blk}</h1>
      <p class="road">{hit ? roadName(hit.road) : ''}</p>
      {#if facts.length}
        <p class="facts">
          {#each facts as f, i (f)}{#if i}<span class="dot" aria-hidden="true">{' · '}</span>{/if}<span>{f}</span>{/each}
          {#if source}
            <a class="src" href={source.url} target="_blank" rel="noopener" aria-label="Source: {source.name}, data.gov.sg (opens in a new tab)">
              <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M3.5 2.5h5v5M8.5 2.5l-6 6" /></svg>
            </a>
          {/if}
        </p>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet cta()}
  <div class="cta">
    {#if faces}
      <p class="faces">
        <span class="k">Faces</span> <strong>{faces.point}</strong> · <span class="num">{faces.deg}°</span>
      </p>
      <button class="btn btn-primary enter" onclick={onenter} disabled={leaving}>
        Enter {storeyTag(session.storey)}
        <svg class="nudge" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M3 9h12M10 4l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    {:else}
      <p class="prompt">
        <span class="tap" aria-hidden="true"></span>
        Tap the side your living room faces.
      </p>
    {/if}
  </div>
{/snippet}

<div class="bs" class:wide class:leaving>
  {#if wide}
    <section class="panel" bind:this={panel} bind:clientWidth={panelW} data-avoid>
      {@render who(true)}
      <div class="sheet">
        <FlatChooser {session} />
        {@render cta()}
      </div>
      <p class="disclose">Computer-generated model, not a photograph</p>
    </section>
    <div class="map" data-avoid><BlockOutline {session} /></div>
    <div class="scale" data-avoid><StoreyScrubber {session} /></div>
    <div class="sun" bind:clientHeight={bottom} style:left="{left + 24}px" data-avoid><SunPill {session} /></div>
  {:else}
    <header class="top" bind:clientHeight={head} data-avoid>
      {@render who(false)}
      <p class="disclose">Computer-generated model, not a photograph</p>
    </header>
    <div class="map" data-avoid><BlockOutline {session} /></div>
    <div class="scale" style:top="{head + 20}px" style:bottom="{bottom + 12}px" data-avoid><StoreyScrubber {session} /></div>
    <div class="dock" bind:clientHeight={bottom} data-avoid>
      <SunPill {session} />
      <div class="sheet glass">
        <FlatChooser {session} />
        {@render cta()}
      </div>
    </div>
  {/if}
</div>

<style>
  .bs {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .bs > * {
    pointer-events: auto;
  }
  /* Everything steps out of the way of the push-in. */
  .bs > * {
    transition:
      opacity 300ms var(--ease-in),
      transform 420ms var(--ease-in);
  }
  .leaving > * {
    opacity: 0;
    pointer-events: none;
  }
  .leaving .top,
  .leaving .panel {
    transform: translateY(-14px);
  }
  .leaving .dock,
  .leaving .sun {
    transform: translateY(20px);
  }
  .leaving .scale,
  .leaving .map {
    transform: translateX(16px);
  }

  /* ── Who the block is ── */
  .top {
    position: absolute;
    top: calc(var(--gutter) + var(--safe-t));
    left: calc(var(--gutter) + var(--safe-l));
    right: calc(var(--gutter) + var(--safe-r));
    animation: rise-in 600ms var(--ease-out) 120ms both;
    text-shadow:
      0 0 2px var(--surface),
      0 0 6px var(--surface),
      0 0 14px rgb(var(--surface-rgb) / 0.85);
  }
  /* The way back on its own row, then the name under it, so the words get the width of the screen. */
  .who {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .back {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    text-shadow: none;
    transition: transform 180ms var(--ease-out);
  }
  .back:active {
    transform: scale(0.94);
  }
  .back path,
  .src path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .name {
    min-width: 0;
    padding-left: 2px;
  }
  /* Clear of the outline in the top right corner. */
  .top .blk,
  .top .road {
    max-width: calc(100vw - 2 * var(--gutter) - 140px);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Set large, the way the number is painted on the end wall of the block. */
  .blk {
    font: 700 44px/0.82 var(--font-mark);
    letter-spacing: 0;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .road {
    margin-top: 6px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .facts {
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-2);
  }
  .dot {
    white-space: pre;
  }
  .src {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 18px;
    margin: -4px 0;
    vertical-align: middle;
    color: var(--ink-2);
  }
  .src path {
    stroke-width: 1.4;
  }
  .disclose {
    margin-top: 8px;
    font-size: 11px;
    color: var(--ink-2);
  }

  /* ── The outline and the scale ── */
  .map {
    position: absolute;
    top: calc(var(--gutter) + var(--safe-t));
    right: calc(var(--gutter) + var(--safe-r));
    animation: rise-in 600ms var(--ease-out) 200ms both;
  }
  .scale {
    position: absolute;
    right: calc(var(--gutter) - 4px + var(--safe-r));
    animation: scale-in 640ms var(--ease-out) 260ms both;
  }
  @keyframes scale-in {
    from {
      opacity: 0;
      transform: translateX(18px);
    }
  }

  /* ── The bottom of a phone ── */
  .dock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 calc(var(--gutter) + var(--safe-r)) calc(var(--gutter) + var(--safe-b)) calc(var(--gutter) + var(--safe-l));
    animation: rise-in 640ms var(--ease-out) 180ms both;
  }
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dock .sheet {
    padding: 10px 12px 12px;
    border-radius: 24px;
  }

  /* ── The way in ── */
  .cta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 52px;
    padding-top: 10px;
    border-top: 0.5px solid var(--line-soft);
  }
  .faces {
    font-size: 14px;
    color: var(--ink-2);
    white-space: nowrap;
    animation: fade-in 300ms var(--ease-out) both;
  }
  .faces strong {
    font-weight: 600;
    color: var(--ink);
  }
  .faces .num {
    color: var(--ink);
    font-size: 13.5px;
  }
  .enter {
    animation: enter-in 520ms var(--spring) both;
  }
  @keyframes enter-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.94);
    }
  }
  .prompt {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.008em;
  }
  /* A tap, drawn as the ring a finger leaves. */
  .tap {
    position: relative;
    flex: none;
    width: 12px;
    height: 12px;
    margin-left: 4px;
    border-radius: 50%;
    background: var(--sun);
  }
  .tap::after {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    border: 1.5px solid var(--sun);
    animation: ring 1600ms var(--ease-out) infinite;
  }
  @keyframes ring {
    from {
      opacity: 0.9;
      transform: scale(0.4);
    }
    to {
      opacity: 0;
      transform: scale(1.6);
    }
  }

  /* ── A wide screen: the words take the left, as on the poster ── */
  .panel {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--gutter) + 40px + var(--safe-l));
    width: min(420px, 34vw);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 28px;
    pointer-events: none;
  }
  .panel > * {
    pointer-events: auto;
    animation: rise-in 640ms var(--ease-out) both;
  }
  .panel > :nth-child(2) {
    animation-delay: 120ms;
  }
  .panel > :nth-child(3) {
    animation-delay: 200ms;
  }
  .who.big {
    flex-direction: column;
    gap: 22px;
  }
  .big .back {
    width: auto;
    padding: 0 16px 0 11px;
    font-weight: 600;
    font-size: 14px;
  }
  .big .blk {
    font-size: clamp(96px, 9vw, 136px);
    margin-left: -0.03em;
  }
  .big .road {
    margin-top: 12px;
    font-size: 22px;
  }
  .big .facts {
    margin-top: 4px;
    font-size: 14px;
  }
  .wide .disclose {
    font-size: 12px;
  }
  .wide .cta {
    justify-content: flex-start;
    gap: 18px;
  }
  .wide .map {
    top: calc(var(--gutter) + var(--safe-t));
  }
  /* Under the outline, and clear of the sun at the bottom. */
  .wide .scale {
    top: calc(var(--gutter) + var(--safe-t) + 214px);
    bottom: calc(var(--gutter) + var(--safe-b) + 96px);
    right: calc(var(--gutter) + 8px + var(--safe-r));
  }
  .sun {
    position: absolute;
    right: calc(var(--gutter) + 300px);
    bottom: calc(var(--gutter) + var(--safe-b));
    max-width: 440px;
    margin: 0 auto;
    animation: rise-in 640ms var(--ease-out) 240ms both;
  }
</style>
