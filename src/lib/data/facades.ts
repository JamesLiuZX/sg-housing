/**
 * The sides of a block a person would point at: "my living room faces this
 * side". HDB footprints are full of 1 to 3 m steps (bay windows, planter
 * ledges, recessed service yards), so a footprint's raw edges are not its
 * sides. This finds the long straight runs, lets short jogs and notches ride
 * along with the run they interrupt, and measures each run's direction from
 * the wall segments that actually run that way.
 */

import type { Facade, Footprint, Ring, XY } from './types';

/**
 * The defaults were tuned by eye on a few dozen real footprints across towns:
 * slab blocks come out with their two long sides and two ends, L and T blocks
 * with one side per arm face, and a facade of fins or recessed service yards
 * as one side rather than ten.
 */
export interface FacadeOptions {
  /** Steps and notches shallower than this (metres) never split a side. Default 2.5. */
  jog?: number;
  /** Neighbouring runs whose directions differ by less than this (degrees) are one side. Default 15. */
  angle?: number;
  /** Sides shorter than this (metres) are dropped; when they sit between two parallel runs, those runs join. Default 6. */
  minLength?: number;
  /**
   * Two parallel runs separated only by short pieces join if one is set back
   * from the other by less than this (metres): fins and bay windows standing
   * proud of a wall by up to this much still leave one side. Default 5.
   */
  step?: number;
}

const DEFAULTS: Required<FacadeOptions> = { jog: 2.5, angle: 15, minLength: 6, step: 5 };

/** Fine edges within this angle of a side's direction count when measuring that direction. */
const PARALLEL = Math.cos((30 * Math.PI) / 180);

/**
 * Compass bearing of a ground vector (x east, y north): degrees clockwise
 * from true north, 0 ≤ result < 360. Exact for the four axis directions.
 */
export function bearingOf(x: number, y: number): number {
  let deg = (Math.atan2(x, y) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  // -0 becomes 0, and a hair below zero that rounds up to 360 wraps back.
  return deg >= 360 ? deg - 360 : deg + 0;
}

/**
 * The bearing a wall looks out on, given the direction it runs with the
 * building on its left: the outward normal of (dx, dy) is (dy, -dx).
 */
export function outwardBearing(dx: number, dy: number): number {
  return bearingOf(dy, -dx);
}

/** Smallest difference between two bearings, 0 to 180 degrees. */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function area2(r: Ring): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % n];
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Indices of the vertices Douglas-Peucker keeps on a closed ring, in ring order. */
function keptCorners(r: Ring, tol: number): number[] {
  const n = r.length;
  // Split the ring at two vertices that are surely corners: farthest from the
  // mean, and farthest from that.
  let mx = 0;
  let my = 0;
  for (const [x, y] of r) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  const farthest = (fx: number, fy: number): number => {
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(r[i][0] - fx, r[i][1] - fy);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const a = farthest(mx, my);
  const b = farthest(r[a][0], r[a][1]);
  const keep = new Set<number>([a, b]);
  const at = (k: number): XY => r[k % n];
  const chains: [number, number][] = [
    [a, a < b ? b : b + n],
    [b, b < a ? a : a + n]
  ];
  while (chains.length) {
    const [i, j] = chains.pop()!;
    let worst = -1;
    let worstD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment(at(k), at(i), at(j));
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep.add(worst % n);
      chains.push([i, worst], [worst, j]);
    }
  }
  return [...keep].sort((p, q) => p - q);
}

interface Run {
  /** Fine edge indices, in ring order; edge k runs from vertex k to vertex k + 1. */
  edges: number[];
  /** Unit direction. */
  dx: number;
  dy: number;
  /** Line the run lies on: a point on it, and the run's extent along it. */
  cx: number;
  cy: number;
  t0: number;
  t1: number;
}

/**
 * Measures a run: its direction is the sum of the fine edges that run within
 * 30° of `guess` (so a notch's in-and-out edges cancel nothing and count for
 * nothing), its line passes through their length-weighted middle, and its
 * extent covers every vertex it spans.
 */
function measure(r: Ring, edges: number[], gx: number, gy: number): Run {
  const n = r.length;
  const gl = Math.hypot(gx, gy) || 1;
  const ux = gx / gl;
  const uy = gy / gl;
  let sx = 0;
  let sy = 0;
  let mx = 0;
  let my = 0;
  let w = 0;
  for (const k of edges) {
    const [x0, y0] = r[k];
    const [x1, y1] = r[(k + 1) % n];
    const ex = x1 - x0;
    const ey = y1 - y0;
    const len = Math.hypot(ex, ey);
    if (len === 0 || (ex * ux + ey * uy) / len < PARALLEL) continue;
    sx += ex;
    sy += ey;
    mx += ((x0 + x1) / 2) * len;
    my += ((y0 + y1) / 2) * len;
    w += len;
  }
  let dx = ux;
  let dy = uy;
  let cx: number;
  let cy: number;
  if (w > 0) {
    const sl = Math.hypot(sx, sy);
    dx = sx / sl;
    dy = sy / sl;
    cx = mx / w;
    cy = my / w;
  } else {
    [cx, cy] = r[edges[0]];
  }
  let t0 = Infinity;
  let t1 = -Infinity;
  const first = edges[0];
  const ends = [first, ...edges.map((k) => (k + 1) % n)];
  for (const v of ends) {
    const t = (r[v][0] - cx) * dx + (r[v][1] - cy) * dy;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  return { edges, dx, dy, cx, cy, t0, t1 };
}

function merged(r: Ring, runs: Run[]): Run {
  // Weight each run's direction by its length so a long side decides the joint direction.
  let gx = 0;
  let gy = 0;
  for (const u of runs) {
    const len = u.t1 - u.t0;
    gx += u.dx * len;
    gy += u.dy * len;
  }
  return measure(
    r,
    runs.flatMap((u) => u.edges),
    gx,
    gy
  );
}

function ringFacades(r: Ring, o: Required<FacadeOptions>): { a: XY; b: XY; dx: number; dy: number; firstEdge: number }[] {
  const n = r.length;
  if (n < 3) return [];
  const corners = keptCorners(r, o.jog);
  let runs: Run[] = corners.map((c, i) => {
    const next = corners[(i + 1) % corners.length];
    const edges: number[] = [];
    for (let k = c; k !== next; k = (k + 1) % n) edges.push(k);
    const [x0, y0] = r[c];
    const [x1, y1] = r[next];
    return measure(r, edges, x1 - x0, y1 - y0);
  });

  const cosAngle = Math.cos((o.angle * Math.PI) / 180);
  const long = (u: Run): boolean => u.t1 - u.t0 >= o.minLength;
  const parallel = (u: Run, v: Run): boolean => u.dx * v.dx + u.dy * v.dy >= cosAngle;
  const setBack = (u: Run, v: Run): number => Math.abs((v.cx - u.cx) * u.dy - (v.cy - u.cy) * u.dx);

  // Join runs until nothing changes. Each pass tries every run as the start of
  // a join, around the ring, so a side that straddles vertex 0 joins too.
  for (let changed = true; changed && runs.length > 1; ) {
    changed = false;
    for (let i = 0; i < runs.length && runs.length > 1; i++) {
      const u = runs[i];
      const m = runs.length;
      const next = runs[(i + 1) % m];
      if (parallel(u, next)) {
        runs = splice(runs, i, 2, merged(r, [u, next]));
        changed = true;
        break;
      }
      if (!long(u)) continue;
      // Short pieces, then a parallel run not set back too far: one side with a jog in it.
      let k = 1;
      let shortLength = 0;
      while (k < m - 1 && !long(runs[(i + k) % m])) {
        const s = runs[(i + k) % m];
        shortLength += s.t1 - s.t0;
        k++;
      }
      const v = runs[(i + k) % m];
      if (k > 1 && k < m && long(v) && parallel(u, v) && shortLength <= 2 * o.minLength && setBack(u, v) <= o.step) {
        const group: Run[] = [];
        for (let j = 0; j <= k; j++) group.push(runs[(i + j) % m]);
        runs = splice(runs, i, k + 1, merged(r, group));
        changed = true;
        break;
      }
    }
  }

  return runs
    .filter(long)
    .map((u) => ({
      a: [u.cx + u.dx * u.t0, u.cy + u.dy * u.t0] as XY,
      b: [u.cx + u.dx * u.t1, u.cy + u.dy * u.t1] as XY,
      dx: u.dx,
      dy: u.dy,
      firstEdge: Math.min(...u.edges)
    }))
    .sort((p, q) => p.firstEdge - q.firstEdge);
}

/** Replaces `count` cyclic entries starting at `start` with one. */
function splice<T>(list: T[], start: number, count: number, item: T): T[] {
  const m = list.length;
  const drop = new Set<number>();
  for (let j = 0; j < count; j++) drop.add((start + j) % m);
  const out: T[] = [];
  for (let j = 0; j < m; j++) {
    if (j === start) out.push(item);
    else if (!drop.has(j)) out.push(list[j]);
  }
  return out;
}

/** Points for a ring of either orientation, turned so the building is on the left. */
function oriented(r: Ring, hole: boolean): Ring {
  const ccw = area2(r) > 0;
  return ccw === hole ? r.slice().reverse() : r;
}

/**
 * The footprint's significant straight sides, outside rings first, each with
 * the compass bearing it looks out on. Accepts a footprint from `loadBlock`,
 * or a bare ring (any orientation) for an outline drawn some other way.
 */
export function facades(shape: Footprint | Ring, options: FacadeOptions = {}): Facade[] {
  const o = { ...DEFAULTS, ...options };
  const parts = Array.isArray(shape) ? [{ outer: shape, holes: [] as Ring[] }] : shape.parts;
  const out: Facade[] = [];
  parts.forEach((p, part) => {
    [p.outer, ...p.holes].forEach((ring, ri) => {
      for (const f of ringFacades(oriented(ring, ri > 0), o)) {
        out.push({
          part,
          ring: ri,
          a: f.a,
          b: f.b,
          mid: [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2],
          length: Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]),
          bearing: outwardBearing(f.dx, f.dy)
        });
      }
    });
  });
  return out;
}

/** The facade whose bearing is closest to `bearing`, or null for an empty list. */
export function facadeFacing(list: Facade[], bearing: number): Facade | null {
  let best: Facade | null = null;
  for (const f of list) if (!best || bearingDiff(f.bearing, bearing) < bearingDiff(best.bearing, bearing)) best = f;
  return best;
}
