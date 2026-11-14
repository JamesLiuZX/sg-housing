<script lang="ts">
  import type { AddressHit } from '../data';
  import Search from './Search.svelte';

  /**
   * The poster. The flat is already on screen behind it as a line drawing;
   * this says what it is in as few words as possible, and offers the way
   * in: a block by its address, the bundled block that needs no network, or
   * the typical flat. On a phone, the poster's words step aside while the
   * field is in use, so the list has the room above the keyboard.
   */
  let {
    leaving,
    wide,
    finding,
    trouble,
    height = $bindable(0),
    onstart,
    ondemo,
    onpick
  }: {
    leaving: boolean;
    wide: boolean;
    finding: string | null;
    trouble: string | null;
    height?: number;
    onstart: () => void;
    ondemo: () => void;
    onpick: (hit: AddressHit) => void;
  } = $props();

  let seeking = $state(false);
</script>

<section class="poster" class:leaving class:wide class:seeking={seeking && !wide} bind:clientHeight={height} aria-label="Blk">
  <div class="words" aria-hidden={seeking && !wide}>
    <p class="tag num" style="--i:0">TYPICAL 4-ROOM BTO · 93 m²</p>
    <h1 class="mark" style="--i:1" aria-label="Blk">BLK</h1>
    <p class="line" style="--i:2">A showflat for every flat.</p>
    <p class="say" style="--i:3">Walk it at true scale. See where the real sun falls. Know which walls can go.</p>
  </div>
  <div class="go" style="--i:4">
    <Search {finding} {trouble} up={!wide} bind:seeking {onpick} />
  </div>
  <div class="alts" style="--i:5">
    <button class="alt" onclick={ondemo} disabled={leaving}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 17.5V3.5h7v14M12 8h3.5v9.5M3 17.5h14" />
        <path class="lit" d="M7.4 6.4h2.2M7.4 9.4h2.2M7.4 12.4h2.2" />
      </svg>
      <span>Try Blk 440A Clementi Ave 3</span>
      <svg class="nudge" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h12M10 4l5 5-5 5" /></svg>
    </button>
    <button class="alt" onclick={onstart} disabled={leaving}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 4.5h14v11H3zM10 4.5v6.2M10 13v2.5M3 10.5h4.4" />
      </svg>
      <span>Walk a typical 4-room</span>
      <svg class="nudge" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h12M10 4l5 5-5 5" /></svg>
    </button>
  </div>
  <p class="foot" style="--i:6">Computer-generated models of typical layouts, on open data from OneMap and data.gov.sg. Not affiliated with HDB.</p>
</section>

<style>
  .poster {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 56px calc(var(--gutter) + 12px + var(--safe-r)) calc(18px + var(--safe-b)) calc(var(--gutter) + 12px + var(--safe-l));
    /* The drawing fades into the paper under the words, so lines never run through type. */
    background: linear-gradient(to bottom, transparent, var(--sky-1, #f1ede5) 30%);
    pointer-events: none;
  }
  .poster > :not(.words),
  .words > * {
    pointer-events: auto;
    animation: rise-in 700ms var(--ease-out) both;
    animation-delay: calc(240ms + var(--i) * 70ms);
    transition:
      opacity 320ms var(--ease-in),
      transform 420ms var(--ease-in);
    transition-delay: calc((6 - var(--i)) * 34ms);
  }
  .poster.leaving > :not(.words),
  .poster.leaving .words > * {
    opacity: 0;
    transform: translateY(-18px);
  }
  /* Searching on a phone: the words step back and the list takes their place above the field. */
  .seeking .words > * {
    opacity: 0;
    transform: translateY(-10px);
    pointer-events: none;
    transition:
      opacity 220ms var(--ease-out),
      transform 320ms var(--ease-out);
    transition-delay: 0ms;
  }

  .tag {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--ink-2);
    margin-bottom: 2px;
  }
  .mark {
    font: 700 clamp(104px, 31vw, 168px) / 0.8 var(--font-mark);
    letter-spacing: -0.01em;
    margin: 0 0 0 -0.045em;
    /* Painted on, like the number on the side of a block. */
    color: var(--ink);
  }
  .line {
    font: 600 22px/1.2 var(--font-ui);
    letter-spacing: -0.015em;
    margin-top: 12px;
  }
  .say {
    max-width: 30ch;
    margin-top: 6px;
    color: var(--ink-2);
    font-size: 15px;
    line-height: 1.45;
  }
  .go {
    margin-top: 18px;
  }

  /* Two quiet ways in that need nothing typed. */
  .alts {
    display: flex;
    flex-direction: column;
    margin-top: 8px;
    max-width: 460px;
  }
  .alt {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 6px 0 18px;
    border-radius: 14px;
    font-size: 14.5px;
    font-weight: 500;
    letter-spacing: -0.005em;
    text-align: left;
    transition:
      background-color 160ms,
      transform 160ms var(--ease-out);
  }
  .alt + .alt {
    box-shadow: inset 0 0.5px 0 var(--line-soft);
  }
  .alt:active {
    transform: scale(0.98);
  }
  .alt span {
    flex: 1;
  }
  .alt svg {
    flex: none;
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .alt svg .lit {
    stroke: var(--sun);
    stroke-width: 1.6;
  }
  .alt .nudge {
    stroke: currentColor;
    stroke-width: 1.7;
    margin-right: 10px;
    transition: transform 260ms var(--spring-snappy);
  }
  @media (hover: hover) {
    .alt:hover {
      background: rgb(var(--ink-rgb) / 0.05);
    }
    .alt:hover .nudge {
      transform: translateX(3px);
    }
  }

  .foot {
    margin-top: 12px;
    padding: 0 18px;
    max-width: 48ch;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--ink-2);
    text-wrap: balance;
  }

  .poster.wide {
    top: 0;
    right: auto;
    width: min(640px, 44vw);
    min-width: 400px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 0 0 calc(var(--gutter) + 40px);
    background: none;
  }
  .wide .mark {
    font-size: clamp(170px, 17vw, 260px);
  }
  .wide .line {
    font-size: 30px;
    margin-top: 22px;
  }
  .wide .say {
    font-size: 17px;
    margin-top: 12px;
    max-width: 34ch;
  }
  .wide .go {
    margin-top: 30px;
  }
  .wide .alts {
    margin-top: 12px;
  }
  .wide .foot {
    margin-top: 20px;
    font-size: 12px;
  }
</style>
