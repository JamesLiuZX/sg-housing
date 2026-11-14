/**
 * Address search through OneMap, the Singapore Land Authority's map service.
 * Only the cleaned address query leaves the device.
 *
 * OneMap answers search without a token today, with a notice asking for one
 * on every answer, and its documentation shows the tokenless answer becoming
 * empty. An empty answer with that notice is therefore ambiguous: no such
 * place, or OneMap refusing. One probe settles it (OneMap's own documented
 * example query, cached for the visit), so a typo reads as "not found" today
 * and a refusal will read as "unavailable" when it comes. Tokens last three
 * days, so the likely future is a small proxy that holds one;
 * `configureOneMap` takes either, and callers of `searchAddress` do not change.
 */

import { cacheGet, cachePut } from './cache';
import { getJson, unavailable, untilAborted } from './http';
import type { AddressHit, SearchHits, SearchResult } from './types';

export interface OneMapConfig {
  /** Replaces https://www.onemap.gov.sg, e.g. with a proxy that adds the token itself. */
  baseUrl?: string | null;
  /** A OneMap API token, or a function returning a current one. Sent as the Authorization header, as OneMap documents. */
  token?: string | null | (() => string | null | Promise<string | null>);
}

const DEFAULT_BASE = 'https://www.onemap.gov.sg';
let config: OneMapConfig = {};

export function configureOneMap(next: OneMapConfig): void {
  config = { ...next };
  // A new token or proxy may answer differently; ask again.
  probe = null;
}

/** Results are kept in memory only: what someone types in passing should not outlive the visit. */
const SEARCH_TTL_MS = 10 * 60 * 1000;

/**
 * The part of what someone typed that OneMap can search: a six-digit postal
 * code alone if there is one, otherwise the address without "Blk", unit
 * numbers or "Singapore". OneMap finds nothing for "blk 440a clementi ave 3"
 * or "440A Clementi Ave 3 #12-34", but finds both once cleaned. Returns null
 * when nothing searchable is left.
 */
export function cleanQuery(raw: string): string | null {
  let s = raw
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .slice(0, 200);
  // A postal code is the most precise thing anyone can type; use it alone.
  const postal = /(?:^|\D)(\d{6})(?!\d)/.exec(s);
  if (postal) return postal[1];
  s = s
    .replace(/#\s*[A-Z]?\d{1,3}\s*-\s*[A-Z]?\d{1,5}[A-Z]?/g, ' ')
    .replace(/\bUNIT\s+[A-Z]?\d{1,3}\s*-\s*\d{1,5}[A-Z]?/g, ' ')
    .replace(/[^A-Z0-9'.\- ]+/g, ' ')
    .replace(/\bBLK(?=\d)/g, '');
  let ws = s
    .split(' ')
    .map((w) => w.replace(/^[.'-]+/, '').replace(/[-']+$/, ''))
    .filter((w) => w && !/^(?:BLK\.?|BLOCK|BK|SINGAPORE|S'PORE|SPORE|SG|S)$/.test(w) && /[A-Z0-9]/.test(w));
  // "440 A CLEMENTI ..." is block 440A.
  if (ws.length >= 3 && /^\d{1,4}$/.test(ws[0]) && /^[A-Z]$/.test(ws[1])) ws = [ws[0] + ws[1], ...ws.slice(2)];
  const q = ws.join(' ').slice(0, 100).trim();
  return (q.match(/[A-Z0-9]/g)?.length ?? 0) >= 2 ? q : null;
}

interface OneMapRaw {
  error?: unknown;
  found?: unknown;
  results?: unknown;
}

const nil = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === 'NIL' ? '' : s;
};

/** One OneMap result to a hit, or null if it lacks a usable position. */
export function toHit(r: unknown): AddressHit | null {
  if (typeof r !== 'object' || r === null) return null;
  const o = r as Record<string, unknown>;
  const lat = Number(o.LATITUDE);
  const lng = Number(o.LONGITUDE);
  // Singapore's bounding box, generously: anything outside is not a usable answer.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 1 || lat > 1.6 || lng < 103.5 || lng > 104.2) return null;
  const postal = nil(o.POSTAL);
  return {
    blk: nil(o.BLK_NO).toUpperCase(),
    road: nil(o.ROAD_NAME).toUpperCase(),
    building: nil(o.BUILDING),
    postal: /^\d{6}$/.test(postal) ? postal : '',
    lat,
    lng,
    address: nil(o.ADDRESS)
  };
}

/**
 * What a OneMap search body says. `refused` is an empty answer carrying an
 * error that mentions a token: OneMap turning us away, or (today, when the
 * notice rides on every answer) simply nothing found.
 */
export type Parsed =
  | { kind: 'hits'; data: SearchHits }
  | { kind: 'none' }
  | { kind: 'refused'; message: string }
  | { kind: 'bad'; detail: string };

/** Parses a OneMap search body. Exported for tests. */
export function parseSearch(body: unknown, query: string): Parsed {
  if (typeof body !== 'object' || body === null) return { kind: 'bad', detail: 'not an object' };
  const raw = body as OneMapRaw;
  if (!Array.isArray(raw.results)) return { kind: 'bad', detail: 'no results array' };
  if (raw.results.length === 0) {
    if (raw.error === undefined || raw.error === null || raw.error === '') return { kind: 'none' };
    const message = String(raw.error);
    return /token|auth/i.test(message) ? { kind: 'refused', message } : { kind: 'bad', detail: message };
  }
  const seen = new Set<string>();
  const hits: AddressHit[] = [];
  for (const r of raw.results) {
    const h = toHit(r);
    if (!h) continue;
    // OneMap lists a block once per building name inside it ("CLEMENTI CASCADIA", a care centre in the void deck, ...).
    const key = h.postal ? `${h.postal}|${h.blk}|${h.road}` : `${h.address}|${h.lat}|${h.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(h);
  }
  if (!hits.length) return { kind: 'bad', detail: 'no usable results' };
  const found = typeof raw.found === 'number' ? raw.found : hits.length;
  return { kind: 'hits', data: { query, hits, total: Math.max(found, hits.length) } };
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = typeof config.token === 'function' ? await config.token() : config.token;
    return token ? { Authorization: token } : {};
  } catch {
    // A token source that fails is the same as no token; OneMap may still answer.
    return {};
  }
}

function searchUrl(q: string, page: number): string {
  const params = new URLSearchParams({ searchVal: q, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: String(page) });
  return `${config.baseUrl ?? DEFAULT_BASE}/api/common/elastic/search?${params}`;
}

/** OneMap's own documentation example (640 Rowell Road): if this finds nothing, OneMap is refusing, not missing. */
const PROBE_QUERY = '200640';
const PROBE_TTL_MS = 30 * 60 * 1000;
let probe: { at: number; answers: Promise<boolean | null> } | null = null;

/** Does OneMap answer searches as currently configured? true, false, or null when it could not be asked. */
function oneMapAnswers(): Promise<boolean | null> {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.answers;
  const answers = authHeaders()
    .then((headers) => getJson(searchUrl(PROBE_QUERY, 1), { service: 'onemap', headers, retries: 1 }))
    .then((r) => (r.ok ? parseSearch(r.body, PROBE_QUERY).kind === 'hits' : null));
  probe = { at: Date.now(), answers };
  void answers.then((v) => {
    if (v === null) probe = null;
  });
  return answers;
}

/**
 * Searches OneMap for an address, postal code or place name.
 *
 * - `ok`: one or more places, best match first.
 * - `not-found`: OneMap answered and matched nothing.
 * - `empty`: nothing searchable was typed, so nothing was sent.
 * - `unavailable`: no answer (offline, preview build, OneMap down or asking for a token).
 * - `aborted`: `signal` fired; a newer query has probably replaced this one.
 *
 * Fine to call on every keystroke behind a short debounce: pass the previous
 * call's AbortController signal so stale requests are cancelled.
 */
export async function searchAddress(query: string, options: { signal?: AbortSignal; page?: number } = {}): Promise<SearchResult> {
  const { signal, page = 1 } = options;
  const q = cleanQuery(query);
  if (!q) return { status: 'empty' };
  if (signal?.aborted) return { status: 'aborted' };

  const key = `onemap:${page}:${q}`;
  const cached = cacheGet<SearchHits | null>(key);
  if (cached) return cached.data ? { status: 'ok', data: cached.data, fetchedAt: cached.fetchedAt } : { status: 'not-found' };

  const r = await getJson(searchUrl(q, page), { service: 'onemap', signal, headers: await authHeaders(), retries: 1 });
  if (!r.ok) return r.result;
  const parsed = parseSearch(r.body, q);
  switch (parsed.kind) {
    case 'hits':
      cachePut<SearchHits | null>(key, parsed.data, SEARCH_TTL_MS, false);
      return { status: 'ok', data: parsed.data, fetchedAt: Date.now() };
    case 'none':
      cachePut<SearchHits | null>(key, null, SEARCH_TTL_MS, false);
      return { status: 'not-found' };
    case 'bad':
      return unavailable('onemap', 'bad-response', parsed.detail);
    case 'refused': {
      const answers = await untilAborted(oneMapAnswers(), signal);
      if (signal?.aborted) return { status: 'aborted' };
      if (answers === true) {
        cachePut<SearchHits | null>(key, null, SEARCH_TTL_MS, false);
        return { status: 'not-found' };
      }
      return answers === false ? unavailable('onemap', 'auth', parsed.message) : unavailable('onemap', 'network', 'could not check whether OneMap is answering');
    }
  }
}
