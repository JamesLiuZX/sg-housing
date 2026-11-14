/**
 * Shared types for Blk's data layer: the block index, OneMap search and the
 * data.gov.sg block facts. Everything here is plain data, safe to keep in
 * Svelte state or serialise.
 *
 * Ground coordinates are metres, x east and y north, with north up. That is
 * not the flat format's frame (millimetres, y running down the page); the
 * interface turns one into the other when it sets a plan's `north`.
 */

/** A point on the ground: metres east (x) and north (y) of a stated origin. */
export type XY = [x: number, y: number];

/**
 * A closed ring, first point not repeated. Outer rings run counter-clockwise
 * seen from above with north up; holes run clockwise. Walking a ring in its
 * own direction, the building is always on your left.
 */
export type Ring = XY[];

/** One piece of a footprint: its outline and any courtyards inside it. */
export interface Part {
  outer: Ring;
  /** Courtyards and large voids. Air wells under 50 m² are not kept. */
  holes: Ring[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A block's footprint as HDB surveyed it, simplified to within about 0.3 m. */
export interface Footprint {
  /** Largest first. Nearly every block has exactly one part; ten have two or three. */
  parts: Part[];
  /** Plan area in m², courtyards excluded. */
  area: number;
  bounds: Bounds;
}

/** A block from the index, positioned in its own frame. */
export interface Block {
  /** Six digits, e.g. "121440". */
  postal: string;
  /** As HDB writes it, e.g. "440A". */
  blk: string;
  /** WGS84 latitude and longitude of the footprint's centroid, which is the origin of `footprint`. */
  lat: number;
  lng: number;
  /** Metres east and north of the centroid. */
  footprint: Footprint;
  /**
   * Other blocks from the same sector file whose footprints come within the
   * requested radius (150 m by default), nearest first, in this block's frame.
   * Blocks just across a postal sector boundary are not included.
   */
  neighbours: Neighbour[];
}

export interface Neighbour {
  postal: string;
  blk: string;
  /** In the frame of the block it neighbours. */
  footprint: Footprint;
  /** Shortest distance between the two footprints, metres. */
  gap: number;
}

/** A significant straight side of a footprint: something a person would call "that side of the block". */
export interface Facade {
  /** Which part of the footprint (0 is the largest) and which ring of it (0 is the outside, 1 and up are courtyards). */
  part: number;
  ring: number;
  /**
   * Ends of the facade, in the footprint's frame, in the ring's direction:
   * walking from `a` to `b` the building is on your left and the view is on
   * your right.
   */
  a: XY;
  b: XY;
  mid: XY;
  /** Metres from `a` to `b`. */
  length: number;
  /**
   * Compass bearing the facade looks out on: its outward normal, in degrees
   * clockwise from true north, 0 ≤ bearing < 360. For a courtyard ring this is
   * the direction into the courtyard.
   */
  bearing: number;
}

// ---------------------------------------------------------------------------
// Results. Every network function resolves (never rejects) to one of these.

/** Which outside service a result depends on, so the interface can name it. */
export type Service = 'blocks' | 'onemap' | 'datagov';

/**
 * network       the request never got an answer: offline, blocked (as in the single-file preview), DNS, CORS
 * timeout       no answer in time
 * rate-limited  the service said "too many requests" and still did after polite retries
 * auth          the service wants a token or key it was not given
 * server        the service answered with an error status
 * bad-response  the service answered with something that is not what it documents
 */
export type UnavailableReason = 'network' | 'timeout' | 'rate-limited' | 'auth' | 'server' | 'bad-response';

export interface Found<T> {
  status: 'ok';
  data: T;
  /** When the data was fetched from the service (ms since epoch); older than now when it came from the device's cache. */
  fetchedAt: number;
}

/** The service answered, and there is no such thing. */
export interface NotFound {
  status: 'not-found';
}

/** The service could not be asked or did not answer properly. Say so, and offer to try again. */
export interface Unavailable {
  status: 'unavailable';
  service: Service;
  reason: UnavailableReason;
  /** When rate-limited: how long the service asked us to wait, if it said. */
  retryAfterMs?: number;
  /** For the console, not for people. */
  detail?: string;
}

/** The caller's AbortSignal fired. Nothing to show. */
export interface Aborted {
  status: 'aborted';
}

export type Result<T> = Found<T> | NotFound | Unavailable | Aborted;

// ---------------------------------------------------------------------------
// OneMap

export interface AddressHit {
  /** Block or house number, e.g. "440A"; empty for a road or a landmark. */
  blk: string;
  /** Road name in full, as OneMap spells it, e.g. "CLEMENTI AVENUE 3". */
  road: string;
  /** Building or estate name, e.g. "CLEMENTI CASCADIA"; empty when there is none. */
  building: string;
  /** Six digits; empty when OneMap has no postal code for the place. */
  postal: string;
  lat: number;
  lng: number;
  /** OneMap's one-line address, e.g. "440A CLEMENTI AVENUE 3 CLEMENTI CASCADIA SINGAPORE 121440". */
  address: string;
}

export interface SearchHits {
  /** The query as actually sent, after cleaning ("blk 440a clementi ave 3 #12-34" becomes "440A CLEMENTI AVE 3"). */
  query: string;
  /** One per address: OneMap's duplicates for the same block (one per building name) are merged. */
  hits: AddressHit[];
  /** How many places OneMap matched in all; more than `hits.length` means the query could be more specific. */
  total: number;
}

/** `empty`: the query had nothing searchable in it, so nothing was sent. */
export type SearchResult = Result<SearchHits> | { status: 'empty' };

// ---------------------------------------------------------------------------
// data.gov.sg

/** Where a fact came from, for the "facts carry sources" rule. */
export interface DataSource {
  /** Dataset name as data.gov.sg titles it. */
  name: string;
  /** data.gov.sg dataset page. */
  url: string;
}

/**
 * Flat types as HDB's resale data writes them, so a block's unit mix and its
 * resale summary can be matched directly. `STUDIO` (studio apartments) and
 * `OTHER` (other rental flats) only appear in the unit mix.
 */
export type FlatType = '1 ROOM' | '2 ROOM' | '3 ROOM' | '4 ROOM' | '5 ROOM' | 'EXECUTIVE' | 'MULTI-GENERATION' | 'STUDIO' | 'OTHER';

export interface UnitCount {
  type: FlatType;
  sold: number;
  rental: number;
}

/** One block's row from "HDB Property Information". */
export interface BlockFacts {
  blk: string;
  /** Street as HDB spells it, e.g. "CLEMENTI AVE 3". */
  street: string;
  /** Highest floor level. */
  storeys: number;
  yearCompleted: number;
  dwellingUnits: number;
  /** Non-zero flat types only, smallest first. */
  units: UnitCount[];
  /** False for blocks that are only shops, markets or car parks. */
  residential: boolean;
  source: DataSource;
}

/** One transaction from "Resale flat prices", as published: registration month, not completion. */
export interface Resale {
  /** "2026-09". */
  month: string;
  flatType: string;
  /** "Model A", "Improved", "New Generation", ... */
  flatModel: string;
  /** Floor range as published, e.g. "25 TO 27"; HDB does not publish the exact floor. */
  storeyRange: string;
  /** m². */
  floorArea: number;
  /** Year the 99-year lease began. */
  leaseStart: number;
  /** As published at the time of sale, e.g. "90 years 11 months". */
  remainingLease: string;
  /** S$. */
  price: number;
}

/** A layout family seen in the block's resale records: the input for choosing a template. */
export interface LayoutSeen {
  flatType: string;
  flatModel: string;
  /** Distinct floor areas recorded, m², smallest first. */
  floorAreas: number[];
  /** Transactions of this type and model since January 2017. */
  count: number;
}

export interface ResaleSummary {
  blk: string;
  street: string;
  /** Town as the resale data names it, e.g. "CLEMENTI"; empty when there were no sales. */
  town: string;
  /** Transactions on record since January 2017. Zero for a block too new to have been resold. */
  total: number;
  /** Newest first, at most 30. */
  recent: Resale[];
  /** Most common type-and-model combinations first. */
  layouts: LayoutSeen[];
  /** Year the lease began, from the records; null when there were no sales. */
  leaseStart: number | null;
  source: DataSource;
}

/** Everything known about a block from one OneMap hit. Each part may be missing on its own. */
export interface BlockLookup {
  hit: AddressHit;
  block: Result<Block>;
  facts: Result<BlockFacts>;
  resales: Result<ResaleSummary>;
}
