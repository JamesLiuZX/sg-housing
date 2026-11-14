/**
 * A small two-level cache for answers from OneMap and data.gov.sg: memory for
 * this visit, and optionally the device's localStorage so a block looked up
 * yesterday opens instantly today without spending the public rate limit.
 *
 * localStorage can be missing, full, or throw on any access (private
 * browsing, sandboxed previews, storage disabled), so every touch is wrapped
 * and the cache quietly becomes memory-only. Entries carry a format version
 * and an expiry; anything stale, foreign or unreadable is treated as absent
 * and removed.
 */

/** Bump when the shape of anything cached changes, so old entries are ignored. */
export const CACHE_VERSION = 1;
const PREFIX = 'blk:data:';
const MEMORY_LIMIT = 300;

interface Entry {
  v: number;
  /** When the data was fetched, ms. */
  t: number;
  /** When it stops being used, ms. */
  e: number;
  d: unknown;
}

export interface Cached<T> {
  data: T;
  fetchedAt: number;
}

const memory = new Map<string, Entry>();

/** Minimal Storage surface, so tests can pass a fake or a throwing one. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

let storageOverride: StorageLike | null | undefined;

/** Tests: use this storage instead of the browser's; null means none. Pass undefined to restore. */
export function setCacheStorage(storage: StorageLike | null | undefined): void {
  storageOverride = storage;
}

function storage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Merely reading `localStorage` throws when storage is blocked.
    return null;
  }
}

function fresh(e: Entry | null | undefined, now: number): e is Entry {
  return !!e && e.v === CACHE_VERSION && typeof e.e === 'number' && e.e > now && typeof e.t === 'number';
}

function remember(key: string, e: Entry): void {
  memory.delete(key);
  memory.set(key, e);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
}

export function cacheGet<T>(key: string, now = Date.now()): Cached<T> | null {
  const m = memory.get(key);
  if (fresh(m, now)) {
    remember(key, m);
    return { data: m.d as T, fetchedAt: m.t };
  }
  if (m) memory.delete(key);

  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (raw === null) return null;
    const e = JSON.parse(raw) as Entry;
    if (!fresh(e, now)) {
      s.removeItem(PREFIX + key);
      return null;
    }
    remember(key, e);
    return { data: e.d as T, fetchedAt: e.t };
  } catch {
    try {
      s.removeItem(PREFIX + key);
    } catch {
      /* storage gone; nothing to tidy */
    }
    return null;
  }
}

/**
 * Stores `data` for `ttlMs`. With `persist`, also on the device; otherwise for
 * this visit only (search results, "not found" answers: nothing the person
 * typed in passing should outlive the visit).
 */
export function cachePut<T>(key: string, data: T, ttlMs: number, persist: boolean, now = Date.now(), fetchedAt = now): void {
  const e: Entry = { v: CACHE_VERSION, t: fetchedAt, e: now + ttlMs, d: data };
  remember(key, e);
  if (!persist) return;
  const s = storage();
  if (!s) return;
  const body = JSON.stringify(e);
  try {
    s.setItem(PREFIX + key, body);
  } catch {
    // Probably full: clear out our own stale entries and try once more.
    try {
      pruneStorage(s, now);
      s.setItem(PREFIX + key, body);
    } catch {
      /* the memory copy will do */
    }
  }
}

function ourKeys(s: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

function pruneStorage(s: StorageLike, now: number): void {
  for (const k of ourKeys(s)) {
    try {
      const e = JSON.parse(s.getItem(k) ?? 'null') as Entry | null;
      if (!fresh(e, now)) s.removeItem(k);
    } catch {
      s.removeItem(k);
    }
  }
}

/** Forgets everything this module stored, in memory and on the device. */
export function cacheClear(): void {
  memory.clear();
  const s = storage();
  if (!s) return;
  try {
    for (const k of ourKeys(s)) s.removeItem(k);
  } catch {
    /* nothing more to do */
  }
}
