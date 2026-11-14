<script lang="ts">
  import { untrack } from 'svelte';
  import { DEMO_POSTAL, isDemoHit, lookupBlock, lookupDemo, searchAddress, type AddressHit, type BlockLookup } from './lib/data';
  import { Viewer, type Hooks, type Lens } from './lib/engine/Viewer';
  import { Atmosphere } from './lib/ui/atmosphere';
  import BlockStage from './lib/ui/BlockStage.svelte';
  import Dock from './lib/ui/Dock.svelte';
  import Landing from './lib/ui/Landing.svelte';
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
  /** True once the camera has landed inside after walking in. */
  let landed = $state(false);
  const wide = $derived(vw >= 820);

  /** The block being looked up, for the poster to say so, and what went wrong if it did. */
  let finding = $state<string | null>(null);
  let trouble = $state<string | null>(null);
  let lookup: AbortController | null = null;
  let arrivals = 0;

  /** Room the dock will take before it has been measured, so the first camera move lands close. */
  const dockGuess = (lens: Lens = session.lens) =>
    lens === 'sun' ? (wide ? 392 : 358) : lens === 'rules' ? (wide ? 168 : 196) : wide ? 150 : 148;
  /** Room the block stage's controls take, before they have been measured. */
  const blockGuess = () => blockBottom || (wide ? 72 : 260);

  /** The inset the model was last fitted to. A big change in the dock re-fits the model; a small one only slides it. */
  let fitted = 0;
  /** The storey the block last reported, so it is not sent straight back. */
  let heard = 0;

  const hooks: Hooks = {
    frame: () => frames.forEach((f) => f()),
    mode: (m) => {
      if (m === 'walk') session.stage = 'walk';
      else if (m === 'doll' && session.stage === 'walk') session.stage = 'explore';
    },
    wall: (w) => {
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
    }
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
        if (params.walk) walkInto(params.walk === '1' ? null : params.walk);
      }
    } else if (params.postal) {
      void v.showPlan();
      void arriveFromLink();
    } else if (params.skip || reduced) {
      land(v);
      const wall = params.wall ? session.plan.walls.find((w) => w.id === params.wall) : null;
      if (wall) v.select(wall);
      if (params.walk) walkInto(params.walk === '1' ? null : params.walk);
    } else {
      void v.showPlan();
    }
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
  $effect(() => {
    if (session.stage !== 'explore' || !viewer) return;
    const before = viewer.lens;
    viewer.setLens(session.lens);
    // A lens change re-fits against the insets in force; the new panel's height arrives a frame later.
    if (viewer.lens !== before) fitted = untrack(() => dockH) + 6;
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

  $effect(() => {
    if (!viewer) return;
    if (session.stage === 'landing') {
      // The poster takes the left on a wide screen and the bottom on a phone; the plan gets the rest.
      if (wide) viewer.setInsets(0, Math.round(Math.min(640, Math.max(400, vw * 0.44))));
      else viewer.setInsets(posterH, 0);
    } else if (session.stage === 'block' && blockBottom > 0) {
      viewer.setInsets(blockBottom, wide ? blockLeft : 0);
    } else if (session.stage === 'explore' && dockH > 0) {
      const inset = dockH + 6;
      if (Math.abs(inset - fitted) > 48) {
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
    if (session.stage === 'explore') land(viewer);
  }

  function showSite(v: Viewer): void {
    const block = session.block;
    if (!block) return;
    v.setBearing(session.bearing);
    v.showBlock({ block, storeys: session.storeys, label: block.blk }, blockGuess());
    heard = session.storey;
    v.setStorey(session.storey);
    if (session.facade) v.setUnit({ storey: session.storey, facade: session.facade, along: session.along });
  }

  async function enter(): Promise<void> {
    if (!viewer || session.stage !== 'block' || !session.facade) return;
    session.stage = 'entering';
    fitted = dockGuess();
    if (reduced) viewer.jump(fitted);
    else await viewer.enterFlat(fitted);
    if (session.stage === 'entering') session.stage = 'explore';
  }

  async function backToBlock(): Promise<void> {
    if (!viewer || session.stage !== 'explore' || !session.place) return;
    session.wall = null;
    // The Sun lens may have turned the flat; in its block it faces the side that was chosen.
    session.orient();
    session.stage = 'leaving';
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
  </div>
</div>
