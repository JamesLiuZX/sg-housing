<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import type { Viewer } from '../engine/Viewer';
  import { boundsOf, frameOf, openingsOf, pointInPoly } from '../plan/geometry';
  import { clock } from '../sg/solar';
  import { ms } from './motion';
  import type { Session } from './session.svelte';
  import SunArc from './SunArc.svelte';
  import { sunIsUp } from './sunText';

  /**
   * First person. Just enough to stay oriented and get back out: the way to
   * the overview, a plan with you on it, a hint until you have moved, and the
   * sun, so the light can be moved from inside the room.
   */
  let {
    viewer,
    session,
    frames,
    landed = true,
    onexit
  }: { viewer: Viewer; session: Session; frames: Set<() => void>; landed?: boolean; onexit: () => void } = $props();

  // The plan is fixed for the life of the page, so the map is drawn from it once.
  // svelte-ignore state_referenced_locally
  const plan = session.plan;

  // ── The mini-map, drawn once from the plan ──
  const b = boundsOf(plan);
  const PAD = 450;
  const box = { x: b.minX - PAD, y: b.minY - PAD, w: b.maxX - b.minX + PAD * 2, h: b.maxY - b.minY + PAD * 2 };

  interface Seg {
    d: string;
    t: number;
    low: boolean;
  }
  const solid: Seg[] = [];
  const glass: Seg[] = [];
  for (const w of plan.walls) {
    const f = frameOf(w);
    const seg = (u0: number, u1: number): string =>
      `M${(w.a[0] + f.dx * u0).toFixed(0)} ${(w.a[1] + f.dy * u0).toFixed(0)}L${(w.a[0] + f.dx * u1).toFixed(0)} ${(w.a[1] + f.dy * u1).toFixed(0)}`;
    // Ends run half a thickness past the centreline so corners close, as on a drawn plan.
    let cursor = -w.t / 2;
    for (const o of openingsOf(plan, w.id)) {
      if (o.at > cursor) solid.push({ d: seg(cursor, o.at), t: w.t, low: w.kind === 'parapet' });
      if (o.type === 'window') glass.push({ d: seg(o.at, o.at + o.w), t: w.t, low: false });
      cursor = o.at + o.w;
    }
    if (f.len + w.t / 2 > cursor) solid.push({ d: seg(cursor, f.len + w.t / 2), t: w.t, low: w.kind === 'parapet' });
  }
  const rooms = plan.rooms.map((r) => ({ id: r.id, d: `M${r.poly.map((p) => p.join(' ')).join('L')}Z` }));

  // The sun, pinned to the edge of the map in the direction it shines from.
  const sunMark = $derived.by(() => {
    if (!sunIsUp(session.sun)) return null;
    const a = (session.sun.azimuth * 180) / Math.PI - session.bearing;
    const rx = box.w / 2 - 260;
    const ry = box.h / 2 - 260;
    const s = Math.sin((a * Math.PI) / 180);
    const c = -Math.cos((a * Math.PI) / 180);
    // Onto the rectangle's edge rather than an ellipse, so it hugs the frame of the map.
    const k = 1 / Math.max(Math.abs(s) / rx, Math.abs(c) / ry);
    return { x: box.x + box.w / 2 + s * k, y: box.y + box.h / 2 + c * k };
  });

  // ── Following the walker, outside reactive state ──
  let me = $state<SVGGElement>();
  let roomId = $state('');
  let moved = $state(false);
  const room = $derived.by(() => {
    const name = plan.rooms.find((r) => r.id === roomId)?.name ?? '';
    return name === 'Living' ? 'Living room' : name;
  });
  /** "the kitchen", but "bedroom 2". */
  const where = $derived(/^bedroom \d/i.test(room) ? room.toLowerCase() : `the ${room.toLowerCase()}`);
  let start: { x: number; y: number; yaw: number } | null = null;

  function place(): void {
    const p = viewer.walkPose();
    me?.setAttribute('transform', `translate(${p.x.toFixed(0)} ${p.y.toFixed(0)}) rotate(${((-p.yaw * 180) / Math.PI).toFixed(1)})`);
    start ??= p;
    if (!moved && (Math.hypot(p.x - start.x, p.y - start.y) > 120 || Math.abs(p.yaw - start.yaw) > 0.08)) moved = true;
    // Written only when it changes, so following the walker costs nothing reactive.
    const here = plan.rooms.find((r) => pointInPoly(p.x, p.y, r.poly))?.id ?? '';
    if (here !== roomId) roomId = here;
  }

  const fine = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  let hint = $state(false);

  onMount(() => {
    frames.add(place);
    place();
    return () => frames.delete(place);
  });

  // The hint waits for the camera to land, then leaves after the first move or a few seconds.
  $effect(() => {
    if (moved) {
      hint = false;
      return;
    }
    if (!landed) return;
    const show = setTimeout(() => (hint = true), 300);
    const hide = setTimeout(() => (hint = false), 6300);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  });
</script>

<div class="hud">
  <div class="corner" in:fly={{ y: -10, duration: ms(420), delay: ms(600) }} out:fade={{ duration: ms(160) }}>
    <button class="out glass" onclick={onexit}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M9 2.4 15 5.7v6.6L9 15.6l-6-3.3V5.7L9 2.4Z" />
        <path d="M3 5.7 9 9l6-3.3M9 9v6.6" />
      </svg>
      Overview
    </button>
    <p class="disclose">Computer-generated model, not a photograph</p>
  </div>

  <figure class="map glass" aria-label={room ? `Plan of the flat. You are in ${where}.` : 'Plan of the flat'} in:fly={{ y: -10, duration: ms(420), delay: ms(680) }} out:fade={{ duration: ms(160) }}>
    <svg viewBox="{box.x} {box.y} {box.w} {box.h}" aria-hidden="true">
      <defs>
        <radialGradient id="hud-cone" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="2900">
          <stop offset="0" style="stop-color: var(--sun); stop-opacity: 0.55" />
          <stop offset="1" style="stop-color: var(--sun); stop-opacity: 0" />
        </radialGradient>
      </defs>
      {#each rooms as r (r.id)}
        <path class="room" class:here={r.id === roomId} d={r.d} />
      {/each}
      {#each solid as s, i (i)}
        <path class="wall" class:low={s.low} d={s.d} stroke-width={s.low ? s.t * 0.7 : s.t} />
      {/each}
      {#each glass as s, i (i)}
        <path class="glass-line" d={s.d} stroke-width={s.t * 0.45} />
      {/each}
      {#if sunMark}
        <circle class="sun-halo" cx={sunMark.x} cy={sunMark.y} r="520" />
        <circle class="sun" cx={sunMark.x} cy={sunMark.y} r="230" />
      {/if}
      <g bind:this={me}>
        <path class="cone" d="M0 0L-1864 -2222A2900 2900 0 0 1 1864 -2222Z" fill="url(#hud-cone)" />
        <circle class="me" r="300" />
      </g>
    </svg>
    {#if room}
      <figcaption>{room}</figcaption>
    {/if}
  </figure>

  {#if hint}
    <p class="hint glass" in:fly={{ y: 8, duration: ms(420) }} out:fade={{ duration: ms(420) }}>
      {fine ? 'Click the floor to move. Drag to look, or use WASD.' : 'Tap the floor to move. Drag to look.'}
    </p>
  {/if}

  <div class="scrub glass" in:fly={{ y: 16, duration: ms(460), delay: ms(760) }} out:fade={{ duration: ms(160) }}>
    <p class="time num">{clock(session.minutes)}</p>
    <div class="track"><SunArc {session} compact /></div>
    <button class="play" class:on={session.playing} onclick={() => session.togglePlay()} aria-label={session.playing ? 'Pause' : 'Play the day'}>
      <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
        <path class="i-play" d="M7.2 5.1v9.8a.6.6 0 0 0 .9.5l7.6-4.9a.6.6 0 0 0 0-1L8.1 4.6a.6.6 0 0 0-.9.5Z" />
        <path class="i-pause" d="M6.4 5h2.4v10H6.4zM11.2 5h2.4v10h-2.4z" />
      </svg>
    </button>
  </div>
</div>

<style>
  /* Lets the floor take taps everywhere except on the controls themselves. */
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .corner {
    position: absolute;
    top: calc(var(--gutter) + var(--safe-t));
    left: calc(var(--gutter) + var(--safe-l));
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    pointer-events: none;
  }
  .out {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 16px 0 13px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.005em;
    transition: transform 180ms var(--ease-out);
  }
  .out:active {
    transform: scale(0.96);
  }
  .out path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .disclose {
    /* Clear of the map on the narrowest phones; it wraps rather than run under it. */
    max-width: calc(100vw - 2 * var(--gutter) - 128px - 20px);
    padding-left: 4px;
    font-size: 11px;
    color: var(--ink-2);
    text-shadow:
      0 0 3px var(--surface),
      0 0 8px var(--surface);
  }

  .map {
    position: absolute;
    top: calc(var(--gutter) + var(--safe-t));
    right: calc(var(--gutter) + var(--safe-r));
    margin: 0;
    width: 128px;
    padding: 7px 7px 6px;
    border-radius: 16px;
    pointer-events: none;
  }
  .map svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .room {
    fill: rgb(var(--ink-rgb) / 0.035);
    transition: fill 300ms;
  }
  .room.here {
    fill: rgb(var(--ink-rgb) / 0.11);
  }
  .wall {
    fill: none;
    stroke: var(--ink);
    stroke-linecap: butt;
  }
  .wall.low {
    stroke: var(--ink-3);
  }
  .glass-line {
    fill: none;
    stroke: var(--ink-3);
  }
  .sun {
    fill: var(--sun);
  }
  .sun-halo {
    fill: var(--sun);
    opacity: 0.22;
  }
  .me {
    fill: var(--ink);
    stroke: var(--surface);
    stroke-width: 110;
  }
  figcaption {
    margin-top: 4px;
    padding: 0 2px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: -0.003em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    position: absolute;
    left: 50%;
    bottom: calc(var(--gutter) + var(--safe-b) + 92px);
    translate: -50% 0;
    max-width: calc(100% - 2 * var(--gutter));
    padding: 10px 16px;
    border-radius: 999px;
    font-size: 13.5px;
    font-weight: 500;
    text-align: center;
    pointer-events: none;
  }

  .scrub {
    position: absolute;
    left: 50%;
    bottom: calc(var(--gutter) + var(--safe-b));
    translate: -50% 0;
    width: min(calc(100% - 2 * var(--gutter)), 440px);
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 6px 6px 6px 16px;
    border-radius: 999px;
    pointer-events: auto;
  }
  .time {
    min-width: 8ch;
    font-size: 16px;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .track {
    min-width: 0;
  }
  .play {
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

  @media (min-width: 820px) {
    .map {
      width: 184px;
      padding: 9px 9px 8px;
      border-radius: 18px;
    }
    figcaption {
      font-size: 12px;
    }
    .disclose {
      font-size: 12px;
    }
  }
</style>
