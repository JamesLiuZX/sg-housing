import { describe, expect, it } from 'vitest';
import { facades, type Ring } from '../data';
import { flatPoint, groundBox, nearestSide, onFootprint, sameSide, sideMarks } from './outline';

// A slab 40 m east to west and 12 m north to south, centred on the origin.
const SLAB: Ring = [
  [-20, -6],
  [20, -6],
  [20, 6],
  [-20, 6]
];
const sides = facades(SLAB);
const bearingOf = (hit: { index: number } | null, of = sides) => (hit ? Math.round(of[hit.index].bearing) : null);
/** A point in the drawing's coordinates: metres east, and metres north turned down the page. */
const at = (east: number, north: number) => [east, -north] as const;

// An L: a 30 m arm along the south, a 30 m arm up the west, 10 m thick, with the notch to the north-east.
const L: Ring = [
  [0, 0],
  [30, 0],
  [30, 10],
  [10, 10],
  [10, 30],
  [0, 30]
];
const lSides = facades(L);
const lParts = [{ outer: L, holes: [] }];
/** The side an L-block tap names, as the outline works it out. */
const onL = (east: number, north: number) => {
  const [x, y] = at(east, north);
  return bearingOf(nearestSide(lSides, x, y, onFootprint(lParts, x, y)), lSides);
};

describe('the block outline', () => {
  it('has one side for each way the slab looks', () => {
    expect(sides.map((f) => Math.round(f.bearing)).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
  });

  it('names the side a tap out on the ground is in front of', () => {
    expect(bearingOf(nearestSide(sides, ...at(-30, 0)))).toBe(270);
    expect(bearingOf(nearestSide(sides, ...at(30, 0)))).toBe(90);
    expect(bearingOf(nearestSide(sides, ...at(0, 15)))).toBe(0);
    expect(bearingOf(nearestSide(sides, ...at(0, -15)))).toBe(180);
  });

  it('knows the block from the ground round it', () => {
    expect(onFootprint(lParts, ...at(5, 25))).toBe(true);
    expect(onFootprint(lParts, ...at(25, 5))).toBe(true);
    expect(onFootprint(lParts, ...at(20, 20))).toBe(false);
    expect(onFootprint(lParts, ...at(-5, 5))).toBe(false);
  });

  it('out on the ground, names the face a person would stand in front of', () => {
    // Just past the slab's north-west corner, well north of it: equally near the west and north faces, but the north one is ahead.
    expect(bearingOf(nearestSide(sides, ...at(-21, 10)))).toBe(0);
    // Just past the end of the L's south arm and a little north: the end face is ahead, the arm's inner face at a slant.
    expect(onL(33, 11)).toBe(90);
    // Further north there: now the inner face is ahead. The west arm's inner face is straight ahead too, but across the notch.
    expect(onL(32, 15)).toBe(0);
    // Deep in the notch, near the west arm: its inner face.
    expect(onL(13, 20)).toBe(90);
  });

  it('on the block itself, names the nearest side, whichever way it looks', () => {
    // Inside the south arm near its inner face, which is nearest; the west arm's inner face "looks" this way along its line.
    expect(onL(14, 8)).toBe(0);
    expect(onL(2, 20)).toBe(270);
    expect(bearingOf(nearestSide(sides, ...at(0, 5), true))).toBe(0);
    expect(bearingOf(nearestSide(sides, ...at(18, 0), true))).toBe(90);
  });

  it('says how far along the side the tap fell', () => {
    const hit = nearestSide(sides, ...at(10, 15));
    expect(hit).not.toBeNull();
    const f = sides[hit!.index];
    // Where the flat goes is where the finger was, along the side.
    const p = flatPoint(f, hit!.along);
    expect(p.x).toBeCloseTo(10, 5);
    expect(p.y).toBeCloseTo(-6, 5);
  });

  it('draws the ground round a block as a square a half again its size, and marks a side off its wall', () => {
    const box = groundBox({ parts: [{ outer: SLAB, holes: [] }], area: 480, bounds: { minX: -20, minY: -6, maxX: 20, maxY: 6 } });
    expect(box.w).toBe(76);
    expect(box.h).toBe(76);
    const north = sides.find((f) => Math.round(f.bearing) === 0)!;
    expect(sameSide(north, north)).toBe(true);
    expect(sameSide(null, north)).toBe(false);
    // The arrowhead stands out from the north side, up the page.
    expect(sideMarks(north, box).head.y).toBeLessThan(-6);
  });

  it('has nothing to name without sides', () => {
    expect(nearestSide([], 0, 0)).toBeNull();
  });
});
