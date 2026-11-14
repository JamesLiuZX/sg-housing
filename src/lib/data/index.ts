/**
 * Blk's data layer: from a typed address to a block's footprint, facades,
 * facts and resale history, using open government data only.
 *
 *   const found = await searchAddress('440A Clementi Ave 3', { signal });
 *   if (found.status === 'ok') {
 *     const { block, facts, resales } = await lookupBlock(found.data.hits[0]);
 *     if (block.status === 'ok') facades(block.data.footprint);   // sides to tap
 *   }
 *
 * Every async function resolves to a `Result` (ok, not-found, unavailable,
 * aborted) and never rejects, including offline and in the single-file
 * preview, where every request fails as `unavailable` with reason `network`.
 */

export type * from './types';

export { searchAddress, configureOneMap, cleanQuery, type OneMapConfig } from './onemap';
export { loadBlock, loadBlockIndexInfo, configureBlocks, cleanPostal, toBlockFrame, type LoadBlockOptions } from './blocks';
export { facades, facadeFacing, bearingOf, outwardBearing, bearingDiff, type FacadeOptions } from './facades';
export {
  blockFacts,
  blockResales,
  configureDataGov,
  PROPERTY_SOURCE,
  RESALE_SOURCE,
  type DataGovConfig
} from './datagov';
export { lookupBlock } from './lookup';
export { lookupDemo, demoHit, isDemoHit, DEMO_POSTAL, DEMO_TAKEN, type DemoLookup } from './demo';
export { hdbStreet, streetKey, hdbBlock } from './street';
export { cacheClear as clearDataCache } from './cache';
export type { Manifest, ManifestSector } from './shard';
