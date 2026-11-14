import { describe, expect, it } from 'vitest';
import { windowAspects } from '../sg/solar';
import { frameOf, polyArea } from './geometry';
import { hero4room } from './hero4room';
import { MIRRORED, isMirrored, mirror } from './mirror';
import { templates } from './templates';
import type { Plan, Pt } from './types';
import { validatePlan } from './validate';

/** The reflection the mirror uses: about the middle of the flat's outline. */
function reflect(plan: Plan): (p: Pt) => Pt {
  const xs = plan.outline.map((p) => p[0]);
  const sum = Math.min(...xs) + Math.max(...xs);
  return ([x, y]) => [sum - x, y];
}

/** A door as points on the plan: its hinge, its far jamb, and a point on the side it swings to. */
function doorPoints(plan: Plan, id: string): { hinge: Pt; far: Pt; swing: Pt } {
  const o = plan.openings.find((x) => x.id === id)!;
  const f = frameOf(plan.walls.find((w) => w.id === o.wall)!);
  const along = (u: number): Pt => [f.wall.a[0] + f.dx * u, f.wall.a[1] + f.dy * u];
  const start = (o.hinge ?? 'start') === 'start';
  const hinge = along(start ? o.at : o.at + o.w);
  const far = along(start ? o.at + o.w : o.at);
  const side = o.into ?? 1;
  return { hinge, far, swing: [hinge[0] + f.nx * side * 500, hinge[1] + f.ny * side * 500] };
}

const angle = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

describe('mirror', () => {
  for (const t of templates) {
    describe(t.id, () => {
      it('gives back exactly the same plan when applied twice', () => {
        expect(mirror(mirror(t.plan))).toEqual(t.plan);
      });

      it('passes validation the other way round too', () => {
        expect(validatePlan(mirror(t.plan))).toEqual([]);
      });

      it('keeps the outline clockwise, in the same place, with the same rooms', () => {
        const m = mirror(t.plan);
        expect(polyArea(m.outline)).toBeGreaterThan(0);
        const xs = (p: Plan) => p.outline.map((q) => q[0]);
        expect(Math.min(...xs(m))).toBe(Math.min(...xs(t.plan)));
        expect(Math.max(...xs(m))).toBe(Math.max(...xs(t.plan)));
        for (const r of t.plan.rooms) {
          const twin = m.rooms.find((x) => x.id === r.id)!;
          expect(polyArea(twin.poly)).toBeCloseTo(polyArea(r.poly), 6);
        }
      });

      it('puts every door, hinge and swing at its mirror image', () => {
        const m = mirror(t.plan);
        const f = reflect(t.plan);
        for (const o of t.plan.openings.filter((x) => x.type === 'door')) {
          const before = doorPoints(t.plan, o.id);
          const after = doorPoints(m, o.id);
          expect(after.hinge).toEqual(f(before.hinge));
          expect(after.far).toEqual(f(before.far));
          const [sx, sy] = f(before.swing);
          expect(after.swing[0]).toBeCloseTo(sx, 6);
          expect(after.swing[1]).toBeCloseTo(sy, 6);
        }
      });

      it('keeps the bearing, so the facade looks the same way and side windows swap sides', () => {
        const m = mirror(t.plan);
        expect(m.north).toBe(t.plan.north);
        const before = windowAspects(t.plan, t.plan.north);
        const after = new Map(windowAspects(m, m.north).map((a) => [a.id, a.bearing]));
        expect(after.size).toBe(before.length);
        for (const a of before) {
          // A window looking out at bearing b looks out at the reflection of b about the facade's bearing.
          expect(angle(after.get(a.id)!, 2 * t.plan.north - a.bearing)).toBeCloseTo(0, 6);
        }
      });
    });
  }

  it('turns furniture facing east to face west, and moves the hob to the other end of its counter', () => {
    const m = mirror(hero4room);
    hero4room.items.forEach((it, i) => {
      const twin = m.items[i];
      expect(twin.y).toBe(it.y);
      if (it.face === 'E') expect(twin.face).toBe('W');
      if (it.face === 'W') expect(twin.face).toBe('E');
      if (it.face === 'N' || it.face === 'S') expect(twin.face).toBe(it.face);
    });
    const hob = hero4room.items.findIndex((it) => typeof it.opts?.hob === 'number');
    expect(m.items[hob].opts?.hob).toBe(0.75);
  });

  it('marks the mirrored plan, and unmarks it on the way back', () => {
    expect(isMirrored(hero4room)).toBe(false);
    expect(mirror(hero4room).id).toBe(`bto-4room-93${MIRRORED}`);
    expect(isMirrored(mirror(hero4room))).toBe(true);
    expect(mirror(mirror(hero4room)).id).toBe('bto-4room-93');
  });

  it('moves the living room of the hero from the right end to the left', () => {
    const living = (p: Plan) => p.rooms.find((r) => r.id === 'living')!.poly;
    expect(Math.min(...living(hero4room).map((q) => q[0]))).toBe(9200);
    expect(Math.max(...living(mirror(hero4room)).map((q) => q[0]))).toBe(12500 - 9200);
  });
});
