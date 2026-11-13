<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Viewer, type Lens } from './lib/engine/Viewer';
  import { hero4room } from './lib/plan/hero4room';
  import { Atmosphere } from './lib/ui/atmosphere';
  import Dock from './lib/ui/Dock.svelte';
  import Landing from './lib/ui/Landing.svelte';
  import { readParams } from './lib/ui/params';
  import PlanMarks from './lib/ui/PlanMarks.svelte';
  import RoomLabels from './lib/ui/RoomLabels.svelte';
  import { walkTarget } from './lib/ui/scene';
  import { Session } from './lib/ui/session.svelte';
  import TopBar from './lib/ui/TopBar.svelte';
  import WalkHud from './lib/ui/WalkHud.svelte';
  import WallPin from './lib/ui/WallPin.svelte';

  const params = readParams();
  const session = new Session(hero4room, {
    lens: params.lens,
    minutes: params.minutes,
    month: params.month,
    bearing: params.facing,
    furnished: !params.bare
  });

  /** Overlays that follow the model subscribe here and are called after every rendered frame. */
  const frames = new Set<() => void>();

  let canvas = $state<HTMLCanvasElement>();
  let sky = $state<HTMLElement>();
  // The viewer is a large Three.js object graph; it must never be made deeply reactive.
  let viewer = $state.raw<Viewer | null>(null);
  let vw = $state(0);
  let vh = $state(0);
  let dockH = $state(0);
  let posterH = $state(0);
  /** True once the camera has landed inside after walking in. */
  let landed = $state(false);
  const wide = $derived(vw >= 820);

  /** Room the dock will take before it has been measured, so the first camera move lands close. */
  const dockGuess = (lens: Lens = session.lens) =>
    lens === 'sun' ? (wide ? 392 : 358) : lens === 'rules' ? (wide ? 168 : 196) : wide ? 150 : 148;

  /** The inset the model was last fitted to. A big change in the dock re-fits the model; a small one only slides it. */
  let fitted = 0;

  onMount(() => {
    const atmosphere = new Atmosphere(document.documentElement, sky!, (night) => {
      session.night = night;
    });
    const v = new Viewer(canvas!, hero4room, {
      frame: () => frames.forEach((f) => f()),
      mode: (m) => {
        if (m === 'walk') session.stage = 'walk';
        else if (m === 'doll' && session.stage === 'walk') session.stage = 'explore';
      },
      wall: (w) => {
        session.wall = w;
      },
      atmosphere: (day, gold) => atmosphere.set(day, gold)
    });
    v.setBearing(session.bearing);
    v.setSun(session.sun);
    v.setDayPath(session.path);
    viewer = v;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (params.skip || reduced) {
      v.jump(dockGuess());
      fitted = dockGuess();
      session.stage = 'explore';
      v.setLens(session.lens);
      const wall = params.wall ? hero4room.walls.find((w) => w.id === params.wall) : null;
      if (wall) v.select(wall);
      if (params.walk) walkInto(params.walk === '1' ? null : params.walk);
    } else {
      void v.showPlan();
    }

    return () => {
      v.dispose();
      atmosphere.dispose();
    };
  });

  // Mirror the session into the engine. Each effect reads only what it forwards.
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
  $effect(() => {
    if (!viewer) return;
    if (session.stage === 'landing') {
      // The poster takes the left on a wide screen and the bottom on a phone; the plan gets the rest.
      if (wide) viewer.setInsets(0, Math.round(Math.min(640, Math.max(400, vw * 0.44))));
      else viewer.setInsets(posterH, 0);
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

  async function start(): Promise<void> {
    if (!viewer || session.stage !== 'landing') return;
    session.stage = 'opening';
    fitted = dockGuess();
    await viewer.intro(fitted);
    session.stage = 'explore';
  }

  function walkInto(roomId: string | null): void {
    if (!viewer) return;
    session.stop();
    const to = roomId ? walkTarget(hero4room, roomId) : null;
    landed = false;
    void viewer.enterWalk(to?.at, to?.lookAt).then(() => {
      landed = true;
    });
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div class="stage" data-stage={session.stage}>
  <div class="sky" bind:this={sky}></div>
  <canvas bind:this={canvas} aria-label="3D model of the flat"></canvas>

  {#if viewer && (session.stage === 'landing' || session.stage === 'opening')}
    <PlanMarks {viewer} {frames} bearing={session.bearing} leaving={session.stage === 'opening'} />
  {/if}
  {#if viewer && session.stage === 'explore'}
    <RoomLabels {viewer} {session} {frames} onpick={walkInto} />
    {#if session.lens === 'rules' && session.wall}
      <WallPin {viewer} {frames} wall={session.wall} />
    {/if}
  {/if}

  <div class="layer">
    {#if session.stage === 'landing' || session.stage === 'opening'}
      <Landing leaving={session.stage === 'opening'} {wide} bind:height={posterH} onstart={start} />
    {/if}

    {#if session.stage === 'explore'}
      <TopBar plan={hero4room} />
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
