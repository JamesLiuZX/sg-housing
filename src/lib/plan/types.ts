/**
 * The flat format. One document describes one flat, in millimetres, with
 * x running right and y running down the page (plan view). Everything the
 * app shows is derived from this: the 3D model, the sun study, the rule
 * verdicts and the shared link.
 */

export type Pt = [number, number];

/** How HDB's rules treat a wall. */
export type WallKind = 'external' | 'structural' | 'shelter' | 'partition' | 'parapet';

export interface Wall {
  id: string;
  a: Pt;
  b: Pt;
  /** Thickness in mm. */
  t: number;
  kind: WallKind;
  /** Bounds a bathroom, so the 3-year finishes rule applies in a new flat. */
  wet?: boolean;
  /** Height in mm when it differs from the flat's ceiling height. */
  h?: number;
}

export type Leaf = 'timber' | 'room' | 'fold' | 'glass' | 'steel';

export interface Opening {
  id: string;
  wall: string;
  /** Distance in mm from the wall's `a` end to the start of the opening. */
  at: number;
  w: number;
  type: 'door' | 'window' | 'open';
  sill?: number;
  head?: number;
  /** Doors only. */
  leaf?: Leaf;
  hinge?: 'start' | 'end';
  /** Which side the leaf swings to, relative to the wall's left normal. */
  into?: 1 | -1;
  /** Open angle in degrees. */
  angle?: number;
  gate?: boolean;
  /** Windows only: the room this window lights. */
  room?: string;
}

export type Finish = 'porcelain' | 'vinyl' | 'tile' | 'cement';

export interface Room {
  id: string;
  name: string;
  /** Polygon on wall centrelines. */
  poly: Pt[];
  finish: Finish;
  /** Where the label sits, if the centroid is a poor spot. */
  label?: Pt;
  /** Left unlabelled in the overview. */
  quiet?: boolean;
}

/** Floor outside the flat proper: common corridor, air-con ledge. */
export interface Slab {
  id: string;
  rect: [number, number, number, number];
  finish: Finish;
}

export type Face = 'N' | 'E' | 'S' | 'W';

export interface Item {
  kind: string;
  /** Centre of the footprint, mm. */
  x: number;
  y: number;
  /** Which way the front faces on the plan. N is up the page. */
  face?: Face;
  w?: number;
  d?: number;
  h?: number;
  /** Counts as an obstacle when walking. */
  solid?: boolean;
  opts?: Record<string, number | string | boolean>;
}

export interface Plan {
  id: string;
  title: string;
  subtitle: string;
  areaSqm: number;
  /** Floor-to-ceiling height, mm. */
  height: number;
  /** Compass bearing, in degrees, that the top of the plan faces. */
  north: number;
  /** Footprint of the flat on wall centrelines. */
  outline: Pt[];
  /** Where a visitor stands on arrival, and which way they look. */
  entry: { x: number; y: number; face: Face };
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  slabs: Slab[];
  items: Item[];
  /** Where interior lights hang, mm. */
  lights: Pt[];
  source: 'template' | 'traced';
}
