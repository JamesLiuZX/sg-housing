import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheClear, setCacheStorage } from './cache';
import { blockFacts, blockResales, configureDataGov, PROPERTY_RESOURCE, RESALE_RESOURCE, summariseResales, toFacts } from './datagov';
import { blocked, datastore, json, mockFetch, type Call } from './fetch.fixture';

/** HDB Property Information's row for Blk 440A Clementi Ave 3, as served on 13 Nov 2026. */
const FACTS_440A = {
  _id: 7421,
  blk_no: '440A',
  street: 'CLEMENTI AVE 3',
  max_floor_lvl: '30',
  year_completed: '2017',
  residential: 'Y',
  commercial: 'N',
  market_hawker: 'N',
  miscellaneous: 'Y',
  multistorey_carpark: 'N',
  precinct_pavilion: 'N',
  bldg_contract_town: 'CL',
  total_dwelling_units: '208',
  '1room_sold': '0',
  '2room_sold': '54',
  '3room_sold': '102',
  '4room_sold': '52',
  '5room_sold': '0',
  exec_sold: '0',
  multigen_sold: '0',
  studio_apartment_sold: '0',
  '1room_rental': '0',
  '2room_rental': '0',
  '3room_rental': '0',
  other_room_rental: '0'
};

const sale = (month: string, flat_type: string, area: string, flat_model = 'Model A') => ({
  month,
  town: 'CLEMENTI',
  flat_type,
  block: '440A',
  street_name: 'CLEMENTI AVE 3',
  storey_range: '25 TO 27',
  floor_area_sqm: area,
  flat_model,
  lease_commence_date: '2018',
  remaining_lease: '90 years 11 months',
  resale_price: '890000'
});

const SALES_440A = [
  sale('2025-10', '4 ROOM', '87.00'),
  sale('2026-09', '3 ROOM', '69.00'),
  sale('2024-02', '3 ROOM', '69'),
  sale('2023-07', '2 ROOM', '47.00'),
  sale('2026-01', '3 ROOM', '69.00')
];

const resource = (c: Call) => c.url.searchParams.get('resource_id');
const filters = (c: Call) => JSON.parse(c.url.searchParams.get('filters') ?? '{}') as Record<string, string>;

beforeEach(() => {
  setCacheStorage(null);
  cacheClear();
  // No pacing in tests; the limiter has its own.
  configureDataGov({ ratePer10s: 1000 });
});
afterEach(() => vi.unstubAllGlobals());

describe('toFacts', () => {
  it('reads the published row for 440A Clementi Ave 3', () => {
    expect(toFacts(FACTS_440A)).toMatchObject({
      blk: '440A',
      street: 'CLEMENTI AVE 3',
      storeys: 30,
      yearCompleted: 2017,
      dwellingUnits: 208,
      residential: true,
      units: [
        { type: '2 ROOM', sold: 54, rental: 0 },
        { type: '3 ROOM', sold: 102, rental: 0 },
        { type: '4 ROOM', sold: 52, rental: 0 }
      ]
    });
  });
});

describe('summariseResales', () => {
  it('lists the layouts seen, newest sales first, with the lease year', () => {
    const s = summariseResales('440A', 'CLEMENTI AVE 3', SALES_440A, 24);
    expect(s.recent.map((r) => r.month)).toEqual(['2026-09', '2026-01', '2025-10', '2024-02', '2023-07']);
    expect(s.layouts).toEqual([
      // "69" and "69.00" are the same flat.
      { flatType: '3 ROOM', flatModel: 'Model A', floorAreas: [69], count: 3 },
      { flatType: '2 ROOM', flatModel: 'Model A', floorAreas: [47], count: 1 },
      { flatType: '4 ROOM', flatModel: 'Model A', floorAreas: [87], count: 1 }
    ]);
    expect(s.leaseStart).toBe(2018);
    expect(s.town).toBe('CLEMENTI');
    expect(s.total).toBe(24);
    expect(s.recent[0]).toMatchObject({ floorArea: 69, price: 890000, storeyRange: '25 TO 27', leaseStart: 2018 });
  });

  it('is empty, not missing, for a block nobody has resold', () => {
    expect(summariseResales('101A', 'TENGAH DR', [])).toMatchObject({ total: 0, recent: [], layouts: [], leaseStart: null, town: '' });
  });
});

describe('blockFacts', () => {
  it('asks with HDB\'s spelling of the street', async () => {
    const calls = mockFetch(() => datastore([FACTS_440A]));
    const r = await blockFacts('440a', 'CLEMENTI AVENUE 3');
    expect(r).toMatchObject({ status: 'ok', data: { storeys: 30 } });
    expect(calls).toHaveLength(1);
    expect(resource(calls[0])).toBe(PROPERTY_RESOURCE);
    expect(filters(calls[0])).toEqual({ blk_no: '440A', street: 'CLEMENTI AVE 3' });
  });

  it('falls back to every block with that number when the spelling misses', async () => {
    const calls = mockFetch((url) => {
      const f = JSON.parse(url.searchParams.get('filters') ?? '{}') as Record<string, string>;
      if (f.street) return datastore([]);
      return datastore([{ ...FACTS_440A, street: 'CLEMENTI AVE 2' }, { ...FACTS_440A, street: 'RACE COURSE RD', blk_no: '681' }]);
    });
    const r = await blockFacts('681', 'RACECOURSE ROAD');
    expect(r).toMatchObject({ status: 'ok', data: { street: 'RACE COURSE RD' } });
    expect(calls.map(filters)).toEqual([{ blk_no: '681', street: 'RACECOURSE RD' }, { blk_no: '681' }]);
  });

  it('says "not found" when no block has that number on that street', async () => {
    mockFetch(() => datastore([]));
    expect(await blockFacts('9999Z', 'NOWHERE ROAD')).toEqual({ status: 'not-found' });
  });

  it('fails soft offline', async () => {
    mockFetch(blocked);
    expect(await blockFacts('440A', 'CLEMENTI AVENUE 3')).toMatchObject({ status: 'unavailable', service: 'datagov', reason: 'network' });
  });

  it('rides out a 429 politely', async () => {
    let n = 0;
    const calls = mockFetch(() => (n++ === 0 ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } }) : datastore([FACTS_440A])));
    expect(await blockFacts('440A', 'CLEMENTI AVE 3')).toMatchObject({ status: 'ok' });
    expect(calls).toHaveLength(2);
  });

  it('shares one request between callers, and lets one give up alone', async () => {
    let answer: (r: Response) => void = () => {};
    const calls = mockFetch(() => new Promise<Response>((resolve) => (answer = resolve)));
    const ctl = new AbortController();
    const first = blockFacts('440A', 'CLEMENTI AVE 3', { signal: ctl.signal });
    const second = blockFacts('440A', 'Clementi Avenue 3');
    ctl.abort();
    expect(await first).toEqual({ status: 'aborted' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    answer(datastore([FACTS_440A]));
    expect(await second).toMatchObject({ status: 'ok', data: { dwellingUnits: 208 } });
    // And the answer is remembered.
    expect(await blockFacts('440A', 'CLEMENTI AVE 3')).toMatchObject({ status: 'ok' });
    expect(calls).toHaveLength(1);
  });

  it('can go through a keyed proxy without callers changing', async () => {
    const calls = mockFetch(() => datastore([FACTS_440A]));
    configureDataGov({ baseUrl: 'https://proxy.example', ratePer10s: 1000 });
    await blockFacts('440A', 'CLEMENTI AVE 3');
    expect(calls[0].url.origin).toBe('https://proxy.example');
    expect(calls[0].url.pathname).toBe('/api/action/datastore_search');
  });

  it('calls an unexpected answer a bad response', async () => {
    mockFetch(() => json({ success: false, error: { message: 'nope' } }));
    expect(await blockFacts('440A', 'CLEMENTI AVE 3')).toMatchObject({ status: 'unavailable', reason: 'bad-response' });
  });
});

describe('blockResales', () => {
  it('asks for the block\'s sales newest first and summarises them', async () => {
    const calls = mockFetch(() => datastore(SALES_440A, 24));
    const r = await blockResales('440A', 'CLEMENTI AVENUE 3');
    expect(r).toMatchObject({ status: 'ok', data: { total: 24, leaseStart: 2018 } });
    expect(resource(calls[0])).toBe(RESALE_RESOURCE);
    expect(filters(calls[0])).toEqual({ block: '440A', street_name: 'CLEMENTI AVE 3' });
    expect(calls[0].url.searchParams.get('sort')).toBe('month desc');
  });

  it('reports a block with no resales as found, with nothing sold', async () => {
    const calls = mockFetch((url) => datastore(url.searchParams.get('resource_id') === PROPERTY_RESOURCE ? [{ ...FACTS_440A, blk_no: '101A', street: 'TENGAH DR' }] : []));
    const r = await blockResales('101A', 'TENGAH DRIVE');
    expect(r).toMatchObject({ status: 'ok', data: { total: 0, layouts: [], street: 'TENGAH DR' } });
    expect(calls.map(resource)).toEqual([RESALE_RESOURCE, PROPERTY_RESOURCE]);
  });

  it('retries under HDB\'s spelling when Property Information knows the street by another', async () => {
    const calls = mockFetch((url) => {
      const f = JSON.parse(url.searchParams.get('filters') ?? '{}') as Record<string, string>;
      if (url.searchParams.get('resource_id') === PROPERTY_RESOURCE) return datastore(f.street ? [] : [{ ...FACTS_440A, blk_no: '681', street: 'RACE COURSE RD' }]);
      return datastore(f.street_name === 'RACE COURSE RD' ? [{ ...sale('2026-05', '3 ROOM', '67'), block: '681', street_name: 'RACE COURSE RD' }] : []);
    });
    const r = await blockResales('681', 'RACECOURSE ROAD');
    expect(r).toMatchObject({ status: 'ok', data: { total: 1, street: 'RACE COURSE RD' } });
    expect(calls).toHaveLength(4);
  });

  it('says "not found" for a block HDB does not have', async () => {
    mockFetch(() => datastore([]));
    expect(await blockResales('9999Z', 'NOWHERE ROAD')).toEqual({ status: 'not-found' });
  });

  it('fails soft offline', async () => {
    mockFetch(blocked);
    expect(await blockResales('440A', 'CLEMENTI AVE 3')).toMatchObject({ status: 'unavailable', reason: 'network' });
  });
});
