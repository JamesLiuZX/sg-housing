import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheClear, setCacheStorage } from './cache';
import {
  blockFacts,
  blockHeights,
  blockResales,
  buildingKind,
  configureDataGov,
  HEIGHT_FIELDS,
  PROPERTY_RESOURCE,
  RESALE_RESOURCE,
  summariseResales,
  toFacts,
  toHeight
} from './datagov';
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

/** A Property Information row trimmed to the columns heights are read from, with the uses named set to "Y". */
const building = (blk_no: string, street: string, max_floor_lvl: string, ...uses: string[]): Record<string, string> => ({
  blk_no,
  street,
  max_floor_lvl,
  ...Object.fromEntries(HEIGHT_FIELDS.slice(3).map((c) => [c, uses.includes(c) ? 'Y' : 'N']))
});

/** Three of 440A's neighbours as data.gov.sg served them on 18 Nov 2026: a tower, a car park, a bus interchange podium. */
const TOWER_440B = building('440B', 'CLEMENTI AVE 3', '40', 'residential');
const CARPARK_440 = building('440', 'CLEMENTI AVE 3', '3', 'multistorey_carpark');
const PODIUM_441 = building('441', "C'WEALTH AVE WEST", '7');

/** The filters of a datastore search, lists and all. */
const lists = (c: Call) => JSON.parse(c.url.searchParams.get('filters') ?? '{}') as Record<string, string | string[]>;

describe('buildingKind', () => {
  it.each([
    [['residential'], 'residential'],
    [['residential', 'commercial'], 'residential'],
    [['residential', 'market_hawker'], 'residential'],
    [['multistorey_carpark'], 'carpark'],
    [['commercial', 'multistorey_carpark'], 'carpark'],
    [['market_hawker', 'multistorey_carpark'], 'carpark'],
    [['market_hawker'], 'market'],
    [['commercial', 'market_hawker'], 'market'],
    [['commercial'], 'commercial'],
    [['precinct_pavilion'], 'pavilion'],
    [[], 'other']
  ])('calls a building flagged %j a %s', (uses, kind) => {
    expect(buildingKind(building('1', 'ANY RD', '1', ...uses))).toBe(kind);
  });
});

describe('toHeight', () => {
  it('reads the storeys and the kind as HDB records them', () => {
    expect(toHeight(TOWER_440B, '122440')).toEqual({ postal: '122440', blk: '440B', street: 'CLEMENTI AVE 3', storeys: 40, kind: 'residential' });
    expect(toHeight(CARPARK_440, '120440')).toMatchObject({ storeys: 3, kind: 'carpark' });
    expect(toHeight(PODIUM_441, '120441')).toMatchObject({ storeys: 7, kind: 'other' });
  });

  it('never draws a car park or a market as a tower, even when its record has no height', () => {
    expect(toHeight(building('440', 'CLEMENTI AVE 3', '', 'multistorey_carpark'), 'x')).toMatchObject({ storeys: 5, kind: 'carpark' });
    expect(toHeight(building('448', 'CLEMENTI AVE 3', '0', 'market_hawker'), 'x')).toMatchObject({ storeys: 1, kind: 'market' });
    expect(toHeight(building('439', 'CLEMENTI AVE 3', 'n/a', 'precinct_pavilion'), 'x')).toMatchObject({ storeys: 1, kind: 'pavilion' });
  });

  it('leaves a block of flats without a believable height unknown, for the engine\'s typical block', () => {
    expect(toHeight(building('1', 'ANY RD', '', 'residential'), 'x')).toBeNull();
    expect(toHeight(building('1', 'ANY RD', '400', 'residential'), 'x')).toBeNull();
  });

  it('needs a block number and a street', () => {
    expect(toHeight({ max_floor_lvl: '12', residential: 'Y' }, 'x')).toBeNull();
  });
});

describe('blockHeights', () => {
  const NEIGHBOURS = [
    { postal: '122440', blk: '440B', street: 'CLEMENTI AVENUE 3' },
    { postal: '120440', blk: '440', street: 'CLEMENTI AVENUE 3' },
    { postal: '120441', blk: '441', street: 'COMMONWEALTH AVENUE WEST' }
  ];

  it('asks once for many blocks, in HDB\'s spelling, for only the columns it reads', async () => {
    // Every number on every street comes back, so 441 on Clementi Ave 3 would too if it existed; it is not 441's street.
    const decoy = building('441', 'CLEMENTI AVE 3', '12', 'residential');
    const calls = mockFetch(() => datastore([decoy, TOWER_440B, PODIUM_441, CARPARK_440]));
    const r = await blockHeights(NEIGHBOURS);
    expect(calls).toHaveLength(1);
    expect(resource(calls[0])).toBe(PROPERTY_RESOURCE);
    expect(lists(calls[0])).toEqual({ blk_no: ['440B', '440', '441'], street: ['CLEMENTI AVE 3', "C'WEALTH AVE WEST"] });
    expect(calls[0].url.searchParams.get('fields')).toBe(HEIGHT_FIELDS.join(','));
    expect(r.map((x) => (x.status === 'ok' ? [x.data.postal, x.data.storeys, x.data.kind] : x.status))).toEqual([
      ['122440', 40, 'residential'],
      ['120440', 3, 'carpark'],
      ['120441', 7, 'other']
    ]);
  });

  it('looks again by number alone for a street HDB spells another way', async () => {
    const calls = mockFetch((url) =>
      datastore(url.searchParams.get('filters')?.includes('"street"') ? [] : [building('681', 'HOUGANG AVE 8', '11', 'residential'), building('681', 'RACE COURSE RD', '12', 'residential')])
    );
    const [r] = await blockHeights([{ postal: '210681', blk: '681', street: 'RACECOURSE ROAD' }]);
    expect(r).toMatchObject({ status: 'ok', data: { street: 'RACE COURSE RD', storeys: 12 } });
    expect(calls.map(lists)).toEqual([{ blk_no: ['681'], street: ['RACECOURSE RD'] }, { blk_no: ['681'] }]);
  });

  it('says "not found" for a block HDB does not have, and asks nothing about one with no street', async () => {
    const calls = mockFetch(() => datastore([]));
    const r = await blockHeights([
      { postal: '000001', blk: '9999Z', street: 'NOWHERE ROAD' },
      { postal: '000002', blk: '12', street: '' }
    ]);
    expect(r).toEqual([{ status: 'not-found' }, { status: 'not-found' }]);
    expect(calls.map((c) => lists(c).blk_no)).toEqual([['9999Z'], ['9999Z']]);
    expect(await blockHeights([])).toEqual([]);
  });

  it('fails soft offline, every answer "unavailable" and none rejected', async () => {
    mockFetch(blocked);
    const r = await blockHeights(NEIGHBOURS);
    expect(r).toHaveLength(3);
    for (const x of r) expect(x).toMatchObject({ status: 'unavailable', service: 'datagov', reason: 'network' });
  });

  it('stops when its caller gives up', async () => {
    const calls = mockFetch(() => datastore([TOWER_440B]));
    const ctl = new AbortController();
    ctl.abort();
    expect(await blockHeights(NEIGHBOURS, { signal: ctl.signal })).toEqual([{ status: 'aborted' }, { status: 'aborted' }, { status: 'aborted' }]);
    expect(calls).toHaveLength(0);
  });
});
