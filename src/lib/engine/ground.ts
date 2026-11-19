import * as THREE from 'three';
import { TILE_PX, coverSquare, loadTiles, rangeBounds, tileUrl, tilesIn, type MapStyle, type TileImage, type TileRange } from '../data/tiles';
import type { Block, Bounds } from '../data/types';
import { clamp } from './tween';

/**
 * The ground the site model stands on: OneMap's base map, laid on the table
 * exactly where the tiles say the ground is, so every block stands on its
 * own printed outline.
 *
 * The map is not a second surface. It is the colour of the existing table,
 * so the sun's shadows, the contact shade under the blocks, the fade at the
 * table's edge and the haze all fall on it as they fell on the paper. It is
 * printed in a quiet ink: the paper's own colour where the map is blank,
 * its lines and lettering a little darker, its colours mostly drained, so
 * the model stays the subject.
 *
 * Three fields of tiles, finest first, each over the next:
 *
 *   near   zoom 19, drawn for high-density screens: the block and its
 *          closest neighbours, 0.3 m to a pixel
 *   table  zoom 18, with the same lettering: the rest of the table
 *   far    zoom 16, about 2.4 km: only once the view from inside a flat
 *          opens, for the ground far below a window
 *
 * Nothing waits for the network. The paper shows first and each tile fades
 * in as it arrives; a tile that never comes leaves the paper showing, and
 * nothing is said or logged. By day the map is OneMap's Grey; once the
 * stage's night signal (uNight, the one that lights the windows) is well up,
 * its Night drawing is fetched and crossfaded in, and back again at dawn.
 *
 * Alignment: the tiles are placed through the same projection the
 * footprints use (see src/lib/data/tiles.ts). Measured on seven blocks
 * across Singapore, HDB's footprints drawn this way sit on OneMap's own
 * outlines within a few centimetres wherever both draw the same wall.
 */

export type GroundKind = 'paper' | 'map';

interface FieldSpec {
  zoom: number;
  day: MapStyle;
  night: MapStyle;
  /** Side of the square the field covers, metres, from the table's radius. */
  side: (radius: number) => number;
  /** Loaded only once the ground beyond the table is drawn: from inside a flat. */
  far: boolean;
  /** Width of the soft edge where the field gives way to the next, as a share of its side. */
  edge: number;
}

const FIELDS: readonly FieldSpec[] = [
  { zoom: 19, day: 'Grey_HD', night: 'Night_HD', side: (r) => clamp(0.8 * r, 180, 300), far: false, edge: 0.07 },
  { zoom: 18, day: 'Grey', night: 'Night', side: (r) => 1.9 * r, far: false, edge: 0.05 },
  { zoom: 16, day: 'Grey', night: 'Night', side: () => 2400, far: true, edge: 0.12 }
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
 * The map's ink, from each drawing's own colours. Day: how strongly the
 * Grey map's lines and lettering darken the paper, and how much of its
 * colour is kept. Night: the same for the Night drawing, whose ground is
 * dark and whose lines are light.
 */
const INK_DAY = 0.62;
const TINT_DAY = 0.3;
const INK_NIGHT = 0.8;
const TINT_NIGHT = 0.2;
/** The Grey map's blank ground, 242 of 255, decoded to linear: the shade that prints as the paper itself. */
const GREY_PAPER = Math.pow((242 / 255 + 0.055) / 1.055, 2.4);

/** The paint a canvas is cleared to before tiles land on it: the drawing's own blank ground, so mipmaps never bleed a wrong colour. */
const BLANK: Record<'day' | 'night', string> = { day: '#f2f2f2', night: '#19282f' };

export interface GroundUniforms {
  [name: string]: THREE.IUniform;
}

/** One drawing of one field: a canvas of its tiles, its texture, and each tile's fade. */
class Slot {
  canvas: HTMLCanvasElement | null = null;
  tex: THREE.CanvasTexture | null = null;
  style: MapStyle | null = null;
  night = false;
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
    this.style = null;
    this.state.fill(0);
    this.fade.fill(0);
    this.done = false;
    this.pending = false;
  }
}

class Field {
  readonly range: TileRange;
  readonly bounds: Bounds;
  readonly cols: number;
  readonly rows: number;
  /** First row of this field's tiles in the shared fade texture. */
  readonly row0: number;
  /** a is shown; b is the drawing coming in over it. */
  a: Slot;
  b: Slot;
  wanted = false;

  constructor(
    readonly spec: FieldSpec,
    block: Pick<Block, 'lat' | 'lng'>,
    radius: number,
    row0: number
  ) {
    this.range = coverSquare(block.lat, block.lng, spec.side(radius), spec.zoom);
    this.bounds = rangeBounds(block, this.range);
    this.cols = this.range.x1 - this.range.x0;
    this.rows = this.range.y1 - this.range.y0;
    this.row0 = row0;
    this.a = new Slot(this.cols * this.rows);
    this.b = new Slot(this.cols * this.rows);
    this.wanted = !spec.far;
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
 * `blkMap(p)`, the ink on the table at a site-frame point (x east, z
 * south), premultiplied by how much of the map is there (a): 0 where the
 * paper shows.
 */
export function groundChunk(): string {
  const fields = FIELDS.map(
    (_, i) => /* glsl */ `
uniform sampler2D uMap${i}A;
uniform sampler2D uMap${i}B;
uniform vec4 uMapRect${i};
uniform vec4 uMapGrid${i};
uniform vec2 uMapKind${i};`
  ).join('');
  // Finest first, each laid over the ones after it.
  const layers = FIELDS.map((_, i) => `  m = blkMapOver(m, blkMapField(uMap${i}A, uMap${i}B, uMapRect${i}, uMapGrid${i}, uMapKind${i}, p));`).join('\n');
  return /* glsl */ `
uniform float uMapOn;
uniform sampler2D uMapFade;
uniform vec2 uMapFadeSize;
uniform vec4 uMapInk;
${fields}
// The map as ink on the table: 1 is the paper itself. By day the Grey map's blank ground prints as paper and its
// lines and letters darken it; at night the Night drawing's dark ground darkens the table and its lines stay light.
vec3 blkMapInk(vec3 c, float night) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 day = mix(vec3(1.0), mix(vec3(l), c, uMapInk.y) / ${GREY_PAPER.toFixed(5)}, uMapInk.x);
  vec3 dark = mix(vec3(1.0), mix(vec3(l), c, uMapInk.w), uMapInk.z);
  return mix(day, dark, night);
}
// One field: its shown drawing (A) and the one coming in over it (B), each tile faded in on its own, softly edged.
vec4 blkMapField(sampler2D ta, sampler2D tb, vec4 rect, vec4 grid, vec2 kind, vec2 p) {
  vec2 uv = (p - rect.xy) * rect.zw;
  vec3 ca = texture2D(ta, uv).rgb;
  vec3 cb = texture2D(tb, uv).rgb;
  vec2 cell = clamp(floor(uv * grid.xy), vec2(0.0), grid.xy - 1.0);
  vec2 f = texture2D(uMapFade, (vec2(cell.x, cell.y + grid.z) + 0.5) / uMapFadeSize).rg;
  vec2 e = smoothstep(vec2(0.0), vec2(grid.w), uv) * smoothstep(vec2(0.0), vec2(grid.w), 1.0 - uv);
  float edge = e.x * e.y;
  float wa = f.r * edge;
  float wb = f.g * edge;
  return vec4(blkMapInk(cb, kind.y) * wb + blkMapInk(ca, kind.x) * wa * (1.0 - wb), wb + wa * (1.0 - wb));
}
vec4 blkMapOver(vec4 top, vec4 under) {
  return top + under * (1.0 - top.a);
}
vec4 blkMap(vec2 p) {
  vec4 m = vec4(0.0);
${layers}
  return m * uMapOn;
}
`;
}

export interface MapGroundOptions {
  /** Called whenever the map needs drawing again: a tile has arrived, or something is fading. */
  onRepaint: () => void;
  /** Called when the base map comes on screen or leaves it, for its attribution. */
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
      uMapInk: { value: vec4(INK_DAY, TINT_DAY, INK_NIGHT, TINT_NIGHT) }
    };
    this.fields.forEach((f, i) => {
      const b = f.bounds;
      // Site frame: x east, z south. The canvas's top row is the field's north edge.
      u[`uMapRect${i}`] = { value: vec4(b.minX, -b.maxY, 1 / (b.maxX - b.minX), 1 / (b.maxY - b.minY)) };
      u[`uMapGrid${i}`] = { value: vec4(f.cols, f.rows, f.row0, f.spec.edge) };
      u[`uMapKind${i}`] = { value: new THREE.Vector2() };
      u[`uMap${i}A`] = { value: blankTexture() };
      u[`uMap${i}B`] = { value: blankTexture() };
    });
    this.uniforms = u;
  }

  /** The person's choice: OneMap's map under the model, or the plain paper table. */
  setKind(kind: GroundKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    if (kind === 'paper') for (const f of this.fields) for (const s of [f.a, f.b]) this.pause(s);
    else if (this.started) for (const f of this.fields) this.want(f);
    this.wake();
  }

  /** New callbacks, for the site that has taken this ground over from the one before. */
  rebind(opts: MapGroundOptions): void {
    this.opts = opts;
    this.shown = false;
    this.report();
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
    if (change && this.kind === 'map') for (const f of this.fields) this.want(f);
    if (this.on !== (this.kind === 'map' ? 1 : 0)) this.wake();
  }

  /** Makes a field show the drawing for the time of day, fetching it if need be. */
  private want(f: Field): void {
    if (!f.wanted) return;
    const style = this.night ? f.spec.night : f.spec.day;
    if (f.a.style === style) {
      // Already shown; whatever was coming in over it is no longer wanted.
      if (f.b.style) this.empty(f.b);
      this.resume(f, f.a);
      return;
    }
    if (!f.a.style) return this.fill(f, f.a, style);
    if (f.b.style === style) return this.resume(f, f.b);
    this.fill(f, f.b, style);
  }

  /** Clears a slot and points its samplers back at the blank texture. */
  private empty(s: Slot): void {
    s.drop();
    this.bind();
    this.writeFades();
  }

  /** Starts a drawing in a slot: a canvas cleared to its blank ground, and its tiles asked for, nearest the block first. */
  private fill(f: Field, s: Slot, style: MapStyle): void {
    s.drop();
    const canvas = document.createElement('canvas');
    canvas.width = f.cols * TILE_PX;
    canvas.height = f.rows * TILE_PX;
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) return this.empty(s);
    s.style = style;
    s.night = style === f.spec.night;
    g.fillStyle = s.night ? BLANK.night : BLANK.day;
    g.fillRect(0, 0, canvas.width, canvas.height);
    s.canvas = canvas;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // Clamped by three to what the device allows.
    tex.anisotropy = 16;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    s.tex = tex;
    this.bind();
    this.resume(f, s);
  }

  /** Asks for the tiles of a slot that are not on its canvas yet. */
  private resume(f: Field, s: Slot): void {
    if (!s.style || s.ctl || this.kind !== 'map' || this.disposed) return;
    const list = tilesIn(f.range);
    const tw = (f.bounds.maxX - f.bounds.minX) / f.cols;
    const th = (f.bounds.maxY - f.bounds.minY) / f.rows;
    // Nearest the block first: the block's centroid is the frame's origin, which is not always the middle of the field.
    const dist = (col: number, row: number) => Math.hypot(f.bounds.minX + (col + 0.5) * tw, f.bounds.maxY - (row + 0.5) * th);
    const todo = list.filter((t) => s.state[t.row * f.cols + t.col] === 0).sort((p, q) => dist(p.col, p.row) - dist(q.col, q.row));
    if (!todo.length) {
      s.done = true;
      return;
    }
    const ctl = new AbortController();
    s.ctl = ctl;
    s.done = false;
    const style = s.style;
    void loadTiles(
      todo.map((t) => tileUrl(style, t)),
      (i, tile) => this.land(f, s, ctl, todo[i].col, todo[i].row, tile),
      { signal: ctl.signal, concurrency: 4 }
    ).then(() => {
      if (s.ctl !== ctl) return;
      s.ctl = null;
      if (!ctl.signal.aborted) s.done = true;
      this.wake();
    });
  }

  private pause(s: Slot): void {
    s.ctl?.abort();
    s.ctl = null;
  }

  /** A tile has arrived: onto the canvas it goes, to be sent to the GPU with the next batch and faded in. */
  private land(f: Field, s: Slot, ctl: AbortController, col: number, row: number, tile: TileImage | null): void {
    if (!tile) return;
    if (s.ctl !== ctl || !s.canvas || this.disposed) {
      tile.close();
      return;
    }
    const g = s.canvas.getContext('2d', { alpha: false });
    g?.drawImage(tile.image, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
    tile.close();
    s.state[row * f.cols + col] = 1;
    s.pending = true;
    this.wake();
  }

  /** Points the shader's samplers and kinds at what each slot holds now. */
  private bind(): void {
    this.fields.forEach((f, i) => {
      this.uniforms[`uMap${i}A`].value = f.a.tex ?? blankTexture();
      this.uniforms[`uMap${i}B`].value = f.b.tex ?? blankTexture();
      (this.uniforms[`uMapKind${i}`].value as THREE.Vector2).set(f.a.night ? 1 : 0, f.b.night ? 1 : 0);
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
      if (!b.style || !b.done || b.pending) continue;
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

    const target = this.kind === 'map' ? 1 : 0;
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

  /** Tells the interface whether any of the map is on the table, for its attribution. */
  private report(): void {
    const shown = this.on > 0 && this.kind === 'map' && this.fields.some((f) => f.a.fade.some((v) => v > 0) || f.b.fade.some((v) => v > 0));
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
    this.rebind(opts);
    if (this.started && this.kind === 'map') for (const f of this.fields) this.want(f);
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
