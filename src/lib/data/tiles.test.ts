import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupDemo } from './demo';
import { SNAPSHOT_SHARD } from './demo-snapshot';
import { blocked, mockFetch, never } from './fetch.fixture';
import { decodeRow, localFrame } from './shard';
import {
  MAX_ZOOM,
  TILE_PX,
  clearTiles,
  coverSquare,
  frameToPixel,
  fromWorldPixel,
  loadTile,
  loadTiles,
  pixelToFrame,
  rangeBounds,
  tileAt,
  tileKnown,
  tileUrl,
  tilesIn,
  toWorldPixel,
  type TileRange
} from './tiles';

const demo = lookupDemo().block.data;
/** OneMap's own point for 440A Clementi Ave 3, from the demo snapshot. */
const ONEMAP_POINT = [1.315998673983866, 103.7641976249758] as const;

describe('Web Mercator', () => {
  it('puts the corners and the middle of the world where EPSG:3857 does', () => {
    expect(toWorldPixel(0, 0, 0)).toEqual([128, 128]);
    expect(toWorldPixel(0, 180, 0)[0]).toBe(256);
    expect(toWorldPixel(0, -180, 1)[0]).toBe(0);
    // The projection's square ends at 85.0511° north.
    expect(toWorldPixel(85.0511287798066, 0, 0)[1]).toBeCloseTo(0, 6);
  });

  it('agrees with figures worked by hand for OneMap’s point for 440A Clementi Ave 3', () => {
    // x = (lng + 180) / 360 · 256 · 2^z, y = (1 − ln(tan φ + sec φ) / π) / 2 · 256 · 2^z, worked separately.
    const [px, py] = toWorldPixel(...ONEMAP_POINT, 18);
    expect(px).toBeCloseTo(52897480.406899, 5);
    expect(py).toBeCloseTo(33309090.493865, 5);
    // The tile the block's own drawing is on in OneMap's Grey map, fetched and looked at.
    expect(tileAt(...ONEMAP_POINT, 18)).toEqual({ z: 18, x: 206630, y: 130113 });
    expect(tileAt(...ONEMAP_POINT, 19)).toEqual({ z: 19, x: 413261, y: 260227 });
    expect(tileAt(...ONEMAP_POINT, 20)).toEqual({ z: 20, x: 826523, y: 520454 });
  });

  it('comes back to the same place', () => {
    for (const z of [11, 16, 19, 20]) {
      const [px, py] = toWorldPixel(...ONEMAP_POINT, z);
      const [lat, lng] = fromWorldPixel(px, py, z);
      expect(lat).toBeCloseTo(ONEMAP_POINT[0], 11);
      expect(lng).toBeCloseTo(ONEMAP_POINT[1], 11);
    }
  });

  it('names its tiles the way OneMap serves them', () => {
    expect(tileUrl('Grey', { z: 18, x: 206630, y: 130113 })).toBe('https://www.onemap.gov.sg/maps/tiles/Grey/18/206630/130113.png');
    expect(MAX_ZOOM.Grey).toBe(19);
    expect(MAX_ZOOM.Grey_HD).toBe(20);
  });
});

describe('tiles in the block’s frame', () => {
  it('places a footprint corner on the pixel an independent measurement put it on', () => {
    // The demo block's first corner, 32.23 m east and 8.11 m north of its centroid. A separate script decoded the same
    // shard row, turned the corner back into latitude and longitude with the shard's own frame and projected it; its
    // outline drawn there lies on OneMap's drawn outline (see the alignment note in ground.ts).
    const [x, y] = demo.footprint.parts[0].outer[0];
    expect(x).toBeCloseTo(32.2301, 3);
    expect(y).toBeCloseTo(8.112, 3);
    const [px, py] = frameToPixel(demo, x, y, 20);
    // Within a hundredth of a zoom-20 pixel: 1.5 mm.
    expect(Math.abs(px - 211590017.38452)).toBeLessThan(0.01);
    expect(Math.abs(py - 133236361.14207)).toBeLessThan(0.01);
    const back = pixelToFrame(demo, px, py, 20);
    expect(back[0]).toBeCloseTo(x, 6);
    expect(back[1]).toBeCloseTo(y, 6);
  });

  it('uses the footprints’ own projection, to the millimetre across the whole site', () => {
    // A footprint is stored in its postal sector's frame and moved to the block's centroid; the tiles reach the block's
    // frame through toBlockFrame. Every neighbour's every corner must come out the same both ways.
    const frame = localFrame(SNAPSHOT_SHARD.origin[0], SNAPSHOT_SHARD.origin[1]);
    const [cx, cy] = localFrame(SNAPSHOT_SHARD.origin[0], SNAPSHOT_SHARD.origin[1]).toLocal(demo.lat, demo.lng);
    let worst = 0;
    for (const row of SNAPSHOT_SHARD.blocks) {
      const d = decodeRow(row, SNAPSHOT_SHARD.unit)!;
      for (const p of d.parts)
        for (const [sx, sy] of p.outer) {
          const [lat, lng] = frame.toLatLng(sx, sy);
          const [px, py] = toWorldPixel(lat, lng, 20);
          const [fx, fy] = pixelToFrame(demo, px, py, 20);
          worst = Math.max(worst, Math.hypot(fx - (sx - cx), fy - (sy - cy)));
        }
    }
    expect(worst).toBeLessThan(0.005);
  });

  it('measures a tile on the ground, east to west and north to south apart', () => {
    const t = tileAt(demo.lat, demo.lng, 19);
    const b = rangeBounds(demo, { z: 19, x0: t.x, y0: t.y, x1: t.x + 1, y1: t.y + 1 });
    // From the ellipsoid's radii of curvature at 1.3159° N: 76.417 m across, 75.906 m down, 0.67% apart.
    expect(b.maxX - b.minX).toBeCloseTo(76.417, 2);
    expect(b.maxY - b.minY).toBeCloseTo(75.906, 2);
    expect(b.minX).toBeLessThanOrEqual(0);
    expect(b.maxX).toBeGreaterThan(0);
    expect(b.minY).toBeLessThanOrEqual(0);
    expect(b.maxY).toBeGreaterThan(0);
  });

  it('lays a texture of a range on its rectangle to within a few millimetres, even 2.4 km across', () => {
    for (const r of [coverSquare(demo.lat, demo.lng, 300, 19), coverSquare(demo.lat, demo.lng, 2400, 16)] as TileRange[]) {
      const b = rangeBounds(demo, r);
      let worst = 0;
      for (let i = 0; i <= 16; i++)
        for (let j = 0; j <= 16; j++) {
          const px = (r.x0 + ((r.x1 - r.x0) * i) / 16) * TILE_PX;
          const py = (r.y0 + ((r.y1 - r.y0) * j) / 16) * TILE_PX;
          const [x, y] = pixelToFrame(demo, px, py, r.z);
          // Where a linear texture coordinate puts that pixel.
          const lx = b.minX + ((b.maxX - b.minX) * i) / 16;
          const ly = b.maxY - ((b.maxY - b.minY) * j) / 16;
          worst = Math.max(worst, Math.hypot(x - lx, y - ly));
        }
      expect(worst).toBeLessThan(0.005);
    }
  });

  it('covers a square round the block with the fewest whole tiles', () => {
    for (const [size, z] of [
      [300, 19],
      [600, 18],
      [2400, 16]
    ]) {
      const r = coverSquare(demo.lat, demo.lng, size, z);
      const b = rangeBounds(demo, r);
      expect(b.minX).toBeLessThanOrEqual(-size / 2);
      expect(b.maxX).toBeGreaterThanOrEqual(size / 2);
      expect(b.minY).toBeLessThanOrEqual(-size / 2);
      expect(b.maxY).toBeGreaterThanOrEqual(size / 2);
      // One column or row fewer on any side would leave part of the square bare.
      const tileW = (b.maxX - b.minX) / (r.x1 - r.x0);
      const tileH = (b.maxY - b.minY) / (r.y1 - r.y0);
      expect(b.minX + tileW).toBeGreaterThan(-size / 2);
      expect(b.maxX - tileW).toBeLessThan(size / 2);
      expect(b.minY + tileH).toBeGreaterThan(-size / 2);
      expect(b.maxY - tileH).toBeLessThan(size / 2);
      expect(tilesIn(r)).toHaveLength((r.x1 - r.x0) * (r.y1 - r.y0));
    }
  });

  it('lists a range’s tiles from the north-west, row by row', () => {
    const list = tilesIn({ z: 19, x0: 10, y0: 20, x1: 12, y1: 22 });
    expect(list.map((t) => [t.x, t.y, t.col, t.row])).toEqual([
      [10, 20, 0, 0],
      [11, 20, 1, 0],
      [10, 21, 0, 1],
      [11, 21, 1, 1]
    ]);
  });
});

describe('loading tiles', () => {
  const png = () => new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), { status: 200 });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTiles();
  });

  /** A stand-in decoder, as node has no createImageBitmap. */
  function stubDecode(): { closed: number } {
    const count = { closed: 0 };
    vi.stubGlobal('createImageBitmap', async () => ({ width: 256, height: 256, close: () => count.closed++ }));
    return count;
  }

  it('asks OneMap without cookies or a referrer, in CORS mode, and keeps the tile for the session', async () => {
    stubDecode();
    const calls = mockFetch(png);
    const url = tileUrl('Grey', { z: 19, x: 1, y: 2 });
    expect(await loadTile(url)).not.toBeNull();
    expect(calls[0].init).toMatchObject({ mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(tileKnown(url)).toBe(true);
    expect(await loadTile(url)).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('treats a missing tile, an empty answer and a blocked network as no tile, quietly', async () => {
    stubDecode();
    const log = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    mockFetch((url) => (url.pathname.includes('/404/') ? new Response('', { status: 404 }) : new Response(new Blob([]), { status: 200 })));
    expect(await loadTile(tileUrl('Grey', { z: 404, x: 1, y: 1 }))).toBeNull();
    // Past a style's highest zoom OneMap answers 200 with nothing in it.
    expect(await loadTile(tileUrl('Grey', { z: 20, x: 1, y: 1 }))).toBeNull();
    mockFetch(blocked);
    expect(await loadTile(tileUrl('Grey', { z: 19, x: 5, y: 5 }))).toBeNull();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('remembers that a tile does not exist, but asks again after a failed request', async () => {
    stubDecode();
    let calls = mockFetch(() => new Response('', { status: 404 }));
    const gone = tileUrl('Grey', { z: 19, x: 7, y: 7 });
    await loadTile(gone);
    await loadTile(gone);
    expect(calls).toHaveLength(1);
    calls = mockFetch(blocked);
    const flaky = tileUrl('Grey', { z: 19, x: 8, y: 8 });
    await loadTile(flaky);
    expect(tileKnown(flaky)).toBe(false);
    calls = mockFetch(png);
    expect(await loadTile(flaky)).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('keeps no more than a few requests in flight, and hands every tile over', async () => {
    stubDecode();
    let live = 0;
    let most = 0;
    mockFetch(async () => {
      live++;
      most = Math.max(most, live);
      await new Promise((r) => setTimeout(r, 2));
      live--;
      return png();
    });
    const urls = tilesIn({ z: 19, x0: 0, y0: 0, x1: 5, y1: 5 }).map((t) => tileUrl('Grey', t));
    const got: number[] = [];
    await loadTiles(urls, (i, t) => t && got.push(i), { concurrency: 3 });
    expect(most).toBe(3);
    expect(got.sort((a, b) => a - b)).toEqual(urls.map((_, i) => i));
  });

  it('stops asking once the signal fires, and closes what arrives after', async () => {
    const decoded = stubDecode();
    const calls = mockFetch(never);
    const ctl = new AbortController();
    const urls = tilesIn({ z: 19, x0: 0, y0: 0, x1: 4, y1: 4 }).map((t) => tileUrl('Night', t));
    const got: unknown[] = [];
    const done = loadTiles(urls, (_, t) => got.push(t), { signal: ctl.signal, concurrency: 2 });
    await new Promise((r) => setTimeout(r, 5));
    ctl.abort();
    await done;
    expect(calls.length).toBe(2);
    expect(got).toHaveLength(0);
    expect(decoded.closed).toBe(0);
  });
});
