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
  /** Added to the neighbours so they step back behind the chosen block. */
  uHaze: THREE.IUniform<THREE.Color>;
  /** The table: strength of the sun's shadow, of the contact shade, and of the whole table. */
  uCast: THREE.IUniform<number>;
  uContact: THREE.IUniform<number>;
  uGround: THREE.IUniform<number>;
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
varying float vLow;
`;

// aInfo: x the storey (chosen block, from 1) or -1 (a neighbour); y metres along the wall; z the wall's
// length; w the kind (0 wall, 1 roof or section, 2 parapet, 3 lift core) plus a per-wall seed below 1.
const VERT_BODY = /* glsl */ `
vInfo = aInfo;
vSite = transformed;
transformed.y += aInfo.x > 0.5 ? (aInfo.x > uSplit - 0.5 ? uMove.x : -uMove.y) : -uMove.z;
vLow = transformed.y;
`;

const FRAG_HEAD = /* glsl */ `
uniform vec2 uBand;
uniform float uBandOn;
uniform float uNight;
uniform vec3 uMark;
uniform vec3 uGlow;
uniform vec3 uHaze;
varying vec4 vInfo;
varying vec3 vSite;
varying float vLow;
float blkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/**
 * The block's face, drawn rather than modelled: slab edges at true storey
 * height, a band of windows on every storey, the void deck's shade between
 * its columns, and the marked storey in the sun's orange. Lines are about a
 * pixel wide at any distance and fade out before they could crowd into a
 * grey, so the far blocks stay quiet.
 */
const FRAG_COLOR = /* glsl */ `
// Pieces sinking into the table are cut off at its surface.
if (vLow < -0.02) discard;
float blkKind = floor(vInfo.w + 0.001);
float blkSeed = fract(vInfo.w + 0.001);
bool blkMain = vInfo.x > 0.5;
float blkY = vSite.y;
float blkPx = max(fwidth(blkY), 1e-4);
vec3 blkC = diffuseColor.rgb;
if (blkKind < 0.5) {
  float st = blkMain ? vInfo.x : (blkY < ${GROUND.toFixed(1)} ? 1.0 : 2.0 + floor((blkY - ${GROUND.toFixed(1)}) / ${STOREY.toFixed(1)}));
  float h = blkY - (st < 1.5 ? 0.0 : ${GROUND.toFixed(1)} + (st - 2.0) * ${STOREY.toFixed(1)});
  float u = vInfo.y;
  float len = vInfo.z;
  float lvl = ${GROUND.toFixed(1)} + max(0.0, floor((blkY - ${GROUND.toFixed(1)}) / ${STOREY.toFixed(1)} + 0.5)) * ${STOREY.toFixed(1)};
  float line = (1.0 - smoothstep(0.3 * blkPx, 1.3 * blkPx, abs(blkY - lvl))) * (1.0 - smoothstep(0.22, 0.6, blkPx));
  float win = 0.0;
  float deck = 0.0;
  if (blkMain && st > 1.5) {
    float along = step(1.6, len) * smoothstep(0.35, 0.35 + blkPx, u) * (1.0 - smoothstep(len - 0.35 - blkPx, len - 0.35, u));
    win = along * smoothstep(0.9, 0.9 + blkPx, h) * (1.0 - smoothstep(2.15 - blkPx, 2.15, h));
  } else if (blkMain) {
    float column = max(step(u, 0.55), step(len - 0.55, u));
    if (len > 8.0) column = max(column, step(fract(u / 6.5 + 0.5), 0.09));
    deck = (1.0 - column) * (1.0 - smoothstep(3.05, 3.05 + blkPx, h));
  }
  blkC = mix(blkC, vec3(0.42, 0.5, 0.56), 0.3 * win);
  blkC *= 1.0 - 0.52 * deck;
  blkC = mix(blkC, vec3(0.046, 0.05, 0.058), (blkMain ? 0.36 : 0.15) * line);
  // At night some windows are lit, each its own warmth, and void decks keep their lights on.
  float r = blkHash(vec2(st + blkSeed * 37.0, floor(u / 2.6) + blkSeed * 91.0));
  totalEmissiveRadiance += uGlow * uNight * (win * step(0.52, r) * (0.5 + 0.5 * fract(r * 13.7)) + 0.3 * deck);
  if (blkMain) {
    float inBand = smoothstep(uBand.x - blkPx, uBand.x, blkY) * (1.0 - smoothstep(uBand.y, uBand.y + blkPx, blkY));
    float rim = 1.0 - smoothstep(0.7 * blkPx, 1.8 * blkPx, min(abs(blkY - uBand.x), abs(blkY - uBand.y)));
    blkC = mix(blkC, uMark, 0.6 * uBandOn * inBand);
    blkC = mix(blkC, uMark * 0.45, 0.85 * uBandOn * rim);
    totalEmissiveRadiance += uMark * uBandOn * inBand * (0.08 + 0.45 * uNight);
  }
} else if (blkKind < 1.5) {
  blkC *= 0.94;
}
if (!blkMain) totalEmissiveRadiance += uHaze;
diffuseColor.rgb = blkC;
`;

function siteShade<T extends THREE.Material>(mat: T, u: SiteUniforms, key: string, pattern: boolean): T {
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = VERT_HEAD + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
    let fs = FRAG_HEAD + s.fragmentShader.replace('#include <shadowmap_pars_fragment>', softShadowChunk());
    fs = pattern
      ? fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      : fs.replace('#include <color_fragment>', '#include <color_fragment>\nif (vLow < -0.02) discard;\n');
    s.fragmentShader = fs;
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
 * The table under the site: it draws only shade, the sun's shadows and a soft
 * contact shadow round every block, over the page itself, and fades out at
 * its rim the way the flat's table does.
 */
function groundMaterial(u: SiteUniforms, ao: THREE.Texture, rect: THREE.Vector4, radius: number): THREE.ShadowMaterial {
  const mat = new THREE.ShadowMaterial({ color: 0x2a2218, opacity: 1, depthWrite: false });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uAo: { value: ao },
      uAoRect: { value: rect },
      uRim: { value: new THREE.Vector2(radius * 0.55, radius) },
      uCast: u.uCast,
      uContact: u.uContact,
      uGround: u.uGround
    });
    s.vertexShader = 'varying vec2 vGround;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;');
    s.fragmentShader =
      'uniform sampler2D uAo;\nuniform vec4 uAoRect;\nuniform vec2 uRim;\nuniform float uCast;\nuniform float uContact;\nuniform float uGround;\nvarying vec2 vGround;\n' +
      s.fragmentShader
        .replace('#include <shadowmap_pars_fragment>', softShadowChunk())
        .replace(
          'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
          /* glsl */ `
float blkCast = uCast * (1.0 - getShadowMask());
float blkAo = uContact * texture2D(uAo, (vGround - uAoRect.xy) / uAoRect.zw).r;
float blkRim = 1.0 - smoothstep(uRim.x, uRim.y, length(vGround));
gl_FragColor = vec4(color, (1.0 - (1.0 - blkCast) * (1.0 - blkAo)) * blkRim * uGround);
`
        );
  };
  mat.customProgramCacheKey = () => 'blk-site-ground';
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

/** The block number as it is painted: tall condensed figures in graphite, on a transparent card. */
function paintNumber(label: string): { canvas: HTMLCanvasElement; aspect: number; redraw: () => void } {
  const canvas = document.createElement('canvas');
  const font = '700 150px "Barlow Condensed", "Arial Narrow", sans-serif';
  const g = canvas.getContext('2d')!;
  g.font = font;
  const width = Math.ceil(Math.min(900, g.measureText(label).width * 1.08 + 30));
  canvas.width = width;
  canvas.height = 150;
  const redraw = () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#3d3f44';
    // Figures sit on the baseline; condensed caps are about seven tenths of the size.
    g.fillText(label, width / 2, 128, width - 20);
  };
  redraw();
  return { canvas, aspect: width / canvas.height, redraw };
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
    let best: Facade | null = null;
    let score = -Infinity;
    for (const f of list) {
      if (f.part !== 0 || f.ring !== 0 || f.length < 4.5) continue;
      const nx = Math.sin((f.bearing * Math.PI) / 180);
      const ny = Math.cos((f.bearing * Math.PI) / 180);
      if ((nx * ax + ny * ay) * sign < 0.7) continue;
      const s = (f.mid[0] * ax + f.mid[1] * ay) * sign + f.length * 0.5;
      if (s > score) {
        score = s;
        best = f;
      }
    }
    if (!best) continue;
    // The facade is a measured line; the paint goes on the longest real wall along it.
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
    if (wall) out.push(wall);
  }
  return out;
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
    uGlow: { value: new THREE.Color(0xffc98c).multiplyScalar(0.9) },
    uHaze: { value: new THREE.Color(0, 0, 0) },
    uCast: { value: 0 },
    uContact: { value: 0.3 },
    uGround: { value: 1 }
  };

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
      // Kind 0 (a wall) plus a fraction that varies wall to wall, for which windows are lit at night.
      const wall = 0.9 * Math.abs((Math.sin(++seed * 12.9898) * 43758.5453) % 1);
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

  const solidMat = siteShade(new THREE.MeshLambertMaterial({ color: col(PAL.wall) }), u, 'blk-site', true);
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
  const lines = new THREE.LineSegments(lineLoops(rings(parts), top + PARAPET), new THREE.LineBasicMaterial({ color: PAL.capSolid, transparent: true, opacity: 0.6 }));
  root.add(lines);
  const faintPts: THREE.BufferGeometry[] = block.neighbours.map((nb) => lineLoops(rings(nb.footprint.parts), roofY(neighbourStoreys(nb, spec))));
  const faintGeo = mergeLines(faintPts);
  const faint = new THREE.LineSegments(faintGeo, new THREE.LineBasicMaterial({ color: PAL.capSolid, transparent: true, opacity: 0.22 }));
  root.add(faint);

  // ── The block number on the end walls.
  const paint = paintNumber(spec.label.trim() || block.blk);
  const numTex = new THREE.CanvasTexture(paint.canvas);
  numTex.colorSpace = THREE.SRGBColorSpace;
  numTex.anisotropy = 4;
  const decal = new Solid();
  const uv: number[] = [];
  for (const w of numberWalls(parts, list)) {
    const cap = clamp(w.len * 0.3, 1.8, 5.2);
    let hq = cap / 0.72;
    let wq = hq * paint.aspect;
    if (wq > w.len * 0.9) {
      wq = w.len * 0.9;
      hq = wq / paint.aspect;
    }
    const yc = top - 1.2 - hq / 2;
    const dx = (w.b[0] - w.a[0]) / w.len;
    const dy = (w.b[1] - w.a[1]) / w.len;
    const n = new THREE.Vector3(dy, 0, dx);
    const off = 0.06;
    const mx = (w.a[0] + w.b[0]) / 2 + dy * off;
    const my = (w.a[1] + w.b[1]) / 2 - dx * off;
    const at = (s: number, y: number) => site([mx + dx * s, my + dy * s], y);
    const st = storeyAt(yc, S);
    decal.quad(at(-wq / 2, yc - hq / 2), at(wq / 2, yc - hq / 2), at(wq / 2, yc + hq / 2), at(-wq / 2, yc + hq / 2), n, st, 0, 0, 0, 1);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
  }
  const decalGeo = decal.build();
  decalGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const decalMat = siteShade(
    new THREE.MeshLambertMaterial({ map: numTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    u,
    'blk-site-paint',
    false
  );
  const decals = new THREE.Mesh(decalGeo, decalMat);
  decals.receiveShadow = true;
  decals.renderOrder = 1;
  root.add(decals);
  // The page's own figures may still be loading; repaint once they are here.
  const font = '700 150px "Barlow Condensed"';
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
  const contact = bakeContact(outlines, radius, coarse);
  const gPos = [-radius, 0, -radius, radius, 0, -radius, radius, 0, radius, -radius, 0, radius];
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  gGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  gGeo.setIndex([0, 2, 1, 0, 3, 2]);
  const ground = new THREE.Mesh(gGeo, groundMaterial(u, contact.tex, contact.rect, radius));
  ground.receiveShadow = true;
  ground.renderOrder = -1;
  root.add(ground);

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
    u,
    storeys: S,
    top,
    peak: Math.max(top + PARAPET + (core.d > 2 ? 3.2 : 0), neighbourTop),
    radius,
    neighbourTop,
    facades: list,
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
