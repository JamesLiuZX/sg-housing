import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheClear, setCacheStorage, type StorageLike } from './cache';
import { configureDataGov, HEIGHT_FIELDS } from './datagov';
import { lookupDemo } from './demo';
import { blocked, datastore, json, mockFetch, type Call, type Route } from './fetch.fixture';
import { knownNeighbourHeights, lookupNeighbourHeights } from './neighbours';
import { configureOneMap } from './onemap';
import type { Block, NeighbourHeights } from './types';

/**
 * A block whose neighbours nobody knows yet: the demo block's shapes and
 * gaps, renumbered so that neither the snapshot nor the cache has them.
 * Neighbour i, nearest first, is postal 99000i.
 */
function stranger(count: number): Block {
  const demo = lookupDemo().block.data;
  return {
    ...demo,
    postal: '990999',
    blk: '999',
    neighbours: demo.neighbours.slice(0, count).map((n, i) => ({ ...n, postal: `99${String(i).padStart(4, '0')}`, blk: String(10 + i) }))
  };
}

/** Neighbour i is Blk 10+i, 10+i storeys, on Test Avenue 1 or Test Street 2 in turn; Blk 11 is a car park. */
function place(postal: string) {
  const i = Number(postal.slice(2));
  const odd = i % 2 === 1;
  return { i, blk: String(10 + i), road: odd ? 'TEST STREET 2' : 'TEST AVENUE 1', street: odd ? 'TEST ST 2' : 'TEST AVE 1', storeys: 10 + i };
}

/**
 * OneMap and data.gov.sg as far as these blocks go. `unplaced`: postal codes
 * OneMap has nothing at. `unrecorded`: block numbers Property Information has no row for.
 */
function services(options: { unplaced?: string[]; unrecorded?: string[] } = {}): Route {
  return (url) => {
    if (url.hostname === 'www.onemap.gov.sg') {
      const postal = url.searchParams.get('searchVal') ?? '';
      if (options.unplaced?.includes(postal)) return json({ found: 0, totalNumPages: 0, pageNum: 1, results: [] });
      const p = place(postal);
      const address = `${p.blk} ${p.road} SINGAPORE ${postal}`;
      return json({ found: 1, results: [{ BLK_NO: p.blk, ROAD_NAME: p.road, BUILDING: 'NIL', ADDRESS: address, POSTAL: postal, LATITUDE: '1.316', LONGITUDE: '103.764' }] });
    }
    const f = JSON.parse(url.searchParams.get('filters') ?? '{}') as { blk_no: string[]; street?: string[] };
    const rows = [...Array(20).keys()]
      .map((i) => place(`99${String(i).padStart(4, '0')}`))
      .filter((p) => f.blk_no.includes(p.blk) && (!f.street || f.street.includes(p.street)) && !options.unrecorded?.includes(p.blk))
      .map((p) => ({
        ...Object.fromEntries(HEIGHT_FIELDS.map((c) => [c, 'N'])),
        blk_no: p.blk,
        street: p.street,
        max_floor_lvl: String(p.storeys),
        [p.i === 1 ? 'multistorey_carpark' : 'residential']: 'Y'
      }));
    return datastore(rows);
  };
}

const isOneMap = (c: Call): boolean => c.url.hostname === 'www.onemap.gov.sg';
const isDataGov = (c: Call): boolean => c.url.hostname === 'data.gov.sg';
const numbers = (c: Call): string[] => (JSON.parse(c.url.searchParams.get('filters') ?? '{}') as { blk_no: string[] }).blk_no;

/** Runs a lookup to its end on the fake clock, where OneMap's half-second pacing takes no real time. */
async function finish<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.then(() => (done = true));
  for (let i = 0; i < 300 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  return p;
}

// Each test starts an hour after the last on the fake clock, so OneMap's pacing carries nothing over.
let clock = Date.now();
beforeEach(() => {
  vi.useFakeTimers({ now: (clock += 3600_000) });
  setCacheStorage(null);
  cacheClear();
  configureOneMap({});
  configureDataGov({ ratePer10s: 1000 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setCacheStorage(undefined);
});

describe('knownNeighbourHeights', () => {
  it("knows every one of the demo block's neighbours at once, without the network", async () => {
    const calls = mockFetch(blocked);
    const block = lookupDemo().block.data;
    const now = knownNeighbourHeights(block);
    expect(now.found.map((h) => h.postal)).toEqual(block.neighbours.map((n) => n.postal));
    expect(now.missing).toEqual([]);
    expect(now.storeys).toMatchObject({ '122440': 40, '120440': 3 });
    const progress = vi.fn();
    expect(await lookupNeighbourHeights(block, { onProgress: progress })).toEqual(now);
    expect(progress).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('knows nothing about blocks nobody has asked about', () => {
    expect(knownNeighbourHeights(stranger(8))).toEqual({ storeys: {}, found: [], missing: [] });
  });

  it('hands out copies, so one caller cannot change what another sees', () => {
    const block = lookupDemo().block.data;
    knownNeighbourHeights(block).found[0].storeys = 99;
    expect(knownNeighbourHeights(block).found[0].storeys).not.toBe(99);
  });
});

describe('lookupNeighbourHeights', () => {
  it('asks about the nearest eight, nearest first: a OneMap search each, one data.gov.sg search per four', async () => {
    const block = stranger(10);
    const calls = mockFetch(services());
    const r = await finish(lookupNeighbourHeights(block));
    const nearest = block.neighbours.slice(0, 8).map((n) => n.postal);
    expect(calls.filter(isOneMap).map((c) => c.url.searchParams.get('searchVal'))).toEqual(nearest);
    expect(calls.filter(isDataGov).map(numbers)).toEqual([
      ['10', '11', '12', '13'],
      ['14', '15', '16', '17']
    ]);
    expect(r.found.map((h) => h.postal)).toEqual(nearest);
    expect(r.found[1]).toMatchObject({ blk: '11', street: 'TEST ST 2', storeys: 11, kind: 'carpark' });
    expect(r.storeys).toMatchObject({ '990000': 10, '990007': 17 });
    // The ninth and tenth are not asked about, and keep the engine's typical height.
    expect(r.storeys['990008']).toBeUndefined();
    expect(r.missing).toEqual([]);
  });

  it('reports each wave of answers as it lands, nearest first', async () => {
    const progress: NeighbourHeights[] = [];
    mockFetch(services());
    const r = await finish(lookupNeighbourHeights(stranger(8), { onProgress: (h) => progress.push(h) }));
    expect(progress.map((h) => h.found.map((x) => x.blk))).toEqual([
      ['10', '11', '12', '13'],
      ['10', '11', '12', '13', '14', '15', '16', '17']
    ]);
    expect(progress[1]).toEqual(r);
  });

  it('keeps every answer, so the same block again asks nobody and is drawn true at once', async () => {
    const block = stranger(8);
    mockFetch(services());
    const first = await finish(lookupNeighbourHeights(block));
    const calls = mockFetch(blocked);
    expect(knownNeighbourHeights(block)).toEqual(first);
    expect(await finish(lookupNeighbourHeights(block))).toEqual(first);
    expect(calls).toHaveLength(0);
  });

  it('keeps heights on the device for a week', async () => {
    const stored = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => stored.get(k) ?? null,
      setItem: (k, v) => void stored.set(k, v),
      removeItem: (k) => void stored.delete(k),
      key: (i) => [...stored.keys()][i] ?? null,
      get length() {
        return stored.size;
      }
    };
    setCacheStorage(storage);
    mockFetch(services());
    await finish(lookupNeighbourHeights(stranger(2)));
    const entry = JSON.parse(stored.get('blk:data:height:990000') ?? 'null') as { e: number; t: number } | null;
    expect(entry && entry.e - entry.t).toBe(7 * 24 * 3600 * 1000);
  });

  it('fails soft: a neighbour neither service can place keeps the default', async () => {
    const block = stranger(6);
    const [a, , , d] = block.neighbours.map((n) => n.postal);
    mockFetch(services({ unplaced: [a], unrecorded: ['13'] }));
    const r = await finish(lookupNeighbourHeights(block));
    expect(r.missing).toEqual([a, d]);
    expect(r.storeys[a]).toBeUndefined();
    expect(r.storeys[d]).toBeUndefined();
    expect(Object.keys(r.storeys)).toHaveLength(4);
  });

  it('does not ask again this visit about a block that is not on record', async () => {
    const block = stranger(2);
    mockFetch(services({ unrecorded: ['10'] }));
    await finish(lookupNeighbourHeights(block));
    const calls = mockFetch(services());
    const r = await finish(lookupNeighbourHeights(block));
    expect(calls).toHaveLength(0);
    expect(r.missing).toEqual(['990000']);
    expect(knownNeighbourHeights(block).missing).toEqual(['990000']);
  });

  it('offline, resolves with nothing new and never rejects; back online, it asks again', async () => {
    const block = stranger(8);
    mockFetch(blocked);
    const off = await finish(lookupNeighbourHeights(block));
    expect(off.found).toEqual([]);
    expect(off.missing).toHaveLength(8);
    mockFetch(services());
    expect((await finish(lookupNeighbourHeights(block))).found).toHaveLength(8);
  });

  it('stops when its signal fires: no progress after that, and it still resolves', async () => {
    const ctl = new AbortController();
    const progress = vi.fn();
    const calls = mockFetch(services());
    const pending = lookupNeighbourHeights(stranger(8), { signal: ctl.signal, onProgress: progress });
    await vi.advanceTimersByTimeAsync(600);
    ctl.abort();
    const r = await finish(pending);
    expect(progress).not.toHaveBeenCalled();
    expect(calls.filter(isOneMap).length).toBeLessThanOrEqual(2);
    expect(calls.filter(isDataGov)).toHaveLength(0);
    expect(r).toEqual({ storeys: {}, found: [], missing: [] });
  });

  it('goes only as far as asked, counting neighbours already known', async () => {
    const block = stranger(5);
    mockFetch(services());
    await finish(lookupNeighbourHeights({ ...block, neighbours: [block.neighbours[1], block.neighbours[4]] }));
    const calls = mockFetch(services());
    const r = await finish(lookupNeighbourHeights(block, { limit: 3 }));
    // Of the nearest three, the second is known: only the first and the third are asked about.
    expect(calls.filter(isOneMap).map((c) => c.url.searchParams.get('searchVal'))).toEqual(['990000', '990002']);
    // The fifth is farther than asked, and known already, so it is kept.
    expect(r.found.map((h) => h.postal)).toEqual(['990000', '990001', '990002', '990004']);
  });

  it('carries on when a progress callback throws, and does not reject', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch(services());
    const r = await finish(
      lookupNeighbourHeights(stranger(8), {
        onProgress: () => {
          throw new Error('a mistake in the caller');
        }
      })
    );
    expect(r.found).toHaveLength(8);
    expect(error).toHaveBeenCalledTimes(2);
  });
});
