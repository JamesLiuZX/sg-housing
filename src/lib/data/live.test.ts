/**
 * Checks against the real OneMap and data.gov.sg. Skipped unless BLK_LIVE=1:
 *
 *   BLK_LIVE=1 npx vitest run src/lib/data/live.test.ts
 *
 * About a dozen requests in all, paced by the data layer's own limiter, so it
 * stays well inside data.gov.sg's public rate limit.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import realManifest from '../../../public/blocks/manifest.json?raw';
import realSector12 from '../../../public/blocks/12.json?raw';
import { configureBlocks } from './blocks';
import { cacheClear, setCacheStorage } from './cache';
import { blockFacts } from './datagov';
import { facades } from './facades';
import { lookupBlock } from './lookup';
import { searchAddress } from './onemap';
import { hdbStreet } from './street';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const LIVE = env.BLK_LIVE === '1';
const INDEX = 'https://index.test/blocks/';

describe.skipIf(!LIVE)('live services', () => {
  beforeAll(() => {
    setCacheStorage(null);
    cacheClear();
    // Real network for the services; the block index is served from the files in public/.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(INDEX)) return Promise.resolve(new Response(url.endsWith('manifest.json') ? realManifest : realSector12));
      return realFetch(input, init);
    });
    configureBlocks({ baseUrl: INDEX });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('OneMap finds 440A Clementi Ave 3 however it is typed', { timeout: 30000 }, async () => {
    for (const q of ['440A Clementi Ave 3', 'blk 440a clementi avenue 3', '121440']) {
      const r = await searchAddress(q);
      expect(r.status, q).toBe('ok');
      if (r.status === 'ok') expect(r.data.hits[0]).toMatchObject({ postal: '121440', blk: '440A', road: 'CLEMENTI AVENUE 3' });
    }
  });

  it('OneMap says "not found" for junk, not "unavailable"', { timeout: 30000 }, async () => {
    expect(await searchAddress('xqzzv qqqj')).toEqual({ status: 'not-found' });
  });

  it('one hit gives the footprint, the facts and the resale summary', { timeout: 60000 }, async () => {
    const found = await searchAddress('440A Clementi Ave 3');
    if (found.status !== 'ok') throw new Error(found.status);
    const { block, facts, resales } = await lookupBlock(found.data.hits[0]);
    if (block.status !== 'ok' || facts.status !== 'ok' || resales.status !== 'ok') throw new Error(`${block.status} ${facts.status} ${resales.status}`);
    expect(facades(block.data.footprint).length).toBeGreaterThanOrEqual(4);
    expect(facts.data).toMatchObject({ storeys: 30, yearCompleted: 2017, dwellingUnits: 208 });
    expect(facts.data.units).toContainEqual({ type: '3 ROOM', sold: 102, rental: 0 });
    expect(facts.data.units).toContainEqual({ type: '4 ROOM', sold: 52, rental: 0 });
    expect(resales.data.leaseStart).toBe(2018);
    expect(resales.data.layouts).toContainEqual(expect.objectContaining({ flatType: '3 ROOM', flatModel: 'Model A', floorAreas: [69] }));
    expect(resales.data.layouts).toContainEqual(expect.objectContaining({ flatType: '4 ROOM', flatModel: 'Model A', floorAreas: [87] }));
  });

  it.each([
    ["100 C'wealth Cres", "C'WEALTH CRES"],
    ["1 St. George's Rd", "ST. GEORGE'S RD"],
    ['11 Upp Boon Keng Rd', 'UPP BOON KENG RD'],
    ['103 Bt Batok Ctrl', 'BT BATOK CTRL']
  ])('goes from "%s" through OneMap to HDB\'s %s', { timeout: 60000 }, async (typed, hdb) => {
    const found = await searchAddress(typed);
    if (found.status !== 'ok') throw new Error(found.status);
    const hit = found.data.hits[0];
    expect(hdbStreet(hit.road)).toBe(hdb);
    const facts = await blockFacts(hit.blk, hit.road);
    expect(facts).toMatchObject({ status: 'ok', data: { street: hdb } });
  });
});
