import { frameOf, openingsOf, pointInPoly } from '../plan/geometry';
import type { Plan } from '../plan/types';

/**
 * Which faces of the flat's walls have the sun on them, worked out on the
 * plan. A point of a face is in sun when a line from it toward the sun leaves
 * the flat through a window or doorway, within the opening's height, before
 * it meets a wall, a door head or the ceiling. With the sun high, its light
 * lands on floors; as it drops the light climbs the walls that face it, and
 * the Sun lens keeps those standing so the light is still there to see.
 */

/** Along each face, as fractions of its length, and up it, metres. */
const ALONG = [0.12, 0.35, 0.65, 0.88];
const UP = [0.3, 1.0, 1.7, 2.3];
/** Points of a face that must be in sun for the face to count: one alone could be a sliver at a jamb. */
const ENOUGH = 2;

interface Crossing {
  /** Index of the wall crossed. */
  wall: number;
  /** Distance along the ray, mm. */
  d: number;
  /** How far along the crossed wall, mm from its `a` end. */
  u: number;
}

/**
 * Two flags per wall, left face then right, the left face being the one its
 * left normal points out of. `dir` points at the sun in plan axes: x as plan
 * x, z as plan y (down the page), y up. Nothing is lit with the sun down.
 */
export function litFaces(plan: Plan, dir: { x: number; y: number; z: number }): Uint8Array {
  const out = new Uint8Array(plan.walls.length * 2);
  const flat = Math.hypot(dir.x, dir.z);
  if (dir.y <= 0 || flat < 1e-6) return out;
  const sx = dir.x / flat;
  const sy = dir.z / flat;
  // Height gained per millimetre travelled across the plan, in metres.
  const rise = dir.y / flat / 1000;
  const ceiling = plan.height / 1000;
  const walls = plan.walls.map((w) => {
    const f = frameOf(w);
    const mx = (w.a[0] + w.b[0]) / 2;
    const my = (w.a[1] + w.b[1]) / 2;
    const probe = w.t / 2 + 250;
    const left = pointInPoly(mx + f.nx * probe, my + f.ny * probe, plan.outline);
    const right = pointInPoly(mx - f.nx * probe, my - f.ny * probe, plan.outline);
    return { w, f, left, right, outer: left !== right, top: (w.h ?? plan.height) / 1000, gaps: openingsOf(plan, w.id) };
  });

  /** Whether the line from (x, y) at height h toward the sun gets out of the flat. */
  const reaches = (from: number, x: number, y: number, h: number): boolean => {
    const hits: Crossing[] = [];
    walls.forEach(({ w, f }, i) => {
      if (i === from) return;
      // The ray (x, y) + d·s against the wall's centre line a + u·(dx, dy).
      const den = sx * f.dy - sy * f.dx;
      if (Math.abs(den) < 1e-9) return;
      const ax = w.a[0] - x;
      const ay = w.a[1] - y;
      const d = (ax * f.dy - ay * f.dx) / den;
      const u = (ax * sy - ay * sx) / den;
      if (d > 1 && u >= -w.t / 2 && u <= f.len + w.t / 2) hits.push({ wall: i, d, u });
    });
    hits.sort((p, q) => p.d - q.d);
    for (const c of hits) {
      const { gaps, outer, top } = walls[c.wall];
      const at = h + c.d * rise;
      // Still under the ceiling, or the light came down through it.
      if (at >= ceiling) return false;
      const gap = gaps.find((o) => c.u > o.at && c.u < o.at + o.w);
      const sill = gap?.type === 'window' ? (gap.sill ?? 0) / 1000 : 0;
      const head = gap ? (gap.head ?? plan.height) / 1000 : 0;
      const through = gap ? at > sill && at < head : at > top;
      if (!through) return false;
      if (outer) return true;
    }
    return false;
  };

  walls.forEach(({ w, f, left, right, gaps }, i) => {
    for (const side of [1, -1]) {
      // Only faces that look into the flat, and only those that face the sun at all.
      if (!(side > 0 ? left : right)) continue;
      if ((f.nx * sx + f.ny * sy) * side <= 0) continue;
      const off = w.t / 2 + 5;
      let lit = 0;
      for (const k of ALONG) {
        const u = k * f.len;
        // A face's own openings are holes, not wall.
        if (gaps.some((o) => u > o.at && u < o.at + o.w)) continue;
        const x = w.a[0] + f.dx * u + f.nx * off * side;
        const y = w.a[1] + f.dy * u + f.ny * off * side;
        for (const h of UP) if (h < Math.min(ceiling, (w.h ?? plan.height) / 1000) && reaches(i, x, y, h)) lit++;
      }
      if (lit >= ENOUGH) out[i * 2 + (side > 0 ? 0 : 1)] = 1;
    }
  });
  return out;
}
