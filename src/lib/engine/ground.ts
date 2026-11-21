import * as THREE from 'three';
import { TILE_PX, bundledMap, coverSquare, loadTiles, rangeBounds, rectBounds, tileUrl, tilesIn, type BundledMap, type MapStyle, type TileImage, type TileRange } from '../data/tiles';
import type { Block, Bounds } from '../data/types';
import { clamp } from './tween';

/**
 * The ground the site model stands on: OneMap's base map, laid on the table
 * exactly where the tiles say the ground is, so every block stands on its
 * own printed outline.
 *
 * The map is not a second surface. It is the colour of the existing table,
 * so the sun's shadows, the contact shade under the blocks, the fade at the
 * table's edge and the haze all fall on it as they fell on the paper. The
 * drawn map is printed in a quiet ink: the paper's own colour where the map
 * is blank, its lines and lettering a little darker, its colours mostly
 * drained, so the model stays the subject. The aerial photograph is laid in
 * washed and a little drained for the same reason.
 *
 * Fields of tiles, finest first, each over the next:
 *
 *   near    zoom 19: the block and its closest neighbours, 0.3 m to a pixel
 *   table   zoom 18: the rest of the table
 *   bundle  a picture that came with the app (the demo block only), so that
 *           block has its map with no network at all; live tiles cover it
 *   far     zoom 16, about 2.4 km: only once the view from inside a flat
 *           opens, for the ground far below a window
 *
 * Nothing waits for the network. The paper shows first and each tile fades
 * in as it arrives; a tile that never comes leaves the paper showing, and
 * nothing is said or logged. By day the drawn map is OneMap's Grey; once
 * the stage's night signal (uNight, the one that lights the windows) is well
 * up, its Night drawing is fetched and crossfaded in, and back again at dawn.
 *
 * Alignment: the tiles are placed through the same projection the
 * footprints use (see src/lib/data/tiles.ts). Measured in the tiles on seven
 * blocks across Singapore, HDB's footprints sit on OneMap's own outlines to
 * within 7 cm on six and 19 cm on the seventh; measured again in this scene
 * seen from above, at Clementi, Tampines and Woodlands, to within 4 cm, with
 * no turn to speak of (under a fifth of a degree).
 */

/**
 * What the site stands on: the plain paper table, OneMap's drawn map, or its
 * aerial photograph. The photograph is for evaluation only: OneMap does not
 * publish it as a base map for others to use (see MAX_ZOOM in tiles.ts).
 */
export type GroundKind = 'paper' | 'map' | 'aerial';

/** How a drawing is printed: the Grey map's ink, the Night map's, or a photograph. */
const GREY = 0;
const NIGHT = 1;
const PHOTO = 2;

interface FieldSpec {
  zoom: number;
  /** The drawn map by day and after dark, and the photograph. */
  day: MapStyle;
  night: MapStyle;
  photo: MapStyle;
  /** Side of the square the field covers, metres, from the table's radius. */
  side: (radius: number) => number;
  /** Loaded only once the ground beyond the table is drawn: from inside a flat. */
  far: boolean;
  /** The picture that came with the app, rather than tiles. */
  bundle: boolean;
  /** Width of the soft edge where the field gives way to the next, as a share of its side. */
  edge: number;
}

const FIELDS: readonly FieldSpec[] = [
  { zoom: 19, day: 'Grey_HD', night: 'Night_HD', photo: 'Satellite', side: (r) => clamp(0.8 * r, 180, 300), far: false, bundle: false, edge: 0.07 },
  // The table has faded to a tenth by 0.83 of its radius, so tiles further out would not be seen.
  { zoom: 18, day: 'Grey', night: 'Night', photo: 'Satellite', side: (r) => 1.66 * r, far: false, bundle: false, edge: 0.05 },
  { zoom: 18, day: 'Grey', night: 'Night', photo: 'Satellite', side: () => 1, far: false, bundle: true, edge: 0.05 },
  { zoom: 16, day: 'Grey', night: 'Night', photo: 'Satellite', side: () => 2400, far: true, bundle: false, edge: 0.12 }
];

/** Seconds for a tile to fade in over the paper; for one drawing of the map to give way to another; for the map to come or go. */
const TILE_FADE = 0.5;
const STYLE_FADE = 0.8;
const ON_FADE = 0.45;
/** The stage's night signal at which the map turns to its night drawing, and back: apart, so it cannot flutter at dusk. */
const TO_NIGHT = 0.5;
const TO_DAY = 0.3;
/** At most this often, the textures of tiles that have arrived are sent to the GPU again, seconds. */
const UPLOAD_GAP = 0.15;

/**
 * The map's ink. By day: how strongly the Grey map's lines and lettering
 * darken the card, and how much of its colour is kept. After dark: how far
 * the Night drawing's dark ground takes the card down, how much of its
 * colour is kept, and how much of its own light it gives off, so its roads
 * and names can still be read under a dark sky.
 */
const INK_DAY = 0.62;
const TINT_DAY = 0.3;
const INK_NIGHT = 0.8;
/** The Night drawing's blue roads and green railways are a key to the map, not the colour of the city at night: most of it goes. */
const TINT_NIGHT = 0.35;
const GLOW_NIGHT = 0.4;
/** The photograph: how fully it replaces the card, how much of its colour is kept, and its gain and lift toward the card's lightness. */
const PHOTO_OVER = 0.9;
const PHOTO_TINT = 0.72;
const PHOTO_GAIN = 0.95;
const PHOTO_LIFT = 0.07;
/** The Grey map's blank ground, 242 of 255, decoded to linear: the shade that prints as the card itself. */
const GREY_PAPER = Math.pow((242 / 255 + 0.055) / 1.055, 2.4);

/** The paint a canvas is cleared to before tiles land on it: each drawing's own blank ground, so mipmaps never bleed a wrong colour. */
const BLANK = ['#f2f2f2', '#19282f', '#6f7468'] as const;

export interface GroundUniforms {
  [name: string]: THREE.IUniform;
}

/** What a slot is asked to hold. */
interface Source {
  key: string;
  mode: number;
  style: MapStyle | null;
  night: boolean;
}

/** One drawing of one field: a canvas of its tiles, its texture, and each tile's fade. */
class Slot {
  canvas: HTMLCanvasElement | null = null;
  tex: THREE.CanvasTexture | null = null;
  src: Source | null = null;
  /** Per tile: 0 nothing, 1 drawn on the canvas, 2 on the GPU. */
  state: Uint8Array;
  fade: Float32Array;
  ctl: AbortController | null = null;
  done = false;
  pending = false;

  constructor(n: number) {
    this.state = new Uint8Array(n);
    this.fade = new Float32Array(n);
  }

  get any(): boolean {
    return this.state.some((s) => s > 0);
  }

  drop(): void {
    this.ctl?.abort();
    this.ctl = null;
    this.tex?.dispose();
    this.tex = null;
    this.canvas = null;
    this.src = null;
    this.state.fill(0);
    this.fade.fill(0);
    this.done = false;
    this.pending = false;
  }
}

class Field {
  range: TileRange;
  bounds: Bounds;
  cols: number;
  rows: number;
  /** a is shown; b is the drawing coming in over it. */
  a: Slot;
  b: Slot;
  wanted: boolean;
  bundle: BundledMap | null = null;

  constructor(
    readonly spec: FieldSpec,
    block: Pick<Block, 'lat' | 'lng'>,
    radius: number,
    /** First row of this field's tiles in the shared fade texture. */
    readonly row0: number
  ) {
    // The bundled picture is one tile to the shader, whatever it is a mosaic of; where it lies is known once it is found.
    this.range = spec.bundle ? { z: 0, x0: 0, y0: 0, x1: 1, y1: 1 } : coverSquare(block.lat, block.lng, spec.side(radius), spec.zoom);
    this.bounds = spec.bundle ? { minX: 0, minY: 0, maxX: 1, maxY: 1 } : rangeBounds(block, this.range);
    this.cols = this.range.x1 - this.range.x0;
    this.rows = this.range.y1 - this.range.y0;
    this.a = new Slot(this.cols * this.rows);
    this.b = new Slot(this.cols * this.rows);
    this.wanted = !spec.far && !spec.bundle;
  }
}

const vec4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);

let blank: THREE.DataTexture | null = null;
/** Bound to an empty slot, so every sampler always has a texture. */
function blankTexture(): THREE.DataTexture {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([242, 242, 242, 255]), 1, 1);
    blank.needsUpdate = true;
  }
  return blank;
}

/**
 * GLSL for the map, for the table's fragment shader: its uniforms, and
 * `blkMap(p, base, glow)`: what the map makes of the card's colour `base` at
 * a site-frame point p (x east, z south), premultiplied by how much of the
 * map is there (a, 0 where the paper shows), and the light the night drawing
 * gives off there.
 */
export function groundChunk(): string {
  const fields = FIELDS.map(
    (_, i) => /* glsl */ `
uniform sampler2D uMap${i}A;
uniform sampler2D uMap${i}B;
uniform vec4 uMapRect${i};
uniform vec4 uMapGrid${i};
uniform vec4 uMapKind${i};`
  ).join('');
  // Finest first, each laid over the ones after it.
  const layers = FIELDS.map(
    (_, i) => `  f = blkMapField(uMap${i}A, uMap${i}B, uMapRect${i}, uMapGrid${i}, uMapKind${i}, p, base, g);\n  glow += g * (1.0 - m.a);\n  m += f * (1.0 - m.a);`
  ).join('\n');
  return /* glsl */ `
uniform float uMapOn;
uniform sampler2D uMapFade;
uniform vec2 uMapFadeSize;
uniform vec4 uMapInk;
uniform vec4 uMapPhoto;
uniform float uMapGlow;
${fields}
// What a drawing makes of the card. The Grey map's blank ground prints as the card itself and its lines and letters
// darken it; the Night drawing's dark ground takes the card down and its lines stay light; the photograph replaces it.
vec3 blkMapTone(vec3 c, float mode, vec3 base) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (mode < 0.5) return base * mix(vec3(1.0), mix(vec3(l), c, uMapInk.y) / ${GREY_PAPER.toFixed(5)}, uMapInk.x);
  if (mode < 1.5) return base * mix(vec3(1.0), mix(vec3(l), c, uMapInk.w), uMapInk.z);
  return mix(base, mix(vec3(l), c, uMapPhoto.y) * uMapPhoto.z + uMapPhoto.w, uMapPhoto.x);
}
// One field: its shown drawing (A) and the one coming in over it (B), each tile faded in on its own, softly edged.
// kind: how A and B are printed (x, y) and whether each is there at all (z, w).
vec4 blkMapField(sampler2D ta, sampler2D tb, vec4 rect, vec4 grid, vec4 kind, vec2 p, vec3 base, out vec3 glow) {
  glow = vec3(0.0);
  if (kind.z + kind.w < 0.5) return vec4(0.0);
  vec2 uv = (p - rect.xy) * rect.zw;
  vec2 cell = clamp(floor(uv * grid.xy), vec2(0.0), grid.xy - 1.0);
  vec2 f = texture2D(uMapFade, (vec2(cell.x, cell.y + grid.z) + 0.5) / uMapFadeSize).rg;
  vec2 e = smoothstep(vec2(0.0), vec2(grid.w), uv) * smoothstep(vec2(0.0), vec2(grid.w), 1.0 - uv);
  float edge = e.x * e.y;
  vec4 a = vec4(0.0);
  vec4 b = vec4(0.0);
  vec3 ga = vec3(0.0);
  vec3 gb = vec3(0.0);
  if (kind.z > 0.5) {
    vec3 c = texture2D(ta, uv).rgb;
    a = vec4(blkMapTone(c, kind.x, base), 1.0) * f.r * edge;
    if (kind.x > 0.5 && kind.x < 1.5) ga = c * uMapGlow * a.a;
  }
  if (kind.w > 0.5) {
    vec3 c = texture2D(tb, uv).rgb;
    b = vec4(blkMapTone(c, kind.y, base), 1.0) * f.g * edge;
    if (kind.y > 0.5 && kind.y < 1.5) gb = c * uMapGlow * b.a;
  }
  glow = gb + ga * (1.0 - b.a);
  return b + a * (1.0 - b.a);
}
vec4 blkMap(vec2 p, vec3 base, out vec3 glow) {
  vec4 m = vec4(0.0);
  vec4 f;
  vec3 g;
  glow = vec3(0.0);
${layers}
  glow *= uMapOn;
  return m * uMapOn;
}
`;
}

export interface MapGroundOptions {
  /** Called whenever the map needs drawing again: a tile has arrived, or something is fading. */
  onRepaint: () => void;
  /** Called when OneMap's map or photograph comes onto the table or leaves it, for its attribution. */
  onShown?: (shown: boolean) => void;
}

/**
 * OneMap's base map on the table round one block. Build with `groundFor`,
 * which keeps the last one across a rebuild of the same block, so new
 * neighbour heights do not send the map back to paper.
 */
export class MapGround {
  readonly uniforms: GroundUniforms;
  readonly key: string;
  private fields: Field[];
  private fadeData: Uint8Array;
  private fadeTex: THREE.DataTexture;
  private fadeW: number;
  private kind: GroundKind = 'map';
  private on = 0;
  private night = false;
  private started = false;
  private raf = 0;
  private last = 0;
  private sinceUpload = 0;
  private shown = false;
  private disposed = false;
  private opts: MapGroundOptions;

  constructor(
    private block: Pick<Block, 'postal' | 'lat' | 'lng'>,
    radius: number,
    opts: MapGroundOptions
  ) {
    this.opts = opts;
    this.key = keyOf(block, radius);
    let row = 0;
    this.fields = FIELDS.map((spec) => {
      const f = new Field(spec, block, radius, row);
      row += f.rows;
      return f;
    });
    this.fadeW = Math.max(...this.fields.map((f) => f.cols));
    this.fadeData = new Uint8Array(this.fadeW * row * 4);
    this.fadeTex = new THREE.DataTexture(this.fadeData, this.fadeW, row);
    this.fadeTex.magFilter = this.fadeTex.minFilter = THREE.NearestFilter;
    this.fadeTex.needsUpdate = true;
    const u: GroundUniforms = {
      uMapOn: { value: 0 },
      uMapFade: { value: this.fadeTex },
      uMapFadeSize: { value: new THREE.Vector2(this.fadeW, row) },
      uMapInk: { value: vec4(INK_DAY, TINT_DAY, INK_NIGHT, TINT_NIGHT) },
      uMapPhoto: { value: vec4(PHOTO_OVER, PHOTO_TINT, PHOTO_GAIN, PHOTO_LIFT) },
      uMapGlow: { value: GLOW_NIGHT }
    };
    this.fields.forEach((f, i) => {
      u[`uMapRect${i}`] = { value: vec4() };
      u[`uMapGrid${i}`] = { value: vec4(f.cols, f.rows, f.row0, f.spec.edge) };
      u[`uMapKind${i}`] = { value: vec4() };
      u[`uMap${i}A`] = { value: blankTexture() };
      u[`uMap${i}B`] = { value: blankTexture() };
    });
    this.uniforms = u;
    this.fields.forEach((f, i) => this.place(f, i));
    // The picture that came with the app, if this block has one: found without the network, and laid under the live tiles.
    void bundledMap(block.postal).then((found) => {
      const i = this.fields.findIndex((f) => f.spec.bundle);
      if (!found || this.disposed || i < 0) return;
      const f = this.fields[i];
      f.bundle = found;
      f.bounds = rectBounds(block, found.rect);
      this.place(f, i);
      f.wanted = true;
      if (this.started) this.want(f);
    });
  }

  /** Tells the shader where a field lies. Site frame: x east, z south; a canvas's top row is the field's north edge. */
  private place(f: Field, i: number): void {
    const b = f.bounds;
    (this.uniforms[`uMapRect${i}`].value as THREE.Vector4).set(b.minX, -b.maxY, 1 / (b.maxX - b.minX), 1 / (b.maxY - b.minY));
  }

  /** The person's choice: OneMap's map or photograph under the model, or the plain paper table. */
  setKind(kind: GroundKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    if (kind === 'paper') for (const f of this.fields) for (const s of [f.a, f.b]) this.pause(s);
    else if (this.started) for (const f of this.fields) this.want(f);
    this.wake();
  }

  /**
   * Called as the table is drawn, with the stage's night signal: starts the
   * fetching on the first frame (when the light is known), and turns the
   * map to its night drawing and back. `far` is true for the ground beyond
   * the table, which is drawn only from inside a flat.
   */
  frame(night: number, far: boolean): void {
    if (this.disposed) return;
    const was = this.night;
    if (!this.night && night >= TO_NIGHT) this.night = true;
    else if (this.night && night <= TO_DAY) this.night = false;
    let change = !this.started || this.night !== was;
    this.started = true;
    for (const f of this.fields)
      if (far && f.spec.far && !f.wanted) {
        f.wanted = true;
        change = true;
      }
    if (change && this.kind !== 'paper') for (const f of this.fields) this.want(f);
    if (this.on !== (this.kind === 'paper' ? 0 : 1)) this.wake();
  }

  /** What a field should show for the person's choice and the time of day; null for nothing. */
  private source(f: Field): Source | null {
    const { spec } = f;
    if (this.kind === 'aerial') return spec.bundle ? null : { key: spec.photo, mode: PHOTO, style: spec.photo, night: false };
    const night = this.night;
    if (spec.bundle) return f.bundle ? { key: night ? 'bundle night' : 'bundle day', mode: night ? NIGHT : GREY, style: null, night } : null;
    const style = night ? spec.night : spec.day;
    return { key: style, mode: night ? NIGHT : GREY, style, night };
  }

  /** Makes a field show the drawing for the choice and the time of day, fetching it if need be. */
  private want(f: Field): void {
    if (!f.wanted) return;
    const src = this.source(f);
    if (!src) {
      // The bundled map has no photograph: it leaves the table to the live tiles.
      if (f.a.src || f.b.src) {
        f.a.drop();
        this.empty(f.b);
      }
      return;
    }
    if (f.a.src?.key === src.key) {
      // Already shown; whatever was coming in over it is no longer wanted.
      if (f.b.src) this.empty(f.b);
      this.resume(f, f.a);
      return;
    }
    if (!f.a.src) return this.fill(f, f.a, src);
    if (f.b.src?.key === src.key) return this.resume(f, f.b);
    this.fill(f, f.b, src);
  }

  /** Clears a slot and points its samplers back at the blank texture. */
  private empty(s: Slot): void {
    s.drop();
    this.bind();
    this.writeFades();
  }

  /** Starts a drawing in a slot: a canvas cleared to its blank ground, and its tiles asked for, nearest the block first. */
  private fill(f: Field, s: Slot, src: Source): void {
    s.drop();
    // The bundled picture brings its own size, so its canvas is made when it arrives.
    if (!f.spec.bundle) {
      const canvas = document.createElement('canvas');
      canvas.width = f.cols * TILE_PX;
      canvas.height = f.rows * TILE_PX;
      const g = canvas.getContext('2d', { alpha: false });
      if (!g) return this.empty(s);
      g.fillStyle = BLANK[src.mode];
      g.fillRect(0, 0, canvas.width, canvas.height);
      s.canvas = canvas;
      s.tex = this.texture(canvas);
    }
    s.src = src;
    this.bind();
    this.resume(f, s);
  }

  /** A canvas of map as a texture: mipmapped, and crisp at grazing angles. */
  private texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // three keeps this within what the device allows.
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  /** Asks for the tiles of a slot that are not on its canvas yet. */
  private resume(f: Field, s: Slot): void {
    const src = s.src;
    if (!src || s.ctl || this.kind === 'paper' || this.disposed) return;
    const ctl = new AbortController();
    const finish = (): void => {
      if (s.ctl !== ctl) return;
      s.ctl = null;
      if (!ctl.signal.aborted) s.done = true;
      this.wake();
    };
    if (f.spec.bundle) {
      if (s.state[0] !== 0 || !f.bundle) return void (s.done = true);
      s.ctl = ctl;
      s.done = false;
      void f.bundle.image(src.night).then((tile) => {
        this.land(f, s, ctl, 0, 0, tile);
        finish();
      });
      return;
    }
    const tw = (f.bounds.maxX - f.bounds.minX) / f.cols;
    const th = (f.bounds.maxY - f.bounds.minY) / f.rows;
    // Nearest the block first: the block's centroid is the frame's origin, which is not always the middle of the field.
    const dist = (col: number, row: number) => Math.hypot(f.bounds.minX + (col + 0.5) * tw, f.bounds.maxY - (row + 0.5) * th);
    const todo = tilesIn(f.range)
      .filter((t) => s.state[t.row * f.cols + t.col] === 0)
      .sort((p, q) => dist(p.col, p.row) - dist(q.col, q.row));
    if (!todo.length || !src.style) return void (s.done = true);
    s.ctl = ctl;
    s.done = false;
    const style = src.style;
    void loadTiles(
      todo.map((t) => tileUrl(style, t)),
      (i, tile) => this.land(f, s, ctl, todo[i].col, todo[i].row, tile),
      { signal: ctl.signal, concurrency: 4 }
    ).then(finish);
  }

  private pause(s: Slot): void {
    s.ctl?.abort();
    s.ctl = null;
  }

  /** A tile has arrived: onto the canvas it goes, to be sent to the GPU with the next batch and faded in. */
  private land(f: Field, s: Slot, ctl: AbortController, col: number, row: number, tile: TileImage | null): void {
    if (!tile) return;
    if (s.ctl !== ctl || ctl.signal.aborted || this.disposed) return tile.close();
    if (f.spec.bundle) {
      const { width, height } = tile.image as { width: number; height: number };
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext('2d', { alpha: false });
      if (!g) return tile.close();
      g.drawImage(tile.image, 0, 0);
      s.canvas = canvas;
      s.tex = this.texture(canvas);
      this.bind();
    } else {
      const g = s.canvas?.getContext('2d', { alpha: false });
      if (!g) return tile.close();
      g.drawImage(tile.image, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
    }
    tile.close();
    s.state[row * f.cols + col] = 1;
    s.pending = true;
    this.wake();
  }

  /** Points the shader's samplers at what each slot holds now, and says how each is printed. */
  private bind(): void {
    this.fields.forEach((f, i) => {
      this.uniforms[`uMap${i}A`].value = f.a.tex ?? blankTexture();
      this.uniforms[`uMap${i}B`].value = f.b.tex ?? blankTexture();
      (this.uniforms[`uMapKind${i}`].value as THREE.Vector4).set(f.a.src?.mode ?? 0, f.b.src?.mode ?? 0, f.a.tex ? 1 : 0, f.b.tex ? 1 : 0);
    });
  }

  private writeFades(): void {
    const d = this.fadeData;
    for (const f of this.fields)
      for (let r = 0; r < f.rows; r++)
        for (let c = 0; c < f.cols; c++) {
          const i = r * f.cols + c;
          const o = ((f.row0 + r) * this.fadeW + c) * 4;
          d[o] = Math.round(255 * f.a.fade[i]);
          d[o + 1] = Math.round(255 * f.b.fade[i]);
        }
    this.fadeTex.needsUpdate = true;
  }

  /** Runs the fades for as long as something is changing, asking for a frame each time. */
  private wake(): void {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.step);
  }

  private step = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.sinceUpload += dt;
    let busy = false;
    let fades = false;

    // Tiles that have landed go to the GPU in batches, then fade in.
    const upload = this.sinceUpload >= UPLOAD_GAP;
    for (const f of this.fields)
      for (const s of [f.a, f.b]) {
        if (s.pending) {
          if (upload && s.tex) {
            s.tex.needsUpdate = true;
            s.pending = false;
            for (let i = 0; i < s.state.length; i++) if (s.state[i] === 1) s.state[i] = 2;
            this.sinceUpload = 0;
          }
          busy = true;
        }
        const k = dt / (s === f.b && f.a.any ? STYLE_FADE : TILE_FADE);
        for (let i = 0; i < s.state.length; i++)
          if (s.state[i] === 2 && s.fade[i] < 1) {
            s.fade[i] = Math.min(1, s.fade[i] + k);
            fades = true;
          }
        if (s.ctl) busy = true;
      }

    // A drawing that has fully come in over the old one takes its place.
    for (const f of this.fields) {
      const b = f.b;
      if (!b.src || !b.done || b.pending) continue;
      const covers = b.state.every((st, i) => (f.a.state[i] === 0 || st === 2) && (st !== 2 || b.fade[i] >= 1));
      if (!covers) continue;
      if (!b.any) {
        this.empty(b);
        continue;
      }
      f.a.drop();
      f.a = b;
      f.b = new Slot(f.cols * f.rows);
      this.bind();
      fades = true;
    }

    const target = this.kind === 'paper' ? 0 : 1;
    if (this.on !== target) {
      this.on = target > this.on ? Math.min(1, this.on + dt / ON_FADE) : Math.max(0, this.on - dt / ON_FADE);
      this.uniforms.uMapOn.value = this.on;
      fades = true;
    }
    if (fades) this.writeFades();
    this.report();
    if (fades || busy) this.opts.onRepaint();
    if (fades || busy) this.raf = requestAnimationFrame(this.step);
  };

  /** Tells the interface whether any of OneMap's map is on the table, for its attribution: until the last of it has faded out. */
  private report(): void {
    const shown = this.on > 0 && this.fields.some((f) => f.a.fade.some((v) => v > 0) || f.b.fade.some((v) => v > 0));
    if (shown === this.shown) return;
    this.shown = shown;
    this.opts.onShown?.(shown);
  }

  /** Let go of by its site: kept for a rebuild of the same block, its fetching paused. */
  release(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const f of this.fields) for (const s of [f.a, f.b]) this.pause(s);
    if (this.shown) {
      this.shown = false;
      this.opts.onShown?.(false);
    }
  }

  /** Taken up again by a new site for the same block. */
  adopt(opts: MapGroundOptions): void {
    this.opts = opts;
    if (this.started && this.kind !== 'paper') for (const f of this.fields) this.want(f);
    this.report();
    this.wake();
  }

  dispose(): void {
    this.release();
    this.disposed = true;
    for (const f of this.fields) {
      f.a.drop();
      f.b.drop();
    }
    this.fadeTex.dispose();
  }
}

function keyOf(block: Pick<Block, 'postal' | 'lat' | 'lng'>, radius: number): string {
  return `${block.postal}:${block.lat.toFixed(7)}:${block.lng.toFixed(7)}:${Math.round(radius)}`;
}

/** The ground last let go of, kept so a rebuild of the same block picks it up where it was. */
let kept: MapGround | null = null;

/**
 * The map ground for a block: the one kept from the last site if it was for
 * the same block and table, else a new one (and the kept one is let go).
 */
export function groundFor(block: Pick<Block, 'postal' | 'lat' | 'lng'>, radius: number, opts: MapGroundOptions): MapGround {
  const key = keyOf(block, radius);
  if (kept && kept.key === key) {
    const g = kept;
    kept = null;
    g.adopt(opts);
    return g;
  }
  kept?.dispose();
  kept = null;
  return new MapGround(block, radius, opts);
}

/** A site is done with its ground: keep it for the next site, which may be the same block rebuilt. */
export function letGo(g: MapGround): void {
  g.release();
  if (kept && kept !== g) kept.dispose();
  kept = g;
}
