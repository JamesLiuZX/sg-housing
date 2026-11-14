import { pointInPoly } from './geometry';
import type { Opening, Plan, Pt } from './types';

/**
 * Which way a flat looks out. The block stage stands a flat inside the real
 * block, so it needs the flat's window side as a line it can lay against a
 * facade of the block's footprint, and the `north` that turns the plan to
 * match. The conventions are those of `windowAspects` in src/lib/sg/solar.ts:
 * plan-up faces `plan.north`, and a direction's bearing is `north` plus its
 * angle clockwise from plan-up.
 */

export interface Facade {
  /** The perimeter walls along this side, in order from `a` to `b`. */
  walls: string[];
  /** The two ends of the side on wall centrelines, plan mm, in the outline's clockwise order. */
  a: Pt;
  b: Pt;
  /** Length of the side, mm. */
  length: number;
  /** The way the side looks out, as a unit vector on the plan (x right, y down). */
  out: Pt;
  /** Angle of `out` clockwise from the top of the plan, degrees: 0 when the side looks up the page. */
  offset: number;
  /** The compass bearing the side looks out on with the plan's own `north`. */
  bearing: number;
}

const RAD = Math.PI / 180;
/** Millimetres within which a wall counts as lying on a side of the outline. */
const ON = 1;

/** Degrees in [0, 360), with the noise of floating point taken off whole values. */
function degrees(d: number): number {
  const r = Math.round((((d % 360) + 360) % 360) * 1e9) / 1e9;
  return r === 360 ? 0 : r;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
}

/** The window that decides the facade: the living room's biggest, or else the flat's biggest. */
function keyWindow(plan: Plan): Opening | null {
  const living = new Set(plan.rooms.filter((r) => r.id === 'living' || /living/i.test(r.name)).map((r) => r.id));
  const size = (o: Opening) => o.w * ((o.head ?? plan.height) - (o.sill ?? 0));
  const outside = plan.openings.filter((o) => {
    if (o.type !== 'window') return false;
    const w = plan.walls.find((x) => x.id === o.wall);
    return !!w && plan.outline.some((p, i) => {
      const q = plan.outline[(i + 1) % plan.outline.length];
      return segDist(w.a, p, q) < ON && segDist(w.b, p, q) < ON;
    });
  });
  const pick = (list: Opening[]) => list.reduce<Opening | null>((best, o) => (!best || size(o) > size(best) ? o : best), null);
  return pick(outside.filter((o) => o.room && living.has(o.room))) ?? pick(outside);
}

/**
 * The flat's window side: the straight run of the outline that carries the
 * living room window, or the biggest outside window when no window lights a
 * living room. Null when the flat has no outside window at all.
 */
export function mainFacade(plan: Plan): Facade | null {
  const win = keyWindow(plan);
  const wall = win && plan.walls.find((w) => w.id === win.wall);
  if (!wall) return null;
  const ring = plan.outline;
  const n = ring.length;
  const edge = ring.findIndex((p, i) => segDist(wall.a, p, ring[(i + 1) % n]) < ON && segDist(wall.b, p, ring[(i + 1) % n]) < ON);
  if (edge < 0) return null;

  // An outline may carry a corner in the middle of a straight side; the side runs on through it.
  const dir = (i: number): Pt => {
    const p = ring[((i % n) + n) % n];
    const q = ring[(((i + 1) % n) + n) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  };
  const [dx, dy] = dir(edge);
  const straight = (i: number) => {
    const [ex, ey] = dir(i);
    return Math.abs(ex * dy - ey * dx) < 1e-9 && ex * dx + ey * dy > 0;
  };
  let first = edge;
  let last = edge;
  let taken = 1;
  while (taken < n && straight(first - 1)) {
    first--;
    taken++;
  }
  while (taken < n && straight(last + 1)) {
    last++;
    taken++;
  }
  const a = ring[((first % n) + n) % n];
  const b = ring[(((last + 1) % n) + n) % n];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);

  // Outward is the side away from the flat, the same test windowAspects makes against the room.
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let out: Pt = [dy, -dx];
  if (pointInPoly(mid[0] + out[0] * 50, mid[1] + out[1] * 50, ring)) out = [-dy, dx];
  // Adding zero turns a negative zero positive, so the vector compares equal to the one written by hand.
  out = [out[0] + 0, out[1] + 0];
  const offset = degrees(Math.atan2(out[0], -out[1]) / RAD);

  const along = (p: Pt) => (p[0] - a[0]) * dx + (p[1] - a[1]) * dy;
  const walls = plan.walls
    .filter((w) => segDist(w.a, a, b) < ON && segDist(w.b, a, b) < ON)
    .sort((p, q) => along(p.a) + along(p.b) - along(q.a) - along(q.b))
    .map((w) => w.id);

  return { walls, a: [a[0], a[1]], b: [b[0], b[1]], length, out, offset, bearing: degrees(plan.north + offset) };
}

/**
 * The `north` for a plan whose window side should look out on this compass
 * bearing. With it, `windowAspects` reports that bearing for the windows on
 * that side. A flat with no outside window keeps the north it has.
 */
export function northForFacing(plan: Plan, facadeBearing: number): number {
  const f = mainFacade(plan);
  return f ? degrees(facadeBearing - f.offset) : plan.north;
}
