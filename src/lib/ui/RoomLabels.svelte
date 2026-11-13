<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Viewer } from '../engine/Viewer';
  import { shortName, sqft, sqm } from './format';
  import { ms } from './motion';
  import type { Session } from './session.svelte';
  import { roomSunLabel } from './sunText';

  /**
   * Room names written on the model, the way a plan is annotated. They follow
   * the camera on every rendered frame by writing transforms straight to the
   * DOM, never through reactive state.
   *
   * Nothing may overlap, on any screen. Each frame the names claim space
   * first, biggest room first (lit rooms first in the Sun lens), and a name
   * that would touch another, or the bar and dock, is left out. Second lines
   * then go in only where they touch nothing. On a phone in the Sun lens the
   * hours appear for one room, the lit one nearest the middle of the view;
   * the rest carry a sun dot. Zoom in and more comes back.
   */
  let {
    viewer,
    session,
    frames,
    onpick
  }: { viewer: Viewer; session: Session; frames: Set<() => void>; onpick: (roomId: string) => void } = $props();

  /** Below this a room is a bathroom, a yard or a shelter, and its label steps back. */
  const SMALL = 6;
  /** Clear space between the words of two labels, px. Wider than the halo, so halos never merge. */
  const GAP = 6;
  /** Labels stay this far inside the screen edge. */
  const EDGE = 6;
  /** Narrower than this, the Sun lens shows hours for one room at a time. */
  const NARROW = 520;

  // The viewer and its rooms are fixed for the life of the page.
  // svelte-ignore state_referenced_locally
  const anchors = viewer.anchors;
  const els: (HTMLElement | undefined)[] = [];
  /** Measured size of each label's name [0] and second line [1]. The padding round them only enlarges the target. */
  const size = anchors.map(() => [
    { w: 0, h: 0 },
    { w: 0, h: 0 }
  ]);
  /** 0 hidden, 1 name only, 2 name and second line. */
  const state = new Uint8Array(anchors.length);
  const at = anchors.map(() => ({ x: 0, y: 0 }));
  const out = { x: 0, y: 0, front: false };
  // Bigger rooms claim their spot first; in the Sun lens a lit room outranks an unlit one.
  const byArea = anchors.map((_, i) => i).sort((a, b) => anchors[b].areaSqm - anchors[a].areaSqm);

  type Box = { x: number; y: number; w: number; h: number };
  const taken: Box[] = [];
  const own: (Box | null)[] = anchors.map(() => null);

  // Seeded here, then kept current by the effect below.
  // svelte-ignore state_referenced_locally
  let lens = session.lens;
  let lit = new Set<string>();
  $effect(() => {
    lens = session.lens;
    lit = new Set(lens === 'sun' ? session.lit : []);
    place();
  });

  function free(b: Box, except: Box | null = null): boolean {
    for (const p of taken) {
      if (p === except) continue;
      if (b.x < p.x + p.w + GAP && p.x < b.x + b.w + GAP && b.y < p.y + p.h + GAP && p.y < b.y + b.h + GAP) return false;
    }
    return true;
  }

  function onScreen(b: Box, vw: number, vh: number): boolean {
    return b.x >= EDGE && b.y >= EDGE && b.x + b.w <= vw - EDGE && b.y + b.h <= vh - EDGE;
  }

  let vw = 0;
  let vh = 0;
  const front = anchors.map(() => false);
  const blocked: Box[] = [];

  function place(): void {
    vw = window.innerWidth;
    vh = window.innerHeight;
    // The bar at the top and the dock at the bottom are already spoken for.
    blocked.length = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-avoid]')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) blocked.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    for (let i = 0; i < anchors.length; i++) {
      viewer.project(anchors[i].pos, out);
      at[i].x = out.x;
      at[i].y = out.y;
      front[i] = out.front;
    }

    if (lens === 'sun' && vw < NARROW) {
      // A phone in the Sun lens: every name, a sun dot on the lit ones, and the hours for one room.
      // The nearest lit room to the middle whose hours fit gets them; if none fits, the nearest makes room.
      const ranked = sunRanked();
      layout(-1);
      if (!ranked.some((i) => state[i] === 1 && line(i)) && ranked.length) layout(ranked[0]);
    } else {
      layout(-1);
      for (const i of order()) if (state[i] === 1) line(i);
    }

    for (let i = 0; i < anchors.length; i++) {
      const el = els[i];
      if (!el) continue;
      el.style.transform = `translate3d(${at[i].x.toFixed(1)}px, ${at[i].y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.toggleAttribute('data-off', state[i] === 0);
      el.toggleAttribute('data-lean', state[i] === 1);
    }
  }

  /** Biggest room first; in the Sun lens the lit rooms ahead of the rest. */
  function order(): number[] {
    return lit.size ? [...byArea].sort((a, b) => Number(lit.has(anchors[b].id)) - Number(lit.has(anchors[a].id))) : byArea;
  }

  /** Places the names, each where it touches nothing. `first`, if given, claims its name and hours before anyone else. */
  function layout(first: number): void {
    taken.length = 0;
    taken.push(...blocked);
    state.fill(0);
    own.fill(null);
    const ids = first >= 0 ? [first, ...order().filter((i) => i !== first)] : order();
    for (const i of ids) {
      const n = size[i][0];
      if (!els[i] || !front[i] || !n.w) continue;
      const box = { x: at[i].x - n.w / 2, y: at[i].y - n.h / 2, w: n.w, h: n.h };
      if (!onScreen(box, vw, vh) || !free(box)) continue;
      taken.push(box);
      own[i] = box;
      state[i] = 1;
      if (i === first) line(i);
    }
  }

  /** Adds a label's second line under its name if it touches nothing. True if it went in. */
  function line(i: number): boolean {
    const n = size[i][0];
    const m = size[i][1];
    if (!m.w) return false;
    const box = { x: at[i].x - m.w / 2, y: at[i].y + n.h / 2, w: m.w, h: m.h };
    if (!onScreen(box, vw, vh) || !free(box, own[i])) return false;
    taken.push(box);
    state[i] = 2;
    return true;
  }

  /**
   * Rooms that could carry the hours, nearest the middle of what is on screen first:
   * the lit ones, or when none is lit, those that get sun at some point in the day.
   */
  function sunRanked(): number[] {
    const seen = (i: number) => front[i] && at[i].x > 0 && at[i].y > 0 && at[i].x < vw && at[i].y < vh;
    const on = anchors.map((_, i) => i).filter(seen);
    if (!on.length) return [];
    const cx = on.reduce((t, i) => t + at[i].x, 0) / on.length;
    const cy = on.reduce((t, i) => t + at[i].y, 0) / on.length;
    const litOnes = on.filter((i) => lit.has(anchors[i].id));
    const pool = litOnes.length ? litOnes : on.filter((i) => !!session.roomSun.get(anchors[i].id)?.spans.length);
    return pool.sort((a, b) => Math.hypot(at[a].x - cx, at[a].y - cy) - Math.hypot(at[b].x - cx, at[b].y - cy));
  }

  // Sizes change with the lens, the screen width, a room lighting up, and when the fonts arrive.
  const parts = new Map<Element, [number, 0 | 1]>();
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const which = parts.get(e.target);
      const el = e.target as HTMLElement;
      if (which) size[which[0]][which[1]] = { w: el.offsetWidth, h: el.offsetHeight };
    }
    place();
  });

  function track(i: number) {
    return (el: HTMLElement) => {
      els[i] = el;
      return () => {
        if (els[i] === el) els[i] = undefined;
      };
    };
  }

  function measure(i: number, part: 0 | 1) {
    return (el: HTMLElement) => {
      parts.set(el, [i, part]);
      ro.observe(el);
      return () => {
        ro.unobserve(el);
        parts.delete(el);
        if (part === 1) size[i][1] = { w: 0, h: 0 };
      };
    };
  }

  onMount(() => {
    frames.add(place);
    place();
    return () => {
      frames.delete(place);
      ro.disconnect();
    };
  });

  const hidden = $derived(session.lens === 'rules');

  function spoken(name: string, id: string, areaSqm: number): string {
    const what =
      session.lens === 'sun' ? roomSunLabel(session.roomSun.get(id)) : `${sqm(areaSqm)} square metres, ${sqft(areaSqm)} square feet`;
    return `Walk into ${name.toLowerCase() === 'living' ? 'the living room' : name}. ${what}.`;
  }
</script>

<div class="labels" class:hidden inert={hidden} aria-hidden={hidden}>
  {#each anchors as a, i (a.id)}
    {@const isLit = session.lens === 'sun' && session.lit.includes(a.id)}
    <button
      class="label"
      class:small={a.areaSqm < SMALL}
      class:lit={isLit}
      data-off
      data-lean
      {@attach track(i)}
      onclick={() => onpick(a.id)}
      aria-label={spoken(a.name, a.id, a.areaSqm)}
    >
      <span class="tag" style="--i:{i}" aria-hidden="true">
        <span class="name" {@attach measure(i, 0)}><span class="full">{a.name}</span><span class="short">{shortName(a.name)}</span></span>
        {#key session.lens}
          <span class="meta" {@attach measure(i, 1)} in:fade={{ duration: ms(260) }}>
            {#if session.lens === 'sun'}
              {roomSunLabel(session.roomSun.get(a.id))}
            {:else}
              <span class="num">{sqm(a.areaSqm)} m²</span><span class="ft"> · <span class="num">{sqft(a.areaSqm)} sq ft</span></span>
            {/if}
          </span>
        {/key}
      </span>
    </button>
  {/each}
</div>

<style>
  .labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transition: opacity 280ms var(--ease-out);
  }
  .labels.hidden {
    opacity: 0;
  }

  .label {
    position: absolute;
    top: 0;
    left: 0;
    padding: 8px;
    border-radius: 12px;
    pointer-events: auto;
    text-align: center;
    will-change: transform;
    transition: opacity 220ms var(--ease-out);
  }
  /* Crowded out, off screen or behind the camera. It goes at once and returns with a fade, so two never share a spot. */
  .label[data-off] {
    opacity: 0;
    pointer-events: none;
    transition: none;
  }
  .hidden .label {
    pointer-events: none;
  }

  .tag {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Arrive one after another once the camera has settled. */
    animation: rise-in 520ms var(--ease-out) both;
    animation-delay: calc(380ms + var(--i) * 45ms);
    /* A paper halo, so the words read over floor, furniture and shadow alike. */
    text-shadow:
      0 0 2px var(--surface),
      0 0 4px var(--surface),
      0 0 8px rgb(var(--surface-rgb) / 0.9);
    transition: transform 240ms var(--spring-snappy);
  }
  @media (hover: hover) {
    .label:hover .tag {
      transform: translateY(-2px);
    }
  }
  .label:active .tag {
    transform: scale(0.96);
  }

  .name {
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: -0.008em;
    line-height: 1.2;
    white-space: nowrap;
  }
  .short {
    display: none;
  }
  /* The second line hangs under the name, so the name sits exactly on its room whether or not the line is shown. */
  .meta {
    position: absolute;
    top: 100%;
    left: 50%;
    translate: -50% 0;
    padding-top: 1px;
    font-size: 11px;
    line-height: 1.2;
    color: var(--ink-2);
    white-space: nowrap;
    transition: opacity 200ms var(--ease-out);
  }
  .label[data-lean] .meta {
    visibility: hidden;
    opacity: 0;
    transition: none;
  }
  .meta .num {
    font-size: 10.5px;
  }

  /* Small rooms: the short name, lighter. */
  .small .full {
    display: none;
  }
  .small .short {
    display: inline;
  }
  .small .name {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-2);
  }
  .small .meta {
    font-size: 10px;
  }

  /* Sun lens: rooms with direct sun this minute carry the sun colour. */
  .lit .name::before {
    content: '';
    display: inline-block;
    width: 7px;
    height: 7px;
    margin: 0 5px 1px 0;
    border-radius: 50%;
    background: var(--sun);
    box-shadow: 0 0 0 2.5px rgb(224 123 57 / 0.25);
    vertical-align: middle;
  }
  .lit.small .name {
    color: var(--ink);
  }
  .lit .meta {
    color: var(--sun-ink);
    font-weight: 500;
  }

  /* A phone has room for every room but not every word: agents' short names, square metres only, small rooms named only. */
  @media (max-width: 519px) {
    .full {
      display: none;
    }
    .short {
      display: inline;
    }
    .name {
      font-size: 11.5px;
    }
    .meta,
    .meta .num {
      font-size: 10px;
    }
    .small .meta,
    .ft {
      display: none;
    }
  }
</style>
