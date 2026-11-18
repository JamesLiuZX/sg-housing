import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { facadeFacing } from '../data/facades';
import type { Facade } from '../data/types';
import { mainFacade } from '../plan/facing';
import { frameOf } from '../plan/geometry';
import type { Plan, Wall } from '../plan/types';
import type { PathPoint, Sun } from '../sg/solar';
import { buildFlat, type Built, type RoomAnchor } from './build';
import { BOUNCE_SCALE } from './field';
import { PAL, col, cutTop, installToneMapping, makeUniforms, type Uniforms } from './materials';
import { Nav, type P2 } from './nav';
import { Outdoors } from './outdoors';
import { placeSite, type Unit } from './placement';
import { GROUND, PLATE, PLATE_INSIDE, STAGE_HAZE, STOREY, buildSite, floorY, storeyAt, type BlockSite, type SiteModel } from './site';
import { skyStops } from './sky';
import { litFaces } from './sunlit';
import { Tweens, clamp, ease, lerp, smooth } from './tween';

export type { BlockSite } from './site';
export type { Unit } from './placement';

export type Lens = 'space' | 'sun' | 'rules';
export type Mode = 'plan' | 'doll' | 'walk' | 'block';

/** A tap on a side of the chosen block. */
export interface FacadePick {
  /** Index into `facades(block.footprint)`, the same list as `Viewer.blockFacades`. */
  index: number;
  facade: Facade;
  /** How far along the side the tap was, 0 at the facade's `a` end to 1 at its `b` end. */
  along: number;
  /** The storey at the height tapped. */
  storey: number;
}

export interface Hooks {
  /** Called after every rendered frame, for overlays that track the scene. */
  frame?: () => void;
  mode?: (m: Mode) => void;
  wall?: (wall: Wall | null) => void;
  /** day: 0 night to 1 full daylight. gold: 1 at the horizon, 0 with the sun high. */
  atmosphere?: (day: number, gold: number) => void;
  /** Block mode: the person dragged the marked storey to n (they own the band; it has already moved). */
  storey?: (n: number) => void;
  /** Block mode: the person tapped a side of the block. */
  facade?: (pick: FacadePick) => void;
}

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const EYE = 1.55;
const BASE = 0.14;
const DOLL_FOV = 30;
const FACE_YAW = { N: 0, W: Math.PI / 2, S: Math.PI, E: -Math.PI / 2 } as const;

/** Sun strength at full height. Strong against the sky light, so a patch on the floor is unmistakable. */
const SUN = 11;
/** Lamplight at night, against the field's lamp channel. */
const LAMP = 4.2;
/** Seconds for a wall to fold down or stand back up as the camera moves round. */
const CUT_TIME = 0.4;
/** Shadow-filter step in metres. The visible penumbra of a sun patch is about two and a half steps. */
const SOFT_STEP = 0.016;
/** How far outside the compass ring its N, E, S, W letters stand, metres. */
const LETTER_OUT = 1.0;
/** Length of the opening sequence, seconds. */
const INTRO_TIME = 3.4;
/** Length of the push from the block into the flat, seconds. */
const PUSH_TIME = 3.6;
/** Shadow-filter step on the site, metres: a soft model's shadow, not a crisp one. */
const SITE_SOFT = 0.45;
/** How far round from the facade's normal the push-in arrives, so the dollhouse is seen three-quarter on. */
const ARRIVE_TURN = 0.5;
/**
 * What it is worth to the arrival view to see the painted block number, in
 * the units of its other wants (a whole block hidden is 1, a quarter turn off
 * the ideal angle 0.5): enough to swing it a few tens of degrees.
 */
const NUMBER_SEEN = 0.6;
/** The sun on the site against the sun in the flat: the blocks are white card far from the camera, and would bleach. */
const SITE_SUN = 0.45;
/** Seconds for the view out of the windows to clear once the walk has landed. */
const OUTSIDE_TIME = 0.9;
/**
 * Haze on the site seen from inside: its strength, and the distances it
 * starts and reaches that strength at, metres. Light enough that the nearer
 * blocks keep their tone and the ground stays darker than the sky until a
 * few degrees under the horizon, which is what makes a horizon read.
 */
const WALK_HAZE = 0.42;
const WALK_HAZE_NEAR = 50;
const WALK_HAZE_FAR = 700;
/** How far round the flat its own block is left out, seen from inside: clear of the outer walls, slabs and ledges. Metres. */
const HIDE_MARGIN = 0.4;
/** Width of the edge of a block's shadow seen from inside, metres. */
const WALK_SITE_SOFT = 0.5;
/**
 * The Sun lens turns toward the sun's side as the sun drops: not at all above
 * the higher altitude, fully below the lower one, radians. In between, its
 * patches move off the floor and up the walls that face the sun.
 */
const LOW_SUN_HIGH = 34 * (Math.PI / 180);
const LOW_SUN_LOW = 16 * (Math.PI / 180);
/**
 * It looks almost along the sun's own bearing, where most of the light
 * inside is in view (on the hero flat at 6:15 pm in June, five to ten times
 * what either view of the arc side on shows), just off it so the sun's
 * marker does not sit on the facade.
 */
const LOW_SUN_OFF = 12 * (Math.PI / 180);
/** And it turns no further than this from the view that shows the day's arc side on, whichever side that is. */
const LOW_SUN_TURN = 110 * (Math.PI / 180);
/** Seconds for the view to catch up with the sun as it is dragged: the time constant of an eased follow. */
const SUN_FOLLOW = 0.45;

/** The two ends of the push-in: the block view and the dollhouse view, each as an orbit about a target. */
interface PushPlan {
  block: Orbit;
  doll: Orbit;
  storey: number;
  /** Metres the top of the block lifts away, the bottom sinks and the neighbours sink, by the end. */
  lift: number;
  sink: number;
  drop: number;
}

interface Orbit {
  target: THREE.Vector3;
  r: number;
  theta: number;
  phi: number;
  pad: number;
}

/** The two ends of the opening sequence. */
interface IntroPlan {
  from: { theta: number; phi: number };
  to: { theta: number; phi: number };
  d0: number;
  d1: number;
  pad0: number;
  padX0: number;
  bottom: number;
}

/** Sun colour by altitude: warm white high up, amber low down, red at the horizon. Degrees, sRGB. */
const SUN_STOPS: [number, number][] = [
  [-1, 0xff7a3c],
  [3, 0xff9452],
  [8, 0xffae6e],
  [16, 0xffc68a],
  [28, 0xffdaae],
  [45, 0xffe8cc],
  [70, 0xfff1e0]
];

/** Fill from the side the model is first seen from, so faces at right angles read apart in the shade. */
const FILL_DIR = new THREE.Vector3(Math.sin(25 * DEG) * Math.cos(50 * DEG), Math.sin(50 * DEG), Math.cos(25 * DEG) * Math.cos(50 * DEG));

function sunColour(altitude: number, out: THREE.Color): THREE.Color {
  const a = altitude / DEG;
  let i = 0;
  while (i < SUN_STOPS.length - 2 && a > SUN_STOPS[i + 1][0]) i++;
  const [a0, c0] = SUN_STOPS[i];
  const [a1, c1] = SUN_STOPS[i + 1];
  return out.copy(col(c0)).lerp(col(c1), clamp((a - a0) / (a1 - a0), 0, 1));
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,214,150,1)');
  grad.addColorStop(0.22, 'rgba(255,170,80,0.85)');
  grad.addColorStop(0.5, 'rgba(255,150,60,0.22)');
  grad.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function letterSprite(text: string, strong: boolean): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.font = `${strong ? 700 : 500} ${strong ? 64 : 46}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = strong ? '#e0672a' : '#6b675f';
  g.fillText(text, 48, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0 }));
  s.scale.setScalar(strong ? 1.35 : 1.0);
  s.renderOrder = 6;
  return s;
}

export class Viewer {
  mode: Mode = 'plan';
  lens: Lens = 'space';
  anchors: RoomAnchor[] = [];

  /** The flat on show. setPlan replaces it. */
  get plan(): Plan {
    return this.current;
  }

  private current: Plan;
  private canvas: HTMLCanvasElement;
  private hooks: Hooks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(DOLL_FOV, 1, 0.5, 300);
  private controls: OrbitControls;
  private built: Built;
  private nav: Nav;
  private u: Uniforms;
  private tweens = new Tweens();
  private ray = new THREE.Raycaster();

  private sunLight = new THREE.DirectionalLight(0xffffff, 0);
  private hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  private fill = new THREE.DirectionalLight(0xffffff, 0.4);
  private shadowProbe = new THREE.OrthographicCamera();
  /** Per wall, whether it should be cut down for the current camera. */
  private cutWant: Float32Array;
  /** The opening being held still by scrubIntro, if any. */
  private scrub: IntroPlan | null = null;
  /** Sun direction the light field's bounce was last spread for. */
  private bounceDir = new THREE.Vector3(0, -1, 0);
  /** The haze the far blocks fade into: the page behind the block on the stage, the horizon seen from inside. */
  private fogColour = new THREE.Color();
  private glowColour = new THREE.Color();
  /** The sky and the site's own shadow, for the view out of the windows. */
  private outdoors: Outdoors;
  /** How clear the view out of the windows is: 0 in the dollhouse, 1 once a walk has landed. */
  private outsideK = 0;
  /** The site's own shadow map needs drawing again, because the sun or the site has moved. */
  private siteShadowDirty = true;
  /** Per wall, whether its left and right faces have the sun on them; worked out when the Sun lens needs it. */
  private lit: Uint8Array = new Uint8Array(0);
  private litDirty = true;
  /** The Sun lens still chooses the view's angle; false from the moment the person turns it themselves. */
  private sunSteer = false;
  /** The azimuth that shows the day's arc side on, which the Sun lens turns from as the sun drops. */
  private sunBase = 0;
  /** The sun has moved, and the Sun lens's view is catching up. */
  private sunChase = false;

  private compass = new THREE.Group();
  private compassMats: { mat: THREE.Material & { opacity: number }; base: number }[] = [];
  private compassShow = 0;
  // The compass is built for the flat's size, so these are made again when the flat changes.
  private sunSprite!: THREE.Sprite;
  private sunCore!: THREE.Mesh;
  private pathDots!: THREE.Points;
  private hourDots!: THREE.Points;
  private drop!: THREE.Line;
  private domeR: number;
  /** The day's arc above the horizon, in the compass frame, for framing the sun lens. */
  private pathPts: THREE.Vector3[] = [];
  private dayPath: PathPoint[] = [];

  private target = new THREE.Vector3();
  private w = 1;
  private h = 1;
  private pad = 0;
  private padX = 0;
  /** Screen taken by interface at the top, CSS pixels: a phone's header. */
  private padTop = 0;
  private flying = false;
  private introRunning = false;
  private dirty = true;
  private shadowDirty = true;
  private orbitLive = false;
  private raf = 0;
  private last = 0;
  private disposed = false;

  private sun: Sun = { azimuth: 0, altitude: 1 };
  private bearing: number;
  private sunGain = 0;
  private furnished = true;
  private shellAlpha = 0;

  private saved: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private walk = {
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    keys: new Set<string>(),
    looking: false,
    route: null as null | { pts: P2[]; cum: number[]; len: number; s: number; dur: number; t: number }
  };
  private ptr: { id: number; x: number; y: number; lx: number; ly: number; t: number; moved: boolean } | null = null;
  private ring: THREE.Mesh;
  private highlight: { group: THREE.Group; wall: number; h: number } | null = null;
  private ro: ResizeObserver;

  // ── Block stage state ──
  private site: SiteModel | null = null;
  private siteSpec: BlockSite | null = null;
  /** Site frame to world, as last applied. Kept apart from the site so a rebuilt site lands where the old one was. */
  private siteMatrix = new THREE.Matrix4();
  /** World to the site frame. */
  private siteInverse = new THREE.Matrix4();
  private unit: Unit | null = null;
  /** The marked storey, 0 for none. */
  private marked = 0;
  /** The flat's outline on its storey: a patch on the facade, and the volume seen through the block. */
  private ghost: THREE.Group | null = null;
  /** How far the lamps are on, 0 by day to 1 at night, as the light was last set. */
  private lampsK = 0;
  /** 0 at the flat's scale, 1 at the site's: blends the shadow fit and the depth range between them. */
  private siteW = 0;
  /** The flat's table shadow, faded out while the flat stands in its block. */
  private tableGain = 1;
  private pushing = false;
  private pushHold: PushPlan | null = null;
  /** Pointers down on the canvas, to tell one finger from two, and whether this gesture has had two. */
  private held = new Set<number>();
  private multi = false;
  /** A press on the block, until it shows whether it scrubs the storey or orbits. */
  private grab: { id: number; x: number; y: number; scrub: boolean; plane: THREE.Plane } | null = null;
  private coarse: boolean;

  constructor(canvas: HTMLCanvasElement, plan: Plan, hooks: Hooks = {}) {
    this.canvas = canvas;
    this.current = plan;
    this.hooks = hooks;
    this.bearing = plan.north;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral tone mapping keeps paper white and timber timber; ours also lets direct sun bleach toward cream.
    installToneMapping();
    this.renderer.toneMapping = THREE.CustomToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    // The plain PCF branch is the one the materials replace with their wide, smooth filter.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.u = makeUniforms(plan.walls.length, plan.height / 1000);
    this.cutWant = new Float32Array(plan.walls.length);
    this.built = buildFlat(plan, this.u, this.renderer.capabilities.getMaxAnisotropy());
    this.anchors = this.built.anchors;
    this.scene.add(this.built.root);
    this.nav = new Nav(plan, this.built.toWorld);

    this.domeR = this.domeFor(this.built);
    this.target.set(0, this.built.height * 0.3, 0);

    // Light. Lamps and bounced sun come from the built light field rather than three's point
    // lights, which would shine through walls and cost every surface on a phone.
    this.scene.add(this.hemi);
    this.fill.position.copy(FILL_DIR).multiplyScalar(20);
    this.scene.add(this.fill);
    const s = this.sunLight.shadow;
    this.coarse = !!window.matchMedia?.('(pointer: coarse)').matches;
    this.outdoors = new Outdoors(this.coarse ? 1024 : 2048);
    this.scene.add(this.outdoors.sky);
    s.mapSize.set(this.coarse ? 1536 : 2048, this.coarse ? 1536 : 2048);
    s.bias = -0.0003;
    // Enough to lift a receiver clear of its own depth across the whole width of the soft filter.
    s.normalBias = 0.024;
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight, this.sunLight.target);

    this.buildCompass();
    this.compass.position.y = -BASE + 0.01;
    this.compass.rotation.y = this.bearing * DEG;
    this.scene.add(this.compass);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.2, 40),
      new THREE.MeshBasicMaterial({ color: PAL.sun, transparent: true, opacity: 0, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    this.ring.renderOrder = 5;
    this.scene.add(this.ring);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    this.controls.maxPolarAngle = 1.42;
    this.controls.target.copy(this.target);
    this.controls.addEventListener('change', () => (this.dirty = true));
    // Only a person starts an orbit: from then on the Sun lens leaves the angle to them.
    this.controls.addEventListener('start', () => {
      this.sunSteer = false;
      this.sunChase = false;
    });

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    // Ahead of the orbit controls' own listener, so a second finger can be handed to them in time.
    window.addEventListener('pointerdown', this.onDownFirst, { capture: true });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.setCompass(0);
    this.applyLight();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Radius of the compass ring for a flat: clear of its corners. */
  private domeFor(built: Built): number {
    const size = built.box.getSize(new THREE.Vector3());
    return Math.hypot(size.x, size.z) / 2 + 0.9;
  }

  /** Compass ring and sun dome, drawn in a frame where -Z is true north, sized to the flat. */
  private buildCompass(): void {
    for (const o of [...this.compass.children]) {
      this.compass.remove(o);
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    }
    this.compassMats = [];
    const ink = 0x6b675f;
    const track = <T extends THREE.Material & { opacity: number }>(mat: T, base: number): T => {
      mat.transparent = true;
      mat.opacity = 0;
      this.compassMats.push({ mat, base });
      return mat;
    };
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.sin(a) * this.domeR, 0, -Math.cos(a) * this.domeR));
    }
    this.compass.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), track(new THREE.LineBasicMaterial({ color: ink }), 0.42)));
    const tickPts: THREE.Vector3[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const len = i % 18 === 0 ? 0.45 : i % 9 === 0 ? 0.28 : 0.12;
      tickPts.push(new THREE.Vector3(Math.sin(a) * this.domeR, 0, -Math.cos(a) * this.domeR));
      tickPts.push(new THREE.Vector3(Math.sin(a) * (this.domeR + len), 0, -Math.cos(a) * (this.domeR + len)));
    }
    this.compass.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), track(new THREE.LineBasicMaterial({ color: ink }), 0.5)));
    (['N', 'E', 'S', 'W'] as const).forEach((letter, i) => {
      const sp = letterSprite(letter, i === 0);
      const a = (i * Math.PI) / 2;
      sp.position.set(Math.sin(a) * (this.domeR + LETTER_OUT), 0.05, -Math.cos(a) * (this.domeR + LETTER_OUT));
      this.compassMats.push({ mat: sp.material, base: i === 0 ? 1 : 0.75 });
      this.compass.add(sp);
    });
    const dpr = this.renderer.getPixelRatio();
    this.pathDots = new THREE.Points(new THREE.BufferGeometry(), track(new THREE.PointsMaterial({ color: PAL.sun, size: 2.6 * dpr, sizeAttenuation: false }), 0.75));
    this.hourDots = new THREE.Points(new THREE.BufferGeometry(), track(new THREE.PointsMaterial({ color: PAL.sun, size: 6 * dpr, sizeAttenuation: false }), 0.95));
    this.pathDots.frustumCulled = false;
    this.hourDots.frustumCulled = false;
    this.drop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      track(new THREE.LineBasicMaterial({ color: PAL.sun }), 0.5)
    );
    this.drop.frustumCulled = false;
    this.sunSprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTexture(), depthWrite: false, blending: THREE.AdditiveBlending }), 1));
    this.sunSprite.scale.setScalar(4.2);
    this.sunCore = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), track(new THREE.MeshBasicMaterial({ color: 0xffb04d }), 1));
    this.compass.add(this.pathDots, this.hourDots, this.drop, this.sunSprite, this.sunCore);
  }

  // ── Framing ───────────────────────────────────────────────────────────────

  private get portrait(): boolean {
    return this.w < this.h * 0.9;
  }

  private planAngles(): { theta: number; phi: number } {
    return { theta: this.portrait ? Math.PI / 2 : 0, phi: 0.0006 };
  }

  private dollAngles(): { theta: number; phi: number } {
    return { theta: this.portrait ? Math.PI / 2 - 0.42 : 0.6, phi: 0.93 };
  }

  /** Distance at which the whole model fits the part of the screen not covered by controls. */
  private fit(theta: number, phi: number, margin = 0.86): number {
    return this.framing(theta, phi, this.boxCorners(), this.target, false, margin).d;
  }

  private boxCorners(): THREE.Vector3[] {
    const b = this.built.box;
    const out: THREE.Vector3[] = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [-BASE, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }

  /**
   * The camera distance at which points fit the free part of the screen, seen
   * from these angles about `base`. With `slide`, the target may also move up
   * the screen, so something tall such as the sun's dome is centred instead of
   * leaving the bottom of the view empty.
   */
  private framing(theta: number, phi: number, pts: THREE.Vector3[], base: THREE.Vector3, slide: boolean, margin = 0.86): { d: number; target: THREE.Vector3 } {
    const toCam = new THREE.Vector3().setFromSphericalCoords(1, Math.max(phi, 0.0006), theta);
    const fwd = toCam.clone().negate();
    const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const t = Math.tan((DOLL_FOV * DEG) / 2);
    const tall = this.virtualH;
    const tanV = ((t * (this.h - this.pad - this.padTop)) / tall) * margin;
    const tanH = ((t * (this.w - this.padX)) / tall) * margin;
    const c = new THREE.Vector3();
    const xs = pts.map((p) => Math.abs(c.copy(p).sub(base).dot(right)));
    const ys = pts.map((p) => c.copy(p).sub(base).dot(up));
    const zs = pts.map((p) => c.copy(p).sub(base).dot(fwd));
    let across = 0;
    for (let i = 0; i < pts.length; i++) across = Math.max(across, xs[i] / tanH - zs[i]);
    const upright = (lift: number) => {
      let d = 0;
      for (let i = 0; i < pts.length; i++) d = Math.max(d, Math.abs(ys[i] - lift) / tanV - zs[i]);
      return d;
    };
    let lift = 0;
    if (slide) {
      // Centre by height alone: when the width decides the distance, this still puts the
      // middle of the content in the middle of the free space. The need is convex in the lift.
      let lo = Math.min(...ys);
      let hi = Math.max(...ys);
      for (let k = 0; k < 40; k++) {
        const a = lo + (hi - lo) / 3;
        const b = hi - (hi - lo) / 3;
        if (upright(a) < upright(b)) hi = b;
        else lo = a;
      }
      lift = (lo + hi) / 2;
    }
    return { d: Math.max(across, upright(lift)), target: base.clone().addScaledVector(up, lift) };
  }

  /** Everything the sun lens draws, in world space: the ring and its letters on the table, the day's arc, and the sun. */
  private domePoints(): THREE.Vector3[] {
    this.compass.updateMatrixWorld();
    const m = this.compass.matrixWorld;
    const out: THREE.Vector3[] = [];
    const r = this.domeR + LETTER_OUT + 0.7;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      out.push(new THREE.Vector3(Math.sin(a) * r, 0, -Math.cos(a) * r).applyMatrix4(m));
    }
    for (const p of this.pathPts) out.push(p.clone().applyMatrix4(m));
    // The sun with room for its glow.
    if (this.sun.altitude > 0) out.push(this.onDome(this.sun).applyMatrix4(m).add(new THREE.Vector3(0, 0.9, 0)));
    return out;
  }

  private setOrbit(theta: number, phi: number, dist: number): void {
    this.camera.position.setFromSphericalCoords(dist, Math.max(phi, 0.0006), theta).add(this.target);
    this.camera.up.copy(UP);
    this.camera.lookAt(this.target);
    this.dirty = true;
  }

  /**
   * Keeps the depth range of an orbiting camera tight round the model. On a
   * phone the dollhouse is framed from far off, and with a near plane at half
   * a metre the millimetre lift of the section caps would start to flicker.
   */
  private fitDepth(least: number): void {
    // Everything drawn outside walk mode lies within the dome and its letters, round the origin.
    const dist = this.camera.position.length();
    const reach = this.domeR + LETTER_OUT + 2;
    let near = Math.max(least, dist - reach - 2);
    let far = dist + reach + 10;
    // The site, when it is on show, reaches a few hundred metres round the block.
    const site = this.site?.root.visible ? this.site : null;
    if (site) {
      const centre = this.sitePoint(0, 0, site.peak / 2);
      const r = Math.hypot(site.radius, site.peak / 2) + site.peak * 2;
      const d = this.camera.position.distanceTo(centre);
      near = Math.min(near, Math.max(least, d - r));
      far = Math.max(far, d + r);
    }
    if (Math.abs(near - this.camera.near) < near * 0.02 && Math.abs(far - this.camera.far) < far * 0.02) return;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Height of the image the camera renders, of which the canvas shows a
   * window: taller than the canvas by the difference of the bottom and top
   * insets, so its centre falls in the middle of the free space between them.
   */
  private get virtualH(): number {
    return this.h + Math.abs(this.pad - this.padTop);
  }

  private applyView(): void {
    const pad = this.pad;
    const padX = this.padX;
    const top = this.padTop;
    if (pad > 0.5 || padX > 0.5 || top > 0.5) {
      const tall = this.virtualH;
      this.camera.aspect = (this.w + padX) / tall;
      // The window sits low in the taller image for a bottom inset, high in it for a top one.
      this.camera.setViewOffset(this.w + padX, tall, 0, Math.max(0, pad - top), this.w, this.h);
    } else {
      this.camera.clearViewOffset();
      this.camera.aspect = this.w / this.h;
    }
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /**
   * Screen space taken by interface at the bottom, left and top, in CSS
   * pixels. The model centres in what is left. Leaving out `top` means none.
   */
  setInsets(bottom: number, left = 0, top = 0): void {
    if (this.mode === 'walk' || this.introRunning || this.pushing) return;
    const b0 = this.pad;
    const l0 = this.padX;
    const t0 = this.padTop;
    if (Math.abs(b0 - bottom) < 1 && Math.abs(l0 - left) < 1 && Math.abs(t0 - top) < 1) return;
    if (this.mode === 'plan') {
      this.pad = bottom;
      this.padX = left;
      this.padTop = top;
      this.applyView();
      const a = this.planAngles();
      this.setOrbit(a.theta, a.phi, this.fit(a.theta, a.phi, 0.8));
      return;
    }
    // The sun's controls are tall on a phone, so its dome is framed again for the room they leave.
    if (this.lens === 'sun' && this.mode === 'doll') {
      this.reframe(bottom, left, 0.5, top);
      return;
    }
    void this.tweens.run('pad', 0.5, (k) => {
      this.pad = lerp(b0, bottom, k);
      this.padX = lerp(l0, left, k);
      this.padTop = lerp(t0, top, k);
      this.applyView();
    });
  }

  resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    this.w = Math.max(1, el.clientWidth);
    this.h = Math.max(1, el.clientHeight);
    this.renderer.setSize(this.w, this.h, false);
    this.applyView();
    if (this.mode === 'plan') {
      const a = this.planAngles();
      this.setOrbit(a.theta, a.phi, this.fit(a.theta, a.phi, 0.8));
    } else if (this.mode === 'walk') {
      this.camera.fov = this.walkFov();
      this.camera.updateProjectionMatrix();
    } else if (this.mode === 'block') {
      if (!this.flying) this.blockControls();
    } else {
      const a = this.dollAngles();
      this.setLimits(this.fit(a.theta, a.phi));
    }
  }

  // ── Opening sequence ──────────────────────────────────────────────────────

  /** Draws the plan as lines, the state shown behind the welcome text. */
  showPlan(): Promise<void> {
    return this.tweens.run('draw', 1.6, (k) => (this.u.uDraw.value = k), { ease: ease.linear, delay: 0.25 });
  }

  /** Where the opening starts and ends, taken from the plan view on screen now. */
  private introPlan(bottom: number): IntroPlan {
    const from = this.planAngles();
    const to = this.dollAngles();
    const pad0 = this.pad;
    const padX0 = this.padX;
    this.pad = bottom;
    this.padX = 0;
    const d1 = this.fit(to.theta, to.phi);
    this.pad = pad0;
    this.padX = padX0;
    return { from, to, d0: this.camera.position.distanceTo(this.target), d1, pad0, padX0, bottom };
  }

  /**
   * The opening sequence as a function of time, so it plays and scrubs alike.
   * The camera tilts while the walls are still rising, so they are seen to
   * grow rather than just shorten toward a camera overhead; finishes wash out
   * from the front door behind them; furniture lands; and the sun comes up
   * last, so its shadows fall on a finished room.
   */
  private introAt(p: IntroPlan, t: number): void {
    const seg = (delay: number, dur: number, e: (k: number) => number = ease.linear) => e(clamp((t - delay) / dur, 0, 1));
    this.u.uRise.value = seg(0, 1.8);
    const k = seg(0.1, 2.6, ease.inOutQuart);
    this.pad = lerp(p.pad0, p.bottom, k);
    this.padX = lerp(p.padX0, 0, k);
    this.applyView();
    this.setOrbit(lerp(p.from.theta, p.to.theta, k), lerp(p.from.phi, p.to.phi, k), lerp(p.d0, p.d1, k));
    this.u.uReveal.value = seg(0.6, 1.9, ease.inOut);
    if (this.furnished) this.u.uPop.value = seg(1.5, 1.6);
    this.sunGain = seg(2.0, 1.4, ease.out);
    this.applyLight();
  }

  /** Walls rise from the plan, finishes wash in, furniture arrives, daylight comes up. */
  async intro(bottom = 0): Promise<void> {
    this.introRunning = true;
    this.tweens.kill('draw');
    this.u.uDraw.value = 1;
    const p = this.introPlan(bottom);
    // Walls that will be cut for the finished view only ever rise to their stub.
    this.stepCuts(0, p.to);
    await this.tweens.run('intro', INTRO_TIME, (k) => this.introAt(p, k * INTRO_TIME), { ease: ease.linear });
    (this.built.caps.material as THREE.Material).transparent = false;
    (this.built.caps.material as THREE.Material).needsUpdate = true;
    this.mode = 'doll';
    this.introRunning = false;
    this.setLimits(p.d1);
    this.controls.enabled = true;
    this.controls.update();
    this.orbitLive = true;
    this.hooks.mode?.('doll');
  }

  /**
   * Holds the opening sequence at `t` seconds, from the plan view, for
   * checking its frames one at a time. Call `jump` to leave it.
   */
  scrubIntro(t: number, bottom = 0): void {
    if (this.mode !== 'plan') return;
    if (!this.scrub) {
      this.tweens.kill('draw');
      this.u.uDraw.value = 1;
      this.introRunning = true;
      this.scrub = this.introPlan(bottom);
      this.stepCuts(0, this.scrub.to);
    }
    this.introAt(this.scrub, clamp(t, 0, INTRO_TIME));
    this.shadowDirty = true;
  }

  /** Zoom limits round the framed distance, out far enough for the whole sun dome. */
  private setLimits(d: number): void {
    const a = this.dollAngles();
    this.controls.minDistance = d * 0.28;
    const sun = this.framing(a.theta, a.phi, [...this.boxCorners(), ...this.domePoints()], this.target, true).d;
    this.controls.maxDistance = Math.max(d * 1.7, sun * 1.25);
  }

  /** Skips the opening sequence and lands on the finished model. For shared links and for tests. */
  jump(bottom = 0): void {
    // From the block, skipping the push-in lands where it would have ended.
    if (this.mode === 'block' && this.site) {
      this.tweens.kill('push');
      this.pushHold = null;
      if (!this.unit) this.setUnit(this.defaultUnit());
      const p = this.pushPlan(bottom, true);
      this.beginPush(p);
      this.pushAt(p, PUSH_TIME);
      this.arriveFlat(p);
      return;
    }
    for (const tag of ['draw', 'intro', 'camera', 'pop']) this.tweens.kill(tag);
    this.introRunning = false;
    this.u.uDraw.value = 1;
    this.u.uRise.value = 1;
    this.u.uReveal.value = 1;
    this.u.uPop.value = this.furnished ? 1 : 0;
    for (const o of this.built.furniture) o.visible = this.furnished;
    this.sunGain = 1;
    this.pad = bottom;
    this.padX = 0;
    this.applyView();
    const to = this.dollAngles();
    const d = this.fit(to.theta, to.phi);
    this.setOrbit(to.theta, to.phi, d);
    this.stepCuts(0, to);
    (this.built.caps.material as THREE.Material).transparent = false;
    (this.built.caps.material as THREE.Material).needsUpdate = true;
    this.mode = 'doll';
    this.scrub = null;
    this.setLimits(d);
    this.controls.enabled = true;
    this.controls.update();
    this.orbitLive = true;
    this.applyLight();
    this.hooks.mode?.('doll');
  }

  // ── Lenses ────────────────────────────────────────────────────────────────

  setLens(lens: Lens): void {
    if (this.lens === lens) return;
    this.lens = lens;
    const rule0 = this.u.uRule.value;
    const rule1 = lens === 'rules' ? 1 : 0;
    if (rule0 !== rule1) void this.tweens.run('rule', 0.55, (k) => (this.u.uRule.value = lerp(rule0, rule1, k)));
    const c0 = this.compassShow;
    const c1 = lens === 'sun' ? 1 : 0;
    if (c0 !== c1) void this.tweens.run('compass', 0.6, (k) => this.setCompass(lerp(c0, c1, k)));
    this.syncFurniture();
    if (lens !== 'rules') this.select(null);
    // Choosing the Sun lens hands it the angle again, until the person next turns the view.
    this.sunSteer = lens === 'sun';
    this.sunChase = false;
    if (this.mode === 'doll') this.reframe();
  }

  private setCompass(k: number): void {
    this.compassShow = k;
    for (const { mat, base } of this.compassMats) mat.opacity = base * k;
    // Out of the windows the real sky has its own sun; the ring is the dollhouse's.
    this.compass.visible = k > 0.01 && this.mode !== 'block' && this.outsideK < 0.5;
    this.placeSunMarker();
    this.dirty = true;
  }

  /** The orbit distance and target that frame what the current lens shows, from these angles. */
  private lensFraming(theta: number, phi: number): { d: number; target: THREE.Vector3 } {
    const home = new THREE.Vector3(0, this.built.height * 0.3, 0);
    // The sun lens frames its whole dome, so the north letter and the sun stay on screen on a phone.
    if (this.lens === 'sun') return this.framing(theta, phi, [...this.boxCorners(), ...this.domePoints()], home, true);
    return this.framing(theta, phi, this.boxCorners(), home, false);
  }

  /**
   * The camera azimuth that sees the day's arc side on, so the sun can be
   * followed and dragged along it: whichever side is nearer, and the current
   * azimuth when it is already close enough.
   */
  private arcAzimuth(theta: number): number {
    if (this.pathPts.length < 2) return theta;
    this.compass.updateMatrixWorld();
    const a = this.pathPts[0].clone().applyMatrix4(this.compass.matrixWorld);
    const b = this.pathPts[this.pathPts.length - 1].clone().applyMatrix4(this.compass.matrixWorld);
    const chord = Math.atan2(b.x - a.x, b.z - a.z);
    let turn = Infinity;
    for (const side of [chord + Math.PI / 2, chord - Math.PI / 2]) {
      const t = Math.atan2(Math.sin(side - theta), Math.cos(side - theta));
      if (Math.abs(t) < Math.abs(turn)) turn = t;
    }
    return Math.abs(turn) < 25 * DEG ? theta : theta + turn;
  }

  /**
   * The azimuth the Sun lens wants for the sun as it is now, turning from
   * `base`, the view of the day's arc side on. With the sun high its light
   * lies on the floors near the windows, seen from any side, so the arc is
   * shown square. As the sun drops the light climbs the far walls of the
   * rooms it reaches, and those face the sun, so the view turns round to the
   * sun's side to look along its light, by no more than LOW_SUN_TURN.
   */
  private sunAzimuth(base: number): number {
    const alt = this.sun.altitude;
    const low = 1 - smooth(LOW_SUN_LOW, LOW_SUN_HIGH, alt);
    if (low <= 0 || alt < -0.02) return base;
    const d = this.sunDir();
    const sunAz = Math.atan2(d.x, d.z);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    // Just off the sun's line, on whichever side of it the view already is.
    const side = wrap(base - sunAz) >= 0 ? 1 : -1;
    const turn = clamp(wrap(sunAz + side * LOW_SUN_OFF - base), -LOW_SUN_TURN, LOW_SUN_TURN);
    return base + turn * low;
  }

  /** Follows the sun with the Sun lens's view, eased, while the lens still has the angle. */
  private chaseSun(dt: number): void {
    if (this.mode !== 'doll' || this.lens !== 'sun' || !this.sunSteer) {
      this.sunChase = false;
      return;
    }
    // A framing move in progress finishes first.
    if (this.flying || this.introRunning || !this.orbitLive || this.tweens.has('camera')) return;
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const want = this.sunAzimuth(this.sunBase);
    const gap = Math.atan2(Math.sin(want - sph.theta), Math.cos(want - sph.theta));
    if (Math.abs(gap) < 0.002) {
      this.sunChase = false;
      return;
    }
    sph.theta += gap * (1 - Math.exp(-dt / SUN_FOLLOW));
    this.camera.position.setFromSpherical(sph).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.dirty = true;
  }

  /**
   * Moves the camera to frame the current lens, easing the screen insets to
   * new values on the way when they are given. It keeps the user's angle,
   * except that the sun lens swings round to see the day's arc side on, and,
   * until the person turns the view, toward the sun's side as it drops.
   */
  private reframe(pad = this.pad, padX = this.padX, dur = 0.9, top = this.padTop): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const theta0 = sph.theta;
    if (this.lens === 'sun') {
      sph.theta = this.arcAzimuth(sph.theta);
      if (this.sunSteer) {
        this.sunBase = sph.theta;
        sph.theta = this.sunAzimuth(this.sunBase);
      }
    }
    const p0 = this.pad;
    const x0 = this.padX;
    const top0 = this.padTop;
    this.pad = pad;
    this.padX = padX;
    this.padTop = top;
    const f = this.lensFraming(sph.theta, sph.phi);
    this.pad = p0;
    this.padX = x0;
    this.padTop = top0;
    this.controls.maxDistance = Math.max(this.controls.maxDistance, f.d * 1.25);
    const d0 = sph.radius;
    const t0 = this.controls.target.clone();
    this.orbitLive = false;
    void this.tweens
      .run('camera', dur, (k) => {
        this.pad = lerp(p0, pad, k);
        this.padX = lerp(x0, padX, k);
        this.padTop = lerp(top0, top, k);
        this.applyView();
        this.target.lerpVectors(t0, f.target, k);
        this.setOrbit(lerp(theta0, sph.theta, k), sph.phi, lerp(d0, f.d, k));
      })
      .then(() => {
        // Cut short by a flight (the push back out to the block), the camera is that flight's.
        if (this.mode !== 'doll' || this.flying) return;
        this.controls.target.copy(this.target);
        this.controls.update();
        this.orbitLive = true;
      });
  }

  setFurnished(on: boolean): void {
    this.furnished = on;
    this.syncFurniture();
  }

  private syncFurniture(): void {
    if (this.mode === 'plan') return;
    const want = this.furnished && this.lens !== 'rules' ? 1 : 0;
    const from = this.u.uPop.value;
    if (from === want) return;
    for (const o of this.built.furniture) o.visible = true;
    void this.tweens
      .run('pop', want ? 1.1 : 0.7, (k) => (this.u.uPop.value = lerp(from, want, k)), { ease: want ? ease.linear : ease.inOut })
      .then(() => {
        if (this.u.uPop.value === 0) for (const o of this.built.furniture) o.visible = false;
        this.shadowDirty = true;
        this.dirty = true;
      });
  }

  // ── Sun ───────────────────────────────────────────────────────────────────

  setSun(sun: Sun): void {
    this.sun = sun;
    this.applyLight();
  }

  setBearing(deg: number): void {
    this.bearing = deg;
    this.compass.rotation.y = deg * DEG;
    // The site turns with the compass, so its true north stays the compass's.
    if (this.site || this.unit) this.placeSite();
    this.applyLight();
  }

  /** The day's track across the sky, drawn as dots on the dome. */
  setDayPath(points: PathPoint[]): void {
    this.dayPath = points;
    const dots: number[] = [];
    const hours: number[] = [];
    this.pathPts = [];
    for (const p of points) {
      if (p.altitude < -0.01) continue;
      const v = this.onDome(p);
      dots.push(v.x, v.y, v.z);
      this.pathPts.push(v);
      if (p.minutes % 60 === 0) hours.push(v.x, v.y, v.z);
    }
    this.pathDots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    this.hourDots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(hours, 3));
    // Another month's arc may lie a little differently; the Sun lens turns from where it now shows side on.
    if (this.sunSteer) {
      this.sunBase = this.arcAzimuth(this.sunBase);
      this.sunChase = true;
    }
    this.dirty = true;
  }

  private onDome(s: Sun): THREE.Vector3 {
    const c = Math.cos(s.altitude);
    return new THREE.Vector3(Math.sin(s.azimuth) * c, Math.sin(s.altitude), -Math.cos(s.azimuth) * c).multiplyScalar(this.domeR);
  }

  private placeSunMarker(): void {
    const v = this.onDome(this.sun);
    const up = this.sun.altitude > -0.02 && this.compassShow > 0.01;
    this.sunSprite.visible = this.sunCore.visible = this.drop.visible = up;
    this.sunSprite.position.copy(v);
    this.sunCore.position.copy(v);
    const pos = this.drop.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, v.x, v.y, v.z);
    pos.setXYZ(1, v.x, 0, v.z);
    pos.needsUpdate = true;
  }

  /**
   * One light model from dawn to night. The sun is the key and is strong, so
   * its patches through the windows stand well clear of the sky light; the
   * sky is a little cool and the bounce from the paper a little warm, so lit
   * and shaded surfaces differ in hue as well as in value; after dark the
   * lamps take over from the field, room by room.
   */
  private applyLight(): void {
    const { azimuth, altitude } = this.sun;
    const c = Math.cos(altitude);
    const dir = new THREE.Vector3(Math.sin(azimuth) * c, Math.sin(altitude), -Math.cos(azimuth) * c).applyAxisAngle(UP, this.bearing * DEG);
    const day = smooth(-4 * DEG, 7 * DEG, altitude);
    const gold = 1 - smooth(4 * DEG, 32 * DEG, altitude);
    const g = this.sunGain;

    // Low sun crosses more air, so it is weaker as well as warmer.
    const up = smooth(-1 * DEG, 12 * DEG, altitude);
    this.sunLight.intensity = SUN * up * (0.7 + 0.3 * smooth(8 * DEG, 45 * DEG, altitude)) * g;
    sunColour(altitude, this.sunLight.color);
    this.fitShadow(dir);

    // Near sunset the sky dims and only warms a little; the sun carries the gold, so the shade
    // keeps its depth instead of the whole model turning one shade of peach.
    const warm = Math.pow(gold, 1.4);
    const sky = col(0xe8eef6).clone().lerp(col(0xeedfd3), warm);
    const ground = col(0xf2e8d8).clone().lerp(col(0xecd9c6), warm);
    this.hemi.color.copy(col(0x26304c)).lerp(sky, day);
    this.hemi.groundColor.copy(col(0x10131c)).lerp(ground, day);
    this.hemi.intensity = lerp(1.1, 2.3, day) * (1 - 0.2 * warm);
    this.fill.color.copy(col(0x9fb0d4)).lerp(col(0xf2f5fb).clone().lerp(col(0xf6dcc4), warm), day);
    this.fill.intensity = lerp(0.35, 0.8, day);

    // Lights come on as the sun goes down, a little before it is dark.
    const lamps = (1 - smooth(0.2, 0.85, day)) * g;
    this.lampsK = lamps;
    this.inkGhost();
    this.u.uLamp.value.copy(col(0xffc98c)).multiplyScalar(LAMP * lamps);
    (this.built.lamps.material as THREE.MeshLambertMaterial).emissiveIntensity = 2.6 * lamps;
    // The bounce only depends on where the sun is, and the opening calls this every frame.
    if (dir.distanceToSquared(this.bounceDir) > 1e-8) {
      this.built.field.setSun(dir);
      this.bounceDir.copy(dir);
      this.litDirty = true;
      if (this.sunSteer) this.sunChase = true;
    }
    this.u.uBounce.value.copy(this.sunLight.color).multiplyScalar(this.sunLight.intensity / BOUNCE_SCALE);
    this.u.uDay.value = day;

    // The model's shadow on the table: always a soft contact line, plus a quiet cast shadow
    // swept away from the sun that lengthens as it drops and fades before it gets absurd.
    const t = this.built.table.uniforms;
    const len = Math.min(4.5, 2.3 / Math.max(0.25, Math.tan(altitude)));
    const hl = Math.hypot(dir.x, dir.z) || 1;
    const size = this.built.tableSize;
    t.uShift.value.set((-dir.x / hl) * (len / size.x), (dir.z / hl) * (len / size.y));
    t.uCast.value = 0.17 * smooth(2 * DEG, 24 * DEG, altitude) * g * this.tableGain;
    t.uContact.value = lerp(0.12, 0.26, day) * this.tableGain;

    // The sky out of the windows is the page's for the hour. The far blocks fade toward the page
    // behind the block on the stage, and toward the horizon seen from inside.
    const stops = skyStops(day, gold);
    const haze = stops[this.outsideK > 0 ? 0 : 1];
    this.fogColour.setRGB(haze[0] / 255, haze[1] / 255, haze[2] / 255, THREE.SRGBColorSpace);
    this.glowColour.copy(this.sunLight.color).multiplyScalar(up);
    this.outdoors.setSky(stops, this.fogColour, dir, this.glowColour, smooth(-1 * DEG, 3 * DEG, altitude));

    // The site is a model under one low lamp: its shade deeper and cooler than a room's, its sunlit
    // faces held short of white so they keep the sun's colour, its windows lit with the flat's lamps,
    // and the far blocks hazed so the chosen one stands forward.
    if (this.site) {
      const su = this.site.u;
      su.uContact.value = lerp(0.16, 0.3, day);
      su.uNight.value = lamps;
      su.uSunK.value = SITE_SUN;
      // After dark the sky's light is so dim, and so blue, that the tone map's toe would crush white card to
      // black and push what is left to a saturated blue. A moonlit lift, strongest in red where the night sky
      // is weakest, keeps the blocks as dark blue-grey forms for their lit windows to sit in.
      const dark = 1 - smooth(0, 0.45, day);
      su.uShade.value.setRGB(lerp(0.95, 0.52, day) * (1 + 20 * dark), lerp(0.95, 0.57, day) * (1 + 15 * dark), lerp(1, 0.7, day) * (1 + 8 * dark));
      this.siteHaze(this.site);
      this.siteShadowDirty = true;
    }

    this.placeSunMarker();
    this.hooks.atmosphere?.(day, gold);
    this.shadowDirty = true;
    this.dirty = true;
  }

  /**
   * Fits the sun's shadow camera tightly round the model as the sun sees it,
   * so the map's texels are as small as they can be and the depth range is
   * short enough for a millimetre-scale bias. The filter is set in metres, so
   * the softness of a patch's edge does not change with the sun's angle.
   */
  private fitShadow(dir: THREE.Vector3): void {
    // On the block stage the fit opens out to the whole site, a few hundred metres across,
    // and closes back round the flat as the push-in arrives.
    const site = this.site && this.siteW > 0 ? this.site : null;
    const w = site ? this.siteW : 0;
    const centre = new THREE.Vector3(0, this.built.height / 2, 0);
    if (site) centre.lerp(this.sitePoint(0, 0, site.peak / 2), w);
    this.sunLight.position.copy(centre).addScaledVector(dir, lerp(40, site ? site.radius * 2 + site.peak : 40, w));
    this.sunLight.target.position.copy(centre);
    const cam = this.sunLight.shadow.camera;
    // Looking straight down, "up" must not be the view direction.
    cam.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.92) cam.up.set(0, 0, -1);
    const probe = this.shadowProbe;
    probe.up.copy(cam.up);
    probe.position.copy(this.sunLight.position);
    probe.lookAt(centre);
    probe.updateMatrixWorld();
    const extent = (pts: THREE.Vector3[]) => {
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
      const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (const p of pts) {
        p.applyMatrix4(probe.matrixWorldInverse);
        lo.min(p);
        hi.max(p);
      }
      return { lo, hi };
    };
    const b = this.built.box;
    const flat: THREE.Vector3[] = [];
    for (const x of [b.min.x - 0.2, b.max.x + 0.2]) for (const y of [-this.built.base, b.max.y + 0.1]) for (const z of [b.min.z - 0.2, b.max.z + 0.2]) flat.push(new THREE.Vector3(x, y, z));
    const { lo, hi } = extent(flat);
    if (site) {
      const pts: THREE.Vector3[] = [];
      for (const x of [-site.radius, site.radius]) for (const y of [0, site.peak]) for (const z of [-site.radius, site.radius]) pts.push(this.sitePoint(x, z, y));
      const s = extent(pts);
      lo.lerp(s.lo, w);
      hi.lerp(s.hi, w);
    }
    cam.left = lo.x;
    cam.right = hi.x;
    cam.bottom = lo.y;
    cam.top = hi.y;
    cam.near = Math.max(0.1, -hi.z - 0.5);
    cam.far = -lo.z + 0.5;
    cam.updateProjectionMatrix();
    const texel = Math.max(hi.x - lo.x, hi.y - lo.y) / this.sunLight.shadow.mapSize.x;
    this.sunLight.shadow.radius = Math.max(1, lerp(SOFT_STEP, SITE_SOFT, w) / texel);
    // The lift off a receiver's own depth grows with the texel, or the site's walls would shade themselves.
    this.sunLight.shadow.normalBias = Math.max(0.024, 1.4 * texel * w);
  }

  // ── Walking ───────────────────────────────────────────────────────────────

  private walkFov(): number {
    const wantH = 80 * DEG;
    return clamp((2 * Math.atan(Math.tan(wantH / 2) / (this.w / this.h))) / DEG, 58, 96);
  }

  private setShell(a: number): void {
    this.shellAlpha = a;
    for (const mesh of this.built.shell) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = a;
      mat.colorWrite = a > 0.01;
      mat.depthWrite = a > 0.98;
      // The ceiling stays in the scene when unseen, because it still has to cast the flat's shadow.
      if (!mesh.castShadow) mesh.visible = a > 0.01;
    }
  }

  /**
   * How clear the view out of the windows is, 0 to 1. Above 0 the sky is
   * drawn behind the glass and the site stands round the flat, whole, at its
   * true height below; it arrives fully hazed and clears as k rises, so the
   * view seems to come into focus rather than appear.
   */
  private setOutside(k: number): void {
    const was = this.outsideK > 0;
    this.outsideK = k;
    const on = k > 0;
    this.outdoors.setOpacity(k);
    const site = this.site;
    if (site && on !== was) this.viewFromInside(site, on);
    // The haze colour changes between the stage's and the horizon's.
    if (on !== was) this.applyLight();
    else if (site) this.siteHaze(site);
    this.setCompass(this.compassShow);
    this.walkDepth();
    this.dirty = true;
  }

  /**
   * The site set up to be seen from inside the flat, or put away again as the
   * dollhouse keeps it, hidden. From inside, the block stands whole and still,
   * except where its walls would cross or cover the flat; it casts no shadow
   * into the flat's map, which would close the windows, but has a map of its
   * own; and its walls show both faces, so a window that looks back into the
   * block sees the block, not through it.
   */
  private viewFromInside(site: SiteModel, on: boolean): void {
    site.root.visible = on;
    const u = site.u;
    u.uSplit.value = 1e4;
    u.uMove.value.set(0, 0, 0);
    u.uGround.value = 1;
    site.caps.visible = false;
    site.lines.position.y = 0;
    (site.faint.material as THREE.LineBasicMaterial).opacity = 0.22;
    this.setGhost(0);
    site.solid.castShadow = !on;
    const mat = site.solid.material as THREE.Material;
    mat.side = on ? THREE.DoubleSide : THREE.FrontSide;
    mat.needsUpdate = true;
    // From inside, the ground runs on to the horizon, solid, instead of fading into the page as the table does.
    site.far.visible = on;
    const ground = site.ground.material as THREE.MeshLambertMaterial;
    ground.transparent = !on;
    ground.depthWrite = on;
    ground.color.set(on ? PLATE_INSIDE : PLATE);
    const r = site.radius;
    if (on) u.uRim.value.set(site.groundReach * 2, site.groundReach * 2 + 1);
    else u.uRim.value.set(r * 0.32, r * 0.92);
    const b = this.built.box;
    if (on) {
      u.uHideMin.value.set(b.min.x - HIDE_MARGIN, -0.3, b.min.z - HIDE_MARGIN);
      u.uHideMax.value.set(b.max.x + HIDE_MARGIN, this.built.height + 0.45, b.max.z + HIDE_MARGIN);
    } else {
      u.uHideMin.value.set(1, 1, 1);
      u.uHideMax.value.set(-1, -1, -1);
      u.uSiteShadowOn.value = 0;
    }
    this.siteShadowDirty = this.shadowDirty = true;
  }

  /**
   * The haze on the site. On the stage it grows with distance from the
   * chosen block. From inside it grows with distance from the walker, is full
   * while the view opens and lifts as it clears.
   */
  private siteHaze(site: SiteModel): void {
    const u = site.u;
    const c = this.fogColour;
    const k = this.outsideK;
    if (k <= 0) {
      u.uFog.value.set(c.r, c.g, c.b, 0.6);
      u.uFogAt.value.set(0, 0, 0);
      u.uFogRange.value.set(...STAGE_HAZE);
      return;
    }
    u.uFog.value.set(c.r, c.g, c.b, lerp(1, WALK_HAZE, k));
    u.uFogRange.value.set(lerp(-1, WALK_HAZE_NEAR, k), lerp(0, WALK_HAZE_FAR, k));
    u.uFogAt.value.copy(this.camera.position).applyMatrix4(this.siteInverse);
  }

  /** Walking, the far plane reaches the last block in view; with no site nothing outside the flat needs depth. */
  private walkDepth(): void {
    if (this.mode !== 'walk' || this.flying) return;
    const site = this.outsideK > 0 ? this.site : null;
    const far = site ? this.camera.position.distanceTo(this.sitePoint(0, 0, 0)) + site.groundReach * 1.42 + site.peak : 60;
    if (this.camera.near === 0.06 && Math.abs(far - this.camera.far) < far * 0.02) return;
    this.camera.near = 0.06;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  /** Before a frame with the view open: the haze follows the walker, and the site's shadow is drawn again if the sun or the site moved. */
  private stepOutside(): void {
    const site = this.site;
    if (!site) return;
    this.siteHaze(site);
    const u = site.u;
    const up = this.sun.altitude > -0.01;
    u.uSiteShadowOn.value = up ? 1 : 0;
    if (!up || !this.siteShadowDirty) return;
    this.siteShadowDirty = false;
    const pts: THREE.Vector3[] = [];
    for (const x of [-site.radius, site.radius]) for (const y of [0, site.peak]) for (const z of [-site.radius, site.radius]) pts.push(this.sitePoint(x, z, y));
    this.outdoors.fit(pts, this.sunDir(), WALK_SITE_SOFT);
    this.outdoors.render(this.renderer, this.scene, site.solid);
    u.uSiteShadow.value = this.outdoors.map.texture;
    u.uSiteShadowMatrix.value.copy(this.outdoors.matrix);
    u.uSiteShadowSoft.value.copy(this.outdoors.soft);
  }

  /**
   * Walks in from the dollhouse: to `at` (plan mm, the front door when left
   * out), facing `lookAt`. With `now`, there is no flight in and the view out
   * is clear at once, as for reduced motion and screenshots.
   */
  async enterWalk(at?: { x: number; y: number }, lookAt?: { x: number; y: number }, opts: { now?: boolean } = {}): Promise<void> {
    if (this.mode !== 'doll') return;
    this.saved = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    this.controls.enabled = false;
    this.orbitLive = false;
    this.tweens.kill('camera');
    this.mode = 'walk';
    this.hooks.mode?.('walk');
    this.select(null);

    const want = at ? this.built.toWorld(at.x, at.y) : [this.built.entry.x, this.built.entry.z];
    const spot = this.nav.nearestFree({ x: want[0], z: want[1] }) ?? { x: this.built.entry.x, z: this.built.entry.z };
    this.walk.x = spot.x;
    this.walk.z = spot.z;
    if (lookAt) {
      const [lx, lz] = this.built.toWorld(lookAt.x, lookAt.y);
      this.walk.yaw = Math.atan2(-(lx - spot.x), -(lz - spot.z));
    } else {
      this.walk.yaw = FACE_YAW[this.plan.entry.face];
    }
    this.walk.pitch = -0.04;
    this.walk.route = null;

    const p0 = this.camera.position.clone();
    const q0 = this.camera.quaternion.clone();
    const f0 = this.camera.fov;
    const pad0 = this.pad;
    const top0 = this.padTop;
    const p1 = new THREE.Vector3(spot.x, EYE, spot.z);
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.walk.pitch, this.walk.yaw, 0, 'YXZ'));
    const f1 = this.walkFov();
    this.camera.near = 0.06;
    if (opts.now) {
      // Inside, every wall stands; with no flight there is no time for the cut ones to rise.
      this.u.uCut.value.fill(0);
      this.cutWant.fill(0);
      this.fitHighlight();
      this.camera.fov = f1;
      this.pad = 0;
      this.padTop = 0;
      this.applyView();
      this.setShell(1);
      this.u.uInside.value = 1;
      this.syncWalkCamera();
      this.setOutside(1);
      return;
    }
    this.flying = true;
    await this.tweens.run(
      'camera',
      1.9,
      (k) => {
        this.camera.position.lerpVectors(p0, p1, k);
        this.camera.quaternion.slerpQuaternions(q0, q1, smooth(0.1, 1, k));
        this.camera.fov = lerp(f0, f1, k);
        // First person fills the screen: the interface floats over it.
        this.pad = lerp(pad0, 0, k);
        this.padTop = lerp(top0, 0, k);
        this.applyView();
        this.setShell(smooth(0.62, 0.97, k));
        // Under the ceiling the sky reaches a room only through its windows.
        this.u.uInside.value = smooth(0.5, 1, k);
      },
      { ease: ease.inOutQuart }
    );
    this.flying = false;
    this.syncWalkCamera();
    // Only now, under a closed ceiling, can the block stand round the flat without hiding it.
    if (this.mode === 'walk') void this.tweens.run('outside', OUTSIDE_TIME, (k) => this.setOutside(k), { ease: ease.out });
  }

  async exitWalk(): Promise<void> {
    if (this.mode !== 'walk' || !this.saved) return;
    const saved = this.saved;
    this.walk.route = null;
    this.walk.keys.clear();
    const p0 = this.camera.position.clone();
    const q0 = this.camera.quaternion.clone();
    const f0 = this.camera.fov;
    const probe = new THREE.PerspectiveCamera();
    probe.position.copy(saved.pos);
    probe.lookAt(saved.target);
    const q1 = probe.quaternion.clone();
    this.mode = 'doll';
    this.hooks.mode?.('doll');
    this.flying = true;
    this.tweens.kill('outside');
    const out0 = this.outsideK;
    await this.tweens.run(
      'camera',
      1.6,
      (k) => {
        this.camera.position.lerpVectors(p0, saved.pos, k);
        this.camera.quaternion.slerpQuaternions(q0, q1, smooth(0, 0.85, k));
        this.camera.fov = lerp(f0, DOLL_FOV, k);
        this.applyView();
        // The view out hazes over and the block steps away before the ceiling lifts off.
        this.setOutside(out0 * (1 - smooth(0, 0.12, k)));
        this.setShell(1 - smooth(0.1, 0.42, k));
        this.u.uInside.value = 1 - smooth(0.1, 0.5, k);
      },
      { ease: ease.inOutQuart }
    );
    this.flying = false;
    this.camera.near = 0.5;
    this.camera.updateProjectionMatrix();
    this.target.copy(saved.target);
    this.controls.target.copy(saved.target);
    this.controls.enabled = true;
    this.controls.update();
    this.orbitLive = true;
    this.saved = null;
  }

  private syncWalkCamera(): void {
    this.camera.position.set(this.walk.x, EYE, this.walk.z);
    this.camera.rotation.set(this.walk.pitch, this.walk.yaw, 0, 'YXZ');
    this.dirty = true;
  }

  /** Where the walker stands and looks, in plan millimetres, for the mini-map. */
  walkPose(): { x: number; y: number; yaw: number } {
    const [ox, oz] = this.built.toWorld(0, 0);
    return { x: (this.walk.x - ox) * 1000, y: (this.walk.z - oz) * 1000, yaw: this.walk.yaw };
  }

  private goTo(dest: P2): void {
    const pts = this.nav.path({ x: this.walk.x, z: this.walk.z }, dest);
    if (!pts || pts.length < 2) return;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const len = cum[cum.length - 1];
    if (len < 0.05) return;
    this.walk.route = { pts, cum, len, s: 0, t: 0, dur: clamp(len / 1.9, 0.7, 7) };
    this.walk.looking = false;
    const end = pts[pts.length - 1];
    this.ring.position.set(end.x, 0.012, end.z);
    const mat = this.ring.material as THREE.MeshBasicMaterial;
    void this.tweens.run(
      'ring',
      this.walk.route.dur + 0.3,
      (k) => {
        mat.opacity = 0.9 * (1 - smooth(0.7, 1, k));
        this.ring.scale.setScalar(1 + 0.25 * Math.sin(k * 14) * (1 - k));
      },
      { ease: ease.linear }
    );
  }

  private stepWalk(dt: number): void {
    const wk = this.walk;
    const r = wk.route;
    if (r) {
      r.t = Math.min(1, r.t + dt / r.dur);
      const s = ease.inOut(r.t) * r.len;
      let i = 1;
      while (i < r.cum.length - 1 && r.cum[i] < s) i++;
      const seg = r.cum[i] - r.cum[i - 1] || 1;
      const k = clamp((s - r.cum[i - 1]) / seg, 0, 1);
      const a = r.pts[i - 1];
      const b = r.pts[i];
      wk.x = lerp(a.x, b.x, k);
      wk.z = lerp(a.z, b.z, k);
      if (!wk.looking && r.t < 0.92) {
        // Turn gently toward where the route is heading.
        const ahead = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        let diff = ahead - wk.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        wk.yaw += diff * Math.min(1, dt * 2.4);
        wk.pitch = lerp(wk.pitch, -0.04, Math.min(1, dt * 2));
      }
      if (r.t >= 1) wk.route = null;
      this.syncWalkCamera();
      return;
    }
    if (!wk.keys.size) return;
    let f = 0;
    let sde = 0;
    if (wk.keys.has('w') || wk.keys.has('arrowup')) f += 1;
    if (wk.keys.has('s') || wk.keys.has('arrowdown')) f -= 1;
    if (wk.keys.has('d')) sde += 1;
    if (wk.keys.has('a')) sde -= 1;
    if (wk.keys.has('arrowleft')) wk.yaw += dt * 1.7;
    if (wk.keys.has('arrowright')) wk.yaw -= dt * 1.7;
    const speed = 2.1 * dt;
    const dx = (-Math.sin(wk.yaw) * f + Math.cos(wk.yaw) * sde) * speed;
    const dz = (-Math.cos(wk.yaw) * f - Math.sin(wk.yaw) * sde) * speed;
    if (this.nav.isFree({ x: wk.x + dx, z: wk.z })) wk.x += dx;
    if (this.nav.isFree({ x: wk.x, z: wk.z + dz })) wk.z += dz;
    this.syncWalkCamera();
  }

  // ── Block stage ───────────────────────────────────────────────────────────

  /** The sides of the chosen block, as `facades(block.footprint)` lists them; empty before showBlock. */
  get blockFacades(): Facade[] {
    return this.site?.facades ?? [];
  }

  /**
   * Builds the block among its neighbours, frames it and enters block mode,
   * at once from wherever the viewer is, so the app can start here and a flat
   * can come straight back (exitToBlock is the animated way back). Called
   * again for the same block, say once its storey count has arrived, it keeps
   * the marked storey and the unit.
   */
  showBlock(site: BlockSite, bottom = this.pad): void {
    const same = this.siteSpec?.block.postal === site.block.postal;
    this.dropSite();
    this.leaveWalkNow();
    this.select(null);
    this.siteSpec = site;
    this.site = buildSite(site, this.coarse, () => (this.dirty = true));
    this.site.u.uSiteShadow.value = this.outdoors.map.texture;
    this.siteShadowDirty = true;
    this.scene.add(this.site.root);
    if (!same) {
      this.unit = null;
      this.marked = 0;
    }
    if (this.unit) this.unit.storey = clamp(this.unit.storey, 1, this.site.storeys);
    this.marked = Math.min(this.marked, this.site.storeys);
    const keep = this.mode === 'block';
    this.placeSite();
    this.buildGhost();
    this.applyBand(true);
    this.finishFlat();
    this.mode = 'block';
    this.closeBlock();
    this.pad = bottom;
    if (!keep) this.padX = 0;
    this.applyView();
    // Rebuilt in place, the view stays where the person left it, side inset and all; anything else starts framed.
    if (!keep) {
      const a = this.blockAngles();
      const f = this.blockFraming(a.theta, a.phi);
      this.target.copy(f.target);
      this.setOrbit(a.theta, a.phi, f.d);
    }
    this.blockControls();
    this.applyLight();
    this.hooks.mode?.('block');
  }

  /** Marks storey n on the block in the sun's orange. 0 clears the mark. */
  setStorey(n: number): void {
    this.marked = this.site ? clamp(Math.round(n), 0, this.site.storeys) : Math.max(0, Math.round(n));
    this.applyBand(false);
  }

  /**
   * Says where the flat is: a storey, a side, and how far along it. The block
   * is moved round the flat so its window side lies on that side there; the
   * flat must already face that side's bearing, so set the bearing to
   * `northForFacing(plan, unit.facade.bearing)` alongside. Null clears it.
   */
  setUnit(unit: Unit | null): void {
    this.unit = unit ? { ...unit, storey: clamp(Math.round(unit.storey), 1, this.site?.storeys ?? Math.max(1, Math.round(unit.storey))) } : null;
    this.placeSite();
    this.buildGhost();
  }

  /** Turns the block to show the flat's side three-quarter on, as for a link that opens with a unit chosen. */
  frameUnit(): Promise<void> {
    if (this.mode !== 'block' || !this.site || !this.unit || this.flying) return Promise.resolve();
    const win = placeSite(this.current, this.bearing, this.unit, this.built.toWorld).window;
    if (!win) return Promise.resolve();
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const turn = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const theta = this.unitView(win, sph.phi);
    const to = this.blockFraming(theta, sph.phi);
    const t0 = this.controls.target.clone();
    const theta0 = sph.theta;
    const dTheta = turn(theta - theta0);
    this.orbitLive = false;
    return this.tweens
      .run('camera', 0.9, (k) => {
        this.target.lerpVectors(t0, to.target, k);
        this.setOrbit(theta0 + dTheta * k, sph.phi, lerp(sph.radius, to.d, k));
      })
      .then(() => {
        if (this.mode === 'block' && !this.flying) this.blockControls();
      });
  }

  /** A point of the site in the world: metres east and north of the block's centroid, metres above the ground. For pinning labels. */
  sitePoint(east: number, north: number, up: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(east, up, -north).applyMatrix4(this.siteMatrix);
  }

  /**
   * The push-in: one move from the block to the flat's storey and into the
   * dollhouse, while the top of the block lifts away, the neighbours and the
   * storeys below sink into the table, and the flat is left standing where it
   * was, on its own paper. Ends in doll mode exactly as the opening does.
   */
  async enterFlat(bottom = this.pad): Promise<void> {
    if (this.mode !== 'block' || !this.site || this.flying) return;
    if (!this.unit) this.setUnit(this.defaultUnit());
    const p = this.pushPlan(bottom, true);
    this.beginPush(p);
    await this.tweens.run('push', PUSH_TIME, (k) => this.pushAt(p, k * PUSH_TIME), { ease: ease.linear });
    if (this.pushing) this.arriveFlat(p);
  }

  /** The push-in in reverse, from the dollhouse back out to the block, looking at the flat's side. */
  async exitToBlock(bottom = this.pad): Promise<void> {
    if (this.mode === 'walk') await this.exitWalk();
    if (this.mode !== 'doll' || !this.site || this.flying) return;
    if (!this.unit) this.setUnit(this.defaultUnit());
    this.select(null);
    const p = this.pushPlan(bottom, false);
    this.beginPush(p);
    this.site.root.visible = true;
    await this.tweens.run('push', PUSH_TIME, (k) => this.pushAt(p, (1 - k) * PUSH_TIME), { ease: ease.linear });
    if (!this.pushing) return;
    this.pushing = false;
    this.flying = false;
    this.mode = 'block';
    this.closeBlock();
    this.target.copy(p.block.target);
    this.blockControls();
    this.applyLight();
    this.hooks.mode?.('block');
  }

  /**
   * Holds the push-in at `t` seconds (0 to 3.6), from block mode, for
   * checking its frames one at a time. showBlock or jump leaves it.
   */
  scrubPush(t: number, bottom = this.pad): void {
    if (this.mode !== 'block' || !this.site) return;
    if (!this.pushHold) {
      if (!this.unit) this.setUnit(this.defaultUnit());
      this.pushHold = this.pushPlan(bottom, true);
      this.beginPush(this.pushHold);
    }
    this.pushAt(this.pushHold, clamp(t, 0, PUSH_TIME));
  }

  /** Draw calls and triangles of the last frame, shadow pass included. */
  renderStats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  /**
   * Replaces the flat with another layout, or its mirror, in place: in the
   * dollhouse, on the block stage, or before the opening. The bearing, sun,
   * site, storey and unit stay; the block moves round the new flat's window
   * side, and the interface sets the new flat's bearing alongside.
   */
  setPlan(plan: Plan): void {
    if (plan === this.current) return;
    this.leaveWalkNow();
    this.select(null);
    const old = this.built;
    const u0 = this.u;
    this.scene.remove(old.root);
    old.dispose();
    this.current = plan;
    this.u = makeUniforms(plan.walls.length, plan.height / 1000);
    for (const key of ['uRise', 'uDraw', 'uRule', 'uPop', 'uReveal', 'uInside', 'uDay'] as const) this.u[key].value = u0[key].value;
    this.u.uLamp.value.copy(u0.uLamp.value);
    this.u.uBounce.value.copy(u0.uBounce.value);
    this.cutWant = new Float32Array(plan.walls.length);
    this.built = buildFlat(plan, this.u, this.renderer.capabilities.getMaxAnisotropy());
    this.anchors = this.built.anchors;
    this.nav = new Nav(plan, this.built.toWorld);
    this.scene.add(this.built.root);
    if (this.mode !== 'plan') {
      (this.built.caps.material as THREE.Material).transparent = false;
      for (const o of this.built.furniture) o.visible = this.u.uPop.value > 0;
    }
    this.built.root.visible = this.mode !== 'block' || this.pushing;
    this.domeR = this.domeFor(this.built);
    this.buildCompass();
    this.setDayPath(this.dayPath);
    this.setCompass(this.compassShow);
    // The light field's bounce is spread for a sun direction; the new flat needs its own.
    this.bounceDir.set(0, -1, 0);
    if (this.site) {
      this.placeSite();
      this.buildGhost();
    }
    if (this.mode === 'plan') {
      this.target.set(0, this.built.height * 0.3, 0);
      const a = this.planAngles();
      this.setOrbit(a.theta, a.phi, this.fit(a.theta, a.phi, 0.8));
    } else if (this.mode === 'doll') {
      const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      this.stepCuts(0, { theta: sph.theta, phi: sph.phi });
      this.setLimits(this.fit(sph.theta, sph.phi));
      this.reframe();
    }
    this.applyLight();
  }

  /** Back to the dollhouse at once from a walk, for changes that cannot wait for the walk out. */
  private leaveWalkNow(): void {
    if (this.mode !== 'walk' || !this.saved) return;
    this.tweens.kill('camera');
    this.tweens.kill('outside');
    this.setOutside(0);
    this.walk.route = null;
    this.walk.keys.clear();
    this.flying = false;
    this.camera.position.copy(this.saved.pos);
    this.camera.fov = DOLL_FOV;
    this.camera.near = 0.5;
    this.camera.updateProjectionMatrix();
    this.target.copy(this.saved.target);
    this.controls.target.copy(this.saved.target);
    this.camera.lookAt(this.target);
    this.setShell(0);
    this.u.uInside.value = 0;
    this.applyView();
    this.saved = null;
    this.mode = 'doll';
    this.controls.enabled = true;
    this.controls.update();
    this.orbitLive = true;
    this.hooks.mode?.('doll');
  }

  /** The flat as it stands after its opening, ready to be revealed whenever the push-in comes. */
  private finishFlat(): void {
    if (this.mode !== 'plan') return;
    for (const tag of ['draw', 'intro']) this.tweens.kill(tag);
    this.introRunning = false;
    this.scrub = null;
    this.u.uDraw.value = 1;
    this.u.uRise.value = 1;
    this.u.uReveal.value = 1;
    this.u.uPop.value = this.furnished ? 1 : 0;
    for (const o of this.built.furniture) o.visible = this.furnished;
    this.sunGain = 1;
    (this.built.caps.material as THREE.Material).transparent = false;
    (this.built.caps.material as THREE.Material).needsUpdate = true;
  }

  private dropSite(): void {
    this.tweens.kill('push');
    this.pushing = false;
    this.pushHold = null;
    this.flying = false;
    if (!this.site) return;
    this.scene.remove(this.site.root);
    this.site.dispose();
    this.site = null;
  }

  /** The block whole and on show, the flat hidden inside it, the dollhouse's ring and table put away. */
  private closeBlock(): void {
    const site = this.site;
    if (!site) return;
    this.pushHold = null;
    this.pushing = false;
    site.root.visible = true;
    site.u.uSplit.value = 1e4;
    site.u.uMove.value.set(0, 0, 0);
    site.u.uGround.value = 1;
    site.caps.visible = false;
    site.lines.position.y = 0;
    (site.faint.material as THREE.LineBasicMaterial).opacity = 0.22;
    this.setGhost(1);
    this.built.root.visible = false;
    this.compass.visible = false;
    this.siteW = 1;
    this.tableGain = 0;
    this.shadowDirty = this.dirty = true;
  }

  /** Moves the site round the flat for the bearing, the flat and the unit, carrying a block-mode camera along so nothing jumps. */
  private placeSite(): void {
    const site = this.site;
    const p = placeSite(this.current, this.bearing, this.unit, this.built.toWorld);
    const m = new THREE.Matrix4().makeRotationY(p.yaw).setPosition(p.offset);
    if (this.mode === 'block' && !this.flying) {
      const delta = m.clone().multiply(this.siteMatrix.clone().invert());
      this.camera.position.applyMatrix4(delta);
      this.target.applyMatrix4(delta);
      this.controls.target.applyMatrix4(delta);
      this.camera.lookAt(this.target);
    }
    this.siteMatrix.copy(m);
    this.siteInverse.copy(m).invert();
    if (site) {
      site.root.position.copy(p.offset);
      site.root.rotation.set(0, p.yaw, 0);
      site.root.updateMatrixWorld(true);
    }
    this.siteShadowDirty = this.shadowDirty = this.dirty = true;
  }

  /** The unit the flat goes to when none was chosen: the marked storey, on the side its windows face now. */
  private defaultUnit(): Unit {
    const site = this.site!;
    const main = mainFacade({ ...this.current, north: this.bearing });
    const facade = (main && facadeFacing(site.facades, main.bearing)) ?? site.facades[0];
    return { storey: this.marked || Math.max(2, Math.round(site.storeys * 0.6)), facade, along: 0.5 };
  }

  private applyBand(now: boolean): void {
    const site = this.site;
    if (!site) return;
    const n = this.marked;
    const y0 = n > 0 ? floorY(n) : site.u.uBand.value.x;
    const y1 = n > 0 ? y0 + (n <= 1 ? GROUND : STOREY) : site.u.uBand.value.y;
    const on = n > 0 ? 1 : 0;
    const band = site.u.uBand.value;
    if (now || site.u.uBandOn.value === 0) {
      this.tweens.kill('band');
      band.set(y0, y1);
      if (now) site.u.uBandOn.value = on;
    }
    const from = band.clone();
    const on0 = site.u.uBandOn.value;
    if (now) {
      this.dirty = true;
      return;
    }
    // The band glides to its storey, quickly enough to keep up with a finger.
    void this.tweens.run(
      'band',
      0.16,
      (k) => {
        band.set(lerp(from.x, y0, k), lerp(from.y, y1, k));
        site.u.uBandOn.value = lerp(on0, on, k);
      },
      { ease: ease.out }
    );
  }

  /** The flat's outline on its storey: an orange patch where it meets the facade, and its volume seen through the block. */
  private buildGhost(): void {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      this.ghost = null;
    }
    if (!this.unit || !this.site) return;
    const h = Math.min(this.current.height / 1000, STOREY - 0.2);
    const ring = this.current.outline.map(([x, y]) => this.built.toWorld(x, y));
    const pos: number[] = [];
    const edge: number[] = [];
    ring.forEach(([x0, z0], i) => {
      const [x1, z1] = ring[(i + 1) % ring.length];
      pos.push(x0, 0, z0, x1, 0, z1, x1, h, z1, x0, 0, z0, x1, h, z1, x0, h, z0);
      edge.push(x0, 0, z0, x1, 0, z1, x0, h, z0, x1, h, z1, x0, 0, z0, x0, h, z0);
    });
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) for (const i of [a, b, c]) pos.push(ring[i][0], h, ring[i][1]);
    const faces = new THREE.BufferGeometry();
    faces.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    const g = new THREE.Group();
    // In front of the facade it shares a plane with, so the patch wins there without a gap.
    const patch = new THREE.Mesh(
      faces,
      new THREE.MeshBasicMaterial({ color: PAL.sun, transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 })
    );
    const through = new THREE.Mesh(faces, new THREE.MeshBasicMaterial({ color: PAL.sun, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    const outline = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: PAL.sun, transparent: true, depthTest: false }));
    patch.renderOrder = 7;
    through.renderOrder = 8;
    outline.renderOrder = 9;
    g.add(patch, through, outline);
    // The patch nearly solid, so the flat reads as the strongest mark on its peach-tinted storey.
    g.userData.base = [0.92, 0.16, 0.9];
    this.ghost = g;
    this.scene.add(g);
    this.inkGhost();
    this.setGhost(this.mode === 'block' && !this.pushing ? 1 : 0);
  }

  /** The unit's outline: graphite on the card by day, so it does not vanish into the orange; lamplight on the dark block at night. */
  private inkGhost(): void {
    const line = this.ghost?.children[2] as THREE.LineSegments | undefined;
    if (!line) return;
    (line.material as THREE.LineBasicMaterial).color.copy(col(PAL.capSolid)).lerp(col(0xfff0dc), this.lampsK);
  }

  private setGhost(k: number): void {
    const g = this.ghost;
    if (!g) return;
    const base = g.userData.base as number[];
    g.children.forEach((o, i) => ((o as THREE.Mesh).material as THREE.Material).opacity = base[i] * k);
    g.visible = k > 0.01;
    this.dirty = true;
  }

  /**
   * Where the block is first seen from: across the sun from a little to its
   * side, so lit and shaded faces read apart and the shadows run across the
   * table, turned as far as it takes to keep the neighbours from standing in
   * front of the block.
   */
  private blockAngles(): { theta: number; phi: number } {
    const d = this.sunDir();
    const sun = Math.atan2(d.x, d.z);
    const phi = this.portrait ? 1.08 : 1.04;
    return { theta: this.clearView([sun + 1.15, sun - 1.15], phi, Math.PI, [], true), phi };
  }

  /** The azimuth that shows the flat's side three-quarter on and within about 75° of square, past the neighbours if it can. */
  private unitView(win: { point: THREE.Vector3; normal: THREE.Vector3 }, phi: number): number {
    const face = Math.atan2(win.normal.x, win.normal.z);
    // The flat itself, on its storey and a little either side of it, matters most.
    const toSite = this.siteMatrix.clone().invert();
    const side = new THREE.Vector3(win.normal.z, 0, -win.normal.x);
    const focus = [-5, 0, 5].map((s) => win.point.clone().addScaledVector(win.normal, 0.5).addScaledVector(side, s).setY(1.3).applyMatrix4(toSite));
    return this.clearView([face + 0.55, face - 0.55], phi, 0.75, focus);
  }

  /**
   * The camera azimuth, within `spread` of the ideal ones, from which the
   * neighbours hide least of the block, and of the `focus` points (site frame)
   * most of all; nearer an ideal wins a tie. With `number`, it also wants a
   * painted block number in view, unhidden and no more than about 40° off
   * square, so the block can be read by its number on arrival.
   */
  private clearView(ideal: number[], phi: number, spread: number, focus: THREE.Vector3[], number = false): number {
    const site = this.site!;
    const b = site.box;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const pts: THREE.Vector3[] = [];
    for (const f of [0.06, 0.2, 0.4, 0.6, 0.8])
      for (const [x, z] of [
        [cx, cz],
        [b.min.x, cz],
        [b.max.x, cz],
        [cx, b.min.z],
        [cx, b.max.z]
      ])
        pts.push(new THREE.Vector3(x, site.top * f, z));
    const toSite = this.siteMatrix.clone().invert();
    const gap = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    let best = { theta: ideal[0], score: Infinity };
    for (let i = 0; i < 36; i++) {
      const theta = (i / 36) * Math.PI * 2;
      const turn = Math.min(...ideal.map((t) => gap(theta - t)));
      if (turn > spread) continue;
      const f = this.blockFraming(theta, phi);
      const eye = new THREE.Vector3().setFromSphericalCoords(f.d, phi, theta).add(f.target).applyMatrix4(toSite);
      const blocked = pts.filter((p) => site.hidden(eye, p)).length / pts.length + focus.filter((p) => site.hidden(eye, p)).length / Math.max(1, focus.length);
      let score = blocked + 0.5 * (turn / (Math.PI / 2)) ** 2;
      if (number && site.numbers.length) {
        let seen = 0;
        for (const n of site.numbers) {
          const facing = n.normal.dot(eye.clone().sub(n.at).normalize());
          if (!site.hidden(eye, n.at)) seen = Math.max(seen, clamp((facing - 0.35) / 0.4, 0, 1));
        }
        score += NUMBER_SEEN * (1 - seen) ** 2;
      }
      if (score < best.score) best = { theta, score };
    }
    return best.theta;
  }

  private sunDir(): THREE.Vector3 {
    const { azimuth, altitude } = this.sun;
    const c = Math.cos(altitude);
    return new THREE.Vector3(Math.sin(azimuth) * c, Math.sin(altitude), -Math.cos(azimuth) * c).applyAxisAngle(UP, this.bearing * DEG);
  }

  /** The chosen block's box, in the world. */
  private blockCorners(): THREE.Vector3[] {
    const b = this.site!.box;
    const out: THREE.Vector3[] = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z).applyMatrix4(this.siteMatrix));
    return out;
  }

  /** Distance and target that frame the chosen block with room round it for its neighbours. */
  private blockFraming(theta: number, phi: number): { d: number; target: THREE.Vector3 } {
    const b = this.site!.box;
    const base = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y * 0.42, (b.min.z + b.max.z) / 2).applyMatrix4(this.siteMatrix);
    return this.framing(theta, phi, this.blockCorners(), base, false, 0.74);
  }

  /** The block framed afresh for new insets, at the angle the person left it, easing there. */
  private reframeBlock(pad: number, padX: number, top = this.padTop): void {
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const p0 = this.pad;
    const x0 = this.padX;
    const top0 = this.padTop;
    this.pad = pad;
    this.padX = padX;
    this.padTop = top;
    const f = this.blockFraming(sph.theta, sph.phi);
    this.pad = p0;
    this.padX = x0;
    this.padTop = top0;
    const t0 = this.controls.target.clone();
    this.orbitLive = false;
    void this.tweens
      .run('camera', 0.5, (k) => {
        this.pad = lerp(p0, pad, k);
        this.padX = lerp(x0, padX, k);
        this.padTop = lerp(top0, top, k);
        this.applyView();
        this.target.lerpVectors(t0, f.target, k);
        this.setOrbit(sph.theta, sph.phi, lerp(sph.radius, f.d, k));
      })
      .then(() => {
        if (this.mode === 'block' && !this.flying) this.blockControls();
      });
  }

  /** Orbiting the block: no panning, two fingers turn and pinch, and the camera stays above the table. */
  private blockControls(): void {
    const c = this.controls;
    const off = this.camera.position.clone().sub(this.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const d = this.blockFraming(sph.theta, sph.phi).d;
    c.target.copy(this.target);
    c.minDistance = d * 0.3;
    c.maxDistance = d * 2.4;
    c.minPolarAngle = 0.3;
    c.maxPolarAngle = 1.45;
    c.enablePan = false;
    c.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    c.enabled = true;
    c.update();
    this.orbitLive = true;
  }

  private dollControls(): void {
    const c = this.controls;
    c.minPolarAngle = 0;
    c.maxPolarAngle = 1.42;
    c.enablePan = true;
    c.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  }

  /** Both ends of the push-in. Entering leaves from the camera as it is; leaving returns to the block seen from the flat's side. */
  private pushPlan(bottom: number, entering: boolean): PushPlan {
    const site = this.site!;
    const unit = this.unit!;
    const here = (): Orbit => {
      const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      return { target: this.controls.target.clone(), r: sph.radius, theta: sph.theta, phi: sph.phi, pad: this.pad };
    };
    const now = here();
    const win = placeSite(this.current, this.bearing, unit, this.built.toWorld).window;
    const n = win ? win.normal : new THREE.Vector3(0, 0, 1);
    const face = Math.atan2(n.x, n.z);
    const turn = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const side = turn(now.theta - face) >= 0 ? 1 : -1;
    const pad0 = this.pad;
    let doll: Orbit;
    let block: Orbit;
    if (entering) {
      block = now;
      const theta = face + side * ARRIVE_TURN;
      const phi = this.dollAngles().phi;
      this.pad = bottom;
      const f = this.lensFraming(theta, phi);
      this.pad = pad0;
      doll = { target: f.target, r: f.d, theta, phi, pad: bottom };
    } else {
      doll = now;
      const phi = 1.12;
      const theta = win ? this.unitView(win, phi) : face + side * 0.55;
      this.pad = bottom;
      const f = this.blockFraming(theta, phi);
      this.pad = pad0;
      block = { target: f.target, r: f.d, theta, phi, pad: bottom };
    }
    // Arrive by the shorter way round.
    doll.theta = block.theta + turn(doll.theta - block.theta);
    return { block, doll, storey: unit.storey, lift: site.peak * 2 + 60, sink: floorY(unit.storey) + 4, drop: site.neighbourTop + 4 };
  }

  private beginPush(p: PushPlan): void {
    const site = this.site!;
    this.tweens.kill('camera');
    this.tweens.kill('pad');
    this.controls.enabled = false;
    this.orbitLive = false;
    this.flying = true;
    this.pushing = true;
    site.split(p.storey);
    site.u.uSplit.value = p.storey;
    site.caps.visible = true;
    // The walls the dollhouse will cut are cut now, while the flat is still hidden inside the block.
    this.stepCuts(0, { theta: p.doll.theta, phi: p.doll.phi });
  }

  /**
   * The push-in as a function of time, so it plays, reverses and scrubs
   * alike. The camera closes in on a log scale, because the move spans a
   * hundredfold change of size; the top of the block lifts away once the
   * storey is near, the neighbours have sunk out of the way by then, and the
   * flat's own table and close shadow fit only arrive with the flat.
   */
  private pushAt(p: PushPlan, t: number): void {
    const site = this.site!;
    const k = t / PUSH_TIME;
    const seg = (a: number, d: number, e: (x: number) => number = ease.inOut) => e(clamp((k - a) / d, 0, 1));
    const kT = seg(0, 0.72);
    const kR = seg(0.02, 0.93);
    const kA = seg(0, 0.8);
    const kP = seg(0.2, 0.75);
    this.pad = lerp(p.block.pad, p.doll.pad, seg(0.25, 0.6));
    this.padX = 0;
    this.applyView();
    this.target.lerpVectors(p.block.target, p.doll.target, kT);
    const r = Math.exp(lerp(Math.log(p.block.r), Math.log(p.doll.r), kR));
    this.setOrbit(lerp(p.block.theta, p.doll.theta, kA), lerp(p.block.phi, p.doll.phi, kP), r);

    const u = site.u;
    u.uMove.value.set(p.lift * seg(0.3, 0.42, ease.in), p.sink * seg(0.56, 0.36), p.drop * seg(0.08, 0.4, ease.in));
    site.lines.position.y = u.uMove.value.x;
    (site.faint.material as THREE.LineBasicMaterial).opacity = 0.22 * (1 - seg(0.06, 0.12, ease.linear));
    u.uGround.value = 1 - seg(0.3, 0.45);
    this.setGhost(1 - seg(0.22, 0.2));
    this.built.root.visible = k > 0.3;
    site.root.visible = k < 0.999;
    this.siteW = 1 - seg(0.55, 0.4);
    this.tableGain = seg(0.8, 0.2);
    this.compass.visible = k > 0.999 && this.compassShow > 0.01;
    this.applyLight();
  }

  private arriveFlat(p: PushPlan): void {
    this.pushing = false;
    this.flying = false;
    this.pushHold = null;
    this.site!.root.visible = false;
    this.built.root.visible = true;
    this.setGhost(0);
    this.siteW = 0;
    this.tableGain = 1;
    this.mode = 'doll';
    this.dollControls();
    this.target.copy(p.doll.target);
    this.controls.target.copy(p.doll.target);
    this.setLimits(p.doll.r);
    this.controls.enabled = true;
    this.controls.update();
    this.orbitLive = true;
    this.setCompass(this.compassShow);
    this.applyLight();
    this.hooks.mode?.('doll');
  }

  /** Where a screen point meets the chosen block, in the site frame. */
  private blockHit(clientX: number, clientY: number) {
    if (!this.site) return null;
    this.aim(clientX, clientY);
    const ray = this.ray.ray.clone().applyMatrix4(this.siteMatrix.clone().invert());
    return this.site.hit(ray);
  }

  /** Follows a finger dragging the storey band, along an upright plane through where it pressed. */
  private scrubTo(clientX: number, clientY: number): void {
    const g = this.grab;
    const site = this.site;
    if (!g || !site) return;
    this.aim(clientX, clientY);
    const p = this.ray.ray.intersectPlane(g.plane, new THREE.Vector3());
    if (!p) return;
    const y = p.applyMatrix4(this.siteMatrix.clone().invert()).y;
    // Storey 1 is the void deck, which has no flats.
    const n = clamp(storeyAt(y, site.storeys), Math.min(2, site.storeys), site.storeys);
    if (n === this.marked) return;
    this.setStorey(n);
    this.hooks.storey?.(n);
  }

  private releaseGrab(): void {
    this.grab = null;
    if (this.mode === 'block' && !this.flying) this.controls.enabled = true;
  }

  /** A second finger joins: hand the gesture back to the orbit before its own listener sees the finger. */
  private onDownFirst = (e: PointerEvent): void => {
    if (this.grab && e.pointerId !== this.grab.id && e.target === this.canvas) this.releaseGrab();
  };

  // ── Pointer and keys ──────────────────────────────────────────────────────

  private onDown = (e: PointerEvent): void => {
    this.held.add(e.pointerId);
    if (this.held.size > 1) this.multi = true;
    this.ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false };
    if (this.mode === 'walk') this.canvas.setPointerCapture(e.pointerId);
    if (this.mode === 'block') this.grabBlock(e);
  };

  /**
   * One finger (or the left button) pressed on the block's walls is held
   * from the orbit until it moves: up or down, it drags the storey band;
   * any other way, the orbit takes it. Off the block, or with two fingers,
   * it is the orbit's from the start.
   */
  private grabBlock(e: PointerEvent): void {
    if (this.held.size > 1 || this.flying || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const hit = this.blockHit(e.clientX, e.clientY);
    if (!hit || hit.roof) return;
    const view = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (view.lengthSq() < 1e-6) return;
    const point = hit.point.clone().applyMatrix4(this.siteMatrix);
    this.grab = { id: e.pointerId, x: e.clientX, y: e.clientY, scrub: false, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(view.normalize(), point) };
    this.controls.enabled = false;
  }

  private onMove = (e: PointerEvent): void => {
    const g = this.grab;
    if (g && g.id === e.pointerId) {
      if (!g.scrub && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) {
        // The orbit's own handler runs after this one and catches up from the press.
        if (Math.abs(e.clientY - g.y) > Math.abs(e.clientX - g.x) * 1.2) g.scrub = true;
        else this.releaseGrab();
      }
      if (g.scrub) this.scrubTo(e.clientX, e.clientY);
    }
    const p = this.ptr;
    if (!p || p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 7) p.moved = true;
    if (this.mode === 'walk' && p.moved && !this.flying) {
      const k = (this.camera.fov * DEG) / this.h;
      this.walk.yaw += (e.clientX - p.lx) * k * 1.15;
      this.walk.pitch = clamp(this.walk.pitch + (e.clientY - p.ly) * k * 1.15, -1.05, 1.05);
      this.walk.looking = true;
      this.syncWalkCamera();
    }
    p.lx = e.clientX;
    p.ly = e.clientY;
  };

  private onUp = (e: PointerEvent): void => {
    this.held.delete(e.pointerId);
    const multi = this.multi;
    if (!this.held.size) this.multi = false;
    if (this.grab?.id === e.pointerId) this.releaseGrab();
    const p = this.ptr;
    if (!p || p.id !== e.pointerId) return;
    this.ptr = null;
    // A finger lifted from a pinch is not a tap.
    if (!p.moved && !multi && performance.now() - p.t < 450) this.tap(e.clientX, e.clientY);
  };

  private onKey = (e: KeyboardEvent): void => {
    if (this.mode !== 'walk') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') void this.exitWalk();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.walk.keys.add(k);
      this.walk.route = null;
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.walk.keys.delete(e.key.toLowerCase());
  };

  private aim(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
  }

  /** Which faces of the walls have the sun on them now, worked out again only after the sun has moved. */
  private litNow(): Uint8Array {
    if (this.litDirty || this.lit.length !== this.current.walls.length * 2) {
      this.lit = litFaces(this.current, this.sunDir());
      this.litDirty = false;
    }
    return this.lit;
  }

  /** How tall a wall is drawn right now, metres, with any cut applied. */
  private wallTop = (i: number): number => cutTop(this.u.uCut.value[i], this.u.uCutSpan.value);

  private tap(clientX: number, clientY: number): void {
    if (this.flying) return;
    if (this.mode === 'block') {
      const site = this.site;
      const hit = this.blockHit(clientX, clientY);
      const pick = site && hit && !hit.roof ? site.facadeAt(hit.point, hit.normal) : null;
      if (site && hit && pick) this.hooks.facade?.({ index: pick.index, facade: site.facades[pick.index], along: pick.along, storey: storeyAt(hit.point.y, site.storeys) });
      return;
    }
    this.aim(clientX, clientY);
    if (this.mode === 'walk') {
      const hitWall = this.built.pick(this.ray.ray, this.wallTop);
      const o = this.ray.ray.origin;
      const d = this.ray.ray.direction;
      let point: THREE.Vector3 | null = null;
      if (d.y < -0.02) point = o.clone().addScaledVector(d, -o.y / d.y);
      if (hitWall && (!point || hitWall.distance < o.distanceTo(point))) point = hitWall.point;
      if (!point || o.distanceTo(point) > 30) return;
      this.goTo({ x: point.x, z: point.z });
      return;
    }
    if (this.mode === 'doll' && this.lens === 'rules') {
      const hit = this.built.pick(this.ray.ray, this.wallTop);
      const wall = hit ? this.plan.walls[hit.wall] : null;
      this.select(wall && wall.kind !== 'parapet' ? wall : null);
    }
  }

  /** Marks a wall as chosen and tells the interface. */
  select(wall: Wall | null): void {
    if (this.highlight) {
      this.scene.remove(this.highlight.group);
      this.highlight.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
      });
      this.highlight = null;
    }
    if (wall) {
      const f = frameOf(wall);
      const wh = (wall.h ?? this.plan.height) / 1000;
      // A unit-high box on the floor, scaled each frame to the wall as it is drawn, cut or not.
      const geo = new THREE.BoxGeometry((f.len + wall.t) / 1000 + 0.03, 1, wall.t / 1000 + 0.04).translate(0, 0.5, 0);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false })));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1c1d20, transparent: true, opacity: 0.9 })));
      const [x, z] = this.built.toWorld((wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
      g.position.set(x, -0.005, z);
      g.rotation.y = -Math.atan2(f.dy, f.dx);
      g.renderOrder = 4;
      this.scene.add(g);
      this.highlight = { group: g, wall: this.plan.walls.indexOf(wall), h: wh };
      this.fitHighlight();
    }
    this.u.uSel.value = this.highlight ? this.highlight.wall : -1;
    this.dirty = true;
    this.hooks.wall?.(wall);
  }

  private fitHighlight(): void {
    const hl = this.highlight;
    if (!hl) return;
    hl.group.scale.y = Math.min(hl.h, this.wallTop(hl.wall)) + 0.025;
  }

  // ── Overlay support ───────────────────────────────────────────────────────

  /** Screen position of a point in the scene, in CSS pixels. */
  project(v: THREE.Vector3, out: { x: number; y: number; front: boolean }): void {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.w;
    out.y = (-p.y * 0.5 + 0.5) * this.h;
    out.front = p.z < 1;
  }

  private planPoint = new THREE.Vector3();

  /**
   * Screen position of a point on the plan (millimetres) at a height above the
   * flat's floor (metres), for captions pinned to rooms and walls. Goes through
   * the flat's own group, so it stays true wherever the flat is placed.
   */
  projectPlan(x: number, y: number, height: number, out: { x: number; y: number; front: boolean }): void {
    const [wx, wz] = this.built.toWorld(x, y);
    this.project(this.built.root.localToWorld(this.planPoint.set(wx, height, wz)), out);
  }

  /**
   * Walks to a spot on the plan (millimetres), round furniture and through
   * doors as a tap on the floor does, then turns to face `lookAt`: the room
   * strip's jump. The turn waits for arrival, so the walker looks where it is
   * going first and at the window last. A tap, a drag or a key on the way
   * cancels the turn. Only while walking.
   */
  walkTo(at: { x: number; y: number }, lookAt?: { x: number; y: number }): void {
    if (this.mode !== 'walk' || this.flying) return;
    const [wx, wz] = this.built.toWorld(at.x, at.y);
    const spot = this.nav.nearestFree({ x: wx, z: wz });
    if (!spot) return;
    this.walk.keys.clear();
    this.walk.looking = false;
    this.goTo(spot);
    const route = this.walk.route;
    if (!lookAt) return;
    const [lx, lz] = this.built.toWorld(lookAt.x, lookAt.y);
    let from: { yaw: number; pitch: number } | null = null;
    let off = false;
    void this.tweens.run(
      'look',
      0.9,
      (k) => {
        if (off) return;
        if ((this.walk.route && this.walk.route !== route) || this.walk.looking || this.walk.keys.size || this.mode !== 'walk') {
          off = true;
          return;
        }
        from ??= { yaw: this.walk.yaw, pitch: this.walk.pitch };
        const want = Math.atan2(-(lx - this.walk.x), -(lz - this.walk.z));
        // The short way round.
        const turn = Math.atan2(Math.sin(want - from.yaw), Math.cos(want - from.yaw));
        this.walk.yaw = from.yaw + turn * k;
        this.walk.pitch = lerp(from.pitch, -0.04, k);
        this.syncWalkCamera();
      },
      { delay: route ? route.dur + 0.05 : 0 }
    );
  }

  /**
   * Insets and a fresh fit, travelling together. setInsets alone slides the
   * model but keeps its size, so when a much taller panel opens (the Sun lens,
   * a wall's verdict) the model is left too big for the space above it. This
   * re-fits for the new insets at the angle the user chose, resetting zoom and
   * pan as a lens change does. Outside the dollhouse it is plain setInsets.
   * `top` is the header's height, as for setInsets; leaving it out means none.
   */
  fitInsets(bottom: number, left = 0, top = 0): void {
    if (this.mode === 'block' && !this.flying && this.site) {
      this.reframeBlock(bottom, left, top);
      return;
    }
    if (this.mode !== 'doll' || this.introRunning || this.flying) {
      this.setInsets(bottom, left, top);
      return;
    }
    // reframe fits against the new insets and eases the insets there alongside the camera.
    this.reframe(bottom, left, 0.5, top);
  }

  // ── Cutting walls away ────────────────────────────────────────────────────

  /**
   * Walls between the camera and the rooms fold down to a stub, the way a
   * sectional model is cut: perimeter walls on the near side, and the inside
   * walls that face the camera most squarely. The others stand, so the rooms
   * keep their shape. Shadows still come from every wall at full height, so
   * the sun on the floor stays true. With an orbit given, the cut for that
   * view is applied at once. Returns whether anything moved.
   */
  private stepCuts(dt: number, orbit?: { theta: number; phi: number }): boolean {
    let cx: number;
    let cz: number;
    let steep: number;
    if (orbit) {
      cx = Math.sin(orbit.theta);
      cz = Math.cos(orbit.theta);
      steep = Math.sin(orbit.phi);
    } else {
      const f = this.camera.getWorldDirection(new THREE.Vector3());
      steep = Math.hypot(f.x, f.z);
      cx = -f.x / (steep || 1);
      cz = -f.z / (steep || 1);
    }
    const active = !!orbit || this.mode === 'doll';
    const cut = this.u.uCut.value;
    const lit = this.lens === 'sun' ? this.litNow() : null;
    let moved = false;
    this.built.cuts.forEach((w, i) => {
      const on = this.cutWant[i] > 0.5;
      let want = 0;
      // Looking almost straight down, nothing needs cutting; a wall chosen in the rules lens stands up to be seen.
      if (active && w.cuttable && steep > 0.3 && this.highlight?.wall !== i) {
        const facing = w.nx * cx + w.nz * cz;
        // Thresholds differ by state, so a wall seen at 45° does not flutter.
        if (w.out !== 0) want = w.out * facing > (on ? 0.1 : 0.22) ? 1 : 0;
        else want = Math.abs(facing) > (on ? 0.68 : 0.74) ? 1 : 0;
        // In the Sun lens an inside wall stands when the face it turns to the camera has the sun on it:
        // with the sun low, that is where all of its light lands.
        if (want && lit && w.out === 0 && lit[i * 2 + (facing > 0 ? 0 : 1)]) want = 0;
      }
      this.cutWant[i] = want;
      const now = cut[i];
      if (now === want) return;
      cut[i] = orbit ? want : want > now ? Math.min(1, now + dt / CUT_TIME) : Math.max(0, now - dt / CUT_TIME);
      moved = true;
    });
    if (moved) this.fitHighlight();
    return moved;
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    this.last = now;
    if (this.tweens.active) {
      this.tweens.update(dt);
      this.dirty = true;
      this.shadowDirty = true;
    }
    if (this.sunChase) this.chaseSun(dt);
    if (this.mode === 'walk' && !this.flying) this.stepWalk(dt);
    else if (this.orbitLive && !this.pushing) this.controls.update();
    // During the push-in the walls hold the cut made for where it arrives.
    if (!this.introRunning && !this.pushing && this.stepCuts(dt)) this.dirty = true;
    if (!this.dirty) return;
    // A walk flight needs a near plane small enough for the room once it gets there.
    if (this.mode !== 'walk' || this.flying) this.fitDepth(this.flying ? 0.06 : 0.5);
    this.dirty = false;
    if (this.outsideK > 0) this.stepOutside();
    if (this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    this.hooks.frame?.();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('pointerdown', this.onDownFirst, { capture: true });
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controls.dispose();
    this.dropSite();
    this.setUnit(null);
    this.built.dispose();
    this.outdoors.dispose();
    this.renderer.dispose();
  }
}
