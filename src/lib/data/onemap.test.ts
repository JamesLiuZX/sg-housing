import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheClear, setCacheStorage } from './cache';
import { blocked, json, mockFetch } from './fetch.fixture';
import { cleanQuery, configureOneMap, parseSearch, searchAddress } from './onemap';

const NOTICE = 'Authentication token missing. Please create an account and generate or renew your API Token.';

/** OneMap's answer for "440A Clementi Ave 3" on 13 Nov 2026, notice and all. */
const CLEMENTI = {
  error: NOTICE,
  found: 2,
  totalNumPages: 1,
  pageNum: 1,
  results: [
    {
      SEARCHVAL: 'ANANIAS CENTRE (CLEMENTI)',
      BLK_NO: '440A',
      ROAD_NAME: 'CLEMENTI AVENUE 3',
      BUILDING: 'ANANIAS CENTRE (CLEMENTI)',
      ADDRESS: '440A CLEMENTI AVENUE 3 ANANIAS CENTRE (CLEMENTI) SINGAPORE 121440',
      POSTAL: '121440',
      X: '20307.50466088206',
      Y: '33142.07118210942',
      LATITUDE: '1.315998673983866',
      LONGITUDE: '103.7641976249758'
    },
    {
      SEARCHVAL: 'CLEMENTI CASCADIA',
      BLK_NO: '440A',
      ROAD_NAME: 'CLEMENTI AVENUE 3',
      BUILDING: 'CLEMENTI CASCADIA',
      ADDRESS: '440A CLEMENTI AVENUE 3 CLEMENTI CASCADIA SINGAPORE 121440',
      POSTAL: '121440',
      X: '20306.18682313897',
      Y: '33142.36444860324',
      LATITUDE: '1.316001325850225',
      LONGITUDE: '103.7641857834711'
    }
  ]
};

const ROAD_ONLY = { found: 1, results: [{ BLK_NO: '', ROAD_NAME: 'CLEMENTI AVENUE 3', BUILDING: 'NIL', ADDRESS: 'CLEMENTI AVENUE 3', POSTAL: 'NIL', LATITUDE: '1.3139', LONGITUDE: '103.7665' }] };
const NOTHING = { error: NOTICE, found: 0, totalNumPages: 0, pageNum: 1, results: [] };

beforeEach(() => {
  setCacheStorage(null);
  cacheClear();
  configureOneMap({});
});
afterEach(() => vi.unstubAllGlobals());

describe('cleanQuery', () => {
  it.each([
    ['440A Clementi Ave 3', '440A CLEMENTI AVE 3'],
    ['blk 440a clementi avenue 3', '440A CLEMENTI AVENUE 3'],
    ['Blk 440A Clementi Ave 3 #12-345', '440A CLEMENTI AVE 3'],
    ['Block 440A, Clementi Ave 3, Singapore', '440A CLEMENTI AVE 3'],
    ['BLK440A CLEMENTI AVE 3', '440A CLEMENTI AVE 3'],
    ['440 A Clementi Ave 3', '440A CLEMENTI AVE 3'],
    ["1 St. George's Rd", "1 ST. GEORGE'S RD"],
    ['100 C’wealth Cres', "100 C'WEALTH CRES"],
    ['121440', '121440'],
    ['Singapore 121440', '121440'],
    ['S(121440)', '121440'],
    ['440A Clementi Avenue 3 Singapore 121440', '121440'],
    ['050531', '050531']
  ])('cleans %j to %j', (raw, want) => {
    expect(cleanQuery(raw)).toBe(want);
  });

  it.each(['', '   ', '!!!', '#', 'a', 'blk', 'Singapore', '#12-345'])('finds nothing searchable in %j', (raw) => {
    expect(cleanQuery(raw)).toBeNull();
  });

  it('caps very long input', () => {
    expect(cleanQuery('clementi '.repeat(100))!.length).toBeLessThanOrEqual(100);
  });
});

describe('parseSearch', () => {
  it('merges the entries OneMap lists once per building name', () => {
    const r = parseSearch(CLEMENTI, '440A CLEMENTI AVE 3');
    expect(r.kind).toBe('hits');
    if (r.kind !== 'hits') return;
    expect(r.data.hits).toHaveLength(1);
    expect(r.data.hits[0]).toEqual({
      blk: '440A',
      road: 'CLEMENTI AVENUE 3',
      building: 'ANANIAS CENTRE (CLEMENTI)',
      postal: '121440',
      lat: 1.315998673983866,
      lng: 103.7641976249758,
      address: '440A CLEMENTI AVENUE 3 ANANIAS CENTRE (CLEMENTI) SINGAPORE 121440'
    });
    expect(r.data.total).toBe(2);
  });

  it('turns OneMap\'s "NIL" into empty strings', () => {
    const r = parseSearch(ROAD_ONLY, 'CLEMENTI AVE 3');
    expect(r.kind === 'hits' && r.data.hits[0]).toMatchObject({ blk: '', building: '', postal: '' });
  });

  it('tells an empty answer from a refusal from a malformed one', () => {
    expect(parseSearch({ found: 0, results: [] }, 'X').kind).toBe('none');
    expect(parseSearch(NOTHING, 'X').kind).toBe('refused');
    expect(parseSearch({ nope: true }, 'X').kind).toBe('bad');
    expect(parseSearch('<html>', 'X').kind).toBe('bad');
  });
});

describe('searchAddress', () => {
  it('sends nothing when there is nothing to search', async () => {
    const calls = mockFetch(() => json(CLEMENTI));
    expect(await searchAddress('  #12-34 ')).toEqual({ status: 'empty' });
    expect(calls).toHaveLength(0);
  });

  it('sends only the cleaned query, and finds the block', async () => {
    const calls = mockFetch(() => json(CLEMENTI));
    const r = await searchAddress('blk 440a clementi avenue 3 #08-123');
    expect(r.status).toBe('ok');
    expect(calls[0].url.searchParams.get('searchVal')).toBe('440A CLEMENTI AVENUE 3');
    expect(calls[0].url.origin).toBe('https://www.onemap.gov.sg');
  });

  it('remembers answers for the visit', async () => {
    const calls = mockFetch(() => json(CLEMENTI));
    await searchAddress('440A Clementi Ave 3');
    await searchAddress('440a clementi ave 3');
    expect(calls).toHaveLength(1);
  });

  it('says "not found" for a typo while OneMap still answers without a token', async () => {
    const calls = mockFetch((url) => json(url.searchParams.get('searchVal') === '200640' ? CLEMENTI : NOTHING));
    expect(await searchAddress('xqzzv')).toEqual({ status: 'not-found' });
    // One probe, then remembered.
    expect(await searchAddress('xqzzw')).toEqual({ status: 'not-found' });
    expect(calls.filter((c) => c.url.searchParams.get('searchVal') === '200640')).toHaveLength(1);
  });

  it('says "unavailable: auth" once OneMap stops answering without a token', async () => {
    mockFetch(() => json(NOTHING));
    expect(await searchAddress('440A Clementi Ave 3')).toMatchObject({ status: 'unavailable', service: 'onemap', reason: 'auth' });
  });

  it('sends a configured token, or goes through a proxy', async () => {
    const calls = mockFetch(() => json(CLEMENTI));
    configureOneMap({ token: async () => 'tok-123' });
    await searchAddress('440A Clementi Ave 3');
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('tok-123');
    configureOneMap({ baseUrl: 'https://proxy.example' });
    cacheClear();
    await searchAddress('440A Clementi Ave 3');
    expect(calls[1].url.origin).toBe('https://proxy.example');
    expect(new Headers(calls[1].init?.headers).has('authorization')).toBe(false);
  });

  it('fails soft when the network is blocked, as in the single-file preview', async () => {
    mockFetch(blocked);
    expect(await searchAddress('440A Clementi Ave 3')).toMatchObject({ status: 'unavailable', service: 'onemap', reason: 'network' });
  });

  it('stops when a newer keystroke aborts it', async () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const ctl = new AbortController();
    const pending = searchAddress('440A Clementi', { signal: ctl.signal });
    ctl.abort();
    expect(await pending).toEqual({ status: 'aborted' });
  });
});
