import * as THREE from 'three';
import { facades } from '../data/facades';
import type { Block, Facade, Neighbour, Part, Ring, XY } from '../data/types';
import { blur } from './floorTexture';
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
uniform float uSplit;
uniform vec3 uMove;
varying vec4 vInfo;
varying vec3 vSite;
varying vec3 vBlkWorld;
varying float vLow;
`;

// aInfo: x the storey (chosen block, from 1) or -1 (a neighbour); y metres along the wall; z the wall's
// length; w the kind (0 wall, 1 roof or section, 2 parapet, 3 lift core, 4 a blank wall that carries
// the painted number) plus a per-wall seed below 1.
const VERT_BODY = /* glsl */ `
vInfo = aInfo;
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
varying vec4 vInfo;
varying float vLow;
float blkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/** Pieces sinking into the table are cut off at its surface, and the chosen block steps aside for a flat seen from inside. */
const FRAG_CLIP = /* glsl */ `
if (vLow < -0.02) discard;
if (vInfo.x > 0.5 && all(greaterThan(vBlkWorld, uHideMin)) && all(lessThan(vBlkWorld, uHideMax))) discard;
`;

const G = GROUND.toFixed(2);
const S = STOREY.toFixed(2);
const P = PARAPET.toFixed(2);

/**
 * The block's face, drawn rather than modelled. The chosen block is warm
 * card with slab edges in graphite at true storey height, a band of windows
 * on every storey broken into bays, a void deck open and in its own shade
 * between columns, a coping line round the roof, and the marked storey in
 * the sun's orange. Its neighbours are cooler, plainer card that only light
 * their windows after dark. Every line is about a pixel wide at any distance,
 * and every pattern gives way to its average before it could shimmer.
 */
const FRAG_COLOR = /* glsl */ `
${FRAG_CLIP}
float blkKind = floor(vInfo.w + 0.001);
float blkSeed = fract(vInfo.w + 0.001);
bool blkMain = vInfo.x > 0.5;
float blkY = vSite.y;
float blkPx = max(fwidth(blkY), 1e-4);
const vec3 blkInk = vec3(0.046, 0.05, 0.058);
vec3 blkC = blkMain ? uCard : uContext;
if (!blkMain) {
  blkDirect = 0.78;
  blkSky = 1.22;
}
if (blkKind < 0.5 || blkKind > 3.5) {
  bool blank = blkKind > 3.5;
  float st = blkMain ? vInfo.x : (blkY < ${G} ? 1.0 : 2.0 + floor((blkY - ${G}) / ${S}));
  float h = blkY - (st < 1.5 ? 0.0 : ${G} + (st - 2.0) * ${S});
  float u = vInfo.y;
  float len = vInfo.z;
  float lvl = ${G} + max(0.0, floor((blkY - ${G}) / ${S} + 0.5)) * ${S};
  float line = (1.0 - smoothstep(0.35 * blkPx, 1.35 * blkPx, abs(blkY - lvl))) * (1.0 - smoothstep(blkMain ? 0.3 : 0.16, blkMain ? 0.8 : 0.4, blkPx));
  // Windows: a band on every storey, in bays about 3.3 m apart with piers between.
  float bays = max(1.0, floor(len / 3.3 + 0.5));
  float bay = len / bays;
  float fx = fract(u / bay);
  float pu = max(fwidth(u) / bay, 1e-4);
  float wx = smoothstep(0.17 - pu, 0.17 + pu, fx) * (1.0 - smoothstep(0.83 - pu, 0.83 + pu, fx));
  wx = mix(wx, 0.66, smoothstep(0.08, 0.3, pu));
  float wy = smoothstep(0.85, 0.85 + blkPx, h) * (1.0 - smoothstep(2.2 - blkPx, 2.2, h));
  wy = mix(wy, 0.48, smoothstep(0.3, 0.8, blkPx));
  float win = st > 1.5 && len > 1.6 && !blank ? wx * wy : 0.0;
  float deck = 0.0;
  if (blkMain && st < 1.5) {
    float column = max(step(u, 0.6), step(len - 0.6, u));
    if (len > 8.0) column = max(column, step(fract(u / 6.5 + 0.5), 0.1));
    deck = (1.0 - column) * (1.0 - smoothstep(3.0, 3.0 + blkPx, h));
  }
  if (blkMain) {
    blkC = mix(blkC, vec3(0.13, 0.17, 0.22), 0.5 * win);
    // The void deck is open: its shade, between columns, reads as a way through.
    blkC = mix(blkC, vec3(0.055, 0.052, 0.05), 0.82 * deck);
  }
  blkC = mix(blkC, blkInk, (blkMain ? 0.52 : 0.14) * line);
  // After dark, about half the windows are lit, each its own warmth; neighbours fewer and fainter, void decks all night.
  float r = blkHash(vec2(st + blkSeed * 37.0, floor(u / bay) + blkSeed * 91.0));
  float lit = step(blkMain ? 0.45 : 0.6, r) * (0.55 + 0.45 * fract(r * 13.7));
  float wn = st > 1.5 && len > 1.6 && !blank ? wx * wy : 0.0;
  // A lit window also spills a little warmth onto the wall round it, so at night it reads as glow, not as a hole.
  float spill = st > 1.5 && len > 1.6 && !blank ? 0.16 : 0.0;
  totalEmissiveRadiance += uGlow * uNight * ((blkMain ? 1.0 : 0.85) * (wn + spill) * lit + 0.4 * deck);
  if (blkMain) {
    float inBand = smoothstep(uBand.x - blkPx, uBand.x, blkY) * (1.0 - smoothstep(uBand.y, uBand.y + blkPx, blkY));
    float rim = 1.0 - smoothstep(0.6 * blkPx, 1.7 * blkPx, min(abs(blkY - uBand.x), abs(blkY - uBand.y)));
    // The storey is tinted a light peach, so the flat's own patch, in the sun's full orange, stands out of it.
    blkC = mix(blkC, mix(uMark, vec3(1.0), 0.34) * (1.0 - 0.18 * win), 0.74 * uBandOn * inBand);
    blkC = mix(blkC, uMark * 0.35, 0.9 * uBandOn * rim);
    totalEmissiveRadiance += uMark * uBandOn * inBand * (0.14 + 0.45 * uNight);
  }
} else if (blkKind < 1.5) {
  blkC *= blkMain ? 0.93 : 0.96;
} else if (blkKind < 2.5) {
  // The parapet: a slab edge at the roof and a crisp coping along its top.
  float hp = blkY - uRoof;
  float edge = max(1.0 - smoothstep(0.4 * blkPx, 1.5 * blkPx, abs(hp)), 1.0 - smoothstep(0.0, 1.6 * blkPx, ${P} - hp));
  blkC = mix(blkC * mix(1.0, 0.9, smoothstep(${P} - 0.25 - blkPx, ${P} - 0.25, hp)), blkInk, 0.6 * edge);
}
diffuseColor.rgb = blkC;
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
 * sweep.
 */
function groundMaterial(u: SiteUniforms, ao: THREE.Texture, rect: THREE.Vector4): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: PLATE, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, {
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
        s.fragmentShader
    ).replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
diffuseColor.rgb *= 1.0 - uContact * texture2D(uAo, (vSite.xz - uAoRect.xy) / uAoRect.zw).r;
diffuseColor.a *= (1.0 - smoothstep(uRim.x, uRim.y, length(vSite.xz))) * uGround;
`
    );
  };
  mat.customProgramCacheKey = () => 'blk-site-plate';
  return mat;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** One buffer for everything solid on the site, with the attribute the shading reads. */
class Solid {
  private pos: number[] = [];
  private nor: number[] = [];
  private info: number[] = [];
  private idx: number[] = [];

  private vertex(p: THREE.Vector3, n: THREE.Vector3, storey: number, u: number, len: number, kind: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.info.push(storey, u, len, kind);
  }

  /** p0 to p1 along the bottom, p3 above p0; u runs from u0 at p0 to u1 at p1. Wound to agree with n. */
  quad(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, n: THREE.Vector3, storey: number, u0: number, u1: number, len: number, kind: number): void {
    const base = this.pos.length / 3;
    this.vertex(p0, n, storey, u0, len, kind);
    this.vertex(p1, n, storey, u1, len, kind);
    this.vertex(p2, n, storey, u1, len, kind);
    this.vertex(p3, n, storey, u0, len, kind);
    const e1 = p1.clone().sub(p0);
    const e2 = p2.clone().sub(p0);
    if (e1.cross(e2).dot(n) >= 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** Flat triangles at height y, facing up or down. */
  cap(tris: number[], y: number, up: boolean, storey: number): void {
    const n = new THREE.Vector3(0, up ? 1 : -1, 0);
    const base = this.pos.length / 3;
    for (let i = 0; i < tris.length; i += 2) this.vertex(new THREE.Vector3(tris[i], y, tris[i + 1]), n, storey, 0, 0, 1);
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

/** The point deepest inside the footprint, where a lift core would stand, and how far it is from any wall. */
function deepest(parts: Part[]): { x: number; y: number; d: number } {
  const all = rings(parts);
  const b = parts[0].outer.reduce((m, [x, y]) => ({ x0: Math.min(m.x0, x), y0: Math.min(m.y0, y), x1: Math.max(m.x1, x), y1: Math.max(m.y1, y) }), {
    x0: Infinity,
    y0: Infinity,
    x1: -Infinity,
    y1: -Infinity
  });
  const step = Math.max(0.5, Math.min(b.x1 - b.x0, b.y1 - b.y0) / 40);
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

/** A neighbour built with the chosen block, as its number says (440B beside 440A), is likely to be as tall. */
function neighbourStoreys(n: Neighbour, spec: BlockSite): number {
  const given = spec.neighbourStoreys?.[n.postal];
  if (given && given > 0) return given;
  const stem = (s: string) => s.replace(/[A-Z]+$/i, '');
  const lettered = (s: string) => /\d[A-Z]$/i.test(s);
  return lettered(n.blk) && lettered(spec.block.blk) && stem(n.blk) === stem(spec.block.blk) ? spec.storeys : NEIGHBOUR_STOREYS;
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

export function buildSite(spec: BlockSite, coarse: boolean, onRepaint: () => void): SiteModel {
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

  // ── The chosen block: every wall cut at every storey, so storeys can be marked and the block opened.
  let seed = 0;
  for (const r of rings(parts)) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const q = r[(i + 1) % r.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      // Building on the left, view on the right: the outward normal of (dx, dy) is (dy, -dx), and z is south.
      const n = new THREE.Vector3((q[1] - p[1]) / len, 0, (q[0] - p[0]) / len);
      // Kind 0 (a wall) or 4 (a blank one), plus a fraction that varies wall to wall, for which windows are lit at night.
      const wall = (blank(p, q) ? 4 : 0) + 0.9 * Math.abs((Math.sin(++seed * 12.9898) * 43758.5453) % 1);
      for (let k = 1; k <= S; k++) {
        const y0 = floorY(k);
        const y1 = k === S ? top : floorY(k + 1);
        solid.quad(site(p, y0), site(q, y0), site(q, y1), site(p, y1), n, k, 0, len, len, wall);
      }
      // The parapet is a skin: its inner face is the same wall seen from the roof.
      solid.quad(site(p, top), site(q, top), site(q, top + PARAPET), site(p, top + PARAPET), n, S, 0, len, len, 2);
      solid.quad(site(q, top), site(p, top), site(p, top + PARAPET), site(q, top + PARAPET), n.clone().negate(), S, 0, len, len, 2);
    }
  }
  const tris = parts.map(triangulate);
  for (const t of tris) solid.cap(t, top, true, S);

  // The lift core's motor room, where the footprint is deepest, turned to the block's long axis.
  const core = deepest(parts);
  if (core.d > 2) {
    const [ax, ay] = principal(parts[0].outer);
    const hu = Math.min(3.4, core.d * 0.8);
    const hv = Math.min(2.6, core.d * 0.6);
    const h = 3.2;
    const corner = (su: number, sv: number, y: number): THREE.Vector3 =>
      site([core.x + ax * hu * su - ay * hv * sv, core.y + ay * hu * su + ax * hv * sv], top + y);
    const faces: [number, number, number, number][] = [
      [1, -1, 1, 1],
      [1, 1, -1, 1],
      [-1, 1, -1, -1],
      [-1, -1, 1, -1]
    ];
    for (const [su0, sv0, su1, sv1] of faces) {
      const a = corner(su0, sv0, 0);
      const b = corner(su1, sv1, 0);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const c = site([core.x, core.y], top);
      const n = new THREE.Vector3(mid.x - c.x, 0, mid.z - c.z).normalize();
      solid.quad(a, b, corner(su1, sv1, h), corner(su0, sv0, h), n, S, 0, 0, 0, 3);
    }
    const lid = [corner(-1, -1, h), corner(1, -1, h), corner(1, 1, h), corner(-1, 1, h)];
    solid.quad(lid[0], lid[1], lid[2], lid[3], new THREE.Vector3(0, 1, 0), S, 0, 0, 0, 3);
  }

  // ── Neighbours: plain extrusions, one wall per edge.
  let neighbourTop = 0;
  const outlines: Part[][] = [parts];
  const screens: { p: XY; q: XY; h: number }[] = [];
  for (const nb of block.neighbours) {
    const h = roofY(neighbourStoreys(nb, spec));
    neighbourTop = Math.max(neighbourTop, h);
    outlines.push(nb.footprint.parts);
    for (const r of rings(nb.footprint.parts))
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 0.05) continue;
        const n = new THREE.Vector3((q[1] - p[1]) / len, 0, (q[0] - p[0]) / len);
        solid.quad(site(p, 0), site(q, 0), site(q, h), site(p, h), n, -1, 0, len, len, 0);
        if (len > 1) screens.push({ p, q, h });
      }
    for (const p of nb.footprint.parts) solid.cap(triangulate(p), h, true, -1);
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
  const faintPts: THREE.BufferGeometry[] = block.neighbours.map((nb) => lineLoops(rings(nb.footprint.parts), roofY(neighbourStoreys(nb, spec))));
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
  const gPos = [-radius, 0, -radius, radius, 0, -radius, radius, 0, radius, -radius, 0, radius];
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  gGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  gGeo.setIndex([0, 2, 1, 0, 3, 2]);
  const ground = new THREE.Mesh(gGeo, groundMaterial(u, contact.tex, contact.rect));
  ground.receiveShadow = true;
  ground.renderOrder = -1;
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
    u,
    storeys: S,
    top,
    peak: Math.max(top + PARAPET + (core.d > 2 ? 3.2 : 0), neighbourTop),
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
