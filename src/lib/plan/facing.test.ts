import { describe, expect, it } from 'vitest';
import { windowAspects } from '../sg/solar';
import { mainFacade, northForFacing } from './facing';
import { hero4room } from './hero4room';
import { mirror } from './mirror';
import { templates } from './templates';
import type { Plan } from './types';

const livingBearings = (plan: Plan, north: number) =>
  windowAspects(plan, north)
    .filter((a) => a.room === 'living')
    .map((a) => a.bearing);
/** Signed difference between two bearings, degrees, in (-180, 180]. */
const angle = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** The hero with its living room window moved from the facade to the right-hand party wall. */
function sideWindow(): Plan {
  const p = structuredClone(hero4room);
  p.openings = p.openings.filter((o) => o.id !== 'win-living');
  p.openings.push({ id: 'win-living', wall: 'party-e', at: 800, w: 2400, type: 'window', sill: 550, head: 2400, room: 'living' });
  return p;
}

describe('mainFacade', () => {
  it("finds the hero's window side: the facade along the top of the plan", () => {
    expect(mainFacade(hero4room)).toEqual({ walls: ['facade'], a: [0, 0], b: [12500, 0], length: 12500, out: [0, -1], offset: 0, bearing: 295 });
  });

  it("agrees with windowAspects: with the hero's north of 295, its living room faces 295", () => {
    expect(livingBearings(hero4room, hero4room.north)).toEqual([295]);
    expect(mainFacade(hero4room)!.bearing).toBe(295);
  });

  it('runs on across every wall along the side, in order', () => {
    const p = structuredClone(hero4room);
    p.walls = p.walls.flatMap((w) =>
      w.id === 'facade'
        ? [
            { ...w, id: 'facade-a', b: [6000, 0] },
            { ...w, id: 'facade-b', a: [6000, 0] }
          ]
        : [w]
    );
    for (const o of p.openings) {
      if (o.wall !== 'facade') continue;
      o.wall = o.at < 6000 ? 'facade-a' : 'facade-b';
      if (o.wall === 'facade-b') o.at -= 6000;
    }
    const f = mainFacade(p)!;
    expect(f.walls).toEqual(['facade-a', 'facade-b']);
    expect([f.a, f.b, f.length]).toEqual([[0, 0], [12500, 0], 12500]);
  });

  it('finds a living room that looks out of the side of the plan, and its mirror image', () => {
    const side = sideWindow();
    const f = mainFacade(side)!;
    expect(f.walls).toEqual(['party-e', 'hs-e']);
    expect([f.a, f.b, f.length, f.out, f.offset]).toEqual([[12500, 0], [12500, 7900], 7900, [1, 0], 90]);
    const m = mainFacade(mirror(side))!;
    expect(m.walls).toEqual(['hs-e', 'party-e']);
    expect([m.a, m.b, m.out, m.offset]).toEqual([[0, 7900], [0, 0], [-1, 0], 270]);
  });

  it('has nothing to say about a flat without an outside window', () => {
    const blind = { ...hero4room, openings: hero4room.openings.filter((o) => o.type !== 'window') };
    expect(mainFacade(blind)).toBeNull();
    expect(northForFacing(blind, 180)).toBe(hero4room.north);
  });
});

describe('northForFacing', () => {
  it('turns the hero so that its living room looks out on 180', () => {
    const north = northForFacing(hero4room, 180);
    expect(north).toBe(180);
    expect(livingBearings(hero4room, north)).toEqual([180]);
  });

  it('turns the mirrored hero the same way, since its facade is the same side', () => {
    const m = mirror(hero4room);
    const north = northForFacing(m, 180);
    expect(north).toBe(180);
    expect(livingBearings(m, north)).toEqual([180]);
  });

  it('holds for every template and its mirror, on any bearing', () => {
    for (const t of templates) {
      for (const plan of [t.plan, mirror(t.plan)]) {
        for (const want of [0, 45, 90, 180, 247, 293, 359.5]) {
          const north = northForFacing(plan, want);
          const got = livingBearings(plan, north);
          expect(got.length).toBeGreaterThan(0);
          for (const b of got) expect(angle(b, want)).toBeCloseTo(0, 9);
          expect(angle(mainFacade({ ...plan, north })!.bearing, want)).toBeCloseTo(0, 9);
        }
      }
    }
  });

  it('holds for a side window, on the plan and on its mirror', () => {
    const side = sideWindow();
    for (const plan of [side, mirror(side)]) {
      for (const want of [0, 180, 293]) {
        const north = northForFacing(plan, want);
        for (const b of livingBearings(plan, north)) expect(angle(b, want)).toBeCloseTo(0, 9);
      }
    }
    expect(northForFacing(side, 180)).toBe(90);
    expect(northForFacing(mirror(side), 180)).toBe(270);
  });
});
