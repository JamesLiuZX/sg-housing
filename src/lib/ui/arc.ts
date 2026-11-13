import type { PathPoint } from '../sg/solar';

/**
 * Geometry for the sun arc: the day drawn as altitude against time.
 * Kept apart from the component so the maths is type-checked and the same
 * scale serves the full control and the compact one used while walking.
 */

/** The chart runs from 5 am to 9 pm: daylight plus enough night at each end to see it turn. */
export const T0 = 5 * 60;
export const T1 = 21 * 60;

const DEG = Math.PI / 180;
/** Lowest altitude the chart has room for. The sun sits about 29° down at 5 am here. */
const FLOOR_DEG = -30;

export interface ArcScale {
  /** Minutes of the day to x. */
  x: (minutes: number) => number;
  /** Altitude in radians to y. */
  y: (altitude: number) => number;
  /** x back to minutes, clamped to the chart. */
  minutes: (x: number) => number;
  horizon: number;
  left: number;
  right: number;
}

/**
 * `top` is where the sun would sit directly overhead and `bottom` the lowest point of the night tails.
 * Altitude maps linearly, so the curve is the real one and months can be compared by eye.
 */
export function arcScale(width: number, padX: number, top: number, bottom: number): ArcScale {
  const left = padX;
  const right = Math.max(left + 1, width - padX);
  const perDeg = (bottom - top) / (90 - FLOOR_DEG);
  const horizon = top + 90 * perDeg;
  return {
    left,
    right,
    horizon,
    x: (m) => left + ((m - T0) / (T1 - T0)) * (right - left),
    y: (alt) => horizon - Math.max(FLOOR_DEG, alt / DEG) * perDeg,
    minutes: (x) => Math.min(T1, Math.max(T0, T0 + ((x - left) / (right - left)) * (T1 - T0)))
  };
}

export interface ArcPoint {
  m: number;
  x: number;
  y: number;
}

export interface ArcPaths {
  /** The curve above the horizon. */
  day: string;
  /** The curve below it, both tails. */
  night: string;
  /** The daylight area, closed along the horizon. */
  fill: string;
  /** The daylight points, for drawing the stretch the sun has already covered. */
  run: ArcPoint[];
}

const f = (n: number) => n.toFixed(1);
const line = (pts: ArcPoint[]) => (pts.length < 2 ? '' : 'M' + pts.map((p) => `${f(p.x)} ${f(p.y)}`).join('L'));

/** Splits the day's track at the horizon so each part can be stroked in its own way. */
export function arcPaths(points: PathPoint[], s: ArcScale): ArcPaths {
  const inView = points.filter((p) => p.minutes >= T0 && p.minutes <= T1);
  const day: ArcPoint[][] = [];
  const night: ArcPoint[][] = [];
  let run: ArcPoint[] = [];
  let up = inView.length ? inView[0].altitude >= 0 : false;

  const close = () => {
    if (run.length) (up ? day : night).push(run);
    run = [];
  };

  for (let i = 0; i < inView.length; i++) {
    const p = inView[i];
    const nowUp = p.altitude >= 0;
    if (i > 0 && nowUp !== up) {
      // Find where the track meets the horizon so the two strokes join cleanly on the line.
      const q = inView[i - 1];
      const k = q.altitude / (q.altitude - p.altitude);
      const m = q.minutes + (p.minutes - q.minutes) * k;
      const cross = { m, x: s.x(m), y: s.horizon };
      run.push(cross);
      close();
      up = nowUp;
      run.push(cross);
    }
    run.push({ m: p.minutes, x: s.x(p.minutes), y: s.y(p.altitude) });
  }
  close();

  const main = day.reduce<ArcPoint[]>((a, b) => (b.length > a.length ? b : a), []);
  const fill = main.length > 1 ? `${line(main)}L${f(main[main.length - 1].x)} ${f(s.horizon)}L${f(main[0].x)} ${f(s.horizon)}Z` : '';
  return { day: day.map(line).join(''), night: night.map(line).join(''), fill, run: main };
}

/** The part of the daylight curve from sunrise up to a moment, ending exactly at the knob. */
export function arcTrail(run: ArcPoint[], minutes: number, knob: { x: number; y: number }): string {
  if (run.length < 2 || minutes <= run[0].m) return '';
  const done = run.filter((p) => p.m < minutes);
  if (minutes < run[run.length - 1].m) done.push({ m: minutes, x: knob.x, y: knob.y });
  return line(done);
}

export interface HourTick {
  x: number;
  /** Shown under the tick on every third hour. */
  label: string | null;
}

export function hourTicks(s: ArcScale): HourTick[] {
  const out: HourTick[] = [];
  for (let h = T0 / 60; h <= T1 / 60; h++) {
    const major = h % 3 === 0 && h * 60 > T0 && h * 60 < T1;
    const label = !major ? null : h === 12 ? 'noon' : `${h > 12 ? h - 12 : h} ${h < 12 ? 'am' : 'pm'}`;
    out.push({ x: s.x(h * 60), label });
  }
  return out;
}
