import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { frameOf } from '../plan/geometry';
import type { Plan, Wall } from '../plan/types';
import type { PathPoint, Sun } from '../sg/solar';
import { buildFlat, type Built, type RoomAnchor } from './build';
import { BOUNCE_SCALE } from './field';
import { PAL, col, cutTop, installToneMapping, makeUniforms, type Uniforms } from './materials';
import { Nav, type P2 } from './nav';
import { Tweens, clamp, ease, lerp, smooth } from './tween';

export type Lens = 'space' | 'sun' | 'rules';
export type Mode = 'plan' | 'doll' | 'walk';

export interface Hooks {
  /** Called after every rendered frame, for overlays that track the scene. */
  frame?: () => void;
  mode?: (m: Mode) => void;
  wall?: (wall: Wall | null) => void;
  /** day: 0 night to 1 full daylight. gold: 1 at the horizon, 0 with the sun high. */
  atmosphere?: (day: number, gold: number) => void;
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
  readonly plan: Plan;
  mode: Mode = 'plan';
  lens: Lens = 'space';
  anchors: RoomAnchor[] = [];

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

  private compass = new THREE.Group();
  private compassMats: { mat: THREE.Material & { opacity: number }; base: number }[] = [];
  private compassShow = 0;
  private sunSprite: THREE.Sprite;
  private sunCore: THREE.Mesh;
  private pathDots: THREE.Points;
  private hourDots: THREE.Points;
  private drop: THREE.Line;
  private domeR: number;
  /** The day's arc above the horizon, in the compass frame, for framing the sun lens. */
  private pathPts: THREE.Vector3[] = [];

  private target = new THREE.Vector3();
  private w = 1;
  private h = 1;
  private pad = 0;
  private padX = 0;
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

  constructor(canvas: HTMLCanvasElement, plan: Plan, hooks: Hooks = {}) {
    this.canvas = canvas;
    this.plan = plan;
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

    const size = this.built.box.getSize(new THREE.Vector3());
    const radius = Math.hypot(size.x, size.z) / 2;
    this.domeR = radius + 0.9;
    this.target.set(0, this.built.height * 0.3, 0);

    // Light. Lamps and bounced sun come from the built light field rather than three's point
    // lights, which would shine through walls and cost every surface on a phone.
    this.scene.add(this.hemi);
    this.fill.position.copy(FILL_DIR).multiplyScalar(20);
    this.scene.add(this.fill);
    const s = this.sunLight.shadow;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    s.mapSize.set(coarse ? 1536 : 2048, coarse ? 1536 : 2048);
    s.bias = -0.0003;
    // Enough to lift a receiver clear of its own depth across the whole width of the soft filter.
    s.normalBias = 0.024;
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight, this.sunLight.target);

    // Compass ring and sun dome, drawn in a frame where -Z is true north.
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

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.setCompass(0);
    this.applyLight();
    this.raf = requestAnimationFrame(this.tick);
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
    const tanV = ((t * (this.h - this.pad)) / (this.h + this.pad)) * margin;
    const tanH = ((t * (this.w - this.padX)) / (this.h + this.pad)) * margin;
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
    const near = Math.max(least, dist - reach - 2);
    const far = dist + reach + 10;
    if (Math.abs(near - this.camera.near) < near * 0.02 && Math.abs(far - this.camera.far) < far * 0.02) return;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  private applyView(): void {
    const pad = this.pad;
    const padX = this.padX;
    if (pad > 0.5 || padX > 0.5) {
      this.camera.aspect = (this.w + padX) / (this.h + pad);
      this.camera.setViewOffset(this.w + padX, this.h + pad, 0, pad, this.w, this.h);
    } else {
      this.camera.clearViewOffset();
      this.camera.aspect = this.w / this.h;
    }
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Screen space taken by interface at the bottom and left, in CSS pixels. The model centres in what is left. */
  setInsets(bottom: number, left = 0): void {
    if (this.mode === 'walk' || this.introRunning) return;
    const b0 = this.pad;
    const l0 = this.padX;
    if (Math.abs(b0 - bottom) < 1 && Math.abs(l0 - left) < 1) return;
    if (this.mode === 'plan') {
      this.pad = bottom;
      this.padX = left;
      this.applyView();
      const a = this.planAngles();
      this.setOrbit(a.theta, a.phi, this.fit(a.theta, a.phi, 0.8));
      return;
    }
    // The sun's controls are tall on a phone, so its dome is framed again for the room they leave.
    if (this.lens === 'sun' && this.mode === 'doll') {
      this.reframe(bottom, left, 0.5);
      return;
    }
    void this.tweens.run('pad', 0.5, (k) => {
      this.pad = lerp(b0, bottom, k);
      this.padX = lerp(l0, left, k);
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
    if (this.mode === 'doll') this.reframe();
  }

  private setCompass(k: number): void {
    this.compassShow = k;
    for (const { mat, base } of this.compassMats) mat.opacity = base * k;
    this.compass.visible = k > 0.01;
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
   * Moves the camera to frame the current lens, easing the screen insets to
   * new values on the way when they are given. It keeps the user's angle,
   * except that the sun lens swings round to see the day's arc side on.
   */
  private reframe(pad = this.pad, padX = this.padX, dur = 0.9): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const theta0 = sph.theta;
    if (this.lens === 'sun') sph.theta = this.arcAzimuth(sph.theta);
    const p0 = this.pad;
    const x0 = this.padX;
    this.pad = pad;
    this.padX = padX;
    const f = this.lensFraming(sph.theta, sph.phi);
    this.pad = p0;
    this.padX = x0;
    this.controls.maxDistance = Math.max(this.controls.maxDistance, f.d * 1.25);
    const d0 = sph.radius;
    const t0 = this.controls.target.clone();
    this.orbitLive = false;
    void this.tweens
      .run('camera', dur, (k) => {
        this.pad = lerp(p0, pad, k);
        this.padX = lerp(x0, padX, k);
        this.applyView();
        this.target.lerpVectors(t0, f.target, k);
        this.setOrbit(lerp(theta0, sph.theta, k), sph.phi, lerp(d0, f.d, k));
      })
      .then(() => {
        if (this.mode !== 'doll') return;
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
    this.applyLight();
  }

  /** The day's track across the sky, drawn as dots on the dome. */
  setDayPath(points: PathPoint[]): void {
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
    this.u.uLamp.value.copy(col(0xffc98c)).multiplyScalar(LAMP * lamps);
    (this.built.lamps.material as THREE.MeshLambertMaterial).emissiveIntensity = 2.6 * lamps;
    // The bounce only depends on where the sun is, and the opening calls this every frame.
    if (dir.distanceToSquared(this.bounceDir) > 1e-8) {
      this.built.field.setSun(dir);
      this.bounceDir.copy(dir);
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
    t.uCast.value = 0.17 * smooth(2 * DEG, 24 * DEG, altitude) * g;
    t.uContact.value = lerp(0.12, 0.26, day);

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
    const centre = new THREE.Vector3(0, this.built.height / 2, 0);
    this.sunLight.position.copy(centre).addScaledVector(dir, 40);
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
    const b = this.built.box;
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (const x of [b.min.x - 0.2, b.max.x + 0.2])
      for (const y of [-this.built.base, b.max.y + 0.1])
        for (const z of [b.min.z - 0.2, b.max.z + 0.2]) {
          p.set(x, y, z).applyMatrix4(probe.matrixWorldInverse);
          lo.min(p);
          hi.max(p);
        }
    cam.left = lo.x;
    cam.right = hi.x;
    cam.bottom = lo.y;
    cam.top = hi.y;
    cam.near = Math.max(0.1, -hi.z - 0.5);
    cam.far = -lo.z + 0.5;
    cam.updateProjectionMatrix();
    const texel = Math.max(hi.x - lo.x, hi.y - lo.y) / this.sunLight.shadow.mapSize.x;
    this.sunLight.shadow.radius = Math.max(1, SOFT_STEP / texel);
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

  async enterWalk(at?: { x: number; y: number }, lookAt?: { x: number; y: number }): Promise<void> {
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
    const p1 = new THREE.Vector3(spot.x, EYE, spot.z);
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.walk.pitch, this.walk.yaw, 0, 'YXZ'));
    const f1 = this.walkFov();
    this.camera.near = 0.06;
    this.flying = true;
    await this.tweens.run(
      'camera',
      1.9,
      (k) => {
        this.camera.position.lerpVectors(p0, p1, k);
        this.camera.quaternion.slerpQuaternions(q0, q1, smooth(0.1, 1, k));
        this.camera.fov = lerp(f0, f1, k);
        this.pad = lerp(pad0, 0, k);
        this.applyView();
        this.setShell(smooth(0.62, 0.97, k));
        // Under the ceiling the sky reaches a room only through its windows.
        this.u.uInside.value = smooth(0.5, 1, k);
      },
      { ease: ease.inOutQuart }
    );
    this.flying = false;
    this.syncWalkCamera();
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
    await this.tweens.run(
      'camera',
      1.6,
      (k) => {
        this.camera.position.lerpVectors(p0, saved.pos, k);
        this.camera.quaternion.slerpQuaternions(q0, q1, smooth(0, 0.85, k));
        this.camera.fov = lerp(f0, DOLL_FOV, k);
        this.applyView();
        this.setShell(1 - smooth(0.05, 0.4, k));
        this.u.uInside.value = 1 - smooth(0.05, 0.5, k);
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

  // ── Pointer and keys ──────────────────────────────────────────────────────

  private onDown = (e: PointerEvent): void => {
    this.ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false };
    if (this.mode === 'walk') this.canvas.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
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
    const p = this.ptr;
    if (!p || p.id !== e.pointerId) return;
    this.ptr = null;
    if (!p.moved && performance.now() - p.t < 450) this.tap(e.clientX, e.clientY);
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

  /** How tall a wall is drawn right now, metres, with any cut applied. */
  private wallTop = (i: number): number => cutTop(this.u.uCut.value[i], this.u.uCutSpan.value);

  private tap(clientX: number, clientY: number): void {
    if (this.flying) return;
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

  /**
   * Insets and a fresh fit, travelling together. setInsets alone slides the
   * model but keeps its size, so when a much taller panel opens (the Sun lens,
   * a wall's verdict) the model is left too big for the space above it. This
   * re-fits for the new insets at the angle the user chose, resetting zoom and
   * pan as a lens change does. Outside the dollhouse it is plain setInsets.
   */
  fitInsets(bottom: number, left = 0): void {
    if (this.mode !== 'doll' || this.introRunning || this.flying) {
      this.setInsets(bottom, left);
      return;
    }
    // reframe fits against the new insets and eases the insets there alongside the camera.
    this.reframe(bottom, left, 0.5);
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
    if (this.mode === 'walk' && !this.flying) this.stepWalk(dt);
    else if (this.orbitLive) this.controls.update();
    if (!this.introRunning && this.stepCuts(dt)) this.dirty = true;
    if (!this.dirty) return;
    // A walk flight needs a near plane small enough for the room once it gets there.
    if (this.mode !== 'walk' || this.flying) this.fitDepth(this.flying ? 0.06 : 0.5);
    this.dirty = false;
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
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controls.dispose();
    this.built.dispose();
    this.renderer.dispose();
  }
}
