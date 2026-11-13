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
   * DOM, never through reactive state, and step aside for each other when the
   * model is small on screen. Zoom in and the hidden ones come back.
   */
  let {
    viewer,
    session,
    frames,
    onpick
  }: { viewer: Viewer; session: Session; frames: Set<() => void>; onpick: (roomId: string) => void } = $props();

  /** Below this a room is a bathroom, a yard or a shelter, and its label steps back. */
  const SMALL = 6;
  /** Clear space kept between the words of two labels, px. */
  const GAP = 3;

  // The viewer and its rooms are fixed for the life of the page.
  // svelte-ignore state_referenced_locally
  const anchors = viewer.anchors;
  const els: (HTMLElement | undefined)[] = [];
  /** The words of each label, measured; the padding round them is only there to make the target bigger. */
  const size = anchors.map(() => ({ w: 0, h: 0 }));
  const out = { x: 0, y: 0, front: false };
  // Bigger rooms claim their spot first; in the Sun lens a lit room outranks an unlit one.
  const byArea = anchors.map((_, i) => i).sort((a, b) => anchors[b].areaSqm - anchors[a].areaSqm);

  let lit = new Set<string>();
  $effect(() => {
    lit = new Set(session.lens === 'sun' ? session.lit : []);
    place();
  });

  const taken: { x: number; y: number; w: number; h: number }[] = [];

  function place(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    taken.length = 0;
    const order = lit.size ? [...byArea].sort((a, b) => Number(lit.has(anchors[b].id)) - Number(lit.has(anchors[a].id))) : byArea;
    for (const i of order) {
      const el = els[i];
      if (!el) continue;
      viewer.project(anchors[i].pos, out);
      const { w, h } = size[i];
      const box = { x: out.x - w / 2, y: out.y - h / 2, w, h };
      const onScreen = out.front && out.x > 0 && out.y > 0 && out.x < vw && out.y < vh;
      const clear =
        onScreen && taken.every((p) => box.x + w + GAP < p.x || p.x + p.w + GAP < box.x || box.y + h + GAP < p.y || p.y + p.h + GAP < box.y);
      if (clear) taken.push(box);
      el.style.transform = `translate3d(${out.x.toFixed(1)}px, ${out.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.toggleAttribute('data-off', !clear);
    }
  }

  let ro: ResizeObserver | undefined;

  /** Registers a label: sizes change with the lens, the screen width and when the fonts arrive. */
  function track(i: number) {
    return (el: HTMLElement) => {
      els[i] = el;
      const tag = el.firstElementChild as HTMLElement;
      ro?.observe(tag);
      return () => {
        ro?.unobserve(tag);
        if (els[i] === el) els[i] = undefined;
      };
    };
  }

  onMount(() => {
    ro = new ResizeObserver(() => {
      els.forEach((el, i) => {
        const tag = el?.firstElementChild as HTMLElement | null;
        if (tag) size[i] = { w: tag.offsetWidth, h: tag.offsetHeight };
      });
      place();
    });
    els.forEach((el) => el?.firstElementChild && ro!.observe(el.firstElementChild));
    frames.add(place);
    place();
    return () => {
      frames.delete(place);
      ro?.disconnect();
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
    {@const small = a.areaSqm < SMALL}
    {@const isLit = session.lens === 'sun' && session.lit.includes(a.id)}
    <button class="label" data-off class:small class:lit={isLit} {@attach track(i)} onclick={() => onpick(a.id)} aria-label={spoken(a.name, a.id, a.areaSqm)}>
      <span class="tag" style="--i:{i}" aria-hidden="true">
        <span class="name"><span class="full">{a.name}</span><span class="short">{shortName(a.name)}</span></span>
        {#key session.lens}
          <span class="meta" in:fade={{ duration: ms(260) }}>
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
    padding: 8px 8px;
    border-radius: 12px;
    pointer-events: auto;
    text-align: center;
    will-change: transform;
    transition: opacity 220ms var(--ease-out);
  }
  /* Behind the camera, off screen, or crowded out by a bigger room. */
  .label[data-off] {
    opacity: 0;
    pointer-events: none;
  }
  .hidden .label {
    pointer-events: none;
  }

  .tag {
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Arrive one after another once the camera has settled. */
    animation: rise-in 520ms var(--ease-out) both;
    animation-delay: calc(380ms + var(--i) * 45ms);
    /* A paper halo, so the words read over floor, furniture and shadow alike. */
    text-shadow:
      0 0 2px var(--surface),
      0 0 5px var(--surface),
      0 0 10px rgb(var(--surface-rgb) / 0.9);
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
  .meta {
    margin-top: 1px;
    font-size: 11px;
    line-height: 1.2;
    color: var(--ink-2);
    white-space: nowrap;
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
  .lit .meta {
    color: var(--sun-ink);
    font-weight: 500;
  }

  /*
   * A phone has room for every room but not every word: agents' short names,
   * square metres only, and small rooms keep just their name.
   */
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
    .meta {
      font-size: 10px;
    }
    .meta .num {
      font-size: 10px;
    }
    .small .meta,
    .ft {
      display: none;
    }
  }
</style>
