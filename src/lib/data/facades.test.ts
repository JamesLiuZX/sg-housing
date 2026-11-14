import { describe, expect, it } from 'vitest';
import { bearingDiff, bearingOf, facadeFacing, facades, outwardBearing } from './facades';
import { footprintOf } from './shard';
import type { Ring, XY } from './types';

/** w × h metres centred on the origin, counter-clockwise, turned clockwise by `turn` degrees. */
function rect(w: number, h: number, turn = 0): Ring {
  return turnBy(
    [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2]
    ],
    turn
  );
}

/** Turns points clockwise, seen from above with north up: what a compass bearing does. */
function turnBy(r: XY[], deg: number): XY[] {
  const t = (deg * Math.PI) / 180;
  return r.map(([x, y]) => [x * Math.cos(t) + y * Math.sin(t), -x * Math.sin(t) + y * Math.cos(t)]);
}

const bearings = (r: Ring | ReturnType<typeof footprintOf>) =>
  facades(r)
    .map((f) => f.bearing)
    .sort((a, b) => a - b);

describe('bearings', () => {
  it('are exact on the four axes', () => {
    expect(bearingOf(0, 1)).toBe(0);
    expect(bearingOf(1, 0)).toBe(90);
    expect(bearingOf(0, -1)).toBe(180);
    expect(bearingOf(-1, 0)).toBe(270);
    // Never -0, and a hair west of north stays below 360.
    expect(Object.is(bearingOf(-0, 1), 0)).toBe(true);
    const b = bearingOf(-1e-17, 1);
    expect(b >= 0 && b < 360).toBe(true);
  });

  it('point outward: a wall running east with the building on its left faces south', () => {
    expect(outwardBearing(1, 0)).toBe(180);
    expect(outwardBearing(0, 1)).toBe(90);
    expect(outwardBearing(-1, 0)).toBe(0);
    expect(outwardBearing(0, -1)).toBe(270);
  });

  it('differ the short way round', () => {
    expect(bearingDiff(350, 10)).toBe(20);
    expect(bearingDiff(10, 350)).toBe(20);
    expect(bearingDiff(0, 180)).toBe(180);
    expect(bearingDiff(90, 450)).toBe(0);
  });
});

describe('facades', () => {
  it('of a north-up rectangle face 0, 90, 180 and 270 exactly', () => {
    const f = facades(rect(60, 15));
    expect(f.map((x) => x.bearing).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    const north = f.find((x) => x.bearing === 0)!;
    expect(north.length).toBeCloseTo(60, 9);
    expect(north.mid[0]).toBeCloseTo(0, 9);
    expect(north.mid[1]).toBeCloseTo(7.5, 9);
    expect(f.find((x) => x.bearing === 90)!.length).toBeCloseTo(15, 9);
  });

  it('turn with the block', () => {
    for (const turn of [17, 30, 45, 123.4, 300]) {
      const want = [0, 90, 180, 270].map((b) => (b + turn) % 360).sort((a, b) => a - b);
      bearings(rect(60, 15, turn)).forEach((b, i) => expect(b).toBeCloseTo(want[i], 9));
    }
  });

  it('read a clockwise ring the same way', () => {
    expect(bearings(rect(60, 15, 30).reverse())).toEqual(bearings(rect(60, 15, 30)));
  });

  it('put a on the left and b on the right as you face out', () => {
    const south = facades(rect(60, 15)).find((x) => x.bearing === 180)!;
    expect(south.a[0]).toBeLessThan(south.b[0]);
  });

  it('take a wall direction from the walls, not from a chord skewed by a step', () => {
    // The south wall steps back 1 m halfway along. A chord corner to corner would face 180.95°.
    const r: Ring = [
      [-30, -7.5],
      [0, -7.5],
      [0, -6.5],
      [30, -6.5],
      [30, 7.5],
      [-30, 7.5]
    ];
    const south = facades(r).filter((x) => bearingDiff(x.bearing, 180) < 45);
    expect(south).toHaveLength(1);
    expect(south[0].bearing).toBeCloseTo(180, 9);
  });

  it('treat a recessed service yard as part of the wall it interrupts', () => {
    // 3 m wide, 2 m deep recess in the south wall.
    const r: Ring = [
      [-30, -7.5],
      [-1.5, -7.5],
      [-1.5, -5.5],
      [1.5, -5.5],
      [1.5, -7.5],
      [30, -7.5],
      [30, 7.5],
      [-30, 7.5]
    ];
    const f = facades(r);
    expect(f.map((x) => x.bearing).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    expect(f.find((x) => x.bearing === 180)!.length).toBeCloseTo(60, 6);
  });

  it('treat a row of fins standing proud of a wall as one side', () => {
    // East wall with three fins sticking out 4 m.
    const r: Ring = [[-10, -30]];
    r.push([10, -30]);
    for (const y of [-20, -5, 10]) r.push([10, y], [14, y], [14, y + 1.5], [10, y + 1.5]);
    r.push([10, 30], [-10, 30]);
    const east = facades(r).filter((x) => bearingDiff(x.bearing, 90) < 45);
    expect(east).toHaveLength(1);
    expect(east[0].bearing).toBeCloseTo(90, 9);
  });

  it('keep a step big enough to be its own side: an L block has six', () => {
    const l: Ring = [
      [0, 0],
      [40, 0],
      [40, 20],
      [20, 20],
      [20, 40],
      [0, 40]
    ];
    expect(bearings(l)).toEqual([0, 0, 90, 90, 180, 270]);
  });

  it('drop sides too short to point at', () => {
    // A 3 m chamfer on one corner.
    const r: Ring = [
      [-30, -7.5],
      [27.9, -7.5],
      [30, -5.4],
      [30, 7.5],
      [-30, 7.5]
    ];
    expect(bearings(r)).toEqual([0, 90, 180, 270]);
  });

  it('face into a courtyard from the courtyard walls', () => {
    const outer = rect(80, 80);
    const hole = rect(40, 40).reverse();
    const f = facades(footprintOf([{ outer, holes: [hole] }]));
    const inner = f.filter((x) => x.ring === 1);
    expect(inner).toHaveLength(4);
    for (const x of inner) {
      // The outward normal at the wall's middle points at the courtyard's centre.
      const t = (x.bearing * Math.PI) / 180;
      expect(Math.sin(t) * -x.mid[0] + Math.cos(t) * -x.mid[1]).toBeGreaterThan(0);
    }
    expect(f.filter((x) => x.ring === 0)).toHaveLength(4);
  });

  it('find the side closest to a bearing', () => {
    const f = facades(rect(60, 15, 20));
    expect(facadeFacing(f, 205)!.bearing).toBeCloseTo(200, 9);
    expect(facadeFacing(f, 0)!.bearing).toBeCloseTo(20, 9);
    expect(facadeFacing([], 0)).toBeNull();
  });
});
