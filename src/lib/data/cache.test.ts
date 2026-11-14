import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CACHE_VERSION, cacheClear, cacheGet, cachePut, setCacheStorage, type StorageLike } from './cache';

/** An in-memory stand-in for localStorage, optionally refusing writes the way a full one does. */
function fakeStorage(opts: { full?: () => boolean } = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.full?.()) throw new DOMException('full', 'QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k)
  };
}

const throwing: StorageLike = {
  get length(): number {
    throw new Error('blocked');
  },
  key: () => {
    throw new Error('blocked');
  },
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  }
};

let store = fakeStorage();

beforeEach(() => {
  store = fakeStorage();
  setCacheStorage(store);
  cacheClear();
});

afterEach(() => setCacheStorage(undefined));

describe('cache', () => {
  it('serves an entry until it expires, then forgets it everywhere', () => {
    cachePut('facts:440A', { storeys: 30 }, 1000, true, 0);
    expect(cacheGet('facts:440A', 999)).toEqual({ data: { storeys: 30 }, fetchedAt: 0 });
    expect(cacheGet('facts:440A', 1000)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('survives a reload through storage', () => {
    cachePut('facts:440A', { storeys: 30 }, 1000, true, 0);
    const saved = new Map(store.map);
    cacheClear();
    for (const [k, v] of saved) store.map.set(k, v);
    expect(cacheGet('facts:440A', 10)).toEqual({ data: { storeys: 30 }, fetchedAt: 0 });
  });

  it('keeps passing answers in memory only', () => {
    cachePut('onemap:1:440A CLEMENTI', ['hit'], 1000, false, 0);
    expect(cacheGet('onemap:1:440A CLEMENTI', 1)).not.toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('ignores entries from another version of the format, and garbage', () => {
    store.map.set('blk:data:old', JSON.stringify({ v: CACHE_VERSION + 1, t: 0, e: Infinity, d: 1 }));
    store.map.set('blk:data:junk', '{not json');
    expect(cacheGet('old', 0)).toBeNull();
    expect(cacheGet('junk', 0)).toBeNull();
    expect(store.map.has('blk:data:old')).toBe(false);
    expect(store.map.has('blk:data:junk')).toBe(false);
  });

  it('makes room by clearing its own stale entries when storage is full', () => {
    let full = false;
    store = fakeStorage({ full: () => full });
    setCacheStorage(store);
    cachePut('stale', 1, 10, true, 0);
    store.map.set('someone-else', 'keep me');
    // Full until the stale entry has gone.
    full = true;
    const realRemove = store.removeItem;
    store.removeItem = (k) => {
      realRemove(k);
      full = false;
    };
    cachePut('fresh', 2, 1000, true, 100);
    expect(store.map.has('blk:data:stale')).toBe(false);
    expect(store.map.has('blk:data:fresh')).toBe(true);
    expect(store.map.get('someone-else')).toBe('keep me');
  });

  it('carries on in memory when storage throws on every touch', () => {
    setCacheStorage(throwing);
    expect(() => cachePut('k', 1, 1000, true, 0)).not.toThrow();
    expect(cacheGet('k', 1)).toEqual({ data: 1, fetchedAt: 0 });
    expect(() => cacheClear()).not.toThrow();
  });

  it('clears only what it stored', () => {
    store.map.set('theme', 'dark');
    cachePut('a', 1, 1000, true);
    cacheClear();
    expect([...store.map.keys()]).toEqual(['theme']);
  });
});
