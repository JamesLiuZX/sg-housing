import { describe, expect, it } from 'vitest';
import { hero4room } from './hero4room';
import type { Plan } from './types';
import { validatePlan, type Issue } from './validate';

/** The hero with one thing changed, so each test breaks exactly one rule. */
function broken(change: (p: Plan) => void): Plan {
  const p = structuredClone(hero4room);
  change(p);
  return p;
}

const codes = (issues: Issue[]) => issues.map((i) => i.code);
const item = (p: Plan, kind: string, x: number) => p.items.find((it) => it.kind === kind && it.x === x)!;

describe('validatePlan', () => {
  it('passes the hero flat with nothing to report', () => {
    expect(validatePlan(hero4room)).toEqual([]);
  });

  it('catches a perimeter wall drawn anticlockwise', () => {
    const p = broken((p) => {
      const w = p.walls.find((x) => x.id === 'facade')!;
      [w.a, w.b] = [w.b, w.a];
    });
    expect(codes(validatePlan(p))).toContain('wall-winding');
  });

  it('catches an outline drawn anticlockwise', () => {
    expect(codes(validatePlan(broken((p) => p.outline.reverse())))).toContain('outline-winding');
  });

  it('catches a gap in the perimeter', () => {
    expect(codes(validatePlan(broken((p) => (p.walls = p.walls.filter((w) => w.id !== 'party-w')))))).toContain('outline-gap');
  });

  it('catches an opening that runs off its wall, and two that overlap', () => {
    const off = broken((p) => (p.openings.find((o) => o.id === 'win-living')!.at = 11000));
    expect(codes(validatePlan(off))).toContain('opening-range');
    const clash = broken((p) => (p.openings.find((o) => o.id === 'win-bed2')!.at = 2400));
    expect(codes(validatePlan(clash))).toContain('opening-overlap');
  });

  it('catches a door cut into the wall that meets its own', () => {
    expect(codes(validatePlan(broken((p) => (p.openings.find((o) => o.id === 'door-bed3')!.at = 0))))).toContain('opening-range');
  });

  it('catches a window credited to a room it does not light', () => {
    const wrong = broken((p) => (p.openings.find((o) => o.id === 'win-bed2')!.room = 'living'));
    expect(codes(validatePlan(wrong))).toContain('window-room');
    const missing = broken((p) => (p.openings.find((o) => o.id === 'win-bed2')!.room = 'study'));
    expect(codes(validatePlan(missing))).toContain('window-room');
  });

  it('catches rooms that do not add up to the stated area', () => {
    expect(codes(validatePlan(broken((p) => (p.areaSqm = 100))))).toContain('area-total');
  });

  it('allows a room open to the next one, but not an edge open to nothing', () => {
    // Without its wall, bedroom 2 simply opens onto the hallway: an open plan, not a mistake.
    const open = broken((p) => (p.walls = p.walls.filter((w) => w.id !== 'p-bed2-s')));
    expect(codes(validatePlan(open))).not.toContain('room-edge-open');
    // A hallway that stops short of the living room leaves a strip that belongs to nothing.
    const short = broken((p) => (p.rooms.find((r) => r.id === 'hall')!.poly = [[1700, 3200], [9000, 3200], [9000, 4300], [1700, 4300]]));
    const found = codes(validatePlan(short));
    expect(found).toContain('room-edge-open');
    expect(found).toContain('floor-uncovered');
  });

  it('catches rooms that overlap, and a wall through the middle of a room', () => {
    const overlap = broken((p) => (p.rooms.find((r) => r.id === 'bed2')!.poly[1] = [6800, 0]));
    expect(codes(validatePlan(overlap))).toContain('room-overlap');
    const through = broken((p) => p.walls.push({ id: 'stray', a: [10000, 500], b: [10000, 2500], t: 100, kind: 'partition' }));
    expect(codes(validatePlan(through))).toContain('wall-in-room');
  });

  it('catches furniture in a wall, on other furniture, and in a door swing', () => {
    expect(codes(validatePlan(broken((p) => (item(p, 'wardrobe', 5950).x = 6100))))).toContain('item-wall');
    expect(codes(validatePlan(broken((p) => (item(p, 'coffeeTable', 10750).x = 11500))))).toContain('item-item');
    // Bedroom 3's door opens inward from the hallway; a bookshelf just inside it blocks the leaf.
    const shelf = broken((p) => p.items.push({ kind: 'bookshelf', x: 7000, y: 2950, face: 'N', w: 900, d: 320, solid: true }));
    expect(codes(validatePlan(shelf))).toContain('item-door');
  });

  it('lets rugs and pendants lie under and over other furniture', () => {
    // The living-room rug already lies under the sofa's front, the coffee table and the console's edge.
    const issues = validatePlan(hero4room).filter((i) => i.ref.includes('rug') || i.ref.includes('pendant'));
    expect(issues).toEqual([]);
  });

  it('catches an air-conditioner hung over a window', () => {
    // Bedroom 2's unit moved onto the facade, where its window is.
    const p = broken((p) => Object.assign(item(p, 'aircon', 4850), { y: 100, face: 'S' }));
    expect(codes(validatePlan(p))).toContain('item-mount');
  });

  it('catches a room nobody can walk into', () => {
    const shut = broken((p) => (p.openings = p.openings.filter((o) => o.id !== 'door-bed3')));
    expect(validatePlan(shut).find((i) => i.code === 'room-unreachable')?.ref).toBe('bed3');
  });

  it('catches a light outside the flat and a room left without one', () => {
    const p = broken((p) => (p.lights[0] = [10850, 9000]));
    const found = codes(validatePlan(p));
    expect(found).toContain('light-outside');
    expect(found).toContain('room-dark');
  });

  it('catches a front door that opens onto nothing', () => {
    expect(codes(validatePlan(broken((p) => (p.slabs = p.slabs.filter((s) => s.id !== 'corridor')))))).toContain('corridor-missing');
  });
});
