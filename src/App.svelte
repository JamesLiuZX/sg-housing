<script lang="ts">
  import { untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { DEMO_POSTAL, isDemoHit, lookupBlock, lookupDemo, lookupNeighbourHeights, searchAddress, type AddressHit, type BlockLookup } from './lib/data';
  import { Viewer, type Hooks, type Lens } from './lib/engine/Viewer';
  import { Atmosphere } from './lib/ui/atmosphere';
  import BlockStage from './lib/ui/BlockStage.svelte';
  import Dock from './lib/ui/Dock.svelte';
  import Landing from './lib/ui/Landing.svelte';
  import MapCredit from './lib/ui/MapCredit.svelte';
  import { ms } from './lib/ui/motion';
  import { readParams } from './lib/ui/params';
  import { roomView } from './lib/ui/pins';
  import { roadName } from './lib/ui/place';
  import PlanMarks from './lib/ui/PlanMarks.svelte';
  import RoomLabels from './lib/ui/RoomLabels.svelte';
  import { Session, type Arrival } from './lib/ui/session.svelte';
  import TopBar from './lib/ui/TopBar.svelte';
  import WalkHud from './lib/ui/WalkHud.svelte';
  import WallPin from './lib/ui/WallPin.svelte';

  const params = readParams();
  const session = new Session({
    lens: params.lens,
    minutes: params.minutes,
    month: params.month,
    bearing: params.facing,
    furnished: !params.bare
  });
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** The block stage opens in late-afternoon light, when the shadows are long and west sun matters. */
  const ARRIVAL_MINUTES = 17 * 60 + 15;
  /** How long the engine takes to ease the model to new insets (Viewer.setInsets), ms. */
  const INSETS_EASE = 500;
  /** What a link asks for on arrival at its block. */
  const asked: Arrival = { storey: params.storey, side: params.side, type: params.type, mirrored: params.mirror };

  /** Overlays that follow the model subscribe here and are called after every rendered frame. */
  const frames = new Set<() => void>();

  let sky = $state<HTMLElement>();
  let canvas = $state<HTMLCanvasElement>();
  // The viewer is a large Three.js object graph; it must never be made deeply reactive.
  let viewer = $state.raw<Viewer | null>(null);
  /** Bumped for a fresh viewer: the way from a block back to the poster's line drawing. */
  let generation = $state(0);
  let atmosphere: Atmosphere | null = null;

  let vw = $state(0);
  let vh = $state(0);
  let dockH = $state(0);
  let posterH = $state(0);
  let blockBottom = $state(0);
  let blockLeft = $state(0);
  let blockTop = $state(0);
  /** True once the camera has landed inside after walking in. */
  let landed = $state(false);
  const wide = $derived(vw >= 820);
  /** The camera is travelling between stages, the opening or a push, with no stage's words on screen. */
  const traveling = $derived(session.stage === 'opening' || session.stage === 'entering' || session.stage === 'leaving');

  /** The block being looked up, for the poster to say so, and what went wrong if it did. */
  let finding = $state<string | null>(null);
  let trouble = $state<string | null>(null);
  let lookup: AbortController | null = null;
  let arrivals = 0;

  /** Room the dock will take before it has been measured, so the first camera move lands close. A wall's verdict is the Rules sheet's taller state. */
  const dockGuess = (lens: Lens = session.lens, verdict = !!session.wall || !!params.wall) =>
    lens === 'sun' ? (wide ? 392 : 358) : lens === 'rules' ? (verdict ? (wide ? 236 : 300) : wide ? 168 : 196) : wide ? 150 : 148;
  /** Room the block stage's controls take, before they have been measured: along the bottom, and on a phone, across the top. */
  const blockGuess = () => blockBottom || (wide ? 120 : 334);
  const blockTopGuess = () => (wide ? 0 : blockTop || 132);

  /** The inset the model was last fitted to. A big change in the dock re-fits the model; a small one only slides it. */
  let fitted = 0;
  /**
   * Set when a wall's verdict opens or closes: the Rules sheet then grows or
   * shrinks under a person who has most likely zoomed in to tap that wall,
   * so the model only slides with it and keeps their view. A lens change,
   * which frames the model afresh anyway, clears it.
   */
  let keepView = false;
  /** The screen size the explore insets were last worked out for. */
  let framedFor = '';
  /** The block stage's insets the block was last framed for; null when it is next to be framed afresh. */
  let blockFramed: { bottom: number; top: number } | null = null;
  /** The storey the block last reported, so it is not sent straight back. */
  let heard = 0;
  /** The neighbours' storeys the block on screen was built with, so it is rebuilt only for new ones. */
  let builtWith: Record<string, number> | null = null;

  const hooks: Hooks = {
    frame: () => frames.forEach((f) => f()),
    mode: (m) => {
      if (m === 'walk') session.stage = 'walk';
      else if (m === 'doll' && session.stage === 'walk') session.stage = 'explore';
    },
    wall: (w) => {
      if (session.stage === 'explore' && dockH > 0 && !w !== !session.wall) keepView = true;
      session.wall = w;
    },
    atmosphere: (day, gold) => atmosphere?.set(day, gold),
    storey: (n) => {
      heard = n;
      session.setStorey(n);
    },
    // A tap on the block names the side. The storey stays where the scale has it: people tap a side, not a floor.
    facade: (pick) => {
      if (session.stage === 'block') session.chooseSide(pick.facade, pick.along);
    },
    map: (shown) => (session.mapShown = shown)
  };

  // A viewer per canvas. The canvas is keyed on `generation`, so a bump builds a fresh one.
  $effect(() => {
    const c = canvas;
    if (!c) return;
    return untrack(() => build(c));
  });

  /** What a fresh viewer does first: the opening of the page once, the poster's drawing after that. */
  let onBuilt: (v: Viewer) => void = first;

  function build(c: HTMLCanvasElement): () => void {
    atmosphere ??= new Atmosphere(document.documentElement, sky!, (night) => {
      session.night = night;
    });
    const v = new Viewer(c, session.plan, hooks);
    v.setBearing(session.bearing);
    v.setSun(session.sun);
    v.setDayPath(session.path);
    v.setFurnished(session.furnished);
    viewer = v;
    const start = onBuilt;
    onBuilt = (x) => void x.showPlan();
    start(v);
    return () => {
      v.dispose();
      if (viewer === v) viewer = null;
    };
  }

  /** The page opening: the poster, a shared state, or a place a link names. */
  function first(v: Viewer): void {
    if (session.place) {
      // The bundled block, arrived at before the first frame.
      showSite(v);
      if (session.stage === 'explore') {
        land(v);
        linked(v);
      }
    } else if (params.postal) {
      void v.showPlan();
      void arriveFromLink();
    } else if (params.skip || reduced) {
      land(v);
      linked(v);
    } else {
      void v.showPlan();
    }
  }

  /** On the finished model at the end of a link: the wall it names, or the room it walks into. */
  function linked(v: Viewer): void {
    const wall = params.wall ? session.plan.walls.find((w) => w.id === params.wall) : null;
    if (wall) v.select(wall);
    if (params.walk) walkInto(params.walk === '1' ? null : params.walk);
  }

  /** Straight onto the finished model; from the block, where the push-in would have ended. */
  function land(v: Viewer): void {
    fitted = dockGuess();
    v.jump(fitted);
    session.stage = 'explore';
    v.setLens(session.lens);
  }

  // ── Mirror the session into the engine. Each effect reads only what it forwards. ──
  $effect(() => viewer?.setSun(session.sun));
  $effect(() => viewer?.setDayPath(session.path));
  $effect(() => viewer?.setBearing(session.bearing));
  $effect(() => viewer?.setFurnished(session.furnished));
  $effect(() => viewer?.setGround(session.ground));
  $effect(() => {
    if (session.stage !== 'explore' || !viewer) return;
    const before = viewer.lens;
    viewer.setLens(session.lens);
    // A lens change re-fits against the insets in force; the new panel's height arrives a frame later.
    // (Leaving the Rules lens clears its wall on the way, which is not the person closing a verdict.)
    if (viewer.lens !== before) {
      fitted = untrack(() => dockH) + 6;
      keepView = false;
    }
  });
  // A new flat type or its mirror, swapped in place, wherever the viewer is.
  $effect(() => {
    const plan = session.plan;
    untrack(() => {
      if (viewer && plan !== viewer.plan) viewer.setPlan(plan);
    });
  });
  // The storey and the unit, from the controls to the block. The bearing effect above runs first, as setUnit asks.
  $effect(() => {
    const n = session.storey;
    if (session.stage !== 'block') return;
    untrack(() => {
      if (n !== heard) viewer?.setStorey(n);
      heard = n;
    });
  });
  $effect(() => {
    const facade = session.facade;
    const storey = session.storey;
    const along = session.along;
    if (!facade || session.stage !== 'block') return;
    untrack(() => viewer?.setUnit({ storey, facade, along }));
  });
  // Once a block is on screen, its nearest neighbours' heights are asked for; a new block or the poster cancels that.
  $effect(() => {
    const block = session.block;
    if (!block || !viewer) return;
    const ctl = new AbortController();
    void lookupNeighbourHeights(block, { signal: ctl.signal, onProgress: (h) => (session.neighbourStoreys = h.storeys) });
    return () => ctl.abort();
  });
  // New heights rebuild the block in place, keeping the view, the storey and the unit. Only at the block stage:
  // anywhere else showBlock would pull the person out of the flat, so heights that come meanwhile are drawn on the way back.
  $effect(() => {
    const v = viewer;
    const block = session.block;
    const storeys = session.neighbourStoreys;
    if (!v || !block || session.stage !== 'block' || storeys === builtWith) return;
    untrack(() => {
      builtWith = storeys;
      v.showBlock({ block, storeys: session.storeys, label: block.blk, neighbourStoreys: storeys }, blockGuess());
    });
  });

  $effect(() => {
    if (!viewer) return;
    if (session.stage === 'landing') {
      // The poster takes the left on a wide screen and the bottom on a phone; the plan gets the rest.
      if (wide) viewer.setInsets(0, Math.round(Math.min(640, Math.max(400, vw * 0.44))));
      else viewer.setInsets(posterH, 0);
    } else if (session.stage === 'block' && blockBottom > 0) {
      // On a phone the words take a band across the top, and the block is framed below it.
      const left = wide ? blockLeft : 0;
      const top = wide ? 0 : blockTop;
      // The first measure and a big change, such as a turned phone, frame the block afresh; a small change slides it.
      if (!blockFramed || Math.abs(blockBottom - blockFramed.bottom) + Math.abs(top - blockFramed.top) > 48) {
        viewer.fitInsets(blockBottom, left, top);
        blockFramed = { bottom: blockBottom, top };
      } else {
        viewer.setInsets(blockBottom, left, top);
      }
    } else if (session.stage === 'explore' && dockH > 0) {
      const inset = dockH + 6;
      // A turned phone is a new screen, framed afresh whatever the sheet was doing.
      const screen = `${vw}x${vh}`;
      if (screen !== framedFor) {
        framedFor = screen;
        keepView = false;
      }
      if (!keepView && Math.abs(inset - fitted) > 48) {
        viewer.fitInsets(inset, 0);
        fitted = inset;
      } else {
        viewer.setInsets(inset, 0);
      }
    }
  });

  // ── The typical flat ──

  async function start(): Promise<void> {
    if (!viewer || session.stage !== 'landing') return;
    lookup?.abort();
    finding = null;
    session.stage = 'opening';
    fitted = dockGuess();
    await viewer.intro(fitted);
    session.stage = 'explore';
  }

  function walkInto(roomId: string | null): void {
    if (!viewer) return;
    session.stop();
    const to = roomId ? roomView(session.plan, roomId) : null;
    landed = false;
    void viewer.enterWalk(to?.at, to?.lookAt).then(() => {
      landed = true;
    });
  }

  // ── A place ──

  async function arriveFromLink(): Promise<void> {
    const postal = params.postal!;
    finding = postal;
    const found = await searchAddress(postal);
    const hit = found.status === 'ok' ? found.data.hits.find((h) => h.postal === postal && h.blk) : null;
    if (hit) return pick(hit, asked);
    finding = null;
    trouble =
      found.status === 'unavailable'
        ? `The link names postal code ${postal}, and OneMap did not answer, so the block cannot be found.`
        : `The link names postal code ${postal}, and there is no HDB block there.`;
  }

  /** Looks a block up and arrives at it, or says what stopped it. */
  async function pick(hit: AddressHit, want: Arrival = {}): Promise<void> {
    lookup?.abort();
    const ctl = (lookup = new AbortController());
    const name = `Blk ${hit.blk} ${roadName(hit.road)}`;
    finding = name;
    trouble = null;
    let found: BlockLookup = await lookupBlock(hit, { signal: ctl.signal });
    if (ctl.signal.aborted) return;
    finding = null;
    // The bundled block stands in for itself when the index cannot be reached.
    if (found.block.status === 'unavailable' && isDemoHit(hit)) found = lookupDemo();
    if (found.block.status === 'ok') return openPlace(found, want);
    trouble =
      found.block.status === 'not-found'
        ? `${name} is not in HDB's list of blocks. Blk covers HDB flats only.`
        : `The block index did not load, so ${name} cannot be drawn. Try again in a moment.`;
  }

  function openPlace(found: BlockLookup, want: Arrival): void {
    if (session.stage !== 'landing') return;
    finding = null;
    trouble = null;
    session.arrive(found, want);
    const first = arrivals++ === 0;
    // The first arrival keeps the hour and month a link gave; every other arrival is on 21 June, at a quarter past five.
    if (!first || params.minutes === null) session.scrub(ARRIVAL_MINUTES);
    if (!first || params.month === null) session.setMonth(5);
    session.stage = params.skip && first && session.facade ? 'explore' : 'block';
    if (!viewer) return;
    viewer.setPlan(session.plan);
    showSite(viewer);
    if (session.stage === 'explore') {
      land(viewer);
      linked(viewer);
    }
  }

  function showSite(v: Viewer): void {
    const block = session.block;
    if (!block) return;
    v.setBearing(session.bearing);
    const bottom = blockGuess();
    const top = blockTopGuess();
    // The block is framed for the insets in force. From the poster those are the poster's, so the block stage's go in
    // first and the block is right from its first frame; from the flat they are the flat's, and the first measure fixes them.
    // A link straight into the flat skips the block stage and its band.
    if (v.mode === 'plan' && session.stage === 'block') {
      v.setInsets(bottom, 0, top);
      blockFramed = { bottom, top };
    } else {
      blockFramed = null;
    }
    builtWith = session.neighbourStoreys;
    v.showBlock({ block, storeys: session.storeys, label: block.blk, neighbourStoreys: builtWith }, bottom);
    heard = session.storey;
    v.setStorey(session.storey);
    if (session.facade) v.setUnit({ storey: session.storey, facade: session.facade, along: session.along });
  }

  async function enter(): Promise<void> {
    if (!viewer || session.stage !== 'block' || !session.facade) return;
    session.stage = 'entering';
    fitted = dockGuess();
    // The push carries the insets in force into the flat, which has no band across the top. So as the band's words
    // fade, the block first takes the room they leave, over the time the engine eases a change of insets.
    if (!wide && blockTop > 0) {
      viewer.setInsets(blockBottom, 0, 0);
      await new Promise((done) => setTimeout(done, ms(INSETS_EASE)));
      if (!viewer || session.stage !== 'entering') return;
    }
    if (reduced) viewer.jump(fitted);
    else await viewer.enterFlat(fitted);
    if (session.stage === 'entering') session.stage = 'explore';
  }

  async function backToBlock(): Promise<void> {
    if (!viewer || session.stage !== 'explore' || !session.place) return;
    session.wall = null;
    session.stage = 'leaving';
    blockFramed = null;
    if (reduced) showSite(viewer);
    else await viewer.exitToBlock(blockGuess());
    if (session.stage === 'leaving') session.stage = 'block';
  }

  function backToSearch(): void {
    if (session.stage !== 'block') return;
    session.leave();
    session.stage = 'landing';
    // The poster's drawing comes from a fresh viewer; the old one, with its block, goes.
    viewer = null;
    generation++;
  }

  // The bundled block needs no network, so a link to it arrives before the first frame is drawn.
  if (params.demo || params.postal === DEMO_POSTAL) openPlace(lookupDemo(), asked);
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div class="stage" data-stage={session.stage}>
  <div class="sky" bind:this={sky}></div>
  {#key generation}
    <canvas bind:this={canvas} aria-label={session.stage === 'block' ? '3D model of the block' : '3D model of the flat'}></canvas>
  {/key}

  {#key `${generation}:${session.plan.id}`}
    {#if viewer && (session.stage === 'landing' || session.stage === 'opening')}
      <PlanMarks {viewer} {frames} bearing={session.bearing} leaving={session.stage === 'opening'} />
    {/if}
    {#if viewer && session.stage === 'explore'}
      <RoomLabels {viewer} {session} {frames} onpick={walkInto} />
      {#if session.lens === 'rules' && session.wall}
        <WallPin {viewer} {frames} wall={session.wall} />
      {/if}
    {/if}
  {/key}

  <div class="layer">
    {#if session.stage === 'landing' || session.stage === 'opening'}
      <Landing
        leaving={session.stage === 'opening'}
        {wide}
        {finding}
        {trouble}
        bind:height={posterH}
        onstart={start}
        ondemo={() => openPlace(lookupDemo(), {})}
        onpick={(hit) => void pick(hit)}
      />
    {/if}

    {#if session.stage === 'block' || session.stage === 'entering'}
      <BlockStage
        {session}
        {wide}
        leaving={session.stage === 'entering'}
        bind:bottom={blockBottom}
        bind:left={blockLeft}
        bind:top={blockTop}
        onenter={() => void enter()}
        onback={backToSearch}
      />
    {/if}

    {#if session.stage === 'explore'}
      <TopBar {session} onback={session.place ? () => void backToBlock() : null} />
      <Dock
        {session}
        bind:height={dockH}
        onwalk={() => walkInto(null)}
        onselect={(w) => viewer?.select(w)}
        onclear={() => viewer?.select(null)}
      />
    {/if}

    {#if viewer && session.stage === 'walk'}
      <WalkHud {viewer} {session} {frames} {landed} onexit={() => void viewer?.exitWalk()} />
    {/if}

    <!-- The standing disclosure, while the camera travels and the stage it left has taken its own words away.
         Going in, it waits for those words to fade; coming back out to the block, there are none to wait for. -->
    {#if traveling}
      <div class="standing" in:fade={{ duration: ms(200), delay: ms(session.stage === 'leaving' ? 0 : 280) }} out:fade={{ duration: ms(300) }}>
        <p>Computer-generated model, not a photograph</p>
        <!-- OneMap's map is still on the table as the camera flies, so its attribution travels too. -->
        <MapCredit shown={session.mapShown} />
      </div>
    {/if}
  </div>
</div>

<style>
  .standing {
    position: absolute;
    top: calc(var(--gutter) + var(--safe-t));
    left: calc(var(--gutter) + var(--safe-l));
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11px;
    color: var(--ink-2);
    pointer-events: none;
    text-shadow:
      0 0 3px var(--surface),
      0 0 8px var(--surface);
  }
  @media (min-width: 820px) {
    .standing {
      font-size: 12px;
    }
  }
</style>
