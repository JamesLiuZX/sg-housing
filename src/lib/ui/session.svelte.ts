import { Spring, prefersReducedMotion } from 'svelte/motion';
import { facadeFacing, facades, type Block, type BlockFacts, type BlockLookup, type Facade, type ResaleSummary } from '../data';
import type { Lens } from '../engine/Viewer';
import { northForFacing } from '../plan/facing';
import { mirror } from '../plan/mirror';
import { templateById, templates, type Candidate, type Template } from '../plan/templates';
import type { Plan, Wall } from '../plan/types';
import { dayPath, roomSunForDay, roomsLitNow, sunAt, sunTimes, type RoomSun, type SunDate } from '../sg/solar';
import { T0, T1 } from './arc';
import { candidateFor, flatOptions, ok, salesAt, storeysOf, usualOption, usualStorey, type FlatOption } from './place';
import { facingOf, sunSummary } from './sunText';

/**
 * landing   the poster over the line-drawn plan, with the address search
 * opening   walls are rising; nothing can be pressed yet
 * block     the real block, to choose a storey, a side and a flat type
 * entering  the camera is pushing in from the block to the flat
 * leaving   and back out to the block
 * explore   the dollhouse, with the lens dial
 * walk      first person, inside the flat
 */
export type Stage = 'landing' | 'opening' | 'block' | 'entering' | 'leaving' | 'explore' | 'walk';

export interface SessionInit {
  lens?: Lens | null;
  minutes?: number | null;
  month?: number | null;
  bearing?: number | null;
  furnished?: boolean;
}

/** What a link asks for on arrival at a block. Anything left out gets a sensible first choice. */
export interface Arrival {
  storey?: number | null;
  /** Bearing of the side the living room faces. */
  side?: number | null;
  /** "4 ROOM". */
  type?: string | null;
  mirrored?: boolean;
}

const YEAR = new Date().getFullYear();
/** Play sweeps the whole chart in this many seconds. */
const SWEEP_SECONDS = 14;
/** The typical flat: what the poster draws and the "walk a typical 4-room" path opens. */
const TYPICAL: Template = templateById('bto-4room-93') ?? templates[0];
/** A block whose height is not on record is drawn this tall, and its height is not stated. */
const STOREYS_UNKNOWN = 12;

/** A light spring for a tap that sends the sun across the sky, a firm one for a finger that is holding it. */
const GLIDE = { stiffness: 0.12, damping: 0.75 };
const HELD = { stiffness: 0.3, damping: 0.8 };

/**
 * Everything the interface knows, in one place. Components read it and call its
 * methods; App.svelte mirrors it into the engine. Nothing here touches the DOM
 * or the viewer, so the whole file is ordinary type-checked TypeScript.
 */
export class Session {
  stage = $state<Stage>('landing');
  lens = $state<Lens>('space');
  /** 0 to 11. The day is always the 21st, which makes June and December the solstices. */
  month = $state(5);
  /** Compass bearing that the top of the plan faces, degrees. */
  bearing = $state(0);
  furnished = $state(true);
  /** The wall chosen in the Rules lens. Set by the engine's `wall` hook. */
  wall = $state<Wall | null>(null);
  playing = $state(false);
  /** True once the sky is dark enough that the interface has switched to light on ink. */
  night = $state(false);

  // ── The place, when the flat came from an address ──

  /** Everything looked up about the block. Null for the typical flat. */
  place = $state.raw<BlockLookup | null>(null);
  storey = $state(1);
  /** The side of the block the living room faces, and where along it the flat sits, 0 to 1. */
  facade = $state.raw<Facade | null>(null);
  along = $state(0.5);
  /** The flat type chosen, and the typical layout standing in for it. */
  option = $state.raw<FlatOption | null>(null);
  candidate = $state.raw<Candidate | null>(null);
  mirrored = $state(false);

  readonly block: Block | null = $derived(ok(this.place?.block));
  readonly facts: BlockFacts | null = $derived(ok(this.place?.facts));
  readonly resales: ResaleSummary | null = $derived(ok(this.place?.resales));
  /** The block's height as recorded; null when it is not, and the block is drawn a typical height instead. */
  readonly storeysKnown = $derived(storeysOf(this.place));
  readonly storeys = $derived(this.storeysKnown ?? STOREYS_UNKNOWN);
  /** The sides of the block a person would point at. */
  readonly sides: Facade[] = $derived(this.block ? facades(this.block.footprint) : []);
  readonly options: FlatOption[] = $derived(flatOptions(this.place));
  /** Recent resales on the chosen storey's range, newest first. */
  readonly sales = $derived(salesAt(this.resales, this.storey));

  readonly template: Template = $derived(this.candidate?.template ?? TYPICAL);
  readonly plan: Plan = $derived(this.mirrored ? mirror(this.template.plan) : this.template.plan);

  #clock: Spring<number>;
  #raf = 0;
  #last = 0;

  constructor(init: SessionInit = {}) {
    this.bearing = init.bearing ?? TYPICAL.plan.north;
    this.month = init.month ?? 5;
    this.lens = init.lens ?? 'space';
    this.furnished = init.furnished ?? true;
    // Half past four in June: the afternoon sun is well into the west-facing rooms.
    this.#clock = new Spring(init.minutes ?? 16 * 60 + 30, GLIDE);
  }

  /**
   * Minutes of the day, eased. Knob, readout and the light in the scene all read
   * this one value, so they move together and the sun has a little weight.
   */
  get minutes(): number {
    return this.#clock.current;
  }

  readonly date: SunDate = $derived({ year: YEAR, month: this.month, day: 21 });
  readonly path = $derived(dayPath(this.date));
  readonly times = $derived(sunTimes(this.date));
  readonly sun = $derived(sunAt(this.date, this.minutes));

  /** Each windowed room's hours of direct sun on the chosen day. */
  readonly roomSun: Map<string, RoomSun> = $derived.by(() => new Map(roomSunForDay(this.plan, this.bearing, this.date).map((r) => [r.room, r])));

  /** Rooms lit this minute, as a stable string so readers only wake when the set changes. */
  readonly litKey = $derived.by(() => roomsLitNow(this.plan, this.bearing, this.sun).sort().join(','));
  readonly lit = $derived(this.litKey ? this.litKey.split(',') : []);
  readonly summary = $derived.by(() => sunSummary(this.plan, this.lit, this.sun, this.times.rise));
  readonly facing = $derived.by(() => facingOf(this.plan, this.bearing));

  // ── Choosing a flat in a block ──

  /** Arrives at a block, with what a link asked for or the likeliest first choices. */
  arrive(lookup: BlockLookup, want: Arrival = {}): void {
    this.place = lookup;
    this.setStorey(want.storey ?? usualStorey(lookup, this.storeys));
    const options = this.options;
    const asked = want.type ? (options.find((o) => o.flatType === want.type) ?? { flatType: want.type }) : null;
    this.mirrored = !!want.mirrored;
    this.facade = want.side != null ? facadeFacing(this.sides, want.side) : null;
    this.along = 0.5;
    this.chooseFlat(asked ?? usualOption(lookup, options));
  }

  /** Back to the typical flat and the poster. */
  leave(): void {
    this.place = null;
    this.option = null;
    this.candidate = null;
    this.facade = null;
    this.mirrored = false;
    this.bearing = TYPICAL.plan.north;
    this.wall = null;
  }

  setStorey(n: number): void {
    this.storey = Math.min(this.storeys, Math.max(1, Math.round(n)));
  }

  chooseSide(facade: Facade | null, along = 0.5): void {
    this.facade = facade;
    this.along = Math.min(1, Math.max(0, along));
    this.orient();
  }

  chooseFlat(option: FlatOption): void {
    this.option = option;
    this.candidate = candidateFor(option, this.place);
    this.orient();
  }

  setMirrored(on: boolean): void {
    this.mirrored = on;
    this.orient();
  }

  /** With a side chosen, the flat turns so its living room window looks out of it. */
  orient(): void {
    if (this.facade) this.bearing = northForFacing(this.plan, this.facade.bearing);
  }

  // ── The sun ──

  /** Moves the sun to a time of day. `held` is true while a finger is on the knob. */
  scrub(minutes: number, held = false): void {
    this.stop();
    const m = Math.round(Math.min(T1, Math.max(T0, minutes)));
    Object.assign(this.#clock, held ? HELD : GLIDE);
    void this.#clock.set(m, { instant: prefersReducedMotion.current });
  }

  /**
   * Steps the sun by `delta` minutes, landing on that step's grid, so arrow
   * keys read 4:30, 4:40, 4:50 even after a drag left the sun at 4:33.
   */
  nudge(delta: number): void {
    const step = Math.abs(delta);
    if (!step) return;
    const t = this.#clock.target;
    const next = delta > 0 ? Math.floor(t / step + 1e-6) * step + step : Math.ceil(t / step - 1e-6) * step - step;
    this.scrub(next);
  }

  setMonth(month: number): void {
    this.month = ((Math.round(month) % 12) + 12) % 12;
  }

  /** Turns the flat. Takes the bearing of the top of the plan. */
  turn(bearing: number): void {
    this.bearing = ((Math.round(bearing) % 360) + 360) % 360;
  }

  togglePlay(): void {
    if (this.playing) return this.stop();
    this.playing = true;
    // Pressed at the end of the day, play starts the day again.
    if (this.#clock.target >= T1 - 1) void this.#clock.set(T0, { instant: true });
    this.#last = performance.now();
    this.#raf = requestAnimationFrame(this.#sweep);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.#raf);
  }

  #sweep = (now: number): void => {
    // Time-based, so a slow device plays the same day in the same time with fewer frames.
    const dt = Math.min(0.25, (now - this.#last) / 1000);
    this.#last = now;
    const next = this.#clock.current + (dt * (T1 - T0)) / SWEEP_SECONDS;
    if (next >= T1) {
      void this.#clock.set(T1, { instant: true });
      this.playing = false;
      return;
    }
    void this.#clock.set(next, { instant: true });
    this.#raf = requestAnimationFrame(this.#sweep);
  };
}
