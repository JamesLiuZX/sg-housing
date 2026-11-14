/**
 * Block facts from data.gov.sg: HDB Property Information (storeys, year
 * completed, unit mix) and resale transactions since January 2017. Only the
 * block number and street name leave the device.
 *
 * data.gov.sg allows four datastore searches per ten seconds without a key,
 * so requests are paced on the device, retried politely on 429, cached in
 * memory and in localStorage, and shared when two callers ask the same thing
 * at once. data.gov.sg asks that API keys stay out of client code, so the way
 * to higher limits is a proxy that holds the key: `configureDataGov({ baseUrl })`.
 */

import { cacheGet, cachePut } from './cache';
import { createLimiter, getJson, untilAborted, type Limiter } from './http';
import { hdbBlock, hdbStreet, streetKey } from './street';
import type { BlockFacts, DataSource, FlatType, LayoutSeen, Resale, ResaleSummary, Result, UnitCount } from './types';

export const PROPERTY_RESOURCE = 'd_17f5382f26140b1fdae0ba2ef6239d2f';
export const RESALE_RESOURCE = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';

export const PROPERTY_SOURCE: DataSource = Object.freeze({
  name: 'HDB Property Information',
  url: `https://data.gov.sg/datasets/${PROPERTY_RESOURCE}/view`
});
export const RESALE_SOURCE: DataSource = Object.freeze({
  name: 'Resale flat prices based on registration date from Jan-2017 onwards',
  url: `https://data.gov.sg/datasets/${RESALE_RESOURCE}/view`
});

export interface DataGovConfig {
  /** Replaces https://data.gov.sg, e.g. with a proxy that adds an API key. */
  baseUrl?: string | null;
  /** Sent as x-api-key. For development; data.gov.sg asks that keys not ship in client code. */
  apiKey?: string | null;
  /** Datastore searches to allow per ten seconds. Default 4, data.gov.sg's limit without a key. */
  ratePer10s?: number;
}

const DEFAULT_BASE = 'https://data.gov.sg';
let config: DataGovConfig = {};
let limiter: Limiter = createLimiter(4, 10000);

export function configureDataGov(next: DataGovConfig): void {
  config = { ...next };
  limiter = createLimiter(Math.max(1, next.ratePer10s ?? 4), 10000);
}

const DAY = 24 * 3600 * 1000;
/** Property Information changes when a block is completed or redeveloped; data.gov.sg refreshes it monthly. */
const FACTS_TTL_MS = 7 * DAY;
/** Resale data is refreshed daily as transactions register. */
const RESALES_TTL_MS = DAY;
/** "No such block" is kept briefly and in memory only, so a typo does not stick. */
const MISS_TTL_MS = 10 * 60 * 1000;
/** Enough for every resale any block has had since 2017 (the busiest has under 200). */
const RESALE_LIMIT = 500;
const RECENT = 30;

type Datastore = { ok: true; records: Record<string, unknown>[]; total: number } | { ok: false; result: Extract<Result<never>, { status: 'unavailable' | 'aborted' }> };

async function datastore(resource: string, params: Record<string, string>, signal?: AbortSignal): Promise<Datastore> {
  const q = new URLSearchParams({ resource_id: resource, ...params });
  const headers: Record<string, string> = config.apiKey ? { 'x-api-key': config.apiKey } : {};
  const r = await getJson(`${config.baseUrl ?? DEFAULT_BASE}/api/action/datastore_search?${q}`, { service: 'datagov', signal, headers, limiter });
  if (!r.ok) return { ok: false, result: r.result };
  const body = r.body as { success?: unknown; result?: { records?: unknown; total?: unknown } } | null;
  const records = body?.result?.records;
  if (body?.success !== true || !Array.isArray(records)) {
    return { ok: false, result: { status: 'unavailable', service: 'datagov', reason: 'bad-response', detail: 'unexpected datastore answer' } };
  }
  const rows = records.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
  const total = typeof body.result?.total === 'number' ? body.result.total : rows.length;
  return { ok: true, records: rows, total };
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const int = (v: unknown): number => {
  const n = Number.parseInt(text(v), 10);
  return Number.isFinite(n) ? n : 0;
};
const num = (v: unknown): number => {
  const n = Number.parseFloat(text(v));
  return Number.isFinite(n) ? n : 0;
};

/** Property Information's unit columns, as flat types. */
const UNIT_COLUMNS: [FlatType, string | null, string | null][] = [
  ['1 ROOM', '1room_sold', '1room_rental'],
  ['2 ROOM', '2room_sold', '2room_rental'],
  ['3 ROOM', '3room_sold', '3room_rental'],
  ['4 ROOM', '4room_sold', null],
  ['5 ROOM', '5room_sold', null],
  ['EXECUTIVE', 'exec_sold', null],
  ['MULTI-GENERATION', 'multigen_sold', null],
  ['STUDIO', 'studio_apartment_sold', null],
  ['OTHER', null, 'other_room_rental']
];

/** One Property Information record to facts. Exported for tests. */
export function toFacts(r: Record<string, unknown>): BlockFacts {
  const units: UnitCount[] = [];
  for (const [type, soldCol, rentalCol] of UNIT_COLUMNS) {
    const sold = soldCol ? int(r[soldCol]) : 0;
    const rental = rentalCol ? int(r[rentalCol]) : 0;
    if (sold || rental) units.push({ type, sold, rental });
  }
  return {
    blk: text(r.blk_no).toUpperCase(),
    street: text(r.street).toUpperCase(),
    storeys: int(r.max_floor_lvl),
    yearCompleted: int(r.year_completed),
    dwellingUnits: int(r.total_dwelling_units),
    units,
    residential: text(r.residential).toUpperCase() === 'Y',
    source: PROPERTY_SOURCE
  };
}

const inflight = new Map<string, Promise<Result<unknown>>>();

/**
 * Runs `work` once per key at a time, without any caller's signal, so one
 * caller giving up does not cancel the answer another is waiting for. The
 * answer still lands in the cache.
 */
function shared<T>(key: string, work: () => Promise<Result<T>>, signal?: AbortSignal): Promise<Result<T>> {
  let p = inflight.get(key) as Promise<Result<T>> | undefined;
  if (!p) {
    p = work().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return untilAborted(p, signal).then((r) => r ?? { status: 'aborted' });
}

function fromCache<T>(key: string): Result<T> | null {
  const c = cacheGet<T | null>(key);
  if (!c) return null;
  return c.data === null ? { status: 'not-found' } : { status: 'ok', data: c.data, fetchedAt: c.fetchedAt };
}

/**
 * The block's row in HDB Property Information.
 *
 * Tries the street in HDB's spelling first; if that misses, asks for every
 * block with this number and picks the one whose street matches loosely, so
 * an abbreviation this module does not know yet still finds the block.
 * `ok` carries the street exactly as HDB spells it.
 */
export function blockFacts(blk: string, street: string, options: { signal?: AbortSignal } = {}): Promise<Result<BlockFacts>> {
  const b = hdbBlock(blk);
  const s = hdbStreet(street);
  if (!b || !s) return Promise.resolve({ status: 'not-found' });
  const key = `facts:${b}|${s}`;
  const hit = fromCache<BlockFacts>(key);
  if (hit) return Promise.resolve(hit);

  return shared<BlockFacts>(
    key,
    async () => {
      const exact = await datastore(PROPERTY_RESOURCE, { filters: JSON.stringify({ blk_no: b, street: s }), limit: '5' });
      if (!exact.ok) return exact.result;
      let row: Record<string, unknown> | undefined = exact.records[0];
      if (!row) {
        const loose = await datastore(PROPERTY_RESOURCE, { filters: JSON.stringify({ blk_no: b }), limit: '100' });
        if (!loose.ok) return loose.result;
        const want = streetKey(s);
        row = loose.records.find((r) => streetKey(text(r.street)) === want);
      }
      if (!row) {
        cachePut(key, null, MISS_TTL_MS, false);
        return { status: 'not-found' };
      }
      const facts = toFacts(row);
      cachePut(key, facts, FACTS_TTL_MS, true);
      return { status: 'ok', data: facts, fetchedAt: Date.now() };
    },
    options.signal
  );
}

/** One resale record, or null if it is missing what makes it a transaction. Exported for tests. */
export function toResale(r: Record<string, unknown>): Resale | null {
  const month = text(r.month);
  const flatType = text(r.flat_type).toUpperCase();
  if (!/^\d{4}-\d{2}$/.test(month) || !flatType) return null;
  return {
    month,
    flatType,
    flatModel: text(r.flat_model),
    storeyRange: text(r.storey_range),
    floorArea: num(r.floor_area_sqm),
    leaseStart: int(r.lease_commence_date),
    remainingLease: text(r.remaining_lease),
    price: num(r.resale_price)
  };
}

/**
 * The block's resale records summarised for choosing a layout: which flat
 * types and models have sold, at which floor areas, and when the lease began.
 * Pure; exported for tests.
 */
export function summariseResales(blk: string, street: string, records: Record<string, unknown>[], total = records.length): ResaleSummary {
  const sales = records.map(toResale).filter((x): x is Resale => x !== null);
  // Newest first, whatever order they came in.
  sales.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  const groups = new Map<string, LayoutSeen>();
  const leases = new Map<number, number>();
  for (const s of sales) {
    const k = `${s.flatType}|${s.flatModel}`;
    const g = groups.get(k) ?? { flatType: s.flatType, flatModel: s.flatModel, floorAreas: [], count: 0 };
    g.count++;
    if (s.floorArea > 0 && !g.floorAreas.includes(s.floorArea)) g.floorAreas.push(s.floorArea);
    groups.set(k, g);
    if (s.leaseStart) leases.set(s.leaseStart, (leases.get(s.leaseStart) ?? 0) + 1);
  }
  const layouts = [...groups.values()]
    .map((g) => ({ ...g, floorAreas: g.floorAreas.sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count || a.flatType.localeCompare(b.flatType) || a.flatModel.localeCompare(b.flatModel));
  let leaseStart: number | null = null;
  let most = 0;
  for (const [year, n] of leases) if (n > most || (n === most && leaseStart !== null && year < leaseStart)) [leaseStart, most] = [year, n];
  const town = records.length ? text(records[0].town).toUpperCase() : '';
  return { blk, street, town, total: Math.max(total, sales.length), recent: sales.slice(0, RECENT), layouts, leaseStart, source: RESALE_SOURCE };
}

const RESALE_FIELDS = 'month,town,flat_type,block,street_name,storey_range,floor_area_sqm,flat_model,lease_commence_date,remaining_lease,resale_price';

function resaleQuery(b: string, s: string) {
  return datastore(RESALE_RESOURCE, {
    filters: JSON.stringify({ block: b, street_name: s }),
    sort: 'month desc',
    limit: String(RESALE_LIMIT),
    fields: RESALE_FIELDS
  });
}

/**
 * The block's resale transactions since January 2017, newest first, with the
 * summary the interface uses to pick a template.
 *
 * - `ok` with `total: 0`: the block exists but has not been resold (too new, or rental only).
 * - `not-found`: there is no such block in HDB's data.
 */
export function blockResales(blk: string, street: string, options: { signal?: AbortSignal } = {}): Promise<Result<ResaleSummary>> {
  const b = hdbBlock(blk);
  const s = hdbStreet(street);
  if (!b || !s) return Promise.resolve({ status: 'not-found' });
  const key = `resales:${b}|${s}`;
  const hit = fromCache<ResaleSummary>(key);
  if (hit) return Promise.resolve(hit);

  return shared<ResaleSummary>(
    key,
    async () => {
      const first = await resaleQuery(b, s);
      if (!first.ok) return first.result;
      let summary: ResaleSummary | null = first.records.length ? summariseResales(b, s, first.records, first.total) : null;
      if (!summary) {
        // No sales under this spelling: either none at all, or HDB spells the street another way.
        // Property Information settles which, and gives HDB's spelling.
        const facts = await blockFacts(b, s);
        if (facts.status !== 'ok') {
          if (facts.status === 'not-found') cachePut(key, null, MISS_TTL_MS, false);
          return facts;
        }
        if (facts.data.street !== s) {
          const again = await resaleQuery(b, facts.data.street);
          if (!again.ok) return again.result;
          summary = summariseResales(b, facts.data.street, again.records, again.total);
        } else {
          summary = summariseResales(b, s, []);
        }
      }
      cachePut(key, summary, RESALES_TTL_MS, true);
      return { status: 'ok', data: summary, fetchedAt: Date.now() };
    },
    options.signal
  );
}
