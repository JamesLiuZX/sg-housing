<script lang="ts">
  import { clock } from '../sg/solar';
  import Compass from './Compass.svelte';
  import FacingGlyph from './FacingGlyph.svelte';
  import { MONTHS, MONTHS_LONG } from './format';
  import type { Session } from './session.svelte';
  import SunArc from './SunArc.svelte';
  import { sunReadout } from './sunText';

  /**
   * The Sun lens: one sheet, read top to bottom as the moment, the day it
   * belongs to, the date, and which way the flat faces. The typical flat can
   * be turned with the compass. A flat in a real block faces the side chosen
   * for it, so that is stated, not offered: turning it would make every sun
   * sentence here wrong. The summary sits beside either, where the hand on
   * the arc does not cover it.
   */
  let { session }: { session: Session } = $props();

  let months = $state<HTMLElement>();
  const KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

  /*
   * Twelve months across a phone leaves each one under 30 px wide, too narrow
   * to aim at. So the pointer treats the strip as one 44 px tall target:
   * every point on it names the month beneath, a press picks it and a drag
   * runs along the year with the thumb and the date following the finger.
   */
  let pointer: number | null = null;
  let held = $state(false);
  /** The month a mouse is over, lit as a button's hover would be. */
  let hover = $state(-1);

  function monthAt(clientX: number): number {
    const box = months!.getBoundingClientRect();
    return Math.min(11, Math.max(0, Math.floor(((clientX - box.left) / box.width) * 12)));
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0 || pointer !== null) return;
    months!.setPointerCapture(e.pointerId);
    pointer = e.pointerId;
    held = true;
    session.setMonth(monthAt(e.clientX));
  }

  function move(e: PointerEvent): void {
    if (pointer === e.pointerId) session.setMonth(monthAt(e.clientX));
    hover = e.pointerType === 'mouse' ? monthAt(e.clientX) : -1;
  }

  function release(e: PointerEvent): void {
    if (pointer !== e.pointerId) return;
    pointer = null;
    held = false;
  }

  // One tab stop for the twelve months; arrows move the choice, as in any radio group.
  function monthKey(e: KeyboardEvent): void {
    const step = KEYS[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    session.setMonth(session.month + step);
    months?.querySelectorAll<HTMLButtonElement>('button')[session.month]?.focus();
  }
</script>

<section class="sun glass" aria-label="Sun">
  <div class="readout">
    <p class="time num">{clock(session.minutes)}</p>
    <p class="when">
      <span class="date">21 {MONTHS_LONG[session.month]}</span>
      <span class="pos">{sunReadout(session.sun)}</span>
    </p>
    <button class="play" class:on={session.playing} onclick={() => session.togglePlay()} aria-label={session.playing ? 'Pause' : 'Play the day'}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path class="i-play" d="M7.2 5.1v9.8a.6.6 0 0 0 .9.5l7.6-4.9a.6.6 0 0 0 0-1L8.1 4.6a.6.6 0 0 0-.9.5Z" />
        <path class="i-pause" d="M6.4 5h2.4v10H6.4zM11.2 5h2.4v10h-2.4z" />
      </svg>
    </button>
  </div>

  <SunArc {session} />

  <div
    class="months"
    class:held
    role="radiogroup"
    aria-label="Month"
    tabindex="-1"
    bind:this={months}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={release}
    onpointercancel={release}
    onpointerleave={() => (hover = -1)}
  >
    <span class="thumb" style:transform="translateX({session.month * 100}%)" aria-hidden="true"></span>
    {#each MONTHS as m, i (m)}
      <button
        role="radio"
        aria-checked={session.month === i}
        aria-label={MONTHS_LONG[i]}
        tabindex={session.month === i ? 0 : -1}
        class:on={session.month === i}
        class:hover={hover === i}
        onclick={() => session.setMonth(i)}
        onkeydown={monthKey}>{m[0]}</button
      >
    {/each}
  </div>

  <div class="facing">
    {#if session.placed}
      <FacingGlyph {session} />
    {:else}
      <Compass {session} />
    {/if}
    <div class="words">
      {#if session.placed}
        <p class="face">
          <span class="visually-hidden">{session.facing.room}</span>
          Faces {session.facing.point} · <span class="num">{session.facing.deg}°</span>, from the side you chose
        </p>
      {:else}
        <p class="face">{session.facing.room} faces {session.facing.point} · <span class="num">{session.facing.deg}°</span></p>
      {/if}
      <p class="summary" aria-live="polite">{session.summary}</p>
    </div>
  </div>
</section>

<style>
  .sun {
    width: 100%;
    padding: 8px 14px 14px;
    border-radius: 22px;
    display: flex;
    flex-direction: column;
  }

  /* ── The moment ── */
  .readout {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: 12px;
    min-height: 48px;
  }
  .time {
    /* Wide enough for "12:00 pm", so the words beside it never shuffle while the sun moves. */
    min-width: 8ch;
    font-size: 28px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: -0.035em;
  }
  .when {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .date {
    font-weight: 600;
    font-size: 13px;
    letter-spacing: -0.005em;
  }
  .pos {
    font-size: 12px;
    color: var(--ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .play {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      background-color 220ms,
      color 220ms,
      transform 200ms var(--ease-out);
  }
  .play:active {
    transform: scale(0.92);
  }
  .play.on {
    background: var(--ink);
    color: var(--surface);
    box-shadow: none;
  }
  @media (hover: hover) {
    .play:not(.on):hover {
      background: rgb(var(--ink-rgb) / 0.06);
    }
  }
  .play path {
    fill: currentColor;
    transform-origin: 10px 10px;
    transition:
      opacity 180ms,
      transform 320ms var(--spring-snappy);
  }
  .i-pause,
  .on .i-play {
    opacity: 0;
    transform: scale(0.5);
  }
  .on .i-pause {
    opacity: 1;
    transform: none;
  }

  /* ── The month ── */
  /* 44 px tall for the finger; the 4 px below it overlap the gap above the facing row, so the sheet is no taller. */
  .months {
    position: relative;
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    height: 44px;
    margin: 0 -4px -4px;
    touch-action: none;
    cursor: pointer;
  }
  .months .thumb {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: calc(100% / 12);
    display: grid;
    place-items: center;
    pointer-events: none;
    transition: transform 460ms var(--spring-snappy);
  }
  /* Under a dragging finger the thumb keeps up rather than springing behind. */
  .months.held .thumb {
    transition-duration: 90ms;
  }
  .months .thumb::before {
    content: '';
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--ink);
  }
  .months button {
    position: relative;
    font: 600 12px/1 var(--font-ui);
    color: var(--ink-2);
    border-radius: 10px;
    transition: color 220ms;
    /* The strip takes the pointer (see monthAt); keys and screen readers still reach each month. */
    pointer-events: none;
  }
  .months button.on {
    color: var(--surface);
  }
  .months button.hover:not(.on) {
    color: var(--ink);
  }
  .months button:focus-visible {
    outline-offset: -2px;
  }

  /* ── Which way it faces, and what that means now ── */
  .facing {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    padding-top: 12px;
    border-top: 0.5px solid var(--line-soft);
  }
  .words {
    min-width: 0;
  }
  .face {
    font-size: 12px;
    color: var(--ink-2);
    line-height: 1.3;
  }
  .face .num {
    font-size: 11.5px;
  }
  .summary {
    margin-top: 2px;
    font-size: 13.5px;
    line-height: 1.32;
    letter-spacing: -0.003em;
    /* Two lines held open, so the sheet keeps its height while the sentence changes under a moving sun. */
    min-height: calc(2 * 1.32em);
    text-wrap: pretty;
  }

  @media (min-width: 820px) {
    .sun {
      padding: 10px 18px 16px;
      border-radius: 24px;
    }
    .time {
      font-size: 32px;
    }
    .date {
      font-size: 13.5px;
    }
    .summary {
      font-size: 14px;
    }
  }
</style>
