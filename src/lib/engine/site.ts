import * as THREE from 'three';
import { facades } from '../data/facades';
import { knownNeighbourHeights } from '../data/neighbours';
import type { Block, BuildingKind, Facade, Neighbour, Part, Ring, XY } from '../data/types';
import type { PathPoint, Sun } from '../sg/solar';
import { blur } from './floorTexture';
import { groundChunk, groundFor, letGo, type GroundKind, type MapGround } from './ground';
import { PAL, col, softShadowChunk } from './materials';
import { clamp } from './tween';

/**
 * The block stage's site model: the chosen block at true height among its
 * neighbours, made the way an architect's site model is made. Card-white
 * volumes, graphite lines, the block number painted on the end walls, and a
 * table that only ever shows the shade the model throws on it, so the page
 * behind the canvas is the paper.
 *
 * Everything is built in the site frame: metres, x east, y up, z south (so
 * true north is -z, as in the compass frame), origin on the ground at the
 * chosen block's footprint centroid. The viewer turns and moves this frame
 * so that the flat, which never moves, sits in it where it belongs.
 */

/** Height of the ground storey, the void deck, metres. */
export const GROUND = 3.6;
/** Floor to floor above the ground storey, metres. */
export const STOREY = 2.8;
/** Parapet round the roof, metres above the roof slab. */
const PARAPET = 1.1;
/** Storeys given to a neighbour whose height nobody has told us: a typical older slab block. */
const NEIGHBOUR_STOREYS = 12;
/**
 * The facade's grammar, metres, the same on every HDB block because nothing
 * more is known: bays fitted to each run of wall at about this width; a
 * window's sill and head above its storey's floor; the void deck open to this
 * height under the first floor's beam; the plant room on the roof this tall.
 */
const BAY = 3.1;
const SILL = 0.9;
const HEAD = 2.2;
const DECK = 3.0;
const BOX = 3.2;
/** A wall turning more than this at a vertex is a corner; a curved wall is drawn in steps that turn less. */
const CORNER = Math.cos((32 * Math.PI) / 180);
/** The chosen block's card: warm and bright, the subject. sRGB. */
const CARD = 0xfff8ec;
/** The neighbours' card: cooler and greyer, so they step back. */
const CONTEXT = 0xe2e4e5;
/** The site plate, a shade under the page so a sunlit patch of it still reads as ground. */
export const PLATE = 0xefece6;
/**
 * The same ground seen from inside a flat: greyboard, darker than the page,
 * because there it lies against the sky at the horizon and has to read as
 * ground under white card blocks rather than as more paper.
 */
export const PLATE_INSIDE = 0xcdc6b9;
/** On the stage, haze starts and is full this many metres from the chosen block. */
export const STAGE_HAZE: readonly [number, number] = [60, 260];
/** The ground seen from inside runs at least this far, metres: past where the haze seen from inside is complete. */
const FAR_GROUND = 4500;

/** What the block stage is asked to show. */
export interface BlockSite {
  block: Block;
  /** Storeys of the chosen block, from HDB's property information. */
  storeys: number;
  /** Painted on the end walls as on the block itself, e.g. "440A". The block's own number when empty. */
  label: string;
  /** Storeys of neighbouring blocks where they are known, by postal code. */
  neighbourStoreys?: Record<string, number>;
  /**
   * What the neighbouring buildings are, by postal code, where HDB's records
   * say. Left out, what this device already knows is used: the bundled
   * snapshot and earlier lookups. Only a building known to hold flats is drawn
   * with them; a car park is drawn as open decks, anything else as a plain mass.
   */
  neighbourKinds?: Record<string, BuildingKind>;
}

/** Height of storey n's floor above the ground, metres. Storey 1 is the ground storey. */
export function floorY(n: number): number {
  return n <= 1 ? 0 : GROUND + (n - 2) * STOREY;
}

/** Height of the roof slab of a block with this many storeys. */
export function roofY(storeys: number): number {
  return storeys <= 1 ? GROUND : floorY(storeys) + STOREY;
}

/** The storey a height above the ground falls in. */
export function storeyAt(y: number, storeys: number): number {
  const n = y < GROUND ? 1 : 2 + Math.floor((y - GROUND) / STOREY);
  return clamp(n, 1, Math.max(1, storeys));
}

export interface SiteUniforms {
  /** The storey the block is opened at: from it up lifts away, below it sinks. Huge while closed. */
  uSplit: THREE.IUniform<number>;
  /** Metres the top has lifted, the bottom has sunk, and the neighbours have sunk. */
  uMove: THREE.IUniform<THREE.Vector3>;
  /** Floor and ceiling of the marked storey, metres, and how strongly it is marked. */
  uBand: THREE.IUniform<THREE.Vector2>;
  uBandOn: THREE.IUniform<number>;
  /** 0 by day, 1 at night: windows and void decks light up. */
  uNight: THREE.IUniform<number>;
  /** The share of flats with a light on after dark, for the hour: litAt. */
  uLit: THREE.IUniform<number>;
  uMark: THREE.IUniform<THREE.Color>;
  uGlow: THREE.IUniform<THREE.Color>;
  /** The table: strength of the contact shade, and of the whole table. */
  uContact: THREE.IUniform<number>;
  uGround: THREE.IUniform<number>;
  /**
   * The site's own exposure, against the lights it shares with the flat:
   * the sky's light scaled per channel, so the shade on a block is deeper and
   * cooler than the shade in a room, and the sun's light scaled, so a sunlit
   * face keeps its warmth instead of bleaching to white.
   */
  uShade: THREE.IUniform<THREE.Color>;
  uSunK: THREE.IUniform<number>;
  /**
   * Haze toward the page: its colour (rgb, linear, after tone mapping) and
   * strength (a), growing with distance from uFogAt (site frame) between
   * uFogRange.x and .y metres.
   */
  uFog: THREE.IUniform<THREE.Vector4>;
  uFogAt: THREE.IUniform<THREE.Vector3>;
  uFogRange: THREE.IUniform<THREE.Vector2>;
  /** The table fades out between these distances from the block's centroid, metres. */
  uRim: THREE.IUniform<THREE.Vector2>;
  /** A box in the world inside which the chosen block is not drawn: round the flat, seen from inside it. Empty while min > max. */
  uHideMin: THREE.IUniform<THREE.Vector3>;
  uHideMax: THREE.IUniform<THREE.Vector3>;
  /**
   * The site's own sun shadow, for when the shared shadow map is fitted to the
   * flat alone (walking, with the site seen through the windows): packed
   * depth, world to map, on (1) or off (0), and the filter's step in map units
   * (x, y) with the lift off each surface in metres (z).
   */
  uSiteShadow: THREE.IUniform<THREE.Texture | null>;
  uSiteShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uSiteShadowOn: THREE.IUniform<number>;
  uSiteShadowSoft: THREE.IUniform<THREE.Vector3>;
}

/** Where the block's number is painted: the middle of the lettering and the wall's outward normal, site frame; a figure's height, metres. */
export interface PaintedNumber {
  at: THREE.Vector3;
  normal: THREE.Vector3;
  height: number;
}

export interface BlockHit {
  /** Site frame. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  roof: boolean;
}

export interface SiteModel {
  root: THREE.Group;
  /** Walls, roofs, parapet, lift core and neighbours, in one draw. */
  solid: THREE.Mesh;
  /** The section where the block opens, shown only while it is open. */
  caps: THREE.Mesh;
  /** The chosen block's roofline. */
  lines: THREE.LineSegments;
  /** The neighbours' rooflines. */
  faint: THREE.LineSegments;
  /** The table under the site. */
  ground: THREE.Mesh;
  /** The ground beyond the table, out to where the haze is complete: shown only from inside a flat, where the horizon is in view. */
  far: THREE.Mesh;
  /** How far that ground runs from the block's centroid, metres, square. */
  groundReach: number;
  /** OneMap's base map, printed on the table and the ground beyond it; `setKind('paper')` leaves the plain table. */
  map: MapGround;
  u: SiteUniforms;
  storeys: number;
  /** Roof slab of the chosen block, metres. */
  top: number;
  /** The tallest roof on the site, parapet and lift core included. */
  peak: number;
  /** Radius of the table, metres from the block's centroid. */
  radius: number;
  /** Tallest neighbour roof, metres. */
  neighbourTop: number;
  facades: Facade[];
  /** Where the block's number is painted, one per end wall that took it. */
  numbers: PaintedNumber[];
  /** The chosen block's footprint box in the site frame. */
  box: THREE.Box3;
  /** The first place a site-frame ray meets the chosen block. */
  hit(ray: THREE.Ray): BlockHit | null;
  /** Whether a neighbour stands between two site-frame points. */
  hidden(from: THREE.Vector3, to: THREE.Vector3): boolean;
  /** The facade a point on the block's wall belongs to, and how far along it, 0 to 1. */
  facadeAt(point: THREE.Vector3, normal: THREE.Vector3): { index: number; along: number } | null;
  /** Builds the section for the block opened at storey n. */
  split(n: number): void;
  dispose(): void;
}

// ── Shading ─────────────────────────────────────────────────────────────────

const VERT_HEAD = /* glsl */ `
attribute vec4 aInfo;
attribute vec2 aSpan;
uniform float uSplit;
uniform vec3 uMove;
varying vec4 vInfo;
varying vec2 vSpan;
varying vec3 vSite;
varying vec3 vBlkWorld;
varying float vLow;
`;

// aInfo: x the storey (chosen block, from 1) or -1 (a neighbour); y metres along the wall's run (a stretch
// of wall from corner to corner, round any gentle curve); z the run's length; w the kind plus a per-run
// seed below 1. Kinds: 0 a wall of flats, 1 a roof, lid or section, 2 a parapet, 3 a roof plant room,
// 4 a blank wall of flats (an end wall, or the one that carries the painted number), 5 a car park's
// wall, 6 the wall of anything else. aSpan: x the roof a parapet or plant room stands on, y a plant
// room's height or a car park's deck to deck, metres.
const VERT_BODY = /* glsl */ `
vInfo = aInfo;
vSpan = aSpan;
vSite = transformed;
transformed.y += aInfo.x > 0.5 ? (aInfo.x > uSplit - 0.5 ? uMove.x : -uMove.y) : -uMove.z;
vLow = transformed.y;
vBlkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

/** The world normal, for the site's own shadow lookup. Lit materials only: a depth shader has no normal. */
const VERT_NORMAL_HEAD = 'varying vec3 vBlkNormalW;\n';
const VERT_NORMAL = 'vBlkNormalW = normalize(mat3(modelMatrix) * objectNormal);\n';

/** What every surface of the site reads: its exposure, the haze, the hole round a flat seen from inside. */
const FRAG_SHARED = /* glsl */ `
uniform vec3 uShade;
uniform float uSunK;
uniform vec4 uFog;
uniform vec3 uFogAt;
uniform vec2 uFogRange;
uniform vec3 uHideMin;
uniform vec3 uHideMax;
uniform sampler2D uSiteShadow;
uniform mat4 uSiteShadowMatrix;
uniform float uSiteShadowOn;
uniform vec3 uSiteShadowSoft;
varying vec3 vSite;
varying vec3 vBlkWorld;
varying vec3 vBlkNormalW;
// Light kept off the neighbours' sunlit faces and given to their shade, so they read flatter than the chosen block.
float blkDirect = 1.0;
float blkSky = 1.0;
`;

const FRAG_HEAD =
  FRAG_SHARED +
  /* glsl */ `
uniform vec2 uBand;
uniform float uBandOn;
uniform float uNight;
uniform vec3 uMark;
uniform vec3 uGlow;
uniform vec3 uCard;
uniform vec3 uContext;
uniform float uRoof;
uniform float uLit;
varying vec4 vInfo;
varying vec2 vSpan;
varying float vLow;
// A hash without sin, so it is the same on every GPU, at any magnitude it is given here.
float blkHash(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// How much of a pixel w wide, centred at x, falls on [a, b]: a pattern laid out in cells c wide whose
// edges stay clear of it for at least g. Where the pixel reaches past the cell and that clear margin it
// counts at the pattern's average m, so a pattern shrinking toward a pixel gives way to its average
// instead of shimmering.
float blkCover(float x, float w, float a, float b, float c, float g, float m) {
  float lo = x - 0.5 * w;
  float hi = x + 0.5 * w;
  float on = max(0.0, min(hi, b) - max(lo, a));
  return clamp((on + m * (max(0.0, -lo - g) + max(0.0, hi - c - g))) / w, 0.0, 1.0);
}
// The same, exactly, for a pattern that repeats unchanged: [a, b] in every cell c tall.
float blkTrainI(float t, float a, float b, float c) {
  float k = floor(t / c);
  return k * (b - a) + clamp(t - k * c - a, 0.0, b - a);
}
float blkTrain(float x, float w, float a, float b, float c) {
  float r = x - floor(x / c) * c;
  return (blkTrainI(r + 0.5 * w, a, b, c) - blkTrainI(r - 0.5 * w, a, b, c)) / w;
}
`;

/** Pieces sinking into the table are cut off at its surface, and the chosen block steps aside for a flat seen from inside. */
const FRAG_CLIP = /* glsl */ `
if (vLow < -0.02) discard;
if (vInfo.x > 0.5 && all(greaterThan(vBlkWorld, uHideMin)) && all(lessThan(vBlkWorld, uHideMax))) discard;
`;

const G = GROUND.toFixed(2);
const S = STOREY.toFixed(2);
const F = (x: number) => x.toFixed(3);

/**
 * The block's face, drawn rather than modelled, in the grammar every HDB
 * block shares and nothing more, since which side has the corridor, where the
 * lifts are and how it is painted are not known. Every storey is a strip of
 * glazing set back in the wall, in bays about three metres apart, under a
 * solid spandrel, with a fine shadow line under each slab; each stack of bays
 * is the same all the way up (a full window, a narrower one or a blank
 * panel), as flats are. The ground storey is a void deck, open and in its own
 * shade between columns. Short walls at the ends of the block stay blank, and
 * the end wall carries the painted number. Up close a window has a frame, a
 * sill, glass that picks up the sky, and the shadow of its head; far off the
 * same face settles into clean bands, because every pattern is filtered over
 * the pixel it falls in (blkCover, blkTrain) and gives way to its average
 * as it shrinks, so nothing shimmers. After dark the flats are lit as flats:
 * whole windows, uLit of them, warm or cool white, each the same every frame.
 *
 * The chosen block is the warm card, its marked storey in the sun's orange;
 * neighbours known to hold flats are drawn the same in the cooler card, a
 * car park as open decks, and anything else as a plain quiet mass.
 */
const FRAG_COLOR = /* glsl */ `
${FRAG_CLIP}
float blkKind = floor(vInfo.w + 0.001);
float blkSeed = fract(vInfo.w + 0.001);
bool blkMain = vInfo.x > 0.5;
float blkY = vSite.y;
float blkPx = max(fwidth(blkY), 2e-3);
const vec3 blkInk = vec3(0.046, 0.05, 0.058);
// Lamplight after dark: warm white in some flats and cool white in others, as Singapore homes are lit;
// the common areas, void decks and car parks in cool white.
const vec3 blkWarm = vec3(1.0, 0.7, 0.42);
const vec3 blkCool = vec3(0.78, 0.86, 1.0);
vec3 blkC = blkMain ? uCard : uContext;
vec3 blkCard = blkC;
vec3 blkE = vec3(0.0);
if (!blkMain) {
  blkDirect = 0.78;
  blkSky = 1.22;
}
if (blkKind < 0.5 || (blkKind > 3.5 && blkKind < 4.5)) {
  bool blkBlank = blkKind > 3.5;
  float blkU = vInfo.y;
  float blkLen = vInfo.z;
  float blkPu = max(fwidth(blkU), 2e-3);
  float blkT = blkY - ${G};
  float blkSt = blkT < 0.0 ? 1.0 : 2.0 + floor(blkT / ${S});
  float blkH = blkT < 0.0 ? blkY : blkT - (blkSt - 2.0) * ${S};
  float blkUp = blkT < 0.0 ? 0.0 : 1.0;
  // Bays about three metres wide, fitted to the run so a pier stands at each corner.
  float blkBays = max(1.0, floor(blkLen / ${F(BAY)} + 0.5));
  float blkBw = blkLen / blkBays;
  float blkBi = clamp(floor(blkU / blkBw), 0.0, blkBays - 1.0);
  float blkBx = blkU - blkBi * blkBw;
  float blkMid = 0.5 * blkBw;
  // How far the bays have shrunk toward a pixel: their differences give way to their average.
  float blkFar = smoothstep(0.3, 0.8, max(blkPu / blkBw, blkPx / ${S}));
  // A strip of glazing broken by narrow piers, each stack of bays the same all the way up.
  float blkFull = max(0.0, blkMid - 0.15);
  float blkNarrow = min(0.62, blkFull);
  float blkMean = blkBlank || blkLen < 1.9 ? 0.0 : (1.4 * blkFull + 0.36 * blkNarrow) / blkBw;
  float blkStack = blkHash(vec2(blkBi + 3.0, blkSeed * 197.0 + 1.0));
  float blkHalf = blkMean <= 0.0 ? 0.0 : blkStack < 0.7 ? blkFull : blkStack < 0.88 ? blkNarrow : 0.0;
  blkHalf = mix(blkHalf, 0.5 * blkMean * blkBw, smoothstep(0.25, 0.6, blkPu / blkBw));
  // Frames, mullions and sills are drawn only while they are a few pixels wide; further off, plain glass.
  float blkFine = 1.0 - smoothstep(0.025, 0.07, max(blkPu, blkPx));
  // Up close the line of sight meets the glass a little back in the wall, so a window has depth.
  vec3 blkN = normalize(vBlkNormalW);
  vec3 blkV = normalize(cameraPosition - vBlkWorld);
  float blkVn = dot(blkV, blkN);
  vec2 blkPar = blkVn > 0.1 ? -0.12 * blkFine * vec2(dot(blkV, vec3(blkN.z, 0.0, -blkN.x)), blkV.y) / blkVn : vec2(0.0);
  float blkOx = blkCover(blkBx, blkPu, blkMid - blkHalf, blkMid + blkHalf, blkBw, 0.15, blkMean);
  float blkOpen = blkOx * blkUp * blkTrain(blkT, blkPx, ${F(SILL)}, ${F(HEAD)}, ${S});
  float blkGu = blkBx + blkPar.x;
  float blkGt = blkT + blkPar.y;
  float blkGx = blkCover(blkGu, blkPu, blkMid - blkHalf + 0.05, blkMid + blkHalf - 0.05, blkBw, 0.15, blkMean * 0.95);
  float blkThird = blkHalf > 0.8 ? blkHalf * 0.6667 : blkHalf;
  float blkM = blkMid - blkHalf + blkThird;
  float blkMull = blkHalf > 0.1 ? blkCover(blkGu, blkPu, blkM - 0.03, blkM + 0.03, blkBw, 0.15, 0.0) : 0.0;
  if (blkHalf > 0.8) blkMull += blkCover(blkGu, blkPu, blkM + blkThird - 0.03, blkM + blkThird + 0.03, blkBw, 0.15, 0.0);
  float blkGlass = min(max(blkGx - blkMull, 0.0) * blkUp * blkTrain(blkGt, blkPx, ${F(SILL + 0.05)}, ${F(HEAD - 0.05)}, ${S}), blkOpen);
  blkGlass = mix(blkOpen, blkGlass, blkFine);
  // Whatever else the line of sight meets in the opening: the frame, or the side of the opening.
  float blkFrame = max(blkOpen - blkGlass, 0.0);
  // A soft shadow under each window's head; with the sun on the face, as long as the sun makes it.
  float blkHs = 0.26;
  #if NUM_DIR_LIGHTS > 0
  vec3 blkL = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
  float blkLn = dot(blkL, blkN);
  if (blkLn > 0.03) blkHs = 0.14 + clamp(0.12 * blkL.y / blkLn, 0.0, 0.8);
  #endif
  float blkGh = blkGt - floor(blkGt / ${S}) * ${S};
  float blkHead = blkGlass * mix(smoothstep(${F(HEAD - 0.05)} - blkHs, ${F(HEAD - 0.05)}, blkGh), 0.16, blkFar);
  // The fine shadow line under each slab, softening below it, and the sill catching the light.
  float blkSlab = blkUp * blkTrain(blkT, blkPx, ${F(STOREY - 0.07)}, ${S}, ${S});
  float blkSoft = blkUp * blkTrain(blkT, blkPx, ${F(STOREY - 0.3)}, ${F(STOREY - 0.07)}, ${S});
  float blkSill = blkUp * blkFine * blkOx * blkTrain(blkT, blkPx, ${F(SILL - 0.05)}, ${F(SILL)}, ${S});
  // The void deck: open between columns about two bays apart, its inside lost in shade.
  float blkDeck = 0.0;
  if (blkUp < 0.5 && blkLen > 1.9) {
    float blkCs = blkLen / max(1.0, floor(blkBays * 0.5));
    float blkCol = blkCover(mod(blkU + 0.5 * blkCs, blkCs), blkPu, 0.5 * blkCs - 0.32, 0.5 * blkCs + 0.32, blkCs, 0.5 * blkCs - 0.4, 0.64 / blkCs);
    blkDeck = (1.0 - blkCol) * blkCover(blkY, blkPx, 0.0, ${F(DECK)}, ${G}, 0.6, ${F(DECK / GROUND)});
  }
  float blkGk = blkMain ? 1.0 : 0.72;
  blkC = mix(blkC, blkCard * 1.05, 0.5 * blkSill);
  blkC = mix(blkC, blkCard * 0.8, blkFrame * blkGk);
  blkC = mix(blkC, blkCard * vec3(0.3, 0.33, 0.37), blkGlass * blkGk);
  blkC = mix(blkC, blkCard * 0.74, 0.45 * blkSoft);
  blkC = mix(blkC, blkCard * 0.4, blkSlab * (blkMain ? 0.85 : 0.55));
  blkC = mix(blkC, blkCard * mix(0.36, 0.22, smoothstep(0.4, ${F(DECK)}, blkY)), blkDeck);
  blkDirect *= max(0.0, 1.0 - 0.85 * blkDeck - 0.65 * blkHead - 0.6 * blkSlab - 0.3 * blkSoft);
  blkSky *= 1.0 - 0.4 * blkDeck - 0.2 * blkHead;
  float blkBand = 0.0;
  if (blkMain) {
    float inBand = smoothstep(uBand.x - blkPx, uBand.x, blkY) * (1.0 - smoothstep(uBand.y, uBand.y + blkPx, blkY));
    float rim = 1.0 - smoothstep(0.6 * blkPx, 1.7 * blkPx, min(abs(blkY - uBand.x), abs(blkY - uBand.y)));
    blkBand = uBandOn * inBand;
    // The storey is tinted a light peach, so the flat's own patch, in the sun's full orange, stands out of it.
    blkC = mix(blkC, mix(uMark, vec3(1.0), 0.34) * (1.0 - 0.22 * blkGlass - 0.5 * blkDeck), 0.74 * blkBand);
    blkC = mix(blkC, uMark * 0.35, 0.9 * uBandOn * rim);
    blkE += uMark * blkBand * (0.14 + 0.45 * uNight);
  }
  // Glass picks up the sky, more of it the more obliquely it is seen.
  float blkFres = 0.05 + 0.45 * pow(1.0 - min(abs(blkVn), 1.0), 4.0);
  blkE += uFog.rgb * blkFres * blkGlass * blkGk * (1.0 - 0.6 * blkHead) * (1.0 - blkBand);
  if (uNight > 0.001) {
    // A flat's light, its own and the same every frame: on in uLit of them, warm or cool, brighter or dimmer.
    float blkR = blkHash(vec2(blkSt * 1.31 + blkSeed * 61.0, blkBi + 11.0));
    float blkOn = step(blkR, uLit);
    float blkTone = blkHash(vec2(blkBi * 0.83 + blkSeed * 23.0, blkSt + 5.0));
    vec3 blkLamp = mix((blkTone < 0.55 ? blkWarm : blkCool) * (0.62 + 0.38 * fract(blkR * 37.0)), mix(blkWarm, blkCool, 0.45) * 0.81, blkFar);
    float blkCeil = 0.82 + 0.18 * smoothstep(${F(SILL)}, ${F(HEAD)}, blkGh);
    // A lit window spills a little light onto the wall round it, and the window below onto the spandrel over it.
    vec2 blkD = vec2(max(abs(blkBx - blkMid) - blkHalf, 0.0), max(max(${F(SILL)} - blkH, blkH - ${F(HEAD)}), 0.0));
    float blkSpill = blkHalf > 0.1 ? blkOn * exp(-5.0 * length(blkD)) : 0.0;
    if (blkHalf > 0.1 && blkH < ${F(SILL)} && blkSt > 2.5) {
      float blkRb = blkHash(vec2((blkSt - 1.0) * 1.31 + blkSeed * 61.0, blkBi + 11.0));
      blkSpill += step(blkRb, uLit) * exp(-5.0 * length(vec2(blkD.x, blkH + ${F(STOREY - HEAD)})));
    }
    blkSpill = mix(blkSpill * (1.0 - blkOpen), 0.06 * uLit, blkFar);
    float blkK = uNight * blkUp * (1.0 - 0.6 * blkBand) * (blkMain ? 1.0 : 0.9);
    blkE += blkK * (blkLamp * blkGlass * mix(blkOn, uLit, blkFar) * blkCeil + mix(blkWarm, blkCool, 0.4) * 0.1 * blkSpill);
    // The void deck is lit all night, evenly and dimly.
    blkE += uNight * blkCool * 0.26 * blkDeck;
  }
} else if (blkKind > 4.5 && blkKind < 5.5) {
  // A multi-storey car park: on every deck a solid barrier to about a metre, then open to the slab over it,
  // between columns about eight metres apart; no windows. After dark each deck glows evenly.
  float blkPitch = max(vSpan.y, 2.4);
  float blkU = vInfo.y;
  float blkLen = vInfo.z;
  float blkPu = max(fwidth(blkU), 2e-3);
  float blkCs = blkLen / max(1.0, floor(blkLen / 8.0 + 0.5));
  float blkCol = blkCover(mod(blkU + 0.5 * blkCs, blkCs), blkPu, 0.5 * blkCs - 0.3, 0.5 * blkCs + 0.3, blkCs, 0.5 * blkCs - 0.4, 0.6 / blkCs);
  float blkOpen = (1.0 - blkCol) * blkTrain(blkY, blkPx, 1.05, blkPitch - 0.3, blkPitch);
  blkC = mix(blkC, blkCard * 0.26, blkOpen);
  blkDirect *= 1.0 - 0.85 * blkOpen;
  blkSky *= 1.0 - 0.45 * blkOpen;
  blkE += uNight * blkCool * 0.42 * blkOpen;
} else if (blkKind > 5.5) {
  // Anything else: a plain quiet mass, since nothing is known of its face.
  blkC *= 0.97;
} else if (blkKind < 1.5) {
  blkC *= blkMain ? 0.9 : 0.94;
} else if (blkKind < 2.5) {
  // The parapet: a fine shadow line where it meets the roof slab, and a crisp coping along its top.
  float hp = blkY - vSpan.x;
  float edge = 0.6 * blkCover(hp, blkPx, 0.0, 0.06, 1e4, 0.0, 0.0) + blkCover(hp, blkPx, ${F(PARAPET - 0.05)}, ${F(PARAPET + 1.0)}, 1e4, 0.0, 0.0);
  float cope = blkCover(hp, blkPx, ${F(PARAPET - 0.25)}, ${F(PARAPET + 1.0)}, 1e4, 0.0, 0.0);
  blkC = mix(blkC * mix(1.0, 0.9, cope), blkInk, (blkMain ? 0.6 : 0.3) * edge);
} else {
  // The plant room on the roof: louvres along the top of its walls, and a coping line.
  float hb = blkY - vSpan.x;
  float louvre = blkTrain(hb, blkPx, 0.0, 0.05, 0.16) * blkCover(hb, blkPx, vSpan.y - 0.95, vSpan.y - 0.35, 1e4, 0.0, 0.0);
  float cope = blkCover(hb, blkPx, vSpan.y - 0.06, vSpan.y + 1.0, 1e4, 0.0, 0.0);
  blkC *= 0.93;
  blkC = mix(blkC, blkCard * 0.5, 0.7 * louvre);
  blkC = mix(blkC, blkInk, (blkMain ? 0.5 : 0.3) * cope);
}
diffuseColor.rgb = blkC;
totalEmissiveRadiance += blkE;
`;

/**
 * Haze, after tone mapping so it lands on the page's own colour. It reaches
 * its set strength over its range, then closes in completely over six times
 * that distance, so ground that runs on to the horizon meets the sky there.
 */
const FRAG_FOG = /* glsl */ `
float blkFogD = distance(vSite.xz, uFogAt.xz);
float blkFogK = uFog.a * smoothstep(uFogRange.x, uFogRange.y, blkFogD);
blkFogK += (1.0 - blkFogK) * smoothstep(uFogRange.y, uFogRange.y * 6.0, blkFogD);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uFog.rgb, blkFogK);
`;

/**
 * The site's own sun shadow, read the way the soft filter reads the shared
 * map: sixteen taps a filter step apart, blended bilinearly, so the edge of a
 * block's shadow is a smooth ramp about as wide as the step. Each surface is
 * lifted off its own depth along its normal, turned for a face seen from
 * behind. Outside the map, and while it is off, everything is in sun.
 */
const SITE_SHADOW = /* glsl */ `
float blkSiteShadow() {
  if (uSiteShadowOn < 0.5) return 1.0;
  vec3 blkN = normalize(vBlkNormalW) * (gl_FrontFacing ? 1.0 : -1.0);
  vec4 blkSc = uSiteShadowMatrix * vec4(vBlkWorld + blkN * uSiteShadowSoft.z, 1.0);
  if (blkSc.x <= 0.0 || blkSc.x >= 1.0 || blkSc.y <= 0.0 || blkSc.y >= 1.0 || blkSc.z >= 1.0) return 1.0;
  vec2 blkStep = uSiteShadowSoft.xy;
  vec2 blkF = fract(blkSc.xy / blkStep + 0.5);
  vec2 blkUv = blkSc.xy - blkF * blkStep;
  #define BLK_STAP( x, y ) step( blkSc.z, unpackRGBAToDepth( texture2D( uSiteShadow, blkUv + vec2( x, y ) * blkStep ) ) )
  #define BLK_SROW( y ) ( mix( BLK_STAP( -1.0, y ), BLK_STAP( 2.0, y ), blkF.x ) + BLK_STAP( 0.0, y ) + BLK_STAP( 1.0, y ) )
  float blkS = ( mix( BLK_SROW( -1.0 ), BLK_SROW( 2.0 ), blkF.y ) + BLK_SROW( 0.0 ) + BLK_SROW( 1.0 ) ) * ( 1.0 / 9.0 );
  #undef BLK_SROW
  #undef BLK_STAP
  return blkS;
}
`;

/** Where three's light loop applies the shadow of a directional light. Only the sun casts one. */
const SUN_TERM = 'getShadow( directionalShadowMap[ i ]';
let sunLoop: string | null = null;

/**
 * three's light loop with the site's own shadow laid on the sun alone, so the
 * fill light still reaches a block in a neighbour's shadow. Empty if three
 * has changed its loop; the shadow then falls on all direct light.
 */
function sunShadowLoop(): string {
  if (sunLoop !== null) return sunLoop;
  const src = THREE.ShaderChunk.lights_fragment_begin;
  sunLoop = src.includes(SUN_TERM) ? src.replace(SUN_TERM, 'blkSiteShadow() * ' + SUN_TERM) : '';
  return sunLoop;
}

/** The site's lighting and haze, on any Lambert shader. */
function siteLight(fs: string): string {
  const loop = sunShadowLoop();
  return fs
    .replace('#include <shadowmap_pars_fragment>', softShadowChunk() + SITE_SHADOW)
    .replace('#include <lights_fragment_begin>', loop || '#include <lights_fragment_begin>')
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nirradiance *= uShade * blkSky;')
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.directDiffuse *= uSunK * blkDirect${loop ? '' : ' * blkSiteShadow()'};`)
    .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\n' + FRAG_FOG);
}

/** The painted number: graphite by day; after dark it glows softly, or the dark block would lose it. */
const FRAG_SIGN = /* glsl */ `
${FRAG_CLIP}
totalEmissiveRadiance += uGlow * uNight * 1.1 * diffuseColor.a;
`;

/** The site's shading on a Lambert material, with `frag` run once its colour is known. */
function siteShade<T extends THREE.Material>(mat: T, u: SiteUniforms, extra: Record<string, THREE.IUniform>, key: string, frag: string): T {
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, extra);
    s.vertexShader = VERT_HEAD + VERT_NORMAL_HEAD + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY + VERT_NORMAL);
    s.fragmentShader = siteLight(FRAG_HEAD + s.fragmentShader).replace('#include <color_fragment>', '#include <color_fragment>\n' + frag);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Shadows move with the pieces, and a piece under the table casts none. */
function siteDepth(u: SiteUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uSplit: u.uSplit, uMove: u.uMove });
    s.vertexShader = VERT_HEAD + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    s.fragmentShader =
      'varying float vLow;\n' + s.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vLow < -0.02) discard;\n');
  };
  mat.customProgramCacheKey = () => 'blk-site-depth';
  return mat;
}

/**
 * The plate the site stands on: card a shade darker than the page, lit like
 * the blocks, so the sun's long shadows have something to fall across, with a
 * soft contact shade round every footprint. It fades into the page well
 * before its edge, the way a model's base dissolves into a photographer's
 * sweep. OneMap's map is printed on it (ground.ts) as the colour of the
 * card, so the shadows, the contact shade, the fade and the haze all read
 * on top of the map as they did on the bare card.
 */
function groundMaterial(u: SiteUniforms, ao: THREE.Texture, rect: THREE.Vector4, map: MapGround): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: PLATE, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, map.uniforms, {
      uAo: { value: ao },
      uAoRect: { value: rect }
    });
    s.vertexShader =
      'varying vec3 vSite;\nvarying vec3 vBlkWorld;\nvarying vec3 vBlkNormalW;\n' +
      s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSite = transformed;\nvBlkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBlkNormalW = vec3(0.0, 1.0, 0.0);'
      );
    s.fragmentShader = siteLight(
      FRAG_SHARED +
        'uniform sampler2D uAo;\nuniform vec4 uAoRect;\nuniform vec2 uRim;\nuniform float uContact;\nuniform float uGround;\n' +
        groundChunk() +
        s.fragmentShader
    ).replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
// The map's ink, over the card where the map is in and fading in; the card itself elsewhere.
vec4 blkInk = blkMap(vSite.xz);
diffuseColor.rgb *= blkInk.rgb + (1.0 - blkInk.a);
diffuseColor.rgb *= 1.0 - uContact * texture2D(uAo, (vSite.xz - uAoRect.xy) / uAoRect.zw).r;
diffuseColor.a *= (1.0 - smoothstep(uRim.x, uRim.y, length(vSite.xz))) * uGround;
`
    );
  };
  mat.customProgramCacheKey = () => 'blk-site-plate';
  return mat;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** What a piece carries in aSpan when it needs nothing there. */
const NO_SPAN: readonly [number, number] = [0, 0];

/** One buffer for everything solid on the site, with the attributes the shading reads. */
class Solid {
  private pos: number[] = [];
  private nor: number[] = [];
  private info: number[] = [];
  private span: number[] = [];
  private idx: number[] = [];

  private vertex(p: THREE.Vector3, n: THREE.Vector3, storey: number, u: number, len: number, kind: number, span: readonly [number, number]): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.info.push(storey, u, len, kind);
    this.span.push(span[0], span[1]);
  }

  /** p0 to p1 along the bottom, p3 above p0; u runs from u0 at p0 to u1 at p1. Wound to agree with n. */
  quad(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    n: THREE.Vector3,
    storey: number,
    u0: number,
    u1: number,
    len: number,
    kind: number,
    span: readonly [number, number] = NO_SPAN
  ): void {
    const base = this.pos.length / 3;
    this.vertex(p0, n, storey, u0, len, kind, span);
    this.vertex(p1, n, storey, u1, len, kind, span);
    this.vertex(p2, n, storey, u1, len, kind, span);
    this.vertex(p3, n, storey, u0, len, kind, span);
    const e1 = p1.clone().sub(p0);
    const e2 = p2.clone().sub(p0);
    if (e1.cross(e2).dot(n) >= 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** Flat triangles at height y, facing up or down. */
  cap(tris: number[], y: number, up: boolean, storey: number): void {
    const n = new THREE.Vector3(0, up ? 1 : -1, 0);
    const base = this.pos.length / 3;
    for (let i = 0; i < tris.length; i += 2) this.vertex(new THREE.Vector3(tris[i], y, tris[i + 1]), n, storey, 0, 0, 1, NO_SPAN);
    for (let i = 0; i < tris.length / 2; i += 3) {
      const ax = tris[i * 2];
      const az = tris[i * 2 + 1];
      // Seen from above with north up, a triangle faces up when it turns anticlockwise.
      const cross = (tris[i * 2 + 2] - ax) * (tris[i * 2 + 5] - az) - (tris[i * 2 + 3] - az) * (tris[i * 2 + 4] - ax);
      if (cross < 0 === up) this.idx.push(base + i, base + i + 1, base + i + 2);
      else this.idx.push(base + i, base + i + 2, base + i + 1);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute('aSpan', new THREE.Float32BufferAttribute(this.span, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Footprint points (x east, y north) to the site frame. */
const site = (p: XY, y: number) => new THREE.Vector3(p[0], y, -p[1]);

/** Triangles covering a footprint part, holes respected, as flat x, z pairs in the site frame. */
function triangulate(part: Part): number[] {
  const contour = part.outer.map(([x, y]) => new THREE.Vector2(x, y));
  const holes = part.holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const all = [...contour, ...holes.flat()];
  const out: number[] = [];
  for (const tri of THREE.ShapeUtils.triangulateShape(contour, holes)) for (const i of tri) out.push(all[i].x, -all[i].y);
  return out;
}

function rings(parts: Part[]): Ring[] {
  return parts.flatMap((p) => [p.outer, ...p.holes]);
}

/** Even-odd test against every ring, so courtyards count as outside. */
function inside(x: number, y: number, all: Ring[]): boolean {
  let hit = false;
  for (const r of all)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  return hit;
}

function edgeDistance(x: number, y: number, all: Ring[]): number {
  let best = Infinity;
  for (const r of all)
    for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i];
      const [bx, by] = r[(i + 1) % r.length];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
  return best;
}

/** The point deepest inside the footprint, where a lift core would stand, and how far it is from any wall; `samples` across its narrow side. */
function deepest(parts: Part[], samples = 40): { x: number; y: number; d: number } {
  const all = rings(parts);
  const b = parts[0].outer.reduce((m, [x, y]) => ({ x0: Math.min(m.x0, x), y0: Math.min(m.y0, y), x1: Math.max(m.x1, x), y1: Math.max(m.y1, y) }), {
    x0: Infinity,
    y0: Infinity,
    x1: -Infinity,
    y1: -Infinity
  });
  const step = Math.max(0.5, Math.min(b.x1 - b.x0, b.y1 - b.y0) / samples);
  let best = { x: 0, y: 0, d: 0 };
  for (let y = b.y0 + step / 2; y < b.y1; y += step)
    for (let x = b.x0 + step / 2; x < b.x1; x += step) {
      if (!inside(x, y, all)) continue;
      const d = edgeDistance(x, y, all);
      if (d > best.d) best = { x, y, d };
    }
  return best;
}

/** The long direction of a ring, as a unit vector (x east, y north), from its edges weighted by length. */
function principal(r: Ring): XY {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i];
    const [bx, by] = r[(i + 1) % r.length];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    sxx += (dx * dx) / l;
    syy += (dy * dy) / l;
    sxy += (dx * dy) / l;
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [Math.cos(a), Math.sin(a)];
}

/** Whether a neighbour was built with the chosen block, as its number says (440B beside 440A). */
function sibling(n: Neighbour, spec: BlockSite): boolean {
  const stem = (s: string) => s.replace(/[A-Z]+$/i, '');
  const lettered = (s: string) => /\d[A-Z]$/i.test(s);
  return lettered(n.blk) && lettered(spec.block.blk) && stem(n.blk) === stem(spec.block.blk);
}

/** A neighbour built with the chosen block is likely to be as tall. */
function neighbourStoreys(n: Neighbour, spec: BlockSite): number {
  const given = spec.neighbourStoreys?.[n.postal];
  if (given && given > 0) return given;
  return sibling(n, spec) ? spec.storeys : NEIGHBOUR_STOREYS;
}

/** What this device already knows the neighbours to be, by postal code: the bundled snapshot and earlier lookups. */
function knownKinds(block: Block): Record<string, BuildingKind> {
  const out: Record<string, BuildingKind> = {};
  try {
    for (const h of knownNeighbourHeights(block).found) out[h.postal] = h.kind;
  } catch {
    // Knowing nothing is what the drawing falls back on anyway.
  }
  return out;
}

/**
 * How a neighbour is drawn: with flats only where HDB's records say it holds
 * them, or where it was built with the chosen block; a car park as open
 * decks; anything else, known or not, as a plain mass.
 */
function drawnAs(n: Neighbour, spec: BlockSite, kinds: Record<string, BuildingKind>): 'flats' | 'carpark' | 'plain' {
  const kind = kinds[n.postal];
  if (kind === 'residential' || (kind === undefined && sibling(n, spec))) return 'flats';
  return kind === 'carpark' ? 'carpark' : 'plain';
}

/**
 * The share of flats with a light on after dark at a time of day, minutes:
 * about six in ten in the evening, falling to four in ten after midnight. A
 * rough figure for how an estate's windows look, not a measurement.
 */
export function litShare(minutes: number): number {
  const h = (((minutes / 60) % 24) + 24) % 24;
  const at: [number, number][] = [
    [0, 0.42],
    [1, 0.4],
    [5, 0.4],
    [6, 0.47],
    [7, 0.5],
    [18, 0.5],
    [19, 0.56],
    [20, 0.6],
    [21.5, 0.6],
    [23, 0.5],
    [24, 0.42]
  ];
  for (let i = 1; i < at.length; i++) {
    if (h > at[i][0]) continue;
    const [x0, y0] = at[i - 1];
    const [x1, y1] = at[i];
    return y0 + ((y1 - y0) * (h - x0)) / (x1 - x0);
  }
  return at[0][1];
}

/** litShare at the hour the day's path puts the sun where it is; the evening's share with no path. */
export function litAt(sun: Sun, path: readonly PathPoint[]): number {
  const c = Math.cos(sun.altitude);
  const x = Math.sin(sun.azimuth) * c;
  const y = Math.sin(sun.altitude);
  const z = Math.cos(sun.azimuth) * c;
  let best = -2;
  let minutes = 20 * 60;
  for (const p of path) {
    const cp = Math.cos(p.altitude);
    const d = x * Math.sin(p.azimuth) * cp + y * Math.sin(p.altitude) + z * Math.cos(p.azimuth) * cp;
    if (d > best) {
      best = d;
      minutes = p.minutes;
    }
  }
  return litShare(minutes);
}

interface WallEdge {
  p: XY;
  q: XY;
  len: number;
  /** Metres along its run at p. */
  u0: number;
}

/** A stretch of wall from corner to corner, round any gentle curve: what a facade's bays are fitted to. */
interface WallRun {
  edges: WallEdge[];
  len: number;
  blank: boolean;
  /** Its outward normal and its middle, footprint frame. */
  normal: XY;
  mid: XY;
}

/**
 * A ring's walls as runs: straight on through the small turns a curved wall
 * is drawn with, broken at real corners and round any wall that must stay
 * blank, so bays are measured along the wall they belong to and fit it from
 * corner to corner, whichever way it faces.
 */
function wallRuns(r: Ring, blank: (p: XY, q: XY) => boolean): WallRun[] {
  const edges: { p: XY; q: XY; len: number; dx: number; dy: number; blank: boolean }[] = [];
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len >= 0.05) edges.push({ p, q, len, dx: (q[0] - p[0]) / len, dy: (q[1] - p[1]) / len, blank: blank(p, q) });
  }
  const n = edges.length;
  const starts = edges.map((e, i) => {
    const prev = edges[(i + n - 1) % n];
    return e.blank || prev.blank || prev.dx * e.dx + prev.dy * e.dy < CORNER;
  });
  // A ring with no corner at all is one run, all the way round.
  const first = Math.max(0, starts.indexOf(true));
  const runs: WallRun[] = [];
  let run: WallRun | null = null;
  for (let k = 0; k < n; k++) {
    const i = (first + k) % n;
    const e = edges[i];
    if (!run || starts[i]) {
      run = { edges: [], len: 0, blank: e.blank, normal: [0, 0], mid: [0, 0] };
      runs.push(run);
    }
    run.edges.push({ p: e.p, q: e.q, len: e.len, u0: run.len });
    run.len += e.len;
    run.normal[0] += e.dy * e.len;
    run.normal[1] -= e.dx * e.len;
    run.mid[0] += ((e.p[0] + e.q[0]) / 2) * e.len;
    run.mid[1] += ((e.p[1] + e.q[1]) / 2) * e.len;
  }
  for (const w of runs) {
    const l = Math.hypot(w.normal[0], w.normal[1]) || 1;
    w.normal = [w.normal[0] / l, w.normal[1] / l];
    w.mid = [w.mid[0] / w.len, w.mid[1] / w.len];
  }
  return runs;
}

/** Walls across the ends of a block's long axis narrower than two bays stay blank, as a block's end walls are. */
function blankEnds(runs: WallRun[], outer: Ring): void {
  const [ax, ay] = principal(outer);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of outer) {
    lo = Math.min(lo, x * ax + y * ay);
    hi = Math.max(hi, x * ax + y * ay);
  }
  for (const w of runs) {
    if (w.blank || w.len >= 2 * BAY) continue;
    const facing = w.normal[0] * ax + w.normal[1] * ay;
    const at = w.mid[0] * ax + w.mid[1] * ay;
    if ((facing > 0.8 && at > hi - 4) || (facing < -0.8 && at < lo + 4)) w.blank = true;
  }
}

/**
 * One plant room on a roof, the lift motor room or water tank every block
 * has, where the footprint is deepest and turned to its long axis, so it is
 * set back from every edge. Its height, or 0 where the footprint is too
 * slight to take one. Where the lifts really are is not known, so it says
 * nothing about them.
 */
function roofBox(solid: Solid, parts: Part[], roof: number, storey: number, samples: number): number {
  const core = deepest(parts, samples);
  if (core.d <= 2) return 0;
  const [ax, ay] = principal(parts[0].outer);
  const hu = Math.min(3.4, core.d * 0.8);
  const hv = Math.min(2.6, core.d * 0.6);
  const corner = (su: number, sv: number, y: number): THREE.Vector3 => site([core.x + ax * hu * su - ay * hv * sv, core.y + ay * hu * su + ax * hv * sv], roof + y);
  const faces: [number, number, number, number][] = [
    [1, -1, 1, 1],
    [1, 1, -1, 1],
    [-1, 1, -1, -1],
    [-1, -1, 1, -1]
  ];
  const c = site([core.x, core.y], roof);
  const span: [number, number] = [roof, BOX];
  for (const [su0, sv0, su1, sv1] of faces) {
    const a = corner(su0, sv0, 0);
    const b = corner(su1, sv1, 0);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const n = new THREE.Vector3(mid.x - c.x, 0, mid.z - c.z).normalize();
    solid.quad(a, b, corner(su1, sv1, BOX), corner(su0, sv0, BOX), n, storey, 0, 0, 0, 3, span);
  }
  const lid = [corner(-1, -1, BOX), corner(1, -1, BOX), corner(1, 1, BOX), corner(-1, 1, BOX)];
  solid.quad(lid[0], lid[1], lid[2], lid[3], new THREE.Vector3(0, 1, 0), storey, 0, 0, 0, 1);
  return BOX;
}

/** Font size the number is painted at on its canvas, px. Condensed figures stand about seven tenths of it. */
const FIG = 160;
const FIG_CAP = FIG * 0.7;
const FIG_PAD = 22;

/**
 * The block number as it is painted, in graphite on a transparent card:
 * across the wall, or one figure under another down a narrow end wall, as
 * on the tall point blocks. `cells` are the texture rectangles (u0, v0, u1,
 * v1) of each piece to place, top first, all FIG_CAP pixels to a figure's height.
 */
function paintNumber(label: string, vertical: boolean): { canvas: HTMLCanvasElement; cells: [number, number, number, number][]; cellW: number; cellH: number; redraw: () => void } {
  const canvas = document.createElement('canvas');
  const font = `700 ${FIG}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  const g = canvas.getContext('2d')!;
  g.font = font;
  const chars = vertical ? [...label] : [label];
  const cellW = Math.ceil(vertical ? FIG * 0.6 + FIG_PAD * 2 : Math.min(1400, g.measureText(label).width * 1.06 + FIG_PAD * 2));
  const cellH = Math.ceil(FIG_CAP + FIG_PAD * 2);
  canvas.width = cellW;
  canvas.height = cellH * chars.length;
  const redraw = () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#34363b';
    chars.forEach((c, i) => g.fillText(c, cellW / 2, i * cellH + FIG_PAD + FIG_CAP, cellW - FIG_PAD));
  };
  redraw();
  // The canvas is flipped on upload, so its top row is v = 1.
  const cells = chars.map((_, i): [number, number, number, number] => [0, 1 - ((i + 1) * cellH) / canvas.height, 1, 1 - (i * cellH) / canvas.height]);
  return { canvas, cells, cellW, cellH, redraw };
}

let measure: CanvasRenderingContext2D | null = null;

/**
 * The height of a figure, metres, for the number set on a wall `len` metres
 * wide on a block whose roof is at `top`: across the wall, or stacked. The
 * arrival view frames the whole block, so a figure has to grow with the
 * block's larger dimension, `frame`, to stay readable there: about a
 * twenty-first of it, kept between a storey and under three, the way the
 * painters size them, and within what the wall and the block's height allow.
 */
function figureHeight(label: string, len: number, top: number, frame: number, vertical: boolean): number {
  const n = [...label].length;
  const want = clamp(frame * 0.048, 2.4, 7.5);
  if (vertical) return Math.min(len * 1.02, want * 1.25, (top * 0.5) / (n * 1.4));
  measure ??= document.createElement('canvas').getContext('2d')!;
  measure.font = `700 ${FIG}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  // The number's width in figure heights.
  const across = Math.max(0.5, measure.measureText(label).width / FIG_CAP);
  return Math.min((len * 0.8) / across, want, top * 0.2);
}

/** A broad end wall takes the number across it; a narrow one, one figure under another, where each can stand far taller. */
function numberStacks(label: string, len: number, top: number, frame: number): boolean {
  return [...label].length > 1 && figureHeight(label, len, top, frame, true) > 1.35 * figureHeight(label, len, top, frame, false);
}

/**
 * The walls the number is painted on: one at each end of the block's long
 * axis, on the longest plain stretch of wall there, sized to fit it.
 */
function numberWalls(parts: Part[], list: Facade[]): { a: XY; b: XY; len: number }[] {
  const outer = parts[0].outer;
  const [ax, ay] = principal(outer);
  const out: { a: XY; b: XY; len: number }[] = [];
  for (const sign of [1, -1]) {
    // The outermost facades at this end first; the paint goes on the first with a real wall to take it.
    const ends = list
      .filter((f) => {
        if (f.part !== 0 || f.ring !== 0 || f.length < 4.5) return false;
        const nx = Math.sin((f.bearing * Math.PI) / 180);
        const ny = Math.cos((f.bearing * Math.PI) / 180);
        return (nx * ax + ny * ay) * sign >= 0.7;
      })
      .map((f) => ({ f, s: (f.mid[0] * ax + f.mid[1] * ay) * sign + f.length * 0.5 }))
      .sort((a, b) => b.s - a.s);
    for (const { f } of ends) {
      const wall = longestWall(outer, f);
      if (wall) {
        out.push(wall);
        break;
      }
    }
  }
  return out;
}

/** The longest real wall along a facade's measured line, if one is long enough to paint on. */
function longestWall(outer: Ring, best: Facade): { a: XY; b: XY; len: number } | null {
  const nx = Math.sin((best.bearing * Math.PI) / 180);
  const ny = Math.cos((best.bearing * Math.PI) / 180);
  const dx = (best.b[0] - best.a[0]) / best.length;
  const dy = (best.b[1] - best.a[1]) / best.length;
  let wall: { a: XY; b: XY; len: number } | null = null;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    const q = outer[(i + 1) % outer.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 2.5) continue;
    const enx = (q[1] - p[1]) / len;
    const eny = -(q[0] - p[0]) / len;
    if (enx * nx + eny * ny < 0.985) continue;
    const mx = (p[0] + q[0]) / 2 - best.a[0];
    const my = (p[1] + q[1]) / 2 - best.a[1];
    const t = mx * dx + my * dy;
    if (Math.abs(mx * nx + my * ny) > 2.6 || t < 0 || t > best.length) continue;
    if (!wall || len > wall.len) wall = { a: p, b: q, len };
  }
  return wall;
}

/** Contact shade round every footprint, baked once: the soft dark line where a model meets its table. */
function bakeContact(all: Part[][], radius: number, coarse: boolean): { tex: THREE.CanvasTexture; rect: THREE.Vector4 } {
  const n = coarse ? 512 : 1024;
  const k = n / (radius * 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  for (const parts of all)
    for (const p of parts) {
      g.beginPath();
      for (const r of [p.outer, ...p.holes]) {
        r.forEach(([x, y], i) => (i ? g.lineTo((x + radius) * k, (radius - y) * k) : g.moveTo((x + radius) * k, (radius - y) * k)));
        g.closePath();
      }
      g.fill('evenodd');
    }
  const img = g.getImageData(0, 0, n, n);
  const data = new Float32Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4] / 255;
  // About three metres of falloff, whatever the resolution.
  blur(data, n, n, Math.max(1, Math.round(1.6 * k)));
  for (let i = 0; i < data.length; i++) {
    const v = Math.round(255 * Math.min(1, data[i] * 1.6));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  return { tex, rect: new THREE.Vector4(-radius, -radius, radius * 2, radius * 2) };
}

function lineLoops(all: Ring[], y: number): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const r of all)
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      pts.push(a[0], y, -a[1], b[0], y, -b[1]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** What the table starts as, OneMap's map or the paper, and who to tell when the map comes on screen or goes, for its attribution. */
export interface SiteGround {
  kind?: GroundKind;
  onShown?: (shown: boolean) => void;
}

export function buildSite(spec: BlockSite, coarse: boolean, onRepaint: () => void, groundOpts: SiteGround = {}): SiteModel {
  const { block } = spec;
  const S = Math.max(1, Math.round(spec.storeys));
  const top = roofY(S);
  const parts = block.footprint.parts;
  const list = facades(block.footprint);
  const solid = new Solid();
  const root = new THREE.Group();

  const u: SiteUniforms = {
    uSplit: { value: 1e4 },
    uMove: { value: new THREE.Vector3() },
    uBand: { value: new THREE.Vector2(-10, -10) },
    uBandOn: { value: 0 },
    uNight: { value: 0 },
    uLit: { value: litShare(20 * 60) },
    uMark: { value: col(PAL.sun).clone() },
    uGlow: { value: new THREE.Color(0xffc98c).multiplyScalar(0.8) },
    uContact: { value: 0.3 },
    uGround: { value: 1 },
    uShade: { value: new THREE.Color(1, 1, 1) },
    uSunK: { value: 1 },
    uFog: { value: new THREE.Vector4() },
    uFogAt: { value: new THREE.Vector3() },
    uFogRange: { value: new THREE.Vector2(...STAGE_HAZE) },
    uRim: { value: new THREE.Vector2() },
    uHideMin: { value: new THREE.Vector3(1, 1, 1) },
    uHideMax: { value: new THREE.Vector3(-1, -1, -1) },
    uSiteShadow: { value: null },
    uSiteShadowMatrix: { value: new THREE.Matrix4() },
    uSiteShadowOn: { value: 0 },
    uSiteShadowSoft: { value: new THREE.Vector3(1e-3, 1e-3, 0.3) }
  };
  const cards = { uCard: { value: col(CARD).clone() }, uContext: { value: col(CONTEXT).clone() }, uRoof: { value: top } };

  // The walls the number is painted on stay blank, as a block's end walls are.
  const painted = numberWalls(parts, list);
  const blank = (p: XY, q: XY) => painted.some((w) => w.a === p && w.b === q);

  // A fraction that varies run to run, so no two walls lay out their stacks and lights alike. The same every build.
  let seed = 0;
  const nextSeed = () => 0.9 * Math.abs((Math.sin(++seed * 12.9898) * 43758.5453) % 1);
  // Building on the left, view on the right: the outward normal of (dx, dy) is (dy, -dx), and z is south.
  const normalOf = (e: WallEdge) => new THREE.Vector3((e.q[1] - e.p[1]) / e.len, 0, (e.q[0] - e.p[0]) / e.len);
  // A parapet is a skin: its inner face is the same wall seen from the roof.
  const parapet = (e: WallEdge, n: THREE.Vector3, storey: number, run: number, roof: number) => {
    const span: [number, number] = [roof, 0];
    const u1 = e.u0 + e.len;
    solid.quad(site(e.p, roof), site(e.q, roof), site(e.q, roof + PARAPET), site(e.p, roof + PARAPET), n, storey, e.u0, u1, run, 2, span);
    solid.quad(site(e.q, roof), site(e.p, roof), site(e.p, roof + PARAPET), site(e.q, roof + PARAPET), n.clone().negate(), storey, u1, e.u0, run, 2, span);
  };

  // ── The chosen block: every wall cut at every storey, so storeys can be marked and the block opened.
  parts.forEach((part, pi) =>
    [part.outer, ...part.holes].forEach((r, ri) => {
      const runs = wallRuns(r, blank);
      if (pi === 0 && ri === 0) blankEnds(runs, r);
      for (const run of runs) {
        // Kind 0 (a wall of flats) or 4 (a blank one), plus the run's own fraction.
        const wall = (run.blank ? 4 : 0) + nextSeed();
        for (const e of run.edges) {
          const n = normalOf(e);
          for (let k = 1; k <= S; k++) {
            const y0 = floorY(k);
            const y1 = k === S ? top : floorY(k + 1);
            solid.quad(site(e.p, y0), site(e.q, y0), site(e.q, y1), site(e.p, y1), n, k, e.u0, e.u0 + e.len, run.len, wall);
          }
          parapet(e, n, S, run.len, top);
        }
      }
    })
  );
  const tris = parts.map(triangulate);
  for (const t of tris) solid.cap(t, top, true, S);
  const plantH = roofBox(solid, parts, top, S, 40);

  // ── Neighbours, each as what it is known to be: flats, a car park's open decks, or a plain mass.
  const kinds = spec.neighbourKinds ?? knownKinds(block);
  let neighbourTop = 0;
  const outlines: Part[][] = [parts];
  const screens: { p: XY; q: XY; h: number }[] = [];
  const roofs: number[] = [];
  for (const nb of block.neighbours) {
    const storeys = neighbourStoreys(nb, spec);
    const h = roofY(storeys);
    const drawn = drawnAs(nb, spec, kinds);
    const rim = drawn === 'plain' ? 0 : PARAPET;
    const ends = drawn === 'flats' ? numberWalls(nb.footprint.parts, facades(nb.footprint)) : [];
    const endWall = (p: XY, q: XY) => ends.some((w) => w.a === p && w.b === q);
    // A car park's decks share its height evenly.
    const span: [number, number] = drawn === 'carpark' ? [0, h / Math.max(1, storeys)] : [0, 0];
    nb.footprint.parts.forEach((part, pi) =>
      [part.outer, ...part.holes].forEach((r, ri) => {
        const runs = wallRuns(r, endWall);
        if (drawn === 'flats' && pi === 0 && ri === 0) blankEnds(runs, r);
        for (const run of runs) {
          const wall = (drawn === 'flats' ? (run.blank ? 4 : 0) : drawn === 'carpark' ? 5 : 6) + nextSeed();
          for (const e of run.edges) {
            const n = normalOf(e);
            solid.quad(site(e.p, 0), site(e.q, 0), site(e.q, h), site(e.p, h), n, -1, e.u0, e.u0 + e.len, run.len, wall, span);
            if (rim) parapet(e, n, -1, run.len, h);
            if (e.len > 1) screens.push({ p: e.p, q: e.q, h: h + rim });
          }
        }
      })
    );
    for (const p of nb.footprint.parts) solid.cap(triangulate(p), h, true, -1);
    const plant = drawn === 'flats' ? roofBox(solid, nb.footprint.parts, h, -1, 14) : 0;
    neighbourTop = Math.max(neighbourTop, h + Math.max(rim, plant));
    outlines.push(nb.footprint.parts);
    roofs.push(h + rim);
  }

  const solidMat = siteShade(new THREE.MeshLambertMaterial({ color: col(PAL.wall) }), u, cards, 'blk-site', FRAG_COLOR);
  const solidMesh = new THREE.Mesh(solid.build(), solidMat);
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  solidMesh.customDepthMaterial = siteDepth(u);
  root.add(solidMesh);

  // ── The section, rebuilt for whichever storey the block opens at.
  const capMesh = new THREE.Mesh(new THREE.BufferGeometry(), solidMat);
  capMesh.receiveShadow = true;
  capMesh.visible = false;
  root.add(capMesh);
  const split = (n: number) => {
    const c = new Solid();
    // The floor the flat stands on sits just under the flat's own slab, so the two never fight.
    for (const t of tris) c.cap(t, floorY(n) - 0.15, true, n - 1);
    for (const t of tris) c.cap(t, floorY(n), false, n);
    capMesh.geometry.dispose();
    capMesh.geometry = c.build();
  };

  // ── Lines: the chosen block's roofline in graphite, the neighbours' fainter.
  const lines = new THREE.LineSegments(lineLoops(rings(parts), top + PARAPET), new THREE.LineBasicMaterial({ color: PAL.capSolid, transparent: true, opacity: 0.7 }));
  root.add(lines);
  const faintPts: THREE.BufferGeometry[] = block.neighbours.map((nb, i) => lineLoops(rings(nb.footprint.parts), roofs[i]));
  const faintGeo = mergeLines(faintPts);
  const faint = new THREE.LineSegments(faintGeo, new THREE.LineBasicMaterial({ color: PAL.capSolid, transparent: true, opacity: 0.22 }));
  root.add(faint);

  // ── The block number, near the top of each end wall. One way of setting it for both walls, so one texture serves.
  const label = spec.label.trim() || block.blk;
  const spread = block.footprint.bounds;
  const frame = Math.max(top + PARAPET, spread.maxX - spread.minX, spread.maxY - spread.minY);
  const vertical = painted.length > 0 && numberStacks(label, Math.min(...painted.map((w) => w.len)), top, frame);
  const paint = paintNumber(label, vertical);
  const numTex = new THREE.CanvasTexture(paint.canvas);
  numTex.colorSpace = THREE.SRGBColorSpace;
  numTex.anisotropy = 8;
  const decal = new Solid();
  const uv: number[] = [];
  const numbers: PaintedNumber[] = [];
  for (const w of painted) {
    // Metres to a canvas pixel, from the height a figure stands.
    const k = figureHeight(label, w.len, top, frame, vertical) / FIG_CAP;
    const cw = paint.cellW * k;
    const ch = paint.cellH * k;
    const dx = (w.b[0] - w.a[0]) / w.len;
    const dy = (w.b[1] - w.a[1]) / w.len;
    const n = new THREE.Vector3(dy, 0, dx);
    const off = 0.06;
    const mx = (w.a[0] + w.b[0]) / 2 + dy * off;
    const my = (w.a[1] + w.b[1]) / 2 - dx * off;
    const at = (s: number, y: number) => site([mx + dx * s, my + dy * s], y);
    // The first figure's top a little under the parapet, as the painters set it.
    const y1 = top - 1.3 + FIG_PAD * k;
    paint.cells.forEach(([u0, v0, u1, v1], i) => {
      const hi = y1 - i * ch;
      const lo = hi - ch;
      // Each figure on its own storey, so it lifts or sinks with that storey in the push-in.
      decal.quad(at(-cw / 2, lo), at(cw / 2, lo), at(cw / 2, hi), at(-cw / 2, hi), n, storeyAt((lo + hi) / 2, S), 0, 0, 0, 1);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    });
    numbers.push({ at: at(0, y1 - (ch * paint.cells.length) / 2), normal: n.clone(), height: k * FIG_CAP });
  }
  const decalGeo = decal.build();
  decalGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const decalMat = siteShade(
    new THREE.MeshLambertMaterial({ map: numTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    u,
    cards,
    'blk-site-paint',
    FRAG_SIGN
  );
  const decals = new THREE.Mesh(decalGeo, decalMat);
  decals.receiveShadow = true;
  decals.renderOrder = 1;
  root.add(decals);
  // The page's own figures may still be loading; repaint once they are here.
  const font = `700 ${FIG}px "Barlow Condensed"`;
  if (document.fonts && !document.fonts.check(font))
    void document.fonts.load(font).then(() => {
      paint.redraw();
      numTex.needsUpdate = true;
      onRepaint();
    });

  // ── The table.
  let reach = 0;
  for (const o of outlines) for (const p of o) for (const [x, y] of p.outer) reach = Math.max(reach, Math.hypot(x, y));
  const radius = Math.max(120, reach + 45);
  u.uRim.value.set(radius * 0.32, radius * 0.92);
  const contact = bakeContact(outlines, radius, coarse);
  // The block's own map, kept from the last site when this is the same block rebuilt, so it does not fade in again.
  const map = groundFor(block, radius, { onRepaint, onShown: groundOpts.onShown });
  map.setKind(groundOpts.kind ?? 'map');
  const gPos = [-radius, 0, -radius, radius, 0, -radius, radius, 0, radius, -radius, 0, radius];
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  gGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  gGeo.setIndex([0, 2, 1, 0, 3, 2]);
  const ground = new THREE.Mesh(gGeo, groundMaterial(u, contact.tex, contact.rect, map));
  ground.receiveShadow = true;
  ground.renderOrder = -1;
  // Drawing the table is what starts the map's tiles, once the light is known; the ground beyond asks for the far field.
  ground.onBeforeRender = () => map.frame(u.uNight.value, false);
  root.add(ground);
  // The same ground on beyond the table, square ring by square ring, in the table's own material so the two meet without a seam.
  const reachFar = Math.max(radius * 14, FAR_GROUND);
  const fPos: number[] = [];
  for (const r of [radius, reachFar]) fPos.push(-r, 0, -r, r, 0, -r, r, 0, r, -r, 0, r);
  const fIdx: number[] = [];
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    fIdx.push(k, k1, 4 + k1, k, 4 + k1, 4 + k);
  }
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  fGeo.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: 8 }, () => [0, 1, 0]).flat(), 3));
  fGeo.setIndex(fIdx);
  const far = new THREE.Mesh(fGeo, ground.material);
  far.receiveShadow = true;
  far.renderOrder = -1;
  far.visible = false;
  far.onBeforeRender = () => map.frame(u.uNight.value, true);
  root.add(far);

  // ── Picking, analytically against the footprint: cheaper and steadier than the meshes.
  const walls: { p: XY; q: XY; len: number }[] = [];
  for (const r of rings(parts))
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const q = r[(i + 1) % r.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len > 0.05) walls.push({ p, q, len });
    }
  const allRings = rings(parts);
  const hit = (ray: THREE.Ray): BlockHit | null => {
    const o = ray.origin;
    const d = ray.direction;
    let best: BlockHit | null = null;
    // In footprint terms the ray runs (x, -z).
    const ox = o.x;
    const oy = -o.z;
    const dx = d.x;
    const dy = -d.z;
    for (const w of walls) {
      const ex = w.q[0] - w.p[0];
      const ey = w.q[1] - w.p[1];
      const nx = ey / w.len;
      const ny = -ex / w.len;
      // Only the outside of a wall can be pointed at.
      if (dx * nx + dy * ny >= 0) continue;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((w.p[0] - ox) * ey - (w.p[1] - oy) * ex) / den;
      const s = ((w.p[0] - ox) * dy - (w.p[1] - oy) * dx) / den;
      if (t <= 0 || s < 0 || s > 1 || (best && t >= best.distance)) continue;
      const y = o.y + d.y * t;
      if (y < 0 || y > top + PARAPET) continue;
      best = { point: ray.at(t, new THREE.Vector3()), normal: new THREE.Vector3(nx, 0, -ny), distance: t, roof: false };
    }
    if (d.y < -1e-6) {
      const t = (top - o.y) / d.y;
      if (t > 0 && (!best || t < best.distance)) {
        const p = ray.at(t, new THREE.Vector3());
        if (inside(p.x, -p.z, allRings)) best = { point: p, normal: new THREE.Vector3(0, 1, 0), distance: t, roof: true };
      }
    }
    return best;
  };

  const hidden = (from: THREE.Vector3, to: THREE.Vector3): boolean => {
    const ax = from.x;
    const ay = -from.z;
    const dx = to.x - ax;
    const dy = -to.z - ay;
    for (const w of screens) {
      const ex = w.q[0] - w.p[0];
      const ey = w.q[1] - w.p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((w.p[0] - ax) * ey - (w.p[1] - ay) * ex) / den;
      const s = ((w.p[0] - ax) * dy - (w.p[1] - ay) * dx) / den;
      if (t > 0 && t < 1 && s >= 0 && s <= 1 && from.y + (to.y - from.y) * t < w.h) return true;
    }
    return false;
  };

  const facadeAt = (point: THREE.Vector3, normal: THREE.Vector3): { index: number; along: number } | null => {
    const px = point.x;
    const py = -point.z;
    let best: { index: number; along: number } | null = null;
    let bestD = 4;
    list.forEach((f, index) => {
      const nx = Math.sin((f.bearing * Math.PI) / 180);
      const ny = Math.cos((f.bearing * Math.PI) / 180);
      if (normal.x * nx - normal.z * ny < 0.6) return;
      const dx = (f.b[0] - f.a[0]) / f.length;
      const dy = (f.b[1] - f.a[1]) / f.length;
      const t = (px - f.a[0]) * dx + (py - f.a[1]) * dy;
      const off = Math.abs((px - f.a[0]) * nx + (py - f.a[1]) * ny);
      const dist = off + Math.max(0, -t, t - f.length);
      if (dist < bestD) {
        bestD = dist;
        best = { index, along: clamp(t / f.length, 0, 1) };
      }
    });
    return best;
  };

  const box = new THREE.Box3();
  for (const p of parts) for (const q of p.outer) box.expandByPoint(site(q, 0));
  box.max.y = top + PARAPET;

  return {
    root,
    solid: solidMesh,
    caps: capMesh,
    lines,
    faint,
    ground,
    far,
    groundReach: reachFar,
    map,
    u,
    storeys: S,
    top,
    peak: Math.max(top + Math.max(PARAPET, plantH), neighbourTop),
    radius,
    neighbourTop,
    facades: list,
    numbers,
    box,
    hit,
    hidden,
    facadeAt,
    split,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose();
        m.customDepthMaterial?.dispose();
      });
      numTex.dispose();
      contact.tex.dispose();
      letGo(map);
    }
  };
}

function mergeLines(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const g of list) {
    pts.push(...(g.getAttribute('position').array as Float32Array));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return out;
}
