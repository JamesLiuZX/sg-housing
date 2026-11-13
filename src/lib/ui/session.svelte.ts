import { Spring, prefersReducedMotion } from 'svelte/motion';
import type { Lens } from '../engine/Viewer';
import type { Plan, Wall } from '../plan/types';
import { dayPath, roomSunForDay, roomsLitNow, sunAt, sunTimes, type RoomSun, type SunDate } from '../sg/solar';
import { T0, T1 } from './arc';
import { facingOf, sunSummary } from './sunText';

/**
 * landing   the poster over the line-drawn plan
 * opening   walls are rising; nothing can be pressed yet
 * explore   the dollhouse, with the lens dial
 * walk      first person, inside the flat
 */
export type Stage = 'landing' | 'opening' | 'explore' | 'walk';

export interface SessionInit {
  lens?: Lens | null;
  minutes?: number | null;
  month?: number | null;
  bearing?: number | null;
  furnished?: boolean;
}

const YEAR = new Date().getFullYear();
/** Play sweeps the whole chart in this many seconds. */
const SWEEP_SECONDS = 14;

/** A light spring for a tap that sends the sun across the sky, a firm one for a finger that is holding it. */
const GLIDE = { stiffness: 0.12, damping: 0.75 };
const HELD = { stiffness: 0.3, damping: 0.8 };

/**
 * Everything the interface knows, in one place. Components read it and call its
 * methods; App.svelte mirrors it into the engine. Nothing here touches the DOM
 * or the viewer, so the whole file is ordinary type-checked TypeScript.
 */
export class Session {
  readonly plan: Plan;

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

  #clock: Spring<number>;
  #raf = 0;
  #last = 0;

  constructor(plan: Plan, init: SessionInit = {}) {
    this.plan = plan;
    this.bearing = init.bearing ?? plan.north;
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

  /** Moves the sun to a time of day. `held` is true while a finger is on the knob. */
  scrub(minutes: number, held = false): void {
    this.stop();
    const m = Math.round(Math.min(T1, Math.max(T0, minutes)));
    Object.assign(this.#clock, held ? HELD : GLIDE);
    void this.#clock.set(m, { instant: prefersReducedMotion.current });
  }

  nudge(delta: number): void {
    this.scrub(this.#clock.target + delta);
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
