import type { Opening, Plan, Pt, Room, Wall } from './types';

export interface WallFrame {
  wall: Wall;
  /** Unit direction a→b. */
  dx: number;
  dy: number;
  /** Left normal of a→b. For perimeter walls drawn clockwise this points indoors. */
  nx: number;
  ny: number;
  len: number;
}

export function frameOf(wall: Wall): WallFrame {
  const ex = wall.b[0] - wall.a[0];
  const ey = wall.b[1] - wall.a[1];
  const len = Math.hypot(ex, ey);
  const dx = ex / len;
  const dy = ey / len;
  return { wall, dx, dy, nx: -dy, ny: dx, len };
}

export function openingsOf(plan: Plan, wallId: string): Opening[] {
  return plan.openings.filter((o) => o.wall === wallId).sort((p, q) => p.at - q.at);
}

/** Stretches of a wall that are solid from floor to ceiling. Windows count as solid. */
export function solidSpans(plan: Plan, wall: Wall): [number, number][] {
  const f = frameOf(wall);
  const gaps = openingsOf(plan, wall.id).filter((o) => o.type !== 'window');
  const spans: [number, number][] = [];
  let cursor = -wall.t / 2;
  for (const g of gaps) {
    if (g.at > cursor) spans.push([cursor, g.at]);
    cursor = g.at + g.w;
  }
  const end = f.len + wall.t / 2;
  if (end > cursor) spans.push([cursor, end]);
  return spans;
}

export function polyArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

export function centroid(poly: Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const k = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
    a += k;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Moves each edge of a polygon sideways by its own distance and rebuilds the
 * corners. Positive distances shrink a clockwise polygon (y down).
 */
export function offsetPoly(poly: Pt[], dist: number[] | number): Pt[] {
  const n = poly.length;
  const sign = polyArea(poly) > 0 ? 1 : -1;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey);
    const d = typeof dist === 'number' ? dist : dist[i];
    // Inward normal for a polygon with positive signed area in y-down space.
    const nx = (-ey / len) * sign;
    const ny = (ex / len) * sign;
    return { px: p[0] + nx * d, py: p[1] + ny * d, ex, ey };
  });
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n];
    const b = lines[i];
    const det = a.ex * b.ey - a.ey * b.ex;
    if (Math.abs(det) < 1e-9) {
      out.push([b.px, b.py]);
      continue;
    }
    const t = ((b.px - a.px) * b.ey - (b.py - a.py) * b.ex) / det;
    out.push([a.px + a.ex * t, a.py + a.ey * t]);
  }
  return out;
}

/** The wall lying along an edge of a room or the outline, or null where the edge is open. */
export function wallOnEdge(plan: Plan, p: Pt, q: Pt): Wall | null {
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  for (const w of plan.walls) {
    if (w.kind === 'parapet') continue;
    const f = frameOf(w);
    const rx = mx - w.a[0];
    const ry = my - w.a[1];
    const u = rx * f.dx + ry * f.dy;
    const v = rx * f.nx + ry * f.ny;
    if (Math.abs(v) < 1 && u > 0 && u < f.len) return w;
  }
  return null;
}

/** Half-thickness of the wall lying along a room edge, or 0 where the edge is open. */
function wallAlong(plan: Plan, p: Pt, q: Pt): number {
  const w = wallOnEdge(plan, p, q);
  return w ? w.t / 2 : 0;
}

/** The room as you could measure it with a tape: centreline polygon less wall thickness. */
export function clearPoly(plan: Plan, room: Room): Pt[] {
  const d = room.poly.map((p, i) => wallAlong(plan, p, room.poly[(i + 1) % room.poly.length]));
  return offsetPoly(room.poly, d);
}

export function clearAreaSqm(plan: Plan, room: Room): number {
  return Math.abs(polyArea(clearPoly(plan, room))) / 1e6;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(plan: Plan): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const eat = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const p of plan.outline) eat(p[0], p[1]);
  for (const s of plan.slabs) {
    eat(s.rect[0], s.rect[1]);
    eat(s.rect[2], s.rect[3]);
  }
  return b;
}

export const SQFT_PER_SQM = 10.7639;
