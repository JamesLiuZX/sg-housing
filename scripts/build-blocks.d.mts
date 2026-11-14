// Types for the parts of build-blocks.mjs the tests import, so the round trip
// from the packer to src/lib/data/shard.ts is checked under strict TypeScript.

export type Pt = [number, number];

export declare const SHARD_VERSION: number;
export declare const ALPHABET: string;
export declare const FOOTPRINT_DATASET: string;

export interface BuildOptions {
  tolerance: number;
  unit: number;
  minHole: number;
  minPart: number;
}
export declare const DEFAULTS: Readonly<BuildOptions>;

export declare function localFrame(lat0: number, lng0: number): {
  toLocal(lat: number, lng: number): Pt;
  toLatLng(x: number, y: number): Pt;
};
export declare function signedArea(ring: Pt[]): number;
export declare function simplifyRing(ring: Pt[], tol: number): Pt[];
export declare function quantizeRing(ring: Pt[], unit: number): Pt[];
export declare function isSimpleRing(ring: Pt[]): boolean;
export declare function packRing(ring: Pt[], options: { tolerance: number; unit: number; hole: boolean }): Pt[] | null;
export declare function encodeInt(v: number): string;
export declare function encodeRing(pts: Pt[]): string;
export declare function normalisePostal(v: unknown): string | null;
export declare function attributionLine(datasetName: string, accessed: Date): string;

export interface GeoJsonFeature {
  type?: 'Feature';
  properties: { POSTAL_COD?: string | number | null; BLK_NO?: string | null; [k: string]: unknown };
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] } | null;
}

export interface BuiltShard {
  shard: { v: number; sector: string; origin: [number, number]; unit: number; blocks: [string, string, ...string[]][] };
  bbox: [number, number, number, number];
}

export declare function buildShards(
  collection: { features?: GeoJsonFeature[] },
  options?: Partial<BuildOptions>
): {
  shards: Map<string, BuiltShard>;
  stats: {
    features: number;
    blocks: number;
    skipped: { postal: number; geometry: number };
    droppedHoles: number;
    droppedParts: number;
    verticesIn: number;
    verticesOut: number;
    maxVertices: number;
  };
  options: BuildOptions;
};
