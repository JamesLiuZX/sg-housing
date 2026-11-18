/**
 * How tall the blocks round a block are, so the shadows they throw across the
 * block stage are true. The block index has footprints only. HDB Property
 * Information has storeys, but it is keyed by block number and street, and
 * the index knows a neighbour by its number and postal code; OneMap turns
 * the postal code into the street.
 *
 *   const now = knownNeighbourHeights(block);           // at once, no network
 *   viewer.showBlock({ block, storeys, label, neighbourStoreys: now.storeys });
 *   void lookupNeighbourHeights(block, { signal, onProgress: (h) => rebuild(h.storeys) });
 *
 * What is known costs nothing: the bundled snapshot holds the demo block's
 * neighbours, and every answer is kept on the device for a week. The rest is
 * asked for once the block is on screen, nearest neighbour first and no
 * further than the eighth: a OneMap search per neighbour, one every half
 * second, then one data.gov.sg search for each four neighbours, paced with
 * every other data.gov.sg request. Nothing here rejects; a neighbour with no
 * answer keeps the engine's typical height.
 */

import { cacheGet, cachePut } from './cache';
import { blockHeights, type BlockRef } from './datagov';
import { snapshotHeights } from './demo';
import { addressOfPostal } from './onemap';
import type { Block, BlockHeight, Neighbour, NeighbourHeights } from './types';

/** Neighbours asked about, nearest first: the near ones throw the shadows that matter, and each costs a OneMap search. */
const LIMIT = 8;
/** Neighbours per data.gov.sg search: the nearest heights arrive while the farther streets are still being found. */
const WAVE = 4;
/** Heights change only when a block is built or rebuilt; Property Information is refreshed monthly. */
const HEIGHT_TTL_MS = 7 * 24 * 3600 * 1000;
/** "No answer" is kept briefly and in memory only, as for block facts. */
const MISS_TTL_MS = 10 * 60 * 1000;

const cacheKey = (postal: string): string => `height:${postal}`;

export interface NeighbourLookupOptions {
  signal?: AbortSignal;
  /** How many of the nearest neighbours to ask about. Default 8. Heights already known for farther ones are kept. */
  limit?: number;
  /**
   * Called each time new heights arrive, with everything known so far, so the
   * model can be rebuilt. Never called once `signal` has fired.
   */
  onProgress?: (heights: NeighbourHeights) => void;
}

/**
 * A height known without asking: from an earlier lookup on this device, or
 * from the bundled snapshot. Null when it is known that there is no answer,
 * undefined when nothing is known.
 */
function known(postal: string): Readonly<BlockHeight> | null | undefined {
  const c = cacheGet<BlockHeight | null>(cacheKey(postal));
  return c ? c.data : snapshotHeights().get(postal);
}

/** What is known, in the block's own nearest-first order, as fresh objects the caller may keep. */
function summarise(block: Block, found: ReadonlyMap<string, Readonly<BlockHeight>>, missing: ReadonlySet<string>): NeighbourHeights {
  const out: NeighbourHeights = { storeys: {}, found: [], missing: [] };
  for (const n of block.neighbours) {
    const h = found.get(n.postal);
    if (h) {
      out.storeys[n.postal] = h.storeys;
      out.found.push({ ...h });
    } else if (missing.has(n.postal)) {
      out.missing.push(n.postal);
    }
  }
  return out;
}

/**
 * The heights known for a block's neighbours without asking anyone: what to
 * build the site with on the first frame. For the demo block, all of them.
 */
export function knownNeighbourHeights(block: Block): NeighbourHeights {
  const found = new Map<string, Readonly<BlockHeight>>();
  const missing = new Set<string>();
  for (const n of block.neighbours) {
    const h = known(n.postal);
    if (h) found.set(n.postal, h);
    else if (h === null) missing.add(n.postal);
  }
  return summarise(block, found, missing);
}

/**
 * Asks for the heights of the block's nearest neighbours that are not known
 * yet, reporting each batch as it lands, and resolves with everything known
 * once the answers are in or `signal` fires. Never rejects: a neighbour that
 * neither service can place is listed in `missing` and keeps the engine's
 * typical height.
 */
export async function lookupNeighbourHeights(block: Block, options: NeighbourLookupOptions = {}): Promise<NeighbourHeights> {
  const { signal, onProgress } = options;
  const limit = Math.max(0, Math.floor(options.limit ?? LIMIT));
  const found = new Map<string, Readonly<BlockHeight>>();
  const missing = new Set<string>();
  const ask: Neighbour[] = [];
  block.neighbours.forEach((n, i) => {
    const h = known(n.postal);
    if (h) found.set(n.postal, h);
    else if (h === null) missing.add(n.postal);
    else if (i < limit) ask.push(n);
  });

  const settle = (postal: string, status: 'not-found' | 'unavailable' | 'aborted'): void => {
    if (status === 'aborted') return;
    missing.add(postal);
    // A service that answered "nothing there" is not asked again this visit; one that did not answer is, next time.
    if (status === 'not-found') cachePut<BlockHeight | null>(cacheKey(postal), null, MISS_TTL_MS, false);
  };
  const report = (): void => {
    if (signal?.aborted || !onProgress) return;
    try {
      onProgress(summarise(block, found, missing));
    } catch (err) {
      // The caller's own mistake: shown, but it neither stops the lookup nor rejects it.
      console.error(err);
    }
  };

  try {
    // Every street is asked for at once and OneMap's pacing serves them nearest
    // first, so the next wave's streets are found while this wave's heights are fetched.
    const places = ask.map((n) => addressOfPostal(n.postal, { signal }));
    for (let i = 0; i < ask.length && !signal?.aborted; i += WAVE) {
      const wave = ask.slice(i, i + WAVE);
      const hits = await Promise.all(places.slice(i, i + WAVE));
      const refs: BlockRef[] = [];
      wave.forEach((n, k) => {
        const hit = hits[k];
        if (hit.status === 'ok') refs.push({ postal: n.postal, blk: n.blk || hit.data.blk, street: hit.data.road });
        else settle(n.postal, hit.status);
      });
      if (!refs.length) continue;
      const answers = await blockHeights(refs, { signal });
      let arrived = false;
      answers.forEach((a, k) => {
        const { postal } = refs[k];
        if (a.status !== 'ok') return settle(postal, a.status);
        found.set(postal, a.data);
        cachePut(cacheKey(postal), a.data, HEIGHT_TTL_MS, true);
        arrived = true;
      });
      if (arrived) report();
    }
  } catch (err) {
    // Both services' failures come back as results, so this is a bug: shown, and what is known still returned.
    console.error(err);
  }
  return summarise(block, found, missing);
}
