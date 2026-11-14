import { describe, expect, it } from 'vitest';
import {
  attributionLine,
  buildShards,
  encodeInt,
  encodeRing,
  isSimpleRing,
  localFrame as packerFrame,
  normalisePostal,
  packRing,
  simplifyRing,
  type GeoJsonFeature,
  type Pt
} from '../../../scripts/build-blocks.mjs';
import { centroidOf, decodeRing, decodeRow, groupParts, isShard, localFrame, signedArea } from './shard';
import type { XY } from './types';

const CLEMENTI: [number, number] = [1.316, 103.764];

/** A rectangle w × h metres, centred on (cx, cy), turned clockwise by `turn` degrees, counter-clockwise. */
function rect(w: number, h: number, cx = 0, cy = 0, turn = 0): XY[] {
  const t = (turn * Math.PI) / 180;
  return (
    [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2]
    ] as XY[]
  ).map(([x, y]) => [cx + x * Math.cos(t) + y * Math.sin(t), cy - x * Math.sin(t) + y * Math.cos(t)]);
}

/** Metres around a point to a GeoJSON ring of [lng, lat], closed. */
function toLngLat(ring: XY[], at = CLEMENTI): number[][] {
  const f = localFrame(at[0], at[1]);
  const out = ring.map(([x, y]) => {
    const [lat, lng] = f.toLatLng(x, y);
    return [lng, lat];
  });
  return [...out, out[0]];
}

function feature(postal: string | number, blk: string, ...polys: XY[][][]): GeoJsonFeature {
  const coords = polys.map((rings) => rings.map((r) => toLngLat(r)));
  return {
    type: 'Feature',
    properties: { POSTAL_COD: postal, BLK_NO: blk },
    geometry: coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords }
  };
}

describe('ring encoding', () => {
  it('round-trips integers of every size', () => {
    const pts: Pt[] = [
      [0, 0],
      [1, -1],
      [15, 16],
      [-16, 511],
      [512, -512],
      [123456, -654321]
    ];
    const ring = decodeRing(encodeRing(pts), 1);
    // The ring stores differences, so decode back to the absolute points.
    expect(ring).toEqual(pts);
  });

  it('writes small numbers in one character and never needs escaping', () => {
    expect(encodeInt(0)).toBe('0');
    expect(encodeInt(-1)).toBe('1');
    expect(encodeInt(15)).toHaveLength(1);
    expect(encodeInt(16)).toHaveLength(2);
    expect(encodeRing([[-5000, 4000], [3, 400], [70, -9]])).toMatch(/^[0-9A-Za-z_-]+$/);
  });

  it('refuses malformed text instead of guessing', () => {
    expect(decodeRing('!!', 0.1)).toBeNull();
    // A continuation character with nothing after it.
    expect(decodeRing(encodeRing([[1, 2], [3, 4], [5, 6]]) + 'W', 0.1)).toBeNull();
    // An odd count of numbers, and too few points for a ring.
    expect(decodeRing('000', 0.1)).toBeNull();
    expect(decodeRing('0000', 0.1)).toBeNull();
  });
});

describe('local frame', () => {
  it('is the same frame in the packer and the app, and inverts exactly', () => {
    const a = packerFrame(...CLEMENTI);
    const b = localFrame(...CLEMENTI);
    const p = a.toLocal(1.3171, 103.7652);
    expect(b.toLocal(1.3171, 103.7652)).toEqual(p);
    const [lat, lng] = b.toLatLng(p[0], p[1]);
    expect(lat).toBeCloseTo(1.3171, 12);
    expect(lng).toBeCloseTo(103.7652, 12);
  });

  it('is true to scale on the WGS84 ellipsoid at Singapore', () => {
    const f = localFrame(1.35, 103.82);
    // A thousandth of a degree: 110.575 m of latitude, 111.289 m of longitude at 1.35°N.
    expect(f.toLocal(1.351, 103.82)[1]).toBeCloseTo(110.575, 2);
    expect(f.toLocal(1.35, 103.821)[0]).toBeCloseTo(111.289, 2);
  });
});

describe('simplification', () => {
  it('drops wiggles under the tolerance and keeps steps over it', () => {
    // South side of a 60 × 15 m block with a 10 cm bump and a 1 m step.
    const ring: Pt[] = [
      [0, 0],
      [10, 0],
      [10.5, -0.1],
      [11, 0],
      [30, 0],
      [30, 1],
      [60, 1],
      [60, 15],
      [0, 15]
    ];
    const out = simplifyRing(ring, 0.3);
    expect(out).not.toContainEqual([10.5, -0.1]);
    expect(out).toContainEqual([30, 0]);
    expect(out).toContainEqual([30, 1]);
  });

  it('orients outer rings counter-clockwise and holes clockwise, whatever came in', () => {
    const cw = rect(60, 15).reverse();
    const outer = packRing(cw, { tolerance: 0.3, unit: 0.1, hole: false });
    const hole = packRing(rect(20, 5), { tolerance: 0.3, unit: 0.1, hole: true });
    expect(signedArea(outer!)).toBeGreaterThan(0);
    expect(signedArea(hole!)).toBeLessThan(0);
  });

  it('spots a ring that folds over itself', () => {
    expect(
      isSimpleRing([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10]
      ])
    ).toBe(false);
    expect(isSimpleRing(rect(10, 10))).toBe(true);
  });
});

describe('building shards', () => {
  const courtyard = [rect(80, 80), rect(40, 40).reverse()];
  const airWell = [rect(30, 30, 0, 0), rect(4, 4).reverse()];
  const { shards, stats } = buildShards({
    features: [
      feature('121440', '440A', [rect(60, 15, 0, 0, 30)]),
      feature('122440', '440B', courtyard),
      feature('123440', '440C', airWell),
      // A main block and a 3 × 3 m bin centre beside it.
      feature('128123', '123', [rect(50, 12, 300, 0)], [rect(3, 3, 330, 30)]),
      // Leading zero lost, as when the dataset carried postal codes as numbers.
      feature(50531, '531', [rect(40, 12, 900, 900)]),
      { properties: { POSTAL_COD: null, BLK_NO: '1' }, geometry: null }
    ]
  });

  it('groups blocks by sector and restores lost leading zeros', () => {
    expect([...shards.keys()]).toEqual(['05', '12']);
    expect(shards.get('05')!.shard.blocks[0].slice(0, 2)).toEqual(['050531', '531']);
    expect(stats.skipped.postal).toBe(1);
    expect(normalisePostal(50531)).toBe('050531');
    expect(normalisePostal('S121440')).toBeNull();
  });

  it('writes a shard the app accepts, with the origin its coordinates were measured from', () => {
    const { shard } = shards.get('12')!;
    expect(isShard(shard)).toBe(true);
    expect(shard.origin.every((v) => Number(v.toFixed(6)) === v)).toBe(true);
  });

  it('decodes to within half a decimetre of what went in', () => {
    const { shard } = shards.get('12')!;
    const f = localFrame(shard.origin[0], shard.origin[1]);
    const row = decodeRow(shard.blocks.find((r) => r[0] === '121440')!, shard.unit)!;
    const source = toLngLat(rect(60, 15, 0, 0, 30)).slice(0, -1);
    const back = row.parts[0].outer.map(([x, y]) => f.toLatLng(x, y));
    // Every source corner survives, within 5 cm (rounding to decimetres).
    for (const [lng, lat] of source) {
      const [x, y] = f.toLocal(lat, lng);
      const nearest = Math.min(...back.map(([la, ln]) => Math.hypot(...f.toLocal(la, ln).map((v, i) => v - [x, y][i]))));
      expect(nearest).toBeLessThanOrEqual(0.0708);
    }
    expect(signedArea(row.parts[0].outer)).toBeCloseTo(900, 0);
  });

  it('keeps courtyards, drops air wells and fragments, largest part first', () => {
    const blocks = shards.get('12')!.shard.blocks;
    const parts = (postal: string) => groupParts(decodeRow(blocks.find((r) => r[0] === postal)!, 0.1)!.parts.flatMap((p) => [p.outer, ...p.holes]));
    expect(parts('122440')[0].holes).toHaveLength(1);
    expect(parts('123440')[0].holes).toHaveLength(0);
    expect(parts('128123')).toHaveLength(1);
    expect(stats.droppedHoles).toBe(1);
    expect(stats.droppedParts).toBe(1);
  });

  it('puts the centroid of a courtyard block in its middle, not on its ring', () => {
    const blocks = shards.get('12')!.shard.blocks;
    const row = decodeRow(blocks.find((r) => r[0] === '122440')!, 0.1)!;
    const [cx, cy] = centroidOf(row.parts);
    const [ox, oy] = centroidOf([{ outer: row.parts[0].outer, holes: [] }]);
    expect(Math.hypot(cx - ox, cy - oy)).toBeLessThan(0.1);
  });

  it('words the attribution as the Singapore Open Data Licence asks', () => {
    expect(attributionLine('HDB Existing Building', new Date('2026-11-13T09:00:00+08:00'))).toBe(
      'Contains information from HDB Existing Building accessed on 13 November 2026 from data.gov.sg which is made available under the terms of the Singapore Open Data Licence version 1.0 https://data.gov.sg/open-data-licence'
    );
  });
});
