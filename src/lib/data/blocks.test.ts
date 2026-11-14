import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildShards, type GeoJsonFeature } from '../../../scripts/build-blocks.mjs';
import realManifest from '../../../public/blocks/manifest.json?raw';
import realSector12 from '../../../public/blocks/12.json?raw';
import { cleanPostal, configureBlocks, footprintGap, loadBlock, loadBlockIndexInfo, toBlockFrame } from './blocks';
import { facades } from './facades';
import { blocked, json, mockFetch } from './fetch.fixture';
import { localFrame } from './shard';
import type { XY } from './types';

const AT: [number, number] = [1.316, 103.764];
const BASE = 'https://index.test/blocks/';

function rect(w: number, h: number, cx: number, cy: number): XY[] {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2]
  ];
}

function feature(postal: string, blk: string, ring: XY[]): GeoJsonFeature {
  const f = localFrame(...AT);
  const coords = ring.map(([x, y]) => {
    const [lat, lng] = f.toLatLng(x, y);
    return [lng, lat];
  });
  return { properties: { POSTAL_COD: postal, BLK_NO: blk }, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } };
}

// Three blocks in sector 12: 440A, a neighbour 30 m east of it, and one 600 m away.
const built = buildShards({
  features: [feature('121440', '440A', rect(60, 15, 0, 0)), feature('122440', '440B', rect(40, 15, 80, 0)), feature('129999', '999', rect(40, 15, 0, 600))]
});
const SHARD_12 = built.shards.get('12')!.shard;
const MANIFEST = { v: 1, built: '2026-11-13T00:00:00Z', blocks: 3, sectors: { '12': { blocks: 3, bytes: 1, bbox: [0, 0, 0, 0] } }, sources: [], licence: 'x', licenceUrl: 'x', attribution: 'Contains information from HDB Existing Building ...' };

/** Serves the index the way a static host does; `missing` is what a missing file returns. */
function serveIndex(files: Record<string, string>, missing: () => Response = () => new Response('Not found', { status: 404 })) {
  return mockFetch((url) => {
    const name = url.href.slice(BASE.length);
    return name in files ? new Response(files[name], { status: 200, headers: { 'content-type': 'application/json' } }) : missing();
  });
}

beforeEach(() => configureBlocks({ baseUrl: BASE }));
afterEach(() => vi.unstubAllGlobals());

describe('loadBlock', () => {
  it('finds a block and centres its footprint on itself', async () => {
    serveIndex({ '12.json': JSON.stringify(SHARD_12), 'manifest.json': JSON.stringify(MANIFEST) });
    const r = await loadBlock('121440');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const b = r.data;
    expect([b.postal, b.blk]).toEqual(['121440', '440A']);
    expect(b.footprint.area).toBeCloseTo(900, 0);
    // The rectangle was centred on AT, so its centroid is AT.
    const [dx, dy] = localFrame(...AT).toLocal(b.lat, b.lng);
    expect(Math.hypot(dx, dy)).toBeLessThan(0.05);
    expect(b.footprint.bounds.minX).toBeCloseTo(-30, 1);
    expect(b.footprint.bounds.maxY).toBeCloseTo(7.5, 1);
    expect(facades(b.footprint).map((f) => Math.round(f.bearing)).sort((p, q) => p - q)).toEqual([0, 90, 180, 270]);
  });

  it('returns the blocks within the radius, nearest first, in the same frame', async () => {
    serveIndex({ '12.json': JSON.stringify(SHARD_12), 'manifest.json': JSON.stringify(MANIFEST) });
    const r = await loadBlock('121440');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.data.neighbours.map((n) => n.blk)).toEqual(['440B']);
    const n = r.data.neighbours[0];
    expect(n.gap).toBeCloseTo(30, 1);
    expect(n.footprint.bounds.minX).toBeCloseTo(60, 1);
    const wide = await loadBlock('121440', { radius: 1000 });
    expect(wide.status === 'ok' && wide.data.neighbours.map((x) => x.blk)).toEqual(['440B', '999']);
  });

  it('says "not found" for a postal code with no HDB block', async () => {
    serveIndex({ '12.json': JSON.stringify(SHARD_12), 'manifest.json': JSON.stringify(MANIFEST) });
    expect(await loadBlock('128888')).toEqual({ status: 'not-found' });
    expect(await loadBlock('not a postcode')).toEqual({ status: 'not-found' });
  });

  it('says "not found" for a sector with no HDB blocks, even where a missing file comes back as a web page', async () => {
    // Vite's dev server, and captive portals, answer a missing file with 200 and HTML.
    const calls = serveIndex({ '12.json': JSON.stringify(SHARD_12), 'manifest.json': JSON.stringify(MANIFEST) }, () => new Response('<!doctype html>', { status: 200 }));
    expect(await loadBlock('018956')).toEqual({ status: 'not-found' });
    expect(calls.map((c) => c.url.href.slice(BASE.length)).sort()).toEqual(['01.json', 'manifest.json']);
  });

  it('says "unavailable" when the sector should exist but will not load', async () => {
    serveIndex({ 'manifest.json': JSON.stringify(MANIFEST) }, () => new Response('', { status: 500 }));
    expect(await loadBlock('121440')).toMatchObject({ status: 'unavailable', service: 'blocks' });
  });

  it('fails soft with no network at all, as in the single-file preview', async () => {
    mockFetch(blocked);
    expect(await loadBlock('121440')).toMatchObject({ status: 'unavailable', service: 'blocks', reason: 'network' });
    expect(await loadBlockIndexInfo()).toMatchObject({ status: 'unavailable', reason: 'network' });
  });

  it('fetches each sector once per visit, and retries one that failed', async () => {
    let fail = true;
    const calls = mockFetch((url) => {
      if (url.href.endsWith('manifest.json')) return json(MANIFEST);
      return fail ? Promise.reject(new TypeError('Failed to fetch')) : json(SHARD_12);
    });
    expect((await loadBlock('121440')).status).toBe('unavailable');
    fail = false;
    expect((await loadBlock('121440')).status).toBe('ok');
    expect((await loadBlock('122440')).status).toBe('ok');
    expect(calls.filter((c) => c.url.href.endsWith('12.json'))).toHaveLength(2);
  });

  it('stops when aborted', async () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const ctl = new AbortController();
    const pending = loadBlock('121440', { signal: ctl.signal });
    ctl.abort();
    expect(await pending).toEqual({ status: 'aborted' });
  });
});

describe('the generated index', () => {
  it('has 440A Clementi Ave 3 where OneMap puts it, with sides to tap and blocks around it', async () => {
    serveIndex({ '12.json': realSector12, 'manifest.json': realManifest });
    const r = await loadBlock('121440');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.data.blk).toBe('440A');
    // OneMap's point for 121440 is the building's address point; it lies on or near the footprint.
    const [x, y] = toBlockFrame(r.data, 1.316001325850225, 103.7641857834711);
    expect(Math.hypot(x, y)).toBeLessThan(40);
    const sides = facades(r.data.footprint);
    expect(sides.length).toBeGreaterThanOrEqual(4);
    for (const s of sides) {
      expect(s.bearing).toBeGreaterThanOrEqual(0);
      expect(s.bearing).toBeLessThan(360);
      expect(s.length).toBeGreaterThanOrEqual(6);
    }
    expect(r.data.neighbours.length).toBeGreaterThan(0);
    expect(r.data.neighbours.every((n) => n.gap <= 150)).toBe(true);
  });

  it('carries the licence attribution', async () => {
    serveIndex({ 'manifest.json': realManifest });
    const m = await loadBlockIndexInfo();
    expect(m.status === 'ok' && m.data.attribution).toMatch(/^Contains information from HDB Existing Building accessed on .+ Singapore Open Data Licence version 1\.0/);
  });
});

describe('helpers', () => {
  it('cleanPostal reads postal codes however they arrive', () => {
    expect(cleanPostal('121440')).toBe('121440');
    expect(cleanPostal(50531)).toBe('050531');
    expect(cleanPostal('Singapore 121440')).toBe('121440');
    expect(cleanPostal('1234')).toBeNull();
  });

  it('footprintGap measures edge to edge', () => {
    const a = [{ outer: rect(10, 10, 0, 0), holes: [] }];
    const b = [{ outer: rect(10, 10, 20, 0), holes: [] }];
    expect(footprintGap(a, b)).toBeCloseTo(10, 9);
  });
});
