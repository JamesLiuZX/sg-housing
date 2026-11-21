/**
 * OneMap's base map, for the ground under the block: Web Mercator tile maths
 * and a small, polite tile loader.
 *
 * OneMap serves its maps as XYZ tiles in EPSG:3857, 256 pixels square, at
 * https://www.onemap.gov.sg/maps/tiles/{style}/{z}/{x}/{y}.png, with
 * `Access-Control-Allow-Origin: *` and no key. Tile x runs east and y south
 * from the north-west corner of the world.
 *
 * Everything here lands in a block's own frame (metres east and north of its
 * centroid) through `toBlockFrame`, the same projection the footprints use,
 * so the map and the model agree. Measured against OneMap's drawn building
 * outlines in the tiles, on seven blocks across Singapore (Clementi,
 * Tampines, Woodlands, Bedok, Pasir Ris, Jurong West, Ang Mo Kio), HDB's
 * footprints placed this way sit within 7 cm of them on six and 19 cm on the
 * seventh, whose two outlines differ a little in shape. Measured again in the
 * scene seen from above, on the first three, they sit within 4 cm, turned by
 * no more than a fifth of a degree.
 *
 * One thing to know about the projection: EPSG:3857 puts WGS84 latitude and
 * longitude on a sphere. On the ground, which is the ellipsoid, a pixel at
 * Singapore's latitude covers 0.67% less distance north to south than east
 * to west (the ratio of the ellipsoid's two radii of curvature). Over a
 * 300 m map that is 2 m, so the two axes are always mapped separately here,
 * never as square pixels.
 */

import { toBlockFrame } from './blocks';
import { DEMO_POSTAL } from './demo';
import { untilAborted } from './http';
import { localFrame } from './shard';
import type { Block, Bounds, XY } from './types';

/** Pixels along a side of one tile. */
export const TILE_PX = 256;

/**
 * The highest zoom each of OneMap's styles serves, as probed on 18 and again
 * on 19 November 2026 at Clementi: one zoom further answers 200 with an empty
 * body.
 * OneMap's TileJSON gives 11 as the lowest. An `_HD` tile at zoom z is drawn
 * with the line weights and lettering of zoom z - 1 at twice the detail,
 * which is how OneMap's TileJSON serves its maps to high-density screens.
 *
 * `Satellite` is the aerial photograph, served from the same address. It is
 * not one of the base maps OneMap publishes for developers: its developer
 * pages (https://www.onemap.gov.sg/docs/maps/), TileJSON and WMTS list
 * Default, Original, Grey, GreyLite, Night and LandLot only, and its API terms
 * ask for use "in accordance to the Agency's published technical and other
 * specifications". So the interface does not offer it; the engine can still
 * draw it (block.html?ground=aerial) for the day SLA says it may be used.
 */
export const MAX_ZOOM = {
  Default: 19,
  Original: 19,
  Grey: 19,
  Night: 19,
  Default_HD: 20,
  Original_HD: 20,
  Grey_HD: 20,
  Night_HD: 20,
  GreyLite: 20,
  LandLot: 20,
  Satellite: 20
} as const;

export type MapStyle = keyof typeof MAX_ZOOM;

const RAD = Math.PI / 180;

/** A tile's address. */
export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** A rectangle of whole tiles at one zoom: columns x0 to x1 - 1, rows y0 to y1 - 1. */
export interface TileRange {
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle of the world at one zoom, in world pixels from its north-west corner: x from px0 to px1, y from py0 to py1. */
export interface PixelRect {
  z: number;
  px0: number;
  py0: number;
  px1: number;
  py1: number;
}

/** Pixels across the whole world at zoom z. */
export function worldPx(z: number): number {
  return TILE_PX * 2 ** z;
}

/** Where a latitude and longitude falls on the world at zoom z, in pixels from its north-west corner. Pixel i spans i to i + 1. */
export function toWorldPixel(lat: number, lng: number, z: number): XY {
  const n = worldPx(z);
  return [((lng + 180) / 360) * n, ((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * n];
}

/** The inverse of `toWorldPixel`: [lat, lng]. */
export function fromWorldPixel(px: number, py: number, z: number): [lat: number, lng: number] {
  const n = worldPx(z);
  return [Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) / RAD, (px / n) * 360 - 180];
}

/** The tile a latitude and longitude falls in. */
export function tileAt(lat: number, lng: number, z: number): TileId {
  const [px, py] = toWorldPixel(lat, lng, z);
  return { z, x: Math.floor(px / TILE_PX), y: Math.floor(py / TILE_PX) };
}

/** The latitude and longitude of a tile's north-west corner. Its south-east corner is the north-west corner of tile (x + 1, y + 1). */
export function tileCorner(x: number, y: number, z: number): [lat: number, lng: number] {
  return fromWorldPixel(x * TILE_PX, y * TILE_PX, z);
}

/**
 * The fewest whole tiles that cover a square `size` metres on a side,
 * centred on a point and lined up with north, measured on the ground.
 */
export function coverSquare(lat: number, lng: number, size: number, z: number): TileRange {
  const f = localFrame(lat, lng);
  const h = size / 2;
  const [north, west] = f.toLatLng(-h, h);
  const [south, east] = f.toLatLng(h, -h);
  const [px0, py0] = toWorldPixel(north, west, z);
  const [px1, py1] = toWorldPixel(south, east, z);
  return { z, x0: Math.floor(px0 / TILE_PX), y0: Math.floor(py0 / TILE_PX), x1: Math.ceil(px1 / TILE_PX), y1: Math.ceil(py1 / TILE_PX) };
}

/** Every tile in a range, row by row from the north-west, with its column and row inside the range. */
export function tilesIn(r: TileRange): (TileId & { col: number; row: number })[] {
  const out: (TileId & { col: number; row: number })[] = [];
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) out.push({ z: r.z, x, y, col: x - r.x0, row: y - r.y0 });
  return out;
}

/** A world pixel at zoom z to the block's frame: metres east and north of its centroid. Exact. */
export function pixelToFrame(block: Pick<Block, 'lat' | 'lng'>, px: number, py: number, z: number): XY {
  const [lat, lng] = fromWorldPixel(px, py, z);
  return toBlockFrame(block, lat, lng);
}

/** A point of the block's frame to the world pixel it falls on at zoom z. Exact. */
export function frameToPixel(block: Pick<Block, 'lat' | 'lng'>, x: number, y: number, z: number): XY {
  const [lat, lng] = localFrame(block.lat, block.lng).toLatLng(x, y);
  return toWorldPixel(lat, lng, z);
}

/** The world pixels a range of tiles covers. */
export function rangeRect(r: TileRange): PixelRect {
  return { z: r.z, px0: r.x0 * TILE_PX, py0: r.y0 * TILE_PX, px1: r.x1 * TILE_PX, py1: r.y1 * TILE_PX };
}

/**
 * The edges of a rectangle of world pixels in the block's frame, metres: what
 * a picture of it spans when it is laid on the ground. East to west the
 * mapping between the picture and the ground is exactly linear; north to
 * south it is linear to within a few millimetres over a few kilometres (see
 * the tests), so a picture laid on this rectangle lands where the map says.
 */
export function rectBounds(block: Pick<Block, 'lat' | 'lng'>, r: PixelRect): Bounds {
  const [minX, maxY] = pixelToFrame(block, r.px0, r.py0, r.z);
  const [maxX, minY] = pixelToFrame(block, r.px1, r.py1, r.z);
  return { minX, minY, maxX, maxY };
}

/** The outer edges of a tile range in the block's frame, metres: what a texture of the range spans on the ground. */
export function rangeBounds(block: Pick<Block, 'lat' | 'lng'>, r: TileRange): Bounds {
  return rectBounds(block, rangeRect(r));
}

// ── Loading ─────────────────────────────────────────────────────────────────

const HOST = 'https://www.onemap.gov.sg/maps/tiles/';

/** The address of one of OneMap's tiles. */
export function tileUrl(style: MapStyle, t: TileId): string {
  return `${HOST}${style}/${t.z}/${t.x}/${t.y}.png`;
}

/** A decoded tile, ready to draw on a canvas. Close it when done with it. */
export interface TileImage {
  image: CanvasImageSource;
  close(): void;
}

/**
 * Tiles fetched this session, by address, as their compressed bytes: a few
 * kilobytes each, so a block seen again, or rebuilt, draws without asking
 * again. A tile OneMap does not have (404, or an empty answer past a style's
 * highest zoom) is kept as null; a request that failed or was cut short is
 * forgotten, so it can be asked again later.
 */
const blobs = new Map<string, Promise<Blob | null>>();
const settled = new Map<string, Blob | null>();

/** No tile ever takes longer than this, so one stalled request cannot hold a slot for good. */
const TIMEOUT_MS = 15000;
/** Requests to OneMap in flight at once, however many maps are loading: what a browser allows one host over HTTP/1.1. */
const MAX_ACTIVE = 6;

let active = 0;
const queue: { start: () => void; signal?: AbortSignal }[] = [];

/** Waits for one of the request slots. False when `signal` fires first; a slot taken must be given back with `release`. */
function slot(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (active < MAX_ACTIVE) {
    active++;
    return Promise.resolve(true);
  }
  return new Promise((done) => {
    const entry = {
      signal,
      start: () => {
        signal?.removeEventListener('abort', stop);
        done(true);
      }
    };
    const stop = (): void => {
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
      done(false);
    };
    signal?.addEventListener('abort', stop, { once: true });
    queue.push(entry);
  });
}

function release(): void {
  const next = queue.shift();
  if (next) next.start();
  else active--;
}

/**
 * A tile's bytes: from this session's store, or fetched once a request slot
 * is free. A request under way is shared and runs to its end even if the
 * caller who started it has gone, so the tile is there for the next one.
 * Resolves null when there is no tile, or `signal` fired before a slot came.
 */
async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  const had = blobs.get(url);
  if (had) return had;
  if (!(await slot(signal))) return null;
  // Someone else may have started it while this caller waited its turn.
  const now = blobs.get(url);
  if (now) {
    release();
    return now;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const p = (async (): Promise<Blob | null> => {
    // CORS without credentials, as crossOrigin="anonymous" asks for an image, so the canvas it is drawn on stays usable by WebGL.
    // No cookies and no referrer: nothing about the person or the page goes with the request.
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  })();
  blobs.set(url, p);
  p.then(
    (b) => settled.set(url, b),
    () => {
      if (blobs.get(url) === p) blobs.delete(url);
    }
  ).finally(() => {
    clearTimeout(timer);
    release();
  });
  return p;
}

async function decode(blob: Blob): Promise<TileImage | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      return { image: bmp, close: () => bmp.close() };
    }
    // Older engines: an image element from an object URL, which is same-origin, so nothing is tainted.
    const src = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    return { image: img, close: () => URL.revokeObjectURL(src) };
  } catch {
    return null;
  }
}

/** True when this tile has already been fetched this session, found or not: drawing it needs no network. */
export function tileKnown(url: string): boolean {
  return settled.has(url);
}

/**
 * One tile, decoded: null when OneMap has none there, the network failed or
 * was blocked, the answer was not an image, or `signal` fired. Never rejects
 * and never logs: a missing tile leaves the paper showing.
 */
export async function loadTile(url: string, signal?: AbortSignal): Promise<TileImage | null> {
  if (signal?.aborted) return null;
  const blob = await untilAborted(
    fetchBlob(url, signal).catch(() => null),
    signal
  );
  if (!blob || signal?.aborted) return null;
  const img = await decode(blob);
  if (img && signal?.aborted) {
    img.close();
    return null;
  }
  return img;
}

export interface LoadTilesOptions {
  signal?: AbortSignal;
  /** Requests in flight at once. OneMap speaks HTTP/2, so this is about manners, not the browser's limit. */
  concurrency?: number;
}

/**
 * Loads tiles in the order given, a few at a time, calling `onTile` with each
 * as it arrives (null for one that could not be had). Tiles already fetched
 * this session are handed over first, without waiting their turn. Resolves
 * when every tile has been tried or `signal` has fired; never rejects.
 */
export async function loadTiles(urls: string[], onTile: (index: number, tile: TileImage | null) => void, options: LoadTilesOptions = {}): Promise<void> {
  const { signal, concurrency = 4 } = options;
  const order = urls.map((_, i) => i).sort((a, b) => Number(tileKnown(urls[b])) - Number(tileKnown(urls[a])));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < order.length && !signal?.aborted) {
      const i = order[next++];
      const tile = await loadTile(urls[i], signal);
      if (signal?.aborted) {
        tile?.close();
        return;
      }
      onTile(i, tile);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, worker));
}

/** Forgets every tile fetched this session. For tests. */
export function clearTiles(): void {
  blobs.clear();
  settled.clear();
  queue.length = 0;
  active = 0;
}

// ── The bundled map ─────────────────────────────────────────────────────────

/** A map that came with the app, for a block that must look right with no network: one picture of a rectangle of the world. */
export interface BundledMap {
  /** The world pixels the picture shows, edge to edge, at the zoom its tiles were drawn for. */
  rect: PixelRect;
  /** The picture, by day or after dark; null if it cannot be decoded. */
  image(night: boolean): Promise<TileImage | null>;
}

/**
 * The map bundled for a block, if there is one: only the demo block has. The
 * pictures are kept out of the first load and decoded when asked for; nothing
 * here touches the network.
 */
export async function bundledMap(postal: string): Promise<BundledMap | null> {
  if (postal !== DEMO_POSTAL) return null;
  try {
    const { DEMO_GROUND } = await import('./demo-ground');
    if (DEMO_GROUND.postal !== postal || !DEMO_GROUND.day) return null;
    const picture = (base64: string): Promise<TileImage | null> => {
      const text = atob(base64);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return decode(new Blob([bytes], { type: DEMO_GROUND.type }));
    };
    return { rect: DEMO_GROUND.rect, image: (night) => picture(night ? DEMO_GROUND.night : DEMO_GROUND.day) };
  } catch {
    return null;
  }
}
