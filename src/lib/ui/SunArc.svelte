<script lang="ts">
  import { clock } from '../sg/solar';
  import { T0, T1, arcPaths, arcScale, arcTrail, hourTicks } from './arc';
  import type { Session } from './session.svelte';
  import { sunIsUp } from './sunText';

  /**
   * The day drawn as the sun's real altitude against the clock, and the
   * control for it. The knob rides the curve. A press sends the sun to that
   * hour on a light spring; once the finger moves, the sun is held under it.
   */
  let { session, compact = false }: { session: Session; compact?: boolean } = $props();

  const uid = $props.id();

  let el = $state<HTMLElement>();
  let width = $state(0);
  let held = $state(false);

  /** Knob radius. The chart keeps this much clear at each end. */
  const r = $derived(compact ? 6 : 7.5);
  const height = $derived(compact ? 40 : 90);
  /** Strip under the chart for the hour labels. */
  const band = $derived(compact ? 0 : 15);
  // Compact lets the knob overhang the top at an equinox noon, so the curve keeps its height in a short strip.
  const scale = $derived(arcScale(width, r + 4, compact ? 3 : r + 3, height - band - 3));
  const paths = $derived(arcPaths(session.path, scale));
  const ticks = $derived(hourTicks(scale));

  const kx = $derived(scale.x(session.minutes));
  const ky = $derived(scale.y(session.sun.altitude));
  const up = $derived(sunIsUp(session.sun));
  const trail = $derived(arcTrail(paths.run, session.minutes, { x: kx, y: ky }));

  let pointer: { id: number; x: number; moved: boolean } | null = null;

  function minutesAt(clientX: number): number {
    const box = el!.getBoundingClientRect();
    return scale.minutes(clientX - box.left);
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0 || pointer) return;
    el!.setPointerCapture(e.pointerId);
    pointer = { id: e.pointerId, x: e.clientX, moved: false };
    held = true;
    session.scrub(minutesAt(e.clientX), false);
  }

  function move(e: PointerEvent): void {
    if (!pointer || pointer.id !== e.pointerId) return;
    // A few pixels of slack, so a tap that wobbles still glides instead of snapping.
    if (!pointer.moved && Math.abs(e.clientX - pointer.x) < 4) return;
    pointer.moved = true;
    session.scrub(minutesAt(e.clientX), true);
  }

  function release(e: PointerEvent): void {
    if (!pointer || pointer.id !== e.pointerId) return;
    pointer = null;
    held = false;
  }

  const STEPS: Record<string, number> = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10, PageUp: 60, PageDown: -60 };

  function key(e: KeyboardEvent): void {
    const step = STEPS[e.key];
    if (step) session.nudge(step);
    else if (e.key === 'Home') session.scrub(session.times.rise);
    else if (e.key === 'End') session.scrub(session.times.set);
    else return;
    e.preventDefault();
    // While walking the same keys move the camera; with the slider focused they belong to the slider.
    e.stopPropagation();
  }

  // The crescent, opening to the right. Two arcs between the same pair of points on the rim.
  const moon = $derived.by(() => {
    const a = r * 0.34;
    const b = Math.sqrt(r * r - a * a);
    return `M${a} ${-b}A${r} ${r} 0 1 0 ${a} ${b}A${r * 1.04} ${r * 1.04} 0 0 1 ${a} ${-b}Z`;
  });
</script>

<div
  class="arc"
  class:compact
  class:held
  class:night={!up}
  bind:this={el}
  bind:clientWidth={width}
  style:height="{height}px"
  role="slider"
  tabindex="0"
  aria-label="Time of day"
  aria-valuemin={T0}
  aria-valuemax={T1}
  aria-valuenow={Math.round(session.minutes)}
  aria-valuetext={clock(session.minutes)}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={release}
  onkeydown={key}
>
  {#if width > 0}
    <svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
      <defs>
        <linearGradient id="{uid}-warm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style="stop-color: var(--sun); stop-opacity: 0.3" />
          <stop offset="1" style="stop-color: var(--sun); stop-opacity: 0.04" />
        </linearGradient>
        <radialGradient id="{uid}-glow">
          <stop offset="0.2" style="stop-color: var(--sun); stop-opacity: 0.55" />
          <stop offset="1" style="stop-color: var(--sun); stop-opacity: 0" />
        </radialGradient>
        <clipPath id="{uid}-done">
          <rect x="0" y="0" width={Math.max(0, kx)} {height} />
        </clipPath>
      </defs>

      <!-- Daylight, faintly; the part of it the sun has already crossed, warm. -->
      <path class="fill" d={paths.fill} />
      <path d={paths.fill} fill="url(#{uid}-warm)" clip-path="url(#{uid}-done)" />

      <line class="horizon" x1="0" x2={width} y1={scale.horizon} y2={scale.horizon} />
      {#each ticks as t (t.x)}
        <line class="tick" x1={t.x} x2={t.x} y1={scale.horizon} y2={scale.horizon + (t.label ? 5 : 3)} />
        {#if t.label && !compact}
          <text class="hour" x={t.x} y={height - 3}>{t.label}</text>
        {/if}
      {/each}

      <path class="night-line" d={paths.night} />
      <path class="day-line" d={paths.day} />
      <path class="trail" d={trail} />
      {#if up}
        <line class="drop" x1={kx} x2={kx} y1={ky + r + 2} y2={scale.horizon} />
      {/if}

      <g transform="translate({kx.toFixed(2)} {ky.toFixed(2)})">
        <g class="body">
          <circle class="glow" r={r * 2.9} fill="url(#{uid}-glow)" />
          <circle class="sun" {r} />
          <path class="moon" d={moon} />
        </g>
        <circle class="focus" r={r + 5} />
      </g>
    </svg>
  {/if}
</div>

<style>
  .arc {
    position: relative;
    touch-action: none;
    cursor: pointer;
    outline: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .arc.held {
    cursor: grabbing;
  }
  svg {
    display: block;
    overflow: visible;
  }

  .fill {
    fill: rgb(var(--ink-rgb) / 0.045);
  }
  .horizon {
    stroke: var(--line);
    stroke-width: 1;
  }
  .tick {
    stroke: var(--ink-3);
    stroke-width: 1;
  }
  .hour {
    font: 500 10px/1 var(--font-mono);
    letter-spacing: 0.01em;
    fill: var(--ink-2);
    text-anchor: middle;
  }
  .night-line {
    fill: none;
    stroke: var(--ink-3);
    stroke-width: 1.25;
    stroke-linecap: round;
    stroke-dasharray: 0.5 3.5;
  }
  .day-line {
    fill: none;
    stroke: rgb(var(--ink-rgb) / 0.42);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .trail {
    fill: none;
    stroke: var(--sun);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .drop {
    stroke: var(--sun);
    stroke-opacity: 0.5;
    stroke-width: 1;
    stroke-dasharray: 1.5 2.5;
  }

  /* The knob. It swells a little under the finger, as if picked up. */
  .body {
    transition: transform 360ms var(--spring);
  }
  .held .body {
    transform: scale(1.22);
  }
  .glow {
    opacity: 0.75;
    transition: opacity 300ms;
  }
  .held .glow {
    opacity: 1;
  }
  .sun {
    fill: var(--sun);
    stroke: var(--surface);
    stroke-width: 2;
    transition:
      opacity 240ms,
      transform 320ms var(--spring-snappy);
  }
  .moon {
    fill: rgb(var(--ink-rgb) / 0.72);
    opacity: 0;
    transform: scale(0.4) rotate(-40deg);
    transition:
      opacity 240ms,
      transform 420ms var(--spring-snappy);
  }
  .night .sun,
  .night .glow {
    opacity: 0;
  }
  .night .sun {
    transform: scale(0.4);
  }
  .night .moon {
    opacity: 1;
    transform: none;
  }

  .focus {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    opacity: 0;
  }
  .arc:focus-visible .focus {
    opacity: 1;
  }
</style>
