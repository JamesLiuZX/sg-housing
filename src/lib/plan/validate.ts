import { Nav } from '../engine/nav';
import { boundsOf, centroid, frameOf, openingsOf, pointInPoly, polyArea, type WallFrame } from './geometry';
import type { Face, Item, Opening, Plan, Pt, Room, Wall } from './types';

/**
 * Checks a flat for the mistakes that are easy to make when a plan is drawn
 * by hand and hard to see in the model: a wall drawn the wrong way round, a
 * window credited to the wrong room, a door that opens into a wardrobe, a
 * room nobody can walk into. Every template must come back clean, and so
 * must its mirror image, because the interface shows both as fact.
 *
 * Furniture is checked against the shapes the engine actually builds, not
 * just the width and depth written in the plan: a bed's headboard stands
 * behind it, chairs pull out from a desk or a dining table, and a bi-fold
 * door sweeps far less floor than a hinged one.
 */

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  /** Stable name of the check, for tests and filtering: 'item-wall', 'room-unreachable'. */
  code: string;
  /** What is at fault: a wall, opening, room or slab id, `outline`, `entry`, or `items[3] bed`. */
  ref: string;
  message: string;
}

export interface ValidateOptions {
  /** How far the room polygons may stray from the stated floor area, as a fraction. */
  areaTolerance?: number;
  /** Leave out the walking check, the slowest one. */
  skipNav?: boolean;
}

type Poly = Pt[];

/** Millimetres within which two lines count as the same line. */
const ON = 1;
/** Overlap forgiven between things drawn touching, mm. */
const TOUCH = 2;
/** Floor left out of every room, or claimed by two, that counts as a mistake, m². */
const AREA_SLIP = 0.02;
/** Grid for the area checks. The offset keeps samples off whole-millimetre lines. */
const STEP = 50;
const OFFSET = 12.5;

// ── Furniture as the engine builds it ───────────────────────────────────────

/**
 * Where a piece lives. `floor` stands on the floor and must be clear of walls,
 * other furniture and door swings. `over` lies under or hangs above others
 * (rugs, pendants). `wall` is mounted high on a wall face. `outside` stands
 * beyond the flat: compressors on a ledge, the laundry rack out of a window.
 */
type Layer = 'floor' | 'over' | 'wall' | 'outside';

interface Kind {
  layer: Layer;
  /** Size when the plan leaves it out, mm, as furniture.ts draws it. */
  w: number;
  d: number;
  /** May stand on a slab outside the flat as well as indoors. */
  corridor?: boolean;
  /** Height of the top, mm, where something mounted above could meet it. */
  top?: number;
}

const KINDS: Record<string, Kind> = {
  sofa: { layer: 'floor', w: 2200, d: 920 },
  bed: { layer: 'floor', w: 1520, d: 2000 },
  sideTable: { layer: 'floor', w: 450, d: 420 },
  wardrobe: { layer: 'floor', w: 1500, d: 600, top: 2320 },
  desk: { layer: 'floor', w: 1200, d: 600 },
  diningSet: { layer: 'floor', w: 1600, d: 850 },
  tvConsole: { layer: 'floor', w: 1800, d: 450 },
  coffeeTable: { layer: 'floor', w: 800, d: 800 },
  plant: { layer: 'floor', w: 420, d: 420, corridor: true },
  floorLamp: { layer: 'floor', w: 380, d: 380 },
  shoeCabinet: { layer: 'floor', w: 1000, d: 350 },
  shoeRack: { layer: 'floor', w: 700, d: 300, corridor: true },
  counter: { layer: 'floor', w: 2400, d: 600 },
  fridge: { layer: 'floor', w: 700, d: 700 },
  washer: { layer: 'floor', w: 600, d: 600 },
  bookshelf: { layer: 'floor', w: 1600, d: 320 },
  wc: { layer: 'floor', w: 400, d: 700 },
  vanity: { layer: 'floor', w: 700, d: 460 },
  showerScreen: { layer: 'floor', w: 1000, d: 24 },
  rack: { layer: 'floor', w: 1500, d: 450 },
  chute: { layer: 'floor', w: 600, d: 600 },
  rug: { layer: 'over', w: 1700, d: 2300 },
  pendant: { layer: 'over', w: 480, d: 480 },
  aircon: { layer: 'wall', w: 880, d: 200 },
  hsVent: { layer: 'wall', w: 630, d: 30 },
  compressor: { layer: 'outside', w: 820, d: 320 },
  dryingRack: { layer: 'outside', w: 1260, d: 1000 }
};

/** Where mounted pieces sit, mm: the same heights as MOUNTED in furniture.ts. */
const MOUNT_FROM: Record<string, number> = { aircon: 2200, hsVent: 2105 };

/** Local axes of a piece on the plan: x across its front, z out of its front. */
const AXES: Record<Face, { ex: Pt; ez: Pt }> = {
  S: { ex: [1, 0], ez: [0, 1] },
  N: { ex: [-1, 0], ez: [0, -1] },
  E: { ex: [0, -1], ez: [1, 0] },
  W: { ex: [0, 1], ez: [-1, 0] }
};

function local(it: Item, lx: number, lz: number): Pt {
  const { ex, ez } = AXES[it.face ?? 'S'];
  return [it.x + ex[0] * lx + ez[0] * lz, it.y + ex[1] * lx + ez[1] * lz];
}

function localRect(it: Item, x0: number, x1: number, z0: number, z1: number): Poly {
  return [local(it, x0, z0), local(it, x1, z0), local(it, x1, z1), local(it, x0, z1)];
}

function circle(x: number, y: number, r: number, n = 12): Poly {
  const out: Poly = [];
  for (let i = 0; i < n; i++) out.push([x + r * Math.cos((i / n) * Math.PI * 2), y + r * Math.sin((i / n) * Math.PI * 2)]);
  return out;
}

function sizeOf(it: Item): { w: number; d: number } {
  const k = KINDS[it.kind];
  return { w: it.w ?? k?.w ?? 0, d: it.d ?? k?.d ?? 0 };
}

/**
 * The floor a piece takes, as convex shapes. The extra parts follow
 * furniture.ts: a bed's frame and headboard, the chair in front of a desk,
 * the chairs along both sides of a dining table.
 */
function footprint(it: Item): Poly[] {
  const { w, d } = sizeOf(it);
  switch (it.kind) {
    case 'bed':
      return [localRect(it, -w / 2 - 55, w / 2 + 55, -d / 2 - 90, d / 2 + 25)];
    case 'desk':
      return it.opts?.vanity
        ? [localRect(it, -w / 2, w / 2, -d / 2, d / 2), localRect(it, -190, 190, d / 2, d / 2 + 350)]
        : [localRect(it, -w / 2, w / 2, -d / 2, d / 2), localRect(it, -200, 240, d / 2, d / 2 + 360)];
    case 'diningSet':
      return [localRect(it, -w / 2, w / 2, -d / 2 - 320, d / 2 + 320)];
    case 'coffeeTable':
      return [circle(it.x, it.y, Math.max(w, d) / 2)];
    case 'plant':
    case 'floorLamp':
      return [circle(it.x, it.y, Math.max(w, d) / 2)];
    case 'showerScreen':
      return [localRect(it, -w / 2, w / 2, -12, 12)];
    case 'aircon':
    case 'hsVent':
    case 'dryingRack':
      // These grow forward from a point on a wall face.
      return [localRect(it, -w / 2, w / 2, 0, d)];
    default:
      return [localRect(it, -w / 2, w / 2, -d / 2, d / 2)];
  }
}

/** Height of the top of a floor piece, mm, where a mounted one could meet it. */
function topOf(it: Item): number {
  if (it.kind === 'counter' && it.opts?.upper) return 2320;
  return KINDS[it.kind]?.top ?? 0;
}

// ── Plane geometry ──────────────────────────────────────────────────────────

function range(p: Poly, ax: number, ay: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of p) {
    const s = x * ax + y * ay;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [lo, hi];
}

/** How deeply two convex shapes overlap: the shortest push that would part them, mm. Zero or less when apart. */
function overlap(a: Poly, b: Poly): number {
  let least = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      const ax = -(q[1] - p[1]) / len;
      const ay = (q[0] - p[0]) / len;
      const [a0, a1] = range(a, ax, ay);
      const [b0, b1] = range(b, ax, ay);
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return o;
      least = Math.min(least, o);
    }
  }
  return least;
}

/** A point in a wall's frame: u along it from `a`, v toward its left normal. */
function onWall(f: WallFrame, u: number, v: number): Pt {
  return [f.wall.a[0] + f.dx * u + f.nx * v, f.wall.a[1] + f.dy * u + f.ny * v];
}

/** A wall's body as built: its ends run on by half its thickness, so corners close. */
function wallBody(f: WallFrame, u0 = -f.wall.t / 2, u1 = f.len + f.wall.t / 2): Poly {
  const h = f.wall.t / 2;
  return [onWall(f, u0, -h), onWall(f, u1, -h), onWall(f, u1, h), onWall(f, u0, h)];
}

/** Where point p falls in a wall's frame. */
function toFrame(f: WallFrame, p: Pt): { u: number; v: number } {
  const rx = p[0] - f.wall.a[0];
  const ry = p[1] - f.wall.a[1];
  return { u: rx * f.dx + ry * f.dy, v: rx * f.nx + ry * f.ny };
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
}

/** Whether segments ab and cd cross or touch. */
function segsMeet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const near = (p: Pt, s: Pt, e: Pt) => segDist(p, s, e) < 1e-6;
  return near(c, a, b) || near(d, a, b) || near(a, c, d) || near(b, c, d);
}

type Span = [number, number];

/** The parts of segment p→q, in mm along it, that lie on any of the given segments. */
function covered(p: Pt, q: Pt, segs: [Pt, Pt][]): Span[] {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const dx = (q[0] - p[0]) / len;
  const dy = (q[1] - p[1]) / len;
  const spans: Span[] = [];
  for (const [a, b] of segs) {
    const off = (r: Pt) => Math.abs((r[0] - p[0]) * dy - (r[1] - p[1]) * dx);
    if (off(a) > ON || off(b) > ON) continue;
    const ta = (a[0] - p[0]) * dx + (a[1] - p[1]) * dy;
    const tb = (b[0] - p[0]) * dx + (b[1] - p[1]) * dy;
    const lo = Math.max(0, Math.min(ta, tb));
    const hi = Math.min(len, Math.max(ta, tb));
    if (hi - lo > ON) spans.push([lo, hi]);
  }
  spans.sort((s, t) => s[0] - t[0]);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + ON) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

/** The parts of [0, len] that the spans leave out. */
function gaps(len: number, spans: Span[]): Span[] {
  const out: Span[] = [];
  let cursor = 0;
  for (const [a, b] of spans) {
    if (a - cursor > ON) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (len - cursor > ON) out.push([cursor, len]);
  return out;
}

function edges(poly: Poly): [Pt, Pt][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as [Pt, Pt]);
}

function mm(n: number): string {
  return `${Math.round(n)} mm`;
}

function onBoundary(p: Pt, poly: Poly): boolean {
  return edges(poly).some(([a, b]) => segDist(p, a, b) < ON);
}

// ── The checks ──────────────────────────────────────────────────────────────

export function validatePlan(plan: Plan, options: ValidateOptions = {}): Issue[] {
  const tolerance = options.areaTolerance ?? 0.03;
  const out: Issue[] = [];
  const add = (level: IssueLevel, code: string, ref: string, message: string) => out.push({ level, code, ref, message });
  const error = (code: string, ref: string, message: string) => add('error', code, ref, message);
  const warn = (code: string, ref: string, message: string) => add('warning', code, ref, message);

  const frames = new Map<string, WallFrame>();
  const solidWalls: WallFrame[] = [];
  for (const w of plan.walls) {
    if (Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < ON || !(w.t > 0)) {
      error('wall-shape', w.id, `Wall ${w.id} has no length or no thickness.`);
      continue;
    }
    const f = frameOf(w);
    frames.set(w.id, f);
    if (w.kind !== 'parapet') solidWalls.push(f);
  }
  const roomById = new Map(plan.rooms.map((r) => [r.id, r]));
  const roomAt = (p: Pt): Room | undefined => plan.rooms.find((r) => pointInPoly(p[0], p[1], r.poly));
  const inFlat = (p: Pt) => pointInPoly(p[0], p[1], plan.outline);
  const onSlab = (p: Pt) => plan.slabs.some((s) => p[0] > s.rect[0] && p[0] < s.rect[2] && p[1] > s.rect[1] && p[1] < s.rect[3]);

  // Ids are how openings, windows and shared links refer to things.
  for (const [what, list] of [
    ['wall', plan.walls],
    ['opening', plan.openings],
    ['room', plan.rooms],
    ['slab', plan.slabs]
  ] as const) {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) error('id-duplicate', x.id, `Two of the ${what}s share the id ${x.id}.`);
      seen.add(x.id);
    }
  }

  // ── Outline ──
  const ring = plan.outline;
  if (ring.length < 3) {
    error('outline-shape', 'outline', 'The outline needs at least three corners.');
    return out;
  }
  if (polyArea(ring) <= 0) error('outline-winding', 'outline', 'The outline must run clockwise on the plan (y down), so every wall on it has the flat on its left.');
  checkSimple(ring, 'outline', 'The outline', error);
  const allSegs = plan.walls.map((w) => [w.a, w.b] as [Pt, Pt]);
  for (const [p, q] of edges(ring)) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (const [a, b] of gaps(len, covered(p, q, allSegs))) {
      error('outline-gap', 'outline', `The outline from (${p.join(', ')}) to (${q.join(', ')}) has ${mm(b - a)} with no wall on it.`);
    }
  }

  // ── Walls ──
  const outlineEdges = edges(ring);
  const onOutline = (f: WallFrame) => {
    const mid: Pt = onWall(f, f.len / 2, 0);
    return outlineEdges.find(([p, q]) => segDist(mid, p, q) < ON && segDist(f.wall.a, p, q) < ON && segDist(f.wall.b, p, q) < ON);
  };
  for (const f of frames.values()) {
    const w = f.wall;
    const edge = onOutline(f);
    if (edge) {
      const ex = edge[1][0] - edge[0][0];
      const ey = edge[1][1] - edge[0][1];
      if (ex * f.dx + ey * f.dy < 0) error('wall-winding', w.id, `Wall ${w.id} runs against the outline, so its left side faces outdoors. Swap a and b.`);
      if (w.kind === 'partition') error('wall-kind', w.id, `Wall ${w.id} is on the outline but drawn as a partition; outer walls are external, structural or shelter walls.`);
    } else if (w.kind === 'parapet') {
      if (inFlat(onWall(f, f.len / 2, 0))) warn('wall-kind', w.id, `Parapet ${w.id} stands inside the flat.`);
    } else {
      // Inside the flat, or at most on its boundary.
      for (const k of [0, 0.5, 1]) {
        const p = onWall(f, f.len * k, 0);
        if (!inFlat(p) && !onBoundary(p, ring)) {
          error('wall-outside', w.id, `Wall ${w.id} runs outside the outline.`);
          break;
        }
      }
      if (w.kind === 'external') warn('wall-kind', w.id, `Wall ${w.id} is marked external but is not on the outline.`);
    }
    // A wall through the middle of a room means the room is really two.
    if (w.kind !== 'parapet') {
      for (const k of [0.25, 0.5, 0.75]) {
        const l = onWall(f, f.len * k, 6);
        const r = onWall(f, f.len * k, -6);
        const room = plan.rooms.find((rm) => pointInPoly(l[0], l[1], rm.poly) && pointInPoly(r[0], r[1], rm.poly));
        if (room) {
          error('wall-in-room', w.id, `Wall ${w.id} runs through the middle of ${room.id}; split the room or move the wall onto its edge.`);
          break;
        }
      }
    }
  }
  const list = [...frames.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const f = list[i];
      const g = list[j];
      if (Math.abs(f.dx * g.dy - f.dy * g.dx) > 1e-6) continue;
      const shared = covered(f.wall.a, f.wall.b, [[g.wall.a, g.wall.b]]);
      if (shared.length) error('wall-overlap', f.wall.id, `Walls ${f.wall.id} and ${g.wall.id} lie on top of each other for ${mm(shared[0][1] - shared[0][0])}.`);
    }
  }

  // ── Openings ──
  for (const o of plan.openings) {
    const f = frames.get(o.wall);
    if (!f) {
      error('opening-wall', o.id, `Opening ${o.id} is on wall ${o.wall}, which does not exist.`);
      continue;
    }
    checkOpening(plan, o, f, solidWalls, error, warn);
  }
  for (const f of frames.values()) {
    const ops = openingsOf(plan, f.wall.id);
    for (let i = 1; i < ops.length; i++) {
      const gap = ops[i].at - (ops[i - 1].at + ops[i - 1].w);
      if (gap < -ON) error('opening-overlap', ops[i].id, `Openings ${ops[i - 1].id} and ${ops[i].id} overlap by ${mm(-gap)} on wall ${f.wall.id}.`);
    }
  }

  // ── Rooms ──
  let total = 0;
  const roomSegs = plan.rooms.flatMap((r) => edges(r.poly).map((e) => ({ room: r.id, e })));
  for (const room of plan.rooms) {
    const poly = room.poly;
    if (poly.length < 3) {
      error('room-shape', room.id, `Room ${room.id} needs at least three corners.`);
      continue;
    }
    const area = polyArea(poly);
    total += Math.abs(area);
    if (area < 0) warn('room-winding', room.id, `Room ${room.id} runs anticlockwise; every other polygon in the format runs clockwise.`);
    checkSimple(poly, room.id, `Room ${room.id}`, error);
    // Each edge is a wall, or open to the room next door. Anything else opens onto nothing.
    for (const [p, q] of edges(poly)) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const by = [...allSegs, ...roomSegs.filter((s) => s.room !== room.id).map((s) => s.e)];
      for (const [a, b] of gaps(len, covered(p, q, by))) {
        error('room-edge-open', room.id, `Room ${room.id} has ${mm(b - a)} of edge from (${p.join(', ')}) toward (${q.join(', ')}) with no wall and no room beyond.`);
      }
    }
    if (/shelter/i.test(room.name)) {
      for (const [p, q] of edges(poly)) {
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const strong = plan.walls.filter((w) => w.kind === 'shelter').map((w) => [w.a, w.b] as [Pt, Pt]);
        if (gaps(len, covered(p, q, strong)).length) error('shelter-wall', room.id, `The household shelter must be closed by shelter walls on every side; the edge from (${p.join(', ')}) is not.`);
      }
    }
    if (/\bbath|\bwc\b|toilet/i.test(room.name)) {
      for (const [p, q] of edges(poly)) {
        for (const w of plan.walls) {
          if (w.kind !== 'partition' || w.wet) continue;
          if (covered(p, q, [[w.a, w.b]]).length) warn('wet-wall', w.id, `Partition ${w.id} bounds ${room.id} but is not marked wet, so the bathroom rule would not show on it.`);
        }
      }
    }
  }
  const stated = plan.areaSqm;
  const sum = total / 1e6;
  if (Math.abs(sum - stated) > stated * tolerance) {
    error('area-total', 'rooms', `The rooms add up to ${sum.toFixed(1)} m², more than ${Math.round(tolerance * 100)}% away from the stated ${stated} m².`);
  }
  checkCover(plan, error);

  // ── Windows name the room they light ──
  for (const o of plan.openings) {
    if (o.type !== 'window') continue;
    const f = frames.get(o.wall);
    if (!f) continue;
    const room = o.room ? roomById.get(o.room) : undefined;
    if (!room) {
      error('window-room', o.id, o.room ? `Window ${o.id} lights ${o.room}, which is not a room.` : `Window ${o.id} does not say which room it lights.`);
      continue;
    }
    const mid = onWall(f, o.at + o.w / 2, 0);
    const reach = f.wall.t / 2 + 60;
    const left = onWall(f, o.at + o.w / 2, reach);
    const right = onWall(f, o.at + o.w / 2, -reach);
    const inL = pointInPoly(left[0], left[1], room.poly);
    const inR = pointInPoly(right[0], right[1], room.poly);
    if (!onBoundary(mid, room.poly) || inL === inR) {
      error('window-room', o.id, `Window ${o.id} is credited to ${room.id} but is not on a wall of that room.`);
      continue;
    }
    const beyond = inL ? right : left;
    if (inFlat(beyond)) warn('window-indoors', o.id, `Window ${o.id} looks into the flat, not out of it; the sun study will treat it as an outside window.`);
  }

  // ── Slabs, the entrance and the entry point ──
  for (const s of plan.slabs) {
    const [x0, y0, x1, y1] = s.rect;
    if (!(x1 > x0 && y1 > y0)) {
      error('slab-shape', s.id, `Slab ${s.id} must be written [left, top, right, bottom].`);
      continue;
    }
    const inner: Pt[] = [
      [(x0 + x1) / 2, (y0 + y1) / 2],
      [x0 + 30, y0 + 30],
      [x1 - 30, y0 + 30],
      [x1 - 30, y1 - 30],
      [x0 + 30, y1 - 30]
    ];
    if (inner.some((p) => inFlat(p))) error('slab-overlap', s.id, `Slab ${s.id} lies over the flat itself; slabs are for floor outside it.`);
  }
  const corridor = plan.slabs.find((s) => s.id === 'corridor');
  if (!corridor) error('corridor-missing', 'slabs', 'There is no slab with the id corridor, so nobody can step out of the front door.');
  const front = plan.openings.find((o) => {
    if (o.type !== 'door') return false;
    const f = frames.get(o.wall);
    return !!f && !!onOutline(f) && f.wall.kind !== 'parapet';
  });
  if (!front) error('entrance', 'openings', 'No door on the outline: the flat has no way in.');
  let outside: Pt | null = null;
  if (front) {
    const f = frames.get(front.wall)!;
    const u = front.at + front.w / 2;
    const l = onWall(f, u, f.wall.t / 2 + 400);
    const r = onWall(f, u, -(f.wall.t / 2 + 400));
    outside = inFlat(l) ? r : l;
    if (!onSlab(outside)) error('entrance', front.id, `The front door ${front.id} does not open onto a slab.`);
    const [ex, ey] = onWall(f, u, 0);
    if (Math.hypot(plan.entry.x - ex, plan.entry.y - ey) > 2500) warn('entry-far', 'entry', `The entry point is more than 2.5 m from the front door ${front.id}.`);
  }
  if (!roomAt([plan.entry.x, plan.entry.y])) error('entry-outside', 'entry', 'The entry point is not inside any room.');

  // ── Lights ──
  const bodies = [...frames.values()].map((f) => ({ id: f.wall.id, body: wallBody(f) }));
  const lit = new Set<string>();
  plan.lights.forEach((p, i) => {
    const room = roomAt(p);
    if (!room || !inFlat(p)) {
      error('light-outside', `lights[${i}]`, `Light ${i} at (${p.join(', ')}) is not inside a room.`);
      return;
    }
    lit.add(room.id);
    const dot = circle(p[0], p[1], 60, 8);
    for (const b of bodies) if (overlap(dot, b.body) > 0) error('light-wall', `lights[${i}]`, `Light ${i} hangs inside wall ${b.id}.`);
  });
  for (const r of plan.rooms) if (!lit.has(r.id)) warn('room-dark', r.id, `Room ${r.id} has no ceiling light, so it goes dark at night.`);

  // ── Furniture ──
  checkItems(plan, frames, bodies, roomAt, inFlat, onSlab, error, warn);

  // ── On foot ──
  if (!options.skipNav) checkWalking(plan, outside, error);

  return out;
}

type Report = (code: string, ref: string, message: string) => void;

function checkSimple(poly: Poly, ref: string, name: string, error: Report): void {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < ON) {
      error('poly-shape', ref, `${name} repeats the corner (${a.join(', ')}).`);
      return;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Neighbouring edges share a corner; they only go wrong by doubling back.
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const [a, b] = [poly[i], poly[(i + 1) % n]];
      const [c, d] = [poly[j], poly[(j + 1) % n]];
      if (adjacent) {
        const shared = j === i + 1 ? b : a;
        const p = shared === b ? a : b;
        const q = shared === b ? d : c;
        const cr = (p[0] - shared[0]) * (q[1] - shared[1]) - (p[1] - shared[1]) * (q[0] - shared[0]);
        const dt = (p[0] - shared[0]) * (q[0] - shared[0]) + (p[1] - shared[1]) * (q[1] - shared[1]);
        if (Math.abs(cr) < 1e-6 && dt > 0) {
          error('poly-shape', ref, `${name} doubles back on itself at (${shared.join(', ')}).`);
          return;
        }
      } else if (segsMeet(a, b, c, d)) {
        error('poly-shape', ref, `${name} crosses itself near (${c.join(', ')}).`);
        return;
      }
    }
  }
}

/** Openings sit within their wall, clear of the walls that meet it, at heights that make sense. */
function checkOpening(plan: Plan, o: Opening, f: WallFrame, solid: WallFrame[], error: Report, warn: Report): void {
  const wh = f.wall.h ?? plan.height;
  if (!(o.w > 0)) error('opening-range', o.id, `Opening ${o.id} has no width.`);
  if (o.at < -ON || o.at + o.w > f.len + ON) {
    error('opening-range', o.id, `Opening ${o.id} runs past the end of wall ${f.wall.id} (${mm(o.at)} to ${mm(o.at + o.w)} on a ${mm(f.len)} wall).`);
  }
  // A wall meeting this one takes its thickness out of it, and an opening cannot cut through that.
  for (const g of solid) {
    if (g.wall.id === f.wall.id) continue;
    const sin = Math.abs(f.dx * g.dy - f.dy * g.dx);
    if (sin < 1e-6) continue;
    const ends = [g.wall.a, g.wall.b];
    const hits: number[] = [];
    for (const e of ends) {
      const { u, v } = toFrame(f, e);
      if (Math.abs(v) < ON && u > -ON && u < f.len + ON) hits.push(u);
    }
    if (!hits.length) {
      const a = toFrame(f, g.wall.a);
      const b = toFrame(f, g.wall.b);
      if (a.v * b.v < 0) {
        const u = a.u + ((b.u - a.u) * a.v) / (a.v - b.v);
        if (u > 0 && u < f.len) hits.push(u);
      }
    }
    for (const u of hits) {
      const half = g.wall.t / 2 / sin;
      const o0 = Math.max(o.at, u - half);
      const o1 = Math.min(o.at + o.w, u + half);
      if (o1 - o0 > ON) error('opening-range', o.id, `Opening ${o.id} cuts into wall ${g.wall.id}, which meets ${f.wall.id} at ${mm(u)}.`);
    }
  }
  if (o.type === 'window') {
    const sill = o.sill ?? 0;
    const head = o.head ?? plan.height;
    if (!(sill < head) || head > wh + ON) error('opening-height', o.id, `Window ${o.id} needs a sill below its head, and a head no higher than the wall (${mm(wh)}).`);
  } else if (o.type === 'door') {
    if ((o.head ?? plan.height) > wh + ON) error('opening-height', o.id, `Door ${o.id} is taller than its wall.`);
    if (!o.hinge || !o.into || !o.leaf) warn('door-detail', o.id, `Door ${o.id} should say its leaf, which end it hinges at and which side it swings to.`);
  }
}

/** Rooms tile the flat: no floor claimed twice, none left out, none outside. */
function checkCover(plan: Plan, error: Report): void {
  const b = boundsOf(plan);
  let twice = 0;
  let none = 0;
  let beyond = 0;
  const twiceBy = new Set<string>();
  for (let y = Math.floor(b.minY / STEP) * STEP + OFFSET; y < b.maxY; y += STEP) {
    for (let x = Math.floor(b.minX / STEP) * STEP + OFFSET; x < b.maxX; x += STEP) {
      const inside = pointInPoly(x, y, plan.outline);
      const hits = plan.rooms.filter((r) => pointInPoly(x, y, r.poly));
      if (hits.length > 1) {
        twice++;
        twiceBy.add(hits.map((r) => r.id).join(' and '));
      }
      if (inside && !hits.length) none++;
      if (!inside && hits.length) beyond++;
    }
  }
  const sq = (n: number) => (n * STEP * STEP) / 1e6;
  if (sq(twice) > AREA_SLIP) error('room-overlap', 'rooms', `${sq(twice).toFixed(2)} m² of floor belongs to two rooms (${[...twiceBy].join('; ')}).`);
  if (sq(none) > AREA_SLIP) error('floor-uncovered', 'rooms', `${sq(none).toFixed(2)} m² of the flat is in no room.`);
  if (sq(beyond) > AREA_SLIP) error('room-outside', 'rooms', `${sq(beyond).toFixed(2)} m² of room lies outside the outline.`);
}

/** The floor swept by a door, as convex shapes: its leaf through a right angle, or a bi-fold folding back. */
function swings(o: Opening, f: WallFrame): Poly[] {
  const side = o.into ?? 1;
  const startHinge = (o.hinge ?? 'start') === 'start';
  const uh = startHinge ? o.at : o.at + o.w;
  const sweep = startHinge ? 1 : -1;
  const t = f.wall.t / 2;
  const arc = (r: number, from: number, to: number, face: number, s: number): Pt[] => {
    const pts: Pt[] = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
      pts.push(onWall(f, uh + sweep * Math.cos(a) * r, s * (face + Math.sin(a) * r)));
    }
    return pts;
  };
  const out: Poly[] = [];
  if (o.leaf === 'fold') {
    // The leaves fold toward the hinge: the swept floor is the hull of the shut door and a quarter circle of half its width.
    const hinge = onWall(f, uh, side * t);
    const far = onWall(f, uh + sweep * o.w, side * t);
    out.push([hinge, far, ...arc(o.w / 2, 60, 90, t, side)]);
  } else {
    out.push([onWall(f, uh, side * t), ...arc(o.w, 0, 90, t, side)]);
  }
  if (o.gate) {
    // The main door's grille gate opens the other way, out over the corridor.
    out.push([onWall(f, uh, -side * t), ...arc(o.w, 0, 112, t, -side)]);
  } else {
    // Room to stand and pass on the side the door does not open to.
    out.push([onWall(f, o.at, -side * t), onWall(f, o.at + o.w, -side * t), onWall(f, o.at + o.w, -side * (t + 400)), onWall(f, o.at, -side * (t + 400))]);
  }
  return out;
}

function checkItems(
  plan: Plan,
  frames: Map<string, WallFrame>,
  bodies: { id: string; body: Poly }[],
  roomAt: (p: Pt) => Room | undefined,
  inFlat: (p: Pt) => boolean,
  onSlab: (p: Pt) => boolean,
  error: Report,
  warn: Report
): void {
  const named = (i: number, it: Item) => `items[${i}] ${it.kind}`;
  const where = (it: Item) => roomAt([it.x, it.y])?.id ?? (inFlat([it.x, it.y]) ? 'the flat' : 'outside');
  const floor: { i: number; it: Item; shapes: Poly[] }[] = [];

  plan.items.forEach((it, i) => {
    const ref = named(i, it);
    const kind = KINDS[it.kind];
    if (!kind) {
      error('item-kind', ref, `There is no furniture called ${it.kind}; the engine would leave it out.`);
      return;
    }
    const shapes = footprint(it);
    const pts = shapes.flatMap((s) => {
      // Corners pulled a millimetre in, so a piece set against a room's edge still counts as inside.
      const [cx, cy] = centroid(s);
      return [[cx, cy] as Pt, ...s.map(([x, y]) => [x + Math.sign(cx - x), y + Math.sign(cy - y)] as Pt)];
    });

    if (kind.layer === 'outside') {
      if (pts.some((p) => inFlat(p))) error('item-outside', ref, `The ${it.kind} at (${it.x}, ${it.y}) belongs outside the flat.`);
      if (it.kind === 'compressor' && !pts.every(onSlab)) error('item-outside', ref, `The compressor at (${it.x}, ${it.y}) is not standing on a ledge.`);
      if (it.kind === 'compressor') floor.push({ i, it, shapes });
      if (it.kind === 'dryingRack' && !nearOutsideFace(frames, [it.x, it.y])) warn('item-mount', ref, `The laundry rack at (${it.x}, ${it.y}) is not hung from an outside wall.`);
      return;
    }

    if (kind.layer === 'wall') {
      checkMounted(plan, i, it, frames, bodies, roomAt, error);
      return;
    }

    // Indoors, or on the corridor for the few things that may stand there.
    const indoors = pts.map((p) => !!roomAt(p) && inFlat(p));
    if (!indoors.every(Boolean)) {
      const allowed = kind.corridor && pts.every((p) => onSlab(p) && !inFlat(p));
      if (!allowed) error('item-room', ref, `The ${it.kind} at (${it.x}, ${it.y}) in ${where(it)} pokes out of its room.`);
    }
    for (const b of bodies) {
      for (const s of shapes) {
        const o = overlap(s, b.body);
        if (o > TOUCH) {
          error('item-wall', ref, `The ${it.kind} at (${it.x}, ${it.y}) in ${where(it)} runs ${mm(o)} into wall ${b.id}.`);
          break;
        }
      }
    }
    if (kind.layer === 'floor') {
      if (!it.solid) warn('item-solid', ref, `The ${it.kind} at (${it.x}, ${it.y}) is not marked solid, so a visitor would walk through it.`);
      floor.push({ i, it, shapes });
    }
  });

  // Furniture against furniture.
  for (let a = 0; a < floor.length; a++) {
    for (let b = a + 1; b < floor.length; b++) {
      const A = floor[a];
      const B = floor[b];
      let worst = 0;
      for (const s of A.shapes) for (const t of B.shapes) worst = Math.max(worst, overlap(s, t));
      if (worst > TOUCH) {
        error('item-item', named(A.i, A.it), `The ${A.it.kind} at (${A.it.x}, ${A.it.y}) and the ${B.it.kind} at (${B.it.x}, ${B.it.y}) overlap by ${mm(worst)}.`);
      }
    }
  }

  // Door swings and the space in front of every door.
  for (const o of plan.openings) {
    if (o.type !== 'door') continue;
    const f = frames.get(o.wall);
    if (!f) continue;
    const zones = swings(o, f);
    for (const { i, it, shapes } of floor) {
      let worst = 0;
      for (const s of shapes) for (const z of zones) worst = Math.max(worst, overlap(s, z));
      if (worst > TOUCH) error('item-door', named(i, it), `The ${it.kind} at (${it.x}, ${it.y}) is in the way of door ${o.id}, by ${mm(worst)}.`);
    }
    // A door swinging into a wall cannot open.
    for (const g of frames.values()) {
      if (g.wall.id === o.wall || g.wall.kind === 'parapet') continue;
      const body = wallBody(g);
      const worst = Math.max(...zones.slice(0, o.gate ? 2 : 1).map((z) => overlap(z, body)));
      if (worst > TOUCH) error('door-wall', o.id, `Door ${o.id} swings into wall ${g.wall.id}.`);
    }
  }
}

/** Whether a point sits just outside an outer wall, where a laundry rack would hang. */
function nearOutsideFace(frames: Map<string, WallFrame>, p: Pt): boolean {
  for (const f of frames.values()) {
    const { u, v } = toFrame(f, p);
    if (u < 0 || u > f.len) continue;
    if (Math.abs(Math.abs(v) - f.wall.t / 2) < 250) return true;
  }
  return false;
}

/** Air-conditioners and shelter vents hang on a wall face, clear of windows, corners and tall cupboards. */
function checkMounted(
  plan: Plan,
  i: number,
  it: Item,
  frames: Map<string, WallFrame>,
  bodies: { id: string; body: Poly }[],
  roomAt: (p: Pt) => Room | undefined,
  error: Report
): void {
  const ref = `items[${i}] ${it.kind}`;
  const { w, d } = sizeOf(it);
  const { ez } = AXES[it.face ?? 'S'];
  let host: { f: WallFrame; u: number } | null = null;
  for (const f of frames.values()) {
    const { u, v } = toFrame(f, [it.x, it.y]);
    if (u < -ON || u > f.len + ON) continue;
    for (const s of [1, -1]) {
      // On this face, and looking away from the wall.
      if (Math.abs(v - s * (f.wall.t / 2)) <= 8 && ez[0] * f.nx * s + ez[1] * f.ny * s > 0.9) host = { f, u };
    }
  }
  if (!host) {
    error('item-mount', ref, `The ${it.kind} at (${it.x}, ${it.y}) is not on a wall face, facing into the room.`);
    return;
  }
  const { f, u } = host;
  const from = MOUNT_FROM[it.kind] ?? 2200;
  for (const o of openingsOf(plan, f.wall.id)) {
    const head = o.head ?? plan.height;
    const o0 = Math.max(o.at, u - w / 2);
    const o1 = Math.min(o.at + o.w, u + w / 2);
    if (o1 - o0 > ON && head > from) error('item-mount', ref, `The ${it.kind} at (${it.x}, ${it.y}) hangs over ${o.id}.`);
  }
  if (it.kind === 'hsVent' && f.wall.kind !== 'shelter') error('item-mount', ref, 'Shelter vents belong on a shelter wall.');
  const shape = footprint(it)[0];
  for (const b of bodies) {
    if (b.id === f.wall.id) continue;
    if (overlap(shape, b.body) > TOUCH) error('item-mount', ref, `The ${it.kind} at (${it.x}, ${it.y}) runs into wall ${b.id}.`);
  }
  const front = local(it, 0, d + 100);
  if (!roomAt(front)) error('item-mount', ref, `The ${it.kind} at (${it.x}, ${it.y}) faces out of the flat.`);
  plan.items.forEach((other, j) => {
    if (j === i || topOf(other) <= from) return;
    for (const s of footprint(other)) {
      if (overlap(shape, s) > TOUCH) error('item-mount', ref, `The ${it.kind} at (${it.x}, ${it.y}) is in the way of the ${other.kind} at (${other.x}, ${other.y}), which stands taller than it hangs.`);
    }
  });
}

/** Every room can be walked into from the front door, using the same grid the walk mode uses. */
function checkWalking(plan: Plan, outside: Pt | null, error: Report): void {
  const b = boundsOf(plan);
  const ox = (b.minX + b.maxX) / 2;
  const oy = (b.minY + b.maxY) / 2;
  const toWorld = (x: number, y: number): [number, number] => [(x - ox) / 1000, (y - oy) / 1000];
  const at = (x: number, y: number) => {
    const [wx, wz] = toWorld(x, y);
    return { x: wx, z: wz };
  };
  const nav = new Nav(plan, toWorld);
  const entry = at(plan.entry.x, plan.entry.y);
  if (!nav.isFree(entry)) {
    error('entry-blocked', 'entry', `There is no room to stand at the entry point (${plan.entry.x}, ${plan.entry.y}).`);
    return;
  }
  const reach = (p: { x: number; z: number }) => {
    const path = nav.path(entry, p);
    const end = path?.[path.length - 1];
    return !!end && Math.hypot(end.x - p.x, end.z - p.z) < 0.01;
  };
  for (const room of plan.rooms) {
    // The free spot nearest the room's label, inside the room itself.
    const [lx, ly] = room.label ?? centroid(room.poly);
    const xs = room.poly.map((p) => p[0]);
    const ys = room.poly.map((p) => p[1]);
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let y = Math.min(...ys) + 50; y < Math.max(...ys); y += 100) {
      for (let x = Math.min(...xs) + 50; x < Math.max(...xs); x += 100) {
        if (!pointInPoly(x, y, room.poly)) continue;
        const p = at(x, y);
        if (!nav.isFree(p)) continue;
        const dd = (x - lx) ** 2 + (y - ly) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = p;
        }
      }
    }
    if (!best) error('room-no-floor', room.id, `There is nowhere to stand in ${room.id}.`);
    else if (!reach(best)) error('room-unreachable', room.id, `${room.name} cannot be reached on foot from the entry.`);
  }
  if (outside) {
    const p = at(outside[0], outside[1]);
    if (!nav.isFree(p) || !reach(p)) error('corridor-unreachable', 'corridor', 'The corridor outside the front door cannot be reached on foot.');
  }
}
