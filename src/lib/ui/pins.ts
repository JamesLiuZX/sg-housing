import { clearAreaSqm, clearPoly, frameOf, pointInPoly, wallOnEdge } from '../plan/geometry';
import type { Plan, Pt, Room } from '../plan/types';
import type { RoomSun } from '../sg/solar';
import { PIN_PARTITION } from '../sg/rules';
import { MONTHS, clockRange, sqft } from './format';
import { labelPoint, mainWindow, openingPoint } from './scene';

/**
 * Walk mode's room views and the facts pinned in them. A room is seen the
 * way a showflat photograph is taken: from near the back, looking at the
 * window, so the window wall, the floor in front of it and the side walls are
 * all in view. Up to three facts are pinned where they are true: the sun's
 * hours on the window, the clear size on the floor in front of it, and on a
 * partition wall, that it can usually go.
 */

/** Stand this far off the wall behind, mm: room to turn, and clear of skirting and furniture. */
const BACK_OFF = 550;
/** But no further from the window than this, mm, so a long living room is still seen as a room. */
const FAR = 3400;
/** The size is written on the floor this far in front of the window wall, mm. */
const FLOOR_AHEAD = 800;

/** Where a ray from `o` along unit `d` first leaves a polygon, mm, or null. */
function exit(poly: Pt[], o: Pt, d: Pt): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p[0] - o[0]) * ey - (p[1] - o[1]) * ex) / den;
    const s = ((p[0] - o[0]) * d[1] - (p[1] - o[1]) * d[0]) / den;
    if (t > 100 && s >= 0 && s <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

export interface RoomView {
  /** Where to stand, plan mm. */
  at: { x: number; y: number };
  /** What to look at, plan mm: the middle of the main window. */
  lookAt?: { x: number; y: number };
  /** Unit vector from the window into the room, when there is one. */
  inward?: Pt;
  window?: Pt;
}

/** Where to stand to see a room, and what to look at. Rooms with no window are seen from their label point. */
export function roomView(plan: Plan, roomId: string): RoomView | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const [lx, ly] = labelPoint(room);
  const win = mainWindow(plan, roomId);
  const w = win ? openingPoint(plan, win) : null;
  if (!w) return { at: { x: lx, y: ly } };
  let dx = lx - w[0];
  let dy = ly - w[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const depth = exit(room.poly, w, [dx, dy]) ?? len * 2;
  const back = Math.max(len, Math.min(FAR, depth - BACK_OFF));
  return { at: { x: w[0] + dx * back, y: w[1] + dy * back }, lookAt: { x: w[0], y: w[1] }, inward: [dx, dy], window: w };
}

export type PinKind = 'sun' | 'size' | 'wall';

export interface Pin {
  kind: PinKind;
  /** Plan mm, and metres above the floor. */
  x: number;
  y: number;
  h: number;
  text: string;
  sub: string;
}

/** "3.3 × 3.0 m" for a room that is a plain rectangle inside its walls (its area fills its bounds); null for any other shape. */
function clearSides(plan: Plan, room: Room): string | null {
  const poly = clearPoly(plan, room);
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...ys) - Math.min(...ys);
  const area = clearAreaSqm(plan, room) * 1e6;
  if (Math.abs(area - w * d) > w * d * 0.02) return null;
  const [a, b] = w >= d ? [w, d] : [d, w];
  return `${(a / 1000).toFixed(1)} × ${(b / 1000).toFixed(1)} m`;
}

/** The longest plain partition along a room's edge: where it is, and which way the room is. */
function partition(plan: Plan, room: Room): { mid: Pt; into: Pt; len: number } | null {
  let best: { mid: Pt; into: Pt; len: number } | null = null;
  for (let i = 0; i < room.poly.length; i++) {
    const p = room.poly[i];
    const q = room.poly[(i + 1) % room.poly.length];
    const wall = wallOnEdge(plan, p, q);
    if (!wall || wall.kind !== 'partition' || wall.wet) continue;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (best && len <= best.len) continue;
    const f = frameOf(wall);
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    // The wall's face on this room's side, so the pin sits on the paint and not inside the wall.
    const side = pointInPoly(mid[0] + f.nx * 300, mid[1] + f.ny * 300, room.poly) ? 1 : -1;
    const off = wall.t / 2 + 20;
    best = { mid: [mid[0] + f.nx * off * side, mid[1] + f.ny * off * side], into: [f.nx * side, f.ny * side], len };
  }
  return best;
}

/** The facts worth pinning in a room, most useful first. */
export function roomPins(plan: Plan, roomId: string, sun: RoomSun | undefined, month: number): Pin[] {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const pins: Pin[] = [];
  const day = `21 ${MONTHS[month] ?? ''}`.trim();
  const win = mainWindow(plan, roomId);
  const view = roomView(plan, roomId);

  if (win && view?.window) {
    const head = (win.head ?? plan.height) / 1000;
    const sill = (win.sill ?? 0) / 1000;
    const spans = sun?.spans ?? [];
    pins.push({
      kind: 'sun',
      x: view.window[0],
      y: view.window[1],
      h: Math.min(head - 0.2, sill + (head - sill) * 0.45),
      text: spans.length ? spans.slice(0, 2).map(([a, b]) => clockRange(a, b)).join(', ') : 'No direct sun',
      sub: spans.length ? `Direct sun at this window, ${day}` : `At this window, ${day}`
    });
  }

  const area = clearAreaSqm(plan, room);
  const sides = clearSides(plan, room);
  const [lx, ly] = labelPoint(room);
  const floor: Pt = view?.window && view.inward ? [view.window[0] + view.inward[0] * FLOOR_AHEAD, view.window[1] + view.inward[1] * FLOOR_AHEAD] : [lx, ly];
  pins.push({
    kind: 'size',
    x: floor[0],
    y: floor[1],
    h: 0.02,
    text: sides ? `${sides} · ${area.toFixed(1)} m²` : `${area.toFixed(1)} m²`,
    sub: `${sqft(area)} sq ft, wall to wall`
  });

  const p = partition(plan, room);
  if (p) pins.push({ kind: 'wall', x: p.mid[0], y: p.mid[1], h: 1.55, text: PIN_PARTITION.text, sub: PIN_PARTITION.sub });
  return pins;
}

/** Rooms to jump between while walking, in the order a visitor would go round: living spaces, bedrooms, wet rooms. Passages are left out. */
export function stripRooms(plan: Plan): Room[] {
  const ORDER = [/^living/i, /^dining/i, /^kitchen/i, /^master bed/i, /^bedroom/i, /^study/i, /^master bath/i, /bath/i, /yard/i, /shelter/i];
  const rank = (r: Room) => {
    const i = ORDER.findIndex((re) => re.test(r.name));
    return i < 0 ? ORDER.length : i;
  };
  return plan.rooms
    .filter((r) => !/hall|corridor|passage|ledge/i.test(r.name))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}
