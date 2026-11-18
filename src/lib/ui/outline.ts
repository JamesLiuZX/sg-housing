import type { Facade, Footprint, Part, Ring } from '../data';

/**
 * A block drawn from above, north up, as SVG: its footprint and the sides a
 * person would point at. Shared by the outline on the block stage, where the
 * sides are chosen, and the glyph in the Sun lens, which only shows the side
 * that was chosen. SVG runs y down the page, so north (+y) is flipped.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Metres of ground shown round the block: a square a half again as wide as the block, plus a margin. */
export function groundBox(footprint: Footprint | null): Box {
  if (!footprint) return { x: -10, y: -10, w: 20, h: 20 };
  const b = footprint.bounds;
  const side = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 1.5 + 16;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { x: cx - side / 2, y: -cy - side / 2, w: side, h: side };
}

const ring = (r: Ring) => `M${r.map(([x, y]) => `${x.toFixed(1)} ${(-y).toFixed(1)}`).join('L')}Z`;

/** A footprint's parts, holes included, as one path. */
export function shapePath(parts: Part[]): string {
  return parts.map((p) => ring(p.outer) + p.holes.map(ring).join('')).join('');
}

export interface SideMarks {
  /** The side, stood off the wall a little so it reads as "this side" rather than as the wall. */
  line: string;
  /** The view out of it. */
  ray: string;
  /** Where the arrowhead goes, and the bearing it points along. */
  head: { x: number; y: number; angle: number };
}

/** The marks for one side, scaled to the ground shown. */
export function sideMarks(f: Facade, box: Box): SideMarks {
  const r = (f.bearing * Math.PI) / 180;
  const ox = Math.sin(r);
  const oy = -Math.cos(r);
  const off = box.w * 0.035;
  const p = (x: number, y: number, k = off) => `${(x + ox * k).toFixed(1)} ${(-y + oy * k).toFixed(1)}`;
  const [mx, my] = f.mid;
  return {
    line: `M${p(f.a[0], f.a[1])}L${p(f.b[0], f.b[1])}`,
    ray: `M${p(mx, my, off * 1.8)}L${p(mx, my, off * 5)}`,
    head: { x: mx + ox * off * 5, y: -my + oy * off * 5, angle: f.bearing }
  };
}

/** Where the flat sits along a side, `along` 0 to 1 from its first corner, in SVG coordinates. */
export function flatPoint(f: Facade, along: number): { x: number; y: number } {
  return { x: f.a[0] + (f.b[0] - f.a[0]) * along, y: -(f.a[1] + (f.b[1] - f.a[1]) * along) };
}

/** Two sides are the same side of the same block. */
export function sameSide(a: Facade | null, b: Facade): boolean {
  return !!a && a.part === b.part && a.ring === b.ring && a.bearing === b.bearing && a.length === b.length;
}

/** Whether a point given in SVG coordinates falls on the footprint, courtyards excepted. */
export function onFootprint(parts: Part[], x: number, y: number): boolean {
  let inside = false;
  for (const p of parts)
    for (const r of [p.outer, ...p.holes])
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const yi = -r[i][1];
        const yj = -r[j][1];
        if (yi > y !== yj > y && x < ((r[j][0] - r[i][0]) * (y - yi)) / (yj - yi) + r[i][0]) inside = !inside;
      }
  return inside;
}

/**
 * The side a point given in SVG coordinates names, and how far along it the
 * point falls, 0 to 1. A tap anywhere on the drawing names a side, so every
 * side gets a target as big as the drawing allows rather than a hairline.
 *
 * A tap out on the ground names the side the person would be standing in
 * front of: each side that looks towards the tap scores its distance divided
 * by how squarely it looks at it, so a face straight ahead beats a nearer
 * corner seen at a slant, and a face turned away never counts. A tap on the
 * block itself (`onBlock`) names the nearest side.
 */
export function nearestSide(sides: Facade[], x: number, y: number, onBlock = false): { index: number; along: number } | null {
  let best: { index: number; along: number } | null = null;
  let bestScore = Infinity;
  let near: { index: number; along: number } | null = null;
  let nearD = Infinity;
  for (let index = 0; index < sides.length; index++) {
    const f = sides[index];
    const ax = f.a[0];
    const ay = -f.a[1];
    const dx = f.b[0] - ax;
    const dy = -f.b[1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const vx = x - (ax + dx * t);
    const vy = y - (ay + dy * t);
    const d = Math.hypot(vx, vy);
    if (d < nearD) {
      nearD = d;
      near = { index, along: t };
    }
    if (onBlock) continue;
    // The outward normal, with y running down the page so that north is -y.
    const r = (f.bearing * Math.PI) / 180;
    const square = d > 0 ? (vx * Math.sin(r) - vy * Math.cos(r)) / d : 1;
    if (square <= 0) continue;
    const score = d / Math.max(square, 0.05);
    if (score < bestScore) {
      bestScore = score;
      best = { index, along: t };
    }
  }
  return best ?? near;
}
