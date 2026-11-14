import type { Face, Item, Opening, Plan, Pt, Room, Wall } from './types';

/**
 * Half of all flats are the mirror image of their neighbour across the party
 * wall, so every template has to be offered both ways round. `mirror` flips a
 * plan left to right, exactly: mirroring twice gives back the same document,
 * and the mirror passes the same checks as the original.
 *
 * The flip is about the middle of the flat's own outline, so the flat keeps
 * its place on the plan and the corridor and ledges move round it.
 *
 * What changes besides the x coordinates:
 * - Every wall swaps its ends. A reflection turns a clockwise outline
 *   anticlockwise; swapping the ends turns it back, so each wall keeps the
 *   room it bounded on its left, and the perimeter still runs clockwise.
 * - Openings are measured from the new `a` end, so an opening that started
 *   `at` from the old `a` now ends `at` from the new `b`.
 * - A door's hinge moves to the other end of its opening. Its swing side
 *   stays: `into` is relative to the wall's left normal, which the swap kept.
 * - Polygons run the other way round after a reflection, so they are reversed.
 * - Furniture facing east now faces west. Anything drawn off-centre along a
 *   piece (the hob in a counter, the sink) moves to the other side.
 *
 * The bearing does not change. The twin across the party wall has its main
 * facade on the same side of the block, looking the same way, so the top of
 * its plan faces the same compass bearing; its side windows are what swap.
 */

/** Marks the id of a mirrored plan, so a shared link can say which way round the flat is. */
export const MIRRORED = '~m';

export function isMirrored(plan: Plan): boolean {
  return plan.id.endsWith(MIRRORED);
}

const FLIP_FACE: Record<Face, Face> = { N: 'N', S: 'S', E: 'W', W: 'E' };

/** 1 - x, kept to a millionth so that flipping twice lands on the same number. */
function flipFraction(x: number): number {
  return Math.round((1 - x) * 1e6) / 1e6;
}

export function mirror(plan: Plan): Plan {
  const xs = plan.outline.map((p) => p[0]);
  const sum = Math.min(...xs) + Math.max(...xs);
  const mx = (x: number) => sum - x;
  const pt = (p: Pt): Pt => [mx(p[0]), p[1]];
  const ring = (poly: Pt[]): Pt[] => poly.map(pt).reverse();

  const lengths = new Map(plan.walls.map((w) => [w.id, Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])]));

  const walls = plan.walls.map((w): Wall => ({ ...w, a: pt(w.b), b: pt(w.a) }));

  const openings = plan.openings.map((o): Opening => {
    const len = lengths.get(o.wall) ?? 0;
    const out: Opening = { ...o, at: len - o.at - o.w };
    if (o.type === 'door') out.hinge = (o.hinge ?? 'start') === 'start' ? 'end' : 'start';
    return out;
  });

  const rooms = plan.rooms.map((r): Room => {
    const out: Room = { ...r, poly: ring(r.poly) };
    if (r.label) out.label = pt(r.label);
    return out;
  });

  const items = plan.items.map((it): Item => {
    const out: Item = { ...it, x: mx(it.x) };
    if (it.face) out.face = FLIP_FACE[it.face];
    if (it.opts) {
      const opts = { ...it.opts };
      // The hob sits a fraction along the counter from its left end; the sink is offset from its middle.
      if (typeof opts.hob === 'number') opts.hob = flipFraction(opts.hob);
      if (typeof opts.sink === 'number' && opts.sink !== 0) opts.sink = -opts.sink;
      out.opts = opts;
    }
    return out;
  });

  return {
    ...plan,
    id: isMirrored(plan) ? plan.id.slice(0, -MIRRORED.length) : plan.id + MIRRORED,
    outline: ring(plan.outline),
    entry: { x: mx(plan.entry.x), y: plan.entry.y, face: FLIP_FACE[plan.entry.face] },
    walls,
    openings,
    rooms,
    slabs: plan.slabs.map((s) => ({ ...s, rect: [mx(s.rect[2]), s.rect[1], mx(s.rect[0]), s.rect[3]] })),
    items,
    lights: plan.lights.map(pt)
  };
}
