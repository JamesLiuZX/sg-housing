import { afterEach, describe, expect, it, vi } from 'vitest';
import realManifest from '../../../public/blocks/manifest.json?raw';
import realSector12 from '../../../public/blocks/12.json?raw';
import snapshotSource from './demo-snapshot.ts?raw';
import { configureBlocks, loadBlock } from './blocks';
import { DEMO_POSTAL, DEMO_TAKEN, demoHit, isDemoHit, lookupDemo } from './demo';
import { facades } from './facades';
import { mockFetch } from './fetch.fixture';
import { isShard } from './shard';
import { SNAPSHOT_SHARD } from './demo-snapshot';

afterEach(() => vi.unstubAllGlobals());

describe('the bundled demo block', () => {
  it('is 440A Clementi Ave 3, every part found, dated by the snapshot', () => {
    const d = lookupDemo();
    const at = Date.parse(DEMO_TAKEN);
    expect(Number.isFinite(at)).toBe(true);
    expect(d.hit).toMatchObject({ blk: '440A', road: 'CLEMENTI AVENUE 3', postal: DEMO_POSTAL });
    expect([d.block.status, d.facts.status, d.resales.status]).toEqual(['ok', 'ok', 'ok']);
    expect([d.block.fetchedAt, d.facts.fetchedAt, d.resales.fetchedAt]).toEqual([at, at, at]);
  });

  it('carries the facts and resale summary the live services gave', () => {
    const { facts, resales } = lookupDemo();
    expect(facts.data).toMatchObject({ blk: '440A', street: 'CLEMENTI AVE 3', storeys: 30, yearCompleted: 2017, dwellingUnits: 208 });
    expect(facts.data.units).toContainEqual({ type: '3 ROOM', sold: 102, rental: 0 });
    expect(facts.data.units).toContainEqual({ type: '4 ROOM', sold: 52, rental: 0 });
    expect(resales.data.leaseStart).toBe(2018);
    expect(resales.data.layouts).toContainEqual(expect.objectContaining({ flatType: '3 ROOM', flatModel: 'Model A', floorAreas: [69] }));
    expect(resales.data.layouts).toContainEqual(expect.objectContaining({ flatType: '4 ROOM', flatModel: 'Model A', floorAreas: [87] }));
    expect(resales.data.recent.length).toBeGreaterThan(0);
    expect(resales.data.recent.length).toBeLessThanOrEqual(30);
  });

  it('is the same block, to the millimetre, that the live index serves', async () => {
    mockFetch((url) => new Response(url.href.endsWith('manifest.json') ? realManifest : realSector12, { status: 200 }));
    configureBlocks({ baseUrl: 'https://index.test/blocks/' });
    const live = await loadBlock(DEMO_POSTAL);
    if (live.status !== 'ok') throw new Error(live.status);
    expect(lookupDemo().block.data).toEqual(live.data);
  });

  it('has sides to tap and neighbours to cast shadows', () => {
    const { block } = lookupDemo();
    expect(facades(block.data.footprint).length).toBeGreaterThanOrEqual(4);
    expect(block.data.neighbours.length).toBeGreaterThan(0);
    expect(block.data.neighbours.every((n) => n.gap <= 150)).toBe(true);
  });

  it('never touches the network', () => {
    const calls = mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    lookupDemo();
    demoHit();
    expect(calls).toHaveLength(0);
  });

  it('hands out copies, so one caller cannot change another\'s', () => {
    const a = lookupDemo();
    a.block.data.footprint.parts.length = 0;
    a.facts.data.storeys = 0;
    expect(lookupDemo().block.data.footprint.parts.length).toBeGreaterThan(0);
    expect(lookupDemo().facts.data.storeys).toBe(30);
  });

  it('stays a few kilobytes and a valid shard', () => {
    expect(snapshotSource.length).toBeLessThan(10_000);
    expect(isShard(SNAPSHOT_SHARD)).toBe(true);
    expect(isDemoHit(demoHit())).toBe(true);
    expect(isDemoHit({ postal: '560406' })).toBe(false);
  });
});
